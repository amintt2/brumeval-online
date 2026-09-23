"""Boar ("Sanglier des brumes"): massive wild boar, ~1.1 m at the shoulder hump, ~2.1 m snout to tail. Faces -Y.
RUSHER: Attack = tusk gore (head toss), Attack2 = two paw scrapes (telegraph) then a head-down charge and toss.

One continuous skin-modifier body (hump, barrel, wedge head with a split snout/jaw, short legs, tail), embedded
curved tusks (GN curve sweeps), eyes, ears, split hooves; coarse bristly fur (fur_flow shader, baked) + a tall
bristle mane of GN fur cards along the spine.

Rig: root, body, hips, spine, chest, neck, head, jaw, ear.L/R, tail_1..3, legs 3 bones each.
"""
import math

import numpy as np

import body as B
import cmat
import quadruped as Q
import rigkit as R
from kit import gn, materials as M
from kit import rig as KR
from rigkit import Track, ease_in, ease_out, smooth

HERO = ("Walk", 5)
BUDGET = "beast"
FX, BX = 0.17, 0.17   # leg track half widths


def skeleton(sk):
    rump, pelvis, loin, rib, chest, neck, skull, sn1, sn2, disc = sk.chain(None, [
        ((0, 0.64, 0.8), (0.19, 0.2)),
        ((0, 0.46, 0.8), (0.25, 0.27)),
        ((0, 0.2, 0.79), (0.27, 0.3)),
        ((0, -0.08, 0.79), (0.3, 0.34)),
        ((0, -0.33, 0.81), (0.3, 0.37)),
        ((0, -0.56, 0.76), (0.23, 0.27)),
        ((0, -0.73, 0.69), (0.165, 0.17)),
        ((0, -0.88, 0.6), (0.11, 0.115)),
        ((0, -1.0, 0.535), (0.078, 0.08)),
        ((0, -1.08, 0.5), (0.066, 0.066)),
    ])
    sk.chain(skull, [((0, -0.85, 0.475), (0.09, 0.045)), ((0, -0.96, 0.44), (0.052, 0.026)),
                     ((0, -1.02, 0.43), (0.03, 0.016))])
    sk.chain(rump, [((0, 0.73, 0.79), (0.1, 0.11)), ((0, 0.785, 0.785), (0.034, 0.034)), ((0, 0.805, 0.7), (0.026, 0.026)),
                    ((0, 0.82, 0.58), (0.018, 0.018))])
    for sx in (1, -1):
        sk.chain(chest, [((FX * sx, -0.36, 0.6), (0.14, 0.17)), ((FX * sx * 1.05, -0.3, 0.4), (0.09, 0.1)),
                         ((FX * sx, -0.33, 0.25), (0.06, 0.066)), ((FX * sx, -0.34, 0.1), (0.05, 0.054)),
                         ((FX * sx, -0.38, 0.035), (0.05, 0.045)), ((FX * sx, -0.42, 0.025), (0.045, 0.025))])
        sk.chain(pelvis, [((BX * sx, 0.5, 0.62), (0.16, 0.21)), ((BX * sx * 1.05, 0.38, 0.42), (0.1, 0.11)),
                          ((BX * sx, 0.52, 0.22), (0.06, 0.066)), ((BX * sx, 0.49, 0.1), (0.05, 0.054)),
                          ((BX * sx, 0.46, 0.035), (0.05, 0.045)), ((BX * sx, 0.42, 0.025), (0.045, 0.025))])


def bones():
    bl = [
        ("root", (0, 0, 0), (0, -0.3, 0), None),
        ("body", (0, 0.05, 0.8), (0, 0.05, 0.95), "root"),
        ("hips", (0, 0.1, 0.8), (0, 0.72, 0.8), "body"),
        ("spine", (0, 0.1, 0.8), (0, -0.2, 0.8), "body"),
        ("chest", (0, -0.2, 0.8), (0, -0.5, 0.78), "spine"),
        ("neck", (0, -0.5, 0.78), (0, -0.7, 0.7), "chest"),
        ("head", (0, -0.7, 0.7), (0, -1.08, 0.5), "neck"),
        ("jaw", (0, -0.8, 0.5), (0, -1.02, 0.43), "head"),
        ("ear.L", (0.09, -0.66, 0.82), (0.15, -0.63, 0.94), "head"),
        ("ear.R", (-0.09, -0.66, 0.82), (-0.15, -0.63, 0.94), "head"),
        ("tail_1", (0, 0.72, 0.8), (0, 0.785, 0.785), "hips"),
        ("tail_2", (0, 0.785, 0.785), (0, 0.805, 0.7), "tail_1"),
        ("tail_3", (0, 0.805, 0.7), (0, 0.82, 0.58), "tail_2"),
    ]
    for sfx, sx in ((".L", 1), (".R", -1)):
        bl += [
            ("front_upper" + sfx, (FX * sx, -0.36, 0.64), (FX * sx * 1.05, -0.3, 0.4), "chest"),
            ("front_lower" + sfx, (FX * sx * 1.05, -0.3, 0.4), (FX * sx, -0.34, 0.1), "front_upper" + sfx),
            ("front_paw" + sfx, (FX * sx, -0.34, 0.1), (FX * sx, -0.43, 0.025), "front_lower" + sfx),
            ("back_upper" + sfx, (BX * sx, 0.5, 0.66), (BX * sx * 1.05, 0.38, 0.42), "hips"),
            ("back_lower" + sfx, (BX * sx * 1.05, 0.38, 0.42), (BX * sx, 0.52, 0.22), "back_upper" + sfx),
            ("back_paw" + sfx, (BX * sx, 0.52, 0.22), (BX * sx, 0.42, 0.025), "back_lower" + sfx),
        ]
    return bl


def sculpt(body):
    B.sculpt(body, lambda co, nr: Q.blobs(co, nr, [
        ((0, -0.3, 1.12), 0.2, 0.05),            # shoulder hump
        ((0.2, -0.35, 0.8), 0.14, 0.03),        # shoulder mass
        ((0.2, 0.45, 0.7), 0.14, 0.03),         # ham
        ((0.12, -0.8, 0.72), 0.06, 0.018),      # cheek
        ((0.09, -0.86, 0.66), 0.05, -0.015),    # eye socket furrow
        ((0, -0.9, 0.7), 0.06, 0.01),           # snout ridge
    ]))
    gn.displace(body, strength=0.006, scale=7.0, detail=3.0, voronoi=0.0, seed=21)
    gn.apply(body)


def attributes(body):
    co, nr = B.co_array(body), B.normal_array(body)
    x, y, z = co[:, 0], co[:, 1], co[:, 2]
    nz = nr[:, 2]
    ss = Q.smoothstep
    segs = [((0, -0.6, 0.8), (0, 0.65, 0.8), (0, 1, -0.2)), ((0, -1.08, 0.5), (0, -0.7, 0.7), (0, 1, 0.5)),
            ((0, 0.66, 0.8), (0, 0.82, 0.56), (0, 0.3, -1))]
    for sx in (1, -1):
        segs += [((FX * sx, -0.36, 0.64), (FX * sx, -0.38, 0.03), (0, 0, -1)),
                 ((BX * sx, 0.5, 0.64), (BX * sx, 0.46, 0.03), (0, 0, -1))]
    B.flow_field(body, segs, down=0.35)
    tone = np.full(len(co), 0.0)
    tone -= 0.7 * ss(nz, 0.2, 0.7) * ss(z, 0.85, 1.0)                  # dark dorsal line
    tone += 0.35 * ss(-nz, 0.2, 0.7) * ss(z, 0.3, 0.55)                # slightly lighter belly
    tone += 0.8 * ss(-y, 0.95, 1.05) * (1 - ss(-y, 1.07, 1.1))          # pale snout band behind the disc
    tone += 0.5 * np.exp(-((np.abs(x) - 0.13) ** 2 + (y + 0.84) ** 2 + (z - 0.6) ** 2) / 0.05 ** 2)   # grizzled cheeks
    tone -= 0.8 * (1 - ss(z, 0.12, 0.3))                               # dark socks
    B.set_attr(body, "tone", np.clip(tone, -1, 1))
    # bristles: tall mane along the spine ridge (neck -> mid back), short bristles elsewhere
    mask = np.full(len(co), 0.1)
    ln = np.full(len(co), 0.05)
    ridge = ss(nz, 0.55, 0.9) * (1 - ss(np.abs(x), 0.06, 0.13)) * ss(y, -0.72, -0.6) * (1 - ss(y, 0.3, 0.5))
    ln = np.where(ridge > 0.2, 0.2 - 0.1 * ss(y, -0.3, 0.3), ln)
    mask = np.maximum(mask, ridge * 1.0)
    cheek = np.exp(-((np.abs(x) - 0.14) ** 2 + (y + 0.78) ** 2 + (z - 0.62) ** 2) / 0.06 ** 2)
    ln = np.where(cheek > mask, 0.08, ln)
    mask = np.maximum(mask, cheek * 0.8)
    mask *= (1 - ss(-y, 0.86, 0.92)) * ss(z, 0.2, 0.3)
    B.set_attr(body, "furmask", mask)
    B.set_attr(body, "furlen", ln)
    B.set_attr(body, "scar", np.zeros(len(co)))


def accessories(mats):
    parts = []
    for sx in (1, -1):
        s = ".L" if sx > 0 else ".R"
        tusk = B.horn(f"Tusk{sx}", [(0.06 * sx, -0.95, 0.46), (0.11 * sx, -1.02, 0.53), (0.15 * sx, -1.0, 0.64),
                                    (0.15 * sx, -0.92, 0.72)], 0.028, mats["tusk"], taper=((0, 1.0), (0.5, 0.75), (1, 0.08)), res=8)
        B.rigid(tusk, "jaw")
        up = B.horn(f"TuskU{sx}", [(0.06 * sx, -0.99, 0.53), (0.1 * sx, -1.03, 0.55), (0.12 * sx, -1.02, 0.6)], 0.016,
                    mats["tusk"], taper=((0, 1.0), (1, 0.1)), res=6)
        B.rigid(up, "head")
        eye = B.eye(f"Eye{sx}", (0.105 * sx, -0.83, 0.71), 0.018, mats["eye"], look=(0.7 * sx, -1, 0.1), seg=12, rings=8, yaw=-35 * sx)
        B.rigid(eye, "head")
        ear = B.ear(f"Ear{sx}", (0.085 * sx, -0.67, 0.8), (0.17 * sx, -0.62, 0.95), 0.09, 0.03, mats["fur"], cup=0.5,
                    facing=(0.4 * sx, -1, 0.2))
        B.rigid(ear, "ear" + s)
        parts += [tusk, up, eye, ear]
    return parts


def attacks(A, legs, arm, tail_pose):
    # Attack 0.625 s: gore — head drops, then rips up and sideways with the tusks
    hx = Track([(0, 0), (0.3, 16), (0.5, -26, ease_out), (0.7, -10), (1, 0)])
    hz = Track([(0, 0), (0.3, -6), (0.5, 18, ease_out), (0.7, 8), (1, 0)])
    by = Track([(0, 0), (0.3, 0.05), (0.5, -0.12, ease_out), (0.75, -0.08), (1, 0)])
    bz = Track([(0, 0), (0.3, -0.04), (0.5, 0.03), (1, 0)])

    def attack(t):
        pose = {"body": {"t": (0, by(t), bz(t)), "r": (-hx(t) * 0.15, 0, hz(t) * 0.2)},
                "neck": {"r": (hx(t) * 0.5, 0, hz(t) * 0.4)}, "head": {"r": (hx(t) * 0.6, hz(t) * 0.3, hz(t) * 0.5)},
                "jaw": {"r": (10 * smooth(t / 0.4) * (1 - smooth((t - 0.6) / 0.3)), 0, 0)},
                "ear.L": {"r": (-30, 0, 0)}, "ear.R": {"r": (-30, 0, 0)}}
        tail_pose(pose, (-20, 0, 0))
        return legs(pose, {"fl": (0, by(t) * 0.6, 0, 0)})
    A.clip("Attack", 15, attack)

    # Attack2 1.5 s: two paw scrapes (front right, 0.75 s telegraph, head low, snorting) then charge + toss
    sc = Track([(0, 0), (0.08, 1), (0.2, -1), (0.28, 1), (0.4, -1), (0.48, 0), (1, 0)])        # scrape stroke
    scz = Track([(0, 0), (0.06, 0.07), (0.1, 0.0), (0.2, 0.0), (0.25, 0.07), (0.3, 0.0), (0.4, 0.0), (0.46, 0.04), (0.5, 0.0), (1, 0)])
    low = Track([(0, 0), (0.1, 1), (0.52, 1), (0.6, 1.2), (0.78, 0.6), (0.86, -0.6), (0.95, 0), (1, 0)])
    ch = Track([(0, 0), (0.5, 0.06), (0.56, 0.07), (0.72, -0.6, ease_out), (0.82, -0.62), (1, 0)])
    chz = Track([(0, 0), (0.5, -0.04), (0.62, 0.05), (0.7, -0.02), (0.8, 0.0), (1, 0)])
    fy = Track([(0, 0), (0.56, 0.02), (0.64, -0.35), (0.7, -0.45), (0.82, -0.5), (0.92, -0.2), (1, 0)])
    fz = Track([(0, 0), (0.56, 0), (0.6, 0.14), (0.66, 0.0), (0.72, 0.08), (0.78, 0.0), (0.9, 0.05), (1, 0)])
    hy = Track([(0, 0), (0.6, 0), (0.68, -0.3), (0.76, -0.5), (0.84, -0.45), (0.94, -0.15), (1, 0)])
    hzz = Track([(0, 0), (0.62, 0), (0.66, 0.1), (0.72, 0.0), (0.78, 0.08), (0.84, 0.0), (0.95, 0.04), (1, 0)])

    def attack2(t):
        lo = low(t)
        pose = {"body": {"t": (0, ch(t), chz(t) - 0.03 * max(lo, 0)), "r": (-5 * max(lo, 0), 0, 0)},
                "chest": {"r": (-3 * max(lo, 0), 0, 0)},
                "neck": {"r": (14 * lo, 0, 0)}, "head": {"r": (12 * lo, 0, 3 * math.sin(t * 60) * (t < 0.5))},
                "jaw": {"r": (6 + 4 * math.sin(t * 50), 0, 0)},
                "ear.L": {"r": (-35 * min(1, abs(lo)), 0, 0)}, "ear.R": {"r": (-35 * min(1, abs(lo)), 0, 0)}}
        tail_pose(pose, (-35 * min(1, abs(lo)), 0, 20 * math.sin(t * 30)))
        offs = {"fr": (0, 0.12 * sc(t), scz(t), 25 * scz(t) / 0.07),
                "fl": (0, fy(t), fz(t), 30 * fz(t) / 0.14), "bl": (0, hy(t), hzz(t), 20 * hzz(t) / 0.1),
                "br": (0, hy(t) + 0.04, hzz(t), 20 * hzz(t) / 0.1)}
        if t > 0.56:
            offs["fr"] = (0, fy(t) + 0.05, fz(t) * 0.9, 30 * fz(t) / 0.14)
        return legs(pose, offs)
    A.clip("Attack2", 36, attack2)


def build():
    spec = {
        "skeleton": skeleton, "sculpt": sculpt, "subsurf": 2, "toe_len": 0.07,
        "gait": {
            "walk": {"frames": 22, "phases": {"bl": 0.0, "fl": 0.25, "br": 0.5, "fr": 0.75},
                     "stride": {"f": 0.13, "b": 0.13}, "lift": {"f": 0.07, "b": 0.06}, "curl": {"f": 55, "b": 35},
                     "duty": 0.62, "bob": 0.012, "neck": 2, "head": 2},
            "run": {"frames": 12, "phases": {"bl": 0.0, "br": 0.12, "fl": 0.45, "fr": 0.55},
                    "stride": {"f": 0.26, "b": 0.24}, "lift": {"f": 0.13, "b": 0.11}, "curl": {"f": 80, "b": 50},
                    "duty": 0.4, "bob": 0.045, "flex": 6, "pitch": 4, "surge": 0.03, "drop": 0.04, "neck": 6, "head": 8},
        },
        "death": {"half_w": 0.34, "half_h": 0.32, "slide": 0.25, "lift": 0.02, "scale": 1.6},
        "attacks": attacks, "tail_rest": (0, 0, 0), "tail_walk": (-10, 0, 0), "tail_run": (-40, 0, 0),
        "idle_jaw": 2, "walk_jaw": 2, "run_jaw": 8, "hit_jaw": 15,
    }
    arm = Q.make_armature(bones())
    body = Q.build_body(spec)
    attributes(body)
    mats = {
        "fur": cmat.fur_flow("Fur_boar", color="#4d3e30", dark="#1c1510", light="#a08a68", tip="#958468", seed=13,
                             lock=14.0, strand=180.0, rough=0.86),
        "pad": cmat.skin_pad("Snout_boar", color="#3a2a26", seed=5, rough=0.4),
        "hoof": cmat.keratin("Hoof_boar", color="#17120f", tip="#5e5246", axis="Z", rough=0.5, grime=0.6),
        "mouth": cmat.mouth("Mouth_boar"),
        "tusk": M.bone("Tusk_boar", color="#d9cba8", dirt=0.7, seed=8),
        "eye": cmat.eye("Eye_boar", iris="#5a2a10", iris_size=0.25, pupil_size=0.8, sclera="#1a120c"),
    }
    B.set_mat(body, mats["fur"])
    B.paint_faces(body, mats["pad"], lambda c, n: (c[:, 1] < -1.07) & (n[:, 1] < -0.4))
    B.paint_faces(body, mats["hoof"], lambda c, n: c[:, 2] < 0.075)

    def mouth(c, n):
        inside = (c[:, 1] < -0.84) & (np.abs(c[:, 0]) < 0.07) & (c[:, 2] > 0.42) & (c[:, 2] < 0.52)
        return inside & (((n[:, 2] < -0.35) & (c[:, 2] > 0.46)) | ((n[:, 2] > 0.35) & (c[:, 2] < 0.47)))
    B.paint_faces(body, mats["mouth"], mouth)

    def jaw_mask(co):
        y, z = co[:, 1], co[:, 2]
        zc = 0.475 - (-(y) - 0.84) * 0.25        # mouth line slopes down towards the snout tip
        return Q.smoothstep(-y, 0.82, 0.87) * (1 - Q.smoothstep(z - zc, -0.005, 0.005))

    def head_mask(co):
        y, z = co[:, 1], co[:, 2]
        zc = 0.475 - (-(y) - 0.84) * 0.25
        return Q.smoothstep(-y, 0.84, 0.9) * Q.smoothstep(z - zc, 0.0, 0.01)
    B.bind(body, arm, overrides=[(jaw_mask, {"jaw": 1.0}), (head_mask, {"head": 1.0})], smooth=3)
    B.join_into(body, accessories(mats))
    card = B.card_template("_Bristle", length=1.0, width=0.22, segs=2, lift=1.3, droop=0.15)
    card_mat = cmat.fur_lock("FurCard_boar", colors=("#17110c", "#2e241b", "#4d3e30", "#8a7760"), tip="#a8967a",
                             seed=6, strands=4)
    fur = B.fur_cards(body, card, card_mat, density=260.0, seed=11, name="Fur")
    gn.remove(card)
    KR.transfer_weights(body, fur, arm, smooth=2)
    Q.standard_clips(arm, spec)
    return {"arm": arm, "meshes": [body, fur], "body": body, "expected": (None, 2.1, 1.15),
            "group_sizes": {"FurCard_boar": 512}, "head_center": (0, -0.9, 0.62), "head_extent": 0.25}
