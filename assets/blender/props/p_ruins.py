"""Ruins of Aldmar (ancient, colossal, eroded, overgrown) + gravestone + desert ruin.

All stone assets: clean masonry base (bmesh lofts / chamfered ashlar blocks / voussoirs) -> voxel fuse ->
GN bites (missing chunks) -> GN fracture (broken crests) -> voxel -> GN erosion -> HIGH; decimated copy = LOW;
moss cushions + grass tufts scattered with GN; everything baked high -> low by the kit.
"""
import math

import pk
from pk import M, gn
from p_mats import aldmar_stone, grave_stone, rune_stone, sandstone  # noqa: E402


def _grass(prefix="GrassRuins", seed=0, color="#4b5a26", color2="#8a8c46"):
    return M.leaf_card(prefix, kind="grass", color=color, color2=color2, seed=seed)


def grass_ring(r_in, r_out, density, seed, h=0.42, w=0.36, color="#3c4620", color2="#6e7334", name="GrassRuins",
               patchy=2.2, sx=1.0, sy=1.0, exclude=None, mat=None):
    """Clumps of grass tufts around a base (wind material Grass*). exclude(x,y,z): drop hidden cards."""
    mat = mat or _grass(name, seed, color, color2)
    card = pk.card_template("_GrassCardTpl", w, h, mat, crossed=2, bend=0.22, segs=2)
    disc = pk.ground_disc("GrassTarget", r_in, r_out, 0.0)
    disc.scale = (sx, sy, 1.0)
    pk.C.apply_transforms(disc)
    g = pk.scatter_cards(disc, card, density, seed, scale=(0.55, 1.2), name="Grass", patchy=patchy)
    if exclude is not None:
        pk.exclude_faces(g, exclude)
    return g


def _in_box(x0, x1, y0, y1):
    return lambda x, y, z: x0 < x < x1 and y0 < y < y1


# ------------------------------------------------------------------------------- ruins_pillar
def build_ruins_pillar(args):
    """≈4.6 m broken fluted column of Aldmar on a stepped plinth, moss, grass at its foot."""
    mat = aldmar_stone("AldmarStone", seed=3)
    rings = []
    for z, w in ((-0.05, 1.78), (0.30, 1.78), (0.30, 1.52), (0.58, 1.52)):   # stepped square plinth
        rings.append(pk.rect_ring(w, w, z, n_side=6, bevel=0.03))
    plinth = pk.loft("Plinth", rings, mat)
    N = 20                                                                   # moulded base + fluted drums

    def flutes(depth):
        return lambda t: 1.0 - depth * max(0.0, math.cos(N * t)) ** 0.6
    prof = [(0.56, 0.73, 0.0), (0.66, 0.75, 0.0), (0.74, 0.72, 0.0), (0.80, 0.64, 0.0), (0.86, 0.61, 0.0),
            (0.92, 0.66, 0.0), (0.98, 0.65, 0.0), (1.04, 0.6, 0.0)]
    top = 5.4
    drums = [1.08, 2.25, 3.35, 4.45, top]
    lathe = [pk.ring(160, r, z=zz, fn=flutes(d)) for zz, r, d in prof]
    for a, b in zip(drums[:-1], drums[1:]):
        for zz in (a + 0.03, a + 0.06, (a + b) / 2, b - 0.06, b - 0.03):
            t = (zz - 1.08) / (top - 1.08)
            r = 0.58 - 0.06 * t + 0.02 * math.sin(t * math.pi)           # entasis
            edge = zz in (a + 0.03, b - 0.03)
            lathe.append(pk.ring(160, r * (0.93 if edge else 1.0), z=zz, fn=flutes(0.06 if not edge else 0.03)))
    shaft = pk.loft("Shaft", lathe, mat)
    base = pk.join([plinth, shaft], "PillarBase")
    high, low = pk.eroded_pair(
        base, target_tris=3700, voxel=0.014, name="Pillar", sink=0.05,
        bite_spots=[((-0.86, -0.84, 0.3), 0.3, (1.3, 1, 1)), ((0.9, 0.7, 0.55), 0.22),
                    ((0.62, 0.3, 4.1), 0.3, (1, 1, 1.8)), ((-0.45, -0.5, 4.25), 0.25, (1, 1, 1.5))], bite_seed=2,
        fractures=[dict(normal=(0.3, -0.18, 1.0), point=(0, 0, 4.4), noise=0.16, scale=1.2, seed=5, jag=0.03)],
        erosion=dict(strength=0.04, scale=2.5, edge=0.09, edge_iters=8, edge_gain=20.0, pits=0.6, cracks=0.2, seed=4))
    gn.store_up_mask(high, "moss", lo=0.55, hi=0.9, noise_scale=1.4, seed=3)
    gn.apply(high)
    moss = pk.moss_clumps(low, density=7.0, up_min=0.8, size=0.1, seed=4, zmax=1.1, embed=0.025)
    grass = grass_ring(0.85, 1.2, 16.0, 7)
    return pk.finish("ruins_pillar", [low, moss, grass], args, high=high, budget="prop", expected=(2.5, 2.5, 4.7),
                     size=1024, extrusion=0.08, max_ray=0.35, group_sizes={"GrassRuins": 256})


# ------------------------------------------------------------------------------- ruins_wall
def build_ruins_wall(args):
    """≈6 m segment of a colossal Aldmar wall: running-bond ashlar, crumbled sloping crest, fallen blocks, moss.
    Runs along X (faces -Y / +Y)."""
    mat = aldmar_stone("AldmarStone", seed=11, moss=0.6)
    zs = [-0.05, 0.5, 1.12, 1.7, 2.32, 2.9, 3.5, 4.1]

    def crest(x):
        return 3.9 - (x + 3.0) * 0.36 + 0.35 * math.sin(x * 2.1)

    def keep(x0, x1, z0, z1):
        return z0 < crest((x0 + x1) / 2) - 0.15
    plinth = pk.courses(-3.15, 3.15, -0.66, 0.66, zs[:2], (1.0, 1.7), seed=2, mat=mat)
    body = pk.courses(-3.0, 3.0, -0.52, 0.52, zs[1:], (0.8, 1.55), seed=5, mat=mat, keep=keep, inset=0.03)
    fallen = [pk.block("Fall0", -0.55, 0.55, -0.3, 0.3, 0.0, 0.52, mat=mat),
              pk.block("Fall1", -0.5, 0.45, -0.3, 0.28, 0, 0.5, mat=mat)]
    pk.transform(fallen[0], (1.55, -1.22, -0.06), (4, -9, 27))
    pk.transform(fallen[1], (-2.1, 1.12, -0.08), (-7, 12, -38))
    base = pk.join(plinth + body + fallen, "WallBase")
    high, low = pk.eroded_pair(
        base, target_tris=9000, voxel=0.02, name="Wall", sink=0.05,
        bite_spots=[((-3.1, -0.6, 2.0), 0.35), ((3.05, 0.55, 0.9), 0.3), ((-1.0, -0.55, 0.3), 0.2),
                    ((0.8, 0.6, 1.9), 0.22), ((-2.9, 0.55, 3.4), 0.3)], bite_seed=7,
        fractures=[dict(normal=(0.34, 0.0, 1.0), point=(0.0, 0.0, 2.95), noise=0.28, scale=0.9, seed=3, jag=0.03)],
        erosion=dict(strength=0.05, scale=1.8, edge=0.1, edge_iters=8, edge_gain=16.0, pits=0.6, cracks=0.25, seed=6))
    gn.store_up_mask(high, "moss", lo=0.6, hi=0.92, noise_scale=1.1, seed=8)
    gn.apply(high)
    moss = pk.moss_clumps(low, density=4.0, up_min=0.8, size=0.12, seed=5, embed=0.03, zmax=0.7)
    grass = grass_ring(0.35, 1.0, 9.0, 12, sx=3.6, sy=1.4, exclude=_in_box(-3.1, 3.1, -0.62, 0.62))
    return pk.finish("ruins_wall", [low, moss, grass], args, high=high, budget="building", expected=(6.8, 2.8, 4.0),
                     size=2048, extrusion=0.08, max_ray=0.35, group_sizes={"GrassRuins": 256})


# ------------------------------------------------------------------------------- ruins_arch
def build_ruins_arch(args):
    """Colossal broken arch of Aldmar (≈7 m wide, 8 m tall): two ashlar piers, voussoir ring snapped just past
    the keystone, right pier crumbled. The passage runs along Y (front -Y)."""
    mat = aldmar_stone("AldmarStone", seed=21, moss=0.55)
    zs = [-0.05, 0.62, 1.25, 1.85, 2.5, 3.1, 3.72, 4.3, 4.7]
    lp = pk.courses(-3.3, -2.0, -0.72, 0.72, zs, (0.62, 0.66), seed=3, mat=mat)
    rp = pk.courses(2.0, 3.3, -0.72, 0.72, zs[:-2], (0.62, 0.66), seed=4, mat=mat,
                    keep=lambda x0, x1, z0, z1: not (z0 > 3.0 and x0 > 2.5))
    plinths = [pk.block("PlL", -3.5, -1.8, -0.9, 0.9, -0.05, 0.45, mat=mat),
               pk.block("PlR", 1.8, 3.5, -0.9, 0.9, -0.05, 0.45, mat=mat)]
    imposts = [pk.block("ImpL", -3.45, -1.85, -0.8, 0.8, 4.7, 4.95, mat=mat)]
    vous = pk.wedge_ring("Vous", 2.0, 3.25, 180.0, 0.0, -0.7, 0.7, 15, 4.95, mat,
                         keep=lambda i, b0, b1: b1 > 62.0)
    base = pk.join(lp + rp + plinths + imposts + vous, "ArchBase")
    high, low = pk.eroded_pair(
        base, target_tris=10000, voxel=0.022, name="Arch", sink=0.05,
        bite_spots=[((3.4, -0.8, 3.1), 0.45), ((2.1, 0.8, 3.4), 0.3), ((-3.4, 0.85, 2.2), 0.3),
                    ((1.2, 0.0, 7.45), 0.5, (1.0, 2.0, 1.0)), ((-1.5, -0.75, 7.3), 0.28)], bite_seed=5,
        fractures=[dict(normal=(0.55, 0.0, 1.0), point=(2.65, 0.0, 3.2), noise=0.25, scale=1.2, seed=2, jag=0.03,
                        radius=1.6),
                   dict(normal=(0.9, 0.0, -0.25), point=(1.25, 0.0, 7.6), noise=0.14, scale=1.5, seed=9, jag=0.03,
                        radius=1.8)],
        erosion=dict(strength=0.05, scale=1.6, edge=0.11, edge_iters=8, edge_gain=16.0, pits=0.6, cracks=0.25, seed=9))
    gn.store_up_mask(high, "moss", lo=0.6, hi=0.92, noise_scale=1.2, seed=4)
    gn.apply(high)
    moss = pk.moss_clumps(low, density=4.0, up_min=0.82, size=0.12, seed=6, embed=0.03, zmax=0.8)
    g1 = grass_ring(0.7, 1.3, 10.0, 21, exclude=_in_box(-0.9, 0.9, -1.0, 1.0))
    gmat = g1.data.materials[0]
    pk.transform(g1, (-2.65, 0, 0))
    g2 = grass_ring(0.7, 1.3, 12.0, 22, exclude=_in_box(-0.9, 0.9, -1.0, 1.0), mat=gmat)
    pk.transform(g2, (2.65, 0, 0))
    grass = pk.join([g1, g2], "Grass")
    return pk.finish("ruins_arch", [low, moss, grass], args, high=high, budget="building", expected=(7.2, 2.6, 8.1),
                     size=2048, extrusion=0.09, max_ray=0.4, group_sizes={"GrassRuins": 256})


# ------------------------------------------------------------------------------- obelisk
def build_obelisk(args):
    """≈4.6 m rune obelisk of Aldmar on a stepped base: golden glowing glyph columns on its four faces."""
    mat = rune_stone("RuneStone", glow="#ffb347", strength=6.0, seed=5)
    rings = []
    for z, w in ((-0.05, 1.9), (0.34, 1.9), (0.34, 1.52), (0.64, 1.52)):
        rings.append(pk.rect_ring(w, w, z, n_side=6, bevel=0.03))
    base_steps = pk.loft("Steps", rings, mat)
    shaft_r = []
    for z, w in ((0.62, 0.86), (0.78, 0.86), (0.84, 0.8), (4.0, 0.56)):
        shaft_r.append(pk.rect_ring(w, w, z, n_side=5, bevel=0.035))
    shaft_r.append(pk.rect_ring(0.03, 0.03, 4.55, n_side=5, bevel=0.005))
    shaft = pk.loft("Shaft", shaft_r, mat)
    base = pk.join([base_steps, shaft], "ObeliskBase")
    high, low = pk.eroded_pair(
        base, target_tris=3200, voxel=0.012, name="Obelisk", sink=0.05,
        bite_spots=[((0.95, -0.95, 0.3), 0.25), ((-0.78, 0.78, 0.6), 0.16), ((0.3, 0.3, 4.4), 0.12),
                    ((-0.43, -0.3, 2.3), 0.07, (1, 1, 3))], bite_seed=3,
        erosion=dict(strength=0.02, scale=3.0, edge=0.035, edge_iters=6, edge_gain=24.0, pits=0.4, cracks=0.2, seed=2))
    gn.store_up_mask(high, "moss", lo=0.6, hi=0.9, noise_scale=1.6, seed=2)
    gn.apply(high)
    moss = pk.moss_clumps(low, density=6.0, up_min=0.85, size=0.09, seed=8, embed=0.025, zmax=0.7)
    grass = grass_ring(0.95, 1.35, 14.0, 31)
    return pk.finish("obelisk", [low, moss, grass], args, high=high, budget="prop", expected=(2.6, 2.6, 4.6),
                     size=1024, extrusion=0.05, max_ray=0.25, group_sizes={"GrassRuins": 256})


# ------------------------------------------------------------------------------- gravestone
def build_gravestone(args):
    """≈1.1 m weathered headstone (sun-cross relief, worn epitaph) at the head of a stone-kerbed grave running
    towards the front (-Y), sunken earth mound, moss and grass. Footprint ≈1.0 x 1.65 m like the old model."""
    stone = grave_stone("GraveStone", seed=4)
    prof = []
    for i in range(25):
        a = math.pi * i / 24
        prof.append((0.37 * math.cos(a), 0.78 + 0.3 * math.sin(a)))
    outline = [(0.4, -0.02), (0.37, 0.78)] + prof[1:-1] + [(-0.37, 0.78), (-0.4, -0.02)]
    verts, faces = [], []
    n = len(outline)
    for y in (-0.08, 0.08):
        for x, z in outline:
            verts.append((x * (1.0 if y < 0 else 0.97), y, z))
    faces.append(tuple(range(n))[::-1])
    faces.append(tuple(range(n, 2 * n)))
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
    head = pk.mesh_obj("Head", verts, faces, stone, smooth=False)
    pk.clean(head)
    pk.transform(head, (0.02, 0.0, 0.0), (-6, 3, 2))
    hbase = pk.block("HeadBase", -0.46, 0.46, -0.16, 0.16, -0.05, 0.12, mat=stone)
    kerb = []
    for x0, x1, y0, y1 in ((-0.47, -0.37, -1.62, -0.14), (0.37, 0.47, -1.62, -0.14), (-0.47, 0.47, -1.62, -1.52)):
        kerb.append(pk.block("Kerb", x0, x1, y0, y1, -0.05, 0.14, mat=stone, chamfer=0.02))
    hs = pk.join([head, hbase] + kerb, "GraveHigh")
    high, low = pk.eroded_pair(
        hs, target_tris=2400, voxel=0.008, name="Grave", sink=0.05,
        bite_spots=[((0.33, -0.08, 1.02), 0.1), ((0.47, -1.6, 0.14), 0.08), ((-0.47, -0.9, 0.14), 0.06, (1, 2, 1))],
        bite_seed=4, erosion=dict(strength=0.012, scale=5.0, edge=0.02, edge_iters=6, edge_gain=40.0, pits=0.4,
                                  cracks=0.15, crack_scale=3.0, seed=3))
    gn.store_up_mask(high, "moss", lo=0.6, hi=0.9, noise_scale=3.0, seed=4)
    gn.apply(high)
    mud = M.mud("GraveEarth", color="#3a2e22", seed=3, wet=0.3)        # earth mound (low-only, baked directly)
    mound_r = []
    for z, s in ((0.0, 1.0), (0.1, 0.92), (0.16, 0.7), (0.18, 0.35)):
        mound_r.append(pk.ring(24, 0.36 * s, 0.68 * s, z=z, cy=-0.86))
    mound = pk.loft("Mound", mound_r, mud)
    gn.displace(mound, strength=0.03, scale=6.0, detail=4, voronoi=0.2, seed=5, subdiv=1)
    gn.apply(mound)
    pk.delete_bottom(mound, z=0.02)
    mound["kit_bake_direct"] = 1
    moss = pk.moss_clumps(low, density=10.0, up_min=0.8, size=0.05, seed=9, embed=0.012, zmax=1.2)
    grass = grass_ring(0.5, 0.95, 26.0, 41, h=0.32, w=0.26, sx=0.85, sy=1.2)
    pk.transform(grass, (0, -0.75, 0))
    return pk.finish("gravestone", [low, mound, moss, grass], args, high=high, budget="prop",
                     expected=(1.0, 1.7, 1.15), size=1024, extrusion=0.03, max_ray=0.12,
                     group_sizes={"GrassRuins": 256}, open_ok=True)


# ------------------------------------------------------------------------------- desert_ruin
def build_desert_ruin(args):
    """Sandstone corner of a desert temple: two crumbling walls (one with an arched window), a broken column,
    half buried under a wind-blown sand drift. ≈6 x 5.5 m, 4 m tall."""
    ss = sandstone("Sandstone", seed=7)
    zs = [-0.05, 0.45, 0.9, 1.35, 1.8, 2.25, 2.7, 3.15, 3.6, 4.05]

    def crest_a(x):
        return 4.1 - (2.2 - x) * 0.45 + 0.3 * math.sin(x * 2.7)

    def keep_a(x0, x1, z0, z1):
        xm = (x0 + x1) / 2
        window = abs(xm - 0.1) < 0.5 and 1.3 < z0 < 2.6
        return z0 < crest_a(xm) - 0.1 and not window
    wall_a = pk.courses(-2.9, 2.2, 1.3, 2.1, zs, (0.5, 1.0), seed=8, mat=ss, keep=keep_a, inset=0.04)

    def keep_b(a, b, z0, z1):
        ym = (a + b) / 2
        return z0 < 3.9 - (2.1 - ym) * 0.55 + 0.25 * math.sin(ym * 3.1)
    wall_b = pk.courses(-2.2, 2.1, -2.9, -2.1, zs, (0.5, 1.0), seed=9, mat=ss, inset=0.04, keep=keep_b)
    for o in wall_b:                          # courses() lays along X: rotate this wall to run along Y
        pk.transform(o, (0, 0, 0), (0, 0, 90))
    lintel = pk.wedge_ring("Win", 0.42, 0.62, 0.0, 180.0, 1.3, 2.1, 5, 2.4, ss)
    for o in lintel:
        pk.transform(o, (0.1, 0, 0))
    col = pk.loft("Col", [pk.ring(24, r, z=z, fn=lambda t: 1 - 0.04 * max(0, math.cos(12 * t)))
                          for z, r in ((-0.05, 0.36), (0.25, 0.36), (0.3, 0.3), (2.3, 0.27))], ss)
    pk.transform(col, (1.25, -0.9, 0))
    drum = pk.loft("Drum", [pk.ring(24, 0.28, z=z) for z in (0.0, 0.75)], ss)
    pk.transform(drum, (-1.2, -2.0, 0.26), (90, 0, 35))
    base = pk.join(wall_a + wall_b + lintel + [col, drum], "DesertBase")
    high, low = pk.eroded_pair(
        base, target_tris=10000, voxel=0.02, name="DesertRuin", sink=0.05,
        bite_spots=[((2.25, 1.7, 2.2), 0.4), ((-2.95, 1.7, 1.2), 0.3), ((2.5, -1.2, 2.4), 0.35),
                    ((1.25, -0.9, 2.3), 0.3)], bite_seed=6,
        fractures=[dict(normal=(0.45, -0.2, 1.0), point=(1.25, -0.9, 2.0), noise=0.1, scale=2.0, seed=4, jag=0.03,
                        radius=0.6)],
        erosion=dict(strength=0.06, scale=1.6, edge=0.12, edge_iters=8, edge_gain=16.0, pits=0.3, cracks=0.2, seed=8))
    sand = M.sand("Sand", color="#c9a978", seed=5, ripples=0.5)       # wind-blown drift (low-only, baked directly)
    dr = []
    for z, s in ((0.0, 1.0), (0.25, 0.8), (0.5, 0.55), (0.62, 0.3)):
        dr.append(pk.ring(40, 2.2 * s, 1.6 * s, z=z, cx=0.9, cy=0.4))
    drift = pk.loft("Drift", dr, sand)
    gn.displace(drift, strength=0.1, scale=1.2, detail=3, voronoi=0.0, seed=2, subdiv=2)
    gn.apply(drift)
    pk.delete_bottom(drift, z=0.02)
    pk.decimate_to(drift, 1600)
    pk.smooth_all(drift)
    drift["kit_bake_direct"] = 1
    return pk.finish("desert_ruin", [low, drift], args, high=high, budget="building", expected=(6.0, 5.5, 4.1),
                     size=2048, extrusion=0.09, max_ray=0.4, open_ok=True)


BUILDERS = {
    "ruins_pillar": build_ruins_pillar,
    "ruins_wall": build_ruins_wall,
    "ruins_arch": build_ruins_arch,
    "obelisk": build_obelisk,
    "gravestone": build_gravestone,
    "desert_ruin": build_desert_ruin,
}
