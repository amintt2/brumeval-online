"""Seam / shading diagnostic sheet for an exported GLB: is a visible discontinuity a BAKE seam or just geometry
under the key light? Renders the hero view 5 times: full material, albedo only (unlit), AO only (unlit),
baked normal map on grey (lit), geometry only on grey (lit), plus UV islands in random colours.
A bake seam shows as a line in one of the texture-only panels that matches a border in the UV-island panel.

blender -b --factory-startup --python assets/blender/kit/samples/seam_diag.py -- path/key.glb [out.png]
"""
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
import bmesh  # noqa: E402
import bpy  # noqa: E402

import common as C  # noqa: E402
from kit import render  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:]
path = argv[0]
out = argv[1] if len(argv) > 1 else os.path.splitext(path)[0] + "_seamdiag.png"
C.reset()
bpy.ops.import_scene.gltf(filepath=path)
objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
random.seed(1)
for o in objs:                              # UV island colours as a corner colour attribute
    bm = bmesh.new()
    bm.from_mesh(o.data)
    ul = bm.loops.layers.uv[0]
    bm.faces.ensure_lookup_table()
    isl, k = [-1] * len(bm.faces), 0
    for f in bm.faces:
        if isl[f.index] >= 0:
            continue
        st = [f]
        isl[f.index] = k
        while st:
            g = st.pop()
            for lp in g.loops:
                for l2 in lp.edge.link_loops:
                    h = l2.face
                    if isl[h.index] < 0 and (lp[ul].uv - l2.link_loop_next[ul].uv).length < 1e-5 and \
                            (lp.link_loop_next[ul].uv - l2[ul].uv).length < 1e-5:
                        isl[h.index] = k
                        st.append(h)
        k += 1
    bm.free()
    cols = [(random.random(), random.random(), random.random(), 1) for _ in range(k)]
    ca = o.data.color_attributes.new("kit_isl", "BYTE_COLOR", "CORNER")
    for p in o.data.polygons:
        for li in p.loop_indices:
            ca.data[li].color = cols[isl[p.index]]
mats = {s.material for o in objs for s in o.material_slots if s.material}
saved = {}
for m in mats:
    nt = m.node_tree
    P = next(n for n in nt.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled")
    outn = next(n for n in nt.nodes if n.bl_idname == "ShaderNodeOutputMaterial")
    sep = next((n for n in nt.nodes if n.bl_idname == "ShaderNodeSeparateColor"), None)
    em = nt.nodes.new("ShaderNodeEmission")
    at = nt.nodes.new("ShaderNodeAttribute")
    at.attribute_name = "kit_isl"
    grey = nt.nodes.new("ShaderNodeBsdfPrincipled")
    grey.inputs["Base Color"].default_value = (0.55, 0.55, 0.55, 1)
    grey.inputs["Roughness"].default_value = 0.8
    saved[m] = dict(nt=nt, P=P, out=outn, sep=sep, em=em, at=at, grey=grey,
                    base=P.inputs["Base Color"].links[0].from_socket if P.inputs["Base Color"].links else None,
                    nrm=P.inputs["Normal"].links[0].from_socket if P.inputs["Normal"].links else None)


def mode(kind):
    for m, d in saved.items():
        nt = d["nt"]
        for l in list(d["out"].inputs["Surface"].links) + list(d["em"].inputs[0].links) + \
                list(d["grey"].inputs["Normal"].links):
            nt.links.remove(l)
        if kind == "full":
            nt.links.new(d["P"].outputs[0], d["out"].inputs["Surface"])
        elif kind in ("albedo", "ao", "islands"):
            src = {"albedo": d["base"], "ao": d["sep"].outputs[0] if d["sep"] else None, "islands": d["at"].outputs[0]}[kind]
            if src is not None:
                nt.links.new(src, d["em"].inputs[0])
            nt.links.new(d["em"].outputs[0], d["out"].inputs["Surface"])
        else:
            if kind == "normalmap" and d["nrm"] is not None:
                nt.links.new(d["nrm"], d["grey"].inputs["Normal"])
            nt.links.new(d["grey"].outputs[0], d["out"].inputs["Surface"])


tiles = []
mn, mx = render.bbox(objs)
with render.Stage(ground=False) as st:
    for kind in ("full", "albedo", "ao", "normalmap", "geometry", "islands"):
        mode(kind)
        st.frame(mn, mx, 35.0, 16.0, margin=1.05)
        t = render.over_bg(st.shoot(420), bg=(0.2, 0.2, 0.21))
        render.draw_text(t, kind.upper(), 8, 8)
        tiles.append(t)
render.save_png(render.grid(tiles, 3), out)
print("[seam_diag] ->", out)
