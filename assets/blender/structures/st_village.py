"""Village props: well, fence, lamp_post, crate, barrel, stall. Front = -Y, base centre at the origin."""
import math

import structkit as K
from structkit import mat, ring_band, stepped_roof

V = K.Vector


# =========================================================================== WELL
def build_well():
    """~2.4 m stone well: staggered wedge stones, dark water, two posts, small shingle roof, windlass, bucket."""
    b = K.Builder(seed=21)
    STONE, DARK, WOOD, ROOF = mat("Stone"), mat("StoneDark"), mat("Wood"), mat("Roof")
    WATER, IRON, ROPE = mat("Water"), mat("Iron"), mat("Rope")
    RO, RI = 1.14, 0.86
    # core ring that fills the joints between the stones (reads as dark mortar)
    ring_band(b, RI + 0.05, RO - 0.07, -0.15, 0.84, 16, DARK)
    # three staggered courses of wedge stones + a wider coping course
    courses = [(-0.1, 0.27, RI, RO, 0.0), (0.27, 0.55, RI, RO, 0.5), (0.55, 0.82, RI, RO, 0.0),
               (0.82, 0.96, RI - 0.04, RO + 0.06, 0.25)]
    n = 11
    for (z0, z1, ri, ro, off) in courses:
        for i in range(n):
            a0 = 2 * math.pi * (i + off) / n + 0.018
            a1 = 2 * math.pi * (i + 1 + off) / n - 0.018
            am = (a0 + a1) / 2
            ring = [(math.cos(a) * r, math.sin(a) * r)
                    for (r, a) in ((ro, a0), (ro, am), (ro, a1), (ri, a1), (ri, am), (ri, a0))]
            zz0 = z0 + 0.012
            zz1 = z1 - 0.012 + b.rand(-0.015, 0.015)
            b.loft([[(x, y, zz0) for x, y in ring], [(x, y, zz1) for x, y in ring]], STONE, jitter=0.018)
    b.cyl(RI + 0.06, 0.04, (0, 0, 0.46), segments=16, material=WATER)

    # posts, knee braces, ridge beam
    PX, TOP = 1.0, 2.55
    for sx in (-1, 1):
        b.box((0.17, 0.17, TOP + 0.2), (sx * PX, 0, TOP / 2), material=WOOD, jitter=0.006)
        b.beam((sx * PX, 0, TOP - 0.55), (sx * 0.55, 0, TOP - 0.02), 0.1, 0.1, WOOD)
        b.box((0.28, 0.3, 0.12), (sx * PX, 0, 1.0), material=WOOD)
    b.box((2 * PX + 0.5, 0.15, 0.16), (0, 0, TOP + 0.05), material=WOOD)
    # little gable roof (ridge along X) with rafters at both gable ends
    RZ = TOP + 0.2
    eave = stepped_roof(b, PX + 0.38, RZ, 0.98, 36, 2, ROOF, thickness=0.09, lift=0.06, overlap=0.1, along="x")
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.beam((sx * (PX + 0.25), 0, RZ - 0.03), (sx * (PX + 0.25), sy * 0.98, eave - 0.03), 0.07, 0.09, WOOD)
    b.box((2 * PX + 0.9, 0.2, 0.2), (0, 0, RZ + 0.1), (math.radians(45), 0, 0), WOOD)

    # windlass: axle, rope drum, crank handle on the right
    AZ = 1.62
    b.cyl_between((-PX - 0.1, 0, AZ), (PX + 0.2, 0, AZ), 0.05, 8, WOOD)
    b.cyl_between((-0.25, 0, AZ), (0.25, 0, AZ), 0.11, 10, ROPE, jitter=0.004)
    for x in (-0.27, 0.27):
        b.cyl_between((x - 0.02, 0, AZ), (x + 0.02, 0, AZ), 0.15, 10, WOOD)
    b.beam((PX + 0.2, 0, AZ), (PX + 0.2, 0, AZ - 0.34), 0.05, 0.05, IRON, extend=0.02)
    b.cyl_between((PX + 0.2, 0, AZ - 0.34), (PX + 0.42, 0, AZ - 0.34), 0.035, 6, WOOD)
    # rope + bucket hanging above the water
    BZ, BY = 0.98, -0.11
    b.cyl_between((0.0, BY, AZ - 0.02), (0.0, BY, BZ + 0.42), 0.015, 4, ROPE)
    b.lathe([(0.13, BZ), (0.165, BZ + 0.27), (0.145, BZ + 0.27), (0.125, BZ + 0.2)], 10, loc=(0, BY, 0),
            material=WOOD)
    b.cyl(0.125, 0.01, (0, BY, BZ + 0.205), segments=10, material=WATER)
    for z in (BZ + 0.05, BZ + 0.21):
        rr = 0.13 + (z - BZ) / 0.27 * 0.035
        ring_band(b, rr - 0.004, rr + 0.012, z - 0.018, z + 0.018, 10, IRON, loc=(0, BY, 0))
    for sx in (-1, 1):   # bail handle
        b.beam((sx * 0.155, BY, BZ + 0.26), (sx * 0.06, BY, BZ + 0.42), 0.02, 0.02, IRON, extend=0.01)
    b.beam((-0.06, BY, BZ + 0.42), (0.06, BY, BZ + 0.42), 0.02, 0.02, IRON, extend=0.01)
    return b.build("well")


# =========================================================================== FENCE
def build_fence():
    """ONE 2 m segment along X (x in [-1, 1]); posts at x = +-0.5 so chained segments get a post every metre."""
    b = K.Builder(seed=31)
    POST, RAIL = mat("WoodDark"), mat("Wood")
    for x, h, tilt in ((-0.5, 1.0, 0.02), (0.5, 0.97, -0.025)):
        b.box((0.13, 0.13, h + 0.12), (x, 0, (h - 0.12) / 2), (0.0, tilt, 0.0), POST)
        top = (h + 0.12) / 2 + 0.06
        b.cone(0.13 / math.sqrt(2) + 0.004, 0.12, (x + math.sin(tilt) * top, 0, (h - 0.12) / 2 + math.cos(tilt) * top),
               (0, tilt, math.radians(45)), 4, POST)
    for z, dz in ((0.4, 0.012), (0.76, -0.01)):
        b.beam((-1.0, -0.075, z), (0.0, -0.075, z + dz), 0.05, 0.11, RAIL)
        b.beam((0.0, -0.075, z + dz), (1.0, -0.075, z), 0.05, 0.11, RAIL)
    return b.build("fence")


# =========================================================================== LAMP POST
def build_lamp_post():
    """~3 m iron lamp post on a stone plinth; the lantern hangs from an arm towards the front (-Y)."""
    b = K.Builder(seed=41)
    STONE, IRON, GLOW = mat("Stone"), mat("Iron"), mat("GlowLantern")
    b.box((0.46, 0.46, 0.34), (0, 0, 0.12), material=STONE, jitter=0.02)
    b.box((0.36, 0.36, 0.1), (0, 0, 0.33), material=STONE, jitter=0.01)
    b.cyl(0.07, 2.5, (0, 0, 0.36 + 1.25), segments=8, material=IRON, r2=0.055)
    for z, r in ((0.44, 0.11), (1.25, 0.085), (2.5, 0.085)):
        b.cyl(r, 0.07, (0, 0, z), segments=8, material=IRON)
    b.sphere(0.075, (0, 0, 2.9), 8, 5, IRON)
    b.cone(0.045, 0.14, (0, 0, 3.02), segments=6, material=IRON)
    # arm with a brace and a decorative ring
    AZ = 2.68
    b.beam((0, 0.03, AZ), (0, -0.66, AZ), 0.05, 0.06, IRON)
    b.beam((0, -0.02, AZ - 0.42), (0, -0.4, AZ - 0.02), 0.035, 0.035, IRON)
    ring_band(b, 0.05, 0.07, -0.018, 0.018, 8, IRON, loc=(0, -0.3, AZ - 0.13), rot=(0, math.radians(90), 0))
    # hook + lantern
    LX, LY = 0.0, -0.58
    b.beam((LX, LY, AZ), (LX, LY, AZ - 0.12), 0.025, 0.025, IRON)
    top = AZ - 0.12
    b.cone(0.2, 0.16, (LX, LY, top - 0.08), (0, 0, math.radians(45)), 4, IRON)
    b.box((0.27, 0.27, 0.035), (LX, LY, top - 0.17), material=IRON)
    gz0, gz1 = top - 0.5, top - 0.19
    b.box((0.2, 0.2, gz1 - gz0), (LX, LY, (gz0 + gz1) / 2), material=GLOW)
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.box((0.03, 0.03, gz1 - gz0 + 0.02), (LX + sx * 0.105, LY + sy * 0.105, (gz0 + gz1) / 2), material=IRON)
    b.box((0.25, 0.25, 0.04), (LX, LY, gz0 - 0.02), material=IRON)
    b.cone(0.05, 0.08, (LX, LY, gz0 - 0.08), (math.radians(180), 0, 0), 4, IRON)
    return b.build("lamp_post")


# =========================================================================== CRATE
def build_crate():
    """~1 m wooden crate: planked sides, dark edge frame, diagonal braces, iron nails."""
    b = K.Builder(seed=51)
    LIGHT, DARK, IRON = mat("WoodLight"), mat("WoodDark"), mat("Iron")
    S = 0.98
    h = S / 2
    b.box((S - 0.06, S - 0.06, S - 0.06), (0, 0, h), material=DARK)   # inner core (dark joints)
    n = 3
    pw = (S - 0.08) / n
    for face in range(4):
        rot = (0, 0, face * math.pi / 2)
        R = K.M(rot=rot)
        for i in range(n):
            z = 0.04 + pw * (i + 0.5)
            d = 0.012 if (i + face) % 2 else 0.0
            b.box((S - 0.1, 0.04 + d, pw - 0.018), R @ V((0, -h + 0.02, z)), rot, LIGHT)
    for i in range(n):
        x = -h + 0.04 + pw * (i + 0.5)
        b.box((pw - 0.018, S - 0.1, 0.04 + 0.01 * (i % 2)), (x, 0, S - 0.02), material=LIGHT)
    e = 0.1
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.box((e, e, S), (sx * (h - e / 2), sy * (h - e / 2), h), material=DARK)
    for z in (e / 2, S - e / 2):
        for sy in (-1, 1):
            b.box((S - 2 * e + 0.01, e, e), (0, sy * (h - e / 2), z), material=DARK)
        for sx in (-1, 1):
            b.box((e, S - 2 * e + 0.01, e), (sx * (h - e / 2), 0, z), material=DARK)
    for face in range(4):
        R = K.M(rot=(0, 0, face * math.pi / 2))
        s = 1 if face % 2 else -1
        p0 = R @ V((s * (h - e), -h - 0.005, e))
        p1 = R @ V((-s * (h - e), -h - 0.005, S - e))
        normal = (R.to_3x3() @ V((0, -1, 0)))
        b.beam(p0, p1, 0.1, 0.03, DARK, up=tuple(normal))
        for sx in (-1, 1):
            for z in (e / 2, S - e / 2):
                b.box((0.035, 0.035, 0.035), R @ V((sx * (h - e / 2), -h - 0.004, z)), (0, 0, face * math.pi / 2), IRON)
    return b.build("crate")


# =========================================================================== BARREL
def build_barrel():
    """~1.1 m bulging barrel with alternating staves, four iron hoops and a planked lid."""
    b = K.Builder(seed=61)
    WOOD, LIGHT, DARK, IRON = mat("Wood"), mat("WoodLight"), mat("WoodDark"), mat("Iron")
    SEG = 14
    prof = [(0.35, 0.0), (0.405, 0.14), (0.44, 0.33), (0.455, 0.55), (0.44, 0.77), (0.405, 0.96), (0.35, 1.1)]
    b.lathe(prof, SEG, material=WOOD, face_mat=lambda i, band: LIGHT if i % 2 else None)

    def radius(z):
        for (r0, z0), (r1, z1) in zip(prof[:-1], prof[1:]):
            if z0 <= z <= z1:
                return r0 + (r1 - r0) * (z - z0) / (z1 - z0)
        return prof[-1][0]
    for z in (0.1, 0.36, 0.74, 1.0):
        r = radius(z)
        ring_band(b, r - 0.01, r + 0.016, z - 0.035, z + 0.035, SEG, IRON)
    # lid: light planks with dark seams, a bung
    b.cyl(0.325, 0.03, (0, 0, 1.1), segments=SEG, material=LIGHT)
    for x in (-0.11, 0.11):
        half = math.sqrt(0.325 ** 2 - x * x) - 0.01
        b.box((0.016, 2 * half, 0.01), (x, 0, 1.117), material=DARK)
    b.cyl(0.045, 0.03, (0.2, -0.1, 1.125), segments=6, material=DARK)
    return b.build("barrel")


# =========================================================================== STALL
def build_stall():
    """~3 m market stall: striped canvas awning, planked counter with apples, bottles, cloth rolls."""
    b = K.Builder(seed=101)
    WOOD, LIGHT = mat("Wood"), mat("WoodLight")
    RED, WHITE = mat("CanvasRed"), mat("CanvasWhite")
    APPLE, GLASS, BLUE, GOLD = mat("Apple"), mat("Glass"), mat("ClothBlue"), mat("ClothGold")
    PX, FY, BY = 1.3, -0.78, 0.75
    FZ, BZ = 2.2, 2.7
    # posts and beams
    for sx in (-1, 1):
        b.box((0.11, 0.11, FZ + 0.1), (sx * PX, FY, (FZ + 0.1) / 2), material=WOOD)
        b.box((0.11, 0.11, BZ + 0.1), (sx * PX, BY, (BZ + 0.1) / 2), material=WOOD)
    b.box((2 * PX + 0.2, 0.12, 0.12), (0, FY, FZ), material=WOOD)
    b.box((2 * PX + 0.2, 0.12, 0.12), (0, BY, BZ), material=WOOD)
    slope = (BZ - FZ) / (BY - FY)
    for sx in (-1, 0, 1):   # rafters resting on the beams, under the canvas
        b.beam((sx * PX, BY + 0.2, BZ + 0.05 + slope * 0.2), (sx * PX, FY - 0.35, FZ + 0.05 - slope * 0.35),
               0.08, 0.08, WOOD)
    # counter: body, front planks, kick board, top
    CZ = 0.94
    b.box_minmax((-PX + 0.06, FY + 0.04, 0.0), (PX - 0.06, FY + 0.6, CZ), LIGHT)
    n = 8
    pw = (2 * PX - 0.12) / n
    for i in range(n):
        x0 = -PX + 0.06 + i * pw
        b.box_minmax((x0 + 0.008, FY - 0.012 * (i % 2), 0.02), (x0 + pw - 0.008, FY + 0.05, CZ - 0.04), WOOD)
    b.box_minmax((-PX + 0.02, FY - 0.08, 0.1), (PX - 0.02, FY + 0.02, 0.18), LIGHT)
    b.box_minmax((-PX + 0.02, FY - 0.08, CZ - 0.2), (PX - 0.02, FY + 0.02, CZ - 0.12), LIGHT)
    b.box_minmax((-PX - 0.02, FY - 0.1, CZ - 0.02), (PX + 0.02, FY + 0.66, CZ + 0.05), LIGHT)
    TOPZ = CZ + 0.05
    # back shelves with jars and sacks
    b.box_minmax((-PX + 0.05, BY - 0.22, 1.25), (PX - 0.05, BY + 0.02, 1.3), LIGHT)
    b.box_minmax((-PX + 0.05, BY - 0.22, 0.35), (PX - 0.05, BY + 0.02, 0.4), LIGHT)
    for k, x in enumerate((-0.95, -0.65, -0.35, 0.45, 0.75, 1.0)):
        hh = 0.2 + 0.05 * (k % 2)
        b.lathe([(0.07, 0.0), (0.08, hh * 0.8), (0.05, hh), (0.05, hh + 0.02)], 7, loc=(x, BY - 0.1, 1.3),
                material=GLASS)
        b.cyl(0.056, 0.03, (x, BY - 0.1, 1.3 + hh + 0.03), segments=7, material=LIGHT)
    for k, x in enumerate((-0.75, 0.0, 0.75)):
        b.ico(0.2, (x, BY - 0.1, 0.55), 1, WHITE if k != 1 else GOLD, scale=(1.0, 0.8, 0.95), jitter=0.02)

    # canvas awning: red / white stripes with a slight sag + scalloped valance
    def cz(y):
        return FZ + 0.14 + slope * (y - FY)
    Y0, Y1 = BY + 0.2, FY - 0.4
    X0, X1 = -1.52, 1.52
    stripes = 6
    sw = (X1 - X0) / stripes
    sag = -0.035
    for i in range(stripes):
        m = RED if i % 2 == 0 else WHITE
        xa, xb = X0 + i * sw, X0 + (i + 1) * sw
        mid = (xa + xb) / 2
        b.poly([(xa, Y0, cz(Y0)), (mid, Y0, cz(Y0) + sag * 0.3), (mid, Y1, cz(Y1) + sag), (xa, Y1, cz(Y1))], m)
        b.poly([(mid, Y0, cz(Y0) + sag * 0.3), (xb, Y0, cz(Y0)), (xb, Y1, cz(Y1)), (mid, Y1, cz(Y1) + sag)], m)
        for j in range(2):   # two scallops per stripe
            ua = xa + j * sw / 2
            ub = ua + sw / 2
            za = cz(Y1) + (sag if j == 1 else 0.0)
            zb_ = cz(Y1) + (sag if j == 0 else 0.0)
            low = min(za, zb_) - 0.2
            b.poly([(ua, Y1, za), (ub, Y1, zb_), (ub, Y1, low + 0.07), ((ua + ub) / 2, Y1, low - 0.05),
                    (ua, Y1, low + 0.07)], m)
    for sx in (-1, 1):   # side valances following the slope
        x = sx * 1.52
        segs = 4
        for k in range(segs):
            ya = Y1 + (Y0 - Y1) * k / segs
            yb = Y1 + (Y0 - Y1) * (k + 1) / segs
            ym = (ya + yb) / 2
            m = RED if k % 2 == 0 else WHITE
            b.poly([(x, ya, cz(ya)), (x, yb, cz(yb)), (x, yb, cz(yb) - 0.13), (x, ym, cz(ym) - 0.25),
                    (x, ya, cz(ya) - 0.13)], m)

    # goods on the counter -------------------------------------------------------------------------
    ax = -0.8   # apple crate
    b.box_minmax((ax - 0.27, FY + 0.08, TOPZ), (ax + 0.27, FY + 0.5, TOPZ + 0.12), WOOD)
    apples = [(-0.17, 0.17), (0.0, 0.17), (0.17, 0.17), (-0.17, 0.3), (0.0, 0.3), (0.17, 0.3), (-0.17, 0.42),
              (0.0, 0.42), (0.17, 0.42), (-0.09, 0.24), (0.09, 0.24), (-0.09, 0.36), (0.09, 0.36)]
    for k, (dx, dy) in enumerate(apples):
        z = TOPZ + 0.16 + (0.07 if k >= 9 else 0)
        b.sphere(0.064, (ax + dx, FY + dy, z), 7, 5, APPLE, jitter=0.004)
    b.sphere(0.064, (ax + 0.38, FY + 0.16, TOPZ + 0.06), 7, 5, APPLE)
    for k, (x, y) in enumerate(((-0.2, 0.18), (-0.06, 0.34), (0.08, 0.14), (0.2, 0.32))):   # bottles
        hh = 0.3 + 0.05 * (k % 2)
        b.lathe([(0.055, 0.0), (0.06, hh * 0.55), (0.022, hh * 0.75), (0.022, hh)], 7, loc=(x, FY + y, TOPZ),
                material=GLASS)
        b.cyl(0.027, 0.04, (x, FY + y, TOPZ + hh + 0.015), segments=6, material=LIGHT)
    for (x, z, m) in ((0.6, 0.085, BLUE), (0.78, 0.085, GOLD), (0.96, 0.085, RED), (0.69, 0.235, WHITE),
                      (0.87, 0.235, BLUE)):   # cloth rolls
        b.cyl_between((x, FY + 0.1, TOPZ + z), (x, FY + 0.58, TOPZ + z), 0.085, 8, m)
    return b.build("stall")
