"""Brumeval Online - village & camp structures (static GLBs), Blender 5.0 headless.

Keys: house, well, fence, lamp_post, crate, barrel, campfire, tent, gravestone, stall
Run:  "<blender>" --background --factory-startup --python-exit-code 1 \
          --python assets/blender/structures/build.py -- [--only house,well] [--no-preview]

Every model is ONE mesh object with a few material slots, pivot at the base centre (z = 0 is the ground),
front towards -Y in Blender (= +Z in glTF / Three.js). No armature, no animation.
Materials whose name starts with "Glow" are emissive (windows, lanterns, flames) so the client can make
them shine at night. Modules: structkit.py (bmesh kit + palette), st_house.py, st_village.py, st_camp.py.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))  # assets/blender            -> common
sys.path.insert(0, HERE)                   # assets/blender/structures -> structkit, st_*

import common as C  # noqa: E402
import structkit as K  # noqa: E402
from st_camp import build_campfire, build_gravestone, build_tent  # noqa: E402
from st_house import build_house  # noqa: E402
from st_village import build_barrel, build_crate, build_fence, build_lamp_post, build_stall, build_well  # noqa: E402

KEYS = ["house", "well", "fence", "lamp_post", "crate", "barrel", "campfire", "tent", "gravestone", "stall"]

BUILDERS = {
    "house": build_house,
    "well": build_well,
    "fence": build_fence,
    "lamp_post": build_lamp_post,
    "crate": build_crate,
    "barrel": build_barrel,
    "campfire": build_campfire,
    "tent": build_tent,
    "gravestone": build_gravestone,
    "stall": build_stall,
}


def main():
    args = C.parse_args()
    for key in C.selected(args, KEYS):
        C.reset()
        obj = BUILDERS[key]()
        dims = obj.dimensions
        print(f"[structures] {key}: {K.tri_count(obj)} tris, {len(obj.data.materials)} materials, "
              f"size {dims.x:.2f} x {dims.y:.2f} x {dims.z:.2f} m")
        C.export_glb(key, args)
        C.render_preview(key, args)


if __name__ == "__main__":
    main()
