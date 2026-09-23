"""Clothing and armour builders for the v0.2 humanoids (A-pose bind frame, character faces -Y).

All garments are CONTINUOUS meshes (no loose triangles): shells cut from the low body with bisect planes (clean,
straight hems), revolved skirts/robes with folds, capes that clear the body's back, hoods, belts from body
cross-sections, plates with thickness. Thickness is added later with kit.gn.solidify (after weighting).

    tunic = region_shell(body, "Tunic", keep=lambda c, n: 0.9 < c.z < 1.5, cuts=[...], offset=0.012)
    robe = skirt("Robe", body, z_top=1.02, z_bot=0.06, flare=0.2, folds=9)
"""
import math
import random

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree


# =============================================================================== basics
def new_obj(name, verts, faces, mat=None, smooth=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    me.validate()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if mat is not None:
        me.materials.append(mat)
    for p in me.polygons:
        p.use_smooth = smooth
    return ob


def from_bm(bm, name, mat=None, smooth=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if mat is not None:
        me.materials.clear()
        me.materials.append(mat)
        for p in me.polygons:
            p.material_index = 0
    for p in me.polygons:
        p.use_smooth = smooth
    return ob


def bvh(obj):
    mw = obj.matrix_world
    co = [mw @ v.co for v in obj.data.vertices]
    return BVHTree.FromPolygons(co, [tuple(p.vertices) for p in obj.data.polygons])


def bvh_core(obj, max_x=0.34):
    """BVH of the body WITHOUT the arms (A-pose hands hang at |x| > 0.4): skirts and capes ray-cast against it."""
    mw = obj.matrix_world
    co = [mw @ v.co for v in obj.data.vertices]
    polys = [tuple(p.vertices) for p in obj.data.polygons if abs((mw @ p.center).x) < max_x]
    return BVHTree.FromPolygons(co, polys)


def recalc_normals(obj, inside=False):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if inside:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


def outward_normals(obj, center_fn):
    """Flip faces whose normal points towards center_fn(face_centre) (open shells: recalc is unreliable)."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.normal_update()
    flip = [f for f in bm.faces if f.normal.dot(f.calc_center_median() - Vector(center_fn(f.calc_center_median()))) < 0]
    if flip:
        bmesh.ops.reverse_faces(bm, faces=flip)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


def subdivide(obj, levels=1, simple=False):
    md = obj.modifiers.new("Sub", "SUBSURF")
    md.levels = md.render_levels = levels
    md.subdivision_type = "SIMPLE" if simple else "CATMULL_CLARK"
    md.boundary_smooth = "PRESERVE_CORNERS"
    _apply_all(obj)


def _apply_all(obj):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    for md in list(obj.modifiers):
        if md.type == "ARMATURE":
            continue
        bpy.ops.object.modifier_apply(modifier=md.name)


def smooth_verts(bm, verts, factor=0.5, iters=3, boundary=True):
    for _ in range(iters):
        bmesh.ops.smooth_vert(bm, verts=verts, factor=factor, use_axis_x=True, use_axis_y=True, use_axis_z=True)


# =============================================================================== body shells
def region_shell(body, name, keep, cuts=(), offset=0.012, offset_fn=None, smooth=2, mat=None, relax=0.5,
                 subdiv=0, min_island=20):
    """Garment cut from the body surface.
    keep(centre, normal) -> bool for body faces; cuts = [(point, normal, radius[, domain])] bisect planes (faces within
    `radius` of the point are cut; the side the normal points to is removed by a flood fill that stays on that side
    and inside `domain(centre)` (default: 3 x radius sphere)) -> straight hems.
    offset (metres) or offset_fn(co) -> metres along the vertex normal."""
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.transform(body.matrix_world)
    for cut in cuts:
        pt, nrm, rad = cut[:3]
        dom = cut[3] if len(cut) > 3 else (lambda c, pt=Vector(pt), r=rad: (c - pt).length < r * 3.0)
        pt, nrm = Vector(pt), Vector(nrm).normalized()
        near = [f for f in bm.faces if (f.calc_center_median() - pt).length < rad * 1.6]
        geom = list({e for f in near for e in f.edges}) + near + list({v for f in near for v in f.verts})
        res = bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-5, plane_co=pt, plane_no=nrm, clear_outer=False, clear_inner=False)
        barrier = {e for e in res["geom_cut"] if isinstance(e, bmesh.types.BMEdge)}
        bm.faces.ensure_lookup_table()
        # seeds: faces just beyond the cut; flood across every edge that is not on the cut -> the whole far side
        # of the limb goes (a sphere-limited kill left feet/hands attached to trousers and sleeves)
        seeds = [f for f in bm.faces if (f.calc_center_median() - pt).length < rad * 1.05
                 and (f.calc_center_median() - pt).dot(nrm) > 0]
        kill, stack = set(seeds), list(seeds)
        while stack:
            f = stack.pop()
            for e in f.edges:
                if e in barrier:
                    continue
                for g in e.link_faces:
                    gc = g.calc_center_median()
                    if g not in kill and (gc - pt).dot(nrm) > 0 and dom(gc):
                        kill.add(g)
                        stack.append(g)
        bmesh.ops.delete(bm, geom=list(kill), context="FACES")
    bm.normal_update()
    drop = [f for f in bm.faces if not keep(f.calc_center_median(), f.normal)]
    bmesh.ops.delete(bm, geom=drop, context="FACES")
    _drop_small_islands(bm, min_island)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.normal_update()
    if relax:
        inner = [v for v in bm.verts if not v.is_boundary]
        smooth_verts(bm, inner, relax, 2)
        bm.normal_update()
    nrm = {v: v.normal.copy() for v in bm.verts}
    for v in bm.verts:
        d = offset_fn(v.co) if offset_fn else offset
        v.co += nrm[v] * d
    if smooth:
        smooth_verts(bm, [v for v in bm.verts], 0.4, smooth)
    # Laplacian smoothing shrinks convex parts (thighs, shoulders): push every vertex back out so it stays at
    # least ~85 % of its offset above the body surface (otherwise the body pokes through at rest)
    tree = bvh(body)
    for v in bm.verts:
        d0 = (offset_fn(v.co) if offset_fn else offset) * 0.85
        if d0 <= 0:
            continue
        q, qn, _, _ = tree.find_nearest(v.co)
        if q is None:
            continue
        h = (v.co - q).dot(qn)
        if h < d0:
            v.co += qn * (d0 - h)
    ob = from_bm(bm, name, mat)
    bm.free()
    if subdiv:
        subdivide(ob, subdiv)
    return ob


def _drop_small_islands(bm, min_faces):
    bm.faces.ensure_lookup_table()
    seen = set()
    kill = []
    for f in bm.faces:
        if f in seen:
            continue
        stack, comp = [f], []
        seen.add(f)
        while stack:
            g = stack.pop()
            comp.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h not in seen:
                        seen.add(h)
                        stack.append(h)
        if len(comp) < min_faces:
            kill += comp
    if kill:
        bmesh.ops.delete(bm, geom=kill, context="FACES")


def near_segment(p, a, b):
    a, b, p = Vector(a), Vector(b), Vector(p)
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-12)))
    return (p - a.lerp(b, t)).length, t


# =============================================================================== cross-sections
def section(obj, pt, nrm, near=None, radius=0.35, n=32):
    """Closed loop where the plane (pt, nrm) cuts `obj` (optionally only near the point `near`), resampled to n
    points ordered around the plane normal. Returns [Vector]."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.transform(obj.matrix_world)
    pt, nrm = Vector(pt), Vector(nrm).normalized()
    c0 = Vector(near) if near is not None else pt
    res = bmesh.ops.bisect_plane(bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces), dist=1e-6,
                                 plane_co=pt, plane_no=nrm)
    pts = [v.co.copy() for v in res["geom_cut"] if isinstance(v, bmesh.types.BMVert) and (v.co - c0).length < radius]
    bm.free()
    if len(pts) < 3:
        return None
    c = sum(pts, Vector()) / len(pts)
    u = (pts[0] - c)
    u = (u - nrm * u.dot(nrm)).normalized()
    w = nrm.cross(u)
    angs = [(math.atan2((p - c).dot(w), (p - c).dot(u)), (p - c)) for p in pts]
    # polar resampling: max radius per angular bin (convex-ish outline, robust to inner cut points)
    out = []
    for i in range(n):
        a = -math.pi + 2 * math.pi * (i + 0.5) / n
        best = None
        for ang, d in angs:
            da = abs((ang - a + math.pi) % (2 * math.pi) - math.pi)
            if da < math.pi / n * 1.6:
                r = d.length
                if best is None or r > best:
                    best = r
        out.append((a, best))
    # fill gaps by interpolation
    rs = [r for _, r in out]
    for i in range(n):
        if rs[i] is None:
            j0 = next(k for k in range(1, n) if rs[(i - k) % n] is not None)
            j1 = next(k for k in range(1, n) if rs[(i + k) % n] is not None)
            rs[i] = (rs[(i - j0) % n] * j1 + rs[(i + j1) % n] * j0) / (j0 + j1)
    return [c + (u * math.cos(a) + w * math.sin(a)) * r for (a, _), r in zip(out, rs)], c, nrm


def band(name, loop, center, axis, height, offset=0.01, thickness=0.012, mat=None, bulge=0.0):
    """Closed band (belt, cuff, collar) around a section loop: `height` along axis, pushed out by `offset`,
    with real thickness (outer + inner wall + top/bottom caps) -> closed manifold."""
    axis = Vector(axis).normalized()
    n = len(loop)
    rings = []
    for k, (dz, dr) in enumerate(((-height / 2, 0.0), (-height / 2, thickness), (0.0, thickness + bulge),
                                  (height / 2, thickness), (height / 2, 0.0))):
        ring = []
        for p in loop:
            d = p - center
            d = d - axis * d.dot(axis)
            r = d.length
            ring.append(center + d.normalized() * (r + offset + dr) + axis * dz)
        rings.append(ring)
    verts = [v for r in rings for v in r]
    faces = []
    R = len(rings)
    for r in range(R):
        r2 = (r + 1) % R
        for i in range(n):
            j = (i + 1) % n
            faces.append((r * n + i, r * n + j, r2 * n + j, r2 * n + i))
    ob = new_obj(name, verts, faces, mat)
    recalc_normals(ob)
    return ob


# =============================================================================== skirts / robes / tabards
def skirt(name, body, z_top, z_bot, seg=48, rings=18, flare=0.18, folds=9, fold_amp=0.02, clearance=0.012,
          front_gap=None, panels=None, hem_jag=0.0, back_long=0.0, front_short=0.0, seed=0, mat=None,
          x_scale=1.0, y_scale=1.0, top_pad=0.0, center=None):
    """Revolved garment from z_top (hugging the body cross-section) down to z_bot (flared).
    front_gap: angle (deg) of an open front (coats); panels: [(a0, a1)] angular ranges to keep (tabards),
    angle 0 = front (-Y), 90 = left (+X). hem_jag: tattered hem amplitude (m)."""
    rnd = random.Random(seed)
    tree = bvh_core(body)
    cen = Vector(center) if center is not None else Vector((0, 0, 0))
    # body radius profile per angle at the top ring (so the waistband hugs the body)
    top_r = []
    for s in range(seg):
        a = 2 * math.pi * s / seg
        d = Vector((math.sin(a), -math.cos(a), 0.0))
        o = Vector((cen.x, cen.y, z_top)) + d * 0.6
        hit = tree.ray_cast(o, -d, 0.7)
        r = (0.6 - hit[3]) if hit[0] is not None else 0.15
        top_r.append(r + clearance + top_pad)
    jag = [rnd.uniform(-1, 1) for _ in range(seg)]
    phase = rnd.uniform(0, 6.28)
    verts = []
    for r in range(rings + 1):
        t = r / rings
        z = z_top + (z_bot - z_top) * t
        for s in range(seg):
            a = 2 * math.pi * s / seg
            ca = math.cos(a)
            # hem length varies: longer at the back, shorter at the front
            zz = z
            if t > 0:
                dz = (z_bot - z_top)
                lenf = 1.0 + back_long * max(0.0, -ca) - front_short * max(0.0, ca)
                zz = z_top + dz * t * lenf + hem_jag * jag[s] * t ** 3
            # radius: body hug at the top, flare below, folds growing towards the hem
            rr = top_r[s] + flare * t ** 1.25
            # keep clear of the legs/body below the top ring
            d = Vector((math.sin(a), -math.cos(a), 0.0))
            if 0 < t:
                o = Vector((cen.x, cen.y, zz)) + d * 0.7
                hit = tree.ray_cast(o, -d, 0.8)
                if hit[0] is not None:
                    rr = max(rr, (0.7 - hit[3]) + clearance + 0.004 * t)
            fold = fold_amp * t ** 0.8 * (math.sin(folds * a + phase + 1.7 * t) * 0.7 + 0.3 * math.sin(2.3 * folds * a + phase))
            rr += fold
            verts.append(Vector((cen.x + math.sin(a) * rr * x_scale, cen.y - math.cos(a) * rr * y_scale, zz)))
    faces = []
    for r in range(rings):
        for s in range(seg):
            s2 = (s + 1) % seg
            faces.append((r * seg + s, r * seg + s2, (r + 1) * seg + s2, (r + 1) * seg + s))
    ob = new_obj(name, verts, faces, mat)
    # remove the open-front / non-panel faces
    if front_gap or panels:
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        kill = []
        for f in bm.faces:
            c = f.calc_center_median() - cen
            ang = math.degrees(math.atan2(c.x, -c.y))       # 0 = front, +90 = left
            if front_gap and abs(ang) < front_gap / 2:
                kill.append(f)
            if panels and not any(_ang_in(ang, a0, a1) for a0, a1 in panels):
                kill.append(f)
        bmesh.ops.delete(bm, geom=list(set(kill)), context="FACES")
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
        bm.to_mesh(ob.data)
        bm.free()
    outward_normals(ob, lambda p: (cen.x, cen.y, p.z))
    return ob


def _ang_in(a, a0, a1):
    a = (a - a0) % 360.0
    return a <= (a1 - a0) % 360.0


# =============================================================================== cape
def cape(name, body, J, length=1.05, width=0.24, seg=22, rows=20, clearance=0.05, flare=0.14, folds=5,
         fold_amp=0.025, hem_jag=0.0, seed=0, mat=None, collar=0.0, top_z=None, wrap=0.55):
    """Cape hanging from the shoulders behind the body. Stays at least `clearance` behind the body's back
    at every height (ray-cast against the body)."""
    rnd = random.Random(seed)
    tree = bvh_core(body)
    neck = Vector(J["neck"][0])
    shL = Vector(J["upper_arm.L"][0])
    z0 = top_z if top_z is not None else shL.z + 0.03
    jag = [rnd.uniform(-1, 1) for _ in range(seg + 1)]
    ph = rnd.uniform(0, 6.3)
    verts = []
    for r in range(rows + 1):
        t = r / rows
        z = z0 - length * t
        for s in range(seg + 1):
            u = s / seg * 2 - 1                       # -1 right .. +1 left
            ang = u * math.pi * wrap                  # around the neck: 0 = back
            half = width + flare * t
            x = math.sin(ang) * (0.09 + (half - 0.09) * min(1.0, t * 3 + 0.35))
            x = x if t > 0 else math.sin(ang) * 0.16
            # back distance: follow the body back + clearance
            y_body = 0.0
            o = Vector((x, 0.8, z))
            hit = tree.ray_cast(o, Vector((0, -1, 0)), 1.6)
            if hit[0] is not None:
                y_body = hit[0].y
            else:
                y_body = neck.y + 0.08
            base_y = y_body + clearance * min(1.0, 0.35 + t * 2)
            if t == 0:
                base_y = y_body + 0.02
            wrap_y = -math.cos(ang) * 0.0
            fold = fold_amp * t * (math.sin(folds * math.pi * u + ph + 2 * t) * 0.7 + 0.3 * math.sin(2.7 * folds * u + ph))
            zz = z + (hem_jag * jag[s] * t ** 4 if r == rows or t > 0.8 else 0.0)
            verts.append(Vector((x, base_y + wrap_y + abs(fold) + 0.0 * u, zz)))
    faces = []
    W = seg + 1
    for r in range(rows):
        for s in range(seg):
            faces.append((r * W + s, r * W + s + 1, (r + 1) * W + s + 1, (r + 1) * W + s))
    ob = new_obj(name, verts, faces, mat)
    outward_normals(ob, lambda p: (0, p.y - 1.0, p.z))       # normals face +Y (away from the body)
    return ob


# =============================================================================== hood
def hood(name, J, face_open=(0.075, 0.11), size=1.0, peak=0.06, cowl_z=None, cowl_r=0.2, seg=36, rings=22,
         mat=None, head_c=None, k=1.0):
    """Hood: a shell around the head with an oval face opening and a pointed back, continued by a cowl that
    drapes over the shoulders."""
    import anatomy as A
    c, k0 = A.head_frame(J)
    if head_c is not None:
        c = Vector(head_c)
    neck = Vector(J["neck"][0])
    cz = cowl_z if cowl_z is not None else neck.z - 0.035
    verts, idx = [], {}
    R0 = 0.128 * size * k0
    for r in range(rings + 1):
        t = r / rings
        for s in range(seg):
            a = 2 * math.pi * s / seg                  # 0 = front
            d = Vector((math.sin(a), -math.cos(a), 0.0))
            if t <= 0.62:     # head part: polar angle 0..~112 deg
                th = t / 0.62 * math.radians(112)
                rr = R0 * (1.0 + 0.06 * math.cos(a))
                p = c + Vector((0, 0.012 * k0, 0.012 * k0)) + (d * math.sin(th) * rr * 1.02 + Vector((0, 0, math.cos(th) * rr * 1.04)))
                # pointed back/top (the hood peak)
                back = max(0.0, -math.cos(a)) * math.sin(th) ** 2 * max(0.0, math.cos(th - 0.9))
                p += Vector((0, 1, 0.55)).normalized() * peak * back ** 2 * k0
            else:             # cowl: from under the jaw down to the shoulders
                u = (t - 0.62) / 0.38
                th = math.radians(112)
                rr = R0 * (1.0 + 0.06 * math.cos(a))
                p0 = c + Vector((0, 0.012 * k0, 0.012 * k0)) + d * math.sin(th) * rr * 1.02 + Vector((0, 0, math.cos(th) * rr * 1.04))
                rc = cowl_r * k0 * (1.0 + 0.15 * math.cos(a)) * (1.0 + 0.1 * math.sin(3 * a))
                p1 = Vector((neck.x, neck.y + 0.01, cz)) + d * rc
                p = p0.lerp(p1, u ** 0.9)
                p.z -= math.sin(u * math.pi) * 0.015
            verts.append(p)
    faces = []
    for r in range(rings):
        for s in range(seg):
            s2 = (s + 1) % seg
            faces.append((r * seg + s, r * seg + s2, (r + 1) * seg + s2, (r + 1) * seg + s))
    # cap the crown
    top = len(verts)
    verts.append(c + Vector((0, 0.012 * k0, 0.012 * k0 + R0 * 1.04)))
    for s in range(seg):
        faces.append((top, (s + 1) % seg, s))
    ob = new_obj(name, verts, faces, mat)
    # face opening (ellipse in front)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    ow, oh = face_open[0] * k0, face_open[1] * k0
    kill = []
    for f in bm.faces:
        q = f.calc_center_median() - c
        if q.y < -0.02 * k0 and (q.x / ow) ** 2 + ((q.z + 0.012 * k0) / oh) ** 2 < 1.0:
            kill.append(f)
    bmesh.ops.delete(bm, geom=kill, context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    # snap the opening's border onto the ellipse (per-face deletion leaves a jagged, pixel-like edge)
    for v in bm.verts:
        if not v.is_boundary:
            continue
        q = v.co - c
        zz = q.z + 0.012 * k0
        r = math.sqrt((q.x / ow) ** 2 + (zz / oh) ** 2)
        if q.y < 0.0 and r < 1.8 and r > 1e-6:
            v.co.x = c.x + q.x / r
            v.co.z = c.z - 0.012 * k0 + zz / r
    for _ in range(2):
        bmesh.ops.smooth_vert(bm, verts=[v for v in bm.verts if v.is_boundary and (v.co - c).y < 0 and v.co.z > c.z - 0.2 * k0],
                              factor=0.3, use_axis_y=True)
    bm.to_mesh(ob.data)
    bm.free()
    recalc_normals(ob)
    outward_normals(ob, lambda p: (c.x, c.y, min(p.z, c.z)))
    return ob


# =============================================================================== plates
def plate(obj, thickness=0.005, bevel=0.0015):
    """Give a plate shell real thickness (solidify with rims) + a small bevel on its rims."""
    md = obj.modifiers.new("Th", "SOLIDIFY")
    md.thickness = thickness
    md.offset = -1.0
    md.use_even_offset = True
    md.use_rim = True
    if bevel:
        bv = obj.modifiers.new("Bv", "BEVEL")
        bv.width = bevel
        bv.segments = 1
        bv.limit_method = "ANGLE"
        bv.angle_limit = math.radians(50)
    _apply_all(obj)
    return obj


def boundary_loops(obj):
    """Ordered boundary loops of a mesh: [[Vector, ...], ...] (world space)."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.transform(obj.matrix_world)
    edges = [e for e in bm.edges if e.is_boundary]
    used = set()
    loops = []
    for e0 in edges:
        if e0 in used:
            continue
        loop = [e0.verts[0], e0.verts[1]]
        used.add(e0)
        while True:
            v = loop[-1]
            nxt = [e for e in v.link_edges if e.is_boundary and e not in used]
            if not nxt:
                break
            e = nxt[0]
            used.add(e)
            w = e.other_vert(v)
            if w == loop[0]:
                break
            loop.append(w)
        loops.append([v.co.copy() for v in loop])
    bm.free()
    return loops


def hem_attribute(obj, name="hem", max_d=0.2):
    """Point attribute = geodesic-ish distance (m) to the nearest open border (0 at the hem), for trims in shaders."""
    me = obj.data
    n = len(me.vertices)
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    dist = np.full(n, max_d)
    front = []
    for v in bm.verts:
        if v.is_boundary:
            dist[v.index] = 0.0
            front.append(v.index)
    import heapq
    h = [(0.0, i) for i in front]
    while h:
        d, i = heapq.heappop(h)
        if d > dist[i]:
            continue
        v = bm.verts[i]
        for e in v.link_edges:
            w = e.other_vert(v)
            nd = d + e.calc_length()
            if nd < dist[w.index]:
                dist[w.index] = nd
                heapq.heappush(h, (nd, w.index))
    bm.free()
    at = me.attributes.get(name) or me.attributes.new(name, "FLOAT", "POINT")
    at.data.foreach_set("value", np.clip(dist / max_d, 0, 1).astype(np.float32))
    return dist
