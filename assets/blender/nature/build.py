"""Nature props for Brumeval Online: tree_pine, tree_oak, tree_dead, rock_a, rock_b, bush, flowers.

Run:
  "C:\\Program Files\\Blender Foundation\\Blender 5.0\\blender.exe" --background --factory-startup \
      --python-exit-code 1 --python assets/blender/nature/build.py -- [--only tree_pine,bush] [--no-preview]

Every prop is ONE static mesh object (no armature) with at most 3 materials, because the client renders them
with GPU instancing (hundreds of copies). Pivot = base centre on the ground (z = 0), trunks and rocks extend a
little below z = 0 so nothing floats on slopes. Low-poly, flat shaded, per-face colour variation stored in the
`Col` colour attribute (see nature_lib.py). Everything is seeded -> deterministic output.
"""
import math
import os
import sys

sys.dont_write_bytecode = True  # keep the repo free of __pycache__ folders
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))  # assets/blender  -> common
sys.path.insert(0, HERE)                   # assets/blender/nature -> nature_lib

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import common as C  # noqa: E402
import nature_lib as N  # noqa: E402
from nature_lib import TAU, hexc, lerp, scale  # noqa: E402

KEYS = ["tree_pine", "tree_oak", "tree_dead", "rock_a", "rock_b", "bush", "flowers"]
BUDGET = {"tree_pine": 700, "tree_oak": 1000, "tree_dead": 600, "rock_a": 300, "rock_b": 600, "bush": 350, "flowers": 500}

# --------------------------------------------------------------------------- palette (sRGB hex)
BARK = hexc("#6e4a31")
BARK_DARK = hexc("#47301f")
PINE = [hexc("#2c5936"), hexc("#346741"), hexc("#3e764a")]
OAK = [hexc("#4a8638"), hexc("#579440"), hexc("#64a146"), hexc("#4f7f34")]
DEAD_DARK = hexc("#4d4540")
DEAD_LIGHT = hexc("#9c9187")
FUNGUS = hexc("#d2b98c")
STONE_DARK = hexc("#646a73")
STONE_LIGHT = hexc("#989ea6")
MOSS = hexc("#6e9440")
MOSS_DARK = hexc("#557a31")
BUSH = [hexc("#457a37"), hexc("#50883d"), hexc("#5a9443")]
BERRY = hexc("#c8262d")
GRASS = [hexc("#4f8e35"), hexc("#5f9f3f"), hexc("#72ae49"), hexc("#46802f")]


def clamp01(x):
    return 0.0 if x < 0.0 else 1.0 if x > 1.0 else x


def centre(f):
    return f.calc_center_median()


def polar(a, r, z=0.0):
    return Vector((math.cos(a) * r, math.sin(a) * r, z))


def direction(az_deg, el_deg):
    az, el = math.radians(az_deg), math.radians(el_deg)
    return Vector((math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el)))


def bark_shader(M, dark, light, z0, z1, var=0.07):
    """Bark colour: darker at the base (ground AO), lighter higher up, darker underneath."""
    def fn(f):
        t = clamp01((centre(f).z - z0) / (z1 - z0))
        nz = f.normal.z
        k = 1.0 + 0.10 * nz if nz >= 0 else 1.0 + 0.35 * nz
        return scale(lerp(dark, light, t), k * (1.0 + M.u(-var, var)))
    return fn


def roots(M, slot, n, r_trunk, z_top, reach, radius, colour, sides=4):
    """Root flares: start inside the trunk, bend outward and dive under the ground (blunt ends)."""
    for i in range(n):
        a = i * TAU / n + M.u(-0.35, 0.35)
        d = polar(a, 1.0)
        rr = radius * M.u(0.85, 1.15)
        pts = [d * (r_trunk * 0.3) + Vector((0, 0, z_top)),
               d * (r_trunk + reach * 0.5) + Vector((0, 0, 0.04)),
               d * (r_trunk + reach) + Vector((0, 0, -0.12))]
        faces = M.tube(pts, [rr, rr * 0.75, rr * 0.45], sides=sides, wobble=0.05, cap_end=True)
        M.paint(faces, slot, lambda f: M.vary(colour, 0.08))


# =========================================================================== tree_pine
def pine_tier(M, slot, z_rim, R, z_apex, seg, base, top_tier=False):
    """One foliage tier: slightly concave cone with a star-shaped drooping rim (branch tips) and a
    concave underside. Closed surface. Returns faces."""
    bm = M.bm
    before = M._mark()
    H = z_apex - z_rim
    phase = M.u(0, TAU)
    lean = Vector((M.u(-0.07, 0.07), M.u(-0.07, 0.07), 0.0))
    apex = bm.verts.new(Vector((0.0, 0.0, z_apex)) + lean)
    profile = [(0.28, 0.22), (0.62, 0.55), (1.0, 1.0)]  # (fraction of height from apex, radius fraction)
    angles = [phase + TAU * k / seg + M.u(-0.06, 0.06) for k in range(seg)]
    rings = []
    for t, rf in profile:
        ring = []
        for k, a in enumerate(angles):
            tip = k % 2 == 0
            star = 1.0 if tip else 0.68
            s = 1.0 + (star - 1.0) * t ** 1.3
            r = R * rf * s * (1.0 + M.u(-0.05, 0.05))
            z = z_apex - H * t + (-0.36 * t * t if tip else 0.08 * t * t) + M.u(-0.03, 0.03)
            ring.append(bm.verts.new(polar(a, r, z) + lean * (1.0 - t)))
        rings.append(ring)
    inner = [bm.verts.new(polar(a, R * 0.32, z_rim + 0.22 + M.u(-0.03, 0.03))) for a in angles]
    hub = bm.verts.new((0.0, 0.0, z_rim + 0.42))
    n = seg
    for k in range(n):
        k2 = (k + 1) % n
        bm.faces.new((apex, rings[0][k], rings[0][k2]))
        for i in range(len(rings) - 1):
            U, L = rings[i], rings[i + 1]
            bm.faces.new((U[k], L[k], L[k2], U[k2]))
        rim = rings[-1]
        bm.faces.new((rim[k], inner[k], inner[k2], rim[k2]))
        bm.faces.new((hub, inner[k2], inner[k]))
    faces = M.fix_normals(M._new(before))

    def colour(f):
        c = centre(f)
        nz = f.normal.z
        if nz < -0.05:  # underside: deep shadow
            return scale(base, 0.52 * (1.0 + M.u(-0.05, 0.05)))
        t = clamp01((z_apex - c.z) / H)  # 0 at apex -> 1 at rim
        # the part near the apex sits in the shadow of the tier above (except for the top tier)
        k = (0.95 + 0.12 * (1.0 - t)) if top_tier else (0.74 + 0.34 * t)
        k *= 1.0 + 0.08 * nz
        return scale(base, k * (1.0 + M.u(-0.06, 0.06)))

    M.paint(faces, slot, colour)
    return faces


def build_pine():
    M = N.Model("tree_pine", seed=1101)
    bark = M.slot("bark", rough=0.92)
    leaf = M.slot("needles", rough=0.82)
    trunk = M.tube([(0, 0, -0.25), (0, 0, 0.28), (0.02, 0.01, 1.6), (0.03, 0.0, 3.2), (0.03, 0.0, 5.0)],
                   [0.33, 0.25, 0.2, 0.13, 0.0], sides=7, wobble=0.04, cap_start=True)
    M.paint(trunk, bark, bark_shader(M, BARK_DARK, BARK, -0.2, 1.6))
    roots(M, bark, 4, 0.22, 0.4, 0.26, 0.13, BARK_DARK)
    pine_tier(M, leaf, 1.38, 2.2, 3.5, 18, PINE[0])
    pine_tier(M, leaf, 2.62, 1.74, 4.78, 16, PINE[1])
    pine_tier(M, leaf, 3.86, 1.24, 6.3, 14, PINE[2], top_tier=True)
    return M.build()


# =========================================================================== tree_oak
def build_oak():
    M = N.Model("tree_oak", seed=2202)
    bark = M.slot("bark", rough=0.92)
    leaf = M.slot("leaves", rough=0.8)
    trunk_pts = [(0, 0, -0.25), (0, 0, 0.3), (0.05, 0.02, 1.1), (0.09, -0.02, 1.9), (0.1, 0.0, 2.75)]
    trunk = M.tube(trunk_pts, [0.56, 0.44, 0.37, 0.33, 0.27], sides=8, wobble=0.05, cap_start=True, cap_end=True)
    bark_col = bark_shader(M, BARK_DARK, BARK, -0.2, 2.2)
    M.paint(trunk, bark, bark_col)
    roots(M, bark, 5, 0.36, 0.5, 0.34, 0.19, BARK_DARK)

    crown_c = Vector((0.05, 0.0, 3.45))
    blobs = [((0.05, 0.0, 3.5), 1.5, OAK[1])]
    for i in range(5):
        a = math.radians(18 + i * 72 + M.u(-12, 12))
        d = 1.28 + M.u(-0.06, 0.06)
        blobs.append((tuple(polar(a, d, 3.08 + M.u(-0.15, 0.15)) + Vector((0.05, 0, 0))),
                      1.06 + M.u(-0.05, 0.06), OAK[(i % 3) if i != 4 else 3]))
    blobs.append(((0.32, -0.22, 4.32), 1.0, OAK[2]))
    blobs.append(((-0.48, 0.4, 4.18), 0.9, OAK[1]))

    # branches from the top of the trunk into the lower crown blobs
    top = Vector((0.1, 0.0, 2.3))
    for i in (1, 3, 5):
        target = Vector(blobs[i][0])
        mid = top.lerp(target, 0.5) + Vector((0, 0, 0.25))
        br = M.tube([top, mid, top.lerp(target, 0.85)], [0.17, 0.11, 0.06], sides=5, wobble=0.06, cap_end=True)
        M.paint(br, bark, bark_col)

    for pos, r, col in blobs:
        f = M.ico(pos, r, subdiv=2, scl=(1.0, 1.0, 0.82), rot_z=M.u(0, TAU))
        M.jitter(f, r * 0.09)

        def colour(face, col=col):
            c = centre(face)
            n = face.normal
            nz = n.z
            k = 1.0 + 0.14 * nz if nz >= 0 else 1.0 + 0.42 * nz
            # faces turned toward the heart of the crown or low down are in shadow
            out = (c - crown_c)
            out.z *= 0.6
            if out.length > 1e-4:
                k *= 0.84 + 0.16 * max(0.0, n.dot(out.normalized()))
            k *= 0.82 + 0.22 * clamp01((c.z - 2.3) / 2.9)
            return scale(col, k * (1.0 + M.u(-0.06, 0.06)))

        M.paint(f, leaf, colour)
    return M.build()


# =========================================================================== tree_dead
def gnarled(M, start, d, length, r0, segs, bend=0.35, curl=0.12, r_end=0.0):
    """Polyline + radii for a crooked, tapering branch: alternating side kinks (zig-zag) and an upward
    curl that grows toward the tip (claw-like dead branches)."""
    pts, radii = [Vector(start)], [r0]
    d = Vector(d).normalized()
    side = d.cross(Vector((0.0, 0.0, 1.0)))
    side = side.normalized() if side.length > 1e-3 else Vector((1.0, 0.0, 0.0))
    step = length / segs
    p = Vector(start)
    sign = 1.0 if M.rnd.random() < 0.5 else -1.0
    for i in range(segs):
        kink = side * (sign * M.u(0.5, 1.0) * bend)
        sign = -sign
        up = Vector((0.0, 0.0, curl * (0.4 + 1.2 * i / max(1, segs - 1))))
        noise = Vector((M.u(-0.08, 0.08), M.u(-0.08, 0.08), M.u(-0.08, 0.08)))
        d = (d + kink + up + noise).normalized()
        p = p + d * step * M.u(0.85, 1.15)
        pts.append(p.copy())
        t = (i + 1) / segs
        radii.append(r_end if i == segs - 1 else r0 * (1.0 - t) ** 0.8)
    return pts, radii


def build_dead():
    M = N.Model("tree_dead", seed=3303)
    bark = M.slot("bark", rough=0.95)
    fungus = M.slot("fungus", rough=0.65)
    col = bark_shader(M, DEAD_DARK, DEAD_LIGHT, -0.2, 3.6, var=0.08)

    trunk_pts = [(0, 0, -0.25), (0.0, 0.0, 0.25), (0.1, 0.06, 0.75), (0.04, 0.16, 1.25),
                 (-0.1, 0.1, 1.75), (-0.14, -0.02, 2.2)]
    trunk_r = [0.5, 0.38, 0.31, 0.27, 0.23, 0.19]
    trunk = M.tube(trunk_pts, trunk_r, sides=6, twist=0.45, wobble=0.08, cap_start=True, cap_end=True)
    M.paint(trunk, bark, col)
    roots(M, bark, 5, 0.36, 0.45, 0.5, 0.17, DEAD_DARK)

    # three twisted limbs splitting from the top of the trunk + one low side limb; twigs spawn along them
    top = Vector(trunk_pts[-1])
    limbs = [
        # start, direction(az, el), length, radius, segments, twig points
        (top + Vector((0.02, 0.0, -0.12)), direction(25, 26), 2.35, 0.16, 5, (2, 3)),
        (top + Vector((-0.02, 0.02, -0.06)), direction(148, 20), 2.25, 0.15, 5, (2, 3)),
        (top + Vector((0.0, -0.02, 0.0)), direction(265, 50), 2.1, 0.145, 5, (2, 3)),
        (Vector((0.04, 0.16, 1.3)), direction(330, 4), 1.7, 0.12, 4, (2,)),
    ]
    for li, (start, d, length, r0, segs, twig_at) in enumerate(limbs):
        pts, radii = gnarled(M, start, d, length, r0, segs, bend=0.32, curl=0.12)
        M.paint(M.tube(pts, radii, sides=5, twist=0.3, wobble=0.06, cap_end=False), bark, col)
        for j in twig_at:
            side = 1 if (li + j) % 2 else -1
            limb_d = (pts[j + 1] - pts[j]).normalized()
            az = math.atan2(limb_d.y, limb_d.x) + side * math.radians(M.u(40, 70))
            td = direction(math.degrees(az), M.u(15, 50))
            tp, tr = gnarled(M, pts[j], td, M.u(0.6, 0.95), radii[j] * 0.66, 3, bend=0.4, curl=0.18)
            M.paint(M.tube(tp, tr, sides=4, wobble=0.05, cap_end=False), bark, col)

    # broken stub (flat cut end)
    s0 = Vector((0.07, 0.05, 0.95))
    stub = M.tube([s0, s0 + direction(115, 22) * 0.34], [0.085, 0.07], sides=5, cap_end=True)
    M.paint(stub, bark, col)

    # two pale bracket fungi on the front side (-Y) of the trunk
    for z, az, r in ((0.62, 255, 0.17), (1.02, 290, 0.12)):
        a = math.radians(az)
        axis = Vector(trunk_pts[2]).lerp(Vector(trunk_pts[3]), clamp01((z - 0.75) / 0.5)) if z > 0.75 else Vector(trunk_pts[2]) * (z / 0.75)
        pos = Vector((axis.x, axis.y, z)) + polar(a, 0.28)
        f = M.ico(pos, r, subdiv=1, scl=(1.0, 1.0, 0.32), rot_z=a)
        M.paint(f, fungus, lambda face: scale(FUNGUS, (1.0 + 0.1 * face.normal.z if face.normal.z > 0 else 0.78) * (1.0 + M.u(-0.05, 0.05))))
    return M.build()


# =========================================================================== rocks
def rock_colour(M, z_top, moss_min_nz=0.78, moss_band=0.4):
    """Returns (is_moss(face), colour(face)) for a rock: cool grey facets, darker underneath,
    moss on the flattest faces near the top."""
    def is_moss(f):
        return f.normal.z > moss_min_nz and centre(f).z > z_top - moss_band

    def stone(f):
        nz = f.normal.z
        base = lerp(STONE_DARK, STONE_LIGHT, M.u(0.15, 0.85))
        k = 1.0 + 0.1 * nz if nz >= 0 else 1.0 + 0.4 * nz
        k *= 0.86 + 0.14 * clamp01((centre(f).z + 0.1) / max(0.4, z_top))
        return scale(base, k)

    def moss(f):
        return scale(lerp(MOSS_DARK, MOSS, M.u(0.3, 1.0)), 1.0 + M.u(-0.04, 0.04))

    return is_moss, stone, moss


def paint_rock(M, faces, stone_slot, moss_slot, z_top, moss_min_nz=0.78, moss_band=0.4):
    is_moss, stone, moss = rock_colour(M, z_top, moss_min_nz, moss_band)
    mossy = [f for f in faces if is_moss(f)]
    rest = [f for f in faces if not is_moss(f)]
    M.paint(rest, stone_slot, stone)
    if mossy:
        M.paint(mossy, moss_slot, moss)


def flat_bottom(points, z=-0.15):
    return [Vector((p.x, p.y, max(p.z, z))) for p in points]


def top_of(faces):
    return max(v.co.z for f in faces for v in f.verts)


def build_rock_a():
    M = N.Model("rock_a", seed=4404)
    stone = M.slot("stone", rough=0.95)
    moss = M.slot("moss", rough=1.0)
    parts = [
        # (n points, radii, centre, noise)
        (34, (0.86, 0.68, 0.64), (0.0, 0.0, 0.40), 0.2),
        (16, (0.46, 0.42, 0.36), (0.5, 0.3, 0.2), 0.2),
        (10, (0.2, 0.17, 0.13), (-0.42, -0.72, 0.0), 0.2),
    ]
    for n, radii, c, noise in parts:
        pts = flat_bottom(N.ellipsoid_points(M.rnd, n, radii, c, noise=noise, rot_z=M.u(0, TAU)))
        f = M.hull(pts)
        paint_rock(M, f, stone, moss, top_of(f), moss_min_nz=0.8, moss_band=0.35)
    return M.build()


def standing_stone_points(M, base, height, rx, ry, lean=(0.0, 0.0)):
    """Tall irregular slab: stacked jittered ellipses narrowing toward a broken top."""
    pts = []
    levels = [(-0.15, 1.0, 9), (height * 0.33, 0.97, 8), (height * 0.64, 0.88, 8), (height * 0.87, 0.7, 7), (height, 0.42, 5)]
    for z, k, n in levels:
        off = M.u(0, TAU)
        for i in range(n):
            a = off + TAU * i / n + M.u(-0.2, 0.2)
            r = k * (1.0 - 0.12 * M.rnd.random())
            zz = z + (M.u(-0.12, 0.12) if z > 0 else 0.0)
            if k < 0.5:  # broken top: one side higher than the other
                zz += 0.22 * math.cos(a - 0.8) + M.u(-0.06, 0.06)
            p = Vector((math.cos(a) * rx * r, math.sin(a) * ry * r, zz))
            p.x += lean[0] * max(zz, 0.0)
            p.y += lean[1] * max(zz, 0.0)
            pts.append(p + Vector(base))
    return pts


def build_rock_b():
    M = N.Model("rock_b", seed=5505)
    stone = M.slot("stone", rough=0.95)
    moss = M.slot("moss", rough=1.0)
    tall = M.hull(standing_stone_points(M, (0.12, 0.12, 0.0), 2.7, 0.74, 0.52, lean=(0.07, -0.04)))
    paint_rock(M, tall, stone, moss, top_of(tall), moss_min_nz=0.72, moss_band=0.5)
    parts = [
        (32, (0.76, 0.66, 0.58), (-0.92, 0.3, 0.36), 0.22),
        (24, (0.58, 0.52, 0.44), (1.0, -0.28, 0.26), 0.22),
        (12, (0.28, 0.25, 0.2), (0.28, -0.9, 0.04), 0.2),
        (12, (0.24, 0.21, 0.17), (-0.42, 0.98, 0.02), 0.2),
    ]
    for n, radii, c, noise in parts:
        pts = flat_bottom(N.ellipsoid_points(M.rnd, n, radii, c, noise=noise, rot_z=M.u(0, TAU)))
        f = M.hull(pts)
        paint_rock(M, f, stone, moss, top_of(f), moss_min_nz=0.8, moss_band=0.3)
    return M.build()


# =========================================================================== bush
def build_bush():
    M = N.Model("bush", seed=6606)
    leaf = M.slot("leaves", rough=0.85)
    berry = M.slot("berries", rough=0.35)
    blobs = [((0.0, 0.02, 0.33), 0.45, (1.0, 1.0, 0.9), BUSH[1]),
             ((-0.31, 0.13, 0.21), 0.31, (1.0, 1.0, 0.92), BUSH[0]),
             ((0.31, -0.1, 0.22), 0.32, (1.0, 1.0, 0.92), BUSH[2])]
    for pos, r, scl, col in blobs:
        f = M.ico(pos, r, subdiv=2, scl=scl, rot_z=M.u(0, TAU))
        M.jitter(f, r * 0.11)
        M.clamp_bottom(f, -0.08, 0.02)

        def colour(face, col=col):
            nz = face.normal.z
            k = 1.0 + 0.14 * nz if nz >= 0 else 1.0 + 0.45 * nz
            k *= 0.78 + 0.27 * clamp01((centre(face).z + 0.05) / 0.75)
            return scale(col, k * (1.0 + M.u(-0.08, 0.08)))

        M.paint(f, leaf, colour)
    # two little clusters of glossy red berries on the front/side surface (5 icosahedra, 20 tris each)
    for bi, az, el, count in ((0, 255, 32, 3), (2, 320, 22, 2)):
        pos, r, scl, _ = blobs[bi]
        d = direction(az, el)
        anchor = Vector(pos) + Vector((d.x * r * scl[0], d.y * r * scl[1], d.z * r * scl[2])) * 0.97
        tangent = Vector((-d.y, d.x, 0.0)).normalized()
        for j in range(count):
            ang = j * TAU / count + 0.6
            off = tangent * math.cos(ang) * 0.05 + Vector((0, 0, math.sin(ang) * 0.045))
            f = M.ico(anchor + off, 0.052, subdiv=1)
            M.paint(f, berry, lambda face: scale(BERRY, (1.1 if face.normal.z > 0.2 else 0.72) * (1.0 + M.u(-0.08, 0.08))))
    return M.build()


# =========================================================================== flowers
FLOWER_KINDS = {
    #            petals             centre         n  petal length
    "daisy": (hexc("#f7f4ea"), hexc("#f3c23a"), 7, 0.15),
    "buttercup": (hexc("#f8d23c"), hexc("#e2852a"), 5, 0.13),
    "rose": (hexc("#f08ab8"), hexc("#f6d24c"), 5, 0.135),
    "violet": (hexc("#9d6fe2"), hexc("#f7e27c"), 5, 0.13),
}
LAVENDER = hexc("#8f67d8")


def facing(faces, want):
    """Orient thin cards so their normal points toward `want` (consistent lighting when double sided)."""
    for f in faces:
        f.normal_update()
        if f.normal.dot(want) < 0:
            f.normal_flip()
            f.normal_update()
    return faces


def blade(M, base, lean_dir, h, w, side):
    """Grass blade: quad + tip triangle, bending along lean_dir."""
    b = Vector(base)
    mid = b + lean_dir * h * 0.3 + Vector((0, 0, h * 0.55))
    tip = b + lean_dir * h * 0.85 + Vector((0, 0, h))
    f1 = M.poly([b - side * w * 0.5, b + side * w * 0.5, mid + side * w * 0.36, mid - side * w * 0.36])
    f2 = M.poly([mid - side * w * 0.36, mid + side * w * 0.36, tip])
    return f1 + f2


def build_flowers():
    M = N.Model("flowers", seed=7707)
    grass = M.slot("grass", rough=0.9, double_sided=True)
    petals = M.slot("petals", rough=0.6, double_sided=True)
    hearts = M.slot("hearts", rough=0.7, double_sided=True)
    rnd = M.rnd
    z0 = -0.06
    up = Vector((0, 0, 1))

    def gradient(col, h):
        """Blade colour: dark at the root (contact shadow) -> light at the tip."""
        def fn(face, loop):
            t = clamp01((loop.vert.co.z - z0) / (h - z0))
            return scale(col, 0.48 + 0.64 * t)
        return fn

    # --- grass tufts: a ring of 8 clumps + one in the middle, blades fanning outward
    clumps = [(polar(TAU * i / 8 + M.u(-0.25, 0.25), M.u(0.2, 0.44)), 5) for i in range(8)]
    clumps.append((Vector((M.u(-0.05, 0.05), M.u(-0.05, 0.05), 0.0)), 6))
    for c, n in clumps:
        col = GRASS[rnd.randrange(len(GRASS))]
        for i in range(n):
            a = TAU * i / n + M.u(-0.45, 0.45)
            out = polar(a, 1.0)
            base = Vector((c.x, c.y, z0)) + out * 0.03
            h = M.u(0.15, 0.3)
            lean = out * M.u(0.3, 0.65)
            side = Vector((-out.y, out.x, 0.0))
            f = facing(blade(M, base, lean, h, M.u(0.06, 0.085), side), out + Vector((0, 0, 0.35)))
            M.paint_loops(f, grass, gradient(M.vary(col, 0.08), h))

    # --- flowers on blue-noise positions inside the patch
    kinds = ["daisy"] * 4 + ["buttercup"] * 3 + ["rose"] * 3 + ["violet"] * 2 + ["lavender"] * 2
    rnd.shuffle(kinds)
    spots = []
    tries = 0
    while len(spots) < len(kinds) and tries < 5000:
        tries += 1
        p = polar(M.u(0, TAU), 0.52 * math.sqrt(rnd.random()))
        if all((p - q).length > 0.19 for q in spots):
            spots.append(p)
    for kind, p in zip(kinds, spots):
        out = Vector((p.x, p.y, 0.0))
        out = out.normalized() if out.length > 1e-3 else polar(M.u(0, TAU), 1.0)
        h = M.u(0.22, 0.34) if kind != "lavender" else M.u(0.4, 0.46)
        nrm = (up + out * M.u(0.15, 0.4)).normalized()  # heads tilt slightly outward
        head = Vector((p.x, p.y, 0.0)) + out * (h * 0.1) + Vector((0, 0, h))
        ground = Vector((p.x, p.y, z0))
        stem_side = Vector((-out.y, out.x, 0.0)) * 0.009
        stem = facing(M.poly([ground - stem_side, ground + stem_side, head + stem_side * 0.6, head - stem_side * 0.6]), out)
        M.paint_loops(stem, grass, gradient(scale(GRASS[1], 0.9), h))
        # one leaf on the stem
        lb = ground.lerp(head, 0.32)
        ld = (polar(math.atan2(out.y, out.x) + M.u(-1.2, 1.2), 1.0) + Vector((0, 0, 0.55))).normalized()
        lside = ld.cross(up).normalized() * 0.026
        leaf = facing(M.poly([lb, lb + ld * 0.07 + lside, lb + ld * 0.15, lb + ld * 0.07 - lside]), up)
        M.paint(leaf, grass, M.vary(GRASS[2], 0.06))

        if kind == "lavender":  # spike of small purple buds
            for j in range(4):
                bp = head + Vector((0, 0, -0.05 * j)) + out * 0.005 * j
                f = M.octa(bp, 0.028 + 0.005 * j, 0.038)
                M.paint(f, petals, lambda face: scale(LAVENDER, (1.05 if face.normal.z > 0 else 0.8) * (1.0 + M.u(-0.06, 0.06))))
            continue

        pcol, ccol, npet, plen = FLOWER_KINDS[kind]
        plen *= M.u(0.9, 1.1)
        u0 = nrm.cross(Vector((0.3, 0.7, 0.1))).normalized()
        v0 = nrm.cross(u0)
        phase = M.u(0, TAU)
        pw = plen * (0.4 if npet >= 6 else 0.5)
        for i in range(npet):
            a = phase + TAU * i / npet
            d = u0 * math.cos(a) + v0 * math.sin(a)
            perp = nrm.cross(d)
            b = head + d * 0.014
            tip = head + d * plen + nrm * plen * 0.26
            s1 = head + d * plen * 0.52 + perp * pw * 0.5 + nrm * plen * 0.1
            s2 = head + d * plen * 0.52 - perp * pw * 0.5 + nrm * plen * 0.1
            f = facing(M.poly([b, s1, tip, s2]), nrm)
            M.paint(f, petals, M.vary(pcol, 0.05))
        # centre: small pyramid
        ring = [head + nrm * 0.008 + (u0 * math.cos(a) + v0 * math.sin(a)) * 0.036 for a in (0.0, TAU / 3, 2 * TAU / 3)]
        apex = head + nrm * 0.048
        cf = []
        for i in range(3):
            f = M.poly([ring[i], ring[(i + 1) % 3], apex])
            cf += facing(f, (ring[i] + ring[(i + 1) % 3]) * 0.5 - head)
        M.paint(cf, hearts, lambda face: M.vary(ccol, 0.05))
    return M.build()


# =========================================================================== main
BUILDERS = {
    "tree_pine": build_pine,
    "tree_oak": build_oak,
    "tree_dead": build_dead,
    "rock_a": build_rock_a,
    "rock_b": build_rock_b,
    "bush": build_bush,
    "flowers": build_flowers,
}


def main():
    args = C.parse_args()
    for key in C.selected(args, KEYS):
        C.reset()
        obj, tris = BUILDERS[key]()
        bpy.context.view_layer.update()
        mats = len(obj.data.materials)
        meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
        d = obj.dimensions
        zmin = min((obj.matrix_world @ Vector(c)).z for c in obj.bound_box)
        print(f"[nature] {key}: {tris} tris (budget {BUDGET[key]}), {mats} materials, "
              f"size {d.x:.2f} x {d.y:.2f} x {d.z:.2f} m, base z {zmin:.2f}")
        if tris > BUDGET[key]:
            raise RuntimeError(f"{key}: {tris} triangles exceeds budget {BUDGET[key]}")
        if mats > 3 or len(meshes) != 1:
            raise RuntimeError(f"{key}: expected 1 mesh with <= 3 materials, got {len(meshes)} meshes / {mats} materials")
        C.export_glb(key, args, animations=False)
        C.render_preview(key, args)


main()
