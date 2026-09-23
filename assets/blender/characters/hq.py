"""Character assembly for the v0.2 humanoids: body -> clothes/gear -> skinning -> hide covered body -> bake ->
back to the arms-down rest -> clips -> export -> QA -> sheets / UI renders.

A character is a Spec: landmarks L (humanoid.HUMAN style), build + face presets, skin tones, a dress(ctx)
callback that creates garments/gear (registering them in ctx) and an animate(ctx) callback that keys the clips.
"""
import math
import os
import time

import bmesh
import bpy
from mathutils import Matrix, Vector

import anatomy as A
import charmats as CM
import common as C
import garments as G
import humanoid as H
import pipeline as PL
from kit import bake, export, gn, qa, render
from kit import materials as KM
from kit import rig as KR


class Ctx:
    """Everything a dress()/animate() callback needs."""

    def __init__(self, key, spec):
        self.key = key
        self.spec = spec
        self.cloths = []      # (obj, smooth, covers_body)
        self.custom = []      # (obj, fn(world_co) -> {bone: w}, covers_body)
        self.rigid = []       # (obj, bone or {bone: w}, covers_body)
        self.layers = []      # (inner, [outer...])  inner faces hidden under outer layers are deleted
        self.thick = []       # (obj, thickness)
        self.hems = []        # objects that get a 'hem' attribute
        self.no_ground = []   # objects ignored by ground contact (weapons, capes)
        self.posts = []
        self.all = []

    # ---- registration
    def cloth(self, obj, smooth=8, covers=True, thickness=0.0, hem=True, post=None):
        """Garment that takes the body's weights (nearest-face transfer + `smooth` Laplacian passes).
        post(obj, rig): optional weight post-process (e.g. capes: blend towards the torso bones)."""
        self.cloths.append((obj, smooth, covers))
        if post is not None:
            self.posts.append((obj, post))
        if thickness:
            self.thick.append((obj, thickness))
        if hem:
            self.hems.append(obj)
        self.all.append(obj)
        return obj

    def weighted(self, obj, fn, covers=True, thickness=0.0, hem=True):
        self.custom.append((obj, fn, covers))
        if thickness:
            self.thick.append((obj, thickness))
        if hem:
            self.hems.append(obj)
        self.all.append(obj)
        return obj

    def piece(self, obj, bone, covers=False, arms_down=False, ground=True):
        """Rigid piece. arms_down=True: authored in the arms-down frame (P0) -> moved into the bind pose."""
        if arms_down:
            b = bone if isinstance(bone, str) else max(bone, key=bone.get)
            PL.to_bind(obj, self.deltas, b)
        self.rigid.append((obj, bone, covers))
        if not ground:
            self.no_ground.append(obj)
        self.all.append(obj)
        return obj

    def posed_grip(self, side, spec):
        """Grip centre of `side` in the posed frame of `spec` (arms-down poser P0)."""
        import gear as GR
        self.P0.solve(spec)
        return self.P0.delta(f"hand.{side}") @ GR.grip_center(self, side)

    def held(self, obj, bone, spec, ground=False):
        """Rigid prop authored in the POSE `spec` (e.g. a staff upright in the idle pose): mapped back to the rest
        (P0.to_rest) then into the bind pose."""
        obj.data.transform(self.P0.to_rest(bone, spec))
        obj.data.update()
        return self.piece(obj, bone, arms_down=True, ground=ground)

    def layer(self, inner, outers):
        self.layers.append((inner, list(outers)))


class Spec:
    def __init__(self, key, L, build="hero", face="stern", faces=3400, skin=None, eyes=None, dress=None, animate=None,
                 kind="player", main_size=2048, cloth_size=1024, bare_feet=False, extra_body=None, portrait=None,
                 ui=None, height=None, preview=("Walk", 5), body_fn=None, eyes_fn=None, bake_samples=8,
                 tri_budget=14200):
        self.key, self.L, self.build, self.face, self.faces = key, L, build, face, faces
        self.skin = skin or {}
        self.eyes = eyes or {}
        self.dress, self.animate = dress, animate
        self.kind = kind
        self.main_size, self.cloth_size = main_size, cloth_size
        self.bare_feet = bare_feet
        self.extra_body = extra_body
        self.ui = ui or {}
        self.height = height
        self.preview = preview
        self.body_fn = body_fn          # custom body (skeleton): fn(ctx) -> (high or None, pre-weighted body)
        self.eyes_fn = eyes_fn
        self.bake_samples = bake_samples
        self.tri_budget = tri_budget


# =============================================================================== helpers for dress()
def eyeballs(ctx, mat):
    out = []
    for i, (p, r) in enumerate(A.eye_positions(ctx.J, ctx.F)):
        bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=(0, 0, 0), segments=12, ring_count=8)
        o = bpy.context.object
        o.name = f"Eye{i}"
        # the +Z pole looks forward (-Y)
        o.data.transform(Matrix.Rotation(math.radians(90), 4, "X"))
        o.data.transform(Matrix.Translation(p))
        o.location = (0, 0, 0)
        for poly in o.data.polygons:
            poly.use_smooth = True
        o.data.materials.append(mat)
        out.append(o)
    eye = C.join(out, "Eyes") if len(out) > 1 else out[0]
    ctx.piece(eye, "head")
    return eye


def body_mask(body, fn):
    """Faces of `body` whose centre satisfies fn -> used for trousers/sleeves selections."""
    return fn


# =============================================================================== the build
def build(spec, args, previews=True, do_bake=True):
    t0 = time.time()
    key = spec.key
    C.reset()
    scene = bpy.context.scene
    scene.render.fps = 24
    ctx = Ctx(key, spec)
    ctx.B, ctx.F = A.BUILD[spec.build], A.FACE[spec.face]
    rig, P0, J, deltas = PL.setup(spec.L)
    ctx.rig, ctx.P0, ctx.J, ctx.deltas, ctx.L = rig, P0, J, deltas, spec.L
    # ---- body
    hc, hk = A.head_frame(J)
    ctx.head_c, ctx.head_k = hc, hk
    if spec.body_fn is None:
        high = A.body_high(J, ctx.B, ctx.F, bare_feet=spec.bare_feet, extra=spec.extra_body)
        body = A.body_low(high, J, faces=spec.faces)
        skin = CM.skin_face(f"{key}_Skin", hc, hk, **spec.skin)
        for o in (body, high):
            o.data.materials.clear()
            o.data.materials.append(skin)
        ctx.skin_mat = skin
        prebound = False
        print(f"[{key}] body high {len(high.data.polygons)} faces, low {len(body.data.polygons)} faces ({time.time() - t0:.0f}s)")
    else:
        high, body = spec.body_fn(ctx)
        prebound = True
    ctx.high, ctx.body = high, body
    if spec.eyes_fn is not None:
        spec.eyes_fn(ctx)
    else:
        eyeballs(ctx, CM.eye(f"{key}_Eye", **spec.eyes))
    # ---- clothes & gear
    spec.dress(ctx)
    if os.environ.get("HQ_DEBUG"):
        for o in ctx.all:
            xs = [o.matrix_world @ v.co for v in o.data.vertices]
            print("BIND_BBOX", o.name, [round(min(p[i] for p in xs), 2) for i in range(3)],
                  [round(max(p[i] for p in xs), 2) for i in range(3)])
    # ---- skinning (bind pose)
    body_src = body.copy()
    body_src.data = body.data.copy()
    scene.collection.objects.link(body_src)
    if not prebound:
        KR.bind(body, rig, smooth=4)
    else:
        PL._parent(body, rig)
    _copy_weights(body, body_src)
    for obj, smooth, _ in ctx.cloths:
        KR.transfer_weights(body_src, obj, rig, smooth=smooth, factor=0.6)
    for obj, post in ctx.posts:
        post(obj, rig)
    for obj, fn, _ in ctx.custom:
        PL.weights_from_fn(obj, rig, fn(body_src) if _wants_src(fn) else fn)
    for obj, bone, _ in ctx.rigid:
        if isinstance(bone, str):
            PL.rigid(obj, rig, bone)
        else:
            PL.weights_from_fn(obj, rig, lambda co, b=bone: b)
    # ---- hide what is covered (bind pose)
    covers = [o for o, _, c in ctx.cloths if c] + [o for o, _, c in ctx.custom if c] + [o for o, _, c in ctx.rigid if c]
    qa.delete_covered_body(body, covers, margin=0.006, max_depth=0.25, shrink=0.006)
    for inner, outers in ([] if os.environ.get("HQ_NOLAYER") else ctx.layers):
        qa.delete_covered_body(inner, outers, margin=0.004, max_depth=0.12, shrink=0.004, min_island=0)
    bpy.data.objects.remove(body_src, do_unlink=True)
    if not os.environ.get("HQ_NOFIT"):
        fit_budget(ctx, body, spec.tri_budget)
    for o in ctx.hems:
        G.hem_attribute(o)
    for obj, th in ctx.thick:
        md = gn.solidify(obj, th, offset=-1.0)
        md.use_even_offset = False          # even offset spikes on folded drapes (mantle hem went 1.5 m out)
        md.thickness_clamp = 1.0
        md.use_quality_normals = True
    # ---- bake (high -> body; everything else directly)
    meshes = [body] + ctx.all
    for o in ctx.all:
        o["kit_bake_direct"] = 1
    sizes = {"Main": spec.main_size, "Cloth": spec.cloth_size}
    tex_dir = None
    res = {} if not do_bake else bake.bake_asset(meshes, key, size=spec.main_size, high=high, extrusion=0.012, max_ray=0.03, ao_samples=32,
                          samples=spec.bake_samples, group_sizes=sizes, tex_dir=tex_dir)
    for g, r in res.items():
        if g.startswith(("Cloth", "Banner")) or g == "Cloth":
            r["material"].use_backface_culling = False
    if high is not None:
        gn.remove(high)
    # ---- back to the arms-down rest, then clips
    P = PL.re_rest(rig, spec.L, meshes)
    ctx.P = P
    spec.animate(ctx)
    print(f"[{key}] clips: {sorted(a.name for a in bpy.data.actions)}  ({time.time() - t0:.0f}s)")
    return ctx, meshes


def _tris(o):
    o.data.calc_loop_triangles()
    return len(o.data.loop_triangles)


def fit_budget(ctx, body, target):
    """Collapse-decimate the biggest pieces so the final character (solidified cloth counted twice) fits `target`
    triangles. The body keeps its face detail unless nothing else is left to reduce."""
    thick = {o.name: t for o, t in ctx.thick}
    items = [(o, _tris(o) * (2 if o.name in thick else 1) + (60 if o.name in thick else 0)) for o in ctx.all]
    total = sum(t for _, t in items) + _tris(body)
    if total <= target:
        print(f"[{ctx.key}] triangles {total} <= {target}: no reduction")
        return
    adj = [(o, t) for o, t in items if t > 350 and not o.name.startswith(("Eye", "Ske_Eyes"))]
    fixed = total - sum(t for _, t in adj)
    ratio = max(0.3, (target - fixed) / max(1, sum(t for _, t in adj)))
    for o, t in adj:
        md = o.modifiers.new("KitFit", "DECIMATE")
        md.decimate_type = "COLLAPSE"
        md.ratio = ratio
        md.use_collapse_triangulate = True
        for x in bpy.context.scene.objects:
            x.select_set(False)
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        while o.modifiers[0] != md:
            bpy.ops.object.modifier_move_up(modifier=md.name)
        bpy.ops.object.modifier_apply(modifier=md.name)
    items = [(o, _tris(o) * (2 if o.name in thick else 1)) for o in ctx.all]
    total2 = sum(t for _, t in items) + _tris(body)
    if total2 > target * 1.03:
        md = body.modifiers.new("KitFit", "DECIMATE")
        md.ratio = max(0.5, 1 - (total2 - target) / max(1, _tris(body)))
        md.use_collapse_triangulate = True
        for x in bpy.context.scene.objects:
            x.select_set(False)
        body.select_set(True)
        bpy.context.view_layer.objects.active = body
        while body.modifiers[0] != md:
            bpy.ops.object.modifier_move_up(modifier=md.name)
        bpy.ops.object.modifier_apply(modifier=md.name)
    print(f"[{ctx.key}] triangles {total} -> {total2} (garment ratio {ratio:.2f}) body {_tris(body)}")


def _wants_src(fn):
    return getattr(fn, "wants_body", False)


def _copy_weights(src, dst):
    for g in list(dst.vertex_groups):
        dst.vertex_groups.remove(g)
    groups = {g.index: dst.vertex_groups.new(name=g.name) for g in src.vertex_groups}
    for v in src.data.vertices:
        for g in v.groups:
            groups[g.group].add([v.index], g.weight, "REPLACE")


# =============================================================================== finishing
def finish(ctx, meshes, args, budget="hero", previews=True, ui=False):
    """QA (separate meshes), then join into ONE skinned mesh per material set, export, sheets, UI renders."""
    key = ctx.key
    rig = ctx.rig
    covers = [o for o, _, c in ctx.cloths if c] + [o for o, _, c in ctx.custom if c] + [o for o, _, c in ctx.rigid if c]
    rep = qa.run(key, meshes, budget=None, expected=(None, None, ctx.spec.height), glb=None,
                 skin=dict(body=ctx.body, cloths=covers, armature=rig, frames=11), seams=False)
    # one mesh (fewer draw calls): join everything into the body
    final = C.join(meshes, key)
    final.name = key
    for md in [m for m in final.modifiers if m.type == "ARMATURE"][1:]:
        final.modifiers.remove(md)
    info = export.export_glb(key, args.out, objects=[rig, final], budget=budget)
    qa.check_budget(rep, [final], budget, info)
    try:
        qa.check_seams(rep, final)
    except Exception as e:
        rep.warn(f"seam check skipped ({e})")
    geo = qa.Report(key)
    qa.check_geometry(geo, final)
    rep["info"]["joined_geometry"] = {"fails": geo["fails"], "warns": geo["warns"]}
    rep["info"]["glb"] = {k: v for k, v in info.items() if k != "warnings"}
    qa.save(rep, args.previews)
    paths = {}
    if previews:
        paths = render.qa_sheets(key, [final], args.previews, hero_action=ctx.spec.preview[0], hero_frame=ctx.spec.preview[1])
    return rep, final, paths
