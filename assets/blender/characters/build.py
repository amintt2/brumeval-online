"""Build the skinned + animated humanoids of Brumeval Online (v0.2 dark-fantasy pipeline, shared kit).

Keys: warrior, mage, ranger (+Roll), npc_elder, npc_merchant, npc_blacksmith, npc_alchemist, npc_guard,
npc_innkeeper (Idle, Walk), goblin, skeleton (+Attack2, Run).
Outputs: client/public/models/<key>.glb, assets/previews/<key>*.png (+ QA sheets and <key>_qa.json),
client/public/ui/class_<cls>.png (512) and portrait_<cls>.png (256) for the three classes.

Run:  npm run assets -- characters [--only warrior,mage] [--no-preview]
  or  blender -b --factory-startup --python-exit-code 1 --python assets/blender/characters/build.py -- --only mage
"""
import os
import sys
import time
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)

import bpy  # noqa: E402

import common as C  # noqa: E402
import hq  # noqa: E402
import mage  # noqa: E402
import monsters  # noqa: E402
import npcs  # noqa: E402
import players  # noqa: E402
import ranger  # noqa: E402
import ui  # noqa: E402

SPECS = {
    "warrior": lambda: players.WARRIOR,
    "mage": lambda: mage.MAGE,
    "ranger": lambda: ranger.RANGER,
    "npc_elder": lambda: npcs.ELDER,
    "npc_merchant": lambda: npcs.MERCHANT,
    "npc_blacksmith": lambda: npcs.SMITH,
    "npc_alchemist": lambda: npcs.ALCHEMIST,
    "npc_guard": lambda: npcs.GUARD,
    "npc_innkeeper": lambda: npcs.INNKEEPER,
    "goblin": lambda: monsters.GOBLIN,
    "skeleton": lambda: monsters.SKELETON,
}
BUDGET = {"player": "hero", "npc": "npc", "monster": "humanoid"}
KEYS = list(SPECS)
CLASSES = ("warrior", "mage", "ranger")
UI_DIR = os.path.join(C.ROOT, "client", "public", "ui")


def main():
    args = C.parse_args()
    failed = []
    for key in C.selected(args, KEYS):
        t0 = time.time()
        try:
            spec = SPECS[key]()
            ctx, meshes = hq.build(spec, args, previews=not args.no_preview)
            rep, final, paths = hq.finish(ctx, meshes, args, budget=BUDGET[spec.kind], previews=not args.no_preview)
            if key in CLASSES:
                ud = UI_DIR if os.path.normcase(os.path.abspath(args.out)) == os.path.normcase(C.DEFAULT_OUT) else args.out
                ui.render_class(ctx, final, os.path.join(ud, f"class_{key}.png"), os.path.join(ud, f"portrait_{key}.png"))
            print(f"[{key}] done in {time.time() - t0:.0f}s  QA fails={len(rep['fails'])} warns={len(rep['warns'])}")
        except Exception:
            traceback.print_exc()
            failed.append(key)
    if failed:
        raise SystemExit(f"characters: failed {failed}")


main()
