"""Bog lurker (≈2.2 m): hunched swamp brute of peat, mud and roots. Cracked mud crust + wet runnels + moss on top
(one continuous sculpted body), roots coiling around the limbs and torso (tubes), hanging moss strands scattered by
Geometry Nodes, root-claw fingers, three glowing sickly-green eyes and a gaping maw."""
import math
import random

import bpy
from mathutils import Vector

import banim as A
import gk
import gmat
from kit import bake, gn, materials as M, rig

KEY = "bog_lurker"

SH = (0.5, 0.05, 1.6)
EL = (0.74, 0.14, 1.12)
WR = (0.84, -0.1, 0.66)
HD = (0.88, -0.2, 0.36)
HIP = (0.26, 0.08, 0.86)
KN = (0.32, -0.08, 0.47)
AN = (0.32, 0.08, 0.1)
TO = (0.33, -0.22, 0.03)


def L(p, s=1):
    return (p[0] * s, p[1], p[2])


def joints():
    J = {
        "root": ((0, 0, 0), (0, 0, 0.25)),
        "hips": ((0, 0.08, 0.86), (0, 0.08, 1.08)),
        "spine": ((0, 0.08, 1.08), (0, 0.06, 1.34)),
        "chest": ((0, 0.06, 1.34), (0, -0.04, 1.66)),
        "neck": ((0, -0.08, 1.6), (0, -0.3, 1.66)),
        "head": ((0, -0.3, 1.66), (0, -0.44, 1.9)),
        "jaw": ((0, -0.34, 1.64), (0, -0.56, 1.5)),
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


def fingers(s):
    w, h = Vector(L(WR, s)), Vector(L(HD, s))
    d = (h - w).normalized()
    out = []
    for off in (-0.06, 0.0, 0.06):
        base = w.lerp(h, 0.7) + Vector((0, -off, 0))
        tip = base + d * 0.24 + Vector((0.02 * s, -off * 0.5 - 0.05, 0))
        out.append((base, tip))
    return out


def body_meta(res):
    m = gk.Meta("BogMB", res=res)
    m.ellipsoid((0, 0.08, 0.92), (0.32, 0.28, 0.24), stiff=3)
    m.ellipsoid((0, -0.02, 1.16), (0.38, 0.34, 0.3), stiff=3)
    m.ellipsoid((0, 0.06, 1.42), (0.44, 0.34, 0.3), rot=(-15, 0, 0), stiff=3)
    m.ellipsoid((0, 0.22, 1.6), (0.4, 0.3, 0.26), rot=(-35, 0, 0), stiff=3)          # hunched hump
    for s in (1, -1):
        m.ellipsoid((0.24 * s, 0.08, 1.66), (0.2, 0.24, 0.16), rot=(0, -20 * s, 0), stiff=3)
    # head: sunk low and forward, wide maw
    m.capsule((0, -0.05, 1.56), (0, -0.28, 1.66), 0.16)
    m.ellipsoid((0, -0.38, 1.74), (0.2, 0.2, 0.15), rot=(-10, 0, 0))
    m.ellipsoid((0, -0.46, 1.6), (0.18, 0.16, 0.08), rot=(15, 0, 0), stiff=4)                # lower maw
    m.ellipsoid((0, -0.52, 1.76), (0.19, 0.06, 0.05), rot=(10, 0, 0), stiff=6)               # brow
    m.ellipsoid((0, -0.56, 1.64), (0.1, 0.06, 0.05), stiff=6, neg=True)                      # mouth hollow

    for s in (1, -1):
        sh, el, wr, hd = L(SH, s), L(EL, s), L(WR, s), L(HD, s)
        m.ball(sh, 0.2, stiff=3)
        m.limb([(sh, 0.16), (el, 0.12)])
        m.limb([(el, 0.13), (Vector(el).lerp(Vector(wr), 0.4), 0.15), (wr, 0.09)])
        m.ellipsoid(Vector(wr).lerp(Vector(hd), 0.35), (0.09, 0.11, 0.12), stiff=5)
        for base, tip in fingers(s):
            m.limb([(base, 0.04), (tip, 0.025)], stiff=7)
        hp, kn, an = L(HIP, s), L(KN, s), L(AN, s)
        m.limb([(hp, 0.18), (kn, 0.13)])
        m.ellipsoid(Vector(hp).lerp(Vector(kn), 0.4), (0.15, 0.16, 0.2), stiff=4)
        m.limb([(kn, 0.12), (an, 0.09)])
        m.ellipsoid(Vector(kn).lerp(Vector(an), 0.3) + Vector((0, 0.05, 0)), (0.11, 0.11, 0.15), stiff=4)
        m.ellipsoid((an[0], an[1] - 0.1, 0.07), (0.11, 0.2, 0.065), stiff=5)
        for off in (-0.05, 0.0, 0.05):
            b = Vector((an[0] + off, an[1] - 0.24, 0.05))
            m.limb([(b, 0.035), (b + Vector((off * 0.4, -0.1, -0.01)), 0.028)], stiff=7)
    return m


LAYERS = [
    {"type": "noise", "scale": 2.5, "amp": 0.03, "detail": 3},                                   # lumpy peat
    {"type": "noise", "scale": 6.0, "amp": 0.014, "detail": 4, "dist": 0.8, "seed": 2},        # mud clumps
    {"type": "cracks", "scale": 4.5, "amp": 0.007, "width": 0.035, "seed": 3, "warp": 1.2, "store": "crack"},
    {"type": "ridges", "scale": 5.0, "amp": 0.01, "stretch": (1, 1, 0.3), "sharp": 3, "seed": 6},  # dripping runnels
    {"type": "noise", "scale": 20.0, "amp": 0.004, "detail": 4, "seed": 8},
]


def roots(body, mat, eye_mat, claw_mat):
    """Roots coiling around the limbs and torso + eyes + root claws (all one mesh, weights transferred later)."""
    rnd = random.Random(4)
    parts = []

    def coil(a, b, r_off, turns, thick, phase):
        a, b = Vector(a), Vector(b)
        axis = (b - a).normalized()
        u = axis.orthogonal().normalized()
        w = axis.cross(u)
        pts, rad = [], []
        n = int(10 * turns) + 6
        for i in range(n + 1):
            t = i / n
            ang = phase + t * turns * 2 * math.pi
            p = a.lerp(b, t)
            d = u * math.cos(ang) + w * math.sin(ang)
            # find the body surface along d from the axis point, sit on it
            ok, loc, nr, idx = body.ray_cast(p, d, distance=1.0)
            rr = (loc - p).length if ok else r_off
            pts.append(p + d * (rr + thick * 0.35))
            rad.append(thick * (0.6 + 0.4 * math.sin(math.pi * t)))
        parts.append(gk.tube(pts, rad, seg=6, name="Root"))

    for s in (1, -1):
        coil(L(SH, s), L(EL, s), 0.15, 1.3, 0.035, rnd.random() * 6)
        coil(L(EL, s), L(WR, s), 0.15, 1.6, 0.032, rnd.random() * 6)
        coil(L(HIP, s), L(KN, s), 0.18, 1.2, 0.035, rnd.random() * 6)
        coil(L(KN, s), Vector(L(AN, s)) + Vector((0, 0, 0.05)), 0.12, 1.5, 0.03, rnd.random() * 6)
    coil((0, 0.06, 0.95), (0, 0.06, 1.6), 0.4, 1.4, 0.045, 0.5)
    coil((0, 0.06, 1.0), (0, 0.06, 1.55), 0.4, 1.1, 0.04, 3.0)
    for o in parts:
        gk.set_mat(o, mat)
    out = parts
    # claws: root-like spikes extending the fingers
    for s in (1, -1):
        for base, tip in fingers(s):
            d = (tip - base).normalized()
            c = gk.spike(tip - d * 0.03, tip + d * 0.1 + Vector((0, -0.02, -0.02)), 0.026, seg=6, rings=2,
                         bend=(0, -0.015, 0), name="Claw")
            gk.set_mat(c, claw_mat)
            out.append(c)
    # three glowing eyes (two + one on the brow)
    for x, y, z, r in ((0.09, -0.535, 1.72, 0.032), (-0.09, -0.535, 1.72, 0.032), (0.0, -0.545, 1.79, 0.024)):
        e = gk.rounded_box((r * 2, r * 1.4, r * 1.6), 0.7, cuts=2, name="Eye", loc=(x, y, z))
        gk.set_mat(e, eye_mat)
        out.append(e)
    # teeth: crooked pegs in the maw
    for i, x in enumerate((-0.09, -0.05, 0.0, 0.05, 0.09)):
        t = gk.spike((x, -0.55, 1.6), (x * 1.1, -0.57, 1.67 + 0.01 * (i % 2)), 0.014, seg=5, rings=2, name="Tooth")
        gk.set_mat(t, claw_mat)
        out.append(t)
    return gk.join(out, "Roots")


def clips(R):
    stance = {"hips": {"rot": (8, 0, 0), "loc": (0, 0, -0.04)}, "spine": (8, 0, 0), "chest": (4, 0, 0), "neck": (-8, 0, 0),
              "head": (-10, 0, 0), "upper_arm.L": (-10, -6, 0), "upper_arm.R": (-10, 6, 0), "forearm.L": (-25, 0, 0),
              "forearm.R": (-25, 0, 0), "hand.L": (-15, 0, 0), "hand.R": (-15, 0, 0)}
    B = A.Biped(R, dict(stance=stance, stride=0.6, lift=0.15, walk_frames=28, bob=0.04, sway=0.05, arm_swing=18,
                        lean=8, run_stride=0.95, run_lift=0.26, run_frames=16, run_lean=22, run_bob=0.07, heavy=0.4,
                        jaw=True))
    # idle: slow heaving breath + a sway of the head (lurking)
    B.idle(frames=64, extra=lambda ph: {"head": (0, 3 * math.sin(2 * math.pi * ph), 6 * math.sin(2 * math.pi * ph + 1)),
                                        "jaw": (4 + 4 * math.sin(2 * math.pi * ph), 0, 0)})
    B.walk()
    B.run()
    # Attack: left-right double claw rake (0.9 s)
    wl = {"hips": {"rot": (0, 0, 14), "loc": (0, 0.04, -0.02)}, "chest": (-6, 4, 18), "upper_arm.L": (-100, -55, 0),
          "forearm.L": (-55, 0, 0), "hand.L": (-25, 0, 0), "head": (-8, 0, -12), "jaw": (18, 0, 0)}
    rake_l = {"hips": {"rot": (8, 0, -12), "loc": (0, -0.1, -0.06)}, "spine": (12, 0, -8), "chest": (8, -4, -22),
              "upper_arm.L": (-60, 25, 0), "forearm.L": (-20, 0, 0), "hand.L": (20, 0, 0),
              "upper_arm.R": (-100, 55, 0), "forearm.R": (-55, 0, 0), "jaw": (26, 0, 0), "ik_foot.L": {"loc": (0, -0.2, 0)}}
    rake_r = {"hips": {"rot": (10, 0, 12), "loc": (0, -0.14, -0.08)}, "spine": (14, 0, 8), "chest": (10, 4, 22),
              "upper_arm.L": (-30, -10, 0), "forearm.L": (-30, 0, 0), "upper_arm.R": (-60, -25, 0), "forearm.R": (-20, 0, 0),
              "hand.R": (20, 0, 0), "jaw": (26, 0, 0), "ik_foot.L": {"loc": (0, -0.2, 0)}}
    B.key("Attack", [(0, {}), (5, wl), (9, rake_l), (13, rake_r), (16, A.scale(rake_r, 0.7)), (22, {})])
    # Attack2: rise up dripping, arms high, then crash both fists into the ground (0.7 s wind-up)
    rise = {"hips": {"rot": (-10, 0, 0), "loc": (0, 0.1, 0.06)}, "spine": (-14, 0, 0), "chest": (-14, 0, 0), "neck": (-6, 0, 0),
            "head": (-18, 0, 0), "upper_arm.R": (-165, 25, 0), "upper_arm.L": (-165, -25, 0), "forearm.R": (-40, 0, 0),
            "forearm.L": (-40, 0, 0), "jaw": (40, 0, 0)}
    crash = {"hips": {"rot": (14, 0, 0), "loc": (0, -0.12, -0.17)}, "spine": (20, 0, 0), "chest": (14, 0, 0), "neck": (-12, 0, 0),
             "head": (-8, 0, 0), "upper_arm.R": (-80, 10, 0), "upper_arm.L": (-80, -10, 0), "forearm.R": (-5, 0, 0),
             "forearm.L": (-5, 0, 0), "hand.R": (25, 0, 0), "hand.L": (25, 0, 0), "jaw": (25, 0, 0),
             "ik_foot.R": {"loc": (0, -0.2, 0)}}
    B.key("Attack2", [(0, {}), (5, A.scale(crash, 0.25)), (12, A.scale(rise, 0.8)), (17, rise), (21, crash),
                      (24, A.add(crash, {"hips": {"loc": (0, 0, -0.03)}})), (30, A.scale(crash, 0.5)), (36, {})])
    B.hit()
    B.death(frames=52, fall_x=82.0, lift=0.6, knee_drop=0.32)


def build(args, stage):
    mats = {
        "body": gmat.bog("BogBody", seed=3),
        "root": M.bark("BogRoot", kind="dead", color="#5d5345", color2="#2e271f", moss=0.45, seed=6),
        "moss": M.moss("BogMoss", color="#4a5a26", color2="#1f2610", seed=9),
        "eye": M.emissive("BogEye", color="#b8ff3a", strength=7.0),
        "claw": M.bone("BogClaw", color="#6b5a44", dirt=0.9),
    }
    base = body_meta(0.014).to_mesh("BogBase")
    gk.set_mat(base, mats["body"])
    extra = roots(base, mats["root"], mats["eye"], mats["claw"])
    if stage == "shape":
        hi = gk.sculpt_copy(base, LAYERS, subdiv=1, name="BogHigh")
        gk.clay_sheet([hi, extra], gk.wip_path(f"{KEY}_clay.png"))
        return {}
    high = gk.sculpt_copy(base, LAYERS, subdiv=1, name="_BogHigh")
    gn.edge_wear(high)
    gn.apply(high)
    body = gk.retopo(base, faces=2600, layers=LAYERS, max_scale=2.6, name="BogLurker")
    gk.set_mat(body, mats["body"])
    # hanging moss strands on the up-facing shoulders / back / head / forearms (GN scatter, droop = hanging)
    gk.vgroup_from(body, "top", lambda p, n: gk.smoothstep(0.15, 0.55, n.z) * gk.smoothstep(0.9, 1.2, p[2]))
    tpl = [gk.lock_mesh(f"_Strand{i}", length=l, width=w, thick=0.012, curl=c, seg=4, rings=4)
           for i, (l, w, c) in enumerate(((0.32, 0.06, 0.05), (0.45, 0.07, 0.08), (0.24, 0.05, 0.03)))]
    for t in tpl:
        gk.set_mat(t, mats["moss"])
    strands = gk.scatter_locks(body, tpl, density=22.0, mask="top", threshold=0.5, seed=5, scale=(0.7, 1.3),
                               droop=0.95, embed=0.015, name="BogMossStrands", distance_min=0.07)
    gk.set_mat(strands, mats["moss"])
    bpy.data.objects.remove(base, do_unlink=True)
    print(f"[bog] tris body={gk.tris(body)} strands={gk.tris(strands)} extra={gk.tris(extra)} high={gk.tris(high)}", flush=True)

    R = gk.Rigger(joints(), PARENTS, legs=LEGS, pole_dist=0.9)
    arm = R.arm
    src = gk.dup(body, "_BodySrc")
    rig.bind(body, arm, smooth=3)
    rig.bind(src, arm, smooth=3)
    rig.transfer_weights(src, extra, arm, smooth=3)
    rig.transfer_weights(src, strands, arm, smooth=2)
    bpy.data.objects.remove(src, do_unlink=True)
    clips(R)
    R.bake()
    meshes = [body, extra, strands]
    gk.ground_clamp(arm, meshes)
    if stage == "anim":
        gk.pose_sheet(KEY + "_anim", meshes, arm, gk.wip_path(""))
        return {}
    for o in (extra, strands):
        o["kit_bake_direct"] = 1
    bake.bake_asset(meshes, KEY, size=2048, high=high, extrusion=0.05, max_ray=0.12, ao_samples=48, samples=8)
    bpy.data.objects.remove(high, do_unlink=True)
    return gk.finish(KEY, args, arm, meshes, "beast", expected=(None, None, 2.0), hero=("Attack2", 17))
