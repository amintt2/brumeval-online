"""Slime ("Gluant"): ~0.8 m glossy, sagging dome of swamp ooze. Faces -Y.
Continuous gel body (sphere deformed into a sagging, lobed dome + GN noise), two glowing eyes floating just under
the surface, old bone shards and a rusty blade stuck in the gel. Gel shader (depth colour, inner bubbles,
suspended debris, faint emissive glow = subsurface look) baked to baseColor / normal / ORM / emissive.

Rig: root, base, body, top, lobe (front pseudopod) — squash & stretch through bone scale + location.
Clips: Idle, Walk, Attack (pseudopod lash), Attack2 (big jump slam), Run, Hit, Death (melts into a puddle).
"""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Vector

import body as B
import cmat
import rigkit as R
from kit import gn, materials as M
from kit import rig as KR
from rigkit import Track, ease_in, ease_out, smooth

HERO = ("Idle", 12)
BUDGET = "beast"
H = 0.8      # height
RAD = 0.47   # base radius


def dome():
    bpy.ops.mesh.primitive_uv_sphere_add(radius=1.0, segments=72, ring_count=44)
    ob = bpy.context.object
    ob.name = "Body"
    co = B.co_array(ob)
    x, y, z = co[:, 0], co[:, 1], co[:, 2]
    ang = np.arctan2(y, x)
    phi = np.arcsin(np.clip(z, -1, 1))                  # -pi/2 bottom .. pi/2 top
    s01 = (np.sin(phi) + 1) / 2
    zz = H * s01 ** 1.25
    rr = RAD * np.clip(np.cos(phi), 0, 1) ** 0.72
    rr *= 1 + 0.16 * np.exp(-((phi + 0.75) / 0.45) ** 2)        # sagging belly
    rr *= 1 - 0.1 * np.exp(-((phi - 0.9) / 0.4) ** 2)           # narrower crown
    rr *= 1 + (0.08 * np.sin(5 * ang + 0.7) + 0.05 * np.sin(3 * ang + 2.1)) * (1 - s01) ** 1.5   # drip lobes
    lean = 0.05 * s01 ** 3
    nx, ny = np.cos(ang), np.sin(ang)
    new = np.stack([rr * nx, rr * ny * 0.93 + lean, zz], 1)
    new[:, 2] = np.maximum(new[:, 2], 0.0)
    B.set_co(ob, new)
    # clean the poles, keep one continuous closed surface
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()
    for p in ob.data.polygons:
        p.use_smooth = True
    gn.displace(ob, strength=0.045, scale=2.2, detail=2.0, voronoi=0.0, seed=11)
    gn.displace(ob, strength=0.006, scale=12.0, detail=2.0, voronoi=0.0, seed=4, name="KitDisplace2")
    gn.apply(ob)
    co = B.co_array(ob)
    co[:, 2] = np.maximum(co[:, 2], 0.0)
    B.set_co(ob, co)
    return ob


def sword_stub(mat):
    """Broken sword stuck in the crown: flat blade (bevelled box, snapped tip), crossguard, wrapped grip, pommel."""
    import bmesh
    parts = []
    axis = Vector((0.18, 0.42, 1.0)).normalized()
    base = Vector((0.05, 0.2, 0.6))             # buried end inside the gel
    side = axis.cross(Vector((1, 0, 0))).normalized()
    thick = axis.cross(side).normalized()
    L, W, T = 0.34, 0.055, 0.012
    bm = bmesh.new()
    prof = [(-1, 0), (0, 1), (1, 0), (0, -1)]       # diamond cross-section (fuller-less blade)
    rings = []
    for k, t in enumerate((0.0, 0.8, 0.93, 1.0)):
        w = W * (1.0 if t < 0.85 else 0.8)
        ring = []
        for j, (a, b) in enumerate(prof):
            # snapped tip: the last ring is skewed (jagged break)
            off = 0.018 * (1 if j in (0, 1) else -0.6) if t == 1.0 else 0.0
            p = base + axis * (L * t + off) + side * (a * w * 0.5) + thick * (b * T * 0.5)
            ring.append(bm.verts.new(p))
        rings.append(ring)
    for k in range(len(rings) - 1):
        for j in range(4):
            bm.faces.new((rings[k][j], rings[k][(j + 1) % 4], rings[k + 1][(j + 1) % 4], rings[k + 1][j]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new("Blade")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("Blade", me)
    bpy.context.scene.collection.objects.link(ob)
    B.set_mat(ob, mat)
    parts.append(ob)
    top = base + axis * L
    g0 = top - side * 0.075 - axis * 0.01
    g1 = top + side * 0.075 - axis * 0.01
    guard = B.horn("Guard", [tuple(g0), tuple((g0 + g1) / 2 + axis * 0.012), tuple(g1)], 0.014, mat,
                   taper=((0, 0.8), (0.5, 1.0), (1, 0.8)), res=6)
    grip = B.horn("Grip", [tuple(top), tuple(top + axis * 0.06), tuple(top + axis * 0.11)], 0.015, mat,
                  taper=((0, 1.0), (1, 0.9)), res=8)
    pommel = B.sphere("Pommel", tuple(top + axis * 0.125), 0.024, mat, seg=10, rings=6)
    for o in (guard, grip, pommel):
        B.set_mat(o, mat)
        for p in o.data.polygons:
            p.use_smooth = True
    for p in ob.data.polygons:
        p.use_smooth = False
    return parts + [guard, grip, pommel]


def bones():
    return [
        ("root", (0, 0, 0), (0, -0.25, 0), None),
        ("base", (0, 0, 0.0), (0, 0, 0.22), "root"),
        ("body", (0, 0, 0.22), (0, 0.01, 0.46), "base"),
        ("top", (0, 0.01, 0.46), (0, 0.04, 0.78), "body"),
        ("lobe", (0, -0.2, 0.3), (0, -0.44, 0.3), "body"),
    ]


def build():
    arm = R.build_armature(bones())
    arm.data.bones["root"].use_deform = False
    body = dome()
    gel = cmat.gel("Gel_slime", color="#4d7424", deep="#0e1f08", rim="#a6cf52", seed=3, glow=0.35)
    B.set_mat(body, gel)
    # weights: vertical chain + front lobe, distance based then smoothed over the mesh
    B.blend_bones(body, arm, ["base", "body", "top", "lobe"], sharp=2.5)
    names = KR.deform_bones(arm)
    W = KR.weights_array(body, names)
    co = B.co_array(body)
    front = np.clip((-co[:, 1] - 0.18) / 0.25, 0, 1) * np.exp(-((co[:, 2] - 0.28) / 0.16) ** 2)
    li = names.index("lobe")
    W[:, li] = front
    KR.set_weights(body, names, W)
    KR.smooth_weights(body, names, 6, 0.5)
    mats = {"eye": cmat.eye("Eye_slime", iris="#e8c63a", pupil="#0a0703", glow=3.0, glow_color="#ffd84a",
                            iris_size=0.35, pupil_size=0.86, sclera="#1d2a0c"),
            "bone": M.bone("Bone_slime", color="#b9a882", dirt=0.9, seed=6),
            "iron": M.metal("Iron_slime", kind="iron", rust=0.85, grime=0.6, seed=2)}
    parts = []
    from mathutils.bvhtree import BVHTree
    bvh = BVHTree.FromObject(body, bpy.context.evaluated_depsgraph_get())
    for sx in (1, -1):
        # eyes bulge out of the front of the dome (60 % outside the gel) so they read from any camera
        d = Vector((0.36 * sx, -1.0, 0.05)).normalized()
        hit = bvh.ray_cast(Vector((0.0, 0.0, 0.5)) + d * 1.5, -d)[0]
        r = 0.058
        c = hit - d * (r * 0.25)
        e = B.eye(f"Eye{sx}", tuple(c), r, mats["eye"], look=tuple(d), seg=24, rings=14, scale=(1.0, 0.85, 1.0))
        B.rigid(e, "top")
        parts.append(e)
    # bone shards and a broken, rusted sword stuck in the gel (partly embedded)
    rib = B.horn("Rib", [(0.3, 0.1, 0.4), (0.5, 0.06, 0.48), (0.58, -0.08, 0.4)], 0.026, mats["bone"],
                 taper=((0, 1.0), (1, 0.45)), res=6, flatten=((0, 0, 1), 0.6))
    rib2 = B.horn("Rib2", [(0.28, 0.2, 0.33), (0.49, 0.18, 0.39), (0.58, 0.05, 0.31)], 0.024, mats["bone"],
                  taper=((0, 1.0), (1, 0.45)), res=6, flatten=((0, 0, 1), 0.6))
    femur = B.horn("Femur", [(-0.2, 0.16, 0.48), (-0.38, 0.26, 0.62), (-0.46, 0.31, 0.71)], 0.036, mats["bone"],
                   taper=((0, 0.9), (0.2, 0.6), (0.8, 0.6), (1, 1.0)), res=8)
    knob = B.sphere("Knob", (-0.46, 0.31, 0.72), 0.045, mats["bone"], seg=12, rings=8, scale=(1.2, 1.0, 0.8))
    blade = sword_stub(mats["iron"])
    B.blend_bones(rib, arm, ["body", "top"], 4)
    B.blend_bones(rib2, arm, ["body", "top"], 4)
    B.blend_bones(femur, arm, ["body", "top"], 4)
    B.rigid(knob, "top")
    for b in blade:
        B.rigid(b, "top")
    parts += [rib, rib2, femur, knob] + blade
    B.join_into(body, parts)
    B.limit_weights(body, arm)
    body.parent = arm
    md = body.modifiers.new("Armature", "ARMATURE")
    md.object = arm
    body.name = "Body"
    animate(arm)
    return {"arm": arm, "meshes": [body], "body": body, "expected": (0.95, None, 0.8), "tex": 1024,
            "head_center": (0, -0.2, 0.45), "head_extent": 0.35}


# =============================================================================== animation
def animate(arm):
    A = R.Animator(arm)

    def sq(k):
        """volume-preserving squash factor k (>1 = flatter)"""
        return (math.sqrt(k), math.sqrt(k), 1.0 / k)

    # Idle 2 s: slow breathing wobble, top sways, surface ripple
    def idle(t):
        b = R.wave(t, 2)
        return {
            "base": {"s": sq(1 + 0.04 * b)},
            "body": {"r": (2 * R.wave(t, 1, 0.1), 0, 3 * R.wave(t, 1)), "s": sq(1 - 0.03 * R.wave(t, 2, 0.15))},
            "top": {"r": (3 * R.wave(t, 1, 0.25), 2 * R.wave(t, 2), 0), "s": sq(1 + 0.04 * R.wave(t, 2, 0.3))},
            "lobe": {"r": (0, 0, 6 * R.wave(t, 1, 0.4)), "s": (1, 1 + 0.08 * R.wave(t, 2, 0.2), 1)},
        }
    A.clip("Idle", 48, idle)

    # Walk 0.83 s: inchworm ooze (squash -> stretch forward -> settle), in place
    def walk(t):
        c = R.wave(t, 1)
        c2 = R.wavec(t, 1)
        return {
            "base": {"s": sq(1 + 0.1 * c), "t": (0, 0, 0)},
            "body": {"r": (-6 * c2, 0, 2 * R.wave(t, 1, 0.3)), "t": (0, -0.015 * c2, 0), "s": sq(1 - 0.05 * R.wave(t, 1, 0.12))},
            "top": {"r": (-8 * R.wavec(t, 1, 0.1), 0, 0), "s": sq(1 + 0.05 * R.wave(t, 1, 0.25))},
            "lobe": {"r": (0, 0, 0), "s": (1, 1 + 0.2 * c, 1)},
        }
    A.clip("Walk", 20, walk)

    # Run 0.5 s: bouncing hops (short air time), squash on landing
    air = Track([(0, 0), (0.2, 0.0), (0.5, 0.12, ease_out), (0.8, 0.0, ease_in), (1, 0)])
    sqr = Track([(0, 1.25), (0.15, 1.0), (0.3, 0.8), (0.5, 0.92), (0.75, 0.85), (0.85, 1.3), (1, 1.25)])

    def run(t):
        return {
            "base": {"s": sq(sqr(t)), "t": (0, 0, air(t))},
            "body": {"r": (-10 + 8 * R.wave(t, 1, 0.1), 0, 0)},
            "top": {"r": (-10 * R.wavec(t, 1, 0.05), 0, 0), "s": sq(1 + 0.06 * R.wave(t, 1, 0.3))},
            "lobe": {"s": (1, 1.1, 1)},
        }
    A.clip("Run", 12, run)

    # Attack 0.625 s: lean back (wind-up) then lash the pseudopod forward
    lean = Track([(0, 0), (0.35, 14), (0.55, -22, ease_out), (0.75, -8), (1, 0)])
    lob = Track([(0, 1), (0.35, 0.8), (0.52, 2.3, ease_out), (0.7, 1.4), (1, 1)])
    lobr = Track([(0, 0), (0.35, 25), (0.52, -20, ease_out), (0.72, 5), (1, 0)])
    squ = Track([(0, 1), (0.35, 1.15), (0.55, 0.85), (0.75, 1.05), (1, 1)])

    def attack(t):
        return {
            "base": {"s": sq(squ(t))},
            "body": {"r": (lean(t) * 0.5, 0, 0)},
            "top": {"r": (lean(t), 0, 0)},
            "lobe": {"r": (lobr(t), 0, 0), "s": (1 / math.sqrt(lob(t)), lob(t), 1 / math.sqrt(lob(t)))},
        }
    A.clip("Attack", 15, attack)

    # Attack2 1.5 s: big jump slam — deep squash (0.6 s telegraph), leap, stretch, slam flat, wobble back
    jz = Track([(0, 0), (0.4, 0), (0.46, 0.05), (0.58, 0.75, ease_out), (0.66, 0.78), (0.74, 0.0, ease_in), (1, 0)])
    js = Track([(0, 1), (0.36, 1.55), (0.42, 1.6), (0.48, 0.62), (0.6, 0.75), (0.7, 0.85), (0.74, 1.8), (0.8, 1.35),
                (0.87, 0.85), (0.93, 1.1), (1, 1)])
    jl = Track([(0, 0), (0.38, 8), (0.5, -10), (0.66, 6), (0.74, 0), (0.8, -6), (0.9, 3), (1, 0)])

    def attack2(t):
        s = js(t)
        return {
            "base": {"s": sq(s), "t": (0, -0.12 * smooth((t - 0.45) / 0.3) * (1 - smooth((t - 0.8) / 0.2)), jz(t))},
            "body": {"r": (jl(t), 0, 0), "s": sq(1 + (s - 1) * 0.25)},
            "top": {"r": (jl(t) * 1.2, 0, 0)},
            "lobe": {"s": (1, 1 + 0.4 * max(0.0, s - 1), 1)},
        }
    A.clip("Attack2", 36, attack2)

    # Hit 0.375 s: knocked back jiggle
    hk = Track([(0, 0), (0.25, 1, ease_out), (0.5, -0.5), (0.75, 0.25), (1, 0)])

    def hit(t):
        k = hk(t)
        return {
            "base": {"s": sq(1 + 0.18 * k)},
            "body": {"r": (12 * k, 0, 4 * k), "t": (0, 0.03 * k, 0)},
            "top": {"r": (16 * k, 0, 0), "s": sq(1 - 0.1 * k)},
            "lobe": {"s": (1, 1 - 0.3 * k, 1)},
        }
    A.clip("Hit", 9, hit)

    # Death 1.25 s: shudder, then melt into a flat puddle
    dm = Track([(0, 0), (0.25, 0.0), (0.85, 1.0, ease_in), (1, 1)])
    sh = Track([(0, 0), (0.08, 1), (0.16, -1), (0.24, 0.6), (0.32, 0), (1, 0)])

    def death(t):
        m = dm(t)
        s = 1 + 5.5 * m
        return {
            "base": {"s": (min(1.9, math.sqrt(s)) * (1 + 0.1 * sh(t)), min(1.9, math.sqrt(s)), 1 / s), "t": (0, 0, 0)},
            "body": {"r": (8 * sh(t), 0, 0), "s": sq(1 + 0.4 * m)},
            "top": {"r": (-10 * m, 0, 0), "s": sq(1 + 0.8 * m)},
            "lobe": {"s": (1, 1 + 0.4 * m, 1)},
        }
    A.clip("Death", 30, death)
    A.rest_pose()
