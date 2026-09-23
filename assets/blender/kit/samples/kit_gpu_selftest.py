"""Regression check for kit.gpu: common.reset() (read_factory_settings) wipes the Cycles device preferences;
kit.gpu must notice and re-enable HIP instead of silently baking on the CPU (bug reported by Codex).

blender -b --factory-startup --python assets/blender/kit/samples/kit_gpu_selftest.py   -> exit code 1 on failure
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
import bpy  # noqa: E402

import common as C  # noqa: E402
from kit import gpu  # noqa: E402

try:
    res = gpu.self_test()
    for i in range(2):                       # the real pattern of a group script: reset, build, bake, reset...
        C.reset()
        with gpu.device(bpy.context.scene, 4) as dev:
            if res["gpu"] and (dev != "GPU" or bpy.context.scene.cycles.device != "GPU" or not gpu.prefs_ok()):
                raise RuntimeError(f"after reset #{i + 1}: device={dev} prefs_ok={gpu.prefs_ok()}")
    print("[gpu-selftest] PASS", res, flush=True)
except Exception as e:
    print(f"[gpu-selftest] FAIL {e}", flush=True)
    sys.exit(1)
