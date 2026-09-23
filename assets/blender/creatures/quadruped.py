"""Shared quadruped machinery (wolf, ice_wolf, boar): skin-skeleton body, armature, heat weights with region
overrides (jaw / head), fur flow + tone attributes, GN fur cards, IK leg gaits and the clip set
Idle, Walk, Attack, Attack2, Run, Hit, Death (24 fps, in place).

A species module provides a SPEC dict (see wolf.py) with its skeleton nodes, bones, accessories and attacks.
"""
import math

import bpy
import numpy as np
from mathutils import Vector

import body as B
from kit import gn
import rigkit as R
from rigkit import Track, ease_in, ease_out, smooth

LEG_KEYS = ("fl", "fr", "bl", "br")


def leg_bones(k):
    side = ".L" if k[1] == "l" else ".R"
    pre = "front" if k[0] == "f" else "back"
    return (f"{pre}_upper{side}", f"{pre}_lower{side}", f"{pre}_paw{side}")


# =============================================================================== armature
def make_armature(bones):
    arm = R.build_armature(bones)
    for n in ("root", "body"):
        if n in arm.data.bones:
            arm.data.bones[n].use_deform = False
    return arm


# =============================================================================== gait helpers
class Legs:
    """IK for the four legs. offsets per leg: (dx, dy, dz, paw_pitch_deg) relative to the rest ankle
    (tail of the lower bone), in armature space. Poles: front knees (elbows) bend back (+Y), hocks forward."""

    def __init__(self, anim, arm, poles=None):
        self.A = anim
        self.ankle = {k: arm.data.bones[leg_bones(k)[1]].tail_local.copy() for k in LEG_KEYS}
        self.poles = poles or {"fl": (0, 1, 0), "fr": (0, 1, 0), "bl": (0, -1, 0), "br": (0, -1, 0)}

    def __call__(self, pose, offs=None, skip=()):
        offs = offs or {}
        for k in LEG_KEYS:
            if k in skip:
                continue
            up, lo, paw = leg_bones(k)
            o = offs.get(k, (0.0, 0.0, 0.0, 0.0))
            dx, dy, dz, pr = o if len(o) == 4 else (0.0, *o)
            self.A.solve_leg(pose, up, lo, self.ankle[k] + Vector((dx, dy, dz)), self.poles[k], foot=paw,
                             foot_rot=(pr, 0, 0))
        return pose


def foot_cycle(p, stride, lift, duty=0.5, curl=60.0, push=18.0, toe_len=0.08):
    """Foot trajectory for gait phase p in [0,1): stance (on the ground, sliding back = +Y) for `duty` of the
    cycle, then swing (lift, forward). Returns (dy, dz, paw_pitch). The ankle is raised when the paw pitches so
    the toes never dip below the ground."""
    p %= 1.0
    if p < duty:
        u = p / duty
        dy = R.lerp(-stride, stride, u)
        dz = 0.0
        pr = push * smooth((u - 0.7) / 0.3)
    else:
        u = (p - duty) / (1 - duty)
        dy = R.lerp(stride, -stride, smooth(u))
        dz = lift * math.sin(math.pi * min(1.0, u * 1.08)) ** 0.9
        pr = push * (1 - smooth(u / 0.25)) + curl * math.sin(math.pi * u) ** 1.5
    dz += toe_len * math.sin(math.radians(max(0.0, min(pr, 90.0))))
    return dy, dz, pr


# =============================================================================== body build
def build_body(spec):
    """Skin skeleton -> continuous body, sculpt, attributes. Returns the body object (not yet skinned)."""
    sk = B.Skel()
    spec["skeleton"](sk)
    body = sk.mesh("Body", subsurf=spec.get("subsurf", 2), branch_smooth=spec.get("branch_smooth", 0.0))
    if spec.get("sculpt"):
        spec["sculpt"](body)
    if spec.get("decimate"):
        gn.decimate(body, spec["decimate"])
        gn.apply(body)
        for p in body.data.polygons:
            p.use_smooth = True
    return body


def blobs(co, nr, items):
    """Sum of gaussian bumps along the normal: items = [(centre, radius, amount[, mirror_x])]."""
    off = np.zeros_like(co)
    for it in items:
        c, r, a = np.asarray(it[0], float), it[1], it[2]
        cs = [c] + ([c * np.array([-1, 1, 1])] if (len(it) < 4 or it[3]) and abs(c[0]) > 1e-6 else [])
        for cc in cs:
            d2 = np.sum((co - cc) ** 2, axis=1) / (r * r)
            off += nr * (a * np.exp(-d2))[:, None]
    return off


def smoothstep(x, a, b):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


# =============================================================================== clips
def standard_clips(arm, spec):
    """Idle, Walk, Run, Hit, Death for any quadruped (+ the species' Attack / Attack2)."""
    A = R.Animator(arm)
    legs = Legs(A, arm)
    g = spec["gait"]
    tails = [b for b in ("tail_1", "tail_2", "tail_3", "tail_4") if b in arm.data.bones]
    ears = [b for b in ("ear.L", "ear.R") if b in arm.data.bones]

    def tail_pose(pose, base=(0, 0, 0), sway=0.0, t=0.0, cycles=1.0, lag=0.12, droop=0.0):
        for i, b in enumerate(tails):
            k = 1.0 + 0.35 * i
            pose[b] = {"r": (base[0] + droop * i, base[1], base[2] + sway * k * R.wave(t, cycles, -lag * i))}
        return pose

    # ------------------------------------------------------------ Idle 2 s: breathing, look around, ear flick, tail
    earflick = Track([(0, 0), (0.55, 0), (0.6, 1, ease_out), (0.66, 0), (0.7, 0.8), (0.78, 0), (1, 0)])

    def idle(t):
        b = R.wave(t, 2)
        look = 10 * math.sin(2 * math.pi * t) * (0.5 + 0.5 * math.sin(2 * math.pi * t - 0.6))
        pose = {
            "body": {"t": (0, 0, -0.004 + 0.004 * b)},
            "spine": {"r": (0.8 * b, 0, 0)},
            "chest": {"r": (-1.0 * b, 0, 0), "s": (1 + 0.012 * b, 1, 1 + 0.02 * b)},
            "neck": {"r": (2.0 * R.wave(t, 1, 0.25), 0, look * 0.4)},
            "head": {"r": (2.5 * R.wave(t, 2, 0.1), 0, look * 0.6)},
            "jaw": {"r": (spec.get("idle_jaw", 4) + spec.get("idle_jaw", 4) * 0.5 * R.wave(t, 4), 0, 0)},
        }
        for i, e in enumerate(ears):
            pose[e] = {"r": (-25 * earflick(t) if i == 0 else 0, 0, 0)}
        tail_pose(pose, spec.get("tail_rest", (0, 0, 0)), 5.0, t)
        return legs(pose)

    A.clip("Idle", 48, idle)

    # ------------------------------------------------------------ Walk: lateral-sequence walk / trot
    W = g["walk"]
    ph = W["phases"]

    def walk(t):
        pose = {
            "body": {"t": (0, 0, W["bob"] * R.wavec(t, 2) - W.get("drop", 0.01))},
            "hips": {"r": (1.5 * R.wavec(t, 2, 0.1), 3.0 * R.wave(t, 1), 2.0 * R.wave(t, 1))},
            "spine": {"r": (0, 0, 2.0 * R.wave(t, 1))},
            "chest": {"r": (-1.5 * R.wavec(t, 2), -3.0 * R.wave(t, 1), -2.5 * R.wave(t, 1))},
            "neck": {"r": (W.get("neck", -4) + 2.5 * R.wavec(t, 2, 0.15), 0, 0)},
            "head": {"r": (W.get("head", 4) - 2.5 * R.wavec(t, 2, 0.15), 0, -2 * R.wave(t, 1))},
            "jaw": {"r": (spec.get("walk_jaw", 3), 0, 0)},
        }
        tail_pose(pose, spec.get("tail_walk", (0, 0, 0)), 7.0, t)
        offs = {}
        for k in LEG_KEYS:
            dy, dz, pr = foot_cycle(t + ph[k], W["stride"][k[0]], W["lift"][k[0]], W.get("duty", 0.6),
                                    curl=W["curl"][k[0]], toe_len=spec["toe_len"])
            offs[k] = (0.0, dy, dz, pr)
        return legs(pose, offs)

    A.clip("Walk", W["frames"], walk)

    # ------------------------------------------------------------ Run: rotary gallop (spine flex, suspension)
    G = g["run"]
    gph = G["phases"]

    def run(t):
        flex = R.wave(t, 1, 0.0)            # + gathered (spine flexed) / - extended
        pose = {
            "body": {"t": (0, G.get("surge", 0.03) * R.wave(t, 1, 0.25), G["bob"] * R.wave(t, 1, 0.1) - G.get("drop", 0.03)),
                     "r": (G["pitch"] * R.wave(t, 1, 0.3), 0, 0)},
            "hips": {"r": (-G["flex"] * flex, 0, 0)},
            "spine": {"r": (G["flex"] * 0.5 * flex, 0, 0)},
            "chest": {"r": (G["flex"] * 0.5 * flex, 0, 0)},
            "neck": {"r": (G.get("neck", -12) - 6 * R.wave(t, 1, 0.45), 0, 0)},
            "head": {"r": (G.get("head", 8) + 5 * R.wave(t, 1, 0.45), 0, 0)},
            "jaw": {"r": (spec.get("run_jaw", 14) + 5 * R.wave(t, 1, 0.2), 0, 0)},
        }
        for e in ears:
            pose[e] = {"r": (-35, 0, 0)}
        tail_pose(pose, spec.get("tail_run", (-15, 0, 0)), 4.0, t, 1, 0.1, droop=G.get("tail_droop", 0))
        for i, b in enumerate(tails):
            pose[b]["r"] = (pose[b]["r"][0] + 10 * R.wave(t, 1, 0.3 - 0.1 * i), pose[b]["r"][1], pose[b]["r"][2])
        offs = {}
        for k in LEG_KEYS:
            dy, dz, pr = foot_cycle(t + gph[k], G["stride"][k[0]], G["lift"][k[0]], G.get("duty", 0.38),
                                    curl=G["curl"][k[0]], push=30, toe_len=spec["toe_len"])
            offs[k] = (0.0, dy, dz, pr)
        return legs(pose, offs)

    A.clip("Run", G["frames"], run)

    # ------------------------------------------------------------ Hit 0.375 s: flinch away
    hk = Track([(0, 0), (0.28, 1, ease_out), (0.55, 0.75), (1, 0)])

    def hit(t):
        k = hk(t)
        pose = {
            "body": {"t": (0.02 * k, 0.06 * k, -0.02 * k), "r": (-3 * k, 0, 4 * k)},
            "spine": {"r": (3 * k, 0, 5 * k)},
            "chest": {"r": (-6 * k, 0, 3 * k)},
            "neck": {"r": (-14 * k, 0, 6 * k)},
            "head": {"r": (-12 * k, 0, -10 * k)},
            "jaw": {"r": (spec.get("hit_jaw", 24) * k, 0, 0)},
        }
        for e in ears:
            pose[e] = {"r": (-40 * k, 0, 0)}
        tail_pose(pose, (18 * k, 0, 0))
        return legs(pose, {"fl": (0, 0.02 * k, 0.03 * k * (1 - k) * 4, 0)})

    A.clip("Hit", 9, hit)

    # ------------------------------------------------------------ Death 1.25 s: stagger, legs buckle, fall on side
    D = spec["death"]
    roll = Track([(0, 0), (0.16, -5), (0.3, 5), (0.62, 88, ease_in), (0.72, 80, ease_out), (0.84, 86), (1, 85)])
    sink = Track([(0, 0), (0.2, -0.03), (0.4, -0.12), (0.62, -0.02), (1, 0.0)])
    k1 = Track([(0, 0), (0.15, 1), (0.4, 0.4), (1, 0)])
    kl = Track([(0, 0), (0.25, 0.3), (0.6, 1), (1, 1)])
    kh = Track([(0, 0), (0.6, 0.2), (0.76, 1, ease_out), (0.86, 0.8), (1, 0.9)])

    hz = arm.data.bones["body"].head_local.z
    S_ = D.get("scale", 1.0)
    slide = Track([(0, 0), (0.3, 0.0), (0.7, D["slide"]), (1, D["slide"])])
    collapse = Track([(0, 0), (0.18, 0.05), (0.42, 0.35), (0.66, 1.0, ease_in), (1, 1)])

    def death(t):
        th = roll(t)
        a = math.radians(max(0.0, th))
        support = D["half_h"] * math.cos(a) + D["half_w"] * math.sin(a) + D.get("lift", 0.0)
        tz = R.lerp(sink(t) * 0.5, support - hz, collapse(t))
        tx = slide(t)
        l, y, h = kl(t), k1(t), kh(t)
        pose = {
            "body": {"t": (tx, 0.0, tz), "r": (0, th, 0)},
            "spine": {"r": (0, 0, 5 * l)},
            "chest": {"r": (-6 * y, 0, 0)},
            "neck": {"r": (-20 * y + 16 * h, 0, -14 * h)},
            "head": {"r": (-10 * y + 10 * h, 0, -8 * h)},
            "jaw": {"r": (22 * y + 14 * l, 0, 0)},
        }
        for e in ears:
            pose[e] = {"r": (-30 * l, 0, 0)}
        tail_pose(pose, (10 * l, 0, 16 * l))
        for sfx, s in ((".L", 1), (".R", -1)):
            e = 0.85 if s > 0 else 1.0
            droop = 0.0 if s > 0 else -18 * l
            pose["front_upper" + sfx] = {"r": (-20 * l * e, droop, 0)}
            pose["front_lower" + sfx] = {"r": (28 * l * e, 0, 0)}
            pose["front_paw" + sfx] = {"r": (25 * l, 0, 0)}
            pose["back_upper" + sfx] = {"r": (20 * l / e, droop * 0.8, 0)}
            pose["back_lower" + sfx] = {"r": (-14 * l, 0, 0)}
            pose["back_paw" + sfx] = {"r": (28 * l, 0, 0)}
        if t < 0.85:
            c = collapse(t)
            ik = legs({k: dict(v) for k, v in pose.items() if k in ("root", "body", "hips", "spine", "chest")},
                      {"fl": (0.22 * S_ * c, -0.05 * c, 0.03 * c, 20 * c), "bl": (0.22 * S_ * c, 0.05 * c, 0.03 * c, 20 * c),
                       "fr": (0.14 * S_ * c, -0.04 * c, 0.3 * S_ * c, 30 * c), "br": (0.14 * S_ * c, 0.04 * c, 0.3 * S_ * c, 30 * c)})
            for k in LEG_KEYS:
                w = 1 - smooth((t - 0.52) / 0.24) if k[1] == "r" else 1 - smooth((t - 0.62) / 0.22)
                if w <= 0:
                    continue
                for bone in leg_bones(k):
                    pose[bone] = {"q": R.blend_delta(pose[bone], ik[bone], w)}
        return pose

    A.clip("Death", 30, death)
    spec["attacks"](A, legs, arm, tail_pose)
    A.rest_pose()
    return A
