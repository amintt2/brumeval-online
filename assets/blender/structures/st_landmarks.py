"""Landmarks: bridge, waypoint (fast-travel standing stone), dungeon_gate."""
import math
import random

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

import sk
import st_props as SP
from kit import gn
from kit import materials as M

V = Vector


def _glow(m):
    m["kit_group"] = "Glow"
    return m


# =============================================================================== BRIDGE
def build_bridge(args):
    """≈12 m timber bridge along Y (deck top at z≈1.0): stone abutments + two stone piers (GN-instanced stones),
    heavy stringers, plank deck with a few gaps, railings with posts and braces, two lanterns."""
    MAT = sk.Mats()
    P = sk.Parts(seed=707)
    stone = MAT.stone("grey", 0.5)
    wood = MAT.wood("Z", "dark")
    old = MAT.wood("Z", "old")
    L = 12.0
    hw = 1.5                              # half width of the deck
    zd = 1.0                              # deck top
    # abutments at both ends (stone blocks, sloping into the ground) + piers
    for sy in (-1, 1):
        y_in = sy * (L / 2 - 1.2)
        y_out = sy * (L / 2)
        # inner face (towards the gap) + side faces
        if sy < 0:
            segs = [((hw + 0.3, y_in), (-hw - 0.3, y_in)), ((-hw - 0.3, y_in), (-hw - 0.3, y_out)),
                    ((hw + 0.3, y_out), (hw + 0.3, y_in))]
        else:
            segs = [((-hw - 0.3, y_in), (hw + 0.3, y_in)), ((hw + 0.3, y_in), (hw + 0.3, y_out)),
                    ((-hw - 0.3, y_out), (-hw - 0.3, y_in))]
        sk.stone_wall(P, segs, 0.0, zd - 0.28, stone, seed=5 + sy, course=(0.24, 0.3), length=(0.4, 0.75), depth=0.32,
                      protrude=0.03)
        P.box((2 * hw + 0.5, 1.15, zd - 0.28), (0, (y_in + y_out) / 2, (zd - 0.28) / 2), MAT.mortar(), bevel=0.0,
              smooth=0)
        P.box((2 * hw + 0.75, 1.3, 0.16), (0, (y_in + y_out) / 2, zd - 0.36), MAT.blocks((0.5, 0.3)), bevel=0.03)
    for yp in (-1.6, 1.6):
        # piers are walls across the stream (along X), with pointed cutwaters on both sides
        segs = [((-hw - 0.2, yp - 0.35), (hw + 0.2, yp - 0.35)), ((hw + 0.2, yp - 0.35), (hw + 0.2, yp + 0.35)),
                ((hw + 0.2, yp + 0.35), (-hw - 0.2, yp + 0.35)), ((-hw - 0.2, yp + 0.35), (-hw - 0.2, yp - 0.35))]
        sk.stone_wall(P, segs, 0.0, zd - 0.3, stone, seed=int(yp * 10) + 40, course=(0.22, 0.3),
                      length=(0.35, 0.6), depth=0.3, protrude=0.03)
        P.box((2 * hw + 0.1, 0.4, zd - 0.3), (0, yp, (zd - 0.3) / 2), MAT.mortar(), bevel=0.0, smooth=0)
        # cutwaters (pointed stone noses) on both sides of the pier
        for sx in (-1, 1):
            P.cyl(0.42, zd - 0.32, (sx * (hw + 0.25), yp, 0.0), MAT.blocks((0.4, 0.25)), n=4, r2=0.36,
                  rot=(0, 0, math.pi / 4), smooth=0)
    # stringers (5 heavy beams along Y)
    for k in range(5):
        x = -hw + 0.2 + (2 * hw - 0.4) * k / 4
        P.beam((x, -L / 2 + 0.3, zd - 0.2), (x, L / 2 - 0.3, zd - 0.2), 0.2, 0.24, wood, bevel=0.025, up=(0, 0, 1),
               jitter=0.01)
    # deck planks across X, a couple missing / sagging
    rnd = random.Random(3)
    n = 44
    step = (L - 0.6) / n
    for k in range(n):
        if k in (17, 29):
            continue
        y = -L / 2 + 0.3 + step * (k + 0.5)
        ln = 2 * hw + 0.1 + rnd.uniform(-0.12, 0.12)
        off = rnd.uniform(-0.06, 0.06)
        P.beam((-ln / 2 + off, y, zd - 0.04 + rnd.uniform(-0.01, 0.005)), (ln / 2 + off, y, zd - 0.04 + rnd.uniform(-0.01, 0.005)),
               step - 0.025, 0.07, old, bevel=0.01, up=(0, 0, 1))
    # railings: posts every 2 m, top rail, mid rail, braces to the stringers' outer edge
    for sx in (-1, 1):
        x = sx * (hw - 0.02)
        ys = [-L / 2 + 0.5 + i * (L - 1.0) / 5 for i in range(6)]
        for y in ys:
            P.beam((x, y, zd - 0.35), (x, y, zd + 1.1), 0.14, 0.14, wood, bevel=0.02)
            P.beam((x + sx * 0.05, y - 0.02, zd - 0.3), (x + sx * 0.45, y - 0.02, zd - 0.35), 0.1, 0.1, wood,
                   bevel=0.014)
            P.beam((x + sx * 0.42, y, zd - 0.33), (x + sx * 0.05, y, zd + 0.55), 0.09, 0.09, wood, bevel=0.012)
        P.beam((x, -L / 2 + 0.4, zd + 1.12), (x, L / 2 - 0.4, zd + 1.12), 0.12, 0.1, old, bevel=0.015, up=(0, 0, 1),
               jitter=0.006)
        P.beam((x, -L / 2 + 0.45, zd + 0.55), (x, L / 2 - 0.45, zd + 0.55), 0.08, 0.07, old, bevel=0.012,
               up=(sx, 0, 0), jitter=0.006)
        # iron straps on the posts
        for y in ys:
            P.box((0.16, 0.16, 0.05), (x, y, zd + 0.98), MAT.blackiron(), bevel=0.006)
    # lanterns on the two middle posts
    iron = MAT.blackiron()
    y = -L / 2 + 0.5 + 2 * (L - 1.0) / 5
    for sx, yy in ((-1, y), (1, -y)):
        x = sx * (hw - 0.02)
        P.tube([(x, yy, zd + 1.15), (x, yy, zd + 1.55), (x + sx * 0.3, yy, zd + 1.55)], 0.018, iron, kind="POLY")
        SP.lantern(P, MAT, (x + sx * 0.3, yy, zd + 1.55), scale=0.75)
    # moss clumps on the abutment caps via GN scatter is overkill; material moss does it
    return P.objs


# =============================================================================== WAYPOINT
def menhir(P, MAT, mat, base, size, lean=(0.0, 0.0), seed=0, cuts=7, twist=0.0, sub=3, target=900):
    """Tall standing stone: tapered box -> GN planar cuts + displacement -> decimated to `target` tris."""
    w, d, h = size
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        t = v.co.z + 0.5
        taper = 1.0 - 0.35 * t
        v.co.x *= w * taper
        v.co.y *= d * taper
        v.co.z = t * h
        v.co.x += lean[0] * t * h
        v.co.y += lean[1] * t * h
    bmesh.ops.subdivide_edges(bm, edges=list(bm.edges), cuts=2, use_grid_fill=True)
    me = bpy.data.meshes.new("Menhir")
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new("Menhir", me)
    bpy.context.scene.collection.objects.link(o)
    me.materials.append(mat)
    gn.planar_cuts(o, cuts=cuts, depth=(0.03, 0.09), seed=seed, subdiv=sub)
    gn.displace(o, strength=0.06, scale=2.2, detail=6, voronoi=0.3, seed=seed)
    gn.apply(o)
    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    gn.decimate(o, min(1.0, target / max(tris, 1)))
    gn.apply(o)
    for p in me.polygons:
        p.use_smooth = True
    o.location = base
    return P.add_obj(o)


def build_waypoint(args):
    """Fast-travel standing stone ≈3 m: rune-carved menhir (emissive runes) on a round dais of flagstones, ring of
    small stones, and a floating crystal above it (separate object "Crystal", origin at its centre, so the client
    can bob / spin it)."""
    MAT = sk.Mats()
    P = sk.Parts(seed=808)
    C_ = sk.Parts(seed=809, prefix="C")
    rune = MAT._get("runestone", lambda: sk.add_runes(M.rock("RuneStone", scale=1.2, seed=4, color="#6f6c66",
                                                              color2="#4a4843", moss=0.35, strata=0.3),
                                                       color="#59c7ff", strength=6.0, cell=(0.15, 0.19),
                                                       column=True, zrange=(0.55, 2.0)))
    menhir(P, MAT, rune, (0, 0, 0.18), (0.62, 0.42, 2.25), lean=(0.02, 0.01), seed=5, target=1100)
    # dais: ring of flagstones (GN instances) + central slab
    rnd = random.Random(2)
    stone = MAT.stone("grey", 0.4)
    pts, rots, scls = [], [], []
    for ring, (r, n) in enumerate(((0.62, 8), (0.98, 12))):
        for i in range(n):
            a = 2 * math.pi * (i + 0.5 * ring) / n
            pts.append((r * math.cos(a), r * math.sin(a), 0.07 + 0.03 * (1 - ring)))
            rots.append((rnd.uniform(-0.03, 0.03), rnd.uniform(-0.03, 0.03), a))
            scls.append((0.34, 2 * math.pi * r / n - 0.04, 0.16 + 0.04 * (1 - ring)))
    var = sk.stone_variants(5, 7, stone, rough=0.06)
    ob, col = sk.gn_instances("Dais", pts, var, rots, scls, seed=2)
    ob.data.materials.append(stone)
    gn.apply(ob)
    gn.remove(col)
    sk._smooth(ob.data, 180)
    P.add_obj(ob)
    P.cyl(0.45, 0.2, (0, 0, 0.0), MAT.blocks((0.4, 0.3)), n=12, bevel=0.02)
    # small standing stones around, with faint runes
    for k in range(5):
        a = 2 * math.pi * k / 5 + 0.4
        r = 1.35
        P.stone((0.26, 0.2, 0.55 + 0.15 * (k % 2)), (r * math.cos(a), r * math.sin(a), 0.25), stone,
                rot=(rnd.uniform(-0.1, 0.1), rnd.uniform(-0.1, 0.1), a), seed=30 + k, rough=0.12)
    # iron brazier-like claws holding nothing: 3 iron prongs at the top of the menhir pointing at the crystal
    iron = MAT.engraved("runes", "blackiron", glow="#59c7ff")
    for k in range(3):
        a = 2 * math.pi * k / 3 + 0.3
        P.tube([(0.2 * math.cos(a), 0.14 * math.sin(a), 2.2), (0.3 * math.cos(a), 0.22 * math.sin(a), 2.42),
                (0.22 * math.cos(a), 0.16 * math.sin(a), 2.62)], 0.022, iron, taper=[(0, 1.0), (1, 0.3)])
    # floating crystal (separate object)
    cry = MAT._get("wpcrystal", lambda: _glow(M.crystal("GlowCrystalWP", color="#6fd2ff", glow=0.9,
                                                       emit_strength=6.0)))
    cz = 2.78
    bm = bmesh.new()
    top = bm.verts.new((0, 0, 0.36))
    bot = bm.verts.new((0, 0, -0.3))
    ring = [bm.verts.new((0.14 * math.cos(2 * math.pi * i / 6), 0.14 * math.sin(2 * math.pi * i / 6),
                          0.02 * (i % 2))) for i in range(6)]
    for i in range(6):
        j = (i + 1) % 6
        bm.faces.new((ring[i], ring[j], top))
        bm.faces.new((ring[j], ring[i], bot))
    C_.add_bm(bm, cry, Matrix.Translation((0, 0, cz)) @ Matrix.Rotation(0.2, 4, "Z"), smooth=0, offset=False)
    for k in range(3):
        a = 2 * math.pi * k / 3 + 0.7
        bm = bmesh.new()
        top = bm.verts.new((0, 0, 0.1))
        bot = bm.verts.new((0, 0, -0.08))
        ring = [bm.verts.new((0.04 * math.cos(2 * math.pi * i / 5), 0.04 * math.sin(2 * math.pi * i / 5), 0))
                for i in range(5)]
        for i in range(5):
            j = (i + 1) % 5
            bm.faces.new((ring[i], ring[j], top))
            bm.faces.new((ring[j], ring[i], bot))
        C_.add_bm(bm, cry, Matrix.Translation((0.32 * math.cos(a), 0.32 * math.sin(a), cz - 0.05 + 0.08 * k)) @
                  Matrix.Rotation(0.4 * k, 4, "X"), smooth=0, offset=False)
    return {"parts": P.objs, "separate": {"Crystal": C_.objs}, "pivots": {"Crystal": (0, 0, cz)}}


def _glow_main(m):
    """Rune stone: keep it in the Main atlas (rock + emissive runes baked into Main's emissive map)."""
    return m


# =============================================================================== DUNGEON GATE
def build_dungeon_gate(args):
    """≈6 m ruined stone gate into the depths: two massive pillars of dressed blocks, an arch of GN-instanced
    voussoirs with a glowing rune keystone, a dark swirling portal plane (emissive), a half-raised iron portcullis,
    steps going down, braziers, rubble and moss."""
    MAT = sk.Mats()
    P = sk.Parts(seed=909)
    blocks = MAT.blocks((0.6, 0.4))
    stone = MAT.stone("dark", 0.55)
    W = 5.8                  # outer width
    pw, pd = 1.25, 1.9       # pillar width / depth
    span = W - 2 * pw        # opening width (3.3)
    ph = 3.0                 # springing height of the arch
    rnd = random.Random(4)
    # pillars: stacked irregular big blocks (GN instances) around a core
    pts, rots, scls = [], [], []
    for sx in (-1, 1):
        xc = sx * (span / 2 + pw / 2)
        z = 0.0
        k = 0
        while z < ph - 0.05:
            h = min(rnd.uniform(0.5, 0.7), ph - z)
            pts.append((xc + rnd.uniform(-0.03, 0.03), rnd.uniform(-0.03, 0.03), z + h / 2))
            rots.append((rnd.uniform(-0.02, 0.02), rnd.uniform(-0.02, 0.02), rnd.uniform(-0.03, 0.03)))
            grow = 0.12 if k == 0 else 0.0
            scls.append((pw + grow + rnd.uniform(-0.04, 0.04), pd + grow + rnd.uniform(-0.04, 0.04), h - 0.025))
            z += h
            k += 1
    var = sk.stone_variants(6, 11, blocks, rough=0.05)
    ob, col = sk.gn_instances("PillarBlocks", pts, var, rots, scls, seed=1)
    ob.data.materials.append(blocks)
    gn.apply(ob)
    gn.remove(col)
    sk._smooth(ob.data, 180)
    P.add_obj(ob)
    # arch: voussoirs GN-instanced on a semicircle (X along the arc, Z radial)
    R = span / 2 + 0.35
    nv = 15
    pts, rots, scls = [], [], []
    for i in range(nv):
        a = math.pi * (i + 0.5) / nv
        pts.append((-R * math.cos(a), 0.0, ph + R * math.sin(a)))
        rots.append((0.0, a - math.pi / 2, rnd.uniform(-0.02, 0.02)))
        scls.append((math.pi * R / nv - 0.035, pd - 0.1 + rnd.uniform(-0.05, 0.05), 0.95))
    vv = sk.stone_variants(4, 50, blocks, rough=0.04)
    ob, col = sk.gn_instances("Voussoirs", pts, vv, rots, scls, seed=3)
    ob.data.materials.append(blocks)
    gn.apply(ob)
    gn.remove(col)
    sk._smooth(ob.data, 180)
    P.add_obj(ob)
    # spandrel masonry around the arch (rectangle minus the arch: concave prism) + cornice + broken merlons
    top = ph + R + 0.5
    Ro = R + 0.42
    poly = [(-W / 2, ph), (-W / 2, top), (W / 2, top), (W / 2, ph)]
    for i in range(17):
        a = math.pi * (1 - i / 16)
        poly.append((-Ro * math.cos(a), ph + Ro * math.sin(a)))
    rot = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0))).to_euler()
    P.poly_prism(poly, -(pd - 0.2) / 2, (pd - 0.2) / 2, blocks, rot=rot, smooth=0)
    P.box((W + 0.3, pd + 0.1, 0.3), (0, 0, top + 0.15), blocks, bevel=0.04)
    for k, x in enumerate((-2.4, -1.2, 0.9, 2.4)):
        hgt = 0.55 if k != 2 else 0.3
        P.box((0.8, pd - 0.3, hgt), (x, 0, top + 0.3 + hgt / 2), blocks, rot=(0, 0.05 * (k - 1.5), 0), bevel=0.04)
    # rune keystone (glowing) protruding at the crown
    rune = MAT._get("gaterune", lambda: sk.add_runes(M.stone_blocks("GateRunes", scale=2.0, seed=9, block=(0.4, 0.3),
                                                                    color="#6a675f", color2="#4d4a44"),
                                                     color="#b34dff", strength=5.0, cell=(0.2, 0.26), column=False,
                                                     sides_only=False))
    kz = ph + R
    P.poly_prism([(-0.28, -0.45), (0.28, -0.45), (0.4, 0.45), (-0.4, 0.45)], -pd / 2 - 0.12, pd / 2 + 0.12, rune,
                 loc=(0, 0, kz), rot=(math.pi / 2, 0, 0), bevel=0.03)
    # the portal: dark swirling emissive plane filling the arch (slightly recessed)
    portal = MAT._get("portal", lambda: _glow(portal_material()))
    verts, faces = [], []
    nseg = 16
    verts.append((0.0, 0.0, ph * 0.5))
    ring = []
    for i in range(nseg + 1):
        a = math.pi * i / nseg
        ring.append((-(span / 2 - 0.02) * math.cos(a), 0.0, ph + (span / 2 - 0.02) * math.sin(a)))
    ring = [(span / 2 - 0.02, 0.0, 0.02)] + ring[::-1] + [(-(span / 2 - 0.02), 0.0, 0.02)]
    # ring goes: bottom right -> arch (right to left) -> bottom left
    verts += ring
    for i in range(1, len(ring)):
        faces.append((0, i, i + 1))
    faces.append((0, len(ring), 1))
    o = P.mesh(verts, faces, portal, loc=(0, 0.25, 0.0), smooth=0, offset=False)
    gn.solidify(o, 0.02, offset=0.0)
    gn.apply(o)
    # worn steps in front of the portal
    for k in range(3):
        P.stone((span - 0.3 - 0.25 * k, 0.45, 0.2), (0, -1.05 - 0.42 * k, 0.1), MAT.stone("grey", 0.4),
                seed=60 + k, rough=0.06)
    # portcullis half raised (iron grid)
    iron = MAT.iron(0.7)
    pz0 = 2.25
    for i in range(9):
        x = -span / 2 + 0.2 + (span - 0.4) * i / 8
        P.box((0.06, 0.06, ph + 0.9 - pz0), (x, -0.05, pz0 + (ph + 0.9 - pz0) / 2), iron, bevel=0.008)
        P.cyl(0.004, 0.18, (x, -0.05, pz0 - 0.18), iron, n=6, r2=0.04, smooth=0)          # spike
    for z in (pz0 + 0.1, pz0 + 0.6, pz0 + 1.1, pz0 + 1.6):
        P.box((span - 0.2, 0.05, 0.06), (0, -0.05, z), iron, bevel=0.008)
    # chains
    for sx in (-1, 1):
        P.chain([(sx * (span / 2 - 0.15), -0.1, ph + 0.9), (sx * (span / 2 - 0.25), -0.1, pz0 + 1.65)], iron,
                link=0.07, wire=0.01, kind="POLY")
    # braziers on stone stands at both sides
    for sx in (-1, 1):
        bx = sx * (span / 2 + pw / 2)
        P.cyl(0.25, 0.9, (bx, -1.6, 0.0), blocks, n=8, r2=0.2, bevel=0.02)
        P.lathe([(0.06, 0.0), (0.1, 0.1), (0.36, 0.3), (0.4, 0.36), (0.35, 0.36), (0.08, 0.14)], (bx, -1.6, 0.9),
                MAT.blackiron(), n=10, cap_top=False)
        P.ico(0.3, (bx, -1.6, 1.2), MAT.ember(), subdiv=2, scale=(1, 1, 0.4), jitter=0.02)
    # rubble + moss clumps
    for k in range(9):
        a = rnd.uniform(0, 2 * math.pi)
        x = rnd.choice((-1, 1)) * rnd.uniform(2.5, 3.1)
        y = rnd.choice((-1, 1)) * rnd.uniform(1.1, 1.5)
        P.stone((rnd.uniform(0.25, 0.5), rnd.uniform(0.2, 0.4), rnd.uniform(0.15, 0.3)), (x, y, 0.08), stone,
                rot=(0, 0, a), seed=100 + k, rough=0.12)
    return P.objs


def portal_material():
    """Dark swirling void with violet/teal energy veins (strong emission only on the veins)."""
    m, nb, bsdf = M._new("GlowPortal", "portal")
    tc = nb.node("ShaderNodeTexCoord").outputs["Object"]
    s = nb.sep(tc)
    # polar swirl around the arch centre (x, z)
    x = s[0]
    z = nb.sub(s[2], 2.2)
    ang = nb.math("ARCTAN2", z, x)
    rad = nb.math("SQRT", nb.add(nb.mul(x, x), nb.mul(z, z)))
    sw = nb.xyz(nb.add(nb.mul(ang, 1.2), nb.mul(rad, 2.5)), nb.mul(rad, 1.5), 0.0)
    n1 = nb.noise(sw, 1.6, 6.0, 0.6, dist=1.2).outputs["Fac"]
    vein = nb.maprange(nb.math("ABSOLUTE", nb.sub(n1, 0.5)), 0.05, 0.0)
    core = nb.maprange(rad, 0.0, 1.6, 1.0, 0.0)
    emis = M._pal(nb, nb.clamp01(nb.add(nb.mul(vein, 0.9), nb.mul(core, 0.25))),
                  ["#000000", "#1b0633", "#6a1fb3", "#5fd7ff"], [0.0, 0.35, 0.75, 1.0])
    col = nb.mix("#050308", "#140a22", n1)
    return M._finish(m, nb, bsdf, col, 0.3, None, emission=emis, emit_strength=2.6, vec=tc)
