"""Character-specific procedural materials (shader nodes, baked by kit.bake) built on kit.materials internals.

    skin_face(...)   skin + painted face (lips, flushed cheeks/nose/ears, eye shadow, brows, stubble, wrinkles)
    eye(...)         sclera / iris / pupil / limbal ring from the eyeball's authored UVs (pole faces forward)
    hair(...)        strand-grooved hair/beard mass (object coords along a flow axis)
    chainmail(...)   riveted rings (BOX projection), grimy steel
    trimmed(...)     wrap any kit material builder's output with a hem trim band (reads the 'hem' attribute)
All cloth that should sway in the wind must be named Cloth*/Banner*; set kit_group so they share ONE atlas.
"""
from kit import materials as KM
from kit.materials import _finish, _new, _pal, coords
from kit.nodes import sock


def group(mat, g):
    mat["kit_group"] = g
    return mat


def skin_face(name, head_c, k=1.0, tone="#b98a6e", tone2="#8e5a45", lips="#8f4a42", brow="#2a1d14", stubble=0.0,
              stubble_col="#2b221c", age=0.0, seed=0, flush=0.5, brow_amt=0.8, eyeliner=0.5, kind="human",
              brow_hair=True):
    """Skin with a painted face: all masks are object-space distances to landmarks around head_c (eye level)."""
    m, nb, bsdf = _new(name, "skin_face")
    v = coords(nb, "OBJECT", 1.0, seed)
    tc = nb.node("ShaderNodeTexCoord").outputs["Object"]
    rel = nb.vmath("SCALE", nb.vmath("SUBTRACT", tc, tuple(head_c)), scale=1.0 / k)   # head-local metres (k=1)
    x, y, z = nb.sep(rel)
    ax = nb.math("ABSOLUTE", x)

    def blob(cx, cy, cz, rx, ry, rz, absx=True):
        dx = nb.mul(nb.sub(ax if absx else x, cx), 1.0 / rx)
        dy = nb.mul(nb.sub(y, cy), 1.0 / ry)
        dz = nb.mul(nb.sub(z, cz), 1.0 / rz)
        d2 = nb.add(nb.add(nb.mul(dx, dx), nb.mul(dy, dy)), nb.mul(dz, dz))
        return nb.maprange(d2, 1.0, 0.0, 0.0, 1.0, "SMOOTHSTEP")

    pores = nb.voronoi(nb.vmath("SCALE", v, scale=320.0), 1.0, "F1").outputs["Distance"]
    blot = nb.noise(nb.vmath("SCALE", v, scale=7.0), 1.0, 5.0, 0.6).outputs["Fac"]
    fine = nb.noise(nb.vmath("SCALE", v, scale=60.0), 1.0, 4.0, 0.6).outputs["Fac"]
    col = nb.mix(tone, tone2, nb.maprange(blot, 0.4, 0.8, 0.0, 0.55))
    # flushed nose tip, cheeks, ears; darker eye sockets
    fl = nb.math("MAXIMUM", blob(0.0, -0.118, -0.04, 0.02, 0.03, 0.02, False), blob(0.045, -0.07, -0.03, 0.03, 0.03, 0.03))
    fl = nb.math("MAXIMUM", fl, blob(0.075, 0.012, -0.005, 0.02, 0.03, 0.04))
    col = nb.mix(col, "#b0564a", nb.mul(fl, 0.35 * flush))
    sock_m = blob(0.032, -0.08, 0.004, 0.028, 0.03, 0.02)
    col = nb.mix(col, nb.mix(tone2, "#3b2a26", 0.5), nb.mul(sock_m, 0.45 * eyeliner))
    # lips
    lp = blob(0.0, -0.1, -0.074, 0.021, 0.02, 0.0115, False)
    col = nb.mix(col, lips, nb.mul(lp, 0.75))
    # eyebrows: painted strands over the brow ridge
    if brow_hair:
        bx = nb.sub(ax, 0.032)
        bz = nb.sub(z, nb.add(0.021, nb.mul(nb.mul(bx, bx), -6.0)))
        bmask = nb.mul(nb.maprange(nb.math("ABSOLUTE", bx), 0.024, 0.017, 0.0, 1.0),
                       nb.maprange(nb.math("ABSOLUTE", bz), 0.0055, 0.0025, 0.0, 1.0))
        bmask = nb.mul(bmask, nb.maprange(y, -0.06, -0.075, 0.0, 1.0))
        strands = nb.noise(nb.vmath("MULTIPLY", rel, (900.0, 300.0, 300.0)), 1.0, 2.0, 0.5).outputs["Fac"]
        bmask = nb.mul(bmask, nb.maprange(strands, 0.3, 0.6, 0.55, 1.0))
        col = nb.mix(col, brow, nb.mul(bmask, brow_amt))
    # stubble on jaw / upper lip / chin (below the cheekbones, front half)
    if stubble > 0:
        jaw = nb.mul(nb.maprange(z, -0.02, -0.045, 0.0, 1.0), nb.maprange(y, 0.02, -0.02, 0.0, 1.0))
        jaw = nb.mul(jaw, nb.sub(1.0, lp))
        jaw = nb.mul(jaw, nb.maprange(z, -0.16, -0.13, 0.0, 1.0))
        dots = nb.maprange(nb.voronoi(nb.vmath("SCALE", v, scale=700.0), 1.0, "F1").outputs["Distance"], 0.0, 0.5, 1.0, 0.0)
        col = nb.mix(col, stubble_col, nb.mul(nb.mul(jaw, stubble), nb.add(0.45, nb.mul(dots, 0.55))))
    # height: pores + wrinkles (forehead lines, crow's feet, nasolabial) with age
    h = nb.add(nb.mul(pores, 0.25), nb.mul(fine, 0.12))
    if age > 0:
        fh = nb.math("SINE", nb.mul(z, 480.0))
        fmask = nb.mul(nb.maprange(z, 0.035, 0.05, 0.0, 1.0), nb.maprange(z, 0.085, 0.07, 0.0, 1.0))
        fmask = nb.mul(fmask, nb.maprange(y, -0.05, -0.08, 0.0, 1.0))
        h = nb.sub(h, nb.mul(nb.mul(nb.maprange(fh, 0.6, 1.0), fmask), 0.5 * age))
        cr = nb.math("SINE", nb.mul(nb.add(z, nb.mul(ax, 0.4)), 700.0))
        cmask = blob(0.058, -0.06, 0.0, 0.016, 0.03, 0.02)
        h = nb.sub(h, nb.mul(nb.mul(nb.maprange(cr, 0.5, 1.0), cmask), 0.45 * age))
        nl = blob(0.03, -0.1, -0.058, 0.01, 0.03, 0.03)
        h = nb.sub(h, nb.mul(nl, 0.35 * age))
        col = nb.mix(col, nb.mix(tone2, "#000000", 0.2), nb.mul(nb.mul(nl, 0.25), age))
        spots = nb.maprange(nb.voronoi(nb.vmath("SCALE", v, scale=45.0), 1.0, "F1").outputs["Distance"], 0.08, 0.02)
        col = nb.mix(col, "#6b4a35", nb.mul(spots, 0.25 * age))
    rough = nb.add(nb.maprange(pores, 0, 1, 0.42, 0.62), nb.mul(lp, -0.1))
    return _finish(m, nb, bsdf, col, rough, h, bump=1.0, bump_dist=0.0012, dirt=0.15, dirt_color=tone2, vec=v,
                   cavity_dist=0.03, sss=0.12 if kind == "human" else 0.05, spec=0.45)


def eye(name="Eye", iris="#4a6a7a", iris2="#2c3b2a", glow=None, strength=4.0, sclera="#d8cfc0"):
    """Eyeball material from the authored sphere UVs (pole = v 1.0 must face forward)."""
    m, nb, bsdf = _new(name, "eye")
    uv = nb.node("ShaderNodeTexCoord").outputs["UV"]
    u, vv, _ = nb.sep(uv)
    d = nb.sub(1.0, vv)                                     # 0 at the front pole
    iris_m = nb.maprange(d, 0.26, 0.23, 0.0, 1.0)
    pupil = nb.maprange(d, 0.1, 0.085, 0.0, 1.0)
    rays = nb.math("SINE", nb.mul(u, 6.283 * 40.0))
    icol = nb.mix(iris, iris2, nb.maprange(nb.add(d, nb.mul(rays, 0.012)), 0.1, 0.24))
    icol = nb.mix(icol, "#101010", nb.maprange(d, 0.2, 0.26, 0.0, 0.8))      # limbal ring
    veins = nb.noise(nb.vmath("SCALE", uv, scale=30.0), 1.0, 6.0, 0.6).outputs["Fac"]
    scl = nb.mix(sclera, "#b89a8a", nb.mul(nb.maprange(veins, 0.55, 0.7), nb.maprange(d, 0.4, 0.8)))
    col = nb.mix(scl, icol, iris_m)
    col = nb.mix(col, "#050505", pupil)
    emis = None
    if glow is not None:
        col = nb.mix("#050505", glow, iris_m)
        emis = nb.mix((0, 0, 0), glow, nb.maprange(d, 0.3, 0.05, 0.0, 1.0))
    return _finish(m, nb, bsdf, col, 0.12, None, emission=emis, emit_strength=strength, spec=0.6)


def hair(name, color="#3a2a1e", color2=None, tip=None, axis=(0.0, 0.0, 1.0), scale=1.0, seed=0, grey=0.0,
         flow_noise=1.0, bump=1.2):
    """Hair/beard mass: fine strand grooves along `axis` (object space), clumps, lighter tips."""
    m, nb, bsdf = _new(name, "hair")
    v = coords(nb, "OBJECT", scale, seed)
    warp = nb.noise(nb.vmath("SCALE", v, scale=6.0), 1.0, 3.0, 0.5).outputs["Color"]
    vw = nb.vmath("ADD", v, nb.vmath("SCALE", nb.vmath("SUBTRACT", warp, (0.5, 0.5, 0.5)), scale=0.04 * flow_noise))
    ax = axis
    # project onto the plane perpendicular to the flow: strands are lines along the flow axis
    st = (400.0 if abs(ax[0]) < 0.5 else 3.0, 400.0 if abs(ax[1]) < 0.5 else 3.0, 400.0 if abs(ax[2]) < 0.5 else 3.0)
    strands = nb.noise(nb.vmath("MULTIPLY", vw, st), 1.0, 3.0, 0.6).outputs["Fac"]
    clump = nb.noise(nb.vmath("MULTIPLY", vw, tuple(s / 12.0 for s in st)), 1.0, 3.0, 0.5).outputs["Fac"]
    c2 = color2 or "#140e0a"
    tp = tip or color
    col = _pal(nb, nb.add(nb.mul(strands, 0.6), nb.mul(clump, 0.4)), [c2, color, tp], [0.25, 0.6, 0.95])
    if grey > 0:
        gm = nb.maprange(nb.noise(nb.vmath("MULTIPLY", vw, tuple(s / 3.0 for s in st)), 1.0, 2.0).outputs["Fac"], 0.3, 0.7)
        col = nb.mix(col, "#b8b2a8", nb.mul(gm, grey))
    h = nb.add(nb.mul(strands, 0.7), nb.mul(clump, 0.5))
    rough = nb.maprange(strands, 0, 1, 0.55, 0.8)
    return _finish(m, nb, bsdf, col, rough, h, bump=bump, bump_dist=0.004, dirt=0.25, dirt_color="#0e0a08", vec=v, spec=0.4)


def chainmail(name="Chainmail", color="#6f7274", scale=1.0, seed=0, rust=0.35):
    """Interlocked riveted rings (BOX projection so rings stay round on every side)."""
    m, nb, bsdf = _new(name, "chainmail")
    v = coords(nb, "BOX", 1.0, seed)
    ring_scale = 110.0 * scale
    br = nb.brick(nb.vmath("SCALE", v, scale=ring_scale), 1.0, 1.0, 1.0, mortar=0.0, offset=0.5, freq=1,
                  c1=(1, 1, 1), c2=(1, 1, 1))
    fr = nb.vmath("FRACTION", nb.vmath("MULTIPLY", nb.vmath("SCALE", v, scale=ring_scale), (1.0, 1.0, 1.0)))
    # ring = distance from cell centre ~ 0.38 (two staggered grids = interlocking look)
    s = nb.sep(nb.vmath("SUBTRACT", fr, (0.5, 0.5, 0.0)))
    r1 = nb.math("SQRT", nb.add(nb.mul(s[0], s[0]), nb.mul(s[1], s[1])))
    fr2 = nb.vmath("FRACTION", nb.vmath("ADD", nb.vmath("SCALE", v, scale=ring_scale), (0.5, 0.5, 0.0)))
    s2 = nb.sep(nb.vmath("SUBTRACT", fr2, (0.5, 0.5, 0.0)))
    r2 = nb.math("SQRT", nb.add(nb.mul(s2[0], s2[0]), nb.mul(s2[1], s2[1])))
    ring1 = nb.maprange(nb.math("ABSOLUTE", nb.sub(r1, 0.36)), 0.11, 0.03)
    ring2 = nb.maprange(nb.math("ABSOLUTE", nb.sub(r2, 0.36)), 0.11, 0.03)
    rings = nb.math("MAXIMUM", ring1, ring2)
    fine = nb.noise(nb.vmath("SCALE", v, scale=8.0), 1.0, 5.0, 0.6).outputs["Fac"]
    base = nb.mix("#15130f", color, rings)
    base = nb.mix(base, nb.mix(color, "#ffffff", 0.2), nb.mul(nb.maprange(fine, 0.6, 0.8), rings))
    rough = nb.mixf(0.9, 0.38, rings)
    metal_v = nb.mixf(0.0, 1.0, rings)
    if rust > 0:
        rn = nb.noise(nb.vmath("SCALE", v, scale=3.0), 1.0, 8.0, 0.7).outputs["Fac"]
        rm = nb.mul(nb.maprange(rn, 0.7 - 0.3 * rust, 0.8 - 0.3 * rust), rings)
        base = nb.mix(base, "#6b3418", rm)
        rough = nb.mixf(rough, 0.9, rm)
        metal_v = nb.mixf(metal_v, 0.0, rm)
    h = nb.mul(rings, 0.8)
    return _finish(m, nb, bsdf, base, rough, h, metal=metal_v, bump=1.4, bump_dist=0.002, dirt=0.5,
                   dirt_color="#120f0c", vec=v, cavity_dist=0.04, spec=0.5)


def trim(mat, color="#8a6a2a", width=0.035, inset=0.012, metal=0.0, rough=0.5, attr="hem", pattern=True):
    """Add an embroidered/metal trim band along open borders (attribute `attr` = distance to the hem / 0.2 m)."""
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled")
    from kit.nodes import NB
    nb = NB(nt)
    a = nb.node("ShaderNodeAttribute", {"attribute_type": "GEOMETRY", "attribute_name": attr}).outputs["Fac"]
    d = nb.mul(a, 0.2)
    bandm = nb.mul(nb.maprange(d, inset - 0.002, inset + 0.002), nb.maprange(d, inset + width, inset + width - 0.004))
    if pattern:
        tc = nb.node("ShaderNodeTexCoord").outputs["Object"]
        wv = nb.wave(nb.vmath("SCALE", tc, scale=1.0), 60.0, 2.0, 1.0, "BANDS", "Z", "SIN").outputs["Fac"]
        bandm = nb.mul(bandm, nb.maprange(wv, 0.15, 0.35, 0.6, 1.0))
    for key, val in (("Base Color", color), ("Metallic", metal), ("Roughness", rough)):
        s = sock(bsdf.inputs, key)
        old = s.links[0].from_socket if s.is_linked else None
        if key == "Base Color":
            mixed = nb.mix(old if old is not None else tuple(s.default_value), val, bandm)
        else:
            mixed = nb.mixf(old if old is not None else s.default_value, val, bandm)
        nb.feed(s, mixed)
    return mat
