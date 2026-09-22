"""Shared helpers for all Blender asset scripts (Blender 5.0, run headless).

Conventions (see SPEC.md §Assets):
  * 1 Blender unit = 1 metre. Models stand on the ground: origin at (0,0,0) = between the feet / base centre.
  * Characters and creatures FACE -Y in Blender (Blender "front" view). The glTF exporter turns that into
    +Z, which is the forward axis the Three.js client uses (yaw 0 = facing +Z).
  * Low-poly, flat-shaded, stylised; colour comes from simple Principled materials (no image textures).
  * Animated models: one Armature, meshes skinned to it, one Action per clip, names exactly as in SPEC.

Typical script:
    import sys, os; sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    import common as C
    args = C.parse_args()
    for key in C.selected(args, ["tree_pine", ...]):
        C.reset()
        ... build ...
        C.export_glb(key, args)          # -> <out>/<key>.glb
        C.render_preview(key, args)      # -> <previews>/<key>.png  (always AFTER export)
"""
import argparse
import math
import os
import sys

import bpy
import mathutils

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # repo root
DEFAULT_OUT = os.path.join(ROOT, "client", "public", "models")
DEFAULT_ICONS = os.path.join(ROOT, "client", "public", "icons")
DEFAULT_PREVIEWS = os.path.join(ROOT, "assets", "previews")


# --------------------------------------------------------------------------- CLI
def parse_args():
    """Parse arguments placed after `--` on the blender command line."""
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--out", default=DEFAULT_OUT, help="directory for .glb files")
    p.add_argument("--icons", default=DEFAULT_ICONS, help="directory for icon .png files")
    p.add_argument("--previews", default=DEFAULT_PREVIEWS, help="directory for preview renders")
    p.add_argument("--only", default="", help="comma separated list of asset keys to build")
    p.add_argument("--no-preview", action="store_true", help="skip preview renders (faster)")
    a = p.parse_args(argv)
    for d in (a.out, a.icons, a.previews):
        os.makedirs(d, exist_ok=True)
    return a


def selected(args, keys):
    only = [k.strip() for k in args.only.split(",") if k.strip()]
    return [k for k in keys if not only or k in only]


# --------------------------------------------------------------------------- scene
def reset():
    """Empty scene, metric units, no leftover datablocks."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    s = bpy.context.scene
    s.unit_settings.system = "METRIC"
    s.render.fps = 24
    s.frame_start = 1
    s.frame_end = 48
    return s


def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def deselect_all():
    for o in bpy.context.scene.objects:
        o.select_set(False)


def activate(obj):
    deselect_all()
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    return obj


# --------------------------------------------------------------------------- materials
_MATS = {}


def material(name, color, rough=0.75, metal=0.0, emit=None, emit_strength=2.0, alpha=1.0):
    """Principled material; `color`/`emit` are (r,g,b) in 0..1 (sRGB-ish values are fine).
    Cached per name within the current file (cache is cleared by reset())."""
    m = bpy.data.materials.get(name)
    if m is not None:
        return m
    m = bpy.data.materials.new(name)
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color[:3], 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if emit is not None:
        bsdf.inputs["Emission Color"].default_value = (*emit[:3], 1.0)
        bsdf.inputs["Emission Strength"].default_value = emit_strength
    if alpha < 1.0:
        bsdf.inputs["Alpha"].default_value = alpha
        m.surface_render_method = "BLENDED"
    m.diffuse_color = (*color[:3], alpha)
    return m


def hex_color(h):
    """'#aabbcc' -> linear-ish (r,g,b) floats. Blender colour sockets are linear; this converts sRGB->linear."""
    h = h.lstrip("#")
    srgb = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb)


# --------------------------------------------------------------------------- primitives
def _finish(obj, name, mat, loc, rot, scale, smooth):
    obj.name = name
    if loc is not None:
        obj.location = loc
    if rot is not None:
        obj.rotation_euler = rot
    if scale is not None:
        obj.scale = scale if isinstance(scale, (tuple, list)) else (scale, scale, scale)
    if mat is not None:
        obj.data.materials.clear()
        obj.data.materials.append(mat)
    if smooth:
        for p in obj.data.polygons:
            p.use_smooth = True
    return obj


def cube(name="Cube", size=1.0, mat=None, loc=(0, 0, 0), rot=None, scale=None, smooth=False):
    bpy.ops.mesh.primitive_cube_add(size=size)
    return _finish(bpy.context.object, name, mat, loc, rot, scale, smooth)


def cylinder(name="Cyl", r=0.5, depth=1.0, verts=8, mat=None, loc=(0, 0, 0), rot=None, scale=None, smooth=False):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, vertices=verts)
    return _finish(bpy.context.object, name, mat, loc, rot, scale, smooth)


def cone(name="Cone", r1=0.5, r2=0.0, depth=1.0, verts=8, mat=None, loc=(0, 0, 0), rot=None, scale=None, smooth=False):
    bpy.ops.mesh.primitive_cone_add(radius1=r1, radius2=r2, depth=depth, vertices=verts)
    return _finish(bpy.context.object, name, mat, loc, rot, scale, smooth)


def sphere(name="Sphere", r=0.5, segments=12, rings=8, mat=None, loc=(0, 0, 0), rot=None, scale=None, smooth=True):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, segments=segments, ring_count=rings)
    return _finish(bpy.context.object, name, mat, loc, rot, scale, smooth)


def ico(name="Ico", r=0.5, subdiv=1, mat=None, loc=(0, 0, 0), rot=None, scale=None, smooth=False):
    bpy.ops.mesh.primitive_ico_sphere_add(radius=r, subdivisions=subdiv)
    return _finish(bpy.context.object, name, mat, loc, rot, scale, smooth)


def torus(name="Torus", major=0.5, minor=0.1, seg=16, minor_seg=6, mat=None, loc=(0, 0, 0), rot=None, scale=None, smooth=True):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=seg, minor_segments=minor_seg)
    return _finish(bpy.context.object, name, mat, loc, rot, scale, smooth)


def jitter(obj, amount=0.05, seed=1):
    """Randomly displace vertices for an organic low-poly look (deterministic)."""
    import random
    rnd = random.Random(seed)
    for v in obj.data.vertices:
        v.co += mathutils.Vector((rnd.uniform(-amount, amount), rnd.uniform(-amount, amount), rnd.uniform(-amount, amount)))
    return obj


def apply_transforms(obj):
    activate(obj)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return obj


def join(objs, name):
    """Apply transforms of every object and join them into a single mesh named `name` (keeps materials)."""
    objs = [o for o in objs if o is not None]
    for o in objs:
        apply_transforms(o)
    deselect_all()
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    out = bpy.context.object
    out.name = name
    out.data.name = name
    return out


def flat(obj):
    for p in obj.data.polygons:
        p.use_smooth = False
    return obj


# --------------------------------------------------------------------------- export
def export_glb(key, args, objects=None, animations=True):
    """Export the scene (or `objects`) to <args.out>/<key>.glb. Returns the path."""
    path = os.path.join(args.out, f"{key}.glb")
    deselect_all()
    use_sel = objects is not None
    if use_sel:
        for o in objects:
            o.select_set(True)
    for a in bpy.data.actions:
        a.use_fake_user = True
    # Leave armatures in rest/no action so the exported bind pose is clean.
    for o in bpy.context.scene.objects:
        if o.type == "ARMATURE" and o.animation_data:
            o.animation_data.action = None
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=use_sel,
        export_apply=True,
        export_yup=True,
        export_animations=animations,
        export_animation_mode="ACTIONS",
        export_anim_single_armature=True,
        export_force_sampling=True,
        export_optimize_animation_size=True,
        export_skins=True,
        export_def_bones=False,
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
    )
    print(f"[export] {path}")
    return path


# --------------------------------------------------------------------------- rendering
def _mesh_bbox(objs):
    dg = bpy.context.evaluated_depsgraph_get()
    mn = mathutils.Vector((1e9, 1e9, 1e9))
    mx = mathutils.Vector((-1e9, -1e9, -1e9))
    found = False
    for o in objs:
        if o.type != "MESH":
            continue
        ev = o.evaluated_get(dg)
        for c in ev.bound_box:
            w = ev.matrix_world @ mathutils.Vector(c)
            mn = mathutils.Vector((min(mn[i], w[i]) for i in range(3)))
            mx = mathutils.Vector((max(mx[i], w[i]) for i in range(3)))
            found = True
    if not found:
        mn, mx = mathutils.Vector((-1, -1, 0)), mathutils.Vector((1, 1, 2))
    return mn, mx


def _render(path, size, yaw_deg, pitch_deg, margin, objs=None, action=None, frame=None, bg=None):
    scene = bpy.context.scene
    temp = []
    objs = objs or [o for o in scene.objects if o.type == "MESH"]
    # optional pose for the preview
    if action is not None:
        for o in scene.objects:
            if o.type == "ARMATURE":
                o.animation_data_create()
                o.animation_data.action = bpy.data.actions.get(action)
        scene.frame_set(frame or 1)
    mn, mx = _mesh_bbox(objs)
    centre = (mn + mx) / 2
    radius = max((mx - mn).length / 2, 0.05)

    cam_data = bpy.data.cameras.new("_PreviewCam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = radius * 2 * margin
    cam_data.clip_end = radius * 40
    cam = link(bpy.data.objects.new("_PreviewCam", cam_data))
    yaw, pitch = math.radians(yaw_deg), math.radians(pitch_deg)
    # camera placed in front of the model (models face -Y), rotated by yaw around Z
    direction = mathutils.Vector((math.sin(yaw) * math.cos(pitch), -math.cos(yaw) * math.cos(pitch), math.sin(pitch)))
    cam.location = centre + direction * radius * 10
    cam.rotation_euler = (centre - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam
    temp.append(cam)

    for nm, rot, energy, col in (("_Key", (math.radians(50), 0, math.radians(-35)), 3.5, (1.0, 0.96, 0.9)),
                                 ("_Fill", (math.radians(60), 0, math.radians(140)), 1.2, (0.8, 0.88, 1.0))):
        ld = bpy.data.lights.new(nm, "SUN")
        ld.energy = energy
        ld.color = col
        lo = link(bpy.data.objects.new(nm, ld))
        lo.rotation_euler = rot
        temp.append(lo)

    world = scene.world or bpy.data.worlds.new("_PreviewWorld")
    scene.world = world
    bgnode = world.node_tree.nodes.get("Background")
    if bgnode:
        bgnode.inputs["Color"].default_value = (0.45, 0.47, 0.52, 1)
        bgnode.inputs["Strength"].default_value = 0.8

    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = bg is None
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "Standard"
    os.makedirs(os.path.dirname(path), exist_ok=True)
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print(f"[render] {path}")

    for o in temp:
        data = o.data
        bpy.data.objects.remove(o, do_unlink=True)
        if isinstance(data, bpy.types.Camera):
            bpy.data.cameras.remove(data)
        elif isinstance(data, bpy.types.Light):
            bpy.data.lights.remove(data)
    return path


def render_preview(key, args, size=384, yaw=35, pitch=20, action=None, frame=None):
    """3/4 view render of the whole scene to <previews>/<key>.png. Call AFTER export_glb.
    Pass action='Walk', frame=6 to preview a pose."""
    if getattr(args, "no_preview", False):
        return None
    return _render(os.path.join(args.previews, f"{key}.png"), size, yaw, pitch, 1.15, action=action, frame=frame)


def render_icon(icon_key, args, objs=None, size=128, yaw=30, pitch=25, margin=1.08):
    """Transparent-background square icon to <icons>/<icon_key>.png."""
    return _render(os.path.join(args.icons, f"{icon_key}.png"), size, yaw, pitch, margin, objs=objs)
