"""Item icon builders. Each builder populates the (reset) scene and returns render options for iconlib.render_icon.

Rarity is expressed through materials: common = plain wood/iron/leather, uncommon = polished steel & gilding,
epic = dark precious materials with glowing emissive parts (rendered with a glow halo).
"""
import math
import random

from mathutils import Matrix, Vector

import geo as G

# --------------------------------------------------------------------------- palette
WOOD = "#8a5a32"
WOOD_DARK = "#5a361c"
WOOD_LIGHT = "#b8834a"
LEATHER = "#6e3f22"
LEATHER_DARK = "#4a2915"
GOLD = "#f0bd4c"
BRONZE = "#b8783a"
STEEL = "#dfe6ee"
IRON = "#7c8490"
CORK = "#c89a62"


def gold(name="Gold"):
    return G.M(name, GOLD, 0.28, 0.85)


def steel(name="Steel", col=STEEL, rough=0.22):
    return G.M(name, col, rough, 0.8)


# --------------------------------------------------------------------------- shared parts
def _hex_ring(w, t, z, bevel=0.55):
    return [(-w, 0, z), (-w * bevel, -t, z), (w * bevel, -t, z), (w, 0, z), (w * bevel, t, z), (-w * bevel, t, z)]


def blade(name, mat, length=1.0, w0=0.1, w1=0.085, t=0.022, tip=0.2, n=8, notches=(), wobble=0.0, seed=1):
    """Sword blade along +Z from z=0, flat faces towards -Y/+Y (the camera)."""
    rnd = random.Random(seed)
    secs = []
    for i in range(n + 1):
        z = length * i / n
        w = w0 + (w1 - w0) * i / n
        ring = _hex_ring(w, t, z)
        if i in notches:  # chipped edge
            ring[3] = (w * 0.72, 0, z)
        if wobble:
            ring = [(x + rnd.uniform(-wobble, wobble), y, zz) for x, y, zz in ring]
        secs.append(ring)
    secs.append(_hex_ring(w1 * 0.55, t * 0.8, length + tip * 0.55))
    secs.append([(0, 0, length + tip)])
    return G.loft(name, secs, mat)


def grip(name, z0, z1, r, mat, ridges=5, ridge_mat=None):
    parts = [G.cyl(name, r, z1 - z0, 10, mat, loc=(0, 0, (z0 + z1) / 2))]
    for i in range(ridges):
        z = z0 + (z1 - z0) * (i + 0.5) / ridges
        parts.append(G.torus(f"{name}_ridge{i}", r * 1.02, r * 0.28, 12, 6, ridge_mat or mat, loc=(0, 0, z), rot=(8, 0, 0)))
    return parts


def potion_flask(liquid_hex, emit_hex, big=False):
    """Round-bottom glass flask with coloured liquid, cork and glassy highlight (upright, origin at the base)."""
    liquid = G.M("Liquid", liquid_hex, 0.14, 0.0, emit=emit_hex, strength=0.22)
    glass = G.glass("Glass", "#1a2026", 0.22)
    cork = G.M("Cork", CORK, 0.9)
    cork_top = G.M("CorkTop", "#a57845", 0.9)
    hi = G.glow("Highlight", "#ffffff", 1.6)
    parts = []
    if not big:
        outer = [(0, 0.0), (0.2, 0.0), (0.31, 0.04), (0.37, 0.13), (0.385, 0.23), (0.355, 0.33), (0.27, 0.42),
                 (0.15, 0.48), (0.11, 0.52), (0.11, 0.66), (0, 0.66)]
        inner = [(0, 0.025), (0.19, 0.025), (0.29, 0.06), (0.345, 0.135), (0.36, 0.23), (0.335, 0.32), (0.29, 0.37),
                 (0, 0.37)]
        neck_top, neck_r, belly_r, belly_z = 0.66, 0.11, 0.385, 0.23
    else:
        outer = [(0, 0.0), (0.22, 0.0), (0.36, 0.05), (0.45, 0.17), (0.48, 0.32), (0.455, 0.47), (0.37, 0.6),
                 (0.24, 0.69), (0.14, 0.74), (0.12, 0.78), (0.12, 1.02), (0, 1.02)]
        inner = [(0, 0.025), (0.21, 0.025), (0.34, 0.07), (0.425, 0.18), (0.45, 0.32), (0.43, 0.46), (0.37, 0.54),
                 (0, 0.54)]
        neck_top, neck_r, belly_r, belly_z = 1.02, 0.12, 0.48, 0.32
    parts.append(G.lathe("GlassBody", outer, 24, glass, smooth=True))
    parts.append(G.lathe("LiquidBody", inner, 24, liquid, smooth=True))
    # lip ring + cork
    parts.append(G.torus("Lip", neck_r + 0.012, 0.028, 20, 8, G.glass("GlassLip", "#f4fbff", 0.55), loc=(0, 0, neck_top - 0.01)))
    parts.append(G.cyl("Cork", neck_r * 0.92, 0.2, 12, cork, loc=(0, 0, neck_top + 0.02), r2=neck_r * 1.12, smooth=True))
    parts.append(G.cyl("CorkTop", neck_r * 1.12, 0.02, 12, cork_top, loc=(0, 0, neck_top + 0.125), smooth=True))
    # string wrapped around the neck
    parts.append(G.torus("String", neck_r + 0.01, 0.014, 20, 6, G.M("String", "#d9c7a0", 0.9), loc=(0, 0, neck_top - 0.09)))
    # glass highlight: vertical streak on the belly, on the camera-left side
    az = math.radians(-118)
    pts = []
    for i in range(7):
        a = math.radians(-35 + 70 * i / 6)
        r = belly_r * 1.02 * math.cos(a) + 0.0
        z = belly_z + belly_r * 0.95 * math.sin(a)
        pts.append((r * math.cos(az), r * math.sin(az), z))
    parts.append(G.ribbon("Streak", pts, [0.0, 0.03, 0.045, 0.05, 0.045, 0.03, 0.0], hi,
                          normal=(math.cos(az), math.sin(az), 0)))
    # neck glass: a bit more opaque so the empty neck still reads
    parts.append(G.lathe("NeckGlass", [(neck_r + 0.008, neck_top - 0.16), (neck_r + 0.008, neck_top - 0.02)], 20,
                         G.glass("NeckGlassMat", "#eef9ff", 0.3), smooth=True, cap=False))
    if big:
        g = gold("GoldBand")
        parts.append(G.torus("Collar", 0.16, 0.035, 24, 8, g, loc=(0, 0, 0.74)))
        parts.append(G.torus("Collar2", neck_r + 0.02, 0.022, 20, 8, g, loc=(0, 0, neck_top - 0.05)))
        # golden heart charm hanging on the front of the belly (the "large healing" mark)
        heart = []
        for i in range(28):
            t = 2 * math.pi * i / 28
            x = 16 * math.sin(t) ** 3
            z = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
            heart.append((x * 0.0085, z * 0.0085))
        h = G.extrude("Heart", heart, 0.04, g, bevel=0.012, bevel_segs=2)
        az_f = math.radians(-70)  # facing the camera (yaw 24)
        hr = 0.5
        G.place(h, loc=(hr * math.cos(az_f), hr * math.sin(az_f), 0.4), rot=(0, 0, math.degrees(az_f) + 90))
        parts.append(h)
        top = (0.16 * math.cos(az_f), 0.16 * math.sin(az_f) - 0.02, 0.72)
        parts.append(G.tube("Chain", [top, (0.34 * math.cos(az_f), 0.34 * math.sin(az_f), 0.62),
                                      (hr * math.cos(az_f), hr * math.sin(az_f), 0.52)], 0.012, 6, g))
    return parts


# --------------------------------------------------------------------------- consumables
def potion_hp_s():
    potion_flask("#c4101e", "#ff1a2a")
    return dict(yaw=24, pitch=16, fill=0.74)


def potion_hp_l():
    potion_flask("#c4101e", "#ff1a2a", big=True)
    return dict(yaw=24, pitch=16, fill=0.92)


def potion_mp_s():
    potion_flask("#1c4fe0", "#2f6dff")
    return dict(yaw=24, pitch=16, fill=0.74)


# --------------------------------------------------------------------------- loot
def slime_gel():
    gel = G.M("Gel", "#5fd34a", 0.08, 0.0, emit="#8cff5c", strength=0.55)
    gel_hi = G.M("GelLight", "#b8ff8a", 0.1, 0.0, emit="#c8ff9a", strength=0.9)
    glass = G.glass("JarGlass", "#e8f7ff", 0.3)
    jar = [(0, 0), (0.3, 0), (0.335, 0.03), (0.34, 0.36), (0.3, 0.41), (0.3, 0.45), (0.345, 0.47), (0.345, 0.52),
           (0.29, 0.52), (0.285, 0.05), (0, 0.05)]
    G.lathe("Jar", jar, 24, glass, smooth=True)
    body = [(0, 0.05), (0.28, 0.05), (0.28, 0.44), (0.305, 0.5), (0.33, 0.56), (0.3, 0.63), (0.22, 0.7), (0.1, 0.74),
            (0, 0.75)]
    blob = G.lathe("Gel", body, 20, gel, smooth=True)
    rnd = random.Random(7)
    for v in blob.data.vertices:
        if v.co.z > 0.5:
            v.co.x += rnd.uniform(-0.02, 0.02)
            v.co.y += rnd.uniform(-0.02, 0.02)
            v.co.z += rnd.uniform(-0.02, 0.025)
    # drips over the rim
    for i, (az, ln) in enumerate(((-100, 0.22), (-45, 0.13), (160, 0.18))):
        a = math.radians(az)
        path = [(0.33 * math.cos(a), 0.33 * math.sin(a), 0.55), (0.36 * math.cos(a), 0.36 * math.sin(a), 0.5),
                (0.36 * math.cos(a), 0.36 * math.sin(a), 0.5 - ln)]
        G.tube(f"Drip{i}", path, [0.05, 0.035, 0.03], 8, gel)
        G.uvsphere(f"DripEnd{i}", 0.042, 10, 8, gel, loc=(0.365 * math.cos(a), 0.365 * math.sin(a), 0.5 - ln - 0.01),
                   scale=(1, 1, 1.25))
    # bubbles
    for i, (x, y, z, r) in enumerate(((-0.1, -0.2, 0.3, 0.05), (0.08, -0.22, 0.18, 0.035), (-0.05, -0.18, 0.62, 0.04),
                                      (0.12, -0.15, 0.4, 0.03))):
        G.uvsphere(f"Bubble{i}", r, 10, 6, gel_hi, loc=(x, y, z))
    # glass highlight
    az = math.radians(-120)
    pts = [(0.35 * math.cos(az), 0.35 * math.sin(az), 0.08 + 0.3 * i / 5) for i in range(6)]
    G.ribbon("JarStreak", pts, [0.0, 0.035, 0.045, 0.045, 0.035, 0.0], G.glow("Hi", "#ffffff", 1.4),
             normal=(math.cos(az), math.sin(az), 0))
    return dict(yaw=24, pitch=22, fill=0.84, glow=0.45, glow_sigma=6)


def _jagged(loop, jag_from, jag_to, rnd, step=0.07, depth=0.045):
    """Subdivide the edges jag_from..jag_to of a clockwise (x, y) loop with outward fur tufts."""
    out = []
    n = len(loop)
    for i in range(n):
        a, b = Vector(loop[i]), Vector(loop[(i + 1) % n])
        if not (jag_from <= i < jag_to):
            out.append(tuple(a))
            continue
        seg = b - a
        k = max(1, int(seg.length / step))
        nrm = Vector((-seg.y, seg.x)).normalized()  # outward for a clockwise loop
        for j in range(k):
            p = a + seg * (j / k)
            if j % 2 == 1:
                p = p + nrm * depth * rnd.uniform(0.7, 1.3)
            out.append(tuple(p))
    return out


def _mirror_loop(half):
    """half: right-side points from the top centre down to the bottom centre -> closed clockwise loop."""
    return half + [(-x, y) for x, y in reversed(half[1:-1])]


def _flat_layer(name, loop, thick, mat, z0, bevel=0.02):
    """Extrude an (x, y) loop into a flat layer whose bottom sits at z0 (bevelled -> puffy)."""
    ob = G.extrude(name, loop, thick, mat)  # authored in XZ, thickness along Y
    ob.data.transform(Matrix.Rotation(math.radians(-90), 4, "X"))  # -> loop in XY, thickness along Z
    if bevel > 0:
        G.add_bevel(ob, bevel, 2, 30)
    ob.location = (0, 0, z0 + thick / 2)
    return ob


def wolf_pelt():
    """Spread wolf hide seen from above: head with pointed ears, four legs, bushy tail, jagged fur edges,
    fur strokes combed away from the spine."""
    fur = G.M("Fur", "#8a8c96", 0.95)
    fur_edge = G.M("FurEdge", "#6a6c76", 0.95)
    fur_dark = G.M("FurDark", "#565862", 0.95)
    fur_light = G.M("FurLight", "#c9c7c0", 0.95)
    nose = G.M("Nose", "#1c1a1c", 0.4)
    ear_in = G.M("EarIn", "#4a3a3c", 0.9)
    rnd = random.Random(12)
    half = [(0.0, 1.08), (0.11, 1.02), (0.16, 0.88), (0.22, 0.79), (0.26, 0.9), (0.32, 1.06), (0.39, 0.77),
            (0.33, 0.6), (0.32, 0.5),                                                      # neck (index 8)
            (0.45, 0.53), (0.67, 0.65), (0.87, 0.76), (0.92, 0.67), (0.69, 0.47), (0.47, 0.33),  # front leg
            (0.46, 0.08), (0.44, -0.16),                                                  # flank
            (0.53, -0.26), (0.75, -0.33), (0.92, -0.47), (0.87, -0.57), (0.62, -0.51), (0.42, -0.53),  # hind leg
            (0.26, -0.63), (0.13, -0.71), (0.16, -0.93), (0.11, -1.13), (0.0, -1.24)]  # rump + tail
    loop = _mirror_loop(half)
    body = _jagged(loop, 8, len(loop) - 8, rnd, 0.075, 0.06)
    parts = [_flat_layer("FurEdge", body, 0.07, fur_edge, 0.0, 0.015)]
    torso_half = [(0.0, 0.6), (0.31, 0.54), (0.41, 0.3), (0.4, 0.0), (0.38, -0.3), (0.27, -0.57), (0.1, -0.67),
                  (0.0, -0.7)]
    parts.append(_flat_layer("Body", _jagged(_mirror_loop(torso_half), 0, 99, rnd, 0.08, 0.035), 0.07, fur, 0.05, 0.03))
    parts.append(_flat_layer("Spine", _mirror_loop([(0.0, 0.56), (0.06, 0.45), (0.07, 0.0), (0.06, -0.45),
                                                     (0.0, -0.62)]), 0.03, fur_dark, 0.11, 0.015))
    # fur strokes combed away from the spine
    specs = []
    while len(specs) < 34:
        x, y = rnd.uniform(-0.34, 0.34), rnd.uniform(-0.55, 0.48)
        if abs(x) < 0.08 or abs(x) > 0.36 - 0.12 * max(0.0, -y - 0.3):
            continue
        s = 1 if x > 0 else -1
        specs.append(((x, y, 0.125), (s * rnd.uniform(0.6, 1.0), rnd.uniform(-0.8, -0.3), 0.05), 0.03,
                      rnd.uniform(0.12, 0.19)))
    parts.append(G.locks("Strokes", specs, G.M("FurStroke", "#72747e", 0.95), flat=0.3, smooth=False))
    # tail: raised, darker tip
    tail_half = [(0.0, -0.62), (0.11, -0.71), (0.13, -0.93), (0.09, -1.12), (0.0, -1.21)]
    parts.append(_flat_layer("Tail", _jagged(_mirror_loop(tail_half), 0, 99, rnd, 0.06, 0.035), 0.06, fur, 0.05, 0.02))
    parts.append(_flat_layer("TailTip", _mirror_loop([(0.0, -0.98), (0.08, -1.04), (0.07, -1.13), (0.0, -1.19)]),
                             0.04, fur_dark, 0.1, 0.015))
    # head with ears (raised), light snout, dark nose, dark inner ears, closed eyes
    head_half = [(0.0, 1.06), (0.1, 1.0), (0.15, 0.87), (0.22, 0.78), (0.26, 0.88), (0.31, 1.03), (0.37, 0.76),
                 (0.31, 0.6), (0.18, 0.53), (0.0, 0.51)]
    parts.append(_flat_layer("Head", _mirror_loop(head_half), 0.08, fur, 0.05, 0.025))
    parts.append(_flat_layer("Snout", _mirror_loop([(0.0, 1.05), (0.085, 1.0), (0.12, 0.88), (0.09, 0.78),
                                                     (0.0, 0.75)]), 0.03, fur_light, 0.12, 0.012))
    parts.append(_flat_layer("Nose", _mirror_loop([(0.0, 1.07), (0.055, 1.045), (0.05, 0.99), (0.0, 0.975)]), 0.03,
                             nose, 0.15, 0.008))
    for s in (-1, 1):
        ear = [(s * 0.27, 0.84), (s * 0.31, 0.97), (s * 0.35, 0.79)]
        parts.append(_flat_layer(f"EarIn{s}", ear[::-1] if s > 0 else ear, 0.02, ear_in, 0.12, 0.0))
        parts.append(G.box(f"Eye{s}", (0.075, 0.024, 0.02), nose, loc=(s * 0.14, 0.77, 0.14), rot=(0, 0, s * 28)))
    # slightly lighter paws
    for s in (-1, 1):
        for (x, y) in ((0.86, 0.7), (0.87, -0.5)):
            ring = [(s * x + 0.055 * math.cos(t * math.pi / 4), y + 0.045 * math.sin(t * math.pi / 4)) for t in range(8)]
            parts.append(_flat_layer(f"Paw{s}{y}", ring[::-1], 0.02, fur_light, 0.05, 0.008))

    def bend(y):  # the hide is not perfectly flat: head and tail curl up a little
        return (max(0.0, -0.4 - y) ** 2) * 0.25 + (max(0.0, y - 0.5) ** 2) * 0.35

    for o in parts:
        for v in o.data.vertices:
            v.co.z += bend(v.co.y)
    G.pose(parts, turn=-28)
    return dict(yaw=0, pitch=55, fill=0.92)


def goblin_trinket():
    bronze = G.M("Bronze", BRONZE, 0.35, 0.8)
    dark_bronze = G.M("BronzeDark", "#7a4a22", 0.5, 0.7)
    gem = G.M("Gem", "#3fcf4a", 0.1, 0.0, emit="#3fff5a", strength=0.8)
    bone = G.M("Tooth", "#efe3c2", 0.6)
    cord = G.M("Cord", LEATHER, 0.85)
    red = G.M("Bead", "#c23a2a", 0.4)
    parts = []
    # crude disc: 9-gon, jittered, facing the camera (-Y)
    disc = G.cyl("Disc", 0.36, 0.07, 9, bronze, rot=(90, 0, 0))
    G.jitter_obj(disc, 0.018, 5)
    rim = G.torus("Rim", 0.34, 0.035, 18, 6, dark_bronze, rot=(90, 0, 0), smooth=False)
    G.jitter_obj(rim, 0.01, 6)
    parts += [disc, rim]
    # central gem in a claw setting
    g = G.ico("Gem", 0.13, 1, gem, loc=(0, -0.06, 0.0), scale=(1, 0.6, 1.15))
    parts.append(g)
    for i in range(4):
        a = math.radians(45 + 90 * i)
        parts.append(G.rod(f"Claw{i}", (0.2 * math.cos(a), -0.04, 0.2 * math.sin(a)),
                           (0.11 * math.cos(a), -0.11, 0.12 * math.sin(a)), 0.022, 6, dark_bronze, r1=0.012))
    # crude scratched marks around the gem
    for i in range(6):
        a = math.radians(i * 60 + 15)
        m = G.box(f"Mark{i}", (0.05, 0.02, 0.018), dark_bronze, loc=(0.26 * math.cos(a), -0.04, 0.26 * math.sin(a)),
                  rot=(0, -math.degrees(a) + 90, 0))
        parts.append(m)
    # fangs hanging below
    for i, (x, ang, ln) in enumerate(((-0.17, 20, 0.28), (0.0, 0, 0.36), (0.17, -20, 0.28))):
        path = [(x, 0, -0.3), (x + math.sin(math.radians(ang)) * ln * 0.5, -0.02, -0.3 - ln * 0.5),
                (x + math.sin(math.radians(ang)) * ln * 1.1, -0.06, -0.3 - ln)]
        parts.append(G.tube(f"Fang{i}", path, [0.055, 0.04, 0.0], 8, bone, smooth=True))
        parts.append(G.torus(f"FangRing{i}", 0.04, 0.012, 10, 5, dark_bronze, loc=(x, 0, -0.31), rot=(0, 90, 0)))
    # cord loop over the top with beads
    loop = G.torus("Cord", 0.42, 0.028, 28, 6, cord, loc=(0, 0.02, 0.54), rot=(90, 0, 0), arc=230, start=-25)
    parts.append(loop)
    for i, a in enumerate((-10, 30, 150, 190)):
        r = math.radians(a)
        parts.append(G.uvsphere(f"Bead{i}", 0.055, 10, 8, red if i % 2 == 0 else bone,
                                loc=(0.42 * math.cos(r), 0.02, 0.54 + 0.42 * math.sin(r))))
    G.pose(parts, turn=18, tilt=-8)
    return dict(yaw=0, pitch=8, fill=0.86, glow=0.25)


def ancient_bone():
    bone = G.M("Bone", "#e4d3ab", 0.65)
    stain = G.M("Stain", "#a88a5c", 0.8)
    rune = G.glow("Rune", "#a45cff", 1.6)
    parts = []
    shaft = G.tube("Shaft", [(0, 0, -0.5), (0.01, 0, -0.2), (-0.01, 0, 0.2), (0, 0, 0.5)], [0.1, 0.085, 0.085, 0.1],
                   10, bone, smooth=True)
    G.jitter_obj(shaft, 0.008, 2)
    parts.append(shaft)
    for sz in (-1, 1):
        for sx in (-1, 1):
            k = G.uvsphere(f"Knob{sz}{sx}", 0.14, 14, 10, bone, loc=(sx * 0.1, 0, sz * 0.58), scale=(1, 0.9, 1.05))
            parts.append(k)
    # cracks / stains
    for i, (z, x) in enumerate(((0.25, 0.05), (-0.3, -0.04))):
        parts.append(G.box(f"Crack{i}", (0.1, 0.02, 0.012), stain, loc=(x, -0.085, z), rot=(0, 25 * (1 - 2 * i), 0)))
    # strange runes glowing faintly
    for i, z in enumerate((-0.2, 0.0, 0.2)):
        parts.append(G.box(f"RuneA{i}", (0.022, 0.02, 0.11), rune, loc=(0.0, -0.085, z)))
        parts.append(G.box(f"RuneB{i}", (0.07, 0.02, 0.022), rune, loc=(0.0, -0.085, z + (0.035 if i % 2 else -0.035)),
                           rot=(0, 35 if i % 2 else -35, 0)))
    G.pose(parts, turn=20, roll=45)
    return dict(yaw=0, pitch=10, fill=0.86, glow=0.55, glow_sigma=6)


def golem_core():
    stone = G.M("Stone", "#7d776d", 0.9)
    stone_d = G.M("StoneDark", "#57524b", 0.9)
    core = G.M("Core", "#2fd6ff", 0.12, 0.0, emit="#22c8ff", strength=1.7)
    core_hi = G.glow("CoreHi", "#c8fbff", 1.6)
    rune = G.glow("Rune", "#2fe0ff", 1.8)
    parts = []
    # faceted crystal: hexagonal bipyramid
    ring = [(0.2 * math.cos(math.radians(60 * i + 15)), 0.2 * math.sin(math.radians(60 * i + 15)), 0) for i in range(6)]
    ring2 = [(x * 0.95, y * 0.95, 0.12) for x, y, _ in ring]
    parts.append(G.loft("Crystal", [[(0, 0, -0.42)], ring, ring2, [(0, 0, 0.52)]], core))
    # bright inner facet towards the camera
    inner = [(x * 0.45, y * 0.45 - 0.1, z) for x, y, z in ring2]
    parts.append(G.loft("CrystalHi", [[(0, -0.1, -0.05)], inner, [(0, -0.1, 0.4)]], core_hi))
    # stone shards gripping the crystal
    rnd = random.Random(11)
    for i in range(5):
        a = math.radians(72 * i + 10)
        loc = (0.3 * math.cos(a), 0.3 * math.sin(a), -0.18 + rnd.uniform(-0.05, 0.05))
        s = G.ico(f"Shard{i}", 0.17, 1, stone if i % 2 else stone_d, loc=loc, scale=(1.0, 1.0, 1.7), seed=i, jitter=0.03)
        s.rotation_euler = (math.radians(-25 * math.sin(a)), math.radians(25 * math.cos(a)), a)
        parts.append(s)
    base = G.ico("Base", 0.34, 1, stone_d, loc=(0, 0, -0.38), scale=(1.1, 1.1, 0.45), seed=4, jitter=0.03)
    parts.append(base)
    # glowing rune bands on the shards
    for i in range(5):
        a = math.radians(72 * i + 10)
        parts.append(G.box(f"Rune{i}", (0.03, 0.03, 0.14), rune,
                           loc=(0.44 * math.cos(a), 0.44 * math.sin(a), -0.16), rot=(0, 0, math.degrees(a))))
    # floating sparks
    for i, (x, z) in enumerate(((-0.34, 0.36), (0.36, 0.3), (0.12, 0.62))):
        parts.append(G.ico(f"Spark{i}", 0.04, 0, rune, loc=(x, -0.1, z)))
    G.pose(parts, turn=12)
    return dict(yaw=10, pitch=18, fill=0.8, glow=1.1, glow_sigma=8, bloom_over=0.3)


# --------------------------------------------------------------------------- swords
def _sword(kind):
    parts = []
    if kind == "rusty":
        bl = G.M("RustSteel", "#877563", 0.6, 0.45)
        rust = G.M("Rust", "#b3561f", 0.95)
        rust2 = G.M("Rust2", "#80391a", 0.95)
        parts.append(blade("Blade", bl, 0.95, 0.105, 0.09, 0.024, 0.2, n=8, notches=(3, 6), wobble=0.004, seed=3))
        rnd = random.Random(9)
        for i in range(16):
            z = rnd.uniform(0.05, 0.98)
            x = rnd.uniform(-0.05, 0.05)
            for side in (-1, 1):
                p = G.ico(f"Rust{i}{side}", rnd.uniform(0.035, 0.06), 1, rust if i % 3 else rust2,
                          loc=(x, side * 0.02, z), scale=(1.4, 0.12, 1.0), seed=i, jitter=0.008)
                p.rotation_euler = (0, rnd.uniform(0, 3.14), 0)
                parts.append(p)
        iron = G.M("Iron", "#5f5a55", 0.7, 0.6)
        parts.append(G.box("Guard", (0.36, 0.07, 0.06), iron, loc=(0, 0, -0.02), bevel=0.01))
        parts += grip("Grip", -0.3, -0.05, 0.035, G.M("Wrap", "#6b4a2e", 0.9), 4, G.M("WrapDark", "#4d321c", 0.9))
        parts.append(G.ico("Pommel", 0.065, 1, iron, loc=(0, 0, -0.34)))
    elif kind == "steel":
        bl = steel("Blade", "#e6edf4", 0.18)
        fuller = G.M("Fuller", "#8b97a6", 0.3, 0.9)
        g = gold()
        parts.append(blade("Blade", bl, 1.0, 0.11, 0.095, 0.024, 0.22, n=6))
        for side in (-1, 1):
            parts.append(G.box(f"Fuller{side}", (0.035, 0.006, 0.72), fuller, loc=(0, side * 0.023, 0.42)))
        guard = G.tube("Guard", [(-0.26, 0, 0.07), (-0.16, 0, -0.01), (0, 0, -0.03), (0.16, 0, -0.01), (0.26, 0, 0.07)],
                       [0.03, 0.04, 0.045, 0.04, 0.03], 8, steel("GuardSteel", "#c9d3de", 0.25), smooth=True)
        parts.append(guard)
        for sx in (-1, 1):
            parts.append(G.uvsphere(f"GuardEnd{sx}", 0.045, 10, 8, g, loc=(sx * 0.27, 0, 0.08)))
        parts.append(G.ico("GuardGem", 0.05, 1, G.M("Sapphire", "#2f6bff", 0.1, 0.0, emit="#3f7bff", strength=0.6),
                           loc=(0, -0.045, -0.03), scale=(1, 0.5, 1)))
        parts += grip("Grip", -0.3, -0.06, 0.034, G.M("Wrap", "#27365c", 0.8), 5, g)
        parts.append(G.uvsphere("Pommel", 0.06, 12, 8, g, loc=(0, 0, -0.35)))
    else:  # runeblade
        bl = G.M("DarkBlade", "#3b3f55", 0.25, 0.8)
        edge = G.M("Edge", "#c9d6ff", 0.15, 0.9)
        rune = G.glow("Rune", "#8f5cff", 1.5)
        g = gold()
        parts.append(blade("Blade", bl, 1.05, 0.125, 0.1, 0.026, 0.25, n=6))
        # bright edges: a slightly wider thin blade behind
        parts.append(blade("EdgeBlade", edge, 1.05, 0.14, 0.113, 0.012, 0.29, n=6))
        glyphs = [((0, 0.06), (0.0, 0.0)), ((-0.03, 0.0), (0.03, 0.06)), ((0.03, 0.0), (-0.03, 0.06)),
                  ((-0.03, 0.03), (0.03, 0.03)), ((0, 0.0), (0.03, 0.06))]
        for i in range(6):
            z0 = 0.12 + i * 0.14
            for side in (-1, 1):
                a, b = glyphs[i % len(glyphs)]
                p0 = (a[0], side * 0.027, z0 + a[1])
                p1 = (b[0], side * 0.027, z0 + b[1])
                parts.append(G.rod(f"Rune{i}{side}", p0, p1, 0.011, 4, rune))
                parts.append(G.rod(f"RuneV{i}{side}", (0, side * 0.027, z0 - 0.005), (0, side * 0.027, z0 + 0.075),
                                   0.009, 4, rune))
        # winged guard
        for sx in (-1, 1):
            wing = [(0, 0.02), (sx * 0.12, 0.0), (sx * 0.3, 0.12), (sx * 0.34, 0.2), (sx * 0.22, 0.08), (sx * 0.08, 0.08)]
            if sx < 0:
                wing = wing[::-1]
            parts.append(G.extrude(f"Wing{sx}", wing, 0.06, g, bevel=0.008))
        parts.append(G.box("GuardBar", (0.22, 0.07, 0.07), g, loc=(0, 0, 0.0), bevel=0.012))
        parts.append(G.ico("GuardGem", 0.065, 1, G.M("Amethyst", "#8a3dff", 0.1, 0.0, emit="#9a4dff", strength=1.4),
                           loc=(0, -0.05, 0.0), scale=(1, 0.5, 1.2)))
        parts += grip("Grip", -0.32, -0.04, 0.036, G.M("Wrap", "#2a1f3d", 0.8), 5, g)
        parts.append(G.ico("Pommel", 0.07, 1, G.M("PommelGem", "#8a3dff", 0.1, 0.0, emit="#9a4dff", strength=1.4),
                           loc=(0, 0, -0.37), scale=(1, 1, 1.3)))
        parts.append(G.torus("PommelRing", 0.06, 0.018, 12, 6, g, loc=(0, 0, -0.34)))
    G.pose(parts, turn=28, roll=45)


def rusty_sword():
    _sword("rusty")
    return dict(yaw=0, pitch=6, fill=0.9)


def steel_sword():
    _sword("steel")
    return dict(yaw=0, pitch=6, fill=0.9)


def runeblade():
    _sword("rune")
    return dict(yaw=0, pitch=6, fill=0.86, glow=0.9, glow_sigma=6)


# --------------------------------------------------------------------------- staves
def _shaft(name, length, r0, r1, mat, bends=0.03, seed=1, segs=7):
    rnd = random.Random(seed)
    pts = []
    n = 8
    for i in range(n + 1):
        z = length * i / n
        pts.append((rnd.uniform(-bends, bends) if 0 < i < n else 0.0, rnd.uniform(-bends, bends) * 0.5 if 0 < i < n else 0,
                    z))
    radii = [r0 + (r1 - r0) * i / n for i in range(n + 1)]
    return G.tube(name, pts, radii, segs, mat, smooth=False)


def apprentice_staff():
    wood = G.M("Wood", WOOD_LIGHT, 0.8)
    wood_d = G.M("WoodDark", WOOD, 0.8)
    cloth = G.M("Cloth", "#3a6fc4", 0.85)
    gem = G.M("Gem", "#9fe6ff", 0.1, 0.0, emit="#7fdcff", strength=1.8)
    parts = [_shaft("Shaft", 1.9, 0.06, 0.078, wood, 0.025, 2)]
    # gnarled crook at the top holding a small gem
    crook = [(0, 0, 1.88), (0.04, 0, 2.02), (0.14, 0, 2.12), (0.24, 0, 2.08), (0.26, 0, 1.96), (0.2, 0, 1.9)]
    parts.append(G.tube("Crook", crook, [0.078, 0.074, 0.065, 0.058, 0.05, 0.04], 7, wood_d))
    parts.append(G.ico("Gem", 0.1, 1, gem, loc=(0.13, 0, 1.99)))
    # cloth wrap + dangling ribbon
    for i in range(3):
        parts.append(G.torus(f"Wrap{i}", 0.074, 0.024, 12, 5, cloth, loc=(0, 0, 1.6 + i * 0.06)))
    parts.append(G.tube("Ribbon", [(0.05, -0.02, 1.62), (0.12, -0.03, 1.5), (0.1, -0.03, 1.36)], [0.022, 0.02, 0.012], 6, cloth))
    # knots
    for i, z in enumerate((0.7, 1.2)):
        parts.append(G.ico(f"Knot{i}", 0.05, 1, wood_d, loc=(0.035 * (1 - 2 * i), -0.01, z), scale=(1, 0.8, 1.3)))
    parts.append(G.cyl("Foot", 0.05, 0.08, 8, G.M("Iron", "#6c6f75", 0.5, 0.7), loc=(0, 0, 0.03)))
    G.pose(parts, turn=15, roll=42)
    return dict(yaw=0, pitch=6, fill=0.9, glow=0.3)


def arcane_staff():
    wood = G.M("Wood", "#4a2c1e", 0.55)
    silver = steel("Silver", "#d9dee8", 0.2)
    g = gold()
    gem = G.M("Amethyst", "#8a3dff", 0.08, 0.0, emit="#9447ff", strength=1.3)
    parts = [_shaft("Shaft", 1.85, 0.056, 0.072, wood, 0.01, 4, 8)]
    for i, z in enumerate((0.4, 1.0, 1.55)):
        parts.append(G.torus(f"Band{i}", 0.074, 0.026, 14, 6, g, loc=(0, 0, z)))
    # crescent head
    arc_pts = G.arc_points(0.26, -150, 150, 13, centre=(0, 0, 2.08))
    arc_pts = [(p[2] - 2.08, 0, 2.08 - p[0]) for p in arc_pts]  # rotate so the crescent opens upwards
    arc_pts = [(x, y, z) for x, y, z in arc_pts]
    parts.append(G.tube("Crescent", arc_pts, [0.025, 0.045, 0.055, 0.062, 0.068, 0.072, 0.072, 0.072, 0.068, 0.062,
                                              0.055, 0.045, 0.025], 7, silver))
    parts.append(G.cyl("Collar", 0.07, 0.12, 10, g, loc=(0, 0, 1.86), r2=0.085))
    parts.append(G.rod("Neck", (0, 0, 1.9), (0, 0, 1.84), 0.06, 8, g))
    # big gem: elongated octahedron
    ring = [(0.16 * math.cos(math.radians(45 * i)), 0.16 * math.sin(math.radians(45 * i)), 2.1) for i in range(8)]
    parts.append(G.loft("Gem", [[(0, 0, 1.88)], ring, [(0, 0, 2.4)]], gem))
    for i, (x, z) in enumerate(((-0.24, 2.36), (0.22, 2.42), (0.3, 2.2))):
        parts.append(G.ico(f"Mote{i}", 0.03, 0, G.glow("Mote", "#d0a8ff", 1.6), loc=(x, -0.05, z)))
    parts.append(G.cyl("Foot", 0.05, 0.1, 8, g, loc=(0, 0, 0.04), r2=0.04))
    G.pose(parts, turn=15, roll=42)
    return dict(yaw=0, pitch=6, fill=0.9, glow=0.7, glow_sigma=6)


def ember_staff():
    wood = G.M("Charred", "#2b1c16", 0.6)
    crack = G.glow("Crack", "#ff5a14", 1.6)
    iron = G.M("DarkIron", "#3d3a3e", 0.35, 0.8)
    g = gold()
    orb = G.M("Ember", "#e0400c", 0.25, 0.0, emit="#ff3c08", strength=1.2)
    orb_core = G.glow("EmberCore", "#ffc23a", 1.3)
    flame = G.glow("Flame", "#ff9a1a", 1.3)
    flame2 = G.glow("Flame2", "#ff3a0a", 1.2)
    parts = [_shaft("Shaft", 1.85, 0.06, 0.076, wood, 0.02, 6, 7)]
    rnd = random.Random(5)
    for i in range(7):
        z = 0.2 + i * 0.22
        a = rnd.uniform(0, 6.28)
        parts.append(G.box(f"Crack{i}", (0.02, 0.02, 0.12), crack,
                           loc=(0.066 * math.cos(a), 0.066 * math.sin(a), z), rot=(rnd.uniform(-20, 20), 0, math.degrees(a))))
    # flame-shaped iron prongs gripping the orb
    for i in range(4):
        a = math.radians(90 * i + 45)
        c, s = math.cos(a), math.sin(a)
        path = [(0.05 * c, 0.05 * s, 1.82), (0.2 * c, 0.2 * s, 1.95), (0.22 * c, 0.22 * s, 2.12), (0.1 * c, 0.1 * s, 2.34)]
        parts.append(G.tube(f"Prong{i}", path, [0.04, 0.038, 0.03, 0.0], 6, iron))
    parts.append(G.cyl("Collar", 0.075, 0.12, 8, g, loc=(0, 0, 1.84), r2=0.1))
    parts.append(G.uvsphere("Orb", 0.23, 16, 12, orb, loc=(0, 0, 2.1)))
    parts.append(G.uvsphere("OrbCore", 0.13, 12, 8, orb_core, loc=(0.02, -0.13, 2.12)))
    # flame tongues licking up from the orb
    for i, (x, h, r) in enumerate(((0.0, 0.42, 0.13), (-0.12, 0.3, 0.09), (0.13, 0.32, 0.095), (0.06, 0.22, 0.07))):
        path = [(x, -0.02, 2.12), (x * 1.3, -0.03, 2.12 + h * 0.45), (x * 0.4 - 0.02, -0.03, 2.12 + h * 0.8),
                (x * 0.2 + 0.03, -0.03, 2.12 + h)]
        parts.append(G.tube(f"Flame{i}", path, [r, r * 0.85, r * 0.45, 0.0], 8, flame2 if i == 0 else flame))
    parts.append(G.cyl("Foot", 0.055, 0.1, 8, iron, loc=(0, 0, 0.04), r2=0.045))
    G.pose(parts, turn=15, roll=42)
    return dict(yaw=0, pitch=6, fill=0.86, glow=1.0, glow_sigma=7, bloom_over=0.0)


# --------------------------------------------------------------------------- bows
def _bow(kind):
    parts = []
    if kind == "short":
        wood = G.M("BowWood", WOOD_LIGHT, 0.7)
        L, depth, recurve = 1.05, 0.36, 0.0
        grip_mat = G.M("Grip", LEATHER, 0.85)
        tip_mat = G.M("Tip", WOOD_DARK, 0.7)
        r_mid, r_tip = 0.045, 0.02
    elif kind == "long":
        wood = G.M("BowWood", "#6d4122", 0.55)
        L, depth, recurve = 1.6, 0.3, 0.0
        grip_mat = G.M("Grip", "#3a2414", 0.8)
        tip_mat = G.M("Tip", "#e8dcc0", 0.5)
        r_mid, r_tip = 0.05, 0.02
    else:
        wood = G.M("BowWood", "#f1ead6", 0.35)
        L, depth, recurve = 1.45, 0.3, 0.12
        grip_mat = G.M("Grip", "#2f7a3e", 0.7)
        tip_mat = gold()
        r_mid, r_tip = 0.048, 0.018
    # limb curve in XZ: string along x=0, belly bulging to -X
    n = 17
    pts, radii = [], []
    for i in range(n):
        t = -1 + 2 * i / (n - 1)
        z = t * L / 2
        x = -depth * (1 - t * t)
        if recurve:
            x += recurve * max(0.0, abs(t) - 0.7) ** 2 / 0.09
        pts.append((x, 0, z))
        radii.append(r_tip + (r_mid - r_tip) * (1 - abs(t)) ** 0.7)
    parts.append(G.tube("Limb", pts, radii, 8, wood, smooth=True, flat_ratio=0.75))
    top, bot = Vector(pts[-1]), Vector(pts[0])
    string = G.glow("String", "#f4efe0", 0.6, base="#eee6d0")
    parts.append(G.rod("String", tuple(bot), tuple(top), 0.008, 5, string))
    # grip wrap
    parts.append(G.cyl("GripWrap", r_mid * 1.25, 0.24, 10, grip_mat, loc=(-depth, 0, 0), smooth=True))
    for sz in (-1, 1):
        parts.append(G.torus(f"GripRing{sz}", r_mid * 1.28, 0.012, 12, 5, tip_mat, loc=(-depth, 0, sz * 0.12)))
    # nocks
    for p in (top, bot):
        parts.append(G.uvsphere("Nock", r_tip * 1.9, 8, 6, tip_mat, loc=tuple(p)))
    if kind == "long":
        # arrow rest + a few feather tassels
        parts.append(G.tube("Tassel", [(-depth - 0.03, 0, 0.1), (-depth - 0.12, -0.02, 0.0), (-depth - 0.14, -0.03, -0.14)],
                            [0.018, 0.015, 0.0], 6, G.M("Feather", "#b33a2a", 0.8)))
    if kind == "elven":
        g = gold("Filigree")
        leaf = G.M("Leaf", "#39b54a", 0.4, 0.0, emit="#5cff7a", strength=0.8)
        gem = G.M("Emerald", "#2ee86a", 0.1, 0.0, emit="#3cff7f", strength=3.0)
        # golden vine spiralling around the limbs
        for sgn in (-1, 1):
            vine = []
            for k in range(12):
                i = int((n - 1) / 2 + sgn * (1 + k * 0.62))
                i = max(0, min(n - 1, i))
                p = Vector(pts[i])
                a = k * 1.4
                vine.append(tuple(p + Vector((math.cos(a) * 0.045, math.sin(a) * 0.045, 0))))
            parts.append(G.tube(f"Vine{sgn}", vine, 0.011, 5, g))
        # leaves at the grip and near the tips
        for i, (idx, ang, s) in enumerate(((5, 30, 1.0), (11, -30, 1.0), (2, 60, 0.8), (14, -60, 0.8))):
            p = Vector(pts[idx])
            lf = [(0, 0), (0.05, 0.07), (0.04, 0.16), (0, 0.22), (-0.04, 0.16), (-0.05, 0.07)]
            o = G.extrude(f"Leaf{i}", [(x * s, z * s) for x, z in lf], 0.015, leaf)
            G.place(o, loc=(p.x - 0.03, -0.03, p.z), rot=(0, ang + (180 if idx < 8 else 0) + 90, 0))
            parts.append(o)
        parts.append(G.ico("GripGem", 0.06, 1, gem, loc=(-depth - 0.05, -0.02, 0), scale=(0.7, 0.7, 1.1)))
    G.pose(parts, turn=20, roll=-45)


def short_bow():
    _bow("short")
    return dict(yaw=0, pitch=6, fill=0.86)


def long_bow():
    _bow("long")
    return dict(yaw=0, pitch=6, fill=0.9)


def elven_bow():
    _bow("elven")
    return dict(yaw=0, pitch=6, fill=0.86, glow=0.6, glow_sigma=6)


# --------------------------------------------------------------------------- armour
def _ring(width, depth, z, n=16, flat_back=0.85):
    out = []
    for i in range(n):
        a = 2 * math.pi * i / n
        x = width * math.cos(a)
        y = depth * math.sin(a)
        if y > 0:
            y *= flat_back
        out.append((x, y, z))
    return out


def torso(name, mat, rows, n=16, smooth=True):
    """rows = [(z, half_width, half_depth), ...] from hem to shoulders."""
    secs = [_ring(w, d, z, n) for z, w, d in rows]
    return G.loft(name, secs, mat, smooth=smooth, sharp_angle=50 if smooth else None)


def _profile_at(rows, z):
    z = min(max(z, rows[0][0]), rows[-1][0])
    for a in range(len(rows) - 1):
        z0, w0, d0 = rows[a]
        z1, w1, d1 = rows[a + 1]
        if z0 <= z <= z1:
            t = (z - z0) / max(z1 - z0, 1e-6)
            return w0 + (w1 - w0) * t, d0 + (d1 - d0) * t
    return rows[-1][1], rows[-1][2]


def front_point(rows, xf, z, lift=0.0):
    """Point on the front (-Y) surface of a torso at horizontal fraction xf (-1..1) and height z + outward normal."""
    w, d = _profile_at(rows, z)
    x = w * xf
    y = -d * math.sqrt(max(0.0, 1 - xf * xf))
    nrm = Vector((x / (w * w), y / (d * d), 0)).normalized()
    return Vector((x, y, z)) + nrm * lift, nrm


def face_rot(nrm):
    """Z rotation (degrees) that turns an XZ-plane decal (facing -Y) to face `nrm`."""
    return math.degrees(math.atan2(nrm.x, -nrm.y))


def sleeve(name, mat, side, z, length=0.3, r0=0.12, r1=0.14, angle=35, x0=0.36, cuff_mat=None, cuff_r=0.028):
    a = math.radians(angle)
    p0 = Vector((side * x0, 0, z))
    d = Vector((side * math.sin(a), 0, -math.cos(a)))
    p1 = p0 + d * length
    parts = [G.tube(name, [tuple(p0), tuple(p0 + d * (length / 2)), tuple(p1)], [r0, (r0 + r1) / 2, r1], 14, mat,
                    smooth=True)]
    if cuff_mat is not None:
        c = G.torus(name + "Cuff", r1 * 1.0, cuff_r, 18, 6, cuff_mat, loc=tuple(p1 - d * cuff_r))
        G.orient_to(c, d)
        parts.append(c)
    return parts


def leather_tunic():
    leather = G.M("Leather", "#8b5a33", 0.75)
    dark = G.M("LeatherDark", "#5c3a1f", 0.8)
    lace = G.M("Lace", "#e5d3a8", 0.8)
    buckle = G.M("Buckle", "#c9a25a", 0.35, 0.8)
    rows = [(0.0, 0.34, 0.2), (0.18, 0.32, 0.19), (0.42, 0.3, 0.18), (0.62, 0.34, 0.2), (0.8, 0.36, 0.2),
            (0.9, 0.3, 0.17), (0.94, 0.14, 0.12)]
    parts = [torso("Body", leather, rows)]
    for s in (-1, 1):
        parts += sleeve(f"Sleeve{s}", leather, s, 0.82, 0.3, 0.12, 0.13, 40, 0.3, cuff_mat=dark)
    parts.append(G.torus("Collar", 0.14, 0.035, 16, 6, dark, loc=(0, 0.0, 0.93), scale=(1, 0.85, 1)))
    parts.append(G.loft("Hem", [_ring(0.345, 0.205, -0.01), _ring(0.345, 0.205, 0.07)], dark, smooth=True))
    parts.append(G.loft("Belt", [_ring(0.31, 0.19, 0.3), _ring(0.305, 0.185, 0.4)], dark, smooth=True))
    parts.append(G.box("Buckle", (0.12, 0.03, 0.12), buckle, loc=(0, -0.19, 0.35), bevel=0.01))
    parts.append(G.box("BuckleHole", (0.06, 0.035, 0.06), dark, loc=(0, -0.19, 0.35)))
    # chest laces (V opening)
    parts.append(G.extrude("Opening", [(-0.08, 0.92), (0.08, 0.92), (0.0, 0.62)], 0.02, dark, y=-0.19))
    for i in range(3):
        z = 0.86 - i * 0.08
        w = 0.06 - i * 0.012
        parts.append(G.rod(f"LaceA{i}", (-w - 0.02, -0.205, z), (w + 0.02, -0.205, z - 0.06), 0.009, 5, lace))
        parts.append(G.rod(f"LaceB{i}", (w + 0.02, -0.205, z), (-w - 0.02, -0.205, z - 0.06), 0.009, 5, lace))
    # stitched seams on the skirt
    for s in (-1, 1):
        p0, _n = front_point(rows, s * 0.55, 0.06, 0.004)
        p1, _n = front_point(rows, s * 0.52, 0.28, 0.004)
        parts.append(G.rod(f"Seam{s}", tuple(p0), tuple(p1), 0.008, 4, dark))
    G.pose(parts, turn=25)
    return dict(yaw=0, pitch=10, fill=0.86)


def mage_robe():
    robe = G.M("Robe", "#3a4fb8", 0.7)
    robe_d = G.M("RobeDark", "#252f78", 0.75)
    inner = G.M("RobeInner", "#5b2f8f", 0.8)
    trim = gold("Trim")
    star = G.glow("Star", "#ffe38a", 1.2)
    rows = [(0.0, 0.5, 0.32), (0.25, 0.42, 0.27), (0.55, 0.31, 0.2), (0.8, 0.33, 0.2), (1.0, 0.36, 0.21),
            (1.1, 0.29, 0.17), (1.15, 0.14, 0.11)]
    parts = [torso("Body", robe, rows, 20)]
    for s in (-1, 1):
        parts += sleeve(f"Sleeve{s}", robe, s, 1.0, 0.5, 0.11, 0.23, 30, 0.28, cuff_mat=trim, cuff_r=0.032)
    # hood: a thick rolled collar whose back rises behind the neck
    hood = G.torus("Hood", 0.2, 0.085, 24, 8, robe_d, arc=240, start=-30)
    for v in hood.data.vertices:
        v.co.z += 0.2 * max(0.0, v.co.y) / 0.28
        v.co.y += 0.05 * max(0.0, v.co.y) / 0.28
    hood.location = (0, 0.03, 1.15)
    parts.append(hood)
    parts.append(G.lathe("HoodInside", [(0.0, 1.16), (0.15, 1.16)], 16, inner, smooth=True))
    parts.append(G.torus("Collar", 0.15, 0.028, 18, 6, trim, loc=(0, -0.005, 1.14), scale=(1, 0.8, 1)))
    # gold hem, front trim following the surface, waist sash with a gem
    parts.append(G.loft("Hem", [_ring(0.505, 0.325, -0.01), _ring(0.49, 0.315, 0.08)], trim, smooth=True))
    trim_pts = [front_point(rows, 0.0, z, 0.006)[0] for z in [0.08 + i * (1.04 / 9) for i in range(10)]]
    parts.append(G.ribbon("FrontTrim", [tuple(p) for p in trim_pts], 0.085, trim, normal=(0, -1, 0)))
    parts.append(G.loft("Sash", [_ring(0.315, 0.205, 0.55), _ring(0.315, 0.205, 0.64)], robe_d, smooth=True))
    gp, gn = front_point(rows, 0.0, 0.595, 0.02)
    parts.append(G.ico("SashGem", 0.055, 1, G.M("Gem", "#8a3dff", 0.1, 0.0, emit="#9447ff", strength=1.3),
                       loc=tuple(gp), scale=(1, 0.6, 1)))
    # stars embroidered on the skirt
    for i, (xf, z, r) in enumerate(((-0.62, 0.22, 0.06), (0.6, 0.34, 0.055), (-0.45, 0.44, 0.045), (0.45, 0.1, 0.05),
                                    (-0.4, 0.82, 0.04), (0.5, 0.86, 0.04))):
        p, n = front_point(rows, xf, z, 0.004)
        pts = []
        for k in range(10):
            a = math.pi / 2 + k * math.pi / 5
            rr = r if k % 2 == 0 else r * 0.45
            pts.append((rr * math.cos(a), rr * math.sin(a)))
        o = G.extrude(f"Star{i}", pts, 0.012, star)
        G.place(o, loc=tuple(p), rot=(0, 0, face_rot(n)))
        parts.append(o)
    G.pose(parts, turn=25)
    return dict(yaw=0, pitch=10, fill=0.88, glow=0.25)


def chainmail():
    mail = G.M("Mail", "#aeb6c0", 0.35, 0.85)
    ring = G.M("Rings", "#d2d9e2", 0.25, 0.9)
    leather = G.M("Leather", "#5c3a1f", 0.8)
    rows = [(0.0, 0.36, 0.21), (0.2, 0.33, 0.2), (0.42, 0.31, 0.19), (0.62, 0.34, 0.2), (0.8, 0.36, 0.2),
            (0.9, 0.3, 0.17), (0.94, 0.14, 0.12)]
    parts = [torso("Body", mail, rows, 20)]
    for s in (-1, 1):
        parts += sleeve(f"Sleeve{s}", mail, s, 0.82, 0.34, 0.12, 0.14, 38, 0.3, cuff_mat=ring, cuff_r=0.03)
    # ring texture: staggered rows of small rings on the front surface
    for rrow in range(11):
        z = 0.06 + rrow * 0.075
        cols = 9
        for c in range(cols):
            f = -0.85 + 1.7 * (c + 0.5 * (rrow % 2)) / cols
            if abs(f) > 0.95:
                continue
            p, nrm = front_point(rows, f, z, 0.004)
            o = G.torus(f"R{rrow}_{c}", 0.028, 0.009, 10, 4, ring, loc=tuple(p))
            G.orient_to(o, nrm)
            parts.append(o)
    parts.append(G.torus("Collar", 0.15, 0.04, 16, 6, leather, loc=(0, 0.0, 0.93), scale=(1, 0.85, 1)))
    parts.append(G.loft("Belt", [_ring(0.315, 0.195, 0.3), _ring(0.31, 0.19, 0.38)], leather, smooth=True))
    parts.append(G.box("Buckle", (0.1, 0.03, 0.1), G.M("Brass", "#c9a25a", 0.35, 0.8), loc=(0, -0.2, 0.34), bevel=0.01))
    parts.append(G.loft("Hem", [_ring(0.37, 0.215, -0.02), _ring(0.365, 0.21, 0.04)], ring, smooth=True))
    G.pose(parts, turn=25)
    return dict(yaw=0, pitch=10, fill=0.86)


def golem_plate():
    plate = G.M("PlateSteel", "#8d97a3", 0.32, 0.75)
    plate_l = steel("PlateLight", "#c3ccd6", 0.25)
    stone = G.M("Stone", "#8c867a", 0.85)
    stone_d = G.M("StoneDark", "#615b52", 0.9)
    moss = G.M("Moss", "#5f8a3a", 0.9)
    rune = G.glow("Rune", "#2fe0ff", 1.8)
    core = G.M("Core", "#2fd6ff", 0.1, 0.0, emit="#22c8ff", strength=1.8)
    rows = [(0.0, 0.36, 0.23), (0.18, 0.33, 0.22), (0.45, 0.35, 0.24), (0.7, 0.42, 0.27), (0.86, 0.44, 0.26),
            (0.97, 0.33, 0.21), (1.02, 0.16, 0.13)]
    parts = [torso("Cuirass", plate, rows, 14, smooth=False)]
    # stone chest slab with the glowing core
    cp, cn = front_point(rows, 0.0, 0.6, 0.0)
    slab_pts = [(-0.27, 0.2), (0.27, 0.2), (0.31, -0.02), (0.0, -0.3), (-0.31, -0.02)]
    slab = G.extrude("ChestSlab", slab_pts, 0.1, stone, bevel=0.02)
    G.jitter_obj(slab, 0.008, 4)
    G.place(slab, loc=(cp.x, cp.y - 0.01, cp.z))
    parts.append(slab)
    parts.append(G.ico("CoreSetting", 0.11, 1, plate_l, loc=(0, cp.y - 0.06, 0.6), scale=(1, 0.45, 1)))
    ringp = [(0.085 * math.cos(math.radians(60 * i + 30)), cp.y - 0.1, 0.6 + 0.1 * math.sin(math.radians(60 * i + 30)))
             for i in range(6)]
    parts.append(G.loft("Core", [[(0, cp.y - 0.07, 0.6)], ringp, [(0, cp.y - 0.15, 0.6)]], core))
    for i, (ang, ln) in enumerate(((25, 0.17), (155, 0.17), (-55, 0.16), (-125, 0.16), (90, 0.07))):
        a = math.radians(ang)
        p0 = (0.1 * math.cos(a), cp.y - 0.07, 0.6 + 0.1 * math.sin(a))
        p1 = ((0.1 + ln) * math.cos(a), cp.y - 0.065, 0.6 + (0.1 + ln) * math.sin(a))
        parts.append(G.rod(f"Crack{i}", p0, p1, 0.016, 4, rune, r1=0.007))
    for i, (x, z) in enumerate(((-0.24, 0.77), (0.24, 0.77), (0.0, 0.34))):
        parts.append(G.uvsphere(f"Rivet{i}", 0.025, 8, 6, plate_l, loc=(x, cp.y - 0.06, z)))
    # massive domed stone pauldrons (three overlapping plates each) with steel rims
    for s in (-1, 1):
        axis = Vector((s * math.sin(math.radians(42)), 0, math.cos(math.radians(42))))
        base = Vector((s * 0.43, 0.0, 0.86))
        for k in range(3):
            R = 0.3 - 0.035 * k
            h = 0.2 - 0.03 * k
            prof = [(0.0, h), (R * 0.5, h * 0.88), (R * 0.82, h * 0.58), (R, 0.0)]
            dome = G.lathe(f"Pauldron{s}{k}", prof, 12, stone if k == 0 else stone_d, smooth=False, cap=True)
            G.jitter_obj(dome, 0.006, 10 + k)
            loc = base + Vector((s * 0.07 * k, 0, -0.1 * k))
            G.orient_to(dome, axis)
            dome.location = loc
            rim = G.torus(f"PauldronRim{s}{k}", R, 0.026, 16, 5, plate_l, loc=tuple(loc), smooth=False)
            G.orient_to(rim, axis)
            parts += [dome, rim]
        # moss tuft + rune on the top plate
        parts.append(G.ico(f"Moss{s}", 0.07, 1, moss, loc=tuple(base + axis * 0.17 + Vector((0, 0.06, 0))),
                           scale=(1.3, 1.0, 0.5), seed=s + 5, jitter=0.01))
        rp = base + axis * 0.12 + Vector((0, -0.2, 0))
        parts.append(G.box(f"PauldronRune{s}", (0.1, 0.03, 0.028), rune, loc=tuple(rp), rot=(0, -s * 42, 0)))
    parts.append(G.torus("Gorget", 0.17, 0.05, 12, 6, plate_l, loc=(0, 0.0, 1.0), scale=(1, 0.85, 1), smooth=False))
    parts.append(G.loft("Waist", [_ring(0.37, 0.24, -0.02, 14), _ring(0.355, 0.235, 0.08, 14)], plate_l, smooth=False))
    # stone tassets hanging at the front
    for i, xf in enumerate((-0.55, 0.0, 0.55)):
        p, n = front_point(rows, xf, 0.0, 0.02)
        t = G.extrude(f"Tasset{i}", [(-0.1, 0.02), (0.1, 0.02), (0.085, -0.2), (-0.085, -0.2)], 0.05, stone_d, bevel=0.01)
        G.place(t, loc=tuple(p), rot=(0, 0, face_rot(n)))
        parts.append(t)
    G.pose(parts, turn=25)
    return dict(yaw=0, pitch=10, fill=0.86, glow=0.8, glow_sigma=6)


# --------------------------------------------------------------------------- gold
def gold_coins():
    g = G.M("Gold", "#f2c14e", 0.26, 0.85)
    g2 = G.M("GoldDeep", "#d99a2b", 0.3, 0.85)
    rnd = random.Random(21)
    parts = []

    def coin(i, loc, rot):
        c = G.cyl(f"Coin{i}", 0.15, 0.035, 20, g, smooth=True)
        G.add_bevel(c, 0.008, 1, 30)
        face = G.cyl(f"CoinFace{i}", 0.1, 0.042, 20, g2, smooth=True)
        face.parent = c
        c.location = loc
        c.rotation_euler = tuple(math.radians(a) for a in rot)
        parts.extend([c, face])

    i = 0
    # heap: rings of coins, each ring higher and narrower
    for layer, (rad, cnt, z) in enumerate(((0.42, 11, 0.02), (0.3, 8, 0.07), (0.17, 5, 0.12), (0.0, 1, 0.17))):
        for k in range(cnt):
            a = 2 * math.pi * k / max(cnt, 1) + layer * 0.4
            loc = (rad * math.cos(a) + rnd.uniform(-0.03, 0.03), rad * math.sin(a) + rnd.uniform(-0.03, 0.03),
                   z + rnd.uniform(-0.01, 0.01))
            tilt = 18 if rad > 0 else 0
            rot = (rnd.uniform(-tilt, tilt), rnd.uniform(-tilt, tilt), rnd.uniform(0, 360))
            coin(i, loc, rot)
            i += 1
    # a small stack and a coin standing on its edge
    for k in range(5):
        coin(i, (0.34 + rnd.uniform(-0.01, 0.01), 0.18, 0.02 + k * 0.038), (0, 0, rnd.uniform(0, 360)))
        i += 1
    coin(i, (-0.12, -0.3, 0.2), (72, 0, 18))
    i += 1
    coin(i, (0.2, -0.38, 0.1), (60, 10, -30))
    G.pose(parts, turn=0)
    return dict(yaw=20, pitch=32, fill=0.9)


BUILDERS = {
    "potion_hp_s": potion_hp_s,
    "potion_hp_l": potion_hp_l,
    "potion_mp_s": potion_mp_s,
    "slime_gel": slime_gel,
    "wolf_pelt": wolf_pelt,
    "goblin_trinket": goblin_trinket,
    "ancient_bone": ancient_bone,
    "golem_core": golem_core,
    "rusty_sword": rusty_sword,
    "steel_sword": steel_sword,
    "runeblade": runeblade,
    "apprentice_staff": apprentice_staff,
    "arcane_staff": arcane_staff,
    "ember_staff": ember_staff,
    "short_bow": short_bow,
    "long_bow": long_bow,
    "elven_bow": elven_bow,
    "leather_tunic": leather_tunic,
    "mage_robe": mage_robe,
    "chainmail": chainmail,
    "golem_plate": golem_plate,
    "gold": gold_coins,
}
