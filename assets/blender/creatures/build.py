"""Brumeval Online - asset group "creatures": skinned, animated beasts built with the shared kit.

Keys: slime, wolf, ice_wolf, boar, spider, scorpion (golem moved to the `giants` group).
Every GLB: one armature 'Rig', a continuous skinned body (+ embedded eyes/teeth/claws, fur cards where relevant),
baked PBR textures (baseColor / normal / ORM [/ emissive], WebP), clips (24 fps, in place):
    Idle, Walk, Attack, Attack2, Run, Hit, Death   (+ Shoot for the scorpion)

Pipeline per key (docs/PIPELINE_BLENDER.md): build -> bake -> export -> QA (kit + ground/loops/weights) -> sheets.

Run (repo root):  npm run assets -- creatures [--only wolf,boar] [--no-preview]
  or: blender -b --factory-startup --python-exit-code 1 --python assets/blender/creatures/build.py -- --only wolf
Outputs: client/public/models/<key>.glb, assets/previews/<key>.png + <key>_{turntable,wire,normals,uv,poses,
poses_side}.png + <key>_qa.json.
"""
import importlib
import os
import sys
import time

sys.dont_write_bytecode = True  # keep the asset folders free of __pycache__
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))  # assets/blender -> common.py, kit
sys.path.insert(0, HERE)                   # this group's helper modules

import bpy  # noqa: E402

import common as C  # noqa: E402
from kit import bake, export, gpu, qa, render  # noqa: E402

import body  # noqa: E402
import qa_extra  # noqa: E402
import sheets  # noqa: E402

KEYS = ["slime", "wolf", "ice_wolf", "boar", "spider", "scorpion"]  # module name == asset key


def main():
    args = C.parse_args()
    for key in C.selected(args, KEYS):
        t0 = time.time()
        mod = importlib.import_module(key)
        C.reset()
        res = mod.build()
        arm, meshes = res["arm"], res["meshes"]
        for m in meshes:
            body.drop_empty_slots(m)
        if os.environ.get("CREATURE_FAST"):
            # iteration mode: no bake / export; animation checks + pose sheets + turntable with the procedural
            # materials (EEVEE), written to --previews (point it at a scratch folder)
            rep = qa.Report(key)
            qa_extra.weights_report(rep, arm, meshes)
            qa_extra.ground_report(rep, arm, meshes, step=1)
            for m in meshes:
                m.data.calc_loop_triangles()
            print(f"[creatures] FAST {key}: tris {sum(len(m.data.loop_triangles) for m in meshes)}  fails {rep['fails']}")
            with gpu.lock_only(wait=60):
                with render.Stage(ground=True) as st:
                    render.turntable(st, meshes, key, args.previews, 300)
            sheets.pose_sheets(key, meshes, arm, args.previews, size=200)
            continue
        tb = time.time()
        sizes = res.get("group_sizes", {})
        bake.bake_asset(meshes, key, size=res.get("tex", 2048), ao_samples=res.get("ao_samples", 64),
                        group_sizes=sizes, uv_method=res.get("uv_method", "CHARTS"), tex_dir=os.environ.get("CREATURE_TEX_DIR") and
                        os.path.join(os.environ["CREATURE_TEX_DIR"], key))
        print(f"[creatures] {key}: bake {time.time() - tb:.1f}s")
        info = export.export_glb(key, args.out, objects=[arm] + meshes, budget=mod.BUDGET)
        rep = qa.run(key, meshes, budget=mod.BUDGET, expected=res.get("expected"), glb=info,
                     open_ok=res.get("open_ok"))
        qa_extra.weights_report(rep, arm, meshes)
        qa_extra.ground_report(rep, arm, meshes, step=2)
        rep["info"]["clips"] = {a.name: round((a.frame_range[1] - a.frame_range[0]) / 24.0, 3)
                                for a in sorted(bpy.data.actions, key=lambda a: a.name)}
        qa.save(rep, args.previews)
        if not args.no_preview:
            action, frame = mod.HERO
            render.qa_sheets(key, meshes, args.previews, hero_action=action, hero_frame=frame, poses=False)
            sheets.pose_sheets(key, meshes, arm, args.previews)
        print(f"[creatures] {key} done in {time.time() - t0:.1f}s  "
              f"({len(rep['fails'])} QA fail(s), {len(rep['warns'])} warning(s))")


main()
