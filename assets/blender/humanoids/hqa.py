"""Extra QA sheets for the humanoids group (on top of kit.render.qa_sheets):
    closeups(key, objs, out_dir, shots)  -> <key>_closeup.png : head / hands / props close-ups (baked materials)
    clip_timing(arm)                      -> {clip: seconds}
"""
import os

import bpy
import mathutils

from kit import gpu, render


def closeups(key, objs, out_dir, shots, size=360, action=None, frame=None):
    """shots = [(label, centre(x,y,z), radius, yaw, pitch), ...]"""
    meshes = [o for o in objs if o.type == "MESH"]
    arm = next((m.object for o in meshes for m in o.modifiers if m.type == "ARMATURE" and m.object), None)
    tiles = []
    with gpu.lock_only(wait=120):
        with render.Stage(ground=False) as st:
            if action and arm is not None:
                render._set_action(arm, bpy.data.actions.get(action))
                bpy.context.scene.frame_set(frame or 0)
            for label, c, r, yaw, pitch in shots:
                c = mathutils.Vector(c)
                st.frame(c - mathutils.Vector((r, r, r)), c + mathutils.Vector((r, r, r)), yaw, pitch, margin=0.62)
                t = render.over_bg(st.shoot(size))
                render.draw_text(t, label, 6, 6, 2)
                tiles.append(t)
            if action and arm is not None:
                render._set_action(arm, None)
                render._rest(arm)
    sheet = render.grid(tiles, min(4, len(tiles)))
    render.draw_text(sheet, f"{key} CLOSE-UPS", 8, 8, 3)
    return render.save_png(sheet, os.path.join(out_dir, f"{key}_closeup.png"))


def posed_turntable(key, objs, out_dir, action="Idle", frame=12, size=320, pitch=12.0):
    """8-angle turntable in a clip pose (weapons held as in game) -> <key>_turntable_posed.png."""
    meshes = [o for o in objs if o.type == "MESH"]
    arm = next((m.object for o in meshes for m in o.modifiers if m.type == "ARMATURE" and m.object), None)
    with gpu.lock_only(wait=120):
        with render.Stage(ground=True) as st:
            if arm is not None and bpy.data.actions.get(action):
                render._set_action(arm, bpy.data.actions.get(action))
                bpy.context.scene.frame_set(frame)
            mn, mx = render.bbox(meshes)
            tiles = []
            for i in range(8):
                yaw = i * 45.0
                st.frame(mn, mx, yaw, pitch)
                t = render.over_bg(st.shoot(size))
                render.draw_text(t, f"{int(yaw)}", 6, 6, 2)
                tiles.append(t)
            if arm is not None:
                render._set_action(arm, None)
                render._rest(arm)
    sheet = render.grid(tiles, 4)
    render.draw_text(sheet, f"{key} TURNTABLE {action.upper()} {frame}", 8, 8, 3)
    return render.save_png(sheet, os.path.join(out_dir, f"{key}_turntable_posed.png"))


def key_poses(key, objs, out_dir, poses, yaws=(0.0, 90.0), size=260, pitch=8.0):
    """Key frames of the attacks / specials seen from the front and the side (a row per view)
    -> <key>_keyposes.png. poses = [(action, frame), ...]"""
    meshes = [o for o in objs if o.type == "MESH"]
    arm = next((m.object for o in meshes for m in o.modifiers if m.type == "ARMATURE" and m.object), None)
    if arm is None or not poses:
        return None
    sc = bpy.context.scene
    mn = mathutils.Vector((1e9,) * 3)
    mx = mathutils.Vector((-1e9,) * 3)
    for act, f in poses:
        render._set_action(arm, bpy.data.actions.get(act))
        sc.frame_set(int(f))
        a, b = render.bbox(meshes)
        mn = mathutils.Vector(map(min, mn, a))
        mx = mathutils.Vector(map(max, mx, b))
    tiles = []
    with gpu.lock_only(wait=120):
        with render.Stage(ground=True) as st:
            for yaw in yaws:
                for act, f in poses:
                    render._set_action(arm, bpy.data.actions.get(act))
                    sc.frame_set(int(f))
                    st.frame(mn, mx, yaw, pitch, margin=1.02)
                    t = render.over_bg(st.shoot(size))
                    render.draw_text(t, f"{act} {f} Y{int(yaw)}", 5, 5, 2)
                    tiles.append(t)
            render._set_action(arm, None)
            render._rest(arm)
    sheet = render.grid(tiles, len(poses))
    render.draw_text(sheet, f"{key} KEY POSES", 8, 8, 3)
    return render.save_png(sheet, os.path.join(out_dir, f"{key}_keyposes.png"))
