"""QA sheets rendered with EEVEE under a dark-fantasy look-dev light (golden-hour sky + warm sun + cool fill).

    paths = render.qa_sheets("rock_a", objs, out_dir=kit.PREVIEWS)   # all sheets + hero
    # -> <key>_turntable.png (8 angles) · <key>_wire.png · <key>_normals.png (blue front / RED BACK = error)
    #    <key>_uv.png (checker) · <key>_poses.png (every clip x N frames) · <key>.png (hero 3/4 view)

Always LOOK at them (Read tool): red in the normals sheet = back faces visible = error; stretched or huge/tiny
checker squares = bad UVs; body poking through clothes in the pose sheet = fix weights / delete hidden body.
"""
import math
import os
import tempfile

import bpy
import mathutils
import numpy as np

from . import PREVIEWS, gpu
from .nodes import NB, sock

BG = (0.26, 0.26, 0.27)
TMP = os.path.join(tempfile.gettempdir(), f"brumeval_render_{os.getpid()}")


# =============================================================================== bbox / camera
def _meshes(objs=None):
    objs = objs if objs is not None else bpy.context.scene.objects
    return [o for o in objs if o.type == "MESH" and not o.get("kit_template") and not o.name.startswith("_") and not o.hide_render]


def bbox(objs=None):
    dg = bpy.context.evaluated_depsgraph_get()
    mn = mathutils.Vector((1e9,) * 3)
    mx = mathutils.Vector((-1e9,) * 3)
    for o in _meshes(objs):
        ev = o.evaluated_get(dg)
        for c in ev.bound_box:
            w = ev.matrix_world @ mathutils.Vector(c)
            mn = mathutils.Vector(map(min, mn, w))
            mx = mathutils.Vector(map(max, mx, w))
    if mn.x > mx.x:
        return mathutils.Vector((-1, -1, 0)), mathutils.Vector((1, 1, 2))
    return mn, mx


def _cam_dir(yaw, pitch):
    y, p = math.radians(yaw), math.radians(pitch)
    # yaw 0 = camera in FRONT of the model (models face -Y); positive yaw orbits towards the model's left (+X)
    return mathutils.Vector((math.sin(y) * math.cos(p), -math.cos(y) * math.cos(p), math.sin(p)))


# =============================================================================== stage
class Stage:
    """Temporary look-dev setup: camera, lights, world, EEVEE settings, optional ground. Restores on exit."""

    def __init__(self, ground=False, sun_elev=18.0, sun_yaw=-40.0, flat=False, exposure=0.0):
        self.ground, self.sun_elev, self.sun_yaw, self.flat, self.exposure = ground, sun_elev, sun_yaw, flat, exposure
        self.tmp = []

    def __enter__(self):
        sc = bpy.context.scene
        self.saved = dict(engine=sc.render.engine, world=sc.world, camera=sc.camera, x=sc.render.resolution_x,
                          y=sc.render.resolution_y, transp=sc.render.film_transparent, vt=sc.view_settings.view_transform,
                          look=sc.view_settings.look, exp=sc.view_settings.exposure, override=bpy.context.view_layer.material_override)
        sc.render.engine = "BLENDER_EEVEE"
        ee = sc.eevee
        ee.taa_render_samples = 24
        for k, v in (("use_shadows", True), ("use_raytracing", True), ("shadow_resolution_scale", 1.0), ("use_fast_gi", True)):
            try:
                setattr(ee, k, v)
            except (AttributeError, TypeError):
                pass
        sc.render.film_transparent = True
        sc.render.image_settings.file_format = "PNG"
        sc.render.image_settings.color_mode = "RGBA"
        sc.render.resolution_percentage = 100
        try:
            sc.view_settings.view_transform = "AgX"
            sc.view_settings.look = "AgX - Medium High Contrast"
        except TypeError:
            sc.view_settings.view_transform = "Standard"
        sc.view_settings.exposure = self.exposure
        # world
        w = bpy.data.worlds.new("_KitLookdev")
        self.tmp.append(w)
        nb = NB(w.node_tree, clear=True)
        out = nb.node("ShaderNodeOutputWorld")
        bg = nb.node("ShaderNodeBackground")
        nb.link(bg.outputs[0], out.inputs["Surface"])
        if self.flat:
            bg.inputs["Color"].default_value = (1, 1, 1, 1)
            bg.inputs["Strength"].default_value = 1.0
        else:
            sky = nb.node("ShaderNodeTexSky")
            try:
                sky.sky_type = "MULTIPLE_SCATTERING"
            except TypeError:
                sky.sky_type = "HOSEK_WILKIE"
            try:
                sky.sun_elevation = math.radians(self.sun_elev)
                sky.sun_rotation = math.radians(self.sun_yaw + 180)
                sky.sun_disc = False
            except AttributeError:
                pass
            nb.link(sky.outputs[0], bg.inputs["Color"])
            bg.inputs["Strength"].default_value = 0.14
        sc.world = w
        if not self.flat:
            # calibrated so an albedo-0.18 surface facing the sun reads ~mid grey (AgX): the old 4.2 W sun blew the
            # lit side to beige/white and made every sun-facing facet look like a bake seam
            self._light("_KitSun", "SUN", 2.6, (1.0, 0.8, 0.6), self.sun_elev + 14, self.sun_yaw, angle=3.0)
            self._light("_KitFill", "SUN", 0.7, (0.55, 0.68, 1.0), 35, self.sun_yaw + 150)
            self._light("_KitRim", "SUN", 1.5, (1.0, 0.9, 0.8), 20, self.sun_yaw + 200)
        if self.ground:
            me = bpy.data.meshes.new("_KitGround")
            s = 400
            me.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
            mat = bpy.data.materials.new("_KitGroundMat")
            gnb = NB(mat.node_tree)
            b = next(n for n in mat.node_tree.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled")
            b.inputs["Base Color"].default_value = (0.045, 0.042, 0.04, 1)
            b.inputs["Roughness"].default_value = 0.95
            me.materials.append(mat)
            g = bpy.data.objects.new("_KitGround", me)
            g.location.z = -0.002
            sc.collection.objects.link(g)
            self.tmp += [g, me, mat]
        cd = bpy.data.cameras.new("_KitCam")
        cam = bpy.data.objects.new("_KitCam", cd)
        sc.collection.objects.link(cam)
        sc.camera = cam
        self.cam = cam
        self.tmp += [cam, cd]
        return self

    def _light(self, name, typ, energy, color, elev, yaw, angle=1.0):
        ld = bpy.data.lights.new(name, typ)
        ld.energy = energy
        ld.color = color
        try:
            ld.angle = math.radians(angle)
        except AttributeError:
            pass
        lo = bpy.data.objects.new(name, ld)
        d = _cam_dir(yaw, elev)
        lo.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
        bpy.context.scene.collection.objects.link(lo)
        self.tmp += [lo, ld]

    def frame(self, mn, mx, yaw, pitch, margin=1.08, ortho=False, lens=60.0, extent=None, center=None):
        c = mathutils.Vector(center) if center is not None else (mn + mx) / 2
        r = max((mx - mn).length / 2, 0.05)
        cam = self.cam
        d = _cam_dir(yaw, pitch)
        if ortho:
            cam.data.type = "ORTHO"
            cam.data.ortho_scale = (max(extent) if extent else r * 2) * margin
            cam.location = c + d * r * 6
        else:
            cam.data.type = "PERSP"
            cam.data.lens = lens
            cam.data.sensor_width = 36
            fov = 2 * math.atan(18 / lens)
            cam.location = c + d * (r * margin / math.sin(fov / 2))
        cam.data.clip_start = r * 0.02
        cam.data.clip_end = max(r * 400, 500.0)
        cam.rotation_euler = (c - cam.location).to_track_quat("-Z", "Y").to_euler()

    def shoot(self, w, h=None):
        sc = bpy.context.scene
        sc.render.resolution_x = w
        sc.render.resolution_y = h or w
        os.makedirs(TMP, exist_ok=True)
        p = os.path.join(TMP, "shot.png")
        sc.render.filepath = p
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(p, check_existing=False)
        a = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
        img.pixels.foreach_get(a)
        a = a.reshape(img.size[1], img.size[0], 4)
        bpy.data.images.remove(img)
        return a

    def __exit__(self, *exc):
        sc = bpy.context.scene
        s = self.saved
        sc.render.engine = s["engine"]
        sc.world = s["world"]
        sc.camera = s["camera"]
        sc.render.resolution_x, sc.render.resolution_y = s["x"], s["y"]
        sc.render.film_transparent = s["transp"]
        sc.view_settings.view_transform = s["vt"]
        try:
            sc.view_settings.look = s["look"]
        except TypeError:
            pass
        sc.view_settings.exposure = s["exp"]
        bpy.context.view_layer.material_override = s["override"]
        for d in self.tmp:
            try:
                if isinstance(d, bpy.types.Object):
                    bpy.data.objects.remove(d, do_unlink=True)
                elif isinstance(d, bpy.types.Camera):
                    bpy.data.cameras.remove(d)
                elif isinstance(d, bpy.types.Light):
                    bpy.data.lights.remove(d)
                elif isinstance(d, bpy.types.World):
                    bpy.data.worlds.remove(d)
                elif isinstance(d, bpy.types.Mesh):
                    bpy.data.meshes.remove(d)
                elif isinstance(d, bpy.types.Material):
                    bpy.data.materials.remove(d)
            except ReferenceError:
                pass
        return False


# =============================================================================== overrides
def _override(kind):
    m = bpy.data.materials.get(f"_KitOverride_{kind}")
    if m:
        return m
    m = bpy.data.materials.new(f"_KitOverride_{kind}")
    nb = NB(m.node_tree, clear=True)
    out = nb.node("ShaderNodeOutputMaterial")
    if kind == "normals":
        geo = nb.node("ShaderNodeNewGeometry")
        col = nb.mix((0.1, 0.3, 1.0), (1.0, 0.05, 0.05), geo.outputs["Backfacing"])
        dif = nb.node("ShaderNodeBsdfDiffuse", Color=col)
        em = nb.node("ShaderNodeEmission", Color=col, Strength=0.35)
        add = nb.node("ShaderNodeAddShader")
        nb.link(dif.outputs[0], add.inputs[0])
        nb.link(em.outputs[0], add.inputs[1])
        nb.link(add.outputs[0], out.inputs["Surface"])
    elif kind == "wire":
        wf = nb.node("ShaderNodeWireframe", {"use_pixel_size": True}, Size=1.0)
        tr = nb.node("ShaderNodeHoldout")          # transparent but still occludes hidden lines
        em = nb.node("ShaderNodeEmission", Color=(0.0, 0.0, 0.0, 1), Strength=1.0)
        mx = nb.node("ShaderNodeMixShader")
        nb.link(wf.outputs[0], mx.inputs[0])
        nb.link(tr.outputs[0], mx.inputs[1])
        nb.link(em.outputs[0], mx.inputs[2])
        nb.link(mx.outputs[0], out.inputs["Surface"])
    elif kind == "uv":
        img = bpy.data.images.get("_KitChecker") or bpy.data.images.new("_KitChecker", 1024, 1024)
        img.generated_type = "COLOR_GRID"
        uv = nb.node("ShaderNodeUVMap")
        tex = nb.node("ShaderNodeTexImage", {"image": img}, Vector=uv.outputs[0])
        dif = nb.node("ShaderNodeBsdfDiffuse", Color=tex.outputs["Color"])
        em = nb.node("ShaderNodeEmission", Color=tex.outputs["Color"], Strength=0.4)
        add = nb.node("ShaderNodeAddShader")
        nb.link(dif.outputs[0], add.inputs[0])
        nb.link(em.outputs[0], add.inputs[1])
        nb.link(add.outputs[0], out.inputs["Surface"])
    return m


# =============================================================================== compositing
_FONT = {
    "A": "010101111101101", "B": "110101110101110", "C": "011100100100011", "D": "110101101101110",
    "E": "111100110100111", "F": "111100110100100", "G": "011100101101011", "H": "101101111101101",
    "I": "111010010010111", "J": "001001001101010", "K": "101101110101101", "L": "100100100100111",
    "M": "101111111101101", "N": "110101101101101", "O": "010101101101010", "P": "110101110100100",
    "Q": "010101101110011", "R": "110101110101101", "S": "011100010001110", "T": "111010010010010",
    "U": "101101101101111", "V": "101101101101010", "W": "101101111111101", "X": "101101010101101",
    "Y": "101101010010010", "Z": "111001010100111", "0": "111101101101111", "1": "010110010010111",
    "2": "110001010100111", "3": "110001010001110", "4": "101101111001001", "5": "111100110001110",
    "6": "011100111101111", "7": "111001010010010", "8": "111101111101111", "9": "111101111001110",
    " ": "000000000000000", ".": "000000000000010", "_": "000000000000111", "-": "000000111000000",
    ":": "000010000010000", "/": "001001010100100", "=": "000111000111000", "#": "101111101111101",
}


def draw_text(arr, text, x, y, scale=3, color=(0.95, 0.9, 0.8)):
    """Draw text (top-left at x,y in image coords, y down) into an HxWx4 array (origin bottom-left)."""
    H = arr.shape[0]
    cx = x
    for ch in text.upper():
        g = _FONT.get(ch, _FONT["#"])
        for r in range(5):
            for c in range(3):
                if g[r * 3 + c] == "1":
                    y0 = H - (y + (r + 1) * scale)
                    x0 = cx + c * scale
                    if 0 <= y0 and y0 + scale <= H and 0 <= x0 and x0 + scale <= arr.shape[1]:
                        arr[y0:y0 + scale, x0:x0 + scale, :3] = color
                        arr[y0:y0 + scale, x0:x0 + scale, 3] = 1
        cx += 4 * scale
    return arr


def over_bg(tile, bg=BG, vignette=True):
    h, w = tile.shape[:2]
    out = np.empty_like(tile)
    base = np.ones((h, w, 3), dtype=np.float32) * np.array(bg, dtype=np.float32)
    if vignette:
        yy, xx = np.mgrid[0:h, 0:w]
        d = np.sqrt(((xx - w / 2) / w) ** 2 + ((yy - h * 0.55) / h) ** 2)
        base *= (1.15 - 0.6 * d)[..., None]
    a = tile[..., 3:4]
    out[..., :3] = tile[..., :3] * a + base * (1 - a)
    out[..., 3] = 1
    return out


HEADER = 30


def grid(tiles, cols, pad=4, bg=(0.12, 0.12, 0.13), header=HEADER):
    """Tile grid with a title strip of `header` px on top (draw the title at y=8)."""
    h, w = tiles[0].shape[:2]
    rows = (len(tiles) + cols - 1) // cols
    H, W = rows * h + (rows + 1) * pad + header, cols * w + (cols + 1) * pad
    out = np.ones((H, W, 4), dtype=np.float32)
    out[..., :3] = bg
    for i, t in enumerate(tiles):
        r, c = divmod(i, cols)
        y0 = H - header - pad - (r + 1) * h - r * pad
        x0 = pad + c * (w + pad)
        out[y0:y0 + h, x0:x0 + w] = t
    return out


def save_png(arr, path):
    path = os.path.abspath(path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    h, w = arr.shape[:2]
    img = bpy.data.images.new("_kit_sheet", w, h, alpha=True)
    img.pixels.foreach_set(np.clip(arr, 0, 1).astype(np.float32).ravel())
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)
    print(f"[render] {path}")
    return path


# =============================================================================== sheets
def _armatures(objs):
    arms = set()
    for o in bpy.context.scene.objects:
        if o.type == "ARMATURE":
            arms.add(o)
    return list(arms)


def _rest(arm):
    for pb in arm.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.rotation_euler = (0, 0, 0)
        pb.scale = (1, 1, 1)
    bpy.context.view_layer.update()


def _set_action(arm, act):
    arm.animation_data_create()
    arm.animation_data.action = act
    try:
        if act is not None and act.slots:
            arm.animation_data.action_slot = act.slots[0]
    except AttributeError:
        pass


def turntable(stage, objs, key, out_dir, size=320, pitch=14.0, angles=8, label=True):
    mn, mx = bbox(objs)
    tiles = []
    for i in range(angles):
        yaw = i * 360.0 / angles
        stage.frame(mn, mx, yaw, pitch)
        t = over_bg(stage.shoot(size))
        if label:
            draw_text(t, f"{int(yaw)}", 6, 6, 2)
        tiles.append(t)
    sheet = grid(tiles, 4)
    draw_text(sheet, f"{key} TURNTABLE", 8, 8, 3)
    return save_png(sheet, os.path.join(out_dir, f"{key}_turntable.png"))


def override_sheet(stage, objs, key, out_dir, kind, size=320, views=((0, 12), (90, 12), (180, 12), (270, 12), (35, 55), (215, -25))):
    mn, mx = bbox(objs)
    vl = bpy.context.view_layer
    tiles = []
    for yaw, pitch in views:
        stage.frame(mn, mx, yaw, pitch)
        if kind == "wire":
            vl.material_override = None
            base = stage.shoot(size)
            vl.material_override = _override("wire")
            lines = stage.shoot(size)
            vl.material_override = None
            a = lines[..., 3:4] * 0.85
            t = base.copy()
            t[..., :3] = base[..., :3] * (1 - a * 0.7) + np.array((1.0, 0.75, 0.3)) * a * 0.7
            t[..., 3:4] = np.maximum(base[..., 3:4], lines[..., 3:4])
        else:
            vl.material_override = _override(kind)
            t = stage.shoot(size)
            vl.material_override = None
        t = over_bg(t)
        draw_text(t, f"{yaw}/{pitch}", 6, 6, 2)
        tiles.append(t)
    sheet = grid(tiles, 3)
    title = {"wire": "WIREFRAME", "normals": "NORMALS BLUE=FRONT RED=BACK", "uv": "UV CHECKER"}[kind]
    draw_text(sheet, f"{key} {title}", 8, 8, 3)
    return save_png(sheet, os.path.join(out_dir, f"{key}_{ {'wire': 'wire', 'normals': 'normals', 'uv': 'uv'}[kind] }.png"))


def pose_sheet(stage, objs, key, out_dir, frames=6, size=220, yaw=35.0, pitch=10.0, actions=None, side_row=False):
    arms = _armatures(objs)
    if not arms:
        return None
    arm = arms[0]
    acts = actions or sorted(bpy.data.actions, key=lambda a: a.name)
    if not acts:
        return None
    sc = bpy.context.scene
    saved = arm.animation_data.action if arm.animation_data else None
    rows = []
    # union bbox over all sampled frames -> stable framing
    samples = []
    for act in acts:
        f0, f1 = act.frame_range
        samples.append((act, [f0 + (f1 - f0) * k / (frames - 1) for k in range(frames)]))
    mn = mathutils.Vector((1e9,) * 3)
    mx = mathutils.Vector((-1e9,) * 3)
    for act, fr in samples:
        _set_action(arm, act)
        for f in fr:
            sc.frame_set(int(f), subframe=f - int(f))
            a, b = bbox(objs)
            mn = mathutils.Vector(map(min, mn, a))
            mx = mathutils.Vector(map(max, mx, b))
    views = [(yaw, pitch)] + ([(90.0, 5.0)] if side_row else [])
    for act, fr in samples:
        _set_action(arm, act)
        for vy, vp in views:
            tiles = []
            for f in fr:
                sc.frame_set(int(f), subframe=f - int(f))
                stage.frame(mn, mx, vy, vp, margin=1.02)
                t = over_bg(stage.shoot(size))
                draw_text(t, f"{act.name} {f:.0f}", 5, 5, 2)
                tiles.append(t)
            rows.append(tiles)
    flat = [t for r in rows for t in r]
    sheet = grid(flat, frames)
    draw_text(sheet, f"{key} POSES", 8, 8, 3)
    _set_action(arm, saved)
    _rest(arm)
    sc.frame_set(sc.frame_start)
    return save_png(sheet, os.path.join(out_dir, f"{key}_poses.png"))


def hero(stage, objs, key, out_dir, size=768, yaw=35.0, pitch=16.0, action=None, frame=None):
    arms = _armatures(objs)
    if action and arms:
        _set_action(arms[0], bpy.data.actions.get(action))
        bpy.context.scene.frame_set(frame or 1)
    mn, mx = bbox(objs)
    stage.frame(mn, mx, yaw, pitch, margin=1.05)
    t = over_bg(stage.shoot(size), bg=(0.2, 0.2, 0.21))
    if action and arms:
        _set_action(arms[0], None)
        _rest(arms[0])
    return save_png(t, os.path.join(out_dir, f"{key}.png"))


def qa_sheets(key, objs=None, out_dir=None, size=320, poses=True, hero_view=True, hero_action=None, hero_frame=None,
              sheets=("turntable", "wire", "normals", "uv"), pose_frames=6):
    """Render every QA sheet for `key` into out_dir (default assets/previews). Returns {name: path}."""
    out_dir = out_dir or PREVIEWS
    objs = _meshes(objs)
    paths = {}
    with gpu.lock_only(wait=120):
        with Stage(ground=True) as st:
            if "turntable" in sheets:
                paths["turntable"] = turntable(st, objs, key, out_dir, size)
            if hero_view:
                paths["hero"] = hero(st, objs, key, out_dir, action=hero_action, frame=hero_frame)
            if poses:
                p = pose_sheet(st, objs, key, out_dir, frames=pose_frames)
                if p:
                    paths["poses"] = p
        with Stage(ground=False) as st:
            for kind in ("wire", "normals", "uv"):
                if kind in sheets:
                    paths[kind] = override_sheet(st, objs, key, out_dir, kind, size)
    return paths


def ortho_rgba(objs, yaw, w, h, extent, center):
    """Flat-lit orthographic RGBA render (for impostors). Returns a bpy image (caller removes it)."""
    with Stage(ground=False, flat=True) as st:
        mn, mx = bbox(objs)
        st.frame(mn, mx, yaw, 0.0, margin=1.0, ortho=True, extent=extent, center=center)
        arr = st.shoot(w, h)
    img = bpy.data.images.new("_kit_ortho", w, h, alpha=True)
    img.pixels.foreach_set(arr.ravel())
    return img
