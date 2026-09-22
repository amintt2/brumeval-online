"""Build the skinned + animated humanoid characters of Brumeval Online.

Keys: warrior, mage, ranger, npc_elder, npc_merchant, goblin, skeleton  (SPEC §5.3)
Outputs: client/public/models/<key>.glb, assets/previews/<key>.png (+ <key>_poses.png contact sheet),
         client/public/ui/class_<cls>.png (512², full body) and portrait_<cls>.png (256², head & shoulders).

Run:  "C:\\Program Files\\Blender Foundation\\Blender 5.0\\blender.exe" --background --factory-startup \
        --python-exit-code 1 --python assets/blender/characters/build.py -- [--only warrior,mage] [--no-preview]
(--no-preview skips the review renders; the UI images of the three classes are always rendered.)
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)

import bpy  # noqa: E402

import common as C  # noqa: E402
import humanoid as H  # noqa: E402
import monsters  # noqa: E402
import npcs  # noqa: E402
import players  # noqa: E402

BUILDERS = {
    "warrior": players.warrior,
    "mage": players.mage,
    "ranger": players.ranger,
    "npc_elder": npcs.elder,
    "npc_merchant": npcs.merchant,
    "goblin": monsters.goblin,
    "skeleton": monsters.skeleton,
}
KEYS = list(BUILDERS)
CLASSES = ("warrior", "mage", "ranger")
UI_DIR = os.path.join(C.ROOT, "client", "public", "ui")

# poses shown on the review contact sheet: (action, frame)
SHEET = {
    "player": [("Idle", 0), ("Walk", 3), ("Walk", 12), ("Attack", 5), ("Attack", 9), ("Cast", 8), ("Hit", 3), ("Death", 14), ("Death", 29)],
    "npc": [("Idle", 0), ("Idle", 24), ("Walk", 4), ("Walk", 14)],
    "monster": [("Idle", 0), ("Walk", 3), ("Walk", 12), ("Attack", 5), ("Attack", 9), ("Hit", 3), ("Death", 14), ("Death", 29)],
}


def kind(key):
    return "player" if key in CLASSES else ("npc" if key.startswith("npc_") else "monster")


def main():
    args = C.parse_args()
    for key in C.selected(args, KEYS):
        C.reset()
        rig, body, P = BUILDERS[key]()
        names = sorted(a.name for a in bpy.data.actions)
        print(f"[{key}] actions: {', '.join(names)}")
        C.export_glb(key, args)
        C.render_preview(key, args, action="Idle", frame=1)
        if not args.no_preview:
            H.render_sheet(os.path.join(args.previews, f"{key}_poses.png"), rig, body, SHEET[kind(key)])
        if key in CLASSES:
            H.render_ui(os.path.join(UI_DIR, f"class_{key}.png"), rig, body, "Idle", 0, 512, mode="full", yaw=30, pitch=6)
            H.render_ui(os.path.join(UI_DIR, f"portrait_{key}.png"), rig, body, "Idle", 0, 256, mode="portrait", yaw=24,
                        pitch=4)


main()
