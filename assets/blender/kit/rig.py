"""Rigging / skinning / keying helpers for skinned models (Blender 5.0).

    arm = rig.humanoid_armature(height=1.8)                     # SPEC bone names, root at the feet
    rig.bind(body, arm)                                           # automatic (heat) weights + smoothing, <=4 influences
    rig.transfer_weights(body_src, robe, arm, smooth=12)          # clothing follows the body smoothly
    rig.clip(arm, "Walk", [(1, POSE_A), (7, POSE_B), (13, POSE_A_MIRROR), ...], cyclic=True)

Poses are dicts {bone: (x_deg, y_deg, z_deg)} (Euler XYZ in the bone's local space, converted to quaternions),
optionally {bone: {"rot": (..), "loc": (..)}}. Every clip keys EVERY deforming bone at every key so clips never
inherit poses from each other. Actions are one per clip (exported with export_animation_mode='ACTIONS').
"""
import math

import bpy
import mathutils
import numpy as np

HUMANOID = ["root", "hips", "spine", "chest", "neck", "head", "upper_arm.L", "forearm.L", "hand.L", "upper_arm.R",
            "forearm.R", "hand.R", "thigh.L", "shin.L", "foot.L", "thigh.R", "shin.R", "foot.R"]


def humanoid_joints(height=1.8, shoulder=0.2, hip=0.1, arm_drop=50.0):
    """Joint positions (metres) for an A-pose humanoid facing -Y. arm_drop = arm angle below horizontal (deg)."""
    s = height / 1.8
    J = {
        "root": ((0, 0, 0), (0, 0.0, 0.25 * s)),
        "hips": ((0, 0, 0.98 * s), (0, 0, 1.1 * s)),
        "spine": ((0, 0, 1.1 * s), (0, 0, 1.28 * s)),
        "chest": ((0, 0, 1.28 * s), (0, 0, 1.46 * s)),
        "neck": ((0, 0, 1.46 * s), (0, -0.01 * s, 1.56 * s)),
        "head": ((0, -0.01 * s, 1.56 * s), (0, -0.01 * s, 1.8 * s)),
    }
    a = math.radians(arm_drop)
    for side, sg in (("L", 1), ("R", -1)):
        sh = mathutils.Vector((sg * shoulder * s, 0.0, 1.42 * s))
        d = mathutils.Vector((sg * math.cos(a), 0.0, -math.sin(a)))
        el = sh + d * 0.29 * s
        wr = el + d * 0.26 * s + mathutils.Vector((0, -0.02 * s, 0))
        hd = wr + d * 0.17 * s
        J[f"upper_arm.{side}"] = (tuple(sh), tuple(el))
        J[f"forearm.{side}"] = (tuple(el), tuple(wr))
        J[f"hand.{side}"] = (tuple(wr), tuple(hd))
        J[f"thigh.{side}"] = ((sg * hip * s, 0, 0.95 * s), (sg * hip * s, -0.01 * s, 0.52 * s))
        J[f"shin.{side}"] = ((sg * hip * s, -0.01 * s, 0.52 * s), (sg * hip * s, 0.02 * s, 0.09 * s))
        J[f"foot.{side}"] = ((sg * hip * s, 0.02 * s, 0.09 * s), (sg * hip * s, -0.14 * s, 0.03 * s))
    return J


_PARENT = {"hips": "root", "spine": "hips", "chest": "spine", "neck": "chest", "head": "neck",
           "upper_arm.L": "chest", "forearm.L": "upper_arm.L", "hand.L": "forearm.L",
           "upper_arm.R": "chest", "forearm.R": "upper_arm.R", "hand.R": "forearm.R",
           "thigh.L": "hips", "shin.L": "thigh.L", "foot.L": "shin.L",
           "thigh.R": "hips", "shin.R": "thigh.R", "foot.R": "shin.R"}


def armature(joints, parents, name="Rig", deform_root=False):
    """Create an armature from {bone: (head, tail)} and {bone: parent}. Bones get a sensible roll (Z up/forward)."""
    ad = bpy.data.armatures.new(name)
    arm = bpy.data.objects.new(name, ad)
    bpy.context.scene.collection.objects.link(arm)
    for o in bpy.context.scene.objects:
        o.select_set(False)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    for bn, (h, t) in joints.items():
        eb = ad.edit_bones.new(bn)
        eb.head, eb.tail = h, t
        v = mathutils.Vector(t) - mathutils.Vector(h)
        eb.align_roll(mathutils.Vector((0, -1, 0)) if abs(v.normalized().z) > 0.7 else mathutils.Vector((0, 0, 1)))
    for bn, p in parents.items():
        if bn in ad.edit_bones and p in ad.edit_bones:
            ad.edit_bones[bn].parent = ad.edit_bones[p]
            ad.edit_bones[bn].use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    if "root" in ad.bones and not deform_root:
        ad.bones["root"].use_deform = False
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
    return arm


def humanoid_armature(height=1.8, name="Rig", **kw):
    return armature(humanoid_joints(height, **kw), _PARENT, name)


# =============================================================================== weights
def _adjacency(me):
    n = len(me.vertices)
    e = np.empty(len(me.edges) * 2, dtype=np.int64)
    me.edges.foreach_get("vertices", e)
    e = e.reshape(-1, 2)
    return n, e


def weights_array(obj, names):
    """(n_verts x n_groups) weight matrix for the given group names."""
    me = obj.data
    W = np.zeros((len(me.vertices), len(names)), dtype=np.float64)
    gi = {obj.vertex_groups[n].index: j for j, n in enumerate(names) if n in obj.vertex_groups}
    for v in me.vertices:
        for g in v.groups:
            j = gi.get(g.group)
            if j is not None:
                W[v.index, j] = g.weight
    return W


def set_weights(obj, names, W, limit=4, eps=0.01):
    """Write a weight matrix back: keep the `limit` largest per vertex, normalise, drop tiny ones."""
    W = W.copy()
    if limit and W.shape[1] > limit:
        idx = np.argsort(-W, axis=1)[:, limit:]
        np.put_along_axis(W, idx, 0.0, axis=1)
    W[W < eps] = 0.0
    s = W.sum(axis=1, keepdims=True)
    W = np.where(s > 0, W / np.maximum(s, 1e-12), W)
    for n in names:
        if n in obj.vertex_groups:
            obj.vertex_groups.remove(obj.vertex_groups[n])
    groups = [obj.vertex_groups.new(name=n) for n in names]
    for j, g in enumerate(groups):
        col = W[:, j]
        nz = np.nonzero(col)[0]
        # group by identical weights is overkill; add per vertex
        for i in nz:
            g.add([int(i)], float(col[i]), "REPLACE")
    return W


def smooth_weights(obj, names, iterations=4, factor=0.5, limit=4):
    """Laplacian smoothing of skin weights over mesh edges (numpy), then normalise + limit influences."""
    n, e = _adjacency(obj.data)
    W = weights_array(obj, names)
    has = W.sum(axis=1) > 0
    for _ in range(iterations):
        acc = np.zeros_like(W)
        cnt = np.zeros(n)
        np.add.at(acc, e[:, 0], W[e[:, 1]])
        np.add.at(acc, e[:, 1], W[e[:, 0]])
        np.add.at(cnt, e[:, 0], 1)
        np.add.at(cnt, e[:, 1], 1)
        avg = acc / np.maximum(cnt, 1)[:, None]
        W = np.where(cnt[:, None] > 0, W * (1 - factor) + avg * factor, W)
        s = W.sum(axis=1, keepdims=True)
        W = np.where(s > 0, W / np.maximum(s, 1e-12), W)
    W[~has & (W.sum(axis=1) == 0)] = 0
    return set_weights(obj, names, W, limit)


def deform_bones(arm):
    return [b.name for b in arm.data.bones if b.use_deform]


def _add_armature_mod(obj, arm):
    for md in obj.modifiers:
        if md.type == "ARMATURE":
            md.object = arm
            return md
    md = obj.modifiers.new("Armature", "ARMATURE")
    md.object = arm
    md.use_deform_preserve_volume = False
    return md


def bind(mesh, arm, smooth=3, factor=0.5, limit=4):
    """Automatic (bone heat) weights; falls back to envelope weights; then smooth + normalise + limit.
    Parents the mesh to the armature (keep transform) and adds an Armature modifier."""
    for o in bpy.context.scene.objects:
        o.select_set(False)
    mesh.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    try:
        bpy.ops.object.parent_set(type="ARMATURE_AUTO", keep_transform=True)
    except RuntimeError as e:
        print(f"[rig] auto weights failed ({e}), using envelopes")
        bpy.ops.object.parent_set(type="ARMATURE_ENVELOPE", keep_transform=True)
    names = deform_bones(arm)
    W = weights_array(mesh, names)
    empty = int((W.sum(axis=1) == 0).sum())
    if empty:
        print(f"[rig] {mesh.name}: {empty} verts without weights -> nearest-bone fallback")
        _nearest_bone_fill(mesh, arm, names, W)
    if smooth:
        smooth_weights(mesh, names, smooth, factor, limit)
    _add_armature_mod(mesh, arm)
    return mesh


def _nearest_bone_fill(mesh, arm, names, W):
    mw = mesh.matrix_world
    segs = []
    for n in names:
        b = arm.data.bones[n]
        segs.append((arm.matrix_world @ b.head_local, arm.matrix_world @ b.tail_local))
    for v in mesh.data.vertices:
        if W[v.index].sum() > 0:
            continue
        p = mw @ v.co
        best, bj = 1e9, 0
        for j, (a, b) in enumerate(segs):
            q, t = mathutils.geometry.intersect_point_line(p, a, b)
            t = min(max(t, 0), 1)
            d = (p - a.lerp(b, t)).length
            if d < best:
                best, bj = d, j
        W[v.index, bj] = 1.0
    set_weights(mesh, names, W)


def transfer_weights(src, dst, arm, smooth=10, factor=0.6, limit=4, mix_groups=None):
    """Copy skin weights from `src` (the body, ideally BEFORE deleting hidden parts) to clothing `dst`
    (nearest face interpolated), then smooth strongly so the cloth moves as one piece (no tearing between legs).
    mix_groups: {group: [groups to blend into it]} e.g. {"thigh.L": ["thigh.R"]} is NOT needed normally."""
    for g in list(dst.vertex_groups):
        dst.vertex_groups.remove(g)
    for g in src.vertex_groups:
        dst.vertex_groups.new(name=g.name)
    md = dst.modifiers.new("KitDT", "DATA_TRANSFER")
    md.object = src
    md.use_vert_data = True
    md.data_types_verts = {"VGROUP_WEIGHTS"}
    md.vert_mapping = "POLYINTERP_NEAREST"
    md.layers_vgroup_select_src = "ALL"
    md.layers_vgroup_select_dst = "NAME"
    for o in bpy.context.scene.objects:
        o.select_set(False)
    dst.select_set(True)
    bpy.context.view_layer.objects.active = dst
    # the data transfer must be first in the stack to be applied
    while dst.modifiers[0] != md:
        bpy.ops.object.modifier_move_up(modifier=md.name)
    bpy.ops.object.modifier_apply(modifier=md.name)
    names = deform_bones(arm)
    if smooth:
        smooth_weights(dst, names, smooth, factor, limit)
    if dst.parent != arm:
        mw = dst.matrix_world.copy()
        dst.parent = arm
        dst.matrix_world = mw
    _add_armature_mod(dst, arm)
    # armature modifier must come before solidify etc.
    while dst.modifiers[0].type != "ARMATURE":
        bpy.ops.object.modifier_move_up(modifier=[m for m in dst.modifiers if m.type == "ARMATURE"][0].name)
    return dst


# =============================================================================== animation
def _q(rot):
    if len(rot) == 4:
        return mathutils.Quaternion(rot)
    return mathutils.Euler(tuple(math.radians(a) for a in rot), "XYZ").to_quaternion()


def pose(arm, p):
    """Apply a pose dict to the armature (unlisted bones -> rest)."""
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
        v = p.get(pb.name)
        rot, loc = (0, 0, 0), (0, 0, 0)
        if isinstance(v, dict):
            rot, loc = v.get("rot", rot), v.get("loc", loc)
        elif v is not None:
            rot = v
        pb.rotation_quaternion = _q(rot)
        pb.location = loc
        pb.scale = (1, 1, 1)


def clip(arm, name, keys, cyclic=False, interpolation="BEZIER", fps=24):
    """Create Action `name` from [(frame, pose_dict), ...] at 24 fps. Frames are shifted so the first key is frame 0
    (clip duration = last frame / fps). cyclic=True: end the list with ("loop", frame) to repeat the first pose there."""
    arm.animation_data_create()
    old = bpy.data.actions.get(name)
    if old is not None:
        bpy.data.actions.remove(old)
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    arm.animation_data.action = act
    ks = list(keys)
    if cyclic and ks and ks[-1][0] == "loop":
        ks = ks[:-1] + [(keys[-1][1], ks[0][1])]
    # glTF clip time 0 = frame 0: shift so the first key is frame 0 (exact durations, no loop hitch)
    f0 = ks[0][0]
    ks = [(f - f0, p) for f, p in ks]
    for f, p in ks:
        pose(arm, p)
        for pb in arm.pose.bones:
            pb.keyframe_insert("rotation_quaternion", frame=f, group=pb.name)
            pb.keyframe_insert("location", frame=f, group=pb.name)
    _set_interp(act, interpolation)
    act.use_frame_range = True
    act.frame_start, act.frame_end = ks[0][0], ks[-1][0]
    if cyclic:
        act.use_cyclic = True
    arm.animation_data.action = None
    pose(arm, {})
    return act


def _fcurves(act):
    try:
        return list(act.fcurves)
    except AttributeError:
        out = []
        for layer in act.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    out += list(bag.fcurves)
        return out


def _set_interp(act, interp):
    for fc in _fcurves(act):
        for kp in fc.keyframe_points:
            kp.interpolation = interp
            if interp == "BEZIER":
                kp.handle_left_type = kp.handle_right_type = "AUTO_CLAMPED"


def mirror_pose(p):
    """Swap .L/.R and mirror Y/Z rotations (for walk cycles)."""
    out = {}
    for k, v in p.items():
        k2 = k.replace(".L", ".TMP").replace(".R", ".L").replace(".TMP", ".R")
        if isinstance(v, dict):
            r = v.get("rot", (0, 0, 0))
            out[k2] = {"rot": (r[0], -r[1], -r[2]), "loc": v.get("loc", (0, 0, 0))}
        else:
            out[k2] = (v[0], -v[1], -v[2])
    return out
