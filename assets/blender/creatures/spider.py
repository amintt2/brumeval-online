"""Giant forest spider ("Araignée sylvestre"): ~2.3 m leg span, ~1.5 m long, knees ~0.95 m high. Faces -Y.

One continuous skin-modifier body: cephalothorax, pedicel, bulbous abdomen with spinnerets, 8 legs
(femur / tibia / tarsus, banded at the joints), two chelicerae and pedipalps; embedded curved fangs, 8 glossy eyes
(faint red glow), GN-scattered bristle cards on legs and abdomen. Hairy chitin shader with pale abdomen chevron
markings ('mark' attribute) and banded joints ('seg' attribute), baked.

Rig: root, body, ceph, abdomen, chel.L/R, palp.L/R, leg1..4 _femur/_tibia/_tarsus .L/.R.
Clips: Idle, Walk (alternating tetrapod), Run, Attack (lunge + fang strike), Attack2 (rear up, double strike),
Hit, Death (drops, legs curl in).
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
from kit import rig as KR
from rigkit import Track, ease_in, ease_out, smooth

HERO = ("Walk", 4)
BUDGET = "beast"

CEPH_Z = 0.5
LEGS = [  # (index, attach y, angle deg, reach, knee height, ankle height)
    (1, -0.36, -52, 1.12, 0.98, 0.5),
    (2, -0.26, -20, 1.05, 0.95, 0.46),
    (3, -0.16, 16, 1.0, 0.9, 0.44),
    (4, -0.06, 46, 1.12, 0.92, 0.46),
]


def leg_geo():
    out = {}
    for i, ay, ang, reach, kh, ah in LEGS:
        for side, sfx in ((1, ".L"), (-1, ".R")):
            out[(i, sfx)] = AR.leg_points((0, ay, CEPH_Z), side, ang, reach, kh, ah, coxa=0.13, knee_r=0.42,
                                          ankle_r=0.86, z0=CEPH_Z)
    return out


def skeleton(sk):
    G = leg_geo()
    plated = set()
    # cephalothorax (one node per leg pair), head, pedicel, abdomen, spinnerets
    head = sk.p((0, -0.47, 0.49), (0.11, 0.09))
    ce = {}
    prev = head
    for i, ay, *_ in LEGS:
        n = sk.p((0, ay, CEPH_Z + 0.01 * (i - 2)), (0.17 - 0.012 * abs(i - 2.5), 0.12))
        sk.e(prev, n)
        ce[i] = n
        prev = n
    ped = sk.p((0, 0.04, 0.5), (0.06, 0.055))
    sk.e(prev, ped)
    abd = sk.chain(ped, [((0, 0.18, 0.56), (0.2, 0.19)), ((0, 0.4, 0.64), (0.3, 0.28)), ((0, 0.66, 0.62), (0.29, 0.27)),
                         ((0, 0.86, 0.52), (0.17, 0.16)), ((0, 0.96, 0.44), (0.06, 0.05))])
    # legs
    for (i, sfx), g in G.items():
        e0 = len(sk.edges)
        sk.chain(ce[i], [(tuple(g["coxa"]), (0.065, 0.065)),
                         (tuple(g["coxa"].lerp(g["knee"], 0.5)), (0.055, 0.058)),
                         (tuple(g["knee"]), (0.042, 0.042)),
                         (tuple(g["knee"].lerp(g["ankle"], 0.5)), (0.034, 0.034)),
                         (tuple(g["ankle"]), (0.028, 0.028)),
                         (tuple(g["ankle"].lerp(g["tip"], 0.6)), (0.02, 0.02)),
                         (tuple(g["tip"] + Vector((0, 0, 0.012))), (0.01, 0.01))])
        plated.update(range(e0 + 1, len(sk.edges)))
    # chelicerae (hang down in front) + pedipalps
    for sx in (1, -1):
        sk.chain(head, [((0.045 * sx, -0.55, 0.45), (0.045, 0.05)), ((0.042 * sx, -0.6, 0.37), (0.035, 0.035)),
                        ((0.04 * sx, -0.61, 0.32), (0.022, 0.022))])
        e0 = len(sk.edges)
        sk.chain(head, [((0.085 * sx, -0.54, 0.44), (0.028, 0.028)), ((0.15 * sx, -0.66, 0.4), (0.025, 0.025)),
                        ((0.15 * sx, -0.74, 0.28), (0.021, 0.021)), ((0.13 * sx, -0.76, 0.2), (0.016, 0.016))])
        plated.update(range(e0 + 1, len(sk.edges)))
    sk._plated = plated
    return sk


def bones():
    G = leg_geo()
    bl = [
        ("root", (0, 0, 0), (0, -0.3, 0), None),
        ("body", (0, -0.2, 0.5), (0, -0.2, 0.62), "root"),
        ("ceph", (0, 0.02, 0.5), (0, -0.5, 0.49), "body"),
        ("abdomen", (0, 0.04, 0.5), (0, 0.95, 0.46), "body"),
    ]
    for sx, sfx in ((1, ".L"), (-1, ".R")):
        bl += [(f"chel{sfx}", (0.045 * sx, -0.52, 0.47), (0.04 * sx, -0.61, 0.32), "ceph"),
               (f"palp{sfx}", (0.085 * sx, -0.54, 0.44), (0.15 * sx, -0.74, 0.28), "ceph")]
    for (i, sfx), g in G.items():
        bl += [(f"leg{i}_femur{sfx}", tuple(g["coxa"]), tuple(g["knee"]), "ceph"),
               (f"leg{i}_tibia{sfx}", tuple(g["knee"]), tuple(g["ankle"]), f"leg{i}_femur{sfx}"),
               (f"leg{i}_tarsus{sfx}", tuple(g["ankle"]), tuple(g["tip"]), f"leg{i}_tibia{sfx}")]
    return bl


def attributes(body, skel):
    co, nr = B.co_array(body), B.normal_array(body)
    x, y, z = co[:, 0], co[:, 1], co[:, 2]
    ss = Q.smoothstep
    seg = AR.seg_attribute(body, skel, skel._plated)
    G = leg_geo()
    segs = [((0, -0.5, 0.5), (0, 0.0, 0.5), (0, 1, 0)), ((0, 0.05, 0.5), (0, 0.95, 0.5), (0, 1, -0.3))]
    for g in G.values():
        segs += [(tuple(g["coxa"]), tuple(g["knee"]), tuple(g["knee"] - g["coxa"])),
                 (tuple(g["knee"]), tuple(g["ankle"]), tuple(g["ankle"] - g["knee"])),
                 (tuple(g["ankle"]), tuple(g["tip"]), tuple(g["tip"] - g["ankle"]))]
    B.flow_field(body, segs, down=0.0, power=6.0)
    abd = ss(y, 0.08, 0.2)
    top = ss(nr[:, 2], -0.1, 0.5)
    B.set_attr(body, "mark", np.zeros(len(co)))   # pattern drawn in the shader (cmat.spider_marks)
    # tone: dark body, pale bands mid-segment on the legs (joints stay dark), darker underside
    tone = np.full(len(co), -0.75)
    legs = ss(np.hypot(x, 0), 0.22, 0.32)
    joint = 1 - ss(np.abs(seg * 2 - 1), 0.55, 0.8)
    tone = np.where(legs > 0.5, -0.5 + 0.9 * joint, tone)
    tone -= 0.2 * ss(-nr[:, 2], 0.3, 0.8)
    B.set_attr(body, "tone", np.clip(tone, -1, 1))
    # bristle cards: legs (femur/tibia), abdomen (sparser, longer on the sides), none on the tarsus tips / face
    mask = np.zeros(len(co))
    ln = np.full(len(co), 0.06)
    legm = legs * ss(z, 0.2, 0.35) * 0.9
    mask = np.maximum(mask, legm)
    abm = abd * 0.55
    ln = np.where(abm > mask, 0.075, ln)
    mask = np.maximum(mask, abm)
    mask *= 1 - ss(-y, 0.42, 0.5) * (1 - ss(np.abs(x), 0.2, 0.3))
    B.set_attr(body, "furmask", mask)
    B.set_attr(body, "furlen", ln)


def attacks(A, legs, arm):
    front = ("1L", "1R", "2L", "2R")
    # Attack 0.625 s: rock back, lunge, fangs strike down
    by = Track([(0, 0), (0.3, 0.06), (0.5, -0.2, ease_out), (0.7, -0.16), (1, 0)])
    bz = Track([(0, 0), (0.3, 0.05), (0.5, -0.1), (0.7, -0.06), (1, 0)])
    bp = Track([(0, 0), (0.3, -12), (0.5, 14, ease_out), (0.7, 8), (1, 0)])
    ch = Track([(0, 0), (0.3, -35), (0.48, 30, ease_out), (0.62, 10), (1, 0)])
    lr = Track([(0, 0), (0.25, 0.1), (0.5, -0.12), (0.7, -0.08), (1, 0)])

    def attack(t):
        pose = {"body": {"t": (0, by(t), bz(t)), "r": (bp(t), 0, 0)}, "abdomen": {"r": (-bp(t) * 0.6, 0, 0)}}
        for s in (".L", ".R"):
            pose["chel" + s] = {"r": (ch(t), 0, 0)}
            pose["palp" + s] = {"r": (-ch(t) * 0.7, 0, 0)}
        offs = {"1L": (0, lr(t), max(0.0, lr(t)) * 1.2), "1R": (0, lr(t), max(0.0, lr(t)) * 1.2)}
        return legs(pose, offs)
    A.clip("Attack", 15, attack)

    # Attack2 1.4 s: rear up, front legs raised high (0.7 s telegraph), then two slamming strikes
    pitch = Track([(0, 0), (0.45, -40), (0.52, -42), (0.6, 8, ease_in), (0.68, -12), (0.76, 10, ease_in), (0.88, 2), (1, 0)])
    rise = Track([(0, 0), (0.45, 0.19), (0.52, 0.2), (0.6, -0.06, ease_in), (0.68, 0.05), (0.76, -0.07, ease_in), (0.88, -0.01), (1, 0)])
    lift = Track([(0, 0), (0.45, 1), (0.52, 1), (0.6, 0, ease_in), (0.68, 0.6), (0.76, 0, ease_in), (1, 0)])
    fwd = Track([(0, 0), (0.45, -0.1), (0.6, -0.28), (0.68, -0.22), (0.76, -0.3), (0.9, -0.1), (1, 0)])
    che = Track([(0, 0), (0.4, -40), (0.55, -40), (0.62, 35, ease_out), (0.7, -20), (0.78, 35, ease_out), (0.9, 0), (1, 0)])

    def attack2(t):
        p, l = pitch(t), lift(t)
        pose = {"body": {"t": (0, 0.06 * l, rise(t)), "r": (p, 0, 0)}, "abdomen": {"r": (-p * 0.7, 0, 0)}}
        for s in (".L", ".R"):
            pose["chel" + s] = {"r": (che(t), 0, 0)}
            pose["palp" + s] = {"r": (-40 * l, 0, 0)}
        offs = {}
        for k in front:
            hi = 0.72 if k[0] == "1" else 0.45
            f = fwd(t) * (1.0 if k[0] == "1" else 0.6)
            offs[k] = (0, f, hi * l)
        return legs(pose, offs)
    A.clip("Attack2", 34, attack2)


def build():
    sk = skeleton(B.Skel())
    body = sk.mesh("Body", subsurf=1)
    B.sculpt(body, lambda co, nr: Q.blobs(co, nr, [((0.0, 0.42, 0.9), 0.14, 0.02), ((0, -0.3, 0.63), 0.1, -0.01)]))
    gn.decimate(body, 0.72)
    gn.apply(body)
    for p in body.data.polygons:
        p.use_smooth = True
    gn.displace(body, strength=0.004, scale=10.0, detail=2.0, voronoi=0.0, seed=8)
    gn.apply(body)
    arm = R.build_armature(bones())
    for n in ("root", "body"):
        arm.data.bones[n].use_deform = False
    attributes(body, sk)
    mats = {
        "chitin": cmat.chitin("Chitin_spider", color="#34271c", dark="#0c0907", edge="#8a7050", hair=1.0,
                              mark_color="#b8a07a", rough=0.55, seed=4, tone=True, pattern="spider"),
        "fang": cmat.keratin("Fang_spider", color="#120d0b", tip="#6b3d25", axis="Z", rough=0.3),
        "eye": cmat.eye("Eye_spider", iris="#1a0606", glow=0.8, glow_color="#b0201a", iris_size=0.55, pupil_size=1.5, sclera="#050303"),
    }
    B.set_mat(body, mats["chitin"])
    B.bind(body, arm, smooth=3)
    parts = []
    eyes = [(0.03, -0.585, 0.54, 0.018), (0.075, -0.575, 0.545, 0.013), (0.05, -0.565, 0.58, 0.012),
            (0.1, -0.55, 0.56, 0.01)]
    for sx in (1, -1):
        for j, (ex, ey, ez, er) in enumerate(eyes):
            e = B.eye(f"Eye{sx}{j}", (ex * sx, ey, ez), er, mats["eye"], look=(ex * sx * 4, -1, 0.3), seg=12, rings=8)
            B.rigid(e, "ceph")
            parts.append(e)
        f = B.horn(f"Fang{sx}", [(0.04 * sx, -0.615, 0.34), (0.03 * sx, -0.64, 0.27), (0.015 * sx, -0.61, 0.22)],
                   0.016, mats["fang"], res=6)
        B.rigid(f, f"chel{'.L' if sx > 0 else '.R'}")
        parts.append(f)
    B.join_into(body, parts)
    print("[spider] furmask max", B.get_attr(body, "furmask").max(), "mean", B.get_attr(body, "furmask").mean(),
          )
    card = B.card_template("_Bristle", length=1.0, width=0.2, segs=2, lift=0.9, droop=0.1)
    card_mat = cmat.fur_lock("FurCard_spider", colors=("#140f0b", "#2e241b", "#4a3a2a", "#8a7456"), tip="#c2ad86",
                             seed=9, strands=4)
    fur = B.fur_cards(body, card, card_mat, density=190.0, seed=3, name="Fur")
    gn.remove(card)
    KR.transfer_weights(body, fur, arm, smooth=1)
    # animation
    A = R.Animator(arm)
    legmap = {f"{i}{s[1]}": (f"leg{i}_femur{s}", f"leg{i}_tibia{s}", f"leg{i}_tarsus{s}", (0, 0, 1))
              for i in range(1, 5) for s in (".L", ".R")}
    legs = AR.LegSet(A, arm, legmap)
    ph = {"1L": 0.0, "2R": 0.05, "3L": 0.1, "4R": 0.15, "1R": 0.5, "2L": 0.55, "3R": 0.6, "4L": 0.65}

    def move_extra(pose, t, sp):
        for s in (".L", ".R"):
            pose["palp" + s] = {"r": (8 * R.wave(t, 1, 0.25 if s == ".L" else 0.75) * sp, 0, 0)}
            pose["chel" + s] = {"r": (3 * R.wave(t, 2), 0, 0)}

    def idle_extra(pose, t):
        for s in (".L", ".R"):
            pose["palp" + s] = {"r": (6 * R.wave(t, 2, 0.1 if s == ".L" else 0.4), 0, 4 * R.wave(t, 1))}
            pose["chel" + s] = {"r": (4 * max(0.0, R.wave(t, 4)), 0, 0)}

    def death_extra(pose, t, c):
        for s in (".L", ".R"):   # palps and fangs fold forward / up so they never dig into the ground
            pose["palp" + s] = {"r": (-75 * c, 0, 0)}
            pose["chel" + s] = {"r": (-50 * c, 0, 0)}

    spec = {"phases": ph, "abdomen": "abdomen", "idle_tap": "1L", "idle_extra": idle_extra, "move_extra": move_extra,
            "death_extra": death_extra,
            "walk": {"frames": 20, "stride": 0.11, "lift": 0.1, "bob": 0.01, "duty": 0.55},
            "run": {"frames": 12, "stride": 0.22, "lift": 0.14, "bob": 0.02, "duty": 0.5, "drop": 0.05},
            "death": {"drop": 0.33, "splay": 0.12, "ankle_z": 0.05, "tip_up": 14, "pitch": 2, "roll": 3}}
    AR.common_clips(A, legs, spec)
    attacks(A, legs, arm)
    A.rest_pose()
    return {"arm": arm, "meshes": [body, fur], "body": body, "expected": (2.2, None, 0.95),
            "group_sizes": {"FurCard_spider": 512}, "head_center": (0, -0.55, 0.45), "head_extent": 0.2}
