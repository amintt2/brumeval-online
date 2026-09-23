"""Brumeval Online - props group (static GLBs + LODs), Blender 5.0 headless, built with the shared kit.

Keys: tent, gravestone, campfire, ruins_pillar, ruins_arch, ruins_wall, obelisk, swamp_hut, snow_cabin, desert_ruin,
      node_copper, node_iron, node_mithril, node_crystal, node_herb_brume, node_herb_givre, node_herb_braise
Run:  npm run assets -- props [--only ruins_pillar,obelisk] [--no-preview]

Pipeline per key (docs/PIPELINE_BLENDER.md): clean base shapes (bmesh lofts) -> Geometry Nodes (voxel fuse,
fracture, erosion, scatter of moss / grass / ore / crystals) -> procedural shader nodes -> Cycles bake (high -> low)
to baseColor / normal / ORM (+ emissive) -> GLB (WebP) + _lod1/_lod2 -> kit QA + QA sheets in assets/previews/.
Front = -Y in Blender, origin at the base centre, z = 0 is the ground, metres.
"""
import os
import sys
import time
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))   # assets/blender -> common, kit
sys.path.insert(0, HERE)                    # props helpers

import common as C  # noqa: E402

import p_ruins  # noqa: E402

KEYS = ["tent", "gravestone", "campfire", "ruins_pillar", "ruins_arch", "ruins_wall", "obelisk", "swamp_hut",
        "snow_cabin", "desert_ruin", "node_copper", "node_iron", "node_mithril", "node_crystal", "node_herb_brume",
        "node_herb_givre", "node_herb_braise"]

BUILDERS = {}
for mod in (p_ruins,):
    BUILDERS.update(mod.BUILDERS)
for _name in ("p_dwell", "p_house", "p_nodes"):
    try:
        BUILDERS.update(__import__(_name).BUILDERS)
    except ModuleNotFoundError:
        pass


def main():
    args = C.parse_args()
    failed = []
    for key in C.selected(args, KEYS):
        if key not in BUILDERS:
            print(f"[props] {key}: no builder yet, skipped", flush=True)
            continue
        t = time.time()
        C.reset()
        try:
            BUILDERS[key](args)
        except Exception:
            traceback.print_exc()
            failed.append(key)
        print(f"[props] {key} built in {time.time() - t:.1f}s", flush=True)
    if failed:
        raise SystemExit(f"[props] FAILED: {failed}")


if __name__ == "__main__":
    main()
