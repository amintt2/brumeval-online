"""Wolf ("Loup gris"): scarred grey wolf, ~0.85 m at the withers, ~1.75 m nose to tail tip. Faces -Y.
Also the base of ice_wolf.py (variant="ice": pale, frost crystals along the spine, glowing eyes).

Body: ONE continuous skin-modifier mesh (torso, neck, head, jaw, legs, tail) sculpted with gaussian muscle
blobs + GN noise, embedded accessories (eyes, ears, fangs, claws), GN-scattered alpha fur cards (neck ruff,
dorsal ridge, bushy tail, cheeks, leg feathers) following the fur flow. Directional fur (locks + strands),
scars and tone are procedural shader nodes baked to baseColor / normal / ORM.

Rig: root, body, hips, spine, chest, neck, head, jaw, ear.L/R, tail_1..4, legs 3 bones each
(front|back _upper/_lower/_paw .L/.R). Clips: Idle, Walk, Attack, Attack2, Run, Hit, Death.
"""
import math

import bpy
import numpy as np
from mathutils import Vector

import body as B
import cmat
import quadruped as Q
import rigkit as R
from kit import gn, materials as M
from rigkit import Track, ease_in, ease_out, smooth

HERO = ("Walk", 5)
BUDGET = "beast"


def _variant(v):
    if v == "ice":
        return dict(S=1.1, fur=("#8d99a2", "#3a4652", "#dde4e8", "#c9d3da"), card=("#8d99a2", "#dde4e8", "#3a4652"),
                    cards=("#3a4652", "#66737e", "#8d99a2", "#dde4e8"), eye=("#7fe3ff", 4.0), scars=False, frost=True, pad="#2a2f35", claw=("#3a4048", "#b9c6cf"))
    return dict(S=1.0, fur=("#5d564d", "#211d1a", "#aaa292", "#8c8374"), card=("#5d554b", "#b3a590", "#1f1b18"),
                cards=("#211d1a", "#3f3931", "#5d564d", "#aaa292"), eye=("#d9a13a", 0.0), scars=True, frost=False, pad="#1b1715", claw=("#262220", "#8c8070"))


# =============================================================================== skeleton (metres, S = scale)
def skeleton_fn(S):
    def sk_build(sk):
        def P(x, y, z):
            return (x * S, y * S, z * S)

        def r(a, b=None):
            return (a * S, (b if b is not None else a) * S)

        rump, pelvis, loin, rib, chest, brisket, neck1, neck2, skull, brow, muz1, muz2, nose = sk.chain(None, [
            (P(0, 0.44, 0.645), r(0.085, 0.095)),
            (P(0, 0.31, 0.67), r(0.12, 0.14)),
            (P(0, 0.12, 0.665), r(0.11, 0.13)),
            (P(0, -0.08, 0.64), r(0.135, 0.19)),
            (P(0, -0.25, 0.64), r(0.135, 0.2)),
            (P(0, -0.37, 0.675), r(0.115, 0.16)),
            (P(0, -0.45, 0.77), r(0.1, 0.12)),
            (P(0, -0.52, 0.855), r(0.085, 0.095)),
            (P(0, -0.585, 0.915), r(0.085, 0.075)),
            (P(0, -0.65, 0.93), r(0.065, 0.055)),
            (P(0, -0.71, 0.905), r(0.045, 0.04)),
            (P(0, -0.76, 0.896), r(0.034, 0.03)),
            (P(0, -0.795, 0.894), r(0.022, 0.02)),
        ])
        sk.chain(skull, [
            (P(0, -0.645, 0.852), r(0.056, 0.03)),
            (P(0, -0.71, 0.85), r(0.037, 0.022)),
            (P(0, -0.768, 0.855), r(0.024, 0.015)),
        ])
        sk.chain(rump, [
            (P(0, 0.5, 0.61), r(0.045, 0.048)),
            (P(0, 0.595, 0.565), r(0.05, 0.05)),
            (P(0, 0.665, 0.455), r(0.045, 0.045)),
            (P(0, 0.705, 0.345), r(0.032, 0.032)),
            (P(0, 0.72, 0.265), r(0.014, 0.014)),
        ])
        for sx in (1, -1):
            x = 0.1 * sx
            sk.chain(chest, [
                (P(x, -0.27, 0.56), r(0.065, 0.09)),
                (P(x * 1.05, -0.215, 0.405), r(0.048, 0.056)),
                (P(x, -0.24, 0.24), r(0.034, 0.038)),
                (P(x, -0.25, 0.115), r(0.028, 0.032)),
                (P(x, -0.285, 0.04), r(0.036, 0.034)),
                (P(x, -0.32, 0.026), r(0.032, 0.022)),
            ])
            sk.chain(pelvis, [
                (P(x * 1.02, 0.33, 0.56), r(0.08, 0.12)),
                (P(x * 1.07, 0.22, 0.395), r(0.052, 0.065)),
                (P(x, 0.3, 0.27), r(0.036, 0.045)),
                (P(x, 0.365, 0.155), r(0.028, 0.034)),
                (P(x, 0.335, 0.04), r(0.036, 0.034)),
                (P(x, 0.3, 0.026), r(0.032, 0.022)),
            ])
    return sk_build


def bones_for(S):
    def P(x, y, z):
        return (x * S, y * S, z * S)
    bones = [
        ("root", (0, 0, 0), (0, -0.25 * S, 0), None),
        ("body", P(0, 0.05, 0.655), P(0, 0.05, 0.76), "root"),
        ("hips", P(0, 0.1, 0.665), P(0, 0.44, 0.645), "body"),
        ("spine", P(0, 0.1, 0.665), P(0, -0.13, 0.65), "body"),
        ("chest", P(0, -0.13, 0.65), P(0, -0.37, 0.68), "spine"),
        ("neck", P(0, -0.40, 0.72), P(0, -0.575, 0.895), "chest"),
        ("head", P(0, -0.575, 0.895), P(0, -0.8, 0.9), "neck"),
        ("jaw", P(0, -0.615, 0.868), P(0, -0.78, 0.853), "head"),
        ("ear.L", P(0.04, -0.59, 0.955), P(0.058, -0.575, 1.045), "head"),
        ("ear.R", P(-0.04, -0.59, 0.955), P(-0.058, -0.575, 1.045), "head"),
        ("tail_1", P(0, 0.44, 0.645), P(0, 0.54, 0.6), "hips"),
        ("tail_2", P(0, 0.54, 0.6), P(0, 0.62, 0.53), "tail_1"),
        ("tail_3", P(0, 0.62, 0.53), P(0, 0.685, 0.41), "tail_2"),
        ("tail_4", P(0, 0.685, 0.41), P(0, 0.72, 0.265), "tail_3"),
    ]
    for sfx, sx in ((".L", 1), (".R", -1)):
        x = 0.1 * sx
        bones += [
            ("front_upper" + sfx, P(x, -0.27, 0.6), P(x * 1.05, -0.215, 0.405), "chest"),
            ("front_lower" + sfx, P(x * 1.05, -0.215, 0.405), P(x, -0.25, 0.115), "front_upper" + sfx),
            ("front_paw" + sfx, P(x, -0.25, 0.115), P(x, -0.33, 0.026), "front_lower" + sfx),
            ("back_upper" + sfx, P(x * 1.02, 0.33, 0.6), P(x * 1.07, 0.22, 0.395), "hips"),
            ("back_lower" + sfx, P(x * 1.07, 0.22, 0.395), P(x, 0.365, 0.155), "back_upper" + sfx),
            ("back_paw" + sfx, P(x, 0.365, 0.155), P(x, 0.3, 0.026), "back_lower" + sfx),
        ]
    return bones


# =============================================================================== sculpt / attributes
def sculpt_fn(S):
    def sc(body):
        def P(x, y, z):
            return (x * S, y * S, z * S)
        B.sculpt(body, lambda co, nr: Q.blobs(co, nr, [
            (P(0.09, -0.3, 0.64), 0.07 * S, 0.018 * S),       # shoulder blades
            (P(0.1, -0.2, 0.47), 0.06 * S, 0.012 * S),        # triceps
            (P(0.1, 0.33, 0.55), 0.08 * S, 0.02 * S),         # thigh / haunch
            (P(0.11, -0.05, 0.6), 0.1 * S, 0.01 * S),         # rib cage
            (P(0.05, 0.1, 0.55), 0.09 * S, -0.018 * S),       # tucked waist
            (P(0.035, -0.652, 0.955), 0.022 * S, 0.008 * S),   # brow ridges
            (P(0.05, -0.62, 0.9), 0.03 * S, 0.012 * S),       # cheek / masseter
            (P(0, -0.69, 0.93), 0.02 * S, -0.007 * S),      # stop between the eyes
            (P(0, -0.58, 0.965), 0.035 * S, 0.006 * S),       # skull crest
            (P(0.03, -0.60, 0.975), 0.02 * S, 0.004 * S),
        ]))
        gn.displace(body, strength=0.004 * S, scale=9.0, detail=3.0, voronoi=0.0, seed=3)
        gn.apply(body)
    return sc


def attributes(body, S, V):
    co, nr = B.co_array(body), B.normal_array(body)
    x, y, z = co[:, 0] / S, co[:, 1] / S, co[:, 2] / S
    nz = nr[:, 2]
    ss = Q.smoothstep
    # ---- fur flow
    segs = [((0, -0.4 * S, 0.68 * S), (0, 0.45 * S, 0.66 * S), (0, 1, 0)),          # torso: backwards
            ((0, -0.8 * S, 0.9 * S), (0, -0.6 * S, 0.92 * S), (0, 1, 0.15)),       # head: back
            ((0, -0.6 * S, 0.9 * S), (0, -0.4 * S, 0.72 * S), (0, 1, -0.6)),        # neck: back / down
            ((0, 0.46 * S, 0.66 * S), (0, 0.72 * S, 0.27 * S), (0, 0.5, -1)),       # tail: to the tip
            ]
    for sx in (1, -1):
        segs += [((0.1 * sx * S, -0.27 * S, 0.56 * S), (0.1 * sx * S, -0.29 * S, 0.03 * S), (0, 0.1, -1)),
                 ((0.1 * sx * S, 0.33 * S, 0.56 * S), (0.1 * sx * S, 0.33 * S, 0.03 * S), (0, 0.1, -1))]
    B.flow_field(body, segs, down=0.25)
    # ---- tone (-1 dark saddle / +1 light belly, throat, legs)
    tone = np.zeros(len(co))
    torso = ss(y, -0.5, -0.4) * (1 - ss(y, 0.5, 0.6))
    tone -= 0.95 * ss(nz, 0.15, 0.75) * ss(z, 0.55, 0.7) * ss(y, -0.55, -0.35)          # saddle incl. neck top
    tone -= 0.25 * ss(nz, 0.2, 0.8) * ss(y, -0.75, -0.6) * (1 - ss(y, -0.55, -0.5))      # dark forehead
    tone += 1.0 * ss(-nz, 0.1, 0.6) * torso                                             # belly
    tone += 1.1 * (1 - ss(y, -0.5, -0.36)) * ss(-nz, -0.3, 0.3) * (1 - ss(z, 0.86, 0.9))  # throat / chest
    tone += 0.8 * ss(-nr[:, 1], 0.3, 0.8) * ss(z, 0.45, 0.6) * (1 - ss(y, -0.42, -0.3)) * (1 - ss(z, 0.8, 0.86))  # chest front
    tone += 0.1 * (1 - ss(z, 0.2, 0.42))                                                # lower legs
    tone += 0.9 * ss(y, -0.9, -0.61) * (1 - ss(z, 0.862, 0.885))                          # muzzle underside + jaw
    tone += 0.9 * np.exp(-((np.abs(x) - 0.036) ** 2 + (y + 0.656) ** 2 + (z - 0.962) ** 2) / 0.012 ** 2)  # brow marks
    tone += 0.8 * np.exp(-((np.abs(x) - 0.052) ** 2 + (y + 0.63) ** 2 + (z - 0.885) ** 2) / 0.022 ** 2)  # cheeks
    tone -= 1.3 * ss(y, 0.66, 0.72)                                                     # dark tail tip
    tone -= 0.5 * np.exp(-((y + 0.25) ** 2 + (z - 0.72) ** 2) / 0.05 ** 2)               # shoulder cape
    B.set_attr(body, "tone", np.clip(tone, -1, 1))
    # ---- fur cards: mask + length
    mask = np.full(len(co), 0.45)
    ln = np.full(len(co), 0.05 * S)

    def put(m, length):
        nonlocal mask, ln
        m = np.clip(m, 0, 1)
        ln = np.where(m > mask, length, ln) * 1.0
        mask = np.maximum(mask, m)
    neck = np.exp(-((y + 0.45) ** 2 / 0.09 ** 2 + (z - 0.76) ** 2 / 0.13 ** 2))
    put(neck * 1.0, 0.12 * S)                                                          # ruff
    put(ss(nz, 0.35, 0.8) * ss(z, 0.6, 0.7) * ss(y, -0.45, -0.3) * (1 - ss(y, 0.3, 0.45)) * 0.8, 0.07 * S)  # dorsal
    put(ss(y, 0.47, 0.52) * 1.0, 0.13 * S)                                               # tail brush
    put(np.exp(-((np.abs(x) - 0.06) ** 2 + (y + 0.6) ** 2 + (z - 0.87) ** 2) / 0.03 ** 2), 0.06 * S)  # cheek tufts
    put(ss(-nz, 0.3, 0.7) * torso * 0.55, 0.06 * S)                                    # belly fringe
    put(ss(nr[:, 1], 0.3, 0.8) * ss(z, 0.15, 0.3) * (1 - ss(z, 0.45, 0.5)) * (1 - ss(y, -0.1, 0.0)) * 0.7, 0.04 * S)  # leg feathers
    put(ss(nr[:, 1], 0.4, 0.8) * ss(y, 0.3, 0.4) * ss(z, 0.4, 0.5) * 0.7, 0.05 * S)     # "pants"
    mask *= (1 - ss(y, -0.9, -0.66) * (1 - ss(z, 0.95, 1.0)))                           # no cards on the face
    mask *= ss(z, 0.16, 0.22)                                                           # nor on the paws
    B.set_attr(body, "furmask", mask)
    B.set_attr(body, "furlen", ln)
    # ---- scars (wolf): 3 claw rakes on the left shoulder + one across the right brow / muzzle
    scar = np.zeros(len(co))
    if V["scars"]:
        rakes = [((0.13, -0.33, 0.7), (0.14, -0.14, 0.52)), ((0.135, -0.3, 0.72), (0.145, -0.1, 0.55)),
                 ((0.13, -0.27, 0.74), (0.14, -0.06, 0.58)),
                 ((-0.02, -0.63, 0.975), (-0.05, -0.72, 0.915))]
        for i, (a, b) in enumerate(rakes):
            d, t = B.seg_dist(co / S, a, b)
            w = (0.006 if i < 3 else 0.005) * (0.4 + 0.6 * np.sin(np.pi * t))
            scar = np.maximum(scar, 1 - ss(d, w * 0.6, w * 1.6))
        scar *= (np.abs(nr[:, 0]) > 0.2) | (nr[:, 2] > 0.3)
    B.set_attr(body, "scar", scar)
    B.set_attr(body, "frost", ss(nz, 0.3, 0.8) * ss(z, 0.6, 0.72) * (1 - ss(y, 0.5, 0.7)) if V["frost"] else np.zeros(len(co)))
    return mask


# =============================================================================== accessories
def accessories(body, arm, S, V, mats):
    parts = []

    def P(x, y, z):
        return (x * S, y * S, z * S)
    for sx in (1, -1):
        # eyes: almond (flattened spheres) set into the brow, looking forward-outward
        e = B.eye(f"Eye{sx}", P(0.043 * sx, -0.66, 0.943), 0.0135 * S, mats["eye"], look=(0.45 * sx, -1, 0.08),
                  seg=16, rings=10, scale=(1.0, 0.8, 0.75), yaw=-28 * sx)
        B.rigid(e, "head")
        parts.append(e)
        # ears
        ear = B.ear(f"Ear{sx}", P(0.042 * sx, -0.585, 0.945), P(0.07 * sx, -0.575, 1.035), 0.072 * S, 0.024 * S,
                    mats["fur"], cup=0.55, facing=(0.35 * sx, -1, 0.1))
        B.rigid(ear, "ear.L" if sx > 0 else "ear.R")
        parts.append(ear)
        # canines (upper point down, lower point up)
        f1 = B.horn(f"FangU{sx}", [P(0.02 * sx, -0.765, 0.876), P(0.021 * sx, -0.77, 0.862), P(0.019 * sx, -0.772, 0.848)],
                    0.0055 * S, mats["tooth"], res=6)
        B.rigid(f1, "head")
        f2 = B.horn(f"FangL{sx}", [P(0.015 * sx, -0.755, 0.855), P(0.016 * sx, -0.758, 0.866), P(0.015 * sx, -0.756, 0.875)],
                    0.0045 * S, mats["tooth"], res=6)
        B.rigid(f2, "jaw")
        parts += [f1, f2]
        # claws: 4 per paw
        for k, (bone, py) in enumerate((("front_paw", -0.32), ("back_paw", 0.3))):
            for j, dx in enumerate((-0.022, -0.0075, 0.0075, 0.022)):
                bx = 0.1 * sx + dx * (1.0 if j in (1, 2) else 1.05)
                yy = py - (0.012 if j in (1, 2) else 0.0)
                c = B.horn(f"Claw{sx}{k}{j}", [P(bx, yy + 0.008, 0.024), P(bx, yy - 0.012, 0.018), P(bx, yy - 0.022, 0.004)],
                           0.0055 * S, mats["claw"], res=5)
                B.rigid(c, bone + (".L" if sx > 0 else ".R"))
                parts.append(c)
    return parts


# =============================================================================== attacks (species-specific)
def attacks(A, legs, arm, tail_pose):
    # ---------------- Attack 0.625 s: quick snapping bite (head drops, jaw opens wide, clamps, shake)
    ry = Track([(0, 0), (0.25, 0.04), (0.45, -0.12, ease_out), (0.65, -0.1), (1, 0)])
    rz = Track([(0, 0), (0.25, -0.03), (0.45, -0.01), (1, 0)])
    pitch = Track([(0, 0), (0.25, 4), (0.45, -6), (0.7, 2), (1, 0)])
    neck = Track([(0, 0), (0.25, 14), (0.45, -8, ease_out), (0.55, 8), (0.8, 2), (1, 0)])
    head = Track([(0, 0), (0.25, -10), (0.45, 6), (0.55, 10), (0.8, 2), (1, 0)])
    jaw = Track([(0, 4), (0.22, 10), (0.4, 44, ease_out), (0.5, 0, ease_in), (0.62, 6), (1, 4)])
    shake = Track([(0, 0), (0.5, 0), (0.58, 12), (0.68, -9), (0.78, 4), (1, 0)])
    fl = Track([(0, 0), (0.3, 0), (0.42, -0.08), (1, 0)])
    flz = Track([(0, 0), (0.28, 0), (0.36, 0.05), (0.46, 0.0, ease_in), (1, 0)])

    def attack(t):
        pose = {
            "body": {"t": (0, ry(t), rz(t)), "r": (pitch(t), 0, 0)},
            "chest": {"r": (-pitch(t) * 0.5, 0, 0)},
            "neck": {"r": (neck(t), 0, shake(t) * 0.4)},
            "head": {"r": (head(t), shake(t) * 0.6, shake(t))},
            "jaw": {"r": (jaw(t), 0, 0)},
            "ear.L": {"r": (-30 * smooth(t / 0.3) * (1 - smooth((t - 0.7) / 0.3)), 0, 0)},
            "ear.R": {"r": (-30 * smooth(t / 0.3) * (1 - smooth((t - 0.7) / 0.3)), 0, 0)},
        }
        tail_pose(pose, (-10 * smooth(t / 0.4), 0, 0))
        return legs(pose, {"fl": (0, fl(t), flz(t), 20 * flz(t) / 0.05), "fr": (0, fl(t) * 0.6, 0, 0)})

    A.clip("Attack", 15, attack)

    # ---------------- Attack2 1.5 s: crouch + snarl (0.75 s telegraph) then lunge-bite and recover
    by = Track([(0, 0), (0.45, 0.07), (0.52, 0.08), (0.62, -0.38, ease_out), (0.72, -0.4), (1, 0)])
    bz = Track([(0, 0), (0.45, -0.13), (0.52, -0.14), (0.6, 0.06, ease_out), (0.68, 0.0), (0.74, -0.04), (1, 0)])
    bp = Track([(0, 0), (0.45, 5), (0.58, -10), (0.66, -4), (0.74, 4), (1, 0)])
    nk = Track([(0, 0), (0.45, 10), (0.52, 12), (0.6, -10, ease_out), (0.66, 4), (0.74, 6), (1, 0)])
    hd = Track([(0, 0), (0.45, -16), (0.52, -18), (0.6, 4), (0.66, 10), (0.8, 2), (1, 0)])
    jw = Track([(0, 4), (0.2, 14), (0.45, 18), (0.5, 12), (0.6, 50, ease_out), (0.66, 0, ease_in), (0.76, 8), (1, 4)])
    sn = Track([(0, 0), (0.12, 1), (0.5, 1), (0.58, 0), (1, 0)])
    # feet: front paws jump forward with the lunge, hind paws push
    fy = Track([(0, 0), (0.52, 0.05), (0.6, -0.3), (0.64, -0.36), (0.8, -0.3), (1, 0)])
    fz = Track([(0, 0), (0.52, 0), (0.57, 0.12), (0.63, 0.0, ease_in), (0.82, 0.0), (0.9, 0.05), (1, 0)])
    hy = Track([(0, 0), (0.55, 0), (0.62, -0.2), (0.72, -0.34), (0.86, -0.2), (1, 0)])
    hz = Track([(0, 0), (0.55, 0), (0.6, 0.06), (0.7, 0.0), (0.84, 0.05), (1, 0)])

    def attack2(t):
        s = sn(t)
        pose = {
            "body": {"t": (0, by(t), bz(t)), "r": (bp(t), 0, 0)},
            "hips": {"r": (-6 * s, 0, 0)},
            "chest": {"r": (4 * s, 0, 0)},
            "neck": {"r": (nk(t), 0, 0)},
            "head": {"r": (hd(t), 0, 2 * math.sin(t * 40) * s)},
            "jaw": {"r": (jw(t), 0, 0)},
            "ear.L": {"r": (-40 * s - 20 * (1 - s) * smooth((t - 0.55) / 0.1) * (1 - smooth((t - 0.8) / 0.2)), 0, 0)},
            "ear.R": {"r": (-40 * s - 20 * (1 - s) * smooth((t - 0.55) / 0.1) * (1 - smooth((t - 0.8) / 0.2)), 0, 0)},
        }
        tail_pose(pose, (-22 * s + 8, 0, 0))
        f = (0, fy(t), fz(t), 30 * fz(t) / 0.12)
        h = (0, hy(t), hz(t), 25 * hz(t) / 0.06)
        return legs(pose, {"fl": f, "fr": (0, fy(t) + 0.03, fz(t) * 0.9, f[3]), "bl": h, "br": (0, hy(t) + 0.02, hz(t), h[3])})

    A.clip("Attack2", 36, attack2)


# =============================================================================== build
def spec_for(S):
    return {
        "skeleton": skeleton_fn(S),
        "sculpt": sculpt_fn(S),
        "subsurf": 2,
        "decimate": 0.62,
        "toe_len": 0.085 * S,
        "gait": {
            "walk": {"frames": 20, "phases": {"bl": 0.0, "fl": 0.25, "br": 0.5, "fr": 0.75},
                     "stride": {"f": 0.12 * S, "b": 0.12 * S}, "lift": {"f": 0.07 * S, "b": 0.06 * S},
                     "curl": {"f": 70, "b": 40}, "duty": 0.62, "bob": 0.008 * S, "neck": -4, "head": 5},
            "run": {"frames": 12, "phases": {"bl": 0.0, "br": 0.1, "fl": 0.42, "fr": 0.52},
                    "stride": {"f": 0.28 * S, "b": 0.26 * S}, "lift": {"f": 0.14 * S, "b": 0.12 * S},
                    "curl": {"f": 90, "b": 55}, "duty": 0.36, "bob": 0.04 * S, "flex": 9, "pitch": 5,
                    "surge": 0.03 * S, "drop": 0.04 * S, "neck": -14, "head": 10},
        },
        "death": {"half_w": 0.2 * S, "half_h": 0.17 * S, "slide": 0.2 * S, "lift": 0.02 * S},
        "attacks": attacks,
        "tail_rest": (6, 0, 0), "tail_walk": (0, 0, 0), "tail_run": (-18, 0, 0),
    }


def build(variant="wolf"):
    V = _variant(variant)
    S = V["S"]
    spec = spec_for(S)
    arm = Q.make_armature(bones_for(S))
    body = Q.build_body(spec)
    mask = attributes(body, S, V)
    fc = V["fur"]
    mats = {
        "fur": cmat.fur_flow("Fur_" + variant, color=fc[0], dark=fc[1], light=fc[2], tip=fc[3], seed=5 if variant == "wolf" else 9,
                             frost_color="#eef8ff" if V["frost"] else None),
        "pad": cmat.skin_pad("Pad_" + variant, color=V["pad"], seed=2),
        "mouth": cmat.mouth("Mouth_" + variant),
        "tooth": M.bone("Tooth_" + variant, color="#ddd3bd", dirt=0.5, seed=3),
        "claw": cmat.keratin("Claw_" + variant, color=V["claw"][0], tip=V["claw"][1], axis="Y"),
        "eye": cmat.eye("Eye_" + variant, iris=V["eye"][0], glow=V["eye"][1], iris_size=0.2, pupil_size=0.82,
                        sclera="#1a1410"),
    }
    B.set_mat(body, mats["fur"])
    s = S

    # nose leather, lips line, paw pads, mouth interior
    def nose(c, n):
        return (c[:, 1] < -0.785 * s) & (c[:, 2] > 0.878 * s)
    B.paint_faces(body, mats["pad"], nose)
    B.paint_faces(body, mats["pad"], lambda c, n: (c[:, 2] < 0.03 * s) & (n[:, 2] < -0.35))

    def mouth(c, n):
        inside = (c[:, 1] < -0.62 * s) & (np.abs(c[:, 0]) < 0.034 * s) & (c[:, 2] > 0.845 * s) & (c[:, 2] < 0.885 * s)
        return inside & (((n[:, 2] < -0.35) & (c[:, 2] > 0.862 * s)) | ((n[:, 2] > 0.35) & (c[:, 2] < 0.868 * s)))
    B.paint_faces(body, mats["mouth"], mouth)

    def lips(c, n):
        near = (c[:, 1] < -0.62 * s) & (c[:, 2] > 0.85 * s) & (c[:, 2] < 0.883 * s) & (np.abs(c[:, 0]) >= 0.0)
        side = np.abs(n[:, 2]) <= 0.35
        return near & side & (np.abs(c[:, 2] - 0.863 * s) < 0.005 * s) & (np.abs(c[:, 0]) > 0.018 * s)
    B.paint_faces(body, mats["pad"], lips)

    # weights: heat + jaw/head regions (mouth split)
    def jaw_mask(co):
        y, z = co[:, 1] / s, co[:, 2] / s
        return Q.smoothstep(-y, 0.615, 0.65) * (1 - Q.smoothstep(z, 0.861, 0.869))

    def head_mask(co):
        y, z = co[:, 1] / s, co[:, 2] / s
        return Q.smoothstep(-y, 0.625, 0.66) * Q.smoothstep(z, 0.865, 0.873)
    B.bind(body, arm, overrides=[(jaw_mask, {"jaw": 1.0}), (head_mask, {"head": 1.0})], smooth=3)
    parts = accessories(body, arm, S, V, mats)
    B.join_into(body, parts)
    # fur cards (GN scatter along the flow), skinned from the body
    card = B.card_template("_FurCard", length=1.0, width=0.3, segs=3, lift=0.9, droop=0.25)
    cc = V["card"]
    card_mat = cmat.fur_lock("FurCard_" + variant, colors=V["cards"], tip=fc[3], seed=4,
                             frost="#eef8ff" if V["frost"] else None)
    fur = B.fur_cards(body, card, card_mat, density=600.0 / (S * S), seed=7, name="Fur")
    gn.remove(card)
    from kit import rig as KR
    KR.transfer_weights(body, fur, arm, smooth=2)
    meshes = [body, fur]
    if V["frost"]:
        import ice_wolf
        crystals = ice_wolf.frost_crystals(body, arm, S)
        meshes.append(crystals)
    body.name = "Body"
    Q.standard_clips(arm, spec)
    return {"arm": arm, "meshes": meshes, "body": body, "expected": (None, 1.75 * S, 1.05 * S),
            "head_center": (0, -0.66 * S, 0.9 * S), "head_extent": 0.14 * S,
            "group_sizes": {"FurCard_" + variant: 512}}
