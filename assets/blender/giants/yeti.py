"""Yeti (≈2.6 m): shaggy white-grey fur brute, gorilla build, dark blue-grey face / chest / hands / feet,
curled ram horns, fangs. Fur = GN-sculpted clumps on the body (baked) + Geometry-Nodes scattered fur locks."""
import math

import bpy
from mathutils import Vector

import banim as A
import gk
import gmat
from kit import bake, gn, materials as M, qa, rig

KEY = "yeti"

SH = (0.6, 0.02, 1.98)
EL = (0.86, 0.12, 1.42)
WR = (0.94, -0.1, 0.86)
HD = (0.97, -0.18, 0.56)
HIP = (0.3, 0.06, 1.02)
KN = (0.36, -0.12, 0.56)
AN = (0.36, 0.05, 0.12)
TO = (0.38, -0.3, 0.04)


def L(p, s=1):
    return (p[0] * s, p[1], p[2])


def joints():
    J = {
        "root": ((0, 0, 0), (0, 0, 0.3)),
        "hips": ((0, 0.06, 1.02), (0, 0.06, 1.3)),
        "spine": ((0, 0.06, 1.3), (0, 0.03, 1.62)),
        "chest": ((0, 0.03, 1.62), (0, -0.05, 2.05)),
        "neck": ((0, -0.08, 2.0), (0, -0.3, 2.12)),
        "head": ((0, -0.3, 2.12), (0, -0.45, 2.42)),
        "jaw": ((0, -0.38, 2.12), (0, -0.62, 2.0)),
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
    m = gk.Meta("YetiMB", res=res)
    m.ellipsoid((0, 0.06, 1.1), (0.38, 0.32, 0.28), stiff=3)                     # pelvis
    m.ellipsoid((0, -0.04, 1.38), (0.44, 0.38, 0.34), stiff=3)                   # belly
    m.ellipsoid((0, 0.0, 1.7), (0.56, 0.42, 0.4), rot=(-10, 0, 0), stiff=3)      # barrel chest
    m.ellipsoid((0, 0.16, 1.98), (0.5, 0.36, 0.3), rot=(-25, 0, 0), stiff=3)     # hunched upper back
    for s in (1, -1):
        m.ellipsoid((0.28 * s, 0.04, 2.08), (0.26, 0.28, 0.2), rot=(0, -20 * s, 0), stiff=3)     # traps
        m.ellipsoid((0.24 * s, -0.3, 1.78), (0.24, 0.14, 0.2), rot=(10, 0, 12 * s), stiff=4)    # pecs
    # head: low skull with a sagittal crest, heavy brow, protruding muzzle
    m.capsule((0, -0.06, 1.98), (0, -0.3, 2.12), 0.19)
    m.ellipsoid((0, -0.4, 2.26), (0.19, 0.2, 0.18), rot=(-10, 0, 0))
    m.ellipsoid((0, -0.3, 2.42), (0.06, 0.2, 0.08), rot=(-20, 0, 0), stiff=5)            # crest
    m.ellipsoid((0, -0.55, 2.3), (0.19, 0.07, 0.05), rot=(12, 0, 0), stiff=6)            # brow
    m.ellipsoid((0, -0.57, 2.14), (0.16, 0.14, 0.11), stiff=4)                           # muzzle
    m.ellipsoid((0, -0.52, 2.03), (0.15, 0.14, 0.07), rot=(12, 0, 0), stiff=4)           # lower jaw
    for s in (1, -1):
        m.ellipsoid((0.12 * s, -0.54, 2.2), (0.06, 0.05, 0.05), stiff=5)                # cheekbones

    def arm(s):
        sh, el, wr, hd = L(SH, s), L(EL, s), L(WR, s), L(HD, s)
        m.ball(sh, 0.26, stiff=3)
        m.limb([(sh, 0.21), (el, 0.16)])
        m.ellipsoid(Vector(sh).lerp(Vector(el), 0.45) + Vector((0, 0.04, 0)), (0.17, 0.18, 0.27), stiff=4)
        m.limb([(el, 0.17), (Vector(el).lerp(Vector(wr), 0.35), 0.2), (wr, 0.12)])
        w, h = Vector(wr), Vector(hd)
        m.ellipsoid(w.lerp(h, 0.4), (0.13, 0.17, 0.17), stiff=5)
        d = (h - w).normalized()
        for off in (-0.09, -0.03, 0.03, 0.09):
            base = w.lerp(h, 0.75) + Vector((0, -off, 0))
            tip = base + d * 0.2 + Vector((0, -off * 0.3 - 0.05, 0))
            m.limb([(base, 0.058), (tip, 0.046)], stiff=7)
        tb = w.lerp(h, 0.35) + Vector((0, -0.13, 0))
        m.limb([(tb, 0.055), (tb + Vector((-0.02 * s, -0.11, -0.12)), 0.044)], stiff=7)

    def leg(s):
        hp, kn, an = L(HIP, s), L(KN, s), L(AN, s)
        m.limb([(hp, 0.23), (kn, 0.17)])
        m.ellipsoid(Vector(hp).lerp(Vector(kn), 0.4), (0.19, 0.21, 0.26), stiff=4)
        m.limb([(kn, 0.16), (an, 0.11)])
        m.ellipsoid(Vector(kn).lerp(Vector(an), 0.3) + Vector((0, 0.06, 0)), (0.14, 0.14, 0.2), stiff=4)
        m.ellipsoid((an[0], an[1] - 0.12, 0.08), (0.14, 0.24, 0.08), stiff=5)
        for off in (-0.07, 0.0, 0.07):
            b = Vector((an[0] + off, an[1] - 0.27, 0.065))
            m.limb([(b, 0.045), (b + Vector((off * 0.3, -0.1, -0.015)), 0.038)], stiff=7)

    for s in (1, -1):
        arm(s)
        leg(s)
    return m


def skin_region(p, n):
    """1 = bare dark skin (face, chest patch, hands, soles), 0 = fur."""
    x, y, z = p
    face = gk.smoothstep(-0.44, -0.52, y) * gk.smoothstep(1.95, 2.02, z) * (1 - gk.smoothstep(2.3, 2.36, z)) * (1 - gk.smoothstep(0.17, 0.21, abs(x)))
    chest = gk.smoothstep(-0.3, -0.38, y) * gk.smoothstep(1.52, 1.6, z) * (1 - gk.smoothstep(1.86, 1.92, z)) * (1 - gk.smoothstep(0.26, 0.32, abs(x)))
    hand = 0.0
    for s in (1, -1):
        hand = max(hand, 1 - gk.smoothstep(0.16, 0.22, gk.seg_dist(p, Vector(L(WR, s)) + Vector((0, 0, -0.05)), Vector(L(HD, s)) + Vector((0, -0.05, -0.1)))))
    feet = 1 - gk.smoothstep(0.1, 0.16, z)
    return max(face, chest, hand, feet)


FUR_LAYERS = [
    {"type": "noise", "scale": 2.0, "amp": 0.02, "detail": 2},
    {"type": "noise", "scale": 7.0, "amp": 0.03, "detail": 3, "stretch": (1.5, 1.5, 0.35), "seed": 3, "mask": "fur",
     "store": "clump"},                                                                     # hanging fur clumps
    {"type": "ridges", "scale": 30.0, "amp": 0.006, "stretch": (1.2, 1.2, 0.25), "sharp": 2, "seed": 5, "mask": "fur"},
    {"type": "bumps", "scale": 22.0, "amp": 0.004, "size": 0.4, "density": 0.5, "seed": 7, "mask": "fur", "invert": True},
]


def horns_claws(bone_mat):
    parts = []
    for s in (1, -1):
        # ram horn: spiral out/back/down/forward from the temple
        c = Vector((0.16 * s, -0.36, 2.34))
        pts, rad = [], []
        for i in range(13):
            t = i / 12
            a = t * 4.2
            r = 0.2 * (1 - 0.3 * t)
            pts.append(c + Vector((s * (0.04 + 0.22 * t), r * math.sin(a) + 0.06, r * math.cos(a) - r)))
            rad.append(0.09 * (1 - t) ** 0.7 + 0.01)
        parts.append(gk.tube(pts, rad, seg=9, name="Horn"))
        for off in (-0.07, 0.0, 0.07):
            an = L(AN, s)
            b = Vector((an[0] + off, an[1] - 0.27, 0.065))
            tip = b + Vector((off * 0.3, -0.1, -0.015))
            parts.append(gk.spike(tip + Vector((0, 0.01, 0.005)), tip + Vector((off * 0.1, -0.07, -0.03)), 0.028, seg=6,
                                  rings=2, name="ToeClaw"))
        w, h = Vector(L(WR, s)), Vector(L(HD, s))
        d = (h - w).normalized()
        for off in (-0.09, -0.03, 0.03, 0.09):
            base = w.lerp(h, 0.75) + Vector((0, -off, 0))
            tip = base + d * 0.2 + Vector((0, -off * 0.3 - 0.05, 0))
            parts.append(gk.spike(tip - d * 0.01, tip + d * 0.08 + Vector((0, -0.025, 0)), 0.03, seg=6, rings=2,
                                  bend=(0, -0.012, 0), name="Claw"))
        # fangs
        parts.append(gk.spike((0.07 * s, -0.66, 2.1), (0.075 * s, -0.68, 2.0), 0.02, seg=6, rings=2, name="Fang"))
        parts.append(gk.spike((0.06 * s, -0.62, 2.03), (0.065 * s, -0.66, 2.1), 0.016, seg=6, rings=2, name="Fang2"))
    for o in parts:
        gk.set_mat(o, bone_mat)
    return gk.join(parts, "Horns")


def clips(R):
    stance = {"hips": {"rot": (6, 0, 0), "loc": (0, 0, -0.04)}, "spine": (6, 0, 0), "neck": (-6, 0, 0), "head": (-8, 0, 0),
              "upper_arm.L": (-8, -6, 0), "upper_arm.R": (-8, 6, 0), "forearm.L": (-20, 0, 0), "forearm.R": (-20, 0, 0),
              "hand.L": (-10, 0, 0), "hand.R": (-10, 0, 0)}
    B = A.Biped(R, dict(stance=stance, stride=0.7, lift=0.18, walk_frames=26, bob=0.05, sway=0.05, arm_swing=22,
                        lean=6, run_stride=1.1, run_lift=0.3, run_frames=16, run_lean=20, run_bob=0.09, heavy=0.6,
                        jaw=True))
    B.idle(frames=60)
    B.walk()
    B.run()
    # Attack: right claw swipe across (0.9 s)
    wind = {"hips": {"rot": (-2, 0, -14), "loc": (0, 0.05, -0.02)}, "spine": (-4, 0, -14), "chest": (-6, -4, -20),
            "head": (-8, 0, 16), "upper_arm.R": (-95, 60, 0), "forearm.R": (-50, 0, 0), "hand.R": (-25, 0, 0),
            "upper_arm.L": (-25, -15, 0), "forearm.L": (-35, 0, 0), "jaw": (18, 0, 0),
            "ik_foot.R": {"loc": (0, -0.1, 0.12)}}
    swipe = {"hips": {"rot": (8, 0, 14), "loc": (0, -0.12, -0.1)}, "spine": (14, 0, 14), "chest": (10, 4, 26),
             "head": (-6, 0, -12), "upper_arm.R": (-70, -30, 0), "forearm.R": (-20, 0, 0), "hand.R": (15, 0, 0),
             "upper_arm.L": (10, -20, 0), "forearm.L": (-25, 0, 0), "jaw": (26, 0, 0),
             "ik_foot.R": {"loc": (0, -0.3, 0)}}
    follow = A.add(swipe, {"chest": (4, 0, 10), "upper_arm.R": (20, -15, 0)})
    B.key("Attack", [(0, {}), (4, A.scale(wind, 0.5)), (9, wind), (12, swipe), (15, follow), (22, {})])
    # Attack2: roar with fists overhead, then a two-fist ground pound (0.7 s wind-up, 1.5 s)
    rear = {"hips": {"rot": (-10, 0, 0), "loc": (0, 0.1, 0.06)}, "spine": (-12, 0, 0), "chest": (-16, 0, 0), "neck": (-8, 0, 0),
            "head": (-20, 0, 0), "upper_arm.R": (-160, 25, 0), "upper_arm.L": (-160, -25, 0), "forearm.R": (-50, 0, 0),
            "forearm.L": (-50, 0, 0), "hand.R": (-20, 0, 0), "hand.L": (-20, 0, 0), "jaw": (35, 0, 0)}
    pound = {"hips": {"rot": (14, 0, 0), "loc": (0, -0.16, -0.22)}, "spine": (22, 0, 0), "chest": (16, 0, 0),
             "neck": (-12, 0, 0), "head": (-12, 0, 0), "upper_arm.R": (-72, 8, 0), "upper_arm.L": (-72, -8, 0),
             "forearm.R": (-10, 0, 0), "forearm.L": (-10, 0, 0), "hand.R": (20, 0, 0), "hand.L": (20, 0, 0),
             "jaw": (22, 0, 0), "ik_foot.R": {"loc": (0, -0.25, 0)}}
    B.key("Attack2", [(0, {}), (5, A.scale(pound, 0.25)), (12, A.scale(rear, 0.8)), (17, rear), (21, pound),
                      (24, A.add(pound, {"hips": {"loc": (0, 0, -0.03)}, "spine": (3, 0, 0)})), (30, A.scale(pound, 0.5)),
                      (36, {})])
    B.hit()
    B.death(frames=52, fall_x=82.0, lift=0.5)


def build(args, stage):
    mats = {
        "fur": gmat.fur("YetiFur", root="#4a4b4f", mid="#b9bcc0", tip="#e9ebee", dirt_col="#6b6457", seed=2),
        "skin": gmat.hide("YetiSkin", c1="#46505c", c2="#262b33", belly="#5d6773", wart="#59636f", seed=5,
                          back_dark=0.2, veins=0.15),
        "horn": M.bone("YetiHorn", color="#a89a84", dirt=0.9),
    }
    base = body_meta(0.016).to_mesh("YetiBase")
    gk.vgroup_from(base, "fur", lambda p, n: 1.0 - skin_region(p, n), smooth_iters=2)
    if stage == "shape":
        hi = gk.sculpt_copy(base, FUR_LAYERS, subdiv=1, name="YetiHigh")
        gk.clay_sheet([hi, horns_claws(mats["horn"])], gk.wip_path(f"{KEY}_clay.png"))
        return {}
    base.data.materials.append(mats["fur"])
    base.data.materials.append(mats["skin"])
    high = gk.sculpt_copy(base, FUR_LAYERS, subdiv=1, name="_YetiHigh")
    gk.assign_material(high, lambda p, n: 1 if skin_region(p, n) > 0.5 else 0)
    gn.edge_wear(high)
    gn.apply(high)
    body = gk.retopo(base, faces=3000, layers=FUR_LAYERS[:1], name="Yeti")
    body.data.materials.clear()
    body.data.materials.append(mats["fur"])
    body.data.materials.append(mats["skin"])
    gk.assign_material(body, lambda p, n: 1 if skin_region(p, n) > 0.5 else 0)
    gk.vgroup_from(body, "fur", lambda p, n: (1.0 - skin_region(p, n)) * (0.0 if p[2] < 0.3 else 1.0))
    # fur locks: GN scatter of 3 lock variants, hanging down
    tpl = [gk.lock_mesh(f"_Lock{i}", length=l, width=w, thick=0.03, curl=c, seg=4, rings=4)
           for i, (l, w, c) in enumerate(((0.26, 0.1, 0.1), (0.34, 0.12, 0.14), (0.2, 0.085, 0.06)))]
    for t in tpl:
        gk.set_mat(t, mats["fur"])
    locks = gk.scatter_locks(body, tpl, density=26.0, mask="fur", threshold=0.7, seed=11, scale=(0.75, 1.25),
                             droop=0.7, embed=0.03, name="YetiLocks", distance_min=0.1)
    gk.set_mat(locks, mats["fur"])
    horns = horns_claws(mats["horn"])
    bpy.data.objects.remove(base, do_unlink=True)
    print(f"[yeti] tris body={gk.tris(body)} locks={gk.tris(locks)} horns={gk.tris(horns)} high={gk.tris(high)}", flush=True)

    R = gk.Rigger(joints(), PARENTS, legs=LEGS, pole_dist=1.0)
    arm = R.arm
    src = gk.dup(body, "_BodySrc")
    rig.bind(body, arm, smooth=3)
    rig.bind(src, arm, smooth=3)
    rig.transfer_weights(src, horns, arm, smooth=1)
    rig.transfer_weights(src, locks, arm, smooth=2)
    bpy.data.objects.remove(src, do_unlink=True)
    clips(R)
    R.bake()
    meshes = [body, locks, horns]
    gk.ground_clamp(arm, meshes)
    if stage == "anim":
        gk.pose_sheet(KEY + "_anim", meshes, arm, gk.wip_path(""))
        return {}
    for o in (locks, horns):
        o["kit_bake_direct"] = 1
    high.hide_render = False
    bake.bake_asset(meshes, KEY, size=2048, high=high, extrusion=0.06, max_ray=0.14, ao_samples=48, samples=8)
    bpy.data.objects.remove(high, do_unlink=True)
    return gk.finish(KEY, args, arm, meshes, "beast", expected=(None, None, 2.55), hero=("Attack2", 17))
