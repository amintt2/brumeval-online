"""Goblin camp and graveyard props: campfire, tent, gravestone. Front = -Y, base centre at the origin."""
import math

import structkit as K
from structkit import mat

V = K.Vector


# =========================================================================== CAMPFIRE
def build_campfire():
    """~1.6 m ring of stones, ash bed, crossed + leaning logs, emissive flame tongues and embers."""
    b = K.Builder(seed=71)
    STONE, ASH, LOG = mat("Stone"), mat("Ash"), mat("LogBark")
    FLAME, CORE, EMBER = mat("GlowFlame"), mat("GlowFlameCore"), mat("GlowEmber")
    n = 10
    for i in range(n):
        a = 2 * math.pi * i / n + b.rand(-0.08, 0.08)
        r = 0.66 + b.rand(-0.02, 0.02)
        size = b.rand(0.16, 0.19)
        b.ico(size, (math.cos(a) * r, math.sin(a) * r, size * 0.4), 1, STONE, scale=(1.25, 0.9, 0.8),
              rot=(0, 0, a + math.pi / 2), jitter=0.025)
    b.cyl(0.56, 0.05, (0, 0, 0.015), segments=12, material=ASH, jitter=0.01)
    # two crossed logs lying in the fire + three leaning logs
    for ang, z in ((math.radians(25), 0.075), (math.radians(115), 0.165)):
        d = V((math.cos(ang), math.sin(ang), 0)) * 0.46
        b.cyl_between((-d.x, -d.y, z), (d.x, d.y, z + 0.02), 0.07, 7, LOG, jitter=0.008)
    for k in range(3):
        a = math.radians(90 + k * 120 + 15)
        base = (math.cos(a) * 0.42, math.sin(a) * 0.42, 0.06)
        top = (math.cos(a) * 0.05, math.sin(a) * 0.05, 0.56)
        b.cyl_between(base, top, 0.055, 6, LOG, jitter=0.006)
    # flames: a tall yellow core surrounded by orange tongues leaning outwards
    flame = [(0.0, 0.0), (0.15, 0.08), (0.19, 0.24), (0.12, 0.48), (0.0, 0.82)]
    b.lathe(flame, 6, loc=(0, 0, 0.1), material=CORE, scale=(0.95, 0.95, 1.1), jitter=0.015)
    for k in range(5):
        a = 2 * math.pi * k / 5 + 0.3
        off = (math.cos(a) * 0.17, math.sin(a) * 0.17, 0.08)
        t = 0.3
        s = b.rand(0.55, 0.8)
        b.lathe(flame, 5, loc=off, rot=(-math.sin(a) * t, math.cos(a) * t, 0), material=FLAME,
                scale=(0.9 * s, 0.9 * s, s), jitter=0.015)
    for k in range(7):
        a = b.rand(0, 2 * math.pi)
        r = b.rand(0.25, 0.46)
        b.box((0.05, 0.05, 0.03), (math.cos(a) * r, math.sin(a) * r, 0.045), (0, 0, a), EMBER, jitter=0.008)
    return b.build("campfire")


# =========================================================================== TENT
def build_tent():
    """~3.5 m goblin tent of patched hides on crossed poles; doorway with folded flaps on the front (-Y)."""
    b = K.Builder(seed=81)
    HL, HM, HD = mat("HideLight"), mat("HideMid"), mat("HideDark")
    WOOD, SHADOW, BONE, STONE = mat("Wood"), mat("Shadow"), mat("Bone"), mat("StoneDark")
    SEG = 8
    phase = -math.pi / 2 - math.pi / SEG          # segment 0 is centred on -Y (front)
    prof = [(1.74, 0.0), (1.44, 0.55), (1.05, 1.2), (0.58, 1.9), (0.17, 2.45)]
    rnd = b.rng
    colours = [HL, HM, HD]
    pattern = {(i, k): colours[(i + k * 2 + rnd.randrange(3)) % 3] for i in range(SEG) for k in range(len(prof) - 1)}
    for k in range(len(prof) - 1):   # front panel in one colour so the doorway reads well
        pattern[(0, k)] = HM
    lean = (0.05, 0.035)   # the whole tent leans a little: goblin craftsmanship

    def ring_pt(i, k, out=0.0):
        r, z = prof[k]
        a = phase + 2 * math.pi * i / SEG
        f = z / prof[-1][1]
        return V((math.cos(a) * (r + out) + lean[0] * f, math.sin(a) * (r + out) + lean[1] * f, z))

    rings = [[tuple(ring_pt(i, k)) for i in range(SEG)] for k in range(len(prof))]
    b.loft(rings, HM, cap_bottom=False, cap_top=False, face_mat=lambda i, band: pattern[(i, band)], jitter=0.03)

    def panel(i, s, t, out=0.05):
        """Point on panel i: s across (0..1), t up in profile rings (0..len(prof)-1)."""
        k = min(int(t), len(prof) - 2)
        f = t - k
        lo = ring_pt(i, k, out).lerp(ring_pt(i + 1, k, out), s)
        hi = ring_pt(i, k + 1, out).lerp(ring_pt(i + 1, k + 1, out), s)
        return lo.lerp(hi, f)

    # doorway (dark opening) and two folded-back flaps tied with straps
    bl, br, apex = panel(0, 0.18, 0.0, 0.04), panel(0, 0.82, 0.0, 0.04), panel(0, 0.5, 2.45, 0.04)
    b.poly([bl, br, apex], SHADOW)
    fl, fr = panel(0, -0.14, 0.0, 0.1), panel(0, 1.14, 0.0, 0.1)
    b.poly([bl + V((0, -0.03, 0)), apex + V((0, -0.05, 0)), fl + V((0, -0.02, 0.02))], HL)
    b.poly([br + V((0, -0.03, 0)), fr + V((0, -0.02, 0.02)), apex + V((0, -0.05, 0))], HL)
    for s0, s1 in ((-0.1, 0.12), (0.88, 1.1)):
        b.beam(panel(0, s0, 0.9, 0.11), panel(0, s1, 0.9, 0.11), 0.05, 0.05, HD)
    # patches sewn on the hides
    for (i, s, t, w, h, m) in ((2, 0.3, 0.3, 0.3, 0.4, HD), (3, 0.5, 1.5, 0.25, 0.3, HL), (5, 0.35, 0.5, 0.35, 0.35, HL),
                               (6, 0.6, 1.2, 0.3, 0.3, HD), (7, 0.4, 0.3, 0.3, 0.45, HD), (1, 0.55, 1.6, 0.25, 0.3, HL),
                               (4, 0.3, 0.8, 0.3, 0.3, HD), (1, 0.2, 0.25, 0.3, 0.35, HD)):
        pts = [panel(i, s, t, 0.045), panel(i, s + w, t, 0.045), panel(i, s + w, t + h, 0.045),
               panel(i, s, t + h, 0.045)]
        b.poly(pts, m)
    # crossed poles sticking out of the top, bound with a hide strap
    for k in range(4):
        a = math.radians(45 + 90 * k + (8 if k % 2 else -6))
        p0 = (math.cos(a) * 0.55, math.sin(a) * 0.55, 1.6)
        p1 = (-math.cos(a) * 0.34, -math.sin(a) * 0.34, 3.15 + 0.08 * (k % 2))
        b.cyl_between(p0, p1, 0.045, 6, WOOD, jitter=0.006)
    b.cyl(0.13, 0.14, (0, 0, 2.47), segments=8, material=HD, jitter=0.01)
    # goblin trophy above the doorway: a skull between two curved tusks
    sk = panel(0, 0.5, 2.72, 0.1)
    b.ico(0.15, sk, 1, BONE, scale=(1.0, 0.9, 0.88), jitter=0.01)
    b.box((0.17, 0.11, 0.08), sk + V((0, -0.06, -0.13)), (0.2, 0, 0), BONE)
    for sx in (-1, 1):
        b.box((0.06, 0.03, 0.055), sk + V((sx * 0.055, -0.125, 0.0)), (0, 0, 0), SHADOW)
        base = sk + V((sx * 0.12, -0.02, -0.06))
        mid = base + V((sx * 0.2, -0.12, -0.06))
        tip = mid + V((sx * 0.08, -0.08, 0.26))
        b.cyl_between(base, mid, 0.05, 6, BONE, r2=0.038)
        b.cyl_between(mid, tip, 0.038, 6, BONE, r2=0.006)
    b.box((0.03, 0.03, 0.04), sk + V((0, -0.13, -0.05)), (0, 0, 0), SHADOW)
    # stones holding the hem down (none in front of the doorway)
    for k in range(14):
        a = phase + 2 * math.pi * (k + 0.5) / 14
        if abs(math.atan2(math.sin(a + math.pi / 2), math.cos(a + math.pi / 2))) < 0.45:
            continue
        r = 1.72 + b.rand(-0.03, 0.03)
        b.ico(b.rand(0.1, 0.14), (math.cos(a) * r, math.sin(a) * r, 0.03), 1, STONE, scale=(1.3, 1.0, 0.7),
              rot=(0, 0, a), jitter=0.02)
    return b.build("tent")


# =========================================================================== GRAVESTONE
def build_gravestone():
    """~1 m weathered round-topped headstone with a carved cross and inscription (front -Y), moss, grave mound."""
    b = K.Builder(seed=91)
    STONE, CARVE, MOSS, DIRT = mat("StoneGrave"), mat("Carving"), mat("Moss"), mat("Dirt")
    # the grave in front (-Y): a low, slightly broken stone kerb around a dirt bed
    GY0, GY1, GX = -0.2, -1.42, 0.36
    b.box_minmax((-GX + 0.05, GY1 + 0.05, -0.1), (GX - 0.05, GY0, 0.06), DIRT, jitter=0.012)
    for (p0, p1) in (((-GX, GY1), (-GX + 0.09, GY0)), ((GX - 0.09, GY1 + 0.25), (GX, GY0)),
                     ((-GX, GY1), (GX, GY1 + 0.09))):
        b.box_minmax((p0[0], p0[1], -0.1), (p1[0], p1[1], 0.1), STONE, jitter=0.012)
    b.box((0.09, 0.26, 0.1), (GX - 0.02, GY1 + 0.1, 0.02), (0.25, 0.1, 0.35), STONE, jitter=0.01)   # fallen piece
    b.box((0.74, 0.34, 0.16), (0, 0, 0.05), material=STONE, jitter=0.015)          # plinth
    Wd, R = 0.3, 0.3
    pts = [(-Wd, 0.0), (Wd, 0.0), (Wd, 0.62)]
    for i in range(1, 8):
        a = math.pi * i / 8
        pts.append((math.cos(a) * R, 0.62 + math.sin(a) * R))
    pts.append((-Wd, 0.62))
    rot = (math.radians(-4), math.radians(2.5), 0)
    tilt = K.M(loc=(0, 0.02, 0.1), rot=rot)
    b.prism(pts, -0.085, 0.085, STONE, mtx=tilt, jitter=0.012)

    def front(x, z, depth=0.0):
        return tilt @ V((x, -0.093 - depth, z))
    b.box((0.055, 0.02, 0.32), front(0, 0.68), rot, CARVE)           # cross
    b.box((0.21, 0.02, 0.055), front(0, 0.75), rot, CARVE)
    for z, w in ((0.4, 0.34), (0.32, 0.26), (0.24, 0.3)):           # inscription lines
        b.box((w, 0.016, 0.035), front(0, z), rot, CARVE)
    # moss on the top and at the foot
    b.ico(0.1, tilt @ V((-0.16, 0, 0.87)), 1, MOSS, scale=(1.4, 1.0, 0.55), jitter=0.02)
    b.ico(0.08, tilt @ V((0.05, -0.01, 0.93)), 1, MOSS, scale=(1.6, 1.1, 0.5), jitter=0.015)
    b.ico(0.1, (0.3, -0.12, 0.12), 1, MOSS, scale=(1.3, 1.0, 0.6), jitter=0.02)
    b.ico(0.09, (-0.33, 0.05, 0.1), 1, MOSS, scale=(1.2, 1.2, 0.6), jitter=0.02)
    for k in range(9):   # grass tufts on the grave and around the kerb
        x = b.rand(-0.3, 0.3) if k < 6 else (-0.45 if k % 2 else 0.45)
        y = -0.3 - b.rand(0, 1.0)
        hgt = b.rand(0.1, 0.18)
        b.cone(0.045, hgt, (x, y, hgt / 2 + 0.01), (b.rand(-0.25, 0.25), b.rand(-0.25, 0.25), 0), 3, MOSS)
    return b.build("gravestone")
