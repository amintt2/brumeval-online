"""v0.2 humanoid pipeline (Blender 5.0, headless) on top of the shared kit.

    rig, P0, J = pipeline.setup(L)            # rig with the SPEC bones, then re-rested in the A-pose (bind pose)
    ... body (anatomy), clothes (garments), rigid gear authored in the ARMS-DOWN frame and moved with to_bind() ...
    pipeline.skin(rig, body, clothes, rigid)  # smooth weights; clothes get the body weights (smoothed)
    pipeline.finish_bind(...)                 # hide body under clothes, bake, then back to the arms-down rest
    P = H.Poser(rig, L)                       # the v0.1 character-space poser + IK drives every clip

Why: automatic weights and clothing are much cleaner when the arms are away from the torso (A-pose), while the
v0.1 clip authoring (humanoid.Poser specs) is relative to the arms-down rest. The rest pose is therefore changed
once, after baking, by applying the armature deformation (exactly what the game would do at runtime).
"""
import math
import os

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

import humanoid as H

APOSE = 42.0         # degrees of arm abduction from the arms-down rest for the bind pose


def joints(rig):
    return {b.name: (tuple(rig.matrix_world @ b.head_local), tuple(rig.matrix_world @ b.tail_local)) for b in rig.data.bones}


def _pose_mode(rig):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig


def _apply_pose_as_rest(rig):
    _pose_mode(rig)
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.select_all(action="SELECT")
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in rig.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)


def apose_spec(angle=APOSE):
    return {"upper_arm.L": H.arm_r("L", 0, angle), "upper_arm.R": H.arm_r("R", 0, angle)}


def setup(L, angle=APOSE):
    """Build the rig (arms-down layout of humanoid.build_rig), keep a Poser of that layout (P0) to author rigid gear,
    then re-rest the rig in the A-pose. Returns (rig, P0, J_apose, bind) where bind(bone) maps arms-down geometry of
    that bone into the A-pose."""
    rig = H.build_rig(L)
    rig.data.bones["root"].use_deform = False
    for pb in rig.pose.bones:
        pb.rotation_mode = "QUATERNION"
    P0 = H.Poser(rig, L)
    spec = apose_spec(angle)
    P0.solve(spec)
    deltas = {b: P0.delta(b) for b in H.ORDER}
    P0.apply(P0.solve(spec))
    bpy.context.view_layer.update()
    _apply_pose_as_rest(rig)
    P0.rest()
    return rig, P0, joints(rig), deltas


def to_bind(obj, deltas, bone):
    """Move an object authored in the arms-down rest (P0 coordinates) into the A-pose bind frame of `bone`."""
    obj.data.transform(deltas[bone])
    obj.data.update()
    return obj


def rigid(obj, rig, bone):
    """Skin a rigid piece 100 % to one bone."""
    for g in list(obj.vertex_groups):
        obj.vertex_groups.remove(g)
    g = obj.vertex_groups.new(name=bone)
    g.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
    _parent(obj, rig)
    return obj


def _parent(obj, rig):
    mw = obj.matrix_world.copy()
    obj.parent = rig
    obj.matrix_world = mw
    md = next((m for m in obj.modifiers if m.type == "ARMATURE"), None) or obj.modifiers.new("Armature", "ARMATURE")
    md.object = rig
    for o in bpy.context.scene.objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    while obj.modifiers[0] != md:
        bpy.ops.object.modifier_move_up(modifier=md.name)


def weights_from_fn(obj, rig, fn):
    """Custom weights: fn(world_co) -> {bone: w}; normalised, <= 4 influences."""
    names = [b.name for b in rig.data.bones if b.use_deform]
    for g in list(obj.vertex_groups):
        if g.name in names:
            obj.vertex_groups.remove(g)
    groups = {n: obj.vertex_groups.new(name=n) for n in names}
    mw = obj.matrix_world
    for v in obj.data.vertices:
        w = fn(mw @ v.co)
        items = sorted(((b, x) for b, x in w.items() if x > 0.005), key=lambda t: -t[1])[:4]
        s = sum(x for _, x in items) or 1.0
        for b, x in items:
            groups[b].add([v.index], x / s, "REPLACE")
    _parent(obj, rig)
    return obj


def re_rest(rig, L, meshes, angle=APOSE):
    """Bring the bind pose (A-pose) back to the arms-down layout: pose, apply the deformation to every skinned mesh,
    apply the pose as the new rest, re-add the Armature modifiers (weights are kept)."""
    P = H.Poser(rig, L)
    P.apply(P.solve({"upper_arm.L": H.arm_r("L", 0, -angle), "upper_arm.R": H.arm_r("R", 0, -angle)}))
    bpy.context.view_layer.update()
    for o in meshes:
        md = next((m for m in o.modifiers if m.type == "ARMATURE"), None)
        if md is None:
            continue
        for x in bpy.context.scene.objects:
            x.select_set(False)
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        # the armature must be first so the rest of the stack sees the deformed mesh
        while o.modifiers[0] != md:
            bpy.ops.object.modifier_move_up(modifier=md.name)
        bpy.ops.object.modifier_apply(modifier=md.name)
    _apply_pose_as_rest(rig)
    for o in meshes:
        _parent(o, rig)
    bpy.context.view_layer.update()
    return H.Poser(rig, L)
