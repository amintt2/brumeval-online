"""Nature group for Brumeval Online (dark-fantasy, Elden-Ring-like look, baked PBR, web budgets).

Keys (SPEC.md §5.3 sizes kept for the existing ones, collision radii rely on them):
  upgrade : tree_pine, tree_oak, tree_dead, rock_a, rock_b, bush, flowers
  new     : tree_birch, tree_willow, tree_pine_snow, tree_palm, cactus, rock_snow, rock_desert, cliff_a, cliff_b,
            reeds, mushrooms, log_fallen, stump

Run:  npm run assets -- nature            (or: blender -b --factory-startup --python assets/blender/nature/build.py
                                            -- [--only tree_oak,rock_a] [--no-preview])

Every model = ONE mesh object (instanced hundreds of times), materials:
  <key>        wood / stone / skin atlas (1024, baked from procedural shader nodes, high->low for trunks & rocks)
  Leaf_* / Foliage_* / Grass_*   alpha-MASK card atlas (2x2 variants, own texture set) -> client wind shader
Pipeline per key: skeleton/shape (Python + Geometry Nodes) -> bake (kit) -> join -> custom canopy normals ->
export GLB + <key>_lod1/_lod2 -> QA json -> QA sheets (assets/previews/<key>_*.png).
"""
import math
import os
import random
import sys
import time

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))  # assets/blender -> common, kit
sys.path.insert(0, HERE)

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import common as C  # noqa: E402
from kit import bake, gn, gpu, materials as M  # noqa: E402
import foliage as F  # noqa: E402
import nature_lib as N  # noqa: E402

KEYS = ["tree_pine", "tree_oak", "tree_dead", "rock_a", "rock_b", "bush", "flowers",
        "tree_birch", "tree_willow", "tree_pine_snow", "tree_palm", "cactus", "rock_snow", "rock_desert",
        "cliff_a", "cliff_b", "reeds", "mushrooms", "log_fallen", "stump"]

AO = 48          # AO samples for the atlas bakes

# Many Blender agents share one GPU (kit.gpu lock). A CPU fallback bake of a tree atlas takes ~15 min on a loaded CPU
# vs ~30 s on the GPU, so this group waits longer for the lock before falling back (NATURE_GPU_WAIT seconds).
_kit_device = gpu.device


def _device_patient(scene=None, samples=16, wait=None, prefer_gpu=True):
    return _kit_device(scene, samples, wait=int(os.environ.get("NATURE_GPU_WAIT", "1800")), prefer_gpu=prefer_gpu)


gpu.device = _device_patient
TAU = math.tau


def _bake(key, objs, high=None, size=1024, leaf_size=None, **kw):
    """Bake the procedural materials of `objs` (objects carrying only already-baked cached foliage atlases are
    skipped: see nature_lib.leaf_material)."""
    todo = [o for o in objs if o is not None and any(s.material and not s.material.get("kit_final") for s in o.material_slots)]
    if not todo:
        return {}
    kw.setdefault("samples", 8)
    kw.setdefault("uv_method", "CHARTS")   # organic: few large charts (kit), no confetti islands
    return bake.bake_asset(todo, key, size=size, high=high, ao_samples=AO, **kw)


def _leaf(name, fn, *a, **k):
    """Cached baked foliage atlas material (see nature_lib.leaf_material)."""
    return N.leaf_material(name, lambda: fn(name, *a, **k), tag=repr((fn.__name__, a, sorted(k.items()))))


def _crown_cards(shell, centre, outer_tpls, inner_tpls, density, inner_density, inner_scale=0.62, seed=0,
                 size=(0.8, 1.2)):
    """Outer bright cards on the hull + inner dark cards on a shrunk hull. Returns the joined leaves object."""
    outer = N.scatter_cards(shell, outer_tpls, density, seed=seed, scale=size, rot=(0.55, 0.55, math.pi),
                            name="LeavesOut")
    inner_shell = N.dup(shell, "_CrownInner")
    c = Vector(centre)
    for v in inner_shell.data.vertices:
        v.co = c + (v.co - c) * inner_scale
    inner = N.scatter_cards(inner_shell, inner_tpls, inner_density, seed=seed + 7, scale=(size[0] * 0.85, size[1] * 0.85), rot=(0.5, 0.5, math.pi),
                            name="LeavesIn")
    N.remove(inner_shell)
    leaves = C.join([outer, inner], "Leaves")
    leaves["kit_open"] = 1
    return leaves


def _templates(mat, w, h, fold=0.16, plane="XY", pivot="center", segs=1, bend=0.0):
    outer = [N.card_template(f"_tplO{i}", mat, w, h, quad=(i, 1), fold=fold, plane=plane, pivot=pivot, segs=segs,
                             bend=bend) for i in (0, 1)]
    inner = [N.card_template(f"_tplI{i}", mat, w, h, quad=(i, 0), fold=fold, plane=plane, pivot=pivot, segs=segs,
                             bend=bend) for i in (0, 1)]
    return outer, inner


def _finish_tree(key, parts, crown_c, crown_r, args, expected, lods="tree", blend=0.72, sink=0.05, up=0.15):
    ob = C.join([p for p in parts if p is not None], key)
    N.ground(ob, sink)
    crown_c = Vector(crown_c) + Vector((0, 0, -sink))
    N.canopy_normals(ob, crown_c, crown_r, blend=blend, up=up)
    gn.remove_templates()
    return N.finish_static(key, ob, args, "vegetation", expected, lods=lods)


# =============================================================================== trees
def _crown_from(br, rnd, levels=(1,), along=(0.55, 1.0), zmin=2.0, r=(0.85, 1.15), rz=(0.7, 0.9), lift=0.25,
                tip_levels=(2,), tip_r=(0.5, 0.7), voxel=0.14, noise=0.3, noise_scale=1.1, seed=4):
    clumps = []
    for p, d in N.tips(br, levels, along=along):
        if p.z > zmin:
            clumps.append((p + Vector((0, 0, lift)), (rnd.uniform(*r),) * 2 + (rnd.uniform(*rz),)))
    for p, d in N.tips(br, tip_levels, along=(1.0, 1.0)):
        if p.z > zmin:
            clumps.append((p, (rnd.uniform(*tip_r),) * 3))
    shell = N.blob_union(clumps, voxel=voxel, seed=seed, noise=noise, noise_scale=noise_scale)
    mn = Vector([min(v.co[i] for v in shell.data.vertices) for i in range(3)])
    mx = Vector([max(v.co[i] for v in shell.data.vertices) for i in range(3)])
    return shell, (mn + mx) / 2, (mx - mn) / 2


def build_tree_oak(args, key="tree_oak"):
    """Old gnarled oak: flared roots, heavy twisting limbs, dense layered crown (~5.4 m, crown ~4.6 m wide)."""
    rnd = random.Random(11)
    bark = M.bark("Bark", "oak", seed=3, moss=0.45, dirt=0.6)
    br = N.grow_tree(dict(height=3.6, radius=0.34, trunk_segs=8, lean=0.06, gnarl=0.1, levels=3, children=(7, 3, 2),
                          start=(0.45, 0.95), spread=(35, 65), up_bias=(0.35, 0.3, 0.25), gravity=(0.0, 0.04, 0.1),
                          length=(0.62, 0.5, 0.4), segs=(8, 5, 3), child_radius=0.6, taper=0.7, roots=7,
                          root_len=0.62, root_r=0.72), seed=7)
    N.recentre(br)
    high = N.trunk_high(br, (-1, 0, 1), bark, voxel=0.022, gnarl=0.05, gnarl_scale=1.4, seed=3)
    low = N.trunk_low(high, 2600, "Wood")
    N.remove(high)
    twigs = N.tubes(br, (2,), bark, profile_res=4, resolution=1)
    shell, cc, cr = _crown_from(br, rnd, zmin=2.1, r=(0.62, 0.9), rz=(0.55, 0.72), tip_r=(0.4, 0.58), noise=0.34,
                                voxel=0.12)
    leaf = _leaf("Leaf_oak", F.broadleaf, "oak", seed=3, n=44)
    outer, inner = _templates(leaf, 1.0, 1.0)
    leaves = _crown_cards(shell, cc, outer, inner, 6.0, 7.0, seed=5)
    N.remove(shell)
    print(f"[nature] {key}: wood {N.tris(low)} twigs {N.tris(twigs)} leaves {N.tris(leaves)}  crown {cc} {cr}")
    _bake(key, [low, twigs, leaves])
    return _finish_tree(key, [low, twigs, leaves], cc, cr, args, expected=(4.7, 4.6, 5.4), blend=0.85)


def _conifer(args, key, leaf, bark, seed=5, snow=False):
    """Conifer: straight trunk with root flare, whorls of drooping branches; the needle-spray cards are GN-scattered
    on layered 'skirts' (flattened blobs along every branch) -> dense tiered silhouette, darker inner layer."""
    rnd = random.Random(seed)
    br = N.grow_tree(dict(height=6.4, radius=0.22, trunk_segs=10, lean=0.03, gnarl=0.03, levels=2, children=(40,),
                          whorls=5, start=(0.1, 0.94), spread=((72, 96),), up_bias=(-0.08, 0.0), gravity=(0.0, 0.07),
                          length=(0.3,), segs=(10, 4), child_radius=0.3, taper=0.85, roots=5, root_len=0.7,
                          root_r=0.6, min_r=0.012), seed=seed)
    high = N.trunk_high(br, (-1, 0), bark, voxel=0.018, gnarl=0.02, gnarl_scale=2.0, seed=seed)
    low = N.trunk_low(high, 1500, "Wood")
    N.remove(high)
    twigs = N.tubes(br, (1,), bark, profile_res=4, resolution=1)
    clumps = []
    for b in br:
        if b["level"] != 1:
            continue
        pts = b["pts"]
        for t in (0.35, 0.7, 1.0):
            i = min(int(t * (len(pts) - 1)), len(pts) - 1)
            p = pts[i][0]
            h = p.z / 6.4
            r = (0.55 - 0.25 * h) * rnd.uniform(0.85, 1.1)
            clumps.append((p + Vector((0, 0, -0.05)), (r, r, r * 0.55)))
    top = max((pp for b in br if b["level"] == 0 for pp, r in b["pts"]), key=lambda v: v.z)
    clumps.append((top + Vector((0, 0, -0.45)), (0.35, 0.35, 0.7)))
    clumps.append((top + Vector((0, 0, -1.1)), (0.55, 0.55, 0.6)))
    shell = N.blob_union(clumps, voxel=0.1, seed=seed, noise=0.12, noise_scale=1.6)
    outer, inner = _templates(leaf, 1.05, 1.05, fold=0.12)
    leaves = _crown_cards(shell, (0, 0, 3.2), outer, inner, 6.5, 4.0, seed=seed + 2, inner_scale=0.72,
                          size=(0.75, 1.15))
    N.remove(shell)
    print(f"[nature] {key}: wood {N.tris(low)} twigs {N.tris(twigs)} leaves {N.tris(leaves)}")
    _bake(key, [low, twigs, leaves])
    return _finish_tree(key, [low, twigs, leaves], (0, 0, 2.6), (2.2, 2.2, 3.6), args, expected=(4.4, 4.3, 6.5),
                        blend=0.7, up=0.2)


def build_tree_pine(args, key="tree_pine"):
    return _conifer(args, key, _leaf("Leaf_pine", F.pine_frond, seed=2),
                    M.bark("Bark", "pine", seed=5, moss=0.3, color="#5a4636", color2="#2b2019"), seed=5)


def build_tree_pine_snow(args, key="tree_pine_snow"):
    bark = N.add_snow(M.bark("Bark", "pine", seed=6, moss=0.1, color="#5a4636", color2="#2b2019"), amount=0.8)
    return _conifer(args, key, _leaf("Leaf_pine_snow", F.pine_frond, seed=4, snow=1.0,
                                            pal=["#0f2019", "#162c22", "#1f3a2b", "#2b4a36"]), bark, seed=8)


def build_tree_dead(args, key="tree_dead"):
    """Graveyard tree: twisted grey dead wood, jagged limbs, fine twig cards, hanging grey moss."""
    rnd = random.Random(21)
    bark = M.bark("Bark", "dead", seed=9, moss=0.25, dirt=0.7)
    br = N.grow_tree(dict(height=3.4, radius=0.3, trunk_segs=9, lean=0.22, gnarl=0.22, levels=4, children=(5, 3, 2),
                          start=(0.4, 0.95), spread=(30, 70), up_bias=(0.2, 0.15, 0.1), gravity=(0.0, 0.06, 0.12, 0.1),
                          length=(0.62, 0.52, 0.45), segs=(9, 6, 4, 3), child_radius=0.58, taper=0.8, roots=5,
                          root_len=0.9, root_r=0.6, min_r=0.008), seed=13)
    N.recentre(br)
    high = N.trunk_high(br, (-1, 0, 1), bark, voxel=0.02, gnarl=0.06, gnarl_scale=1.8, seed=9, ridges=0.018)
    low = N.trunk_low(high, 2600, "Wood")
    N.remove(high)
    twigs = N.tubes(br, (2, 3), bark, profile_res=4, resolution=1)
    twig_mat = _leaf("Foliage_twigs", F.twig_card, seed=3)
    tpl_o, tpl_i = _templates(twig_mat, 0.9, 0.9, fold=0.0, pivot="base")
    frames = []
    for p, d in N.tips(br, (3,), along=(0.7, 1.0)):
        nrm = d.cross(N.UP)
        if nrm.length < 1e-3:
            nrm = Vector((1, 0, 0))
        nrm = (nrm.normalized() + Vector((rnd.uniform(-.4, .4), rnd.uniform(-.4, .4), rnd.uniform(-.2, .2)))).normalized()
        frames.append((p - d * 0.05, *N.frame_from(nrm, d), rnd.uniform(0.6, 0.95)))
    twc = N.place_cards(frames, tpl_o + tpl_i, rnd, "Twigs2")
    moss_mat = _leaf("Foliage_moss", F.hanging_moss, seed=2)
    m_o, m_i = _templates(moss_mat, 0.55, 1.3, fold=0.0, pivot="base", segs=2, bend=0.05)
    mframes = []
    for p, d in N.tips(br, (1, 2), along=(0.3, 0.8)):
        if rnd.random() < 0.35 and p.z > 1.8:
            a = rnd.uniform(0, TAU)
            s = rnd.uniform(0.6, 1.1)
            mframes.append((p - Vector((0, 0, 1.3 * s)), *N.frame_from(Vector((math.cos(a), math.sin(a), 0)), N.UP), s))
    mossc = N.place_cards(mframes, m_o + m_i, rnd, "HangMoss")
    print(f"[nature] {key}: wood {N.tris(low)} twigs {N.tris(twigs)} cards {N.tris(twc)} moss {N.tris(mossc)}")
    _bake(key, [low, twigs, twc, mossc])
    return _finish_tree(key, [low, twigs, twc, mossc], (0, 0, 2.6), (1.8, 1.4, 1.6), args, expected=(3.4, 2.5, 4.2),
                        blend=0.35, up=0.1)


def build_tree_birch(args, key="tree_birch"):
    """Twin-stemmed silver birch: white peeling bark, dark fissured base, light airy crown."""
    rnd = random.Random(31)
    bark = M.bark("Bark", "birch", seed=4, moss=0.2, dirt=0.5)
    br = N.grow_tree(dict(height=6.2, radius=0.17, trunks=2, trunk_spread=0.14, trunk_segs=10, gnarl=0.05,
                          levels=3, children=(9, 3, 2), start=(0.45, 0.97), spread=(25, 50), up_bias=(0.35, 0.25, 0.2),
                          gravity=(0.0, 0.1, 0.15), length=(0.36, 0.45, 0.4), segs=(10, 5, 3), child_radius=0.5,
                          taper=0.8, roots=4, root_len=0.5, root_r=0.5, min_r=0.008), seed=17)
    N.recentre(br)
    high = N.trunk_high(br, (-1, 0, 1), bark, voxel=0.014, gnarl=0.012, gnarl_scale=2.5, seed=4)
    low = N.trunk_low(high, 2400, "Wood")
    N.remove(high)
    twigs = N.tubes(br, (2,), bark, profile_res=4, resolution=1)
    clumps = []
    for p, d in N.tips(br, (1,), along=(0.4, 1.0)):
        clumps.append((p + Vector((0, 0, 0.1)), (rnd.uniform(0.45, 0.65),) * 2 + (rnd.uniform(0.5, 0.7),)))
    shell = N.blob_union(clumps, voxel=0.1, seed=6, noise=0.2, noise_scale=1.4)
    mn = Vector([min(v.co[i] for v in shell.data.vertices) for i in range(3)])
    mx = Vector([max(v.co[i] for v in shell.data.vertices) for i in range(3)])
    cc, cr = (mn + mx) / 2, (mx - mn) / 2
    leaf = _leaf("Leaf_birch", F.broadleaf, "birch", seed=4, n=30)
    outer, inner = _templates(leaf, 0.8, 0.8)
    leaves = _crown_cards(shell, cc, outer, inner, 7.0, 7.0, seed=7, inner_scale=0.6)
    N.remove(shell)
    print(f"[nature] {key}: wood {N.tris(low)} twigs {N.tris(twigs)} leaves {N.tris(leaves)}  crown {cc} {cr}")
    _bake(key, [low, twigs, leaves])
    return _finish_tree(key, [low, twigs, leaves], cc, cr, args, expected=(3.6, 3.6, 7.6))


def build_tree_willow(args, key="tree_willow"):
    """Swamp weeping willow: short leaning gnarled trunk, arching limbs, long hanging leaf curtains."""
    rnd = random.Random(41)
    bark = M.bark("Bark", "oak", seed=8, moss=0.6, dirt=0.7, color="#4a4336", color2="#241f18")
    br = N.grow_tree(dict(height=2.9, radius=0.42, trunk_segs=7, lean=0.25, gnarl=0.13, levels=3, children=(6, 4, 3),
                          start=(0.6, 1.0), spread=(35, 65), up_bias=(0.45, 0.15, 0.0), gravity=(0.0, 0.1, 0.25),
                          droop_tip=0.35, length=(0.95, 0.55, 0.45), segs=(7, 7, 4), child_radius=0.55, taper=0.72,
                          roots=6, root_len=1.2, root_r=0.6, min_r=0.01), seed=23)
    N.recentre(br)
    high = N.trunk_high(br, (-1, 0, 1), bark, voxel=0.024, gnarl=0.06, gnarl_scale=1.4, seed=8, ridges=0.014)
    low = N.trunk_low(high, 2400, "Wood")
    N.remove(high)
    twigs = N.tubes(br, (2,), bark, profile_res=4, resolution=1)
    leaf = _leaf("Leaf_willow", F.willow_strands, seed=3)
    # crown top (flat cards over the arches)
    clumps = [(p + Vector((0, 0, 0.2)), (rnd.uniform(0.7, 0.9),) * 2 + (0.45,)) for p, d in N.tips(br, (1,), along=(0.35, 0.8))]
    shell = N.blob_union(clumps, voxel=0.14, seed=8, noise=0.2, noise_scale=1.0)
    mn = Vector([min(v.co[i] for v in shell.data.vertices) for i in range(3)])
    mx = Vector([max(v.co[i] for v in shell.data.vertices) for i in range(3)])
    cc, cr = (mn + mx) / 2, (mx - mn) / 2
    outer, inner = _templates(leaf, 0.9, 0.9, fold=0.1)
    top = _crown_cards(shell, cc, outer, inner, 3.5, 3.0, seed=9, inner_scale=0.7)
    N.remove(shell)
    # hanging curtains from the drooping outer limbs
    c_o, c_i = _templates(leaf, 0.75, 2.2, fold=0.08, pivot="base", segs=3, bend=0.04)
    frames_o, frames_i = [], []
    for p, d in N.tips(br, (2,), along=(0.2, 1.0)) + N.tips(br, (1,), along=(0.6, 1.0)):
        if p.z < 1.9:
            continue
        out = Vector((p.x, p.y, 0))
        if out.length < 0.3:
            continue
        out.normalize()
        a = math.atan2(out.y, out.x) + rnd.uniform(-0.5, 0.5)
        nrm = Vector((math.cos(a), math.sin(a), rnd.uniform(-0.1, 0.1))).normalized()
        s = rnd.uniform(0.8, 1.25)
        hang = min(2.2 * s, p.z - 0.35)
        s = hang / 2.2
        fr = (p - Vector((0, 0, 2.2 * s - 0.05)), *N.frame_from(nrm, N.UP), s)
        (frames_i if rnd.random() < 0.3 else frames_o).append(fr)
    curt = C.join([N.place_cards(frames_o, c_o, rnd, "CurtO"), N.place_cards(frames_i, c_i, rnd, "CurtI")], "Curtains")
    leaves = C.join([top, curt], "Leaves")
    print(f"[nature] {key}: wood {N.tris(low)} twigs {N.tris(twigs)} leaves {N.tris(leaves)}  crown {cc} {cr}")
    _bake(key, [low, twigs, leaves])
    return _finish_tree(key, [low, twigs, leaves], (cc.x, cc.y, cc.z - 0.6), (cr.x, cr.y, cr.z + 1.2), args,
                        expected=(6.0, 6.0, 6.2), blend=0.55)


def build_tree_palm(args, key="tree_palm"):
    """Desert palm: curved ringed trunk, crown of arching feather fronds (young up, old drooping)."""
    rnd = random.Random(51)
    bark = N.palm_bark("PalmBark", seed=2)
    pts = []
    lean = Vector((0.55, 0.2, 0))
    for i in range(12):
        t = i / 11
        z = -0.1 + 6.4 * t
        off = lean * (t ** 1.7) * 1.6
        r = 0.2 * (1 - 0.25 * t) + 0.12 * max(0.0, 1 - t * 8) ** 2
        pts.append((off.x, off.y, z, r))
    top = Vector(pts[-1][:3])
    spl = [pts]
    # crown knob (leaf bases)
    spl.append([(top.x, top.y, top.z - 0.35, 0.2), (top.x, top.y, top.z + 0.05, 0.22), (top.x, top.y, top.z + 0.25, 0.1)])
    ob = N.sweep(spl, bark, profile_res=14, resolution=4, name="_PalmHigh")
    gn.voxel_remesh(ob, voxel=0.014, smooth_iters=3)
    gn.apply(ob)
    gn.displace(ob, strength=0.012, scale=3.0, detail=3, seed=2, voronoi=0.2)
    gn.apply(ob)
    N.set_smooth(ob)
    high = ob
    low = N.trunk_low(high, 1400, "Wood")
    N.remove(high)
    leaf = _leaf("Leaf_palm", F.palm_frond, seed=1)
    fronds = []
    for k in range(15):
        a = k * math.radians(137.5) + rnd.uniform(-0.2, 0.2)
        el = rnd.uniform(-0.35, 0.95) if k > 3 else rnd.uniform(0.9, 1.25)
        L = rnd.uniform(2.4, 3.2)
        droop = k >= 11
        if droop:
            el = rnd.uniform(-0.9, -0.5)
            L *= 0.85
        fronds.append(_frond(top + Vector((0, 0, 0.05)), a, el, L, rnd, quad=(k % 2, 0 if droop or el < 0 else 1),
                             mat=leaf))
    leaves = C.join(fronds, "Leaves")
    leaves["kit_open"] = 1
    print(f"[nature] {key}: wood {N.tris(low)} leaves {N.tris(leaves)}")
    _bake(key, [low, leaves])
    return _finish_tree(key, [low, leaves], top + Vector((0, 0, -0.4)), (3.0, 3.0, 1.4), args,
                        expected=(5.5, 5.5, 7.2), blend=0.45, up=0.2)


def _frond(base, az, el, L, rnd, quad, mat, segs=9):
    """Palm frond strip: rachis arcs up then droops under gravity, leaflets V-folded upward; UV v along."""
    d = Vector((math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el)))
    side = Vector((-math.sin(az), math.cos(az), 0))
    col, row = quad
    u0, u1 = col * 0.5 + 0.004, col * 0.5 + 0.496
    v0, v1 = row * 0.5 + 0.004, row * 0.5 + 0.496
    verts, faces, uvs = [], [], []
    p = base.copy()
    dd = d.copy()
    seg = L / segs
    for i in range(segs + 1):
        t = i / segs
        w = 0.95 * math.sin(math.pi * min(1.0, 0.12 + t * 0.95)) ** 0.7 + 0.06
        twist = rnd.uniform(-0.05, 0.05)
        up = dd.cross(side).normalized() * -1 if dd.cross(side).z < 0 else dd.cross(side).normalized()
        fold = 0.22 * w
        verts += [p - side * w * 0.5 + up * fold, p.copy(), p + side * w * 0.5 + up * (fold + twist)]
        if i < segs:
            dd = (dd + Vector((0, 0, -0.16 - 0.1 * t))).normalized()
            p = p + dd * seg
    for i in range(segs):
        for j in range(2):
            a = i * 3 + j
            faces.append((a, a + 1, a + 4, a + 3))
            uvs.append([(u0 + (u1 - u0) * j * 0.5, v0 + (v1 - v0) * i / segs),
                        (u0 + (u1 - u0) * (j + 1) * 0.5, v0 + (v1 - v0) * i / segs),
                        (u0 + (u1 - u0) * (j + 1) * 0.5, v0 + (v1 - v0) * (i + 1) / segs),
                        (u0 + (u1 - u0) * j * 0.5, v0 + (v1 - v0) * (i + 1) / segs)])
    ob = N.mesh_obj("Frond", verts, faces, mat, uvs)
    # front face up
    me = ob.data
    if sum(p.normal.z for p in me.polygons) < 0:
        for p in me.polygons:
            p.flip()
    return ob


# =============================================================================== small vegetation
def build_bush(args, key="bush"):
    """Dense round berry bush: short woody stems under a lumpy hull of leaf-spray cards (berries in the atlas)."""
    rnd = random.Random(61)
    bark = M.bark("Bark", "oak", seed=12, moss=0.2)
    br = N.grow_tree(dict(height=0.42, radius=0.035, trunks=4, trunk_spread=0.9, trunk_segs=4, gnarl=0.15, levels=2,
                          children=(3,), start=(0.4, 0.9), spread=(30, 60), up_bias=(0.3,), length=(0.6,), segs=(4, 3),
                          child_radius=0.6, taper=0.6, min_r=0.008), seed=29)
    stems = N.tubes(br, (0, 1), bark, profile_res=5, resolution=2)
    stems["kit_bake_direct"] = 0
    clumps = [((0, 0, 0.4), (0.4, 0.33, 0.27)), ((0.2, 0.06, 0.32), (0.28, 0.22, 0.22)), ((-0.22, -0.04, 0.3), (0.26, 0.22, 0.21)),
              ((0.04, -0.14, 0.28), (0.24, 0.2, 0.2)), ((-0.04, 0.14, 0.34), (0.25, 0.2, 0.21))]
    clumps = [(Vector(c) * 0.85, tuple(r * 0.8 for r in rr)) for c, rr in clumps]   # SPEC: ~1 m round bush
    shell = N.blob_union(clumps, voxel=0.05, seed=3, noise=0.07, noise_scale=3.0)
    cc = Vector((0, 0, 0.36))
    leaf = _leaf("Leaf_bush", F.broadleaf, "bush", seed=5, n=30)
    outer, inner = _templates(leaf, 0.36, 0.36, fold=0.14)
    leaves = _crown_cards(shell, cc, outer, inner, 85.0, 90.0, seed=4, inner_scale=0.65, size=(0.8, 1.15))
    N.remove(shell)
    print(f"[nature] {key}: stems {N.tris(stems)} leaves {N.tris(leaves)}")
    _bake(key, [stems, leaves], size=512)
    return _finish_tree(key, [stems, leaves], cc, (0.55, 0.45, 0.4), args, expected=(1.1, 1.0, 0.8), lods="plant",
                        blend=0.7, sink=0.03)


def _clump_cards(tpls, radius, density, seed, scale, rot, name, sink=0.02):
    """Vertical crossed cards scattered (GN) on a ground disc of `radius`."""
    bpy.ops.mesh.primitive_circle_add(vertices=32, radius=radius, fill_type="TRIFAN")
    disc = bpy.context.object
    disc.name = "_disc"
    ob = N.scatter_cards(disc, tpls, density, seed=seed, scale=scale, rot=rot, name=name)
    N.remove(disc)
    for v in ob.data.vertices:
        v.co.z -= sink
    ob.data.update()
    return ob


def _cross_templates(mat, w, h, quads):
    """Crossed vertical cards (two perpendicular quads, pivot at the base) per atlas quadrant."""
    out = []
    for i, q in enumerate(quads):
        a = N.card_template(f"_x{i}a", mat, w, h, quad=q, fold=0.0, plane="XZ", pivot="base", segs=2, bend=0.05)
        b = N.card_template(f"_x{i}b", mat, w, h, quad=q, fold=0.0, plane="XZ", pivot="base", segs=2, bend=0.05)
        b.rotation_euler = (0, 0, math.pi / 2)
        C.apply_transforms(b)
        out.append(C.join([a, b], f"_xtpl{i}"))
        out[-1]["kit_open"] = 1
    return out


def build_flowers(args, key="flowers"):
    """~1.2 m patch of wild grass with white / yellow / violet / blue / red flowers (no collision)."""
    mat = _leaf("Grass_flowers", F.meadow, seed=3)
    tpls = _cross_templates(mat, 0.34, 0.4, [(1, 1), (1, 1), (0, 1), (0, 1), (1, 0)])
    ob = _clump_cards(tpls, 0.55, 200.0, 5, (0.65, 1.15), (0.22, 0.22, math.pi), "Grass")
    gn.remove_templates()
    print(f"[nature] {key}: cards {N.tris(ob)}")
    _bake(key, [ob])
    return _finish_tree(key, [ob], (0, 0, -0.3), (0.8, 0.8, 0.8), args, expected=(1.2, 1.25, 0.5), lods="plant",
                        blend=0.35, sink=0.02, up=1.2)


def build_reeds(args, key="reeds"):
    """Swamp reed clump with cattails, ~1.9 m."""
    mat = _leaf("Grass_reeds", F.reeds, seed=2)
    tpls = _cross_templates(mat, 0.5, 1.8, [(1, 1), (0, 1), (1, 1), (0, 0)])
    ob = _clump_cards(tpls, 0.45, 60.0, 7, (0.7, 1.08), (0.18, 0.18, math.pi), "Grass")
    gn.remove_templates()
    print(f"[nature] {key}: cards {N.tris(ob)}")
    _bake(key, [ob])
    return _finish_tree(key, [ob], (0, 0, -0.5), (0.9, 0.9, 1.6), args, expected=(1.4, 1.4, 1.9), lods="plant",
                        blend=0.4, sink=0.02, up=0.8)


# =============================================================================== rocks & cliffs
def _ico(scale, subdiv=4, loc=(0, 0, 0)):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdiv, radius=1.0, location=loc)
    o = bpy.context.object
    o.scale = scale
    C.apply_transforms(o)
    N.set_smooth(o)
    return o


def _box(size, cuts=16, loc=(0, 0, 0)):
    import bmesh
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc)
    o = bpy.context.object
    o.scale = size
    C.apply_transforms(o)
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=cuts, use_grid_fill=True)
    bm.to_mesh(o.data)
    bm.free()
    N.set_smooth(o)
    return o


def _shape(o, fn):
    for v in o.data.vertices:
        v.co = fn(v.co.copy())
    o.data.update()
    return o


def _rock_finish(key, high, mat, args, expected, target=3000, moss=None, moss_density=9.0, sink=0.05,
                 extra_direct=(), size=1024, moss_up=0.7, moss_size=0.11, extrusion=0.06, max_ray=0.25, tol=0.25,
                 budget="rock"):
    """high -> (sink) -> low (decimated) + moss clumps (bake direct) -> bake -> join -> finish."""
    N.ground(high, sink)
    if not high.data.materials:
        high.data.materials.append(mat)
    low = N.trunk_low(high, target, "Rock")
    parts = [low]
    if moss is not None:
        mc = N.moss_clumps(low, moss, density=moss_density, up_min=moss_up, size=moss_size, seed=5)
        if mc is not None:
            parts.append(mc)
    parts += list(extra_direct)
    high.name = "_RockHigh"
    _bake(key, parts, high=high, extrusion=extrusion, max_ray=max_ray, size=size)
    N.remove(high)
    ob = C.join(parts, key)
    gn.remove_templates()
    return N.finish_static(key, ob, args, budget, expected, lods="mesh", tol=tol)


def build_rock_a(args, key="rock_a"):
    mat = M.rock("Rock", color="#6f6a61", color2="#4a463f", seed=7, moss=0.4, strata=0.6, lichen=0.35)
    o = _ico((0.9, 0.8, 0.62))
    _shape(o, lambda c: Vector((c.x + 0.1 * max(c.z, 0), c.y, (-0.25 + (c.z + 0.25) * 0.35) if c.z < -0.25 else c.z)))
    high = N.rock_hull(o, seed=11, cuts=14, depth=(0.05, 0.15), disp=0.11, disp_scale=2.0, blob=0.18)
    N.ground(high, 0.05)
    gn.store_up_mask(high, "moss", lo=0.55, hi=0.9, noise_scale=1.5, seed=3)
    return _rock_finish(key, high, mat, args, (1.75, 1.6, 1.16), target=2800, moss=M.moss("MossMat", color="#3f4a25", color2="#1c2410", seed=3))


def build_rock_b(args, key="rock_b"):
    """Tall leaning standing stone with two fallen companions at its foot."""
    mat = M.rock("Rock", color="#6a665e", color2="#46423b", seed=21, moss=0.35, strata=0.9, lichen=0.4)
    big = _ico((0.72, 0.55, 1.55), loc=(0.15, 0.1, 1.3))
    _shape(big, lambda c: Vector((c.x + 0.12 * (c.z - 1.3), c.y, c.z)))
    s1 = _ico((0.6, 0.5, 0.42), loc=(-0.85, -0.45, 0.2))
    s2 = _ico((0.45, 0.4, 0.3), loc=(0.95, -0.6, 0.12))
    highs = []
    for i, o in enumerate((big, s1, s2)):
        highs.append(N.rock_hull(o, seed=31 + i, cuts=12, depth=(0.05, 0.14), disp=0.13 if i == 0 else 0.1,
                                 disp_scale=1.2, strata=0.12, strata_scale=3.5, name=f"_RockHigh{i}"))
    high = C.join(highs, "_RockHigh")
    N.ground(high, 0.1)
    gn.store_up_mask(high, "moss", lo=0.6, hi=0.9, noise_scale=1.3, seed=5)
    return _rock_finish(key, high, mat, args, (3.0, 2.3, 3.0), target=3800, moss=M.moss("MossMat", color="#3f4a25", color2="#1c2410", seed=4),
                        moss_density=7.0, sink=0.05)


def build_rock_snow(args, key="rock_snow"):
    """Granite boulder under a wind-packed snow cap (snow thickness is real geometry in the high, baked)."""
    mat = N.add_snow(M.rock("Rock", color="#6c7178", color2="#474c53", seed=41, moss=0.0, strata=0.4, lichen=0.3,
                            dirt=0.4), amount=0.9)
    o = _ico((1.05, 0.85, 0.7))
    _shape(o, lambda c: Vector((c.x, c.y + 0.08 * c.z, (-0.3 + (c.z + 0.3) * 0.35) if c.z < -0.3 else c.z)))
    high = N.rock_hull(o, seed=43, cuts=11, depth=(0.03, 0.1), disp=0.18, disp_scale=1.3)
    N.snow_cap(high, thickness=0.09, seed=2)
    return _rock_finish(key, high, mat, args, (2.1, 1.75, 1.3), target=3000, sink=0.05)


def build_rock_desert(args, key="rock_desert"):
    """Wind-carved sandstone outcrop: stacked slabs fused (voxel), undercut base, layered ledges (GN terraces)."""
    mat = M.rock("Rock", color="#b07a50", color2="#7a4c31", seed=51, moss=0.0, strata=1.0, lichen=0.1, dirt=0.35,
                 wear=0.2)
    slabs = [((1.5, 1.2, 0.5), (0.0, 0.0, 0.25)), ((1.9, 1.5, 0.55), (0.05, 0.05, 0.75)), ((1.7, 1.35, 0.5), (0.1, -0.05, 1.25)),
             ((1.1, 0.95, 0.35), (0.25, 0.0, 1.6))]
    o = _cliff_high(slabs, seed=53, cuts=7, depth=(0.03, 0.08), disp=0.1, disp_scale=0.9, strata=0.0, voxel=0.035)
    N.terraces(o, step=0.24, depth=0.07, seed=5)
    gn.displace(o, strength=0.02, scale=6.0, detail=5, seed=54, voronoi=0.2)
    gn.apply(o)
    N.set_smooth(o)
    return _rock_finish(key, o, mat, args, (2.2, 1.8, 1.9), target=3200, sink=0.05)


def _cliff_high(blocks, seed, cuts=14, depth=(0.02, 0.07), disp=0.45, disp_scale=0.45, strata=0.3,
                strata_scale=1.3, voxel=0.12):
    """Union of subdivided boxes -> voxel remesh (one surface) -> planar fractures + strata displacement."""
    obs = [_box(size, cuts=10, loc=loc) for size, loc in blocks]
    o = C.join(obs, "_CliffHigh") if len(obs) > 1 else obs[0]
    gn.voxel_remesh(o, voxel=voxel, smooth_iters=2)
    gn.apply(o)
    gn.planar_cuts(o, cuts=cuts, depth=depth, seed=seed, subdiv=1)
    gn.displace(o, strength=disp, scale=disp_scale, detail=8, rough=0.6, seed=seed, voronoi=0.5,
                vor_scale=disp_scale * 1.5, strata=strata, strata_scale=strata_scale)
    gn.displace(o, strength=0.08, scale=2.5, detail=6, rough=0.6, seed=seed + 1, voronoi=0.3, strata=0.04,
                strata_scale=4.0, name="KitDisplace2")
    gn.apply(o)
    N.set_smooth(o)
    o.name = "_CliffHigh"
    return o


def _crag_blocks(seed, width, height, depth, n_cols=7, front=-1.0):
    """Craggy cliff massing: a row of leaning, rotated rock columns of uneven heights (+ a few fallen slabs at the
    foot and ledges) -> after the voxel union it reads as one broken cliff face, not a stack of boxes.
    Returns [(size, loc, rot_euler)]."""
    rnd = random.Random(seed)
    blocks = []
    step = width / n_cols
    for i in range(n_cols):
        x = -width / 2 + step * (i + 0.5) + rnd.uniform(-0.2, 0.2) * step
        h = height * rnd.uniform(0.62, 1.0) * (0.85 + 0.15 * math.sin(i * 1.7 + seed))
        w = step * rnd.uniform(1.15, 1.6)
        d = depth * rnd.uniform(0.55, 0.9)
        y = rnd.uniform(-0.25, 0.35) * depth
        blocks.append(((w, d, h), (x, y, h / 2 - 0.3), (rnd.uniform(-0.06, 0.06), rnd.uniform(-0.1, 0.1),
                                                           rnd.uniform(-0.35, 0.35))))
        if rnd.random() < 0.6:     # stepped ledge / buttress in front of the column
            lh = h * rnd.uniform(0.25, 0.5)
            blocks.append(((w * 0.8, d * 0.6, lh), (x + rnd.uniform(-0.3, 0.3), y + front * d * 0.45, lh / 2 - 0.2),
                           (rnd.uniform(-0.1, 0.1), rnd.uniform(-0.1, 0.1), rnd.uniform(-0.5, 0.5))))
    for k in range(3):             # fallen slabs / scree blocks at the foot
        x = rnd.uniform(-0.4, 0.4) * width
        blocks.append(((rnd.uniform(1.0, 1.8), rnd.uniform(0.8, 1.4), rnd.uniform(0.6, 1.1)),
                       (x, front * depth * rnd.uniform(0.55, 0.8), 0.2),
                       (rnd.uniform(-0.3, 0.3), rnd.uniform(-0.3, 0.3), rnd.uniform(0, TAU))))
    return blocks


def _crag_high(blocks, seed, voxel=0.12):
    obs = []
    for size, loc, rot in blocks:
        o = _box(size, cuts=8, loc=(0, 0, 0))
        o.rotation_euler = rot
        o.location = loc
        C.apply_transforms(o)
        obs.append(o)
    o = C.join(obs, "_CliffHigh")
    gn.voxel_remesh(o, voxel=voxel, smooth_iters=2)
    gn.apply(o)
    gn.planar_cuts(o, cuts=24, depth=(0.02, 0.07), seed=seed, subdiv=1)
    gn.displace(o, strength=0.35, scale=0.35, detail=6, rough=0.6, seed=seed, voronoi=0.6, vor_scale=0.6,
                strata=0.12, strata_scale=0.9)
    gn.displace(o, strength=0.09, scale=2.2, detail=6, rough=0.6, seed=seed + 1, voronoi=0.35, strata=0.03,
                strata_scale=3.0, name="KitDisplace2")
    gn.apply(o)
    N.set_smooth(o)
    o.name = "_CliffHigh"
    return o


def _cliff(args, key, seed, width, height, depth, n_cols, expected, color="#67635b", color2="#403c36"):
    mat = M.rock("Rock", color=color, color2=color2, seed=seed, moss=0.3, strata=0.45, lichen=0.3, scale=0.55,
                 wear=0.1)
    high = _crag_high(_crag_blocks(seed, width, height, depth, n_cols), seed=seed + 2)
    # keep the modular footprint: clamp to the tile width so neighbouring pieces butt together
    for v in high.data.vertices:
        v.co.x = max(-width / 2 - 0.25, min(width / 2 + 0.25, v.co.x))
    high.data.update()
    gn.store_up_mask(high, "moss", lo=0.62, hi=0.92, noise_scale=0.5, seed=seed)
    # set-piece scale (8-12 m): 'building' budget (2048 atlas, <= 20 k tris)
    return _rock_finish(key, high, mat, args, expected, target=9000, sink=0.3, extrusion=0.3, max_ray=0.9,
                        size=2048, budget="building", tol=0.3)


def build_cliff_a(args, key="cliff_a"):
    """Modular cliff wall ~10 m wide, ~8 m high, face toward -Y (tiles side by side along X)."""
    return _cliff(args, key, 61, 10.0, 8.2, 3.4, 7, (10.4, 4.6, 8.0))


def build_cliff_b(args, key="cliff_b"):
    """Tall cliff spire / corner piece ~11 m high."""
    return _cliff(args, key, 71, 6.4, 11.2, 4.4, 4, (6.8, 5.8, 11.0), color="#65625b", color2="#3d3a35")


# =============================================================================== props (cactus, mushrooms, wood)
def _profile_curve(pts2d, name="_Profile"):
    """Closed POLY profile curve object (x, y) for gn.curve_to_mesh(profile=...)."""
    ob = gn.make_curve([[(x, y, 0.0) for x, y in pts2d]], name, kind="POLY")
    ob.data.splines[0].use_cyclic_u = True
    return ob


def build_cactus(args, key="cactus"):
    """Saguaro: ribbed column with three upturned arms fused into one skin, areoles on the rib crests."""
    rnd = random.Random(71)
    mat = N.cactus_skin("Cactus", seed=3)
    ribs = 13
    prof = _profile_curve([((1 - 0.15 * (0.5 - 0.5 * math.cos(ribs * a)) ** 0.6) * math.cos(a),
                            (1 - 0.15 * (0.5 - 0.5 * math.cos(ribs * a)) ** 0.6) * math.sin(a))
                           for a in [i * TAU / (ribs * 6) for i in range(ribs * 6)]])
    main = [(0, 0, -0.12, 0.27), (0, 0, 0.6, 0.27), (0.02, 0, 1.5, 0.26), (0.03, 0.01, 2.4, 0.25), (0.03, 0.01, 3.1, 0.23),
            (0.03, 0.01, 3.32, 0.2), (0.03, 0.01, 3.45, 0.13), (0.03, 0.01, 3.5, 0.04)]
    spl = [main]
    for az, za, top in ((0.35, 1.35, 2.55), (2.9, 1.8, 2.95), (4.5, 2.15, 2.75)):
        c, s = math.cos(az), math.sin(az)
        arm = [(0.05, za, 0.15), (0.3, za - 0.03, 0.17), (0.5, za + 0.08, 0.17), (0.6, za + 0.4, 0.17),
               (0.63, (za + top) / 2 + 0.2, 0.165), (0.63, top - 0.12, 0.15), (0.63, top, 0.11), (0.63, top + 0.05, 0.03)]
        spl.append([(r * c, r * s, z, rad) for r, z, rad in arm])
    cu = gn.make_curve(spl, "_CactusHigh", kind="BEZIER", resolution=8)
    gn.curve_to_mesh(cu, radius=1.0, profile=prof, material=mat, fill_caps=True)
    high = gn.apply(cu)
    gn.remove(prof)
    gn.voxel_remesh(high, voxel=0.011, smooth_iters=2)
    gn.apply(high)
    N.set_smooth(high)
    N.ground(high, 0.06)
    gn.edge_wear(high, iterations=6, strength=30.0)
    gn.apply(high)
    high.name = "_CactusHigh"
    if not high.data.materials:
        high.data.materials.append(mat)
    low = N.trunk_low(high, 4200, "Cactus")
    print(f"[nature] {key}: high {N.tris(high)} low {N.tris(low)}")
    _bake(key, [low], high=high, extrusion=0.02, max_ray=0.05)
    N.remove(high)
    ob = C.join([low], key)
    gn.remove_templates()
    return N.finish_static(key, ob, args, "vegetation", (1.4, 1.3, 3.5), lods="mesh")


def _lathe(profile, seg, name, mat=None):
    """Revolve [(r, z)] around Z (first/last points on the axis become poles). Returns (verts, faces)."""
    verts, faces = [], []
    ring = []
    for i, (r, z) in enumerate(profile):
        if r < 1e-6:
            ring.append([len(verts)])
            verts.append((0.0, 0.0, z))
        else:
            ids = []
            for k in range(seg):
                a = k * TAU / seg
                ids.append(len(verts))
                verts.append((r * math.cos(a), r * math.sin(a), z))
            ring.append(ids)
    for a, b in zip(ring, ring[1:]):
        if len(a) == 1:
            for k in range(seg):
                faces.append((a[0], b[k], b[(k + 1) % seg]))
        elif len(b) == 1:
            for k in range(seg):
                faces.append((a[k], b[0], a[(k + 1) % seg]))
        else:
            for k in range(seg):
                faces.append((a[k], b[k], b[(k + 1) % seg], a[(k + 1) % seg]))
    return verts, faces


def build_mushrooms(args, key="mushrooms"):
    """Glowing swamp mushroom cluster on a mossy mound: velvet caps with luminous spots and gills."""
    import bmesh
    rnd = random.Random(81)
    mat = N.mushroom_mat("Mushroom", seed=2)
    moss = M.moss("MossMat", seed=8)
    mound = _ico((0.5, 0.42, 0.16), subdiv=4)
    gn.displace(mound, strength=0.05, scale=5.0, detail=4, seed=3, voronoi=0.3)
    gn.apply(mound)
    mound.data.materials.append(moss)
    for v in mound.data.vertices:
        v.co.z = max(v.co.z, -0.02)
    parts = [mound]
    specs = [(0.0, 0.02, 0.46, 0.17), (0.2, -0.1, 0.3, 0.12), (-0.18, -0.12, 0.26, 0.1), (-0.28, 0.12, 0.36, 0.13),
             (0.26, 0.17, 0.2, 0.08), (0.08, -0.25, 0.16, 0.07), (-0.05, 0.25, 0.22, 0.085), (0.38, -0.05, 0.13, 0.055),
             (-0.38, -0.02, 0.15, 0.06)]
    for i, (x, y, h, R) in enumerate(specs):
        tilt = Vector((x, y, 0)) * 0.9 + Vector((rnd.uniform(-.1, .1), rnd.uniform(-.1, .1), 0))
        base = Vector((x, y, 0.1 - 0.12 * (x * x + y * y) / 0.2))
        top = base + Vector((tilt.x * h, tilt.y * h, h))
        mid = base.lerp(top, 0.5) + Vector((rnd.uniform(-.02, .02), rnd.uniform(-.02, .02), 0))
        stem = N.sweep([[(base.x, base.y, base.z - 0.06, R * 0.3), (mid.x, mid.y, mid.z, R * 0.24),
                         (top.x, top.y, top.z - 0.01, R * 0.2)]], mat, profile_res=10, resolution=4, name=f"Stem{i}")
        prof = [(0.0, R * 0.55), (R * 0.45, R * 0.5), (R * 0.8, R * 0.32), (R * 0.98, R * 0.1), (R * 1.0, 0.0),
                (R * 0.9, -R * 0.06), (R * 0.55, -R * 0.1), (R * 0.2, -R * 0.07), (0.0, -R * 0.05)]
        vs, fs = _lathe(prof, 20, f"Cap{i}")
        cap = N.mesh_obj(f"Cap{i}", vs, fs, mat)
        # per-vertex attributes for the shader: cap / under (gill side) / ang (around the cap axis)
        me = cap.data
        a_cap = me.attributes.new("cap", "FLOAT", "POINT")
        a_under = me.attributes.new("under", "FLOAT", "POINT")
        a_ang = me.attributes.new("ang", "FLOAT", "POINT")
        for v in me.vertices:
            a_cap.data[v.index].value = 1.0
            a_under.data[v.index].value = 1.0 if (v.co.z < -R * 0.02 and math.hypot(v.co.x, v.co.y) < R * 0.97) else 0.0
            a_ang.data[v.index].value = math.atan2(v.co.y, v.co.x)
        up = (top - mid).normalized()
        q = N.UP.rotation_difference(up)
        cap.rotation_mode = "QUATERNION"
        cap.rotation_quaternion = q
        cap.location = top
        C.apply_transforms(cap)
        for ob in (stem,):
            me = ob.data
            for nm in ("cap", "under", "ang"):
                at = me.attributes.new(nm, "FLOAT", "POINT")
        parts += [stem, cap]
    ob = C.join(parts, "Mushrooms")
    N.set_smooth(ob)
    N.ground(ob, 0.03)
    print(f"[nature] {key}: tris {N.tris(ob)}")
    _bake(key, [ob], size=1024)
    ob.name = key
    gn.remove_templates()
    return N.finish_static(key, ob, args, "prop", (1.0, 0.9, 0.62), lods="mesh")


def _wood_piece(key, spl, bark, endgrain, end_pred, args, expected, target=3000, voxel=0.02, moss_density=10.0,
                budget="prop", spikes=()):
    """Log / stump: sweep -> voxel remesh (fused, watertight) -> GN gnarl -> end grain faces -> low + moss clumps."""
    ob = N.sweep(spl + list(spikes), bark, profile_res=14, resolution=5, name="_WoodHigh")
    gn.voxel_remesh(ob, voxel=voxel, smooth_iters=3)
    gn.apply(ob)
    gn.displace(ob, strength=0.025, scale=3.0, detail=4, seed=4, voronoi=0.3)
    gn.apply(ob)
    N.set_smooth(ob)
    N.ground(ob, 0.05)
    if not ob.data.materials:
        ob.data.materials.append(bark)
    low = N.trunk_low(ob, target, "Wood")
    N.remove(ob)
    N.assign_material(low, endgrain, end_pred)
    gn.store_up_mask(low, "moss", lo=0.55, hi=0.9, noise_scale=2.0, seed=4)
    gn.apply(low)
    mc = N.moss_clumps(low, M.moss("MossMat", seed=9), density=moss_density, up_min=0.75, size=0.09, seed=6,
                       distance_min=0.1)
    parts = [low] + ([mc] if mc else [])
    for p in parts:
        p["kit_bake_direct"] = 0
    print(f"[nature] {key}: tris {sum(N.tris(p) for p in parts)}")
    _bake(key, parts)
    obj = C.join(parts, key)
    gn.remove_templates()
    return N.finish_static(key, obj, args, budget, expected, lods="mesh")


def build_log_fallen(args, key="log_fallen"):
    """Fallen mossy trunk ~4.2 m: saw-cut end (growth rings), splintered broken end, two snapped branch stubs."""
    rnd = random.Random(91)
    bark = M.bark("Bark", "oak", seed=14, moss=0.65, dirt=0.7)
    eg = N.endgrain("EndGrain", axis="X", centre=(0.0, 0.33), seed=2)
    main = []
    for i in range(9):
        t = i / 8
        x = -2.0 + 4.0 * t
        r = 0.36 - 0.07 * t
        main.append((x, 0.08 * math.sin(t * 2.5), r * 0.92 + 0.04 * math.sin(t * 5), r))
    stubs = [[(-0.6, 0.1, 0.45, 0.1), (-0.5, 0.25, 0.75, 0.08), (-0.45, 0.3, 0.9, 0.06)],
             [(0.8, -0.2, 0.35, 0.09), (0.95, -0.5, 0.45, 0.07), (1.05, -0.62, 0.5, 0.05)]]
    spikes = []
    for k in range(6):
        a = k * TAU / 6 + rnd.uniform(-0.3, 0.3)
        rr = 0.2
        y, z = 0.08 * math.sin(2.5) + math.cos(a) * rr, 0.3 + math.sin(a) * rr
        L = rnd.uniform(0.12, 0.3)
        spikes.append([(1.9, y, z, 0.07), (2.0 + L * 0.6, y * 1.05, z, 0.04), (2.0 + L, y * 1.1, z + rnd.uniform(-.03, .03), 0.008)])
    return _wood_piece(key, [main] + stubs, bark, eg, lambda c, n: c.x < -1.9 and n.x < -0.6, args,
                       (4.3, 1.1, 0.9), spikes=spikes, moss_density=8.0)


def build_stump(args, key="stump"):
    """Old cut stump ~1.1 m wide: flared roots, sawn top with growth rings, a broken splinter crest, moss."""
    rnd = random.Random(101)
    bark = M.bark("Bark", "oak", seed=15, moss=0.5, dirt=0.7)
    eg = N.endgrain("EndGrain", axis="Z", centre=(0.0, 0.0), seed=3)
    trunk = [(0, 0, -0.1, 0.42), (0.01, 0, 0.25, 0.39), (0.02, 0.01, 0.5, 0.37), (0.02, 0.01, 0.56, 0.37)]
    spl = [trunk]
    for i in range(6):
        a = i * TAU / 6 + rnd.uniform(-0.3, 0.3)
        d = Vector((math.cos(a), math.sin(a), 0))
        L = rnd.uniform(0.45, 0.7)
        spl.append([tuple(d * 0.15) + (0.3, 0.16), tuple(d * (0.35 + L * 0.4)) + (0.1, 0.12),
                    tuple(d * (0.35 + L)) + (-0.08, 0.05)])
    spikes = []
    for k in range(5):
        a = 1.2 + k * 0.28 + rnd.uniform(-0.08, 0.08)
        r = 0.3
        h = rnd.uniform(0.18, 0.38)
        spikes.append([(math.cos(a) * r, math.sin(a) * r, 0.45, 0.07), (math.cos(a) * r * 1.02, math.sin(a) * r * 1.02, 0.56 + h * 0.6, 0.045),
                       (math.cos(a) * r * 1.04, math.sin(a) * r * 1.04, 0.56 + h, 0.006)])
    return _wood_piece(key, spl, bark, eg, lambda c, n: c.z > 0.45 and n.z > 0.8 and math.hypot(c.x, c.y) < 0.36,
                       args, (1.35, 1.35, 0.95), spikes=spikes, moss_density=10.0)


# =============================================================================== registry
BUILDERS = {k: globals().get("build_" + k) for k in KEYS}


def main():
    args = C.parse_args()
    fails, errors = {}, []
    for key in C.selected(args, KEYS):
        fn = BUILDERS.get(key)
        if fn is None:
            print(f"[nature] {key}: no builder yet, skipped")
            continue
        t0 = time.time()
        C.reset()
        try:
            rep = fn(args)
        except Exception:
            import traceback
            traceback.print_exc()
            errors.append(key)
            continue
        print(f"[nature] {key} done in {time.time() - t0:.0f}s  fails={rep['fails']}  warns={len(rep['warns'])}", flush=True)
        if rep["fails"]:
            fails[key] = rep["fails"]
    if fails:
        print(f"[nature] QA FAILS: {fails}")
    if errors:
        print(f"[nature] BUILD ERRORS: {errors}")
        sys.exit(1)


main()
