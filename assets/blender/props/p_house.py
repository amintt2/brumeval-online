"""Dwellings: swamp_hut (stilt hut of the Brume marshes) and snow_cabin (log cabin of the Givre peaks).

Built at game resolution (real boards / logs / posts as bevelled geometry), procedural shader materials baked
straight onto the mesh. Board walls and decks are laid with the kit's Geometry-Nodes instance_on_curve (row()),
icicles too; reeds are a GN scatter; the snow blanket is a voxel-fused, GN-displaced slab. Front = -Y.
"""
import math
import random

import pk
from pk import M, V, gn
from p_dwell import board_tpl, log, row


def slab(name, corners, thick, mat, nu=8, nv=6):
    """Thick quad slab from 4 corners, subdivided nu x nv, extruded along its normal by `thick`."""
    c = [V(p) for p in corners]
    n = (c[1] - c[0]).cross(c[3] - c[0]).normalized()
    verts, faces = [], []
    for off in (0.0, thick):
        for j in range(nv + 1):
            for i in range(nu + 1):
                u, v = i / nu, j / nv
                p = (c[0] * (1 - u) + c[1] * u) * (1 - v) + (c[3] * (1 - u) + c[2] * u) * v
                verts.append(p + n * off)
    W = nu + 1
    L = W * (nv + 1)
    for j in range(nv):
        for i in range(nu):
            a = j * W + i
            faces.append((a, a + W, a + W + 1, a + 1))
            faces.append((L + a, L + a + 1, L + a + W + 1, L + a + W))
    for i in range(nu):
        faces.append((i, i + 1, L + i + 1, L + i))
        a, b = nv * W + i, nv * W + i + 1
        faces.append((b, a, L + a, L + b))
    for j in range(nv):
        a, b = j * W, (j + 1) * W
        faces.append((b, a, L + a, L + b))
        a, b = j * W + nu, (j + 1) * W + nu
        faces.append((a, b, L + b, L + a))
    ob = pk.mesh_obj(name, verts, faces, mat, smooth=True)
    pk.clean(ob)
    return ob


def reeds(r_in, r_out, density, seed, sx=1.0, sy=1.0, h=0.95, exclude=None, name="GrassReeds"):
    mat = M.leaf_card(name, kind="grass", color="#4b5424", color2="#8c8446", seed=seed)
    card = pk.card_template("_ReedTpl", 0.3, h, mat, crossed=2, bend=0.18, segs=2)
    disc = pk.ground_disc("ReedTarget", r_in, r_out, 0.0)
    disc.scale = (sx, sy, 1.0)
    pk.C.apply_transforms(disc)
    g = pk.scatter_cards(disc, card, density, seed, scale=(0.6, 1.25), name="Reeds", patchy=1.6)
    if exclude is not None:
        pk.exclude_faces(g, exclude)
    return g


def lantern(name, loc, glow_mat, iron):
    """Small iron lantern with an emissive glass core (own glow material)."""
    x, y, z = loc
    body = [pk.cyl(name + "Glass", 0.07, 0.16, loc, verts=8, mat=glow_mat),
            pk.cyl(name + "Cap", 0.1, 0.05, (x, y, z + 0.1), verts=8, mat=iron, r2=0.03),
            pk.cyl(name + "Base", 0.09, 0.03, (x, y, z - 0.095), verts=8, mat=iron)]
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        body.append(pk.beam(name + f"Bar{k}", (x + math.cos(a) * 0.075, y + math.sin(a) * 0.075, z - 0.09),
                            (x + math.cos(a) * 0.075, y + math.sin(a) * 0.075, z + 0.09), 0.008, verts=4, mat=iron))
    body.append(pk.C.torus(name + "Ring", major=0.03, minor=0.006, seg=8, minor_seg=4, mat=iron,
                           loc=(x, y, z + 0.155), rot=(math.pi / 2, 0, 0)))
    return body


def stone_stack(cx, cy, w, d, z0, z1, mat, seed=0, course=0.3):
    """Dry-stone chimney: courses of irregular chamfered blocks around a hollow core, alternating joints."""
    rnd = random.Random(seed)
    out = []
    z = z0
    k = 0
    hw, hd, t = w / 2, d / 2, 0.2
    while z < z1 - 1e-3:
        h = min(course * rnd.uniform(0.8, 1.15), z1 - z)
        ins = 0.03 * (z / z1)                           # slight taper towards the top
        if k % 2 == 0:
            spans = [(-hw + ins, hw - ins, -hd + ins, -hd + ins + t), (-hw + ins, hw - ins, hd - ins - t, hd - ins),
                     (-hw + ins, -hw + ins + t, -hd + ins + t, hd - ins - t), (hw - ins - t, hw - ins, -hd + ins + t, hd - ins - t)]
        else:
            spans = [(-hw + ins, -hw + ins + t, -hd + ins, hd - ins), (hw - ins - t, hw - ins, -hd + ins, hd - ins),
                     (-hw + ins + t, hw - ins - t, -hd + ins, -hd + ins + t), (-hw + ins + t, hw - ins - t, hd - ins - t, hd - ins)]
        for j, (xa, xb, ya, yb) in enumerate(spans):
            j0 = rnd.uniform(-0.012, 0.012)
            out.append(pk.block(f"Chim{k}_{j}", cx + xa + j0, cx + xb + j0, cy + ya + j0, cy + yb - j0, z, z + h,
                                chamfer=0.03, mat=mat, jitter=0.02, seed=seed + k * 5 + j))
        z += h
        k += 1
    return out


def footing_run(xa, xb, ya, yb, mat, seed=0, h=0.4):
    """One side of a stone footing: a row of rough blocks along the longer axis."""
    rnd = random.Random(seed)
    out = []
    along_x = (xb - xa) >= (yb - ya)
    a0, a1 = (xa, xb) if along_x else (ya, yb)
    p = a0
    while p < a1 - 1e-3:
        L = min(rnd.uniform(0.35, 0.6), a1 - p)
        if a1 - (p + L) < 0.15:
            L = a1 - p
        hh = h * rnd.uniform(0.85, 1.05)
        if along_x:
            out.append(pk.block("Foot", p + 0.008, p + L - 0.008, ya, yb, -0.05, hh, chamfer=0.035, mat=mat, jitter=0.03,
                                seed=seed + len(out)))
        else:
            out.append(pk.block("Foot", xa, xb, p + 0.008, p + L - 0.008, -0.05, hh, chamfer=0.035, mat=mat, jitter=0.03,
                                seed=seed + len(out)))
        p += L
    return out


# =============================================================================== swamp_hut
def build_swamp_hut(args):
    """Stilt hut (≈4.6 x 5 m, 4.8 m tall): crooked log stilts, plank deck with front porch and ladder, board walls
    with door + window, sagging reed-thatch roof with moss, hanging lantern, reeds around the stilts."""
    rnd = random.Random(3)
    wet = M.wood("WetWood", color="#4d3d2c", color2="#241a12", seed=2, axis="Z", moss=0.35, weathered=0.45,
                 wear=0.35, dirt=0.7)
    pk.overlay_ground_dirt(wet, "#2a2418", 0.9, 0.85, 2)              # water / mud line on the stilts
    board_v = M.wood("BoardWood", color="#5c4a36", color2="#2d2218", seed=5, axis="Z", moss=0.25, weathered=0.55)
    board_h = M.wood("DeckWood", color="#5a4734", color2="#2b2017", seed=6, axis="Y", moss=0.3, weathered=0.5,
                     dirt=0.7)
    thatch = M.thatch("ReedThatch", color="#6f5f3c", seed=3, axis="Y", moss=0.55, dirt=0.6)
    rope = M.leather("Rope", color="#6b5a3e", seed=2)
    iron = M.metal("Iron", kind="blackiron", rust=0.6, seed=3)
    glow = M.emissive("GlowLantern", color="#ffb35a", strength=6.0)
    glow["kit_group"] = "GlowLantern"
    DZ = 1.35
    objs = []
    xs, ys = (-1.85, 0.0, 1.85), (-2.25, -0.25, 1.65)
    for ix, x in enumerate(xs):
        for iy, y in enumerate(ys):
            lean = (rnd.uniform(-0.1, 0.1), rnd.uniform(-0.1, 0.1))
            objs.append(log(f"Stilt{ix}{iy}", (x + lean[0], y + lean[1], -0.12), (x, y, DZ - 0.02), 0.11, wet,
                            seed=ix * 3 + iy))
    for iy, y in enumerate(ys):                        # beams under the deck
        objs.append(log(f"Beam{iy}", (-2.1, y, DZ - 0.14), (2.1, y, DZ - 0.12), 0.1, wet, seed=20 + iy))
    for k, x in enumerate((-1.95, 1.95)):
        objs.append(log(f"Stringer{k}", (x, -2.45, DZ - 0.05), (x, 1.85, DZ - 0.06), 0.07, wet, seed=30 + k))
    deck = row(board_tpl("DeckBoard", 0.22, 4.3, 0.05, board_h, seed=1, axis="Z"), (-2.05, -0.3, DZ),
               (2.05, -0.3, DZ), 0.22, seed=4, rand_rot=0.02, name="Deck")
    objs.append(deck)
    # walls: room x -1.72..1.72, y -1.15..1.55; boards laid along X then rotated for the side walls
    WZ0, WZ1 = DZ + 0.02, 3.25
    wh = WZ1 - WZ0
    zc = (WZ0 + WZ1) / 2

    def bt(nm, L, sd):
        return board_tpl(nm, 0.2, L, 0.04, board_v, seed=sd, axis="Y")
    objs.append(row(bt("WF", wh, 1), (-1.72, -1.15, zc), (-0.5, -1.15, zc), 0.2, 5, 0.02, name="WallF1"))
    objs.append(row(bt("WF2", wh, 2), (0.5, -1.15, zc), (1.72, -1.15, zc), 0.2, 6, 0.02, name="WallF2"))
    objs.append(row(bt("WFd", 0.4, 3), (-0.5, -1.15, WZ1 - 0.2), (0.5, -1.15, WZ1 - 0.2), 0.2, 7, 0.0, name="WallF3"))
    objs.append(row(bt("WB", wh, 4), (-1.72, 1.55, zc), (1.72, 1.55, zc), 0.2, 8, 0.02, name="WallB"))
    for sgn in (-1, 1):
        parts = [row(bt(f"WS{sgn}a", wh, 9), (-1.15, 0, zc), (-0.1, 0, zc), 0.2, 9, 0.02, name="WallSa"),
                 row(bt(f"WS{sgn}b", wh, 10), (0.55, 0, zc), (1.55, 0, zc), 0.2, 10, 0.02, name="WallSb"),
                 row(bt(f"WS{sgn}c", 0.72, 11), (-0.1, 0, WZ0 + 0.36), (0.55, 0, WZ0 + 0.36), 0.2, 11, 0.0, name="WallSc"),
                 row(bt(f"WS{sgn}d", 0.5, 12), (-0.1, 0, WZ1 - 0.25), (0.55, 0, WZ1 - 0.25), 0.2, 12, 0.0, name="WallSd")]
        for w in parts:
            pk.transform(w, (0, 0, 0), (0, 0, 90))
            pk.transform(w, (sgn * 1.72, 0, 0))
            objs.append(w)
    for x in (-1.75, 1.75):                            # corner posts
        for y in (-1.18, 1.58):
            objs.append(log(f"Post{x}{y}", (x, y, DZ - 0.1), (x, y, WZ1 + 0.1), 0.09, wet, seed=int(40 + x * 10 + y)))
    for x in (-0.52, 0.52):                            # door frame
        objs.append(pk.box(f"DoorJamb{x}", (0.08, 0.1, 1.9), (x, -1.17, WZ0 + 0.95), board_h, bevel=0.015))
    objs.append(pk.box("Lintel", (1.15, 0.12, 0.1), (0, -1.17, WZ0 + 1.9), board_h, bevel=0.015))
    door = pk.box("DoorLeaf", (0.9, 0.06, 1.82), (0, 0, 0), board_v, bevel=0.012)
    pk.transform(door, (-0.9, -1.55, WZ0 + 0.93), (0, 0, -62))    # door swung open outwards
    objs.append(door)
    for x in (-1.9, 1.9):                              # porch rail
        objs.append(log(f"RailPost{x}", (x, -2.3, DZ - 0.05), (x, -2.3, DZ + 0.95), 0.06, wet, seed=int(50 + x)))
    objs.append(log("RailL", (-1.95, -2.3, DZ + 0.85), (-0.55, -2.3, DZ + 0.8), 0.045, wet, seed=61))
    objs.append(log("RailR", (0.55, -2.3, DZ + 0.8), (1.95, -2.3, DZ + 0.86), 0.045, wet, seed=62))
    for x in (-0.32, 0.32):                            # ladder down the front
        objs.append(log(f"LadderRail{x}", (x, -3.05, -0.08), (x, -2.35, DZ + 0.05), 0.045, wet, seed=int(70 + x * 10)))
    for k in range(4):
        t = (k + 0.7) / 4.6
        objs.append(log(f"Rung{k}", (-0.36, -3.05 + 0.7 * t, -0.08 + (DZ + 0.13) * t),
                        (0.36, -3.05 + 0.7 * t, -0.08 + (DZ + 0.13) * t), 0.03, wet, seed=80 + k))
    for x in xs:                                       # rope lashings on the stilts
        for y in ys:
            objs.append(pk.C.torus(f"Lash{x}{y}", major=0.12, minor=0.022, seg=12, minor_seg=5, mat=rope,
                                   loc=(x, y, DZ - 0.28)))
    # roof: two sagging thatch slabs + ridge roll + gable boards
    RZ, EZ = 4.55, 3.05
    yf, yb = -1.15 - 0.75, 1.55 + 0.75
    ym = (-1.15 + 1.55) / 2
    left = slab("RoofF", [(-2.3, yf, EZ), (2.3, yf, EZ), (2.3, ym, RZ), (-2.3, ym, RZ)], 0.26, thatch, 10, 6)
    right = slab("RoofB", [(2.3, yb, EZ), (-2.3, yb, EZ), (-2.3, ym, RZ), (2.3, ym, RZ)], 0.26, thatch, 10, 6)
    roof = pk.join([left, right], "Roof")
    pk.sag(roof, amount=0.14, axis="X", length=4.6)
    gn.displace(roof, strength=0.05, scale=2.5, detail=3, voronoi=0.2, seed=4)
    gn.apply(roof)
    objs.append(roof)
    ridge = pk.beam("Ridge", (-2.35, ym, RZ + 0.1), (2.35, ym, RZ + 0.1), 0.17, verts=12, mat=thatch)
    pk.sag(ridge, amount=0.14, axis="X", length=4.7)
    gn.apply(ridge)
    objs.append(ridge)
    for sgn in (-1, 1):
        n = 14
        for k in range(n):
            y = -1.15 + (k + 0.5) * (2.7 / n)
            hgt = (RZ - 0.25 - WZ1) * (1 - abs(y - ym) / 1.4)
            if hgt < 0.08:
                continue
            objs.append(pk.box(f"Gable{sgn}{k}", (0.04, 2.7 / n * 0.95, hgt + 0.1), (sgn * 1.72, y, WZ1 + hgt / 2 - 0.02),
                               board_v, bevel=0.01))
    objs += lantern("Lantern", (1.55, -2.3, DZ + 1.55), glow, iron)
    objs.append(pk.beam("LanternArm", (1.9, -2.3, DZ + 0.95), (1.9, -2.3, DZ + 1.85), 0.04, verts=6, mat=wet))
    objs.append(pk.beam("LanternArm2", (1.9, -2.3, DZ + 1.8), (1.5, -2.3, DZ + 1.8), 0.03, verts=6, mat=wet))
    objs.append(pk.beam("LanternHook", (1.55, -2.3, DZ + 1.79), (1.55, -2.3, DZ + 1.7), 0.01, verts=4, mat=iron))
    objs.append(reeds(0.0, 2.6, 5.0, 17, exclude=lambda x, y, z: abs(x) < 0.55 and y < -2.2))
    return pk.finish("swamp_hut", objs, args, budget="building", expected=(4.8, 5.4, 4.8), size=2048, open_ok=True,
                     group_sizes={"GlowLantern": 64, "GrassReeds": 256}, ao_distance=0.6)


# =============================================================================== snow_cabin
def build_snow_cabin(args):
    """Log cabin (≈5.8 x 4.8 m, ≈5.3 m tall): notched log walls with overhanging corners on a stone footing,
    plank door, warm glowing window, stone chimney, plank roof under a thick snow blanket with a rounded lip
    and icicles, snow drifts against the walls, firewood stack."""
    logw = M.wood("LogWood", color="#5e4630", color2="#2c1f15", seed=3, axis="X", weathered=0.6, wear=0.4)
    logw_y = M.wood("LogWoodY", color="#5e4630", color2="#2c1f15", seed=4, axis="Y", weathered=0.6, wear=0.4)
    planks = M.wood("DoorWood", color="#6a4a2e", color2="#352314", seed=6, axis="Z", weathered=0.3)
    stone = M.stone_blocks("Footing", color="#6c6a66", color2="#4f4d49", seed=4, moss=0.1, block=(0.45, 0.25))
    fieldstone = M.rock("FieldStone", color="#6f6c66", color2="#4a4843", strata=0.2, scale=2.2, seed=9, dirt=0.8,
                        wear=0.15, moss=0.15, lichen=0.3)
    snowm = M.snow("Snow", seed=2)
    icem = M.ice("Ice", seed=3)
    glow = M.emissive("GlowWindow", color="#ffb35a", strength=5.0)
    glow["kit_group"] = "GlowWindow"
    iron = M.metal("Iron", kind="blackiron", rust=0.5, seed=5)
    objs = []
    X0, X1, Y0, Y1 = -2.3, 2.3, -1.8, 1.8
    R = 0.15
    objs.append(pk.box("Footing", (X1 - X0 - 0.1, Y1 - Y0 - 0.1, 0.36), (0, 0, 0.13), stone, bevel=0.04, seg=2))
    for (xa, xb, ya, yb) in ((X0 - 0.1, X1 + 0.1, Y0 - 0.1, Y0 + 0.2), (X0 - 0.1, X1 + 0.1, Y1 - 0.2, Y1 + 0.1),
                             (X0 - 0.1, X0 + 0.2, Y0 + 0.2, Y1 - 0.2), (X1 - 0.2, X1 + 0.1, Y0 + 0.2, Y1 - 0.2)):
        objs += footing_run(xa, xb, ya, yb, fieldstone, seed=int(abs(xa * 7 + ya * 3)))
    WALLTOP = 2.75
    z = 0.35 + R
    k = 0
    while z < WALLTOP:
        segs = [(X0 - 0.3, X1 + 0.3)]
        if z < 2.15:
            segs = [(X0 - 0.3, -0.5), (0.5, X1 + 0.3)]
        if 1.0 < z < 1.9:
            segs = [(a, b) for a, b in segs if b <= 0.5] + [(0.5, 0.9), (1.8, X1 + 0.3)]
        for a, b in segs:
            objs.append(log(f"LogF{k}_{a:.1f}", (a, Y0, z), (b, Y0, z + 0.01), R, logw, seed=k * 7 + int(a * 3 + 9)))
        objs.append(log(f"LogB{k}", (X0 - 0.3, Y1, z), (X1 + 0.3, Y1, z - 0.01), R, logw, seed=k * 5 + 1))
        zs = z + R
        if zs < WALLTOP + 0.1:
            for sgn, xx in ((-1, X0), (1, X1)):
                objs.append(log(f"LogS{sgn}{k}", (xx, Y0 - 0.3, zs), (xx, Y1 + 0.3, zs), R, logw_y, seed=k * 3 + sgn + 5))
        z += 2 * R * 0.92
        k += 1
    RZ = 4.6
    pitch = (RZ - WALLTOP) / (Y1 + 0.2)
    zz = WALLTOP + R
    while True:                                        # log gables under the roof pitch
        half = (RZ - 0.25 - zz) / pitch
        if half < 0.25:
            break
        for sgn, xx in ((-1, X0), (1, X1)):
            objs.append(log(f"Gab{sgn}{zz:.2f}", (xx, -half, zz), (xx, half, zz), R * 0.95, logw_y,
                            seed=int(zz * 50) + sgn + 2))
        zz += 2 * R * 0.92
    objs.append(pk.box("Door", (0.96, 0.08, 1.8), (0, Y0 - 0.02, 0.35 + 0.9), planks, bevel=0.015))
    for zb in (0.75, 1.55):
        objs.append(pk.box(f"DoorBand{zb}", (0.9, 0.03, 0.07), (0, Y0 - 0.075, zb), iron, bevel=0.008))
    objs.append(pk.box("Frame", (0.95, 0.14, 0.9), (1.35, Y0, 1.45), planks, bevel=0.02))
    objs.append(pk.box("Pane", (0.75, 0.05, 0.72), (1.35, Y0 - 0.06, 1.45), glow, bevel=0.005))
    objs.append(pk.box("Mullion", (0.05, 0.05, 0.74), (1.35, Y0 - 0.09, 1.45), planks))
    objs.append(pk.box("Transom", (0.77, 0.05, 0.05), (1.35, Y0 - 0.09, 1.45), planks))
    ov = 0.55
    ya, yb = Y0 - ov, Y1 + ov
    ez = RZ - pitch * (Y1 + ov)
    objs.append(slab("RoofF", [(X0 - 0.6, ya, ez), (X1 + 0.6, ya, ez), (X1 + 0.6, 0, RZ), (X0 - 0.6, 0, RZ)], 0.12, planks, 6, 4))
    objs.append(slab("RoofB", [(X1 + 0.6, yb, ez), (X0 - 0.6, yb, ez), (X0 - 0.6, 0, RZ), (X1 + 0.6, 0, RZ)], 0.12, planks, 6, 4))
    sn = [slab("SnowF", [(X0 - 0.65, ya - 0.08, ez + 0.1), (X1 + 0.65, ya - 0.08, ez + 0.1), (X1 + 0.65, 0.05, RZ + 0.12),
                         (X0 - 0.65, 0.05, RZ + 0.12)], 0.24, snowm, 16, 8),
          slab("SnowB", [(X1 + 0.65, yb + 0.08, ez + 0.1), (X0 - 0.65, yb + 0.08, ez + 0.1), (X0 - 0.65, -0.05, RZ + 0.12),
                         (X1 + 0.65, -0.05, RZ + 0.12)], 0.24, snowm, 16, 8)]
    snow = pk.join(sn, "SnowRoof")
    gn.voxel_remesh(snow, 0.05, smooth_iters=6)     # one soft continuous blanket with rounded lips
    gn.displace(snow, strength=0.06, scale=1.2, detail=3, voronoi=0.0, seed=7)
    gn.apply(snow)
    pk.decimate_to(snow, 2200)
    pk.smooth_all(snow)
    objs.append(snow)
    objs += stone_stack(X1 + 0.45, 0.6, 0.72, 0.72, 0.0, 5.3, fieldstone, seed=11)
    cap = pk.C.sphere("ChimSnow", r=0.45, segments=16, rings=8, mat=snowm, loc=(X1 + 0.45, 0.6, 5.3))
    cap.scale = (1.0, 1.0, 0.35)
    pk.C.apply_transforms(cap)
    objs.append(cap)
    icl = pk.C.cone("_Icicle", r1=0.035, r2=0.0, depth=0.3, verts=6, mat=icem, loc=(0, 0, 0))
    for v in icl.data.vertices:
        v.co.z -= 0.15
    for i, (nm, y) in enumerate((("IcF", ya + 0.05), ("IcB", yb - 0.05))):
        cu = gn.make_curve([[(X0 - 0.5, y, ez + 0.05), (X1 + 0.5, y, ez + 0.05)]], name=nm + "C")
        gn.instance_on_curve(cu, icl, spacing=0.23, random_scale=0.55, random_rot=0.15, seed=i + 3, name=nm)
        objs.append(gn.apply(cu))
    dr = []
    for z, f in ((0.0, 1.0), (0.18, 0.93), (0.32, 0.86)):
        dr.append(pk.rect_ring((X1 - X0 + 1.1) * f, (Y1 - Y0 + 1.0) * f, z, n_side=10, bevel=0.5))
    drift = pk.loft("Drift", dr, snowm)
    gn.displace(drift, strength=0.12, scale=1.5, detail=3, voronoi=0.0, seed=5, subdiv=2)
    gn.apply(drift)
    pk.exclude_faces(drift, lambda x, y, z: (abs(x) < 0.6 and y < -1.2) or z < 0.01)
    pk.decimate_to(drift, 1800)
    objs.append(drift)
    for i in range(3):                                 # firewood stack by the left wall
        for j in range(3 - i):
            yy = -1.1 + j * 0.22 + i * 0.11
            objs.append(log(f"Fire{i}{j}", (X0 - 0.75, yy, 0.12 + i * 0.19), (X0 - 0.35, yy, 0.12 + i * 0.19), 0.1,
                            logw, verts=8, seed=90 + i * 3 + j))
    return pk.finish("snow_cabin", objs, args, budget="building", expected=(6.2, 5.2, 5.4), size=2048, open_ok=True,
                     group_sizes={"GlowWindow": 64}, ao_distance=0.8)


BUILDERS = {
    "swamp_hut": build_swamp_hut,
    "snow_cabin": build_snow_cabin,
}
