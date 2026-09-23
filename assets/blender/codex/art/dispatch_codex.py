"""Proposal for Claude: install as assets/blender/codex/build.py after merging CX-1/CX-2.
Runs each child in a fresh Blender process so factory resets and module names cannot leak.
"""
from pathlib import Path
import json, subprocess, sys
import bpy
here=Path(__file__).resolve().parent
argv=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
scripts=[here/name/'build.py' for name in ('art','icons')]
if not all(p.is_file() for p in scripts):
    raise SystemExit('Installer ce lanceur dans assets/blender/codex/ après fusion des deux branches.')
only=argv.index('--only') if '--only' in argv else None
requested=set(argv[only+1].split(',')) if only is not None else None
manifests={p:json.loads((p.parent/'manifest.json').read_text())['keys'] for p in scripts}
if requested is not None:
    unknown=requested-set().union(*(set(k) for k in manifests.values()))
    if unknown:raise SystemExit(f'Clés inconnues : {sorted(unknown)}')
for script in scripts:
    child_args=list(argv)
    if requested is not None:
        selected=[k for k in manifests[script] if k in requested]
        if not selected:continue
        child_args[only+1]=','.join(selected)
    subprocess.run([bpy.app.binary_path,'--background','--factory-startup','--python-exit-code','1','--python',str(script),'--',*child_args],check=True)
