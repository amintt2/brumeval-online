"""Kit smoke test for the builders not covered by kit_rock / kit_humanoid: recursive tree (curve_to_mesh + leaf
cards via instance_on_points, tile bake of an alpha leaf card, impostor LOD2), a chain (instance_on_curve) and a
tileable ground texture. Outputs: assets/previews/kit/.

blender -b --factory-startup --python assets/blender/kit/samples/kit_smoke.py
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
import bpy  # noqa: E402

import common as C  # noqa: E402
from kit import PREVIEWS, bake, export, gn, lod, materials as M, qa, render  # noqa: E402

OUT = os.path.join(PREVIEWS, "kit")

# ------------------------------------------------------------------ tree
C.reset()
t = gn.branch_tree(seed=4, height=4.5, radius=0.2, levels=3, children=(5, 3, 2))
cu = gn.make_curve(t["splines"], "Trunk", kind="BEZIER", resolution=3)
bark = M.bark("Bark", "oak", seed=2)
gn.curve_to_mesh(cu, radius=1.0, profile_res=7, material=bark)
trunk = gn.apply(cu)
trunk.name = "Trunk"
# leaf card: a 0.5 m quad with UVs 0..1, pivot at its base
me = bpy.data.meshes.new("LeafCard")
me.from_pydata([(-0.25, 0, 0), (0.25, 0, 0), (0.25, 0, 0.5), (-0.25, 0, 0.5)], [], [(0, 1, 2, 3)])
uv = me.uv_layers.new(name="UVMap")
for i, c in enumerate(((0, 0), (1, 0), (1, 1), (0, 1))):
    uv.data[i].uv = c
me.materials.append(M.leaf_card("Leaf_oak", "oak", seed=1))
card = bpy.data.objects.new("LeafCard", me)
bpy.context.scene.collection.objects.link(card)
card["kit_open"] = 1
pts = gn.points_object([p for p, d in t["tips"]], [d for p, d in t["tips"]], "Leaves")
gn.instance_on_points(pts, card, scale=(0.8, 1.3), rot_random=(0.6, 0.6, math.pi), seed=3)
leaves = gn.apply(pts)
leaves.name = "Leaves"
leaves["kit_open"] = 1
gn.remove(card)
print(f"[smoke] tree tris={export.triangles([trunk, leaves])}")
bake.bake_asset([trunk, leaves], "kit_tree", size=1024, group_sizes={"Leaf_oak": 512}, ao_samples=32, uv_method="CHARTS",
                tex_dir=os.path.join(OUT, "tex"))
info = export.export_glb("kit_tree", OUT, objects=[trunk, leaves], budget="vegetation")
lod.export_lods("kit_tree", [trunk, leaves], OUT, impostor_lod2=True)
rep = qa.run("kit_tree", [trunk, leaves], budget="vegetation", glb=info, open_ok=True)
qa.save(rep, OUT)
render.qa_sheets("kit_tree", [trunk, leaves], OUT, poses=False, sheets=("turntable", "normals"))

# ------------------------------------------------------------------ chain on a curve
C.reset()
bpy.ops.mesh.primitive_torus_add(major_radius=0.04, minor_radius=0.01, major_segments=12, minor_segments=6)
link = bpy.context.object
link.scale = (1.6, 1.0, 1.0)
C.apply_transforms(link)
link.data.materials.append(M.metal("Iron", "iron", rust=0.6))
path = gn.make_curve([[(0, 0, 1.5), (0.4, 0, 1.0), (0.9, 0, 0.8), (1.4, 0, 1.0), (1.8, 0, 1.5)]], "Chain", kind="BEZIER")
gn.instance_on_curve(path, link, spacing=0.1, alternate=90)
chain = gn.apply(path)
gn.remove(link)
chain.name = "Chain"
bake.bake_asset([chain], "kit_chain", size=512, ao_samples=16, uv_method="CHARTS")
info = export.export_glb("kit_chain", OUT, objects=[chain], budget="prop")
rep = qa.run("kit_chain", [chain], budget="prop", glb=info, grounded=False, centred=False)
render.qa_sheets("kit_chain", [chain], OUT, poses=False, sheets=("turntable",), hero_view=False)

# ------------------------------------------------------------------ tileable ground
C.reset()
tex = bake.bake_tileable(M.cobblestone("Cobble", seed=3, moss=0.3), "kit_cobble", size=512, world_size=2.0,
                         out_dir=os.path.join(OUT, "tex"))
print("[smoke] tileable", {k: tuple(v.size) for k, v in tex.items()})
print("[smoke] done")
