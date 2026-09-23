"""Shared clips for the v0.2 humanoids (on top of humanoid.Poser): Roll (0.55 s forward dodge roll in place),
Run (fast loop), heavy telegraphed Attack2, weighty hit / death helpers.

Poser convention (character space): rx > 0 bends the torso forward / swings a hanging limb BACKWARD,
ry > 0 tilts towards the character's left, rz > 0 turns left. 'IK' chains: leg.L/R, arm.L/R.
"""
import math

from mathutils import Euler, Quaternion, Vector

import humanoid as H
from humanoid import arm_r, over, plus


def pivot_root(pitch, pivot, yaw=0.0, roll=0.0):
    """Root entry rotating the whole character by `pitch` (deg, forward) around `pivot` (world point)."""
    q = H.eq((pitch, roll, yaw))
    c = Vector(pivot)
    t = c - q @ c
    return {"r": (pitch, roll, yaw), "t": tuple(t)}


def grounded(P, body, spec, exclude=None, clearance=0.0):
    """Lift/lower the root so the lowest body vertex sits at z = clearance."""
    s = over(spec, {})
    r = s.get("root", {"r": (0, 0, 0)})
    t = Vector(r.get("t", (0, 0, 0)))
    s["root"] = {"r": r.get("r", (0, 0, 0)), "t": tuple(t)}
    z = P.min_z(body, s, exclude)
    t.z += clearance - z
    s["root"] = {"r": r.get("r", (0, 0, 0)), "t": tuple(t)}
    return s


def roll_keys(P, body, base, exclude=None, arms=None, hold=None):
    """0.55 s forward dodge roll, in place, ending standing (13 frames @ 24 fps).
    Anticipation crouch -> dive -> tucked ball (360 deg around a pivot at hip height) -> crouched landing -> stand.
    `arms`: optional arm overrides for the tuck (e.g. keep a shield in front); `hold`: extra bones kept for the whole roll."""
    hold = hold or {}
    legs_free = {"IK": {"leg.L": None, "leg.R": None}}
    tuck_legs = {"thigh.L": (-118, -6, 0), "shin.L": (128, 0, 0), "foot.L": (35, 0, 0),
                 "thigh.R": (-112, 6, 0), "shin.R": (124, 0, 0), "foot.R": (35, 0, 0)}
    tuck_arms = {"upper_arm.L": arm_r("L", 55, 18, 0), "forearm.L": (-105, 0, 0),
                 "upper_arm.R": arm_r("R", 55, 18, 0), "forearm.R": (-105, 0, 0)}
    if arms:
        tuck_arms.update(arms)
    tuck_spine = {"spine": (28, 0, 0), "chest": (26, 0, 0), "neck": (18, 0, 0), "head": (28, 0, 0)}
    # f2: anticipation crouch (feet planted by the base IK), arms reaching forward
    crouch = plus(base, {"hips": {"t": (0, 0.05, -0.24), "r": (22, 0, 0)}, "spine": (16, 0, 0), "chest": (12, 0, 0),
                         "head": (-16, 0, 0)})
    crouch = over(crouch, {"upper_arm.L": arm_r("L", 40, 14), "forearm.L": (-40, 0, 0),
                           "upper_arm.R": arm_r("R", 40, 14), "forearm.R": (-40, 0, 0)})
    # f4: dive: body pitched ~80 deg, legs pushing (extended back), arms forward to the ground
    dive = over(base, dict(legs_free, **{
        "hips": {"t": (0, 0, 0)}, **tuck_spine, "spine": (20, 0, 0), "chest": (18, 0, 0), "head": (20, 0, 0),
        "thigh.L": (-40, 0, 0), "shin.L": (40, 0, 0), "foot.L": (20, 0, 0),
        "thigh.R": (-10, 0, 0), "shin.R": (25, 0, 0), "foot.R": (30, 0, 0),
        "upper_arm.L": arm_r("L", 95, 20), "forearm.L": (-50, 0, 0),
        "upper_arm.R": arm_r("R", 95, 20), "forearm.R": (-50, 0, 0), **hold}))
    ball = over(base, dict(legs_free, **tuck_spine, **tuck_legs, **tuck_arms, **{"hips": {"t": (0, 0, 0)}}, **hold))
    land = over(base, dict(legs_free, **{"hips": {"t": (0, 0, 0)}, "spine": (22, 0, 0), "chest": (18, 0, 0), "neck": (5, 0, 0),
                                         "head": (-12, 0, 0),
                                         "thigh.L": (-95, -4, 0), "shin.L": (120, 0, 0), "foot.L": (-25, 0, 0),
                                         "thigh.R": (-88, 4, 0), "shin.R": (112, 0, 0), "foot.R": (-24, 0, 0),
                                         "upper_arm.L": arm_r("L", 30, 30), "forearm.L": (-50, 0, 0),
                                         "upper_arm.R": arm_r("R", 30, 30), "forearm.R": (-50, 0, 0), **hold}))
    rise = plus(base, {"hips": {"t": (0, 0.0, -0.1), "r": (8, 0, 0)}, "spine": (8, 0, 0), "chest": (4, 0, 0),
                       "head": (-6, 0, 0)})
    piv = (0.0, -0.05, 0.42)
    keys = [(0, base), (2, crouch, "out")]
    # one key per frame while rolling, each grounded (slerped rotations + lerped offsets would sink between keys)
    for f, ang, pose in ((4, 75, dive), (5, 120, ball), (6, 165, ball), (7, 210, ball), (8, 255, ball), (9, 300, ball),
                         (10, 345, land)):
        k = over(pose, {"root": pivot_root(ang, piv)})
        k = grounded(P, body, k, exclude, 0.02 if f == 4 else 0.0)
        keys.append((f, k, "in" if f == 4 else "lin"))
    keys += [(12, rise, "out"), (13, base, "smooth")]
    return keys


def hit_keys(base, strength=1.0, frames=8, side=1.0):
    """Weighty flinch: snap back on frame 2, absorb, recover with a small overshoot."""
    s = strength
    hit = plus(base, {
        "hips": {"t": (0, 0.045 * s, -0.03 * s), "r": (-5 * s, 0, 4 * s * side)},
        "spine": (-8 * s, 0, 3 * side), "chest": (-14 * s, 3 * s * side, 7 * s * side), "neck": (-5 * s, 0, 0),
        "head": (-16 * s, 5 * s * side, 10 * s * side),
        "upper_arm.L": arm_r("L", -14 * s, 14 * s), "upper_arm.R": arm_r("R", -14 * s, 14 * s),
        "forearm.L": (-16 * s, 0, 0), "forearm.R": (-16 * s, 0, 0),
    })
    absorb = plus(base, {"hips": {"t": (0, 0.02 * s, -0.04 * s)}, "spine": (4 * s, 0, 0), "chest": (5 * s, 0, 2 * side),
                         "head": (6 * s, 0, 3 * side)})
    return [(0, base), (2, hit, "out"), (5, absorb, "smooth"), (frames, base, "smooth")]


def run_gait(**kw):
    g = dict(frames=14, stride=1.15, lift=0.24, duty=0.33, drop=0.07, bob=0.045, lean=16.0, twist=12.0, sway=0.01,
             roll=3.0, arm_swing=55.0, elbow=85.0, elbow_swing=20.0, arm_out=10.0, width=0.9, toe_out=3.0, strike=10.0,
             toeoff=48.0, run=True, head_bob=2.5, arms={})
    g.update(kw)
    return H.gait(**g)
