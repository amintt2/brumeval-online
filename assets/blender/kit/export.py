"""glTF export with WebP textures, applied modifiers, skins and every Action, plus budget checks (ROADMAP §4.4).

    info = export.export_glb("rock_a", out_dir, budget="prop")
    # -> {"path", "bytes", "tris", "textures": {name: (w,h)}, "warnings": [...]}
"""
import os

import bpy

from . import MODELS

# LOD0 triangles (min, max) / max texture size / max GLB size in MB
BUDGETS = {
    "hero": ((8000, 15000), 2048, 4.0),
    "humanoid": ((8000, 15000), 2048, 4.0),
    "npc": ((8000, 15000), 2048, 4.0),
    "beast": ((6000, 15000), 2048, 4.0),
    "boss": ((20000, 40000), 2048, 8.0),
    "building": ((5000, 20000), 2048, 5.0),
    "prop": ((1000, 5000), 1024, 2.0),
    "rock": ((1000, 5000), 1024, 2.0),
    "vegetation": ((2000, 6000), 1024, 2.0),
    "lod": ((0, 10 ** 9), 2048, 8.0),
}


def exportable_objects():
    """Visible, renderable meshes/armatures that are not kit templates or helper objects (name starting '_')."""
    out = []
    for o in bpy.context.scene.objects:
        if o.type not in ("MESH", "ARMATURE", "EMPTY"):
            continue
        if o.get("kit_template") or o.name.startswith("_") or o.hide_render:
            continue
        if o.type == "EMPTY" and not o.children:
            continue
        out.append(o)
    return out


def triangles(objs):
    dg = bpy.context.evaluated_depsgraph_get()
    n = 0
    for o in objs:
        if o.type != "MESH":
            continue
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        me.calc_loop_triangles()
        n += len(me.loop_triangles)
        ev.to_mesh_clear()
    return n


def textures(objs):
    res = {}
    for o in objs:
        for s in getattr(o, "material_slots", []):
            m = s.material
            if not m or not m.node_tree:
                continue
            for n in m.node_tree.nodes:
                if n.bl_idname == "ShaderNodeTexImage" and n.image and n.name != "_kit_bake_target":
                    res[n.image.name] = tuple(n.image.size)
    return res


def check_budget(budget, tris, tex, nbytes, key=""):
    warns = []
    if budget not in BUDGETS:
        return warns
    (tmin, tmax), tsize, mb = BUDGETS[budget]
    if tris > tmax:
        warns.append(f"{key}: {tris} triangles > budget {tmax} ({budget})")
    elif tris < tmin:
        warns.append(f"{key}: only {tris} triangles (< {tmin} for {budget}) - is the model detailed enough?")
    for n, (w, h) in tex.items():
        if max(w, h) > tsize:
            warns.append(f"{key}: texture {n} {w}x{h} > {tsize} ({budget})")
    if nbytes > mb * 1024 * 1024:
        warns.append(f"{key}: GLB {nbytes / 1048576:.2f} MB > {mb} MB ({budget})")
    return warns


def export_glb(key, out_dir=None, objects=None, budget=None, animations=True, quality=82, tangents=True, suffix=""):
    """Export `objects` (default: exportable_objects()) to <out_dir>/<key><suffix>.glb (WebP textures).
    Armatures are exported in rest pose with every Action (clip names = Action names)."""
    out_dir = out_dir or MODELS
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f"{key}{suffix}.glb")
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    objs = objects if objects is not None else exportable_objects()
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
        if o.type == "ARMATURE":
            for c in o.children:
                if c.type == "MESH" and c not in objs and not c.get("kit_template"):
                    c.select_set(True)
    for a in bpy.data.actions:
        a.use_fake_user = True
    for o in bpy.context.scene.objects:
        if o.type == "ARMATURE":
            if o.animation_data:
                o.animation_data.action = None
            for pb in o.pose.bones:
                pb.location = (0, 0, 0)
                pb.rotation_quaternion = (1, 0, 0, 0)
                pb.rotation_euler = (0, 0, 0)
                pb.scale = (1, 1, 1)
    bpy.context.scene.frame_set(bpy.context.scene.frame_start)
    has_arm = any(o.type == "ARMATURE" for o in objs)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=tangents,
        export_attributes=False,
        export_image_format="WEBP",
        export_image_quality=quality,
        export_materials="EXPORT",
        export_animations=animations and has_arm,
        export_animation_mode="ACTIONS",
        export_anim_single_armature=True,
        export_force_sampling=True,
        export_optimize_animation_size=True,
        export_skins=True,
        export_def_bones=False,
        export_cameras=False,
        export_lights=False,
        export_extras=False,
    )
    nbytes = os.path.getsize(path)
    meshes = [o for o in objs if o.type == "MESH"] + [c for o in objs if o.type == "ARMATURE" for c in o.children if c.type == "MESH"]
    meshes = list(dict.fromkeys(meshes))
    tris = triangles(meshes)
    tex = textures(meshes)
    warns = check_budget(budget, tris, tex, nbytes, key + suffix) if budget else []
    print(f"[export] {path}  {nbytes / 1024:.0f} KB  {tris} tris  textures={tex}")
    for w in warns:
        print(f"[export] WARN {w}")
    return {"path": path, "bytes": nbytes, "tris": tris, "textures": tex, "warnings": warns}
