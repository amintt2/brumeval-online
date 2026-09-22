"""Icons group: inventory item icons + ability icons -> client/public/icons/<key>.png (128x128 RGBA).

    blender --background --factory-startup --python-exit-code 1 --python assets/blender/icons/build.py -- [--only k1,k2] [--no-preview]

* Item icons (one per ITEMS[*].icon of shared/data.js, plus `gold`): transparent background, object fills ~85 %.
* Ability icons `ab_<abilityId>` (12): opaque backdrop tinted with the owning class colour + bright 3D emblem.
Unless --no-preview, contact sheets are written to assets/previews/icons_items.png and icons_abilities.png.
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))  # assets/blender (common.py)
sys.path.insert(0, HERE)                   # this group's helpers
sys.dont_write_bytecode = True

import common as C  # noqa: E402
import iconlib as L  # noqa: E402
import items  # noqa: E402
import abilities  # noqa: E402

BUILDERS = {}
BUILDERS.update(items.BUILDERS)
BUILDERS.update(abilities.BUILDERS)
ITEM_KEYS = list(items.BUILDERS)
ABILITY_KEYS = list(abilities.BUILDERS)
KEYS = ITEM_KEYS + ABILITY_KEYS


def check_against_game_data():
    """Every icon referenced by shared/data.js must have a builder (and vice versa, warn only)."""
    path = os.path.join(C.ROOT, "shared", "data.js")
    try:
        src = open(path, encoding="utf-8").read()
    except OSError:
        print("[icons] shared/data.js not found, skipping consistency check")
        return
    wanted = set(re.findall(r"icon:\s*'([A-Za-z0-9_]+)'", src))
    wanted.add("gold")
    m = re.search(r"export const ABILITIES = \{(.*?)\n\};", src, re.S)
    if m:
        wanted |= {"ab_" + k for k in re.findall(r"^\s*([a-z_]+):\s*\{", m.group(1), re.M)}
    missing = sorted(wanted - set(KEYS))
    extra = sorted(set(KEYS) - wanted)
    if missing:
        raise SystemExit(f"[icons] no builder for icons used in shared/data.js: {missing}")
    if extra:
        print(f"[icons] note: builders not referenced by shared/data.js: {extra}")


def contact_sheet(keys, path, cols=6, cell=148, pad=10):
    """Review sheet: every icon on a dark UI-like slot (items) or as-is (abilities)."""
    import numpy as np
    rows = (len(keys) + cols - 1) // cols
    W, H = cols * cell + pad, rows * cell + pad
    sheet = np.zeros((H, W, 4), np.float32)
    sheet[..., :3] = L.srgb("#2a2420")
    sheet[..., 3] = 1.0
    for i, k in enumerate(keys):
        p = os.path.join(ARGS.icons, f"{k}.png")
        if not os.path.exists(p):
            continue
        img = L.premul(L.load_rgba(p))
        h, w, _ = img.shape
        r, c = i // cols, i % cols
        x = pad + c * cell
        y = H - (pad + r * cell) - h  # Blender rows are bottom-up
        slot = np.zeros((h, w, 4), np.float32)
        slot[..., :3] = L.srgb("#15110e")
        slot[..., 3] = 1.0
        sheet[y:y + h, x:x + w] = L.over(img, slot)
    L.save_rgba(sheet, path)
    print(f"[preview] {path}")


def main():
    check_against_game_data()
    done = []
    for key in C.selected(ARGS, KEYS):
        C.reset()
        opts = BUILDERS[key]() or {}
        L.render_icon(key, ARGS, **opts)
        done.append(key)
    if not getattr(ARGS, "no_preview", False) and done:
        C.reset()
        contact_sheet([k for k in ITEM_KEYS if os.path.exists(os.path.join(ARGS.icons, f"{k}.png"))],
                      os.path.join(ARGS.previews, "icons_items.png"))
        contact_sheet([k for k in ABILITY_KEYS if os.path.exists(os.path.join(ARGS.icons, f"{k}.png"))],
                      os.path.join(ARGS.previews, "icons_abilities.png"))
    print(f"[icons] {len(done)} icon(s) rendered to {ARGS.icons}")


ARGS = C.parse_args()
main()
