"""Creature shader-node materials (group `creatures`), built with the kit's node builder and layers
(kit.materials._new / _finish) so they bake like every other kit material.

They read per-vertex attributes written by body.py:
    flow  (vector) fur direction          tone (float -1 dark .. +1 light) saddle / belly / markings
    scar  (0..1) hairless scar tissue     frost (0..1) frosted fur tips (ice wolf)
    seg   (0..1) position along a chitin plate (0/1 = joint groove)    mark (0..1) abdomen markings
"""
from kit import materials as M
from kit.materials import _finish, _new, _pal, coords


def _attr(nb, name, vec=False):
    a = nb.node("ShaderNodeAttribute", {"attribute_type": "GEOMETRY", "attribute_name": name})
    return a.outputs["Vector"] if vec else a.outputs["Fac"]


def fur_flow(name="Fur", color="#6d6760", dark="#2b2723", light="#c9c0b0", tip="#a39c90", scale=1.0, seed=0,
             lock=18.0, strand=260.0, bump=2.0, scar_color="#7a5a55", frost_color=None, rough=0.82, dirt=0.25):
    """Directional fur: elongated 'locks' (stretched voronoi along the flow attribute) with overlapping
    sculpted tips + fine strands, coloured by the tone attribute (dark saddle / light belly), optional scars
    (hairless, pinkish) and frost (icy tips). Everything bakes to baseColor + normal + roughness."""
    m, nb, bsdf = _new(name, "fur_flow")
    v = coords(nb, "OBJECT", scale, seed)
    f = nb.vmath("NORMALIZE", _attr(nb, "flow", True))
    along = nb.vmath("DOT_PRODUCT", v, f)
    across = nb.vmath("SUBTRACT", v, nb.vmath("SCALE", f, scale=along))
    # locks: cells 4x longer along the flow
    st = nb.vmath("ADD", across, nb.vmath("SCALE", f, scale=nb.mul(along, 0.25)))
    warp = nb.noise(v, 6.0, 2.0, 0.5).outputs["Color"]
    st = nb.vmath("ADD", st, nb.vmath("SCALE", nb.vmath("SUBTRACT", warp, (0.5, 0.5, 0.5)), scale=0.02))
    vo = nb.voronoi(nb.vmath("SCALE", st, scale=lock), 1.0, "F1", rand=0.9)
    cellpos = vo.outputs["Position"]
    rnd = nb.bw(vo.outputs["Color"])
    off = nb.vmath("DOT_PRODUCT", nb.vmath("SUBTRACT", nb.vmath("SCALE", st, scale=lock), cellpos), f)
    ridge = nb.maprange(vo.outputs["Distance"], 0.0, 0.62, 1.0, 0.0, "SMOOTHSTEP")
    tipramp = nb.maprange(off, -0.55, 0.45, 0.15, 1.0, "SMOOTHSTEP")
    lockh = nb.mul(ridge, tipramp)
    # strands
    sv = nb.vmath("ADD", nb.vmath("SCALE", across, scale=strand), nb.vmath("SCALE", f, scale=nb.mul(along, strand * 0.04)))
    strands = nb.noise(sv, 1.0, 3.0, 0.6).outputs["Fac"]
    big = nb.noise(v, 2.5, 4.0, 0.55).outputs["Fac"]
    h = nb.add(nb.mul(lockh, 0.65), nb.add(nb.mul(strands, 0.3), nb.mul(rnd, 0.08)))
    # colour: tone attribute (-1 dark .. +1 light) + lock/strand variation, lighter tips
    tone = _attr(nb, "tone")
    t01 = nb.clamp01(nb.add(nb.mul(tone, 0.5), 0.5))
    tone_col = _pal(nb, nb.add(t01, nb.mul(nb.sub(big, 0.5), 0.25)), [dark, color, light], [0.0, 0.5, 1.0])
    col = nb.mix(nb.mix(tone_col, "#000000", 0.6), tone_col, nb.maprange(h, 0.1, 0.65))
    col = nb.mix(col, nb.mix(tone_col, tip, 0.55), nb.mul(nb.maprange(nb.mul(tipramp, strands), 0.45, 0.8), 0.6))
    streak = nb.maprange(strands, 0.3, 0.75)
    col = nb.mix(nb.mix(col, "#000000", 0.35), col, streak)
    r = nb.maprange(strands, 0.0, 1.0, rough - 0.08, rough + 0.08)
    # frost on the fur tips (attribute)
    if frost_color is not None:
        fr = nb.mul(_attr(nb, "frost"), nb.maprange(nb.add(nb.mul(tipramp, 0.6), nb.mul(strands, 0.4)), 0.35, 0.7))
        col = nb.mix(col, frost_color, fr)
        r = nb.mixf(r, 0.35, fr)
    # scars: hairless raised tissue, no strands
    sc = nb.clamp01(nb.mul(_attr(nb, "scar"), 1.3))
    skinn = nb.noise(nb.vmath("SCALE", v, scale=90.0), 1.0, 4.0, 0.6).outputs["Fac"]
    col = nb.mix(col, nb.mix(scar_color, "#2b1e1c", nb.mul(skinn, 0.4)), sc)
    h = nb.mixf(h, nb.add(0.45, nb.mul(skinn, 0.1)), sc)
    r = nb.mixf(r, 0.5, sc)
    return _finish(m, nb, bsdf, col, r, h, bump=bump, bump_dist=0.005, dirt=dirt, dirt_color="#1d1914", vec=v,
                   cavity_dist=0.05, spec=0.35)


def skin_pad(name="Pad", color="#1c1816", scale=1.0, seed=0, rough=0.45, bump=1.0, wet=0.0):
    """Nose leather / paw pads / lips: cobbled bumps, dark, slightly moist."""
    m, nb, bsdf = _new(name, "pad")
    v = coords(nb, "OBJECT", scale, seed)
    cob = nb.voronoi(nb.vmath("SCALE", v, scale=160.0), 1.0, "F1").outputs["Distance"]
    fine = nb.noise(nb.vmath("SCALE", v, scale=40.0), 1.0, 4.0).outputs["Fac"]
    col = nb.mix(color, nb.mix(color, "#6a5550", 0.5), nb.mul(fine, 0.4))
    h = nb.sub(0.6, nb.mul(cob, 0.6))
    rr = nb.maprange(cob, 0.0, 0.5, rough - wet, rough + 0.15)
    return _finish(m, nb, bsdf, col, rr, h, bump=bump, bump_dist=0.002, dirt=0.3, vec=v, cavity_dist=0.03, spec=0.5)


def mouth(name="Mouth", color="#5a1f22", scale=1.0, seed=0):
    """Gums / mouth interior: wet dark red with ridges."""
    m, nb, bsdf = _new(name, "mouth")
    v = coords(nb, "OBJECT", scale, seed)
    rid = nb.wave(v, 60.0, 3.0, 2.0, "BANDS", "Y").outputs["Fac"]
    fine = nb.noise(nb.vmath("SCALE", v, scale=50.0), 1.0, 4.0).outputs["Fac"]
    col = nb.mix(color, "#2a0c0e", nb.mul(nb.add(nb.mul(rid, 0.5), nb.mul(fine, 0.5)), 0.6))
    return _finish(m, nb, bsdf, col, 0.3, nb.add(nb.mul(rid, 0.3), nb.mul(fine, 0.2)), bump=0.6, bump_dist=0.002,
                   dirt=0.5, dirt_color="#150506", vec=v, cavity_dist=0.03, spec=0.6)


def keratin(name="Keratin", color="#2a2521", tip="#8c8070", scale=1.0, seed=0, axis="Z", rough=0.45, grime=0.3):
    """Claws, hooves, fangs' dark roots, tusks: growth striations along `axis`, lighter worn tips."""
    m, nb, bsdf = _new(name, "keratin")
    v = coords(nb, "OBJECT", scale, seed)
    st = {"X": (4, 120, 120), "Y": (120, 4, 120), "Z": (120, 120, 4)}[axis]
    stri = nb.noise(nb.vmath("MULTIPLY", v, st), 1.0, 4.0, 0.6).outputs["Fac"]
    big = nb.noise(nb.vmath("SCALE", v, scale=8.0), 1.0, 3.0).outputs["Fac"]
    col = nb.mix(color, tip, nb.maprange(big, 0.35, 0.75, 0.0, 0.7))
    col = nb.mix(col, nb.mix(col, "#000000", 0.4), nb.mul(stri, 0.5))
    return _finish(m, nb, bsdf, col, nb.maprange(stri, 0, 1, rough - 0.1, rough + 0.15), stri, bump=0.8,
                   bump_dist=0.002, dirt=grime, wear=0.4, vec=v, cavity_dist=0.03, edge_radius=0.004,
                   wear_color=nb.mix(color, tip, 0.8), spec=0.5)


def ivory(name="Tusk", color="#d8cbad", root="#5c4a33", scale=1.0, seed=0, root_z=None):
    """Tusks / fangs: kit bone look, yellowed and dirty towards the root."""
    return M.bone(name, color=color, scale=scale, seed=seed, dirt=0.6)


def eye(name="Eye", iris="#d49a2a", pupil="#050403", glow=0.0, glow_color=None, scale=1.0, iris_size=0.55,
        pupil_size=0.9, sclera="#2a211a"):
    """Glossy eyeball drawn from the per-vertex 'iris' attribute (body.eye: cos of the angle to the look direction):
    dark sclera rim, iris (fibres + darker limbal ring), round pupil. glow > 0 = emissive iris."""
    m, nb, bsdf = _new(name, "eye")
    v = coords(nb, "OBJECT", scale, 0)
    c = _attr(nb, "iris")                                  # 1 at the pupil centre
    n = nb.noise(nb.vmath("SCALE", v, scale=400.0), 1.0, 3.0).outputs["Fac"]
    ir = nb.maprange(c, iris_size - 0.04, iris_size + 0.04)          # inside the iris
    limb = nb.mul(ir, nb.maprange(c, iris_size + 0.12, iris_size + 0.03))   # darker limbal ring
    pu = nb.maprange(c, pupil_size - 0.015, pupil_size + 0.015)
    icol = nb.mix(nb.mix(iris, "#000000", 0.45), iris, nb.add(nb.mul(n, 0.6), nb.mul(nb.maprange(c, iris_size, 1.0), 0.4)))
    icol = nb.mix(icol, nb.mix(iris, "#000000", 0.7), limb)
    col = nb.mix(sclera, icol, ir)
    col = nb.mix(col, pupil, pu)
    em = None
    if glow > 0:
        em = nb.mix((0, 0, 0), glow_color or iris, nb.mul(nb.mul(ir, nb.sub(1.0, pu)), nb.add(0.55, nb.mul(n, 0.45))))
    return _finish(m, nb, bsdf, col, 0.06, None, emission=em, emit_strength=glow if glow > 0 else 1.0, coat=1.0,
                   spec=0.8)


def chitin(name="Chitin", color="#3b2a1e", dark="#120c08", edge="#8a6a3e", scale=1.0, seed=0, rough=0.38,
           pits=1.0, bands=1.0, hair=0.0, bump=1.0, mark_color=None, dirt=0.4, tone=False, pattern=None):
    """Arthropod exoskeleton: glossy plates, darker joint grooves from the 'seg' attribute (0/1 = joint),
    lighter worn plate rims, fine pitting and growth lines; optional short hair (spider) and markings ('mark')."""
    m, nb, bsdf = _new(name, "chitin")
    v = coords(nb, "OBJECT", scale, seed)
    seg = _attr(nb, "seg")
    j = nb.math("ABSOLUTE", nb.sub(nb.mul(seg, 2.0), 1.0))          # 1 at joints, 0 mid-plate
    groove = nb.maprange(j, 0.84, 0.97, 0.0, 1.0, "SMOOTHSTEP")
    rim = nb.mul(nb.maprange(j, 0.62, 0.84, 0.0, 1.0), nb.maprange(j, 0.84, 0.9, 1.0, 0.0))
    pit = nb.voronoi(nb.vmath("SCALE", v, scale=140.0), 1.0, "F1").outputs["Distance"]
    pitm = nb.maprange(pit, 0.0, 0.18, 1.0, 0.0)
    grow = nb.wave(v, 30.0, 6.0, 3.0, "BANDS", "Y").outputs["Fac"]
    mott = nb.noise(nb.vmath("SCALE", v, scale=5.0), 1.0, 5.0, 0.6).outputs["Fac"]
    col = _pal(nb, nb.add(nb.mul(mott, 0.8), nb.mul(nb.sub(1.0, j), 0.3)), [dark, color, nb_hex_mix(color, edge)], [0.1, 0.55, 1.0])
    col = nb.mix(col, edge, nb.mul(rim, 0.55))
    col = nb.mix(col, dark, nb.mul(groove, 0.9))
    col = nb.mix(col, nb.mix(col, "#000000", 0.35), nb.mul(pitm, 0.4 * pits))
    col = nb.mix(col, nb.mix(col, "#ffffff", 0.08), nb.mul(grow, 0.3 * bands))
    h = nb.sub(nb.add(nb.mul(nb.sub(1.0, groove), 0.7), nb.mul(rim, 0.15)), nb.add(nb.mul(pitm, 0.12 * pits), nb.mul(grow, 0.05 * bands)))
    r = nb.add(nb.mul(pitm, 0.2), nb.mul(groove, 0.3))
    r = nb.add(r, rough)
    if tone:   # 'tone' attribute: -1 darkest (dorsal / abdomen) .. +1 lighter (leg bands)
        tn = _attr(nb, "tone")
        col = nb.mix(col, dark, nb.mul(nb.clamp01(nb.mul(tn, -1.0)), 0.85))
        col = nb.mix(col, nb.mix(col, edge, 0.7), nb.clamp01(tn))
    if mark_color is not None:
        mk = nb.clamp01(_attr(nb, "mark"))
        if pattern == "spider":
            mk = nb.math("MAXIMUM", mk, spider_marks(nb))
        col = nb.mix(col, mark_color, mk)
    if hair > 0:
        fl = nb.vmath("NORMALIZE", _attr(nb, "flow", True))
        al = nb.vmath("DOT_PRODUCT", v, fl)
        ac = nb.vmath("SUBTRACT", v, nb.vmath("SCALE", fl, scale=al))
        hv = nb.vmath("ADD", nb.vmath("SCALE", ac, scale=380.0), nb.vmath("SCALE", fl, scale=nb.mul(al, 25.0)))
        hs = nb.maprange(nb.noise(hv, 1.0, 2.0, 0.5).outputs["Fac"], 0.5, 0.75)
        hm = nb.mul(hs, hair)
        col = nb.mix(col, nb.mix(col, "#b8a58a", 0.35), nb.mul(hm, 0.6))
        h = nb.add(h, nb.mul(hm, 0.3))
        r = nb.mixf(r, 0.8, nb.mul(hm, 0.8))
    return _finish(m, nb, bsdf, col, r, h, bump=bump, bump_dist=0.004, dirt=dirt, dirt_color="#0d0906", vec=v,
                   cavity_dist=0.05, coat=0.25, spec=0.6)


def _ss(nb, x, a, b):
    return nb.maprange(x, a, b, 0.0, 1.0, "SMOOTHSTEP")


def spider_marks(nb):
    """Dorsal abdomen pattern in OBJECT space (rest pose = armature space, the bake pose): a central chain of 4 pale
    chevrons pointing forward, shrinking towards the spinnerets, paired spots and a short midline. Drawn in the
    shader (vertex attributes are far too coarse for 2-3 cm wide marks)."""
    o = nb.sep(nb.node("ShaderNodeTexCoord").outputs["Object"])
    x, y = o[0], o[1]
    nz = nb.sep(nb.node("ShaderNodeNewGeometry").outputs["Normal"])[2]
    ax = nb.math("ABSOLUTE", x)
    ya = nb.mul(nb.sub(y, 0.18), 1.0 / 0.72)
    half = nb.mul(0.2, nb.sub(1.0, nb.mul(ya, 0.45)))
    mark = None
    for k, yk in enumerate((0.3, 0.46, 0.61, 0.75)):
        w = 0.024 - 0.003 * k
        d = nb.math("ABSOLUTE", nb.sub(nb.sub(ya, yk), nb.mul(ax, 0.75)))
        band = nb.sub(1.0, _ss(nb, d, w, w * 1.8))
        lim = nb.sub(1.0, _ss(nb, ax, nb.mul(half, 0.75 - 0.1 * k), nb.mul(half, 0.85 - 0.1 * k)))
        m = nb.mul(band, lim)
        mark = m if mark is None else nb.math("MAXIMUM", mark, m)
    for yk, xk, rk in ((0.2, 0.075, 0.024), (0.37, 0.12, 0.018), (0.53, 0.105, 0.016), (0.67, 0.085, 0.014)):
        dd = nb.vmath("LENGTH", nb.xyz(nb.sub(ax, xk), nb.sub(y, 0.18 + yk * 0.72), 0.0))
        mark = nb.math("MAXIMUM", mark, nb.sub(1.0, _ss(nb, dd, rk * 0.7, rk * 1.3)))
    mid = nb.mul(nb.mul(nb.sub(1.0, _ss(nb, ax, 0.008, 0.016)), _ss(nb, ya, 0.12, 0.2)), nb.sub(1.0, _ss(nb, ya, 0.28, 0.32)))
    mark = nb.math("MAXIMUM", mark, mid)
    # ragged edges (hairy pattern), only on the top of the abdomen
    rag = nb.noise(nb.vmath("SCALE", nb.node("ShaderNodeTexCoord").outputs["Object"], scale=60.0), 1.0, 3.0).outputs["Fac"]
    mark = nb.maprange(nb.add(mark, nb.mul(nb.sub(rag, 0.5), 0.5)), 0.35, 0.6)
    mask = nb.mul(nb.mul(_ss(nb, y, 0.1, 0.22), _ss(nb, nz, -0.1, 0.45)), nb.sub(1.0, _ss(nb, ya, 0.88, 0.95)))
    return nb.mul(mark, mask)


def nb_hex_mix(a, b, t=0.5):
    """Mix two '#rrggbb' colours in sRGB (python side)."""
    ha, hb = a.lstrip("#"), b.lstrip("#")
    ca = [int(ha[i:i + 2], 16) for i in (0, 2, 4)]
    cb = [int(hb[i:i + 2], 16) for i in (0, 2, 4)]
    return "#" + "".join(f"{int(round(x + (y - x) * t)):02x}" for x, y in zip(ca, cb))


def gel(name="Gel", color="#4f9a2e", deep="#163d10", rim="#b6e56a", scale=1.0, seed=0, glow=0.35):
    """Slime gel: glossy wet surface, darker 'deep' core colour towards the bottom/centre, inner bubbles and
    suspended debris drawn in object space (baked into baseColor + a faint emissive glow = subsurface look)."""
    m, nb, bsdf = _new(name, "gel")
    v = coords(nb, "OBJECT", scale, seed)
    tc = nb.node("ShaderNodeTexCoord").outputs["Object"]
    s = nb.sep(tc)
    rad = nb.vmath("LENGTH", nb.xyz(s[0], s[1], nb.mul(nb.sub(s[2], 0.3), 1.2)))
    depth = nb.maprange(s[2], 0.0, 0.7, 1.0, 0.0)
    # inner bubbles: sparse soft spheres seen through the gel (lighter core, thin darker rim, offset catch-light),
    # denser and larger in the upper half; plus fine champagne-like micro bubbles
    b1 = nb.voronoi(nb.vmath("SCALE", v, scale=7.0), 1.0, "F1", rand=1.0)
    br = nb.bw(b1.outputs["Color"])
    size = nb.mul(nb.maprange(br, 0.0, 1.0, 0.1, 0.24), nb.math("GREATER_THAN", nb.add(br, nb.mul(nb.sub(1.0, depth), 0.12)), 0.8))
    d = b1.outputs["Distance"]
    inner = nb.maprange(d, nb.mul(size, 0.2), size, 1.0, 0.0, "SMOOTHSTEP")
    ring = nb.mul(nb.maprange(d, nb.mul(size, 0.75), size, 0.0, 1.0), nb.maprange(d, size, nb.mul(size, 1.1), 1.0, 0.0))
    hl_off = nb.vmath("ADD", nb.vmath("SCALE", v, scale=7.0), (0.05, -0.05, -0.06))
    hl = nb.voronoi(hl_off, 1.0, "F1", rand=1.0)
    spark = nb.mul(nb.maprange(hl.outputs["Distance"], 0.0, nb.mul(size, 0.3), 1.0, 0.0), nb.math("GREATER_THAN", size, 0.01))
    b2 = nb.voronoi(nb.vmath("SCALE", v, scale=30.0), 1.0, "F1", rand=1.0)
    small = nb.mul(nb.maprange(b2.outputs["Distance"], 0.04, 0.08, 1.0, 0.0), nb.math("GREATER_THAN", nb.bw(b2.outputs["Color"]), 0.85))
    swirl = nb.noise(nb.vmath("SCALE", v, scale=3.0), 1.0, 5.0, 0.6, dist=1.5).outputs["Fac"]
    col = nb.mix(color, deep, nb.clamp01(nb.add(nb.mul(depth, 0.75), nb.mul(nb.maprange(swirl, 0.4, 0.7), 0.4))))
    col = nb.mix(col, nb.mix(color, rim, 0.45), nb.mul(inner, 0.45))
    col = nb.mix(col, deep, nb.mul(ring, 0.5))
    col = nb.mix(col, rim, nb.clamp01(nb.add(nb.mul(spark, 0.8), nb.mul(small, 0.35))))
    # debris: dark specks (leaves, grit) suspended in the gel
    deb = nb.maprange(nb.voronoi(nb.vmath("SCALE", v, scale=40.0), 1.0, "F1", rand=1.0).outputs["Distance"], 0.03, 0.07, 1.0, 0.0)
    debm = nb.mul(deb, nb.maprange(nb.noise(nb.vmath("ADD", v, (5, 5, 5)), 3.0, 2.0).outputs["Fac"], 0.55, 0.65))
    col = nb.mix(col, "#1b1a0c", nb.mul(debm, 0.8))
    em = nb.mix((0, 0, 0), rim, nb.clamp01(nb.add(nb.mul(nb.sub(1.0, depth), 0.22), nb.add(nb.mul(inner, 0.3), nb.mul(spark, 0.3)))))
    h = nb.add(nb.mul(swirl, 0.2), nb.mul(nb.noise(nb.vmath("SCALE", v, scale=25.0), 1.0, 3.0).outputs["Fac"], 0.15))
    rr = nb.maprange(swirl, 0.0, 1.0, 0.06, 0.2)
    return _finish(m, nb, bsdf, col, rr, h, bump=0.5, bump_dist=0.004, vec=v, emission=em, emit_strength=glow,
                   coat=1.0, spec=0.7)


def fur_lock(name="FurCard", colors=("#1f1b18", "#3d362f", "#5d554b", "#b3a590"), tip="#8c8374", seed=0,
             strands=5, cols=4, frost=None):
    """Alpha fur-lock cards, TILE baked (one shared texture): the texture holds `cols` columns, one per tone
    (dark .. light); body.fur_cards() moves each card's U into the column matching the pelt tone under it, so the
    locks match the body colour. Inside a column: a few thick tapered strands (V root -> tip) with a denser root."""
    m, nb, bsdf = _new(name, "fur_lock", alpha=True)
    m["kit_bake"] = "tile"
    uvn = nb.node("ShaderNodeUVMap", {"uv_map": "UVMap"})
    s = nb.sep(uvn.outputs["UV"])
    uu, vv = s[0], s[1]
    k = nb.math("FLOOR", nb.mul(uu, cols))
    u = nb.math("FRACT", nb.mul(uu, cols))
    cell = nb.math("FLOOR", nb.mul(u, strands))
    rnd = nb.node("ShaderNodeTexWhiteNoise", {"noise_dimensions": "1D"}, W=nb.add(nb.add(cell, nb.mul(k, 13.0)), seed * 3.7)).outputs["Value"]
    lu = nb.sub(nb.math("FRACT", nb.mul(u, strands)), nb.add(0.5, nb.mul(nb.sub(rnd, 0.5), 0.25)))
    top = nb.add(0.7, nb.mul(rnd, 0.3))
    bend = nb.mul(nb.mul(nb.sub(0.5, u), 0.8), nb.mul(vv, vv))          # locks converge towards their tip
    lu = nb.add(lu, nb.mul(bend, strands))
    width = nb.mul(0.46, nb.maprange(vv, 0.0, top, 1.0, 0.1))
    strand = nb.mul(nb.math("LESS_THAN", nb.math("ABSOLUTE", lu), width), nb.math("LESS_THAN", vv, top))
    root = nb.math("LESS_THAN", vv, nb.add(0.12, nb.mul(rnd, 0.08)))
    edge = nb.mul(nb.math("GREATER_THAN", u, 0.03), nb.math("LESS_THAN", u, 0.97))
    alpha = nb.math("GREATER_THAN", nb.mul(nb.math("MAXIMUM", strand, root), edge), 0.5)
    # palette per column
    base = nb.ramp(nb.div(nb.add(k, 0.5), cols) if hasattr(nb, "div") else nb.mul(nb.add(k, 0.5), 1.0 / cols),
                   [((i + 0.5) / cols, c) for i, c in enumerate(colors)], "CONSTANT")
    col = nb.mix(nb.mix(base, "#000000", 0.6), base, nb.maprange(vv, 0.0, 0.5))
    col = nb.mix(col, nb.mix(base, tip, 0.5), nb.maprange(vv, 0.6, 0.95))
    col = nb.mix(col, nb.mix(col, "#000000", 0.4), nb.mul(nb.math("ABSOLUTE", lu), 1.4))
    col = nb.mix(col, nb.mix(col, "#ffffff", 0.12), nb.mul(nb.maprange(rnd, 0.75, 1.0), 0.7))
    r = 0.78
    if frost is not None:          # frosted tips on the lightest column(s)
        fr = nb.mul(nb.math("GREATER_THAN", k, cols - 2.5), nb.maprange(vv, 0.5, 0.9))
        col = nb.mix(col, frost, fr)
        r = nb.mixf(0.78, 0.35, fr)
    h = nb.sub(0.5, nb.math("ABSOLUTE", lu))
    m["kit_alpha_cutoff"] = 0.5
    m["kit_cols"] = cols
    return _finish(m, nb, bsdf, col, r, h, alpha=alpha, bump=0.6, bump_dist=0.002, spec=0.35)
