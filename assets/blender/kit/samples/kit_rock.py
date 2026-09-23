"""Kit validation sample (a): detailed mossy boulder.
GN displacement (high poly) -> decimated low poly + GN moss-clump scatter -> high->low bake (all channels)
-> GLB + LODs -> QA checks + QA sheets. Outputs go to assets/previews/kit/ (NOT client/public).

blender -b --factory-startup --python assets/blender/kit/samples/kit_rock.py [-- --cpu]
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))  # assets/blender
import bpy  # noqa: E402

import common as C  # noqa: E402
from kit import PREVIEWS, bake, export, gn, lod, materials as M, qa, render  # noqa: E402

OUT = os.path.join(PREVIEWS, "kit")
KEY = "kit_rock"
if "--cpu" in sys.argv:
    os.environ["BRUMEVAL_FORCE_CPU"] = "1"
    KEY = "kit_rock_cpu"

t0 = time.time()
C.reset()

# ---------------------------------------------------------------- base shape
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=4, radius=1.0)
base = bpy.context.object
base.name = "RockBase"
base.scale = (0.95, 0.78, 0.66)
C.apply_transforms(base)
for v in base.data.vertices:            # flatter base, slightly leaning top
    if v.co.z < -0.25:
        v.co.z = -0.25 + (v.co.z + 0.25) * 0.35
    v.co.x += 0.12 * max(v.co.z, 0)
for p in base.data.polygons:
    p.use_smooth = True
rock_mat = M.rock("Rock", scale=1.0, seed=7, moss=0.45, strata=0.7, lichen=0.35)
base.data.materials.append(rock_mat)

# ---------------------------------------------------------------- high poly (GN displacement)
high = base.copy()
high.data = base.data.copy()
high.name = "RockHigh"
bpy.context.scene.collection.objects.link(high)
gn.planar_cuts(high, cuts=9, depth=(0.02, 0.07), seed=11, subdiv=3)          # fractured flat facets
gn.displace(high, strength=0.2, scale=1.5, detail=9, rough=0.6, seed=7, voronoi=0.45, vor_scale=1.1, strata=0.08,
            strata_scale=5.0)
gn.apply(high)
bpy.data.objects.remove(base, do_unlink=True)
mnz = min(v.co.z for v in high.data.vertices)
for v in high.data.vertices:
    v.co.z -= mnz + 0.06                 # sink 6 cm into the ground
high.data.update()

# ---------------------------------------------------------------- low poly
low = high.copy()
low.data = high.data.copy()
low.name = "Rock"
bpy.context.scene.collection.objects.link(low)
tris = sum(len(p.vertices) - 2 for p in low.data.polygons)
gn.decimate(low, 2600 / tris)
gn.apply(low)

# ---------------------------------------------------------------- moss clumps (GN scatter on up-facing faces)
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=0.11)
clump = bpy.context.object
clump.name = "MossClump"
clump.scale = (1.0, 0.75, 0.22)
C.apply_transforms(clump)
for p in clump.data.polygons:
    p.use_smooth = True
clump.data.materials.append(M.moss("MossMat", seed=3))
gn.displace(clump, strength=0.05, scale=22.0, detail=4, voronoi=0.0, seed=2)
gn.decimate(clump, 0.35)
gn.apply(clump)
moss_obj = low.copy()
moss_obj.data = low.data.copy()
moss_obj.name = "MossScatter"
bpy.context.scene.collection.objects.link(moss_obj)
gn.scatter(moss_obj, clump, density=9.0, up_min=0.7, scale=(0.5, 1.3), rot_random=(0.1, 0.1, 3.14), embed=0.018,
           seed=5, keep_target=False, distance_min=0.14)
gn.apply(moss_obj)
gn.remove(clump)
# the clumps are NOT in the high: they are baked DIRECTLY onto themselves (kit_bake_direct) and composited into
# the same atlas. Rays cast from the low rock then only ever meet the high rock (clumps inside the high produced
# rainbow normals / colour seams around every clump). The AO pass still sees the clumps (contact shadows).
moss_obj["kit_bake_direct"] = 1
high.hide_render = True                  # never exported / rendered
high.name = "_RockHigh"
gn.store_up_mask(high, "moss", lo=0.55, hi=0.9, noise_scale=1.5, seed=3)   # GN moss mask -> 'moss' attribute
print(f"[sample] geometry ready {time.time() - t0:.1f}s  low tris={export.triangles([low, moss_obj])}  high tris={export.triangles([high])}")

# ---------------------------------------------------------------- bake high -> low
high.hide_render = False
res = bake.bake_asset([low, moss_obj], KEY, size=1024, high=high, extrusion=0.06, max_ray=0.25, ao_samples=96,
                      tex_dir=os.path.join(OUT, "tex"), ao_in_base=0.0, uv_method="CHARTS")
high.hide_render = True
bpy.data.objects.remove(high, do_unlink=True)
low = C.join([low, moss_obj], "Rock")      # one mesh / one draw call after the bake (UVs are kept)
t_bake = {g: r["times"] for g, r in res.items()}

# ---------------------------------------------------------------- export + LODs + QA
info = export.export_glb(KEY, OUT, objects=[low], budget="rock")
lods = lod.export_lods(KEY, [low], OUT)
rep = qa.run(KEY, [low], budget="rock", expected=(1.9, 1.55, 1.25), glb=info, open_ok=True)
rep["info"]["bake_times"] = t_bake
rep["info"]["lods"] = [(l["path"], l["tris"], l["bytes"]) for l in lods]
qa.save(rep, OUT)
if "--no-sheets" not in sys.argv:
    render.qa_sheets(KEY, [low], OUT, poses=False)
print(f"[sample] {KEY} done in {time.time() - t0:.1f}s  bake={t_bake}")
