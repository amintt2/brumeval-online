"""Custom procedural materials for the giants group, built with the shared kit's node builder
(kit.materials._new / coords / _finish, kit.nodes.NB). They end in one Principled BSDF and are baked by kit.bake.

Geometry attributes read by these shaders (written by gk.sculpt layers with "store": name):
    wart   0..1 wart / pustule domes      crack  0..1 crack grooves      clump  0..1 fur clumps / mud lumps
"""
from kit import materials as MM
from kit.nodes import sock


def _attr(nb, name):
    a = nb.node("ShaderNodeAttribute", {"attribute_type": "GEOMETRY", "attribute_name": name})
    return a.outputs["Fac"]


def _normal(nb):
    return nb.sep(nb.node("ShaderNodeNewGeometry").outputs["Normal"])


def hide(name="Hide", c1="#5a6150", c2="#383b30", belly="#8c8468", wart="#8a7c5c", scale=1.0, seed=0, bump=1.0,
         dirt=0.6, moss=0.0, back_dark=0.5, pores=220.0, veins=0.3):
    """Thick monster hide (troll, giant): mottled back, pale belly, warts (attribute 'wart'), pores, veins."""
    m, nb, bsdf = MM._new(name, "hide")
    v = MM.coords(nb, "OBJECT", scale, seed)
    big = nb.noise(nb.vmath("SCALE", v, scale=1.2), 1.0, 4.0, 0.55).outputs["Fac"]
    mott = nb.voronoi(nb.vmath("SCALE", v, scale=5.0), 1.0, "F1", rand=1.0)
    blot = nb.noise(nb.vmath("SCALE", v, scale=9.0), 1.0, 5.0, 0.6).outputs["Fac"]
    por = nb.voronoi(nb.vmath("SCALE", v, scale=pores), 1.0, "F1").outputs["Distance"]
    n = _normal(nb)
    col = MM._pal(nb, nb.add(nb.mul(big, 0.6), nb.mul(blot, 0.4)), [c2, c1, c2], [0.15, 0.55, 0.95])
    col = nb.mix(col, nb.mix(c1, "#000000", 0.4), nb.mul(nb.maprange(nb.bw(mott.outputs["Color"]), 0.55, 0.9), 0.5))
    # pale belly / inner limbs, dark sun-burnt back
    bm = nb.mul(nb.maprange(n[1], -0.2, -0.8), nb.maprange(n[2], 0.6, 0.0))
    col = nb.mix(col, belly, nb.mul(bm, 0.55))
    col = nb.mix(col, nb.mix(c2, "#000000", 0.35), nb.mul(nb.maprange(n[2], 0.3, 0.95), back_dark))
    # warts from the sculpt
    w = nb.clamp01(_attr(nb, "wart"))
    col = nb.mix(col, wart, nb.mul(nb.maprange(w, 0.2, 0.9), 0.75))
    col = nb.mix(col, nb.mix(wart, "#000000", 0.5), nb.mul(nb.maprange(w, 0.02, 0.15, 0.0, 1.0), nb.maprange(w, 0.15, 0.3, 1.0, 0.0)))
    if veins > 0:
        vn = nb.noise(nb.vmath("SCALE", v, scale=4.0), 1.0, 3.0, 0.5, dist=1.5).outputs["Fac"]
        vm = nb.maprange(nb.math("ABSOLUTE", nb.sub(vn, 0.5)), 0.0, 0.012, 1.0, 0.0)
        col = nb.mix(col, "#3b2f3a", nb.mul(vm, veins))
    h = nb.add(nb.mul(por, 0.35), nb.add(nb.mul(blot, 0.2), nb.mul(w, 0.3)))
    rough = nb.add(nb.maprange(por, 0.0, 1.0, 0.5, 0.75), nb.mul(w, 0.1))
    return MM._finish(m, nb, bsdf, col, rough, h, bump=bump, bump_dist=0.004, dirt=dirt, dirt_color="#1f1a12",
                      vec=v, cavity_dist=0.06, moss=moss, spec=0.4, wear=0.25, wear_color=nb.mix(c1, "#b9ab8a", 0.3))


def fur(name="Fur", root="#3a3632", mid="#bdb8ae", tip="#e8e4da", dirt_col="#5a4e40", scale=1.0, seed=0, bump=1.0,
        dirt=0.4, strand_dir="Z"):
    """Shaggy fur surface for the body under geometric locks: strands, clumps (attribute 'clump'), dirty roots."""
    m, nb, bsdf = MM._new(name, "gfur")
    v = MM.coords(nb, "OBJECT", scale, seed)
    st = {"Z": (60.0, 60.0, 4.0), "Y": (60.0, 4.0, 60.0)}[strand_dir]
    warp = nb.noise(nb.vmath("SCALE", v, scale=3.0), 1.0, 3.0, 0.5).outputs["Color"]
    vv = nb.vmath("ADD", nb.vmath("MULTIPLY", v, st), nb.vmath("SCALE", nb.vmath("SUBTRACT", warp, 0.5), scale=6.0))
    strands = nb.noise(vv, 1.0, 6.0, 0.7).outputs["Fac"]
    cl = nb.clamp01(_attr(nb, "clump"))
    lum = nb.add(nb.mul(strands, 0.55), nb.mul(cl, 0.45))
    col = MM._pal(nb, lum, [root, mid, tip], [0.15, 0.55, 0.95])
    grime = nb.noise(nb.vmath("SCALE", v, scale=2.0), 1.0, 4.0, 0.6).outputs["Fac"]
    col = nb.mix(col, dirt_col, nb.mul(nb.maprange(grime, 0.5, 0.8), 0.6))
    # lower body darker / muddier
    z = nb.sep(nb.node("ShaderNodeTexCoord").outputs["Object"])[2]
    col = nb.mix(col, dirt_col, nb.maprange(z, 0.9, 0.1, 0.0, 0.7))
    h = nb.add(nb.mul(strands, 0.6), nb.mul(cl, 0.4))
    return MM._finish(m, nb, bsdf, col, nb.maprange(strands, 0, 1, 0.75, 0.95), h, bump=bump, bump_dist=0.006,
                      dirt=dirt, dirt_color="#2a241c", vec=v, cavity_dist=0.08, spec=0.3)


def stone_core(name="RuneCore", color="#23262b", glow="#46d7ff", strength=6.0, scale=1.0, seed=0):
    """Dark basalt core of the golem: glowing rune channels (voronoi edge network) + emissive veins."""
    m, nb, bsdf = MM._new(name, "stone_core")
    v = MM.coords(nb, "OBJECT", scale, seed)
    wv = nb.vmath("ADD", v, nb.vmath("SCALE", nb.noise(nb.vmath("SCALE", v, scale=1.5), 1.0, 3.0).outputs["Color"], scale=0.25))
    net = nb.voronoi(nb.vmath("SCALE", wv, scale=3.2), 1.0, "DISTANCE_TO_EDGE").outputs["Distance"]
    chan = nb.maprange(net, 0.0, 0.014, 1.0, 0.0, "SMOOTHSTEP")
    fine = nb.noise(nb.vmath("SCALE", v, scale=9.0), 1.0, 8.0, 0.6).outputs["Fac"]
    pulse = nb.noise(nb.vmath("SCALE", v, scale=0.8), 1.0, 2.0, 0.5).outputs["Fac"]
    col = nb.mix(color, "#3a3e44", fine)
    col = nb.mix(col, "#0b1216", chan)
    emis = nb.mix((0, 0, 0), glow, nb.mul(chan, nb.maprange(pulse, 0.3, 0.7, 0.55, 1.0)))
    h = nb.sub(nb.mul(fine, 0.4), nb.mul(chan, 0.5))
    return MM._finish(m, nb, bsdf, col, nb.maprange(fine, 0, 1, 0.55, 0.85), h, bump=1.0, bump_dist=0.01,
                      emission=emis, emit_strength=strength, vec=v, dirt=0.4, cavity_dist=0.1)


def carved_stone(name="CarvedStone", color="#7b766b", color2="#56524a", rune="#46d7ff", strength=5.0, scale=1.0,
                 seed=0, moss=0.45, rune_amount=1.0):
    """Ancient carved stone plates: weathered rock + engraved (glowing) rune bands, cracks (attr 'crack'), moss."""
    m = MM.rock(name=name, color=color, color2=color2, strata=0.25, scale=scale, seed=seed, dirt=0.7, wear=0.18,
                moss=moss, lichen=0.35)
    nb = MM.NB(m.node_tree)
    bsdf = next(n for n in m.node_tree.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled")
    v = MM.coords(nb, "OBJECT", scale * 4.0, seed + 11)
    rm = MM._rune_mask(nb, v)
    band = nb.maprange(nb.noise(nb.vmath("SCALE", v, scale=0.35), 1.0, 2.0).outputs["Fac"], 0.56, 0.6, 0.0, rune_amount)
    rm = nb.mul(rm, band)
    cr = nb.clamp01(_attr(nb, "crack"))
    col_in = sock(bsdf.inputs, "Base Color")
    prev = col_in.links[0].from_socket
    col = nb.mix(prev, "#0e1113", nb.clamp01(nb.add(rm, nb.mul(cr, 0.8))))
    nb.feed(col_in, col)
    nb.feed(sock(bsdf.inputs, "Emission Color"), nb.mix((0, 0, 0), rune, nb.clamp01(nb.add(nb.mul(rm, 0.9), nb.mul(cr, 0.12)))))
    sock(bsdf.inputs, "Emission Strength").default_value = strength
    m["kit_emissive"] = 1
    return m


def chitin(name="Chitin", c1="#a8845a", c2="#5e4430", edge="#d9c49a", scale=1.0, seed=0, dirt=0.6, bump=1.0):
    """Sun-bleached armoured plates (sand wyrm): growth bands, pits, sand in cavities, worn pale edges."""
    m, nb, bsdf = MM._new(name, "chitin")
    v = MM.coords(nb, "OBJECT", scale, seed)
    bands = nb.wave(nb.vmath("SCALE", v, scale=1.0), 3.0, 3.0, 2.0, "BANDS", "Y", "SIN").outputs["Fac"]
    pits = nb.voronoi(nb.vmath("SCALE", v, scale=30.0), 1.0, "F1").outputs["Distance"]
    fine = nb.noise(nb.vmath("SCALE", v, scale=12.0), 1.0, 8.0, 0.6).outputs["Fac"]
    col = MM._pal(nb, nb.add(nb.mul(bands, 0.5), nb.mul(fine, 0.5)), [c2, c1, edge], [0.1, 0.55, 1.0])
    col = nb.mix(col, "#2c2118", nb.mul(nb.maprange(pits, 0.08, 0.0), 0.6))
    h = nb.add(nb.mul(bands, 0.2), nb.add(nb.mul(fine, 0.3), nb.mul(nb.maprange(pits, 0.0, 0.1), 0.3)))
    return MM._finish(m, nb, bsdf, col, nb.maprange(fine, 0, 1, 0.45, 0.8), h, bump=bump, bump_dist=0.01, dirt=dirt,
                      dirt_color="#8a6d45", vec=v, cavity_dist=0.2, wear=0.6, wear_color=edge, wear_rough=0.35,
                      edge_radius=0.03, coat=0.2)


def flesh(name="Flesh", c1="#6a2a28", c2="#2a0e10", scale=1.0, seed=0, wet=0.7):
    """Wet inner flesh (maws, gums): ribbed, glossy, dark in the depth."""
    m, nb, bsdf = MM._new(name, "flesh")
    v = MM.coords(nb, "OBJECT", scale, seed)
    rib = nb.noise(nb.vmath("MULTIPLY", v, (18.0, 3.0, 18.0)), 1.0, 4.0, 0.6).outputs["Fac"]
    fine = nb.noise(nb.vmath("SCALE", v, scale=20.0), 1.0, 6.0, 0.6).outputs["Fac"]
    col = MM._pal(nb, nb.add(nb.mul(rib, 0.6), nb.mul(fine, 0.4)), [c2, c1, "#8a4a40"], [0.2, 0.6, 1.0])
    h = nb.add(nb.mul(rib, 0.5), nb.mul(fine, 0.3))
    return MM._finish(m, nb, bsdf, col, nb.mixf(0.6, 0.2, wet), h, bump=1.0, bump_dist=0.01, dirt=0.8,
                      dirt_color="#120506", vec=v, cavity_dist=0.3, coat=wet * 0.6, spec=0.6)


def bog(name="BogBody", mud="#3a3024", peat="#221a12", moss_col="#4b5a24", scale=1.0, seed=0, wet=0.6, moss=0.75):
    """Swamp-brute body: dark peat/mud with dried cracked crust (attr 'crack'), wet glossy runnels, moss on top."""
    m, nb, bsdf = MM._new(name, "bog")
    v = MM.coords(nb, "OBJECT", scale, seed)
    big = nb.noise(nb.vmath("SCALE", v, scale=1.5), 1.0, 5.0, 0.6).outputs["Fac"]
    fine = nb.noise(nb.vmath("SCALE", v, scale=18.0), 1.0, 8.0, 0.65).outputs["Fac"]
    drip = nb.noise(nb.vmath("MULTIPLY", v, (14.0, 14.0, 1.2)), 1.0, 4.0, 0.6).outputs["Fac"]
    cr = nb.clamp01(_attr(nb, "crack"))
    col = MM._pal(nb, nb.add(nb.mul(big, 0.6), nb.mul(fine, 0.4)), [peat, mud, "#5a4a36"], [0.2, 0.6, 1.0])
    crust = nb.maprange(big, 0.55, 0.7)
    col = nb.mix(col, "#6b5e4a", nb.mul(crust, 0.45))
    col = nb.mix(col, "#120d08", nb.mul(cr, 0.8))
    wetm = nb.mul(nb.maprange(drip, 0.55, 0.7), wet)
    col = nb.mix(col, "#15110b", nb.mul(wetm, 0.5))
    rough = nb.mixf(nb.maprange(fine, 0, 1, 0.75, 0.95), 0.12, wetm)
    rough = nb.mixf(rough, 0.95, crust)
    h = nb.sub(nb.add(nb.mul(big, 0.5), nb.mul(fine, 0.4)), nb.mul(cr, 0.4))
    return MM._finish(m, nb, bsdf, col, rough, h, bump=1.0, bump_dist=0.012, dirt=0.6, dirt_color="#0e0b07", vec=v,
                      moss=moss, moss_color=moss_col, cavity_dist=0.12, spec=0.5, coat=0.15)
