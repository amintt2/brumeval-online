"""VFX flipbooks rendered in Cycles from animated procedural volumes / emission shader nodes / generated geometry.

Every effect is a small scene whose shader nodes read per-frame Value nodes (time, loop blend, fade...) that the
script sets before each render; geometric effects (sparks, shards, bolts, motes) are regenerated per frame.
Looping effects blend two evaluations of the same noise field at t and t - T_loop (weight t/T_loop) INSIDE the
shader, so frame N-1 flows into frame 0 without a cut.

Atlas layout: row-major, frame 0 at the TOP-LEFT, square frames. Additive effects: RGB = emitted light (soft
clipped, sRGB), alpha = coverage estimate (max channel). Normal effects: straight (un-premultiplied) RGB + alpha,
colours bled into transparent texels (no dark fringes when mip-mapped).
client/public/vfx/manifest.json: { name: {file, cols, rows, frames, fps, loop, blending, size, frameSize, anchor} }
"""
import json
import math
import os

import bpy
import numpy as np

from ld_common import (NB, PREVIEWS, VFX_DIR, checker_bg, label, lin_to_srgb, log, new_scene, render, resize,
                       save_png, save_webp, sheet, sock, world_color)

# name: cols, rows, frames, fps, loop, blending, size (m, quad size in the world), extent (m framed), anchor
EFFECTS = {
    "fire_loop":      dict(cols=8, rows=8, frames=64, fps=30, loop=True, blending="additive", size=1.6, extent=2.2, anchor="bottom"),
    "fire_burst":     dict(cols=6, rows=6, frames=36, fps=30, loop=False, blending="additive", size=3.0, extent=3.2, anchor="center"),
    "smoke_puff":     dict(cols=6, rows=6, frames=36, fps=24, loop=False, blending="normal", size=2.5, extent=3.0, anchor="center"),
    "arcane_burst":   dict(cols=6, rows=6, frames=36, fps=30, loop=False, blending="additive", size=3.0, extent=3.2, anchor="center"),
    "frost_burst":    dict(cols=6, rows=6, frames=36, fps=30, loop=False, blending="additive", size=3.0, extent=3.2, anchor="center"),
    "heal_aura":      dict(cols=8, rows=6, frames=48, fps=24, loop=True, blending="additive", size=2.4, extent=2.6, anchor="bottom"),
    "slash_arc":      dict(cols=4, rows=4, frames=16, fps=30, loop=False, blending="additive", size=2.6, extent=2.8, anchor="center"),
    "impact_spark":   dict(cols=4, rows=4, frames=16, fps=30, loop=False, blending="additive", size=1.5, extent=2.0, anchor="center"),
    "dust_puff":      dict(cols=6, rows=6, frames=36, fps=24, loop=False, blending="normal", size=2.2, extent=2.6, anchor="bottom"),
    "lightning_bolt": dict(cols=4, rows=4, frames=16, fps=20, loop=True, blending="additive", size=6.0, extent=6.0, anchor="bottom"),
    "soul_wisp":      dict(cols=8, rows=6, frames=48, fps=24, loop=True, blending="additive", size=1.4, extent=1.8, anchor="bottom"),
    "rune_circle":    dict(cols=1, rows=1, frames=1, fps=1, loop=True, blending="additive", size=4.0, extent=4.0, anchor="ground", fs=1024),
    "poison_cloud":   dict(cols=8, rows=6, frames=48, fps=20, loop=True, blending="normal", size=3.0, extent=3.2, anchor="center"),
    "explosion":      dict(cols=8, rows=8, frames=64, fps=30, loop=False, blending="normal", size=4.0, extent=4.4, anchor="center"),
}
FS = 256  # frame size px


# =============================================================================== scene helpers
class Params:
    """Named Value nodes shared by the materials of an effect, set every frame."""

    def __init__(self):
        self.nodes = {}

    def get(self, nb, name, default=0.0):
        n = nb.node("ShaderNodeValue")
        n.outputs[0].default_value = default
        n.label = name
        self.nodes.setdefault(name, []).append(n)
        return n.outputs[0]

    def set(self, name, v):
        for n in self.nodes.get(name, []):
            n.outputs[0].default_value = float(v)


def _mat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    nb = NB(nt)
    out = nb.node("ShaderNodeOutputMaterial")
    return m, nb, out


def _scene(ext, anchor, spp=32, sun=True, ambient=0.35, fs=FS):
    sc = new_scene((fs, fs), spp, transparent=True)
    world_color(sc, (0.55, 0.6, 0.7), ambient)
    sc.cycles.volume_biased = True
    sc.cycles.volume_step_rate = 0.5
    sc.cycles.volume_max_steps = 512
    sc.cycles.volume_bounces = 1
    sc.cycles.max_bounces = 4
    sc.cycles.transparent_max_bounces = 16
    cd = bpy.data.cameras.new("Cam")
    cd.type = "ORTHO"
    cd.ortho_scale = ext
    cam = bpy.data.objects.new("Cam", cd)
    sc.collection.objects.link(cam)
    zc = ext / 2 if anchor == "bottom" else 0.0
    if anchor == "ground":
        cam.location = (0, 0, 10)
        cam.rotation_euler = (0, 0, 0)
    else:
        cam.location = (0, -10, zc)
        cam.rotation_euler = (math.radians(90), 0, 0)
    sc.camera = cam
    if sun:
        ld = bpy.data.lights.new("Key", "SUN")
        ld.energy = 3.2
        ld.color = (1.0, 0.95, 0.88)
        ld.angle = math.radians(5)
        lo = bpy.data.objects.new("Key", ld)
        sc.collection.objects.link(lo)
        lo.rotation_euler = (math.radians(50), math.radians(-35), math.radians(-25))
    return sc


def _domain(name, size, center, mat):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=center)
    ob = bpy.context.object
    ob.name = name
    ob.scale = size
    bpy.ops.object.transform_apply(scale=True)
    ob.data.materials.append(mat)
    return ob


def _noise4(nb, v, w, scale=1.0, det=5.0, rgh=0.55, dist=0.0):
    return nb.node("ShaderNodeTexNoise", {"noise_dimensions": "4D", "noise_type": "FBM"}, Vector=v, W=w, Scale=scale,
                   Detail=det, Roughness=rgh, Distortion=dist).outputs["Fac"]


def _blend_loop(nb, P, field):
    """field(t_socket) -> float socket. Returns the loop-blended field (t in [0,T)): (1-a) f(t) + a f(t - T)."""
    t0, t1, a = P.get(nb, "t"), P.get(nb, "t_prev"), P.get(nb, "a")
    f0, f1 = field(t0), field(t1)
    mixed = nb.mixf(f0, f1, a)
    # restore contrast lost by averaging two independent fields around 0.5
    k = P.get(nb, "contrast", 1.0)
    return nb.add(nb.mul(nb.sub(mixed, 0.5), k), 0.5)


def _set_loop(P, t, T):
    a = t / T
    P.set("t", t)
    P.set("t_prev", t - T)
    P.set("a", a)
    P.set("contrast", 1.0 / math.sqrt((1 - a) ** 2 + a ** 2))


def _fire_ramp(nb, heat, cols=None):
    cols = cols or [(0.0, "#000000"), (0.18, "#2a0400"), (0.38, "#9a1a00"), (0.58, "#ff5a0a"), (0.78, "#ffb040"),
                    (0.92, "#ffe6a0"), (1.0, "#fffaf0")]
    return nb.ramp(heat, cols)


def _emit_volume(nb, out, color, strength):
    em = nb.node("ShaderNodeEmission")
    nb.feed(em.inputs["Color"], color)
    nb.feed(em.inputs["Strength"], strength)
    nb.link(em.outputs[0], out.inputs["Volume"])


def _emit_surface(nb, out, color, strength, mix_transparent=None):
    em = nb.node("ShaderNodeEmission")
    nb.feed(em.inputs["Color"], color)
    nb.feed(em.inputs["Strength"], strength)
    if mix_transparent is None:
        nb.link(em.outputs[0], out.inputs["Surface"])
        return
    tr = nb.node("ShaderNodeBsdfTransparent")
    mx = nb.node("ShaderNodeMixShader")
    nb.link(mix_transparent, mx.inputs[0])
    nb.link(tr.outputs[0], mx.inputs[1])
    nb.link(em.outputs[0], mx.inputs[2])
    nb.link(mx.outputs[0], out.inputs["Surface"])


def _clear_generated():
    for o in list(bpy.context.scene.objects):
        if o.get("vfx_gen"):
            me = o.data
            bpy.data.objects.remove(o, do_unlink=True)
            if me and me.users == 0:
                bpy.data.meshes.remove(me)


def _tube(name, pts, radii, mat, sides=6):
    """Tube mesh along a polyline (list of 3D points) with per-point radius; tagged vfx_gen."""
    import bmesh
    from mathutils import Vector
    bm = bmesh.new()
    rings = []
    P = [Vector(p) for p in pts]
    for i, p in enumerate(P):
        d = (P[min(i + 1, len(P) - 1)] - P[max(i - 1, 0)]).normalized()
        up = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
        a = d.cross(up).normalized()
        b = d.cross(a).normalized()
        r = radii[i]
        rings.append([bm.verts.new(p + (a * math.cos(t) + b * math.sin(t)) * r)
                      for t in (j / sides * math.tau for j in range(sides))])
    for i in range(len(rings) - 1):
        for j in range(sides):
            bm.faces.new((rings[i][j], rings[i][(j + 1) % sides], rings[i + 1][(j + 1) % sides], rings[i + 1][j]))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    ob["vfx_gen"] = 1
    bpy.context.scene.collection.objects.link(ob)
    return ob


def _sphere(name, loc, r, mat, subdiv=2):
    import bmesh
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=r)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    ob.location = loc
    ob["vfx_gen"] = 1
    bpy.context.scene.collection.objects.link(ob)
    return ob


def _glow_mat(name, color, strength=1.0, soft=True):
    """Emissive surface with a soft limb (bright core, fading edges) — for motes, sparks, bolts."""
    m, nb, out = _mat(name)
    lw = nb.node("ShaderNodeLayerWeight", Blend=0.5)
    face = nb.sub(1.0, lw.outputs["Facing"])
    fac = nb.math("POWER", face, 1.5) if soft else 1.0
    s = nb.node("ShaderNodeAttribute", {"attribute_type": "OBJECT", "attribute_name": "glow"}).outputs["Fac"]
    c = nb.node("ShaderNodeAttribute", {"attribute_type": "OBJECT", "attribute_name": "tint"}).outputs["Color"]
    col = nb.mix(color, c, nb.node("ShaderNodeAttribute", {"attribute_type": "OBJECT", "attribute_name": "use_tint"}).outputs["Fac"])
    _emit_surface(nb, out, col, nb.mul(nb.mul(s, strength), fac), mix_transparent=nb.math("MINIMUM", nb.mul(fac, 3.0), 1.0))
    return m


# =============================================================================== effects
def fx_fire_loop(E, P):
    """Tall flame: teardrop envelope, upward-scrolling 4D noise, temperature ramp; loop-blended."""
    T = E["frames"] / E["fps"]
    m, nb, out = _mat("Fire")
    tc = nb.node("ShaderNodeTexCoord").outputs["Object"]
    s = nb.sep(tc)
    H = 1.7
    z = nb.maprange(s[2], 0.0, H, 0.0, 1.0)

    def field(t):
        q = nb.vmath("SUBTRACT", nb.vmath("MULTIPLY", tc, (2.6, 2.6, 1.3)), nb.xyz(0, 0, nb.mul(t, 2.2)))
        n1 = _noise4(nb, q, nb.mul(t, 0.35), 1.0, 6.0, 0.58, 0.3)
        return n1
    n = _blend_loop(nb, P, field)
    width = nb.mul(nb.mul(nb.math("POWER", nb.sub(1.0, nb.math("MINIMUM", z, 0.999)), 0.9), 0.42),
                   nb.maprange(z, 0.0, 0.12, 0.55, 1.0, "SMOOTHSTEP"))
    r = nb.math("LENGTH", nb.xyz(s[0], s[1], 0.0))
    r = nb.add(r, nb.mul(nb.sub(n, 0.5), nb.add(0.1, nb.mul(z, 0.55))))
    core = nb.sub(1.0, nb.math("DIVIDE", r, nb.math("MAXIMUM", width, 0.01)))
    heat = nb.math("MAXIMUM", nb.sub(nb.mul(core, 1.6), nb.mul(z, 0.55)), 0.0)
    heat = nb.math("MINIMUM", nb.add(heat, nb.mul(nb.sub(n, 0.5), 0.5)), 1.0)
    heat = nb.math("MAXIMUM", heat, 0.0)
    col = _fire_ramp(nb, heat)
    _emit_volume(nb, out, col, nb.mul(nb.math("POWER", heat, 1.3), 9.0))
    _domain("FireDom", (1.2, 1.2, H), (0, 0, H / 2), m)
    # glowing embers at the base (small bright floor)
    return lambda f: _set_loop(P, f / E["fps"], T)


def fx_soul_wisp(E, P):
    """Pale-gold ghost flame (death echo / rune glow): thin curling wisp + orbiting motes, loop."""
    T = E["frames"] / E["fps"]
    m, nb, out = _mat("Wisp")
    tc = nb.node("ShaderNodeTexCoord").outputs["Object"]
    s = nb.sep(tc)
    H = 1.35
    z = nb.maprange(s[2], 0.0, H, 0.0, 1.0)

    def field(t):
        q = nb.vmath("SUBTRACT", nb.vmath("MULTIPLY", tc, (3.2, 3.2, 1.6)), nb.xyz(0, 0, nb.mul(t, 1.3)))
        return _noise4(nb, q, nb.mul(t, 0.25), 1.0, 4.0, 0.5, 0.6)
    n = _blend_loop(nb, P, field)
    sway = nb.mul(nb.sub(n, 0.5), nb.mul(z, 0.7))
    width = nb.mul(nb.mul(nb.math("POWER", nb.sub(1.0, nb.math("MINIMUM", z, 0.999)), 1.2), 0.2),
                   nb.maprange(z, 0.0, 0.2, 0.35, 1.0, "SMOOTHSTEP"))
    r = nb.math("LENGTH", nb.xyz(nb.add(s[0], sway), s[1], 0.0))
    core = nb.sub(1.0, nb.math("DIVIDE", r, nb.math("MAXIMUM", width, 0.01)))
    heat = nb.math("MAXIMUM", nb.sub(core, nb.mul(z, 0.25)), 0.0)
    col = nb.ramp(heat, [(0.0, "#000000"), (0.2, "#4a3208"), (0.5, "#d6a23a"), (0.8, "#ffe7a8"), (1.0, "#ffffff")])
    _emit_volume(nb, out, col, nb.mul(nb.math("POWER", heat, 1.2), 7.0))
    _domain("WispDom", (0.9, 0.9, H), (0, 0, H / 2), m)
    mm = _glow_mat("Mote", "#ffd98a", 18.0)
    rng = np.random.default_rng(7)
    motes = [(rng.uniform(0, 1), rng.uniform(0.12, 0.38), rng.uniform(0, math.tau), rng.uniform(0.012, 0.022),
              int(rng.integers(1, 3))) for _ in range(9)]

    def upd(f):
        t = f / E["fps"]
        _set_loop(P, t, T)
        _clear_generated()
        for i, (ph, rad, a0, sz, spd) in enumerate(motes):
            u = (ph + spd * t / T) % 1.0                     # integer speed -> loops exactly
            ang = a0 + math.tau * spd * t / T
            loc = (rad * math.cos(ang) * (1 - 0.4 * u), rad * math.sin(ang), 0.1 + u * 1.25)
            ob = _sphere(f"mote{i}", loc, sz, mm)
            ob["glow"] = math.sin(math.pi * u) ** 1.5
    return upd


def fx_fire_burst(E, P):
    """Expanding fireball: shell of turbulent flame that cools to dark red and breaks up."""
    m, nb, out = _mat("Burst")
    tc = nb.node("ShaderNodeTexCoord").outputs["Object"]
    R, age, t = P.get(nb, "R", 0.2), P.get(nb, "age", 0.0), P.get(nb, "t", 0.0)
    d = nb.math("DIVIDE", nb.vmath("LENGTH", tc), R)
    n = _noise4(nb, nb.vmath("SCALE", tc, scale=nb.math("DIVIDE", 2.4, R)), nb.mul(t, 1.5), 1.0, 5.0, 0.6, 0.4)
    n2 = _noise4(nb, nb.vmath("SCALE", tc, scale=nb.math("DIVIDE", 6.0, R)), nb.add(nb.mul(t, 2.0), 3.0), 1.0, 3.0, 0.5)
    body = nb.sub(1.0, nb.add(d, nb.mul(nb.sub(n, 0.5), 0.9)))
    body = nb.sub(body, nb.mul(age, nb.mul(n2, 0.9)))                 # breaks up with age
    heat = nb.math("MAXIMUM", nb.mul(body, nb.sub(1.6, nb.mul(age, 1.25))), 0.0)
    heat = nb.math("MINIMUM", heat, 1.0)
    col = _fire_ramp(nb, heat)
    _emit_volume(nb, out, col, nb.mul(nb.math("POWER", heat, 1.4), nb.mul(14.0, nb.sub(1.0, nb.mul(age, 0.8)))))
    _domain("BurstDom", (3.0, 3.0, 3.0), (0, 0, 0), m)

    def upd(f):
        a = f / (E["frames"] - 1)
        P.set("R", 0.25 + 1.15 * (1 - math.exp(-a * 5.0)))
        P.set("age", a)
        P.set("t", f / E["fps"])
    return upd


def _blob_volume(name, P, color, dens_k, aniso=0.3, emit=None, seed=0.0, flat=1.0, rise=0.0, billow=1.0):
    """Scattering smoke volume: noisy sphere of radius R (Value 'R'), density fade 'fade', time 't'."""
    m, nb, out = _mat(name)
    tc = nb.node("ShaderNodeTexCoord").outputs["Object"]
    R, fade, t = P.get(nb, "R", 0.5), P.get(nb, "fade", 1.0), P.get(nb, "t", 0.0)
    p = nb.vmath("SUBTRACT", tc, nb.xyz(0, 0, nb.mul(t, rise)))
    p = nb.vmath("MULTIPLY", p, (1.0, 1.0, 1.0 / flat))
    d = nb.math("DIVIDE", nb.vmath("LENGTH", p), R)
    q = nb.vmath("ADD", nb.vmath("SCALE", p, scale=nb.math("DIVIDE", 1.8, R)), (seed, seed * 2.0, seed * 0.5))
    n = _noise4(nb, q, nb.add(nb.mul(t, 0.6), seed), 1.0, 6.0, 0.6, 0.35)
    v = nb.node("ShaderNodeTexVoronoi", {"feature": "F1", "voronoi_dimensions": "4D"}, Vector=nb.vmath("SCALE", q, scale=1.6),
                W=nb.add(nb.mul(t, 0.4), seed), Scale=1.0)
    bill = nb.sub(0.55, v.outputs["Distance"])
    shape = nb.sub(1.0, nb.add(d, nb.add(nb.mul(nb.sub(n, 0.5), 1.1), nb.mul(bill, -0.55 * billow))))
    dens = nb.mul(nb.math("MAXIMUM", nb.mul(shape, 3.0), 0.0), nb.mul(fade, dens_k))
    vol = nb.node("ShaderNodeVolumePrincipled", Anisotropy=aniso)
    nb.feed(sock(vol.inputs, "Color"), color)
    nb.link(dens, sock(vol.inputs, "Density"))
    if emit is not None:
        heat = emit(nb, shape, n)
        nb.link(heat[0], sock(vol.inputs, "Emission Color"))
        nb.link(heat[1], sock(vol.inputs, "Emission Strength"))
    nb.link(vol.outputs[0], out.inputs["Volume"])
    return m


def fx_smoke_puff(E, P):
    m = _blob_volume("Smoke", P, "#77726c", 9.0, 0.25, seed=1.3, rise=0.35)
    _domain("SmokeDom", (3.0, 3.0, 3.0), (0, 0, 0), m)

    def upd(f):
        a = f / (E["frames"] - 1)
        P.set("R", 0.35 + 0.95 * (1 - math.exp(-a * 3.2)))
        P.set("fade", (1 - a) ** 1.6 * min(1.0, a * 10 + 0.25))
        P.set("t", f / E["fps"])
    return upd


def fx_dust_puff(E, P):
    m = _blob_volume("Dust", P, "#8a7a62", 7.0, 0.2, seed=4.1, flat=0.55, rise=0.25)
    _domain("DustDom", (2.6, 2.6, 2.6), (0, 0, 0.3), m)

    def upd(f):
        a = f / (E["frames"] - 1)
        P.set("R", 0.3 + 0.95 * (1 - math.exp(-a * 3.5)))
        P.set("fade", (1 - a) ** 1.4 * min(1.0, a * 12 + 0.3))
        P.set("t", f / E["fps"])
    return upd


def fx_poison_cloud(E, P):
    """Sickly toxic cloud, lit volume with a faint inner glow; loop (blend of two time-offset fields)."""
    T = E["frames"] / E["fps"]
    m, nb, out = _mat("Poison")
    tc = nb.node("ShaderNodeTexCoord").outputs["Object"]
    d = nb.vmath("LENGTH", nb.vmath("MULTIPLY", tc, (1.0, 1.0, 1.6)))

    def field(t):
        q = nb.vmath("ADD", nb.vmath("SCALE", tc, scale=1.7), nb.xyz(nb.mul(t, 0.25), 0.0, nb.mul(t, 0.12)))
        return _noise4(nb, q, nb.mul(t, 0.3), 1.0, 6.0, 0.62, 0.5)
    n = _blend_loop(nb, P, field)
    shape = nb.sub(1.0, nb.add(nb.mul(d, 0.95), nb.mul(nb.sub(n, 0.5), 1.6)))
    dens = nb.mul(nb.math("MAXIMUM", nb.mul(shape, 2.2), 0.0), 5.0)
    vol = nb.node("ShaderNodeVolumePrincipled", Anisotropy=0.2)
    col = nb.ramp(n, [(0.3, "#4b5a18"), (0.55, "#7f9a2a"), (0.75, "#a8b845")])
    nb.link(col, sock(vol.inputs, "Color"))
    nb.link(dens, sock(vol.inputs, "Density"))
    glow = nb.math("MAXIMUM", nb.sub(shape, 0.35), 0.0)
    nb.feed(sock(vol.inputs, "Emission Color"), "#8fd13a")
    nb.link(nb.mul(glow, 1.4), sock(vol.inputs, "Emission Strength"))
    nb.link(vol.outputs[0], out.inputs["Volume"])
    _domain("PoisonDom", (3.2, 3.2, 3.2), (0, 0, 0), m)
    return lambda f: _set_loop(P, f / E["fps"], T)


def fx_explosion(E, P):
    """Fireball (emissive, absorbing) that rises and turns into dark smoke. Normal blending."""
    m, nb, out = _mat("Explosion")
    tc = nb.node("ShaderNodeTexCoord").outputs["Object"]
    R, fade, t, hot, rise = P.get(nb, "R", 0.3), P.get(nb, "fade", 1.0), P.get(nb, "t"), P.get(nb, "hot", 1.0), P.get(nb, "rise")
    p = nb.vmath("SUBTRACT", tc, nb.xyz(0, 0, rise))
    d = nb.math("DIVIDE", nb.vmath("LENGTH", nb.vmath("MULTIPLY", p, (1.0, 1.0, 0.85))), R)
    q = nb.vmath("SCALE", p, scale=nb.math("DIVIDE", 1.9, R))
    n = _noise4(nb, q, nb.mul(t, 0.8), 1.0, 6.0, 0.6, 0.4)
    v = nb.node("ShaderNodeTexVoronoi", {"feature": "F1", "voronoi_dimensions": "4D"}, Vector=nb.vmath("SCALE", q, scale=1.5),
                W=nb.mul(t, 0.5), Scale=1.0)
    bill = nb.sub(0.55, v.outputs["Distance"])
    shape = nb.sub(1.0, nb.add(d, nb.add(nb.mul(nb.sub(n, 0.5), 1.0), nb.mul(bill, -0.6))))
    dens = nb.mul(nb.math("MAXIMUM", nb.mul(shape, 3.0), 0.0), nb.mul(fade, 7.0))
    heat = nb.math("MINIMUM", nb.math("MAXIMUM", nb.mul(nb.sub(shape, nb.sub(0.9, nb.mul(hot, 0.9))), 2.2), 0.0), 1.0)
    heat = nb.mul(heat, hot)
    vol = nb.node("ShaderNodeVolumePrincipled", Anisotropy=0.2)
    nb.feed(sock(vol.inputs, "Color"), "#3d3935")
    nb.link(dens, sock(vol.inputs, "Density"))
    nb.link(_fire_ramp(nb, heat), sock(vol.inputs, "Emission Color"))
    nb.link(nb.mul(nb.math("POWER", heat, 1.3), 40.0), sock(vol.inputs, "Emission Strength"))
    nb.link(vol.outputs[0], out.inputs["Volume"])
    _domain("ExpDom", (4.4, 4.4, 4.4), (0, 0, 0), m)

    def upd(f):
        a = f / (E["frames"] - 1)
        P.set("R", 0.3 + 1.2 * (1 - math.exp(-a * 4.5)))
        P.set("hot", max(0.0, 1.0 - a * 1.9) ** 1.2)
        P.set("fade", (1 - a) ** 1.3 * min(1.0, a * 20 + 0.4))
        P.set("rise", 0.45 * a * a)
        P.set("t", f / E["fps"])
    return upd


def fx_arcane_burst(E, P):
    """Blue/violet magic burst: expanding double ring + inner flash + noisy energy shell + outward sparkles."""
    ring_m, nb, out = _mat("Ring")
    tc = nb.node("ShaderNodeTexCoord").outputs["Object"]
    R, w, gl, t = P.get(nb, "R", 0.2), P.get(nb, "w", 0.05), P.get(nb, "ring", 1.0), P.get(nb, "t")
    r = nb.math("LENGTH", nb.xyz(nb.sep(tc)[0], nb.sep(tc)[2], 0.0))
    band = nb.maprange(nb.math("ABSOLUTE", nb.sub(r, R)), 0.0, w, 1.0, 0.0, "SMOOTHSTEP")
    band2 = nb.maprange(nb.math("ABSOLUTE", nb.sub(r, nb.mul(R, 0.72))), 0.0, nb.mul(w, 0.4), 0.6, 0.0, "SMOOTHSTEP")
    ang = nb.math("ARCTAN2", nb.sep(tc)[2], nb.sep(tc)[0])
    streak = nb.node("ShaderNodeTexNoise", {"noise_dimensions": "2D"}, Vector=nb.xyz(nb.mul(ang, 3.0), nb.mul(t, 4.0), 0.0),
                     Scale=2.0, Detail=3.0).outputs["Fac"]
    inten = nb.mul(nb.add(band, band2), nb.maprange(streak, 0.3, 0.7, 0.35, 1.3))
    flash = nb.mul(nb.math("EXPONENT", nb.mul(nb.math("DIVIDE", r, 0.35), -3.0)), P.get(nb, "flash", 1.0))
    col = nb.mix("#6a4dff", "#b9a8ff", nb.math("MINIMUM", inten, 1.0))
    col = nb.mix(col, "#e6f0ff", nb.math("MINIMUM", flash, 1.0))
    a_ = nb.math("MINIMUM", nb.add(nb.mul(inten, gl), flash), 1.0)
    _emit_surface(nb, out, col, nb.mul(nb.add(nb.mul(inten, gl), nb.mul(flash, 1.5)), 6.0), mix_transparent=a_)
    bpy.ops.mesh.primitive_plane_add(size=3.2, location=(0, 0, 0), rotation=(math.radians(90), 0, 0))
    bpy.context.object.data.materials.append(ring_m)
    # energy shell (emission volume)
    sm, nb2, out2 = _mat("ArcShell")
    tc2 = nb2.node("ShaderNodeTexCoord").outputs["Object"]
    R2, t2, sh = P.get(nb2, "R"), P.get(nb2, "t"), P.get(nb2, "shell", 1.0)
    d = nb2.math("DIVIDE", nb2.vmath("LENGTH", tc2), nb2.math("MAXIMUM", R2, 0.05))
    n = _noise4(nb2, nb2.vmath("SCALE", tc2, scale=3.0), nb2.mul(t2, 2.0), 1.0, 4.0, 0.6, 0.8)
    shell = nb2.maprange(nb2.math("ABSOLUTE", nb2.sub(nb2.add(d, nb2.mul(nb2.sub(n, 0.5), 0.5)), 0.85)), 0.0, 0.25, 1.0, 0.0, "SMOOTHSTEP")
    wisps = nb2.mul(shell, nb2.maprange(n, 0.45, 0.7, 0.0, 1.0))
    _emit_volume(nb2, out2, nb2.mix("#3b2bd6", "#9f7bff", n), nb2.mul(wisps, nb2.mul(sh, 5.0)))
    _domain("ArcDom", (3.0, 3.0, 3.0), (0, 0, 0), sm)
    sp = _glow_mat("ArcSpark", "#c8baff", 25.0)
    rng = np.random.default_rng(11)
    sparks = [(rng.normal(0, 1, 3), rng.uniform(1.2, 2.6), rng.uniform(0.01, 0.022)) for _ in range(34)]

    def upd(f):
        a = f / (E["frames"] - 1)
        e = 1 - math.exp(-a * 5.0)
        P.set("R", 0.15 + 1.3 * e)
        P.set("w", 0.03 + 0.1 * a)
        P.set("ring", (1 - a) ** 1.4)
        P.set("flash", max(0.0, 1 - a * 5.0) ** 2)
        P.set("shell", (1 - a) ** 1.8)
        P.set("t", f / E["fps"])
        _clear_generated()
        for i, (dv, spd, sz) in enumerate(sparks):
            dv = dv / np.linalg.norm(dv)
            dist = spd * 0.55 * (1 - math.exp(-a * 4))
            p0 = dv * dist
            vel = dv * spd * math.exp(-a * 4) * 0.12 + 1e-3 * dv
            ob = _tube(f"s{i}", [tuple(p0 - vel), tuple(p0)], [sz * 0.3, sz], sp, 5)
            ob["glow"] = max(0.0, 1 - a * 1.1) * (0.6 + 0.4 * math.sin(i * 7 + f))
    return upd


def fx_frost_burst(E, P):
    """Ice shards bursting outward (crystal spikes with glowing rims) + cold mist + frost sparkles."""
    shard_m, nb, out = _mat("Shard")
    lw = nb.node("ShaderNodeLayerWeight", Blend=0.35)
    rim = nb.math("POWER", lw.outputs["Fresnel"], 1.4)
    g = nb.node("ShaderNodeAttribute", {"attribute_type": "OBJECT", "attribute_name": "glow"}).outputs["Fac"]
    col = nb.mix("#2a7fb8", "#e8fbff", rim)
    _emit_surface(nb, out, col, nb.mul(nb.add(nb.mul(rim, 3.5), 0.35), nb.mul(g, 2.0)),
                  mix_transparent=nb.math("MINIMUM", nb.add(nb.mul(rim, 1.2), 0.45), 1.0))
    mist_m, nb2, out2 = _mat("Mist")
    tc = nb2.node("ShaderNodeTexCoord").outputs["Object"]
    R, fade, t = P.get(nb2, "R"), P.get(nb2, "fade"), P.get(nb2, "t")
    d = nb2.math("DIVIDE", nb2.vmath("LENGTH", tc), nb2.math("MAXIMUM", R, 0.05))
    n = _noise4(nb2, nb2.vmath("SCALE", tc, scale=2.5), nb2.mul(t, 0.8), 1.0, 5.0, 0.6, 0.4)
    m_ = nb2.math("MAXIMUM", nb2.sub(1.0, nb2.add(d, nb2.mul(nb2.sub(n, 0.5), 1.2))), 0.0)
    _emit_volume(nb2, out2, nb2.mix("#1e5a8c", "#bfeaff", m_), nb2.mul(m_, nb2.mul(fade, 2.2)))
    _domain("MistDom", (3.0, 3.0, 3.0), (0, 0, 0), mist_m)
    rng = np.random.default_rng(21)
    shards = []
    for i in range(16):
        d = rng.normal(0, 1, 3)
        d[1] *= 0.4
        d /= np.linalg.norm(d)
        shards.append((d, rng.uniform(0.25, 0.55), rng.uniform(0.04, 0.08), rng.uniform(1.0, 2.0)))
    sp = _glow_mat("FrostSpark", "#dff6ff", 22.0)
    sparks = [(rng.normal(0, 1, 3), rng.uniform(0.6, 1.6)) for _ in range(28)]

    def upd(f):
        a = f / (E["frames"] - 1)
        P.set("R", 0.3 + 1.0 * (1 - math.exp(-a * 4)))
        P.set("fade", (1 - a) ** 1.5 * min(1.0, a * 8 + 0.3))
        P.set("t", f / E["fps"])
        _clear_generated()
        grow = min(1.0, a * 6)
        for i, (dv, L, w, spd) in enumerate(shards):
            dist = 0.1 + spd * 0.6 * (1 - math.exp(-a * 3.5))
            base = dv * dist
            tip = dv * (dist + L * grow)
            mid = dv * (dist + L * grow * 0.35)
            ob = _tube(f"sh{i}", [tuple(base), tuple(mid), tuple(tip)], [w * 0.4, w, 0.002], shard_m, 5)
            ob["glow"] = max(0.0, 1 - max(0.0, a - 0.45) * 2.2)
        for i, (dv, spd) in enumerate(sparks):
            dv = dv / np.linalg.norm(dv)
            ob = _sphere(f"fs{i}", tuple(dv * spd * (1 - math.exp(-a * 3))), 0.012, sp, 1)
            ob["glow"] = max(0.0, 1 - a) * (0.5 + 0.5 * math.sin(i * 3.1 + f * 1.7) ** 2)
    return upd


def fx_heal_aura(E, P):
    """Rising green-gold motes + soft light column + ground ring, loop (integer mote cycles per loop)."""
    T = E["frames"] / E["fps"]
    col_m, nb, out = _mat("Column")
    tc = nb.node("ShaderNodeTexCoord").outputs["Object"]
    s = nb.sep(tc)
    t = P.get(nb, "t")
    r = nb.math("ABSOLUTE", s[0])
    h = nb.maprange(s[2], 0.0, 2.0, 0.0, 1.0)
    ph = nb.mul(t, math.tau / T)
    rays = nb.node("ShaderNodeTexNoise", {"noise_dimensions": "4D"}, Vector=nb.xyz(nb.mul(s[0], 6.0), 0.0, nb.mul(s[2], 0.6)),
                   W=0.0, Scale=1.0, Detail=2.0)
    # loop: offset the ray pattern along a circle in (y, w)
    nb.feed(rays.inputs["Vector"], nb.xyz(nb.mul(s[0], 6.0), nb.mul(nb.math("SINE", ph), 0.6), nb.sub(nb.mul(s[2], 0.6), 0.0)))
    nb.feed(rays.inputs["W"], nb.mul(nb.math("COSINE", ph), 0.6))
    beam = nb.mul(nb.maprange(r, 0.0, 0.7, 1.0, 0.0, "SMOOTHSTEP"), nb.maprange(h, 0.0, 1.0, 1.0, 0.0, "SMOOTHSTEP"))
    beam = nb.mul(beam, nb.maprange(rays.outputs["Fac"], 0.35, 0.7, 0.2, 1.0))
    ring = nb.mul(nb.maprange(nb.math("ABSOLUTE", nb.sub(r, 0.85)), 0.0, 0.08, 1.0, 0.0, "SMOOTHSTEP"), nb.maprange(s[2], 0.0, 0.08, 1.0, 0.0))
    ground = nb.mul(nb.maprange(r, 0.0, 0.95, 0.6, 0.0), nb.maprange(s[2], 0.0, 0.06, 1.0, 0.0))
    inten = nb.add(nb.add(nb.mul(beam, 0.55), ring), ground)
    col = nb.mix("#57d67a", "#ffe690", nb.maprange(h, 0.0, 0.8))
    _emit_surface(nb, out, col, nb.mul(inten, 2.2), mix_transparent=nb.math("MINIMUM", inten, 1.0))
    bpy.ops.mesh.primitive_plane_add(size=2.6, location=(0, 0, 1.3), rotation=(math.radians(90), 0, 0))
    bpy.context.object.data.materials.append(col_m)
    mm = _glow_mat("HealMote", "#bfffb0", 22.0)
    rng = np.random.default_rng(5)
    motes = [(rng.uniform(0, 1), rng.uniform(0.1, 0.85), rng.uniform(0, math.tau), rng.uniform(0.014, 0.03),
              int(rng.integers(1, 3)), rng.uniform(0, 1)) for _ in range(26)]

    def upd(f):
        t = f / E["fps"]
        P.set("t", t)
        _clear_generated()
        for i, (ph0, rad, a0, sz, spd, hue) in enumerate(motes):
            u = (ph0 + spd * t / T) % 1.0
            x = rad * math.cos(a0 + 0.8 * math.sin(math.tau * u))
            ob = _sphere(f"hm{i}", (x, rad * math.sin(a0) - 0.5, 0.05 + u * 2.0), sz * (1 - 0.4 * u), mm, 1)
            ob["glow"] = math.sin(math.pi * u) ** 1.2
            ob["use_tint"] = 1.0
            ob["tint"] = (0.75 + 0.25 * hue, 1.0, 0.55 + 0.1 * hue)
    return upd


def fx_slash_arc(E, P):
    """Sword trail crescent sweeping across the frame: hot white leading edge, fading steel-blue/gold tail."""
    m, nb, out = _mat("Slash")
    tc = nb.node("ShaderNodeTexCoord").outputs["Object"]
    s = nb.sep(tc)
    head, fade, length = P.get(nb, "head", 0.0), P.get(nb, "fade", 1.0), P.get(nb, "len", 1.5)
    r = nb.math("LENGTH", nb.xyz(s[0], s[2], 0.0))
    ang = nb.math("ARCTAN2", s[2], s[0])        # radians, 0 = +X, CCW
    behind = nb.sub(head, ang)                    # >0 behind the head
    tail = nb.mul(nb.maprange(behind, 0.0, length, 1.0, 0.0, "SMOOTHSTEP"), nb.math("GREATER_THAN", behind, -0.02))
    edge_r = nb.add(1.05, nb.mul(behind, 0.03))
    radial = nb.maprange(nb.sub(edge_r, r), 0.0, nb.add(0.05, nb.mul(behind, 0.22)), 1.0, 0.0, "SMOOTHSTEP")
    radial = nb.mul(radial, nb.math("GREATER_THAN", edge_r, nb.sub(r, 0.01)))
    streak = nb.node("ShaderNodeTexNoise", {"noise_dimensions": "2D"}, Vector=nb.xyz(nb.mul(r, 22.0), nb.mul(ang, 1.5), 0.0),
                     Scale=1.0, Detail=3.0).outputs["Fac"]
    inten = nb.mul(nb.mul(tail, radial), nb.mul(nb.maprange(streak, 0.3, 0.7, 0.45, 1.2), fade))
    hot = nb.mul(nb.maprange(behind, 0.0, 0.35, 1.0, 0.0), nb.maprange(nb.sub(edge_r, r), 0.0, 0.05, 1.0, 0.0))
    col = nb.mix(nb.mix("#5f86c9", "#e8d6a6", nb.maprange(behind, 0.0, length, 1.0, 0.0)), "#ffffff", hot)
    _emit_surface(nb, out, col, nb.mul(nb.add(inten, nb.mul(hot, 2.0)), 5.0), mix_transparent=nb.math("MINIMUM", nb.mul(inten, 2.0), 1.0))
    bpy.ops.mesh.primitive_plane_add(size=2.8, location=(0, 0, 0), rotation=(math.radians(90), 0, 0))
    ob = bpy.context.object
    ob.rotation_euler = (math.radians(90), math.radians(-25), 0)   # diagonal slash
    ob.data.materials.append(m)

    def upd(f):
        a = f / (E["frames"] - 1)
        e = 1 - (1 - min(1.0, a / 0.55)) ** 3                       # fast ease-out sweep
        P.set("head", math.radians(-70 + 230 * e))
        P.set("len", 0.4 + 1.9 * e)
        P.set("fade", 1.0 if a < 0.45 else max(0.0, 1 - (a - 0.45) / 0.55) ** 1.5)
    return upd


def fx_impact_spark(E, P):
    """Metal hit: white flash + radial spark streaks (decelerating, falling, cooling white->orange->red)."""
    fm, nb, out = _mat("Flash")
    tc = nb.node("ShaderNodeTexCoord").outputs["Object"]
    r = nb.math("LENGTH", nb.xyz(nb.sep(tc)[0], nb.sep(tc)[2], 0.0))
    fl = P.get(nb, "flash", 1.0)
    ang = nb.math("ARCTAN2", nb.sep(tc)[2], nb.sep(tc)[0])
    star = nb.math("POWER", nb.math("ABSOLUTE", nb.math("COSINE", nb.mul(ang, 2.0))), 30.0)
    core = nb.add(nb.math("EXPONENT", nb.mul(r, -14.0)), nb.mul(star, nb.math("EXPONENT", nb.mul(r, -4.5))))
    inten = nb.mul(core, fl)
    _emit_surface(nb, out, nb.mix("#ffd79a", "#ffffff", nb.math("MINIMUM", inten, 1.0)), nb.mul(inten, 8.0),
                  mix_transparent=nb.math("MINIMUM", inten, 1.0))
    bpy.ops.mesh.primitive_plane_add(size=2.0, location=(0, 0.2, 0), rotation=(math.radians(90), 0, 0))
    bpy.context.object.data.materials.append(fm)
    sm = _glow_mat("Spark", "#ffffff", 30.0, soft=False)
    rng = np.random.default_rng(3)
    sparks = []
    for _ in range(30):
        a = rng.uniform(0, math.tau)
        el = rng.normal(0, 0.35)
        d = np.array([math.cos(a) * math.cos(el), math.sin(el) * 0.5, math.sin(a) * math.cos(el)])
        sparks.append((d, rng.uniform(2.0, 5.5), rng.uniform(0.004, 0.009), rng.uniform(0.5, 1.0)))

    def upd(f):
        t = f / E["fps"]
        a = f / (E["frames"] - 1)
        P.set("flash", math.exp(-f * 0.9))
        _clear_generated()
        for i, (d, spd, w, life) in enumerate(sparks):
            k = 6.0
            def posat(tt):
                return d * spd * (1 - math.exp(-k * tt)) / k + np.array([0, 0, -2.5 * tt * tt])
            p1, p0 = posat(t), posat(max(0.0, t - 0.035))
            if a > life:
                continue
            heat = max(0.0, 1 - a / life)
            ob = _tube(f"sp{i}", [tuple(p0), tuple(p1)], [w * 0.4, w], sm, 4)
            ob["glow"] = heat ** 0.7
            ob["use_tint"] = 1.0
            ob["tint"] = (1.0, 0.35 + 0.6 * heat, 0.08 + 0.8 * heat ** 2)
    return upd


def _bolt(rng, top, bottom, rough=0.22, depth=7):
    pts = [np.array(top, float), np.array(bottom, float)]
    for lvl in range(depth):
        new = [pts[0]]
        for a, b in zip(pts[:-1], pts[1:]):
            L = np.linalg.norm(b - a)
            mid = (a + b) / 2 + np.array([rng.normal(0, rough * L), rng.normal(0, rough * L * 0.3), rng.normal(0, rough * L * 0.3)])
            new += [mid, b]
        pts = new
    return pts


def fx_lightning_bolt(E, P):
    """Branching bolt from the sky to the ground; strike -> flicker -> restrike -> fade (16-frame loop)."""
    core = _glow_mat("BoltCore", "#ffffff", 40.0, soft=False)
    glow = _glow_mat("BoltGlow", "#8fb4ff", 5.0, soft=True)
    rng = np.random.default_rng(17)
    H = 5.8
    bolts = [_bolt(rng, (rng.uniform(-0.6, 0.6), 0, H), (rng.uniform(-0.3, 0.3), 0, 0.0)) for _ in range(3)]
    branches = []
    for b in bolts:
        br = []
        for _ in range(5):
            i = int(rng.integers(20, len(b) - 30))
            start = b[i]
            end = start + np.array([rng.uniform(-1.4, 1.4), 0, -rng.uniform(0.6, 1.8)])
            br.append(_bolt(rng, start, end, 0.25, 5))
        branches.append(br)
    # intensity per frame (strike pattern) and which bolt shape
    pattern = [(0, 1.0), (0, 0.8), (0, 0.45), (0, 0.2), (1, 0.9), (1, 0.55), (1, 0.25), (1, 0.1), (2, 0.0), (2, 1.0),
               (2, 0.7), (2, 0.35), (2, 0.15), (0, 0.05), (0, 0.0), (0, 0.0)]

    def upd(f):
        bi, k = pattern[f % len(pattern)]
        _clear_generated()
        if k <= 0:
            return
        b = bolts[bi]
        ob = _tube("core", [tuple(p) for p in b], [0.012] * len(b), core, 5)
        ob["glow"] = k
        ob = _tube("glow", [tuple(p) for p in b], [0.07] * len(b), glow, 8)
        ob["glow"] = k
        for j, br in enumerate(branches[bi]):
            n = len(br)
            ob = _tube(f"br{j}", [tuple(p) for p in br], [0.008 * (1 - i / n) + 0.002 for i in range(n)], core, 4)
            ob["glow"] = k * 0.6
    return upd


def fx_rune_circle(E, P):
    """Ground magic circle (single frame, top-down): double rings, rune band with procedural glyphs, hexagram,
    radial ticks, node circles. Neutral warm-white: tint it in the client (telegraphs, spells)."""
    m, nb, out = _mat("Rune")
    tc = nb.node("ShaderNodeTexCoord").outputs["Object"]
    s = nb.sep(tc)
    r = nb.math("LENGTH", nb.xyz(s[0], s[1], 0.0))
    ang = nb.add(nb.math("ARCTAN2", s[1], s[0]), math.pi)          # 0..2pi
    R = 1.85

    def line(d, w):
        return nb.maprange(nb.math("ABSOLUTE", d), 0.0, w, 1.0, 0.0, "SMOOTHSTEP")

    acc = line(nb.sub(r, R), 0.018)
    acc = nb.math("MAXIMUM", acc, line(nb.sub(r, R * 0.93), 0.008))
    acc = nb.math("MAXIMUM", acc, line(nb.sub(r, R * 0.74), 0.012))
    acc = nb.math("MAXIMUM", acc, line(nb.sub(r, R * 0.70), 0.006))
    acc = nb.math("MAXIMUM", acc, line(nb.sub(r, R * 0.22), 0.01))
    # ticks between the two outer rings
    tick = nb.math("ABSOLUTE", nb.sub(nb.math("FRACT", nb.mul(ang, 72 / math.tau)), 0.5))
    tickm = nb.mul(nb.maprange(tick, 0.42, 0.5, 0.0, 1.0), nb.mul(nb.math("GREATER_THAN", r, R * 0.935), nb.math("LESS_THAN", r, R * 0.99)))
    acc = nb.math("MAXIMUM", acc, nb.mul(tickm, 0.8))
    # rune band between R*0.74 and R*0.93: 28 glyph cells, strokes chosen by a per-cell hash
    N = 28
    cu = nb.mul(ang, N / math.tau)
    cell = nb.math("FLOOR", cu)
    u = nb.math("FRACT", cu)
    v = nb.maprange(r, R * 0.755, R * 0.915, 0.0, 1.0, "LINEAR", True)
    inband = nb.mul(nb.math("GREATER_THAN", r, R * 0.75), nb.math("LESS_THAN", r, R * 0.92))
    wn = nb.node("ShaderNodeTexWhiteNoise", {"noise_dimensions": "1D"}, W=cell)
    hc = nb.out(wn, "Color", "RGBA")
    hv = nb.out(wn, "Value", "VALUE")
    hs = nb.sep(hc)
    gx, gy = nb.maprange(u, 0.2, 0.8, 0.0, 1.0), v
    w = 0.06
    strokes = [
        (line(nb.sub(gx, 0.5), w), hs[0], 0.25),                                   # vertical stem
        (nb.mul(line(nb.sub(gy, 0.8), w), nb.math("LESS_THAN", nb.math("ABSOLUTE", nb.sub(gx, 0.5)), 0.5)), hs[1], 0.35),
        (nb.mul(line(nb.sub(gy, 0.2), w), nb.math("LESS_THAN", nb.math("ABSOLUTE", nb.sub(gx, 0.5)), 0.5)), hs[2], 0.45),
        (line(nb.sub(gy, gx), w * 1.2), hv, 0.4),                                  # diagonals
        (line(nb.sub(gy, nb.sub(1.0, gx)), w * 1.2), nb.math("FRACT", nb.mul(hv, 7.13)), 0.55),
        (line(nb.sub(nb.math("LENGTH", nb.xyz(nb.sub(gx, 0.5), nb.sub(gy, 0.55), 0.0)), 0.22), w), nb.math("FRACT", nb.mul(hv, 3.7)), 0.6),
        (nb.mul(line(nb.sub(gy, 0.5), w), nb.math("LESS_THAN", gx, 0.5)), nb.math("FRACT", nb.mul(hv, 11.3)), 0.5),
    ]
    glyph = None
    for st, hh, thr in strokes:
        g = nb.mul(st, nb.math("GREATER_THAN", hh, thr))
        glyph = g if glyph is None else nb.math("MAXIMUM", glyph, g)
    frame_ = nb.mul(nb.math("GREATER_THAN", u, 0.2), nb.math("LESS_THAN", u, 0.8))
    glyph = nb.mul(nb.mul(glyph, frame_), inband)
    acc = nb.math("MAXIMUM", acc, glyph)
    # hexagram (two triangles) inside the inner ring: polygon edge distance in polar form
    for rot in (0.0, math.pi / 3):
        a_ = nb.math("FLOORED_MODULO", nb.add(ang, rot), math.tau / 3)
        dd = nb.sub(nb.mul(r, nb.math("COSINE", nb.sub(a_, math.pi / 3))), R * 0.70 * math.cos(math.pi / 3))
        acc = nb.math("MAXIMUM", acc, nb.mul(line(dd, 0.01), nb.math("LESS_THAN", r, R * 0.705)))
    # inner hexagon + node circles at the 6 star points
    a6 = nb.math("FLOORED_MODULO", ang, math.tau / 6)
    hexd = nb.sub(nb.mul(r, nb.math("COSINE", nb.sub(a6, math.pi / 6))), R * 0.35 * math.cos(math.pi / 6))
    acc = nb.math("MAXIMUM", acc, nb.mul(line(hexd, 0.007), 0.8))
    for k in range(6):
        th = k * math.pi / 3 - math.pi
        cx, cy = R * 0.70 * math.cos(th), R * 0.70 * math.sin(th)
        dc = nb.math("LENGTH", nb.xyz(nb.sub(s[0], cx), nb.sub(s[1], cy), 0.0))
        acc = nb.math("MAXIMUM", acc, line(nb.sub(dc, 0.09), 0.008))
        acc = nb.math("MAXIMUM", acc, nb.mul(nb.maprange(dc, 0.0, 0.035, 1.0, 0.0, "SMOOTHSTEP"), 0.9))
    # radial spokes in the centre
    sp = nb.math("ABSOLUTE", nb.sub(nb.math("FRACT", nb.mul(ang, 12 / math.tau)), 0.5))
    acc = nb.math("MAXIMUM", acc, nb.mul(nb.maprange(sp, 0.47, 0.5, 0.0, 0.7), nb.mul(nb.math("LESS_THAN", r, R * 0.2), nb.math("GREATER_THAN", r, 0.06))))
    # soft inner glow and a slightly worn/broken look
    wear = nb.node("ShaderNodeTexNoise", Vector=nb.vmath("SCALE", tc, 3.0), Scale=1.0, Detail=4.0).outputs["Fac"]
    acc = nb.mul(acc, nb.maprange(wear, 0.3, 0.5, 0.55, 1.0))
    haze = nb.mul(nb.maprange(r, 0.0, R, 0.18, 0.04), nb.math("LESS_THAN", r, R))
    inten = nb.add(acc, haze)
    col = nb.mix("#ffd9a0", "#fffaf0", nb.math("MINIMUM", acc, 1.0))
    _emit_surface(nb, out, col, nb.mul(inten, 3.0), mix_transparent=nb.math("MINIMUM", inten, 1.0))
    bpy.ops.mesh.primitive_plane_add(size=4.0, location=(0, 0, 0))
    bpy.context.object.data.materials.append(m)
    return lambda f: None


BUILDERS = {
    "fire_loop": fx_fire_loop, "fire_burst": fx_fire_burst, "smoke_puff": fx_smoke_puff,
    "arcane_burst": fx_arcane_burst, "frost_burst": fx_frost_burst, "heal_aura": fx_heal_aura,
    "slash_arc": fx_slash_arc, "impact_spark": fx_impact_spark, "dust_puff": fx_dust_puff,
    "lightning_bolt": fx_lightning_bolt, "soul_wisp": fx_soul_wisp, "rune_circle": fx_rune_circle,
    "poison_cloud": fx_poison_cloud, "explosion": fx_explosion,
}
SPP = {"additive": 24, "normal": 32}


# =============================================================================== post
def _blur(img, r):
    """Separable box blur x3 (~gaussian), edge-clamped, per channel."""
    out = img.astype(np.float32)
    for _ in range(3):
        for ax in (0, 1):
            pad = [(0, 0)] * out.ndim
            pad[ax] = (r + 1, r)
            c = np.cumsum(np.pad(out, pad, mode="edge"), axis=ax)
            hi = np.take(c, range(2 * r + 1, c.shape[ax]), axis=ax)
            lo = np.take(c, range(0, c.shape[ax] - 2 * r - 1), axis=ax)
            out = (hi - lo) / (2 * r + 1)
    return out


def _softclip(x, k=1.0):
    return 1.0 - np.exp(-np.clip(x, 0, None) * k)


def post_additive(fr, glow=0.35):
    rgb = fr[..., :3]
    if glow > 0:
        rgb = rgb + glow * _blur(rgb, max(2, fr.shape[0] // 40)) + glow * 0.5 * _blur(rgb, max(4, fr.shape[0] // 14))
    c = lin_to_srgb(_softclip(rgb, 1.1))
    a = np.clip(c.max(axis=2) * 1.15, 0, 1)
    return np.dstack([c, a])


def post_normal(fr):
    a = np.clip(fr[..., 3], 0, 1)
    rgb = fr[..., :3] / np.maximum(a[..., None], 1e-4)
    c = lin_to_srgb(_softclip(rgb, 1.0))
    out = np.dstack([c, a])
    mask = a > 0.01
    for _ in range(8):  # bleed colour outwards so bilinear/mip sampling has no dark halo
        acc = np.zeros_like(out[..., :3])
        cnt = np.zeros(mask.shape, np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            sm = np.roll(mask, (dy, dx), (0, 1))
            acc += np.roll(out[..., :3], (dy, dx), (0, 1)) * sm[..., None]
            cnt += sm
        grow = (~mask) & (cnt > 0)
        out[grow, :3] = acc[grow] / cnt[grow][:, None]
        mask |= grow
    return out


def edge_energy(fr):
    """Fraction of the frame's alpha energy on the outer 2-px border (clipping detector)."""
    a = fr[..., 3]
    tot = a.sum() + 1e-6
    b = a.copy()
    b[2:-2, 2:-2] = 0
    return float(b.sum() / tot)


# =============================================================================== build
def build_effect(name, previews=True, fs=None):
    E = dict(EFFECTS[name])
    fs = fs or E.get("fs", FS)
    P = Params()
    sc = _scene(E["extent"], E["anchor"], SPP[E["blending"]], sun=E["blending"] == "normal", fs=fs)
    upd = BUILDERS[name](E, P)
    frames = []
    for f in range(E["frames"]):
        upd(f)
        fr = render(sc, f"vfx_{name}_{f:02d}", samples=SPP[E["blending"]], gpu_wait=20)
        frames.append(fr)
        if f == 0 or (f + 1) % 16 == 0:
            log(f"vfx {name}: frame {f + 1}/{E['frames']} on {render.last[0]} {render.last[1]:.1f}s")
    post = [post_additive(fr, 0.0 if name == "rune_circle" else 0.35) if E["blending"] == "additive" else post_normal(fr)
            for fr in frames]
    cols, rows = E["cols"], E["rows"]
    atlas = np.zeros((rows * fs, cols * fs, 4), np.float32)
    for i, fr in enumerate(post):
        r, c = divmod(i, cols)
        y0 = (rows - 1 - r) * fs
        atlas[y0:y0 + fs, c * fs:(c + 1) * fs] = fr
    path = os.path.join(VFX_DIR, f"{name}.webp")
    sz = save_webp(atlas, path, 86)
    edge = max(edge_energy(fr) for fr in post)
    lum = [float(fr[..., 3].mean()) for fr in post]
    log(f"vfx {name}: {cols}x{rows} {fs}px -> {sz // 1024} KB, max edge energy {edge:.3f}")
    if previews:
        _effect_sheet(name, post, E)
    return {"file": f"vfx/{name}.webp", "cols": cols, "rows": rows, "frames": E["frames"], "fps": E["fps"],
            "loop": E["loop"], "blending": E["blending"], "size": E["size"], "frameSize": fs,
            "anchor": E["anchor"], "bytes": sz, "_qa": {"edge_energy": round(edge, 4),
                                                           "alpha_mean_first_last": [round(lum[0], 4), round(lum[-1], 4)]}}


def _over(fr, blending, bg="dark"):
    h, w = fr.shape[:2]
    if blending == "additive":
        base = np.ones((h, w, 3), np.float32) * np.array([0.06, 0.06, 0.07])
        return np.clip(base + fr[..., :3] * 1.0, 0, 1)
    base = checker_bg(h, w, 16, 0.32, 0.42)
    a = fr[..., 3:4]
    return fr[..., :3] * a + base * (1 - a)


def _effect_sheet(name, post, E):
    tiles = [label(np.dstack([_over(fr, E["blending"]), np.ones(fr.shape[:2], np.float32)]), f"{i}", 4, 4, 2)
             for i, fr in enumerate(post)]
    if tiles[0].shape[0] > 256:
        tiles = [resize(t, 256, 256) for t in tiles]
    save_png(sheet(tiles, E["cols"], f"VFX {name.upper()} - {E['frames']} FRAMES {E['fps']} FPS {E['blending'].upper()}"
                   f"{' LOOP' if E['loop'] else ''}"), os.path.join(PREVIEWS, f"lookdev_vfx_{name}.png"))


def contact_sheet(names):
    """One row per effect: 8 evenly spaced frames (from the saved atlases)."""
    from ld_common import load_image
    rows_img = []
    for n in names:
        p = os.path.join(VFX_DIR, f"{n}.webp")
        if not os.path.exists(p):
            continue
        E = EFFECTS[n]
        at = load_image(p)
        fs = at.shape[1] // E["cols"]
        idx = sorted(set(int(round(i * (E["frames"] - 1) / 7)) for i in range(8)))
        tiles = []
        for i in idx:
            r, c = divmod(i, E["cols"])
            y0 = at.shape[0] - (r + 1) * fs
            fr = at[y0:y0 + fs, c * fs:(c + 1) * fs]
            fr = resize(fr, 160, 160) if fs != 160 else fr
            tiles.append(np.dstack([_over(fr, E["blending"]), np.ones((160, 160), np.float32)]))
        while len(tiles) < 8:
            tiles.append(np.dstack([np.ones((160, 160, 3), np.float32) * 0.1, np.ones((160, 160), np.float32)]))
        row = np.concatenate(tiles, axis=1)
        label(row, n.upper(), 4, 4, 2)
        rows_img.append(row)
    if rows_img:
        H = sum(r.shape[0] for r in rows_img) + 4 * len(rows_img)
        W = rows_img[0].shape[1]
        out = np.ones((H, W, 4), np.float32) * 0.1
        y = H
        for r in rows_img:
            y -= r.shape[0]
            out[y:y + r.shape[0]] = r
            y -= 4
        save_png(sheet([out], 1, "LOOKDEV VFX CONTACT SHEET (8 FRAMES PER EFFECT)"), os.path.join(PREVIEWS, "lookdev_vfx.png"))


def write_manifest(entries):
    path = os.path.join(VFX_DIR, "manifest.json")
    data = {}
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            data = {}
    for k, v in entries.items():
        data[k] = {kk: vv for kk, vv in v.items() if not kk.startswith("_")}
    data = {k: data[k] for k in sorted(data) if not k.startswith("_")}
    data = {"_doc": "Flipbook atlases (WebP RGBA). Frames row-major, frame 0 at the TOP-LEFT, square frames of "
                    "frameSize px. blending additive: RGB is light (use AdditiveBlending, ignore alpha); normal: "
                    "straight alpha (NormalBlending, colours bled). size = suggested world size of the quad (m); "
                    "anchor: bottom = quad bottom edge on the ground, center = centred on the emitter, ground = "
                    "horizontal decal (rune_circle: tint it per spell/telegraph).", **data}
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    return path
