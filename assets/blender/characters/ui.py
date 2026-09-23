"""UI art for the three classes: class_<cls>.png (512, full body) and portrait_<cls>.png (256, head & shoulders),
transparent background, dramatic dark-fantasy lighting (warm low key, strong rim, cool fill), EEVEE + AgX."""
import math
import os

import bpy
from mathutils import Vector

from kit import gpu
from kit.nodes import NB


def _light(tmp, name, energy, color, elev, yaw, angle=2.0, typ="SUN", size=1.0, loc=None):
    ld = bpy.data.lights.new(name, typ)
    ld.energy = energy
    ld.color = color
    if typ == "SUN":
        ld.angle = math.radians(angle)
    else:
        ld.shadow_soft_size = size
    lo = bpy.data.objects.new(name, ld)
    y, p = math.radians(yaw), math.radians(elev)
    d = Vector((math.sin(y) * math.cos(p), -math.cos(y) * math.cos(p), math.sin(p)))
    lo.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    if loc is not None:
        lo.location = loc
    bpy.context.scene.collection.objects.link(lo)
    tmp += [lo, ld]
    return lo


def _eval_pts(obj):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    me = ev.to_mesh()
    pts = [obj.matrix_world @ v.co for v in me.vertices]
    ev.to_mesh_clear()
    return pts


def _pose(rig, action, frame):
    act = bpy.data.actions.get(action)
    rig.animation_data_create()
    rig.animation_data.action = act
    try:
        if act is not None and act.slots:
            rig.animation_data.action_slot = act.slots[0]
    except AttributeError:
        pass
    bpy.context.scene.frame_set(frame)


def _shoot(path, size, cam_loc, target, lens):
    sc = bpy.context.scene
    cd = bpy.data.cameras.new("_UICam")
    cd.lens = lens
    cd.sensor_width = 36
    cd.clip_start = 0.02
    cam = bpy.data.objects.new("_UICam", cd)
    sc.collection.objects.link(cam)
    cam.location = cam_loc
    cam.rotation_euler = (Vector(target) - Vector(cam_loc)).to_track_quat("-Z", "Y").to_euler()
    sc.camera = cam
    sc.render.resolution_x = sc.render.resolution_y = size
    sc.render.filepath = path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)
    bpy.data.cameras.remove(cd)
    print(f"[ui] {path}")


def render_class(ctx, obj, class_path, portrait_path, action="Idle", frame=10, yaw=28.0):
    rig = ctx.rig
    sc = bpy.context.scene
    tmp = []
    saved = dict(engine=sc.render.engine, world=sc.world, transp=sc.render.film_transparent,
                 vt=sc.view_settings.view_transform, look=sc.view_settings.look, camera=sc.camera)
    sc.render.engine = "BLENDER_EEVEE"
    sc.eevee.taa_render_samples = 64
    for k, v in (("use_shadows", True), ("use_raytracing", True), ("use_fast_gi", True)):
        try:
            setattr(sc.eevee, k, v)
        except (AttributeError, TypeError):
            pass
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.view_settings.view_transform = "AgX"
    try:
        sc.view_settings.look = "AgX - Punchy"
    except TypeError:
        pass
    w = bpy.data.worlds.new("_UIWorld")
    nb = NB(w.node_tree, clear=True)
    out = nb.node("ShaderNodeOutputWorld")
    bg = nb.node("ShaderNodeBackground")
    bg.inputs["Color"].default_value = (0.05, 0.055, 0.07, 1)
    bg.inputs["Strength"].default_value = 0.35
    nb.link(bg.outputs[0], out.inputs["Surface"])
    sc.world = w
    tmp.append(w)
    # golden low key from the front-left, hard rim from behind-right, cool fill, faint top
    _light(tmp, "_UIKey", 3.4, (1.0, 0.78, 0.52), 24, yaw - 55, 3.0)
    _light(tmp, "_UIRim", 6.0, (1.0, 0.86, 0.66), 18, yaw + 160, 1.5)
    _light(tmp, "_UIRim2", 2.5, (0.55, 0.7, 1.0), 30, yaw - 170, 2.0)
    _light(tmp, "_UIFill", 0.6, (0.5, 0.62, 1.0), 10, yaw + 70, 6.0)
    _pose(rig, action, frame)
    bpy.context.view_layer.update()
    pts = _eval_pts(obj)
    y = math.radians(yaw)
    d = Vector((math.sin(y), -math.cos(y), 0.12)).normalized()
    with gpu.lock_only(wait=120):
        # full body
        zmin = min(p.z for p in pts)
        zmax = max(p.z for p in pts)
        right = Vector((math.cos(y), math.sin(y), 0))
        xs = [p.dot(right) for p in pts]
        cx = (min(xs) + max(xs)) / 2
        centre = right * cx + Vector((0, 0, (zmin + zmax) / 2))
        ext = max(zmax - zmin, max(xs) - min(xs)) * 1.12
        lens = 70.0
        dist = (ext / 2) / math.tan(math.atan(18 / lens))
        _shoot(class_path, 512, centre + d * dist, centre, lens)
        # portrait: head & shoulders from the head bone
        pb = rig.pose.bones["head"]
        hh = rig.matrix_world @ pb.head
        ht = rig.matrix_world @ pb.tail
        face = hh.lerp(ht, 0.42)
        centre = face + Vector((0, 0, -0.07))
        ext = 0.52
        lens = 85.0
        dist = (ext / 2) / math.tan(math.atan(18 / lens))
        yd = math.radians(yaw * 0.7)
        d2 = Vector((math.sin(yd), -math.cos(yd), 0.06)).normalized()
        _shoot(portrait_path, 256, centre + d2 * dist, centre, lens)
    # restore
    rig.animation_data.action = None
    for pbn in rig.pose.bones:
        pbn.location = (0, 0, 0)
        pbn.rotation_quaternion = (1, 0, 0, 0)
    for k in tmp:
        try:
            if isinstance(k, bpy.types.Object):
                bpy.data.objects.remove(k, do_unlink=True)
            elif isinstance(k, bpy.types.Light):
                bpy.data.lights.remove(k)
            elif isinstance(k, bpy.types.World):
                bpy.data.worlds.remove(k)
        except ReferenceError:
            pass
    sc.render.engine = saved["engine"]
    sc.world = saved["world"]
    sc.render.film_transparent = saved["transp"]
    sc.view_settings.view_transform = saved["vt"]
    sc.camera = saved["camera"]
