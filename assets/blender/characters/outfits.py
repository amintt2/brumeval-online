"""Generic garments for the humanoids, cut from the body (A-pose bind frame): shirts, trousers, boots, gloves,
belts, beards, plate pieces, capes with torso-blended weights.

Region selection uses the NEAREST BONE of each body face (bone segments of the bind pose), so selections follow
the anatomy of every build (heroes, goblins, portly innkeepers...)."""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

import anatomy as A
import garments as G
import gear as GR
from kit import gn
from kit import rig as KR

DEFORM = ["hips", "spine", "chest", "neck", "head", "upper_arm.L", "forearm.L", "hand.L", "upper_arm.R", "forearm.R",
          "hand.R", "thigh.L", "shin.L", "foot.L", "thigh.R", "shin.R", "foot.R"]


def seg(ctx, bone):
    h, t = ctx.J[bone]
    return Vector(h), Vector(t)


def nearest_bone(ctx):
    segs = [(b,) + seg(ctx, b) for b in DEFORM]
    # the spine chain is thick: bias so the torso wins over arms/legs close to it
    bias = {"hips": -0.03, "spine": -0.035, "chest": -0.04, "neck": -0.01, "head": -0.05}

    def fn(p):
        best, bb = 1e9, None
        for b, h, t in segs:
            d, _ = G.near_segment(p, h, t)
            d += bias.get(b, 0.0)
            if d < best:
                best, bb = d, b
        return bb
    return fn


def side_of(b):
    return b.split(".")[-1] if "." in b else None


def limb_domain(ctx, bones):
    nb = nearest_bone(ctx)
    return lambda c: nb(c) in bones


def along(ctx, bone, t):
    h, tl = seg(ctx, bone)
    return h.lerp(tl, t), (tl - h).normalized()


# =============================================================================== shirts / trousers / boots / gloves
def shirt(ctx, name, mat, z_bot=0.95, sleeve=("forearm", 0.55), offset=0.012, neck=0.4, offset_fn=None, smooth=2,
          subdiv=0, hood_neck=False):
    """Torso + sleeves. sleeve = (bone, fraction) where the sleeve ends (None = sleeveless: cut at the shoulder)."""
    nb = nearest_bone(ctx)
    cuts = []
    n0, n1 = seg(ctx, "neck")
    cuts.append((n0.lerp(n1, neck), (0, 0.25, 1), 0.2, limb_domain(ctx, {"neck", "head"})))
    cuts.append(((0, 0, z_bot), (0, 0, -1), 0.4))
    allowed = {"hips", "spine", "chest", "neck"}
    for s in ("L", "R"):
        arm = limb_domain(ctx, {f"upper_arm.{s}", f"forearm.{s}", f"hand.{s}"})
        if sleeve is None:
            p, d = along(ctx, f"upper_arm.{s}", 0.05)
            cuts.append((p, d, 0.12, arm))
            continue
        b, t = sleeve
        p, d = along(ctx, f"{b}.{s}", t)
        cuts.append((p, d, 0.14, arm))
        allowed |= {f"upper_arm.{s}"} | ({f"forearm.{s}"} if b == "forearm" else set())
    return G.region_shell(ctx.body, name, lambda c, n: nb(c) in allowed, cuts, offset, offset_fn, smooth, mat, subdiv=subdiv)


def trousers(ctx, name, mat, z_top=1.0, bottom=0.8, offset=0.01, offset_fn=None, smooth=2):
    """Legs from z_top down to `bottom` (fraction along the shin)."""
    nb = nearest_bone(ctx)
    cuts = [((0, 0, z_top), (0, 0, 1), 0.33, lambda c: c.z > z_top - 0.05)]
    for s in ("L", "R"):
        p, d = along(ctx, f"shin.{s}", bottom)
        cuts.append((p, d, 0.14, limb_domain(ctx, {f"shin.{s}", f"foot.{s}"})))
    allowed = {"hips", "thigh.L", "thigh.R", "shin.L", "shin.R"}
    return G.region_shell(ctx.body, name, lambda c, n: nb(c) in allowed and c.z < z_top + 0.01, cuts, offset, offset_fn,
                          smooth, mat)


def boots(ctx, name, mat, top=0.45, offset=0.012, cuff=0.0, sole_mat=None, toe_len=0.015):
    """Boots up to `top` (fraction along the shin from the knee: 0.45 = mid calf). Flat sole at z = 0."""
    nb = nearest_bone(ctx)
    cuts = []
    for s in ("L", "R"):
        p, d = along(ctx, f"shin.{s}", top)
        cuts.append((p, -d, 0.14, limb_domain(ctx, {f"shin.{s}", f"thigh.{s}"})))
    allowed = {"shin.L", "shin.R", "foot.L", "foot.R"}
    ob = G.region_shell(ctx.body, name, lambda c, n: nb(c) in allowed, cuts, offset, None, 2, mat)
    # flat sole, slightly longer toe box
    me = ob.data
    for v in me.vertices:
        if v.co.z < 0.03:
            v.co.y -= toe_len * max(0.0, min(1.0, (-v.co.y - 0.02) / 0.1))
        if v.co.z < 0.004:
            v.co.z = 0.0
    me.update()
    return ob


def gloves(ctx, name, mat, cuff=0.72, offset=0.004):
    """Hands + wrists up to `cuff` (fraction along the forearm from the elbow)."""
    nb = nearest_bone(ctx)
    cuts = []
    for s in ("L", "R"):
        p, d = along(ctx, f"forearm.{s}", cuff)
        cuts.append((p, -d, 0.12, limb_domain(ctx, {f"forearm.{s}", f"upper_arm.{s}"})))
    allowed = {"forearm.L", "forearm.R", "hand.L", "hand.R"}
    return G.region_shell(ctx.body, name, lambda c, n: nb(c) in allowed, cuts, offset, None, 1, mat, relax=0.2)


def belt(ctx, name, mat, z, height=0.045, offset=0.02, thickness=0.008, buckle_mat=None, over=()):
    """Belt band around the body section at height z (pushed out by `offset` + over the given garments)."""
    src = ctx.body
    if over:
        src = over[0]
    sec = G.section(src, (0, 0, z), (0, 0, 1), near=(0, 0, z), radius=0.35, n=40)
    loop, c, nrm = sec
    b = G.band(name, loop, c, nrm, height, offset=offset, thickness=thickness, mat=mat)
    parts = [b]
    if buckle_mat is not None:
        front = min(loop, key=lambda p: p.y)
        y = front.y - offset - thickness - 0.004
        fr = GR.box(name + "_Buckle", (0.055, 0.008, height * 1.25), buckle_mat, 0.002, (front.x, y, z))
        hole = GR.box(name + "_Tongue", (0.006, 0.006, height * 0.9), buckle_mat, 0.001, (front.x + 0.012, y - 0.004, z))
        parts += [fr, hole]
    return GR.join(parts, name) if len(parts) > 1 else b


# =============================================================================== face hair
def beard(ctx, name, mat, length=0.02, chin=0.03, moustache=True, sideburns=True, long=0.0, width=1.0):
    """Beard grown from the jaw/chin/cheeks (skin faces under it are hidden by the covered-body pass).
    long > 0 extends a pointed beard down the chest (metres)."""
    c, k = ctx.head_c, ctx.head_k
    mouth = c + Vector((0, -0.1, -0.074)) * k

    def keep(p, n):
        q = (p - c) / k
        if q.y > 0.015 or q.z > -0.03 or q.z < -0.16:
            return False
        if (p - mouth).length < 0.02 * k and q.z > -0.09:
            return False                    # keep the lips visible
        if abs(q.x) > 0.075 * width:
            return False
        if q.z > -0.05 and abs(q.x) < 0.03:
            return False                    # under the nose: moustache handles it
        if not sideburns and q.z > -0.06 and abs(q.x) > 0.05:
            return False
        return True

    def off(p):
        q = (p - c) / k
        t = max(0.0, min(1.0, (-0.06 - q.z) / 0.06))
        return (length + chin * t * max(0.0, 1 - abs(q.x) / 0.06)) * k

    b = G.region_shell(ctx.body, name, keep, (), 0.0, off, 3, mat, relax=0.3)
    if long > 0:
        _stretch_beard(b, c, k, long)
    parts = [b]
    if moustache:
        pts = []
        for i in range(9):
            u = i / 8 * 2 - 1
            p = c + Vector((u * 0.03, -0.108 - 0.004 * (1 - u * u), -0.061 - 0.012 * abs(u) ** 1.6)) * k
            pts.append(tuple(p) + (1.0 - 0.45 * abs(u),))
        cu = gn.make_curve([pts], name + "_Moustache", kind="NURBS", resolution=3)
        gn.curve_to_mesh(cu, radius=0.0065 * k, profile_res=6)
        m = gn.apply(cu)
        m.data.transform(Matrix.Translation(c) @ Matrix.Diagonal((1, 0.55, 1, 1)) @ Matrix.Translation(-c))
        m.data.materials.clear()
        m.data.materials.append(mat)
        parts.append(m)
    return GR.join(parts, name) if len(parts) > 1 else b


def _stretch_beard(ob, c, k, long):
    """Pull the lower beard down into a tapered point (long beards)."""
    me = ob.data
    for v in me.vertices:
        q = (v.co - c) / k
        t = max(0.0, min(1.0, (-0.075 - q.z) / 0.06))
        if t > 0:
            v.co.z -= long * t ** 1.3
            v.co.x *= 1.0 - 0.55 * t
            v.co.y -= 0.02 * t * k
    me.update()


def hair_cap(ctx, name, mat, hairline=0.045, back=-0.1, offset=0.012, volume=0.01, sides=-0.02, long=0.0, fringe=0.0):
    """Hair mass on the scalp (from the head surface): hairline height (m above eye level at the front),
    back = lowest z at the back of the head (relative to eye level), long = extra length down the nape."""
    c, k = ctx.head_c, ctx.head_k

    def keep(p, n):
        q = (p - c) / k
        if q.y < -0.03:          # front: above the hairline only
            return q.z > hairline - 0.03 * max(0.0, abs(q.x) - 0.03) / 0.05
        if abs(q.x) > 0.055 and q.y < 0.02:   # temples / above the ears
            return q.z > sides
        return q.z > back and (p - c).length < 0.16 * k

    def off(p):
        q = (p - c) / k
        return (offset + volume * max(0.0, min(1.0, (q.z + 0.02) / 0.1))) * k

    h = G.region_shell(ctx.body, name, keep, (), 0.0, off, 3, mat, relax=0.3)
    if long > 0:
        me = h.data
        for v in me.vertices:
            q = (v.co - c) / k
            if q.y > 0.0 and q.z < 0.0:
                t = max(0.0, min(1.0, -q.z / 0.08))
                v.co.z -= long * t
                v.co.y += 0.02 * t * k
        me.update()
    return h


# =============================================================================== weights helpers
def blend_to_torso(amount_fn, bones=("chest", "spine")):
    """post-process for capes/hoods: w' = (1-a) * transferred + a * torso, a = amount_fn(world_co)."""
    def post(obj, rig):
        names = KR.deform_bones(rig)
        W = KR.weights_array(obj, names)
        mw = obj.matrix_world
        tor = np.zeros(len(names))
        for b in bones:
            tor[names.index(b)] = 1.0 / len(bones)
        for v in obj.data.vertices:
            a = amount_fn(mw @ v.co)
            W[v.index] = W[v.index] * (1 - a) + tor * a
        KR.set_weights(obj, names, W)
    return post


def torso_weights(bones):
    """fn(world_co) -> {bone: w} constant weights (rigid-ish plates that follow the torso)."""
    return lambda co: dict(bones)


# =============================================================================== plates
def rim_tube(ctx, name, obj, mat, radius=0.004, min_len=0.05, resolution=2):
    """Rolled metal rim along every open border of a plate (GN curve -> mesh)."""
    loops = [lp for lp in G.boundary_loops(obj) if _loop_len(lp) > min_len]
    if not loops:
        return None
    splines = [[tuple(p) + (1.0,) for p in lp] for lp in loops]
    cu = gn.make_curve(splines, name, kind="POLY")
    for sp in cu.data.splines:
        sp.use_cyclic_u = True
    gn.curve_to_mesh(cu, radius=radius, profile_res=6, fill_caps=False)
    ob = gn.apply(cu)
    ob.data.materials.clear()
    ob.data.materials.append(mat)
    return ob


def _loop_len(lp):
    return sum((lp[i] - lp[i - 1]).length for i in range(len(lp)))


def rivets(ctx, name, obj, mat, spacing=0.035, r=0.0045, inset=0.012, min_len=0.05):
    """Dome rivets along the plate borders (inset from the rim), via kit.gn instance_on_curve."""
    loops = [lp for lp in G.boundary_loops(obj) if _loop_len(lp) > min_len]
    if not loops:
        return None
    tree = G.bvh(obj)
    splines = []
    for lp in loops:
        c = sum(lp, Vector()) / len(lp)
        pts = []
        for p in lp:
            q = p + (c - p).normalized() * inset
            hit = tree.find_nearest(q)
            if hit[0] is not None:
                q = hit[0] + hit[1] * 0.001
            pts.append(tuple(q) + (1.0,))
        splines.append(pts)
    cu = gn.make_curve(splines, name + "_Path", kind="POLY")
    for sp in cu.data.splines:
        sp.use_cyclic_u = True
    tpl = GR.ico(name + "_Tpl", r, mat, 1)          # orientation-free stud, half sunk into the plate
    gn.instance_on_curve(cu, tpl, spacing=spacing)
    ob = gn.apply(cu)
    gn.remove(tpl)
    ob.data.materials.clear()
    ob.data.materials.append(mat)
    ob.name = name
    return ob


# =============================================================================== robes: sleeves, mantle, stole, hat
def flared_sleeve(ctx, name, mat, side, t0=0.3, t1=1.12, flare=0.07, nseg=18, rings=8, clearance=0.012, droop=0.04):
    """Bell sleeve around the forearm (bind pose): hugs the arm at t0 (fraction elbow->wrist), opens to `flare`
    at t1 (> 1 = past the wrist), the lower (hanging) side droops."""
    h, t = seg(ctx, f"forearm.{side}")
    a = (t - h).normalized()
    tree = G.bvh(ctx.body)
    x = Vector((0, -1, 0))
    x = (x - a * x.dot(a)).normalized()
    y = a.cross(x)
    verts = []
    for r in range(rings + 1):
        u = r / rings
        tt = t0 + (t1 - t0) * u
        c = h.lerp(t, tt)
        for s in range(nseg):
            ph = 2 * math.pi * s / nseg
            d = x * math.cos(ph) + y * math.sin(ph)
            o = c + d * 0.25
            hit = tree.ray_cast(o, -d, 0.26)
            rb = (0.25 - hit[3]) if hit[0] is not None and u < 0.7 else 0.035
            rr = max(rb, 0.03) + clearance + flare * u ** 1.6
            p = c + d * rr
            p.z -= droop * u ** 2 * max(0.0, -d.z)          # hanging side sags
            verts.append(p)
    faces = []
    for r in range(rings):
        for s in range(nseg):
            s2 = (s + 1) % nseg
            faces.append((r * nseg + s, r * nseg + s2, (r + 1) * nseg + s2, (r + 1) * nseg + s))
    ob = G.new_obj(name, verts, faces, mat)
    G.outward_normals(ob, lambda p: h + a * (p - h).dot(a))
    return ob


def mantle(ctx, name, mat, drop=0.2, offset=0.03, sleeve=0.35):
    """Capelet over the shoulders: body faces of the upper chest/back + shoulder caps, pushed out, lower edge
    lengthened (drape)."""
    nb = nearest_bone(ctx)
    n0 = Vector(ctx.J["neck"][0])
    zc = n0.z - drop

    def keep(c, n):
        b = nb(c)
        if b in ("chest", "neck"):
            return c.z > zc
        if b.startswith("upper_arm"):
            sh, el = seg(ctx, b)
            _, tt = G.near_segment(c, sh, el)
            return tt < sleeve
        return False
    cuts = [(n0.lerp(Vector(ctx.J["neck"][1]), 0.35), (0, 0.25, 1), 0.2)]
    ob = G.region_shell(ctx.body, name, keep, cuts, offset, None, 3, mat, relax=0.4)
    # drape: open border verts below the neck move down/outward
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    for v in bm.verts:
        if v.is_boundary and v.co.z < n0.z - 0.04:
            v.co.z -= 0.035
            d = Vector((v.co.x, v.co.y, 0))
            if d.length > 1e-4:
                v.co += d.normalized() * 0.012
    bm.to_mesh(ob.data)
    bm.free()
    return ob


def ribbon(ctx, name, mat, pts, width=0.08, clear_objs=(), clearance=0.012, twist=0.0):
    """Hanging strip (stole, scarf ends, sash tails): a ribbon along pts (top -> bottom) facing -Y, pushed in front
    of `clear_objs` (ray cast from the front) so it never sinks into the body/robe."""
    trees = [G.bvh(o) for o in clear_objs]
    verts = []
    n = len(pts)
    for i, p in enumerate(pts):
        p = Vector(p)
        prev = Vector(pts[max(0, i - 1)])
        nxt = Vector(pts[min(n - 1, i + 1)])
        tng = (nxt - prev).normalized()
        side = Vector((1, 0, 0))
        side = (side - tng * side.dot(tng)).normalized()
        for k in (-1, 1):
            q = p + side * (width / 2) * k
            best = None
            for tr in trees:
                hit = tr.ray_cast(Vector((q.x, q.y - 0.6, q.z)), Vector((0, 1, 0)), 1.2)
                if hit[0] is not None:
                    yy = hit[0].y - clearance
                    best = yy if best is None else min(best, yy)
            if best is not None and best < q.y:
                q.y = best
            verts.append(q)
    faces = [(2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2) for i in range(n - 1)]
    ob = G.new_obj(name, verts, faces, mat)
    G.outward_normals(ob, lambda p: (p.x, p.y + 1.0, p.z))
    subd = ob.modifiers.new("Sub", "SUBSURF")
    subd.levels = 1
    G._apply_all(ob)
    return ob


def wizard_hat(ctx, name, mat, band_mat, brim=0.24, height=0.42, bend=0.12, seed=1, tilt=(-6, 4)):
    """Wide-brimmed pointed hat: droopy wavy brim + tall cone bent back at the tip + band. Head-local."""
    import random
    rnd = random.Random(seed)
    c, k = ctx.head_c, ctx.head_k
    base = c + Vector((0, 0.012, 0.055)) * k
    hr = 0.098 * k
    seg_n = 32
    verts, faces = [], []
    ph = [rnd.uniform(0, 6.28) for _ in range(3)]
    # brim rings (inner = head opening, outer = wavy droopy edge)
    rings = [(hr, 0.0), (hr + 0.03, -0.004), (hr + (brim - hr) * 0.55, -0.02), (brim, -0.05)]
    for ri, (rr, dz) in enumerate(rings):
        for s in range(seg_n):
            a = 2 * math.pi * s / seg_n
            wav = 0.012 * math.sin(3 * a + ph[0]) + 0.008 * math.sin(5 * a + ph[1]) if ri >= 2 else 0.0
            front = -math.cos(a)
            zz = dz * (1.0 + 0.4 * max(0.0, front)) + wav * (ri / 3)
            verts.append(base + Vector((math.sin(a) * rr, -math.cos(a) * rr * 1.08, zz)))
    for r in range(len(rings) - 1):
        for s in range(seg_n):
            s2 = (s + 1) % seg_n
            faces.append((r * seg_n + s, (r + 1) * seg_n + s, (r + 1) * seg_n + s2, r * seg_n + s2))
    brim_o = G.new_obj(name + "_Brim", verts, faces, mat)
    G.plate(brim_o, 0.006, 0.0)
    # cone: rings from the head opening up to the bent tip
    cv, cf = [], []
    cs = 16
    N = 12
    for r in range(N + 1):
        u = r / N
        rr = hr * (1.0 - u) ** 1.15 + 0.004
        zc = height * u
        yb = bend * u ** 2.2
        xb = 0.02 * math.sin(u * 3.0)
        cc = base + Vector((xb, yb, zc))
        crumple = 1.0 + 0.05 * math.sin(u * 17 + ph[2]) * u
        for s in range(cs):
            a = 2 * math.pi * s / cs
            cv.append(cc + Vector((math.sin(a) * rr * crumple, -math.cos(a) * rr * 1.06 * crumple, 0)))
    for r in range(N):
        for s in range(cs):
            s2 = (s + 1) % cs
            cf.append((r * cs + s, r * cs + s2, (r + 1) * cs + s2, (r + 1) * cs + s))
    top = len(cv)
    cv.append(base + Vector((0.02 * math.sin(3.0), bend * 1.05, height + 0.01)))
    for s in range(cs):
        cf.append((N * cs + s, N * cs + (s + 1) % cs, top))
    cone = G.new_obj(name + "_Cone", cv, cf, mat)
    G.recalc_normals(cone)
    band_o = GR.lathe(name + "_Band", [(0.0, hr + 0.006), (0.035, hr * 0.93 + 0.006)], cs, band_mat, cap0=False, cap1=False)
    GR.xf(band_o, Matrix.Translation(base + Vector((0, 0, 0.004))) @ Matrix.Diagonal((1, 1.06, 1, 1)))
    G.plate(band_o, 0.003, 0.0)
    hat = GR.join([brim_o, cone, band_o], name)
    # jaunty tilt around the head centre
    hat.data.transform(Matrix.Translation(c) @ GR.R(tilt[0], tilt[1], 0) @ Matrix.Translation(-c))
    return hat
