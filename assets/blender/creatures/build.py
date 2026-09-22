"""Brumeval Online - asset group "creatures": skinned, animated non-humanoid monsters.

Keys: slime, wolf, golem (SPEC §5.3). Each GLB has one armature 'Rig', one skinned mesh and the clips
Idle, Walk, Attack, Hit, Death (24 fps, in place; Idle/Walk loop seamlessly).

Run (repo root):
  "C:\\Program Files\\Blender Foundation\\Blender 5.0\\blender.exe" --background --factory-startup \
      --python-exit-code 1 --python assets/blender/creatures/build.py -- [--only slime,wolf] [--no-preview]

Outputs: client/public/models/<key>.glb, assets/previews/<key>.png (3/4 view) and
assets/previews/<key>_anims.png (contact sheet: one row per clip, fixed camera, ground disc).
Optional review mode: set the env var CREATURE_REVIEW=<dir> to also print a ground-contact report per clip and
write side-view contact sheets into <dir>.
"""
import os
import sys

sys.dont_write_bytecode = True  # keep the asset folders free of __pycache__
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))  # assets/blender -> common.py
sys.path.insert(0, HERE)                   # this group's helper modules

import importlib  # noqa: E402

import common as C  # noqa: E402

KEYS = ["slime", "wolf", "golem"]  # module name == asset key


def main():
    args = C.parse_args()
    review_dir = os.environ.get("CREATURE_REVIEW")
    for key in C.selected(args, KEYS):
        mod = importlib.import_module(key)
        C.reset()
        rig = mod.build()
        C.export_glb(key, args)
        action, frame = mod.PREVIEW
        C.render_preview(key, args, action=action, frame=frame)
        if not args.no_preview:
            import review
            # <previews>/<key>_anims.png: one row per clip (Idle, Walk, Attack, Hit, Death), fixed camera
            review.contact_sheet(key, rig, mod.SHEET, args.previews, size=180, name=f"{key}_anims")
        if review_dir:
            import review
            review.ground_report(rig, mod.CLIPS)
            if getattr(mod, "SIDE_SHEET", None):
                review.contact_sheet(key, rig, mod.SIDE_SHEET, review_dir, size=getattr(mod, "SHEET_SIZE", 200),
                                     yaw=90, pitch=5, suffix="_side")
        print(f"[creatures] {key} done")


main()
