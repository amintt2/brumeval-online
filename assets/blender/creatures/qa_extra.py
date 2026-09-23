"""Extra automated checks for skinned creatures (on top of kit.qa):
* ground_report: lowest evaluated vertex per clip (feet on the ground, nothing sinking) + first/last pose match
  for looping clips (seamless loops);
* weights_report: vertices without any bone weight, max influences per vertex.
Results are stored in the kit QA report (rep["info"]["creature"]) and FAIL/WARN lines are added.
"""
import bpy
import numpy as np

from kit import qa


def _set_action(arm, act):
    arm.animation_data_create()
    arm.animation_data.action = act
    try:
        if act is not None and act.slots:
            arm.animation_data.action_slot = act.slots[0]
    except AttributeError:
        pass


def _verts(meshes):
    out = []
    for o in meshes:
        co, _, _ = qa.world_mesh(o)
        out.append(co)
    return np.concatenate(out, 0)


def ground_report(rep, arm, meshes, loops=("Idle", "Walk", "Run"), step=1, below_tol=0.025, float_tol=0.03):
    sc = bpy.context.scene
    res = {}
    for act in sorted(bpy.data.actions, key=lambda a: a.name):
        _set_action(arm, act)
        f0, f1 = int(act.frame_range[0]), int(act.frame_range[1])
        lows = []
        first = last = None
        for f in range(f0, f1 + 1, step):
            sc.frame_set(f)
            co = _verts(meshes)
            lows.append(float(co[:, 2].min()))
            if lows[-1] < -below_tol and (not res.get("_worst") or lows[-1] < res["_worst"][1]):
                res["_worst"] = (f, lows[-1], [round(float(c), 3) for c in co[int(co[:, 2].argmin())]])
            if f == f0:
                first = co
        sc.frame_set(f1)
        last = _verts(meshes)
        mn = min(lows)
        gap = float(np.abs(first - last).max()) if first is not None else 0.0
        worst = res.pop("_worst", None)
        res[act.name] = {"frames": [f0, f1], "min_z": round(mn, 3), "max_min_z": round(max(lows), 3),
                         "loop_gap": round(gap, 4)}
        if worst:
            res[act.name]["lowest"] = {"frame": worst[0], "at": worst[2]}
            print(f"[creatures] {act.name}: lowest point frame {worst[0]} at {worst[2]}")
        if mn < -below_tol:
            rep.fail(f"clip {act.name}: mesh goes {-mn:.3f} m below the ground")
        if act.name in loops and gap > 0.003:
            rep.fail(f"clip {act.name}: loop not seamless (first/last frame differ by {gap:.3f} m)")
        if act.name in ("Idle", "Walk", "Attack", "Hit") and max(lows) > float_tol and act.name != "Attack2":
            rep.warn(f"clip {act.name}: whole model leaves the ground by {max(lows):.3f} m at some frame")
        print(f"[creatures] ground {act.name:8s} {f1 - f0 + 1:3d}f  minZ {mn:+.3f}  maxMinZ {max(lows):+.3f}  loop_gap {gap:.4f}")
    _set_action(arm, None)
    for pb in arm.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.scale = (1, 1, 1)
    sc.frame_set(sc.frame_start)
    rep["info"].setdefault("creature", {})["ground"] = res
    return res


def weights_report(rep, arm, meshes):
    deform = {b.name for b in arm.data.bones if b.use_deform}
    out = {}
    for o in meshes:
        idx = {g.index: g.name for g in o.vertex_groups if g.name in deform}
        none, maxinf = 0, 0
        for v in o.data.vertices:
            gs = [g for g in v.groups if g.group in idx and g.weight > 1e-4]
            if not gs:
                none += 1
            maxinf = max(maxinf, len(gs))
        out[o.name] = {"unweighted": none, "max_influences": maxinf}
        if none:
            rep.fail(f"{o.name}: {none} vertices without bone weights")
        if maxinf > 4:
            rep.warn(f"{o.name}: up to {maxinf} bone influences per vertex (glTF/three.js uses 4)")
    rep["info"].setdefault("creature", {})["weights"] = out
    return out
