"""Frost giant (boss ≈6 m): pale blue-grey giant in rune-engraved black-iron armour rimed with ice (pauldrons with
ice-crystal growths, bracers, greaves, belt), horned helm, glowing icy eyes, a beard of hanging icicles, a fur kilt
(Cloth_ -> client wind) and a huge ice axe (wooden haft, iron socket, crescent blade of glacial ice).
Clips: Idle Walk Run Attack (diagonal axe cleave) Attack2 (two-handed overhead chop) Hit Death Special (ice-nova roar)."""
import math
import random

import bmesh
import bpy
from mathutils import Euler, Vector

import banim as A
import gk
import gmat
import troll as T
from kit import bake, gn, materials as M, qa, rig

KEY = "frost_giant"

SH = (1.0, 0.05, 4.7)
EL = (1.42, 0.16, 3.78)
WR = (1.64, -0.08, 2.92)
HD = (1.7, -0.2, 2.42)
HIP = (0.48, 0.05, 3.05)
KN = (0.58, -0.2, 1.66)
AN = (0.6, 0.05, 0.3)
TO = (0.62, -0.62, 0.08)


def L(p, s=1):
    return (p[0] * s, p[1], p[2])


def joints():
    J = {
        "root": ((0, 0, 0), (0, 0, 0.6)),
        "hips": ((0, 0.05, 3.05), (0, 0.05, 3.55)),
        "spine": ((0, 0.05, 3.55), (0, 0.02, 4.05)),
        "chest": ((0, 0.02, 4.05), (0, -0.05, 4.85)),
        "neck": ((0, -0.08, 4.8), (0, -0.18, 5.15)),
        "head": ((0, -0.18, 5.15), (0, -0.26, 5.85)),
        "jaw": ((0, -0.22, 5.28), (0, -0.62, 5.08)),
    }
    for s, n in ((1, "L"), (-1, "R")):
        J[f"upper_arm.{n}"] = (L(SH, s), L(EL, s))
        J[f"forearm.{n}"] = (L(EL, s), L(WR, s))
        J[f"hand.{n}"] = (L(WR, s), L(HD, s))
        J[f"thigh.{n}"] = (L(HIP, s), L(KN, s))
        J[f"shin.{n}"] = (L(KN, s), L(AN, s))
        J[f"foot.{n}"] = (L(AN, s), L(TO, s))
    return J


PARENTS = {"hips": "root", "spine": "hips", "chest": "spine", "neck": "chest", "head": "neck", "jaw": "head"}
for _n in ("L", "R"):
    PARENTS.update({f"upper_arm.{_n}": "chest", f"forearm.{_n}": f"upper_arm.{_n}", f"hand.{_n}": f"forearm.{_n}",
                    f"thigh.{_n}": "hips", f"shin.{_n}": f"thigh.{_n}", f"foot.{_n}": f"shin.{_n}"})
LEGS = [("L", "thigh.L", "shin.L", "foot.L"), ("R", "thigh.R", "shin.R", "foot.R")]


def body_meta(res):
    m = gk.Meta("FrostMB", res=res)
    m.ellipsoid((0, 0.05, 3.2), (0.62, 0.45, 0.4), stiff=3)                           # pelvis
    m.ellipsoid((0, -0.02, 3.65), (0.62, 0.44, 0.45), stiff=3)                        # abdomen
    m.ellipsoid((0, 0.0, 4.3), (0.9, 0.55, 0.6), rot=(-6, 0, 0), stiff=3)             # rib cage
    m.ellipsoid((0, 0.18, 4.65), (0.8, 0.45, 0.35), rot=(-15, 0, 0), stiff=3)         # upper back
    for s in (1, -1):
        m.ellipsoid((0.42 * s, -0.36, 4.42), (0.4, 0.2, 0.3), rot=(10, 0, 14 * s), stiff=4)   # pecs
        m.ellipsoid((0.45 * s, 0.05, 4.82), (0.4, 0.34, 0.24), rot=(0, -18 * s, 0), stiff=3)  # traps
        m.ellipsoid((0.3 * s, -0.36, 3.7), (0.2, 0.12, 0.32), stiff=5)                       # abs
    m.capsule((0, -0.05, 4.8), (0, -0.18, 5.2), 0.3)
    m.ellipsoid((0, -0.25, 5.5), (0.32, 0.36, 0.38), rot=(-8, 0, 0))                    # skull
    m.ellipsoid((0, -0.52, 5.56), (0.3, 0.1, 0.07), rot=(10, 0, 0), stiff=6)            # brow
    m.ellipsoid((0, -0.46, 5.22), (0.26, 0.22, 0.17), rot=(8, 0, 0))                     # jaw
    m.limb([((0, -0.56, 5.5), 0.06), ((0, -0.64, 5.4), 0.075), ((0, -0.64, 5.34), 0.06)], stiff=6)   # nose
    for s in (1, -1):
        m.ellipsoid((0.3 * s, -0.24, 5.46), (0.05, 0.12, 0.14), stiff=5)                # ears
        sh, el, wr, hd = L(SH, s), L(EL, s), L(WR, s), L(HD, s)
        m.ball(sh, 0.42, stiff=3)
        m.limb([(sh, 0.34), (el, 0.26)])
        m.ellipsoid(Vector(sh).lerp(Vector(el), 0.45) + Vector((0, 0.04, 0)), (0.28, 0.3, 0.44), stiff=4)
        m.limb([(el, 0.26), (Vector(el).lerp(Vector(wr), 0.35), 0.29), (wr, 0.19)])
        w, h = Vector(wr), Vector(hd)
        m.ellipsoid(w.lerp(h, 0.4), (0.2, 0.25, 0.26), stiff=5)
        d = (h - w).normalized()
        for off in (-0.13, -0.045, 0.045, 0.13):
            base = w.lerp(h, 0.75) + Vector((0, -off, 0))
            tip = base + d * 0.3 + Vector((0, -off * 0.3 - 0.07, 0))
            m.limb([(base, 0.08), (tip, 0.065)], stiff=7)
        tb = w.lerp(h, 0.35) + Vector((0, -0.2, 0))
        m.limb([(tb, 0.08), (tb + Vector((-0.03 * s, -0.17, -0.17)), 0.063)], stiff=7)
        hp, kn, an = L(HIP, s), L(KN, s), L(AN, s)
        m.limb([(hp, 0.4), (kn, 0.28)])
        m.ellipsoid(Vector(hp).lerp(Vector(kn), 0.4), (0.34, 0.36, 0.5), stiff=4)
        m.limb([(kn, 0.27), (an, 0.18)])
        m.ellipsoid(Vector(kn).lerp(Vector(an), 0.3) + Vector((0, 0.1, 0)), (0.24, 0.24, 0.36), stiff=4)
        m.ellipsoid((an[0], an[1] - 0.25, 0.15), (0.24, 0.42, 0.14), stiff=5)
    return m


LAYERS = [
    {"type": "noise", "scale": 1.2, "amp": 0.03, "detail": 2},
    {"type": "noise", "scale": 4.0, "amp": 0.01, "detail": 3, "seed": 4},
    {"type": "ridges", "scale": 5.0, "amp": 0.006, "stretch": (1, 1, 2.5), "sharp": 3, "seed": 5},      # veins/folds
    {"type": "bumps", "scale": 14.0, "amp": 0.004, "size": 0.35, "density": 0.4, "seed": 7, "store": "wart"},
]


# ----------------------------------------------------------------------------- armour / gear
def shell(body, bone_pts, radius_add, name, mat, seg=18, rows=6, flat_top=False):
    """Armour band around a limb segment: rings sampled on the body surface (inside-out rays) + offset."""
    a, b = Vector(bone_pts[0]), Vector(bone_pts[1])
    axis = (b - a).normalized()
    u = axis.orthogonal().normalized()
    w = axis.cross(u)
    verts, faces = [], []
    for r in range(rows + 1):
        t = r / rows
        c = a.lerp(b, t)
        flare = 1.0 + 0.12 * (abs(t - 0.5) * 2) ** 2
        for s_ in range(seg):
            ang = 2 * math.pi * s_ / seg
            d = u * math.cos(ang) + w * math.sin(ang)
            ok, loc, n, i = body.ray_cast(c, d, distance=2.0)
            rr = (loc - c).length if ok else 0.3
            verts.append(c + d * (rr * flare + radius_add))
    for r in range(rows):
        for s_ in range(seg):
            i0, i1 = r * seg + s_, r * seg + (s_ + 1) % seg
            faces.append((i0, i1, i1 + seg, i0 + seg))
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    gk.cleanup(ob, keep_largest=False)
    _outward_axis(ob, a, b)
    for p in ob.data.polygons:
        p.use_smooth = True
    gn.solidify(ob, 0.04, offset=1.0)
    gn.apply(ob)
    gk.set_mat(ob, mat)
    return ob


def _outward_axis(ob, a, b):
    axis = (b - a).normalized()
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.normal_update()
    score = 0.0
    for f in bm.faces:
        c = f.calc_center_median()
        v = c - a
        radial = v - axis * v.dot(axis)
        score += f.normal.dot(radial)
    if score < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()


def pauldron(s, mat, ice):
    """Layered iron shoulder guard (3 overlapping lames) + ice crystals growing out of it."""
    parts = []
    sh = Vector(L(SH, s))
    for k in range(3):
        c = sh + Vector((0.12 * s + 0.1 * s * k, 0.02, 0.28 - 0.2 * k))
        ob = gk.rounded_box((0.95 - 0.1 * k, 1.0 - 0.08 * k, 0.26), 0.55, cuts=4, name="Lame", loc=c,
                            rot=(0, -28 * s - 12 * s * k, 0))
        # dome it: push the centre up
        for v in ob.data.vertices:
            lv = v.co - c
            v.co.z += 0.12 * max(0.0, 1 - (lv.x ** 2 + lv.y ** 2) / 0.25)
        gk.set_mat(ob, mat)
        parts.append(ob)
    iron = gk.join(parts, "Pauldron")
    rnd = random.Random(3 + s)
    crys = []
    for k in range(6):
        base = sh + Vector((s * rnd.uniform(0.05, 0.45), rnd.uniform(-0.3, 0.35), 0.38 + rnd.uniform(-0.05, 0.05)))
        d = Vector((s * rnd.uniform(0.1, 0.6), rnd.uniform(-0.3, 0.4), 1.0)).normalized()
        h = rnd.uniform(0.35, 0.85)
        crys.append(gk.spike(base - d * 0.1, base + d * h, rnd.uniform(0.07, 0.12), seg=5, rings=2, name="IceCrystal"))
    for o in crys:
        gk.set_mat(o, ice)
    return gk.join([iron] + crys, f"Pauldron{s}")


def helm(mat, horn_mat):
    parts = []
    prof = [(0.0, 5.92), (0.18, 5.9), (0.3, 5.82), (0.37, 5.68), (0.4, 5.55), (0.405, 5.45)]
    lat = gk.lathe([(r, z) for r, z in reversed(prof)], seg=24, name="Helm", cap_top=False, cap_bottom=False)
    for v in lat.data.vertices:
        v.co.y = v.co.y * 1.08 - 0.26
    lat.data.update()
    T._outward(lat)
    gn.solidify(lat, 0.04, offset=1.0)
    gn.apply(lat)
    # nasal guard
    nas = gk.rounded_box((0.09, 0.07, 0.34), 0.4, cuts=2, name="Nasal", loc=(0, -0.66, 5.54), rot=(12, 0, 0))
    for o in (lat, nas):
        gk.set_mat(o, mat)
    parts += [lat, nas]
    for s in (1, -1):
        pts, rad = [], []
        for i in range(10):
            t = i / 9
            pts.append((s * (0.34 + 0.55 * t), -0.22 + 0.2 * t, 5.72 + 0.2 * t + 0.5 * t * t))
            rad.append(0.1 * (1 - t) ** 0.8 + 0.012)
        h = gk.tube(pts, rad, seg=8, name="HelmHorn")
        gk.set_mat(h, horn_mat)
        parts.append(h)
    return gk.join(parts, "Helm")


def beard(ice, eye_mat):
    """Icicle beard hanging from the jaw line + two glowing eyes."""
    rnd = random.Random(11)
    parts = []
    for i in range(22):
        t = i / 21
        ang = (t - 0.5) * 2.4
        x = 0.27 * math.sin(ang)
        y = -0.3 - 0.3 * math.cos(ang)
        z = 5.14 + 0.1 * abs(math.sin(ang)) + 0.04
        ln = (0.9 - 0.55 * abs(t - 0.5) * 2) * rnd.uniform(0.7, 1.1)
        r = rnd.uniform(0.045, 0.07)
        parts.append(gk.spike((x, y, z + 0.06), (x * 1.1 + rnd.uniform(-0.04, 0.04), y - 0.08, z - ln), r, seg=5, rings=3,
                              bend=(0, -0.05, 0), name="Icicle"))
    for o in parts:
        gk.set_mat(o, ice)
    eyes = []
    for s in (1, -1):
        e = gk.rounded_box((0.12, 0.06, 0.06), 0.7, cuts=2, name="Eye", loc=(0.14 * s, -0.55, 5.48), rot=(0, 0, -12 * s))
        gk.set_mat(e, eye_mat)
        eyes.append(e)
    return gk.join(parts + eyes, "Beard")


def axe(wood, iron, ice):
    grip = (Vector(L(WR, -1)) + Vector(L(HD, -1))) / 2 + Vector((0, -0.08, 0))
    d = Vector((0.06, -0.62, 0.78)).normalized()
    haft = gk.tube([grip - d * 1.0, grip + d * 2.8], [0.085, 0.075], seg=10, name="Haft")
    gk.sculpt(haft, [{"type": "ridges", "scale": 6.0, "amp": 0.01, "stretch": (1, 1, 0.3)}], subdiv=1)
    gn.apply(haft)
    gk.set_mat(haft, wood)
    # iron socket + pommel + leather-less iron bands
    side = d.cross(Vector((0, 0, 1))).normalized()
    up = side.cross(d).normalized()
    head_c = grip + d * 2.45
    sock_ = gk.tube([head_c - d * 0.35, head_c + d * 0.4], [0.13, 0.12], seg=10, name="Socket")
    pom = gk.tube([grip - d * 1.08, grip - d * 0.9], [0.13, 0.1], seg=10, name="Pommel")
    bands = [gk.tube([grip + d * t, grip + d * (t + 0.06)], [0.095, 0.095], seg=10, name="Band") for t in (-0.3, 0.0, 0.35)]
    for o in [sock_, pom] + bands:
        gk.set_mat(o, iron)
    # crescent ice blade: a closed quad grid lofted between an inner and a jagged outer arc, thick at the socket
    # and thinning to a chipped cutting edge (no n-gon fans / long slivers)
    rng = random.Random(7)
    cols, rows = 22, 6
    outer, inner = [], []
    for i in range(cols + 1):
        a = -1.0 + 2.0 * i / cols
        jag = 0.0 if i in (0, cols) else rng.uniform(-0.05, 0.03)
        outer.append(((0.3 + (1.05 + jag) * math.cos(a * 0.95)), (1.05 + jag) * math.sin(a)))
        inner.append((0.05 + 0.16 * math.cos(a), 0.36 * math.sin(a)))
    verts, faces = [], []

    def vid(sd, r, c):
        return (sd * (rows + 1) + r) * (cols + 1) + c
    for sd in (0, 1):
        for r in range(rows + 1):
            t = r / rows
            th = 0.11 * (1 - t) ** 1.3 + 0.008
            for c in range(cols + 1):
                x = inner[c][0] + (outer[c][0] - inner[c][0]) * t
                y = inner[c][1] + (outer[c][1] - inner[c][1]) * t
                verts.append((x, y, th if sd == 0 else -th))
    for r in range(rows):
        for c in range(cols):
            faces.append((vid(0, r, c), vid(0, r, c + 1), vid(0, r + 1, c + 1), vid(0, r + 1, c)))
            faces.append((vid(1, r, c), vid(1, r + 1, c), vid(1, r + 1, c + 1), vid(1, r, c + 1)))
    for c in range(cols):   # rims: inner arc (r=0) and cutting edge (r=rows)
        faces.append((vid(0, 0, c + 1), vid(0, 0, c), vid(1, 0, c), vid(1, 0, c + 1)))
        faces.append((vid(0, rows, c), vid(0, rows, c + 1), vid(1, rows, c + 1), vid(1, rows, c)))
    for r in range(rows):   # the two blade tips
        faces.append((vid(0, r, 0), vid(0, r + 1, 0), vid(1, r + 1, 0), vid(1, r, 0)))
        faces.append((vid(0, r + 1, cols), vid(0, r, cols), vid(1, r, cols), vid(1, r + 1, cols)))
    me = bpy.data.meshes.new("Blade")
    me.from_pydata(verts, [], faces)
    blade = bpy.data.objects.new("Blade", me)
    bpy.context.scene.collection.objects.link(blade)
    import mathutils
    Mx = mathutils.Matrix((side, d, up)).transposed()  # local x -> side, y -> along haft, z -> up (thickness)
    for v in blade.data.vertices:
        v.co = head_c + Mx @ Vector((v.co.x, v.co.y, v.co.z))
    blade.data.update()
    gk.sculpt(blade, [{"type": "cells", "scale": 7.0, "amp": 0.012, "smooth": 0.2},
                      {"type": "cracks", "scale": 5.0, "amp": 0.01, "width": 0.04, "seed": 3}], subdiv=1)
    gn.apply(blade)
    gk.cleanup(blade, keep_largest=False)
    gk.set_mat(blade, ice)
    # a few jagged ice shards on the blade back
    shards = []
    for k in range(4):
        b = head_c - side * 0.12 + d * (-0.3 + 0.2 * k)
        shards.append(gk.spike(b, b - side * (0.35 + 0.1 * (k % 2)) + d * 0.1, 0.07, seg=5, rings=2, name="Shard"))
    for o in shards:
        gk.set_mat(o, ice)
    return gk.join([haft, sock_, pom] + bands + [blade] + shards, "IceAxe")


# ----------------------------------------------------------------------------- animation
def clips(R):
    stance = {"hips": {"rot": (3, 0, 0), "loc": (0, 0, -0.08)}, "spine": (3, 0, 0), "chest": (2, 0, 0), "neck": (-2, 0, 0),
              "head": (-3, 0, 0), "upper_arm.L": (-8, -8, 0), "upper_arm.R": (-10, 10, 0), "forearm.L": (-18, 0, 0),
              "forearm.R": (-30, 0, 0), "hand.R": (-6, 0, 0)}
    B = A.Biped(R, dict(stance=stance, stride=1.5, lift=0.4, walk_frames=34, bob=0.1, sway=0.1, arm_swing=12, lean=4,
                        run_stride=1.8, run_lift=0.5, run_frames=22, run_lean=14, run_bob=0.18, heavy=1.0, jaw=True,
                        swing_R=0.35))
    B.idle(frames=72)
    B.walk()
    B.run()
    wind = {"hips": {"rot": (-3, 0, -16), "loc": (0, 0.1, -0.04)}, "spine": (-6, 0, -14), "chest": (-6, -5, -24),
            "head": (-6, 0, 20), "upper_arm.R": (-135, 45, 0), "forearm.R": (-70, 0, 0), "hand.R": (-20, 0, 0),
            "upper_arm.L": (-40, -18, 0), "forearm.L": (-35, 0, 0), "jaw": (10, 0, 0), "ik_foot.R": {"loc": (0, -0.2, 0.25)}}
    cleave = {"hips": {"rot": (10, 0, 14), "loc": (0, -0.25, -0.25)}, "spine": (18, 0, 12), "chest": (14, 5, 30),
              "head": (-10, 0, -12), "upper_arm.R": (-55, -20, 0), "forearm.R": (-10, 0, 0), "hand.R": (10, 0, 0),
              "upper_arm.L": (15, -25, 0), "forearm.L": (-25, 0, 0), "jaw": (22, 0, 0), "ik_foot.R": {"loc": (0, -0.6, 0)}}
    follow = A.add(cleave, {"chest": (4, 0, 10), "upper_arm.R": (22, -14, 0), "hips": {"loc": (0, -0.03, -0.04)}})
    B.key("Attack", [(0, {}), (6, A.scale(wind, 0.5)), (12, wind), (16, cleave), (19, follow), (29, {})])
    up = {"hips": {"rot": (-6, 0, 0), "loc": (0, 0.18, 0.08)}, "spine": (-10, 0, 0), "chest": (-16, 0, 0), "neck": (-6, 0, 0),
          "head": (-16, 0, 0), "upper_arm.R": (-172, 10, 0), "upper_arm.L": (-160, -14, 0), "forearm.R": (-50, 0, 0),
          "forearm.L": (-70, 0, 0), "hand.R": (-25, 0, 0), "jaw": (30, 0, 0), "ik_foot.R": {"loc": (0, -0.1, 0.1)}}
    chop = {"hips": {"rot": (14, 0, 0), "loc": (0, -0.3, -0.45)}, "spine": (22, 0, 0), "chest": (16, 0, 0), "neck": (-10, 0, 0),
            "head": (-12, 0, 0), "upper_arm.R": (-88, -8, 0), "upper_arm.L": (-82, 8, 0), "forearm.R": (-8, 0, 0),
            "forearm.L": (-20, 0, 0), "hand.R": (8, 0, 0), "jaw": (20, 0, 0),
            "ik_foot.R": {"loc": (0, -0.7, 0)}, "ik_foot.L": {"loc": (0, 0.15, 0)}}
    B.key("Attack2", [(0, {}), (7, A.scale(chop, 0.2)), (15, A.scale(up, 0.85)), (20, up), (24, chop),
                      (27, A.add(chop, {"hips": {"loc": (0, 0, -0.05)}, "spine": (3, 0, 0)})), (33, A.scale(chop, 0.5)),
                      (40, {})])
    B.hit()
    B.death(frames=60, fall_x=80.0, lift=1.9, knee_drop=0.9)
    # Special: ice-nova roar — gather (crouch, arms in), then burst up: arms flung wide, head back, jaw wide
    gather = {"hips": {"rot": (10, 0, 0), "loc": (0, 0.05, -0.45)}, "spine": (18, 0, 0), "chest": (14, 0, 0), "neck": (4, 0, 0),
              "head": (8, 0, 0), "upper_arm.L": (-60, 25, 0), "upper_arm.R": (-60, -25, 0), "forearm.L": (-90, 0, 0),
              "forearm.R": (-90, 0, 0), "jaw": (5, 0, 0)}
    burst = {"hips": {"rot": (-8, 0, 0), "loc": (0, 0.12, 0.05)}, "spine": (-12, 0, 0), "chest": (-20, 0, 0), "neck": (-12, 0, 0),
             "head": (-26, 0, 0), "upper_arm.L": (-50, -85, 0), "upper_arm.R": (-50, 85, 0), "forearm.L": (-20, 0, 0),
             "forearm.R": (-20, 0, 0), "hand.L": (-20, 0, 0), "hand.R": (-20, 0, 0), "jaw": (40, 0, 0)}
    B.key("Special", [(0, {}), (10, A.scale(gather, 0.7)), (18, gather), (23, burst),
                      (40, A.add(burst, {"chest": (-3, 0, 0), "head": (-3, 0, 4), "jaw": (3, 0, 0)})),
                      (48, A.scale(burst, 0.5)), (56, {})])


# ----------------------------------------------------------------------------- build
def build(args, stage):
    mats = {
        "skin": gmat.hide("FrostSkin", c1="#8ea2b0", c2="#5c6e7c", belly="#b7c5cd", wart="#a9bac6", seed=4,
                          back_dark=0.3, veins=0.45),
        "iron": M.engraved_metal("FrostIron", kind="blackiron", pattern="bands", rust=0.15, grime=0.6, wear=0.7),
        "ice": M.crystal("FrostIce", color="#9ad8f2", glow=0.35, emit_strength=2.5, seed=3),
        "horn": M.bone("FrostHorn", color="#6d6a66", dirt=0.9),
        "fur": gmat.fur("Cloth_FrostKilt", root="#2a221c", mid="#6b5a48", tip="#a8987f", dirt_col="#3a3027", seed=5),
        "wood": M.wood("FrostHaft", color="#4a3525", color2="#231810", axis="Y", seed=2),
        "eye": M.emissive("FrostEye", color="#9fefff", strength=9.0),
        "leather": M.leather("FrostLeather", color="#3a2a1e", wear=0.6),
    }
    base = body_meta(0.03).to_mesh("FrostBase")
    gk.set_mat(base, mats["skin"])
    gear = []
    for s, n in ((1, "L"), (-1, "R")):
        gear.append(pauldron(s, mats["iron"], mats["ice"]))
        gear.append(shell(base, (Vector(L(EL, s)).lerp(Vector(L(WR, s)), 0.3), Vector(L(WR, s)) + Vector((0, 0, 0.05))), 0.05,
                          f"Bracer{n}", mats["iron"], rows=4))
        gear.append(shell(base, (Vector(L(KN, s)).lerp(Vector(L(AN, s)), 0.2), Vector(L(AN, s)) + Vector((0, 0, 0.15))), 0.05,
                          f"Greave{n}", mats["iron"], rows=5))
    belt = T.ring_tube(base, mats["leather"], 3.45, 0.06, 0.07, "Belt", flat=(1.0, 1.8))
    head = helm(mats["iron"], mats["horn"])
    brd = beard(mats["ice"], mats["eye"])
    weapon = axe(mats["wood"], mats["iron"], mats["ice"])
    kilt = T.loincloth(base, mats["fur"], z_top=3.5, length0=1.3, side_cut=0.55, flare0=0.06, flare1=0.14, seg=36,
                       rows=8, name="Kilt", step=0.18)
    if stage == "shape":
        hi = gk.sculpt_copy(base, LAYERS, subdiv=1, name="FrostHigh")
        gk.clay_sheet([hi, belt, head, brd, weapon, kilt] + gear, gk.wip_path(f"{KEY}_clay.png"))
        return {}
    high = gk.sculpt_copy(base, LAYERS, subdiv=2, name="_FrostHigh")
    gn.edge_wear(high)
    gn.apply(high)
    body = gk.retopo(base, faces=6500, layers=LAYERS, max_scale=1.5, name="FrostGiant")
    gk.set_mat(body, mats["skin"])
    armor = gk.join(gear + [belt, head], "Armor")
    bpy.data.objects.remove(base, do_unlink=True)
    print(f"[frost] tris body={gk.tris(body)} armor={gk.tris(armor)} beard={gk.tris(brd)} axe={gk.tris(weapon)} "
          f"kilt={gk.tris(kilt)} high={gk.tris(high)}", flush=True)

    R = gk.Rigger(joints(), PARENTS, legs=LEGS, pole_dist=2.2)
    arm = R.arm
    src = gk.dup(body, "_BodySrc")
    rig.bind(body, arm, smooth=3)
    rig.bind(src, arm, smooth=3)
    rig.transfer_weights(src, armor, arm, smooth=4)
    rig.transfer_weights(src, brd, arm, smooth=2)
    rig.transfer_weights(src, kilt, arm, smooth=25, factor=0.7)
    gk.rigid(weapon, arm, "hand.R")
    gn.solidify(kilt, 0.02, offset=-1.0)
    bpy.data.objects.remove(src, do_unlink=True)
    clips(R)
    R.bake()
    meshes = [body, armor, brd, kilt, weapon]
    gk.ground_clamp(arm, meshes)
    if stage == "anim":
        gk.pose_sheet(KEY + "_anim", meshes, arm, gk.wip_path(""))
        return {}
    qa.delete_covered_body(body, [kilt], margin=0.02, max_depth=0.5, shrink=0.015)
    for o in (armor, brd, kilt, weapon):
        o["kit_bake_direct"] = 1
    bake.bake_asset(meshes, KEY, size=2048, high=high, extrusion=0.08, max_ray=0.2, ao_samples=48, samples=8,
                    group_sizes={"Cloth_FrostKilt": 1024})
    bpy.data.objects.remove(high, do_unlink=True)
    return gk.finish(KEY, args, arm, meshes, "boss", expected=(None, None, 6.0), body=body, cloths=[kilt],
                     hero=("Special", 30))
