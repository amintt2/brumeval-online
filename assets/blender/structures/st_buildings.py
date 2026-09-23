"""Village buildings: house, house_b, tavern, forge, windmill, watchtower.

Generic pieces (timber-framed storey, openings, gables, plinth, chimney) are shared; every wall is built from
separate parts (plaster panel, sills, posts, studs, braces, window/door kits) so the kit's OBJECT-space materials
follow each piece.
"""
import math
import random

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

import sk
import st_props as SP
from kit import gn
from kit import materials as M

V = Vector


# =============================================================================== extra materials
def lattice_glow(MAT, color="#ffae52", strength=5.0, cell=0.11):
    """Leaded diamond-pane window glass: warm emissive light cut by a dark lead lattice (panes live in local XZ)."""
    def mk():
        m, nb, bsdf = M._new("GlowWindowLead", "window")
        tc = nb.node("ShaderNodeTexCoord").outputs["Object"]
        s = nb.sep(tc)
        a = nb.math("FRACT", nb.math("DIVIDE", nb.add(s[0], s[2]), cell))
        b = nb.math("FRACT", nb.math("DIVIDE", nb.sub(s[0], s[2]), cell))
        la = nb.maprange(nb.math("ABSOLUTE", nb.sub(a, 0.5)), 0.43, 0.47)
        lb = nb.maprange(nb.math("ABSOLUTE", nb.sub(b, 0.5)), 0.43, 0.47)
        lead = nb.math("MAXIMUM", la, lb)
        flick = nb.noise(nb.vmath("SCALE", tc, scale=6.0), 1.0, 3.0).outputs["Fac"]
        glass = nb.mix(color, "#fff0c8", nb.maprange(flick, 0.4, 0.8, 0.0, 0.35))
        emis = nb.mix(glass, "#000000", lead)
        emis = nb.mix(emis, nb.mix(emis, "#000000", 0.5), nb.maprange(flick, 0.2, 0.45, 0.6, 0.0))
        col = nb.mix(nb.mix(color, "#000000", 0.5), "#1a1612", lead)
        m["kit_group"] = "Glow"
        return M._finish(m, nb, bsdf, col, nb.mixf(0.15, 0.6, lead), nb.mul(lead, 0.5), metal=nb.mixf(0.0, 0.6, lead),
                         emission=emis, emit_strength=strength, vec=tc, bump_dist=0.004)
    return MAT._get(("lattice", color), mk)


# =============================================================================== helpers
def wall_frame(a, b):
    a, b = V((*a, 0)), V((*b, 0))
    t = (b - a).normalized()
    n = V((t.y, -t.x, 0))
    return a, b, t, n, (b - a).length


def log_part(P, MAT, p0, p1, r):
    """Firewood log: bark sides + pale end grain (two material slots)."""
    p0, p1 = V(p0), V(p1)
    bm = bmesh.new()
    L = (p1 - p0).length
    geom = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=7, radius1=r, radius2=r * 0.97, depth=L)
    for f in bm.faces:
        f.material_index = 1 if abs(f.normal.z) > 0.9 else 0
    for v in bm.verts:
        v.co.x += P.rnd.uniform(-0.1, 0.1) * r
        v.co.y += P.rnd.uniform(-0.1, 0.1) * r
    z = (p1 - p0).normalized()
    R = z.to_track_quat("Z", "Y").to_matrix().to_4x4()
    bark = MAT._get("logbark", lambda: M.bark("LogBark", kind="oak", moss=0.1))
    endg = MAT.wood("X", "fresh")
    return P.add_bm(bm, None, Matrix.Translation((p0 + p1) / 2) @ R, smooth=50, mats=[bark, endg])


def firewood(P, MAT, origin, along, length=1.6, height=0.9, depth=0.42, r=0.075):
    """Stack of split logs; `along` = unit vector of the stack length, logs point away from the wall."""
    o, u = V(origin), V(along).normalized()
    out = V((u.y, -u.x, 0))
    rows = int(height / (2 * r * 0.95))
    for j in range(rows):
        n = int(length / (2 * r)) - (j % 2)
        for i in range(n):
            c = o + u * ((i + 0.5 + 0.5 * (j % 2)) * 2 * r) + V((0, 0, r + j * 2 * r * 0.92))
            d = depth * P.rnd.uniform(0.9, 1.05)
            log_part(P, MAT, c - out * 0.02, c + out * d, r * P.rnd.uniform(0.85, 1.05))


# =============================================================================== plinth / stone walls
def plinth(P, MAT, x0, x1, y0, y1, h, seed=0, stone=None, core_inset=0.2):
    stone = stone or MAT.stone("grey", 0.45)
    segs = [((x0, y0), (x1, y0)), ((x1, y0), (x1, y1)), ((x1, y1), (x0, y1)), ((x0, y1), (x0, y0))]
    sk.stone_wall(P, segs, 0.0, h, stone, seed=seed, course=(0.3, 0.42), length=(0.5, 0.95), depth=0.32,
                  protrude=0.05)
    P.box((x1 - x0 - 2 * core_inset, y1 - y0 - 2 * core_inset, h + 0.02), ((x0 + x1) / 2, (y0 + y1) / 2, h / 2),
          MAT.mortar(), bevel=0.0, smooth=0)


# =============================================================================== openings
def window(P, MAT, c, t, n, w, h, shutters="open", box=False, lead=True):
    """Window kit centred at c (on the plaster face), t = wall tangent, n = outward normal."""
    c = V(c)
    R = Matrix((t, n, V((0, 0, 1)))).transposed().to_4x4()        # local X = t, local Y = n (out), Z up
    glow = lattice_glow(MAT) if lead else MAT.glow()
    # pane in local XZ (lattice), slightly proud of the plaster
    bm = bmesh.new()
    sk.bm_box(bm, w, 0.02, h)
    P.add_bm(bm, glow, Matrix.Translation(c + n * 0.005) @ R, offset=False)
    frame = MAT.wood("Z", "dark")
    fw, fd = 0.09, 0.07
    zb, zt = c.z - h / 2, c.z + h / 2
    for s in (-1, 1):
        x = c + t * (s * (w / 2 + fw / 2))
        P.beam(V((x.x, x.y, zb - fw)) + n * (fd / 2), V((x.x, x.y, zt + fw)) + n * (fd / 2), fw, fd, frame,
               bevel=0.012, up=n, outer=True)
    P.beam(c - t * (w / 2 + fw) + V((0, 0, h / 2 + fw / 2)) + n * (fd / 2),
           c + t * (w / 2 + fw) + V((0, 0, h / 2 + fw / 2)) + n * (fd / 2), fw, fd, frame, bevel=0.012, up=n, outer=True)
    # sill ledge sticking out
    P.beam(c - t * (w / 2 + fw + 0.05) + V((0, 0, -h / 2 - fw / 2)) + n * 0.06,
           c + t * (w / 2 + fw + 0.05) + V((0, 0, -h / 2 - fw / 2)) + n * 0.06, 0.07, 0.14, frame, bevel=0.012, up=V((0, 0, 1)))
    # mullion + transom
    P.beam(c + V((0, 0, -h / 2)) + n * 0.03, c + V((0, 0, h / 2)) + n * 0.03, 0.045, 0.04, frame, bevel=0.0, up=n)
    P.beam(c - t * (w / 2) + V((0, 0, h * 0.12)) + n * 0.03, c + t * (w / 2) + V((0, 0, h * 0.12)) + n * 0.03, 0.045,
           0.04, frame, bevel=0.0, up=n)
    if shutters:
        sh = MAT.wood("Z", "red")
        for s in (-1, 1):
            if shutters == "open":
                base = c + t * (s * (w / 2 + fw + 0.02)) + n * 0.03
                u_dir = t * s
            else:
                base = c + t * (s * (w / 2)) + n * 0.09
                u_dir = -t * s
            nb = 3
            bw = (w / 2) / nb
            for i in range(nb):
                cc = base + u_dir * (bw * (i + 0.5))
                P.beam(V((cc.x, cc.y, zb + 0.01)), V((cc.x, cc.y, zt - 0.01)), bw - 0.008, 0.03, sh, bevel=0.0, up=n)
            # Z brace boards
            for zz in (zb + 0.12, zt - 0.12):
                cc = base + u_dir * (w / 4)
                P.beam(cc - u_dir * (w / 4 - 0.03) + V((0, 0, zz - cc.z)) + n * 0.03,
                       cc + u_dir * (w / 4 - 0.03) + V((0, 0, zz - cc.z)) + n * 0.03, 0.08, 0.025, sh, bevel=0.0, up=n)
    if box:   # flower box with herbs
        bc = c + V((0, 0, -h / 2 - fw - 0.12)) + n * 0.2
        P.box((w + 0.1, 0.22, 0.18), bc, MAT.wood("Z", "old"), rot=(0, 0, math.atan2(t.y, t.x)), bevel=0.01)
        herb = MAT.flat("Herbs", "#3f5226", 0.9)
        for k in range(5):
            p = bc + t * ((k - 2) * (w / 5)) + V((0, 0, 0.12))
            P.ico(0.1, p, herb, subdiv=1, scale=(1.2, 1.0, 0.8), jitter=0.02)


def door(P, MAT, c, t, n, w=1.1, h=2.1, arched=False):
    """Plank door (bottom centre at c on the plaster face) with iron strap hinges, frame and ring pull."""
    c = V(c)
    frame = MAT.wood("Z", "dark")
    leaf = MAT.wood("Z", "red")
    iron = MAT.blackiron()
    nbds = 6
    bw = w / nbds
    for i in range(nbds):
        x = c + t * (-w / 2 + bw * (i + 0.5)) + n * 0.03
        top = h - (0.0 if not arched else 0.25 * (1 - ((i + 0.5) / nbds * 2 - 1) ** 2) * 0 )
        P.beam(V((x.x, x.y, c.z + 0.01)), V((x.x, x.y, c.z + top)), bw - 0.01, 0.05, leaf, bevel=0.007, up=n)
    # frame (protrudes -> recessed look) + lintel
    for s in (-1, 1):
        x = c + t * (s * (w / 2 + 0.08)) + n * 0.08
        P.beam(V((x.x, x.y, c.z)), V((x.x, x.y, c.z + h + 0.16)), 0.16, 0.16, frame, bevel=0.018, up=n, outer=True)
    P.beam(c - t * (w / 2 + 0.28) + V((0, 0, h + 0.1)) + n * 0.09, c + t * (w / 2 + 0.28) + V((0, 0, h + 0.1)) + n * 0.09,
           0.2, 0.18, frame, bevel=0.02, up=n, outer=True)
    # iron straps with nails + ring
    pts, nn = [], []
    for zz in (0.35, h - 0.4):
        a = c + t * (-w / 2 + 0.02) + V((0, 0, zz)) + n * 0.062
        b = c + t * (w / 2 - 0.15) + V((0, 0, zz)) + n * 0.062
        P.beam(a, b, 0.07, 0.012, iron, bevel=0.003, up=n)
        P.cyl(0.05, 0.012, b + t * 0.02, iron, rot=Euler((math.pi / 2, 0, math.atan2(t.y, t.x))), n=8)
        for k in range(5):
            p = a.lerp(b, (k + 0.5) / 5) + n * 0.008
            pts.append(p)
            nn.append(n)
    P.nail_heads(pts, nn, iron, r=0.011)
    rc = c + t * (w * 0.3) + V((0, 0, h * 0.5)) + n * 0.075
    P.torus(0.06, 0.009, rc, iron, rot=Euler((math.pi / 2, 0, math.atan2(t.y, t.x))), seg=12, rseg=4)
    P.box((0.07, 0.015, 0.07), rc + V((0, 0, 0.06)) - n * 0.01, iron, rot=(0, 0, math.atan2(t.y, t.x)), bevel=0.004)


# =============================================================================== timber-framed storey
def storey(P, MAT, x0, x1, y0, y1, z0, z1, openings, seed=0, wall_t=0.2, beam=0.2, stud_step=1.0, braces=True,
           posts=True, plaster=None):
    """Plaster walls with a timber frame. openings = {side: [dict(u, w, z0, z1, kind, shutters, box)]},
    side in front/right/back/left (CCW, u measured from the wall's start corner)."""
    rnd = random.Random(seed)
    plaster = plaster or MAT.plaster()
    wood = MAT.wood("Z", "dark")
    sides = {"front": ((x0, y0), (x1, y0)), "right": ((x1, y0), (x1, y1)), "back": ((x1, y1), (x0, y1)),
             "left": ((x0, y1), (x0, y0))}
    bd = beam * 0.9                         # beam depth (outward)
    for side, (A, B) in sides.items():
        a, b, t, n, L = wall_frame(A, B)
        ops = openings.get(side, [])
        # plaster panel (side walls fit between the front/back panels -> no coplanar overlaps)
        inset = wall_t if side in ("right", "left") else 0.0
        mid = (a + b) / 2 - n * (wall_t / 2)
        bm = bmesh.new()
        sk.bm_box(bm, L - 2 * inset - 0.002, wall_t, z1 - z0)
        R = Matrix((t, n, V((0, 0, 1)))).transposed().to_4x4()
        P.add_bm(bm, plaster, Matrix.Translation(V((mid.x, mid.y, (z0 + z1) / 2))) @ R, smooth=0)
        off = n * (0.035 - bd / 2)          # beams protrude 3.5 cm from the plaster
        # sill + top plate
        P.beam(a + off + V((0, 0, z0 + beam / 2)) - t * 0.02, b + off + V((0, 0, z0 + beam / 2)) + t * 0.02, beam, bd,
               wood, bevel=0.02, up=n, outer=True)
        P.beam(a + off + V((0, 0, z1 - beam / 2)) - t * 0.05, b + off + V((0, 0, z1 - beam / 2)) + t * 0.05, beam, bd,
               wood, bevel=0.02, up=n, outer=True)
        # posts: corners + studs avoiding openings
        us = [beam / 2 + 0.01, L - beam / 2 - 0.01]
        k = 1
        while k * stud_step < L - stud_step * 0.5:
            us.append(k * stud_step + rnd.uniform(-0.05, 0.05))
            k += 1
        blocked = []
        for o in ops:
            blocked.append((o["u"] - o["w"] / 2 - 0.2, o["u"] + o["w"] / 2 + 0.2))
            us += [o["u"] - o["w"] / 2 - 0.19, o["u"] + o["w"] / 2 + 0.19]
        us = sorted(u for u in us if not any(lo + 0.02 < u < hi - 0.02 for lo, hi in blocked) or
                    any(abs(u - (o["u"] - o["w"] / 2 - 0.19)) < 1e-6 or abs(u - (o["u"] + o["w"] / 2 + 0.19)) < 1e-6
                        for o in ops))
        dedup = []
        for u in us:
            if not dedup or u - dedup[-1] > beam * 1.2:
                dedup.append(u)
        us = dedup
        zr = z0 + (z1 - z0) * 0.48            # mid rail height
        for u in us:
            p = a + t * u + off
            corner = u < beam or u > L - beam
            w_ = beam * (1.1 if corner else 0.8)
            P.beam(V((p.x, p.y, z0 + beam)), V((p.x, p.y, z1 - beam)), w_, bd * (1.0 if corner else 0.92), wood,
                   bevel=0.02, up=n, outer=True)
        # mid rail + braces between studs (skip where openings are)
        for i in range(len(us) - 1):
            u0, u1 = us[i], us[i + 1]
            seg_ops = [o for o in ops if u0 - 0.01 < o["u"] < u1 + 0.01]
            if not seg_ops:
                pa = a + t * (u0 + beam * 0.4) + off
                pb = a + t * (u1 - beam * 0.4) + off
                P.beam(V((pa.x, pa.y, zr)), V((pb.x, pb.y, zr)), beam * 0.75, bd * 0.9, wood, bevel=0.018, up=n, outer=True)
                if braces and (u1 - u0) > 0.6:
                    lo, hi = (z0 + beam, zr - beam * 0.4) if (i % 2 == 0) else (zr + beam * 0.4, z1 - beam)
                    if rnd.random() < 0.5:
                        pa, pb = pb, pa
                    P.beam(V((pa.x, pa.y, lo)), V((pb.x, pb.y, hi)), beam * 0.7, bd * 0.85, wood, bevel=0.018, up=n, outer=True)
                    if (i % 3 == 1):       # St Andrew's cross in some panels
                        P.beam(V((pb.x, pb.y, lo)), V((pa.x, pa.y, hi)), beam * 0.6, bd * 0.8, wood, bevel=0.016, up=n, outer=True)
            else:
                for o in seg_ops:
                    lo_u, hi_u = o["u"] - o["w"] / 2, o["u"] + o["w"] / 2
                    for zz in ((o["z0"] - 0.1,) if o["kind"] == "window" else ()) + (o["z1"] + 0.12,):
                        if zz > z1 - beam * 1.2:
                            continue
                        pa = a + t * (u0 + beam * 0.4) + off
                        pb = a + t * (u1 - beam * 0.4) + off
                        P.beam(V((pa.x, pa.y, zz)), V((pb.x, pb.y, zz)), beam * 0.7, bd * 0.9, wood, bevel=0.018, up=n, outer=True)
        # openings
        for o in ops:
            cu = a + t * o["u"]
            if o["kind"] == "window":
                c = V((cu.x, cu.y, (o["z0"] + o["z1"]) / 2))
                window(P, MAT, c, t, n, o["w"], o["z1"] - o["z0"], shutters=o.get("shutters", "open"),
                       box=o.get("box", False))
            elif o["kind"] == "door":
                door(P, MAT, V((cu.x, cu.y, o["z0"])), t, n, o["w"], o["z1"] - o["z0"])


def gable(P, MAT, cx, y_face, x_half, z0, z1, n_sign, seed=0, window_w=0.5, window_h=0.6, plaster=None):
    """Triangular gable (plaster + timber) in the XZ plane at y = y_face, facing n_sign*Y."""
    plaster = plaster or MAT.plaster()
    wood = MAT.wood("Z", "dark")
    t = V((1, 0, 0)) if n_sign < 0 else V((-1, 0, 0))
    n = V((0, n_sign, 0))
    tri = [(-x_half, 0.0), (x_half, 0.0), (0.0, z1 - z0)]
    rot = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0))).to_euler()    # local XY -> world XZ, extrude along -Y
    P.poly_prism(tri, 0.0, 0.2, plaster, loc=(cx, y_face + (0.2 if n_sign < 0 else 0.0), z0), rot=rot, smooth=0)
    off = n * (0.035 - 0.09)
    base = V((cx, y_face, 0))
    # king post + collar + struts
    P.beam(base + off + V((0, 0, z0 + 0.1)), base + off + V((0, 0, z1 - 0.2)), 0.18, 0.17, wood, bevel=0.02, up=n, outer=True)
    zc = z0 + (z1 - z0) * 0.4
    xc = x_half * (1 - 0.4) - 0.1
    P.beam(base + off + V((-xc, 0, zc)), base + off + V((xc, 0, zc)), 0.18, 0.17, wood, bevel=0.02, up=n, outer=True)
    for s in (-1, 1):
        P.beam(base + off + V((s * 0.1, 0, zc + 0.1)), base + off + V((s * xc * 0.55, 0, z0 + (z1 - z0) * 0.72 - 0.1)),
               0.15, 0.16, wood, bevel=0.018, up=n, outer=True)
        P.beam(base + off + V((s * 0.12, 0, z0 + 0.12)), base + off + V((s * (xc - 0.1), 0, zc - 0.1)),
               0.15, 0.16, wood, bevel=0.018, up=n, outer=True)
    if window_w:
        c = V((cx + 0.0, y_face, zc + 0.08 + window_h / 2 + 0.08))
        # small attic window left of the king post
        window(P, MAT, c + V((-x_half * 0.28, 0, -window_h * 0.1)), t, n, window_w * 0.8, window_h * 0.8, shutters=None)


def chimney(P, MAT, x, y, z0, z1, w=0.75, d=0.6):
    blocks = MAT.blocks((0.34, 0.2))
    P.box((w, d, z1 - z0), (x, y, (z0 + z1) / 2), blocks, bevel=0.02, smooth=0)
    P.box((w + 0.12, d + 0.12, 0.12), (x, y, z1 - 0.3), blocks, bevel=0.02, smooth=0)
    P.box((w + 0.16, d + 0.16, 0.1), (x, y, z1 + 0.02), blocks, bevel=0.02, smooth=0)
    P.cyl(0.14, 0.3, (x - 0.1, y, z1 + 0.07), MAT.mortar(), n=10, r2=0.12)
    P.cyl(0.12, 0.25, (x + 0.16, y + 0.05, z1 + 0.07), MAT.mortar(), n=10, r2=0.1)
    soot = MAT.flat("Soot", "#0b0908", 0.95)
    P.cyl(0.1, 0.02, (x - 0.1, y, z1 + 0.36), soot, n=10)
    P.cyl(0.085, 0.02, (x + 0.16, y + 0.05, z1 + 0.31), soot, n=10)


def moss_on(P, MAT, target, density=2.0, seed=0, scale=(0.5, 1.2)):
    """GN-scatter a few moss clumps on the up-facing faces of `target` (roof rows)."""
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.1)
    cl = bpy.context.object
    cl.name = "_MossClump"
    cl.scale = (1.0, 0.8, 0.3)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    cl.data.materials.append(MAT.moss())
    for p in cl.data.polygons:
        p.use_smooth = True
    gn.scatter(target, cl, density=density, up_min=0.55, scale=scale, embed=0.02, seed=seed, distance_min=0.25,
               rot_random=(0.1, 0.1, 3.14))
    gn.apply(target)
    gn.remove(cl)


# =============================================================================== HOUSE
def build_house(args):
    """≈6×6 m cottage: stone plinth, timber-framed plaster walls, front gable with door (-Y), wood shingles."""
    MAT = sk.Mats()
    P = sk.Parts(seed=101)
    x0, x1, y0, y1 = -2.8, 2.8, -2.8, 2.8
    zp, ze = 0.75, 3.0
    ridge = 5.55
    plinth(P, MAT, x0, x1, y0, y1, zp, seed=3)
    W = x1 - x0
    ops = {
        "front": [dict(u=W / 2, w=1.1, z0=zp, z1=zp + 2.05, kind="door"),
                  dict(u=1.05, w=0.75, z0=1.35, z1=2.2, kind="window", shutters="open", box=True),
                  dict(u=W - 1.05, w=0.75, z0=1.35, z1=2.2, kind="window", shutters="open")],
        "right": [dict(u=1.5, w=0.8, z0=1.35, z1=2.2, kind="window", shutters="open"),
                  dict(u=4.1, w=0.8, z0=1.35, z1=2.2, kind="window", shutters="closed")],
        "back": [dict(u=W / 2, w=0.8, z0=1.35, z1=2.2, kind="window", shutters="open")],
        "left": [dict(u=W / 2 + 0.9, w=0.8, z0=1.35, z1=2.2, kind="window", shutters="open")],
    }
    storey(P, MAT, x0, x1, y0, y1, zp, ze, ops, seed=5)
    # gables (front/back) + roof (ridge along Y)
    gable(P, MAT, 0.0, y0, W / 2, ze, ridge - 0.1, -1, window_w=0.55, window_h=0.6)
    gable(P, MAT, 0.0, y1, W / 2, ze, ridge - 0.1, +1, window_w=0.0)
    roof = SP.gable_roof(P, MAT, 0.0, 0.0, W, y1 - y0, ze, ridge, overhang=0.38, ridge_axis="Y", kind="wood",
                         exposure=0.26, sh_w=0.36, thick=0.035, deck=0.06, seed=9)
    # moss on the north-ish slope rows
    rows = [o for o in roof if o.name.startswith("RoofRows")]
    moss_on(P, MAT, rows[1], density=0.45, seed=4)
    # front steps
    blocks = MAT.blocks((0.6, 0.25))
    for k, (dy, h) in enumerate(((-0.95, 0.25), (-0.65, 0.5), (-0.35, 0.75))):
        P.stone((1.5 - 0.1 * k, 0.34, 0.26), (0.0, y0 + dy + 0.02, h - 0.12), MAT.stone("warm", 0.3), seed=60 + k,
                rot=(0, 0, 0.02 * k))
    # small pent roof over the door on carved brackets
    wood = MAT.wood("Z", "dark")
    for s in (-1, 1):
        P.beam((s * 0.8, y0 + 0.02, zp + 2.35), (s * 0.8, y0 - 0.55, zp + 2.5), 0.1, 0.12, wood, bevel=0.015)
        P.beam((s * 0.8, y0 + 0.02, zp + 1.95), (s * 0.8, y0 - 0.45, zp + 2.47), 0.08, 0.08, wood, bevel=0.012)
    pe = V((0, y0 - 0.7, zp + 2.43))
    pr = V((0, y0 + 0.02, zp + 2.78))
    sd = (pr - pe).normalized()
    pn = V((1, 0, 0)).cross(sd).normalized()
    if pn.z < 0:
        pn = -pn
    P.beam(pe - pn * 0.025, pr - pn * 0.025, 2.0, 0.04, wood, bevel=0.01, up=pn)
    sk.roof_rows(P, MAT.shingles("wood"), pe, pr, (1, 0, 0), 2.0, exposure=0.2, sh_w=0.3, thick=0.03, seed=17,
                 name="PentRows")
    # lantern by the door
    iron = MAT.blackiron()
    P.tube([(0.85, y0 + 0.05, zp + 1.85), (0.85, y0 - 0.25, zp + 1.87), (0.85, y0 - 0.33, zp + 1.84)], 0.014, iron,
           kind="POLY")
    SP.lantern(P, MAT, (0.85, y0 - 0.33, zp + 1.84), scale=0.8)
    # internal chimney through the back slope
    chimney(P, MAT, 1.3, 1.3, 3.2, 6.3)
    # firewood stack against the left wall
    firewood(P, MAT, (x0 - 0.07, 1.9, 0.0), (0, -1, 0), length=1.5, height=0.95, depth=0.45)
    # rain barrel at the front right corner
    P.lathe([(0.3, 0.0), (0.34, 0.35), (0.3, 0.72), (0.27, 0.72), (0.27, 0.68)], (x1 + 0.1, y0 - 0.35, 0.0),
            MAT.wood("Z", "red"), n=16, cap_top=False)
    P.cyl(0.275, 0.02, (x1 + 0.1, y0 - 0.35, 0.62), MAT._get("water", lambda: M.flat("Water", "#0a1417", 0.04)), n=16)
    for z in (0.12, 0.6):
        P.lathe([(0.31 + 0.02 * (z < 0.3), z - 0.025), (0.325 + 0.02 * (z < 0.3), z - 0.025),
                 (0.325 + 0.02 * (z < 0.3), z + 0.025), (0.31 + 0.02 * (z < 0.3), z + 0.025)],
                (x1 + 0.1, y0 - 0.35, 0.0), MAT.iron(0.6), n=16, cap_top=False, cap_bottom=False)
    return P.objs


# =============================================================================== masonry storey (ashlar walls)
def masonry_storey(P, MAT, x0, x1, y0, y1, z0, z1, openings, wall_t=0.35, quoins=True, seed=0):
    """Ground floor of dressed stone (Ashlar material, box-projected blocks) with window/door kits and
    GN-instanced corner quoin stones."""
    blocks = MAT.blocks((0.55, 0.3))
    sides = {"front": ((x0, y0), (x1, y0)), "right": ((x1, y0), (x1, y1)), "back": ((x1, y1), (x0, y1)),
             "left": ((x0, y1), (x0, y0))}
    for side, (A, B) in sides.items():
        a, b, t, n, L = wall_frame(A, B)
        inset = wall_t if side in ("right", "left") else 0.0
        mid = (a + b) / 2 - n * (wall_t / 2)
        bm = bmesh.new()
        sk.bm_box(bm, L - 2 * inset - 0.002, wall_t, z1 - z0)
        R = Matrix((t, n, V((0, 0, 1)))).transposed().to_4x4()
        # NOTE: no random offset -> the box-projected blocks of neighbouring walls line up at the corners
        P.add_bm(bm, blocks, Matrix.Translation(V((mid.x, mid.y, (z0 + z1) / 2))) @ R, smooth=0, offset=False)
        for o in openings.get(side, []):
            cu = a + t * o["u"]
            if o["kind"] == "window":
                c = V((cu.x, cu.y, (o["z0"] + o["z1"]) / 2))
                window(P, MAT, c, t, n, o["w"], o["z1"] - o["z0"], shutters=o.get("shutters", "open"),
                       box=o.get("box", False))
                # stone lintel + sill
                P.box((o["w"] + 0.5, 0.12, 0.2), c + n * 0.03 + V((0, 0, (o["z1"] - o["z0"]) / 2 + 0.2)),
                      MAT.stone("warm", 0.2), rot=(0, 0, math.atan2(t.y, t.x)), bevel=0.02)
            elif o["kind"] == "door":
                door(P, MAT, V((cu.x, cu.y, o["z0"])), t, n, o["w"], o["z1"] - o["z0"])
    if quoins:
        rnd = random.Random(seed)
        stone = MAT.stone("warm", 0.3)
        pts, rots, scls = [], [], []
        for (cx, cy, sx, sy) in ((x0, y0, 1, 1), (x1, y0, -1, 1), (x1, y1, -1, -1), (x0, y1, 1, -1)):
            z = z0
            k = 0
            while z < z1 - 0.1:
                h = min(rnd.uniform(0.28, 0.36), z1 - z)
                long_x = (k % 2 == 0)
                lx, ly = (0.55, 0.3) if long_x else (0.3, 0.55)
                pts.append((cx + sx * (lx / 2 - 0.04), cy + sy * (ly / 2 - 0.04), z + h / 2))
                rots.append((0, 0, rnd.uniform(-0.02, 0.02)))
                scls.append((lx, ly, h - 0.02))
                z += h
                k += 1
        variants = sk.stone_variants(5, seed + 3, stone, rough=0.08)
        ob, col = sk.gn_instances("Quoins", pts, variants, rots, scls, seed=seed)
        ob.data.materials.append(stone)
        gn.apply(ob)
        gn.remove(col)
        sk._smooth(ob.data, 180)
        P.add_obj(ob)


def joist_ends(P, MAT, a, b, z, n, step=0.45, size=0.16, out=0.3):
    a, b, n = V(a), V(b), V(n)
    L = (b - a).length
    t = (b - a).normalized()
    k = int(L / step)
    for i in range(k + 1):
        p = a + t * (L * i / k) + V((0, 0, z))
        P.beam(p - n * 0.2, p + n * out, size, size * 1.1, MAT.wood("Z", "dark"), bevel=0.0, up=V((0, 0, 1)))


def balcony(P, MAT, x0, x1, y_wall, depth, z, rail_h=1.0):
    """Wooden balcony along X in front of y_wall (towards -Y): joists, plank floor, turned balusters, rail."""
    dark = MAT.wood("Z", "dark")
    yf = y_wall - depth
    # joists + floor planks
    nj = int((x1 - x0) / 0.6) + 1
    for i in range(nj):
        x = x0 + (x1 - x0) * i / (nj - 1)
        P.beam((x, y_wall + 0.2, z - 0.1), (x, yf - 0.05, z - 0.1), 0.12, 0.16, dark, bevel=0.015, up=(0, 0, 1))
    P.planks((x0 - 0.05, yf, z - 0.02), (1, 0, 0), (0, 1, 0), x1 - x0 + 0.1, depth, 5, MAT.wood("Z", "old"),
             thick=0.04, gap=0.012)
    P.beam((x0 - 0.05, yf, z - 0.1), (x1 + 0.05, yf, z - 0.1), 0.16, 0.1, dark, bevel=0.015, up=(0, -1, 0))
    # knee braces down to the wall below
    for x in (x0 + 0.1, (x0 + x1) / 2, x1 - 0.1):
        P.beam((x, y_wall - 0.05, z - 1.0), (x, yf + 0.25, z - 0.14), 0.1, 0.1, dark, bevel=0.014)
    # posts, rail, balusters
    for x in (x0, x1):
        P.beam((x, yf + 0.05, z), (x, yf + 0.05, z + rail_h + 0.1), 0.12, 0.12, dark, bevel=0.016)
        P.beam((x, yf + 0.05, z + rail_h * 0.5), (x, y_wall - 0.02, z + rail_h * 0.5), 0.07, 0.07, dark, bevel=0.01)
        P.beam((x, yf + 0.05, z + rail_h), (x, y_wall - 0.02, z + rail_h), 0.09, 0.07, dark, bevel=0.012, up=(0, 0, 1))
    P.beam((x0, yf + 0.05, z + rail_h), (x1, yf + 0.05, z + rail_h), 0.1, 0.07, dark, bevel=0.012, up=(0, 0, 1))
    P.beam((x0, yf + 0.05, z + 0.12), (x1, yf + 0.05, z + 0.12), 0.08, 0.06, dark, bevel=0.01, up=(0, 0, 1))
    nb = int((x1 - x0) / 0.2)
    prof = [(0.03, 0.0), (0.03, 0.06), (0.018, 0.12), (0.035, 0.32), (0.018, 0.55), (0.028, 0.66), (0.028, 0.72)]
    for i in range(1, nb):
        x = x0 + (x1 - x0) * i / nb
        P.lathe(prof, (x, yf + 0.05, z + 0.15), MAT.wood("Z", "old"), n=6, smooth=45)
    # rug hanging over the rail (cloth -> wind)
    rug = MAT.cloth("ClothRug", "#5a2230", kind="wool", stripes=("#b8904a", 0.09, "Z"))
    return rug


# =============================================================================== HOUSE B
def build_house_b(args):
    """≈7×5 m two-storey house: stone ground floor with quoins, jettied timber upper floor with a balcony on the
    front (-Y), slate roof with the ridge along X, chimney."""
    MAT = sk.Mats()
    P = sk.Parts(seed=202)
    x0, x1, y0, y1 = -3.4, 3.4, -2.4, 2.4
    zp, z1, z2 = 0.5, 2.9, 5.3
    ridge = 7.35
    plinth(P, MAT, x0 - 0.02, x1 + 0.02, y0 - 0.02, y1 + 0.02, zp, seed=7)
    W, D = x1 - x0, y1 - y0
    g_ops = {
        "front": [dict(u=W / 2 - 1.2, w=1.05, z0=zp, z1=zp + 2.0, kind="door"),
                  dict(u=1.0, w=0.7, z0=1.2, z1=2.1, kind="window", shutters="closed"),
                  dict(u=W / 2 + 1.0, w=0.8, z0=1.2, z1=2.1, kind="window", shutters=None),
                  dict(u=W - 0.8, w=0.6, z0=1.2, z1=2.1, kind="window", shutters=None)],
        "right": [dict(u=D / 2, w=0.7, z0=1.2, z1=2.1, kind="window", shutters="open")],
        "back": [dict(u=W / 2, w=0.7, z0=1.2, z1=2.1, kind="window", shutters="open")],
        "left": [dict(u=D / 2 - 0.6, w=0.6, z0=1.3, z1=2.0, kind="window", shutters=None)],
    }
    masonry_storey(P, MAT, x0, x1, y0, y1, zp, z1, g_ops, seed=4)
    # jettied upper floor: 0.35 out at the front and the back
    jx0, jx1, jy0, jy1 = x0 - 0.1, x1 + 0.1, y0 - 0.35, y1 + 0.35
    joist_ends(P, MAT, (x0 + 0.2, y0, 0), (x1 - 0.2, y0, 0), z1 + 0.08, (0, -1, 0), out=0.38)
    joist_ends(P, MAT, (x1 - 0.2, y1, 0), (x0 + 0.2, y1, 0), z1 + 0.08, (0, 1, 0), out=0.38)
    u_ops = {
        "front": [dict(u=(jx1 - jx0) / 2, w=1.0, z0=z1 + 0.2, z1=z1 + 2.15, kind="door"),
                  dict(u=1.2, w=0.75, z0=z1 + 0.75, z1=z1 + 1.6, kind="window", shutters="open"),
                  dict(u=(jx1 - jx0) - 1.2, w=0.75, z0=z1 + 0.75, z1=z1 + 1.6, kind="window", shutters="open",
                       box=True)],
        "right": [dict(u=(jy1 - jy0) / 2, w=0.7, z0=z1 + 0.75, z1=z1 + 1.6, kind="window", shutters="open")],
        "back": [dict(u=1.5, w=0.7, z0=z1 + 0.75, z1=z1 + 1.6, kind="window", shutters="closed"),
                 dict(u=(jx1 - jx0) - 1.5, w=0.7, z0=z1 + 0.75, z1=z1 + 1.6, kind="window", shutters="open")],
        "left": [dict(u=(jy1 - jy0) / 2, w=0.7, z0=z1 + 0.75, z1=z1 + 1.6, kind="window", shutters="open")],
    }
    storey(P, MAT, jx0, jx1, jy0, jy1, z1 + 0.18, z2, u_ops, seed=8)
    # floor slab between the storeys (hidden joists carry it)
    P.box((W + 0.1, jy1 - jy0 - 0.1, 0.18), (0, 0, z1 + 0.09), MAT.wood("Z", "dark"), bevel=0.02, smooth=0)
    # balcony in front of the upper door
    rug = balcony(P, MAT, -1.3, 1.3, jy0, 0.75, z1 + 0.2)
    SP.cloth_sheet(P, rug, 0.9, 0.8, (-0.6, jy0 - 0.82, z1 + 1.24), seg=(8, 8), folds=0.02, tails=False, seed=3)
    # gables at the X ends + slate roof (ridge along X)
    for sx in (-1, 1):
        gable_x(P, MAT, sx * jx1 if sx > 0 else jx0, 0.0, (jy1 - jy0) / 2, z2, ridge - 0.12, sx)
    roof = SP.gable_roof(P, MAT, 0.0, 0.0, jy1 - jy0, jx1 - jx0, z2, ridge, overhang=0.35, ridge_axis="X",
                         kind="slate", exposure=0.24, sh_w=0.3, thick=0.03, deck=0.06, seed=12)
    rows = [o for o in roof if o.name.startswith("RoofRows")]
    moss_on(P, MAT, rows[1], density=0.4, seed=6)
    chimney(P, MAT, -2.2, 0.9, 4.8, 8.1, w=0.8, d=0.65)
    # steps + barrels + lantern
    for k, (dy, h) in enumerate(((-0.6, 0.25), (-0.32, 0.5))):
        P.stone((1.3, 0.32, 0.26), (x0 + W / 2 - 1.2, y0 + dy, h - 0.12), MAT.stone("warm", 0.3), seed=70 + k)
    iron = MAT.blackiron()
    lx = x0 + W / 2 - 0.4
    P.tube([(lx, y0 + 0.05, 2.45), (lx, y0 - 0.25, 2.47), (lx, y0 - 0.33, 2.44)], 0.014, iron, kind="POLY")
    SP.lantern(P, MAT, (lx, y0 - 0.33, 2.44), scale=0.8)
    for k, (x, y) in enumerate(((x1 - 0.45, y0 - 0.5), (x1 - 1.1, y0 - 0.45))):
        P.lathe([(0.26, 0.0), (0.3, 0.3), (0.26, 0.62), (0.24, 0.62), (0.24, 0.58)], (x, y, 0.0), MAT.wood("Z", "red"),
                n=14, cap_top=False)
        P.cyl(0.245, 0.02, (x, y, 0.56), MAT.wood("Y", "red"), n=14)
        for z in (0.1, 0.5):
            P.lathe([(0.28, z - 0.02), (0.295, z - 0.02), (0.295, z + 0.02), (0.28, z + 0.02)], (x, y, 0.0),
                    MAT.iron(0.6), n=14, cap_top=False, cap_bottom=False)
    return P.objs


def gable_x(P, MAT, x_face, cy, y_half, z0, z1, n_sign, plaster=None):
    """Triangular timber-framed gable in the YZ plane at x = x_face, facing n_sign*X."""
    plaster = plaster or MAT.plaster()
    wood = MAT.wood("Z", "dark")
    n = V((n_sign, 0, 0))
    t = V((-n.y, n.x, 0))
    tri = [(-y_half, 0.0), (y_half, 0.0), (0.0, z1 - z0)]
    # local X -> world -Y*n_sign, local Y -> world Z, local Z -> world -X*n_sign (inward); det = +1
    rot = Matrix(((0, 0, -n_sign), (-n_sign, 0, 0), (0, 1, 0))).to_euler()
    P.poly_prism(tri, 0.0, 0.2, plaster, loc=(x_face, cy, z0), rot=rot, smooth=0)
    off = n * (0.035 - 0.09)
    base = V((x_face, cy, 0))
    P.beam(base + off + V((0, 0, z0 + 0.1)), base + off + V((0, 0, z1 - 0.2)), 0.18, 0.17, wood, bevel=0.02, up=n, outer=True)
    zc = z0 + (z1 - z0) * 0.42
    yc = y_half * 0.58 - 0.1
    P.beam(base + off + V((0, -yc, zc)), base + off + V((0, yc, zc)), 0.18, 0.17, wood, bevel=0.02, up=n, outer=True)
    for s in (-1, 1):
        P.beam(base + off + V((0, s * 0.12, z0 + 0.12)), base + off + V((0, s * (yc - 0.1), zc - 0.1)), 0.15, 0.16,
               wood, bevel=0.018, up=n, outer=True)
        P.beam(base + off + V((0, s * 0.1, zc + 0.1)), base + off + V((0, s * yc * 0.5, z0 + (z1 - z0) * 0.75 - 0.1)),
               0.15, 0.16, wood, bevel=0.018, up=n, outer=True)
    c = V((x_face, cy + y_half * 0.3, zc + 0.5))
    window(P, MAT, c, t, n, 0.45, 0.55, shutters=None)


# =============================================================================== TAVERN
def hanging_sign(P, MAT, wall_pt, n, z, length=1.1):
    """Iron bracket sticking out of the wall + wooden sign board on chains (painted tankard emblem)."""
    wall_pt, n = V(wall_pt), V(n)
    t = V((-n.y, n.x, 0))
    iron = MAT.blackiron()
    tip = wall_pt + n * length
    P.tube([tuple(wall_pt + V((0, 0, z))), tuple(tip + V((0, 0, z)))], 0.022, iron, kind="POLY")
    P.tube([tuple(wall_pt + V((0, 0, z - 0.5))), tuple(wall_pt + n * 0.35 + V((0, 0, z - 0.2))),
            tuple(wall_pt + n * 0.7 + V((0, 0, z - 0.05))), tuple(tip + V((0, 0, z - 0.01)))], 0.014, iron)
    P.tube([tuple(wall_pt + n * 0.25 + V((0, 0, z - 0.3))), tuple(wall_pt + n * 0.2 + V((0, 0, z - 0.1))),
            tuple(wall_pt + n * 0.32 + V((0, 0, z - 0.03))), tuple(wall_pt + n * 0.38 + V((0, 0, z - 0.12)))],
           0.009, iron)
    P.box((0.2, 0.05, 0.3), wall_pt + n * 0.02 + V((0, 0, z - 0.1)), iron, rot=(0, 0, math.atan2(t.y, t.x)),
          bevel=0.01)
    board_c = wall_pt + n * (length * 0.55) + V((0, 0, z - 0.6))
    for s in (-1, 1):
        p = wall_pt + n * (length * 0.55 + s * 0.3) + V((0, 0, z))
        P.tube([tuple(p), tuple(p - V((0, 0, 0.2)))], 0.008, iron, res=5, kind="POLY")
        P.torus(0.03, 0.007, p - V((0, 0, 0.23)), iron, rot=(math.pi / 2, 0, math.atan2(t.y, t.x)), seg=8, rseg=4)
    sign = MAT._get("signboard", lambda: sk.add_emblem(M.wood("SignBoard", color="#4e3421", color2="#2a1a0f",
                                                                axis="X", weathered=0.4),
                                                         {"color": "#b8913e", "center": (0.0, 0.0), "size": 0.19}))
    # board lies in the (n, z) plane: local X = n, local Z = up -> emblem centred on the board
    R = Matrix((n, -t, V((0, 0, 1)))).transposed().to_4x4()
    bm = bmesh.new()
    sk.bm_box(bm, 0.95, 0.05, 0.62, bevel=0.015)
    P.add_bm(bm, sign, Matrix.Translation(board_c) @ R, offset=False)
    for dz in (0.33, -0.33):
        bm = bmesh.new()
        sk.bm_box(bm, 1.01, 0.065, 0.05, bevel=0.01)
        P.add_bm(bm, MAT.wood("Z", "dark"), Matrix.Translation(board_c + V((0, 0, dz))) @ R)


def dormer(P, MAT, x, y_face, z_base, w=1.1, h=1.1, depth=1.6, roof_kind="slate"):
    """Small gabled dormer facing -Y whose front face is at y_face (walls + window + mini gable roof)."""
    plaster = MAT.plaster()
    P.box((w, depth, h), (x, y_face + depth / 2, z_base + h / 2), plaster, bevel=0.0, smooth=0)
    t, n = V((1, 0, 0)), V((0, -1, 0))
    window(P, MAT, V((x, y_face, z_base + h * 0.5)), t, n, w * 0.5, h * 0.55, shutters=None)
    wood = MAT.wood("Z", "dark")
    for s in (-1, 1):
        P.beam((x + s * (w / 2 - 0.06), y_face - 0.02, z_base), (x + s * (w / 2 - 0.06), y_face - 0.02, z_base + h),
               0.12, 0.12, wood, bevel=0.015, up=(0, -1, 0))
    tri = [(-w / 2, 0.0), (w / 2, 0.0), (0.0, 0.5)]
    rot = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0))).to_euler()
    P.poly_prism(tri, 0.0, depth, plaster, loc=(x, y_face + depth, z_base + h), rot=rot, smooth=0)
    SP.gable_roof(P, MAT, x, y_face + depth / 2 - 0.1, w, depth + 0.1, z_base + h, z_base + h + 0.5, overhang=0.15,
                  ridge_axis="Y", kind=roof_kind, exposure=0.16, sh_w=0.22, thick=0.025, deck=0.04,
                  seed=int(abs(x) * 10) + 3)


def build_tavern(args):
    """≈10×8 m two-storey tavern: stone plinth, timber frame, big leaded windows, porch over a double door,
    two dormers, external stone chimney on the right gable, hanging sign."""
    MAT = sk.Mats()
    P = sk.Parts(seed=303)
    x0, x1, y0, y1 = -4.9, 4.9, -3.8, 3.8
    zp, z1, z2 = 0.3, 3.2, 5.8
    ridge = 8.0
    W, D = x1 - x0, y1 - y0
    # ground floor of dressed stone with quoins (the tavern is the only stone-built inn of the village)
    g_ops = {
        "front": [dict(u=W / 2, w=1.6, z0=zp, z1=zp + 2.2, kind="door"),
                  dict(u=1.4, w=1.2, z0=1.0, z1=2.2, kind="window", shutters="open"),
                  dict(u=3.1, w=0.8, z0=1.1, z1=2.1, kind="window", shutters=None),
                  dict(u=W - 3.1, w=0.8, z0=1.1, z1=2.1, kind="window", shutters=None),
                  dict(u=W - 1.4, w=1.2, z0=1.0, z1=2.2, kind="window", shutters="open", box=True)],
        "right": [dict(u=1.3, w=0.9, z0=1.1, z1=2.1, kind="window", shutters=None),
                  dict(u=D - 1.3, w=0.9, z0=1.1, z1=2.1, kind="window", shutters="closed")],
        "back": [dict(u=2.0, w=1.0, z0=zp, z1=zp + 2.0, kind="door"),
                 dict(u=W / 2, w=0.9, z0=1.1, z1=2.1, kind="window", shutters=None),
                 dict(u=W - 2.0, w=0.9, z0=1.1, z1=2.1, kind="window", shutters="open")],
        "left": [dict(u=D / 2, w=1.1, z0=1.05, z1=2.15, kind="window", shutters=None)],
    }
    masonry_storey(P, MAT, x0, x1, y0, y1, 0.0, z1, g_ops, seed=13)
    # jetty front/back 0.3
    jy0, jy1 = y0 - 0.3, y1 + 0.3
    joist_ends(P, MAT, (x0 + 0.25, y0, 0), (x1 - 0.25, y0, 0), z1 + 0.08, (0, -1, 0), step=0.5, out=0.34)
    joist_ends(P, MAT, (x1 - 0.25, y1, 0), (x0 + 0.25, y1, 0), z1 + 0.08, (0, 1, 0), step=0.5, out=0.34)
    P.box((W - 0.1, jy1 - jy0 - 0.1, 0.18), (0, 0, z1 + 0.09), MAT.wood("Z", "dark"), bevel=0.02, smooth=0)
    u_ops = {
        "front": [dict(u=1.3, w=0.8, z0=z1 + 0.8, z1=z1 + 1.7, kind="window", shutters="open"),
                  dict(u=3.3, w=0.8, z0=z1 + 0.8, z1=z1 + 1.7, kind="window", shutters="closed", box=True),
                  dict(u=W - 3.3, w=0.8, z0=z1 + 0.8, z1=z1 + 1.7, kind="window", shutters="open"),
                  dict(u=W - 1.3, w=0.8, z0=z1 + 0.8, z1=z1 + 1.7, kind="window", shutters="open")],
        "right": [dict(u=(jy1 - jy0) / 2 + 1.5, w=0.7, z0=z1 + 0.8, z1=z1 + 1.7, kind="window", shutters="open")],
        "back": [dict(u=2.2, w=0.8, z0=z1 + 0.8, z1=z1 + 1.7, kind="window", shutters="open"),
                 dict(u=W - 2.2, w=0.8, z0=z1 + 0.8, z1=z1 + 1.7, kind="window", shutters="open")],
        "left": [dict(u=(jy1 - jy0) / 2, w=0.8, z0=z1 + 0.8, z1=z1 + 1.7, kind="window", shutters="open")],
    }
    storey(P, MAT, x0, x1, jy0, jy1, z1 + 0.18, z2, u_ops, seed=17, stud_step=1.6)
    for sx in (-1, 1):
        gable_x(P, MAT, x1 if sx > 0 else x0, 0.0, (jy1 - jy0) / 2, z2, ridge - 0.12, sx)
    roof = SP.gable_roof(P, MAT, 0.0, 0.0, jy1 - jy0, W, z2, ridge, overhang=0.4, ridge_axis="X", kind="slate",
                         exposure=0.31, sh_w=0.52, thick=0.035, deck=0.07, seed=21)
    rows = [o for o in roof if o.name.startswith("RoofRows")]
    # two dormers on the front slope
    pitch = math.atan2(ridge - z2, (jy1 - jy0) / 2)
    for x in (-2.4, 2.4):
        yf = jy0 + 1.25
        zb = z2 + (yf - jy0) * math.tan(pitch) - 0.25
        dormer(P, MAT, x, yf, zb, w=1.1, h=1.0, depth=1.5)
    # external stone chimney on the right gable
    stone = MAT.stone("grey", 0.35)
    cx = x1 + 0.45
    segs = [((cx - 0.45, -0.75), (cx + 0.45, -0.75)), ((cx + 0.45, -0.75), (cx + 0.45, 0.75)),
            ((cx + 0.45, 0.75), (cx - 0.45, 0.75))]
    sk.stone_wall(P, segs, 0.0, 2.2, stone, seed=31, course=(0.3, 0.4), length=(0.45, 0.75), depth=0.26,
                  protrude=0.03)
    P.box((0.86, 1.46, 2.2), (cx, 0, 1.1), MAT.mortar(), bevel=0.0, smooth=0)
    P.box((1.0, 1.6, 0.14), (cx - 0.02, 0, 2.27), MAT.blocks((0.4, 0.2)), bevel=0.03)
    chimney(P, MAT, cx - 0.05, 0.0, 2.3, 9.0, w=0.75, d=1.0)
    # porch over the double door: two posts + pent roof
    wood = MAT.wood("Z", "dark")
    for s in (-1, 1):
        P.beam((s * 1.25, y0 - 1.45, 0.0), (s * 1.25, y0 - 1.45, 3.05), 0.16, 0.16, wood, bevel=0.02)
        P.box((0.3, 0.3, 0.2), (s * 1.25, y0 - 1.45, 0.1), MAT.blocks((0.3, 0.2)), bevel=0.02)
        P.beam((s * 1.25, y0 - 1.45, 2.6), (s * 1.25, y0 + 0.05, 3.3), 0.12, 0.12, wood, bevel=0.015)
        P.beam((s * 1.25, y0 - 1.45, 2.4), (s * 1.0, y0 - 1.45, 2.95), 0.1, 0.1, wood, bevel=0.012)
    P.beam((-1.45, y0 - 1.45, 3.05), (1.45, y0 - 1.45, 3.05), 0.16, 0.14, wood, bevel=0.02, up=(0, 0, 1))
    pe = V((0, y0 - 1.7, 3.05))
    pr = V((0, y0 + 0.02, 3.6))
    sd = (pr - pe).normalized()
    pn = V((1, 0, 0)).cross(sd).normalized()
    if pn.z < 0:
        pn = -pn
    P.beam(pe - pn * 0.03, pr - pn * 0.03, 3.1, 0.05, wood, bevel=0.01, up=pn)
    sk.roof_rows(P, MAT.shingles("slate"), pe, pr, (1, 0, 0), 3.1, exposure=0.22, sh_w=0.32, thick=0.03, seed=27,
                 name="PorchRows")
    # steps + benches + barrels + lanterns
    P.stone((2.3, 0.5, 0.3), (0.0, y0 - 0.3, 0.13), MAT.stone("warm", 0.3), seed=80)
    for s in (-1, 1):
        bx = s * 2.3
        P.planks((bx - 0.7, y0 - 0.75, 0.45), (1, 0, 0), (0, 1, 0), 1.4, 0.35, 2, MAT.wood("Z", "old"), thick=0.05)
        for dx in (-0.55, 0.55):
            P.beam((bx + dx, y0 - 0.58, 0.0), (bx + dx, y0 - 0.58, 0.45), 0.08, 0.3, wood, bevel=0.012,
                   up=(0, 1, 0))
    for k, (x, y) in enumerate(((x0 + 0.6, y0 - 0.6), (x0 + 1.25, y0 - 0.55), (x0 + 0.9, y0 - 1.15))):
        P.lathe([(0.27, 0.0), (0.31, 0.32), (0.27, 0.64), (0.25, 0.64), (0.25, 0.6)], (x, y, 0.0), MAT.wood("Z", "red"),
                n=14, cap_top=False)
        P.cyl(0.255, 0.02, (x, y, 0.58), MAT.wood("Y", "red"), n=14)
        for z in (0.1, 0.52):
            P.lathe([(0.29, z - 0.02), (0.305, z - 0.02), (0.305, z + 0.02), (0.29, z + 0.02)], (x, y, 0.0),
                    MAT.iron(0.6), n=14, cap_top=False, cap_bottom=False)
    iron = MAT.blackiron()
    for s in (-1, 1):
        P.tube([(s * 1.25, y0 - 1.37, 2.55), (s * 1.25, y0 - 1.1, 2.57)], 0.012, iron, kind="POLY")
        SP.lantern(P, MAT, (s * 1.25, y0 - 1.1, 2.57), scale=0.75)
    hanging_sign(P, MAT, (x1 - 2.25, y0, 0), (0, -1, 0), 3.3, length=1.15)
    return P.objs


# =============================================================================== FORGE
def build_forge(args):
    """Open smithy ≈5×4 m: flagstone floor, stone back wall with a glowing hearth + hood + chimney, lean-to
    shingle roof on four posts, anvil on a stump, bellows, quench trough, tool rack, grindstone."""
    MAT = sk.Mats()
    P = sk.Parts(seed=404)
    x0, x1, y0, y1 = -2.5, 2.5, -2.0, 2.0
    stone = MAT.stone("dark", 0.35)
    wood = MAT.wood("Z", "dark")
    iron = MAT.blackiron()
    # flagstone floor (GN-instanced flat stones)
    rnd = random.Random(5)
    pts, rots, scls = [], [], []
    y = y0 + 0.05
    while y < y1 - 0.3:
        h = rnd.uniform(0.45, 0.7)
        x = x0 + 0.05
        while x < x1 - 0.1:
            w = min(rnd.uniform(0.5, 0.9), x1 - x)
            pts.append((x + w / 2, y + h / 2, 0.06))
            rots.append((rnd.uniform(-0.02, 0.02), rnd.uniform(-0.02, 0.02), rnd.uniform(-0.04, 0.04)))
            scls.append((w - 0.03, h - 0.03, 0.12))
            x += w
        y += h
    flag = sk.stone_variants(5, 9, MAT.stone("grey", 0.2), rough=0.05)
    ob, col = sk.gn_instances("Flagstones", pts, flag, rots, scls, seed=3)
    ob.data.materials.append(MAT.stone("grey", 0.2))
    gn.apply(ob)
    gn.remove(col)
    sk._smooth(ob.data, 180)
    P.add_obj(ob)
    P.box((x1 - x0 - 0.1, y1 - y0 - 0.1, 0.08), (0, 0, 0.04), MAT.mortar(), bevel=0.0, smooth=0)
    # back wall: rubble stone base (both faces) + timber frame clad with vertical boards up to the roof
    zw = 1.2
    sk.stone_wall(P, [((x0, y1 - 0.35), (x1, y1 - 0.35))], 0.0, zw, stone, seed=4, course=(0.26, 0.34),
                  length=(0.4, 0.7), depth=0.3, protrude=0.02)
    sk.stone_wall(P, [((x1, y1), (x0, y1))], 0.0, zw, stone, seed=5, course=(0.26, 0.34), length=(0.4, 0.7),
                  depth=0.3, protrude=0.02)
    P.box((x1 - x0, 0.2, zw), (0, y1 - 0.175, zw / 2), MAT.mortar(), bevel=0.0, smooth=0)
    P.beam((x0, y1 - 0.18, zw + 0.1), (x1, y1 - 0.18, zw + 0.1), 0.2, 0.3, wood, bevel=0.02, up=(0, 1, 0))
    for x in (x0 + 0.1, -0.6, x1 - 0.1):
        P.beam((x, y1 - 0.18, zw + 0.2), (x, y1 - 0.18, 3.5), 0.18, 0.2, wood, bevel=0.02, up=(0, 1, 0))
    P.beam((x0 - 0.05, y1 - 0.18, 3.5), (x1 + 0.05, y1 - 0.18, 3.5), 0.2, 0.24, wood, bevel=0.02, up=(0, 1, 0))
    P.planks((x0, y1 - 0.05, zw + 0.2), (1, 0, 0), (0, 0, 1), x1 - x0, 3.4 - zw - 0.2, 14, MAT.wood("Z", "old"),
             thick=0.04, gap=0.01, along="v", ragged=0.02)
    P.planks((x1, y1 - 0.31, zw + 0.2), (-1, 0, 0), (0, 0, 1), x1 - x0, 3.4 - zw - 0.2, 14, MAT.wood("Z", "old"),
             thick=0.04, gap=0.01, along="v", ragged=0.02)
    sk.stone_wall(P, [((x0 + 0.35, y0 + 0.4), (x0 + 0.35, y1 - 0.4)), ((x0, y1 - 0.4), (x0, y0 + 0.4))], 0.0, 1.1,
                  stone, seed=6, course=(0.24, 0.32), length=(0.35, 0.6), depth=0.3, protrude=0.02)
    P.box((0.14, y1 - y0 - 0.85, 1.1), (x0 + 0.175, 0.0, 0.55), MAT.mortar(), bevel=0.0, smooth=0)
    P.box((0.5, y1 - y0 - 0.7, 0.1), (x0 + 0.175, 0.0, 1.14), MAT.blocks((0.5, 0.25)), bevel=0.02)
    # hearth block against the back wall (right half) with a glowing coal bed + fire mouth
    hx, hy = 1.1, y1 - 1.0
    blocks = MAT.blocks((0.36, 0.2))
    P.box((1.7, 1.1, 0.85), (hx, hy, 0.425), blocks, bevel=0.03)
    P.box((1.5, 0.9, 0.08), (hx, hy, 0.88), MAT.flat("Soot", "#0b0908", 0.95), bevel=0.01)
    P.ico(0.55, (hx, hy, 0.86), MAT.ember(), subdiv=2, scale=(1.25, 0.7, 0.22), jitter=0.02)
    P.box((0.6, 0.02, 0.36), (hx, hy - 0.555, 0.38), MAT.ember(), bevel=0.0)          # glowing ash pit mouth
    P.box((0.8, 0.12, 0.1), (hx, hy - 0.6, 0.6), blocks, bevel=0.02)
    # hood (tapered, plastered stone) + chimney through the roof
    P.cyl(1.0, 1.2, (hx, hy + 0.1, 1.9), MAT.blocks((0.3, 0.2)), n=4, r2=0.45, rot=(0, 0, math.pi / 4), smooth=0)
    P.box((0.7, 0.7, 2.1), (hx, hy + 0.1, 4.05), MAT.blocks((0.3, 0.2)), bevel=0.02, smooth=0)
    P.box((0.86, 0.86, 0.12), (hx, hy + 0.1, 5.1), MAT.blocks((0.3, 0.2)), bevel=0.02, smooth=0)
    P.cyl(0.25, 0.02, (hx, hy + 0.1, 5.16), MAT.flat("Soot", "#0b0908", 0.95), n=10)
    P.beam((hx - 0.95, hy - 0.62, 1.93), (hx + 0.95, hy - 0.62, 1.93), 0.14, 0.14, iron, bevel=0.01, up=(0, -1, 0))
    # lean-to roof on 4 posts: high at the back (3.5), low at the front (2.6)
    zf, zb = 2.6, 3.5
    for x in (x0 + 0.15, x1 - 0.15):
        P.beam((x, y0 + 0.15, 0.0), (x, y0 + 0.15, zf), 0.2, 0.2, wood, bevel=0.025)
        P.box((0.34, 0.34, 0.14), (x, y0 + 0.15, 0.07), MAT.blocks((0.3, 0.2)), bevel=0.02)
        P.beam((x, y0 + 0.15, zf - 0.6), (x + (0.5 if x < 0 else -0.5), y0 + 0.15, zf - 0.08), 0.12, 0.14, wood,
               bevel=0.015)
        P.beam((x, y0 + 0.05, zf + 0.05), (x, y1 + 0.1, zb + 0.05), 0.12, 0.16, wood, bevel=0.015)
    P.beam((x0 - 0.1, y0 + 0.15, zf - 0.02), (x1 + 0.1, y0 + 0.15, zf - 0.02), 0.2, 0.2, wood, bevel=0.025,
           up=(0, 0, 1))
    pe = V((0, y0 - 0.35, zf - 0.02))
    pr = V((0, y1 + 0.25, zb + 0.2))
    sd = (pr - pe).normalized()
    pn = V((1, 0, 0)).cross(sd).normalized()
    if pn.z < 0:
        pn = -pn
    P.beam(pe - pn * 0.04 + pn * 0.12, pr - pn * 0.04 + pn * 0.12, x1 - x0 + 0.6, 0.06, wood, bevel=0.01, up=pn)
    rr = sk.roof_rows(P, MAT.shingles("wood"), pe + pn * 0.12, pr + pn * 0.12, (1, 0, 0), x1 - x0 + 0.6,
                      exposure=0.25, sh_w=0.34, thick=0.035, seed=33, name="ForgeRows")
    moss_on(P, MAT, rr, density=0.4, seed=2)
    # anvil on a stump
    P.lathe([(0.32, 0.0), (0.3, 0.1), (0.27, 0.55), (0.28, 0.6)], (-0.3, -0.35, 0.0),
            MAT._get("logbark", lambda: M.bark("LogBark", kind="oak", moss=0.1)), n=12, cap_top=False)
    P.cyl(0.28, 0.02, (-0.3, -0.35, 0.59), MAT.wood("Z", "fresh"), n=12)
    ax, ay, az = -0.3, -0.35, 0.6
    P.box((0.3, 0.22, 0.1), (ax, ay, az + 0.05), iron, bevel=0.015)
    P.box((0.18, 0.14, 0.18), (ax, ay, az + 0.18), iron, bevel=0.012)
    P.box((0.46, 0.2, 0.1), (ax + 0.02, ay, az + 0.32), MAT._get("anvil", lambda: M.metal("AnvilSteel", kind="steel", rust=0.2, wear=0.9)),
          bevel=0.012)
    horn = P.cyl(0.07, 0.3, (ax + 0.25, ay, az + 0.32), iron, rot=(0, math.pi / 2, 0), n=8, r2=0.012)
    P.box((0.1, 0.18, 0.08), (ax - 0.26, ay, az + 0.32), iron, bevel=0.01)
    hammer_(P, MAT, (ax - 0.05, ay - 0.05, az + 0.37))
    # glowing bar on the anvil
    P.box((0.3, 0.03, 0.03), (ax + 0.05, ay + 0.03, az + 0.385), MAT.ember(), rot=(0, 0, 0.3), bevel=0.005)
    # quench trough
    tx, ty = -1.2, -0.2
    P.planks((tx - 0.3, ty - 0.55, 0.0), (1, 0, 0), (0, 0, 1), 0.6, 0.55, 3, MAT.wood("Z", "old"), thick=0.05)
    P.planks((tx + 0.3, ty + 0.55, 0.0), (-1, 0, 0), (0, 0, 1), 0.6, 0.55, 3, MAT.wood("Z", "old"), thick=0.05)
    for s in (-1, 1):
        P.box((0.06, 1.2, 0.55), (tx + s * 0.33, ty, 0.275), MAT.wood("Y", "old"), bevel=0.01)
    P.box((0.6, 1.1, 0.02), (tx, ty, 0.46), MAT._get("water", lambda: M.flat("Water", "#0a1417", 0.04)), bevel=0.0)
    # bellows beside the hearth (leather bag between two boards) + lever
    bx, by = hx - 1.25, hy + 0.1
    P.poly_prism([(-0.25, -0.35), (0.25, -0.35), (0.12, 0.35), (-0.12, 0.35)], 0.55, 0.6, MAT.wood("Z", "red"),
                 loc=(bx, by, 0.0), bevel=0.01)
    P.poly_prism([(-0.25, -0.35), (0.25, -0.35), (0.12, 0.35), (-0.12, 0.35)], 0.95, 1.0, MAT.wood("Z", "red"),
                 loc=(bx, by, 0.0), bevel=0.01)
    P.lathe([(0.0, 0.6), (0.26, 0.62), (0.3, 0.7), (0.3, 0.85), (0.26, 0.93), (0.0, 0.95)], (bx, by - 0.03, 0.0),
            MAT.leather("#3b2616"), n=12)
    P.cyl(0.05, 0.5, (bx + 0.12, by + 0.35, 0.78), iron, rot=(0, math.pi / 2, 0), n=8, r2=0.03)
    for s in (-1, 1):
        P.beam((bx + s * 0.22, by, 0.0), (bx + s * 0.22, by, 0.58), 0.08, 0.08, wood, bevel=0.01)
    P.beam((bx, by - 0.4, 1.0), (bx, by - 0.9, 1.4), 0.06, 0.06, wood, bevel=0.01)
    # tool rack on the back wall: tongs + hammers + horseshoes
    for k in range(4):
        x = -1.6 + k * 0.35
        P.cyl(0.015, 0.1, (x, y1 - 0.44, 1.7), wood, rot=(math.pi / 2, 0, 0), n=6)
        P.beam((x, y1 - 0.5, 1.68), (x + 0.03, y1 - 0.5, 1.18), 0.018, 0.012, iron, bevel=0.003)
        P.beam((x + 0.03, y1 - 0.5, 1.68), (x + 0.06, y1 - 0.5, 1.2), 0.018, 0.012, iron, bevel=0.003)
    for k in range(3):
        P.torus(0.07, 0.012, (-1.55 + k * 0.4, y1 - 0.51, 2.1), iron, rot=(math.pi / 2, 0, 0), seg=10, rseg=4)
    # grindstone
    gx, gy = x1 - 0.55, y0 + 0.8
    P.cyl(0.35, 0.1, (gx - 0.05, gy, 0.75), MAT.stone("pale", 0.0), rot=(0, math.pi / 2, 0), n=16)
    P.cyl(0.03, 0.5, (gx - 0.25, gy, 0.75), iron, rot=(0, math.pi / 2, 0), n=8)
    for s in (-1, 1):
        P.beam((gx - 0.2 + s * 0.15, gy - 0.2, 0.0), (gx - 0.2 + s * 0.15, gy, 0.8), 0.07, 0.07, wood, bevel=0.01)
        P.beam((gx - 0.2 + s * 0.15, gy + 0.2, 0.0), (gx - 0.2 + s * 0.15, gy, 0.8), 0.07, 0.07, wood, bevel=0.01)
    # iron bars + coal pile + bucket
    for k in range(5):
        P.box((1.1, 0.04, 0.04), (-1.3, y1 - 0.75 + k * 0.05, 1.19 + 0.0), MAT.iron(0.7), bevel=0.004,
              rot=(0, 0, 0.02 * k))
    P.ico(0.4, (x0 + 0.75, y1 - 0.8, 0.0), MAT.flat("Coal", "#141312", 0.7), subdiv=2, scale=(1.0, 0.9, 0.5),
          jitter=0.05)
    SP.bucket(P, MAT, (-0.9, -0.9, 0.0), s=1.0)
    return P.objs


def hammer_(P, MAT, loc):
    SP.hammer(P, MAT, loc, yaw=2.6, s=0.9)


# =============================================================================== WINDMILL
def octagon_tower(P, MAT, z0, z1, r0, r1, n=8, boards=True, seed=0):
    """Tapered polygonal smock tower clad with overlapping horizontal weatherboards (one ring per board row)."""
    wood_old = MAT.wood("Z", "old")
    rows = int((z1 - z0) / 0.26)
    dz = (z1 - z0) / rows
    rnd = random.Random(seed)
    for k in range(rows):
        za, zb = z0 + k * dz, z0 + (k + 1) * dz + 0.03
        ra = r0 + (r1 - r0) * (za - z0) / (z1 - z0) + 0.025
        rb = r0 + (r1 - r0) * (zb - z0) / (z1 - z0)
        # one weatherboard ring: slightly flared bottom edge (lap siding)
        P.lathe([(ra - 0.03, za), (ra, za), (rb, zb), (rb - 0.03, zb)], (0, 0, 0), MAT.wood("X", "old"), n=n,
                rot=(0, 0, math.pi / n), cap_top=False, cap_bottom=False, smooth=20)
    # inner core so there is never a see-through gap
    P.lathe([(r0 - 0.03, z0), (r1 - 0.03, z1)], (0, 0, 0), MAT.flat("TowerInside", "#171210", 0.95), n=n,
            rot=(0, 0, math.pi / n), cap_top=True, cap_bottom=False, smooth=0)
    # corner posts
    for i in range(n):
        a = 2 * math.pi * i / n
        p0 = V((math.cos(a) * (r0 + 0.04), math.sin(a) * (r0 + 0.04), z0))
        p1 = V((math.cos(a) * (r1 + 0.04), math.sin(a) * (r1 + 0.04), z1))
        P.beam(p0, p1, 0.16, 0.12, MAT.wood("Z", "dark"), bevel=0.02, up=V((math.cos(a), math.sin(a), 0)))


def sail(P, MAT, hub, angle, length=4.4, inner=0.9, width=1.25):
    """One sail: stock (spar) + lattice frame + canvas panels, in the XZ plane at y = hub.y - 0.1."""
    hub = V(hub)
    d = V((math.cos(angle), 0, math.sin(angle)))
    s = V((-math.sin(angle), 0, math.cos(angle)))          # sideways (sail width direction)
    wood = MAT.wood("Z", "old")
    dark = MAT.wood("Z", "dark")
    y = V((0, -0.08, 0))
    P.beam(hub + y + d * 0.2, hub + y + d * length, 0.16, 0.12, dark, bevel=0.02, up=V((0, -1, 0)))
    # lattice: two long rails + cross bars
    for off in (0.3, width):
        P.beam(hub + y + d * inner + s * off - V((0, 0.03, 0)), hub + y + d * (length - 0.05) + s * off - V((0, 0.03, 0)),
               0.05, 0.05, wood, bevel=0.008, up=V((0, -1, 0)))
    nb = 11
    for i in range(nb):
        t = inner + (length - 0.1 - inner) * i / (nb - 1)
        P.beam(hub + y + d * t - V((0, 0.05, 0)), hub + y + d * t + s * (width + 0.05) - V((0, 0.05, 0)), 0.04, 0.04,
               wood, bevel=0.006, up=V((0, -1, 0)))
    # canvas (not a wind material: the sails spin as a whole in the client)
    canvas = MAT._get("sailcanvas", lambda: M.cloth("SailCanvas", color="#b6a888", kind="linen", dirt=0.6,
                                                     hem_dirt=0.0))
    verts, faces = [], []
    nu, nv = 6, 3
    for i in range(nu + 1):
        for j in range(nv + 1):
            t = inner + 0.05 + (length - 0.2 - inner - 0.05) * i / nu
            w = 0.32 + (width - 0.36) * j / nv
            bil = 0.06 * math.sin(math.pi * j / nv) * math.sin(math.pi * i / nu)
            p = hub + y + d * t + s * w + V((0, -0.08 - bil, 0))
            verts.append(tuple(p))
    for i in range(nu):
        for j in range(nv):
            a = i * (nv + 1) + j
            faces.append((a, a + nv + 1, a + nv + 2, a + 1))
    o = P.mesh(verts, faces, canvas, smooth=180, offset=False)
    gn.solidify(o, 0.01, offset=0.0)
    gn.apply(o)
    sk._smooth(o.data, 180)


def build_windmill(args):
    """≈12 m smock windmill: stone base, tapered octagonal weatherboarded tower, gallery, boat cap with shingles.
    The four sails are a separate object "Sails" whose origin is ON the hub axis (the client spins it around its
    local Y axis = glTF Z, the front direction)."""
    MAT = sk.Mats()
    P = sk.Parts(seed=505)
    S = sk.Parts(seed=506, prefix="S")
    stone = MAT.stone("grey", 0.45)
    SP.stone_ring(P, MAT, 2.45, 0.0, 1.3, depth=0.34, seed=7, mat=stone, course=(0.26, 0.36), length=(0.4, 0.7))
    P.lathe([(2.15, 0.0), (2.15, 1.35), (0.0, 1.35)], (0, 0, 0), MAT.mortar(), n=16, cap_top=False, cap_bottom=False)
    P.lathe([(2.5, 1.28), (2.52, 1.36), (2.25, 1.44), (0.0, 1.44)], (0, 0, 0), MAT.blocks((0.5, 0.3)), n=16,
            cap_bottom=False)
    z0, z1, r0, r1 = 1.4, 7.4, 2.15, 1.45
    octagon_tower(P, MAT, z0, z1, r0, r1, seed=3)
    # door at the front (-Y) in an ashlar surround block + windows on the octagon faces
    P.box((1.7, 0.6, 2.55), (0, -2.35, 1.275), MAT.blocks((0.45, 0.28)), bevel=0.03)
    P.box((1.9, 0.7, 0.18), (0, -2.38, 2.6), MAT.blocks((0.45, 0.28)), bevel=0.03)
    t, n = V((1, 0, 0)), V((0, -1, 0))
    door(P, MAT, V((0, -2.65, 0.25)), t, n, w=0.95, h=1.95)
    for k in range(2):
        P.stone((1.3 - 0.2 * k, 0.36, 0.26), (0, -2.95 + 0.25 * k, 0.12 + 0.12 * k), MAT.stone("warm", 0.3),
                seed=90 + k)
    for (a, z) in ((math.pi / 4, 4.6), (3 * math.pi / 4, 4.5), (-math.pi / 2, 5.6), (math.pi, 6.3)):
        r = (r0 + (r1 - r0) * (z - z0) / (z1 - z0)) * math.cos(math.pi / 8) + 0.04
        c = V((math.sin(a) * r, -math.cos(a) * r, z))
        tt = V((math.cos(a), math.sin(a), 0))
        nn = V((math.sin(a), -math.cos(a), 0))
        window(P, MAT, c, tt, nn, 0.42, 0.58, shutters=None)
    # gallery (reefing stage) at 2.9 m: ring of planks on brackets + railing
    zg = 2.9
    rg = r0 + (r1 - r0) * (zg - z0) / (z1 - z0)
    P.lathe([(rg - 0.05, zg - 0.06), (rg + 0.95, zg - 0.06), (rg + 0.95, zg + 0.02), (rg - 0.05, zg + 0.02)],
            (0, 0, 0), MAT.planks("X", "old", (0.6, 0.18)), n=16)
    for i in range(8):
        a = 2 * math.pi * (i + 0.5) / 8
        c = V((math.cos(a), math.sin(a), 0))
        P.beam(c * (rg - 0.1) + V((0, 0, zg - 0.9)), c * (rg + 0.8) + V((0, 0, zg - 0.08)), 0.1, 0.1,
               MAT.wood("Z", "dark"), bevel=0.012)
        P.beam(c * (rg + 0.88) + V((0, 0, zg)), c * (rg + 0.88) + V((0, 0, zg + 1.0)), 0.08, 0.08, MAT.wood("Z", "dark"),
               bevel=0.012)
    for z in (zg + 0.5, zg + 0.98):
        P.lathe([(rg + 0.86, z - 0.03), (rg + 0.91, z - 0.03), (rg + 0.91, z + 0.03), (rg + 0.86, z + 0.03)], (0, 0, 0),
                MAT.wood("X", "dark"), n=16, cap_top=False, cap_bottom=False)
    # cap: curb ring + boat-shaped cap covered with shingle rows (two slopes, ridge along Y) + gables
    P.lathe([(r1 + 0.12, z1 - 0.05), (r1 + 0.12, z1 + 0.2), (0.0, z1 + 0.2)], (0, 0, 0), MAT.wood("X", "dark"), n=16,
            cap_bottom=False)
    cz = z1 + 0.2
    SP.gable_roof(P, MAT, 0.0, 0.15, 3.0, 3.4, cz + 0.2, cz + 1.9, overhang=0.25, ridge_axis="Y", kind="wood",
                  exposure=0.22, sh_w=0.3, thick=0.03, deck=0.05, seed=41)
    for sy in (-1, 1):
        tri = [(-1.5, 0.0), (1.5, 0.0), (0.0, 1.7)]
        rot = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0))).to_euler()
        yy = 0.15 + sy * 1.7
        P.poly_prism(tri, 0.0, 0.1, MAT.planks("X", "dark", (1.0, 0.2)), loc=(0, yy + (0.05 if sy < 0 else 0.05), cz + 0.2),
                     rot=rot)
    P.box((3.0, 3.4, 0.22), (0, 0.15, cz + 0.1), MAT.wood("Y", "dark"), bevel=0.02)
    # windshaft + hub (brake wheel housing) sticking out at the front
    hub = V((0, -2.25, 8.5))
    P.cyl(0.2, 1.2, hub + V((0, 1.1, 0)), MAT.wood("Z", "dark"), rot=(math.pi / 2, 0, 0), n=10)
    P.cyl(0.24, 0.18, hub + V((0, 0.05, 0)), MAT.iron(0.5), rot=(math.pi / 2, 0, 0), n=10)
    # tail pole (winding the cap) at the back down to the ground
    P.beam((0, 1.6, cz + 0.1), (0, 3.9, 2.2), 0.14, 0.14, MAT.wood("Z", "dark"), bevel=0.02)
    P.beam((0, 1.5, cz - 0.7), (0, 3.2, 2.8), 0.1, 0.1, MAT.wood("Z", "dark"), bevel=0.015)
    P.cyl(0.35, 0.1, (-0.05, 3.95, 2.1), MAT.wood("Z", "old"), rot=(0, math.pi / 2, 0), n=10)
    # ------------------------------------------------------------ the sails (separate object "Sails")
    S.cyl(0.28, 0.35, hub + V((0, -0.05, 0)), MAT.iron(0.5), rot=(math.pi / 2, 0, 0), n=10)
    S.box((0.36, 0.3, 0.36), hub + V((0, -0.2, 0)), MAT.wood("Z", "dark"), rot=(0, math.pi / 4, 0), bevel=0.03)
    for k in range(4):
        sail(S, MAT, hub + V((0, -0.2, 0)), math.pi / 4 + k * math.pi / 2, length=4.3)
    return {"parts": P.objs, "separate": {"Sails": S.objs}, "pivots": {"Sails": tuple(hub + V((0, -0.2, 0)))}}


# =============================================================================== WATCHTOWER
def pyramid_roof(P, MAT, cx, cy, half, eave_z, apex_z, kind="wood", exposure=0.2, sh_w=0.28, seed=0):
    """Four tapered shingle slopes meeting at an apex, deck faces, hip boards and a finial."""
    mat = MAT.shingles(kind)
    apex = V((cx, cy, apex_z))
    wood = MAT.wood("Z", "dark")
    for k in range(4):
        R = Matrix.Rotation(k * math.pi / 2, 3, "Z")
        pe = V((cx, cy, 0)) + R @ V((0, -half, 0)) + V((0, 0, eave_z))
        wd = R @ V((1, 0, 0))
        sd = (apex - pe).normalized()
        nrm = wd.cross(sd).normalized()
        if nrm.z < 0:
            nrm = -nrm
        sk.roof_rows(P, mat, pe, apex - sd * 0.12, wd, 2 * half, exposure=exposure, sh_w=sh_w, thick=0.03,
                     seed=seed + k, name=f"PyrRows{k}", taper=(1.0, 0.04))
        # hip board on the corner
        corner = V((cx, cy, 0)) + R @ V((half, -half, 0)) + V((0, 0, eave_z))
        P.beam(corner + V((0, 0, 0.06)), apex + V((0, 0, 0.06)), 0.1, 0.07, wood, bevel=0.012,
               up=(corner - V((cx, cy, corner.z))).normalized() + V((0, 0, 1.5)))
    # closed pyramid deck under the shingle rows
    P.cyl(half * math.sqrt(2) - 0.02, apex_z - eave_z - 0.06, (cx, cy, eave_z - 0.07), wood, n=4, r2=0.0,
          rot=(0, 0, math.pi / 4), smooth=0)
    P.lathe([(0.1, 0.0), (0.06, 0.2), (0.08, 0.3), (0.0, 0.7)], (cx, cy, apex_z - 0.05), MAT.blackiron(), n=6)


def build_watchtower(args):
    """≈10 m timber watchtower: four battered log legs on stone footings, X-bracing, ladder, plank platform with
    a log parapet, pyramid shingle roof, brazier and a banner."""
    MAT = sk.Mats()
    P = sk.Parts(seed=606)
    log = MAT._get("towerlog", lambda: M.bark("TowerLog", kind="oak", color="#5b5046", color2="#2f2821", moss=0.25))
    wood = MAT.wood("Z", "dark")
    stone = MAT.stone("grey", 0.4)
    b0, b1 = 1.75, 1.3                   # half-spread of the legs at the ground / at the platform
    zp = 6.4                             # platform floor
    legs = []
    for (sx, sy) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        p0 = V((sx * b0, sy * b0, 0.3))
        p1 = V((sx * b1, sy * b1, zp + 2.35))
        legs.append((p0, p1))
        P.cyl(0.16, (p1 - p0).length, p0, log, rot=(p1 - p0).to_track_quat("Z", "Y").to_euler(), n=9, r2=0.13,
              smooth=50)
        for k in range(4):
            a = k * math.pi / 2 + 0.3
            P.stone((0.4, 0.3, 0.3), (sx * b0 + 0.22 * math.cos(a), sy * b0 + 0.22 * math.sin(a), 0.1), stone,
                    rot=(0, 0, a), seed=k + 10 * (sx + 2) + sy)
    # horizontal girts + X bracing on each face at two levels
    def leg_at(i, z):
        p0, p1 = legs[i]
        t = (z - p0.z) / (p1.z - p0.z)
        return p0.lerp(p1, t)
    for lvl, (za, zb) in enumerate(((0.6, 3.4), (3.4, zp - 0.1))):
        for i in range(4):
            j = (i + 1) % 4
            A0, B0 = leg_at(i, za), leg_at(j, za)
            A1, B1 = leg_at(i, zb), leg_at(j, zb)
            out = ((A0 + B0) / 2 - V((0, 0, za))).normalized()
            P.beam(A1 + out * 0.12, B1 + out * 0.12, 0.14, 0.12, wood, bevel=0.018, up=out)
            P.beam(A0 + out * 0.14, B1 + out * 0.14, 0.12, 0.08, wood, bevel=0.014, up=out)
            P.beam(B0 + out * 0.2, A1 + out * 0.2, 0.12, 0.08, wood, bevel=0.014, up=out)
    # platform: joists + planks (overhanging) + parapet of vertical boards with a top rail
    ph = b1 + 0.35 + 0.25
    for k in range(6):
        y = -ph + 2 * ph * k / 5
        P.beam((-ph - 0.05, y, zp - 0.12), (ph + 0.05, y, zp - 0.12), 0.14, 0.16, wood, bevel=0.015, up=(0, 0, 1))
    P.planks((-ph, -ph, zp - 0.04), (1, 0, 0), (0, 1, 0), 2 * ph, 2 * ph, 11, MAT.wood("Z", "old"), thick=0.05,
             gap=0.012, ragged=0.08)
    ph2 = ph - 0.05
    for k in range(4):
        R = Matrix.Rotation(k * math.pi / 2, 3, "Z")
        o = R @ V((-ph2, -ph2, 0)) + V((0, 0, zp))
        u = R @ V((1, 0, 0))
        v = V((0, 0, 1))
        P.planks(o, u, v, 2 * ph2, 1.05, 14, MAT.wood("Z", "old"), thick=0.045, gap=0.015, along="v", ragged=0.1)
        a = o + V((0, 0, 1.08))
        P.beam(a - u * 0.05, a + u * (2 * ph2 + 0.05), 0.1, 0.14, wood, bevel=0.015, up=(0, 0, 1))
        # arrow slit gap: skip one board (visual notch) is enough at game scale
    # roof posts (the legs continue) + roof beams
    zr = zp + 2.35
    for i in range(4):
        j = (i + 1) % 4
        P.beam(legs[i][1] + V((0, 0, -0.05)), legs[j][1] + V((0, 0, -0.05)), 0.16, 0.14, wood, bevel=0.018,
               up=(0, 0, 1))
    pyramid_roof(P, MAT, 0.0, 0.0, b1 + 0.75, zr, zr + 1.35, kind="wood", exposure=0.2, sh_w=0.28, seed=5)
    # ladder on the front face (-Y) up to a hatch
    lx = 0.35
    for s in (-1, 1):
        P.beam((lx + s * 0.25, -b0 - 0.35, 0.0), (lx + s * 0.25, -ph + 0.05, zp + 0.9), 0.07, 0.07, MAT.wood("Z", "old"),
               bevel=0.01)
    nr = 22
    for k in range(1, nr):
        t = k / nr
        a = V((lx - 0.25, -b0 - 0.35, 0.0)).lerp(V((lx - 0.25, -ph + 0.05, zp + 0.9)), t)
        P.beam(a, a + V((0.5, 0, 0)), 0.04, 0.04, MAT.wood("Z", "old"), bevel=0.006)
    # brazier on the platform (ember glow) + banner on a pole
    P.lathe([(0.05, 0.0), (0.08, 0.5), (0.3, 0.75), (0.34, 0.8), (0.3, 0.8), (0.05, 0.62)], (0.7, 0.6, zp),
            MAT.blackiron(), n=10, cap_top=False)
    P.ico(0.27, (0.7, 0.6, zp + 0.74), MAT.ember(), subdiv=2, scale=(1, 1, 0.35), jitter=0.02)
    P.cyl(0.04, 3.2, (-ph2 + 0.1, ph2 - 0.1, zp - 0.1), MAT.wood("Z", "dark"), n=8)
    ban = MAT.cloth("BannerTower", "#6e1b17", kind="wool", emblem={"color": "#c9a24a", "center": (0.0, -0.45),
                                                                 "size": 0.14})
    P.beam((-ph2 + 0.1, ph2 - 0.1, zp + 2.9), (-ph2 + 0.1 + 0.75, ph2 - 0.1, zp + 2.9), 0.04, 0.04,
           MAT.wood("Z", "dark"), bevel=0.006)
    SP.cloth_sheet(P, ban, 0.65, 1.3, (-ph2 + 0.1 + 0.4, ph2 - 0.1, zp + 2.87), seg=(8, 14), folds=0.03, seed=7)
    # crates/barrel at the foot
    P.box((0.6, 0.6, 0.6), (1.1, -0.8, 0.3), MAT.wood("Z", "old"), rot=(0, 0, 0.3), bevel=0.02)
    return P.objs
