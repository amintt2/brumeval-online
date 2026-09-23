"""Biped clip generators for the giants (Idle, Walk, Run, Hit, Death + helpers for attacks).

Poses use gk.Rigger conventions (rotations in degrees about the ARMATURE axes, applied in parent space):
    spine/chest/neck/head  +X = bend forward / nod down, +Z = turn to the model's left (+X side), +Y = lean left
    hanging arms/legs      -X = swing forward, upper_arm.L -Y = raise sideways (R: +Y)
    forearm                -X = bend the elbow (hand comes forward/up)
    jaw                    +X = open
    ik_foot.<s>            loc = foot offset (m), rot +X = toes down
    hips                   {"rot": .., "loc": ..}
Every pose passed to Rigger.key() is merged with the creature's base stance.
"""
import math

import gk


def mirror(p):
    out = {}
    for k, v in p.items():
        k2 = k.replace(".L", ".TMP").replace(".R", ".L").replace(".TMP", ".R")
        if isinstance(v, dict):
            r = v.get("rot", (0, 0, 0))
            l = v.get("loc", (0, 0, 0))
            out[k2] = {"rot": (r[0], -r[1], -r[2]), "loc": (-l[0], l[1], l[2])}
        else:
            out[k2] = (v[0], -v[1], -v[2])
    return out


def _get(v):
    if isinstance(v, dict):
        return tuple(v.get("rot", (0, 0, 0))), tuple(v.get("loc", (0, 0, 0)))
    return tuple(v), (0.0, 0.0, 0.0)


def add(*poses):
    """Sum poses bone-wise (rotations add per axis - fine for the moderate angles we use)."""
    out = {}
    for p in poses:
        for k, v in p.items():
            r, l = _get(v)
            if k in out:
                r0, l0 = _get(out[k])
                r = tuple(a + b for a, b in zip(r0, r))
                l = tuple(a + b for a, b in zip(l0, l))
            out[k] = {"rot": r, "loc": l}
    return out


def scale(p, f):
    out = {}
    for k, v in p.items():
        r, l = _get(v)
        out[k] = {"rot": tuple(a * f for a in r), "loc": tuple(a * f for a in l)}
    return out


def lerp(a, b, t):
    return add(scale(a, 1 - t), scale(b, t))


class Biped:
    """cfg keys (all optional):
        stance   base pose dict merged into every key (relaxed arms, slight crouch...)
        stride, lift, walk_frames, bob, sway, arm_swing, lean
        run_stride, run_lift, run_frames, run_lean, run_bob
        hip_h    hips height (m, rest) — used to keep Death on the ground
        heavy    0..1 extra weight (slower settle, bigger dips)
    """

    def __init__(self, R, cfg):
        self.R = R
        self.c = dict(stride=0.8, lift=0.2, walk_frames=28, bob=0.04, sway=0.04, arm_swing=18.0, lean=4.0,
                      run_stride=1.4, run_lift=0.35, run_frames=18, run_lean=14.0, run_bob=0.08, heavy=0.5,
                      stance={}, jaw=False, neck=True)
        self.c.update(cfg)
        self.stance = self.c["stance"]

    def P(self, *poses):
        return add(self.stance, *poses)

    def key(self, name, keys, cyclic=False):
        return self.R.key(name, [(f, self.P(p)) if f != "loop" else (f, p) for f, p in keys], cyclic=cyclic)

    # ------------------------------------------------------------------ locomotion
    def gait(self, name, frames, stride, lift, duty, bob, sway, swing, lean, elbow, step=2, run=False):
        keys = []
        for f in range(0, frames + 1, step):
            ph = f / frames
            p = {}
            for side, off in (("L", 0.0), ("R", 0.5)):
                dy, dz, pitch = gk.foot_cycle(ph + off, stride, lift, duty)
                p[f"ik_foot.{side}"] = {"rot": (pitch, 0, 0), "loc": (0, dy, dz)}
            # pelvis: lowest right after each contact, sways over the stance foot
            dip = 0.5 + 0.5 * math.cos(4 * math.pi * (ph - (0.08 if not run else 0.2)))
            hz = -bob * dip - (0.03 if not run else 0.12) * (1 + self.c["heavy"])
            hx = sway * math.sin(2 * math.pi * (ph - 0.05))
            yaw = 5.0 * math.cos(2 * math.pi * ph)
            p["hips"] = {"rot": (lean * 0.3, -3.0 * math.sin(2 * math.pi * ph), yaw), "loc": (hx, 0, hz)}
            p["spine"] = (lean * 0.4 + 1.5 * dip, 1.5 * math.sin(2 * math.pi * ph), -yaw * 0.6)
            p["chest"] = (lean * 0.3, 2.0 * math.sin(2 * math.pi * ph), -yaw * 0.9)
            if self.c["neck"]:
                p["neck"] = (-lean * 0.4 - 1.5 * dip, 0, yaw * 0.4)
            p["head"] = (-lean * 0.3 - 1.0 * dip, 0, yaw * 0.3)
            sw = math.cos(2 * math.pi * ph)
            p["upper_arm.L"] = (swing * sw * self.c.get("swing_L", 1.0), 0, 0)
            p["upper_arm.R"] = (-swing * sw * self.c.get("swing_R", 1.0), 0, 0)
            p["forearm.L"] = (-elbow - 0.4 * elbow * max(0.0, -sw), 0, 0)
            p["forearm.R"] = (-elbow - 0.4 * elbow * max(0.0, sw), 0, 0)
            p["hand.L"] = (-5 * sw, 0, 0)
            p["hand.R"] = (5 * sw, 0, 0)
            keys.append((f, p))
        return self.key(name, keys, cyclic=True)

    def walk(self, name="Walk", extra=None):
        c = self.c
        return self.gait(name, c["walk_frames"], c["stride"], c["lift"], 0.6, c["bob"], c["sway"], c["arm_swing"],
                         c["lean"], 12.0)

    def run(self, name="Run"):
        c = self.c
        return self.gait(name, c["run_frames"], c["run_stride"], c["run_lift"], 0.42, c["run_bob"], c["sway"] * 0.6,
                         c["arm_swing"] * 1.8, c["run_lean"], 45.0, run=True)

    def idle(self, name="Idle", frames=60, extra=None):
        keys = []
        for f in range(0, frames + 1, 5):
            ph = f / frames
            b = math.sin(2 * math.pi * ph)            # breath
            b2 = math.sin(4 * math.pi * ph + 0.7)
            p = {
                "hips": {"rot": (0, 0.8 * math.sin(2 * math.pi * ph + 1.0), 0), "loc": (0.012 * math.sin(2 * math.pi * ph + 1.0), 0, -0.012 * (1 + b))},
                "spine": (1.2 * b, 0, 0),
                "chest": (-2.0 * b, 0, 1.0 * b2),
                "head": (1.5 * b, 0, 4.0 * math.sin(2 * math.pi * ph + 2.0)),
                "upper_arm.L": (1.5 * b, -1.5 * b, 0),
                "upper_arm.R": (1.5 * b, 1.5 * b, 0),
                "forearm.L": (-2.0 * b, 0, 0),
                "forearm.R": (-2.0 * b, 0, 0),
            }
            if self.c["neck"]:
                p["neck"] = (-1.0 * b, 0, 2.0 * math.sin(2 * math.pi * ph + 2.0))
            if self.c["jaw"]:
                p["jaw"] = (2.5 + 2.5 * b, 0, 0)
            if extra:
                p = add(p, extra(ph))
            keys.append((f, p))
        return self.key(name, keys, cyclic=True)

    def hit(self, name="Hit", frames=12, side=1):
        s = side
        recoil = {"hips": {"rot": (-4, 0, 0), "loc": (0, 0.08, -0.04)}, "spine": (-10, 3 * s, 4 * s), "chest": (-10, 4 * s, 6 * s),
                  "head": (-16, 0, -8 * s), "upper_arm.L": (12, -18, 0), "upper_arm.R": (12, 18, 0),
                  "forearm.L": (-25, 0, 0), "forearm.R": (-25, 0, 0)}
        if self.c["neck"]:
            recoil["neck"] = (-8, 0, -4 * s)
        if self.c["jaw"]:
            recoil["jaw"] = (18, 0, 0)
        over = scale(recoil, -0.25)
        return self.key(name, [(0, {}), (3, recoil), (7, over), (frames, {})])

    def death(self, name="Death", frames=52, fall_x=84.0, lift=0.45, dy=0.0, knee_drop=0.45):
        """Stagger back, knees buckle (feet planted), topple forward onto the belly and settle.
        fall_x: root pitch at the end (+ = forward), lift/dy: root offset so the lying body rests on z=0."""
        jaw = {"jaw": (22, 0, 0)} if self.c["jaw"] else {}
        k0 = {}
        k1 = add({"hips": {"rot": (-8, 0, 0), "loc": (0, 0.1, -0.05)}, "spine": (-12, 0, 0), "chest": (-12, 0, 0),
                  "head": (-25, 0, 0), "upper_arm.L": (15, -25, 0), "upper_arm.R": (15, 25, 0),
                  "forearm.L": (-30, 0, 0), "forearm.R": (-30, 0, 0)}, jaw)
        k2 = add({"hips": {"rot": (10, 4, 0), "loc": (0, -0.05, -knee_drop)}, "spine": (18, 0, 0), "chest": (15, 4, 0),
                  "head": (15, 0, 0), "upper_arm.L": (-10, -10, 0), "upper_arm.R": (-5, 10, 0),
                  "forearm.L": (-15, 0, 0), "forearm.R": (-15, 0, 0),
                  "ik_foot.L": {"rot": (35, 0, 0), "loc": (0, 0.1, 0)}, "ik_foot.R": {"rot": (35, 0, 0), "loc": (0, 0.12, 0)}}, jaw)
        fall = {"root": {"rot": (fall_x * 0.55, 0, 0), "loc": (0, dy * 0.5, lift * 0.4)},
                "hips": {"rot": (15, 6, 0), "loc": (0, -0.05, -knee_drop * 0.8)}, "spine": (12, 0, 0), "chest": (10, 0, 0),
                "head": (-10, 0, 0), "upper_arm.L": (-60, -15, 0), "upper_arm.R": (-60, 15, 0),
                "forearm.L": (-20, 0, 0), "forearm.R": (-20, 0, 0),
                "ik_foot.L": {"rot": (60, 0, 0), "loc": (0, 0.1, 0.05)}, "ik_foot.R": {"rot": (60, 0, 0), "loc": (0, 0.12, 0.05)}}
        land = {"root": {"rot": (fall_x + 4, 0, 0), "loc": (0, dy, lift - 0.03)},
                "hips": {"rot": (-6, 8, 0), "loc": (0, 0, 0)}, "spine": (-4, 0, 0), "chest": (-6, 5, 0),
                "head": (-30, 0, 20), "upper_arm.L": (-85, -35, 0), "upper_arm.R": (-80, 35, 0),
                "forearm.L": (-10, 0, 0), "forearm.R": (-10, 0, 0),
                "ik_foot.L": {"rot": (70, 0, 0), "loc": (0, 0.05, 0.1)}, "ik_foot.R": {"rot": (70, 0, 0), "loc": (0.05, 0.08, 0.1)}}
        settle = add(land, {"root": {"rot": (-4, 0, 0), "loc": (0, 0, 0.03)}, "head": (4, 0, -5), "chest": (3, 0, 0)})
        return self.key(name, [(0, k0), (5, k1), (14, k2), (24, fall), (31, land), (38, settle),
                               (frames, add(settle, jaw))])
