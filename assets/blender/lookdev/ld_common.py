"""Look-dev helpers (sky HDRIs, tileable textures, VFX flipbooks) — Blender 5.0 headless.

Everything is rendered with Cycles (GPU through kit.gpu's cross-process lock, CPU fallback) into float EXR files
that are read back with numpy; post-processing (tiling checks, normal maps from height, atlases, tonemapping) is
numpy; outputs are written with Blender's own WebP / Radiance HDR writers.
"""
import math
import os
import sys
import tempfile
import time

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))  # -> assets/blender

from kit import gpu  # noqa: E402
from kit.nodes import NB, sock, srgb  # noqa: E402,F401
from kit import render as KR  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
PUBLIC = os.path.join(ROOT, "client", "public")
ENV_DIR = os.path.join(PUBLIC, "env")
TEX_DIR = os.path.join(PUBLIC, "textures")
TERRAIN_DIR = os.path.join(TEX_DIR, "terrain")
VFX_DIR = os.path.join(PUBLIC, "vfx")
PREVIEWS = os.path.join(ROOT, "assets", "previews")
TMP = os.path.join(tempfile.gettempdir(), f"brumeval_lookdev_{os.getpid()}")
for _d in (ENV_DIR, TERRAIN_DIR, VFX_DIR, PREVIEWS, TMP):
    os.makedirs(_d, exist_ok=True)

TAU = 2.0 * math.pi


def log(msg):
    print(f"[lookdev] {msg}", flush=True)


# =============================================================================== scene / render
def new_scene(res=(512, 512), samples=32, transparent=False, view="Standard"):
    """Fresh factory scene configured for Cycles look-dev renders (linear float output)."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = "METRIC"
    sc.render.engine = "CYCLES"
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = transparent
    sc.render.use_persistent_data = True
    sc.cycles.samples = samples
    sc.cycles.use_denoising = False
    sc.cycles.use_adaptive_sampling = False
    sc.cycles.pixel_filter_type = "BLACKMAN_HARRIS"
    sc.cycles.filter_width = 1.5
    sc.view_settings.view_transform = view
    sc.view_settings.look = "None"
    sc.view_settings.exposure = 0.0
    sc.view_settings.gamma = 1.0
    sc.render.image_settings.file_format = "OPEN_EXR"
    sc.render.image_settings.color_depth = "32"
    sc.render.image_settings.exr_codec = "ZIP"
    sc.render.image_settings.color_mode = "RGBA"
    w = bpy.data.worlds.new("World")
    sc.world = w
    w.use_nodes = True
    return sc


def world_color(sc, color=(0, 0, 0), strength=1.0):
    nt = sc.world.node_tree
    nt.nodes.clear()
    nb = NB(nt)
    bg = nb.node("ShaderNodeBackground", Color=tuple(color) + (1.0,) if len(color) == 3 else color, Strength=strength)
    out = nb.node("ShaderNodeOutputWorld")
    nb.link(bg.outputs[0], out.inputs["Surface"])
    return nb


def read_exr(path):
    img = bpy.data.images.load(path, check_existing=False)
    img.colorspace_settings.name = "Non-Color"
    w, h = img.size
    a = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    bpy.data.images.remove(img)
    return a.reshape(h, w, 4)


def render(sc, name="frame", samples=None, denoise=False, gpu_wait=240):
    """Render the current frame with Cycles; returns HxWx4 float32 linear (premultiplied alpha if transparent)."""
    samples = samples or sc.cycles.samples
    path = os.path.join(TMP, f"{name}.exr")
    sc.render.filepath = path
    t = time.time()
    with gpu.device(sc, samples=samples, wait=gpu_wait) as dev:
        sc.cycles.use_denoising = bool(denoise)
        if denoise:
            sc.cycles.denoiser = "OPENIMAGEDENOISE"
            try:
                sc.cycles.denoising_input_passes = "RGB_ALBEDO_NORMAL"
            except Exception:
                pass
        bpy.ops.render.render(write_still=True)
    arr = read_exr(path)
    try:
        os.remove(path)
    except OSError:
        pass
    render.last = (dev, time.time() - t)
    return arr


render.last = ("", 0.0)


# =============================================================================== image IO
def lin_to_srgb(x):
    x = np.clip(x, 0.0, None)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def srgb_to_lin(x):
    x = np.clip(x, 0.0, 1.0)
    return np.where(x <= 0.04045, x / 12.92, np.power((x + 0.055) / 1.055, 2.4))


def _img_from(arr, name, float_buffer=False):
    arr = np.asarray(arr, dtype=np.float32)
    if arr.ndim == 2:
        arr = np.dstack([arr, arr, arr, np.ones_like(arr)])
    elif arr.shape[2] == 3:
        arr = np.dstack([arr, np.ones(arr.shape[:2], np.float32)])
    h, w = arr.shape[:2]
    old = bpy.data.images.get(name)
    if old:
        bpy.data.images.remove(old)
    img = bpy.data.images.new(name, w, h, alpha=True, float_buffer=float_buffer)
    img.colorspace_settings.name = "Non-Color"
    img.pixels.foreach_set(np.ascontiguousarray(arr).ravel())
    return img


def save_webp(arr, path, quality=88):
    """arr: HxW(x3/4) values already in the file's encoding (sRGB for colour, raw for data), origin bottom-left.
    quality 100 = lossless."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img = _img_from(np.clip(arr, 0, 1), "_ld_webp")
    img.filepath_raw = path
    img.file_format = "WEBP"
    img.save(quality=quality)
    bpy.data.images.remove(img)
    return os.path.getsize(path)


def save_png(arr, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img = _img_from(np.clip(arr, 0, 1), "_ld_png")
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)
    log(f"preview {os.path.relpath(path, ROOT)}")
    return path


def save_hdr(arr, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    a = np.array(arr, dtype=np.float32)
    a[..., 3] = 1.0
    img = _img_from(a, "_ld_hdr", float_buffer=True)
    img.filepath_raw = path
    img.file_format = "HDR"
    img.save()
    bpy.data.images.remove(img)
    return os.path.getsize(path)


def load_image(path):
    img = bpy.data.images.load(path, check_existing=False)
    img.colorspace_settings.name = "Non-Color"
    w, h = img.size
    a = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    bpy.data.images.remove(img)
    return a.reshape(h, w, 4)


def resize(arr, w, h):
    """Box/bilinear resize through a Blender image scale (good enough for previews and mip-like downsampling)."""
    arr = np.asarray(arr, np.float32)
    H, W = arr.shape[:2]
    if (W, H) == (w, h):
        return arr.copy()
    if W % w == 0 and H % h == 0:  # exact box filter
        fy, fx = H // h, W // w
        return arr.reshape(h, fy, w, fx, -1).mean(axis=(1, 3))
    img = _img_from(arr, "_ld_rs", float_buffer=True)
    img.scale(w, h)
    a = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    bpy.data.images.remove(img)
    return a.reshape(h, w, 4)[..., :arr.shape[2]] if arr.ndim == 3 else a.reshape(h, w, 4)[..., 0]


# =============================================================================== tiling helpers (numpy)
def normal_from_height(h, strength, wrap=True):
    """Tangent-space (OpenGL, +Y up) normal map from a height field in metres-per-pixel units * strength.
    Periodic finite differences when wrap=True (seamless)."""
    if wrap:
        dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
        dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
    else:
        dy, dx = np.gradient(h)
    n = np.dstack([-dx * strength, -dy * strength, np.ones_like(h)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return n


def encode_normal(n):
    return np.clip(n * 0.5 + 0.5, 0, 1)


def tile_seam_error(arr):
    """Mean abs difference across the wrap edge vs. mean abs difference between neighbouring interior pixels.
    ~1.0 = seamless (edge behaves like any interior line); >> 1 = visible seam."""
    a = np.asarray(arr, np.float32)
    if a.ndim == 3:
        a = a[..., :3].mean(axis=2)
    ex = np.abs(a[:, 0] - a[:, -1]).mean()
    ey = np.abs(a[0, :] - a[-1, :]).mean()
    ix = np.abs(np.diff(a, axis=1)).mean()
    iy = np.abs(np.diff(a, axis=0)).mean()
    return float(max(ex / max(ix, 1e-6), ey / max(iy, 1e-6)))


def tile3(arr):
    return np.tile(arr, (3, 3, 1) if arr.ndim == 3 else (3, 3))


# =============================================================================== periodic (torus) coordinates — shader nodes
def torus_coords(nb, uv, period=1.0, freq=4.0, offset=(0.0, 0.0, 0.0, 0.0)):
    """Map a 2D coordinate (x,y), periodic with `period`, onto a flat 4D Clifford torus so that 4D noise/voronoi
    evaluated there tiles perfectly. `freq` ~ features per tile (the torus radius is freq/(2*pi) so feature size
    stays isotropic). Returns (vector3_socket, w_socket)."""
    s = nb.sep(uv)
    ax = nb.mul(s[0], TAU / period)
    ay = nb.mul(s[1], TAU / period)
    r = freq / TAU
    cx = nb.add(nb.mul(nb.math("COSINE", ax), r), offset[0])
    sx = nb.add(nb.mul(nb.math("SINE", ax), r), offset[1])
    cy = nb.add(nb.mul(nb.math("COSINE", ay), r), offset[2])
    sy = nb.add(nb.mul(nb.math("SINE", ay), r), offset[3])
    return nb.xyz(cx, sx, cy), sy


def pnoise(nb, uv, freq, detail=4.0, rough=0.55, dist=0.0, seed=0, period=1.0, lac=2.0, ntype="FBM"):
    """Periodic 4D noise (Fac socket, ~0..1)."""
    v, w = torus_coords(nb, uv, period, freq, (seed * 1.7, seed * 3.1, seed * 5.3, seed * 7.9))
    n = nb.noise(v, 1.0, detail, rough, dist, lac, dim="4D", w=w, ntype=ntype)
    return n


def pvoronoi(nb, uv, freq, feature="F1", seed=0, period=1.0, rand=1.0, smooth=None, metric="EUCLIDEAN"):
    v, w = torus_coords(nb, uv, period, freq, (seed * 2.3, seed * 1.9, seed * 4.1, seed * 6.7))
    n = nb.node("ShaderNodeTexVoronoi", {"feature": feature, "distance": metric, "voronoi_dimensions": "4D"},
                Vector=v, Scale=1.0, Randomness=rand)
    nb.feed(sock(n.inputs, "W"), w)
    if smooth is not None:
        nb.feed(sock(n.inputs, "Smoothness"), smooth)
    return n


# =============================================================================== contact sheets
def label(arr, text, x=6, y=6, scale=2, color=(0.95, 0.9, 0.8)):
    """Draw a label with a dark backing strip (y measured from the top). Returns an RGBA array."""
    if arr.shape[2] == 3:
        arr = np.dstack([arr, np.ones(arr.shape[:2], np.float32)])
    h = arr.shape[0]
    tw = len(text) * 4 * scale + 6
    y0 = h - (y + 5 * scale + 4)
    arr[max(0, y0):h - y + 2, max(0, x - 3):x - 3 + tw, :3] *= 0.35
    KR.draw_text(arr, text, x, y, scale, color)
    return arr


def sheet(tiles, cols, title, pad=6, bg=(0.10, 0.10, 0.11)):
    tiles = [np.dstack([t[..., :3], np.ones(t.shape[:2], np.float32)]) if t.shape[2] == 3 else t for t in tiles]
    g = KR.grid(tiles, cols, pad=pad, bg=bg, header=34)
    KR.draw_text(g, title, 8, 9, 3)
    return g


def checker_bg(h, w, cell=16, a=0.16, b=0.24):
    yy, xx = np.mgrid[0:h, 0:w]
    c = (((yy // cell) + (xx // cell)) % 2).astype(np.float32)
    v = a + (b - a) * c
    return np.dstack([v, v, v])
