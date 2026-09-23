"""Kit validation sample (b): skinned humanoid with a long robe and a 1 s walk.
Continuous body (skin modifier -> subdivided), tunic = inflated body faces, skirt = revolved profile with folds,
belt; smooth automatic weights + weight transfer to the clothes; body hidden under clothes deleted/shrunk;
baked textures; GLB; per-frame body-through-cloth QA; QA sheets incl. pose sheet. Outputs: assets/previews/kit/.

blender -b --factory-startup --python assets/blender/kit/samples/kit_humanoid.py
"""
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
import bmesh  # noqa: E402
import bpy  # noqa: E402

import common as C  # noqa: E402
from kit import PREVIEWS, bake, export, gn, materials as M, qa, render, rig  # noqa: E402

OUT = os.path.join(PREVIEWS, "kit")
KEY = "kit_humanoid"
t0 = time.time()
C.reset()
C.bpy.context.scene.render.fps = 24

# ---------------------------------------------------------------- armature
arm = rig.humanoid_armature(1.8)
J = rig.humanoid_joints(1.8)

# ---------------------------------------------------------------- body: skin-modifier skeleton -> one continuous mesh
pts, edges, radii = [], [], []


def P(co, r):
    pts.append(co)
    radii.append(r)
    return len(pts) - 1


pel = P((0, 0, 0.97), (0.14, 0.1))
spi = P((0, 0, 1.12), (0.125, 0.09))
che = P((0, 0, 1.3), (0.155, 0.1))
nk = P((0, -0.005, 1.5), (0.05, 0.05))
hb = P((0, -0.01, 1.58), (0.075, 0.085))
hm = P((0, -0.015, 1.67), (0.095, 0.105))
ht = P((0, -0.01, 1.77), (0.05, 0.055))
edges += [(pel, spi), (spi, che), (che, nk), (nk, hb), (hb, hm), (hm, ht)]
for side in ("L", "R"):
    sh, el = J[f"upper_arm.{side}"]
    wr = J[f"forearm.{side}"][1]
    hd = J[f"hand.{side}"][1]
    a = P(sh, (0.055, 0.055))
    b = P(el, (0.042, 0.042))
    c = P(wr, (0.032, 0.028))
    d = P(hd, (0.028, 0.014))
    edges += [(che, a), (a, b), (b, c), (c, d)]
    hp = P(J[f"thigh.{side}"][0], (0.08, 0.08))
    kn = P(J[f"shin.{side}"][0], (0.055, 0.055))
    an = P(J[f"foot.{side}"][0], (0.04, 0.04))
    to = P(J[f"foot.{side}"][1], (0.04, 0.025))
    edges += [(pel, hp), (hp, kn), (kn, an), (an, to)]
me = bpy.data.meshes.new("Body")
me.from_pydata(pts, edges, [])
body = bpy.data.objects.new("Body", me)
bpy.context.scene.collection.objects.link(body)
sk = body.modifiers.new("Skin", "SKIN")
sk.use_smooth_shade = True
for i, r in enumerate(radii):
    body.data.skin_vertices[0].data[i].radius = r
body.data.skin_vertices[0].data[pel].use_root = True
ss = body.modifiers.new("Sub", "SUBSURF")
ss.levels = ss.render_levels = 2
gn.apply(body)
body.data.materials.append(M.skin("Skin", "human", seed=2))
print(f"[sample] body tris={export.triangles([body])}")

# ---------------------------------------------------------------- clothing
# tunic: body faces of the torso + upper arms, inflated
bm = bmesh.new()
bm.from_mesh(body.data)
keep = [f for f in bm.faces if all(0.86 < v.co.z < 1.49 and abs(v.co.x) < 0.4 for v in f.verts)]
bmesh.ops.delete(bm, geom=[f for f in bm.faces if f not in set(keep)], context="FACES")
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
# clean hems: the face selection leaves stair-stepped borders (read as torn, jagged triangles) -> snap the
# border vertices onto a straight hem line (sleeves at |x| = 0.4, waist at z = 0.9, hidden by the belt)
for v in bm.verts:
    if any(e.is_boundary for e in v.link_edges):
        if abs(v.co.x) > 0.3:
            v.co.x = math.copysign(0.4, v.co.x)
        elif v.co.z < 1.05:
            v.co.z = 0.9
bm.normal_update()
for v in bm.verts:
    v.co += v.normal * 0.028
tme = bpy.data.meshes.new("Tunic")
bm.to_mesh(tme)
bm.free()
tunic = bpy.data.objects.new("Tunic", tme)
bpy.context.scene.collection.objects.link(tunic)
for p in tunic.data.polygons:
    p.use_smooth = True
robe_mat = M.cloth("Cloth_Robe", color="#2c3350", kind="wool", seed=4, pattern_color="#8a6a2a", hem_dirt=0.6)
tunic.data.materials.append(robe_mat)

# skirt: revolved A-line profile with folds, from under the tunic (z 1.0) to the hem (z 0.1)
seg, rings = 40, 16
sv, sf = [], []
for r in range(rings + 1):
    t = r / rings
    z = 1.0 - 0.9 * t
    rx = 0.165 + 0.2 * t ** 1.3
    ry = 0.118 + 0.19 * t ** 1.3
    for s in range(seg):
        a = 2 * math.pi * s / seg
        fold = 1 + (0.02 + 0.07 * t) * math.sin(7 * a + 1.3 * t) * (0.6 + 0.4 * math.sin(3 * a))
        sv.append((rx * fold * math.sin(a), -ry * fold * math.cos(a), z))
for r in range(rings):
    for s in range(seg):
        a, b = r * seg + s, r * seg + (s + 1) % seg
        sf.append((a, b, b + seg, a + seg))
sme = bpy.data.meshes.new("Skirt")
sme.from_pydata(sv, [], sf)
skirt = bpy.data.objects.new("Skirt", sme)
bpy.context.scene.collection.objects.link(skirt)
for p in skirt.data.polygons:
    p.use_smooth = True
skirt.data.materials.append(robe_mat)
# make the skirt normals point outward
bm = bmesh.new()
bm.from_mesh(sme)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
bm.to_mesh(sme)
bm.free()

# belt: leather band hiding the tunic/skirt seam
bpy.ops.mesh.primitive_torus_add(major_radius=1.0, minor_radius=0.12, major_segments=40, minor_segments=8)
belt = bpy.context.object
belt.name = "Belt"
belt.scale = (0.19, 0.145, 0.19)
belt.location = (0, 0, 0.93)
C.apply_transforms(belt)
for p in belt.data.polygons:
    p.use_smooth = True
belt.data.materials.append(M.leather("Belt", color="#4a2e1a", seed=1))

# ---------------------------------------------------------------- skinning
body_src = body.copy()
body_src.data = body.data.copy()
bpy.context.scene.collection.objects.link(body_src)
rig.bind(body, arm, smooth=3)
rig.bind(body_src, arm, smooth=3)
rig.transfer_weights(body_src, tunic, arm, smooth=6)
rig.transfer_weights(body_src, skirt, arm, smooth=25, factor=0.7)
rig.transfer_weights(body_src, belt, arm, smooth=10)
gn.solidify(tunic, 0.008, offset=-1.0)
gn.solidify(skirt, 0.008, offset=-1.0)
bpy.data.objects.remove(body_src, do_unlink=True)

# ---------------------------------------------------------------- walk (1 s = 24 frames) + idle
lean = {"spine": (4, 0, 0)}
A = {"thigh.L": (-20, 0, 0), "shin.L": (-6, 0, 0), "foot.L": (12, 0, 0),
     "thigh.R": (16, 0, 0), "shin.R": (-18, 0, 0), "foot.R": (-8, 0, 0),
     "upper_arm.L": (12, 0, 0), "upper_arm.R": (-12, 0, 0), "forearm.L": (-8, 0, 0), "forearm.R": (-14, 0, 0),
     "hips": {"rot": (0, 4, 0), "loc": (0, 0, 0)}, "chest": (0, -5, 0), **lean}
PASS = {"thigh.L": (2, 0, 0), "shin.L": (-5, 0, 0), "thigh.R": (-8, 0, 0), "shin.R": (-35, 0, 0), "foot.R": (10, 0, 0),
        "hips": {"rot": (0, 0, 0), "loc": (0, 0.025, 0)}, **lean}
B, PASS2 = rig.mirror_pose(A), rig.mirror_pose(PASS)
rig.clip(arm, "Walk", [(1, A), (7, PASS), (13, B), (19, PASS2), ("loop", 25)], cyclic=True)
rig.clip(arm, "Idle", [(1, {"chest": (2, 0, 0)}), (25, {"chest": (-1, 0, 0), "head": (-3, 0, 0)}), ("loop", 49)], cyclic=True)

# ---------------------------------------------------------------- hide body under clothes, bake, export, QA
qa.delete_covered_body(body, [tunic, skirt], margin=0.012, max_depth=0.25, shrink=0.008)
meshes = [body, tunic, skirt, belt]
res = bake.bake_asset(meshes, KEY, size=1024, ao_samples=64, tex_dir=os.path.join(OUT, "tex"), ao_in_base=0.0,
                      uv_method="CHARTS")
info = export.export_glb(KEY, OUT, objects=[arm] + meshes, budget="hero")
rep = qa.run(KEY, meshes, budget="hero", expected=(None, None, 1.8), glb=info,
             skin=dict(body=body, cloths=[tunic, skirt], armature=arm, frames=13))
rep["info"]["bake_times"] = {g: r["times"] for g, r in res.items()}
qa.save(rep, OUT)
render.qa_sheets(KEY, meshes, OUT, hero_action="Walk", hero_frame=7)
print(f"[sample] {KEY} done in {time.time() - t0:.1f}s")
