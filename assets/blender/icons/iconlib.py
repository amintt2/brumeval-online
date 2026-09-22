"""Icon renderer for the `icons` group.

Why not common.render_icon? Icons need (1) tight framing from the *projected* silhouette so every object
fills ~85 % of the frame whatever its shape, (2) a camera-relative 3-point light rig with a rim light,
(3) a glow for magical / epic parts, (4) a thin dark outline so silhouettes read at 40 px on any
background, and (5) opaque class-tinted backdrops for ability icons. All of this is done here:

    pass A : lit render, transparent film, 2x supersampled
    pass B : emission only (lights off, world black) -> blurred -> glow layer   (only when glow > 0)
    numpy  : glow + outline + object (+ backdrop) composited, box-downsampled to the final size, saved as PNG.
"""
import math
import os
import tempfile

import bpy
import numpy as np
from mathutils import Vector


TMP = os.path.join(tempfile.gettempdir(), "brumeval_icons")


# --------------------------------------------------------------------------- colour utils (sRGB 0..1)
def srgb(hexstr):
    h = hexstr.lstrip("#")
    return np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)], np.float32)


def mix(a, b, t):
    return a * (1.0 - t) + b * t


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


# --------------------------------------------------------------------------- scene setup
def _world(strength=0.55):
    scene = bpy.context.scene
    world = bpy.data.worlds.new("IconWorld")
    scene.world = world
    nt = world.node_tree
    nodes = nt.nodes
    bg = nodes.get("Background")
    out = nodes.get("World Output")
    if bg is None:
        bg = nodes.new("ShaderNodeBackground")
    if out is None:
        out = nodes.new("ShaderNodeOutputWorld")
        nt.links.new(bg.outputs[0], out.inputs[0])
    tc = nodes.new("ShaderNodeTexCoord")
    sep = nodes.new("ShaderNodeSeparateXYZ")
    mr = nodes.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = -1.0
    mr.inputs["From Max"].default_value = 1.0
    ramp = nodes.new("ShaderNodeValToRGB")
    els = ramp.color_ramp.elements
    els[0].position = 0.0
    els[0].color = (0.035, 0.03, 0.03, 1)
    els[1].position = 1.0
    els[1].color = (1.0, 0.93, 0.82, 1)
    mid = els.new(0.52)
    mid.color = (0.5, 0.48, 0.46, 1)
    nt.links.new(tc.outputs["Generated"], sep.inputs[0])
    nt.links.new(sep.outputs["Z"], mr.inputs["Value"])
    nt.links.new(mr.outputs["Result"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = strength
    return bg


def _camera(yaw, pitch):
    cd = bpy.data.cameras.new("IconCam")
    cd.type = "ORTHO"
    cam = bpy.data.objects.new("IconCam", cd)
    bpy.context.scene.collection.objects.link(cam)
    yaw, pitch = math.radians(yaw), math.radians(pitch)
    direction = Vector((math.sin(yaw) * math.cos(pitch), -math.cos(yaw) * math.cos(pitch), math.sin(pitch)))
    cam.rotation_euler = (-direction).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = cam
    return cam


def _world_points(objs):
    dg = bpy.context.evaluated_depsgraph_get()
    chunks = []
    for o in objs:
        if o.type != "MESH" or o.hide_render:
            continue
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        n = len(me.vertices)
        if n:
            co = np.empty(n * 3, np.float32)
            me.vertices.foreach_get("co", co)
            co = co.reshape(n, 3)
            mw = np.array(ev.matrix_world, np.float32)
            chunks.append(co @ mw[:3, :3].T + mw[:3, 3])
        ev.to_mesh_clear()
    return np.concatenate(chunks) if chunks else np.zeros((1, 3), np.float32)


def _frame(cam, objs, fill, offset=(0.0, 0.0)):
    """Centre the ortho camera on the projected silhouette and scale it so it fills `fill` of the frame."""
    bpy.context.view_layer.update()
    pts = _world_points(objs)
    rot = np.array(cam.matrix_world.to_3x3(), np.float32)
    loc = pts @ rot  # camera-local coordinates (rows: x right, y up, z towards camera)
    mn, mx = loc.min(0), loc.max(0)
    w, h = mx[0] - mn[0], mx[1] - mn[1]
    ext = max(w, h, 1e-3)
    cx = (mn[0] + mx[0]) / 2 - offset[0] * ext / fill
    cy = (mn[1] + mx[1]) / 2 - offset[1] * ext / fill
    depth = mx[2] - mn[2]
    cam.location = Vector((rot @ np.array([cx, cy, mx[2] + depth + 2.0], np.float32)).tolist())
    cam.data.ortho_scale = ext / fill
    cam.data.clip_start = 0.01
    cam.data.clip_end = depth * 3 + 10.0
    return ext


def _lights(cam, key=3.2, fill=1.1, rim=4.5, key_col=(1.0, 0.94, 0.84), rim_col=(1.0, 0.97, 0.9)):
    R = cam.matrix_world.to_3x3()
    right, up, back = R @ Vector((1, 0, 0)), R @ Vector((0, 1, 0)), R @ Vector((0, 0, 1))
    rig = [
        ("IconKey", (-0.55 * right + 0.75 * up + 0.8 * back), key, key_col, 8.0),
        ("IconFill", (0.9 * right - 0.15 * up + 0.55 * back), fill, (0.78, 0.86, 1.0), 20.0),
        ("IconRim", (0.45 * right + 0.55 * up - 1.0 * back), rim, rim_col, 4.0),
    ]
    out = []
    for name, d, energy, col, ang in rig:
        ld = bpy.data.lights.new(name, "SUN")
        ld.energy = energy
        ld.color = col
        ld.angle = math.radians(ang)
        lo = bpy.data.objects.new(name, ld)
        bpy.context.scene.collection.objects.link(lo)
        lo.rotation_euler = (-d.normalized()).to_track_quat("-Z", "Y").to_euler()
        out.append(lo)
    return out


def _render_to(path, size):
    s = bpy.context.scene
    s.render.engine = "BLENDER_EEVEE"
    s.eevee.taa_render_samples = 48
    s.render.resolution_x = s.render.resolution_y = size
    s.render.resolution_percentage = 100
    s.render.film_transparent = True
    s.render.filter_size = 1.2
    s.render.image_settings.file_format = "PNG"
    s.render.image_settings.color_mode = "RGBA"
    s.render.image_settings.color_depth = "8"
    s.view_settings.view_transform = "Standard"
    s.view_settings.look = "None"
    s.render.filepath = path
    bpy.ops.render.render(write_still=True)


# --------------------------------------------------------------------------- image IO (8-bit PNG, display values)
def load_rgba(path):
    img = bpy.data.images.load(path, check_existing=False)
    w, h = img.size
    a = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(a)
    bpy.data.images.remove(img)
    return a.reshape(h, w, 4)


def save_rgba(arr, path):
    h, w, _ = arr.shape
    img = bpy.data.images.new("_icon_out", w, h, alpha=True)
    img.pixels.foreach_set(np.clip(arr, 0, 1).astype(np.float32).ravel())
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)
    return path


# --------------------------------------------------------------------------- numpy image ops (premultiplied RGBA)
def premul(a):
    out = a.copy()
    out[..., :3] *= out[..., 3:4]
    return out


def unpremul(a):
    out = a.copy()
    al = np.maximum(out[..., 3:4], 1e-6)
    out[..., :3] = np.where(out[..., 3:4] > 1e-6, out[..., :3] / al, 0.0)
    return out


def over(top, bottom):
    return top + bottom * (1.0 - top[..., 3:4])


def blur(img, sigma):
    """Separable gaussian blur of an (H, W, C) array (zero padding)."""
    r = max(1, int(sigma * 3))
    x = np.arange(-r, r + 1, dtype=np.float32)
    k = np.exp(-(x * x) / (2 * sigma * sigma))
    k /= k.sum()
    out = img
    for axis in (0, 1):
        pad = [(0, 0)] * img.ndim
        pad[axis] = (r, r)
        p = np.pad(out, pad)
        acc = np.zeros_like(out)
        n = out.shape[axis]
        for i, kv in enumerate(k):
            sl = [slice(None)] * img.ndim
            sl[axis] = slice(i, i + n)
            acc += kv * p[tuple(sl)]
        out = acc
    return out


def dilate(mask, radius):
    """Max filter with a disc of `radius` px on a (H, W) mask."""
    r = int(math.ceil(radius))
    h, w = mask.shape
    p = np.pad(mask, r)
    out = np.zeros_like(mask)
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            d = math.hypot(dx, dy)
            if d > radius + 0.5:
                continue
            wgt = 1.0 if d <= radius - 0.5 else (radius + 0.5 - d)
            out = np.maximum(out, p[r + dy:r + dy + h, r + dx:r + dx + w] * wgt)
    return out


def downsample(img, f):
    if f == 1:
        return img
    h, w, c = img.shape
    return img.reshape(h // f, f, w // f, f, c).mean(axis=(1, 3))


def edge_fade(h, w, px):
    """1 inside, fading to 0 in the last `px` pixels near the border (keeps glows from being cut hard)."""
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    d = np.minimum(np.minimum(xx, w - 1 - xx), np.minimum(yy, h - 1 - yy))
    return smoothstep(0.0, px, d)[..., None]


# --------------------------------------------------------------------------- ability backdrop
def backdrop(size, color_hex, rays=True):
    """Opaque square backdrop tinted by a class colour: radial gradient, faint light rays, bevelled edge.
    Arrays follow Blender's pixel order (row 0 = BOTTOM), so v = 1 is the top of the icon."""
    c = srgb(color_hex)
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    u = (xx + 0.5) / size
    v = (yy + 0.5) / size
    unit = 1.0 / 128.0  # one pixel of the final 128 px icon
    dx, dy = u - 0.5, v - 0.54
    dist = np.sqrt(dx * dx + dy * dy)
    light = np.clip(mix(c, np.ones(3, np.float32), 0.38) * 1.12, 0, 1)
    mid = c * 0.9
    dark = c * 0.22
    t = smoothstep(0.0, 0.72, dist)[..., None]
    col = np.where(t < 0.5, mix(light, mid, t * 2), mix(mid, dark, (t - 0.5) * 2))
    if rays:
        ang = np.arctan2(dy, dx)
        ray = 0.5 + 0.5 * np.cos(ang * 12.0)
        ray = smoothstep(0.55, 1.0, ray) * (1.0 - smoothstep(0.05, 0.7, dist))
        col = col + ray[..., None] * 0.10
    col = col * (0.86 + 0.22 * v[..., None])  # slightly lighter towards the top
    d_left, d_right, d_top, d_bot = u, 1.0 - u, 1.0 - v, v
    edge = np.minimum(np.minimum(d_left, d_right), np.minimum(d_top, d_bot))
    rim = 1.0 - smoothstep(0.0, 2.0 * unit, edge)
    hi = (1.0 - smoothstep(0.0, 6.0 * unit, np.minimum(d_left, d_top))) * (1 - rim)
    lo = (1.0 - smoothstep(0.0, 8.0 * unit, np.minimum(d_right, d_bot))) * (1 - rim)
    col = col + hi[..., None] * 0.14 - lo[..., None] * 0.12
    col = mix(col, c * 0.12, rim[..., None] * 0.85)
    vig = smoothstep(0.45, 0.85, np.sqrt((u - 0.5) ** 2 + (v - 0.5) ** 2) * 1.2)
    col = col * (1.0 - 0.35 * vig[..., None])
    out = np.ones((size, size, 4), np.float32)
    out[..., :3] = np.clip(col, 0, 1)
    return out


# --------------------------------------------------------------------------- main entry
def render_icon(key, args, *, yaw=0.0, pitch=0.0, fill=0.86, offset=(0.0, 0.0), bg=None, glow=0.0,
                glow_sigma=7.0, bloom_over=0.25, outline=0.85, outline_px=2.2, outline_col="#140e0a",
                size=128, ss=2, frame_objs=None, key_light=3.2, fill_light=1.1, rim_light=4.5, world=0.55):
    """Render the current scene as <icons>/<key>.png (size x size RGBA).

    yaw/pitch: camera direction (degrees, same convention as common.render_preview; 0/0 looks along +Y).
    fill: fraction of the frame covered by the projected silhouette (larger side).
    bg: None -> transparent background (item icon) | '#rrggbb' -> opaque class backdrop (ability icon).
    glow: strength of the halo computed from emissive surfaces (0 = off); bloom_over adds part of it on top.
    """
    os.makedirs(TMP, exist_ok=True)
    scene = bpy.context.scene
    objs = frame_objs or [o for o in scene.objects if o.type == "MESH"]
    cam = _camera(yaw, pitch)
    _frame(cam, objs, fill, offset)
    bgnode = _world(world)
    lights = _lights(cam, key_light, fill_light, rim_light)
    S = size * ss

    pa = os.path.join(TMP, f"{key}_a.png")
    _render_to(pa, S)
    A = premul(load_rgba(pa))
    os.remove(pa)
    comp = np.zeros((S, S, 4), np.float32)
    G = None
    if glow > 0:
        # pass B: emission only (lights off, black world) -> blurred -> additive-looking halo layer
        for lo in lights:
            lo.hide_render = True
        bgnode.inputs["Strength"].default_value = 0.0
        pb = os.path.join(TMP, f"{key}_b.png")
        _render_to(pb, S)
        B = premul(load_rgba(pb))
        os.remove(pb)
        for lo in lights:
            lo.hide_render = False
        bgnode.inputs["Strength"].default_value = world
        src = B[..., :3]
        g = (blur(src, glow_sigma * ss / 2) + blur(src, glow_sigma * ss / 5) * 0.6) * glow
        ga = np.clip(g.max(axis=2, keepdims=True), 0, 1)
        G = np.concatenate([np.minimum(np.clip(g, 0, 1), ga), ga], axis=2) * edge_fade(S, S, 7 * ss)
        comp = over(G, comp)
    if outline > 0:
        mask = dilate(A[..., 3], outline_px * ss / 2)
        O = np.zeros((S, S, 4), np.float32)
        O[..., 3] = mask * outline
        O[..., :3] = srgb(outline_col) * O[..., 3:4]
        comp = over(O, comp)
    comp = over(A, comp)
    if G is not None and bloom_over > 0:
        comp[..., :3] = np.minimum(comp[..., :3] + G[..., :3] * bloom_over * A[..., 3:4], comp[..., 3:4])
    if bg is not None:
        comp = over(comp, backdrop(S, bg))
    out = unpremul(downsample(comp, ss))
    path = os.path.join(args.icons, f"{key}.png")
    save_rgba(out, path)
    print(f"[icon] {path}")
    return path
