"""Props-group procedural materials (shader nodes, baked by kit.bake). Built with the kit's NB builder and the
kit material scaffolding (M._new / M._finish), so dirt / wear / moss layers behave exactly like kit materials."""
import pk
from pk import M, NB, sock

_new, _finish, coords, _pal = M._new, M._finish, M.coords, M._pal


def aldmar_stone(name="AldmarStone", seed=0, moss=0.55, color="#8d887b", color2="#5f5b52", streaks=0.55):
    """Pale grey-ochre limestone of Aldmar, darkened by age: run-off streaks, earth splash, lichen + moss."""
    m = M.rock(name, color=color, color2=color2, strata=0.25, scale=0.8, seed=seed, dirt=0.75, wear=0.18, moss=moss,
               lichen=0.45)
    pk.overlay_streaks(m, "#3a352c", streaks, 1.0, seed)
    pk.overlay_ground_dirt(m, "#3d3526", 0.7, 0.6, seed)
    return m


def sandstone(name="Sandstone", seed=0):
    m = M.rock(name, color="#c7a57a", color2="#9c7a52", strata=0.9, scale=0.9, seed=seed, dirt=0.55, wear=0.25,
               moss=0.0, lichen=0.08)
    pk.overlay_streaks(m, "#6e5236", 0.35, 0.8, seed)
    pk.overlay_ground_dirt(m, "#b89464", 0.9, 0.55, seed)     # sand dust at the foot
    return m


def _face_uv(nb, v):
    """Planar coords on the face the shading normal points to: (u = across, w = z)."""
    geo = nb.node("ShaderNodeNewGeometry")
    tc = nb.node("ShaderNodeTexCoord").outputs["Object"]
    s = nb.sep(tc)
    n = nb.sep(nb.node("ShaderNodeVectorTransform", {"vector_type": "NORMAL", "convert_from": "WORLD",
                                                      "convert_to": "OBJECT"}, Vector=geo.outputs["Normal"]).outputs[0])
    fx = nb.math("GREATER_THAN", nb.math("ABSOLUTE", n[0]), nb.math("ABSOLUTE", n[1]))
    u = nb.mixf(s[0], s[1], fx)
    return u, s[2], n


def rune_stone(name="RuneStone", glow="#ffb54a", strength=6.0, seed=0, u_half=0.17, z0=1.05, z1=3.6, cell=0.13,
               color="#5a5a5c", color2="#38383b"):
    """Dark weathered stone with carved rune columns on every face (glyph strokes glow: emission)."""
    m = M.rock(name, color=color, color2=color2, strata=0.15, scale=0.9, seed=seed, dirt=0.7, wear=0.2, moss=0.35,
               lichen=0.35)
    pk.overlay_streaks(m, "#1e1c1a", 0.5, 1.0, seed)
    nb = NB(m.node_tree)
    bsdf = pk._bsdf(m)
    u, z, n = _face_uv(nb, None)
    side = nb.math("LESS_THAN", nb.math("ABSOLUTE", n[2]), 0.5)
    band = nb.mul(nb.mul(nb.math("LESS_THAN", nb.math("ABSOLUTE", u), u_half), side),
                  nb.mul(nb.math("GREATER_THAN", z, z0), nb.math("LESS_THAN", z, z1)))
    gv = nb.xyz(nb.math("DIVIDE", nb.add(u, u_half), cell), nb.math("DIVIDE", z, cell * 1.25), float(seed))
    rm = nb.mul(M._rune_mask(nb, gv), band)
    # border lines framing the column
    edge = nb.mul(nb.maprange(nb.math("ABSOLUTE", nb.sub(nb.math("ABSOLUTE", u), u_half + 0.03)), 0.012, 0.004),
                  nb.mul(side, nb.mul(nb.math("GREATER_THAN", z, z0 - 0.05), nb.math("LESS_THAN", z, z1 + 0.05))))
    carve = nb.math("MAXIMUM", rm, nb.mul(edge, 0.8))
    bc = sock(bsdf.inputs, "Base Color")
    nb.feed(bc, nb.mix(pk._input_src(nb, bc), "#1a1410", carve))
    flick = nb.maprange(nb.noise(nb.xyz(z, u, 3.0), 3.0, 2.0).outputs["Fac"], 0.3, 0.7, 0.55, 1.0)
    nb.feed(sock(bsdf.inputs, "Emission Color"), nb.mix((0, 0, 0, 1), glow, nb.mul(rm, flick)))
    sock(bsdf.inputs, "Emission Strength").default_value = strength
    m["kit_emissive"] = 1
    # carve the glyphs into the relief: subtract from the bump height
    nrm = sock(bsdf.inputs, "Normal")
    if nrm.is_linked:
        bump = nrm.links[0].from_node
        hs = sock(bump.inputs, "Height")
        nb.feed(hs, nb.sub(pk._input_src(nb, hs), nb.mul(carve, 0.6)))
    return m


def grave_stone(name="GraveStone", seed=0):
    """Dark weathered headstone: sun-cross relief + worn epitaph lines engraved on the front (-Y) face."""
    m = M.rock(name, color="#77766f", color2="#4d4c47", strata=0.1, scale=1.4, seed=seed, dirt=0.8, wear=0.25,
               moss=0.5, lichen=0.6)
    pk.overlay_streaks(m, "#2a2824", 0.6, 1.6, seed)
    nb = NB(m.node_tree)
    bsdf = pk._bsdf(m)
    tc = nb.node("ShaderNodeTexCoord").outputs["Object"]
    s = nb.sep(tc)
    x, z = s[0], s[2]
    geo = nb.node("ShaderNodeNewGeometry")
    ny = nb.sep(nb.node("ShaderNodeVectorTransform", {"vector_type": "NORMAL", "convert_from": "WORLD",
                                                       "convert_to": "OBJECT"}, Vector=geo.outputs["Normal"]).outputs[0])[1]
    front = nb.math("LESS_THAN", ny, -0.6)
    cz = 0.8
    dx, dz = x, nb.sub(z, cz)
    r = nb.math("SQRT", nb.add(nb.mul(dx, dx), nb.mul(dz, dz)))
    ring = nb.maprange(nb.math("ABSOLUTE", nb.sub(r, 0.12)), 0.018, 0.008)
    barv = nb.mul(nb.maprange(nb.math("ABSOLUTE", dx), 0.024, 0.014), nb.math("LESS_THAN", nb.math("ABSOLUTE", dz), 0.22))
    barh = nb.mul(nb.maprange(nb.math("ABSOLUTE", dz), 0.024, 0.014), nb.math("LESS_THAN", nb.math("ABSOLUTE", dx), 0.2))
    cross = nb.math("MAXIMUM", ring, nb.math("MAXIMUM", barv, barh))
    lines = None
    for k, (lz, lw) in enumerate(((0.52, 0.2), (0.44, 0.24), (0.36, 0.16))):
        ln = nb.mul(nb.maprange(nb.math("ABSOLUTE", nb.sub(z, lz)), 0.016, 0.008),
                    nb.math("LESS_THAN", nb.math("ABSOLUTE", x), lw))
        # broken, worn letters: chop the line with noise
        chop = nb.maprange(nb.noise(nb.xyz(nb.mul(x, 30.0), float(k), 0.0), 1.0, 2.0).outputs["Fac"], 0.42, 0.5)
        ln = nb.mul(ln, chop)
        lines = ln if lines is None else nb.math("MAXIMUM", lines, ln)
    carve = nb.mul(nb.math("MAXIMUM", cross, nb.mul(lines, 0.8)), front)
    wearn = nb.maprange(nb.noise(nb.vmath("SCALE", tc, scale=9.0), 1.0, 3.0).outputs["Fac"], 0.3, 0.6, 0.35, 1.0)
    carve = nb.mul(carve, wearn)
    bc = sock(bsdf.inputs, "Base Color")
    nb.feed(bc, nb.mix(pk._input_src(nb, bc), "#24211c", nb.mul(carve, 0.7)))
    nrm = sock(bsdf.inputs, "Normal")
    if nrm.is_linked:
        hs = sock(nrm.links[0].from_node.inputs, "Height")
        nb.feed(hs, nb.sub(pk._input_src(nb, hs), nb.mul(carve, 0.5)))
    return m


def charred_wood(name="CharredWood", seed=0, ember="#ff5a14", ember_strength=3.0, axis="Z"):
    """Burnt log: black alligator-cracked charcoal, grey ash on top, glowing embers in the cracks (emission)."""
    m, nb, bsdf = _new(name, "charred_wood")
    v = coords(nb, "OBJECT", 1.0, seed)
    st = {"X": (1.0, 4.0, 4.0), "Y": (4.0, 1.0, 4.0), "Z": (4.0, 4.0, 1.0)}[axis]
    cells = nb.voronoi(nb.vmath("MULTIPLY", v, tuple(x * 9.0 for x in st)), 1.0, "DISTANCE_TO_EDGE").outputs["Distance"]
    crack = nb.maprange(cells, 0.0, 0.06, 1.0, 0.0)
    fine = nb.noise(nb.vmath("SCALE", v, scale=30.0), 1.0, 6.0, 0.6).outputs["Fac"]
    col = _pal(nb, fine, ["#0b0908", "#1d1a17", "#2b2622"])
    ash = nb.mul(M.up_mask(nb, 0.3, 0.8), nb.maprange(nb.noise(nb.vmath("SCALE", v, scale=6.0), 1.0, 4.0).outputs["Fac"], 0.4, 0.6))
    col = nb.mix(col, "#8a857c", nb.mul(ash, 0.8))
    glowm = nb.mul(crack, nb.maprange(nb.noise(nb.vmath("SCALE", v, scale=3.0), 1.0, 3.0).outputs["Fac"], 0.45, 0.6))
    glowm = nb.mul(glowm, nb.sub(1.0, ash))
    col = nb.mix(col, "#3a0e02", glowm)
    emis = nb.mix((0, 0, 0, 1), ember, glowm)
    h = nb.sub(nb.add(nb.mul(nb.maprange(cells, 0.0, 0.2), 0.6), nb.mul(fine, 0.2)), nb.mul(crack, 0.4))
    rough = nb.mixf(0.9, 0.97, ash)
    return _finish(m, nb, bsdf, col, rough, h, bump=1.0, bump_dist=0.01, dirt=0.3, vec=v, emission=emis,
                   emit_strength=ember_strength)


def flame(name="FireGlow", seed=0):
    """Emissive flame tongues: white-yellow core at the base, orange then deep red at the tips (object Z)."""
    m, nb, bsdf = _new(name, "flame", group=name)
    tc = nb.node("ShaderNodeTexCoord").outputs["Object"]
    z = nb.sep(tc)[2]
    n = nb.noise(nb.vmath("MULTIPLY", tc, (6.0, 6.0, 2.5)), 1.0, 3.0, 0.6).outputs["Fac"]
    t = nb.clamp01(nb.add(nb.maprange(z, 0.15, 1.05), nb.mul(nb.sub(n, 0.5), 0.35)))
    col = _pal(nb, t, ["#fff1b0", "#ffc43a", "#ff7a14", "#c22a06"], [0.0, 0.3, 0.65, 1.0])
    return _finish(m, nb, bsdf, nb.mix(col, "#000000", 0.3), 0.6, None, emission=col, emit_strength=7.0)


def hide(name="HideTent", seed=0):
    """Patched, stitched animal hides (goblin tent): irregular mismatched leather panels (noise-warped voronoi),
    dark sinew seams with small stitches, a few furry patches, water stains, soot towards the smoke hole."""
    m, nb, bsdf = _new(name, "hide")
    v = coords(nb, "OBJECT", 1.0, seed)
    warp = nb.noise(nb.vmath("SCALE", v, scale=1.3), 1.0, 3.0, 0.5).outputs["Color"]
    pv = nb.vmath("ADD", nb.vmath("MULTIPLY", v, (1.25, 1.25, 1.05)), nb.vmath("SCALE", warp, scale=0.55))
    vo = nb.voronoi(pv, 1.0, "F1", rand=1.0)
    per = nb.bw(vo.outputs["Color"])
    ed = nb.voronoi(pv, 1.0, "DISTANCE_TO_EDGE").outputs["Distance"]
    seam = nb.maprange(ed, 0.0, 0.018, 1.0, 0.0)
    stitch_line = nb.maprange(nb.math("ABSOLUTE", nb.sub(ed, 0.03)), 0.006, 0.002)
    dots = nb.maprange(nb.math("SINE", nb.mul(nb.add(nb.sep(v)[0], nb.add(nb.sep(v)[1], nb.sep(v)[2])), 150.0)),
                       0.3, 0.9)
    stitch = nb.mul(stitch_line, dots)
    peb = nb.voronoi(nb.vmath("SCALE", v, scale=90.0), 1.0).outputs["Distance"]
    wr = nb.noise(nb.vmath("MULTIPLY", v, (5, 5, 14)), 1.0, 6.0, 0.6, dist=0.6).outputs["Fac"]
    wrinkle = nb.maprange(nb.math("ABSOLUTE", nb.sub(wr, 0.5)), 0.0, 0.035, 1.0, 0.0)
    col = _pal(nb, per, ["#3e2a1a", "#5a4029", "#6b5237", "#34261a", "#735c42", "#4b3421", "#5e4a36"])
    # furry patches (a third of the panels): streaky darker hair
    furm = nb.maprange(per, 0.72, 0.76)
    hair = nb.noise(nb.vmath("MULTIPLY", v, (60.0, 60.0, 8.0)), 1.0, 4.0, 0.7).outputs["Fac"]
    col = nb.mix(col, _pal(nb, hair, ["#1f1710", "#3b2b1c", "#5c4630"]), furm)
    col = nb.mix(col, "#20150c", nb.mul(wrinkle, 0.35))
    spots = nb.maprange(nb.noise(nb.vmath("SCALE", v, scale=3.0), 1.0, 5.0, 0.6).outputs["Fac"], 0.56, 0.7)
    col = nb.mix(col, "#2a1b10", nb.mul(spots, 0.45))
    z = nb.sep(nb.node("ShaderNodeTexCoord").outputs["Object"])[2]
    soot = nb.maprange(nb.add(z, nb.mul(nb.sub(wr, 0.5), 0.8)), 1.9, 2.9)
    col = nb.mix(col, "#110d0a", nb.mul(soot, 0.85))
    splash = nb.maprange(nb.add(z, nb.mul(nb.sub(wr, 0.5), 0.3)), 0.35, 0.0)
    col = nb.mix(col, "#2b2117", nb.mul(splash, 0.6))
    col = nb.mix(col, "#150e08", nb.mul(seam, 0.75))
    col = nb.mix(col, "#7c6849", nb.mul(stitch, 0.8))
    h = nb.sub(nb.add(nb.mul(peb, 0.2), 0.5), nb.add(nb.mul(wrinkle, 0.25), nb.mul(seam, 0.4)))
    h = nb.add(h, nb.add(nb.mul(stitch, 0.25), nb.mul(nb.mul(hair, furm), 0.3)))
    rough = nb.mixf(nb.maprange(peb, 0, 1, 0.6, 0.82), 0.95, furm)
    return _finish(m, nb, bsdf, col, rough, h, bump=1.0, bump_dist=0.006, dirt=0.7, wear=0.25, vec=v,
                   wear_color="#8a7456", cavity_dist=0.1, edge_radius=0.01)


def ore_metal(name, kind="copper", seed=0):
    """Raw ore chunk: metallic crystalline faces + oxidation (verdigris / rust / blue sheen)."""
    spec = {"copper": ("#c46a3a", 0.35, ["#2e6e5c", "#4f9c82", "#8cc7ad"], 0.45),
            "iron": ("#6c625c", 0.45, ["#4a1f0e", "#8a3d17", "#b3602a"], 0.5),
            "mithril": ("#cfe3f2", 0.18, ["#9fc4e6", "#dff0ff", "#7fa8d6"], 0.15)}[kind]
    base_c, r0, ox, oxa = spec
    m, nb, bsdf = _new(name, "ore_" + kind)
    v = coords(nb, "OBJECT", 1.0, seed)
    fac = nb.voronoi(nb.vmath("SCALE", v, scale=14.0), 1.0, "F1").outputs["Color"]
    facet = nb.bw(fac)
    fine = nb.noise(nb.vmath("SCALE", v, scale=40.0), 1.0, 5.0, 0.6).outputs["Fac"]
    col = nb.mix(nb.mix(base_c, "#000000", 0.35), nb.mix(base_c, "#ffffff", 0.15), facet)
    on = nb.noise(nb.vmath("SCALE", v, scale=5.0), 1.0, 6.0, 0.65).outputs["Fac"]
    cav = M.cavity_mask(nb, 0.08)
    om = nb.clamp01(nb.mul(nb.maprange(nb.add(on, nb.mul(cav, 0.4)), 0.65 - oxa * 0.3, 0.8 - oxa * 0.3), 1.0))
    col = nb.mix(col, _pal(nb, fine, ox), om)
    rough = nb.mixf(nb.add(r0, nb.mul(nb.sub(facet, 0.5), 0.15)), 0.85, om)
    metal = nb.mixf(1.0, 0.0, om)
    h = nb.add(nb.mul(facet, 0.4), nb.mul(fine, 0.2))
    emission = None
    if kind == "mithril":
        emission = nb.mix((0, 0, 0, 1), "#a8d8ff", nb.mul(nb.maprange(facet, 0.6, 0.95), 0.6))
    return _finish(m, nb, bsdf, col, rough, h, metal=metal, bump=1.0, bump_dist=0.006, dirt=0.4, wear=0.5,
                   wear_color=nb.mix(base_c, "#ffffff", 0.4), wear_rough=0.2, vec=v, cavity_dist=0.08,
                   edge_radius=0.006, emission=emission, emit_strength=1.2 if emission is not None else 1.0)
