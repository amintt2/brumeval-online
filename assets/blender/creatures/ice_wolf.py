"""Ice wolf ("Loup de givre"): the wolf body at 1.1x, pale blue-grey pelt with frosted fur tips, glowing ice-blue
eyes and a ridge of ice crystals along the spine (Geometry Nodes scatter of crystal shards on a dorsal mask,
aligned to the surface normal, embedded; glowing crystal shader, baked). Same rig and clips as wolf.py.
"""
import bmesh
import bpy
import numpy as np

import body as B
import quadruped as Q
from kit import gn, materials as M
from kit import rig as KR

HERO = ("Idle", 20)
BUDGET = "beast"


def _shard(name, h=1.0, r=0.16, sides=5):
    """Pointed hexagonal-ish crystal along +Z, base slightly below the origin (embeds in the fur)."""
    bm = bmesh.new()
    import math
    ring0, ring1 = [], []
    for i in range(sides):
        a = 2 * math.pi * i / sides
        ring0.append(bm.verts.new((r * math.cos(a), r * math.sin(a), -0.15 * h)))
        ring1.append(bm.verts.new((r * 0.9 * math.cos(a + 0.2), r * 0.9 * math.sin(a + 0.2), 0.62 * h)))
    tip = bm.verts.new((0.03 * r, 0.02 * r, h))
    for i in range(sides):
        j = (i + 1) % sides
        bm.faces.new((ring0[i], ring0[j], ring1[j], ring1[i]))
        bm.faces.new((ring1[i], ring1[j], tip))
    bm.faces.new(list(reversed(ring0)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def frost_crystals(body, arm, S):
    """Crystal shards scattered (GN) on the dorsal ridge from the neck to the croup; skinned to the spine bones."""
    co, nr = B.co_array(body), B.normal_array(body)
    y, z = co[:, 1] / S, co[:, 2] / S
    ss = Q.smoothstep
    ridge = ss(nr[:, 2], 0.6, 0.92) * (1 - ss(np.abs(co[:, 0] / S), 0.035, 0.07)) * ss(y, -0.5, -0.4) * (1 - ss(y, 0.3, 0.42))
    ridge *= ss(z, 0.66, 0.72)
    B.set_attr(body, "crystal", ridge)
    tpl = [_shard(f"_Shard{i}", h=1.0, r=0.15 + 0.04 * i) for i in range(3)]
    src = body.copy()
    src.data = body.data.copy()
    src.name = "Crystals"
    for md in list(src.modifiers):
        src.modifiers.remove(md)
    bpy.context.scene.collection.objects.link(src)
    gn.scatter(src, tpl, density=320.0, seed=5, attr_mask="crystal", attr_threshold=0.5, scale=(0.07 * S, 0.16 * S),
               rot_random=(0.35, 0.35, 3.14), embed=0.012 * S, distance_min=0.028 * S, keep_target=False)
    gn.apply(src)
    gn.remove(*tpl)
    for c in [c for c in bpy.data.collections if c.name.startswith("_tpl_")]:
        bpy.data.collections.remove(c)
    for g in list(src.vertex_groups):
        src.vertex_groups.remove(g)
    for a in [a.name for a in src.data.attributes if a.name in ("flow", "tone", "furmask", "furlen", "scar", "frost", "crystal")]:
        src.data.attributes.remove(src.data.attributes[a])
    body.data.attributes.remove(body.data.attributes["crystal"])
    mat = M.crystal("Crystal_ice", color="#9fe6ff", glow=0.7, emit_strength=3.0, seed=2)
    src.data.materials.clear()
    src.data.materials.append(mat)
    for p in src.data.polygons:
        p.use_smooth = False
        p.material_index = 0
    B.blend_bones(src, arm, ["hips", "spine", "chest", "neck"], sharp=6)
    src.parent = arm
    md = src.modifiers.new("Armature", "ARMATURE")
    md.object = arm
    print(f"[ice_wolf] {len(src.data.polygons)} crystal faces")
    return src


def build():
    import wolf
    return wolf.build("ice")
