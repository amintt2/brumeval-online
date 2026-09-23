"""Group `humanoids`: goblin_shaman, skeleton_archer, bandit, wraith, lich (boss), swamp_hag (boss).

    npm run assets -- humanoids                    (all keys)
    blender -b --factory-startup --python assets/blender/humanoids/build.py -- --only bandit

Every character: continuous voxel-fused body (high -> baked normal/AO details, decimated low for the game),
garments lofted / shelled from the body with a clearance, smooth skin weights, body hidden under clothes deleted,
clips keyed in character space (hanim) with ground snapping, procedural materials baked to glTF PBR, QA + sheets.
Set HUM_FAST=1 to skip the bake (geometry / animation iteration only).
"""
import math
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)

import bpy  # noqa: E402
import mathutils  # noqa: E402

import common as C  # noqa: E402
import hanim as HA  # noqa: E402
import hbody as HB  # noqa: E402
import hchar as HC  # noqa: E402
import hgarment as HG  # noqa: E402
import hmats as HM  # noqa: E402
import hprops as PR  # noqa: E402
import hrig  # noqa: E402
from kit import gn, qa, rig  # noqa: E402

V = mathutils.Vector
KEYS = ["goblin_shaman", "skeleton_archer", "bandit", "wraith", "lich", "swamp_hag"]
FAST = bool(os.environ.get("HUM_FAST"))
args = C.parse_args()


from hutil import J0, lerp, shell, conform, thicken  # noqa: E402


# =============================================================================== BANDIT
def build_bandit():
    P = dict(H=1.8, hands=("fist", "fist"), ears="human", muscle=0.85, bulk=1.08, nose=1.1, jaw=1.05)
    B = HC.make_body(P, "human", tris=4200)
    arm, J, base, high, body = B["arm"], B["J"], B["base"], B["high"], B["low"]
    s = B["s"]
    R = HG.Regions(J)
    hips, ch, nk, hd = J0(J, "hips"), J0(J, "chest"), J0(J, "neck"), J0(J, "head")
    # ---------------------------------------------------------------- materials
    m_skin = HM.skin("Skin", "human", "#a47a60", seed=3)
    m_jerkin = HM.leather("Leather_Jerkin", color="#3e2b1d", seed=2, wear=0.7, dirt=0.6)
    m_shirt = HM.cloth("Shirt", color="#4a2320", kind="linen", seed=5, dirt=0.5)
    m_pants = HM.cloth("Trousers", color="#2d2a27", kind="wool", seed=6, dirt=0.6, hem_dirt=0.8)
    m_boots = HM.leather("Boots", color="#261a12", seed=7, wear=0.8, dirt=0.8)
    m_glove = HM.leather("Gloves", color="#1d1612", seed=8, wear=0.6)
    m_hood = HM.cloth("Cloth_Hood", color="#262b25", kind="wool", seed=9, dirt=0.5, hem_dirt=0.0)
    HM.tatter(m_hood, hd.z - 0.62 * s, hd.z - 0.5 * s, 1.3, holes=0.25, seed=2)
    m_scarf = HM.cloth("Cloth_Scarf", color="#5b221c", kind="wool", seed=10, dirt=0.4, hem_dirt=0.0)
    m_belt = HM.leather("Belt", color="#2c1d12", seed=11, wear=0.8)
    m_iron = HM.metal("Iron", kind="iron", rust=0.45, seed=12)
    m_steel = HM.metal("Steel", kind="steel", rust=0.2, grime=0.5, seed=13, scratches=0.9)
    m_grip = HM.leather("Grip", color="#1a120c", seed=14, wear=0.3)
    body.data.materials.append(m_skin)
    # ---------------------------------------------------------------- garments (from the quad base mesh)
    wz = hips.z - 0.16 * s
    jerkin = shell(base, R, lambda c, co: (c[0] == "torso" and wz < co.z < nk.z + 0.015 * s) or
                   (c[0].startswith("arm") and c[1] < 0.2), 0.02 * s, "Jerkin", m_jerkin)
    sleeves = shell(base, R, lambda c, co: c[0].startswith("arm") and 0.12 < c[1] < 0.58, 0.012 * s, "Sleeves", m_shirt)
    bracers = shell(base, R, lambda c, co: c[0].startswith("arm") and 0.5 < c[1] < 0.74, 0.02 * s, "Bracers", m_glove)
    pants = shell(base, R, lambda c, co: (c[0].startswith("leg") and c[1] < 0.62) or
                  (c[0] == "torso" and co.z < hips.z - 0.02 * s), 0.011 * s, "Trousers", m_pants)
    boots = shell(base, R, lambda c, co: c[0].startswith("leg") and c[1] > 0.52, 0.017 * s, "Boots", m_boots)
    for g, off in ((jerkin, 0.016), (sleeves, 0.009), (bracers, 0.016), (pants, 0.008), (boots, 0.013)):
        conform(g, [high], off * s)
    conform(jerkin, [pants], 0.006 * s)
    conform(bracers, [sleeves], 0.004 * s)
    # gloves: painted on the body itself (low AND high, so the high->low bake agrees)
    HG.paint_region([body, high], R, lambda c, co: c[0].startswith("arm") and c[1] >= 0.72, m_glove)
    for g, t in ((jerkin, 1700), (sleeves, 800), (bracers, 500), (pants, 1900), (boots, 1300)):
        HB.decimate_to(g, t)
    conform(boots, [pants], 0.005 * s)
    # hood + short mantle, scarf over the lower face
    hood = HG.hood(J, s, "Cloth_Hood", m_hood, depth=1.05, peak=0.07, mantle=(0.25, 0.18), hem_drop=0.2,
                   open_w=0.2, open_h=(0.03, 0.16), brim=0.035)
    HG.drape(hood, [jerkin], 0.012 * s, 0.55, zmax=J0(J, "upper_arm.L").z + 0.02 * s)
    conform(hood, [high, jerkin], 0.012 * s, iters=3)
    rings = []
    for k, (z, rx, ry, cy) in enumerate([(nk.z + 0.0, 0.1, 0.1, 0.0), (nk.z + 0.05, 0.085, 0.09, -0.01),
                                        (hd.z + 0.02, 0.078, 0.095, -0.02), (hd.z + 0.06, 0.082, 0.1, -0.025),
                                        (hd.z + 0.085, 0.084, 0.1, -0.025)]):
        rings.append(HG.ring((0, hd.y + cy * s, z), rx * s, ry * s, 28, folds=(6, 0.04, 0.3 * k)))
    scarf = HB.loft(rings, "Cloth_Scarf", mat=m_scarf)
    HB.outward_normals(scarf, lambda p: V((0, hd.y, p.z)))
    conform(scarf, [high], 0.01 * s, iters=4)
    conform(hood, [scarf], 0.006 * s, iters=2)
    # ---------------------------------------------------------------- skinning
    src = HB.copy(body, "_BodySrc")
    rig.bind(body, arm, smooth=4)
    rig.bind(src, arm, smooth=4)
    for g, sm in ((jerkin, 6), (sleeves, 4), (bracers, 3), (pants, 3), (boots, 3)):
        HC.weights_from(src, g, arm, smooth=sm)
    HG.seg_weights(hood, arm, ["head", "neck", "chest", "upper_arm.L", "upper_arm.R", "spine"], power=3.0, smooth=8,
                   bias={"head": 2.5})
    HG.seg_weights(scarf, arm, ["head", "neck", "chest"], power=3, smooth=6, bias={"head": 1.5})
    zc = HB.get_co(scarf)[:, 2]
    HC.blend_weights_to(scarf, arm, "head", ((zc - (hd.z - 0.01 * s)) / (0.04 * s)).clip(0, 1))
    zc = HB.get_co(hood)[:, 2]
    HC.blend_weights_to(hood, arm, "head", ((zc - (hd.z + 0.0 * s)) / (0.05 * s)).clip(0, 1))
    # ---------------------------------------------------------------- gear: belt, pouches, daggers, bandolier
    loop = HG.body_loop(jerkin, hips.z - 0.03 * s, hips.y, 0.17 * s, 0.13 * s, n=40, clearance=0.006 * s)
    belt = HG.band(loop, 0.05 * s, 0.012 * s, "BeltBand", m_belt, closed=True)
    buckle = HB.ellipsoid(V(loop[0]) + V((0, -0.008, 0)) * s, (0.03 * s, 0.01 * s, 0.028 * s), seg=12, rings=6, name="Buckle")
    PR._mat(buckle, m_iron)
    # bandolier: loop around the torso from the right shoulder to the left hip (hugging the jerkin)
    tj = HB.bvh(jerkin)
    pts = []
    sh_r = J0(J, "upper_arm.R") + V((0.06, 0, 0.06)) * s
    hip_l = V((0.14 * s, hips.y, hips.z + 0.02 * s))
    for k in range(24):
        a = 2 * math.pi * k / 24
        c = lerp(sh_r, hip_l, 0.5)
        axis = (hip_l - sh_r)
        half = axis.length / 2
        u = axis.normalized()
        w = V((0, 1, 0))
        p = c + u * half * math.cos(a) + w * 0.2 * s * math.sin(a)
        q, n_, i_, d_ = tj.find_nearest(p)
        pts.append(tuple(q + n_ * 0.007 * s))
    bando = HG.band(pts, 0.035 * s, 0.008 * s, "Bandolier", m_belt, up=(0.7, 0, 0.7), closed=True)
    pouches = [PR.pouch(V(loop[k]) + (V(loop[k]) - V((0, hips.y, V(loop[k]).z))).normalized() * 0.03 * s - V((0, 0, 0.04 * s)),
                        0.1 * s, m_belt, name=f"Pouch{k}") for k in (7, 33)]
    gl, al, _, _ = PR.grip_frame(J, "L")
    gr, ar, _, _ = PR.grip_frame(J, "R")
    dag_r = PR.dagger(gr, ar, 0.38 * s, m_steel, m_grip, m_iron, curve=0.05, name="DaggerR")
    dag_l = PR.dagger(gl, al, 0.36 * s, m_steel, m_grip, m_iron, curve=-0.03, name="DaggerL")
    HC.parent_rigid(dag_r, arm, "hand.R")
    HC.parent_rigid(dag_l, arm, "hand.L")
    for g in [belt, buckle, bando] + pouches:
        HG.seg_weights(g, arm, ["hips", "spine", "chest", "thigh.L", "thigh.R"], power=3, smooth=4, bias={"hips": 2.0})
    gear = HC.join_gear([belt, buckle, bando] + pouches + [dag_r, dag_l], "Gear")
    # thickness last (after weights so the shell verts inherit them)
    for g, t in ((jerkin, 0.006), (sleeves, 0.004), (bracers, 0.006), (pants, 0.004), (boots, 0.006), (scarf, 0.005)):
        thicken(g, t * s)
    thicken(hood, 0.006 * s, full=True)
    cloths = [jerkin, sleeves, bracers, pants, boots, hood, scarf]
    # ---------------------------------------------------------------- clips
    st = dict(snap=body, arms=30, elbow=-12, stride=26, swing=12,
              base={"spine": (6, 0, 0), "neck": (-4, 0, 0), "upper_arm.L": (-18, 4, 10), "upper_arm.R": (-22, -4, -10),
                    "forearm.L": (-33, 0, 0), "forearm.R": (-38, 0, 0)})
    ready = {"thigh.L": (-10, -4, 0), "thigh.R": (6, 5, 0), "shin.L": (14, 0, 0), "shin.R": (16, 0, 0),
             "foot.L": (-4, 0, 0), "foot.R": (-18, 0, 0), "spine": (0, 0, 10), "chest": (2, 0, 6), "head": (0, 0, -12)}
    HA.idle(arm, st, extra=(ready, hrig.add(ready, {"spine": (1, 0, 0)})))
    HA.walk(arm, st, dur=24)
    HA.run(arm, st, dur=16)
    # Attack: quick lunge + right-hand stab (0.62 s)
    a0 = ready
    a1 = hrig.add(ready, {"spine": (-4, 0, -22), "chest": (0, 0, -14), "upper_arm.R": (40, -30, 0), "forearm.R": (-60, 0, 0),
                          "thigh.L": (-4, 0, 0), "shin.L": (6, 0, 0), "head": (0, 0, 14)})
    a2 = hrig.add(ready, {"spine": (14, 0, 22), "chest": (6, 0, 16), "upper_arm.R": (-62, 18, 0), "forearm.R": (48, 0, 0),
                          "upper_arm.L": (22, 0, 0), "thigh.L": (-34, 0, 0), "shin.L": (30, 0, 0), "foot.L": (4, 0, 0),
                          "thigh.R": (24, 0, 0), "shin.R": (6, 0, 0), "head": (-6, 0, -16),
                          "hips": {"rot": (0, 0, 8), "loc": (0, -0.1, -0.04)}})
    HA.clip(arm, st, "Attack", [(0, a0), (4, a1), (8, a2), (11, hrig.lerp(a2, a0, 0.25)), (15, a0)])
    # Attack2: coil -> spinning double slash (360 deg) -> recover (1.45 s)
    coil = hrig.add(ready, {"spine": (18, 0, -40), "chest": (6, 0, -20), "upper_arm.L": (-10, -30, -40),
                            "upper_arm.R": (-20, 30, 30), "forearm.L": (-60, 0, 0), "forearm.R": (-70, 0, 0),
                            "thigh.L": (-22, -8, 0), "thigh.R": (-10, 8, 0), "shin.L": (40, 0, 0), "shin.R": (38, 0, 0),
                            "foot.L": (-14, 0, 0), "foot.R": (-14, 0, 0), "hips": {"rot": (0, 0, -20), "loc": (0, 0, -0.1)}})
    slash = {"spine": (4, 0, 10), "chest": (0, 0, 10), "upper_arm.L": (-10, -55, 0), "upper_arm.R": (-10, 55, 0),
             "forearm.L": (-10, 0, 0), "forearm.R": (-10, 0, 0), "thigh.L": (-8, -8, 0), "thigh.R": (-8, 8, 0),
             "shin.L": (14, 0, 0), "shin.R": (14, 0, 0), "head": (-4, 0, 0)}

    def spin(p, deg, lift=0.0):
        q = dict(p)
        q["root"] = {"rot": (0, 0, deg), "loc": (0, 0, lift)}
        return q
    keys = [(0, a0), (8, coil), (14, spin(coil, 0)), (17, spin(slash, 120)), (20, spin(slash, 240)),
            (23, spin(hrig.add(slash, {"upper_arm.L": (-30, 20, 0), "upper_arm.R": (-30, -20, 0)}), 360)),
            (27, spin(hrig.add(ready, {"spine": (10, 0, 0)}), 360)), (35, spin(ready, 360))]
    HA.clip(arm, st, "Attack2", keys)
    HA.hit(arm, st, 9, extra=ready)
    HA.death(arm, st, 30, direction=-1)
    # ---------------------------------------------------------------- hide covered body, finish
    qa.delete_covered_body(body, cloths, margin=0.0, max_depth=0.25, shrink=0.02 * s)
    HC.fix_pokes(body, cloths, arm)
    bpy.data.objects.remove(src, do_unlink=True)
    return dict(arm=arm, body=body, cloths=cloths, gear=[gear], high=high, H=1.8, budget="humanoid", hero=("Idle", 12),
                closeups=[("head", tuple(hd + V((0, -0.03, 0.1)) * 1), 0.16, 25, 5), ("head side", tuple(hd + V((0, 0, 0.1))), 0.16, 80, 5),
                          ("daggers", tuple(lerp(J0(J, "hand.L"), J0(J, "hand.R"), 0.5) + V((0, 0, 0.02))), 0.5, 20, 10),
                          ("belt", tuple(V((0, 0, hips.z))), 0.28, 30, 10)])


# =============================================================================== driver
import c_goblin  # noqa: E402
import c_skeleton  # noqa: E402
import c_wraith  # noqa: E402

BUILDERS = {"bandit": build_bandit, "goblin_shaman": c_goblin.build, "skeleton_archer": c_skeleton.build,
            "wraith": c_wraith.build}


def main():
    for key in C.selected(args, KEYS):
        if key not in BUILDERS:
            print(f"[humanoids] {key}: not implemented yet")
            continue
        t0 = time.time()
        C.reset()
        bpy.context.scene.render.fps = 24
        R = BUILDERS[key]()
        for o in [R["body"]] + R["cloths"] + R["gear"]:
            for p in o.data.polygons:
                pass
        if FAST:
            from kit import render, export
            import hqa
            meshes = [R["body"]] + R["cloths"] + R["gear"]
            if R.get("high") is not None:
                bpy.data.objects.remove(R["high"], do_unlink=True)
            if os.environ.get("HUM_SAVE"):
                bpy.ops.wm.save_as_mainfile(filepath=os.path.join(os.environ["HUM_SAVE"], key + ".blend"))
            print(f"[humanoids] {key}: FAST tris={export.triangles(meshes)}")
            for o in meshes:
                mn, mx = render.bbox([o])
                print(f"[humanoids]   {o.name}: tris={export.triangles([o])} min={[round(x, 2) for x in mn]} max={[round(x, 2) for x in mx]}")
            rep = qa.run(key, meshes, budget=R["budget"], expected=(None, None, R["H"]),
                         skin=dict(body=R["body"], cloths=R["cloths"], armature=R["arm"], frames=7), seams=False)
            render.qa_sheets(key, meshes, args.previews, hero_action=R["hero"][0], hero_frame=R["hero"][1],
                             sheets=("turntable", "normals"))
            hqa.posed_turntable(key, meshes, args.previews, R["hero"][0], R["hero"][1])
            if R.get("closeups"):
                hqa.closeups(key, meshes, args.previews, R["closeups"])
            if R.get("keyposes"):
                hqa.key_poses(key, meshes, args.previews, R["keyposes"])
        else:
            HC.finish(key, args, R["arm"], R["body"], R["cloths"], R["gear"], R["budget"], R["H"], high=R.get("high"),
                      hero=R["hero"], closeups=R.get("closeups", ()), keyposes=R.get("keyposes", ()))
        print(f"[humanoids] {key} done in {time.time() - t0:.1f}s")


main()
