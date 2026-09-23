"""Garments: procedural skin weights, hoods, robes/skirts, capes, sleeves, straps and belts.

All garments are continuous quad meshes (lofted rings), pushed outside the body with a clearance (push_outside)
and skinned with smooth distance-based weights (seg_weights) so they never tear between the legs."""
import math

import bmesh
import bpy
import mathutils
import numpy as np

import hbody as HB
from kit import gn, rig

V = mathutils.Vector


def _bone_segs(arm, bones):
    out = []
    for b in bones:
        bb = arm.data.bones[b]
        out.append((np.array(arm.matrix_world @ bb.head_local), np.array(arm.matrix_world @ bb.tail_local)))
    return out


def seg_weights(ob, arm, bones, power=3.0, smooth=6, factor=0.5, bias=None, falloff=None):
    """Inverse-distance weights to bone SEGMENTS (restricted to `bones`), normalised, then Laplacian-smoothed.
    bias: {bone: multiplier}. Continuous by construction (no tearing). Adds / updates the Armature modifier."""
    co = HB.get_co(ob) @ np.array(ob.matrix_world)[:3, :3].T + np.array(ob.matrix_world)[:3, 3]
    segs = _bone_segs(arm, bones)
    W = np.zeros((len(co), len(bones)))
    for j, (a, b) in enumerate(segs):
        ab = b - a
        t = np.clip(((co - a) @ ab) / max(ab @ ab, 1e-9), 0, 1)
        d = np.linalg.norm(co - (a + t[:, None] * ab), axis=1)
        w = 1.0 / np.maximum(d, 0.01) ** power
        if bias and bones[j] in bias:
            w *= bias[bones[j]]
        W[:, j] = w
    W /= W.sum(1, keepdims=True)
    names = rig.deform_bones(arm)
    full = np.zeros((len(co), len(names)))
    for j, b in enumerate(bones):
        full[:, names.index(b)] = W[:, j]
    for g in list(ob.vertex_groups):
        if g.name in names:
            ob.vertex_groups.remove(g)
    rig.set_weights(ob, names, full)
    if smooth:
        rig.smooth_weights(ob, names, smooth, factor)
    if ob.parent != arm:
        mw = ob.matrix_world.copy()
        ob.parent = arm
        ob.matrix_world = mw
    if not any(m.type == "ARMATURE" for m in ob.modifiers):
        md = ob.modifiers.new("Armature", "ARMATURE")
        md.object = arm
        with bpy.context.temp_override(object=ob):
            while ob.modifiers[0] != md:
                bpy.ops.object.modifier_move_up(modifier=md.name)
    return ob


# =============================================================================== lofted garments
def ring(c, rx, ry, n, z=None, phase=0.0, folds=None, front_flat=0.0):
    """Ellipse ring around centre c (x,y,z). Angle 0 = front (-Y), increasing towards +X (character's left).
    folds = (count, amplitude, phase) radial wave."""
    pts = []
    for k in range(n):
        a = 2 * math.pi * k / n + phase
        f = 1.0
        if folds:
            cnt, amp, ph = folds
            f += amp * math.sin(cnt * a + ph) * (0.6 + 0.4 * math.sin(3 * a + ph * 1.7))
        x = rx * math.sin(a) * f
        y = -ry * math.cos(a) * f
        if front_flat and math.cos(a) > 0:
            y *= 1 - front_flat * math.cos(a) ** 2
        pts.append((c[0] + x, c[1] + y, c[2] if z is None else z))
    return pts


def loft_grid(rings, name, mat=None):
    ob = HB.loft(rings, name, mat=mat)
    return ob


def delete_faces(ob, pred):
    """Delete faces whose centre satisfies pred(centre, face_index) (e.g. open fronts, face openings)."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    kill = [f for f in bm.faces if pred(f.calc_center_median(), f.index)]
    bmesh.ops.delete(bm, geom=kill, context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def smooth_boundary(ob, iters=4, fac=0.5):
    """Smooth only the open borders (rounds the corners of cut openings / hems)."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    for _ in range(iters):
        new = {}
        for v in bm.verts:
            if not v.is_boundary:
                continue
            nb = [e.other_vert(v) for e in v.link_edges if e.is_boundary]
            if len(nb) == 2:
                avg = (nb[0].co + nb[1].co) / 2
                new[v] = v.co + (avg - v.co) * fac
        for v, c in new.items():
            v.co = c
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def hood(J, s, name="Cloth_Hood", mat=None, n=32, depth=1.0, peak=0.05, mantle=(0.23, 0.17), hem_drop=0.16,
         open_w=0.34, open_h=(0.0, 0.155), brim=0.03, cape=None, cape_fold=1.0):
    """Hood + shoulder mantle as ONE lofted mesh with an oval face opening.
    cape: optional (length, width_scale) to extend the back into a cape (front stays open below the mantle)."""
    hd = V(J["head"][0])
    nk = V(J["neck"][0])
    sh = V(J["upper_arm.L"][0])
    ch = V(J["chest"][0])
    c = hd + V((0, 0.012 * s, 0.1 * s))
    R = 0.125 * s
    rings = []
    # hood dome: polar angle 0 (top) -> 118 deg (under the jaw, around the neck)
    nd = 12
    for i in range(nd + 1):
        ph = math.radians(8 + 110 * i / nd)
        z = c.z + R * 1.08 * math.cos(ph)
        r = R * math.sin(ph)
        rx, ry = r * 1.0, r * 1.12 * depth
        cy = c.y + (0.012 * s) + peak * s * max(0.0, math.cos(ph)) ** 2   # peak falls back
        cc = (0, cy - brim * s * math.sin(ph) ** 4 * 0.0, z)
        pts = ring(cc, max(rx, 0.01 * s), max(ry, 0.01 * s), n)
        # pull the front (face side) forward to form a brim around the face opening
        pts = [(x, y - brim * s * max(0.0, -(y - cc[1]) / max(ry, 1e-6)) ** 3, zz) for x, y, zz in pts]
        rings.append(pts)
    # neck -> mantle over the shoulders
    zs = [nk.z + 0.02 * s, sh.z + 0.03 * s, sh.z - 0.02 * s, sh.z - hem_drop * s * 0.6, sh.z - hem_drop * s]
    ws = [(0.085 * s, 0.09 * s), (mantle[0] * s * 0.8, mantle[1] * s * 0.9), (mantle[0] * s, mantle[1] * s),
          (mantle[0] * s * 1.06, mantle[1] * s * 1.05), (mantle[0] * s * 1.1, mantle[1] * s * 1.08)]
    cyc = [nk.y + 0.005 * s, ch.y + 0.01 * s, ch.y + 0.015 * s, ch.y + 0.015 * s, ch.y + 0.015 * s]
    for z, (rx, ry), yy in zip(zs, ws, cyc):
        rings.append(ring((0, yy, z), rx, ry, n, folds=(9, 0.025, 0.4) if z < sh.z else None))
    if cape:
        L, wsc = cape
        for k in range(1, 7):
            t = k / 6
            z = zs[-1] - L * s * t
            rx = ws[-1][0] * (1 + 0.15 * t) * wsc
            ry = ws[-1][1] * (1 + 0.25 * t)
            rings.append(ring((0, cyc[-1] + 0.03 * s * t, z), rx, ry, n,
                              folds=(9, (0.05 + 0.04 * t) * cape_fold, 0.4 + t)))
    ob = HB.loft(rings, name, mat=mat)
    # face opening (param-space rectangle, corners rounded by boundary smoothing)
    zlo, zhi = hd.z + open_h[0] * s, hd.z + open_h[1] * s

    def opening(cn, fi):
        return cn.y < c.y - 0.02 * s and abs(cn.x) < open_w * 0.5 * s * (1.0 - 0.0) and zlo < cn.z < zhi
    delete_faces(ob, opening)
    if cape:
        def front(cn, fi):
            return cn.z < zs[1] and cn.y < ch.y - 0.02 * s and abs(cn.x) < 0.12 * s + (zs[1] - cn.z) * 0.15
        delete_faces(ob, front)
    smooth_boundary(ob, 6, 0.5)
    HB.outward_normals(ob, lambda p: V((0, c.y, p.z)))
    return ob


def skirt(z_top, z_hem, r_top, r_hem, s, name="Cloth_Skirt", mat=None, n=40, rings_n=14, folds=7, fold_amp=0.07,
          cy=0.0, open_front=0.0, back_long=0.0, flare=1.3):
    """Revolved A-line skirt / robe bottom with folds increasing towards the hem. r_* = (rx, ry)."""
    rings = []
    for r in range(rings_n + 1):
        t = r / rings_n
        z = z_top + (z_hem - z_top) * t
        rx = r_top[0] + (r_hem[0] - r_top[0]) * t ** flare
        ry = r_top[1] + (r_hem[1] - r_top[1]) * t ** flare
        pts = ring((0, cy, z), rx, ry, n, folds=(folds, (0.015 + fold_amp * t), 1.3 * t))
        if back_long:
            pts = [(x, y, zz - back_long * s * t * max(0.0, (y - cy) / max(ry, 1e-6))) for x, y, zz in pts]
        rings.append(pts)
    ob = HB.loft(rings, name, mat=mat)
    if open_front:
        def front(cn, fi):
            return cn.y < cy and abs(cn.x) < open_front * s
        delete_faces(ob, front)
        smooth_boundary(ob, 3, 0.5)
    HB.outward_normals(ob, lambda p: V((0, cy, p.z)))
    return ob


def sleeve(J, side, s, r0, r1, name="Cloth_Sleeve", mat=None, n=16, rings_n=8, start=0.0, end=1.0, bell=0.0, drop=0.0):
    """Tube along upper_arm -> forearm (t in [start, end] of the whole arm), radius r0 -> r1 (+ bell flare at the end,
    drop = the cuff hangs lower on the underside)."""
    sh = V(J[f"upper_arm.{side}"][0])
    el = V(J[f"upper_arm.{side}"][1])
    wr = V(J[f"forearm.{side}"][1])
    L1, L2 = (el - sh).length, (wr - el).length

    def at(t):
        u = t * (L1 + L2)
        return sh + (el - sh) * (u / L1) if u <= L1 else el + (wr - el) * ((u - L1) / L2)
    rings = []
    for k in range(rings_n + 1):
        t = start + (end - start) * k / rings_n
        p = at(t)
        d = (at(min(t + 0.02, 1.0)) - at(max(t - 0.02, 0.0))).normalized()
        r = r0 + (r1 - r0) * (k / rings_n) + bell * (k / rings_n) ** 3
        ax = d.orthogonal().normalized()
        ay = d.cross(ax).normalized()
        pts = []
        for j in range(n):
            a = 2 * math.pi * j / n
            off = ax * math.cos(a) * r + ay * math.sin(a) * r
            if drop and off.z < 0:
                off.z -= drop * (k / rings_n) ** 2 * (-off.z / max(r, 1e-6))
            pts.append(tuple(p + off))
        rings.append(pts)
    ob = HB.loft(rings, name, mat=mat)
    HB.outward_normals(ob, lambda q: sh + (wr - sh) * max(0, min(1, (V(q) - sh).dot((wr - sh).normalized()) / (wr - sh).length)))
    return ob


def band(points, width, thick, name="Strap", mat=None, up=None, closed=False):
    """Flat strap (belt, bandolier) through world points; the band's width is along `up` (default: Z-ish, i.e.
    across the path on the body surface). Returns a closed box-section mesh."""
    pts = [V(p) for p in points]
    if closed:
        pts = pts + [pts[0]]
    n = len(pts)
    rings = []
    for i, p in enumerate(pts):
        d = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
        u = V(up) if up is not None else V((0, 0, 1))
        w = (u - d * u.dot(d)).normalized()
        t = d.cross(w).normalized()
        hw, ht = width / 2, thick / 2
        rings.append([tuple(p + w * hw + t * ht), tuple(p - w * hw + t * ht), tuple(p - w * hw - t * ht), tuple(p + w * hw - t * ht)])
    if closed:
        rings = rings[:-1]
        bm = bmesh.new()
        R = [[bm.verts.new(q) for q in r] for r in rings]
        m = len(R)
        for i in range(m):
            a, b = R[i], R[(i + 1) % m]
            for k in range(4):
                bm.faces.new((a[k], a[(k + 1) % 4], b[(k + 1) % 4], b[k]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        if mat is not None:
            me.materials.append(mat)
    else:
        ob = HB.loft(rings, name, closed_start=True, closed_end=True, mat=mat)
    for p in ob.data.polygons:
        p.use_smooth = False
    return ob


def body_loop(body_high, z, cy, rx, ry, n=48, clearance=0.01):
    """A closed loop hugging the body at height z (for belts): ellipse pushed out to the body surface + clearance."""
    t = HB.bvh(body_high)
    pts = []
    for k in range(n):
        a = 2 * math.pi * k / n
        d = V((math.sin(a), -math.cos(a), 0))
        o = V((0, cy, z))
        hit = t.ray_cast(o + d * 0.6, -d, 0.6)
        if hit[0] is not None:
            pts.append(tuple(hit[0] + d * clearance))
        else:
            pts.append(tuple(o + V((d.x * rx, d.y * ry, 0))))
    return pts


# =============================================================================== body regions (for region_shell)
class Regions:
    """Nearest-bone classification of rest-pose points + parameter along limb chains, for garment predicates.
        R = Regions(J); R.limb(co) -> ('arm.L', t 0..1 shoulder->fingertips, dist) / ('leg.R', t hip->toe, dist) / ('torso', z, dist)"""
    CHAINS = {"arm.L": ("upper_arm.L", "forearm.L", "hand.L"), "arm.R": ("upper_arm.R", "forearm.R", "hand.R"),
              "leg.L": ("thigh.L", "shin.L", "foot.L"), "leg.R": ("thigh.R", "shin.R", "foot.R"),
              "torso": ("hips", "spine", "chest", "neck", "head")}

    def __init__(self, J):
        self.J = J
        self.segs = {}
        for ch, bones in self.CHAINS.items():
            pts = [V(J[bones[0]][0])] + [V(J[b][1]) for b in bones]
            L = [0.0]
            for a, b in zip(pts[:-1], pts[1:]):
                L.append(L[-1] + (b - a).length)
            self.segs[ch] = (pts, L)

    def _proj(self, ch, p):
        pts, L = self.segs[ch]
        best = (1e9, 0.0)
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            ab = b - a
            t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-12)))
            d = (p - (a + ab * t)).length
            if d < best[0]:
                best = (d, (L[i] + t * (L[i + 1] - L[i])) / L[-1])
        return best

    def limb(self, co):
        p = V(co)
        best = None
        hip_z = V(self.J["thigh.L"][0]).z
        for ch in self.CHAINS:
            if ch.startswith("leg") and p.z > hip_z - 0.02:
                continue          # above the hip joints it is always the pelvis / belly
            d, t = self._proj(ch, p)
            w = d * (1.35 if ch == "torso" else 1.0)
            if best is None or w < best[2]:
                best = (ch, t, w)
        return best


def hem_lip(ob, thickness=0.006, depth=0.02, tag=True):
    """Cheap cloth thickness: every open border gets a rim band (turned inwards along -normal) and a short inner
    facing, instead of a full Solidify inner shell (half the triangles). Materials render double-sided."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.normal_update()
    bnd = [e for e in bm.edges if e.is_boundary]
    if not bnd:
        bm.free()
        return ob
    vn = {v: v.normal.copy() for e in bnd for v in e.verts}
    # inward direction along the surface for each border vertex = away from the border, tangent to the surface
    inward = {}
    for v in vn:
        acc = V((0, 0, 0))
        for e in v.link_edges:
            if not e.is_boundary:
                acc += e.other_vert(v).co - v.co
        inward[v] = (acc - vn[v] * acc.dot(vn[v])).normalized() if acc.length > 1e-9 else V((0, 0, 0))
    r1 = bmesh.ops.extrude_edge_only(bm, edges=bnd)
    new1 = [g for g in r1["geom"] if isinstance(g, bmesh.types.BMVert)]
    # map new verts to their source by position
    src_of = {}
    for nv in new1:
        best = min(vn.keys(), key=lambda v: (v.co - nv.co).length_squared)
        src_of[nv] = best
    for nv in new1:
        sv = src_of[nv]
        nv.co = sv.co - vn[sv] * thickness
    bnd2 = [e for e in bm.edges if e.is_boundary]
    r2 = bmesh.ops.extrude_edge_only(bm, edges=bnd2)
    new2 = [g for g in r2["geom"] if isinstance(g, bmesh.types.BMVert)]
    for nv in new2:
        best = min(new1, key=lambda v: (v.co - nv.co).length_squared)
        nv.co = best.co + inward[src_of[best]] * depth
    new_idx = [v.index for v in new1 + new2]
    bm.verts.index_update()
    new_idx = [v.index for v in new1 + new2]
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    if tag:   # rim + inner facing: ignored by the clothing QA (like the kit's Solidify shell)
        grp = ob.vertex_groups.get("kit_shell") or ob.vertex_groups.new(name="kit_shell")
        grp.add(new_idx, 1.0, "REPLACE")
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def paint_region(objs, R, pred, mat):
    """Assign `mat` to the faces of each object whose vertices all satisfy pred(R.limb(co), co)."""
    for ob in objs:
        if mat.name not in [s.material.name for s in ob.material_slots if s.material]:
            ob.data.materials.append(mat)
        idx = [i for i, s in enumerate(ob.material_slots) if s.material == mat][0]
        vs = ob.data.vertices
        cache = {}
        for p in ob.data.polygons:
            ok = True
            for vi in p.vertices:
                if vi not in cache:
                    co = vs[vi].co
                    cache[vi] = pred(R.limb(co), co)
                if not cache[vi]:
                    ok = False
                    break
            if ok:
                p.material_index = idx


def drape(ob, colliders, offset=0.012, factor=0.6, zmax=None, zmin=None, iters=2):
    """Pull vertices (z in [zmin, zmax]) towards the nearest collider surface (+offset) by `factor`: stiff lofted
    shapes (mantles, capes) settle onto the shoulders / back like cloth. Smoothed between iterations."""
    trees = [HB.bvh(c) for c in colliders]
    co = HB.get_co(ob)
    w = np.ones(len(co))
    if zmax is not None:
        w *= np.clip((zmax - co[:, 2]) / 0.05, 0, 1)
    if zmin is not None:
        w *= np.clip((co[:, 2] - zmin) / 0.05, 0, 1)
    for _ in range(iters):
        co = HB.get_co(ob)
        for i in range(len(co)):
            if w[i] <= 0:
                continue
            p = V(co[i])
            best = None
            for t in trees:
                q, n, fi, d = t.find_nearest(p, 0.4)
                if q is not None and (best is None or d < best[2]):
                    best = (q, n, d)
            if best is None:
                continue
            target = best[0] + best[1] * offset
            co[i] = p + (target - p) * factor * w[i]
        HB.set_co(ob, co)
        HB.laplacian(ob, 1, 0.4)
    return ob


def strip(rows, name, mat=None):
    """Open quad grid from rows of points (rows[i] = list of M points, same M): flaps, loincloths, tabards."""
    bm = bmesh.new()
    R = [[bm.verts.new(tuple(p)) for p in r] for r in rows]
    for i in range(len(R) - 1):
        for k in range(len(R[i]) - 1):
            bm.faces.new((R[i][k], R[i][k + 1], R[i + 1][k + 1], R[i + 1][k]))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    for p in ob.data.polygons:
        p.use_smooth = True
    if mat is not None:
        me.materials.append(mat)
    return ob


def flap(top_l, top_r, length, n_w=6, n_h=8, bulge=(0, -1, 0), bulge_amp=0.0, flare=1.15, sway=0.0, seed=0):
    """Rows for a hanging cloth flap from the segment top_l -> top_r, `length` down (slight flare, belly bulge
    along `bulge`, ragged zig-zag bottom handled by the tatter material)."""
    import random
    rnd = random.Random(seed)
    a, b = V(top_l), V(top_r)
    c = (a + b) / 2
    rows = []
    for i in range(n_h + 1):
        t = i / n_h
        w = 1.0 + (flare - 1.0) * t
        row = []
        for k in range(n_w + 1):
            u = k / n_w
            p = c + (a.lerp(b, u) - c) * w
            p = p - V((0, 0, length * t))
            p += V(bulge) * bulge_amp * math.sin(math.pi * u) * (0.3 + 0.7 * t)
            p += V(bulge) * sway * t * t
            row.append(p + V((0, 0, rnd.uniform(-0.002, 0.002) * t)))
        rows.append(row)
    return rows
