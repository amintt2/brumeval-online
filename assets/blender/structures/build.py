"""Brumeval Online - village structures & props (static GLBs + LODs), Blender 5.0 headless, dark-fantasy look.

Keys: house, well, fence, lamp_post, crate, barrel, stall, house_b, tavern, forge, alchemy_table, workbench, windmill,
      watchtower, bridge, waypoint, dungeon_gate, chest, banner
Run:  npm run assets -- structures [--only house,well] [--no-preview]

Pipeline (kit, see docs/PIPELINE_BLENDER.md): parts built at real size (bmesh + Geometry Nodes: instanced stones,
shingle rows, curves) with procedural node materials -> Cycles bake (baseColor/normal/ORM/emissive, WebP) -> join ->
<key>.glb + <key>_lod1/_lod2.glb -> QA checks (<previews>/<key>_qa.json) -> QA sheets (<previews>/<key>_*.png).
Front = -Y in Blender (+Z glTF), origin at the base centre, metres.
Separate named objects for the client: windmill "Sails" (origin on the hub axis, spins around its local Y/-Y axis =
glTF Z), chest "Lid" (origin on the back hinge line, opens around its local X axis).
Emissive parts use materials in the "Glow" texture set (windows, lanterns, embers, runes).
"""
import os
import sys
import time
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))  # assets/blender -> common, kit
sys.path.insert(0, HERE)                   # structures helpers

import common as C  # noqa: E402
import sk  # noqa: E402
from kit import gpu  # noqa: E402

# Several asset agents share one GPU through the kit's lock. Falling back to the CPU after 4 min makes a 2k
# bake take ~10x longer while starving the other Blender processes of CPU; waiting a bit longer for the GPU is
# faster for everybody. ST_GPU_WAIT (s) overrides it; BRUMEVAL_FORCE_CPU=1 still forces the CPU.
_kit_device = gpu.device


def _patient_device(scene=None, samples=16, wait=None, prefer_gpu=True):
    return _kit_device(scene, samples=samples, wait=int(os.environ.get("ST_GPU_WAIT", "1500")), prefer_gpu=prefer_gpu)


gpu.device = _patient_device
import st_props as SP  # noqa: E402

try:
    import st_buildings as SB  # noqa: E402
except ImportError:  # pragma: no cover - during incremental development
    SB = None
try:
    import st_landmarks as SL  # noqa: E402
except ImportError:  # pragma: no cover
    SL = None

KEYS = ["house", "well", "fence", "lamp_post", "crate", "barrel", "stall",
        "house_b", "tavern", "forge", "alchemy_table", "workbench", "windmill", "watchtower", "bridge", "waypoint",
        "dungeon_gate", "chest", "banner"]

# key: (module, builder, budget, expected bbox (x, y, z) m, atlas size, extra finish kwargs)
SPEC = {
    "crate": ("SP", "build_crate", "prop", (1.04, 1.04, 1.03), 1024, {}),
    "barrel": ("SP", "build_barrel", "prop", (0.92, 0.92, 1.1), 1024, {}),
    "fence": ("SP", "build_fence", "prop", (2.0, 0.2, 1.1), 512, {}),
    "chest": ("SP", "build_chest", "prop", (1.1, 0.7, 0.8), 1024, {}),
    "lamp_post": ("SP", "build_lamp_post", "prop", (0.5, 1.0, 3.1), 1024, {}),
    "banner": ("SP", "build_banner", "prop", (1.2, 0.3, 4.0), 1024, {}),
    "workbench": ("SP", "build_workbench", "prop", (2.2, 1.0, 1.4), 1024, {}),
    "alchemy_table": ("SP", "build_alchemy_table", "prop", (2.2, 1.2, 1.9), 1024, {}),
    "well": ("SP", "build_well", "building", (2.9, 2.6, 3.1), 1024, {}),
    "stall": ("SP", "build_stall", "building", (3.1, 2.2, 2.9), 1024, {"group_sizes": {"ClothAwning": 1024}}),
    "house": ("SB", "build_house", "building", (6.8, 6.9, 6.5), 2048, {}),
    "house_b": ("SB", "build_house_b", "building", (7.4, 5.6, 7.4), 2048, {}),
    "tavern": ("SB", "build_tavern", "building", (10.6, 8.6, 8.2), 2048, {}),
    "forge": ("SB", "build_forge", "building", (5.4, 4.4, 4.6), 2048, {}),
    "windmill": ("SB", "build_windmill", "building", (10.0, 6.0, 12.5), 2048, {}),
    "watchtower": ("SB", "build_watchtower", "building", (4.4, 4.4, 10.0), 2048, {}),
    "bridge": ("SL", "build_bridge", "building", (4.2, 12.0, 2.2), 2048, {}),
    "waypoint": ("SL", "build_waypoint", "prop", (1.8, 1.8, 3.2), 1024, {}),
    "dungeon_gate": ("SL", "build_dungeon_gate", "building", (6.4, 3.0, 6.0), 2048, {}),
}


def main():
    args = C.parse_args()
    mods = {"SP": SP, "SB": SB, "SL": SL}
    t0 = time.time()
    failed = []
    for key in C.selected(args, KEYS):
        modname, fn, budget, expected, size, extra = SPEC[key]
        mod = mods[modname]
        if mod is None or not hasattr(mod, fn):
            print(f"[structures] {key}: builder {modname}.{fn} missing - skipped", flush=True)
            continue
        C.reset()
        t = time.time()
        try:
            res = getattr(mod, fn)(args)
            if isinstance(res, dict):          # {"parts": [...], "separate": {...}, "pivots": {...}, ...}
                parts = res.pop("parts")
                kw = dict(extra, **res)
            else:
                parts, kw = res, dict(extra)
            print(f"[structures] {key}: geometry built in {time.time() - t:.1f}s ({len(parts)} parts)", flush=True)
            if os.environ.get("ST_DRY"):          # dev: geometry-only preview (no bake) into $ST_DRY
                sk.dry_preview(key, parts + [o for v in kw.get("separate", {}).values() for o in v],
                               os.environ["ST_DRY"], expected)
                continue
            sk.finish(key, args, parts, budget, expected, size=size, **kw)
        except Exception:                      # keep building the other keys, fail the run at the end
            traceback.print_exc()
            failed.append(key)
    print(f"[structures] done in {time.time() - t0:.0f}s" + (f"  FAILED: {failed}" if failed else ""), flush=True)
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
