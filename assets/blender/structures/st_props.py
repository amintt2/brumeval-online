"""Small village props: crate, barrel, fence, chest, lamp_post, banner, workbench, well, stall, alchemy_table."""
import math
import random

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

import sk
from kit import gn

V = Vector


# =============================================================================== crate
def build_crate(args):
    MAT = sk.Mats()
    P = sk.Parts(seed=11)
    s = 0.96                                   # outer size of the boards
    h = s / 2
    wood = MAT.wood("Z", "old")
    board_t = 0.035
    rnd = random.Random(4)
    # side boards (real planks with gaps): 4 boards per face
    nb = 4
    bw = s / nb
    for face in range(4):
        ang = face * math.pi / 2
        R = Matrix.Rotation(ang, 4, "Z")
        for i in range(nb):
            z = 0.02 + i * bw + bw / 2
            L = s - 0.004
            # board along local Z (grain) rotated to horizontal along the face
            m = R @ Matrix.Translation((0, -h + board_t / 2, z)) @ Matrix.Rotation(math.pi / 2, 4, "Y")
            bm = bmesh.new()
            sk.bm_box(bm, bw - 0.012, board_t, L - 2 * board_t * (face % 2), bevel=0.006)
            for v in bm.verts:
                v.co.y += rnd.uniform(-0.002, 0.002)
            P.add_bm(bm, wood, m)
    # top/bottom boards
    for zc in (0.02 + s - board_t / 2, 0.02 + board_t / 2):
        for i in range(nb):
            x = -h + bw / 2 + i * bw
            P.box((bw - 0.012, s - 2 * board_t, board_t), (x, 0, zc), MAT.wood("Y", "old"), bevel=0.006)
    # inner core so nothing is see-through between the boards
    P.box((s - 2 * board_t - 0.01, s - 2 * board_t - 0.01, s - 2 * board_t - 0.01), (0, 0, 0.02 + s / 2),
          MAT.flat("CrateInside", "#1c140d", 0.95), bevel=0.0)
    # frame battens on the 12 edges
    bt, bwid = 0.035, 0.085
    e = h + bt / 2 - 0.004
    z0, z1 = 0.0, 0.02 + s + bt - 0.004
    for sx in (-1, 1):
        for sy in (-1, 1):
            P.beam((sx * (h - bwid / 2 + 0.01), sy * e, z0), (sx * (h - bwid / 2 + 0.01), sy * e, z1), bwid, bt,
                   MAT.wood("Z", "dark"), bevel=0.008, up=(0, sy, 0))
            P.beam((sx * e, sy * (h - bwid / 2 + 0.01), z0 + 0.003), (sx * e, sy * (h - bwid / 2 + 0.01), z1 - 0.003),
                   bwid, bt, MAT.wood("Z", "dark"), bevel=0.008, up=(sx, 0, 0))
    for zc in (z0 + bwid / 2, z1 - bwid / 2 + 0.0):
        for sy in (-1, 1):
            P.beam((-h + bwid, sy * e, zc), (h - bwid, sy * e, zc), bwid, bt, MAT.wood("Z", "dark"), bevel=0.008,
                   up=(0, sy, 0))
        for sx in (-1, 1):
            P.beam((sx * e, -h + bwid, zc), (sx * e, h - bwid, zc), bwid, bt, MAT.wood("Z", "dark"), bevel=0.008,
                   up=(sx, 0, 0))
    # diagonal braces on the 4 sides
    for face in range(4):
        R = Matrix.Rotation(face * math.pi / 2, 4, "Z")
        a = R @ V((-h + bwid, -e, z0 + bwid))
        b = R @ V((h - bwid, -e, z1 - bwid))
        if face % 2:
            a, b = R @ V((-h + bwid, -e, z1 - bwid)), R @ V((h - bwid, -e, z0 + bwid))
        P.beam(a, b, bwid * 0.9, bt * 0.9, MAT.wood("Z", "dark"), bevel=0.007, up=R @ V((0, -1, 0)))
    # iron corner brackets + nails
    iron = MAT.iron(0.6)
    nails, nn = [], []
    for sx in (-1, 1):
        for sy in (-1, 1):
            for zc in (0.06, z1 - 0.06):
                c = V((sx * (h + bt), sy * (h + bt), zc))
                P.box((0.16, 0.012, 0.12), (sx * (h - 0.06), sy * (e + bt / 2 + 0.003), zc), iron, bevel=0.003)
                P.box((0.012, 0.16, 0.12), (sx * (e + bt / 2 + 0.003), sy * (h - 0.06), zc), iron, bevel=0.003)
                for k in (0.035,):
                    nails.append((sx * (h - k), sy * (e + bt / 2 + 0.009), zc + 0.03))
                    nn.append((0, sy, 0))
                    nails.append((sx * (e + bt / 2 + 0.009), sy * (h - k), zc - 0.03))
                    nn.append((sx, 0, 0))
    P.nail_heads(nails, nn, iron, r=0.011)
    # rope handles on the X sides
    rope = MAT.rope()
    for sx in (-1, 1):
        cu = gn.make_curve([[(sx * (e + 0.015), -0.15, 0.7), (sx * (e + 0.045), -0.1, 0.6), (sx * (e + 0.05), 0.0, 0.56),
                             (sx * (e + 0.045), 0.1, 0.6), (sx * (e + 0.015), 0.15, 0.7)]], "RopeHandle", kind="NURBS")
        gn.curve_to_mesh(cu, radius=0.014, profile_res=6)
        o = gn.apply(cu)
        o.data.materials.append(rope)
        P.add_obj(o)
    return P.objs


# =============================================================================== barrel
def _stave_profile(z, H, r_end, r_mid):
    t = z / H
    return r_end + (r_mid - r_end) * math.sin(math.pi * t)


def build_barrel(args):
    MAT = sk.Mats()
    P = sk.Parts(seed=12)
    rnd = random.Random(7)
    H, r_end, r_mid = 1.08, 0.37, 0.445
    n_st = 18
    th = 0.035
    rings = 9
    wood = MAT.wood("Z", "red")
    for i in range(n_st):
        a0 = 2 * math.pi * i / n_st + 0.004
        a1 = 2 * math.pi * (i + 1) / n_st - 0.004
        h_top = H + rnd.uniform(-0.006, 0.01)
        bm = bmesh.new()
        outer, inner = [], []
        for k in range(rings + 1):
            z = h_top * k / rings
            ro = _stave_profile(z, h_top, r_end, r_mid) + rnd.uniform(-0.002, 0.002)
            ri = ro - th
            ro_row = [bm.verts.new((ro * math.cos(a), ro * math.sin(a), z)) for a in (a0, (a0 + a1) / 2, a1)]
            ri_row = [bm.verts.new((ri * math.cos(a), ri * math.sin(a), z)) for a in (a0, (a0 + a1) / 2, a1)]
            outer.append(ro_row)
            inner.append(ri_row)
        for k in range(rings):
            for j in range(2):
                bm.faces.new((outer[k][j], outer[k][j + 1], outer[k + 1][j + 1], outer[k + 1][j]))
                bm.faces.new((inner[k][j + 1], inner[k][j], inner[k + 1][j], inner[k + 1][j + 1]))
            bm.faces.new((inner[k][0], outer[k][0], outer[k + 1][0], inner[k + 1][0]))
            bm.faces.new((outer[k][2], inner[k][2], inner[k + 1][2], outer[k + 1][2]))
        for k, flip in ((0, True), (rings, False)):
            for j in range(2):
                vs = (outer[k][j], outer[k][j + 1], inner[k][j + 1], inner[k][j])
                bm.faces.new(tuple(reversed(vs)) if flip else vs)
        P.add_bm(bm, wood, Matrix(), smooth=40)
    # heads (lids) slightly recessed, made of planks
    for zc, up in ((H - 0.07, 1), (0.05, -1)):
        r = r_end - th + 0.004
        n_pl = 5
        pw = 2 * r / n_pl
        for i in range(n_pl):
            x0 = -r + i * pw + 0.004
            x1 = x0 + pw - 0.008
            pts = []
            for x in (x0, x1):
                pass
            # plank = circle chord slab built as a polygon prism
            poly = []
            steps = 5
            for kk in range(steps + 1):
                x = x0 + (x1 - x0) * kk / steps
                y = math.sqrt(max(r * r - x * x, 1e-6))
                poly.append((x, -y))
            for kk in range(steps + 1):
                x = x1 - (x1 - x0) * kk / steps
                y = math.sqrt(max(r * r - x * x, 1e-6))
                poly.append((x, y))
            P.poly_prism(poly, -0.02, 0.02, MAT.wood("Y", "red"), loc=(0, 0, zc), bevel=0.004)
    # iron hoops (4)
    iron = MAT.iron(0.65)
    for zc, hh in ((0.07, 0.05), (0.3, 0.045), (H - 0.3, 0.045), (H - 0.07, 0.05)):
        prof = []
        for k, (dz, dr) in enumerate(((-hh / 2, 0.0), (-hh / 2, 0.009), (hh / 2, 0.009), (hh / 2, 0.0))):
            z = zc + dz
            prof.append((_stave_profile(z, H, r_end, r_mid) + dr - 0.002, z))
        P.lathe([(prof[0][0] - 0.004, prof[0][1])] + prof[1:3] + [(prof[3][0] - 0.004, prof[3][1])], (0, 0, 0), iron,
                n=36, cap_top=False, cap_bottom=False, smooth=60)
    # rivets on the hoops
    pts, nn = [], []
    for zc in (0.07, 0.3, H - 0.3, H - 0.07):
        for k in range(8):
            a = 2 * math.pi * (k + 0.5) / 8 + zc
            r = _stave_profile(zc, H, r_end, r_mid) + 0.007
            pts.append((r * math.cos(a), r * math.sin(a), zc))
            nn.append((math.cos(a), math.sin(a), 0))
    P.nail_heads(pts, nn, iron, r=0.01)
    # bung + bung hole plug
    r = _stave_profile(H / 2, H, r_end, r_mid)
    P.cyl(0.03, 0.03, (0, -r + 0.01, H / 2), MAT.wood("Z", "dark"), rot=(math.pi / 2, 0, 0), n=10)
    return P.objs


# =============================================================================== fence
def build_fence(args):
    """ONE 2.0 m segment along X. A single post at the -X end so chained segments never double their posts;
    the rails run the full 2.0 m and meet the next segment's post."""
    MAT = sk.Mats()
    P = sk.Parts(seed=13)
    rnd = random.Random(9)
    wood = MAT.wood("Z", "old")
    # split posts: irregular 7-sided section, weathered, axe-cut pointed top, sunk 4 cm
    for (x, hgt) in ((-0.92, 1.16), (0.05, 1.08)):
        sec = [(0.085, 0.0), (0.05, 0.07), (-0.02, 0.085), (-0.08, 0.04), (-0.075, -0.035), (-0.02, -0.08),
               (0.055, -0.06)]
        bm = bmesh.new()
        rings = []
        zs = [-0.04, 0.25, 0.55, 0.85, hgt - 0.12]
        for zi, z in enumerate(zs):
            sc = 1.0 - 0.04 * zi
            rings.append([bm.verts.new((px * sc + rnd.uniform(-0.008, 0.008), py * sc + rnd.uniform(-0.008, 0.008), z))
                          for px, py in sec])
        tip = [bm.verts.new((0.03, 0.0, hgt)), bm.verts.new((-0.03, 0.0, hgt - 0.03))]
        n = len(sec)
        for k in range(len(rings) - 1):
            for i in range(n):
                j = (i + 1) % n
                bm.faces.new((rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]))
        top = rings[-1]
        for i in range(n):
            j = (i + 1) % n
            t = tip[0] if top[i].co.x + top[j].co.x > 0 else tip[1]
            bm.faces.new((top[i], top[j], t))
        # bridge the two tip verts
        for i in range(n):
            j = (i + 1) % n
            if (top[i].co.x > 0) != (top[j].co.x > 0):
                vs = (top[i], top[j], tip[1], tip[0]) if top[i].co.x > 0 else (top[i], top[j], tip[0], tip[1])
                try:
                    bm.faces.new(vs)
                except ValueError:
                    pass
        bm.faces.new(list(reversed(rings[0])))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        o = P.add_bm(bm, wood, Matrix.Translation((x, 0, 0)), smooth=45)
    # three split rails (half-round logs), slightly sagging, pegged to the posts
    prof = [(0.07, -0.03, 0), (0.05, 0.035, 0), (-0.01, 0.05, 0), (-0.065, 0.02, 0), (-0.06, -0.03, 0), (0.0, -0.045, 0)]
    for zc, sag, y in ((0.9, 0.022, -0.1), (0.58, 0.012, -0.1), (0.27, 0.016, -0.1)):
        pts = []
        for k in range(9):
            t = k / 8
            x = -1.0 + 2.0 * t
            pts.append((x, y + rnd.uniform(-0.008, 0.008), zc - sag * math.sin(math.pi * t) + rnd.uniform(-0.006, 0.006)))
        cu = gn.make_curve([pts], "Rail", kind="NURBS", resolution=4)
        pr = gn.make_curve([prof + [prof[0]]], "RailProfile", kind="POLY")
        gn.curve_to_mesh(cu, radius=1.0, profile=pr, fill_caps=True, smooth=False)
        o = gn.apply(cu)
        gn.remove(pr)
        o.data.materials.append(MAT.wood("X", "old"))
        sk._smooth(o.data, 40)
        P.add_obj(o)
    # wooden pegs through the rails into the posts, rope binding on the tall post
    for x in (-0.92, 0.05):
        for zc in (0.9, 0.58, 0.27):
            P.cyl(0.02, 0.07, (x + 0.01, -0.14, zc + 0.005), MAT.wood("Z", "dark"), rot=(math.pi / 2, 0, 0), n=7)
    rope = MAT.rope()
    for k in range(3):
        P.torus(0.083, 0.012, (-0.92, 0.0, 0.97 + k * 0.026), rope, rot=(0.04 * k, 0.05, 0), seg=14, rseg=5)
    return P.objs


# =============================================================================== chest
def build_chest(args):
    """Iron-bound chest, lid = separate object "Lid" hinged on the back edge (origin on the hinge axis)."""
    MAT = sk.Mats()
    P = sk.Parts(seed=21)
    L = sk.Parts(seed=22, prefix="L")
    W, D, Hb = 1.0, 0.6, 0.5            # base size
    t = 0.04                            # wall thickness
    wood = MAT.wood("Z", "red")
    band = MAT.blackiron()
    # base walls: horizontal boards (3 per side), open top, inner floor
    for side in range(4):
        R = Matrix.Rotation(side * math.pi / 2, 4, "Z")
        span = W if side % 2 == 0 else D
        depth = D if side % 2 == 0 else W
        for i in range(3):
            z = 0.06 + i * (Hb - 0.06) / 3 + (Hb - 0.06) / 6
            a = R @ V((-span / 2 + (t if side % 2 else 0), -depth / 2 + t / 2, z))
            b = R @ V((span / 2 - (t if side % 2 else 0), -depth / 2 + t / 2, z))
            P.beam(a, b, (Hb - 0.06) / 3 - 0.006, t, wood, bevel=0.006, up=R @ V((0, -1, 0)))
    P.box((W - 2 * t, D - 2 * t, 0.04), (0, 0, 0.08), MAT.wood("Y", "dark"), bevel=0.004)          # floor
    # skids
    for x in (-W / 2 + 0.1, W / 2 - 0.1):
        P.box((0.1, D + 0.02, 0.06), (x, 0, 0.03), MAT.wood("Y", "dark"), bevel=0.008)
    # treasure inside (seen when the lid opens): heap of coins + a goblet
    gold = MAT._get("gold", lambda: sk.M.metal("Gold", kind="gold", rust=0.0, grime=0.4, wear=0.8))
    P.ico(0.3, (0, 0, 0.1), gold, subdiv=2, scale=(1.35, 0.72, 0.55), jitter=0.01)
    rnd = random.Random(5)
    coins = []
    for k in range(26):
        a = rnd.uniform(0, 2 * math.pi)
        rr = rnd.uniform(0.0, 0.33)
        x, y = rr * math.cos(a) * 1.2, rr * math.sin(a) * 0.55
        z = 0.1 + 0.165 * math.sqrt(max(0.0, 1 - (x / 0.4) ** 2 - (y / 0.22) ** 2)) + 0.004
        P.cyl(0.022, 0.005, (x, y, z), gold, rot=(rnd.uniform(-0.4, 0.4), rnd.uniform(-0.4, 0.4), 0), n=10, smooth=0)
    P.lathe([(0.03, 0.0), (0.035, 0.005), (0.012, 0.02), (0.01, 0.07), (0.05, 0.1), (0.055, 0.16), (0.05, 0.16)],
            (0.22, 0.05, 0.14), gold, n=12, rot=(0.25, 0.0, 0.0), cap_top=True)
    # iron bands around the base (U shapes) + corner caps
    for x in (-0.3, 0.3):
        P.box((0.07, D + 0.012, 0.012), (x, 0, Hb - 0.006), band, bevel=0.003)
        for sy in (-1, 1):
            P.box((0.07, 0.012, Hb - 0.02), (x, sy * (D / 2 + 0.006), Hb / 2), band, bevel=0.003)
    for sx in (-1, 1):
        for sy in (-1, 1):
            P.box((0.1, 0.012, 0.1), (sx * (W / 2 - 0.045), sy * (D / 2 + 0.006), 0.07), band, bevel=0.003)
            P.box((0.012, 0.1, 0.1), (sx * (W / 2 + 0.006), sy * (D / 2 - 0.045), 0.07), band, bevel=0.003)
            P.box((0.1, 0.012, 0.1), (sx * (W / 2 - 0.045), sy * (D / 2 + 0.006), Hb - 0.05), band, bevel=0.003)
            P.box((0.012, 0.1, 0.1), (sx * (W / 2 + 0.006), sy * (D / 2 - 0.045), Hb - 0.05), band, bevel=0.003)
    # side handles (iron rings on plates)
    for sx in (-1, 1):
        P.box((0.012, 0.14, 0.08), (sx * (W / 2 + 0.006), 0, Hb * 0.62), band, bevel=0.003)
        P.torus(0.055, 0.009, (sx * (W / 2 + 0.03), 0, Hb * 0.55), band, rot=(0, math.pi / 2, 0), seg=14, rseg=5)
    # front lock plate (engraved) + keyhole
    eng = MAT.engraved("filigree", "bronze")
    P.box((0.16, 0.014, 0.18), (0, -D / 2 - 0.007, Hb - 0.08), eng, bevel=0.004)
    P.box((0.018, 0.006, 0.05), (0, -D / 2 - 0.016, Hb - 0.09), MAT.flat("Keyhole", "#050404", 0.9), bevel=0.0)
    # rivets
    pts, nn = [], []
    for x in (-0.3, 0.3):
        for z in (0.12, 0.26, 0.4):
            for sy in (-1, 1):
                pts.append((x, sy * (D / 2 + 0.012), z))
                nn.append((0, sy, 0))
    P.nail_heads(pts, nn, band, r=0.012)
    # ---------------- lid: barrel vault of 7 staves + end boards + bands (hinge at the back top edge)
    rv = 0.34                     # vault radius (> D/2 -> flatter arc)
    cy = 0.0
    zc = Hb - math.sqrt(rv * rv - (D / 2) ** 2)
    a0 = math.asin((D / 2) / rv)
    nst = 7
    for i in range(nst):
        aa = -a0 + 2 * a0 * i / nst + 0.004
        ab = -a0 + 2 * a0 * (i + 1) / nst - 0.004
        am = (aa + ab) / 2
        pmid = V((0, cy + rv * math.sin(am), zc + rv * math.cos(am)))
        nrm = V((0, math.sin(am), math.cos(am)))
        wdt = 2 * rv * math.sin((ab - aa) / 2)
        L.beam(pmid - nrm * 0.02 - V((W / 2 - 0.005, 0, 0)), pmid - nrm * 0.02 + V((W / 2 - 0.005, 0, 0)), wdt, 0.04,
               MAT.wood("Z", "red"), bevel=0.006, up=nrm)
    # end boards (arched)
    for sx in (-1, 1):
        prof = []
        for k in range(9):
            aa = -a0 + 2 * a0 * k / 8
            prof.append((cy + (rv - 0.035) * math.sin(aa), zc + (rv - 0.035) * math.cos(aa)))
        # prism built in local XY (= world YZ) and extruded along local Z (= world X)
        rot = Matrix(((0, 0, 1), (1, 0, 0), (0, 1, 0))).to_euler()
        L.poly_prism([(y, z - Hb) for (y, z) in prof], -0.02, 0.02, MAT.wood("Y", "red"),
                     loc=(sx * (W / 2 - 0.025), 0, Hb), rot=rot, bevel=0.004)
    # iron bands over the lid
    for x in (-0.3, 0.3):
        pts = []
        for k in range(13):
            aa = -a0 - 0.02 + (2 * a0 + 0.04) * k / 12
            pts.append((x, cy + (rv + 0.006) * math.sin(aa), zc + (rv + 0.006) * math.cos(aa)))
        prof = gn.make_curve([[(-0.035, -0.006, 0), (0.035, -0.006, 0), (0.035, 0.006, 0), (-0.035, 0.006, 0),
                               (-0.035, -0.006, 0)]], "BandProfile", kind="POLY")
        cu = gn.make_curve([pts], "LidBand", kind="POLY")
        gn.curve_to_mesh(cu, radius=1.0, profile=prof, fill_caps=True, smooth=False)
        o = gn.apply(cu)
        gn.remove(prof)
        o.data.materials.append(band)
        L.add_obj(o)
    # lock hasp on the lid front
    L.box((0.07, 0.014, 0.12), (0, -D / 2 - 0.012, Hb + 0.02), eng, bevel=0.003)
    # hinges at the back
    for x in (-0.3, 0.3):
        P.cyl(0.018, 0.1, (x - 0.05, D / 2 + 0.012, Hb), band, rot=(0, math.pi / 2, 0), n=8)
    return {"parts": P.objs, "separate": {"Lid": L.objs}, "pivots": {"Lid": (0, D / 2, Hb)}}


# =============================================================================== lantern (shared by lamp_post / buildings)
def lantern(P, MAT, top, scale=1.0, hang=True):
    """Hanging iron lantern whose ring top is at `top`; glowing panes (Glow set) + candle. Returns bottom z."""
    s = scale
    x, y, z = top
    iron = MAT.blackiron()
    glow = MAT.glow("#ffb45a", 6.0, "GlowLantern")
    h = 0.34 * s
    w = 0.2 * s
    zb = z - 0.06 * s - h                       # bottom of the cage
    # ring + roof (pyramid cap) + top plate
    P.torus(0.03 * s, 0.006 * s, (x, y, z - 0.03 * s), iron, rot=(math.pi / 2, 0, 0), seg=10, rseg=4)
    P.cyl(0.15 * s, 0.1 * s, (x, y, zb + h - 0.005), iron, n=4, r2=0.02 * s, rot=(0, 0, math.pi / 4), smooth=0)
    P.cyl(0.13 * s, 0.02 * s, (x, y, zb + h - 0.02 * s), iron, n=4, rot=(0, 0, math.pi / 4), smooth=0)
    # base plate
    P.cyl(0.13 * s, 0.03 * s, (x, y, zb - 0.02 * s), iron, n=4, rot=(0, 0, math.pi / 4), smooth=0)
    P.cyl(0.04 * s, 0.05 * s, (x, y, zb - 0.07 * s), iron, n=6, r2=0.08 * s, smooth=0)
    # corner posts
    for sx in (-1, 1):
        for sy in (-1, 1):
            P.box((0.02 * s, 0.02 * s, h), (x + sx * w / 2, y + sy * w / 2, zb + h / 2), iron, bevel=0.003)
    # glowing panes (slightly inset) + cross bars
    for k in range(4):
        R = Matrix.Rotation(k * math.pi / 2, 4, "Z")
        c = V((x, y, 0)) + R @ V((0, -w / 2 + 0.004, 0))
        P.box((w - 0.02 * s, 0.006, h - 0.02 * s), (c.x, c.y, zb + h / 2), glow, rot=(0, 0, k * math.pi / 2), bevel=0.0)
        c2 = V((x, y, 0)) + R @ V((0, -w / 2 - 0.002, 0))
        P.box((0.012 * s, 0.01, h - 0.02 * s), (c2.x, c2.y, zb + h / 2), iron, rot=(0, 0, k * math.pi / 2), bevel=0.0)
        P.box((w, 0.01, 0.012 * s), (c2.x, c2.y, zb + h * 0.55), iron, rot=(0, 0, k * math.pi / 2), bevel=0.0)
    return zb - 0.07 * s


# =============================================================================== lamp post
def build_lamp_post(args):
    MAT = sk.Mats()
    P = sk.Parts(seed=31)
    stone = MAT.stone("grey", 0.4)
    # stepped stone plinth: 4 irregular blocks + cap
    rnd = random.Random(3)
    for k in range(4):
        R = Matrix.Rotation(k * math.pi / 2 + 0.05, 4, "Z")
        c = R @ V((0.11, 0.0, 0.0))
        P.stone((0.24, 0.42, 0.34), (c.x, c.y, 0.16), stone, rot=(0, 0, k * math.pi / 2 + rnd.uniform(-0.1, 0.1)),
                seed=k + 3)
    P.box((0.36, 0.36, 0.08), (0, 0, 0.36), MAT.blocks((0.4, 0.2)), bevel=0.02)
    # wooden post with chamfers, iron collars
    post = MAT.wood("Z", "dark")
    P.beam((0, 0, 0.36), (0, 0, 2.95), 0.15, 0.15, post, bevel=0.025)
    P.cyl(0.075, 0.1, (0, 0, 2.93), post, n=8, r2=0.03, smooth=0)                   # carved finial
    iron = MAT.blackiron()
    for z in (0.5, 2.62):
        P.box((0.17, 0.17, 0.06), (0, 0, z), iron, bevel=0.006)
    # iron bracket arm towards the front (-Y) with a scroll brace
    P.tube([(0, -0.07, 2.72), (0, -0.4, 2.74), (0, -0.72, 2.73)], 0.018, iron, res=6, kind="POLY")
    P.tube([(0, -0.07, 2.3), (0, -0.2, 2.42), (0, -0.38, 2.6), (0, -0.55, 2.7), (0, -0.62, 2.67), (0, -0.6, 2.61),
            (0, -0.54, 2.62)], 0.012, iron, res=5)
    P.tube([(0, -0.07, 2.5), (0, -0.16, 2.58), (0, -0.2, 2.66), (0, -0.16, 2.7), (0, -0.12, 2.66)], 0.009, iron, res=5)
    P.box((0.05, 0.02, 0.5), (0, -0.085, 2.5), iron, bevel=0.004)                    # wall plate on the post
    # hook + short chain + lantern
    P.tube([(0, -0.7, 2.73), (0, -0.7, 2.66), (0, -0.66, 2.64)], 0.008, iron, res=5, kind="POLY")
    P.chain([(0, -0.7, 2.66), (0, -0.7, 2.44)], iron, link=0.05, wire=0.006, kind="POLY")
    lantern(P, MAT, (0, -0.7, 2.45), scale=1.0)
    return P.objs


# =============================================================================== banner
def cloth_sheet(P, mat, width, length, top_center, seg=(10, 22), folds=0.04, tails=True, thick=0.008, seed=0,
                plane="XZ", holes=0):
    """Hanging cloth: a subdivided sheet with folds (sine + noise), V-cut ragged tails, solidified (closed)."""
    rnd = random.Random(seed)
    nx, nz = seg
    verts, faces = [], []
    idx = {}
    for j in range(nz + 1):
        for i in range(nx + 1):
            u = i / nx
            v = j / nz
            x = (u - 0.5) * width
            z = -v * length
            # V-shaped swallow-tail: shorten the columns towards the middle
            if tails:
                cut = abs(u - 0.5) * 2
                z_end = -length * (0.82 + 0.18 * cut)
                z = -v * (-z_end)
            y = folds * math.sin(u * math.pi * 3.2 + v * 1.3) * (0.3 + 0.7 * v) + rnd.uniform(-0.004, 0.004) * v
            y += 0.02 * v * v
            idx[(i, j)] = len(verts)
            verts.append((x, y, z))
    kill = set()
    for _ in range(holes):
        ci, cj = rnd.randint(1, nx - 2), rnd.randint(nz // 2, nz - 2)
        kill.add((ci, cj))
    for j in range(nz):
        for i in range(nx):
            if (i, j) in kill:
                continue
            faces.append((idx[(i, j)], idx[(i + 1, j)], idx[(i + 1, j + 1)], idx[(i, j + 1)]))
    # ragged hem: jitter the last row
    for i in range(nx + 1):
        k = idx[(i, nz)]
        x, y, z = verts[k]
        verts[k] = (x, y, z + rnd.uniform(-0.05, 0.03))
    o = P.mesh(verts, faces, mat, loc=top_center, smooth=180, offset=False)
    gn.solidify(o, thick, offset=0.0)
    gn.apply(o)
    sk._smooth(o.data, 180)
    return o


def build_banner(args):
    MAT = sk.Mats()
    P = sk.Parts(seed=41)
    wood = MAT.wood("Z", "dark")
    iron = MAT.blackiron()
    H = 4.0
    # pole with iron shoe, stone footing, crossbar, finial spear-head
    stone = MAT.stone("dark", 0.45)
    for k in range(5):
        a = k * 2 * math.pi / 5 + 0.3
        P.stone((0.34, 0.28, 0.22), (0.22 * math.cos(a), 0.22 * math.sin(a), 0.07), stone, rot=(0, 0.1, a), seed=k + 11)
    P.cyl(0.07, H - 0.3, (0, 0, 0.0), wood, n=10, r2=0.055, smooth=40)
    P.cyl(0.08, 0.35, (0, 0, 0.0), iron, n=10, r2=0.075, smooth=40)
    for z in (1.4, 2.8):
        P.cyl(0.066, 0.05, (0, 0, z), iron, n=10, smooth=40)
    P.lathe([(0.06, 0), (0.07, 0.03), (0.03, 0.08), (0.075, 0.2), (0.0, 0.42)], (0, 0, H - 0.32), iron, n=4,
            rot=(0, 0, math.pi / 4), smooth=0)
    # crossbar with capped ends + rope ties
    bar_z = H - 0.55
    P.beam((-0.62, -0.08, bar_z), (0.62, -0.08, bar_z), 0.07, 0.07, MAT.wood("Z", "dark"), bevel=0.012)
    for sx in (-1, 1):
        P.cyl(0.045, 0.06, (sx * 0.62, -0.08, bar_z), iron, rot=(0, sx * math.pi / 2, 0), n=8)
    P.box((0.1, 0.1, 0.18), (0, -0.06, bar_z), iron, bevel=0.01)
    # the banner: Banner* material (client wind), heraldic emblem
    ban = MAT.cloth("BannerCloth", "#6e1b17", kind="wool", emblem={"color": "#c9a24a", "center": (0.0, -0.75),
                                                                 "size": 0.26})
    o = cloth_sheet(P, ban, 1.02, 2.3, (0, -0.13, bar_z - 0.04), seg=(12, 26), folds=0.035, seed=4, holes=0)
    # fringe band at the top (dark leather strip wrapped over the bar)
    P.box((1.08, 0.1, 0.07), (0, -0.09, bar_z - 0.005), MAT.leather("#2e1d12"), bevel=0.012)
    return P.objs


# =============================================================================== small reusable props
def hammer(P, MAT, loc, yaw=0.0, s=1.0):
    R = Matrix.Translation(loc) @ Matrix.Rotation(yaw, 4, "Z")
    a, b = R @ V((0, 0, 0.018)), R @ V((0.32 * s, 0, 0.018))
    P.beam(a, b, 0.028 * s, 0.024 * s, MAT.wood("Z", "fresh"), bevel=0.006)
    c = R @ V((0.3 * s, 0, 0.03))
    P.box((0.05 * s, 0.13 * s, 0.05 * s), c, MAT.iron(0.4), rot=(0, 0, yaw), bevel=0.008)


def saw(P, MAT, loc, rot=(0, 0, 0), s=1.0):
    M_ = Matrix.Translation(loc) @ Euler(rot).to_matrix().to_4x4()
    pts = [(0, 0), (0.55 * s, 0.02 * s), (0.55 * s, 0.1 * s), (0, 0.15 * s)]
    o = P.poly_prism(pts, -0.002, 0.002, MAT.iron(0.3), smooth=0)
    o.matrix_world = M_ @ Matrix.Rotation(math.pi / 2, 4, "X") @ o.matrix_world
    h = P.box((0.14 * s, 0.03 * s, 0.13 * s), (0, 0, 0), MAT.wood("Z", "fresh"), bevel=0.01)
    h.matrix_world = M_ @ Matrix.Translation((-0.06 * s, 0, 0.075 * s)) @ h.matrix_world


def bucket(P, MAT, loc, s=1.0, handle=True):
    x, y, z = loc
    prof = [(0.13 * s, 0.0), (0.135 * s, 0.01 * s), (0.16 * s, 0.26 * s), (0.155 * s, 0.27 * s), (0.14 * s, 0.27 * s),
            (0.12 * s, 0.03 * s)]
    P.lathe(prof, loc, MAT.wood("Z", "red"), n=14, cap_top=False, cap_bottom=True)
    for zz in (0.05, 0.22):
        r = (0.13 + 0.03 * (zz / 0.26)) * s + 0.004
        P.lathe([(r - 0.002, (zz - 0.012) * s), (r + 0.004, (zz - 0.012) * s), (r + 0.005, (zz + 0.012) * s),
                 (r - 0.002, (zz + 0.012) * s)], loc, MAT.iron(0.6), n=14, cap_top=False, cap_bottom=False, smooth=60)
    if handle:
        P.tube([(x - 0.16 * s, y, z + 0.24 * s), (x - 0.12 * s, y, z + 0.4 * s), (x, y, z + 0.45 * s),
                (x + 0.12 * s, y, z + 0.4 * s), (x + 0.16 * s, y, z + 0.24 * s)], 0.007 * s, MAT.iron(0.6), res=5)


def book(P, MAT, loc, size, yaw=0.0, color="#4a2018", tilt=0.0):
    w, d, h = size
    P.box((w, d, h), loc, MAT.leather(color), rot=(tilt, 0, yaw), bevel=0.006)
    pl = V(loc) + Matrix.Rotation(yaw, 3, "Z") @ V((0.006, 0, 0))
    P.box((w - 0.012, d - 0.016, h - 0.012), pl, MAT.flat("Pages", "#b8a888", 0.9), rot=(tilt, 0, yaw), bevel=0.002)


def candle(P, MAT, loc, h=0.12, r=0.02):
    x, y, z = loc
    P.cyl(r, h, loc, MAT.flat("Wax", "#cfc3a2", 0.6), n=8, smooth=50)
    P.cyl(r * 0.5, h * 0.35, (x, y, z + h + 0.004), MAT.glow("#ffc36b", 8.0, "GlowFlame"), n=6, r2=0.0, smooth=0)
    P.lathe([(r * 1.9, -0.012), (r * 2.0, 0.0), (r * 1.1, 0.004), (r * 1.1, 0.01)], loc, MAT.bronze(), n=10)


def flask(P, MAT, loc, kind="round", liquid="#57ff7a", s=1.0, level=0.55):
    """Glass flask with glowing liquid (lower rings use a Glow material, upper rings dark glass) + cork."""
    glass = MAT.flat("Glass", "#20302c", 0.08)
    liq = MAT.glow(liquid, 2.5, f"GlowPotion_{liquid[1:]}")
    if kind == "round":
        prof = [(0.0, 0.0), (0.05, 0.005), (0.085, 0.04), (0.095, 0.09), (0.08, 0.14), (0.03, 0.17), (0.022, 0.19),
                (0.022, 0.27), (0.028, 0.28)]
    elif kind == "cone":
        prof = [(0.0, 0.0), (0.085, 0.002), (0.09, 0.015), (0.03, 0.15), (0.022, 0.17), (0.022, 0.22), (0.027, 0.23)]
    elif kind == "vial":
        prof = [(0.0, 0.0), (0.018, 0.004), (0.022, 0.02), (0.022, 0.13), (0.026, 0.14)]
    else:  # bottle
        prof = [(0.0, 0.0), (0.05, 0.003), (0.055, 0.02), (0.055, 0.13), (0.03, 0.17), (0.018, 0.2), (0.018, 0.24),
                (0.022, 0.25)]
    prof = [(r * s, z * s) for r, z in prof]
    top = prof[-1][1]
    lvl = level * top
    P.lathe(prof, loc, None, n=12, mats=[glass, liq], cap_top=True, cap_bottom=False,
            mat_index=lambda j: 1 if prof[min(j + 1, len(prof) - 1)][1] <= lvl + 1e-6 else 0)
    x, y, z = loc
    P.cyl(prof[-1][0] * 0.8, 0.03 * s, (x, y, z + top - 0.008 * s), MAT.flat("Cork", "#6b4f33", 0.9), n=8,
          r2=prof[-1][0])


def _glow_group(m):
    m["kit_group"] = "Glow"
    return m


# =============================================================================== workbench
def build_workbench(args):
    MAT = sk.Mats()
    P = sk.Parts(seed=51)
    dark = MAT.wood("Z", "dark")
    fresh = MAT.wood("Z", "fresh")
    # top: 4 thick boards along X
    P.planks((-1.0, -0.4, 0.83), (1, 0, 0), (0, 1, 0), 2.0, 0.8, 4, MAT.wood("Z", "old"), thick=0.09, gap=0.01,
             bevel=0.012, ragged=0.04)
    # legs + stretchers + apron
    for sx in (-1, 1):
        for sy in (-1, 1):
            P.beam((sx * 0.84, sy * 0.3, 0.0), (sx * 0.84, sy * 0.3, 0.83), 0.12, 0.12, dark, bevel=0.018)
        P.beam((sx * 0.84, -0.36, 0.2), (sx * 0.84, 0.36, 0.2), 0.08, 0.1, dark, bevel=0.012, up=(0, 0, 1))
    for sy in (-1, 1):
        P.beam((-0.9, sy * 0.3, 0.2), (0.9, sy * 0.3, 0.2), 0.08, 0.08, dark, bevel=0.012, up=(0, 0, 1))
        P.beam((-0.92, sy * 0.365, 0.76), (0.92, sy * 0.365, 0.76), 0.12, 0.04, dark, bevel=0.01, up=(0, sy, 0))
    # lower shelf with stacked lumber
    P.planks((-0.8, -0.3, 0.24), (1, 0, 0), (0, 1, 0), 1.6, 0.6, 5, MAT.wood("Z", "old"), thick=0.025, gap=0.02)
    for k in range(4):
        a = V((-0.7 + 0.05 * k, -0.1 + (k % 2) * 0.18, 0.285 + k * 0.036))
        P.beam(a, a + V((1.3 - k * 0.1, 0.03 * (k - 1.5), 0)), 0.16, 0.035, fresh, bevel=0.004, up=(0, 0, 1))
    # back tool rack
    for sx in (-1, 1):
        P.beam((sx * 0.84, 0.36, 0.8), (sx * 0.84, 0.36, 1.42), 0.08, 0.08, dark, bevel=0.012)
    P.planks((-0.9, 0.325, 1.0), (1, 0, 0), (0, 0, 1), 1.8, 0.36, 3, MAT.wood("Z", "old"), thick=0.025, gap=0.008)
    P.beam((-0.95, 0.36, 1.42), (0.95, 0.36, 1.42), 0.09, 0.06, dark, bevel=0.012, up=(0, 0, 1))
    iron = MAT.iron(0.45)
    # hanging tools on pegs
    for x in (-0.6, -0.2, 0.25, 0.6):
        P.cyl(0.012, 0.08, (x, 0.33, 1.3), dark, rot=(math.pi / 2, 0, 0), n=6)
    saw(P, MAT, (-0.62, 0.3, 1.25), rot=(0, math.pi / 2 + 0.1, 0), s=0.9)
    for x, ln in ((-0.2, 0.28), (-0.12, 0.22)):
        P.beam((x, 0.3, 1.2), (x, 0.3, 1.2 - ln), 0.014, 0.01, iron, bevel=0.003)
        P.cyl(0.018, 0.1, (x, 0.3, 1.2), fresh, n=8)
    P.torus(0.12, 0.012, (0.6, 0.3, 1.16), MAT.rope(), rot=(math.pi / 2, 0, 0), seg=18, rseg=5)
    # vise on the front-left
    P.box((0.32, 0.1, 0.24), (-0.65, -0.46, 0.79), dark, bevel=0.015)
    P.cyl(0.02, 0.3, (-0.65, -0.3, 0.8), iron, rot=(math.pi / 2, 0, 0), n=8)
    P.cyl(0.015, 0.3, (-0.8, -0.56, 0.8), fresh, rot=(0, math.pi / 2, 0), n=8)
    # items on top: hammer, plane, board in progress, shavings, nail box
    hammer(P, MAT, (0.2, -0.15, 0.92), yaw=0.4)
    P.box((0.26, 0.07, 0.07), (-0.2, 0.1, 0.955), MAT.wood("Z", "red"), rot=(0, 0, 0.2), bevel=0.012)
    P.box((0.05, 0.075, 0.01), (-0.23, 0.095, 0.995), iron, rot=(0, 0.6, 0.2), bevel=0.002)
    P.beam((0.0, 0.2, 0.935), (0.9, 0.16, 0.935), 0.2, 0.03, fresh, bevel=0.004, up=(0, 0, 1))
    rnd = random.Random(3)
    for k in range(7):
        x, y = rnd.uniform(-0.1, 0.8), rnd.uniform(-0.3, 0.0)
        P.torus(0.025, 0.006, (x, y, 0.925), fresh, rot=(math.pi / 2, 0, rnd.uniform(0, 3)), seg=8, rseg=3)
    P.box((0.16, 0.12, 0.07), (-0.55, 0.2, 0.955), MAT.wood("Z", "old"), bevel=0.006)
    bucket(P, MAT, (0.72, -0.72, 0.0), s=1.1)
    return P.objs


# =============================================================================== alchemy table
def build_alchemy_table(args):
    MAT = sk.Mats()
    P = sk.Parts(seed=61)
    dark = MAT.wood("Z", "dark")
    tx = -0.28
    # table top + turned legs
    P.planks((tx - 0.8, -0.38, 0.8), (1, 0, 0), (0, 1, 0), 1.6, 0.76, 3, MAT.wood("Z", "red"), thick=0.06, gap=0.006,
             bevel=0.01)
    for sx in (-1, 1):
        for sy in (-1, 1):
            P.lathe([(0.045, 0.0), (0.05, 0.06), (0.035, 0.12), (0.045, 0.3), (0.03, 0.5), (0.045, 0.66),
                     (0.05, 0.8)], (tx + sx * 0.7, sy * 0.3, 0.0), dark, n=10)
        P.beam((tx + sx * 0.7, -0.3, 0.15), (tx + sx * 0.7, 0.3, 0.15), 0.05, 0.05, dark, bevel=0.01)
    P.beam((tx - 0.7, 0.0, 0.15), (tx + 0.7, 0.0, 0.15), 0.05, 0.05, dark, bevel=0.01)
    # back shelf unit
    for sx in (-1, 1):
        P.beam((tx + sx * 0.76, 0.34, 0.86), (tx + sx * 0.76, 0.34, 1.9), 0.07, 0.07, dark, bevel=0.012)
    for z in (1.28, 1.66):
        P.planks((tx - 0.73, 0.22, z), (1, 0, 0), (0, 1, 0), 1.46, 0.24, 1, MAT.wood("Z", "red"), thick=0.035)
    P.beam((tx - 0.8, 0.34, 1.88), (tx + 0.8, 0.34, 1.88), 0.08, 0.06, dark, bevel=0.012, up=(0, 0, 1))
    # flasks: on the table and shelves
    cols = ["#5dff6e", "#b561ff", "#4fc3ff", "#ff5a3c", "#ffd54a"]
    flask(P, MAT, (tx - 0.45, -0.12, 0.86), "round", cols[0], s=1.2)
    flask(P, MAT, (tx - 0.2, 0.05, 0.86), "cone", cols[1], s=1.1)
    flask(P, MAT, (tx + 0.05, -0.15, 0.86), "bottle", cols[2], s=1.0, level=0.7)
    for k, c in enumerate(cols):
        flask(P, MAT, (tx - 0.6 + k * 0.28, 0.32, 1.315), ["vial", "bottle", "round", "cone", "vial"][k], c,
              s=[1.2, 0.8, 0.75, 0.8, 1.3][k], level=0.6)
    for k, c in enumerate(cols[::-1][:4]):
        flask(P, MAT, (tx - 0.5 + k * 0.33, 0.3, 1.695), ["bottle", "vial", "cone", "round"][k], c, s=0.8, level=0.5)
    # vial rack
    P.box((0.3, 0.08, 0.04), (tx + 0.35, 0.12, 0.88), dark, bevel=0.006)
    for k in range(4):
        flask(P, MAT, (tx + 0.24 + k * 0.075, 0.12, 0.86), "vial", cols[(k + 2) % 5], s=0.9, level=0.7)
    # books + candles + mortar + crystals + scroll
    book(P, MAT, (tx + 0.55, -0.12, 0.855), (0.28, 0.2, 0.05), yaw=0.2, color="#3d1f1a")
    book(P, MAT, (tx + 0.56, -0.13, 0.9), (0.24, 0.18, 0.04), yaw=-0.1, color="#1f2a3a")
    book(P, MAT, (tx + 0.55, 0.3, 1.46), (0.05, 0.2, 0.26), yaw=0.0, color="#4a3a1a")
    book(P, MAT, (tx + 0.61, 0.3, 1.44), (0.05, 0.19, 0.22), yaw=0.0, color="#2a3a22")
    candle(P, MAT, (tx - 0.68, -0.25, 0.86), h=0.14)
    candle(P, MAT, (tx + 0.72, 0.1, 0.86), h=0.09)
    candle(P, MAT, (tx + 0.62, 0.3, 1.695), h=0.12, r=0.016)
    pale = MAT.stone("pale", 0.0)
    P.lathe([(0.05, 0.0), (0.075, 0.02), (0.085, 0.08), (0.07, 0.085), (0.055, 0.03), (0.0, 0.03)],
            (tx + 0.28, -0.25, 0.86), pale, n=12, cap_top=False)
    P.cyl(0.014, 0.16, (tx + 0.28, -0.24, 0.9), pale, rot=(0.4, 0.2, 0), n=8)
    cry = MAT._get("crystal", lambda: _glow_group(sk.M.crystal("GlowCrystal", color="#8f6bff", glow=0.8)))
    for k in range(4):
        P.cyl(0.03 - 0.004 * k, 0.12 + 0.03 * (k % 2), (tx - 0.1 + 0.03 * k, 0.33, 1.69), cry, n=6, r2=0.0,
              rot=(0.3 * (k - 1.5), 0.2 * (k % 2), 0), smooth=0)
    P.tube([(tx - 0.05, -0.28, 0.882), (tx + 0.15, -0.3, 0.882)], 0.022, MAT.flat("Parchment", "#c9b489", 0.9),
           kind="POLY")
    # cauldron on a small fire to the right
    cx, cy = 0.8, -0.05
    stone = MAT.stone("dark", 0.3)
    for k in range(7):
        a = k * 2 * math.pi / 7
        P.stone((0.2, 0.16, 0.13), (cx + 0.34 * math.cos(a), cy + 0.34 * math.sin(a), 0.05), stone,
                rot=(0, 0, a), seed=k + 21)
    P.ico(0.2, (cx, cy, 0.0), MAT.ember(), subdiv=2, scale=(1.2, 1.2, 0.35), jitter=0.02)
    for a in (0.3, 2.2, 4.1):
        P.beam((cx + 0.3 * math.cos(a), cy + 0.3 * math.sin(a), 0.0), (cx + 0.24 * math.cos(a), cy + 0.24 * math.sin(a), 0.3),
               0.03, 0.03, MAT.blackiron(), bevel=0.005)
    P.lathe([(0.12, 0.0), (0.22, 0.04), (0.29, 0.14), (0.3, 0.26), (0.27, 0.38), (0.28, 0.4), (0.3, 0.42),
             (0.3, 0.44), (0.26, 0.44), (0.25, 0.4), (0.26, 0.28), (0.2, 0.15), (0.0, 0.14)],
            (cx, cy, 0.28), MAT.iron(0.5), n=18, cap_top=False, cap_bottom=True)
    brew = MAT.glow("#63ff4a", 5.0, "GlowBrew")
    P.cyl(0.26, 0.02, (cx, cy, 0.28 + 0.34), brew, n=18)
    rnd = random.Random(4)
    for k in range(5):
        a, r = rnd.uniform(0, 6.28), rnd.uniform(0.0, 0.18)
        P.ico(0.025 + 0.02 * rnd.random(), (cx + r * math.cos(a), cy + r * math.sin(a), 0.64), brew, subdiv=1,
              scale=(1, 1, 0.6))
    P.beam((cx + 0.05, cy - 0.05, 0.55), (cx + 0.2, cy + 0.1, 1.0), 0.03, 0.02, MAT.wood("Z", "old"), bevel=0.005)
    return P.objs


# =============================================================================== well
def stone_ring(P, MAT, R, z0, z1, depth=0.3, course=(0.2, 0.28), length=(0.32, 0.55), seed=0, mat=None, name="Ring"):
    """Circular wall of GN-instanced irregular stones (outer radius R)."""
    rnd = random.Random(seed)
    mat = mat or MAT.stone("grey", 0.4)
    pts, rots, scls = [], [], []
    z = z0
    row = 0
    while z < z1 - 0.04:
        h = min(rnd.uniform(*course), z1 - z)
        if z1 - (z + h) < 0.08:
            h = z1 - z
        a = rnd.uniform(0, 2 * math.pi)
        circ = 2 * math.pi * (R - depth / 2)
        done = 0.0
        while done < circ - 0.05:
            ln = min(rnd.uniform(*length), circ - done)
            am = a + (done + ln / 2) / (R - depth / 2)
            rr = R - depth / 2 + rnd.uniform(-0.01, 0.01)
            pts.append((rr * math.cos(am), rr * math.sin(am), z + h / 2))
            rots.append((rnd.uniform(-0.03, 0.03), rnd.uniform(-0.03, 0.03), am + math.pi / 2))
            scls.append((ln * 1.02, depth, h - 0.012))
            done += ln
        z += h
        row += 1
    variants = sk.stone_variants(6, seed, mat)
    ob, col = sk.gn_instances(name, pts, variants, rots, scls, seed=seed)
    ob.data.materials.append(mat)
    gn.apply(ob)
    gn.remove(col)
    sk._smooth(ob.data, 180)
    return P.add_obj(ob)


def gable_roof(P, MAT, cx, cy, span, length, eave_z, ridge_z, overhang=0.25, ridge_axis="X", kind="wood",
               exposure=0.2, sh_w=0.26, thick=0.03, deck=0.05, seed=0, barge=True, ridge_cap=True, wood_tone="dark"):
    """Two shingle slopes (GN-free rows from sk.roof_rows) + deck boards + barge boards + ridge cap.
    span = width across the ridge, length = along the ridge (both without overhang)."""
    mat = MAT.shingles(kind)
    half = span / 2 + overhang
    run = span / 2
    pitch = math.atan2(ridge_z - eave_z, run)
    drop = overhang * math.tan(pitch)
    L = length + 2 * overhang
    out = []
    if ridge_axis == "X":
        wd = V((1, 0, 0))
        sides = [(V((cx, cy - half, eave_z - drop)), V((cx, cy, ridge_z))),
                 (V((cx, cy + half, eave_z - drop)), V((cx, cy, ridge_z)))]
    else:
        wd = V((0, 1, 0))
        sides = [(V((cx - half, cy, eave_z - drop)), V((cx, cy, ridge_z))),
                 (V((cx + half, cy, eave_z - drop)), V((cx, cy, ridge_z)))]
    for k, (pe, pr) in enumerate(sides):
        up = (pr - pe).normalized()
        nrm = wd.cross(up).normalized()
        if nrm.z < 0:
            nrm = -nrm
        # deck (roof boards) under the shingles
        c = (pe + pr) / 2 - nrm * (deck / 2)
        slope_len = (pr - pe).length
        deck_obj = P.beam(c - up * slope_len / 2, c + up * slope_len / 2, L, deck, MAT.wood("Z", wood_tone),
                          bevel=0.01, up=nrm)
        out.append(deck_obj)
        out.append(sk.roof_rows(P, mat, pe, pr - up * 0.02, wd, L, exposure=exposure, sh_w=sh_w, thick=thick,
                                seed=seed + k, name=f"RoofRows{k}", pointed=(kind != "slate")))
        if barge:
            for sgn in (-1, 1):
                off = wd * (sgn * (L / 2 + 0.02))
                P.beam(pe + off - nrm * 0.02 - up * 0.03, pr + off - nrm * 0.02 + up * 0.02, 0.05, 0.2,
                       MAT.wood("Z", wood_tone), bevel=0.012, up=nrm)
    if ridge_cap:
        a = V((cx, cy, ridge_z)) - wd * (L / 2 + 0.05)
        b = V((cx, cy, ridge_z)) + wd * (L / 2 + 0.05)
        # inverted V ridge boards
        for sgn in (-1, 1):
            if ridge_axis == "X":
                d = V((0, sgn * math.cos(pitch), -math.sin(pitch)))
            else:
                d = V((sgn * math.cos(pitch), 0, -math.sin(pitch)))
            nrm2 = V((d.y * 0, 0, 0))
            nn = (wd.cross(d)).normalized()
            if nn.z < 0:
                nn = -nn
            off = d * 0.1 + nn * 0.045
            P.beam(a + off, b + off, 0.22, 0.035, MAT.wood("Z", wood_tone), bevel=0.008, up=nn)
    return out


def build_well(args):
    MAT = sk.Mats()
    P = sk.Parts(seed=71)
    R = 1.12
    stone = MAT.stone("grey", 0.45)
    # ring wall of stones + inner shaft + water
    stone_ring(P, MAT, R, 0.0, 0.72, depth=0.3, seed=3, mat=stone)
    P.lathe([(R - 0.26, 0.2), (R - 0.26, 0.74), (R - 0.3, 0.74), (R - 0.3, 0.2)], (0, 0, 0), MAT.mortar(), n=28,
            cap_top=False, cap_bottom=False, smooth=40)
    P.cyl(R - 0.27, 0.22, (0, 0, 0.0), MAT._get("water", lambda: sk.M.flat("Water", "#0a1417", 0.04)), n=28)
    # coping: 12 cut stones in a ring (wedge prisms)
    blocks = MAT.blocks((0.5, 0.3))
    n = 12
    rnd = random.Random(8)
    for i in range(n):
        a0 = 2 * math.pi * i / n + 0.012
        a1 = 2 * math.pi * (i + 1) / n - 0.012
        ro, ri = R + 0.04, R - 0.32
        pts = []
        for k in range(4):
            a = a0 + (a1 - a0) * k / 3
            pts.append((ro * math.cos(a), ro * math.sin(a)))
        for k in range(4):
            a = a1 - (a1 - a0) * k / 3
            pts.append((ri * math.cos(a), ri * math.sin(a)))
        P.poly_prism(pts, 0.0, 0.14 + rnd.uniform(-0.01, 0.01), blocks, loc=(0, 0, 0.72), bevel=0.018, smooth=40)
    # timber frame: two posts on the coping, knee braces, beam
    post = MAT.wood("Z", "dark")
    zt = 2.35
    for sx in (-1, 1):
        x = sx * (R - 0.14)
        P.beam((x, 0, 0.86), (x, 0, zt), 0.16, 0.16, post, bevel=0.022)
        P.box((0.3, 0.3, 0.06), (x, 0, 0.89), MAT.iron(0.5), bevel=0.01)
        P.beam((x, 0, zt - 0.02), (x, 0, zt + 0.1), 0.2, 0.9, post, bevel=0.02, up=(0, 1, 0))           # cap block
        for sy in (-1, 1):
            P.beam((x, sy * 0.08, zt - 0.55), (x, sy * 0.42, zt + 0.02), 0.09, 0.09, post, bevel=0.012)
    # windlass: axle + drum with wound rope + crank
    az = 1.55
    P.cyl(0.035, 2 * R + 0.08, (-(R + 0.04), 0, az), MAT.wood("Z", "old"), rot=(0, math.pi / 2, 0), n=10)
    P.cyl(0.13, 0.9, (-0.45, 0, az), MAT.wood("Z", "old"), rot=(0, math.pi / 2, 0), n=14)
    rope = MAT.rope()
    for k in range(7):
        P.torus(0.14, 0.016, (-0.38 + k * 0.038, 0, az), rope, rot=(0, math.pi / 2, 0), seg=14, rseg=4)
    iron = MAT.blackiron()
    P.beam((R + 0.04, 0, az), (R + 0.04, 0, az - 0.3), 0.04, 0.04, iron, bevel=0.006)
    P.beam((R + 0.04, 0, az - 0.3), (R + 0.26, 0, az - 0.3), 0.035, 0.035, iron, bevel=0.006)
    P.cyl(0.022, 0.14, (R + 0.26, 0, az - 0.3), MAT.wood("Z", "old"), rot=(0, math.pi / 2, 0), n=8)
    # rope down to the bucket (hangs over the shaft, slightly in front)
    P.tube([(0.1, -0.14, az - 0.02), (0.1, -0.14, 1.4), (0.1, -0.14, 1.25)], 0.012, rope, res=5, kind="POLY")
    bucket(P, MAT, (0.1, -0.14, 0.78), s=1.2)
    # little roof, ridge along X
    gable_roof(P, MAT, 0, 0, 1.8, 2 * R - 0.1, zt + 0.1, 3.05, overhang=0.28, ridge_axis="X", kind="wood",
               exposure=0.16, sh_w=0.2, thick=0.025, deck=0.04, seed=5)
    # gable triangles (vertical boards) at both ends
    for sx in (-1, 1):
        x = sx * (R - 0.14)
        tri = [(-0.9, 0.0), (0.9, 0.0), (0.0, 3.0 - zt - 0.12)]
        rot = Matrix(((0, 0, 1), (1, 0, 0), (0, 1, 0))).to_euler()
        P.poly_prism(tri, -0.02, 0.02, MAT.planks("Y", "dark", (1.0, 0.18)), loc=(x, 0, zt + 0.1), rot=rot)
    # stones & bucket around the base, moss clumps via GN scatter on the coping
    for k, (x, y) in enumerate(((0.9, -1.05), (-1.1, -0.75), (1.2, 0.6))):
        P.stone((0.28, 0.22, 0.16), (x, y, 0.05), stone, rot=(0, 0, k), seed=40 + k)
    return P.objs


# =============================================================================== stall
def awning(P, mat, x0, x1, y_back, z_back, y_front, z_front, sag=0.06, seg=(16, 8), valance=0.24, scallops=6,
           thick=0.01):
    """Canvas roof sheet with sag between the rafters + scalloped valance hanging at the front."""
    nx, ny = seg
    verts, faces = [], []
    for j in range(ny + 1):
        t = j / ny
        for i in range(nx + 1):
            u = i / nx
            x = x0 + (x1 - x0) * u
            y = y_back + (y_front - y_back) * t
            z = z_back + (z_front - z_back) * t - sag * abs(math.sin(u * math.pi * 2)) * (0.35 + 0.65 * math.sin(math.pi * t))
            verts.append((x, y, z))
    for j in range(ny):
        for i in range(nx):
            faces.append((j * (nx + 1) + i, j * (nx + 1) + i + 1, (j + 1) * (nx + 1) + i + 1, (j + 1) * (nx + 1) + i))
    # valance: extra rows going down from the front edge with scalloped bottom
    base = ny * (nx + 1)
    rows = 3
    for r in range(1, rows + 1):
        for i in range(nx + 1):
            u = i / nx
            x = x0 + (x1 - x0) * u
            scal = 0.5 + 0.5 * math.cos(u * scallops * 2 * math.pi)
            dz = valance * (r / rows) * (0.65 + 0.35 * scal)
            verts.append((x, y_front - 0.01 * r, z_front - dz))
    for r in range(rows):
        a0 = base + r * (nx + 1)
        a1 = (ny + 1) * (nx + 1) + r * (nx + 1)
        if r == 0:
            a0 = base
        else:
            a0 = (ny + 1) * (nx + 1) + (r - 1) * (nx + 1)
        for i in range(nx):
            faces.append((a0 + i, a0 + i + 1, a1 + i + 1, a1 + i))
    o = P.mesh(verts, faces, mat, smooth=180, offset=False)
    gn.solidify(o, thick, offset=0.0)
    gn.apply(o)
    sk._smooth(o.data, 180)
    return o


def build_stall(args):
    MAT = sk.Mats()
    P = sk.Parts(seed=81)
    post = MAT.wood("Z", "dark")
    old = MAT.wood("Z", "old")
    W, Dp = 2.9, 1.8
    yf, yb = -0.8, 0.8
    # posts (front lower, back higher -> canvas slopes to the front)
    for sx in (-1, 1):
        P.beam((sx * 1.38, yf, 0.0), (sx * 1.38, yf, 2.3), 0.12, 0.12, post, bevel=0.018)
        P.beam((sx * 1.38, yb, 0.0), (sx * 1.38, yb, 2.72), 0.12, 0.12, post, bevel=0.018)
        P.beam((sx * 1.38, yf - 0.05, 2.28), (sx * 1.38, yb + 0.05, 2.74), 0.08, 0.1, post, bevel=0.012)   # rafter
        P.stone((0.3, 0.3, 0.14), (sx * 1.38, yf, 0.04), MAT.stone("grey", 0.3), seed=3 + sx)
        P.stone((0.3, 0.3, 0.14), (sx * 1.38, yb, 0.04), MAT.stone("grey", 0.3), seed=5 + sx)
    P.beam((-1.45, yf, 2.26), (1.45, yf, 2.26), 0.1, 0.1, post, bevel=0.014)
    P.beam((-1.45, yb, 2.68), (1.45, yb, 2.68), 0.1, 0.1, post, bevel=0.014)
    P.beam((0, yf, 2.3), (0, yb, 2.72), 0.07, 0.08, post, bevel=0.01)
    # counter: front board wall (vertical planks) + top
    P.planks((-1.32, yf + 0.02, 0.05), (1, 0, 0), (0, 0, 1), 2.64, 0.85, 12, old, thick=0.03, gap=0.01, along="v",
             ragged=0.03)
    P.planks((-1.36, yf - 0.1, 0.92), (1, 0, 0), (0, 1, 0), 2.72, 0.62, 3, MAT.wood("Z", "red"), thick=0.05,
             gap=0.008, bevel=0.01)
    for sx in (-1, 1):
        P.planks((sx * 1.3, yf + 0.05, 0.05), (0, 1, 0), (0, 0, 1), 0.45, 0.85, 3, old, thick=0.03, along="v")
    P.beam((-1.3, yf + 0.06, 0.5), (1.3, yf + 0.06, 0.5), 0.08, 0.05, post, bevel=0.01, up=(0, 1, 0))
    # back shelf
    P.planks((-1.3, yb - 0.3, 1.2), (1, 0, 0), (0, 1, 0), 2.6, 0.3, 1, MAT.wood("Z", "red"), thick=0.04)
    P.planks((-1.3, yb - 0.02, 0.1), (1, 0, 0), (0, 0, 1), 2.6, 1.6, 7, old, thick=0.025, gap=0.012)
    # canvas awning (Cloth* -> wind in the client), striped
    can = MAT.cloth("ClothAwning", "#7a2a1e", kind="linen", stripes=("#c9b48a", 0.22, "X"))
    awning(P, can, -1.52, 1.52, yb + 0.12, 2.9, yf - 0.28, 2.38, sag=0.06)
    # goods: produce in crates, baskets, sacks, hanging herbs + lantern, a brass scale
    rnd = random.Random(12)
    for k, (x, col) in enumerate(((-0.95, "#7a1c14"), (-0.45, "#5e7a2a"), (0.1, "#b0762a"))):
        P.box((0.44, 0.34, 0.14), (x, yf + 0.18, 1.04), old, bevel=0.01)
        fr = MAT.flat(f"Fruit{k}", col, 0.55)
        for j in range(9):
            P.ico(0.045, (x - 0.15 + (j % 3) * 0.15 + rnd.uniform(-0.02, 0.02), yf + 0.08 + (j // 3) * 0.1,
                          1.13 + rnd.uniform(0, 0.02)), fr, subdiv=1, jitter=0.006)
    # basket (lathe) with bread loaves
    P.lathe([(0.12, 0.0), (0.2, 0.12), (0.22, 0.14), (0.2, 0.14), (0.1, 0.02), (0.0, 0.02)], (0.75, yf + 0.2, 0.97),
            MAT.planks("X", "old", (0.3, 0.02)), n=16, cap_top=False)
    for j in range(3):
        P.ico(0.07, (0.7 + j * 0.06, yf + 0.2, 1.1), MAT.flat("Bread", "#a86a2e", 0.8), subdiv=2,
              scale=(1.3, 0.8, 0.6), rot=(0, 0, j))
    # sacks leaning in front
    burlap = MAT._get("sack", lambda: sk.M.cloth("Sack", color="#8a7453", kind="burlap", dirt=0.6, hem_dirt=0.5))
    for k, (x, y) in enumerate(((1.1, yf - 0.35), (0.75, yf - 0.3))):
        P.ico(0.24, (x, y, 0.2), burlap, subdiv=2, scale=(1.05, 0.9, 1.05), jitter=0.035, rot=(0.1, -0.15, k))
        P.cyl(0.07, 0.14, (x + 0.02, y, 0.42), burlap, n=8, r2=0.11, rot=(0.15, 0.1, 0))
        P.torus(0.075, 0.012, (x + 0.024, y, 0.47), MAT.rope(), rot=(0.15, 0.1, 0), seg=10, rseg=4)
    # hanging herbs bundles on the front beam
    herb = MAT.flat("Herbs", "#3d4722", 0.9)
    for k in range(5):
        x = -1.1 + k * 0.4
        P.tube([(x, yf, 2.2), (x, yf, 2.0)], 0.005, MAT.rope(), res=4, kind="POLY")
        for j in range(5):
            a = j * 2 * math.pi / 5 + k
            P.cyl(0.004, 0.32, (x, yf, 2.02), herb, n=4, r2=0.035,
                  rot=(math.pi + 0.18 * math.cos(a), 0.18 * math.sin(a), 0), smooth=0)
    # scale on the counter
    brass = MAT.bronze()
    P.cyl(0.012, 0.3, (-0.2, yf + 0.5, 0.97), brass, n=6)
    P.beam((-0.4, yf + 0.5, 1.27), (0.0, yf + 0.5, 1.27), 0.015, 0.015, brass, bevel=0.003)
    for x in (-0.4, 0.0):
        P.lathe([(0.0, 0.0), (0.08, 0.01), (0.09, 0.03)], (x, yf + 0.5, 1.1), brass, n=12, cap_top=False)
    return P.objs
