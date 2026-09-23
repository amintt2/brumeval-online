"""Procedural alpha-card foliage atlases for the nature group (shader nodes, baked by kit.bake as 'tile' groups).

Every card material is a 2x2 atlas in UV space:
    columns = two layouts (the right column is the left one mirrored + re-seeded shades)
    rows    = v < 0.5 : INNER / shaded variant (darker, cooler: used deep inside the canopy -> fake canopy AO)
              v > 0.5 : OUTER / sunlit variant
Card meshes pick a quadrant with their UVs (see nature_lib.card_template).

Shapes are drawn with node math (no image input):
    * explicit leaves  : each leaf = lanceolate/lobed profile around its own axis, layered in draw order
    * fishbone sprays  : needles / leaflets / hanging willow leaves as periodic patterns along twig segments
    * twigs            : distance-to-segment strokes
    * blades / flowers : grass & reed blades (periodic), flower heads (polar petals), cattails
The shader composes a few accumulators (mask, along-leaf T, across-leaf X, shade S, layer height H) and derives
colour / roughness / bump ONCE from them, so a card with 30 leaves stays a few hundred nodes.
Material names start with Leaf / Foliage / Grass so the client's wind shader moves them.
"""
import math
import random

from kit import materials as M
from kit.nodes import sock

TAU = math.tau


# =============================================================================== small node helpers
class Card:
    """Accumulator state for one card graph."""

    def __init__(self, name, kind, grid=2):
        self.m, self.nb, self.bsdf = M._new(name, "card_" + kind, bake_mode="tile", alpha=True)
        nb = self.nb
        uv = nb.node("ShaderNodeTexCoord").outputs["UV"]
        s = nb.sep(uv)
        u, v = nb.mul(s[0], grid), nb.mul(s[1], grid)
        self.col_id = nb.math("FLOOR", u)
        self.row_id = nb.math("FLOOR", v)
        lu = nb.math("FRACT", u)
        self.lv = nb.math("FRACT", v)
        odd = nb.math("MODULO", self.col_id, 2.0)
        self.lu = nb.mixf(lu, nb.sub(1.0, lu), odd)            # right column = mirrored layout
        self.odd = odd
        self.p = nb.xyz(self.lu, self.lv, 0.0)
        self.mask = 0.0          # leaf mask
        self.T = 0.0             # along-leaf 0 (base) .. 1 (tip)
        self.X = 0.0             # across-leaf 0 (midrib) .. 1 (edge)
        self.S = 0.0             # per-leaf random shade 0..1
        self.H = 0.0             # layer height (draw order)
        self.K = 0.0             # leaf kind channel (0 leaf, 1 = secondary: berries / flowers / heads)
        self.twig = 0.0          # twig/stem mask (under the leaves)
        self.n_layers = 0

    # -------------------------------------------------------------- compose
    def put(self, inside, T, X, S, kind=0.0, layer=None):
        nb = self.nb
        self.n_layers += 1
        h = layer if layer is not None else min(1.0, 0.25 + self.n_layers * 0.02)
        if isinstance(self.mask, float):
            self.mask = inside
        else:
            self.mask = nb.math("MAXIMUM", self.mask, inside)
        self.T = nb.mixf(self.T, T, inside)
        self.X = nb.mixf(self.X, X, inside)
        self.S = nb.mixf(self.S, S, inside)
        self.H = nb.mixf(self.H, h, inside)
        if kind or not isinstance(self.K, float):
            self.K = nb.mixf(self.K, kind, inside)

    def add_twig(self, m):
        if isinstance(self.twig, float):
            self.twig = m
        else:
            self.twig = self.nb.math("MAXIMUM", self.twig, m)


def _lt(nb, a, b):
    return nb.math("LESS_THAN", a, b)


def _gt(nb, a, b):
    return nb.math("GREATER_THAN", a, b)


def _between01(nb, t):
    """1 where 0 < t < 1."""
    return _lt(nb, nb.math("ABSOLUTE", nb.sub(t, 0.5)), 0.5)


def _local(nb, p, base, ang):
    """(along, across) coordinates of point p in a frame at `base` rotated by `ang`."""
    d = nb.vmath("SUBTRACT", p, (base[0], base[1], 0.0))
    ly = nb.vmath("DOT_PRODUCT", d, (math.cos(ang), math.sin(ang), 0.0))
    lx = nb.vmath("DOT_PRODUCT", d, (-math.sin(ang), math.cos(ang), 0.0))
    return ly, lx


def leaf(c, base, ang, L, W, shade, lobes=0.0, lobe_n=4, power=0.75, tipw=0.9, kind=0.0):
    """One leaf: base point, direction angle, length L, half-width W (card units 0..1)."""
    nb = c.nb
    ly, lx = _local(nb, c.p, base, ang)
    t = nb.mul(ly, 1.0 / L)
    tc = nb.clamp01(t)
    prof = nb.math("POWER", nb.math("SINE", nb.mul(nb.math("POWER", tc, tipw), math.pi)), power)
    if lobes > 0:
        lob = nb.math("ABSOLUTE", nb.math("SINE", nb.mul(tc, math.pi * lobe_n)))
        prof = nb.mul(prof, nb.add(1.0 - lobes, nb.mul(lob, lobes)))
    wd = nb.mul(prof, W)
    ax = nb.math("ABSOLUTE", lx)
    X = nb.math("DIVIDE", ax, nb.math("MAXIMUM", wd, 1e-4))
    inside = nb.mul(_lt(nb, X, 1.0), _between01(nb, t))
    c.put(inside, tc, nb.clamp01(X), shade, kind)


def twig(c, a, b, w0, w1=None):
    """Stroke from a to b, half-width w0 -> w1."""
    nb = c.nb
    w1 = w0 * 0.5 if w1 is None else w1
    dx, dy = b[0] - a[0], b[1] - a[1]
    ln = math.hypot(dx, dy)
    ang = math.atan2(dy, dx)
    ly, lx = _local(nb, c.p, a, ang)
    t = nb.clamp01(nb.mul(ly, 1.0 / ln))
    # distance to the segment
    along = nb.sub(ly, nb.mul(t, ln))
    dist = nb.vmath("LENGTH", nb.xyz(along, lx, 0.0))
    w = nb.add(w0, nb.mul(t, w1 - w0))
    c.add_twig(_lt(nb, dist, w))


def fishbone(c, a, b, leaf_len, spacing, slant=0.6, width=0.35, shape="needle", taper=0.5, seed=0, stem=0.006,
             sides=2, gap=0.0, start=0.04):
    """Periodic leaves/needles on both sides of the segment a->b.
    leaf_len: needle/leaflet length (card units) at the base, shrinking by `taper` toward b.
    spacing: distance between successive leaves along the stem. slant: forward lean (0 = perpendicular).
    width: leaf thickness as a fraction of the spacing. shape: 'needle' (constant) / 'leaf' (lanceolate).
    gap: 0..1 probability of a missing leaflet (torn palm fronds)."""
    nb = c.nb
    dx, dy = b[0] - a[0], b[1] - a[1]
    ln = math.hypot(dx, dy)
    ang = math.atan2(dy, dx)
    ly, lx = _local(nb, c.p, a, ang)
    s = nb.mul(ly, 1.0 / ln)                                      # 0..1 along the stem
    ax = nb.math("ABSOLUTE", lx)
    if sides == 1:
        ax = nb.math("MAXIMUM", lx, 0.0)
    L = nb.mul(leaf_len, nb.sub(1.0, nb.mul(nb.clamp01(s), taper)))
    rr = nb.math("DIVIDE", ax, L)                                 # 0 at the stem .. 1 at the leaf tip
    ph = nb.mul(nb.sub(ly, nb.mul(ax, slant)), 1.0 / spacing)     # leaf index coordinate (slanted)
    cell = nb.math("FLOOR", ph)
    side = _gt(nb, lx, 0.0)
    wn = nb.node("ShaderNodeTexWhiteNoise", {"noise_dimensions": "1D"}, W=nb.add(nb.add(cell, nb.mul(side, 37.0)), seed * 1.37))
    rnd = wn.outputs["Value"]
    f = nb.sub(nb.math("FRACT", ph), 0.5)
    if shape == "needle":
        thick = nb.mul(width * 0.5, nb.sub(1.0, nb.mul(rr, 0.6)))
    else:
        thick = nb.mul(width * 0.5, nb.math("POWER", nb.math("SINE", nb.mul(nb.clamp01(nb.math("POWER", rr, 0.8)), math.pi)), 0.8))
    rr_ok = _lt(nb, rr, nb.add(0.75, nb.mul(rnd, 0.25)))           # uneven leaf lengths
    inside = nb.mul(nb.mul(_lt(nb, nb.math("ABSOLUTE", f), thick), rr_ok), _between01(nb, nb.mul(nb.sub(s, start), 1.0 / (1.0 - start))))
    if gap > 0:
        inside = nb.mul(inside, _gt(nb, rnd, gap))
    X = nb.clamp01(nb.math("DIVIDE", nb.math("ABSOLUTE", f), nb.math("MAXIMUM", thick, 1e-4)))
    c.put(inside, nb.clamp01(rr), X, rnd)
    if stem > 0:
        twig(c, a, b, stem, stem * 0.4)


def blades(c, n, h_min=0.55, h_max=1.0, width=0.42, lean=0.9, seed=0, u0=0.0, u1=1.0, shade_off=0.0):
    """Vertical grass/reed blades across the card (periodic in u), tapering to their random tip height."""
    nb = c.nb
    uu = nb.mul(nb.sub(c.lu, u0), 1.0 / (u1 - u0))
    inside_u = _between01(nb, uu)
    cell = nb.math("FLOOR", nb.mul(uu, n))
    rnd = nb.node("ShaderNodeTexWhiteNoise", {"noise_dimensions": "1D"}, W=nb.add(cell, seed * 1.31)).outputs["Value"]
    rnd2 = nb.node("ShaderNodeTexWhiteNoise", {"noise_dimensions": "1D"}, W=nb.add(cell, seed * 2.71 + 11.0)).outputs["Value"]
    lu = nb.sub(nb.math("FRACT", nb.mul(uu, n)), 0.5)
    top = nb.add(h_min, nb.mul(rnd, h_max - h_min))
    t = nb.math("DIVIDE", c.lv, top)
    bend = nb.mul(nb.mul(nb.sub(rnd2, 0.5), lean), nb.mul(t, t))     # blades curve sideways toward the tip
    w = nb.mul(width, nb.math("POWER", nb.clamp01(nb.sub(1.0, t)), 0.6))
    X = nb.math("DIVIDE", nb.math("ABSOLUTE", nb.sub(lu, bend)), nb.math("MAXIMUM", w, 1e-4))
    inside = nb.mul(nb.mul(_lt(nb, X, 1.0), _between01(nb, t)), inside_u)
    c.put(inside, nb.clamp01(t), nb.clamp01(X), nb.clamp01(nb.add(rnd2, shade_off)))


def flower(c, centre, R, petals=5, shade=0.5, kind=1.0, heart=0.3, stem_to=None, stem_w=0.006):
    """Flower head seen from the side-front: polar petals around `centre`. kind > 0 -> flower palette."""
    nb = c.nb
    if stem_to is not None:
        twig(c, stem_to, centre, stem_w, stem_w * 0.8)
    d = nb.vmath("SUBTRACT", c.p, (centre[0], centre[1], 0.0))
    ds = nb.sep(d)
    r = nb.vmath("LENGTH", d)
    th = nb.math("ARCTAN2", ds[1], ds[0])
    pet = nb.math("ABSOLUTE", nb.math("COSINE", nb.mul(th, petals * 0.5)))
    rad = nb.mul(R, nb.add(0.45, nb.mul(nb.math("POWER", pet, 0.6), 0.55)))
    X = nb.math("DIVIDE", r, rad)
    inside = _lt(nb, X, 1.0)
    T = nb.clamp01(nb.maprange(X, heart, heart + 0.05, 0.0, 1.0))   # 0 = heart, 1 = petal
    c.put(inside, T, nb.clamp01(X), shade, kind)


def blob(c, centre, R, shade=0.5, kind=1.0, squash=1.0):
    """Round berry / cattail segment: X = radial distance (0 centre .. 1 rim)."""
    nb = c.nb
    d = nb.vmath("MULTIPLY", nb.vmath("SUBTRACT", c.p, (centre[0], centre[1], 0.0)), (1.0, 1.0 / squash, 1.0))
    X = nb.math("DIVIDE", nb.vmath("LENGTH", d), R)
    inside = _lt(nb, X, 1.0)
    c.put(inside, nb.clamp01(nb.sub(1.0, X)), nb.clamp01(X), shade, kind)


def capsule(c, a, b, R, shade=0.5, kind=1.0):
    """Cattail head: a rounded thick segment."""
    nb = c.nb
    dx, dy = b[0] - a[0], b[1] - a[1]
    ln = math.hypot(dx, dy)
    ly, lx = _local(nb, c.p, a, math.atan2(dy, dx))
    t = nb.clamp01(nb.mul(ly, 1.0 / ln))
    along = nb.sub(ly, nb.mul(t, ln))
    X = nb.math("DIVIDE", nb.vmath("LENGTH", nb.xyz(along, lx, 0.0)), R)
    inside = _lt(nb, X, 1.0)
    c.put(inside, t, nb.clamp01(X), shade, kind)


# =============================================================================== finishing (colour / height from the accumulators)
def finish(c, pal, twig_col="#3b2a1c", pal2=None, rough=0.6, row_dark=0.5, row_tint="#1a2416", veins=1.0,
           edge_dark=0.25, spec=0.35, dome=1.0, cluster_mask=None, sheen=None):
    """pal: leaf palette (list of hex, ramp over S). pal2: palette of 'kind 1' elements (berries/flowers/heads),
    ramp over S as well. Row 0 (inner variant) is darkened by row_dark and tinted cool."""
    nb = c.nb
    S, T, X = c.S, c.T, c.X
    col = M._pal(nb, S, pal)
    col = nb.mix(col, nb.mix(col, "#000000", 0.45), nb.mul(nb.sub(1.0, T), 0.35))     # darker near the leaf base
    col = nb.mix(col, nb.mix(col, "#0d0f05", 0.5), nb.mul(nb.maprange(X, 0.75, 1.0), edge_dark))
    vein = 0.0
    if veins > 0:
        mid = nb.maprange(X, 0.0, 0.09, 1.0, 0.0)
        lat = nb.maprange(nb.math("ABSOLUTE", nb.sub(nb.math("FRACT", nb.sub(nb.mul(T, 7.0), nb.mul(X, 1.4))), 0.5)), 0.44, 0.5)
        vein = nb.mul(nb.math("MAXIMUM", mid, nb.mul(lat, nb.maprange(X, 0.1, 0.8, 0.8, 0.0))), veins)
        col = nb.mix(col, nb.mix(col, "#9aa266", 0.35), nb.mul(vein, 0.45))   # subtle veins (no yellow grid)
    if sheen is not None:
        col = nb.mix(col, sheen, nb.mul(nb.maprange(X, 0.2, 0.7, 0.35, 0.0), nb.maprange(T, 0.3, 0.9)))
    if pal2 is not None and not isinstance(c.K, float):
        col2 = M._pal(nb, S, pal2)
        col2 = nb.mix(col2, nb.mix(col2, "#000000", 0.55), nb.mul(nb.maprange(X, 0.6, 1.0), 0.6))  # shaded rims
        col2 = nb.mix(col2, nb.mix(col2, "#ffffff", 0.35), nb.mul(nb.maprange(X, 0.35, 0.0), 0.5))  # highlight
        col = nb.mix(col, col2, c.K)
    # twigs under everything
    mask = c.mask
    if not isinstance(c.twig, float):
        tw_only = nb.mul(c.twig, nb.sub(1.0, mask))
        col = nb.mix(col, twig_col, tw_only)
        mask = nb.math("MAXIMUM", mask, c.twig)
    else:
        tw_only = 0.0
    if cluster_mask is not None:
        mask = nb.mul(mask, cluster_mask)
    # inner variant (row 0): darker + cooler -> fake canopy occlusion
    inner = nb.sub(1.0, nb.math("MINIMUM", c.row_id, 1.0))
    col = nb.mix(col, nb.mix(nb.mix(col, row_tint, 0.35), "#000000", row_dark), inner)
    # height -> baked normal map: dome per leaf + layer steps + veins grooves
    h = nb.add(nb.mul(nb.sub(1.0, nb.mul(X, X)), 0.5 * dome), nb.mul(c.H, 0.8))
    if veins > 0:
        h = nb.sub(h, nb.mul(vein, 0.25))
    if not isinstance(tw_only, float):
        h = nb.mixf(h, 0.35, tw_only)
    rg = nb.mixf(rough, 0.85, tw_only) if not isinstance(tw_only, float) else rough
    c.m["kit_alpha_cutoff"] = 0.5
    alpha = _gt(nb, mask, 0.5)
    return M._finish(c.m, nb, c.bsdf, col, rg, h, alpha=alpha, bump=0.7, bump_dist=0.004, spec=spec)


# =============================================================================== layouts
def _spray_layout(rnd, n_leaves, L=(0.2, 0.28), W=(0.08, 0.1), stem_top=0.8, side_twigs=3, spread=1.0, droop=0.0):
    """A branch spray entering from the bottom centre: main stem + side twigs, leaves at twig nodes.
    Returns (twigs[(a,b,w)], leaves[(base, ang, L, W, shade)])."""
    twigs, leaves = [], []
    main = [(0.5, 0.0)]
    x, y = 0.5, 0.0
    for i in range(4):
        x += rnd.uniform(-0.05, 0.05)
        y += stem_top / 4
        main.append((x, y))
    for a, b in zip(main, main[1:]):
        twigs.append((a, b, 0.012))
    anchors = [(p, math.pi / 2) for p in main[1:]]
    for k in range(side_twigs):
        p = main[1 + k % (len(main) - 1)]
        sgn = 1 if k % 2 == 0 else -1
        ang = math.pi / 2 + sgn * rnd.uniform(0.6, 1.0) * spread
        ln = rnd.uniform(0.18, 0.3)
        q = (p[0] + math.cos(ang) * ln, p[1] + math.sin(ang) * ln - droop * ln)
        twigs.append((p, q, 0.008))
        anchors.append((q, math.atan2(q[1] - p[1], q[0] - p[0])))
        anchors.append((((p[0] + q[0]) / 2, (p[1] + q[1]) / 2), ang))
    for i in range(n_leaves):
        (ax, ay), a0 = anchors[i % len(anchors)]
        ang = a0 + rnd.uniform(-0.9, 0.9) * spread - droop * 0.6
        ll = rnd.uniform(*L)
        ww = rnd.uniform(*W)
        bx, by = ax + rnd.uniform(-0.03, 0.03), ay + rnd.uniform(-0.03, 0.03)
        # keep the leaf inside the card
        tx, ty = bx + math.cos(ang) * ll, by + math.sin(ang) * ll
        if not (0.03 < tx < 0.97 and 0.03 < ty < 0.97):
            ang = math.atan2(0.5 - by, 0.5 - bx) + rnd.uniform(-0.5, 0.5)
            ll *= 0.8
        leaves.append(((bx, by), ang, ll, ww, rnd.random()))
    return twigs, leaves


def broadleaf(name="Leaf_oak", kind="oak", pal=None, seed=0, n=18):
    """Oak / birch / bush leaf spray. kind: oak (lobed), birch (small serrated), bush (small + berries), round."""
    rnd = random.Random(seed)
    c = Card(name, kind)
    tipw = 0.9
    if kind == "oak":
        tw, lv = _spray_layout(rnd, n, L=(0.13, 0.19), W=(0.05, 0.068), side_twigs=7)
        lobes, lobe_n, power = 0.4, 4, 0.7
    elif kind == "birch":
        tw, lv = _spray_layout(rnd, n, L=(0.13, 0.19), W=(0.055, 0.075), side_twigs=6, droop=0.35)
        lobes, lobe_n, power, tipw = 0.1, 11, 0.95, 0.55
    elif kind == "bush":
        tw, lv = _spray_layout(rnd, n, L=(0.13, 0.19), W=(0.055, 0.075), side_twigs=6)
        lobes, lobe_n, power, tipw = 0.0, 0, 0.85, 0.7
    else:
        tw, lv = _spray_layout(rnd, n, L=(0.16, 0.24), W=(0.08, 0.11), side_twigs=5)
        lobes, lobe_n, power = 0.0, 0, 0.7
    for a, b, w in tw:
        twig(c, a, b, w, w * 0.6)
    # draw far/lower leaves first so upper ones overlap them
    for base, ang, L, W, sh in sorted(lv, key=lambda l: -l[0][1]):
        leaf(c, base, ang, L, W, sh, lobes=lobes, lobe_n=lobe_n, power=power, tipw=tipw)
    pal2 = None
    if kind == "bush":
        for i in range(7):
            cx, cy = rnd.uniform(0.25, 0.75), rnd.uniform(0.3, 0.8)
            for j in range(rnd.randint(2, 4)):
                blob(c, (cx + rnd.uniform(-0.035, 0.035), cy + rnd.uniform(-0.035, 0.035)), rnd.uniform(0.018, 0.026),
                     shade=rnd.random(), kind=1.0)
        pal2 = ["#4a0b10", "#8e1620", "#b8322a"]
    pal = pal or {"oak": ["#1b2a13", "#2a3c19", "#3b4c1f", "#515a25"],
                  "birch": ["#3d5220", "#5a7428", "#7f8f33", "#a5a043"],
                  "bush": ["#1a2c16", "#26391b", "#354a21", "#485726"]}.get(kind, ["#2a3a1c", "#46602a"])
    return finish(c, pal, pal2=pal2, twig_col="#3a2a1d", rough=0.68, spec=0.3)


def pine_frond(name="Leaf_pine", seed=0, snow=0.0, pal=None):
    """Conifer spray: main twig + side twigs covered in needles (fishbone). snow > 0 adds snow clumps on top."""
    rnd = random.Random(seed)
    c = Card(name, "pine")
    main_a, main_b = (0.5, 0.02), (0.5 + rnd.uniform(-0.04, 0.04), 0.95)
    sides = []
    for k in range(6):
        t = 0.12 + k * 0.13
        px = main_a[0] + (main_b[0] - main_a[0]) * t
        py = main_a[1] + (main_b[1] - main_a[1]) * t
        sgn = 1 if k % 2 == 0 else -1
        ang = math.pi / 2 + sgn * rnd.uniform(0.75, 1.0)
        ln = (0.36 - 0.03 * k) * rnd.uniform(0.9, 1.1)
        sides.append(((px, py), (px + math.cos(ang) * ln, py + math.sin(ang) * ln)))
    for k, (a, b) in enumerate(sides):
        fishbone(c, a, b, leaf_len=0.1, spacing=0.0085, slant=0.8, width=0.6, shape="needle", taper=0.45,
                 seed=seed + k, stem=0.007)
    fishbone(c, main_a, main_b, leaf_len=0.11, spacing=0.0085, slant=0.8, width=0.6, shape="needle", taper=0.5,
             seed=seed + 20, stem=0.011)
    pal = pal or ["#0e2016", "#163020", "#21402a", "#2f5234"]
    m = finish(c, pal, twig_col="#3d2a1b", rough=0.62, veins=0.0, edge_dark=0.1, dome=0.6, row_dark=0.5)
    if snow > 0:
        _add_card_snow(m, c, snow, seed)
    return m


def _add_card_snow(m, c, amount, seed):
    """Lumpy snow clumps resting on the spray (drawn over needles, extending the alpha mask a little)."""
    nb = c.nb
    bsdf = c.bsdf
    n = nb.noise(nb.vmath("MULTIPLY", c.p, (7.0, 7.0, 1.0)), 1.0, 4.0, 0.6).outputs["Fac"]
    blobs = nb.voronoi(nb.vmath("MULTIPLY", c.p, (6.0, 6.0, 1.0)), 1.0, "SMOOTH_F1", smooth=0.8).outputs["Distance"]
    sm = nb.mul(nb.maprange(nb.add(nb.mul(n, 0.6), nb.mul(nb.sub(0.6, blobs), 0.8)), 0.55 - 0.25 * amount, 0.62 - 0.25 * amount),
                nb.maprange(c.lv, 0.05, 0.25))
    sm = nb.mul(sm, _gt(nb, c.mask if not isinstance(c.mask, float) else 0.0, 0.5))
    base_in = sock(bsdf.inputs, "Base Color")
    prev = base_in.links[0].from_socket
    snowc = nb.mix("#dfe7ef", "#a9bccf", nb.maprange(n, 0.3, 0.7))
    inner = nb.sub(1.0, nb.math("MINIMUM", c.row_id, 1.0))
    snowc = nb.mix(snowc, nb.mix(snowc, "#5a6a80", 0.45), inner)
    nb.feed(base_in, nb.mix(prev, snowc, sm))
    r_in = sock(bsdf.inputs, "Roughness")
    if r_in.is_linked:
        nb.feed(r_in, nb.mixf(r_in.links[0].from_socket, 0.5, sm))
    else:
        nb.feed(r_in, nb.mixf(r_in.default_value, 0.5, sm))


def palm_frond(name="Leaf_palm", seed=0, pal=None):
    """Palm frond strip texture: rachis along the card's V axis, long pointed leaflets on both sides (some torn).
    The frond mesh is a long curved strip that maps V = 0 (base) .. 1 (tip) in each quadrant."""
    c = Card(name, "palm")
    fishbone(c, (0.5, 0.0), (0.5, 1.0), leaf_len=0.47, spacing=0.034, slant=0.55, width=0.8, shape="leaf",
             taper=0.75, seed=seed, stem=0.018, gap=0.12, start=0.06)
    pal = pal or ["#2c3d17", "#40561d", "#5f6c26", "#7b7432"]
    return finish(c, pal, twig_col="#6b5a34", rough=0.5, veins=0.6, edge_dark=0.4, dome=0.5)


def willow_strands(name="Leaf_willow", seed=0, pal=None):
    """Hanging willow curtain: 4 thin twigs from the top edge hanging down, narrow leaves along them."""
    rnd = random.Random(seed)
    c = Card(name, "willow")
    for k in range(4):
        x0 = 0.14 + k * 0.24 + rnd.uniform(-0.04, 0.04)
        x1 = x0 + rnd.uniform(-0.08, 0.08)
        y1 = rnd.uniform(0.02, 0.2)
        fishbone(c, (x0, 1.0), (x1, y1), leaf_len=0.085, spacing=0.03, slant=-1.2, width=0.9, shape="leaf",
                 taper=0.3, seed=seed + k * 7, stem=0.005)
    pal = pal or ["#3a4a1d", "#56672a", "#768034", "#94903f"]
    return finish(c, pal, twig_col="#4a3b25", rough=0.55, veins=0.4, dome=0.5, row_dark=0.5)


def hanging_moss(name="Foliage_moss", seed=0):
    """Grey-green hanging (Spanish) moss strands for dead / swamp trees."""
    c = Card(name, "hangmoss")
    rnd = random.Random(seed)
    nb = c.nb
    for k in range(6):
        x0 = 0.1 + k * 0.16 + rnd.uniform(-0.03, 0.03)
        y1 = rnd.uniform(0.05, 0.45)
        fishbone(c, (x0, 1.0), (x0 + rnd.uniform(-0.05, 0.05), y1), leaf_len=0.05, spacing=0.012, slant=-1.8,
                 width=0.5, shape="needle", taper=0.2, seed=seed + k, stem=0.008)
    return finish(c, ["#3c4232", "#5b604a", "#7c7c62", "#8e8a6c"], twig_col="#4a4a3a", rough=0.85, veins=0.0,
                  dome=0.3, row_dark=0.45)


def twig_card(name="Foliage_twigs", seed=0, col="#3e3934"):
    """Bare fine twigs (dead tree crown detail): recursive forks from the bottom centre."""
    rnd = random.Random(seed)
    c = Card(name, "twigs")

    def grow(p, ang, ln, w, depth):
        q = (p[0] + math.cos(ang) * ln, p[1] + math.sin(ang) * ln)
        q = (min(0.97, max(0.03, q[0])), min(0.97, max(0.03, q[1])))
        twig(c, p, q, w, w * 0.65)
        if depth <= 0:
            return
        for s in (-1, 1):
            if rnd.random() < 0.9:
                grow(q, ang + s * rnd.uniform(0.3, 0.7), ln * rnd.uniform(0.6, 0.78), w * 0.62, depth - 1)
    grow((0.5, 0.0), math.pi / 2 + rnd.uniform(-0.15, 0.15), 0.3, 0.016, 4)
    c.mask = 0.0
    m = finish(c, ["#000000", "#000000"], twig_col=col, rough=0.85, veins=0.0, dome=0.0, row_dark=0.35)
    return m


def meadow(name="Grass_flowers", seed=0, flowers=True, pal=None):
    """Grass blades + flower heads (left column: grass only, right column: grass with flowers)."""
    rnd = random.Random(seed)
    c = Card(name, "meadow")
    nb = c.nb
    blades(c, 23, 0.3, 0.8, width=0.3, lean=1.3, seed=seed + 5, shade_off=-0.2)     # back layer, shorter
    blades(c, 15, 0.45, 0.95, width=0.3, lean=1.6, seed=seed)
    if flowers:
        heads = [("#e8e2d0", 6), ("#d9b43a", 5), ("#7d5aa8", 5), ("#4f6fb3", 6), ("#c8452f", 5)]
        pal2 = []
        for i in range(7):
            x = 0.1 + i * 0.13 + rnd.uniform(-0.03, 0.03)
            y = rnd.uniform(0.55, 0.9)
            k = i % len(heads)
            # stem (only drawn in the flower column): encode by making the flower only exist where odd == 1
            flower(c, (x, y), rnd.uniform(0.045, 0.065), petals=heads[k][1], shade=(k + 0.5) / len(heads), kind=1.0,
                   stem_to=(x + rnd.uniform(-0.03, 0.03), 0.0), stem_w=0.006)
        pal2 = ["#e8e2d0", "#d9b43a", "#7d5aa8", "#4f6fb3", "#c8452f"]
        # the flower column only: kill flowers (K=1) and stems in the grass-only column
        colmask = c.odd
        c.mask = nb.mul(c.mask, nb.sub(1.0, nb.mul(_gt(nb, c.K, 0.5), nb.sub(1.0, colmask))))
        c.twig = nb.mul(c.twig, colmask)
    else:
        pal2 = None
    pal = pal or ["#2c461b", "#436426", "#617f30", "#8a9544"]
    return finish(c, pal, pal2=pal2, twig_col="#3e5222", rough=0.62, veins=0.0, edge_dark=0.1, dome=0.5,
                  row_dark=0.18)


def reeds(name="Grass_reeds", seed=0):
    """Tall reed blades + cattail heads (right column) for swamp edges."""
    rnd = random.Random(seed)
    c = Card(name, "reeds")
    nb = c.nb
    blades(c, 7, 0.6, 1.0, width=0.3, lean=0.6, seed=seed)
    for i in range(3):
        x = 0.2 + i * 0.3 + rnd.uniform(-0.05, 0.05)
        y0 = rnd.uniform(0.62, 0.72)
        twig(c, (x, 0.0), (x, y0 + 0.24), 0.007, 0.005)
        capsule(c, (x, y0), (x, y0 + 0.15), 0.028, shade=rnd.random(), kind=1.0)
    colmask = c.odd
    c.mask = nb.mul(c.mask, nb.sub(1.0, nb.mul(_gt(nb, c.K, 0.5), nb.sub(1.0, colmask))))
    c.twig = nb.mul(c.twig, colmask)
    return finish(c, ["#3a4520", "#56602c", "#7a7a3c", "#9a8f55"], pal2=["#3a2414", "#5a3a20", "#6e4a2a"],
                  twig_col="#66663a", rough=0.6, veins=0.0, edge_dark=0.15, dome=0.4, row_dark=0.4)
