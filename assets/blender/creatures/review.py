"""Review tools for the `creatures` group.

* contact_sheet(): renders several frames of every clip with a FIXED camera and a ground disc, then stitches
  them into one PNG grid (rows = clips) so poses, ground contact and motion amplitude can be checked at once.
* ground_report(): prints the lowest / highest evaluated vertex Z for each clip (feet on the ground?).
"""
import math
import os
import tempfile

import bpy
import numpy as np
from mathutils import Vector


def _mesh_objs():
    return [o for o in bpy.context.scene.objects if o.type == "MESH" and not o.name.startswith("_")]


def _eval_bounds(objs):
    dg = bpy.context.evaluated_depsgraph_get()
    mn = Vector((1e9, 1e9, 1e9))
    mx = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        for v in me.vertices:
            w = ev.matrix_world @ v.co
            for i in range(3):
                mn[i] = min(mn[i], w[i])
                mx[i] = max(mx[i], w[i])
        ev.to_mesh_clear()
    return mn, mx


def _set_action(rig, name):
    rig.animation_data_create()
    act = bpy.data.actions.get(name)
    rig.animation_data.action = act
    if act is not None and hasattr(rig.animation_data, "action_slot") and act.slots:
        rig.animation_data.action_slot = act.slots[0]


def ground_report(rig, clips):
    objs = _mesh_objs()
    lines = []
    for name in clips:
        act = bpy.data.actions.get(name)
        _set_action(rig, name)
        f0, f1 = int(act.frame_range[0]), int(act.frame_range[1])
        lows, highs = [], []
        for f in range(f0, f1 + 1):
            bpy.context.scene.frame_set(f)
            mn, mx = _eval_bounds(objs)
            lows.append(mn.z)
            highs.append(mx.z)
        fl = f0 + lows.index(min(lows))
        lines.append(f"  {name:7s} frames {f0}-{f1}: minZ {min(lows):+.3f}(f{fl})..{max(lows):+.3f}  maxZ {min(highs):.2f}..{max(highs):.2f}"
                     f"  first/last minZ {lows[0]:+.3f}/{lows[-1]:+.3f}  final bbox x {mn.x:+.2f}..{mx.x:+.2f} y {mn.y:+.2f}..{mx.y:+.2f}")
    rig.animation_data.action = None
    bpy.context.scene.frame_set(0)
    print("[ground]\n" + "\n".join(lines))
    return lines


def _render_fixed(path, centre, radius, yaw_deg, pitch_deg, size):
    scene = bpy.context.scene
    temp = []
    cam_data = bpy.data.cameras.new("_RevCam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = radius * 2
    cam_data.clip_end = radius * 60
    cam = bpy.data.objects.new("_RevCam", cam_data)
    scene.collection.objects.link(cam)
    yaw, pitch = math.radians(yaw_deg), math.radians(pitch_deg)
    d = Vector((math.sin(yaw) * math.cos(pitch), -math.cos(yaw) * math.cos(pitch), math.sin(pitch)))
    cam.location = centre + d * radius * 12
    cam.rotation_euler = (centre - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam
    temp.append(cam)
    for nm, rot, energy, col in (("_RKey", (math.radians(50), 0, math.radians(-35)), 3.5, (1.0, 0.96, 0.9)),
                                 ("_RFill", (math.radians(60), 0, math.radians(140)), 1.2, (0.8, 0.88, 1.0))):
        ld = bpy.data.lights.new(nm, "SUN")
        ld.energy = energy
        ld.color = col
        lo = bpy.data.objects.new(nm, ld)
        scene.collection.objects.link(lo)
        lo.rotation_euler = rot
        temp.append(lo)
    world = scene.world or bpy.data.worlds.new("_RevWorld")
    scene.world = world
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs["Color"].default_value = (0.45, 0.47, 0.52, 1)
        bg.inputs["Strength"].default_value = 0.8
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "Standard"
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    for o in temp:
        data = o.data
        bpy.data.objects.remove(o, do_unlink=True)
        if isinstance(data, bpy.types.Camera):
            bpy.data.cameras.remove(data)
        else:
            bpy.data.lights.remove(data)


def _rest(rig):
    rig.animation_data_create()
    rig.animation_data.action = None
    for pb in rig.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.scale = (1, 1, 1)
    bpy.context.view_layer.update()


def contact_sheet(key, rig, rows, out_dir, size=200, yaw=35, pitch=15, extra_margin=0.95, ground_r=None, suffix="",
                  name=None):
    """rows: [(clip_name, [frames...]), ...]. Writes <out_dir>/<name or key_sheet+suffix>.png."""
    os.makedirs(out_dir, exist_ok=True)
    objs = _mesh_objs()
    _rest(rig)
    bpy.context.scene.frame_set(0)
    mn, mx = _eval_bounds(objs)
    centre = (mn + mx) / 2
    radius = (mx - mn).length / 2 * extra_margin
    # ground disc for contact reading
    gmat = bpy.data.materials.new("_ground")
    gmat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.25, 0.3, 0.22, 1)
    bpy.ops.mesh.primitive_circle_add(vertices=48, radius=ground_r or radius * 1.2, fill_type="NGON")
    ground = bpy.context.object
    ground.name = "_ground"
    ground.data.materials.append(gmat)
    tiles = []
    tile = os.path.join(tempfile.gettempdir(), f"_creature_tile_{key}_{os.getpid()}.png")
    cols = max(len(fr) for _, fr in rows)
    for clip, frames in rows:
        _set_action(bpy.data.objects["Rig"], clip)
        row = []
        for f in frames:
            bpy.context.scene.frame_set(f)
            p = tile
            _render_fixed(p, centre, radius, yaw, pitch, size)
            img = bpy.data.images.load(p)
            px = np.array(img.pixels[:], dtype=np.float32).reshape(size, size, 4)
            bpy.data.images.remove(img)
            row.append(px)
        while len(row) < cols:  # pad with the background colour (top-left pixel of the first tile)
            row.append(np.broadcast_to(row[0][-1, 0], (size, size, 4)).copy())
        tiles.append(np.concatenate(row, axis=1))
    bpy.data.objects["Rig"].animation_data.action = None
    bpy.data.objects.remove(ground, do_unlink=True)
    sheet = np.concatenate(tiles[::-1], axis=0)  # image rows are bottom-up
    h, w = sheet.shape[:2]
    out = bpy.data.images.new(f"_sheet_{key}", w, h, alpha=True)
    out.pixels[:] = sheet.ravel()
    path = os.path.join(out_dir, f"{name}.png" if name else f"{key}_sheet{suffix}.png")
    out.filepath_raw = path
    out.file_format = "PNG"
    out.save()
    bpy.data.images.remove(out)
    try:
        os.remove(tile)
    except OSError:
        pass
    bpy.context.scene.frame_set(0)
    print(f"[sheet] {path}")
    return path
