"""House: timber-framed cottage (~6 x 6 m footprint, ~5.6 m tall), door on the front (-Y)."""
import math

import structkit as K
from structkit import mat


# =========================================================================== HOUSE
class Wall:
    """Maps wall-local coordinates (u = along the wall, left->right seen from outside; z = height;
    o = distance out of the wall plane) to world space for one face of a square house of half-size w."""

    def __init__(self, face, w):
        self.face, self.w = face, w

    def p(self, u, z, o=0.0):
        w = self.w
        if self.face == "front":   # y = -w, outward -Y, u along +X
            return (u, -w - o, z)
        if self.face == "back":    # y = +w, outward +Y, u along -X
            return (-u, w + o, z)
        if self.face == "left":    # x = -w, outward -X, u along -Y
            return (-w - o, -u, z)
        return (w + o, u, z)       # right: x = +w, outward +X, u along +Y

    def box(self, b, u0, u1, z0, z1, o0, o1, material, jitter=0.0):
        a, c = self.p(u0, z0, o0), self.p(u1, z1, o1)
        mn = tuple(min(a[i], c[i]) for i in range(3))
        mx = tuple(max(a[i], c[i]) for i in range(3))
        return b.box_minmax(mn, mx, material, jitter)

    def brace(self, b, u0, z0, u1, z1, width, o0, o1, material):
        om = (o0 + o1) / 2
        return b.beam(self.p(u0, z0, om), self.p(u1, z1, om), o1 - o0, width, material)


def build_house():
    b = K.Builder(seed=11)
    STONE, PLASTER, TIMBER, ROOF, GLOW, FLOWERS = (mat("Stone"), mat("Plaster"), mat("Timber"), mat("Roof"),
                                                    mat("GlowWindow"), mat("Flowers"))
    W = 2.7            # wall half size
    FH = 2.92          # foundation half size
    Z0, ZT = 0.45, 2.95
    th = math.radians(40)
    TAN, COS, SIN = math.tan(th), math.cos(th), math.sin(th)
    ZR = ZT + W * TAN  # ridge height on the roof underside
    OVX, OVY = 0.46, 0.36

    # ---- stone foundation (sinks 0.2 m into the ground) + rough stones on its faces
    b.box_minmax((-FH, -FH, -0.2), (FH, FH, Z0), STONE, jitter=0.02)
    for face in ("front", "back", "left", "right"):
        wall = Wall(face, FH)
        u = -FH + 0.05
        row = 0
        while u < FH - 0.3:
            ln = b.rand(0.45, 0.85)
            u1 = min(u + ln, FH - 0.04)
            if face == "front" and -0.8 < (u + u1) / 2 < 0.8:
                u = u1 + 0.06
                continue
            z0 = 0.02 if row % 2 == 0 else 0.22
            wall.box(b, u, u1, z0, z0 + b.rand(0.16, 0.2), -0.01, 0.045, STONE, jitter=0.018)
            u = u1 + b.rand(0.05, 0.12)
            row += 1
    # door steps
    b.box_minmax((-0.75, -FH - 0.45, -0.1), (0.75, -FH + 0.02, 0.22), STONE, jitter=0.015)

    # ---- plaster body (walls + gables in one solid)
    b.prism([(-W, Z0), (W, Z0), (W, ZT), (0, ZR), (-W, ZT)], -W, W, PLASTER)

    # ---- timber frame
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.box((0.26, 0.26, ZT - Z0 + 0.02), (sx * (W - 0.08), sy * (W - 0.08), (Z0 + ZT) / 2), material=TIMBER)
    D0, D1 = -0.01, 0.07   # frame depth (out of the wall)
    for face in ("front", "back", "left", "right"):
        wall = Wall(face, W)
        wall.box(b, -W, W, Z0, Z0 + 0.18, D0, D1, TIMBER)          # sill beam
        wall.box(b, -W, W, ZT - 0.18, ZT + 0.02, D0, D1, TIMBER)   # top plate

    def window(wall, uc, zc, hw, hh, shutters=False, box=False):
        wall.box(b, uc - hw, uc + hw, zc - hh, zc + hh, -0.03, 0.015, GLOW)
        f = 0.09
        wall.box(b, uc - hw - f, uc + hw + f, zc + hh, zc + hh + f, D0, D1, TIMBER)   # head
        wall.box(b, uc - hw - f, uc - hw, zc - hh, zc + hh, D0, D1, TIMBER)          # jambs
        wall.box(b, uc + hw, uc + hw + f, zc - hh, zc + hh, D0, D1, TIMBER)
        wall.box(b, uc - hw - f - 0.05, uc + hw + f + 0.05, zc - hh - 0.08, zc - hh, D0, 0.15, TIMBER)  # sill
        wall.box(b, uc - 0.025, uc + 0.025, zc - hh, zc + hh, -0.03, 0.03, TIMBER)   # muntins
        wall.box(b, uc - hw, uc + hw, zc - 0.025, zc + 0.025, -0.03, 0.03, TIMBER)
        if shutters:
            for s in (-1, 1):
                u0 = uc + s * (hw + f + 0.02)
                u1 = u0 + s * hw
                for k in range(2):   # two planks per shutter
                    a0 = u0 + (u1 - u0) * k / 2
                    a1 = u0 + (u1 - u0) * (k + 1) / 2
                    wall.box(b, min(a0, a1) + 0.008, max(a0, a1) - 0.008, zc - hh - 0.02, zc + hh + 0.02,
                             0.0, 0.05 + 0.012 * k, TIMBER)
                wall.box(b, min(u0, u1), max(u0, u1), zc + hh * 0.45, zc + hh * 0.45 + 0.07, 0.03, 0.075, TIMBER)
                wall.box(b, min(u0, u1), max(u0, u1), zc - hh * 0.55, zc - hh * 0.55 + 0.07, 0.03, 0.075, TIMBER)
        if box:
            z0 = zc - hh - 0.3
            wall.box(b, uc - hw - 0.05, uc + hw + 0.05, z0, z0 + 0.2, 0.02, 0.26, TIMBER)
            wall.box(b, uc - hw - 0.1, uc - hw - 0.05, z0 - 0.06, z0 + 0.02, 0.02, 0.2, TIMBER)
            wall.box(b, uc + hw + 0.05, uc + hw + 0.1, z0 - 0.06, z0 + 0.02, 0.02, 0.2, TIMBER)
            n = 6
            for i in range(n):
                u = uc - hw + (2 * hw) * (i + 0.5) / n + b.rand(-0.03, 0.03)
                b.ico(b.rand(0.075, 0.1), wall.p(u, z0 + 0.22 + b.rand(0, 0.05), 0.14 + b.rand(-0.04, 0.04)),
                      1, FLOWERS, jitter=0.012)

    # ---- front: door, two windows with flower boxes, wall lantern, gable window
    fr = Wall("front", W)
    DZ = Z0 + 1.95
    fr.box(b, -0.66, -0.5, Z0, ZT - 0.18, D0, D1 + 0.02, TIMBER)    # door posts
    fr.box(b, 0.5, 0.66, Z0, ZT - 0.18, D0, D1 + 0.02, TIMBER)
    fr.box(b, -0.8, 0.8, DZ, DZ + 0.16, D0, D1 + 0.03, TIMBER)      # lintel
    planks = 4
    for i in range(planks):
        u0 = -0.5 + i * 0.25
        fr.box(b, u0 + 0.006, u0 + 0.25 - 0.006, Z0, DZ, -0.04, 0.0 + 0.012 * (i % 2), TIMBER)
    for zz in (Z0 + 0.35, Z0 + 1.55):
        fr.box(b, -0.46, 0.46, zz, zz + 0.1, 0.0, 0.04, TIMBER)          # battens
    fr.box(b, 0.3, 0.38, Z0 + 0.95, Z0 + 1.02, 0.0, 0.1, STONE)          # handle
    for sx in (-1, 1):
        window(fr, sx * 1.62, 1.82, 0.36, 0.42, box=True)
        fr.box(b, sx * 0.66, sx * 1.17, 1.1, 1.2, D0, D1, TIMBER)          # rails under window
        fr.box(b, sx * 2.07, sx * 2.57, 1.1, 1.2, D0, D1, TIMBER)
        fr.brace(b, sx * 0.7, Z0 + 0.18, sx * 1.1, 1.1, 0.1, D0, D1, TIMBER)
        fr.brace(b, sx * 2.52, Z0 + 0.18, sx * 2.12, 1.1, 0.1, D0, D1, TIMBER)
        fr.box(b, sx * 0.66, sx * 2.57, ZT - 0.52, ZT - 0.44, D0, D1, TIMBER)   # upper rail
    # wall lantern (right of the door)
    fr.box(b, 0.8, 0.86, 2.02, 2.08, 0.0, 0.26, TIMBER)
    fr.box(b, 0.87, 1.05, 1.72, 1.94, 0.12, 0.3, GLOW)
    fr.box(b, 0.84, 1.08, 1.94, 2.0, 0.09, 0.33, TIMBER)
    fr.box(b, 0.84, 1.08, 1.68, 1.72, 0.09, 0.33, TIMBER)
    # gable (front and back): posts, braces, small window
    for face in ("front", "back"):
        g = Wall(face, W)
        g.box(b, -0.44, -0.34, ZT, ZR - 0.4 * TAN - 0.02, D0, D1, TIMBER)
        g.box(b, 0.34, 0.44, ZT, ZR - 0.4 * TAN - 0.02, D0, D1, TIMBER)
        g.box(b, -0.44, 0.44, 3.4, 3.48, D0, D1, TIMBER)
        g.box(b, -0.34, 0.34, 3.48, 4.02, -0.03, 0.015, GLOW)
        g.box(b, -0.44, 0.44, 4.02, 4.1, D0, D1, TIMBER)
        g.box(b, -0.025, 0.025, 3.48, 4.02, -0.03, 0.03, TIMBER)
        for sx in (-1, 1):
            g.brace(b, sx * 1.95, ZT, sx * 0.44, ZT + 1.1, 0.1, D0, D1, TIMBER)

    # ---- sides: shuttered window + big braces; back: window
    for face in ("left", "right"):
        s = Wall(face, W)
        window(s, 0.0, 1.8, 0.34, 0.42, shutters=True)
        for sx in (-1, 1):
            s.brace(b, sx * 2.55, Z0 + 0.18, sx * 1.35, ZT - 0.18, 0.11, D0, D1, TIMBER)
            s.box(b, sx * 1.12, sx * 1.24, Z0 + 0.18, ZT - 0.18, D0, D1, TIMBER)
    bk = Wall("back", W)
    window(bk, -1.2, 1.8, 0.34, 0.42, shutters=True)
    bk.box(b, -0.12, 0.0, Z0 + 0.18, ZT - 0.18, D0, D1, TIMBER)          # stud
    bk.box(b, 1.3, 1.42, Z0 + 0.18, ZT - 0.18, D0, D1, TIMBER)
    bk.brace(b, 0.02, Z0 + 0.18, 1.3, ZT - 0.18, 0.11, D0, D1, TIMBER)
    bk.brace(b, 2.55, Z0 + 0.18, 1.42, ZT - 0.18, 0.11, D0, D1, TIMBER)
    bk.box(b, -2.57, -0.12, 1.1, 1.2, D0, D1, TIMBER)

    # ---- roof: rows of stepped shingles on both slopes
    Y1 = W + OVY
    D = (W + OVX) / COS
    N, T, LIFT, OVL = 5, 0.12, 0.085, 0.14
    for s in (-1, 1):
        ux, uz = s * COS, -SIN        # down-slope direction (XZ)
        nx, nz = s * SIN, COS         # outward normal
        for i in range(N):
            d0 = i * D / N - (OVL if i else 0.0)
            d1 = (i + 1) * D / N
            ax, az = ux * d0, ZR + uz * d0
            bx, bz = ux * d1 + nx * LIFT, ZR + uz * d1 + nz * LIFT
            pts = [(ax, az), (bx, bz), (bx + nx * T, bz + nz * T), (ax + nx * T, az + nz * T)]
            b.prism(pts, -Y1 - 0.02 * (i % 2), Y1 + 0.02 * (i % 2), ROOF)
    # ridge cap
    b.box((0.3, 2 * Y1 + 0.12, 0.3), (0, 0, ZR + T + 0.03), (0, math.radians(45), 0), ROOF)
    b.box((0.22, 2 * Y1 + 0.16, 0.22), (0, 0, ZR + T + 0.14), (0, math.radians(45), 0), TIMBER)
    # barge boards on the gable edges
    for sy in (-1, 1):
        for s in (-1, 1):
            p0 = (0, sy * (Y1 + 0.03), ZR + 0.1)
            p1 = (s * (W + OVX + 0.02), sy * (Y1 + 0.03), ZR - (W + OVX + 0.02) * TAN + 0.1)
            b.beam(p0, p1, 0.08, 0.26, TIMBER, extend=0.04)
    # ---- chimney through the right slope
    cx, cy = 1.3, 1.25
    b.box_minmax((cx - 0.36, cy - 0.36, ZT), (cx + 0.36, cy + 0.36, 5.55), STONE, jitter=0.015)
    b.box_minmax((cx - 0.44, cy - 0.44, 5.5), (cx + 0.44, cy + 0.44, 5.64), STONE, jitter=0.01)
    b.box_minmax((cx - 0.22, cy - 0.22, 5.6), (cx + 0.22, cy + 0.22, 5.665), TIMBER)   # sooty flue opening
    for k in range(3):
        z = 4.3 + k * 0.38
        b.box_minmax((cx - 0.39, cy - 0.39, z), (cx + 0.39, cy + 0.39, z + 0.16), STONE, jitter=0.02)

    # ---- firewood stack against the right wall (towards the back, under the chimney)
    for col in range(2):
        for row in range(3 - col):
            x = FH + 0.15 + col * 0.26
            b.cyl(0.13, 1.25 + b.rand(-0.1, 0.1), (x, 1.55 + b.rand(-0.05, 0.05), 0.13 + row * 0.235),
                  (math.radians(90), 0, b.rand(-0.1, 0.1)), 6, TIMBER, jitter=0.012)
    return b.build("house")
