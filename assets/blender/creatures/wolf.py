"""Wolf ("Loup gris"): grey/brown low-poly quadruped, ~0.9 m at the shoulder, ~1.6 m nose to tail. Faces -Y.

Rig: root, hips, spine, chest, neck, head, jaw, tail_1, tail_2 and four legs
(front_upper/front_lower/front_paw, back_upper/back_lower/back_paw with .L/.R).
Legs are animated with a two-bone IK so paws stay planted (Idle/Attack/Hit) and follow a proper diagonal
trot (Walk: front-left + back-right, then front-right + back-left).
"""
import math
import zlib

from mathutils import Vector

import common as C
import meshkit as M
import rigkit as R
from rigkit import Track, ease_in, ease_out, smooth

PREVIEW = ("Walk", 4)
SHEET_SIZE = 240
SIDE_SHEET = [("Walk", [0, 2, 4, 6, 8, 10, 12, 14, 16]), ("Attack", [0, 3, 5, 6, 7, 8, 10, 12, 15])]
CLIPS = ("Idle", "Walk", "Attack", "Hit", "Death")
SHEET = [("Idle", [0, 12, 24, 36]), ("Walk", [0, 3, 5, 9, 12, 14]), ("Attack", [0, 4, 6, 8, 11]),
         ("Hit", [0, 3, 6, 9]), ("Death", [0, 6, 12, 18, 24, 29])]

X = 0.115  # half track width of the legs
HEAD_PIVOT = Vector((0, -0.59, 0.91))
HEAD_SCALE = 1.16  # stylised: slightly oversized head


def hs(p):
    """map a head-space design point to its final (scaled) position"""
    return tuple(HEAD_PIVOT + (Vector(p) - HEAD_PIVOT) * HEAD_SCALE)


BONES = [
    ("root", (0, 0, 0), (0, -0.25, 0), None),
    ("hips", (0, 0.28, 0.68), (0, 0.02, 0.70), "root"),
    ("spine", (0, 0.02, 0.70), (0, -0.22, 0.71), "hips"),
    ("chest", (0, -0.22, 0.71), (0, -0.42, 0.74), "spine"),
    ("neck", (0, -0.42, 0.77), (0, -0.585, 0.905), "chest"),
    ("head", (0, -0.585, 0.905), hs((0, -0.80, 0.93)), "neck"),
    ("jaw", hs((0, -0.665, 0.875)), hs((0, -0.87, 0.868)), "head"),
    ("tail_1", (0, 0.40, 0.76), (0, 0.56, 0.63), "hips"),
    ("tail_2", (0, 0.56, 0.63), (0, 0.685, 0.42), "tail_1"),
]
for sfx, sx in ((".L", 1), (".R", -1)):
    x = X * sx
    BONES += [
        ("front_upper" + sfx, (x, -0.33, 0.64), (x, -0.275, 0.38), "chest"),
        ("front_lower" + sfx, (x, -0.275, 0.38), (x, -0.31, 0.075), "front_upper" + sfx),
        ("front_paw" + sfx, (x, -0.31, 0.075), (x, -0.40, 0.025), "front_lower" + sfx),
        ("back_upper" + sfx, (x, 0.28, 0.64), (x, 0.19, 0.39), "hips"),
        ("back_lower" + sfx, (x, 0.19, 0.39), (x, 0.29, 0.075), "back_upper" + sfx),
        ("back_paw" + sfx, (x, 0.29, 0.075), (x, 0.20, 0.025), "back_lower" + sfx),
    ]

# leg key -> (upper, lower, paw, pole y direction: +1 = joint bends backwards, -1 = forwards)
LEGS = {
    "fl": ("front_upper.L", "front_lower.L", "front_paw.L", 1),
    "fr": ("front_upper.R", "front_lower.R", "front_paw.R", 1),
    "bl": ("back_upper.L", "back_lower.L", "back_paw.L", -1),
    "br": ("back_upper.R", "back_lower.R", "back_paw.R", -1),
}


def build():
    back = C.material("wolf_fur_dark", C.hex_color("#4d463f"), rough=0.9)
    fur = C.material("wolf_fur", C.hex_color("#857e73"), rough=0.9)
    light = C.material("wolf_fur_light", C.hex_color("#d6ccb8"), rough=0.9)
    leg = C.material("wolf_fur_leg", C.hex_color("#9a9285"), rough=0.9)
    nose = C.material("wolf_nose", C.hex_color("#1b1716"), rough=0.35)
    eye = C.material("wolf_eye", C.hex_color("#ffb12e"), rough=0.3, emit=C.hex_color("#ffa51f"), emit_strength=2.5)
    teeth = C.material("wolf_teeth", C.hex_color("#f3eee0"), rough=0.4)
    inner = C.material("wolf_inner", C.hex_color("#8f6558"), rough=0.8)
    tongue = C.material("wolf_tongue", C.hex_color("#c9566a"), rough=0.5)

    rig = R.build_armature(BONES)
    parts = []

    # ---------------------------------------------------------------- torso
    torso = M.loft("torso", [
        ((0, 0.45, 0.735), 0.085, 0.08),
        ((0, 0.36, 0.725), 0.15, 0.14),
        ((0, 0.19, 0.715), 0.155, 0.135),
        ((0, 0.02, 0.715), 0.16, 0.155),
        ((0, -0.14, 0.705), 0.178, 0.195),
        ((0, -0.28, 0.70), 0.19, 0.225),
        ((0, -0.40, 0.72), 0.175, 0.21),
        ((0, -0.47, 0.76), 0.13, 0.16),
    ], n=10, cap_push=0.5)
    M.jitter(torso, 0.012, 11)
    M.paint(torso, [back, fur, light], lambda c, n: 0 if n.z > 0.55 else 2 if (n.z < -0.4 or (c.y < -0.36 and n.y < -0.35 and c.z < 0.78)) else 1)
    R.blended(torso, R.by_bones(rig, ["hips", "spine", "chest"], sharp=5))
    parts.append(torso)

    # ---------------------------------------------------------------- neck with a fur ruff
    neck = M.loft("neck", [
        ((0, -0.36, 0.75), 0.15, 0.18),
        ((0, -0.47, 0.83), 0.145, 0.16),
        ((0, -0.56, 0.90), 0.105, 0.115),
        ((0, -0.62, 0.94), 0.08, 0.085),
    ], n=10, cap_push=0.2)
    M.jitter(neck, 0.016, 12)
    M.paint(neck, [back, fur, light], lambda c, n: 0 if n.z > 0.6 else 2 if (n.z < -0.25 or n.y < -0.65) else 1)
    R.blended(neck, R.by_bones(rig, ["chest", "neck", "head"], sharp=4))
    parts.append(neck)
    for i, side in enumerate((1, -1)):  # ruff tufts on the sides of the neck
        tuft = M.cone(f"ruff{i}", 0.07, 0.0, 0.16, n=4, mat=fur, loc=(0.11 * side, -0.5, 0.8), rot=(-60, 25 * side, 0), scale=(1, 0.6, 1))
        R.blended(tuft, R.by_bones(rig, ["chest", "neck"]))
        parts.append(tuft)

    # ---------------------------------------------------------------- head
    skull = M.loft("skull", [
        ((0, -0.545, 0.955), 0.07, 0.07),
        ((0, -0.61, 0.965), 0.105, 0.095),
        ((0, -0.69, 0.96), 0.095, 0.082),
        ((0, -0.765, 0.94), 0.058, 0.055),
        ((0, -0.845, 0.925), 0.046, 0.042),
        ((0, -0.905, 0.92), 0.034, 0.032),
    ], n=8, cap_push=0.35)
    M.paint(skull, [back, fur, light], lambda c, n: 2 if (n.z < -0.3 or (c.y < -0.72 and abs(n.x) > 0.75 and c.z < 0.93)) else 0 if (n.z > 0.6 and c.y > -0.75) else 1)
    R.rigid(skull, "head")
    skull["_head"] = True
    parts.append(skull)
    for i, side in enumerate((1, -1)):  # cheek fur tufts
        ck = M.cone(f"cheek{i}", 0.045, 0.0, 0.11, n=4, mat=light, loc=(0.085 * side, -0.64, 0.905), rot=(-75, 0, 115 * side), scale=(1, 0.55, 1))
        R.rigid(ck, "head")
        ck["_head"] = True
        parts.append(ck)
    nose_o = M.ellipsoid("nose", (0.026, 0.022, 0.02), nose, loc=(0, -0.915, 0.935), seg=8, rings=5, smooth=False)
    R.rigid(nose_o, "head")
    nose_o["_head"] = True
    parts.append(nose_o)
    for i, side in enumerate((1, -1)):
        e = M.ellipsoid(f"eye{i}", (0.02, 0.013, 0.013), eye, loc=(0.066 * side, -0.73, 0.987), rot=(0, 0, 35 * side), seg=6, rings=4, smooth=False)
        brow = M.block(f"brow{i}", (0.05, 0.035, 0.02), back, loc=(0.058 * side, -0.725, 1.006), rot=(0, -18 * side, 30 * side), bevel=0.2, jit=0.0)
        # ears: flattened 4-sided pyramids, outer dark + inner pink
        ear = M.cone(f"ear{i}", 0.05, 0.0, 0.13, n=4, mat=back, rot=(0, 0, 45), scale=(1, 0.5, 1))
        M.transform(ear, loc=(0.065 * side, -0.575, 1.0), rot=(12, 16 * side, 0))
        ein = M.cone(f"earin{i}", 0.032, 0.0, 0.09, n=4, mat=inner, rot=(0, 0, 45), scale=(1, 0.35, 1))
        M.transform(ein, loc=(0.065 * side, -0.592, 1.012), rot=(12, 16 * side, 0))
        fang = M.cone(f"fang{i}", 0.009, 0.0, 0.032, n=4, mat=teeth, loc=(0.024 * side, -0.878, 0.892), rot=(180, 0, 0))
        for p in (e, brow, ear, ein, fang):
            R.rigid(p, "head")
            p["_head"] = True
        parts += [e, brow, ear, ein, fang]

    # ---------------------------------------------------------------- jaw + tongue + lower fangs
    jaw = M.loft("jaw", [
        ((0, -0.66, 0.88), 0.062, 0.03),
        ((0, -0.76, 0.875), 0.047, 0.024),
        ((0, -0.865, 0.872), 0.032, 0.017),
    ], n=6, cap_push=0.3)
    M.paint(jaw, [light, fur], lambda c, n: 1 if n.z > 0.5 else 0)
    tng = M.ellipsoid("tongue", (0.028, 0.08, 0.01), tongue, loc=(0, -0.78, 0.894), seg=6, rings=4, smooth=False)
    R.rigid(jaw, "jaw")
    R.rigid(tng, "jaw")
    jaw["_head"] = tng["_head"] = True
    parts += [jaw, tng]
    for i, side in enumerate((1, -1)):
        lf = M.cone(f"lfang{i}", 0.008, 0.0, 0.026, n=4, mat=teeth, loc=(0.02 * side, -0.855, 0.885))
        R.rigid(lf, "jaw")
        lf["_head"] = True
        parts.append(lf)

    # ---------------------------------------------------------------- legs
    for sfx, s in ((".L", 1), (".R", -1)):
        x = X * s
        fu = M.loft("fu" + sfx, [((x, -0.335, 0.72), 0.08, 0.1), ((x * 1.05, -0.30, 0.52), 0.07, 0.08),
                                 ((x * 1.02, -0.278, 0.38), 0.047, 0.052)], n=6, up=(0, -1, 0), cap_push=0.3)
        fl = M.loft("fl" + sfx, [((x * 1.02, -0.278, 0.39), 0.044, 0.047), ((x, -0.295, 0.2), 0.033, 0.035),
                                 ((x, -0.31, 0.07), 0.035, 0.037)], n=6, up=(0, -1, 0), cap_push=0.3)
        fp = M.loft("fp" + sfx, [((x, -0.285, 0.058), 0.041, 0.038), ((x, -0.345, 0.04), 0.047, 0.037),
                                 ((x, -0.41, 0.03), 0.038, 0.027)], n=6, cap_push=0.4)
        bu = M.loft("bu" + sfx, [((x * 0.95, 0.30, 0.73), 0.09, 0.12), ((x * 1.06, 0.25, 0.53), 0.085, 0.105),
                                 ((x * 1.03, 0.195, 0.4), 0.052, 0.056)], n=6, up=(0, -1, 0), cap_push=0.3)
        bl = M.loft("bl" + sfx, [((x * 1.03, 0.19, 0.405), 0.048, 0.05), ((x, 0.255, 0.26), 0.035, 0.039),
                                 ((x, 0.31, 0.165), 0.033, 0.038), ((x, 0.295, 0.07), 0.032, 0.035)], n=6, up=(0, -1, 0), cap_push=0.3)
        bp = M.loft("bp" + sfx, [((x, 0.305, 0.058), 0.039, 0.036), ((x, 0.25, 0.04), 0.045, 0.036),
                                 ((x, 0.19, 0.03), 0.036, 0.026)], n=6, cap_push=0.4)
        for obj, mat, bone in ((fu, fur, "front_upper"), (fl, leg, "front_lower"), (fp, light, "front_paw"),
                               (bu, fur, "back_upper"), (bl, leg, "back_lower"), (bp, light, "back_paw")):
            M.jitter(obj, 0.006, zlib.crc32(obj.name.encode()))
            if bone in ("front_upper", "back_upper"):
                M.paint(obj, [back, mat], lambda c, n: 0 if n.z > 0.5 else 1)
            else:
                obj.data.materials.clear()
                obj.data.materials.append(mat)
            R.rigid(obj, bone + sfx)
            parts.append(obj)

    # ---------------------------------------------------------------- bushy tail
    tail = M.loft("tail", [
        ((0, 0.39, 0.77), 0.05, 0.05),
        ((0, 0.47, 0.72), 0.08, 0.085),
        ((0, 0.55, 0.645), 0.1, 0.105),
        ((0, 0.62, 0.55), 0.095, 0.1),
        ((0, 0.67, 0.455), 0.068, 0.072),
        ((0, 0.70, 0.375), 0.026, 0.028),
    ], n=8, up=(0, -1, 0), cap_push=0.6)
    M.jitter(tail, 0.014, 21)
    M.paint(tail, [back, fur, light], lambda c, n: 0 if (c.z < 0.5 or n.y < -0.5) else 2 if n.y > 0.55 and c.z > 0.5 else 1)
    R.blended(tail, R.by_bones(rig, ["hips", "tail_1", "tail_2"], sharp=4))
    parts.append(tail)

    for p in parts:
        if p.get("_head"):
            M.transform(p, loc=-HEAD_PIVOT)
            M.transform(p, scale=HEAD_SCALE)
            M.transform(p, loc=HEAD_PIVOT)
    R.skin(parts, rig, "Wolf")
    animate(rig)
    return rig


# ------------------------------------------------------------------------------------------------ animation
def animate(rig):
    A = R.Animator(rig)
    ankles = {k: rig.data.bones[v[1]].tail_local.copy() for k, v in LEGS.items()}

    def legs(pose, offs=None):
        """offs: {leg: (dy, dz, paw_pitch_deg)} relative to the rest ankle (armature space)."""
        offs = offs or {}
        for k, (up, lo, paw, pole) in LEGS.items():
            dy, dz, pr = offs.get(k, (0.0, 0.0, 0.0))
            A.solve_leg(pose, up, lo, ankles[k] + Vector((0, dy, dz)), (0, pole, 0), foot=paw, foot_rot=(pr, 0, 0))
        return pose

    # ---------------------------------------------------------------- Idle (2 s): breathing, panting, look around
    def idle(t):
        b = R.wave(t, 2)
        pose = {
            "root": {"t": (0, 0, -0.008 + 0.006 * b)},
            "spine": {"r": (0.8 * b, 0, 0)},
            "chest": {"r": (-1.2 * b, 0, 0), "t": (0, 0, 0.004 * b)},
            "neck": {"r": (2.5 * R.wave(t, 1, 0.25), 0, 0)},
            "head": {"r": (2.0 * R.wave(t, 2, 0.1), 0, 9 * R.wave(t, 1))},
            "jaw": {"r": (7 + 4 * R.wave(t, 4), 0, 0)},
            "tail_1": {"r": (0, 0, 6 * R.wave(t, 1))},
            "tail_2": {"r": (0, 0, 10 * R.wave(t, 1, -0.12))},
        }
        return legs(pose)

    A.clip("Idle", 48, idle)

    # ---------------------------------------------------------------- Walk: diagonal trot, 18 frames (0.75 s)
    phases = {"fl": 0.0, "br": 0.04, "fr": 0.5, "bl": 0.54}
    stride = {"fl": 0.17, "fr": 0.17, "bl": 0.155, "br": 0.155}
    lift = {"fl": 0.075, "fr": 0.075, "bl": 0.07, "br": 0.07}

    def foot(k, t):
        p = (t + phases[k]) % 1.0
        S = stride[k]
        if p < 0.5:  # stance: foot on the ground sliding back
            u = p / 0.5
            dy, dz = R.lerp(-S, S, u), 0.0
            pr = 18 * smooth((u - 0.75) / 0.25)  # heel lifts at push-off
        else:  # swing: lift and bring forward
            u = (p - 0.5) / 0.5
            dy = R.lerp(S, -S, smooth(u))
            dz = lift[k] * math.sin(math.pi * min(1.0, u * 1.1))
            curl = 75 if k[0] == "f" else 40
            pr = 18 * (1 - smooth(u / 0.2)) + curl * math.sin(math.pi * u) ** 1.5
        # rotating the paw pivots on the ankle: raise the ankle so the toes never dip under the ground
        dz += 0.1 * math.sin(math.radians(min(pr, 90)))
        return dy, dz, pr

    def walk(t):
        pose = {
            "root": {"t": (0, 0.02, -0.042 + 0.013 * R.wavec(t, 2))},
            "hips": {"r": (1.5 * R.wavec(t, 2, 0.1), 3.5 * R.wave(t, 1), 0)},
            "spine": {"r": (0, 0, 2.5 * R.wave(t, 1))},
            "chest": {"r": (-1.5 * R.wavec(t, 2), -3.5 * R.wave(t, 1), -2 * R.wave(t, 1))},
            "neck": {"r": (-6 + 3 * R.wavec(t, 2, 0.15), 0, 0)},
            "head": {"r": (8 - 3 * R.wavec(t, 2, 0.15), 0, 0)},
            "jaw": {"r": (10 + 3 * R.wave(t, 2), 0, 0)},
            "tail_1": {"r": (-14, 0, 9 * R.wave(t, 1, -0.1))},
            "tail_2": {"r": (-12, 0, 14 * R.wave(t, 1, -0.22))},
        }
        return legs(pose, {k: foot(k, t) for k in LEGS})

    A.clip("Walk", 18, walk)

    # ---------------------------------------------------------------- Attack: crouch, lunge + bite. 15 frames
    ry = Track([(0, 0), (0.28, 0.1), (0.46, -0.3, ease_out), (0.62, -0.28), (1, 0)])
    rz = Track([(0, 0), (0.28, -0.1), (0.42, 0.04), (0.56, 0.0), (0.7, -0.03), (1, 0)])
    pitch = Track([(0, 0), (0.28, 4), (0.44, -10), (0.6, 5), (0.8, 1), (1, 0)])
    neckx = Track([(0, 0), (0.28, 16), (0.44, -2), (0.54, 14), (0.75, 4), (1, 0)])
    headx = Track([(0, 0), (0.28, -12), (0.44, 2), (0.54, 12), (0.8, 2), (1, 0)])
    jawx = Track([(0, 0), (0.24, 4), (0.44, 42, ease_out), (0.52, 0, ease_in), (0.62, 6), (1, 0)])
    headz = Track([(0, 0), (0.52, 0), (0.6, 10), (0.7, -8), (0.82, 3), (1, 0)])
    fy = Track([(0, 0), (0.28, 0.02), (0.44, -0.36), (0.58, -0.3), (1, 0)])
    fz = Track([(0, 0), (0.28, 0), (0.4, 0.2), (0.52, 0.12), (0.6, 0.0, ease_in), (1, 0)])
    fp = Track([(0, 0), (0.3, 0), (0.42, 40), (0.56, 10), (0.62, 0), (1, 0)])
    by = Track([(0, 0), (0.3, 0), (0.46, -0.1), (0.7, -0.1), (1, 0)])
    bz = Track([(0, 0), (0.3, 0), (0.4, 0.03), (0.5, 0.0), (1, 0)])
    tailx = Track([(0, 0), (0.28, -10), (0.5, -25), (1, 0)])

    def attack(t):
        pose = {
            "root": {"t": (0, ry(t), rz(t))},
            "hips": {"r": (pitch(t) * 0.5, 0, 0)},
            "spine": {"r": (pitch(t) * 0.5, 0, 0)},
            "neck": {"r": (neckx(t), 0, 0)},
            "head": {"r": (headx(t), 0, headz(t))},
            "jaw": {"r": (jawx(t), 0, 0)},
            "tail_1": {"r": (tailx(t), 0, 0)},
            "tail_2": {"r": (tailx(t) * 0.6, 0, 0)},
        }
        f = (fy(t), fz(t), fp(t))
        b = (by(t), bz(t), 0)
        f2 = (fy(t) + 0.03, fz(t) * 0.8, fp(t))
        return legs(pose, {"fl": f, "fr": f2, "bl": b, "br": b})

    A.clip("Attack", 15, attack)

    # ---------------------------------------------------------------- Hit: flinch back, yelp. 9 frames
    hy = Track([(0, 0), (0.3, 0.09, ease_out), (1, 0)])
    hz = Track([(0, 0), (0.3, -0.03), (1, 0)])
    hk = Track([(0, 0), (0.3, 1, ease_out), (0.55, 0.8), (1, 0)])

    def hit(t):
        k = hk(t)
        pose = {
            "root": {"t": (0, hy(t), hz(t))},
            "spine": {"r": (3 * k, 0, 4 * k)},
            "chest": {"r": (-6 * k, 0, 0)},
            "neck": {"r": (-14 * k, 0, 0)},
            "head": {"r": (-12 * k, 0, -8 * k)},
            "jaw": {"r": (22 * k, 0, 0)},
            "tail_1": {"r": (22 * k, 0, 0)},
            "tail_2": {"r": (15 * k, 0, 0)},
        }
        return legs(pose)

    A.clip("Hit", 9, hit)

    # ---------------------------------------------------------------- Death: stagger, collapse on its side. 29 frames
    roll = Track([(0, 0), (0.18, -6), (0.3, 4), (0.66, 90, ease_in), (0.76, 82, ease_out), (0.88, 88), (1, 87)])
    sink = Track([(0, 0), (0.2, -0.02), (0.35, -0.05), (0.66, 0.02), (1, 0.05)])
    slide = Track([(0, 0), (0.3, 0), (0.7, -0.3), (1, -0.32)])  # keep the corpse near the entity origin
    k1 = Track([(0, 0), (0.18, 1), (0.4, 0.4), (1, 0)])       # yelp
    kl = Track([(0, 0), (0.2, 0.2), (0.6, 1), (1, 1)])         # limp legs / body
    kh = Track([(0, 0), (0.62, 0.3), (0.78, 1, ease_out), (0.88, 0.85), (1, 0.95)])  # head hits the ground

    def death(t):
        th = roll(t)
        a = math.radians(th)
        px = 0.13  # fall pivots on the left paws
        tx = px - px * math.cos(a)
        tz = px * math.sin(a)
        l, y, h = kl(t), k1(t), kh(t)
        pose = {
            "root": {"t": (tx + slide(t), 0.02 * l, tz + sink(t)), "r": (0, th, 0)},
            "spine": {"r": (0, 0, 4 * l)},
            "chest": {"r": (-8 * y, 0, 0)},
            "neck": {"r": (-22 * y + 18 * h, 0, -10 * h)},
            "head": {"r": (-10 * y + 8 * h, 0, -6 * h)},
            "jaw": {"r": (26 * y + 12 * l, 0, 0)},
            "tail_1": {"r": (10 * l, 0, 18 * l)},
            "tail_2": {"r": (4 * l, 0, 12 * l)},
        }
        for sfx, s in ((".L", 1), (".R", -1)):
            e = 0.8 if s > 0 else 1.0  # slightly asymmetric
            droop = 0.0 if s > 0 else -24 * l  # upper (right) legs sag towards the ground
            pose["front_upper" + sfx] = {"r": (-24 * l * e, droop, 0)}
            pose["front_lower" + sfx] = {"r": (30 * l * e, 0, 0)}
            pose["front_paw" + sfx] = {"r": (20 * l, 0, 0)}
            pose["back_upper" + sfx] = {"r": (22 * l / e, droop * 0.8, 0)}
            pose["back_lower" + sfx] = {"r": (-10 * l, 0, 0)}
            pose["back_paw" + sfx] = {"r": (25 * l, 0, 0)}
        if t < 0.4:  # still standing: paws planted (IK) while it staggers, blending into the limp fall
            w = 1 - smooth(t / 0.4)
            ik = legs({k: dict(v) for k, v in pose.items() if k in ("root", "hips", "spine", "chest")})
            for bone in [b for leg in LEGS.values() for b in leg[:3]]:
                pose[bone] = {"q": R.blend_delta(pose[bone], ik[bone], w)}
        return pose

    A.clip("Death", 29, death)
    A.rest_pose()
