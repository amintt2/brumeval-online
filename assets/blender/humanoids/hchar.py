"""Character assembly helpers: body creation (high + low), skinning, garments binding and the final
bake -> export -> QA -> sheets pipeline shared by every key of the group."""
import math
import os

import bmesh
import bpy
import mathutils
import numpy as np

import anatomy as A
import hbody as HB
import hrig
import skeleton as SK
from kit import bake, export, gn, qa, render, rig

V = mathutils.Vector


def make_body(P, kind="human", voxel=0.004, tris=6000, name="Body", smooth=10, face_smooth=5):
    """Returns dict(arm, J, base, high, low, eyes). kind: human | skeleton.
    high = fused, sculpted, smoothed voxel mesh (bake source, name starts with '_' -> never exported)
    low  = decimated continuous game mesh."""
    arm, J = hrig.armature(P)
    s = P["H"] / 1.8
    eyes = []
    base = None
    if kind == "skeleton":
        parts, ops, eyes, cutters = SK.skeleton(J, P)
        high = HB.fuse(parts, voxel, "_" + name + "High")
        HB.keep_largest(high)
        HB.sculpt(high, ops)
        HB.carve(high, cutters, voxel=voxel)
        HB.keep_largest(high)
        HB.taubin(high, 4)
    else:
        g, parts, ops = A.human(J, P)
        base = g.build("_" + name + "Base")
        base.hide_render = True
        high = HB.fuse([base] + parts, voxel, "_" + name + "High", keep=[base])
        HB.keep_largest(high)
        HB.sculpt(high, ops)
        hd = V(J["head"][0]) + V((0, -0.04 * s, 0.08 * s))
        hands = [(J["hand.L"][1], 0.1 * s, 0.15), (J["hand.R"][1], 0.1 * s, 0.15)]
        if face_smooth:
            HB.laplacian(high, face_smooth, 0.5, mask=HB.region_mask(high, [(hd, 0.11 * s * P.get("head", 1.0), 1.0)], 0.0) * 0.8)
        HB.taubin(high, smooth, mask=HB.region_mask(high, hands))
    for p in high.data.polygons:
        p.use_smooth = True
    low = HB.copy(high, name)
    HB.decimate_to(low, tris)
    high.hide_render = True
    low.hide_render = False
    return dict(arm=arm, J=J, base=base, high=high, low=low, eyes=eyes, s=s)


def parent_rigid(ob, arm, bone):
    """Rigid prop: 100 % weight to one bone + Armature modifier (skinned like the rest)."""
    for g in list(ob.vertex_groups):
        ob.vertex_groups.remove(g)
    for b in hrig.BONES:
        if arm.data.bones[b].use_deform:
            ob.vertex_groups.new(name=b)
    ob.vertex_groups[bone].add(list(range(len(ob.data.vertices))), 1.0, "REPLACE")
    mw = ob.matrix_world.copy()
    ob.parent = arm
    ob.matrix_world = mw
    md = ob.modifiers.new("Armature", "ARMATURE")
    md.object = arm
    while ob.modifiers[0] != md:
        with bpy.context.temp_override(object=ob):
            bpy.ops.object.modifier_move_up(modifier=md.name)
    return ob


def weights_from(src, dst, arm, smooth=8, factor=0.6):
    """Garment / accessory weights from the (full) skinned body copy, smoothed."""
    return rig.transfer_weights(src, dst, arm, smooth=smooth, factor=factor)


def blend_weights_to(ob, arm, bone, mask):
    """Force weights of the masked vertices (mask: array 0..1) towards one bone (e.g. hood -> head)."""
    names = rig.deform_bones(arm)
    W = rig.weights_array(ob, names)
    j = names.index(bone)
    one = np.zeros(len(names))
    one[j] = 1
    m = np.asarray(mask, dtype=float)[:, None]
    W = W * (1 - m) + one[None, :] * m
    rig.set_weights(ob, names, W)


def apply_transform(ob):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def join_gear(objs, name):
    """Join rigid/skinned accessories into one mesh (keeps vertex groups + armature modifier of the first)."""
    objs = [o for o in objs if o is not None]
    if len(objs) == 1:
        objs[0].name = name
        return objs[0]
    ob = HB.join(objs, name)
    mods = [m for m in ob.modifiers if m.type == "ARMATURE"]
    for m in mods[1:]:
        ob.modifiers.remove(m)
    return ob


# =============================================================================== final pipeline
def finish(key, args, arm, body, cloths, gear, budget, height, high=None, hero=("Walk", 6), tex=2048, cloth_tex=1024,
           closeups=(), qa_frames=9, extra_open_ok=(), expected=None, keyposes=()):
    """bake -> export -> QA -> sheets. body: skinned body mesh (continuous), cloths: garments tested against the
    body, gear: every other mesh. Returns the QA report."""
    import hqa
    meshes = [body] + list(cloths) + list(gear)
    if high is not None:
        for o in meshes:
            if o is not body:
                o["kit_bake_direct"] = 1
        # the high carries the same material as the body
        high.data.materials.clear()
        for s in body.material_slots:
            high.data.materials.append(s.material)
    for o in extra_open_ok:
        o["kit_open"] = 1
    gs = {}
    for o in meshes:
        for s in o.material_slots:
            if s.material is not None and s.material.name.startswith(("Cloth", "Banner", "Leaf", "Foliage", "Grass")):
                gs[s.material.name] = cloth_tex
    res = bake.bake_asset(meshes, key, size=tex, high=high, extrusion=0.012, max_ray=0.03, ao_samples=64,
                          group_sizes=gs, ao_in_base=0.0)
    if high is not None:
        bpy.data.objects.remove(high, do_unlink=True)
    info = export.export_glb(key, args.out, objects=[arm] + meshes, budget=budget)
    rep = qa.run(key, meshes, budget=budget, expected=expected or (None, None, height), glb=info,
                 skin=dict(body=body, cloths=list(cloths), armature=arm, frames=qa_frames) if cloths else None)
    rep["info"]["bake_times"] = {g: r["times"] for g, r in res.items()}
    rep["info"]["clips"] = {a.name: round((a.frame_range[1] - a.frame_range[0]) / 24.0, 3) for a in bpy.data.actions}
    qa.save(rep, args.previews)
    if not args.no_preview:
        render.qa_sheets(key, meshes, args.previews, hero_action=hero[0] if hero else None,
                         hero_frame=hero[1] if hero else None)
        if hero:
            hqa.posed_turntable(key, meshes, args.previews, hero[0], hero[1])
        if closeups:
            hqa.closeups(key, meshes, args.previews, closeups)
        if keyposes:
            hqa.key_poses(key, meshes, args.previews, keyposes)
    return rep


# =============================================================================== clothing poke fixer
def poking_verts(body, cloths, arm, frames=9, tol=0.002, max_depth=0.2):
    """Indices of covered body vertices that end up in front of the clothing in any sampled frame of any clip
    (same test as kit.qa.check_clothing, slightly stricter tolerance)."""
    from mathutils import Vector
    scene = bpy.context.scene
    arm.data.pose_position = "REST"
    bpy.context.view_layer.update()
    co, nr, _ = qa.world_mesh(body, disable=("SOLIDIFY",))
    idx, depth = qa._covered(co, nr, qa._cloth_trees(cloths), max_depth)
    arm.data.pose_position = "POSE"
    bad = set()
    for act in bpy.data.actions:
        hrig.set_action(arm, act)
        f0, f1 = act.frame_range
        for k in range(frames):
            f = int(round(f0 + (f1 - f0) * k / max(frames - 1, 1)))
            scene.frame_set(f)
            bco, _, _ = qa.world_mesh(body, disable=("SOLIDIFY",))
            trees = qa._cloth_trees(cloths)
            for i in idx:
                if int(i) in bad:
                    continue
                p = Vector(bco[i])
                inside = False
                for t in trees:
                    q, qn, _, d = t.find_nearest(p, max_depth * 2)
                    if q is not None and (p - q).dot(qn) <= tol:
                        inside = True
                        break
                if not inside:
                    bad.add(int(i))
    hrig.set_action(arm, None)
    rig.pose(arm, {})
    scene.frame_set(0)
    return bad


def fix_pokes(body, cloths, arm, passes=3, push=0.012, frames=25, delete=True):
    """Shrink (then delete, unless delete=False) the few covered body vertices that still poke through clothing."""
    for it in range(passes + (1 if delete else 0)):
        bad = poking_verts(body, cloths, arm, frames)
        print(f"[humanoids] fix_pokes pass {it}: {len(bad)} verts")
        if not bad:
            return 0
        bm = bmesh.new()
        bm.from_mesh(body.data)
        bm.verts.ensure_lookup_table()
        bm.normal_update()
        if it < passes:
            for i in bad:
                v = bm.verts[i]
                v.co -= v.normal * push
        else:
            kill = list({f for i in bad for f in bm.verts[i].link_faces})
            bmesh.ops.delete(bm, geom=kill, context="FACES")
            bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
        bm.to_mesh(body.data)
        bm.free()
        body.data.update()
    return len(bad)


def tag_shell(ob, predicate_new_verts):
    """Put vertices (indices) into the kit_shell group: garment rims / inner facings ignored by the clothing QA."""
    g = ob.vertex_groups.get("kit_shell") or ob.vertex_groups.new(name="kit_shell")
    g.add(list(predicate_new_verts), 1.0, "REPLACE")
