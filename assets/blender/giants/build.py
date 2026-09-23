"""Brumeval Online - asset group "giants": big skinned monsters and bosses (Blender 5.0, headless).

Keys (ROADMAP §4.5): golem (boss, upgrade), yeti, bog_lurker, troll, frost_giant (boss), sand_wyrm (boss).
Every GLB: one armature "Rig", continuous skinned meshes with smooth weights, baked PBR textures (WebP:
baseColor / normal / ORM / emissive) from procedural shader nodes + Geometry Nodes high-poly sculpts, and the clips
Idle, Walk, Run, Attack, Attack2, Hit, Death (+ Special for bosses), 24 fps, in place.

Run (repo root):  npm run assets -- giants            (or: --only troll,yeti  --no-preview)
  "C:\\Program Files\\Blender Foundation\\Blender 5.0\\blender.exe" -b --factory-startup --python-exit-code 1 \
      --python assets/blender/giants/build.py -- [--only troll] [--no-preview]
Env GIANTS_STAGE=shape  -> only the clay shape sheet (fast iteration), GIANTS_STAGE=anim -> + clay pose sheet.

Outputs: client/public/models/<key>.glb, assets/previews/<key>.png + <key>_{turntable,wire,normals,uv,poses}.png
and <key>_qa.json (kit QA report + clip durations + ground contact).
"""
import importlib
import os
import sys
import time

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))   # assets/blender -> common, kit
sys.path.insert(0, HERE)                    # this group's modules

import common as C  # noqa: E402

KEYS = ["troll", "yeti", "bog_lurker", "golem", "frost_giant", "sand_wyrm"]


def main():
    args = C.parse_args()
    stage = os.environ.get("GIANTS_STAGE", "full")
    failed = []
    for key in C.selected(args, KEYS):
        t0 = time.time()
        C.reset()
        mod = importlib.import_module(key)
        try:
            rep = mod.build(args, stage)
        except Exception:
            import traceback
            traceback.print_exc()
            failed.append(key)
            continue
        n = len(rep["fails"]) if isinstance(rep, dict) and "fails" in rep else 0
        print(f"[giants] {key} done in {time.time() - t0:.0f}s ({n} QA fail(s))", flush=True)
    if failed:
        raise SystemExit(f"[giants] failed: {failed}")


main()
