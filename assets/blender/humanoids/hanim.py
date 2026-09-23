"""Clip library (character-space poses, see hrig). Generic locomotion / reactions parameterised by a style dict;
attacks and specials are authored per character in build.py with the same helpers.

Style keys:
    base      pose added to every key (stance: crouch, hunch compensation, weapon carry...)
    arms      degrees the arms are lowered from the A-pose rest (default 32)
    swing     arm swing amplitude in walk/run (deg)          stride   thigh swing (deg)
    carry     {bone: rot} arm pose overriding the swing for a weapon arm (e.g. staff upright)
    float     wraith: hover height (m); disables ground snapping and adds a slow bob
    snap      skinned mesh used to keep the lowest point on the ground (feet planted) at every key
"""
import math

import bpy
import numpy as np

import hbody as HB
import hrig

P = hrig.add


def arms_down(k=32.0, elbow=-12.0):
    return {"upper_arm.L": (0, k, 0), "upper_arm.R": (0, -k, 0), "forearm.L": (elbow, 0, 0), "forearm.R": (elbow, 0, 0)}


def with_base(st, p):
    b = P(arms_down(st.get("arms", 32.0), st.get("elbow", -12.0)), st.get("base", {}))
    out = P(b, p)
    for k, v in st.get("carry", {}).items():       # weapon arm: absolute override of the swing
        if k in p and isinstance(p[k], dict) and p[k].get("keep"):
            continue
        out[k] = {"rot": tuple(v)} if not isinstance(v, dict) else v
    return out


# =============================================================================== ground snapping
def _min_z(arm, body, pose):
    hrig.pose_now(arm, pose)
    dg = bpy.context.evaluated_depsgraph_get()
    ev = body.evaluated_get(dg)
    me = ev.to_mesh()
    n = len(me.vertices)
    co = np.empty(n * 3)
    me.vertices.foreach_get("co", co)
    ev.to_mesh_clear()
    mw = np.array(body.matrix_world)
    z = (co.reshape(-1, 3) @ mw[:3, :3].T + mw[:3, 3])[:, 2]
    return float(z.min())


def snap(arm, body, pose, clearance=0.004, only_down=False):
    """Adjust root z so the lowest point of `body` touches the ground in this pose."""
    p = dict(pose)
    r = p.get("root", {"rot": (0, 0, 0), "loc": (0, 0, 0)})
    if not isinstance(r, dict):
        r = {"rot": r, "loc": (0, 0, 0)}
    loc = list(r.get("loc", (0, 0, 0)))
    p["root"] = {"rot": r.get("rot", (0, 0, 0)), "loc": tuple(loc)}
    mz = _min_z(arm, body, p)
    dz = clearance - mz
    if only_down and dz > 0:
        dz = 0.0
    loc[2] += dz
    p["root"] = {"rot": r.get("rot", (0, 0, 0)), "loc": tuple(loc)}
    return p


def clip(arm, st, name, keys, cyclic=False, snap_keys=True):
    """keys = [(frame, pose)...(+("loop", frame))]: adds the style base, snaps feet to the ground, keys the Action."""
    out = []
    body = st.get("snap")
    for f, p in keys:
        if f == "loop":
            out.append((f, p))
            continue
        nos = bool(p.get("_nosnap"))
        p = {k: v for k, v in p.items() if k != "_nosnap"}
        q = with_base(st, p)
        if st.get("float") is not None:
            r = q.get("root", {"rot": (0, 0, 0), "loc": (0, 0, 0)})
            loc = list(r.get("loc", (0, 0, 0)))
            loc[2] += st["float"]
            q["root"] = {"rot": r.get("rot", (0, 0, 0)), "loc": tuple(loc)}
        elif body is not None and snap_keys and not nos:
            q = snap(arm, body, q)
        out.append((f, q))
    act = hrig.clip(arm, name, out, cyclic=cyclic)
    hrig.pose_now(arm, {})
    return act


# =============================================================================== generic clips
def idle(arm, st, dur=48, breathe=2.5, sway=1.5, extra=None):
    """Breathing loop: chest rise, shoulders, slight weight shift, head look."""
    a = {"spine": (breathe * 0.4, 0, 0), "chest": (-breathe, 0, sway * 0.3), "neck": (1, 0, 0), "head": (1, -1, -3),
         "hips": {"rot": (0, sway * 0.5, 0), "loc": (0.004, 0, 0)},
         "upper_arm.L": (0, -2, 0), "upper_arm.R": (0, 2, 0)}
    b = {"spine": (-breathe * 0.2, 0, 0), "chest": (breathe * 0.6, 0, -sway * 0.3), "neck": (-1, 0, 0), "head": (-2, 1, 4),
         "hips": {"rot": (0, -sway * 0.5, 0), "loc": (-0.004, 0, -0.006)},
         "upper_arm.L": (0, 2, 0), "upper_arm.R": (0, -2, 0), "forearm.L": (-3, 0, 0), "forearm.R": (-3, 0, 0)}
    if extra:
        a, b = P(a, extra[0]), P(b, extra[1])
    return clip(arm, st, "Idle", [(0, a), (dur // 2, b), ("loop", dur)], cyclic=True)


def walk(arm, st, dur=24, name="Walk", stride=None, swing=None, bob=0.022, lean=4.0, knee=38.0, extra=None):
    """Two-step cycle: contact L / passing / contact R / passing. Feet snapped to the ground at every key."""
    sd = stride if stride is not None else st.get("stride", 24.0)
    sw = swing if swing is not None else st.get("swing", 18.0)
    q = dur // 4
    A = {"thigh.L": (-sd, 0, 0), "shin.L": (4, 0, 0), "foot.L": (sd * 0.55, 0, 0),
         "thigh.R": (sd * 0.75, 0, 0), "shin.R": (sd * 0.6, 0, 0), "foot.R": (-sd * 0.3, 0, 0),
         "hips": {"rot": (0, 0, -6), "loc": (0, 0, -bob * 0.5)}, "spine": (lean, 0, 3), "chest": (0, 0, 5),
         "neck": (-lean * 0.4, 0, -3), "head": (-1, 0, -2),
         "upper_arm.L": (sw, 0, 0), "upper_arm.R": (-sw, 0, 0), "forearm.L": (-4, 0, 0), "forearm.R": (-sw * 0.9, 0, 0)}
    PASS = {"thigh.L": (-2, 0, 0), "shin.L": (6, 0, 0), "foot.L": (-4, 0, 0),
            "thigh.R": (-sd * 0.45, 0, 0), "shin.R": (knee, 0, 0), "foot.R": (-8, 0, 0),
            "hips": {"rot": (0, -2.5, 0), "loc": (0, 0, bob * 0.5)}, "spine": (lean + 1, 0, 0), "chest": (0, 0, 0),
            "neck": (-lean * 0.4, 0, 0), "head": (0, 0, 0),
            "upper_arm.L": (sw * 0.1, 0, 0), "upper_arm.R": (-sw * 0.1, 0, 0), "forearm.L": (-8, 0, 0), "forearm.R": (-8, 0, 0)}
    if extra:
        A, PASS = P(A, extra[0]), P(PASS, extra[1])
    B, PASS2 = hrig.mirror(A), hrig.mirror(PASS)
    return clip(arm, st, name, [(0, A), (q, PASS), (2 * q, B), (3 * q, PASS2), ("loop", dur)], cyclic=True)


def run(arm, st, dur=16, stride=None, swing=None, lean=14.0, extra=None):
    sd = stride if stride is not None else st.get("stride", 24.0) * 1.55
    sw = swing if swing is not None else st.get("swing", 18.0) * 2.0
    q = dur // 4
    A = {"thigh.L": (-sd, 0, 0), "shin.L": (14, 0, 0), "foot.L": (sd * 0.45, 0, 0),
         "thigh.R": (sd * 0.55, 0, 0), "shin.R": (70, 0, 0), "foot.R": (-10, 0, 0),
         "hips": {"rot": (lean * 0.3, 0, -9), "loc": (0, 0, -0.035)}, "spine": (lean, 0, 5), "chest": (lean * 0.3, 0, 8),
         "neck": (-lean * 0.8, 0, -5), "head": (-lean * 0.3, 0, -4),
         "upper_arm.L": (sw, 0, 0), "upper_arm.R": (-sw, 0, 0), "forearm.L": (-35, 0, 0), "forearm.R": (-75, 0, 0)}
    FLY = {"thigh.L": (sd * 0.3, 0, 0), "shin.L": (35, 0, 0), "foot.L": (15, 0, 0),
           "thigh.R": (-sd * 0.85, 0, 0), "shin.R": (95, 0, 0), "foot.R": (-5, 0, 0),
           "hips": {"rot": (lean * 0.3, 0, 0), "loc": (0, 0, 0.03)}, "spine": (lean + 2, 0, 0), "chest": (lean * 0.3, 0, 0),
           "neck": (-lean * 0.8, 0, 0), "head": (-lean * 0.3, 0, 0),
           "upper_arm.L": (sw * 0.2, 0, 0), "upper_arm.R": (-sw * 0.2, 0, 0), "forearm.L": (-55, 0, 0), "forearm.R": (-55, 0, 0)}
    if extra:
        A, FLY = P(A, extra[0]), P(FLY, extra[1])
    B, FLY2 = hrig.mirror(A), hrig.mirror(FLY)
    FLY["_nosnap"] = FLY2["_nosnap"] = True
    # flight keys: keep the root height of the contact snap + the hip lift (no ground contact)
    keys = [(0, A), (q, FLY), (2 * q, B), (3 * q, FLY2), ("loop", dur)]
    body = st.get("snap")
    if body is not None and st.get("float") is None:
        a = snap(arm, body, with_base(st, {k: v for k, v in A.items() if k != "_nosnap"}))
        z0 = a["root"]["loc"][2]
        for k in (1, 3):
            f, p = keys[k]
            p = dict(p)
            p["root"] = {"rot": (0, 0, 0), "loc": (0, 0, z0 + 0.02)}
            keys[k] = (f, p)
    return clip(arm, st, "Run", keys, cyclic=True)


def hit(arm, st, dur=9, side=1, extra=None):
    """0.35 s flinch: snap back, head whips, arms jerk, recover to the stance."""
    rest = {}
    H = {"spine": (-9, side * 3, side * 6), "chest": (-10, 0, side * 5), "neck": (-8, 0, 0), "head": (-14, side * 6, side * 8),
         "hips": {"rot": (-3, 0, 0), "loc": (0, 0.04, -0.01)},
         "upper_arm.L": (-12, -8, 0), "upper_arm.R": (-12, 8, 0), "forearm.L": (-25, 0, 0), "forearm.R": (-25, 0, 0),
         "thigh.L": (-6, 0, 0), "shin.L": (10, 0, 0), "thigh.R": (6, 0, 0), "shin.R": (6, 0, 0)}
    H2 = hrig.lerp(H, {}, 0.55)
    if extra:
        H = P(H, extra)
    return clip(arm, st, "Hit", [(0, rest), (2, H), (5, H2), (dur, rest)])


def death(arm, st, dur=30, direction=-1, extra_mid=None, extra_end=None):
    """~1.25 s: stagger, knees buckle, fall on the back (direction -1) or face (+1); ends lying still on the ground."""
    d = direction
    k1 = {"spine": (-10 * d * -1, 0, 8), "chest": (-8, 0, 6), "head": (-18, 8, 10), "neck": (-6, 0, 0),
          "hips": {"rot": (0, 0, 6), "loc": (0, 0.03, -0.02)},
          "upper_arm.L": (-25, -20, 0), "upper_arm.R": (-30, 15, 0), "forearm.L": (-40, 0, 0), "forearm.R": (-35, 0, 0),
          "thigh.L": (-10, 0, 0), "shin.L": (15, 0, 0), "thigh.R": (8, 0, 0), "shin.R": (10, 0, 0)}
    k2 = {"root": {"rot": (d * 12, 0, 4), "loc": (0, 0, 0)}, "spine": (d * 10, 0, 6), "chest": (d * 8, 0, 4),
          "head": (d * 14, 6, 12), "hips": {"rot": (-10, 0, 4), "loc": (0, 0, -0.25)},
          "thigh.L": (-60, -5, 0), "shin.L": (95, 0, 0), "foot.L": (-25, 0, 0),
          "thigh.R": (-45, 8, 0), "shin.R": (80, 0, 0), "foot.R": (-20, 0, 0),
          "upper_arm.L": (-10, -30, 0), "upper_arm.R": (-5, 25, 0), "forearm.L": (-30, 0, 0), "forearm.R": (-45, 0, 0)}
    if extra_mid:
        k2 = P(k2, extra_mid)
    k3 = {"root": {"rot": (d * 80, 0, 10), "loc": (0, d * 0.2, 0)}, "spine": (d * 6, 0, 0), "chest": (d * 4, 0, 0),
          "neck": (0, 0, 0), "head": (-d * 6, 10, 25), "hips": {"rot": (-6, 4, 0), "loc": (0, 0, -0.05)},
          "thigh.L": (-25, -6, 0), "shin.L": (30, 0, 0), "foot.L": (20, 0, 0),
          "thigh.R": (-8, 10, 0), "shin.R": (12, 0, 0), "foot.R": (25, 0, 0),
          "upper_arm.L": (-d * 30, -40, 0), "upper_arm.R": (-d * 20, 45, 0), "forearm.L": (-20, 0, 0), "forearm.R": (-10, 0, 0)}
    if extra_end:
        k3 = P(k3, extra_end)
    k4 = hrig.add(k3, {"chest": (-d * 3, 0, 0), "head": (d * 3, 0, 0), "upper_arm.L": (0, 4, 0)})
    return clip(arm, st, "Death", [(0, {}), (6, k1), (15, k2), (dur - 7, k4), (dur, k3)])
