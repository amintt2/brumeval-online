"""Look-dev group: sky HDRIs, tileable terrain PBR sets, shared textures, VFX flipbooks.

    npm run assets -- lookdev                                  # everything (long: ~GPU minutes, see README below)
    npm run assets -- lookdev --only sky_golden,terrain_grass  # selected keys
    npm run assets -- lookdev --only sky,terrain,textures,vfx  # whole families
    ... --no-preview                                           # skip contact sheets

Keys: sky_<day|golden|night|overcast> · terrain_<name> (see terrain.TERRAINS) · grass_blades · water_normal · foam ·
cloud_noise · detail_noise · vfx_<name> (see vfx.EFFECTS).

Outputs: client/public/env/ (sky_*.hdr + sky_*.webp + manifest.json), client/public/textures/terrain/
(<name>_albedo/_normal/_orm/_height.webp + manifest.json), client/public/textures/*.webp (+ manifest.json),
client/public/vfx/*.webp + manifest.json; contact sheets assets/previews/lookdev_*.png.
Deterministic: fixed seeds everywhere, no time-dependent input.
"""
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

import common as C  # noqa: E402
import ld_common as L  # noqa: E402
import sky  # noqa: E402
import terrain  # noqa: E402
import textures  # noqa: E402
import vfx  # noqa: E402
from kit import gpu  # noqa: E402

args = C.parse_args()
SKY_KEYS = [f"sky_{n}" for n in ("day", "golden", "overcast", "night")]
TERRAIN_KEYS = [f"terrain_{n}" for n in terrain.TERRAINS]
TEX_KEYS = list(textures.KEYS)
VFX_KEYS = [f"vfx_{n}" for n in vfx.EFFECTS]
ALL = SKY_KEYS + TERRAIN_KEYS + TEX_KEYS + VFX_KEYS
FAMILIES = {"sky": SKY_KEYS, "terrain": TERRAIN_KEYS, "textures": TEX_KEYS, "vfx": VFX_KEYS}

only = [k.strip() for k in args.only.split(",") if k.strip()]
keys = []
for k in only or ALL:
    for kk in FAMILIES.get(k, [k]):
        if kk in ALL and kk not in keys:
            keys.append(kk)
        elif kk not in ALL:
            L.log(f"unknown key {kk!r} (known: {', '.join(ALL)})")

t0 = time.time()
sky_info, ter_info, tex_info, vfx_info, tex_imgs = {}, {}, {}, {}, {}


def _build_key(key):
    if key in SKY_KEYS:
        n = key[4:]
        sky_info[n] = sky.build_sky(n)
    elif key in TERRAIN_KEYS:
        n = key[8:]
        ter_info[n] = terrain.build_terrain(n)
    elif key in TEX_KEYS:
        tex_info[key], tex_imgs[key] = textures.BUILDERS[key]()
    elif key in VFX_KEYS:
        n = key[4:]
        vfx_info[n] = vfx.build_effect(n, previews=not args.no_preview)


for key in keys:
    t = time.time()
    # hold the cross-process GPU lock for the whole key (dozens of renders) instead of queueing per render:
    # with many Blender agents sharing one GPU, per-render queueing starves and falls back to a saturated CPU
    held = gpu.enable_hip() and gpu.acquire(int(os.environ.get("LOOKDEV_GPU_WAIT", "1800")))
    try:
        _build_key(key)
    finally:
        if held:
            gpu.release()
    L.log(f"== {key} done in {time.time() - t:.1f}s")

if sky_info:
    sky.write_manifest(sky_info)
if ter_info:
    terrain.write_manifest(ter_info)
if tex_info:
    textures.write_manifest(tex_info)
if vfx_info:
    vfx.write_manifest(vfx_info)
if not args.no_preview:
    if sky_info:
        sky.preview(["day", "golden", "overcast", "night"])
    if ter_info:
        terrain.preview(terrain.TERRAINS)
    if tex_info:
        textures.preview(tex_imgs)
    if vfx_info:
        vfx.contact_sheet(vfx.EFFECTS)
L.log(f"lookdev: {len(keys)} keys in {time.time() - t0:.1f}s")
