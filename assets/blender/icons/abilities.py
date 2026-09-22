"""Ability icon builders (ab_<abilityId>): bright symbolic 3D emblem, rendered over an opaque backdrop tinted with
the colour of the class that owns the ability (CLASSES[*].color / CLASSES[*].abilities in shared/data.js)."""
import math
import os
import random
import re

from mathutils import Vector

import common as C
import geo as G

# Fallback if shared/data.js cannot be parsed (kept identical to shared/data.js).
_FALLBACK = {
    "warrior": ("#c0392b", ["strike", "heavy_blow", "whirlwind", "war_cry"]),
    "mage": ("#2e6fd8", ["firebolt", "fireball", "frost_nova", "heal"]),
    "ranger": ("#2e9e4f", ["shot", "piercing_shot", "arrow_rain", "rapid_fire"]),
}


def _class_colours():
    """ability id -> class colour, read from shared/data.js so the icons follow the game data."""
    out = {}
    try:
        src = open(os.path.join(C.ROOT, "shared", "data.js"), encoding="utf-8").read()
        block = re.search(r"export const CLASSES = \{(.*?)\n\};", src, re.S).group(1)
        for m in re.finditer(r"color:\s*'(#[0-9a-fA-F]{6})'.*?abilities:\s*\[([^\]]*)\]", block, re.S):
            for ab in re.findall(r"'([a-z_]+)'", m.group(2)):
                out[ab] = m.group(1)
    except (OSError, AttributeError):
        pass
    for col, abs_ in _FALLBACK.values():
        for ab in abs_:
            out.setdefault(ab, col)
    return out


COLOURS = _class_colours()


# --------------------------------------------------------------------------- shared emblem parts
def mini_sword(prefix, length=1.0, width=0.12, steel_hex="#e8eef5"):
    """Chunky sword along +Z (hilt at the origin), flat faces towards the camera."""
    steel = G.M("EmSteel", steel_hex, 0.25, 0.55)
    gold = G.M("EmGold", "#f0bd4c", 0.28, 0.85)
    grip = G.M("EmGrip", "#5a3620", 0.85)
    t = width * 0.22
    secs = []
    for i in range(4):
        z = 0.08 + length * 0.8 * i / 3
        w = width * (1 - 0.15 * i / 3)
        secs.append([(-w, 0, z), (-w * 0.5, -t, z), (w * 0.5, -t, z), (w, 0, z), (w * 0.5, t, z), (-w * 0.5, t, z)])
    secs.append([(0, 0, 0.08 + length)])
    parts = [G.loft(f"{prefix}Blade", secs, steel)]
    parts.append(G.box(f"{prefix}Guard", (width * 3.2, width * 0.7, width * 0.55), gold, loc=(0, 0, 0.05), bevel=0.012))
    parts.append(G.cyl(f"{prefix}Grip", width * 0.32, length * 0.26, 8, grip, loc=(0, 0, -length * 0.13)))
    parts.append(G.uvsphere(f"{prefix}Pommel", width * 0.55, 10, 8, gold, loc=(0, 0, -length * 0.27)))
    return parts


def arrow(prefix, length=1.3, head_mat=None, fletch_hex="#d8443a", glow_head=None, scale=1.0):
    """Arrow along +Z: nock at z=0, tip at z=length. Chunky proportions for small icons."""
    wood = G.M("ArWood", "#c99a5c", 0.7)
    head = head_mat or G.M("ArHead", "#dfe6ee", 0.25, 0.6)
    fl = G.M(f"ArFletch{fletch_hex}", fletch_hex, 0.7)
    fl_w = G.M("ArFletchW", "#f4efe4", 0.7)
    s = scale
    parts = [G.rod(f"{prefix}Shaft", (0, 0, 0.02 * s), (0, 0, (length - 0.22) * s), 0.028 * s, 6, wood)]
    # broad-head: flattened diamond
    hz0 = (length - 0.26) * s
    ring = [(-0.09 * s, 0, hz0 + 0.06 * s), (0, -0.03 * s, hz0 + 0.03 * s), (0.09 * s, 0, hz0 + 0.06 * s), (0, 0.03 * s, hz0 + 0.03 * s)]
    parts.append(G.loft(f"{prefix}Head", [[(0, 0, hz0)], ring, [(0, 0, length * s)]], head))
    # fletching: three vanes
    for k in range(3):
        a = math.radians(90 + 120 * k)
        vane = [(0, 0.05), (0.13, 0.0), (0.13, 0.12), (0, 0.36)]
        o = G.extrude(f"{prefix}Vane{k}", [(x * s, z * s) for x, z in vane], 0.012 * s, fl if k else fl_w)
        o.rotation_euler = (0, 0, a)
        o.location = (0, 0, 0.02 * s)
        parts.append(o)
    parts.append(G.cyl(f"{prefix}Nock", 0.036 * s, 0.05 * s, 6, G.M("ArNock", "#3a2a1c", 0.7), loc=(0, 0, 0.02 * s)))
    if glow_head:
        parts.append(G.uvsphere(f"{prefix}Spark", 0.06 * s, 8, 6, glow_head, loc=(0, 0, length * s)))
    return parts


def streak_mat():
    return G.M("StreakMat", "#ffffff", 0.5, 0.0, emit="#f6fff0", strength=1.1, alpha=0.55)


def streak(name, p0, p1, width, mat):
    """Tapered motion streak (flat ribbon facing the camera)."""
    p0, p1 = Vector(p0), Vector(p1)
    pts = [tuple(p0.lerp(p1, i / 5)) for i in range(6)]
    widths = [width * w for w in (0.0, 0.5, 0.8, 1.0, 0.9, 0.5)]
    return G.ribbon(name, pts, widths, mat)


def star_shape(n, r_out, r_in, rot=0.0):
    pts = []
    for k in range(n * 2):
        a = math.radians(rot) + math.pi * k / n
        r = r_out if k % 2 == 0 else r_in
        pts.append((r * math.cos(a), r * math.sin(a)))
    return pts


def flame(name, base, direction, length, radius, mat, wiggle=0.0, seed=0, segs=8):
    """Flame tongue: tapered curved tube from `base` along `direction`."""
    rnd = random.Random(seed)
    d = Vector(direction).normalized()
    side = d.cross(Vector((0, 1, 0))).normalized()
    pts, radii = [], []
    n = 6
    for i in range(n + 1):
        t = i / n
        off = side * math.sin(t * math.pi * 1.3 + rnd.uniform(0, 1)) * wiggle * t
        pts.append(tuple(Vector(base) + d * (length * t) + off))
        radii.append(radius * (1 - t) ** 0.8 * (1 + 0.25 * math.sin(t * 3)))
    return G.tube(name, pts, radii, segs, mat, smooth=True)


# --------------------------------------------------------------------------- warrior
def ab_strike():
    parts = mini_sword("S", 1.15, 0.13)
    G.pose(parts, turn=20, roll=45)
    slash = G.glow("Slash", "#fff3c4", 3.0)
    slash2 = G.glow("Slash2", "#ffd36a", 2.2)
    arc1 = G.arc_points(0.95, 150, 40, 14, centre=(0.25, -0.2, -0.35))
    G.ribbon("SlashA", arc1, [0.0, 0.05, 0.09, 0.12, 0.14, 0.15, 0.15, 0.14, 0.12, 0.1, 0.08, 0.05, 0.02, 0.0], slash)
    arc2 = G.arc_points(0.78, 140, 60, 10, centre=(0.25, -0.18, -0.35))
    G.ribbon("SlashB", arc2, [0.0, 0.03, 0.05, 0.06, 0.06, 0.05, 0.04, 0.03, 0.015, 0.0], slash2)
    return dict(yaw=0, pitch=4, fill=0.82, glow=0.8, glow_sigma=6)


def ab_heavy_blow():
    wood = G.M("Haft", "#6b4526", 0.75)
    iron = G.M("HammerIron", "#9aa3ad", 0.3, 0.8)
    dark = G.M("HammerDark", "#5d646d", 0.4, 0.8)
    gold = G.M("EmGold", "#f0bd4c", 0.28, 0.85)
    parts = [G.rod("Haft", (0, 0, -0.9), (0, 0, 0.55), 0.055, 8, wood)]
    for i, z in enumerate((-0.55, -0.4)):
        parts.append(G.torus(f"Wrap{i}", 0.062, 0.02, 10, 5, G.M("Wrap", "#3b2414", 0.9), loc=(0, 0, z)))
    parts.append(G.box("Head", (0.78, 0.36, 0.4), iron, loc=(0, 0, 0.55), bevel=0.03))
    for sx in (-1, 1):
        parts.append(G.box(f"Face{sx}", (0.1, 0.42, 0.46), dark, loc=(sx * 0.42, 0, 0.55), bevel=0.02))
    parts.append(G.box("Band", (0.2, 0.38, 0.42), gold, loc=(0, 0, 0.55), bevel=0.015))
    parts.append(G.uvsphere("Pommel", 0.08, 10, 8, gold, loc=(0, 0, -0.92)))
    piv = G.pose(parts, turn=15, roll=-38)
    # impact burst at the striking face (lower right of the head after the pose)
    burst = G.glow("Burst", "#ffd84a", 3.0)
    burst2 = G.glow("Burst2", "#fff6d0", 4.0)
    fw = piv.matrix_world @ Vector((0.48, 0, 0.55))
    b = G.extrude("Burst", star_shape(8, 0.42, 0.17, 10), 0.03, burst, y=0)
    G.place(b, loc=(fw.x + 0.28, -0.35, fw.z - 0.2))
    b2 = G.extrude("BurstCore", star_shape(8, 0.22, 0.09, 32), 0.03, burst2, y=0)
    G.place(b2, loc=(fw.x + 0.28, -0.37, fw.z - 0.2))
    # swing arcs
    sw = G.glow("Swing", "#fff0c0", 1.8)
    G.ribbon("Swing1", G.arc_points(1.05, 175, 110, 9, centre=(0.25, 0.1, -0.5)),
             [0.0, 0.03, 0.06, 0.08, 0.09, 0.08, 0.06, 0.03, 0.0], sw)
    G.ribbon("Swing2", G.arc_points(0.8, 170, 118, 7, centre=(0.25, 0.1, -0.5)),
             [0.0, 0.03, 0.05, 0.05, 0.04, 0.02, 0.0], sw)
    return dict(yaw=0, pitch=4, fill=0.84, glow=0.8, glow_sigma=6)


def ab_whirlwind():
    parts = []
    for k in range(3):
        sw = mini_sword(f"W{k}", 0.72, 0.1)
        parts.append(G.pose(sw, roll=90 + 120 * k))
    swirl = G.glow("Swirl", "#fff3c8", 2.4)
    for k in range(3):
        a0 = 120 * k + 30
        pts = []
        widths = []
        for i in range(12):
            t = i / 11
            a = math.radians(a0 + 110 * t)
            r = 0.55 + 0.35 * t
            pts.append((r * math.cos(a), -0.2, r * math.sin(a)))
            widths.append(0.14 * math.sin(math.pi * t) + 0.01)
        G.ribbon(f"Swirl{k}", pts, widths, swirl)
    G.uvsphere("Hub", 0.12, 12, 8, G.glow("Hub", "#fff0b0", 3.0), loc=(0, -0.3, 0))
    return dict(yaw=0, pitch=0, fill=0.84, glow=0.7, glow_sigma=6)


def ab_war_cry():
    ivory = G.M("Ivory", "#f1e4c3", 0.5)
    gold = G.M("EmGold", "#f0bd4c", 0.28, 0.85)
    dark = G.M("HornIn", "#3b2616", 0.9)
    # curved horn from the mouthpiece (lower left) to the bell (upper right)
    path, radii = [], []
    n = 12
    for i in range(n + 1):
        t = i / n
        a = math.radians(200 - 120 * t)
        path.append((0.55 * math.cos(a) + 0.05, 0, 0.55 * math.sin(a) - 0.05 + 0.25 * t))
        radii.append(0.05 + 0.24 * t ** 1.8)
    G.tube("Horn", path, radii, 16, ivory, smooth=True)
    fr = G.frames(path)
    for k, idx in enumerate((3, 7, 11)):
        p, t, _n, _b = fr[idx]
        band = G.torus(f"Band{k}", radii[idx] * 1.03, 0.025, 20, 6, gold, loc=tuple(p))
        band.rotation_euler = Vector((0, 0, 1)).rotation_difference(t).to_euler()
    p, t, _n, _b = fr[-1]
    rim = G.torus("Rim", radii[-1], 0.035, 24, 6, gold, loc=tuple(p))
    rim.rotation_euler = Vector((0, 0, 1)).rotation_difference(t).to_euler()
    mouth = G.cyl("Mouth", radii[-1] * 0.92, 0.02, 20, dark, loc=tuple(p + t * 0.005))
    mouth.rotation_euler = Vector((0, 0, 1)).rotation_difference(t).to_euler()
    mp = fr[0][0]
    G.cyl("Mouthpiece", 0.06, 0.1, 10, gold, loc=tuple(mp - fr[0][1] * 0.03)).rotation_euler = \
        Vector((0, 0, 1)).rotation_difference(fr[0][1]).to_euler()
    # sound waves out of the bell
    wave = G.glow("Wave", "#ffe27a", 2.6)
    ang = math.degrees(math.atan2(t.z, t.x))
    for k, r in enumerate((0.26, 0.45, 0.64)):
        pts = G.arc_points(r, ang - 42, ang + 42, 9, centre=(p.x, -0.1, p.z))
        G.ribbon(f"Wave{k}", pts, [0.0, 0.04, 0.06, 0.07, 0.075, 0.07, 0.06, 0.04, 0.0], wave)
    return dict(yaw=0, pitch=4, fill=0.84, glow=0.7, glow_sigma=6)


# --------------------------------------------------------------------------- mage
def ab_firebolt():
    """Slender flaming dart flying to the upper right."""
    core = G.glow("BoltCore", "#ffe36a", 1.3)
    sheath = G.glow("BoltSheath", "#ff8c1a", 1.3)
    wisp = G.glow("BoltWisp", "#ff3a0a", 1.2, base="#d8280a")
    tip = Vector((0.62, 0.0, 0.62))
    d = Vector((-1, 0, -1)).normalized()

    def spindle(name, start, length, radii, mat, y):
        pts = [tuple(start + d * (length * i / (len(radii) - 1)) + Vector((0, y, 0))) for i in range(len(radii))]
        return G.tube(name, pts, radii, 10, mat, smooth=True)

    spindle("Core", tip, 0.95, [0.0, 0.085, 0.1, 0.085, 0.06, 0.03, 0.0], core, -0.1)
    spindle("Sheath", tip + d * -0.04, 1.45, [0.0, 0.13, 0.16, 0.14, 0.1, 0.06, 0.03, 0.0], sheath, 0.0)
    for i, (off, ln, r) in enumerate(((0.12, 1.5, 0.08), (-0.12, 1.35, 0.075), (0.0, 1.75, 0.07))):
        side = Vector((1, 0, -1)).normalized() * off
        flame(f"Wisp{i}", tip + d * 0.25 + side + Vector((0, 0.08, 0)), d, ln, r, wisp, wiggle=0.12, seed=i + 3)
    for i, (t, off, r) in enumerate(((0.5, 0.28, 0.035), (0.9, -0.25, 0.03), (1.25, 0.2, 0.028), (0.3, -0.2, 0.025))):
        p = tip + d * t + Vector((1, 0, -1)).normalized() * off
        G.ico(f"Spark{i}", r, 0, core, loc=(p.x, -0.15, p.z))
    return dict(yaw=0, pitch=0, fill=0.82, glow=0.9, glow_sigma=7, bloom_over=0.0)


def ab_fireball():
    """Big blazing ball with a corona of flames trailing to the lower left."""
    hot = G.glow("BallHot", "#fff1b0", 1.2)
    core = G.glow("BallCore", "#ffc52e", 1.3)
    ball = G.M("Ball", "#ff7a14", 0.3, 0.0, emit="#ff6a0a", strength=1.3)
    f_or = G.glow("FOrange", "#ff8a14", 1.3)
    f_red = G.glow("FRed", "#e8300a", 1.2, base="#c0200a")
    f_yel = G.glow("FYellow", "#ffc23a", 1.3)
    c = Vector((0.12, 0, 0.12))
    G.uvsphere("Ball", 0.5, 20, 14, ball, loc=tuple(c))
    G.uvsphere("Core", 0.36, 16, 12, core, loc=tuple(c + Vector((0.06, -0.22, 0.06))))
    G.uvsphere("Hot", 0.17, 12, 8, hot, loc=tuple(c + Vector((0.1, -0.45, 0.1))))
    rnd = random.Random(8)
    trail = Vector((-0.7, 0, -0.7)).normalized()
    for i in range(18):
        a = 2 * math.pi * i / 18 + 0.1
        radial = Vector((math.cos(a), 0, math.sin(a)))
        back = max(0.0, radial.dot(trail))
        direction = (radial * (0.9 - 0.5 * back) + trail * (0.5 + back)).normalized()
        base = c + radial * 0.38 + Vector((0, 0.12, 0))
        ln = 0.3 + 0.75 * back ** 1.5 + rnd.uniform(0, 0.12)
        mat = (f_red, f_or, f_yel)[i % 3]
        flame(f"Tongue{i}", base, direction, ln, 0.16 + 0.05 * back, mat, wiggle=0.07, seed=i)
    return dict(yaw=0, pitch=0, fill=0.84, glow=0.9, glow_sigma=8, bloom_over=0.0)


def ab_frost_nova():
    ice = G.M("Ice", "#dcf6ff", 0.08, 0.0, emit="#8fe4ff", strength=1.2)
    ice2 = G.M("Ice2", "#9fdcff", 0.1, 0.0, emit="#5cc8ff", strength=1.0)
    core = G.glow("IceCore", "#ffffff", 4.0, base="#e8fbff")
    ring = G.glow("Ring", "#a8ecff", 2.5)
    parts = []

    def shard(name, a_deg, r0, r1, w, mat):
        a = math.radians(a_deg)
        d = Vector((math.cos(a), 0, math.sin(a)))
        side = Vector((-d.z, 0, d.x))
        y = Vector((0, 1, 0))
        base = d * r0
        mid = d * (r0 + (r1 - r0) * 0.3)
        ringp = [tuple(mid + side * w), tuple(mid + y * w * 0.6), tuple(mid - side * w), tuple(mid - y * w * 0.6)]
        return G.loft(name, [[tuple(base)], ringp, [tuple(d * r1)]], mat)

    for k in range(8):
        long = k % 2 == 0
        parts.append(shard(f"Shard{k}", 90 + 45 * k, 0.12, 0.95 if long else 0.66, 0.13 if long else 0.1,
                           ice if long else ice2))
    # small side spikes on the long shards (snowflake feel)
    for k in range(0, 8, 2):
        a = 90 + 45 * k
        for s in (-1, 1):
            base_r = 0.58
            b = Vector((math.cos(math.radians(a)), 0, math.sin(math.radians(a)))) * base_r
            dd = math.radians(a + s * 40)
            tipv = b + Vector((math.cos(dd), 0, math.sin(dd))) * 0.24
            parts.append(G.rod(f"Spike{k}{s}", tuple(b), tuple(tipv), 0.035, 4, ice, r1=0.0))
    hexr = [(0.2 * math.cos(math.radians(60 * i + 30)), 0, 0.2 * math.sin(math.radians(60 * i + 30))) for i in range(6)]
    parts.append(G.loft("Core", [[(0, 0.12, 0)], hexr, [(0, -0.14, 0)]], core))
    parts.append(G.torus("Nova", 0.8, 0.028, 40, 6, ring, rot=(90, 0, 0), loc=(0, 0.1, 0)))
    rnd = random.Random(6)
    for k in range(8):
        a = math.radians(90 + 45 * k + 22.5)
        c = Vector((math.cos(a), 0, math.sin(a))) * 0.8
        chunk = G.ico(f"Chunk{k}", 0.075, 0, ice2, loc=(c.x, 0.05, c.z), scale=(1, 1, 1.6), seed=k, jitter=0.01)
        chunk.rotation_euler = (0, -a + math.pi / 2 + rnd.uniform(-0.3, 0.3), 0)
        parts.append(chunk)
    G.pose(parts, turn=12, tilt=-10)
    return dict(yaw=0, pitch=0, fill=0.84, glow=0.9, glow_sigma=7)


def ab_heal():
    green = G.M("HealGreen", "#46d862", 0.3, 0.0, emit="#4dff6e", strength=1.6)
    light = G.glow("HealLight", "#e8ffe0", 3.5, base="#ffffff")
    leaf = G.M("Leaf", "#2fae45", 0.5, 0.0, emit="#3cd85a", strength=0.4)
    parts = [G.box("CrossV", (0.34, 0.2, 1.0), green, bevel=0.05), G.box("CrossH", (1.0, 0.2, 0.34), green, bevel=0.05)]
    parts.append(G.box("InnerV", (0.12, 0.05, 0.72), light, loc=(0, -0.1, 0)))
    parts.append(G.box("InnerH", (0.72, 0.05, 0.12), light, loc=(0, -0.1, 0)))
    # two leaves sprouting behind the cross
    for s in (-1, 1):
        lf = [(0, 0), (0.1, 0.1), (0.12, 0.28), (0.0, 0.46), (-0.12, 0.28), (-0.1, 0.1)]
        o = G.extrude(f"Leaf{s}", lf, 0.03, leaf, y=0.1)
        G.place(o, loc=(s * 0.18, 0.05, -0.48), rot=(0, s * 55, 0))
        parts.append(o)
        parts.append(G.rod(f"Vein{s}", (s * 0.18, -0.02, -0.48), (s * (0.18 + 0.32 * math.sin(math.radians(55))), -0.02,
                                                                  -0.48 + 0.32 * math.cos(math.radians(55))), 0.01, 4,
                           G.M("Vein", "#1f7a31", 0.6)))
    # sparkles
    for i, (x, z, r) in enumerate(((0.55, 0.55, 0.14), (-0.58, 0.42, 0.1), (0.62, -0.3, 0.08), (-0.45, -0.62, 0.07))):
        parts.append(G.extrude(f"Sparkle{i}", star_shape(4, r, r * 0.3, 90), 0.02, light, y=-0.15))
        parts[-1].location = (x, 0, z)
    G.pose(parts, turn=18, tilt=-6)
    return dict(yaw=0, pitch=0, fill=0.8, glow=0.9, glow_sigma=7)


# --------------------------------------------------------------------------- ranger
def ab_shot():
    parts = arrow("A", 1.5)
    G.pose(parts, turn=25, roll=45)
    sm = streak_mat()
    d = Vector((-1, 0, -1)).normalized()
    side = Vector((1, 0, -1)).normalized()
    for i, (off, ln, st) in enumerate(((0.0, 0.75, 0.1), (0.16, 0.5, 0.18), (-0.16, 0.5, 0.18))):
        start = Vector((0, -0.3, 0)) + side * off + d * st
        streak(f"Streak{i}", tuple(start + d * ln), tuple(start), 0.045, sm)
    return dict(yaw=0, pitch=4, fill=0.84, glow=0.3, glow_sigma=5)


def _shield(prefix, R=0.62):
    """Round plank shield in the XZ plane (facing -Y), iron rim and two iron bands."""
    wood = G.M("ShieldWood", "#a06a38", 0.8)
    wood2 = G.M("ShieldWood2", "#83542b", 0.8)
    iron = G.M("ShieldIron", "#7d8590", 0.35, 0.8)
    parts = []
    n = 5
    w = 2 * R / n
    for i in range(n):
        x0, x1 = -R + i * w + 0.008, -R + (i + 1) * w - 0.008
        xs = [x0 + (x1 - x0) * k / 6 for k in range(7)]
        top = [(x, math.sqrt(max(0.0, R * R - x * x))) for x in xs]
        bot = [(x, -z) for x, z in reversed(top)]
        parts.append(G.extrude(f"{prefix}Plank{i}", top[::-1] + bot[::-1], 0.08, wood if i % 2 else wood2))
    parts.append(G.torus(f"{prefix}Rim", R, 0.05, 36, 6, iron, rot=(90, 0, 0)))
    for z in (-0.3, 0.3):
        half = math.sqrt(R * R - z * z)
        parts.append(G.box(f"{prefix}Band{z}", (2 * half, 0.1, 0.08), iron, loc=(0, 0, z)))
        for x in (-half * 0.75, 0.0, half * 0.75):
            parts.append(G.uvsphere(f"{prefix}Rivet{z}{x}", 0.03, 8, 6, iron, loc=(x, -0.055, z)))
    return parts


def ab_piercing_shot():
    crack = G.M("Crack", "#2a1a10", 0.9)
    splinter = G.M("Splinter", "#d9a86a", 0.8)
    parts = _shield("S")
    hole = Vector((0.05, -0.04, 0.02))
    for i, a in enumerate((15, 80, 150, 215, 290)):
        r = math.radians(a)
        parts.append(G.rod(f"Crack{i}", tuple(hole + Vector((0.05 * math.cos(r), -0.005, 0.05 * math.sin(r)))),
                           tuple(hole + Vector((0.34 * math.cos(r), -0.005, 0.34 * math.sin(r)))), 0.02, 4, crack,
                           r1=0.004))
    for i, a in enumerate((40, 120, 200, 320)):
        r = math.radians(a)
        s = G.box(f"Splinter{i}", (0.03, 0.12, 0.03), splinter,
                  loc=tuple(hole + Vector((0.08 * math.cos(r), -0.06, 0.08 * math.sin(r)))), rot=(60, 0, a))
        parts.append(s)
    piv = G.pose(parts, turn=38)
    H = piv.matrix_world @ hole
    d = Vector((1.0, -0.62, 0.42)).normalized()
    head = G.M("PierceHead", "#eef6ff", 0.2, 0.6)
    ar = arrow("P", 1.9, head_mat=head)
    G.align(ar, H - d * 1.2, H + d * 0.95, length=1.9)
    flash = G.glow("Flash", "#fff3b0", 1.6)
    fl = G.extrude("Flash", star_shape(8, 0.26, 0.07, 10), 0.02, flash)
    G.place(fl, loc=(H.x, H.y - 0.12, H.z))
    trail = streak_mat()
    streak("PierceTrail", tuple(H + d * 0.1 + Vector((0, -0.15, 0))), tuple(H + d * 0.85 + Vector((0, -0.15, 0))),
           0.06, trail)
    return dict(yaw=0, pitch=6, fill=0.84, glow=0.6, glow_sigma=6)


def ab_arrow_rain():
    """A volley of arrows falling onto a target zone (ellipse on the ground)."""
    sm = streak_mat()
    rnd = random.Random(4)
    tips = [(-0.5, -0.5, 0.95), (0.05, -0.62, 1.0), (0.55, -0.48, 0.95), (-0.62, 0.12, 0.85), (-0.12, -0.02, 0.9),
            (0.42, 0.08, 0.88), (0.12, 0.55, 0.8)]
    d = Vector((-0.3, 0, -1)).normalized()
    for i, (x, z, s) in enumerate(tips):
        L = 1.0 * s
        tip = Vector((x, -0.05 * i, z))
        nock = tip - d * L
        G.align(arrow(f"R{i}", 1.0), nock, tip, twist=rnd.uniform(0, 120), length=1.0 / s)
        streak(f"St{i}", tuple(nock - d * 0.45 + Vector((0, -0.2, 0))), tuple(nock - d * 0.02 + Vector((0, -0.2, 0))),
               0.04, sm)
    ring = G.M("Target", "#e8ffc0", 0.5, 0.0, emit="#e0ffb0", strength=1.0, alpha=0.85)
    for k, (r, w) in enumerate(((0.78, 0.035), (0.45, 0.025))):
        o = G.torus(f"Target{k}", r, w, 48, 6, ring, loc=(0.02, 0.4, -0.72), rot=(90, 0, 0))
        o.scale = (1, 0.28, 1)  # local Y becomes world Z after the 90 deg X rotation -> flat ellipse
    return dict(yaw=0, pitch=0, fill=0.86, glow=0.35, glow_sigma=5)


def ab_rapid_fire():
    sm = streak_mat()
    origin = Vector((-0.55, 0.0, -0.55))
    for i, a in enumerate((22, 45, 68)):
        rad = math.radians(a)
        fwd = Vector((math.sin(rad), 0, math.cos(rad)))
        nock = origin + fwd * (0.3 + 0.12 * (1 - abs(i - 1))) + Vector((0, -0.06 * i, 0))
        G.align(arrow(f"F{i}", 1.35), nock, nock + fwd * 1.35, twist=20 * i, length=1.35)
        start = nock + Vector((0, -0.25, 0))
        streak(f"St{i}", tuple(start - fwd * 0.5), tuple(start + fwd * 0.02), 0.045, sm)
    return dict(yaw=0, pitch=0, fill=0.84, glow=0.3, glow_sigma=5)


def _with_bg(fn, ab):
    def build():
        opts = fn()
        opts["bg"] = COLOURS[ab]
        return opts
    return build


_EMBLEMS = {
    "strike": ab_strike,
    "heavy_blow": ab_heavy_blow,
    "whirlwind": ab_whirlwind,
    "war_cry": ab_war_cry,
    "firebolt": ab_firebolt,
    "fireball": ab_fireball,
    "frost_nova": ab_frost_nova,
    "heal": ab_heal,
    "shot": ab_shot,
    "piercing_shot": ab_piercing_shot,
    "arrow_rain": ab_arrow_rain,
    "rapid_fire": ab_rapid_fire,
}
BUILDERS = {f"ab_{ab}": _with_bg(fn, ab) for ab, fn in _EMBLEMS.items()}
