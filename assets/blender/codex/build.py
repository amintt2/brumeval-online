"""Codex asset dispatcher: `npm run assets -- codex` runs every Codex sub-build (assets/blender/codex/*/build.py).

Adapted from art/dispatch_codex.py. Each child runs in a fresh Blender process so factory resets and module
names cannot leak between builds.

  npm run assets -- codex                          every sub-build (art, equipment, icons, uikit, weather...)
  npm run assets -- codex --only icons,weather     whole sub-builds by folder name
  npm run assets -- codex --only logo,bg_login     keys listed in a sub-build's manifest.json (art, icons)

Other flags given to scripts/build-assets.mjs (e.g. --no-preview) are meant for the main model builds and are
not forwarded: each Codex build has its own options, run it directly for those
(blender -b --python assets/blender/codex/<name>/build.py -- ...).
"""
from pathlib import Path
import json
import subprocess
import sys

import bpy

HERE = Path(__file__).resolve().parent
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []

children = sorted(p for p in HERE.glob('*/build.py') if p.is_file())
# icons last: they may reuse the other builds' outputs (same rule as scripts/build-assets.mjs)
children.sort(key=lambda p: (p.parent.name == 'icons', p.parent.name))
if not children:
    raise SystemExit('Aucune sous-construction Codex trouvée (assets/blender/codex/*/build.py).')


def manifest_keys(script):
    m = script.parent / 'manifest.json'
    if not m.is_file():
        return None
    try:
        keys = json.loads(m.read_text(encoding='utf-8')).get('keys')
    except (OSError, ValueError):
        return None
    return list(keys) if isinstance(keys, list) else None


requested = None
if '--only' in argv:
    i = argv.index('--only')
    if i + 1 >= len(argv):
        raise SystemExit('--only attend une liste : --only icons,weather ou --only logo,bg_login')
    requested = {k.strip() for k in argv[i + 1].split(',') if k.strip()}

plan = []  # (script, child args)
if requested is None:
    plan = [(s, []) for s in children]
else:
    known = set()
    for s in children:
        name = s.parent.name
        known.add(name)
        keys = manifest_keys(s) or []
        known.update(keys)
        if name in requested:
            plan.append((s, []))
            continue
        selected = [k for k in keys if k in requested]
        if selected:
            plan.append((s, ['--only', ','.join(selected)]))
    unknown = requested - known
    if unknown:
        raise SystemExit(f'Clés inconnues : {sorted(unknown)} (connues : sous-constructions {sorted(s.parent.name for s in children)} ou clés des manifest.json)')

failed = []
for script, child_args in plan:
    name = script.parent.name
    print(f'\n--- codex/{name} ---', flush=True)
    r = subprocess.run([bpy.app.binary_path, '--background', '--factory-startup', '--python-exit-code', '1',
                        '--python', str(script), '--', *child_args])
    if r.returncode != 0:
        failed.append(name)
        print(f'codex/{name} a échoué (code {r.returncode})', flush=True)

if failed:
    raise SystemExit(f'Échec des sous-constructions Codex : {", ".join(failed)}')
print(f'\nCodex : {len(plan)} sous-construction(s) terminée(s).')
