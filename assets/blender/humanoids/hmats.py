"""Materials of the humanoids group: kit.materials presets + a few custom node graphs (tattered alpha cloth,
ghostly robe, feathers, glowing eyes). Everything is procedural (shader nodes) and baked by kit.bake."""
import bpy

from kit import materials as M
from kit.materials import _finish, _new, coords, cavity_mask
from kit.nodes import NB, sock


def _bsdf(m):
    return next(n for n in m.node_tree.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled")


def tatter(m, z_lo, z_hi, scale=1.0, holes=0.0, seed=0, strands=1.0, cutoff=0.5):
    """Add an alpha-MASK tatter to a material: ragged vertical tears below z_hi (fully cut below z_lo) + moth holes.
    Uses OBJECT coordinates (= rest-pose metres for our unparented, identity-transform meshes)."""
    nb = NB(m.node_tree)
    b = _bsdf(m)
    tc = nb.node("ShaderNodeTexCoord").outputs["Object"]
    v = nb.vmath("ADD", tc, (seed * 3.1, seed * 1.7, seed * 0.3))
    sep = nb.sep(tc)
    # vertical strands: noise stretched along Z
    strand = nb.noise(nb.vmath("MULTIPLY", v, (14.0 * scale, 14.0 * scale, 1.6 * scale)), 1.0, 4.0, 0.6).outputs["Fac"]
    fine = nb.noise(nb.vmath("MULTIPLY", v, (40.0 * scale, 40.0 * scale, 9.0 * scale)), 1.0, 3.0, 0.5).outputs["Fac"]
    h = nb.maprange(sep[2], z_lo, z_hi, 0.0, 1.0)
    a = nb.add(nb.mul(h, 1.25), nb.mul(nb.sub(strand, 0.5), 1.3 * strands))
    a = nb.add(a, nb.mul(nb.sub(fine, 0.5), 0.35))
    alpha = nb.math("GREATER_THAN", a, 0.5)
    if holes > 0:
        vo = nb.voronoi(nb.vmath("SCALE", v, scale=9.0 * scale), 1.0, "F1").outputs["Distance"]
        hm = nb.noise(nb.vmath("SCALE", v, scale=2.0), 1.0, 2.0).outputs["Fac"]
        hole = nb.mul(nb.math("LESS_THAN", vo, 0.05 + 0.18 * holes), nb.math("GREATER_THAN", hm, 0.62 - 0.12 * holes))
        alpha = nb.mul(alpha, nb.sub(1.0, hole))
    nb.feed(sock(b.inputs, "Alpha"), alpha)
    # darken + fray the colour close to the torn edges
    col_in = sock(b.inputs, "Base Color")
    if col_in.is_linked:
        prev = col_in.links[0].from_socket
        edge = nb.maprange(a, 0.5, 0.75, 1.0, 0.0)
        nb.feed(col_in, nb.mix(prev, "#141110", nb.mul(edge, 0.6)))
    m["kit_alpha"] = 1
    m["kit_alpha_cutoff"] = cutoff
    try:
        m.surface_render_method = "DITHERED"
    except Exception:
        pass
    return m


def glow(name="Glow_Eyes", color="#7dffb0", strength=12.0):
    return M.emissive(name, color, strength)


def feather(name="Feather", color="#2a2622", tip="#b8b0a0", band="#6a2a1a", seed=0):
    """Feather vane: barbs along the local length (object X), dark shaft line, coloured bands."""
    m, nb, bsdf = _new(name, "feather")
    v = coords(nb, "OBJECT", 1.0, seed)
    s = nb.sep(nb.node("ShaderNodeTexCoord").outputs["UV"])
    barbs = nb.noise(nb.vmath("MULTIPLY", v, (8.0, 260.0, 260.0)), 1.0, 2.0, 0.5).outputs["Fac"]
    bands = nb.wave(v, 6.0, 2.0, 1.0, "BANDS", "X").outputs["Fac"]
    col = nb.mix(color, band, nb.mul(nb.maprange(bands, 0.55, 0.75), 0.8))
    col = nb.mix(col, tip, nb.maprange(nb.noise(nb.vmath("SCALE", v, scale=3.0), 1.0, 2.0).outputs["Fac"], 0.6, 0.8))
    col = nb.mix(col, "#0d0b09", nb.mul(barbs, 0.35))
    return _finish(m, nb, bsdf, col, 0.7, nb.mul(barbs, 0.4), bump=0.6, bump_dist=0.001, spec=0.35)


def ghost_robe(name="Cloth_Wraith", color="#1b1f26", glow_col="#5fd6c0", seed=0, z_lo=0.02, z_hi=0.55):
    """Wraith robe: near-black cloth with bluish sheen, faint emissive wisps growing towards the torn hem."""
    m = M.cloth(name, color=color, kind="linen", seed=seed, dirt=0.6, wear=0.2, hem_dirt=0.0)
    nb = NB(m.node_tree)
    b = _bsdf(m)
    tc = nb.node("ShaderNodeTexCoord").outputs["Object"]
    z = nb.sep(tc)[2]
    wisp = nb.noise(nb.vmath("MULTIPLY", tc, (5.0, 5.0, 1.2)), 1.0, 5.0, 0.6, dist=0.6).outputs["Fac"]
    em = nb.mul(nb.maprange(z, z_hi + 0.4, z_lo, 0.0, 1.0), nb.maprange(wisp, 0.5, 0.8))
    nb.feed(sock(b.inputs, "Emission Color"), nb.mix((0, 0, 0), glow_col, em))
    sock(b.inputs, "Emission Strength").default_value = 2.5
    m["kit_emissive"] = 1
    return tatter(m, z_lo, z_hi, 1.2, holes=0.6, seed=seed, strands=1.4)


def bone_cracked(name="Bone", color="#c4b393", seed=0, dirt=0.85, grime="#4a3b28"):
    """Old bone: kit bone + extra dark hairline cracks and grime streaks (cracked skeleton look)."""
    m = M.bone(name, color=color, seed=seed, dirt=dirt, bump=1.3)
    nb = NB(m.node_tree)
    b = _bsdf(m)
    v = coords(nb, "OBJECT", 1.0, seed + 5)
    cr = nb.voronoi(nb.vmath("MULTIPLY", v, (9, 9, 3)), 1.0, "DISTANCE_TO_EDGE").outputs["Distance"]
    crm = nb.mul(nb.maprange(cr, 0.0, 0.012, 1.0, 0.0),
                 nb.maprange(nb.noise(nb.vmath("SCALE", v, scale=4.0), 1.0, 3.0).outputs["Fac"], 0.5, 0.6))
    streak = nb.noise(nb.vmath("MULTIPLY", v, (30, 30, 3)), 1.0, 4.0, 0.6).outputs["Fac"]
    col_in = sock(b.inputs, "Base Color")
    prev = col_in.links[0].from_socket
    col = nb.mix(prev, "#1c140c", nb.mul(crm, 0.9))
    col = nb.mix(col, grime, nb.mul(nb.maprange(streak, 0.55, 0.8), 0.45))
    nb.feed(col_in, col)
    nin = sock(b.inputs, "Normal")
    if nin.is_linked:
        bump_node = nin.links[0].from_node
        hin = sock(bump_node.inputs, "Height")
        hprev = hin.links[0].from_socket if hin.is_linked else 0.5
        nb.feed(hin, nb.sub(hprev, nb.mul(crm, 0.6)))
    return m


def skin(name, kind, color, seed=0, moss=0.0, veins=0.0):
    m = M.skin(name, kind, color=color, seed=seed, bump=1.4, dirt=0.4)
    if veins or moss:
        nb = NB(m.node_tree)
        b = _bsdf(m)
        v = coords(nb, "OBJECT", 1.0, seed + 9)
        col_in = sock(b.inputs, "Base Color")
        prev = col_in.links[0].from_socket
        if veins:
            vn = nb.voronoi(nb.vmath("SCALE", v, scale=14.0), 1.0, "DISTANCE_TO_EDGE").outputs["Distance"]
            vm = nb.mul(nb.maprange(vn, 0.0, 0.02, 1.0, 0.0), veins)
            prev = nb.mix(prev, "#3b3a4a", nb.mul(vm, 0.5))
        if moss:
            cav = cavity_mask(nb, 0.05)
            mn = nb.noise(nb.vmath("SCALE", v, scale=5.0), 1.0, 6.0, 0.6).outputs["Fac"]
            mm = nb.mul(nb.maprange(mn, 0.55, 0.7), nb.add(0.4, nb.mul(cav, 0.6)))
            prev = nb.mix(prev, "#3a4420", nb.mul(mm, moss))
        nb.feed(col_in, prev)
    return m


# thin wrappers so builds read nicely
leather = M.leather
cloth = M.cloth
metal = M.metal
engraved = M.engraved_metal
wood = M.wood
bark = M.bark
fur = M.fur
moss = M.moss
crystal = M.crystal
magic = M.magic
emissive = M.emissive
rock = M.rock
