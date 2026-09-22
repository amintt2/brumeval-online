"""Golem ("Golem ancien", boss): ~4 m tall stone golem built from chunky jittered rock blocks, moss patches,
glowing cyan runes, an orange core in the chest, huge fists and short thick legs. Faces -Y.

Rig (humanoid-like): root, hips, spine, chest, head, upper_arm/forearm/hand .L/.R, thigh/shin/foot .L/.R.
Every rock is rigidly bound to one bone (no stretching). Legs use two-bone IK so feet stay planted.
"""
import math
import zlib

from mathutils import Vector

import common as C
import meshkit as M
import rigkit as R
from rigkit import Track, ease_in, ease_out, smooth

PREVIEW = ("Idle", 0)
CLIPS = ("Idle", "Walk", "Attack", "Hit", "Death")
SHEET_SIZE = 240
SHEET = [("Idle", [0, 12, 24, 36]), ("Walk", [0, 4, 8, 12, 16, 20]), ("Attack", [0, 5, 8, 10, 12, 16]),
         ("Hit", [0, 3, 6, 10]), ("Death", [0, 7, 14, 20, 26, 36])]
SIDE_SHEET = [("Walk", [0, 3, 6, 9, 12, 15, 18, 21]), ("Attack", [0, 4, 7, 9, 10, 12, 15, 20]),
              ("Death", [0, 6, 10, 14, 18, 22, 28, 36])]

SH = 1.08    # shoulder joint half width
HIPX = 0.55  # hip joint half width

BONES = [
    ("root", (0, 0, 0), (0, -0.6, 0), None),
    ("hips", (0, 0.05, 1.45), (0, 0.05, 1.92), "root"),
    ("spine", (0, 0.05, 1.92), (0, 0.1, 2.45), "hips"),
    ("chest", (0, 0.1, 2.45), (0, 0.08, 3.3), "spine"),
    ("head", (0, -0.28, 3.28), (0, -0.34, 3.95), "chest"),
]
for sfx, s in ((".L", 1), (".R", -1)):
    BONES += [
        ("upper_arm" + sfx, (SH * s, 0.1, 3.12), (1.3 * s, 0.12, 2.25), "chest"),
        ("forearm" + sfx, (1.3 * s, 0.12, 2.25), (1.4 * s, -0.04, 1.34), "upper_arm" + sfx),
        ("hand" + sfx, (1.4 * s, -0.04, 1.34), (1.42 * s, -0.12, 0.72), "forearm" + sfx),
        ("thigh" + sfx, (HIPX * s, 0.05, 1.45), (0.6 * s, -0.16, 0.8), "hips"),
        ("shin" + sfx, (0.6 * s, -0.16, 0.8), (0.62 * s, 0.05, 0.25), "thigh" + sfx),
        ("foot" + sfx, (0.62 * s, 0.05, 0.25), (0.62 * s, -0.55, 0.05), "shin" + sfx),
    ]

LEGS = {"l": ("thigh.L", "shin.L", "foot.L"), "r": ("thigh.R", "shin.R", "foot.R")}


def _seed(name):
    return zlib.crc32(name.encode())


def build():
    stone = C.material("golem_stone", C.hex_color("#8c8479"), rough=0.92)
    dark = C.material("golem_stone_dark", C.hex_color("#6a6258"), rough=0.95)
    light = C.material("golem_stone_light", C.hex_color("#a79e90"), rough=0.9)
    moss = C.material("golem_moss", C.hex_color("#5d8a33"), rough=0.95)
    moss2 = C.material("golem_moss_light", C.hex_color("#7eaa45"), rough=0.95)
    rune = C.material("golem_rune", C.hex_color("#5ee9ff"), rough=0.4, emit=C.hex_color("#42dcff"), emit_strength=3.0)
    core = C.material("golem_core", C.hex_color("#ffb347"), rough=0.3, emit=C.hex_color("#ff9a1f"), emit_strength=5.0)
    crystal = C.material("golem_crystal", C.hex_color("#7fe6f5"), rough=0.2, emit=C.hex_color("#3cc8e6"), emit_strength=1.6)

    rig = R.build_armature(BONES)
    parts = []

    def add(obj, bone):
        R.rigid(obj, bone)
        parts.append(obj)
        return obj

    def blk(name, bone, size, loc, mat=stone, rot=(0, 0, 0), jit=0.05, bevel=0.16, taper=1.0):
        return add(M.block(name, size, mat, loc=loc, rot=rot, bevel=bevel, jit=jit, seed=_seed(name), taper=taper), bone)

    def rk(name, bone, r, loc, mat=stone, scale=(1, 1, 1), rot=(0, 0, 0), jit=0.14):
        return add(M.rock(name, r, mat, loc=loc, rot=rot, scale=scale, jit=jit, seed=_seed(name)), bone)

    def mossy(name, bone, r, loc, scale=(1.2, 1.0, 0.32), rot=(0, 0, 0), mat=None):
        sc = (scale[0], scale[1], scale[2] * 0.7)  # thin caps hugging the stone
        return rk(name, bone, r, (loc[0], loc[1], loc[2] - r * scale[2] * 0.25), mat or moss, scale=sc, rot=rot, jit=0.22)

    def glyph(name, bone, g, c, n, size, spin=0.0, up=(0, 0, 1)):
        return add(M.rune(name, g, c, n, size, rune, up=up, spin=spin), bone)

    # ------------------------------------------------------------------ pelvis / belly
    blk("pelvis", "hips", (1.42, 0.98, 0.62), (0, 0.05, 1.52), dark)
    blk("pelvis_f", "hips", (0.7, 0.3, 0.4), (0, -0.43, 1.42), stone, rot=(8, 0, 0))
    for s in (1, -1):
        blk(f"hipplate{s}", "hips", (0.5, 0.8, 0.5), (0.72 * s, 0.05, 1.56), stone, rot=(0, 12 * s, 0))
    blk("belly", "spine", (1.28, 1.0, 0.72), (0, 0.08, 2.08), stone, taper=1.08)
    blk("belly_f", "spine", (0.8, 0.28, 0.5), (0, -0.46, 2.05), light, rot=(-6, 0, 0))
    glyph("rune_belly", "spine", "zig", (0, -0.62, 2.06), (0, -1, 0), 0.16)

    # ------------------------------------------------------------------ chest: two massive pecs, hunched back
    for s in (1, -1):
        blk(f"pec{s}", "chest", (1.02, 1.3, 1.02), (0.57 * s, 0.1, 2.86), stone, rot=(0, -4 * s, 3 * s), jit=0.06)
        blk(f"flank{s}", "chest", (0.45, 0.9, 0.7), (1.0 * s, 0.2, 2.62), dark, rot=(0, 10 * s, 0))
        glyph(f"rune_side{s}", "chest", "diamond", (1.25 * s, 0.2, 2.64), (s, 0, 0), 0.14)
    blk("hump", "chest", (1.75, 0.95, 0.9), (0, 0.52, 3.22), dark, rot=(12, 0, 0), jit=0.07)
    blk("collar", "chest", (1.3, 0.8, 0.4), (0, 0.1, 3.4), stone, rot=(6, 0, 0))
    mossy("moss_hump", "chest", 0.42, (0.15, 0.55, 3.66), scale=(1.6, 1.1, 0.35), rot=(12, 0, 20))
    mossy("moss_hump2", "chest", 0.28, (-0.45, 0.72, 3.52), scale=(1.3, 1.0, 0.35), rot=(20, 0, -30), mat=moss2)
    # glowing core in a dark socket, runes radiating from it
    add(M.rock("core", 0.26, core, loc=(0, -0.66, 2.86), jit=0.08, seed=5), "chest")
    for i, (x, z, sx, sz) in enumerate(((0, 3.16, 0.5, 0.16), (0, 2.56, 0.5, 0.16), (0.26, 2.86, 0.16, 0.5), (-0.26, 2.86, 0.16, 0.5))):
        blk(f"socket{i}", "chest", (sx, 0.3, sz), (x, -0.56, z), dark, jit=0.02, bevel=0.05)
    for i, (x0, z0, x1, z1) in enumerate(((0.3, 2.95, 0.55, 3.25), (-0.3, 2.95, -0.55, 3.25), (0.3, 2.75, 0.5, 2.5), (-0.3, 2.75, -0.5, 2.5))):
        bar = M.block_between(f"coreline{i}", (x0, -0.585, z0), (x1, -0.585, z1), 0.05, 0.06, rune, bevel=0.0, jit=0.0)
        add(bar, "chest")
    # crystals growing out of the back
    for i, (x, y, z, rx, ry, h) in enumerate(((0.38, 0.85, 3.45, -35, 15, 0.7), (-0.3, 0.9, 3.5, -40, -12, 0.85),
                                              (0.02, 0.98, 3.2, -55, 0, 0.6), (0.62, 0.72, 3.15, -30, 40, 0.45))):
        cr = M.cone(f"crystal{i}", 0.13, 0.0, h, n=5, mat=crystal, loc=(x, y, z), rot=(rx, ry, 0))
        add(cr, "chest")

    # ------------------------------------------------------------------ head: sunk between the shoulders
    blk("head", "head", (0.78, 0.74, 0.64), (0, -0.58, 3.6), stone, jit=0.04)
    blk("brow", "head", (0.94, 0.36, 0.2), (0, -0.87, 3.81), dark, rot=(-14, 0, 0), jit=0.03)
    blk("jaw", "head", (0.66, 0.54, 0.28), (0, -0.7, 3.26), dark, jit=0.03)
    for s in (1, -1):
        add(M.block(f"eye{s}", (0.24, 0.12, 0.12), rune, loc=(0.2 * s, -0.96, 3.63), rot=(0, 10 * s, -10 * s), bevel=0.03, jit=0), "head")
        blk(f"cheek{s}", "head", (0.2, 0.44, 0.34), (0.39 * s, -0.66, 3.48), stone, jit=0.03)
        blk(f"tusk{s}", "head", (0.11, 0.11, 0.22), (0.23 * s, -0.96, 3.26), light, rot=(12, 0, 0), jit=0.0, bevel=0.03)
    mossy("moss_head", "head", 0.28, (0.08, -0.52, 3.93), scale=(1.3, 1.15, 0.3), rot=(0, 0, 25))

    # ------------------------------------------------------------------ arms
    for sfx, s in ((".L", 1), (".R", -1)):
        ua, fa, hd = "upper_arm" + sfx, "forearm" + sfx, "hand" + sfx
        rk("shoulder" + sfx, ua, 0.52, (1.1 * s, 0.1, 3.3), stone, scale=(1.15, 1.05, 0.85))
        mossy("moss_sh" + sfx, ua, 0.36, (1.14 * s, 0.08, 3.68), scale=(1.4, 1.2, 0.3))
        add(M.block_between("uarm" + sfx, (1.14 * s, 0.1, 3.0), (1.3 * s, 0.12, 2.25), 0.66, 0.64, stone,
                            extend=0.1, jit=0.05, seed=_seed("uarm" + sfx)), ua)
        rk("elbow" + sfx, fa, 0.36, (1.3 * s, 0.14, 2.24), dark, scale=(1, 1, 0.9))
        add(M.block_between("farm" + sfx, (1.31 * s, 0.1, 2.2), (1.4 * s, -0.04, 1.36), 0.72, 0.72, stone,
                            extend=0.05, jit=0.05, seed=_seed("farm" + sfx), taper=1.25), fa)
        mossy("moss_fa" + sfx, fa, 0.25, (1.32 * s, 0.02, 2.02), scale=(1.2, 1.2, 0.35), rot=(0, 20 * s, 0), mat=moss2)
        glyph("rune_fa" + sfx, fa, "algiz", (1.76 * s, 0.03, 1.72), (s, 0, 0), 0.17)
        # huge fist + knuckles + thumb
        blk("fist" + sfx, hd, (0.92, 0.92, 0.8), (1.42 * s, -0.1, 0.98), stone, jit=0.06)
        for i, dx in enumerate((-0.26, 0.0, 0.26)):
            blk(f"knuckle{i}{sfx}", hd, (0.24, 0.22, 0.26), ((1.42 + dx) * s, -0.58, 0.88), light, jit=0.03, bevel=0.06)
        blk("thumb" + sfx, hd, (0.22, 0.34, 0.3), ((1.42 - 0.47) * s, -0.36, 1.08), light, rot=(0, 0, 15 * s), jit=0.03, bevel=0.06)
        blk("wrist" + sfx, hd, (0.62, 0.62, 0.3), (1.41 * s, -0.06, 1.38), dark, jit=0.03)

    # ------------------------------------------------------------------ legs
    for sfx, s in ((".L", 1), (".R", -1)):
        th, sh, ft = "thigh" + sfx, "shin" + sfx, "foot" + sfx
        add(M.block_between("thighb" + sfx, (0.56 * s, 0.05, 1.45), (0.6 * s, -0.12, 0.84), 0.8, 0.82, stone,
                            extend=0.12, jit=0.05, seed=_seed("thighb" + sfx)), th)
        glyph("rune_th" + sfx, th, "raido" if s > 0 else "algiz", (0.62 * s, -0.49, 1.15), (0, -1, 0.1), 0.13)
        rk("knee" + sfx, sh, 0.3, (0.61 * s, -0.26, 0.8), light, scale=(1, 0.9, 1))
        add(M.block_between("shinb" + sfx, (0.6 * s, -0.12, 0.8), (0.62 * s, 0.05, 0.27), 0.74, 0.74, dark,
                            extend=0.05, jit=0.05, seed=_seed("shinb" + sfx), taper=1.1), sh)
        blk("footb" + sfx, ft, (0.92, 1.18, 0.34), (0.62 * s, -0.16, 0.205), stone, jit=0.035)
        for i, dx in enumerate((-0.28, 0.0, 0.28)):
            blk(f"toe{i}{sfx}", ft, (0.26, 0.28, 0.24), ((0.62 + dx) * s, -0.8, 0.15), light, jit=0.03, bevel=0.07)
        mossy("moss_ft" + sfx, ft, 0.2, (0.66 * s, -0.25, 0.36), scale=(1.4, 1.3, 0.35), mat=moss2)

    mesh = R.skin(parts, rig, "Golem")
    tri = sum(len(p.vertices) - 2 for p in mesh.data.polygons)
    print(f"[golem] triangles: {tri}")
    animate(rig)
    return rig


# ------------------------------------------------------------------------------------------------ animation
def animate(rig):
    A = R.Animator(rig)
    ankles = {k: rig.data.bones[v[1]].tail_local.copy() for k, v in LEGS.items()}

    def legs(pose, offs=None):
        offs = offs or {}
        for k, (th, sh, ft) in LEGS.items():
            dx, dy, dz, fr = offs.get(k, (0.0, 0.0, 0.0, 0.0))
            A.solve_leg(pose, th, sh, ankles[k] + Vector((dx, dy, dz)), (0, -1, 0), foot=ft, foot_rot=(fr, 0, 0))
        return pose

    def arms(pose, ua, fa, hd=(0, 0, 0), mirror=True):
        """ua/fa/hd euler for the LEFT arm; mirrored (y, z negated) on the right."""
        pose["upper_arm.L"] = {"r": ua}
        pose["forearm.L"] = {"r": fa}
        pose["hand.L"] = {"r": hd}
        m = (lambda e: (e[0], -e[1], -e[2])) if mirror else (lambda e: e)
        pose["upper_arm.R"] = {"r": m(ua)}
        pose["forearm.R"] = {"r": m(fa)}
        pose["hand.R"] = {"r": m(hd)}
        return pose

    # ---------------------------------------------------------------- Idle: slow heavy breathing (2 s)
    def idle(t):
        b = R.wave(t, 1)         # one deep breath per loop
        b2 = R.wave(t, 1, -0.08)  # arms lag a little
        pose = {
            "root": {"t": (0, 0, -0.03 - 0.02 * b)},
            "hips": {"r": (1.0 * b, 0, 0)},
            "spine": {"r": (-1.5 * b, 0, 0)},
            "chest": {"r": (-2.5 * b, 0, 0), "t": (0, 0, 0.035 * b)},
            "head": {"r": (2.5 * b + 1.5 * R.wave(t, 2), 0, 3 * R.wave(t, 1, 0.3))},
        }
        arms(pose, (2.5 * b2, 0, -3 - 2.5 * b2), (-6 - 3 * b2, 0, 0), (-4 * b2, 0, 0))
        return legs(pose)

    A.clip("Idle", 48, idle)

    # ---------------------------------------------------------------- Walk: heavy stomp, 24 frames (1 s)
    duty = 0.58
    stride, lift = 0.5, 0.34

    def foot(t, ph):
        p = (t + ph) % 1.0
        if p < duty:
            u = p / duty
            return 0.0, R.lerp(-stride, stride, u), 0.0, 0.0
        u = (p - duty) / (1 - duty)
        dy = R.lerp(stride, -stride, smooth(u))
        dz = lift * math.sin(math.pi * u) ** 0.8
        fr = -14 * math.sin(math.pi * u)  # toes up while swinging
        # toes-up pivots on the ankle and would push the heel (0.4 m behind it) into the ground
        return 0.0, dy, dz + 0.42 * math.sin(math.radians(-fr)), fr

    impact = lambda t: math.exp(-((t % 0.5) / 0.07) ** 2) + math.exp(-(((t % 0.5) - 0.5) / 0.07) ** 2)  # noqa: E731

    def walk(t):
        sway = R.wave(t, 1)  # + while the left foot carries the weight
        bob = -0.12 - 0.06 * R.wavec(t, 2, -0.12) - 0.05 * impact(t)
        pose = {
            "root": {"t": (0.1 * sway, 0, bob)},
            "hips": {"r": (2, -4 * sway, 7 * R.wave(t, 1, 0.05))},
            "spine": {"r": (4, 2 * sway, -3 * R.wave(t, 1, 0.05))},
            "chest": {"r": (3 + 3 * impact(t), 3 * sway, -6 * R.wave(t, 1, 0.08))},
            "head": {"r": (-6 - 2 * impact(t), -2 * sway, 3 * R.wave(t, 1, 0.08))},
        }
        sw = 20 * R.wavec(t, 1)  # left arm back when the left foot is forward (t=0)
        pose["upper_arm.L"] = {"r": (sw, 0, -4)}
        pose["upper_arm.R"] = {"r": (-sw, 0, 4)}
        pose["forearm.L"] = {"r": (-14 - 10 * R.wavec(t, 1, 0.1), 0, 0)}
        pose["forearm.R"] = {"r": (-14 + 10 * R.wavec(t, 1, 0.1), 0, 0)}
        pose["hand.L"] = {"r": (-6 * R.wavec(t, 1, 0.15), 0, 0)}
        pose["hand.R"] = {"r": (6 * R.wavec(t, 1, 0.15), 0, 0)}
        return legs(pose, {"l": foot(t, 0.0), "r": foot(t, 0.5)})

    A.clip("Walk", 24, walk)

    # ---------------------------------------------------------------- Attack: double-fist overhead slam. 20 frames
    kUp = Track([(0, 0), (0.38, 1, ease_out), (0.46, 1.03), (0.56, 0, ease_in), (1, 0)])
    kDn = Track([(0, 0), (0.46, 0), (0.56, 1, ease_in), (0.72, 1), (1, 0)])
    squat = Track([(0, 0), (0.3, 0.1), (0.46, 0.05), (0.58, 0.36, ease_in), (0.72, 0.33), (1, 0)])
    back = Track([(0, 0), (0.38, 0.12), (0.5, 0.0), (0.6, -0.12), (1, 0)])
    shake = lambda t: 2.5 * math.sin(t * 90) * math.exp(-((t - 0.6) / 0.08) ** 2)  # noqa: E731

    def attack(t):
        u, d = kUp(t), kDn(t)
        pose = {
            "root": {"t": (0, back(t), -squat(t))},
            "hips": {"r": (-4 * u + 14 * d, 0, 0)},
            "spine": {"r": (-8 * u + 16 * d, 0, 0)},
            "chest": {"r": (-12 * u + 18 * d + shake(t), 0, 0)},
            "head": {"r": (-12 * u - 16 * d, 0, 0)},
        }
        arms(pose, (-160 * u - 72 * d, -20 * u, -22 * d), (-35 * u - 10 * d, 0, 0), (-10 * u + 10 * d, 0, 0))
        return legs(pose)

    A.clip("Attack", 20, attack)

    # ---------------------------------------------------------------- Hit: recoil. 10 frames
    hk = Track([(0, 0), (0.28, 1, ease_out), (0.6, 0.55), (1, 0)])

    def hit(t):
        k = hk(t)
        pose = {
            "root": {"t": (0, 0.14 * k, -0.06 * k)},
            "hips": {"r": (-3 * k, 0, 2 * k)},
            "spine": {"r": (-5 * k, 0, 0)},
            "chest": {"r": (-10 * k, 0, 4 * k)},
            "head": {"r": (-18 * k, 0, -6 * k)},
        }
        arms(pose, (-14 * k, 0, -14 * k), (-20 * k, 0, 0), (-10 * k, 0, 0))
        return legs(pose)

    A.clip("Hit", 10, hit)

    # ---------------------------------------------------------------- Death: roars, drops to its knees, topples
    # face-down; on impact the head breaks off and the fists crack loose. 36 frames (1.5 s)
    kR = Track([(0, 0), (0.14, 1, ease_out), (0.3, 0.15), (0.45, 0)])                 # recoil / roar
    kK = Track([(0, 0), (0.14, 0), (0.4, 1, ease_in), (0.46, 0.95), (1, 1)])          # knees buckle
    kF = Track([(0, 0), (0.42, 0), (0.74, 1, ease_in), (0.8, 0.94, ease_out), (0.88, 1.0), (1, 1)])  # topple
    kC = Track([(0, 0), (0.72, 0), (0.84, 1, ease_out), (1, 1)])                    # crumble on impact
    shake = lambda t: math.sin(t * 120) * math.exp(-((t - 0.76) / 0.06) ** 2)  # noqa: E731

    def death(t):
        r, k, f, c = kR(t), kK(t), kF(t), kC(t)
        pose = {
            "root": {"t": (0, 0.25 * k + 0.1 * f, -0.7 * k + 0.28 * f)},
            "hips": {"r": (6 * k + 70 * f + 2 * shake(t), 0, 3 * k - 3 * f)},
            "spine": {"r": (-6 * r + 6 * k + 6 * f, 0, -4 * k)},
            "chest": {"r": (-14 * r + 6 * k + 4 * f, 0, 4 * k)},
            "head": {"r": (-28 * r + 12 * k - 40 * f - 20 * c, 25 * c, 18 * c),
                     "t": (0.15 * c, 0.1 * c, 0.3 * c)},
        }
        # arms: flung up by the roar, hang limp while kneeling, lie along the flanks once face-down
        arms(pose, (-40 * r + 8 * k - 18 * f, -6 * f, -24 * r - 4 * k - 10 * f), (-25 * r - 18 * k + 14 * f, 0, 0), (0, 0, 0))
        pose["forearm.L"]["t"] = (0.14 * c, 0.05 * c, -0.1 * c)
        pose["forearm.R"]["t"] = (-0.1 * c, 0.08 * c, -0.12 * c)
        pose["hand.L"]["t"] = (0.22 * c, 0.1 * c, -0.05 * c)
        pose["hand.L"]["r"] = (30 * c, 25 * c, 20 * c)
        pose["hand.R"]["t"] = (-0.2 * c, 0.16 * c, -0.05 * c)
        pose["hand.R"]["r"] = (40 * c, -20 * c, -30 * c)
        return legs(pose)

    A.clip("Death", 36, death)
    A.rest_pose()
