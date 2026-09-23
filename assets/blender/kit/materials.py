"""Procedural shader-node materials for Brumeval's dark-fantasy look (Blender 5.0).

Every function builds a node graph that ends in ONE Principled BSDF and returns the bpy Material.
The graphs are meant to be BAKED with kit.bake (glTF cannot carry node graphs); they use Cycles-only
nodes (Ambient Occlusion, Bevel) for cavity dirt and edge wear, which work during the bake.

Common keyword arguments (all optional):
    name      material name. Wind in the client is driven by the name prefix: Leaf*/Foliage*/Grass*/Cloth*/Banner*.
    scale     pattern frequency multiplier (features per metre ~ scale).
    seed      integer, offsets the pattern (deterministic variation between assets).
    coords    'OBJECT' (default, 3D), 'BOX' (2D box projection, for bricks/planks/tiles), 'UV' (authored UVs).
    dirt      0..1 grime in cavities (AO) and in low parts of the pattern.
    wear      0..1 edge wear (bevel-normal edge detector + the 'wear' attribute written by kit.gn.edge_wear).
    moss      0..1 moss/lichen overlay on up-facing surfaces and cavities (+ 'moss' attribute if present).
    bump      multiplier of the bump strength.
Colours accept '#rrggbb' (sRGB) or (r,g,b) tuples in sRGB.

Custom properties set on each material (read by kit.bake):
    mat["kit_bake"] = "atlas" (unique UVs, default) or "tile" (keep authored UVs, bake one tileable square)
    mat["kit_group"] = texture-set name; materials of the same group share one atlas/material after baking.
                       Default: "Main" for opaque surfaces; wind/alpha materials get their own group = their name.
"""
import bpy

from .nodes import NB, sock, srgb

WIND_PREFIXES = ("Leaf", "Foliage", "Grass", "Cloth", "Banner")


# =============================================================================== scaffolding
def _new(name, kind, group=None, bake_mode="atlas", alpha=False):
    old = bpy.data.materials.get(name)
    if old is not None:  # deterministic: rebuild instead of silently reusing different parameters
        old.name = name + "_old"
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    nb = NB(m.node_tree, clear=True)
    out = nb.node("ShaderNodeOutputMaterial")
    out.location = (600, 0)
    bsdf = nb.node("ShaderNodeBsdfPrincipled")
    bsdf.location = (300, 0)
    nb.links.new(bsdf.outputs[0], out.inputs["Surface"])
    m["kit"] = kind
    m["kit_bake"] = bake_mode
    if group is None:
        group = name if (alpha or name.startswith(WIND_PREFIXES)) else "Main"
    m["kit_group"] = group
    if alpha:
        m["kit_alpha"] = 1
        m.surface_render_method = "DITHERED"
    return m, nb, bsdf


def coords(nb, mode="OBJECT", scale=1.0, seed=0, stretch=(1.0, 1.0, 1.0)):
    """Texture coordinate vector socket: mode OBJECT/BOX/UV/GENERATED, scaled, stretched and seed-offset."""
    tc = nb.node("ShaderNodeTexCoord")
    if mode == "UV":
        v = tc.outputs["UV"]
    elif mode == "GENERATED":
        v = tc.outputs["Generated"]
    elif mode == "BOX":
        p = nb.sep(tc.outputs["Object"])
        nrm = nb.vmath("ABSOLUTE", tc.outputs["Normal"])
        an = nb.sep(nrm)
        mxy = nb.math("MAXIMUM", an[0], an[1])
        cz = nb.math("GREATER_THAN", an[2], mxy)            # top/bottom faces -> (x, y)
        cx0 = nb.math("GREATER_THAN", an[0], an[1])         # side faces facing X -> (y, z)
        cx = nb.mul(cx0, nb.sub(1.0, cz))
        cy = nb.mul(nb.sub(1.0, cx0), nb.sub(1.0, cz))      # faces facing Y -> (x, z)
        vz = nb.vmath("SCALE", nb.xyz(p[0], p[1], 0.0), scale=cz)
        vx = nb.vmath("SCALE", nb.xyz(p[1], p[2], 0.0), scale=cx)
        vy = nb.vmath("SCALE", nb.xyz(p[0], p[2], 0.0), scale=cy)
        v = nb.vmath("ADD", nb.vmath("ADD", vz, vx), vy)
    else:
        v = tc.outputs["Object"]
    s = scale if isinstance(scale, (tuple, list)) else (scale, scale, scale)
    v = nb.vmath("MULTIPLY", v, tuple(s[i] * stretch[i] for i in range(3)))
    if seed:
        v = nb.vmath("ADD", v, (seed * 7.31 % 97.0, seed * 3.17 % 89.0, seed * 5.53 % 83.0))
    return v


def _attr(nb, name):
    a = nb.node("ShaderNodeAttribute", {"attribute_type": "GEOMETRY", "attribute_name": name})
    return a.outputs["Fac"]


def cavity_mask(nb, dist=0.25, contrast=1.0):
    """1 in crevices (ray-traced AO, Cycles), 0 on open surfaces."""
    ao = nb.node("ShaderNodeAmbientOcclusion", {"only_local": True, "samples": 12}, Distance=dist)
    c = nb.maprange(ao.outputs["AO"], 0.35, 1.0, 1.0, 0.0, "SMOOTHSTEP")
    return nb.math("POWER", c, 1.0 / max(contrast, 0.05)) if contrast != 1.0 else c


def edge_mask(nb, radius=0.02, attr="wear"):
    """1 on convex edges: bevel-normal vs true normal (Cycles) + optional geometry attribute from gn.edge_wear."""
    bev = nb.node("ShaderNodeBevel", {"samples": 6}, Radius=radius)
    geo = nb.node("ShaderNodeNewGeometry")
    d = nb.vmath("DOT_PRODUCT", bev.outputs[0], geo.outputs["Normal"])
    e = nb.maprange(d, 0.985, 0.90, 0.0, 1.0, "SMOOTHSTEP")
    if attr:
        e = nb.math("MAXIMUM", e, _attr(nb, attr))
    return e


def up_mask(nb, lo=0.35, hi=0.85):
    geo = nb.node("ShaderNodeNewGeometry")
    z = nb.sep(geo.outputs["Normal"])[2]
    return nb.smooth(z, lo, hi)


def _finish(m, nb, bsdf, base, rough, height=None, metal=0.0, emission=None, emit_strength=1.0, alpha=None,
            bump=1.0, bump_dist=0.02, dirt=0.0, dirt_color="#2a2118", wear=0.0, wear_color=None, wear_rough=None,
            moss=0.0, moss_color="#4a5a26", vec=None, cavity_dist=0.25, edge_radius=0.02, spec=0.5, sss=0.0, coat=0.0):
    """Apply dirt / edge wear / moss layers and plug everything into the Principled BSDF."""
    if vec is None:
        vec = coords(nb, "OBJECT", 1.0)
    brk = nb.noise(vec, 3.0, 6.0, 0.6).outputs["Fac"]                 # large breakup noise
    # ---- dirt in cavities and low parts of the pattern
    if dirt > 0:
        cav = cavity_mask(nb, cavity_dist)
        if height is not None:
            low = nb.maprange(height, 0.0, 0.45, 1.0, 0.0, "SMOOTHSTEP")
            cav = nb.math("MAXIMUM", cav, nb.mul(low, 0.7))
        dm = nb.mul(nb.mul(cav, nb.maprange(brk, 0.3, 0.7, 0.55, 1.0)), dirt)
        base = nb.mix(base, dirt_color, nb.clamp01(nb.mul(dm, 1.2)))
        rough = nb.mixf(rough, 0.95, dm)
        if not isinstance(metal, (int, float)) or metal > 0:
            metal = nb.mixf(metal, 0.0, dm)
    # ---- edge wear
    if wear > 0:
        em = edge_mask(nb, edge_radius)
        em = nb.mul(em, nb.maprange(nb.noise(vec, 9.0, 4.0, 0.7).outputs["Fac"], 0.35, 0.65, 0.2, 1.0))
        em = nb.clamp01(nb.mul(em, wear * 1.5))
        wc = wear_color if wear_color is not None else nb.mix(base, "#d8cfbf", 0.18, "SCREEN")
        base = nb.mix(base, wc, em)
        if wear_rough is not None:
            rough = nb.mixf(rough, wear_rough, em)
    # ---- moss / lichen overlay
    if moss > 0:
        mvec = nb.vmath("ADD", vec, (13.1, 7.7, 3.3))
        mn = nb.noise(mvec, 2.2, 8.0, 0.65, dist=0.4).outputs["Fac"]
        mm = nb.mul(up_mask(nb, 0.25, 0.8), nb.maprange(mn, 0.62 - 0.3 * moss, 0.72 - 0.3 * moss, 0.0, 1.0))
        mm = nb.math("MAXIMUM", mm, nb.mul(nb.mul(cavity_mask(nb, cavity_dist * 0.7), 0.6 * moss), nb.maprange(mn, 0.4, 0.6)))
        mm = nb.math("MAXIMUM", mm, _attr(nb, "moss"))
        mm = nb.clamp01(nb.mul(mm, 1.0))
        fine = nb.noise(nb.vmath("SCALE", vec, scale=40.0), 1.0, 6.0, 0.7)
        mcol = nb.mix(nb.mix(moss_color, "#2c3a14", fine.outputs["Fac"]), "#7d8a3a",
                      nb.mul(nb.maprange(mn, 0.6, 0.9), 0.5))
        base = nb.mix(base, mcol, mm)
        rough = nb.mixf(rough, 0.95, mm)
        if height is not None:
            height = nb.mixf(height, nb.add(nb.mul(fine.outputs["Fac"], 0.25), 0.7), mm)
        if not isinstance(metal, (int, float)) or metal > 0:
            metal = nb.mixf(metal, 0.0, mm)
    # ---- plug
    nb.feed(sock(bsdf.inputs, "Base Color"), base)
    nb.feed(sock(bsdf.inputs, "Roughness"), rough)
    nb.feed(sock(bsdf.inputs, "Metallic"), metal)
    try:
        sock(bsdf.inputs, "Specular IOR Level").default_value = spec
    except KeyError:
        pass
    if height is not None and bump > 0:
        b = nb.node("ShaderNodeBump", Strength=min(1.0, 0.6 * bump), Distance=bump_dist * bump, Height=height)
        nb.link(b.outputs["Normal"], sock(bsdf.inputs, "Normal"))
    if emission is not None:
        nb.feed(sock(bsdf.inputs, "Emission Color"), emission)
        sock(bsdf.inputs, "Emission Strength").default_value = emit_strength
        m["kit_emissive"] = 1
    if alpha is not None:
        nb.feed(sock(bsdf.inputs, "Alpha"), alpha)
    if sss > 0:
        sock(bsdf.inputs, "Subsurface Weight").default_value = sss
        sock(bsdf.inputs, "Subsurface Radius").default_value = (0.9, 0.35, 0.2)
        sock(bsdf.inputs, "Subsurface Scale").default_value = 0.01
    if coat > 0:
        sock(bsdf.inputs, "Coat Weight").default_value = coat
    m.diffuse_color = (0.5, 0.5, 0.5, 1)
    return m


def _pal(nb, fac, colors, positions=None):
    """Colour ramp over a palette list."""
    n = len(colors)
    positions = positions or [i / (n - 1) for i in range(n)]
    return nb.ramp(fac, list(zip(positions, colors)))


# =============================================================================== stone & rock
def stone_blocks(name="Stone", color="#77736a", color2="#5d5a53", mortar_color="#3a352c", scale=1.0, block=(0.6, 0.3),
                 seed=0, coords_mode="BOX", dirt=0.6, wear=0.4, moss=0.0, bump=1.0):
    """Irregular ashlar / castle wall blocks (block = width, height in metres)."""
    m, nb, bsdf = _new(name, "stone_blocks")
    v = coords(nb, coords_mode, scale, seed)
    warp = nb.noise(v, 1.5, 2.0, 0.5).outputs["Color"]
    vw = nb.vmath("ADD", v, nb.vmath("SCALE", nb.vmath("SUBTRACT", warp, 0.5), scale=0.04))
    br = nb.brick(vw, 1.0, block[0], block[1], mortar=0.018, msmooth=0.35, offset=0.45, freq=2, c1=(1, 1, 1), c2=(0, 0, 0))
    per = nb.bw(br.outputs["Color"])                           # per-block random value
    mort = br.outputs["Fac"]
    chip = nb.noise(nb.vmath("SCALE", v, scale=6.0), 1.0, 8.0, 0.65).outputs["Fac"]
    pits = nb.voronoi(nb.vmath("SCALE", v, scale=14.0), 1.0).outputs["Distance"]
    h = nb.mul(nb.sub(1.0, mort), nb.add(0.65, nb.mul(chip, 0.35)))
    h = nb.sub(h, nb.mul(nb.maprange(pits, 0.0, 0.12, 0.12, 0.0), 1.0))
    h = nb.add(h, nb.mul(per, 0.12))
    col = nb.mix(color2, color, nb.maprange(per, 0, 1, 0.1, 0.9))
    col = nb.mix(col, _pal(nb, chip, ["#4e4a44", "#8a867c", "#a39d90"]), 0.35, "OVERLAY")
    col = nb.mix(col, mortar_color, nb.maprange(mort, 0.2, 0.6))
    rough = nb.maprange(chip, 0.2, 0.8, 0.72, 0.95)
    return _finish(m, nb, bsdf, col, rough, h, bump=bump, bump_dist=0.03, dirt=dirt, wear=wear, moss=moss, vec=v,
                   cavity_dist=0.2)


def rock(name="Rock", color="#6b665d", color2="#4f4a42", strata=0.6, scale=1.0, seed=0, dirt=0.6, wear=0.12,
         moss=0.3, bump=1.0, lichen=0.2):
    """Rough rock / cliff with sedimentary strata, cracks, lichen and moss."""
    m, nb, bsdf = _new(name, "rock")
    v = coords(nb, "OBJECT", scale, seed)
    big = nb.noise(v, 0.8, 4.0, 0.55, dist=0.3)
    bands = nb.wave(v, 1.6, 6.0, 4.0, "BANDS", "Z", "SIN", dscale=1.5)
    cr = nb.voronoi(nb.vmath("SCALE", v, scale=1.0), 1.4, "DISTANCE_TO_EDGE", rand=1.0)
    cmask = nb.maprange(nb.noise(nb.vmath("ADD", v, (4.2, 1.9, 7.3)), 1.1, 3.0).outputs["Fac"], 0.52, 0.62)
    crack = nb.mul(nb.maprange(cr.outputs["Distance"], 0.0, 0.03, 1.0, 0.0, "SMOOTHSTEP"), cmask)
    fine = nb.noise(nb.vmath("SCALE", v, scale=8.0), 1.0, 10.0, 0.62)
    h = nb.add(nb.mul(big.outputs["Fac"], 0.55), nb.mul(fine.outputs["Fac"], 0.35))
    h = nb.add(h, nb.mul(bands.outputs["Fac"], 0.25 * strata))
    h = nb.sub(h, nb.mul(crack, 0.45))
    col = _pal(nb, nb.mixf(big.outputs["Fac"], bands.outputs["Fac"], 0.5 * strata), [color2, color, color2],
               [0.2, 0.5, 0.85])
    col = nb.mix(col, _pal(nb, fine.outputs["Fac"], ["#4a4640", "#8c877d"]), 0.22, "OVERLAY")
    speck = nb.noise(nb.vmath("SCALE", v, scale=35.0), 1.0, 2.0, 0.5).outputs["Fac"]
    col = nb.mix(col, "#2b2824", nb.mul(nb.maprange(speck, 0.62, 0.72), 0.5))          # dark mineral specks
    if lichen > 0:
        ln = nb.voronoi(nb.vmath("SCALE", v, scale=7.0), 1.0, "F1").outputs["Distance"]
        lm = nb.mul(nb.maprange(ln, 0.12, 0.04), nb.maprange(big.outputs["Fac"], 0.55, 0.68, 0.0, lichen))
        col = nb.mix(col, "#9b9670", lm)
    col = nb.mix(col, "#1d1a16", nb.mul(crack, 0.8))
    rough = nb.maprange(fine.outputs["Fac"], 0.3, 0.7, 0.78, 0.95)
    return _finish(m, nb, bsdf, col, rough, h, bump=bump, bump_dist=0.05, dirt=dirt, wear=wear, moss=moss, vec=v,
                   cavity_dist=0.3, edge_radius=0.03)


def cobblestone(name="Cobble", color="#6f6a62", gap_color="#3a3024", scale=1.0, stone=0.18, seed=0, coords_mode="BOX",
                dirt=0.5, moss=0.2, bump=1.0):
    """Rounded cobbles (stone = stone size in metres) with muddy gaps."""
    m, nb, bsdf = _new(name, "cobblestone")
    v = coords(nb, coords_mode, scale / stone, seed)
    vo = nb.voronoi(v, 1.0, "DISTANCE_TO_EDGE", rand=0.85)
    vc = nb.voronoi(v, 1.0, "F1", rand=0.85)
    dome = nb.maprange(vo.outputs["Distance"], 0.0, 0.25, 0.0, 1.0, "SMOOTHERSTEP")
    fine = nb.noise(nb.vmath("SCALE", v, scale=4.0), 1.0, 8.0, 0.6).outputs["Fac"]
    h = nb.add(nb.mul(dome, 0.85), nb.mul(fine, 0.15))
    per = nb.bw(vc.outputs["Color"])
    col = _pal(nb, per, ["#57534c", color, "#8a8378", "#6a5f52"])
    col = nb.mix(col, gap_color, nb.maprange(dome, 0.25, 0.05))
    rough = nb.maprange(dome, 0.0, 1.0, 0.95, 0.72)
    return _finish(m, nb, bsdf, col, rough, h, bump=bump, bump_dist=0.03, dirt=dirt, moss=moss, vec=v, cavity_dist=0.12)


def slate(name="Slate", color="#3f4447", scale=1.0, seed=0, dirt=0.4, moss=0.15, bump=1.0):
    """Dark layered slate with flaking strata."""
    m, nb, bsdf = _new(name, "slate")
    v = coords(nb, "OBJECT", scale, seed)
    layers = nb.wave(nb.vmath("MULTIPLY", v, (1, 1, 1)), 6.0, 3.0, 2.0, "BANDS", "Z", "SAW")
    fl = nb.voronoi(nb.vmath("MULTIPLY", v, (3, 3, 0.8)), 2.5, "F1").outputs["Distance"]
    fine = nb.noise(nb.vmath("SCALE", v, scale=10.0), 1.0, 8.0, 0.6).outputs["Fac"]
    h = nb.add(nb.mul(layers.outputs["Fac"], 0.5), nb.add(nb.mul(fl, 0.3), nb.mul(fine, 0.2)))
    col = _pal(nb, nb.mixf(layers.outputs["Fac"], fine, 0.5), ["#2c3033", color, "#5b6265"])
    rough = nb.maprange(fl, 0.0, 1.0, 0.55, 0.85)
    return _finish(m, nb, bsdf, col, rough, h, bump=bump, bump_dist=0.02, dirt=dirt, moss=moss, vec=v)


def plaster(name="Plaster", color="#b9ad96", stain="#6d5f4a", scale=1.0, seed=0, cracks=0.5, dirt=0.6, moss=0.0,
            bump=1.0, ground_dirt=0.6):
    """Old lime plaster with water stains, cracks and dirt rising from the ground."""
    m, nb, bsdf = _new(name, "plaster")
    v = coords(nb, "OBJECT", scale, seed)
    st = nb.noise(nb.vmath("MULTIPLY", v, (1, 1, 0.35)), 1.5, 6.0, 0.6, dist=0.5).outputs["Fac"]
    fine = nb.noise(nb.vmath("SCALE", v, scale=12.0), 1.0, 8.0, 0.7).outputs["Fac"]
    cr = nb.voronoi(nb.vmath("SCALE", v, scale=2.0), 1.0, "DISTANCE_TO_EDGE").outputs["Distance"]
    crm = nb.mul(nb.maprange(cr, 0.0, 0.015, 1.0, 0.0), nb.maprange(st, 0.5, 0.65, 0.0, cracks))
    col = nb.mix(color, stain, nb.maprange(st, 0.45, 0.75, 0.0, 0.7))
    col = nb.mix(col, _pal(nb, fine, ["#8c826f", "#d6ccb6"]), 0.25, "OVERLAY")
    col = nb.mix(col, "#3b3226", crm)
    if ground_dirt > 0:
        z = nb.sep(nb.node("ShaderNodeTexCoord").outputs["Object"])[2]
        gd = nb.mul(nb.maprange(nb.add(z, nb.mul(st, 0.4)), 0.0, 0.9, ground_dirt, 0.0), 1.0)
        col = nb.mix(col, "#4a3e2e", gd)
    h = nb.sub(nb.add(nb.mul(fine, 0.3), nb.mul(st, 0.2)), nb.mul(crm, 0.4))
    rough = nb.maprange(fine, 0, 1, 0.82, 0.96)
    return _finish(m, nb, bsdf, col, rough, h, bump=bump, bump_dist=0.01, dirt=dirt, moss=moss, vec=v)


# =============================================================================== wood & vegetation surfaces
def wood_planks(name="Wood", color="#6b4a2e", color2="#3f2a19", scale=1.0, plank=(2.0, 0.22), axis="X", seed=0,
                coords_mode="BOX", dirt=0.5, wear=0.4, moss=0.0, bump=1.0, weathered=0.3):
    """Weathered planks (plank = length, width in metres) with grain, knots, gaps and grey sun-bleaching."""
    m, nb, bsdf = _new(name, "wood_planks")
    v = coords(nb, coords_mode, scale, seed)
    if axis == "Y":
        s = nb.sep(v)
        v = nb.xyz(s[1], s[0], s[2])
    br = nb.brick(v, 1.0, plank[0], plank[1], mortar=0.006, msmooth=0.4, offset=0.37, freq=1, c1=(1, 1, 1), c2=(0, 0, 0))
    per = nb.bw(br.outputs["Color"])
    gap = br.outputs["Fac"]
    gv = nb.vmath("ADD", nb.vmath("MULTIPLY", v, (1.0, 22.0, 22.0)), nb.xyz(0, nb.mul(per, 17.0), 0))
    grain = nb.wave(gv, 1.0, 9.0, 3.0, "BANDS", "Y", "SIN", dscale=2.0).outputs["Fac"]
    fib = nb.noise(nb.vmath("MULTIPLY", v, (4, 60, 60)), 1.0, 6.0, 0.7).outputs["Fac"]
    knots = nb.voronoi(nb.vmath("MULTIPLY", v, (1.6, 6.0, 6.0)), 1.0, "F1").outputs["Distance"]
    km = nb.maprange(knots, 0.1, 0.03)
    col = nb.mix(color2, color, nb.maprange(nb.add(nb.mul(grain, 0.7), nb.mul(per, 0.5)), 0.2, 1.1))
    col = nb.mix(col, _pal(nb, fib, ["#2d1e12", "#8a6a48"]), 0.25, "OVERLAY")
    col = nb.mix(col, "#20150c", nb.mul(km, 0.8))
    if weathered > 0:
        wn = nb.noise(v, 1.2, 4.0, 0.6).outputs["Fac"]
        col = nb.mix(col, "#7f7a70", nb.maprange(wn, 0.45, 0.75, 0.0, weathered))
    col = nb.mix(col, "#140d07", nb.maprange(gap, 0.2, 0.7))
    h = nb.mul(nb.sub(1.0, gap), nb.add(0.7, nb.add(nb.mul(grain, 0.15), nb.mul(fib, 0.15))))
    h = nb.sub(h, nb.mul(km, 0.1))
    rough = nb.maprange(fib, 0.0, 1.0, 0.7, 0.92)
    return _finish(m, nb, bsdf, col, rough, h, bump=bump, bump_dist=0.012, dirt=dirt, wear=wear, moss=moss, vec=v,
                   wear_color=nb.mix(color, "#b59a78", 0.5), cavity_dist=0.15)


def wood(name="WoodBeam", color="#5e4129", color2="#352316", scale=1.0, seed=0, axis="Z", dirt=0.5, wear=0.4, moss=0.0,
         bump=1.0, weathered=0.3):
    """Solid wood (beams, posts, handles): grain along `axis`, cracks and weathering."""
    m, nb, bsdf = _new(name, "wood")
    st = {"X": (1.5, 25, 25), "Y": (25, 1.5, 25), "Z": (25, 25, 1.5)}[axis]
    v = coords(nb, "OBJECT", scale, seed)
    gv = nb.vmath("MULTIPLY", v, st)
    ring = nb.wave(gv, 0.8, 8.0, 3.0, "RINGS", "SPHERICAL", "SIN", dscale=1.5).outputs["Fac"]
    fib = nb.noise(gv, 2.0, 8.0, 0.7).outputs["Fac"]
    cracks = nb.voronoi(nb.vmath("MULTIPLY", v, tuple(x * 0.35 for x in st)), 1.0, "DISTANCE_TO_EDGE").outputs["Distance"]
    crk = nb.maprange(cracks, 0.0, 0.02, 1.0, 0.0)
    col = nb.mix(color2, color, nb.add(nb.mul(ring, 0.6), nb.mul(fib, 0.4)))
    if weathered > 0:
        wn = nb.noise(v, 1.5, 4.0, 0.6).outputs["Fac"]
        col = nb.mix(col, "#77716a", nb.maprange(wn, 0.45, 0.75, 0.0, weathered))
    col = nb.mix(col, "#150e08", nb.mul(crk, 0.85))
    h = nb.sub(nb.add(nb.mul(ring, 0.25), nb.mul(fib, 0.4)), nb.mul(crk, 0.5))
    rough = nb.maprange(fib, 0, 1, 0.68, 0.9)
    return _finish(m, nb, bsdf, col, rough, h, bump=bump, bump_dist=0.01, dirt=dirt, wear=wear, moss=moss, vec=v,
                   wear_color=nb.mix(color, "#b8a07c", 0.5))


_BARK = {
    "oak": dict(c1="#3b2f25", c2="#5f5143", stretch=(3.0, 3.0, 0.45), furrow=0.8, plates=0.2),
    "pine": dict(c1="#3a2317", c2="#7a4a2e", stretch=(2.0, 2.0, 1.0), furrow=0.35, plates=0.9),
    "birch": dict(c1="#d9d4c7", c2="#efe9dc", stretch=(1.0, 1.0, 1.0), furrow=0.0, plates=0.0),
    "dead": dict(c1="#57524b", c2="#8e877c", stretch=(3.0, 3.0, 0.3), furrow=0.6, plates=0.0),
}


def bark(name="Bark", kind="oak", color=None, color2=None, scale=1.0, seed=0, dirt=0.5, moss=0.3, bump=1.0):
    """Tree bark: kind in oak / pine / birch / dead. Trunks run along local Z (curves: use object coords)."""
    p = _BARK[kind]
    c1, c2 = color2 or p["c1"], color or p["c2"]
    m, nb, bsdf = _new(name, "bark_" + kind)
    v = coords(nb, "OBJECT", scale * 3.0, seed)
    vs = nb.vmath("MULTIPLY", v, p["stretch"])
    warp = nb.noise(v, 0.6, 3.0, 0.5).outputs["Color"]
    vs = nb.vmath("ADD", vs, nb.vmath("SCALE", nb.vmath("SUBTRACT", warp, 0.5), scale=0.6))
    fine = nb.noise(nb.vmath("SCALE", v, scale=6.0), 1.0, 8.0, 0.65).outputs["Fac"]
    if kind == "birch":
        lent = nb.noise(nb.vmath("MULTIPLY", v, (2.0, 2.0, 30.0)), 1.0, 3.0, 0.5).outputs["Fac"]
        lm = nb.maprange(lent, 0.62, 0.7)
        patch = nb.noise(nb.vmath("MULTIPLY", v, (1.5, 1.5, 0.8)), 1.0, 5.0, 0.6, dist=0.6).outputs["Fac"]
        pm = nb.maprange(patch, 0.64, 0.7)
        col = nb.mix(c1, c2, fine)
        col = nb.mix(col, "#2a2521", nb.math("MAXIMUM", lm, pm))
        h = nb.sub(nb.mul(fine, 0.3), nb.mul(lm, 0.3))
        rough = 0.6
    else:
        fur = nb.voronoi(vs, 1.0, "DISTANCE_TO_EDGE").outputs["Distance"]
        fm = nb.maprange(fur, 0.0, 0.18, 0.0, 1.0, "SMOOTHSTEP")
        pl = nb.voronoi(vs, 1.0, "F1").outputs["Color"]
        h = nb.add(nb.mul(fm, p["furrow"]), nb.mul(fine, 0.35))
        if p["plates"] > 0:
            h = nb.add(h, nb.mul(nb.bw(pl), 0.3 * p["plates"]))
        col = nb.mix(c1, c2, nb.maprange(h, 0.1, 1.0))
        col = nb.mix(col, "#15100c", nb.mul(nb.maprange(fm, 0.3, 0.0), 0.85))
        if kind == "pine":
            col = nb.mix(col, "#8f5a38", nb.mul(nb.bw(pl), 0.35))
        rough = nb.maprange(fine, 0, 1, 0.8, 0.95)
    return _finish(m, nb, bsdf, col, rough, h, bump=bump, bump_dist=0.03, dirt=dirt, moss=moss, vec=v,
                   moss_color="#4b5c24", cavity_dist=0.12)


def thatch(name="Thatch", color="#8a7447", scale=1.0, seed=0, axis="Y", dirt=0.5, moss=0.35, bump=1.0):
    """Straw thatch; straws run along `axis` (roof slope direction, default Y)."""
    m, nb, bsdf = _new(name, "thatch")
    st = {"X": (2.0, 80.0, 80.0), "Y": (80.0, 2.0, 80.0), "Z": (80.0, 80.0, 2.0)}[axis]
    v = coords(nb, "OBJECT", scale, seed)
    strands = nb.noise(nb.vmath("MULTIPLY", v, st), 1.0, 6.0, 0.7).outputs["Fac"]
    clumps = nb.voronoi(nb.vmath("MULTIPLY", v, tuple(s / 16 for s in st)), 1.0, "F1").outputs["Distance"]
    h = nb.add(nb.mul(strands, 0.6), nb.mul(nb.sub(1.0, clumps), 0.4))
    col = _pal(nb, strands, ["#3e3120", color, "#b39a63"])
    col = nb.mix(col, "#4e4a3c", nb.mul(nb.noise(v, 1.0, 4.0).outputs["Fac"], 0.5))
    return _finish(m, nb, bsdf, col, 0.92, h, bump=bump, bump_dist=0.025, dirt=dirt, moss=moss, vec=v,
                   moss_color="#51612b")


def roof_tiles(name="RoofTiles", color="#7a3b28", color2="#51261a", scale=1.0, tile=(0.3, 0.2), seed=0,
               coords_mode="BOX", dirt=0.5, moss=0.35, bump=1.0):
    """Overlapping clay tiles; rows run along X, stepping along the projection's second axis."""
    m, nb, bsdf = _new(name, "roof_tiles")
    v = coords(nb, coords_mode, scale, seed)
    br = nb.brick(v, 1.0, tile[0], tile[1], mortar=0.01, msmooth=0.6, offset=0.5, freq=2, c1=(1, 1, 1), c2=(0, 0, 0))
    per = nb.bw(br.outputs["Color"])
    row = nb.math("FRACT", nb.math("DIVIDE", nb.sep(v)[1], tile[1]))
    step = nb.maprange(row, 0.0, 1.0, 1.0, 0.25)            # thick lower edge of each tile
    h = nb.mul(nb.sub(1.0, nb.mul(br.outputs["Fac"], 0.6)), step)
    col = nb.mix(color2, color, per)
    col = nb.mix(col, "#2e1a12", nb.maprange(row, 0.8, 1.0, 0.0, 0.5))
    col = nb.mix(col, _pal(nb, nb.noise(nb.vmath("SCALE", v, scale=8.0), 1.0, 6.0).outputs["Fac"], ["#3a2019", "#a2644a"]), 0.3, "OVERLAY")
    return _finish(m, nb, bsdf, col, 0.8, h, bump=bump, bump_dist=0.02, dirt=dirt, moss=moss, vec=v)


# =============================================================================== metals
_METALS = {
    "iron": ("#5a5754", 0.55), "steel": ("#8d9095", 0.35), "gold": ("#c9983e", 0.3),
    "bronze": ("#8c5f33", 0.4), "copper": ("#a0613d", 0.35), "silver": ("#b8b8b8", 0.3), "blackiron": ("#2d2c2b", 0.5),
}


def metal(name="Metal", kind="iron", color=None, rust=0.4, grime=0.5, wear=0.6, scale=1.0, seed=0, scratches=0.5,
          bump=1.0, patina=None):
    """Iron/steel/gold/bronze/copper/silver/blackiron with rust (or verdigris patina), grime and edge wear."""
    base_c, r0 = _METALS[kind]
    base_c = color or base_c
    m, nb, bsdf = _new(name, "metal_" + kind)
    v = coords(nb, "OBJECT", scale, seed)
    n1 = nb.noise(nb.vmath("SCALE", v, scale=2.5), 1.0, 8.0, 0.65, dist=0.3).outputs["Fac"]
    fine = nb.noise(nb.vmath("SCALE", v, scale=25.0), 1.0, 6.0, 0.6).outputs["Fac"]
    scr = nb.noise(nb.vmath("MULTIPLY", v, (3.0, 120.0, 3.0)), 1.0, 2.0, 0.5).outputs["Fac"]
    scm = nb.mul(nb.maprange(scr, 0.62, 0.7), scratches)
    col = nb.mix(base_c, nb.mix(base_c, "#000000", 0.35), nb.maprange(n1, 0.3, 0.7))
    rough = nb.add(r0, nb.mul(nb.sub(fine, 0.5), 0.2))
    rough = nb.mixf(rough, max(0.08, r0 - 0.25), scm)
    col = nb.mix(col, nb.mix(base_c, "#ffffff", 0.3), nb.mul(scm, 0.5))
    h = nb.add(nb.mul(fine, 0.2), nb.mul(scm, -0.15))
    metal_v = 1.0
    if rust > 0:
        if patina is None:
            patina = kind in ("bronze", "copper")
        rn = nb.noise(nb.vmath("SCALE", v, scale=4.0), 1.0, 10.0, 0.7, dist=0.5).outputs["Fac"]
        cav = cavity_mask(nb, 0.15)
        rm = nb.maprange(nb.add(rn, nb.mul(cav, 0.35)), 0.72 - 0.35 * rust, 0.82 - 0.35 * rust)
        rcol = _pal(nb, fine, ["#3d6a5a", "#5c8f7a", "#86b19c"] if patina else ["#3a1e10", "#7a3a18", "#a5582a", "#5a3218"])
        col = nb.mix(col, rcol, rm)
        rough = nb.mixf(rough, 0.92, rm)
        metal_v = nb.mixf(1.0, 0.0, rm)
        h = nb.add(h, nb.mul(rm, nb.mul(fine, 0.5)))
    return _finish(m, nb, bsdf, col, rough, h, metal=metal_v, bump=bump, bump_dist=0.004, dirt=grime,
                   dirt_color="#1b1714", wear=wear, wear_color=nb.mix(base_c, "#ffffff", 0.35), wear_rough=0.22,
                   vec=v, cavity_dist=0.08, edge_radius=0.008)


def engraved_metal(name="EngravedMetal", kind="steel", pattern="filigree", color=None, scale=1.0, seed=0, rust=0.15,
                   grime=0.7, wear=0.6, glow=None, glow_strength=3.0):
    """Metal with engraved filigree / runes / bands; engravings filled with dark grime (or glowing if glow colour)."""
    base_c, r0 = _METALS[kind]
    base_c = color or base_c
    m, nb, bsdf = _new(name, "engraved_" + kind)
    v = coords(nb, "OBJECT", scale * 6.0, seed)
    if pattern == "runes":
        eng = _rune_mask(nb, v)
    elif pattern == "bands":
        w = nb.wave(v, 2.0, 0.0, 0.0, "BANDS", "Z", "SIN").outputs["Fac"]
        eng = nb.maprange(nb.math("ABSOLUTE", nb.sub(w, 0.5)), 0.02, 0.0)
    else:  # filigree: interlocking curls
        mg = nb.node("ShaderNodeTexMagic", {"turbulence_depth": 3}, Vector=v, Scale=1.0, Distortion=2.2)
        vo = nb.voronoi(nb.vmath("ADD", v, mg.outputs["Color"]), 1.5, "DISTANCE_TO_EDGE").outputs["Distance"]
        eng = nb.maprange(vo, 0.0, 0.03, 1.0, 0.0)
    fine = nb.noise(nb.vmath("SCALE", v, scale=5.0), 1.0, 6.0, 0.6).outputs["Fac"]
    col = nb.mix(base_c, nb.mix(base_c, "#000000", 0.3), fine)
    col = nb.mix(col, "#14100c", nb.mul(eng, 0.9))
    rough = nb.mixf(nb.add(r0, nb.mul(nb.sub(fine, 0.5), 0.15)), 0.85, eng)
    metal_v = nb.mixf(1.0, 0.2, eng)
    h = nb.sub(nb.mul(fine, 0.1), nb.mul(eng, 0.6))
    emis = None
    if glow is not None:
        emis = nb.mix((0, 0, 0), glow, eng)
    if rust > 0:
        rn = nb.noise(nb.vmath("SCALE", v, scale=0.8), 1.0, 8.0, 0.7).outputs["Fac"]
        rm = nb.maprange(rn, 0.75 - 0.3 * rust, 0.85 - 0.3 * rust)
        col = nb.mix(col, "#6a3417", rm)
        rough = nb.mixf(rough, 0.9, rm)
        metal_v = nb.mixf(metal_v, 0.0, rm)
    return _finish(m, nb, bsdf, col, rough, h, metal=metal_v, bump=1.0, bump_dist=0.003, dirt=grime,
                   dirt_color="#15110d", wear=wear, wear_color=nb.mix(base_c, "#ffffff", 0.4), wear_rough=0.2,
                   vec=v, cavity_dist=0.06, edge_radius=0.006, emission=emis, emit_strength=glow_strength)


def _rune_mask(nb, v):
    """Angular rune-like glyph strokes (1 on strokes)."""
    br = nb.brick(v, 1.0, 1.0, 1.0, mortar=0.0, offset=0.0, c1=(1, 1, 1), c2=(0, 0, 0))
    cell = nb.bw(br.outputs["Color"])
    lv = nb.vmath("FRACTION", v)
    s = nb.sep(lv)
    # strokes: vertical, horizontal and diagonal lines chosen per cell by thresholds of the random cell value
    vert = nb.maprange(nb.math("ABSOLUTE", nb.sub(s[0], nb.add(0.3, nb.mul(cell, 0.4)))), 0.06, 0.03)
    hor = nb.mul(nb.maprange(nb.math("ABSOLUTE", nb.sub(s[1], nb.sub(0.8, nb.mul(cell, 0.5)))), 0.06, 0.03),
                 nb.math("GREATER_THAN", cell, 0.3))
    diag = nb.mul(nb.maprange(nb.math("ABSOLUTE", nb.sub(s[0], s[1])), 0.07, 0.035), nb.math("LESS_THAN", cell, 0.6))
    inside = nb.mul(nb.mul(nb.maprange(s[0], 0.1, 0.14), nb.maprange(s[0], 0.9, 0.86)),
                    nb.mul(nb.maprange(s[1], 0.08, 0.12), nb.maprange(s[1], 0.92, 0.88)))
    return nb.mul(nb.math("MAXIMUM", nb.math("MAXIMUM", vert, hor), diag), inside)


# =============================================================================== organics
def leather(name="Leather", color="#5a3a24", scale=1.0, seed=0, wear=0.5, dirt=0.4, bump=1.0, stitches=False):
    """Pebbled, creased leather; lighter worn edges."""
    m, nb, bsdf = _new(name, "leather")
    v = coords(nb, "OBJECT", scale, seed)
    peb = nb.voronoi(nb.vmath("SCALE", v, scale=90.0), 1.0, "F1").outputs["Distance"]
    cr = nb.noise(nb.vmath("MULTIPLY", v, (6, 6, 22)), 1.0, 6.0, 0.65, dist=0.8).outputs["Fac"]
    crease = nb.maprange(nb.math("ABSOLUTE", nb.sub(cr, 0.5)), 0.0, 0.05, 1.0, 0.0)
    big = nb.noise(nb.vmath("SCALE", v, scale=3.0), 1.0, 5.0).outputs["Fac"]
    h = nb.sub(nb.add(nb.mul(peb, 0.35), 0.4), nb.mul(crease, 0.3))
    col = nb.mix(nb.mix(color, "#000000", 0.35), color, nb.maprange(big, 0.3, 0.7))
    col = nb.mix(col, nb.mix(color, "#000000", 0.6), nb.mul(crease, 0.6))
    rough = nb.maprange(peb, 0.0, 1.0, 0.55, 0.8)
    return _finish(m, nb, bsdf, col, rough, h, bump=bump, bump_dist=0.004, dirt=dirt, wear=wear, vec=v,
                   wear_color=nb.mix(color, "#c8a882", 0.45), wear_rough=0.45, cavity_dist=0.06, edge_radius=0.01)


def cloth(name="Cloth", color="#3b3f5c", kind="wool", scale=1.0, seed=0, dirt=0.4, wear=0.3, hem_dirt=0.5, bump=1.0,
          pattern_color=None, coords_mode="OBJECT"):
    """Woven cloth: kind wool (coarse), linen (fine, light), silk (smooth sheen), burlap (open weave).
    Keep the name starting with 'Cloth' (or 'Banner') for wind sway in the client."""
    freq = {"wool": 160.0, "linen": 260.0, "silk": 400.0, "burlap": 70.0}[kind]
    m, nb, bsdf = _new(name, "cloth_" + kind)
    v = coords(nb, coords_mode, scale, seed)
    s = nb.sep(v)
    wa = nb.math("SINE", nb.mul(nb.add(s[0], s[1]), freq))
    wb = nb.math("SINE", nb.mul(s[2], freq))
    weave = nb.maprange(nb.mul(wa, wb), -1.0, 1.0)
    fuzz = nb.noise(nb.vmath("SCALE", v, scale=freq * 0.4), 1.0, 4.0, 0.7).outputs["Fac"]
    folds = nb.noise(nb.vmath("MULTIPLY", v, (3, 3, 0.7)), 1.0, 4.0, 0.5).outputs["Fac"]
    col = nb.mix(nb.mix(color, "#000000", 0.3), color, nb.maprange(folds, 0.25, 0.75))
    # the weave itself is sub-texel at game texture sizes: keep it faint (strong weave = checkerboard moire)
    # (sub-texel at 1-2k: only a whisper in colour, or it aliases into a diamond moire once baked)
    col = nb.mix(col, nb.mix(color, "#ffffff", 0.08), nb.mul(weave, 0.015 if freq > 100 else 0.05))
    col = nb.mix(col, _pal(nb, fuzz, ["#000000", "#ffffff"]), 0.1, "OVERLAY")
    streak = nb.noise(nb.vmath("MULTIPLY", v, (18.0, 18.0, 2.0)), 1.0, 5.0, 0.6).outputs["Fac"]
    col = nb.mix(col, nb.mix(color, "#000000", 0.45), nb.mul(nb.maprange(streak, 0.45, 0.8), 0.35))   # worn/faded streaks
    if pattern_color is not None:  # embroidered border near the hem
        z = s[2]
        band = nb.mul(nb.maprange(z, 0.06 * scale, 0.08 * scale), nb.maprange(z, 0.2 * scale, 0.18 * scale))
        col = nb.mix(col, pattern_color, nb.mul(band, 0.85))
    if hem_dirt > 0:
        z = nb.sep(nb.node("ShaderNodeTexCoord").outputs["Object"])[2]
        col = nb.mix(col, "#2d2519", nb.maprange(nb.add(z, nb.mul(fuzz, 0.1)), 0.05, 0.45, hem_dirt, 0.0))
    h = nb.add(nb.mul(weave, 0.03 if freq > 100 else 0.12), nb.add(nb.mul(fuzz, 0.2), nb.mul(folds, 0.8)))
    rough = {"silk": 0.45, "linen": 0.85, "wool": 0.95, "burlap": 0.97}[kind]
    sheen_rough = nb.add(rough, nb.mul(nb.sub(fuzz, 0.5), 0.08))
    return _finish(m, nb, bsdf, col, sheen_rough, h, bump=bump, bump_dist=0.004, dirt=dirt, wear=wear, vec=v,
                   wear_color=nb.mix(color, "#9a9080", 0.4), cavity_dist=0.08, spec=0.3)


def fur(name="Fur", color="#5b5048", tip="#a39a8e", root="#241d17", scale=1.0, seed=0, direction="Z", bump=1.0, dirt=0.2):
    """Fur/hair surface (for shells and the body under fur cards): strands along `direction`."""
    m, nb, bsdf = _new(name, "fur")
    st = {"X": (3, 120, 120), "Y": (120, 3, 120), "Z": (120, 120, 3)}[direction]
    v = coords(nb, "OBJECT", scale, seed)
    warp = nb.noise(v, 2.0, 3.0, 0.5).outputs["Color"]
    vv = nb.vmath("ADD", nb.vmath("MULTIPLY", v, st), nb.vmath("SCALE", warp, scale=4.0))
    strands = nb.noise(vv, 1.0, 5.0, 0.7).outputs["Fac"]
    clump = nb.noise(nb.vmath("MULTIPLY", v, tuple(x / 8 for x in st)), 1.0, 3.0, 0.5).outputs["Fac"]
    col = _pal(nb, nb.add(nb.mul(strands, 0.7), nb.mul(clump, 0.3)), [root, color, tip], [0.2, 0.55, 0.9])
    h = nb.add(nb.mul(strands, 0.7), nb.mul(clump, 0.3))
    return _finish(m, nb, bsdf, col, 0.85, h, bump=bump, bump_dist=0.006, dirt=dirt, vec=v, spec=0.35)


def skin(name="Skin", kind="human", color=None, scale=1.0, seed=0, bump=1.0, dirt=0.25):
    """Skin: kind human / orc / undead / troll. Pores, blotches, darker creases, subtle SSS."""
    pal = {"human": ("#b98a6e", "#9a5e4a"), "orc": ("#5f7a45", "#3f5230"), "undead": ("#8c8d7f", "#5c5a4f"),
           "troll": ("#6f7f6a", "#4b5347")}[kind]
    c1 = color or pal[0]
    m, nb, bsdf = _new(name, "skin_" + kind)
    v = coords(nb, "OBJECT", scale, seed)
    pores = nb.voronoi(nb.vmath("SCALE", v, scale=300.0), 1.0, "F1").outputs["Distance"]
    blot = nb.noise(nb.vmath("SCALE", v, scale=6.0), 1.0, 5.0, 0.6).outputs["Fac"]
    col = nb.mix(c1, pal[1], nb.maprange(blot, 0.45, 0.8, 0.0, 0.6))
    if kind == "undead":
        col = nb.mix(col, "#3c4a3a", nb.maprange(blot, 0.2, 0.35, 0.5, 0.0))
    h = nb.add(nb.mul(pores, 0.3), nb.mul(blot, 0.1))
    rough = nb.maprange(pores, 0, 1, 0.45, 0.65)
    return _finish(m, nb, bsdf, col, rough, h, bump=bump, bump_dist=0.0015, dirt=dirt, dirt_color=pal[1], vec=v,
                   cavity_dist=0.04, sss=0.12 if kind in ("human", "orc") else 0.0, spec=0.45)


def bone(name="Bone", color="#cbbd9c", scale=1.0, seed=0, dirt=0.7, bump=1.0):
    """Old bone/ivory: pits, hairline cracks, dirt in cavities."""
    m, nb, bsdf = _new(name, "bone")
    v = coords(nb, "OBJECT", scale, seed)
    pits = nb.voronoi(nb.vmath("SCALE", v, scale=40.0), 1.0, "F1").outputs["Distance"]
    cr = nb.voronoi(nb.vmath("MULTIPLY", v, (6, 6, 2)), 1.0, "DISTANCE_TO_EDGE").outputs["Distance"]
    crm = nb.maprange(cr, 0.0, 0.015, 1.0, 0.0)
    fine = nb.noise(nb.vmath("SCALE", v, scale=10.0), 1.0, 6.0, 0.6).outputs["Fac"]
    col = nb.mix(color, "#8a7a5a", nb.maprange(fine, 0.4, 0.8, 0.0, 0.6))
    col = nb.mix(col, "#3d3222", nb.mul(crm, 0.8))
    h = nb.sub(nb.add(nb.mul(fine, 0.3), nb.mul(nb.maprange(pits, 0.0, 0.1, 0.0, 1.0), 0.3)), nb.mul(crm, 0.3))
    return _finish(m, nb, bsdf, col, nb.maprange(fine, 0, 1, 0.5, 0.75), h, bump=bump, bump_dist=0.003, dirt=dirt,
                   vec=v, cavity_dist=0.06)


def moss(name="Moss", color="#48562a", color2="#232c12", scale=1.0, seed=0, bump=1.0):
    """Standalone moss (clumps, moss-covered roofs). Use materials' `moss=` for overlays."""
    m, nb, bsdf = _new(name, "moss")
    v = coords(nb, "OBJECT", scale, seed)
    fine = nb.noise(nb.vmath("SCALE", v, scale=60.0), 1.0, 6.0, 0.75).outputs["Fac"]
    big = nb.noise(nb.vmath("SCALE", v, scale=4.0), 1.0, 5.0, 0.6).outputs["Fac"]
    col = _pal(nb, nb.add(nb.mul(fine, 0.6), nb.mul(big, 0.4)), [color2, color, "#76803f"], [0.25, 0.6, 0.95])
    col = nb.mix(col, "#5b5a3a", nb.mul(nb.maprange(big, 0.55, 0.8), 0.5))           # dry brownish tips
    h = nb.add(nb.mul(fine, 0.6), nb.mul(big, 0.4))
    return _finish(m, nb, bsdf, col, 0.95, h, bump=bump, bump_dist=0.01, vec=v, spec=0.3)


# =============================================================================== ground & elements
def mud(name="Mud", color="#3f3122", scale=1.0, seed=0, wet=0.5, bump=1.0):
    """Mud with wet glossy puddles in low areas and footprints-like dents."""
    m, nb, bsdf = _new(name, "mud")
    v = coords(nb, "OBJECT", scale, seed)
    big = nb.noise(nb.vmath("SCALE", v, scale=1.5), 1.0, 6.0, 0.6).outputs["Fac"]
    fine = nb.noise(nb.vmath("SCALE", v, scale=20.0), 1.0, 8.0, 0.7).outputs["Fac"]
    h = nb.add(nb.mul(big, 0.7), nb.mul(fine, 0.3))
    puddle = nb.mul(nb.maprange(h, 0.45, 0.38), wet)
    col = nb.mix(_pal(nb, fine, ["#231a11", color, "#5c4a35"]), "#1a130c", puddle)
    rough = nb.mixf(0.85, 0.08, puddle)
    h = nb.math("MAXIMUM", h, 0.4)
    return _finish(m, nb, bsdf, col, rough, h, bump=bump, bump_dist=0.02, vec=v)


def snow(name="Snow", color="#e6ecf2", scale=1.0, seed=0, bump=1.0, dirt=0.0):
    """Wind-packed snow: soft drifts, sparkle-roughness variation, blue in cavities."""
    m, nb, bsdf = _new(name, "snow")
    v = coords(nb, "OBJECT", scale, seed)
    drift = nb.noise(nb.vmath("MULTIPLY", v, (1.5, 3.0, 1.5)), 1.0, 5.0, 0.55).outputs["Fac"]
    grain = nb.voronoi(nb.vmath("SCALE", v, scale=200.0), 1.0).outputs["Distance"]
    col = nb.mix(color, "#9fb3c9", nb.mul(cavity_mask(nb, 0.3), 0.6))
    col = nb.mix(col, "#c9d6e3", nb.maprange(drift, 0.3, 0.7, 0.3, 0.0))
    rough = nb.maprange(grain, 0.0, 0.3, 0.35, 0.8)
    h = nb.add(nb.mul(drift, 0.8), nb.mul(grain, 0.1))
    return _finish(m, nb, bsdf, col, rough, h, bump=bump, bump_dist=0.02, dirt=dirt, vec=v, sss=0.2, spec=0.5)


def ice(name="Ice", color="#8fc3dc", deep="#1d4a66", scale=1.0, seed=0, bump=1.0):
    """Glacial ice: glossy, deep blue in cracks and cavities, frosty patches."""
    m, nb, bsdf = _new(name, "ice")
    v = coords(nb, "OBJECT", scale, seed)
    cr = nb.voronoi(nb.vmath("SCALE", v, scale=2.5), 1.0, "DISTANCE_TO_EDGE").outputs["Distance"]
    crm = nb.maprange(cr, 0.0, 0.03, 1.0, 0.0)
    frost = nb.noise(nb.vmath("SCALE", v, scale=5.0), 1.0, 8.0, 0.7).outputs["Fac"]
    col = nb.mix(color, deep, nb.add(nb.mul(crm, 0.8), nb.mul(cavity_mask(nb, 0.4), 0.5)))
    fm = nb.maprange(frost, 0.55, 0.75)
    col = nb.mix(col, "#e2f0f6", fm)
    rough = nb.mixf(0.08, 0.6, fm)
    h = nb.sub(nb.mul(frost, 0.3), nb.mul(crm, 0.4))
    return _finish(m, nb, bsdf, col, rough, h, bump=bump, bump_dist=0.01, vec=v, coat=0.5, spec=0.8)


def sand(name="Sand", color="#c2a574", scale=1.0, seed=0, ripples=0.6, bump=1.0):
    """Desert sand with wind ripples and scattered pebbles."""
    m, nb, bsdf = _new(name, "sand")
    v = coords(nb, "OBJECT", scale, seed)
    rip = nb.wave(v, 6.0, 6.0, 2.0, "BANDS", "X", "SIN").outputs["Fac"]
    grain = nb.noise(nb.vmath("SCALE", v, scale=80.0), 1.0, 4.0, 0.7).outputs["Fac"]
    peb = nb.voronoi(nb.vmath("SCALE", v, scale=12.0), 1.0, "F1", rand=1.0).outputs["Distance"]
    pm = nb.maprange(peb, 0.1, 0.06)
    col = nb.mix(_pal(nb, grain, ["#9e8156", color, "#dbc494"]), "#6b5a45", pm)
    h = nb.add(nb.mul(rip, 0.5 * ripples), nb.add(nb.mul(grain, 0.2), nb.mul(pm, 0.4)))
    return _finish(m, nb, bsdf, col, 0.9, h, bump=bump, bump_dist=0.01, vec=v)


# =============================================================================== magic
def crystal(name="Crystal", color="#6fd2ff", glow=0.6, scale=1.0, seed=0, emit_strength=4.0):
    """Faceted crystal: glossy, darker core colour, glowing inner veins (emission)."""
    m, nb, bsdf = _new(name, "crystal")
    v = coords(nb, "OBJECT", scale, seed)
    vo = nb.voronoi(nb.vmath("SCALE", v, scale=3.0), 1.0, "DISTANCE_TO_EDGE").outputs["Distance"]
    vein = nb.maprange(vo, 0.0, 0.05, 1.0, 0.0)
    inner = nb.noise(nb.vmath("SCALE", v, scale=4.0), 1.0, 4.0, 0.5).outputs["Fac"]
    col = nb.mix(nb.mix(color, "#000000", 0.6), color, nb.maprange(inner, 0.3, 0.8))
    emis = nb.mix((0, 0, 0), color, nb.clamp01(nb.add(nb.mul(vein, glow), nb.mul(nb.maprange(inner, 0.6, 0.9), 0.4 * glow))))
    return _finish(m, nb, bsdf, col, 0.08, nb.mul(vein, -0.2), emission=emis, emit_strength=emit_strength, vec=v,
                   coat=1.0, spec=0.9)


def runes(name="RuneStone", base="rock", rune_color="#59c7ff", strength=6.0, scale=1.0, seed=0, **base_kwargs):
    """Stone (or any base: rock / stone_blocks / slate) carved with glowing runes (emission)."""
    fn = {"rock": rock, "stone_blocks": stone_blocks, "slate": slate}[base]
    m = fn(name=name, scale=scale, seed=seed, **base_kwargs)
    nb = NB(m.node_tree)
    bsdf = next(n for n in m.node_tree.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled")
    v = coords(nb, "OBJECT", scale * 5.0, seed + 11)
    band = nb.maprange(nb.noise(nb.vmath("SCALE", v, scale=0.12), 1.0, 2.0).outputs["Fac"], 0.5, 0.55)
    rm = nb.mul(_rune_mask(nb, v), band)
    col_in = sock(bsdf.inputs, "Base Color")
    prev = col_in.links[0].from_socket if col_in.is_linked else col_in.default_value[:]
    nb.feed(col_in, nb.mix(prev, "#101418", rm))
    nb.feed(sock(bsdf.inputs, "Emission Color"), nb.mix((0, 0, 0), rune_color, rm))
    sock(bsdf.inputs, "Emission Strength").default_value = strength
    m["kit_emissive"] = 1
    return m


def magic(name="Magic", color="#8a5cff", color2="#ff4fd8", strength=8.0, scale=1.0, seed=0):
    """Pure glowing energy (cores, portals, spell props): swirling emission, dark base."""
    m, nb, bsdf = _new(name, "magic")
    v = coords(nb, "OBJECT", scale * 3.0, seed)
    sw = nb.noise(v, 1.0, 6.0, 0.6, dist=2.5).outputs["Fac"]
    emis = _pal(nb, sw, ["#000000", color, color2, "#ffffff"], [0.2, 0.5, 0.8, 1.0])
    return _finish(m, nb, bsdf, nb.mix("#0b0b10", color, 0.2), 0.3, None, emission=emis, emit_strength=strength, vec=v)


def emissive(name="Glow", color="#ffb347", strength=5.0):
    """Flat emissive material (lantern glass, eyes, embers)."""
    m, nb, bsdf = _new(name, "emissive")
    return _finish(m, nb, bsdf, color, 0.4, None, emission=color, emit_strength=strength)


def flat(name="Flat", color="#808080", rough=0.8, metallic=0.0):
    """Plain colour (placeholder / tiny parts)."""
    m, nb, bsdf = _new(name, "flat")
    return _finish(m, nb, bsdf, color, rough, None, metal=metallic)


# =============================================================================== alpha cards (tile bake mode, UV space)
def leaf_card(name="Leaf", kind="oak", color="#3f5a22", color2="#6c7f2c", autumn=0.0, seed=0):
    """Alpha-mask foliage card texture in UV space (0..1). kind: oak / birch / willow / pine / grass / fern.
    The card mesh must have authored UVs; kit.bake bakes the card once as a tileable square (kit_bake='tile').
    Name MUST start with Leaf/Foliage/Grass for wind."""
    m, nb, bsdf = _new(name, "leaf_" + kind, bake_mode="tile", alpha=True)
    uv = nb.node("ShaderNodeTexCoord").outputs["UV"]
    s = nb.sep(uv)
    u, vv = s[0], s[1]
    if kind in ("pine", "grass"):
        # many thin blades/needles across the card, tapering to the tip (v=1)
        n_bl = 9.0 if kind == "grass" else 22.0
        cell = nb.math("FLOOR", nb.mul(u, n_bl))
        rnd = nb.node("ShaderNodeTexWhiteNoise", {"noise_dimensions": "1D"}, W=nb.add(cell, seed * 1.3)).outputs["Value"]
        lu = nb.sub(nb.math("FRACT", nb.mul(u, n_bl)), 0.5)
        lean = nb.mul(nb.sub(rnd, 0.5), nb.mul(vv, 0.9))
        top = nb.add(0.55, nb.mul(rnd, 0.45))
        width = nb.mul(0.42, nb.maprange(vv, 0.0, top, 1.0, 0.0))
        mask = nb.math("LESS_THAN", nb.math("ABSOLUTE", nb.sub(lu, lean)), width)
        mask = nb.mul(mask, nb.math("LESS_THAN", vv, top))
        shade = nb.add(nb.mul(vv, 0.7), nb.mul(rnd, 0.3))
        vein = nb.maprange(nb.math("ABSOLUTE", nb.sub(lu, lean)), 0.0, 0.08, 0.25, 0.0)
    else:
        # a cluster of leaves on a twig: 5 leaves placed around the card
        leaves = []
        shape = {"oak": (0.20, 0.11, 0.45), "birch": (0.14, 0.10, 0.2), "willow": (0.26, 0.05, 0.1),
                 "fern": (0.35, 0.06, 0.6)}[kind]
        spots = [(0.5, 0.78, 0.0), (0.3, 0.55, 0.9), (0.7, 0.55, -0.9), (0.33, 0.28, 1.2), (0.67, 0.3, -1.2), (0.5, 0.45, 0.2)]
        vein = None
        for i, (cx, cy, ang) in enumerate(spots):
            import math
            ca, sa = math.cos(ang), math.sin(ang)
            du, dv = nb.sub(u, cx), nb.sub(vv, cy)
            lx = nb.add(nb.mul(du, ca), nb.mul(dv, sa))       # across leaf
            ly = nb.sub(nb.mul(dv, ca), nb.mul(du, sa))       # along leaf
            L, W, lobes = shape
            t = nb.maprange(ly, -L, L, 0.0, 1.0, clamp=False)
            prof = nb.math("SINE", nb.mul(nb.clamp01(t), 3.14159))
            prof = nb.math("POWER", prof, 0.7)
            if lobes > 0:
                prof = nb.mul(prof, nb.add(1.0 - lobes * 0.25, nb.mul(nb.math("ABSOLUTE", nb.math("SINE", nb.mul(t, 15.7))), lobes * 0.25)))
            inside = nb.math("LESS_THAN", nb.math("ABSOLUTE", lx), nb.mul(prof, W))
            inside = nb.mul(inside, nb.mul(nb.math("GREATER_THAN", t, 0.0), nb.math("LESS_THAN", t, 1.0)))
            leaves.append(inside)
            vv_i = nb.maprange(nb.math("ABSOLUTE", lx), 0.0, 0.006, 1.0, 0.0)
            vein = vv_i if vein is None else nb.math("MAXIMUM", vein, nb.mul(vv_i, inside))
        mask = leaves[0]
        for l in leaves[1:]:
            mask = nb.math("MAXIMUM", mask, l)
        twig = nb.mul(nb.math("LESS_THAN", nb.math("ABSOLUTE", nb.sub(u, 0.5)), 0.012), nb.math("LESS_THAN", vv, 0.8))
        mask = nb.math("MAXIMUM", mask, twig)
        shade = nb.noise(uv, 6.0, 4.0, 0.6).outputs["Fac"]
        vein = nb.mul(vein, 0.4)
    col = nb.mix(color, color2, shade)
    if autumn > 0:
        col = nb.mix(col, _pal(nb, shade, ["#7a2e10", "#c7701f", "#d9a531"]), autumn)
    col = nb.mix(col, nb.mix(color2, "#d8e0a0", 0.4), vein)
    alpha = nb.math("GREATER_THAN", mask, 0.5)
    m["kit_alpha_cutoff"] = 0.5
    return _finish(m, nb, bsdf, col, 0.6, nb.mul(vein, -0.5), alpha=alpha, bump=0.5, bump_dist=0.002, sss=0.0, spec=0.4)


def fur_card(name="FurCard", color="#6b5d50", tip="#b5a998", root="#2a211a", seed=0):
    """Alpha hair/fur strand card in UV space (strands along V). kit_bake='tile'."""
    m, nb, bsdf = _new(name, "fur_card", bake_mode="tile", alpha=True)
    uv = nb.node("ShaderNodeTexCoord").outputs["UV"]
    s = nb.sep(uv)
    n_st = 40.0
    cell = nb.math("FLOOR", nb.mul(s[0], n_st))
    rnd = nb.node("ShaderNodeTexWhiteNoise", {"noise_dimensions": "1D"}, W=nb.add(cell, seed)).outputs["Value"]
    lu = nb.sub(nb.math("FRACT", nb.mul(s[0], n_st)), 0.5)
    top = nb.add(0.6, nb.mul(rnd, 0.4))
    mask = nb.mul(nb.math("LESS_THAN", nb.math("ABSOLUTE", lu), nb.mul(0.45, nb.maprange(s[1], 0, top, 1, 0))),
                  nb.math("LESS_THAN", s[1], top))
    col = _pal(nb, nb.add(nb.mul(s[1], 0.8), nb.mul(rnd, 0.2)), [root, color, tip], [0.0, 0.5, 1.0])
    m["kit_alpha_cutoff"] = 0.5
    return _finish(m, nb, bsdf, col, 0.8, None, alpha=nb.math("GREATER_THAN", mask, 0.5), spec=0.35)


# registry for docs / quick tests
ALL = {
    "stone_blocks": stone_blocks, "rock": rock, "cobblestone": cobblestone, "slate": slate, "plaster": plaster,
    "wood_planks": wood_planks, "wood": wood, "bark": bark, "thatch": thatch, "roof_tiles": roof_tiles,
    "metal": metal, "engraved_metal": engraved_metal, "leather": leather, "cloth": cloth, "fur": fur, "skin": skin,
    "bone": bone, "moss": moss, "mud": mud, "snow": snow, "ice": ice, "sand": sand, "crystal": crystal,
    "runes": runes, "magic": magic, "emissive": emissive, "flat": flat, "leaf_card": leaf_card, "fur_card": fur_card,
}
