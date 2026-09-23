"""Re-run the kit's automated QA on an exported GLB (no rebuild): geometry, UV layout, texture seams, size.

blender -b --factory-startup --python assets/blender/kit/samples/qa_glb.py -- path/to/key.glb [--budget prop]
    --inject-seam   self-test of the seam detector: brightens the baseColor of the 2nd biggest UV island by 8 %
                    (a typical bake seam) -> the report MUST fail.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
import bpy  # noqa: E402

import common as C  # noqa: E402
from kit import qa  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
path = argv[0]
budget = argv[argv.index("--budget") + 1] if "--budget" in argv else None
C.reset()
bpy.ops.import_scene.gltf(filepath=path)
objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
for m in bpy.data.materials:                # glTF alphaMode MASK/BLEND -> alpha cards (kit flag lost on export)
    P = next((n for n in (m.node_tree.nodes if m.node_tree else []) if n.bl_idname == "ShaderNodeBsdfPrincipled"), None)
    if P is not None and P.inputs["Alpha"].is_linked:
        m["kit_alpha"] = 1
key = os.path.splitext(os.path.basename(path))[0]
if "--inject-seam" in argv:
    import bmesh
    import numpy as np
    from kit import bake
    o = max(objs, key=lambda x: len(x.data.polygons))
    bm = bmesh.new()
    bm.from_mesh(o.data)
    ul = bm.loops.layers.uv[0]
    bm.faces.ensure_lookup_table()
    isl, sizes = [-1] * len(bm.faces), []
    for f in bm.faces:
        if isl[f.index] >= 0:
            continue
        st, n = [f], 0
        isl[f.index] = len(sizes)
        while st:
            g = st.pop()
            n += 1
            for lp in g.loops:
                for l2 in lp.edge.link_loops:
                    h = l2.face
                    if isl[h.index] < 0 and (lp[ul].uv - l2.link_loop_next[ul].uv).length < 1e-5 and                             (lp.link_loop_next[ul].uv - l2[ul].uv).length < 1e-5:
                        isl[h.index] = len(sizes)
                        st.append(h)
        sizes.append(n)
    bm.free()
    target = int(np.argsort(sizes)[-2])
    img = qa._final_images(o.material_slots[0].material)["base"]
    mask = bake.uv_coverage([o], tuple(img.size), uv_name=o.data.uv_layers[0].name,
                            faces_filter=lambda ob, p: isl[p.index] == target)
    mask = bake._dilate(mask, 4)
    a = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    a = a.reshape(img.size[1], img.size[0], 4)
    a[mask, :3] = np.clip(a[mask, :3] * 1.08 + 0.02, 0, 1)
    img.pixels.foreach_set(a.ravel())
    qa._px.cache.clear()
    print(f"[qa_glb] injected a +8% seam on island {target} ({sizes[target]} faces)")
rep = qa.run(key, objs, budget=budget, open_ok=True, grounded=False, centred=False)
for m in rep["fails"]:
    print("FAIL", m)
for m in rep["warns"]:
    print("WARN", m)
print("UV", rep["info"].get("uv"))
