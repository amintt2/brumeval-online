"""Brumeval Blender kit (Blender 5.0, headless).

Usage from a group script (assets/blender/<group>/build.py):

    import sys, os
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # -> assets/blender
    import common as C
    from kit import materials, gn, bake, lod, qa, render, gpu, export, rig

See docs/PIPELINE_BLENDER.md for the full workflow (French).
"""
import os

KIT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(KIT_DIR)))  # repo root
PREVIEWS = os.path.join(ROOT, "assets", "previews")
MODELS = os.path.join(ROOT, "client", "public", "models")
