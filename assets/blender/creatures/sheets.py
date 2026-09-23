"""Creature pose sheets (group `creatures`): every clip x N frames, framed PER CLIP (the kit's union framing made the
creature tiny because Death / Attack2 travel), from a 3/4 view and from the side (ground contact, leg motion).

    <key>_poses.png       3/4 front view (yaw 35)
    <key>_poses_side.png  side view (yaw 90, low camera) - feet on the ground line, spine / tail arcs
"""
import os

import bpy
import mathutils

from kit import gpu, render


def _set_action(arm, act):
    arm.animation_data_create()
    arm.animation_data.action = act
    try:
        if act is not None and act.slots:
            arm.animation_data.action_slot = act.slots[0]
    except AttributeError:
        pass


def _rest(arm):
    for pb in arm.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.scale = (1, 1, 1)


def pose_sheets(key, meshes, arm, out_dir, frames=6, size=250, views=(("poses", 35.0, 12.0), ("poses_side", 90.0, 3.0))):
    sc = bpy.context.scene
    acts = sorted(bpy.data.actions, key=lambda a: a.name)
    _set_action(arm, None)
    _rest(arm)
    sc.frame_set(0)
    rmn, rmx = render.bbox(meshes)
    rest_r = (rmx - rmn).length / 2
    plan = []
    for act in acts:
        _set_action(arm, act)
        f0, f1 = act.frame_range
        fr = [f0 + (f1 - f0) * k / (frames - 1) for k in range(frames)]
        mn = mathutils.Vector((1e9,) * 3)
        mx = mathutils.Vector((-1e9,) * 3)
        for f in fr:
            sc.frame_set(int(round(f)))
            a, b = render.bbox(meshes)
            mn = mathutils.Vector(map(min, mn, a))
            mx = mathutils.Vector(map(max, mx, b))
        # never zoom in closer than the rest pose: sizes stay comparable between clips
        c = (mn + mx) / 2
        r = max((mx - mn).length / 2, rest_r)
        h = mathutils.Vector((r, r, r)) / 3 ** 0.5
        plan.append((act, fr, c - h, c + h))
    out = {}
    vl = bpy.context.view_layer
    with gpu.lock_only(wait=120):
        with render.Stage(ground=True) as st:
            vl.material_override = None
            for name, yaw, pitch in views:
                tiles = []
                for act, fr, mn, mx in plan:
                    _set_action(arm, act)
                    for f in fr:
                        sc.frame_set(int(round(f)))
                        st.frame(mn, mx, yaw, pitch, margin=0.86)
                        t = render.over_bg(st.shoot(size))
                        render.draw_text(t, f"{act.name} {int(round(f))}", 5, 5, 2)
                        tiles.append(t)
                sheet = render.grid(tiles, frames)
                render.draw_text(sheet, f"{key} {name.upper().replace('_', ' ')}", 8, 8, 3)
                out[name] = render.save_png(sheet, os.path.join(out_dir, f"{key}_{name}.png"))
    _set_action(arm, None)
    _rest(arm)
    sc.frame_set(0)
    return out
