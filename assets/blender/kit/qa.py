"""Automated QA checks. Every check prints "QA FAIL ..." / "QA WARN ..." lines and fills a report dict.

    rep = qa.run("rock_a", objs, budget="prop", expected=(1.8, 1.6, 1.2), glb=info)       # static model
    rep = qa.run("mage", [body, robe], budget="hero", skin=dict(body=body, cloths=[robe], armature=rig))
    qa.save(rep, previews_dir)            # <key>_qa.json
    qa.assert_clean(rep)                  # raise if any FAIL (use in build scripts once the model is final)

Checks: floating triangles / tiny loose parts, non-manifold edges, inconsistent winding & inverted shells
(signed volume + outward-ray heuristic), degenerate faces, duplicate / coplanar overlapping faces (z-fighting),
texture SEAMS across UV islands (check_seams: baseColor/AO/roughness/metal/object-space normal compared on both
sides of every UV seam vs same-island edges), triangle budget, texture sizes, GLB size, bbox vs expected size,
origin at base centre; skinned: body vertices
covered by clothing in the rest pose must stay covered in every sampled frame of every clip, feet not below ground.

Helper for clothing: delete_covered_body(body, cloths) deletes/shrinks the body under the clothes (do it!).
"""
import json
import math
import os

import bmesh
import bpy
import mathutils
import numpy as np
from mathutils.bvhtree import BVHTree

from . import export


class Report(dict):
    def __init__(self, key):
        super().__init__(key=key, fails=[], warns=[], info={})

    def fail(self, msg):
        self["fails"].append(msg)
        print(f"QA FAIL [{self['key']}] {msg}", flush=True)

    def warn(self, msg):
        self["warns"].append(msg)
        print(f"QA WARN [{self['key']}] {msg}", flush=True)

    @property
    def ok(self):
        return not self["fails"]


# =============================================================================== mesh helpers
def world_mesh(obj, dg=None, disable=(), skip_shell=False):
    """(verts Nx3 world, normals Nx3 world, polys list[list[int]]) of the evaluated object.
    `disable`: modifier types to switch off temporarily (e.g. ('SOLIDIFY',))."""
    toggled = []
    for md in obj.modifiers:
        if md.type in disable and md.show_viewport:
            md.show_viewport = False
            toggled.append(md)
    if toggled:
        bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    me = ev.to_mesh()
    n = len(me.vertices)
    co = np.empty(n * 3, dtype=np.float64)
    me.vertices.foreach_get("co", co)
    nr = np.empty(n * 3, dtype=np.float64)
    try:
        me.vertex_normals.foreach_get("vector", nr)
    except AttributeError:
        me.vertices.foreach_get("normal", nr)
    polys = [list(p.vertices) for p in me.polygons]
    gi = obj.vertex_groups.find("kit_shell")
    if skip_shell and gi >= 0:
        shell = set(v.index for v in me.vertices if any(g.group == gi and g.weight > 0.5 for g in v.groups))
        if shell:
            polys = [p for p in polys if not any(i in shell for i in p)]
    ev.to_mesh_clear()
    mw = np.array(obj.matrix_world, dtype=np.float64)
    co = co.reshape(-1, 3) @ mw[:3, :3].T + mw[:3, 3]
    nm = np.linalg.inv(mw[:3, :3]).T
    nr = nr.reshape(-1, 3) @ nm.T
    nr /= np.maximum(np.linalg.norm(nr, axis=1, keepdims=True), 1e-12)
    for md in toggled:
        md.show_viewport = True
    if toggled:
        bpy.context.view_layer.update()
    return co, nr, polys


def _bm_world(obj):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    bm = bmesh.new()
    bm.from_object(obj, dg)
    bm.transform(obj.matrix_world)
    bm.normal_update()
    return bm


def _islands(bm):
    """Connected parts. Vertices are welded by POSITION (0.01 mm) so a mesh split at UV seams / hard edges (every
    imported glTF) is not mistaken for many loose parts."""
    bm.faces.ensure_lookup_table()
    bm.verts.ensure_lookup_table()
    pos = {}
    for v in bm.verts:
        pos.setdefault((round(v.co.x, 5), round(v.co.y, 5), round(v.co.z, 5)), []).append(v)
    twins = {v: grp for grp in pos.values() for v in grp}
    island = [-1] * len(bm.faces)
    k = 0
    for f in bm.faces:
        if island[f.index] >= 0:
            continue
        stack = [f]
        island[f.index] = k
        while stack:
            g = stack.pop()
            for v in g.verts:
                for h in (h for w in twins[v] for h in w.link_faces):
                    if island[h.index] < 0:
                        island[h.index] = k
                        stack.append(h)
        k += 1
    return island, k


# =============================================================================== geometry checks
def check_geometry(rep, obj, open_ok=None, min_island_faces=3, sample=4000):
    """Topology checks on one mesh object (evaluated, world space)."""
    if open_ok is None:
        open_ok = bool(obj.get("kit_open")) or any((s.material and s.material.get("kit_alpha")) for s in obj.material_slots)
    bm = _bm_world(obj)
    nm = obj.name
    info = rep["info"].setdefault("objects", {}).setdefault(nm, {})
    info["faces"] = len(bm.faces)
    if not bm.faces:
        rep.warn(f"{nm}: no faces")
        bm.free()
        return
    island, nisl = _islands(bm)
    sizes = np.bincount(np.array(island), minlength=nisl)
    info["islands"] = int(nisl)
    # alpha cards (leaves, grass, fur, hair) are legitimately single-quad islands
    alpha_slots = {i for i, sl in enumerate(obj.material_slots) if sl.material and sl.material.get("kit_alpha")}
    card_isl = np.zeros(nisl, dtype=bool)
    for f in bm.faces:
        if f.material_index in alpha_slots:
            card_isl[island[f.index]] = True
    tiny = [i for i in range(nisl) if sizes[i] < min_island_faces and not card_isl[i]]
    if tiny:
        rep.fail(f"{nm}: {len(tiny)} floating part(s) with < {min_island_faces} faces (loose triangles)")
    # area per island
    areas = np.zeros(nisl)
    for f in bm.faces:
        areas[island[f.index]] += f.calc_area()
    total = areas.sum()
    small = [i for i in range(nisl) if areas[i] < total * 1e-4 and sizes[i] >= min_island_faces]
    if small:
        rep.warn(f"{nm}: {len(small)} tiny loose part(s) (< 0.01% of the area)")
    # degenerate
    degen = sum(1 for f in bm.faces if f.calc_area() < 1e-10)
    if degen:
        rep.fail(f"{nm}: {degen} degenerate (zero-area) faces")
    # non-manifold
    boundary = sum(1 for e in bm.edges if len(e.link_faces) == 1)
    multi = sum(1 for e in bm.edges if len(e.link_faces) > 2)
    wire = sum(1 for e in bm.edges if len(e.link_faces) == 0)
    info.update(boundary_edges=boundary, nonmanifold_edges=multi)
    if multi:
        rep.fail(f"{nm}: {multi} non-manifold edges (shared by > 2 faces)")
    if wire:
        rep.fail(f"{nm}: {wire} loose edges without faces")
    if boundary and not open_ok:
        rep.warn(f"{nm}: {boundary} boundary edges (holes / open borders) - fine only if hidden")
    # winding consistency
    flipped_edges = sum(1 for e in bm.edges if len(e.link_faces) == 2 and not e.is_contiguous)
    if flipped_edges:
        rep.fail(f"{nm}: {flipped_edges} edges between faces with inconsistent winding (flipped normals)")
    # inverted shells
    closed = np.ones(nisl, dtype=bool)
    for e in bm.edges:
        if len(e.link_faces) == 1:
            closed[island[e.link_faces[0].index]] = False
    vol = np.zeros(nisl)
    for f in bm.faces:
        c = f.calc_center_median()
        vol[island[f.index]] += c.dot(f.normal) * f.calc_area() / 3.0
    inv_closed = [i for i in range(nisl) if closed[i] and vol[i] < -1e-9]
    if inv_closed:
        rep.fail(f"{nm}: {len(inv_closed)} closed shell(s) with inverted normals (negative volume)")
    # outward-ray heuristic for open shells
    open_ids = [i for i in range(nisl) if not closed[i] and sizes[i] >= 8]
    bad_open = 0
    faces_by = {}
    for f in bm.faces:
        if island[f.index] in open_ids:
            faces_by.setdefault(island[f.index], []).append(f)
    for i, fl in faces_by.items():
        verts = [v.co.copy() for v in bm.verts]
        tree = BVHTree.FromPolygons(verts, [[v.index for v in f.verts] for f in fl])
        step = max(1, len(fl) // 300)
        inward = hits = 0
        for f in fl[::step]:
            c = f.calc_center_median()
            n = f.normal
            loc, hn, idx, d = tree.ray_cast(c + n * 1e-4, n, 10.0)
            if loc is not None:
                hits += 1
                if hn.dot(n) > 0.2:
                    inward += 1
        if hits > 10 and inward > 0.6 * hits and inward > 0.3 * len(fl[::step]):
            bad_open += 1
            c = sum((f.calc_center_median() for f in fl), mathutils.Vector()) / len(fl)
            info.setdefault("inward_open_shells", []).append({"faces": len(fl), "centre": [round(x, 2) for x in c],
                                                              "inward_hits": inward, "hits": hits})
    if bad_open:
        rep.fail(f"{nm}: {bad_open} open shell(s) whose normals seem to point inward {info['inward_open_shells']}")
    # duplicate / z-fighting faces
    keys = {}
    dup = 0
    for f in bm.faces:
        k = tuple(sorted(tuple(round(x, 4) for x in v.co) for v in f.verts))
        if k in keys:
            dup += 1
        else:
            keys[k] = f.index
    if dup:
        rep.fail(f"{nm}: {dup} duplicate faces (z-fighting)")
    verts = [v.co.copy() for v in bm.verts]
    tree = BVHTree.FromBMesh(bm)
    step = max(1, len(bm.faces) // sample)
    zf = 0
    for f in list(bm.faces)[::step]:
        c = f.calc_center_median()
        for (loc, hn, idx, d) in tree.find_nearest_range(c, 2e-4):
            if idx != f.index and island[idx] != island[f.index] and abs(hn.dot(f.normal)) > 0.995:
                zf += 1
                break
    if zf:
        rep.warn(f"{nm}: ~{zf * step} faces coplanar with another shell (possible z-fighting)")
    bm.free()


# =============================================================================== texture seams
def _final_images(mat):
    """{'base','normal','orm'} images of a baked (glTF-friendly) material, found by what they feed."""
    out = {}
    if mat is None or not mat.node_tree:
        return out
    for n in mat.node_tree.nodes:
        if n.bl_idname != "ShaderNodeTexImage" or n.image is None:
            continue
        for l in n.outputs["Color"].links:
            t = l.to_node
            if t.bl_idname == "ShaderNodeBsdfPrincipled" and l.to_socket.name == "Base Color":
                out["base"] = n.image
            elif t.bl_idname == "ShaderNodeNormalMap":
                out["normal"] = n.image
            elif t.bl_idname in ("ShaderNodeSeparateColor", "ShaderNodeSeparateRGB"):
                out["orm"] = n.image
    return out


def _px(img):
    key = img.name
    cache = _px.cache
    if key not in cache or cache[key][0] != tuple(img.size):
        a = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
        img.pixels.foreach_get(a)
        cache[key] = (tuple(img.size), a.reshape(img.size[1], img.size[0], 4))
    return cache[key][1]


_px.cache = {}


def _sample(arr, uv):
    """Bilinear sample of an HxWx4 array at N x 2 UVs (repeat wrapping)."""
    h, w = arr.shape[:2]
    x = (uv[:, 0] % 1.0) * w - 0.5
    y = (uv[:, 1] % 1.0) * h - 0.5
    x0 = np.floor(x).astype(np.int64)
    y0 = np.floor(y).astype(np.int64)
    fx = (x - x0)[:, None]
    fy = (y - y0)[:, None]
    x0 %= w
    y0 %= h
    x1 = (x0 + 1) % w
    y1 = (y0 + 1) % h
    return (arr[y0, x0] * (1 - fx) * (1 - fy) + arr[y0, x1] * fx * (1 - fy)
            + arr[y1, x0] * (1 - fx) * fy + arr[y1, x1] * fx * fy)


def check_seams(rep, obj, inset_px=1.5, samples_per_edge=3, fail_ratio=2.5):
    """Texture-seam test: along every UV seam edge (two faces, different UVs) sample baseColor / ORM / normal map
    just inside each face and compare both sides. The baked normal map is decoded to OBJECT space with each side's
    own tangent frame, so a tangent-space mismatch shows up as an angle. Reference = the same measure across
    NON-seam edges (natural texture variation). FAIL when seams are clearly worse than the texture itself."""
    me = obj.data
    if not me.uv_layers or not me.polygons:
        return
    uvl = me.uv_layers.active or me.uv_layers[0]
    uv_name = uvl.name
    nl = len(me.loops)
    uv = np.empty(nl * 2, dtype=np.float64)
    uvl.data.foreach_get("uv", uv)          # read BEFORE calc_tangents (it invalidates layer pointers)
    uv = uv.reshape(-1, 2)
    try:
        me.calc_tangents(uvmap=uv_name)
        have_t = True
    except RuntimeError:
        have_t = False
    loops = me.loops
    lnorm = np.empty(nl * 3)
    loops.foreach_get("normal", lnorm)
    lnorm = lnorm.reshape(-1, 3)
    if have_t:
        ltan = np.empty(nl * 3)
        loops.foreach_get("tangent", ltan)
        ltan = ltan.reshape(-1, 3)
        lsign = np.empty(nl)
        loops.foreach_get("bitangent_sign", lsign)
    # per-material images
    imgs = {i: _final_images(s.material) for i, s in enumerate(obj.material_slots)}
    skip = {i for i, s in enumerate(obj.material_slots)
            if s.material is None or s.material.get("kit_alpha") or not imgs[i].get("base")}
    if len(skip) == len(imgs):
        return
    # edge -> [(poly, loop_a, loop_b)] where loop_a/b are this poly's loops on the edge's two verts
    # vertices are welded by POSITION so seams already split into separate vertices (glTF import) still pair up
    vco = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", vco)
    _, pid = np.unique(np.round(vco.reshape(-1, 3), 5), axis=0, return_inverse=True)
    pid = pid.ravel()
    edge_faces = {}
    for p in me.polygons:
        if p.material_index in skip or p.material_index not in imgs:
            continue
        li = list(p.loop_indices)
        vs = [int(pid[loops[i].vertex_index]) for i in li]
        n = len(li)
        for k in range(n):
            a, b = vs[k], vs[(k + 1) % n]
            key = (a, b) if a < b else (b, a)
            la, lb = (li[k], li[(k + 1) % n]) if a < b else (li[(k + 1) % n], li[k])
            edge_faces.setdefault(key, []).append((p, la, lb))
    seam_rows, ref_rows, seam_mid = [], [], []
    seam_pairs, joins = [], []
    ts = (np.arange(samples_per_edge) + 1) / (samples_per_edge + 1)
    for key, fl in edge_faces.items():
        if len(fl) != 2:
            continue
        (p1, a1, b1), (p2, a2, b2) = fl
        if p1.material_index != p2.material_index:
            continue
        seam = (np.abs(uv[a1] - uv[a2]).max() > 1e-5) or (np.abs(uv[b1] - uv[b2]).max() > 1e-5)
        im = imgs[p1.material_index]
        base = _px(im["base"])
        size = np.array(base.shape[1::-1], dtype=np.float64)
        sides = []
        for p, la, lb in ((p1, a1, b1), (p2, a2, b2)):
            cuv = uv[list(p.loop_indices)].mean(axis=0)
            e_uv = uv[la][None] * (1 - ts[:, None]) + uv[lb][None] * ts[:, None]
            d = cuv[None] - e_uv
            dl = np.linalg.norm(d * size[None], axis=1, keepdims=True)
            dirn = d / np.maximum(dl, 1e-9)
            # sample at 1x and 2x the inset and extrapolate linearly back to the edge: both sides then describe
            # the SAME surface point, so real gradients (AO in a concave crease...) do not count as seams
            if dl.min() < 2.5:            # sliver face (< ~5 texels across): texel sampling is meaningless
                sides = None
                break
            i1 = np.minimum(inset_px, dl * 0.25)
            uv1, uv2 = e_uv + dirn * i1, e_uv + dirn * (2 * i1)

            def ex(img, uv1=uv1, uv2=uv2):
                a = _px(img)
                return (2 * _sample(a, uv1) - _sample(a, uv2))[:, :3]
            row = {"col": ex(im["base"])}
            if "orm" in im:
                row["orm"] = ex(im["orm"])
            if "normal" in im and have_t:
                tn = ex(im["normal"]) * 2 - 1
                w = ts[:, None]
                N = lnorm[la] * (1 - w) + lnorm[lb] * w
                T = ltan[la] * (1 - w) + ltan[lb] * w
                B = np.cross(N, T) * lsign[la]
                on = T * tn[:, :1] + B * tn[:, 1:2] + N * tn[:, 2:3]
                row["n"] = on / np.maximum(np.linalg.norm(on, axis=1, keepdims=True), 1e-9)
            sides.append(row)
        if sides is None:
            continue
        dcol = np.abs(sides[0]["col"] - sides[1]["col"]).mean(axis=1)
        dorm = np.abs(sides[0]["orm"] - sides[1]["orm"]) if "orm" in sides[0] else np.zeros((len(dcol), 3))
        if "n" in sides[0]:
            dn = np.degrees(np.arccos(np.clip((sides[0]["n"] * sides[1]["n"]).sum(axis=1), -1, 1)))
        else:
            dn = np.zeros_like(dcol)
        # hard (split-normal) edges: the shading normal jumps, so AO and the normal map may jump too -> not a seam
        hard = (np.dot(lnorm[a1], lnorm[a2]) < 0.996) or (np.dot(lnorm[b1], lnorm[b2]) < 0.996)
        # curved edge (rim of a moss clump, lip of a cut, contact line): AO legitimately changes there
        crease = hard or (p1.normal.dot(p2.normal) < 0.9)
        if "orm" in sides[0]:          # contact / buried areas (AO < 0.5 on a side) are dark anyway: not a seam
            crease = crease or min(sides[0]["orm"][:, 0].min(), sides[1]["orm"][:, 0].min()) < 0.5
        if crease:
            dorm = dorm.copy()
            dorm[:, 0] = np.nan
        if hard:
            dorm = dorm.copy()
            dorm[:, 0] = np.nan
            dn = np.full_like(dn, np.nan)
        (seam_rows if seam else ref_rows).append(np.column_stack([dcol, dorm, dn]))
        if seam:
            seam_mid.append(p1.index)
            lum = np.array([0.2126, 0.7152, 0.0722])
            sl = float(((sides[0]["col"] - sides[1]["col"]) @ lum).mean())
            sa = float((sides[0]["orm"][:, 0] - sides[1]["orm"][:, 0]).mean()) if "orm" in sides[0] and not crease else np.nan
            dv = (sides[0]["n"] - sides[1]["n"]).mean(axis=0) if ("n" in sides[0] and not hard) else np.full(3, np.nan)
            seam_pairs.append((p1.index, p2.index, sl, sa, dv))
        else:
            joins.append((p1.index, p2.index))
    if have_t:
        me.free_tangents()
    if not seam_rows:
        return
    S = np.concatenate(seam_rows)
    R = np.concatenate(ref_rows) if ref_rows else np.zeros((1, 5))
    names = ("baseColor", "AO", "roughness", "metallic", "normal(deg)")
    info = rep["info"].setdefault("seams", {}).setdefault(obj.name, {"seam_edges": len(seam_rows)})
    # where are the worst seams (world positions of the faces) -> look there in the sheets
    per_edge = np.array([np.nan_to_num(r[:, 4]).max() + 100 * r[:, 0].max() + 30 * np.nan_to_num(r[:, 1]).max()
                         for r in seam_rows])
    mw = obj.matrix_world
    info["worst_at"] = [[round(x, 2) for x in (mw @ me.polygons[seam_mid[i]].center)]
                        for i in np.argsort(-per_edge)[:6]]
    _island_offsets(rep, obj, info, joins, seam_pairs)
    # thresholds per channel: (systematic p50 abs, visible p95 abs)
    lim = {"baseColor": (0.03, 0.12), "AO": (0.06, 0.35), "roughness": (0.05, 0.2), "metallic": (0.1, 0.4),
           "normal(deg)": (6.0, 25.0)}
    for k, nm in enumerate(names):
        if np.all(np.isnan(S[:, k])):
            continue
        s50, s95 = float(np.nanpercentile(S[:, k], 50)), float(np.nanpercentile(S[:, k], 95))
        if np.all(np.isnan(R[:, k])):
            r50 = r95 = 0.0
        else:
            r50, r95 = float(np.nanpercentile(R[:, k], 50)), float(np.nanpercentile(R[:, k], 95))
        info[nm] = {"seam_p50": round(s50, 4), "seam_p95": round(s95, 4), "ref_p50": round(r50, 4),
                    "ref_p95": round(r95, 4)}
        a50, a95 = lim[nm]
        eps = 0.5 if k == 4 else 0.004
        systematic = s50 > fail_ratio * max(r50, eps) and s50 > a50      # most seams differ: a bake bug
        visible = s95 > fail_ratio * max(r95, eps) and s95 > a95         # some seams clearly visible
        warn = s95 > 1.6 * max(r95, eps) and s95 > a95 * 0.5
        msg = (f"{obj.name}: {nm} texture SEAM across UV islands p50={s50:.3f} p95={s95:.3f} "
               f"(same-island edges p50={r50:.3f} p95={r95:.3f}); worst near {info['worst_at'][:3]}")
        if systematic or visible:
            rep.fail(msg)
        elif warn:
            rep.warn(msg)


def _island_offsets(rep, obj, info, joins, seam_pairs, min_edges=6, lum_lim=0.035, ao_lim=0.08, n_lim=10.0):
    """Island-level seam test: 'one face much lighter than its neighbour'. For every pair of UV islands sharing
    at least `min_edges` seam edges, average the SIGNED difference along the whole shared border. Natural texture
    noise averages out; a bake/lighting offset between two islands does not."""
    parent = {}

    def find(a):
        while parent.get(a, a) != a:
            parent[a] = parent.get(parent[a], parent[a])
            a = parent[a]
        return a
    for a, b in joins:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb
    # loose parts (all edges, seams included): AO across a split of a SMALL closed part (moss clump, pebble,
    # rivet: top/bottom halves) changes for real at its rim -> AO is not judged there
    part = {}

    def pfind(a):
        while part.get(a, a) != a:
            part[a] = part.get(part[a], part[a])
            a = part[a]
        return a
    for a, b in list(joins) + [(x[0], x[1]) for x in seam_pairs]:
        ra, rb = pfind(a), pfind(b)
        if ra != rb:
            part[ra] = rb
    psize = {}
    for f in range(len(obj.data.polygons)):
        r = pfind(f)
        psize[r] = psize.get(r, 0) + 1
    small = max(64, 0.03 * len(obj.data.polygons))
    pairs = {}
    for a, b, sl, sa, dn in seam_pairs:
        if psize[pfind(a)] < small:
            sa = np.nan
        ia, ib = find(a), find(b)
        if ia == ib:
            continue
        sign = 1.0 if ia < ib else -1.0
        k = (min(ia, ib), max(ia, ib))
        pairs.setdefault(k, []).append((sign * sl, sign * sa if sa == sa else np.nan, *(sign * dn)))
    worst = []
    mw = obj.matrix_world
    for k, rows in pairs.items():
        if len(rows) < min_edges:
            continue
        r = np.array(rows, dtype=np.float64)
        dl = abs(float(np.nanmean(r[:, 0])))
        da = abs(float(np.nanmean(r[:, 1]))) if not np.all(np.isnan(r[:, 1])) else 0.0
        # normals: mean of the SIGNED object-space difference vector (a tangent-frame mismatch is systematic,
        # relief noise averages out) -> angle
        dvec = np.nanmean(r[:, 2:5], axis=0) if not np.all(np.isnan(r[:, 2])) else np.zeros(3)
        dn = float(np.degrees(2 * np.arcsin(min(1.0, np.linalg.norm(dvec) / 2))))
        score = max(dl / lum_lim, da / ao_lim, dn / n_lim)
        worst.append((score, dl, da, dn, len(rows), k))
    worst.sort(reverse=True)
    info["island_pairs"] = len(worst)
    info["island_offset_worst"] = [
        {"lum": round(w[1], 4), "ao": round(w[2], 4), "normal_deg": round(w[3], 2), "edges": w[4],
         "at": [round(x, 2) for x in (mw @ obj.data.polygons[w[5][0]].center)]} for w in worst[:4]]
    bad = [w for w in worst if w[0] > 1.0]
    if bad:
        w = bad[0]
        rep.fail(f"{obj.name}: {len(bad)} UV island border(s) with a systematic offset (visible seam): worst "
                 f"lum={w[1]:.3f} ao={w[2]:.3f} normal={w[3]:.1f}deg over {w[4]} edges near "
                 f"{info['island_offset_worst'][0]['at']}")
    elif worst and worst[0][0] > 0.6:
        rep.warn(f"{obj.name}: UV island border close to a visible offset (score {worst[0][0]:.2f})")


def check_uvs(rep, obj, res=512, max_islands_per_1k_tris=25, max_overlap=0.004, atlas=None):
    """UV layout of a baked atlas mesh: overlapping texels (two surfaces share texels -> the bake of one shows on
    the other), mirrored/flipped UV triangles, island count (splinters = texel waste + mip bleeding + seams),
    coverage of the 0..1 square. Alpha/tile materials (authored card UVs, overlaps on purpose) are skipped."""
    me = obj.data
    if not me.uv_layers or not me.polygons:
        return
    skip = {i for i, sl in enumerate(obj.material_slots)
            if sl.material is not None and (sl.material.get("kit_alpha") or sl.material.get("kit_bake") == "tile"
                                            or "Leaf" in sl.material.name or "Foliage" in sl.material.name
                                            or "Grass" in sl.material.name)}
    uvl = me.uv_layers.active or me.uv_layers[0]
    uv = np.empty(len(me.loops) * 2)
    uvl.data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    me.calc_loop_triangles()
    cnt = np.zeros((res, res), dtype=np.uint8)
    cov = np.zeros((res, res), dtype=bool)
    flipped = total = 0
    for lt in me.loop_triangles:
        if me.polygons[lt.polygon_index].material_index in skip:
            continue
        total += 1
        a, b, c = uv[list(lt.loops)] * res
        d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if d < 0:
            flipped += 1
        if abs(d) < 1e-9:
            continue
        x0, x1 = int(max(0, np.floor(min(a[0], b[0], c[0])))), int(min(res - 1, np.ceil(max(a[0], b[0], c[0]))))
        y0, y1 = int(max(0, np.floor(min(a[1], b[1], c[1])))), int(min(res - 1, np.ceil(max(a[1], b[1], c[1]))))
        if x1 < x0 or y1 < y0:
            continue
        ys, xs = np.mgrid[y0:y1 + 1, x0:x1 + 1]
        px, py = xs + 0.5, ys + 0.5
        l1 = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / d
        l2 = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / d
        inside = (l1 > 0.02) & (l2 > 0.02) & (1 - l1 - l2 > 0.02)     # strict interior: shared edges don't count
        cnt[y0:y1 + 1, x0:x1 + 1] += inside.astype(np.uint8)
        cov[y0:y1 + 1, x0:x1 + 1] |= (l1 >= -0.01) & (l2 >= -0.01) & (1 - l1 - l2 >= -0.01)
    if not total:
        return
    covered = cov
    overlap = float((cnt > 1).sum()) / max(1, covered.sum())
    if atlas is not None:                   # objects sharing one texture set: coverage/overlap judged together
        imgs = {i: _final_images(sl.material).get("base") for i, sl in enumerate(obj.material_slots)}
        names = {im.name for i, im in imgs.items() if im is not None and i not in skip}
        for nm in names:
            atlas.setdefault(nm, []).append((obj.name, cnt, cov))
    # islands (UV-connected components); vertices welded by POSITION so meshes split at hard edges (imported
    # glTF, flat-shaded parts) are judged like the source mesh
    vco = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", vco)
    _, pid = np.unique(np.round(vco.reshape(-1, 3), 5), axis=0, return_inverse=True)
    pid = pid.ravel()
    lv = np.empty(len(me.loops), dtype=np.int64)
    me.loops.foreach_get("vertex_index", lv)
    parent = list(range(len(me.polygons)))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    edges = {}
    for poly in me.polygons:
        if poly.material_index in skip:
            continue
        li = list(poly.loop_indices)
        n = len(li)
        for k in range(n):
            la, lb = li[k], li[(k + 1) % n]
            pa, pb = int(pid[lv[la]]), int(pid[lv[lb]])
            if pa > pb:
                pa, pb, la, lb = pb, pa, lb, la
            key = (pa, pb)
            other = edges.get(key)
            if other is None:
                edges[key] = (poly.index, la, lb)
            else:
                q, qa_, qb = other
                if np.abs(uv[la] - uv[qa_]).max() < 1e-5 and np.abs(uv[lb] - uv[qb]).max() < 1e-5:
                    ra, rb = find(poly.index), find(q)
                    if ra != rb:
                        parent[ra] = rb
    tri_count = {}
    for poly in me.polygons:
        if poly.material_index in skip:
            continue
        r = find(poly.index)
        tri_count[r] = tri_count.get(r, 0) + len(poly.vertices) - 2
    sizes = list(tri_count.values())
    sizes = np.array(sizes)
    splinters = int((sizes <= 2).sum())
    info = rep["info"].setdefault("uv", {})[obj.name] = {
        "islands": int(len(sizes)), "splinter_islands": splinters, "coverage": round(float(covered.mean()), 3),
        "overlap": round(overlap, 4), "flipped_tris": flipped}
    if overlap > max_overlap:
        rep.fail(f"{obj.name}: {overlap * 100:.1f}% of the UV texels are OVERLAPPING (baked detail will repeat)")
    if flipped:
        rep.warn(f"{obj.name}: {flipped} mirrored/folded UV triangle(s) (tangent sign flips -> normal-map seams)")
    if splinters > 0.1 * len(sizes) + 8:
        rep.warn(f"{obj.name}: fragmented UVs ({len(sizes)} islands, {splinters} of 1-2 triangles for {total} tris) -> "
                 f"use bake_asset(uv_method='CHARTS') for organic shapes")
    if atlas is None and covered.mean() < 0.35:
        rep.warn(f"{obj.name}: UV coverage only {covered.mean() * 100:.0f}% of the texture")
    return info


def check_atlas(rep, atlas, min_cov=0.2):
    """Texture-level UV check across all objects sharing a texture set: coverage + overlaps BETWEEN objects."""
    for nm, lst in atlas.items():
        tot = sum((c > 0).astype(np.uint8) for _, c, _ in lst)
        anyc = np.logical_or.reduce([cv for _, _, cv in lst])
        cov = float(anyc.mean())
        cross = float((tot > 1).sum()) / max(1, anyc.sum())
        rep["info"].setdefault("atlas", {})[nm] = {"objects": [x[0] for x in lst], "coverage": round(cov, 3),
                                                  "overlap_between_objects": round(cross, 4)}
        if cross > 0.004:
            rep.fail(f"texture {nm}: {cross * 100:.1f}% of texels used by 2 objects (UVs overlap between meshes)")
        if cov < min_cov:
            rep.warn(f"texture {nm}: UV coverage only {cov * 100:.0f}% (texels wasted; pack tighter / smaller size)")


# =============================================================================== size / budgets
def bbox(objs):
    from . import render
    return render.bbox(objs)


def check_size(rep, objs, expected=None, tol=0.25, grounded=True, centred=True):
    mn, mx = bbox(objs)
    dims = mx - mn
    rep["info"]["bbox_min"] = [round(x, 3) for x in mn]
    rep["info"]["bbox_max"] = [round(x, 3) for x in mx]
    rep["info"]["dims"] = [round(x, 3) for x in dims]
    if grounded and abs(mn.z) > 0.06:
        rep.warn(f"lowest point z={mn.z:.3f} (origin must be at the base, ground z=0)")
    if centred:
        cx, cy = (mn.x + mx.x) / 2, (mn.y + mx.y) / 2
        if math.hypot(cx, cy) > 0.25 * max(dims.x, dims.y, 0.4):
            rep.warn(f"bbox centre ({cx:.2f},{cy:.2f}) far from the origin (pivot must be at base centre)")
    if expected:
        for i, ax in enumerate("xyz"):
            e = expected[i] if not isinstance(expected, dict) else expected.get(ax)
            if not e:
                continue
            r = dims[i] / e
            if abs(r - 1) > 2 * tol:
                rep.fail(f"size {ax}={dims[i]:.2f} m vs expected {e:.2f} m")
            elif abs(r - 1) > tol:
                rep.warn(f"size {ax}={dims[i]:.2f} m vs expected {e:.2f} m")


def check_budget(rep, objs, budget, glb=None):
    meshes = [o for o in objs if o.type == "MESH"]
    tris = export.triangles(meshes)
    tex = export.textures(meshes)
    nbytes = glb["bytes"] if isinstance(glb, dict) else (os.path.getsize(glb) if glb else 0)
    rep["info"].update(tris=tris, textures={k: list(v) for k, v in tex.items()}, glb_bytes=nbytes)
    for w in export.check_budget(budget, tris, tex, nbytes, rep["key"]):
        (rep.fail if ("> budget" in w or "GLB" in w or "texture" in w) else rep.warn)(w)
    if not tex:
        rep.warn("no image textures: materials were not baked")


# =============================================================================== clothing
def _covered(body_co, body_n, cloth_trees, max_depth):
    """Indices of body verts covered by clothing: the outward ray exits through a cloth BACK face within
    max_depth AND the nearest cloth point is in front of the vertex. Returns (idx array, depth array)."""
    idx, depth = [], []
    for i in range(len(body_co)):
        p = mathutils.Vector(body_co[i])
        n = mathutils.Vector(body_n[i])
        best = None
        for t in cloth_trees:
            loc, hn, fi, d = t.ray_cast(p + n * 1e-4, n, max_depth)
            if loc is not None and hn.dot(n) > 0.0:
                q, qn, _, qd = t.find_nearest(p)
                if q is not None and (p - q).dot(qn) < 0:
                    best = d if best is None else min(best, d)
        if best is not None:
            idx.append(i)
            depth.append(best)
    return np.array(idx, dtype=np.int64), np.array(depth)


def _cloth_trees(cloths):
    trees = []
    for c in cloths:
        co, _, polys = world_mesh(c, disable=("SOLIDIFY",), skip_shell=True)
        trees.append(BVHTree.FromPolygons([tuple(v) for v in co], polys))
    return trees


def delete_covered_body(body, cloths, margin=0.012, max_depth=0.2, shrink=0.006, armature=None, min_island=64):
    """Delete body faces whose vertices are ALL covered by clothing deeper than `margin` (in the rest pose),
    and push the remaining covered vertices `shrink` metres inward; then remove leftover islands with fewer than
    `min_island` faces (orphans hidden under the clothes). Keeps vertex groups (weights).
    Returns (deleted_faces, shrunk_verts)."""
    arms = [md.object for md in body.modifiers if md.type == "ARMATURE" and md.object]
    saved = {a: a.data.pose_position for a in arms}
    for a in arms:
        a.data.pose_position = "REST"
    bpy.context.view_layer.update()
    co, nr, polys = world_mesh(body, disable=("SOLIDIFY",))
    idx, depth = _covered(co, nr, _cloth_trees(cloths), max_depth)
    deep = set(int(i) for i, d in zip(idx, depth) if d > margin)
    cov = set(int(i) for i in idx)
    if len(co) != len(body.data.vertices):
        raise RuntimeError("delete_covered_body: apply the body's modifiers (except Armature) first")
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.verts.ensure_lookup_table()
    bm.normal_update()
    kill = [f for f in bm.faces if all(v.index in deep for v in f.verts)]
    nk = len(kill)
    # shrink covered verts that survive (local space, along -normal) so they stay behind the cloth when animated
    ns = 0
    if shrink > 0:
        ks = set(kill)
        killed_only = set(v.index for f in kill for v in f.verts if all(g in ks for g in v.link_faces))
        moves = [(bm.verts[i], bm.verts[i].normal.copy()) for i in cov if i not in killed_only]
        for v, n in moves:
            v.co -= n * shrink
            ns += 1
    bmesh.ops.delete(bm, geom=kill, context="FACES")
    # small orphan islands left under the clothes (armpits, collar) are useless and confuse tests -> remove
    if min_island:
        island, n = _islands(bm)
        sizes = np.bincount(np.array(island, dtype=np.int64), minlength=n) if island else []
        orphans = [f for f in bm.faces if sizes[island[f.index]] < min_island]
        if orphans:
            print(f"[qa] {body.name}: removing {len(orphans)} faces of small orphan islands under clothing")
            bmesh.ops.delete(bm, geom=orphans, context="FACES")
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bm.to_mesh(body.data)
    bm.free()
    body.data.update()
    for a, p in saved.items():
        a.data.pose_position = p
    print(f"[qa] {body.name}: deleted {nk} faces hidden under clothing, shrunk {ns} verts")
    return nk, ns


def check_clothing(rep, body, cloths, armature, actions=None, frames=8, tol=0.004, max_depth=0.2, ground=True):
    """Per-frame 'body through clothing' test for every clip. FAIL if any covered body vertex ends up in front of
    the cloth surface by more than `tol` metres in any sampled frame. Solidify modifiers are ignored (mid-surface)."""
    scene = bpy.context.scene
    arm = armature
    saved_action = arm.animation_data.action if arm.animation_data else None
    arm.data.pose_position = "REST"
    bpy.context.view_layer.update()
    co, nr, _ = world_mesh(body, disable=("SOLIDIFY",))
    idx, depth = _covered(co, nr, _cloth_trees(cloths), max_depth)
    arm.data.pose_position = "POSE"
    rep["info"]["covered_verts"] = int(len(idx))
    if len(idx) == 0:
        rep.warn(f"{body.name}: no body vertex covered by clothing in rest pose (nothing to test)")
    actions = actions or [a for a in bpy.data.actions]
    arm.animation_data_create()
    res = {}
    worst_total = 0
    for act in actions:
        arm.animation_data.action = act
        try:
            if act.slots:
                arm.animation_data.action_slot = act.slots[0]
        except AttributeError:
            pass
        f0, f1 = act.frame_range
        fr = sorted(set(int(round(f0 + (f1 - f0) * k / max(frames - 1, 1))) for k in range(frames)))
        worst, bad_frames, below = 0, [], 0.0
        for f in fr:
            scene.frame_set(f)
            bco, bnr, _ = world_mesh(body, disable=("SOLIDIFY",))
            trees = _cloth_trees(cloths)
            n_out = 0
            where = []
            for i in idx:
                p = mathutils.Vector(bco[i])
                inside = False
                for t in trees:
                    q, qn, _, d = t.find_nearest(p, max_depth * 2)
                    if q is None:
                        continue
                    if (p - q).dot(qn) <= tol:
                        inside = True
                        break
                if not inside:
                    n_out += 1
                    if len(where) < 6:
                        where.append([round(float(x), 3) for x in bco[i]])
            if n_out:
                bad_frames.append((f, n_out, where))
            worst = max(worst, n_out)
            if ground:
                below = min(below, float(bco[:, 2].min()))
        res[act.name] = {"frames": fr, "worst_verts": worst, "bad_frames": bad_frames, "min_z": round(below, 3)}
        worst_total += worst
        if worst:
            rep.fail(f"clip {act.name}: body pokes through clothing ({worst} verts, frames {[b[0] for b in bad_frames]}, "
                     f"e.g. at {bad_frames[0][2][:3]})")
        if ground and below < -0.03:
            rep.warn(f"clip {act.name}: body goes {-below:.2f} m below the ground")
    rep["info"]["clothing"] = res
    arm.animation_data.action = saved_action
    for pb in arm.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.scale = (1, 1, 1)
    scene.frame_set(scene.frame_start)
    return worst_total == 0


# =============================================================================== driver
def run(key, objs=None, budget=None, expected=None, tol=0.25, glb=None, skin=None, open_ok=None, grounded=True,
        centred=True, min_island_faces=3, seams=True):
    """Run every applicable check. skin = dict(body=, cloths=[...], armature=, actions=None, frames=8)."""
    rep = Report(key)
    objs = objs or export.exportable_objects()
    meshes = [o for o in objs if o.type == "MESH"]
    atlas = {}
    for o in meshes:
        check_geometry(rep, o, open_ok=open_ok, min_island_faces=min_island_faces)
        try:
            check_uvs(rep, o, atlas=atlas)
        except Exception as e:
            rep.warn(f"{o.name}: UV check skipped ({e})")
        if seams:
            try:
                check_seams(rep, o)
            except Exception as e:  # never let the diagnostic crash a build
                rep.warn(f"{o.name}: seam check skipped ({e})")
    try:
        check_atlas(rep, atlas)
    except Exception as e:
        rep.warn(f"atlas check skipped ({e})")
    check_size(rep, meshes, expected, tol, grounded, centred)
    if budget:
        check_budget(rep, meshes, budget, glb)
    if skin:
        check_clothing(rep, skin["body"], skin["cloths"], skin["armature"], skin.get("actions"), skin.get("frames", 8))
    print(f"QA {'PASS' if rep.ok else 'FAILED'} [{key}] {len(rep['fails'])} fail(s), {len(rep['warns'])} warning(s)", flush=True)
    return rep


def save(rep, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    p = os.path.join(out_dir, f"{rep['key']}_qa.json")
    with open(p, "w", encoding="utf-8") as f:
        json.dump(rep, f, indent=1, default=str)
    return p


def assert_clean(rep):
    if rep["fails"]:
        raise RuntimeError(f"QA failed for {rep['key']}: {rep['fails']}")
