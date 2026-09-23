"""LODs for static environment models: <key>_lod1.glb (~30 %) and <key>_lod2.glb (~8 % or a tree impostor).

    lod.export_lods("rock_a", [rock], out_dir)                     # decimated copies, same baked materials
    lod.export_lods("tree_oak", [trunk, leaves], out_dir, impostor=True)   # lod2 = crossed alpha cards

Call AFTER bake + export of LOD0 (the copies reuse the baked materials/UVs).
"""
import math
import os

import bpy
import numpy as np

from . import export


def _dup(objs, suffix):
    out = []
    for o in objs:
        if o.type != "MESH":
            continue
        c = o.copy()
        c.data = o.data.copy()
        c.name = o.name + suffix
        bpy.context.scene.collection.objects.link(c)
        out.append(c)
    return out


def decimated_copies(objs, ratio, suffix="_lod"):
    """Copies of `objs` decimated (collapse, triangulated) keeping UV seams/material borders."""
    copies = _dup(objs, suffix)
    for c in copies:
        tris = sum(len(p.vertices) - 2 for p in c.data.polygons)
        target = max(12, int(tris * ratio))
        md = c.modifiers.new("KitLOD", "DECIMATE")
        md.decimate_type = "COLLAPSE"
        md.ratio = max(0.001, min(1.0, target / max(tris, 1)))
        md.use_collapse_triangulate = True
        md.use_symmetry = False
        for o in bpy.context.scene.objects:
            o.select_set(False)
        c.select_set(True)
        bpy.context.view_layer.objects.active = c
        # keep the armature modifier (skinned LODs), apply the rest
        for m in list(c.modifiers):
            if m.type != "ARMATURE":
                bpy.ops.object.modifier_apply(modifier=m.name)
        c.data.validate(clean_customdata=False)
    return copies


def impostor(objs, key, size=512, name=None):
    """Two crossed vertical alpha cards textured with orthographic renders (front + side) of `objs`.
    The material is named Foliage_<key>_impostor so the client's wind still applies."""
    from . import render
    name = name or f"Foliage_{key}_impostor"
    mn, mx = render.bbox(objs)
    w = max(mx.x - mn.x, mx.y - mn.y)
    h = mx.z - mn.z
    cx, cy = (mn.x + mx.x) / 2, (mn.y + mx.y) / 2
    imgs = []
    for yaw in (0, 90):
        imgs.append(render.ortho_rgba(objs, yaw, size, size, extent=(w, h), center=((cx, cy, (mn.z + mx.z) / 2))))
    # atlas: two views side by side
    atlas = bpy.data.images.new(f"{key}_impostor", size * 2, size, alpha=True)
    a0 = np.array(imgs[0].pixels[:], dtype=np.float32).reshape(size, size, 4)
    a1 = np.array(imgs[1].pixels[:], dtype=np.float32).reshape(size, size, 4)
    from .bake import _bleed_alpha, build_gltf_material
    arr = np.concatenate([a0, a1], axis=1)
    arr[..., 3] = (arr[..., 3] > 0.5).astype(np.float32)
    arr = _bleed_alpha(arr, 8)
    atlas.pixels.foreach_set(arr.ravel())
    atlas.pack()
    for im in imgs:
        bpy.data.images.remove(im)
    mat = build_gltf_material(name, atlas, alpha=True, double_sided=True)
    verts, faces, uvs = [], [], []
    for i, ang in enumerate((0.0, math.pi / 2)):
        ca, sa = math.cos(ang), math.sin(ang)
        b = len(verts)
        for (u, z) in ((-0.5, 0), (0.5, 0), (0.5, 1), (-0.5, 1)):
            verts.append((cx + u * w * ca, cy + u * w * sa, mn.z + z * h))
        faces.append((b, b + 1, b + 2, b + 3))
        u0 = 0.5 * i
        uvs += [(u0, 0), (u0 + 0.5, 0), (u0 + 0.5, 1), (u0, 1)]
    me = bpy.data.meshes.new(f"{key}_impostor")
    me.from_pydata(verts, [], faces)
    uvl = me.uv_layers.new(name="UVMap")
    for li, uv in enumerate(uvs):
        uvl.data[li].uv = uv
    me.materials.append(mat)
    ob = bpy.data.objects.new(f"{key}_impostor", me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def downscale_materials(objs, scale, suffix, min_size=128):
    """Give `objs` copies of their materials whose image textures are resized by `scale` (distant LODs do not need
    full-res maps; this is most of a LOD's GLB size). Returns the created (materials, images) for cleanup."""
    made_m, made_i, done = [], [], {}
    for o in objs:
        for sl in o.material_slots:
            m = sl.material
            if m is None or not m.node_tree:
                continue
            if m.name not in done:
                mc = m.copy()
                mc.name = m.name + suffix
                for n in mc.node_tree.nodes:
                    if n.bl_idname == "ShaderNodeTexImage" and n.image is not None:
                        src = n.image
                        w, h = src.size
                        nw, nh = max(min_size, int(w * scale)), max(min_size, int(h * scale))
                        if (nw, nh) == (w, h):
                            continue
                        im = src.copy()
                        im.name = src.name + suffix
                        im.scale(nw, nh)
                        im.pack()
                        n.image = im
                        made_i.append(im)
                done[m.name] = mc
                made_m.append(mc)
            sl.material = done[m.name]
    return made_m, made_i


def export_lods(key, objs, out_dir=None, ratios=(0.30, 0.08), impostor_lod2=False, impostor_size=512, keep=False,
                tex_scale=(0.5, 0.25)):
    """Export <key>_lod1.glb and <key>_lod2.glb. Returns [info_lod1, info_lod2] (export dicts).
    tex_scale: texture resolution factor per LOD (1.0 = share LOD0 maps)."""
    infos = []
    for i, r in enumerate(ratios, start=1):
        made = ([], [])
        if i == 2 and impostor_lod2:
            copies = [impostor(objs, key, impostor_size)]
        else:
            copies = decimated_copies(objs, r, f"_lod{i}")
            ts = tex_scale[i - 1] if tex_scale and len(tex_scale) >= i else 1.0
            if ts < 1.0:
                made = downscale_materials(copies, ts, f"_lod{i}")
        info = export.export_glb(key, out_dir, objects=copies, budget=None, animations=False, suffix=f"_lod{i}")
        info["ratio"] = r
        infos.append(info)
        if not keep:
            for c in copies:
                me = c.data
                bpy.data.objects.remove(c, do_unlink=True)
                if me.users == 0:
                    bpy.data.meshes.remove(me)
            for mc in made[0]:
                bpy.data.materials.remove(mc)
            for im in made[1]:
                bpy.data.images.remove(im)
    return infos
