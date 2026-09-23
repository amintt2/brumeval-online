"""Giant scorpion ("Scorpion des dunes"): ~2 m from pincers to telson, tail arched over the back (~1.2 m high).
Faces -Y.

One continuous skin-modifier body: carapace, 7 tergites (plated), segmented 5-part tail + telson bulb, two
pedipalps with heavy pincers (fixed finger + movable finger branch) and 8 walking legs; embedded curved stinger,
eyes; chitin shader (plates / joint grooves from the 'seg' attribute, pitting, worn lighter rims) baked.

Rig: root, body, prosoma, abdomen, tail_1..tail_5, telson, claw_upper/lower/hand/finger .L/.R,
leg1..4 _femur/_tibia/_tarsus .L/.R.
Clips: Idle, Walk, Run, Attack (pincer lunge + snap), Attack2 (overhead tail slam), Shoot (venom spit: tail cocks
and flicks forward), Hit, Death.
"""
import math

import numpy as np
from mathutils import Vector

import arthropod as AR
import body as B
import cmat
import quadruped as Q
import rigkit as R
from kit import gn, materials as M
from rigkit import Track, ease_in, ease_out, smooth

HERO = ("Idle", 10)
BUDGET = "beast"

BODY_Z = 0.37
LEGS = [  # (index, attach y, angle, reach, knee h, ankle h)
    (1, -0.3, -38, 0.6, 0.44, 0.17),
    (2, -0.17, -12, 0.62, 0.45, 0.17),
    (3, -0.04, 14, 0.63, 0.44, 0.17),
    (4, 0.09, 38, 0.66, 0.45, 0.17),
]
# tail joints (armature space): base -> telson, arched forward over the back
TAIL = [(0, 0.66, 0.42), (0, 0.82, 0.58), (0, 0.9, 0.79), (0, 0.87, 0.99), (0, 0.76, 1.13), (0, 0.61, 1.2)]
TELSON = [(0, 0.61, 1.2), (0, 0.49, 1.19)]
TAIL_R = [0.115, 0.108, 0.1, 0.095, 0.09, 0.085]


def leg_geo():
    out = {}
    for i, ay, ang, reach, kh, ah in LEGS:
        for side, sfx in ((1, ".L"), (-1, ".R")):
            out[(i, sfx)] = AR.leg_points((0, ay, BODY_Z), side, ang, reach, kh, ah, coxa=0.16, knee_r=0.45,
                                          ankle_r=0.85, z0=BODY_Z - 0.03)
    return out


def claw_geo(sx):
    return {"coxa": Vector((0.12 * sx, -0.45, 0.33)), "elbow": Vector((0.36 * sx, -0.58, 0.38)),
            "wrist": Vector((0.34 * sx, -0.8, 0.37)), "hand": Vector((0.32 * sx, -0.99, 0.36)),
            "tip": Vector((0.26 * sx, -1.24, 0.34)), "fing0": Vector((0.39 * sx, -1.07, 0.36)),
            "fing": Vector((0.32 * sx, -1.25, 0.345))}


def skeleton(sk):
    plated = set()
    front = sk.p((0, -0.5, 0.35), (0.13, 0.08))
    pro = sk.chain(front, [((0, -0.37, 0.37), (0.2, 0.11)), ((0, -0.22, 0.375), (0.23, 0.115))])
    # tergites: alternate joint / plate radii
    prev = pro[-1]
    att = {}
    y = -0.12
    for k in range(7):
        e0 = len(sk.edges)
        j = sk.p((0, y, 0.375 + 0.005 * k), (0.25 - 0.006 * k, 0.11))
        sk.e(prev, j)
        m = sk.p((0, y + 0.05, 0.385 + 0.005 * k), (0.28 - 0.016 * k, 0.125))
        sk.e(j, m)
        plated.update(range(e0, len(sk.edges)))
        prev = m
        y += 0.1
        att[k] = j
    # tail segments (joint -> mid -> joint ...)
    e0 = len(sk.edges)
    j = sk.p(TAIL[0], (TAIL_R[0] * 0.9, TAIL_R[0] * 0.8))
    sk.e(prev, j)
    for k in range(5):
        a, b = Vector(TAIL[k]), Vector(TAIL[k + 1])
        m = sk.p(tuple(a.lerp(b, 0.5)), (TAIL_R[k], TAIL_R[k] * 0.95))
        sk.e(j, m)
        j2 = sk.p(tuple(b), (TAIL_R[k + 1] * 0.72, TAIL_R[k + 1] * 0.7))
        sk.e(m, j2)
        j = j2
    tel = sk.chain(j, [((0, 0.56, 1.22), (0.12, 0.11)), ((0, 0.49, 1.2), (0.07, 0.065))])
    plated.update(range(e0, len(sk.edges)))
    # legs: attach on the carapace / first tergites
    ce = {1: pro[0], 2: pro[1], 3: att[0], 4: att[1]}
    for (i, sfx), g in leg_geo().items():
        e0 = len(sk.edges)
        sk.chain(ce[i], [(tuple(g["coxa"]), (0.058, 0.052)),
                         (tuple(g["coxa"].lerp(g["knee"], 0.5)), (0.05, 0.046)),
                         (tuple(g["knee"]), (0.04, 0.04)),
                         (tuple(g["knee"].lerp(g["ankle"], 0.5)), (0.034, 0.034)),
                         (tuple(g["ankle"]), (0.026, 0.026)),
                         (tuple(g["ankle"].lerp(g["tip"], 0.6)), (0.018, 0.018)),
                         (tuple(g["tip"] + Vector((0, 0, 0.01))), (0.008, 0.008))])
        plated.update(range(e0 + 1, len(sk.edges)))
    # pedipalps with pincers
    for sx in (1, -1):
        c = claw_geo(sx)
        e0 = len(sk.edges)
        hand = sk.chain(pro[0], [(tuple(c["coxa"]), (0.065, 0.055)), (tuple(c["elbow"]), (0.062, 0.056)),
                                 (tuple(c["elbow"].lerp(c["wrist"], 0.5)), (0.07, 0.062)), (tuple(c["wrist"]), (0.06, 0.055)),
                                 (tuple(c["wrist"].lerp(c["hand"], 0.5)), (0.12, 0.085)),
                                 (tuple(c["hand"]), (0.155, 0.105))])[-1]
        sk.chain(hand, [(tuple(c["hand"].lerp(c["tip"], 0.4)), (0.07, 0.058)), (tuple(c["hand"].lerp(c["tip"], 0.75)), (0.045, 0.04)),
                        (tuple(c["tip"]), (0.012, 0.012))])
        sk.chain(hand, [(tuple(c["fing0"]), (0.062, 0.055)), (tuple(c["fing0"].lerp(c["fing"], 0.5)), (0.045, 0.04)),
                        (tuple(c["fing"]), (0.01, 0.01))])
        plated.update(range(e0 + 1, len(sk.edges)))
    sk._plated = plated
    return sk


def bones():
    bl = [("root", (0, 0, 0), (0, -0.3, 0), None),
          ("body", (0, -0.15, BODY_Z), (0, -0.15, BODY_Z + 0.12), "root"),
          ("prosoma", (0, -0.1, BODY_Z), (0, -0.5, 0.35), "body"),
          ("abdomen", (0, -0.1, BODY_Z), (0, TAIL[0][1], TAIL[0][2]), "body")]
    prev = "abdomen"
    for k in range(5):
        bl.append((f"tail_{k + 1}", TAIL[k], TAIL[k + 1], prev))
        prev = f"tail_{k + 1}"
    bl.append(("telson", TELSON[0], TELSON[1], prev))
    for sx, sfx in ((1, ".L"), (-1, ".R")):
        c = claw_geo(sx)
        bl += [(f"claw_upper{sfx}", tuple(c["coxa"]), tuple(c["elbow"]), "prosoma"),
               (f"claw_lower{sfx}", tuple(c["elbow"]), tuple(c["wrist"]), f"claw_upper{sfx}"),
               (f"claw_hand{sfx}", tuple(c["wrist"]), tuple(c["tip"]), f"claw_lower{sfx}"),
               (f"claw_finger{sfx}", tuple(c["fing0"]), tuple(c["fing"]), f"claw_hand{sfx}")]
    for (i, sfx), g in leg_geo().items():
        par = "prosoma" if i <= 2 else "abdomen"
        bl += [(f"leg{i}_femur{sfx}", tuple(g["coxa"]), tuple(g["knee"]), par),
               (f"leg{i}_tibia{sfx}", tuple(g["knee"]), tuple(g["ankle"]), f"leg{i}_femur{sfx}"),
               (f"leg{i}_tarsus{sfx}", tuple(g["ankle"]), tuple(g["tip"]), f"leg{i}_tibia{sfx}")]
    return bl


def attributes(body, skel):
    co, nr = B.co_array(body), B.normal_array(body)
    AR.seg_attribute(body, skel, skel._plated)
    B.set_attr(body, "tone", np.zeros(len(co)))
    B.flow_field(body, [((0, -0.5, 0.35), (0, 0.6, 0.4), (0, 1, 0))], down=0.0)


def finger_weights(body, arm):
    """Movable finger branch -> claw_finger only (the heat weights can bleed into the fixed finger)."""
    names = [b.name for b in arm.data.bones if b.use_deform]
    from kit import rig as KR
    W = KR.weights_array(body, names)
    co = B.co_array(body)
    for sx, sfx in ((1, ".L"), (-1, ".R")):
        c = claw_geo(sx)
        dF, tF = B.seg_dist(co, c["fing0"], c["fing"])
        dT, tT = B.seg_dist(co, c["hand"].lerp(c["tip"], 0.3), c["tip"])
        m = (dF < dT) & (dF < 0.05) & (tF > 0.05)
        fi, hi = names.index(f"claw_finger{sfx}"), names.index(f"claw_hand{sfx}")
        W[m] = 0
        W[m, fi] = 1.0
        mt = (dT <= dF) & (dT < 0.06) & (tT > 0.05)
        W[mt] = 0
        W[mt, hi] = 1.0
    KR.set_weights(body, names, W)
    KR.smooth_weights(body, names, 1, 0.3)


def tail_pose(pose, angles, telson=0.0):
    for k, a in enumerate(angles):
        pose[f"tail_{k + 1}"] = {"r": (a, 0, 0)}
    pose["telson"] = {"r": (telson, 0, 0)}
    return pose


def attacks(A, legs, arm):
    # Attack 0.625 s: both pincers open, lunge forward, snap shut
    lung = Track([(0, 0), (0.3, 0.05), (0.5, -0.14, ease_out), (0.7, -0.1), (1, 0)])
    arm_f = Track([(0, 0), (0.3, 1.0), (0.5, -1.0, ease_out), (0.7, -0.6), (1, 0)])
    op = Track([(0, 0), (0.25, 1), (0.48, 1), (0.54, -0.1, ease_in), (0.7, 0), (1, 0)])

    def claws(pose, fwd, openv, lift=0.0):
        for sx, s in ((1, ".L"), (-1, ".R")):
            pose["claw_upper" + s] = {"r": (8 * lift, 0, sx * (-18 * fwd))}
            pose["claw_lower" + s] = {"r": (0, 0, sx * (22 * fwd))}
            pose["claw_hand" + s] = {"r": (-6 * lift, 0, sx * (-6 * fwd))}
            pose["claw_finger" + s] = {"r": (0, 0, sx * 28 * openv)}

    def attack(t):
        pose = {"body": {"t": (0, lung(t), 0.02 * arm_f(t)), "r": (-3 * arm_f(t), 0, 0)}}
        claws(pose, arm_f(t), op(t), lift=max(0.0, arm_f(t)))
        tail_pose(pose, [4 * arm_f(t), 4 * arm_f(t), 3 * arm_f(t), 0, 0], 0)
        return legs(pose)
    A.clip("Attack", 15, attack)

    # Attack2 1.5 s: overhead tail slam — tail rears back high (0.75 s telegraph), whips over and slams the
    # ground in front, holds, recovers
    k = Track([(0, 0), (0.45, -1.0), (0.52, -1.05), (0.6, 1.0, ease_in), (0.7, 1.0), (0.78, 0.9), (1, 0)])
    bp = Track([(0, 0), (0.45, -6), (0.6, 10, ease_in), (0.7, 9), (1, 0)])
    bz = Track([(0, 0), (0.45, 0.06), (0.6, -0.06), (0.7, -0.05), (1, 0)])

    def attack2(t):
        v = k(t)
        back = min(0.0, v)
        fwd = max(0.0, v)
        # rear back: straighten + tilt the tail backwards; slam: curl forward and down past the head
        b = -back
        ang = [-25 * b + 72 * fwd, -10 * b - 8 * fwd, -4 * b - 18 * fwd, 10 * b - 22 * fwd, 16 * b - 16 * fwd]
        pose = {"body": {"t": (0, -0.05 * fwd, bz(t)), "r": (bp(t), 0, 0)}}
        tail_pose(pose, ang, 20 * b + 30 * fwd)
        claws(pose, 0.3 * back, 0.6 * b)
        return legs(pose)
    A.clip("Attack2", 36, attack2)

    # Shoot 0.83 s: venom spit — tail cocks back, telson swells, flicks forward (spray), settles
    ck = Track([(0, 0), (0.4, -1.0), (0.55, 0.8, ease_out), (0.7, 0.5), (1, 0)])
    sw = Track([(0, 1.0), (0.35, 1.25), (0.5, 1.3), (0.58, 0.9), (0.75, 1.0), (1, 1.0)])

    def shoot(t):
        v = ck(t)
        pose = {"body": {"t": (0, 0.03 * min(0.0, -v), 0), "r": (-2 * v, 0, 0)}}
        tail_pose(pose, [-10 * v * -1 if v < 0 else 8 * v, -12 * min(v, 0) * -1 + 10 * max(v, 0), 14 * v, 16 * v, 10 * v],
                  30 * v)
        pose["telson"]["s"] = (sw(t), sw(t), sw(t))
        claws(pose, -0.2 * abs(v), 0.3)
        return legs(pose)
    A.clip("Shoot", 20, shoot)


def build():
    sk = skeleton(B.Skel())
    body = sk.mesh("Body", subsurf=1)
    B.sculpt(body, lambda co, nr: Q.blobs(co, nr, [((0.1, -0.35, 0.47), 0.06, 0.01), ((0, -0.46, 0.42), 0.05, 0.012)]))
    gn.displace(body, strength=0.003, scale=14.0, detail=2.0, voronoi=0.0, seed=12)
    gn.apply(body)
    arm = R.build_armature(bones())
    for n in ("root", "body"):
        arm.data.bones[n].use_deform = False
    attributes(body, sk)
    mats = {
        "chitin": cmat.chitin("Chitin_scorpion", color="#4a2c18", dark="#140b06", edge="#a8753c", rough=0.35, seed=7,
                              pits=1.2, bands=1.0),
        "sting": cmat.keratin("Sting_scorpion", color="#1a120c", tip="#c9a86a", axis="Y", rough=0.25),
        "eye": cmat.eye("Eye_scorpion", iris="#1b1712", glow=0.0, iris_size=-0.5, pupil_size=1.5),
        "venom": M.emissive("Venom_scorpion", color="#a6e04a", strength=3.0),
    }
    B.set_mat(body, mats["chitin"])
    B.bind(body, arm, smooth=2)
    finger_weights(body, arm)
    parts = []
    st = B.horn("Stinger", [(0, 0.48, 1.19), (0, 0.39, 1.16), (0, 0.34, 1.07), (0, 0.355, 0.99)], 0.04, mats["sting"],
                taper=((0, 1.0), (1, 0.03)), res=8)
    B.rigid(st, "telson")
    drop = B.sphere("VenomDrop", (0, 0.357, 0.99), 0.011, mats["venom"], seg=8, rings=6)
    B.rigid(drop, "telson")
    parts += [st, drop]
    for sx in (1, -1):
        for j, (ex, ey, ez, er) in enumerate([(0.025, -0.38, 0.49, 0.016), (0.1, -0.47, 0.425, 0.01), (0.115, -0.45, 0.42, 0.008)]):
            e = B.eye(f"Eye{sx}{j}", (ex * sx, ey, ez), er, mats["eye"], look=(0.5 * sx, -1, 0.5), seg=10, rings=6)
            B.rigid(e, "prosoma")
            parts.append(e)
    B.join_into(body, parts)
    A = R.Animator(arm)
    legmap = {f"{i}{s[1]}": (f"leg{i}_femur{s}", f"leg{i}_tibia{s}", f"leg{i}_tarsus{s}", (0, 0, 1))
              for i in range(1, 5) for s in (".L", ".R")}
    legs = AR.LegSet(A, arm, legmap)
    ph = {"1L": 0.0, "2R": 0.08, "3L": 0.12, "4R": 0.2, "1R": 0.5, "2L": 0.58, "3R": 0.62, "4L": 0.7}

    def claws_idle(pose, t):
        for sx, s in ((1, ".L"), (-1, ".R")):
            pose["claw_upper" + s] = {"r": (3 * R.wave(t, 1, 0.1 if sx > 0 else 0.4), 0, 0)}
            pose["claw_finger" + s] = {"r": (0, 0, sx * 12 * max(0.0, R.wave(t, 2, 0.2 if sx > 0 else 0.6)))}
        tail_pose(pose, [2 * R.wave(t, 1), 3 * R.wave(t, 1, 0.1), 3 * R.wave(t, 1, 0.2), 2 * R.wave(t, 1, 0.3), 2 * R.wave(t, 1, 0.4)],
                  6 * R.wave(t, 1, 0.5))

    def move_extra(pose, t, sp):
        for sx, s in ((1, ".L"), (-1, ".R")):
            pose["claw_upper" + s] = {"r": (4 * sp * R.wave(t, 1, 0.25 if sx > 0 else 0.75), 0, 0)}
        tail_pose(pose, [3 * sp * R.wave(t, 2, 0.1 * i) for i in range(5)], 4 * R.wave(t, 2))

    def death_extra(pose, t, c):
        tail_pose(pose, [-8 * c, -6 * c, -4 * c, -2 * c, 0.0], -6 * c)
        for sx, s in ((1, ".L"), (-1, ".R")):
            pose["claw_upper" + s] = {"r": (-12 * c, 0, sx * 10 * c)}
            pose["claw_finger" + s] = {"r": (0, 0, sx * 20 * c)}

    spec = {"phases": ph, "abdomen": "abdomen", "idle_tap": "2L", "idle_extra": claws_idle, "move_extra": move_extra,
            "death_extra": death_extra,
            "walk": {"frames": 20, "stride": 0.08, "lift": 0.07, "bob": 0.006, "duty": 0.6},
            "run": {"frames": 12, "stride": 0.15, "lift": 0.1, "bob": 0.012, "duty": 0.5, "drop": 0.03},
            "death": {"drop": 0.22, "splay": 0.08, "ankle_z": 0.04, "tip_up": 10, "pitch": 2, "roll": 4}}
    AR.common_clips(A, legs, spec)
    attacks(A, legs, arm)
    A.rest_pose()
    return {"arm": arm, "meshes": [body], "body": body, "expected": (None, 1.9, 1.3),
            "head_center": (0, -0.75, 0.4), "head_extent": 0.45}
