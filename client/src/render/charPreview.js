// [accounts] 3D preview of the selected character on the character selection screen: its real GLB (same model as
// in game, Idle animation) on a stone pedestal, dramatic top light, class-coloured rim light and slow turntable
// (drag to turn it). A second, small WebGL context that only renders while the screen is visible; when WebGL is
// unavailable, attach() returns false and the UI keeps the class artwork.
import * as THREE from 'three';
import { CLASSES } from '@shared/data.js';
import { Animator } from './animator.js';

export class CharPreview {
  constructor(assets) {
    this.assets = assets;
    this.renderer = null;
    this.host = null;
    this.inst = null;
    this.animator = null;
    this.current = null;
    this.running = false;
    this.last = 0;
    this.spin = 0;
    this.drag = null;
    this.frame = this.frame.bind(this);
  }

  /** Create the renderer inside `host` (once). Returns false when WebGL is unavailable. */
  attach(host) {
    if (this.renderer) return this.host === host;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch {
      return false;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.AgXToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.className = 'bv-cs-canvas';
    host.appendChild(renderer.domElement);
    this.renderer = renderer;
    this.host = host;

    const scene = new THREE.Scene();
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    this.camera.position.set(0, 1.45, 5.6);
    this.camera.lookAt(0, 1.0, 0);

    // pedestal: worn stone disc with a gold inlay ring
    const stone = new THREE.MeshStandardMaterial({ color: 0x3b3833, roughness: 0.92, metalness: 0.02 });
    const top = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.15, 0.28, 48), stone);
    top.position.y = -0.14;
    top.receiveShadow = true;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.35, 0.3, 48), new THREE.MeshStandardMaterial({ color: 0x24221f, roughness: 1 }));
    base.position.y = -0.43;
    base.receiveShadow = true;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.98, 0.022, 8, 64), new THREE.MeshStandardMaterial({ color: 0xc9a24d, metalness: 0.9, roughness: 0.35, emissive: 0x3a2808 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.005;
    this.pedestal = new THREE.Group();
    this.pedestal.add(top, base, ring);
    scene.add(this.pedestal);

    // lights: warm key from above (shadow on the pedestal), class-coloured rim from behind, cold fill
    const key = new THREE.SpotLight(0xffe2b0, 60, 14, Math.PI / 7, 0.55, 1.6);
    key.position.set(1.2, 5.5, 2.6);
    key.target.position.set(0, 0.6, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0004;
    scene.add(key, key.target);
    this.rim = new THREE.DirectionalLight(0xc9a24d, 3.2);
    this.rim.position.set(-2.5, 2.6, -3.5);
    scene.add(this.rim);
    scene.add(new THREE.HemisphereLight(0x6b7fa8, 0x1a120a, 0.55));

    this.pivot = new THREE.Group();
    scene.add(this.pivot);

    const el = renderer.domElement;
    el.addEventListener('pointerdown', (e) => {
      this.drag = { x: e.clientX, spin: this.spin, id: e.pointerId };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.drag || this.drag.id !== e.pointerId) return;
      this.spin = this.drag.spin + (e.clientX - this.drag.x) * 0.012;
    });
    const end = () => { this.drag = null; };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    this.ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.resize()) : null;
    this.ro?.observe(host);
    this.resize();
    return true;
  }

  resize() {
    if (!this.renderer) return;
    const r = this.host.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // keep the whole character in frame on narrow stages
    this.camera.position.z = w / h < 0.8 ? 7.2 : 5.6;
    this.camera.updateProjectionMatrix();
  }

  /** Show a character summary ({ cls, … }) or nothing (null: stops rendering). */
  show(ch) {
    if (!this.renderer) return;
    const cls = ch?.cls && CLASSES[ch.cls] ? ch.cls : null;
    if (!cls) {
      this.running = false;
      return;
    }
    if (cls !== this.current) {
      this.clear();
      this.current = cls;
      try {
        const inst = this.assets.instantiate(CLASSES[cls].model);
        this.inst = inst;
        const s = 1.9 / Math.max(0.5, inst.height || 1.8);
        inst.object.scale.multiplyScalar(s);
        inst.object.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
        const holder = new THREE.Group();
        holder.add(inst.object);
        this.pivot.add(holder);
        this.animator = new Animator(inst.object, inst.clips, holder, { style: 'humanoid', height: 1.9 });
      } catch (err) {
        console.info('[aperçu] modèle indisponible', err?.message || err);
      }
      this.rim.color.set(CLASSES[cls].color || '#c9a24d');
      this.spin = -0.35;
    }
    if (!this.running) {
      this.running = true;
      this.last = performance.now();
      requestAnimationFrame(this.frame);
    }
  }

  clear() {
    if (this.inst) {
      this.pivot.clear();
      this.assets.disposeInstance(this.inst);
    }
    this.inst = null;
    this.animator = null;
    this.current = null;
  }

  frame(now) {
    if (!this.running || !this.renderer) return;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (!this.drag) this.spin += dt * 0.25;
    this.pivot.rotation.y = this.spin;
    this.animator?.update(dt);
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this.frame);
  }
}
