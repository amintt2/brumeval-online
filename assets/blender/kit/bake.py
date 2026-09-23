"""Bake procedural shader-node materials to glTF PBR textures (baseColor[+alpha] / normal / ORM / emissive).

Main entry point:

    groups = bake.bake_asset([body, robe], "mage", size=2048)                 # procedural -> textures
    groups = bake.bake_asset([rock_low], "rock_a", size=1024, high=rock_high)  # high -> low (normal + all channels)

What it does:
  1. applies every modifier except Armature (Geometry Nodes are realised) - skinned meshes are baked in rest pose;
  2. groups materials by mat["kit_group"] (default "Main"; wind/alpha materials keep their own group+name);
  3. 'atlas' groups get fresh non-overlapping UVs (smart project or lightmap pack, packed with margins) in a UV layer
     "UVBake"; 'tile' groups (leaf/fur cards, mat["kit_bake"]="tile") keep their authored UVs and are baked once on a
     unit square;
  4. bakes every channel by rewiring the Principled inputs to an Emission shader (works for metals, emission,
     alpha), bakes tangent-space NORMAL (shader bump + optional high->low) and AO with Cycles on the GPU
     (kit.gpu lock, CPU fallback);
  5. packs ORM with numpy, builds one final glTF-friendly material per group (image textures -> Principled,
     Normal Map, glTF Material Output/Occlusion, alpha clip via Math Round) and replaces the old materials;
  6. leaves ONE UV layer named "UVMap".
Returns {group: {"material", "images": {...}, "times": {...}, "device"}}.
"""
import math
import os
import time

import bpy
import numpy as np

from . import gpu
from .nodes import NB, sock

SIZES = {"tiny": 256, "small": 512, "prop": 1024, "building": 2048, "hero": 2048, "boss": 2048, "vegetation": 1024}
UV_NAME = "UVBake"


# =============================================================================== utils
def _log(msg):
    print(f"[bake] {msg}", flush=True)


def _select(objs, active=None):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or objs[0]


def apply_modifiers(obj, keep=("ARMATURE",)):
    """Apply all modifiers except the types in `keep` (in stack order). Works on meshes with GN modifiers."""
    if obj.type != "MESH":
        return obj
    _select([obj])
    for md in list(obj.modifiers):
        if md.type in keep:
            continue
        try:
            bpy.ops.object.modifier_apply(modifier=md.name)
        except RuntimeError as e:
            _log(f"WARN cannot apply {md.name} on {obj.name}: {e}; removing it")
            obj.modifiers.remove(md)
    return obj


def new_image(name, size, alpha=False, data=False, color=(0, 0, 0, 1), float_buffer=False):
    old = bpy.data.images.get(name)
    if old is not None:
        bpy.data.images.remove(old)
    w, h = (size, size) if isinstance(size, int) else size
    img = bpy.data.images.new(name, w, h, alpha=alpha, float_buffer=float_buffer)
    img.colorspace_settings.name = "Non-Color" if data else "sRGB"
    img.generated_color = color
    return img


def img_to_np(img):
    a = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(img.size[1], img.size[0], 4)


def np_to_img(img, arr):
    img.pixels.foreach_set(np.ascontiguousarray(arr, dtype=np.float32).ravel())
    img.update()


def save_image(img, path, fmt="PNG"):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.filepath_raw = path
    img.file_format = fmt
    img.save()
    return path


def _principled(mat):
    for n in mat.node_tree.nodes:
        if n.bl_idname == "ShaderNodeBsdfPrincipled":
            return n
    return None


def _output(mat):
    outs = [n for n in mat.node_tree.nodes if n.bl_idname == "ShaderNodeOutputMaterial"]
    for n in outs:
        if n.is_active_output:
            return n
    return outs[0] if outs else None


def _group_of(mat):
    if mat is None:
        return "Main", "atlas"
    return mat.get("kit_group", "Main"), mat.get("kit_bake", "atlas")


# =============================================================================== UVs
_CHART_DIRS = np.array([(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)], dtype=np.float64)


def chart_seams(bm, sel, smooth_iter=10, min_faces=40, dirs=_CHART_DIRS, crease_dot=0.35):
    """Organic charting: cluster the selected faces of `bm` by their SMOOTHED normal into a few big charts
    (6 box directions by default), merge small fragments into their neighbours, and mark the chart borders as
    UV seams (all other seams of the selected faces are cleared). Gives a handful of large islands instead of
    the hundreds of splinters Smart UV Project makes on noisy/displaced surfaces (fragmented islands waste
    texels, bleed at low mips and multiply the places where a bake can show a seam). Returns the chart count."""
    bm.faces.ensure_lookup_table()
    faces = [f for f in bm.faces if sel[f.index]]
    if not faces:
        return 0
    idx = {f.index: i for i, f in enumerate(faces)}
    nrm = np.array([f.normal[:] for f in faces], dtype=np.float64) * np.array([f.calc_area() for f in faces])[:, None]
    # neighbours across SOFT edges only: a solidified garment's outer shell, rim and inner shell (or any crease
    # sharper than ~70 deg) never share a chart, so thin shells cannot fold onto themselves in UV space
    nbr = [[idx[g.index] for e in f.edges for g in e.link_faces
            if g is not f and g.index in idx and f.normal.dot(g.normal) > crease_dot] for f in faces]
    for _ in range(smooth_iter):                      # area-weighted normal diffusion over face neighbours
        nrm = nrm + np.array([nrm[n].sum(axis=0) if n else np.zeros(3) for n in nbr]) * 0.5
        nrm /= np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-12)
    lab = np.argmax(nrm @ dirs.T, axis=1)
    for _ in range(12):                               # merge fragments smaller than min_faces into a neighbour
        comp = -np.ones(len(faces), dtype=np.int64)
        comps = []
        for i in range(len(faces)):
            if comp[i] >= 0:
                continue
            st, members = [i], []
            comp[i] = len(comps)
            while st:
                j = st.pop()
                members.append(j)
                for k in nbr[j]:
                    if comp[k] < 0 and lab[k] == lab[i]:
                        comp[k] = len(comps)
                        st.append(k)
            comps.append(members)
        changed = False
        for members in sorted(comps, key=len):
            if len(members) >= min_faces:
                continue
            ms = set(members)
            votes = {}
            for j in members:
                for k in nbr[j]:
                    if k not in ms:
                        votes[lab[k]] = votes.get(lab[k], 0) + 1
            if votes:
                new = max(votes, key=votes.get)
                if new != lab[members[0]]:
                    lab[members] = new
                    changed = True
        if not changed:
            break
    # a closed part (moss clump, pebble...) that ended up as ONE chart cannot be flattened: split it in two
    # halves along its main axis
    part = -np.ones(len(faces), dtype=np.int64)
    np_parts = 0
    for i in range(len(faces)):
        if part[i] >= 0:
            continue
        st = [i]
        part[i] = np_parts
        while st:
            j = st.pop()
            for k in nbr[j]:
                if part[k] < 0:
                    part[k] = np_parts
                    st.append(k)
        np_parts += 1
    cen = np.array([f.calc_center_median()[:] for f in faces])
    for pi in range(np_parts):
        m = np.where(part == pi)[0]
        if len(set(lab[m].tolist())) > 1:
            continue
        c = cen[m] - cen[m].mean(axis=0)
        axis = np.linalg.svd(c, full_matrices=False)[2][-1]          # thinnest axis: split top / bottom
        side = (nrm[m] @ axis) >= 0
        base = int(lab[m[0]])
        lab[m[side]] = base
        lab[m[~side]] = (base + 1) % len(dirs) if len(dirs) > 1 else base
    for f in faces:
        for e in f.edges:
            e.seam = False
    for f in faces:
        li = lab[idx[f.index]]
        for e in f.edges:
            for g in e.link_faces:
                if g is not f and (g.index not in idx or lab[idx[g.index]] != li):
                    e.seam = True
    return len({int(x) for x in lab})


def _fix_failed_charts(objs, angle, margin):
    """(EDIT mode) Faces whose chart could not be flattened (zero UV area) are re-projected with Smart UV."""
    import bmesh
    bad_total = 0
    keep = {}
    for o in objs:
        bm = bmesh.from_edit_mesh(o.data)
        ul = bm.loops.layers.uv.active
        keep[o.name] = [f.index for f in bm.faces if f.select]
        bad = 0
        for f in bm.faces:
            if not f.select:
                continue
            uvs = [l[ul].uv for l in f.loops]
            tri = [(uvs[i] - uvs[0]).cross(uvs[i + 1] - uvs[0]) for i in range(1, len(uvs) - 1)]
            # SIGNED fan triangles: any <= 0 = degenerate, folded or mirrored (tangent sign flip)
            f.tag = not (min(tri) > 1e-12 and all(u.x == u.x for u in uvs))
        badf = [f for f in bm.faces if f.select and f.tag]
        ring = {g for f in badf for v in f.verts for g in v.link_faces if g.select}   # + 1 ring: no splinters
        for f in bm.faces:
            f.select = f in ring
            f.tag = False
        bad += len(badf)
        bm.select_flush_mode()
        bmesh.update_edit_mesh(o.data)
        bad_total += bad
    if bad_total:
        _log(f"{bad_total} face(s) unsolved or folded in their chart -> smart project (+1 ring)")
        bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=margin, area_weight=0.0,
                                 correct_aspect=True, scale_to_bounds=False)
    for o in objs:                            # restore the selection of the faces being unwrapped
        bm = bmesh.from_edit_mesh(o.data)
        bm.faces.ensure_lookup_table()
        ks = set(keep[o.name])
        for f in bm.faces:
            f.select = f.index in ks
        bm.select_flush_mode()
        bmesh.update_edit_mesh(o.data)


def unwrap(objs, faces_filter=None, method="SMART", margin=0.006, angle=66.0, uv_name=UV_NAME):
    """Unwrap the selected faces of all `objs` together into `uv_name` (created if needed, made active for baking).
    faces_filter(obj, poly) -> bool selects the faces to unwrap (others keep their UVs).

    method: 'SMART'    smart UV project (hard-surface: planks, blocks, buildings, weapons),
            'CHARTS'   smoothed-normal charts + minimum-stretch unwrap (ORGANIC: rocks, cliffs, creatures,
                       bodies, cloth, trunks) -> few big islands, no splinters,
            'SEAMS'    use the seams already marked on the mesh (hand/GN authored) + minimum-stretch unwrap,
            'LIGHTMAP' lightmap pack (one island per face; only for very simple meshes)."""
    for o in objs:
        uvl = o.data.uv_layers.get(uv_name) or o.data.uv_layers.new(name=uv_name)
        o.data.uv_layers.active = uvl
        sel = [faces_filter(o, p) if faces_filter else True for p in o.data.polygons]
        # NB: Mesh.edges.foreach_set("select") crashes Blender 5.0 on meshes without selection attributes -> bmesh
        import bmesh
        bm = bmesh.new()
        bm.from_mesh(o.data)
        for v in bm.verts:
            v.select = False
        for e in bm.edges:
            e.select = False
        bm.faces.ensure_lookup_table()
        for f in bm.faces:
            f.select = sel[f.index]
        if method == "CHARTS":
            n = chart_seams(bm, sel)
            if n:
                _log(f"{o.name}: {n} UV charts")
        bm.select_flush_mode()
        bm.to_mesh(o.data)
        bm.free()
        o.data.update()
    _select(objs)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.context.tool_settings.mesh_select_mode = (False, False, True)
    bpy.context.tool_settings.use_uv_select_sync = False
    bpy.ops.mesh.hide(unselected=True)      # other groups' faces must not take part in the pack
    if method == "LIGHTMAP":
        bpy.ops.uv.lightmap_pack(PREF_CONTEXT="SEL_FACES", PREF_PACK_IN_ONE=True, PREF_NEW_UVLAYER=False,
                                 PREF_BOX_DIV=12, PREF_MARGIN_DIV=max(0.05, margin * 30))
    elif method in ("CHARTS", "SEAMS"):
        try:
            bpy.ops.uv.unwrap(method="MINIMUM_STRETCH", fill_holes=True, margin=margin)
        except TypeError:
            bpy.ops.uv.unwrap(method="CONFORMAL", fill_holes=True, margin=margin)
        _fix_failed_charts(objs, angle, margin)
    else:
        bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=margin, area_weight=0.0,
                                 correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.average_islands_scale()      # uniform texel density
    try:
        bpy.ops.uv.pack_islands(udim_source="CLOSEST_UDIM", rotate=True, rotate_method="ANY", scale=True,
                                merge_overlap=False, margin_method="FRACTION", margin=margin, shape_method="CONCAVE")
    except TypeError:
        bpy.ops.uv.pack_islands(rotate=True, margin=margin)
    bpy.ops.mesh.reveal(select=False)
    bpy.ops.object.mode_set(mode="OBJECT")


def _copy_uv(obj, src_name, dst_name, poly_filter):
    src = obj.data.uv_layers.get(src_name)
    dst = obj.data.uv_layers.get(dst_name)
    if src is None or dst is None:
        return
    for p in obj.data.polygons:
        if poly_filter(p):
            for li in p.loop_indices:
                dst.data[li].uv = src.data[li].uv


def pin_uv(mats, uv_name):
    """Make every UV-dependent node of `mats` read `uv_name` EXPLICITLY (TexCoord.UV -> UV Map node, empty
    Normal Map / Tangent uv_map -> uv_name). The bake layer can then be both the active AND the render-active UV
    map, so every UV-dependent thing Cycles computes during the bake (tangent frame of the NORMAL pass, default UV
    coordinates) matches the final glTF material, whatever the Blender version's defaults are."""
    for m in mats:
        if m is None or not m.node_tree:
            continue
        nt = m.node_tree
        for n in list(nt.nodes):
            if n.bl_idname == "ShaderNodeTexCoord" and n.outputs["UV"].is_linked:
                uvn = nt.nodes.new("ShaderNodeUVMap")
                uvn.uv_map = uv_name
                uvn.location = (n.location.x, n.location.y - 180)
                for to in [l.to_socket for l in n.outputs["UV"].links]:
                    nt.links.new(uvn.outputs[0], to)       # replaces the old link on that input
            elif n.bl_idname == "ShaderNodeNormalMap" and n.space == "TANGENT" and not n.uv_map:
                n.uv_map = uv_name
            elif n.bl_idname == "ShaderNodeTangent" and n.direction_type == "UV_MAP" and not n.uv_map:
                n.uv_map = uv_name
            elif n.bl_idname == "ShaderNodeUVMap" and not n.uv_map:
                n.uv_map = uv_name


# =============================================================================== pass rewiring
class _Rewire:
    """Temporarily route one Principled input through an Emission shader to the output (for EMIT bakes)."""

    def __init__(self, mats, channel):
        self.saved = []
        for m in mats:
            nt = m.node_tree
            bsdf, out = _principled(m), _output(m)
            if bsdf is None or out is None:
                continue
            old = out.inputs["Surface"].links[0].from_socket if out.inputs["Surface"].is_linked else None
            em = nt.nodes.new("ShaderNodeEmission")
            em.name = "_kit_bake_emit"
            em.inputs["Strength"].default_value = 1.0
            if channel == "emission":
                src = sock(bsdf.inputs, "Emission Color")
                scale = m.get("_kit_emit_scale", 1.0)
                strength = sock(bsdf.inputs, "Emission Strength").default_value
                em.inputs["Strength"].default_value = scale * (1.0 if strength > 0 else 0.0)
            else:
                src = sock(bsdf.inputs, {"base": "Base Color", "rough": "Roughness", "metal": "Metallic", "alpha": "Alpha"}[channel])
            if src.is_linked:
                nt.links.new(src.links[0].from_socket, em.inputs["Color"])
            else:
                v = src.default_value
                em.inputs["Color"].default_value = tuple(v) if hasattr(v, "__len__") else (v, v, v, 1.0)
            nt.links.new(em.outputs[0], out.inputs["Surface"])
            self.saved.append((m, em, old, out))

    def restore(self):
        for m, em, old, out in self.saved:
            nt = m.node_tree
            nt.nodes.remove(em)
            if old is not None:
                nt.links.new(old, out.inputs["Surface"])


def _set_target(mats, img):
    """Make `img` the active Image Texture node in every material (bake target)."""
    for m in mats:
        nt = m.node_tree
        n = nt.nodes.get("_kit_bake_target")
        if n is None:
            n = nt.nodes.new("ShaderNodeTexImage")
            n.name = "_kit_bake_target"
            n.location = (-400, 400)
        n.image = img
        for o in nt.nodes:
            o.select = False
        n.select = True
        nt.nodes.active = n


def _clear_targets(mats):
    for m in mats:
        n = m.node_tree.nodes.get("_kit_bake_target")
        if n is not None:
            m.node_tree.nodes.remove(n)


def _bake(kind, targets, high=None, samples=16, margin=8, extrusion=0.05, max_ray=0.0, times=None, label=""):
    scene = bpy.context.scene
    b = scene.render.bake
    b.margin = margin
    b.margin_type = "EXTEND"
    b.use_clear = True
    b.target = "IMAGE_TEXTURES"
    b.use_selected_to_active = high is not None
    if high is not None:
        b.cage_extrusion = extrusion
        b.max_ray_distance = max_ray
    if kind == "NORMAL":
        b.normal_space = "TANGENT"
    t0 = time.time()
    with gpu.device(scene, samples=samples) as dev:
        if high is None:
            _select(targets)
            bpy.ops.object.bake(type=kind, use_clear=True, margin=margin)
        else:
            for i, low in enumerate(targets):
                _select(list(high) + [low], active=low)
                bpy.ops.object.bake(type=kind, use_clear=(i == 0), margin=margin)
    dt = time.time() - t0
    if times is not None:
        times[label or kind] = round(dt, 2)
        times["_device"] = dev
    _log(f"{label or kind}: {dt:.1f}s on {dev}")
    return dev


def uv_coverage(objs, size, uv_name=UV_NAME, faces_filter=None):
    """Boolean HxW mask of the texels covered by the UV triangles of `objs` (numpy rasteriser, texel centres)."""
    w, h = (size, size) if isinstance(size, int) else size
    mask = np.zeros((h, w), dtype=bool)
    for o in objs:
        me = o.data
        uvl = me.uv_layers.get(uv_name)
        if uvl is None:
            continue
        uv = np.empty(len(me.loops) * 2, dtype=np.float64)
        uvl.data.foreach_get("uv", uv)
        uv = uv.reshape(-1, 2) * (w, h)
        me.calc_loop_triangles()
        for lt in me.loop_triangles:
            if faces_filter and not faces_filter(o, me.polygons[lt.polygon_index]):
                continue
            a, b, c = uv[list(lt.loops)]
            x0, x1 = int(max(0, np.floor(min(a[0], b[0], c[0]) - 0.5))), int(min(w - 1, np.ceil(max(a[0], b[0], c[0]))))
            y0, y1 = int(max(0, np.floor(min(a[1], b[1], c[1]) - 0.5))), int(min(h - 1, np.ceil(max(a[1], b[1], c[1]))))
            if x1 < x0 or y1 < y0:
                continue
            ys, xs = np.mgrid[y0:y1 + 1, x0:x1 + 1]
            px, py = xs + 0.5, ys + 0.5
            d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
            if abs(d) < 1e-12:
                continue
            l1 = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / d
            l2 = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / d
            inside = (l1 >= -1e-6) & (l2 >= -1e-6) & (1 - l1 - l2 >= -1e-6)
            mask[y0:y1 + 1, x0:x1 + 1] |= inside
    return mask


def _dilate(mask, n):
    out = mask.copy()
    for _ in range(n):
        g = out.copy()
        g[1:] |= out[:-1]
        g[:-1] |= out[1:]
        g[:, 1:] |= out[:, :-1]
        g[:, :-1] |= out[:, 1:]
        out = g
    return out


def _bake_mixed(kind, img, mats, targets, direct, high, samples, margin, extrusion, max_ray, times, label, masks):
    """high->low bake for `targets` + plain bake for `direct` objects (moss clumps, straps... anything that is not
    in the high-poly source) composited into the same image. Rays cast from a low mesh never hit geometry that
    exists only in the low, which is what caused rainbow normals / wrong colours at the contacts."""
    if not direct or not high:
        return _bake(kind, targets + direct, high, samples, margin, extrusion, max_ray, times, label)
    s2a = [t for t in targets if t not in direct]
    dev = _bake(kind, s2a, high, samples, margin, extrusion, max_ray, times, label) if s2a else "CPU"
    tmp = new_image("_kit_bake_direct", tuple(img.size), data=img.colorspace_settings.name == "Non-Color",
                    float_buffer=img.is_float)
    tmp.colorspace_settings.name = img.colorspace_settings.name
    _set_target(mats, tmp)
    t2 = {}
    _bake(kind, direct, None, samples, margin, extrusion, max_ray, t2, label)
    _set_target(mats, img)
    if times is not None:
        times[label] = round(times.get(label, 0) + t2.get(label, 0), 2)
    if "direct" not in masks:
        m_d = uv_coverage(direct, tuple(img.size))
        m_s = uv_coverage(s2a, tuple(img.size))
        masks["direct"] = m_d | (_dilate(m_d, margin) & ~_dilate(m_s, 1))
    a, b = img_to_np(img), img_to_np(tmp)
    m = masks["direct"]
    a[m] = b[m]
    np_to_img(img, a)
    bpy.data.images.remove(tmp)
    return dev


# =============================================================================== final material
def _gltf_output_group():
    ng = bpy.data.node_groups.get("glTF Material Output")
    if ng is None:
        ng = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
        ng.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
        ng.interface.new_socket("Thickness", in_out="INPUT", socket_type="NodeSocketFloat")
        ng.nodes.new("NodeGroupInput")
    return ng


def build_gltf_material(name, base, normal=None, orm=None, emission=None, emit_strength=1.0, alpha=False,
                        cutoff=0.5, uv_name="UVMap", double_sided=False):
    """Material made only of glTF-exportable nodes: image textures -> Principled BSDF."""
    old = bpy.data.materials.get(name)
    if old is not None:
        old.name = name + "_proc"
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    nb = NB(m.node_tree, clear=True)
    out = nb.node("ShaderNodeOutputMaterial")
    bsdf = nb.node("ShaderNodeBsdfPrincipled")
    nb.link(bsdf.outputs[0], out.inputs["Surface"])
    uv = nb.node("ShaderNodeUVMap", {"uv_map": uv_name})
    tb = nb.node("ShaderNodeTexImage", {"image": base}, Vector=uv.outputs[0])
    nb.link(tb.outputs["Color"], sock(bsdf.inputs, "Base Color"))
    if alpha:
        r = nb.node("ShaderNodeMath", {"operation": "ROUND"})
        nb.link(tb.outputs["Alpha"], r.inputs[0])
        nb.link(r.outputs[0], sock(bsdf.inputs, "Alpha"))
        m.surface_render_method = "DITHERED"
        m.use_backface_culling = False
        m["kit_alpha"] = 1
    else:
        m.use_backface_culling = not double_sided
    if orm is not None:
        to = nb.node("ShaderNodeTexImage", {"image": orm}, Vector=uv.outputs[0])
        sc = nb.node("ShaderNodeSeparateColor")
        nb.link(to.outputs["Color"], sc.inputs[0])
        nb.link(sc.outputs[1], sock(bsdf.inputs, "Roughness"))
        nb.link(sc.outputs[2], sock(bsdf.inputs, "Metallic"))
        g = nb.node("ShaderNodeGroup")
        g.node_tree = _gltf_output_group()
        nb.link(sc.outputs[0], g.inputs["Occlusion"])
    if normal is not None:
        tn = nb.node("ShaderNodeTexImage", {"image": normal}, Vector=uv.outputs[0])
        nm = nb.node("ShaderNodeNormalMap", {"space": "TANGENT", "uv_map": uv_name})
        nb.link(tn.outputs["Color"], nm.inputs["Color"])
        nb.link(nm.outputs[0], sock(bsdf.inputs, "Normal"))
    if emission is not None:
        te = nb.node("ShaderNodeTexImage", {"image": emission}, Vector=uv.outputs[0])
        nb.link(te.outputs["Color"], sock(bsdf.inputs, "Emission Color"))
        sock(bsdf.inputs, "Emission Strength").default_value = emit_strength
    m["kit_final"] = 1
    return m


def _assign(objs, mapping):
    """Replace slot materials: mapping old_material -> new_material; merge duplicate slots."""
    for o in objs:
        mats = [s.material for s in o.material_slots]
        new = []
        remap = []
        for mt in mats:
            nm = mapping.get(mt, mt)
            if nm not in new:
                new.append(nm)
            remap.append(new.index(nm))
        idx = np.zeros(len(o.data.polygons), dtype=np.int32)
        o.data.polygons.foreach_get("material_index", idx)
        if remap:
            idx = np.array(remap, dtype=np.int32)[np.clip(idx, 0, len(remap) - 1)]
        o.data.materials.clear()
        for nm in new:
            o.data.materials.append(nm)
        o.data.polygons.foreach_set("material_index", idx)
        o.data.update()


# =============================================================================== main
def bake_asset(objs, key, size=1024, high=None, samples=16, ao=True, ao_samples=64, ao_distance=None,
               uv_method="SMART", uv_margin=0.006, px_margin=8, extrusion=0.04, max_ray=0.0, tex_dir=None,
               ao_in_base=0.0, group_sizes=None):
    """Bake every material of `objs` into per-group texture sets and swap in final glTF materials.

    high:        optional object or list of high-poly objects to bake FROM (selected-to-active, all channels).
    ao_in_base:  0..1, multiply baked AO into baseColor too (a little helps the dark-fantasy look under IBL).
    tex_dir:     if set, PNG copies of every texture are saved there (for inspection).
    group_sizes: {group: size} overrides (e.g. {"Leaf": 512}).
    """
    t_start = time.time()
    objs = [o for o in objs if o.type == "MESH"]
    highs = [] if high is None else (list(high) if isinstance(high, (list, tuple)) else [high])
    scene = bpy.context.scene
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    # rest pose for skinned meshes
    arms = {md.object for o in objs for md in o.modifiers if md.type == "ARMATURE" and md.object}
    saved_pose = {a: a.data.pose_position for a in arms}
    for a in arms:
        a.data.pose_position = "REST"
    for o in objs:
        apply_modifiers(o)
        if not o.material_slots:
            from . import materials as M
            o.data.materials.append(M.flat("Default_" + o.name))
    # --------------------------------------------------------------- groups
    groups = {}
    for o in objs:
        for s in o.material_slots:
            g, mode = _group_of(s.material)
            groups.setdefault(g, {"mode": mode, "mats": [], "alpha": False, "emissive": False})
            if s.material not in groups[g]["mats"]:
                groups[g]["mats"].append(s.material)
            if s.material is not None and s.material.get("kit_alpha"):
                groups[g]["alpha"] = True
            if s.material is not None and s.material.get("kit_emissive"):
                groups[g]["emissive"] = True
    _log(f"{key}: groups {[(g, v['mode'], [m.name for m in v['mats']]) for g, v in groups.items()]}")
    # --------------------------------------------------------------- UVs
    for o in objs:
        if not o.data.uv_layers:
            o.data.uv_layers.new(name="UVMap")
    auth_name = objs[0].data.uv_layers[0].name
    for o in objs:
        if o.data.uv_layers[0].name != auth_name:
            o.data.uv_layers[0].name = auth_name
    for h in highs:
        if h.type == "MESH":
            if not h.data.uv_layers:
                h.data.uv_layers.new(name=auth_name)
            h.data.uv_layers[0].name = auth_name
    # shaders read the authored layout explicitly (the bake layer becomes render-active below)
    pin_uv({s.material for o in objs + highs for s in o.material_slots if s.material}, auth_name)
    for g, info in groups.items():
        mats = info["mats"]

        def filt(o, p, mats=mats):
            return p.material_index < len(o.material_slots) and o.material_slots[p.material_index].material in mats
        if info["mode"] == "atlas":
            unwrap(objs, filt, uv_method, uv_margin)
        else:
            for o in objs:
                o.data.uv_layers.get(UV_NAME) or o.data.uv_layers.new(name=UV_NAME)
                _copy_uv(o, o.data.uv_layers[0].name, UV_NAME, lambda p, o=o: filt(o, p))
    for o in objs:
        o.data.uv_layers.active = o.data.uv_layers[UV_NAME]          # bake target layout
        o.data.uv_layers[UV_NAME].active_render = True               # tangent frame of the NORMAL bake
    # --------------------------------------------------------------- bake
    result = {}
    all_src_mats = {s.material for o in objs + highs for s in o.material_slots if s.material}
    for g, info in groups.items():
        gsize = (group_sizes or {}).get(g, size)
        times = {}
        mats = info["mats"]
        imgs = {}
        if info["mode"] == "tile":
            targets, tmp = [_unit_plane(mats, auth_name)], True
            src_high = None
        else:
            targets, tmp = objs, False
            src_high = highs or None
        direct = [o for o in targets if o.get("kit_bake_direct")] if src_high else []
        masks = {}
        # emission scale per material so the strongest one maps to 1.0
        strengths = [sock(_principled(m).inputs, "Emission Strength").default_value for m in mats if _principled(m)]
        emit_max = max([s for s in strengths] + [0.0])
        for m in mats:
            if _principled(m):
                s = sock(_principled(m).inputs, "Emission Strength").default_value
                m["_kit_emit_scale"] = s / emit_max if emit_max > 0 else 0.0
        rew_mats = list(all_src_mats) if src_high else mats
        passes = [("base", False), ("rough", True), ("metal", True)]
        if info["alpha"]:
            passes.append(("alpha", True))
        if info["emissive"] and emit_max > 0:
            passes.append(("emission", False))
        for ch, data in passes:
            img = new_image(f"{key}_{g}_{ch}", gsize, data=data)
            _set_target(mats, img)
            rw = _Rewire(rew_mats, ch)
            try:
                _bake_mixed("EMIT", img, mats, targets, direct, src_high, samples, px_margin, extrusion, max_ray,
                            times, ch, masks)
            finally:
                rw.restore()
            imgs[ch] = img
        img = new_image(f"{key}_{g}_normal", gsize, data=True, color=(0.5, 0.5, 1.0, 1.0))
        _set_target(mats, img)
        _bake_mixed("NORMAL", img, mats, targets, direct, src_high, samples, px_margin, extrusion, max_ray, times,
                    "normal", masks)
        imgs["normal"] = img
        if ao and info["mode"] == "atlas":
            img = new_image(f"{key}_{g}_ao", gsize, data=True, color=(1, 1, 1, 1))
            _set_target(mats, img)
            if scene.world is None:
                scene.world = bpy.data.worlds.new("World")
            dims = max(max(o.dimensions) for o in objs)
            scene.world.light_settings.distance = ao_distance or max(0.1, dims * 0.25)
            hidden = [h for h in highs if not h.hide_render]
            for h in hidden:                 # high-poly sources must not occlude the low mesh
                h.hide_render = True
            try:
                _bake("AO", targets, None, ao_samples, px_margin, extrusion, max_ray, times, "ao")
            finally:
                for h in hidden:
                    h.hide_render = False
            imgs["ao"] = img
        _clear_targets(mats)
        if tmp:
            _remove_obj(targets[0])
        # ------------------------------------------------------- pack
        base = img_to_np(imgs["base"])
        rough = img_to_np(imgs["rough"])[..., 0]
        metal = img_to_np(imgs["metal"])[..., 0]
        aoa = img_to_np(imgs["ao"])[..., 0] if "ao" in imgs else np.ones_like(rough)
        if "ao" in imgs:
            aoa = np.clip(aoa * 0.85 + 0.15, 0, 1)       # keep a little ambient in the deepest crevices
        orm_img = new_image(f"{key}_{g}_orm", gsize, data=True)
        np_to_img(orm_img, np.dstack([aoa, rough, metal, np.ones_like(rough)]))
        base_img = new_image(f"{key}_{g}_basecolor", gsize, alpha=info["alpha"])
        if ao_in_base > 0:
            base[..., :3] *= (1.0 - ao_in_base + ao_in_base * aoa)[..., None]
        if info["alpha"]:
            base[..., 3] = (img_to_np(imgs["alpha"])[..., 0] > 0.5).astype(np.float32)
            base = _bleed_alpha(base)
        else:
            base[..., 3] = 1.0
        np_to_img(base_img, base)
        final_imgs = {"basecolor": base_img, "normal": imgs["normal"], "orm": orm_img}
        if "emission" in imgs:
            imgs["emission"].name = f"{key}_{g}_emissive"
            final_imgs["emissive"] = imgs["emission"]
        for ch in ("base", "rough", "metal", "alpha", "ao"):
            if ch in imgs:
                bpy.data.images.remove(imgs[ch])
        for nm, im in final_imgs.items():
            im.pack()
            if tex_dir:
                save_image(im, os.path.join(tex_dir, f"{key}_{g}_{nm}.png"))
        mname = g if g != "Main" else key
        fm = build_gltf_material(mname, base_img, final_imgs["normal"], orm_img, final_imgs.get("emissive"),
                                 emit_max, info["alpha"], mats[0].get("kit_alpha_cutoff", 0.5) if mats else 0.5)
        result[g] = {"material": fm, "images": final_imgs, "times": times, "size": gsize, "src": [m.name for m in mats]}
    # --------------------------------------------------------------- swap materials / UV layers
    mapping = {}
    for g, info in groups.items():
        for m in info["mats"]:
            mapping[m] = result[g]["material"]
    _assign(objs, mapping)
    for o in objs:
        for uvl in [u for u in o.data.uv_layers if u.name != UV_NAME]:
            o.data.uv_layers.remove(uvl)
        o.data.uv_layers[UV_NAME].name = "UVMap"
        o.data.uv_layers["UVMap"].active = True
        o.data.uv_layers["UVMap"].active_render = True
    for a, p in saved_pose.items():
        a.data.pose_position = p
    _log(f"{key}: baked {len(groups)} group(s) in {time.time() - t_start:.1f}s")
    return result


def _bleed_alpha(rgba, iters=6):
    """Dilate colour into transparent texels so mip-mapped alpha cards have no dark fringes."""
    out = rgba.copy()
    mask = out[..., 3] > 0.5
    for _ in range(iters):
        acc = np.zeros_like(out[..., :3])
        cnt = np.zeros(mask.shape, dtype=np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            sm = np.roll(mask, (dy, dx), (0, 1))
            acc += np.roll(out[..., :3], (dy, dx), (0, 1)) * sm[..., None]
            cnt += sm
        grow = (~mask) & (cnt > 0)
        out[grow, :3] = acc[grow] / cnt[grow][:, None]
        mask = mask | grow
    return out


def _unit_plane(mats, auth_name="UVMap"):
    """Temporary 1x1 plane with UVs 0..1 carrying `mats` (for 'tile' groups)."""
    me = bpy.data.meshes.new("_kit_tile")
    me.from_pydata([(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0)], [], [(0, 1, 2, 3)])
    uvl = me.uv_layers.new(name=auth_name)
    for i, uv in enumerate(((0, 0), (1, 0), (1, 1), (0, 1))):
        uvl.data[i].uv = uv
    me.uv_layers.new(name=UV_NAME)
    for i, uv in enumerate(((0, 0), (1, 0), (1, 1), (0, 1))):
        me.uv_layers[UV_NAME].data[i].uv = uv
    me.uv_layers.active = me.uv_layers[UV_NAME]
    me.uv_layers[UV_NAME].active_render = True
    me.materials.append(mats[0])
    ob = bpy.data.objects.new("_kit_tile", me)
    ob.location = (1000, 1000, 1000)  # far from everything (AO / bevel)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def _remove_obj(ob):
    me = ob.data
    bpy.data.objects.remove(ob, do_unlink=True)
    if me.users == 0:
        bpy.data.meshes.remove(me)


# =============================================================================== tileable textures (terrain / trims)
def make_tileable(arr, blend=0.25):
    """Offset-and-blend a HxWxC array so it tiles seamlessly (edges replaced by a half-shifted copy)."""
    h, w = arr.shape[:2]
    shifted = np.roll(arr, (h // 2, w // 2), (0, 1))
    y = np.minimum(np.arange(h), h - 1 - np.arange(h)) / (h * blend)
    x = np.minimum(np.arange(w), w - 1 - np.arange(w)) / (w * blend)
    wy = np.clip(y, 0, 1)[:, None]
    wx = np.clip(x, 0, 1)[None, :]
    wgt = (wy * wx)[..., None]
    wgt = wgt * wgt * (3 - 2 * wgt)
    return arr * wgt + shifted * (1 - wgt)


def bake_tileable(material, name, size=1024, world_size=2.0, out_dir=None, samples=16, tile_blend=0.25):
    """Bake a procedural material on a flat world_size x world_size patch into seamless tileable PBR textures.
    Returns {"basecolor","normal","orm"} images (and saves PNGs to out_dir if given). Use for terrain sets and
    trim sheets (the client applies them with repeat wrapping)."""
    me = bpy.data.meshes.new("_kit_tileable")
    s = world_size / 2
    me.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
    uvl = me.uv_layers.new(name="UVMap")
    for i, uv in enumerate(((0, 0), (1, 0), (1, 1), (0, 1))):
        uvl.data[i].uv = uv
    me.materials.append(material)
    ob = bpy.data.objects.new("_kit_tileable", me)
    bpy.context.scene.collection.objects.link(ob)
    me.uv_layers.active = uvl
    # direct bake (UVs already fill 0..1, no unwrap)
    times = {}
    imgs = {}
    for ch, data in (("base", False), ("rough", True), ("metal", True)):
        img = new_image(f"{name}_{ch}", size, data=data)
        _set_target([material], img)
        rw = _Rewire([material], ch)
        try:
            _bake("EMIT", [ob], None, samples, 0, times=times, label=ch)
        finally:
            rw.restore()
        imgs[ch] = img
    img = new_image(f"{name}_normal", size, data=True)
    _set_target([material], img)
    _bake("NORMAL", [ob], None, samples, 0, times=times, label="normal")
    imgs["normal"] = img
    _clear_targets([material])
    _remove_obj(ob)
    base = make_tileable(img_to_np(imgs["base"]), tile_blend)
    nrm = make_tileable(img_to_np(imgs["normal"]), tile_blend)
    v = nrm[..., :3] * 2 - 1
    v /= np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-6)
    nrm[..., :3] = v * 0.5 + 0.5
    rough = make_tileable(img_to_np(imgs["rough"]), tile_blend)[..., 0]
    metal = make_tileable(img_to_np(imgs["metal"]), tile_blend)[..., 0]
    out = {}
    out["basecolor"] = new_image(f"{name}_basecolor", size)
    np_to_img(out["basecolor"], base)
    out["normal"] = new_image(f"{name}_normal_t", size, data=True)
    np_to_img(out["normal"], nrm)
    out["orm"] = new_image(f"{name}_orm", size, data=True)
    np_to_img(out["orm"], np.dstack([np.ones_like(rough), rough, metal, np.ones_like(rough)]))
    for ch in ("base", "rough", "metal", "normal"):
        bpy.data.images.remove(imgs[ch])
    if out_dir:
        for k, im in out.items():
            save_image(im, os.path.join(out_dir, f"{name}_{k}.png"))
    _log(f"tileable {name}: {times}")
    return out
