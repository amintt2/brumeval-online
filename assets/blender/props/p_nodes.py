"""Gathering nodes: ore outcrops (copper / iron / mithril), magenta crystal cluster, three herbs (brume, givre,
braise). ≈1-1.6 m, readable from afar: strong silhouettes, bright ore / crystal / petal colours on dark rock.

Ores: GN-eroded boulder (high -> low bake) + faceted ore chunks and small crystals GN-scattered on the low rock
(baked directly, kit_bake_direct). Herbs: stems are GN curve sweeps, leaves and petals are GN instances on points
(clean closed blades, no alpha), one wind material 'Foliage*' whose colours are driven by per-part attributes.
"""
import math
import random

import bpy

import pk
from pk import M, NB, V, gn, sock
from p_mats import ore_metal


# =============================================================================== rock base
def boulder_pair(name, parts, mat, target_tris, voxel=0.012, cuts=6, disp=0.05, seed=0):
    """Fused boulders (list of (loc, scale)) -> voxel -> GN planar cuts + displacement = HIGH; decimated LOW."""
    obs = []
    for k, (loc, sc) in enumerate(parts):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=1.0)
        o = bpy.context.object
        o.scale = sc
        o.location = loc
        pk.C.apply_transforms(o)
        o.data.materials.append(mat)
        obs.append(o)
    base = pk.join(obs, "_" + name + "Base")
    gn.voxel_remesh(base, voxel)
    gn.apply(base)
    gn.planar_cuts(base, cuts=cuts, depth=(0.03, 0.1), seed=seed, up_bias=0.2)
    gn.displace(base, strength=disp, scale=2.2, detail=8, rough=0.6, seed=seed, voronoi=0.4, strata=0.03,
                strata_scale=6.0)
    gn.apply(base)
    pk.ground_clip(base, -0.05)
    gn.apply(base)
    pk.remove_small_islands(base, 200)
    pk.smooth_all(base)
    high = base
    high.name = "_" + name + "High"
    low = pk.dup(high, name)
    pk.decimate_to(low, target_tris)
    pk.remove_small_islands(low, 24)
    pk.delete_bottom(low, z=-0.03)
    pk.sharp_edges(low, 70.0)
    return high, low


def host_rock(name="NodeRock", seed=0, color="#57544f", color2="#3a3834", vein=None):
    m = M.rock(name, color=color, color2=color2, strata=0.35, scale=1.6, seed=seed, dirt=0.7, wear=0.15, moss=0.25,
               lichen=0.2)
    if vein:                                  # ore veins running through the rock (voronoi cell edges)
        nb = NB(m.node_tree)
        bsdf = pk._bsdf(m)
        tc = nb.node("ShaderNodeTexCoord").outputs["Object"]
        w = nb.noise(nb.vmath("SCALE", tc, scale=1.5), 1.0, 3.0).outputs["Color"]
        vv = nb.vmath("ADD", nb.vmath("SCALE", tc, scale=2.2), nb.vmath("SCALE", w, scale=0.6))
        ed = nb.voronoi(vv, 1.0, "DISTANCE_TO_EDGE").outputs["Distance"]
        vm = nb.mul(nb.maprange(ed, 0.0, 0.035, 1.0, 0.0),
                    nb.maprange(nb.noise(nb.vmath("SCALE", tc, scale=2.0), 1.0, 2.0).outputs["Fac"], 0.45, 0.6))
        bc = sock(bsdf.inputs, "Base Color")
        nb.feed(bc, nb.mix(pk._input_src(nb, bc), vein, vm))
        mt = sock(bsdf.inputs, "Metallic")
        nb.feed(mt, nb.math("MAXIMUM", pk._input_src(nb, mt), nb.mul(vm, 0.8)))
        rs = sock(bsdf.inputs, "Roughness")
        nb.feed(rs, nb.mixf(pk._input_src(nb, rs), 0.35, vm))
    return m


def chunk_tpl(name, size, mat, seed, cuts=6, stretch=(1.0, 1.0, 1.3)):
    """Faceted ore chunk template (for GN scatter)."""
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=size)
    c = bpy.context.object
    c.name = name
    c.scale = stretch
    pk.C.apply_transforms(c)
    c.data.materials.append(mat)
    gn.planar_cuts(c, cuts=cuts, depth=(0.1, 0.3), seed=seed)
    gn.apply(c)
    pk.smooth_all(c, False)
    return c


def prism(name, r, h, mat, sides=6, tip=0.3, taper=0.85, seed=0):
    """Hexagonal crystal prism with a pointed tip, base at z=0, pointing +Z."""
    rnd = random.Random(seed)
    tw = rnd.uniform(0, 1)
    rings = [pk.ring(sides, r, z=-0.05, phase=tw), pk.ring(sides, r * taper, z=h * (1 - tip), phase=tw),
             pk.ring(sides, r * 0.06, z=h, phase=tw)]
    ob = pk.loft(name, rings, mat, smooth=False)
    return ob


def _ore_node(key, args, kind, rock_kw, ore_seed, vein_col, expected):
    rock = host_rock("NodeRock", seed=ore_seed, vein=vein_col, **rock_kw)
    parts = [((0.0, 0.0, 0.2), (0.62, 0.5, 0.55)), ((0.35, 0.18, 0.12), (0.4, 0.38, 0.42)),
             ((-0.32, -0.12, 0.08), (0.36, 0.34, 0.3)), ((0.05, -0.1, 0.55), (0.32, 0.3, 0.32))]
    high, low = boulder_pair("Rock", parts, rock, 2600, voxel=0.012, cuts=7, disp=0.06, seed=ore_seed)
    ore = ore_metal("Ore" + kind.title(), kind, seed=ore_seed)
    tpls = [chunk_tpl(f"_Chunk{k}", s, ore, ore_seed * 10 + k, stretch=st)
            for k, (s, st) in enumerate(((0.09, (1.0, 0.9, 1.5)), (0.07, (1.2, 1.0, 1.0)), (0.11, (1.0, 1.0, 1.9))))]
    chunks = pk.dup(low, "OreChunks")
    gn.scatter(chunks, tpls, density=16.0, seed=ore_seed, up_min=-0.1, scale=(0.7, 1.5), rot_random=(0.5, 0.5, 3.14),
               embed=0.035, keep_target=False, distance_min=0.12, name="OreScatter")
    gn.apply(chunks)
    pk.remove_small_islands(chunks, 6)
    chunks["kit_bake_direct"] = 1
    for t in tpls:
        gn.remove(t)
    gn.store_up_mask(high, "moss", lo=0.7, hi=0.95, noise_scale=2.0, seed=ore_seed)
    gn.apply(high)
    return pk.finish(key, [low, chunks], args, high=high, budget="prop", expected=expected, size=1024,
                     extrusion=0.04, max_ray=0.15, open_ok=True)


def build_node_copper(args):
    """Copper outcrop: dark rock laced with copper veins, bright copper nuggets with green verdigris."""
    return _ore_node("node_copper", args, "copper", dict(color="#5a554f", color2="#3b3833"), 3, "#b8683a",
                     (1.3, 1.1, 1.0))


def build_node_iron(args):
    """Iron outcrop: reddish-brown rusty rock, dark metallic iron chunks with rust blooms."""
    return _ore_node("node_iron", args, "iron", dict(color="#6a4e3e", color2="#3d2c22"), 5, "#8a3d1a",
                     (1.3, 1.1, 1.0))


def build_node_mithril(args):
    """Mithril outcrop: pale grey-blue rock, pale blue-silver shimmering crystalline chunks (faint glow)."""
    return _ore_node("node_mithril", args, "mithril", dict(color="#7d8590", color2="#4d535c"), 8, "#bcd8f0",
                     (1.3, 1.1, 1.0))


def build_node_crystal(args):
    """Magenta crystal cluster (≈1.5 m) bursting from a dark rock: big emissive prisms + small scattered shards."""
    rock = host_rock("NodeRock", seed=11, color="#4a4650", color2="#2c2a31")
    parts = [((0.0, 0.0, 0.12), (0.7, 0.6, 0.4)), ((0.3, 0.3, 0.1), (0.4, 0.35, 0.3)),
             ((-0.35, 0.2, 0.05), (0.35, 0.4, 0.25))]
    high, low = boulder_pair("Rock", parts, rock, 2200, voxel=0.012, cuts=6, disp=0.05, seed=11)
    cry = M.crystal("CrystalMagenta", color="#ff3fd2", glow=0.85, seed=4, emit_strength=5.0)
    cry["kit_group"] = "GlowCrystal"
    rnd = random.Random(4)
    prisms = []
    spec = [(0, 0, 1.45, 0.17, 0, 0), (0.18, 0.1, 1.0, 0.12, 24, 40), (-0.2, 0.08, 1.1, 0.13, 26, 150),
            (0.05, -0.2, 0.85, 0.11, 30, 260), (-0.1, 0.25, 0.8, 0.1, 35, 100), (0.28, -0.12, 0.6, 0.09, 42, 320),
            (-0.3, -0.15, 0.65, 0.09, 40, 210), (0.12, 0.3, 0.55, 0.08, 45, 70)]
    for k, (x, y, h, r, tilt, az) in enumerate(spec):
        p = prism(f"Prism{k}", r, h, cry, seed=k)
        p.rotation_euler = (math.radians(tilt), 0, math.radians(az))
        p.location = (x, y, 0.3)
        pk.C.apply_transforms(p)
        prisms.append(p)
    cluster = pk.join(prisms, "Crystals")
    shard = prism("_Shard", 0.03, 0.18, cry, seed=9)
    shards = pk.dup(low, "Shards")
    gn.scatter(shards, shard, density=10.0, seed=6, up_min=0.3, scale=(0.6, 1.4), rot_random=(0.5, 0.5, 3.14),
               embed=0.02, keep_target=False, distance_min=0.1, name="ShardScatter")
    gn.apply(shards)
    gn.remove(shard)
    cr = pk.join([cluster, shards], "Crystals")
    cr["kit_bake_direct"] = 1
    gn.store_up_mask(high, "moss", lo=0.75, hi=0.95, noise_scale=2.0, seed=2)
    gn.apply(high)
    return pk.finish("node_crystal", [low, cr], args, high=high, budget="prop", expected=(1.4, 1.3, 1.6), size=1024,
                     extrusion=0.04, max_ray=0.15, open_ok=True, group_sizes={"GlowCrystal": 512})


# =============================================================================== herbs
def herb_material(name, stem="#3f5a2a", leaf="#5d7a3a", leaf2="#8aa35a", petal="#6fb0ff", petal2="#dff2ff",
                  core="#ffe9a0", emit=None, emit_strength=1.5, frost=0.0, seed=0):
    """One wind material ('Foliage*') for a whole herb. Part attributes written by the geometry:
    'petal' (1 on petals), 'core' (1 on flower hearts), 'tint' (0..1 per leaf, colour variation), 'grad' (0 at
    the base of a leaf/petal -> 1 at its tip)."""
    m, nb, bsdf = M._new(name, "herb")
    attr = lambda n: M._attr(nb, n)
    tint, grad, pet, cor = attr("tint"), attr("grad"), attr("petal"), attr("core")
    tc = nb.node("ShaderNodeTexCoord").outputs["Object"]
    vein = nb.maprange(nb.noise(nb.vmath("SCALE", tc, scale=60.0), 1.0, 3.0).outputs["Fac"], 0.45, 0.6, 0.0, 0.25)
    lcol = nb.mix(nb.mix(stem, leaf, nb.maprange(grad, 0.0, 0.35)), leaf2, nb.mul(tint, 0.8))
    lcol = nb.mix(lcol, "#1c2410", vein)
    if frost > 0:                            # frosted tips / edges
        lcol = nb.mix(lcol, "#dbe9f2", nb.mul(nb.maprange(grad, 0.55, 1.0), frost))
    pcol = nb.mix(petal, petal2, nb.maprange(grad, 0.1, 1.0))
    col = nb.mix(lcol, pcol, pet)
    col = nb.mix(col, core, cor)
    rough = nb.mixf(0.55, 0.4, pet)
    h = nb.mul(nb.noise(nb.vmath("SCALE", tc, scale=40.0), 1.0, 4.0).outputs["Fac"], 0.3)
    emission = None
    if emit:
        emission = nb.mix((0, 0, 0, 1), emit, nb.clamp01(nb.add(nb.mul(pet, nb.maprange(grad, 0.0, 1.0, 1.0, 0.35)),
                                                                   cor)))
    return M._finish(m, nb, bsdf, col, rough, h, bump=0.4, bump_dist=0.002, vec=tc, emission=emission,
                     emit_strength=emit_strength if emit else 1.0, sss=0.1, spec=0.4)


def _blade(name, length, width, mat, curl=0.25, segs=6, thick=0.004, attrs=None, shape="leaf", cup=0.25, cols=5):
    """Closed thin blade along +Z (leaf / petal): lens outline, curled forward (+Y), cupped across. Writes the
    'grad' attribute (0 base -> 1 tip) and constant attrs."""
    verts, faces, grad = [], [], []
    for j in range(segs + 1):
        t = j / segs
        if shape == "leaf":
            w = width * math.sin(math.pi * min(1.0, t * 1.05)) ** 0.8 + 0.002
        elif shape == "petal":
            w = width * (math.sin(math.pi * (0.15 + 0.85 * t)) ** 0.6) * (0.4 + 0.6 * t) + 0.002
        else:                                 # "spike": thin tapering
            w = width * (1 - t) + 0.001
        z = length * t
        yb = curl * length * t * t
        for i in range(cols):
            u = (i / (cols - 1)) * 2 - 1
            x = u * w
            y = yb + cup * w * u * u
            verts.append((x, y, z))
            grad.append(t)
    top = len(verts)
    for k in range(top):
        x, y, z = verts[k]
        verts.append((x, y - thick, z))
        grad.append(grad[k])
    for j in range(segs):
        for i in range(cols - 1):
            a = j * cols + i
            faces.append((a, a + 1, a + cols + 1, a + cols))
            faces.append((top + a, top + a + cols, top + a + cols + 1, top + a + 1))
    for j in range(segs):                     # side walls
        a, b = j * cols, (j + 1) * cols
        faces.append((a, b, top + b, top + a))
        a, b = j * cols + cols - 1, (j + 1) * cols + cols - 1
        faces.append((a, top + a, top + b, b))
    faces.append(tuple(top + i for i in range(cols)) + tuple(reversed(range(cols))))
    ob = pk.mesh_obj(name, verts, faces, mat, smooth=True)
    pk.clean(ob, dist=1e-5)
    _store(ob, "grad", [grad[v.index] if v.index < len(grad) else 0.0 for v in ob.data.vertices])
    for k, val in (attrs or {}).items():
        _store(ob, k, [val] * len(ob.data.vertices))
    return ob


def _store(ob, name, values):
    at = ob.data.attributes.get(name) or ob.data.attributes.new(name, "FLOAT", "POINT")
    at.data.foreach_set("value", values)


def flower_head(name, kind, mat, size, seed=0):
    """kind 'star' (5 open petals), 'bell' (6 petals cupped down), 'spike' (stacked florets)."""
    rnd = random.Random(seed)
    parts = []
    if kind == "spike":
        for k in range(9):
            t = k / 8
            a = k * 2.4
            p = _blade(f"{name}F{k}", size * (0.5 - 0.3 * t), size * 0.18, mat, curl=0.1, segs=2, cup=0.3,
                       attrs={"petal": 1.0}, shape="petal", cols=3)
            p.rotation_euler = (math.radians(60 - 20 * t), 0, a)
            p.location = (0, 0, size * 2.0 * t)
            pk.C.apply_transforms(p)
            parts.append(p)
        core = pk.C.sphere(f"{name}Core", r=size * 0.05, segments=6, rings=4, mat=mat, loc=(0, 0, size * 2.1))
    else:
        n = 5 if kind == "star" else 6
        tilt = 70 if kind == "star" else 150
        for k in range(n):
            a = 2 * math.pi * k / n + rnd.uniform(-0.1, 0.1)
            p = _blade(f"{name}P{k}", size, size * 0.42, mat, curl=0.15 if kind == "star" else -0.25, segs=3, cup=0.35,
                       attrs={"petal": 1.0}, shape="petal", cols=4)
            p.rotation_euler = (math.radians(tilt + rnd.uniform(-8, 8)), 0, a + math.pi / 2)
            pk.C.apply_transforms(p)
            parts.append(p)
        core = pk.C.sphere(f"{name}Core", r=size * 0.2, segments=8, rings=6, mat=mat, loc=(0, 0, 0.0))
        core.scale = (1, 1, 0.6)
    pk.C.apply_transforms(core)
    _store(core, "core", [1.0] * len(core.data.vertices))
    _store(core, "grad", [1.0] * len(core.data.vertices))
    parts.append(core)
    return pk.join(parts, name)


def build_herb(key, args, *, mat, n_stems, stem_h, flower, fsize, leaves, leaf_len, leaf_w, leaf_curl, seed,
               expected, leaf_shape="leaf", n_leaves=16, droop=0.35):
    rnd = random.Random(seed)
    mud = M.mud("Soil", color="#3a2f24", seed=seed, wet=0.35)
    stone = M.rock("Pebble", color="#6a665f", color2="#4b4843", scale=6.0, seed=seed, moss=0.4)
    objs = []
    # soil mound + pebbles (rigid, not swaying)
    mr = [pk.ring(24, 0.42 * f, z=z) for z, f in ((-0.03, 1.0), (0.04, 0.85), (0.08, 0.5), (0.09, 0.1))]
    mound = pk.loft("Mound", mr, mud)
    gn.displace(mound, strength=0.02, scale=6.0, detail=3, voronoi=0.0, seed=seed, subdiv=1)
    gn.apply(mound)
    pk.delete_bottom(mound, z=0.0)
    objs.append(mound)
    peb = chunk_tpl("_Pebble", 0.05, stone, seed, cuts=4, stretch=(1.2, 1.0, 0.6))
    pk.smooth_all(peb, True)
    pts = []
    for k in range(6):
        a = rnd.uniform(0, 6.28)
        r = rnd.uniform(0.28, 0.46)
        pts.append((math.cos(a) * r, math.sin(a) * r, 0.02))
    po = gn.points_object(pts, [(0, 0, 1)] * len(pts), name="PebblePts")
    gn.instance_on_points(po, peb, scale=(0.7, 1.5), rot_random=(0.2, 0.2, 3.14), seed=seed, name="PebbleOn")
    pebbles = gn.apply(po)
    objs.append(pebbles)
    gn.remove(peb)
    # stems: GN curve sweeps; flower heads instanced at their tips
    splines, tips = [], []
    for k in range(n_stems):
        a = 2 * math.pi * k / n_stems + rnd.uniform(-0.4, 0.4)
        lean = rnd.uniform(0.15, 0.35)
        h = stem_h * rnd.uniform(0.75, 1.1)
        p = []
        for j in range(6):
            t = j / 5
            r = lean * h * t * t * 0.6 + 0.02
            p.append((math.cos(a) * r, math.sin(a) * r, 0.05 + h * t, 1.0 - 0.5 * t))
        splines.append(p)
        d = V(p[-1][:3]) - V(p[-2][:3])
        tips.append((p[-1][:3], tuple(d.normalized())))
    cu = gn.make_curve(splines, name="Stems", kind="NURBS")
    gn.curve_to_mesh(cu, radius=0.012, profile_res=6, material=mat)
    stems = gn.apply(cu)
    _store(stems, "grad", [0.0] * len(stems.data.vertices))
    objs.append(stems)
    head = flower_head("_Head", flower, mat, fsize, seed)
    hp = gn.points_object([t[0] for t in tips], [t[1] for t in tips], name="HeadPts")
    gn.instance_on_points(hp, head, scale=(0.8, 1.2), rot_random=(0.15, 0.15, 3.14), seed=seed + 1, name="HeadsOn")
    heads = gn.apply(hp)
    objs.append(heads)
    gn.remove(head)
    # rosette of leaves at the base (+ a few up the stems): GN instances on points aligned to 'dir'
    lpts, ldirs = [], []
    for k in range(n_leaves):
        a = k * 2.39996 + rnd.uniform(-0.2, 0.2)
        el = rnd.uniform(0.35, 0.9) if k % 3 else rnd.uniform(0.2, 0.45)
        d = V((math.cos(a) * math.sin(el * 1.2 + droop), math.sin(a) * math.sin(el * 1.2 + droop), math.cos(el * 1.2 + droop)))
        lpts.append((math.cos(a) * 0.03, math.sin(a) * 0.03, 0.06 + rnd.uniform(0, 0.05)))
        ldirs.append(tuple(d.normalized()))
    for k, sp in enumerate(splines):                  # stem leaves
        for f in (0.35, 0.6):
            j = int(f * 5)
            p = sp[j]
            a = rnd.uniform(0, 6.28)
            lpts.append(p[:3])
            ldirs.append(tuple(V((math.cos(a), math.sin(a), 0.9)).normalized()))
    lo = gn.points_object(lpts, ldirs, name="LeafPts")
    lts = []
    for v in range(3):
        b = _blade(f"_Leaf{v}", leaf_len * (0.8 + 0.2 * v), leaf_w, mat, curl=leaf_curl, segs=5, cup=0.3,
                   attrs={"tint": v / 2.0}, shape=leaf_shape, cols=4)
        lts.append(b)
    gn.instance_on_points(lo, lts, scale=(0.55, 1.1), rot_random=(0.1, 0.1, 3.14), seed=seed + 2, name="LeavesOn")
    lv = gn.apply(lo)
    objs.append(lv)
    gn.remove_templates()
    return pk.finish(key, objs, args, budget="prop", expected=expected, size=512, open_ok=True, ao_distance=0.15,
                     group_sizes={mat.name: 1024})


def build_node_herb_brume(args):
    """Brume herb: silvery mint-green curling leaves and pale misty flower spikes that glow faintly."""
    mat = herb_material("FoliageHerbBrume", stem="#46603f", leaf="#7fa48a", leaf2="#b9d3bf", petal="#c9f2dc",
                        petal2="#f2fff8", core="#e9fff2", emit="#8dffc8", emit_strength=0.9, seed=1)
    return build_herb("node_herb_brume", args, mat=mat, n_stems=7, stem_h=0.85, flower="spike", fsize=0.11,
                      leaves=True, leaf_len=0.42, leaf_w=0.07, leaf_curl=0.55, seed=21, expected=(1.0, 1.0, 1.05),
                      n_leaves=18, droop=0.55)


def build_node_herb_givre(args):
    """Givre herb: frost-edged blue-grey leaves and frost-blue star flowers (faint cold glow)."""
    mat = herb_material("FoliageHerbGivre", stem="#3f5a55", leaf="#5e7f84", leaf2="#9fbcc4", petal="#5aa8ff",
                        petal2="#e3f4ff", core="#ffffff", emit="#7cc4ff", emit_strength=1.0, frost=0.8, seed=2)
    return build_herb("node_herb_givre", args, mat=mat, n_stems=6, stem_h=0.8, flower="star", fsize=0.09,
                      leaves=True, leaf_len=0.36, leaf_w=0.06, leaf_curl=0.35, seed=31, expected=(1.0, 1.0, 1.0),
                      n_leaves=16, droop=0.4)


def build_node_herb_braise(args):
    """Braise herb: dark red-green leaves and ember-red bell flowers with glowing orange hearts."""
    mat = herb_material("FoliageHerbBraise", stem="#40301f", leaf="#4d4a26", leaf2="#7a3a22", petal="#c4210e",
                        petal2="#ff7a26", core="#ffd060", emit="#ff4a10", emit_strength=1.6, seed=3)
    return build_herb("node_herb_braise", args, mat=mat, n_stems=6, stem_h=0.9, flower="bell", fsize=0.1,
                      leaves=True, leaf_len=0.38, leaf_w=0.08, leaf_curl=0.3, seed=41, expected=(1.0, 1.0, 1.05),
                      n_leaves=16, droop=0.35)


BUILDERS = {
    "node_copper": build_node_copper,
    "node_iron": build_node_iron,
    "node_mithril": build_node_mithril,
    "node_crystal": build_node_crystal,
    "node_herb_brume": build_node_herb_brume,
    "node_herb_givre": build_node_herb_givre,
    "node_herb_braise": build_node_herb_braise,
}
