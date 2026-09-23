// Cascaded shadow maps for the sun / moon.
//
// Why not three/addons/csm: CSM needs `csm.setupMaterial()` on every material (it replaces onBeforeCompile, which
// our wind / see-through / terrain patches already use, and keeps a Map of every material → leaks with the
// per-entity cloned materials). Here the cascades are N ordinary shadow-casting DirectionalLights and ONE global
// shader-chunk patch makes every lit material treat them as a single light: the fragment picks the finest cascade
// whose shadow map contains it (cross-fading near the border, the last one fading to "lit" far away).
// Nothing to set up per material, works with instancing, skinning and every onBeforeCompile patch.
//
// Cascades are bounding spheres of camera frustum slices (rotation-invariant size = no shimmering), snapped to
// shadow-map texels, and the far cascades are refreshed less often (staggered) to save draw calls.
import * as THREE from 'three';

const CASCADE_CHUNK = /* glsl */ `
#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )
	DirectionalLight directionalLight;
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLightShadow;
	#endif
	#if NUM_DIR_LIGHT_SHADOWS > 1
		// [render-souls] shadowed directional lights are the cascades of ONE light (the sun / moon)
		directionalLight = directionalLights[ 0 ];
		getDirectionalLightInfo( directionalLight, directLight );
		#if defined( USE_SHADOWMAP )
		float bvShadow = 0.0;
		float bvRemain = 1.0;
		vec3 bvC;
		float bvE;
		float bvW;
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
			if ( bvRemain > 0.001 ) {
				bvC = vDirectionalShadowCoord[ i ].xyz / vDirectionalShadowCoord[ i ].w;
				bvE = max( abs( bvC.x - 0.5 ), abs( bvC.y - 0.5 ) ) * 2.0;
				if ( bvE < 1.0 && bvC.z < 1.0 ) {
					directionalLightShadow = directionalLightShadows[ i ];
					bvW = bvRemain * ( 1.0 - smoothstep( 0.82, 0.98, bvE ) );
					bvShadow += bvW * getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] );
					bvRemain -= bvW;
				}
			}
		}
		#pragma unroll_loop_end
		bvShadow += bvRemain;
		directLight.color *= ( directLight.visible && receiveShadow ) ? bvShadow : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
		#if NUM_DIR_LIGHTS > NUM_DIR_LIGHT_SHADOWS
		#pragma unroll_loop_start
		for ( int i = NUM_DIR_LIGHT_SHADOWS; i < NUM_DIR_LIGHTS; i ++ ) {
			directionalLight = directionalLights[ i ];
			getDirectionalLightInfo( directionalLight, directLight );
			RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
		}
		#pragma unroll_loop_end
		#endif
	#else
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
		directionalLight = directionalLights[ i ];
		getDirectionalLightInfo( directionalLight, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
		directionalLightShadow = directionalLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
	#endif
#endif
`;

/** Objects on this layer (and not on layer 0) cast shadows into the first cascade only. Cameras must enable it. */
export const SMALL_CASTER_LAYER = 2;

let installed = false;
/** Patch the global light chunk once (before the first shader compiles). Returns true when active. */
export function installCascadeChunk() {
  if (installed) return true;
  const src = THREE.ShaderChunk.lights_fragment_begin;
  const start = src.indexOf('#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )');
  const endMarker = '#pragma unroll_loop_end';
  if (start < 0) return false;
  const end = src.indexOf(endMarker, start);
  const close = end < 0 ? -1 : src.indexOf('#endif', end);
  if (close < 0) return false;
  THREE.ShaderChunk.lights_fragment_begin = src.slice(0, start) + CASCADE_CHUNK + src.slice(close + '#endif'.length);
  installed = true;
  return true;
}

/**
 * Cascade layouts per shadow quality: [split distances (fraction of maxDist)], map size, update periods and phases.
 * Phases are chosen so that at most one staggered (far) cascade is re-rendered in any frame: this keeps the worst
 * frame's draw-call count close to the average one.
 */
const LAYOUTS = {
  1: { splits: [0.2, 1], size: 1024, every: [1, 2], phase: [0, 1] },
  2: { splits: [0.1, 0.34, 1], size: 2048, every: [1, 2, 2], phase: [0, 1, 0] },
  3: { splits: [0.06, 0.18, 0.45, 1], size: 2048, every: [1, 2, 4, 4], phase: [0, 1, 0, 2] },
};

const _fwd = new THREE.Vector3();
const _c = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _Y = new THREE.Vector3(0, 1, 0);

export class CascadedShadows {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.lights = [];
    this.cascades = [];
    this.level = -1;
    this.maxDist = 110;
    this.frame = 0;
    this.direction = new THREE.Vector3(0.4, 0.8, 0.3).normalize(); // towards the light
    this.color = new THREE.Color(1, 1, 1);
    this.intensity = 3;
    this.chunk = installCascadeChunk();
    this._aspect = 0;
    this._fov = 0;
  }

  /** Main light (the first cascade), e.g. for the water specular or god rays. */
  get light() {
    return this.lights[0];
  }

  /** (Re)build the lights for a shadow quality 0..3 and a max shadow distance. */
  configure(level, maxDist) {
    level = this.chunk ? level : Math.min(level, 0);
    this.maxDist = maxDist;
    if (level === this.level) { this._aspect = 0; return; }
    this.level = level;
    for (const L of this.lights) {
      this.scene.remove(L, L.target);
      L.shadow.map?.dispose();
      L.dispose();
    }
    this.lights = [];
    this.cascades = [];
    const layout = LAYOUTS[level];
    const n = layout ? layout.splits.length : 1;
    for (let i = 0; i < n; i++) {
      const L = new THREE.DirectionalLight(0xffffff, this.intensity);
      L.name = i === 0 ? 'sun' : `sunCascade${i}`;
      L.castShadow = !!layout;
      if (layout) {
        L.shadow.mapSize.set(layout.size, layout.size);
        L.shadow.autoUpdate = false;
        L.shadow.needsUpdate = true;
        L.shadow.intensity = 1;
        // small props (layer SMALL_CASTER_LAYER) only cast into the first, sharpest cascade
        L.shadow.camera.layers.set(0);
        if (i === 0) L.shadow.camera.layers.enable(SMALL_CASTER_LAYER);
      }
      this.scene.add(L, L.target);
      this.lights.push(L);
      this.cascades.push({ near: 0, far: 0, center: 0, radius: 1, every: layout ? layout.every[i] : 1, phase: layout ? layout.phase[i] : 0 });
    }
    this.renderer.shadowMap.enabled = !!layout;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this._aspect = 0; // force a split recompute
    this._lastDir = undefined; // every new cascade renders its map on the first frame
  }

  _splits(camera) {
    const layout = LAYOUTS[this.level];
    if (!layout) return;
    const tanY = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    // a page opened in a 0 × 0 (hidden) viewport has a NaN aspect until the first resize: NaN cascades would disable
    // shadow-camera culling (every caster drawn into every cascade)
    const aspect = Number.isFinite(camera.aspect) && camera.aspect > 0 ? camera.aspect : 16 / 9;
    const tanX = tanY * aspect;
    const k2 = tanX * tanX + tanY * tanY;
    let near = camera.near;
    layout.splits.forEach((f, i) => {
      const far = Math.max(near + 1, f * this.maxDist);
      // smallest sphere (centred on the view axis) containing the frustum slice [near, far]
      const rn2 = near * near * k2, rf2 = far * far * k2;
      let c = (rf2 - rn2 + far * far - near * near) / (2 * (far - near));
      c = Math.min(far, Math.max(near, c));
      const radius = Math.sqrt(rf2 + (far - c) * (far - c)) * 1.04;
      const cs = this.cascades[i];
      cs.near = near; cs.far = far; cs.center = c; cs.radius = radius;
      const L = this.lights[i];
      const cam = L.shadow.camera;
      cam.left = -radius; cam.right = radius; cam.top = radius; cam.bottom = -radius;
      cam.near = 0.5;
      cam.far = radius * 2 + 220;
      cam.updateProjectionMatrix();
      const texel = (2 * radius) / layout.size;
      cs.texel = texel;
      // softer filtering close to the camera, tighter far away (similar penumbra size in metres)
      L.shadow.radius = i === 0 ? 2.6 : i === 1 ? 2.0 : 1.4;
      L.shadow.bias = -0.00025 * (1 + i * 0.6);
      L.shadow.normalBias = texel * 1.4;
      near = far;
    });
    this._aspect = camera.aspect;
    this._fov = camera.fov;
  }

  /** Per frame: direction (towards the light), colour and intensity; place / refresh the cascades. */
  update(camera, direction, color, intensity) {
    this.frame++;
    this.direction.copy(direction);
    this.color.copy(color);
    this.intensity = intensity;
    for (const L of this.lights) {
      L.color.copy(color);
      L.intensity = intensity;
    }
    const layout = LAYOUTS[this.level];
    if (!layout) {
      const L = this.lights[0];
      L.position.copy(camera.position).addScaledVector(direction, 100);
      L.target.position.copy(camera.position);
      L.target.updateMatrixWorld();
      return;
    }
    if (!Object.is(camera.aspect, this._aspect) || camera.fov !== this._fov) this._splits(camera);
    camera.getWorldDirection(_fwd);
    // light basis for texel snapping
    const dir = this.direction;
    _right.crossVectors(_Y, dir);
    if (_right.lengthSq() < 1e-6) _right.set(1, 0, 0);
    _right.normalize();
    _up.crossVectors(dir, _right).normalize();
    const enabled = intensity > 0.001;
    for (let i = 0; i < this.lights.length; i++) {
      const cs = this.cascades[i];
      const L = this.lights[i];
      const due = (this.frame + cs.phase) % cs.every === 0 || this._lastDir === undefined || !L.shadow.map;
      if (!due || !enabled) { L.shadow.needsUpdate = false; continue; }
      _c.copy(camera.position).addScaledVector(_fwd, cs.center);
      const t = cs.texel;
      const pr = Math.round(_c.dot(_right) / t) * t;
      const pu = Math.round(_c.dot(_up) / t) * t;
      const pd = _c.dot(dir);
      _c.copy(_right).multiplyScalar(pr).addScaledVector(_up, pu).addScaledVector(dir, pd);
      L.target.position.copy(_c);
      L.position.copy(_c).addScaledVector(dir, cs.radius + 200);
      L.target.updateMatrixWorld();
      L.updateMatrixWorld();
      L.shadow.needsUpdate = true;
    }
    this._lastDir = 1;
  }

  /** Force every cascade to re-render on the next frame (e.g. after a teleport). */
  invalidate() {
    this._lastDir = undefined;
  }

  dispose() {
    for (const L of this.lights) {
      this.scene.remove(L, L.target);
      L.shadow.map?.dispose();
      L.dispose();
    }
    this.lights = [];
  }
}
