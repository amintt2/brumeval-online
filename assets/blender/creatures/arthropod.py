"""Shared arthropod machinery (spider, scorpion): radial legs on a skin skeleton, 3-bone legs
(femur / tibia / tarsus) solved with 2-bone IK + planted tarsus, alternating-tetrapod gait, chitin plate
coordinate ('seg' attribute) from the skeleton edges, and the common clips Idle / Walk / Run / Hit / Death.
"""
import math

import numpy as np
from mathutils import Quaternion, Vector

import body as B
import rigkit as R
from rigkit import Track, ease_in, ease_out, smooth


def leg_points(attach, side, angle_deg, reach, knee_h, ankle_h, coxa=0.14, knee_r=0.5, ankle_r=0.95, tip_z=0.0,
               z0=None):
    """Joint positions of one radial leg. angle: 0 = straight out (+-X), negative = towards the front (-Y).
    Returns dict coxa, knee, ankle, tip (armature space)."""
    a = math.radians(angle_deg)
    d = Vector((side * math.cos(a), math.sin(a), 0.0))
    at = Vector(attach)
    base = Vector((side * coxa, at.y + d.y * coxa * 0.5, (z0 if z0 is not None else at.z) - 0.02))
    return {
        "coxa": base,
        "knee": base + d * (reach * knee_r) + Vector((0, 0, knee_h - base.z)),
        "ankle": base + d * (reach * ankle_r) + Vector((0, 0, ankle_h - base.z)),
        "tip": base + d * reach + Vector((0, 0, tip_z - base.z)),
    }


def seg_attribute(ob, skel, plated, default=0.5):
    """'seg' = parameter (0..1) along the nearest skeleton edge for edges flagged in `plated` (set of edge
    indices), `default` elsewhere. Joint grooves / bands are drawn where seg is near 0 or 1."""
    co = B.co_array(ob)
    pts = np.asarray(skel.pts, float)
    best = np.full(len(co), 1e9)
    seg = np.full(len(co), default)
    for ei, (a, b) in enumerate(skel.edges):
        d, t = B.seg_dist(co, pts[a], pts[b])
        # normalise by the local radius so thin legs win near their own surface
        ra = np.mean(skel.rad[a]) * (1 - t) + np.mean(skel.rad[b]) * t
        dn = d / np.maximum(ra, 0.01)
        m = dn < best
        best[m] = dn[m]
        seg[m] = t[m] if ei in plated else default
    B.set_attr(ob, "seg", seg)
    return seg


class LegSet:
    """IK for N legs: legs = {key: (upper, lower, foot, pole)}; offsets {key: (dx, dy, dz)} relative to the rest
    ankle; the foot (tarsus) keeps its rest orientation in armature space (optional pitch)."""

    def __init__(self, anim, arm, legs):
        self.A = anim
        self.legs = legs
        self.ankle = {k: arm.data.bones[v[1]].tail_local.copy() for k, v in legs.items()}
        self.dirs = {}
        self.foot_dir = {}
        for k, v in legs.items():
            b = arm.data.bones[v[0]]
            d = b.tail_local - b.head_local
            d.z = 0
            self.dirs[k] = d.normalized()
            f = arm.data.bones[v[2]]
            self.foot_dir[k] = (f.tail_local - f.head_local).normalized()

    def flat_foot(self, k, w, up_deg=12.0):
        """Euler (deg, armature space) turning the tarsus from its rest direction (down to the ground) to lying
        flat, pointing outwards and slightly up (dead / sprawled pose); w = blend 0..1."""
        d = self.dirs[k]
        a = math.radians(up_deg)
        target = Vector((d.x * math.cos(a), d.y * math.cos(a), math.sin(a))).normalized()
        q = self.foot_dir[k].rotation_difference(target)
        q = Quaternion().slerp(q, w)
        return tuple(math.degrees(x) for x in q.to_euler("XYZ"))

    def __call__(self, pose, offs=None, skip=()):
        offs = offs or {}
        for k, (up, lo, ft, pole) in self.legs.items():
            if k in skip:
                continue
            o = offs.get(k, (0.0, 0.0, 0.0))
            fr = o[3] if len(o) > 3 else 0.0
            frot = o[4] if len(o) > 4 and o[4] is not None else (fr, 0, 0)   # full armature-space euler (deg)
            self.A.solve_leg(pose, up, lo, self.ankle[k] + Vector(o[:3]), pole, foot=ft, foot_rot=frot)
        return pose


def step(p, stride, lift, duty=0.55):
    """Foot offset (dy, dz) for gait phase p: stance slides back along +Y, swing lifts and returns."""
    p %= 1.0
    if p < duty:
        u = p / duty
        return R.lerp(-stride, stride, u), 0.0
    u = (p - duty) / (1 - duty)
    return R.lerp(stride, -stride, smooth(u)), lift * math.sin(math.pi * u)


def common_clips(A, legs, spec):
    """Idle / Walk / Run / Hit / Death. spec: body bones + gait + species hooks."""
    keys = list(legs.legs.keys())
    phase = spec["phases"]            # {leg_key: phase offset}
    ceph = spec.get("ceph", "ceph")
    abd = spec.get("abdomen")
    extra_idle = spec.get("idle_extra", lambda pose, t: None)
    extra_move = spec.get("move_extra", lambda pose, t, k: None)

    def idle(t):
        b = R.wave(t, 2)
        pose = {"body": {"t": (0, 0, 0.006 * b), "r": (1.0 * R.wave(t, 1), 0, 1.5 * R.wave(t, 1, 0.2))}}
        if abd:
            pose[abd] = {"r": (2 * R.wave(t, 2, 0.1), 0, 1.5 * R.wave(t, 1, 0.3)), "s": (1 + 0.015 * b, 1, 1 + 0.02 * b)}
        extra_idle(pose, t)
        offs = {}
        # one leg shifts its grip once per loop (life)
        tapk = spec.get("idle_tap", keys[0])
        tp = Track([(0, 0), (0.45, 0), (0.55, 1), (0.65, 0), (1, 0)])(t)
        offs[tapk] = (0, -0.03 * tp, 0.05 * tp)
        return legs(pose, offs)
    A.clip("Idle", 48, idle)

    W = spec["walk"]

    def walk(t):
        pose = {"body": {"t": (0, 0, W["bob"] * R.wavec(t, 2) - W.get("drop", 0.0)),
                         "r": (0, 1.5 * R.wave(t, 1), 2 * R.wave(t, 1, 0.25))}}
        if abd:
            pose[abd] = {"r": (2 * R.wave(t, 2, 0.2), 0, -3 * R.wave(t, 1, 0.1))}
        extra_move(pose, t, 1.0)
        offs = {}
        for k in keys:
            dy, dz = step(t + phase[k], W["stride"], W["lift"], W.get("duty", 0.55))
            offs[k] = (0, dy, dz)
        return legs(pose, offs)
    A.clip("Walk", W["frames"], walk)

    G = spec["run"]

    def run(t):
        pose = {"body": {"t": (0, 0, G["bob"] * R.wavec(t, 2) - G.get("drop", 0.03)),
                         "r": (-3 + 2 * R.wavec(t, 2), 2.5 * R.wave(t, 1), 3 * R.wave(t, 1, 0.25))}}
        if abd:
            pose[abd] = {"r": (4 * R.wave(t, 2, 0.2), 0, -4 * R.wave(t, 1, 0.1))}
        extra_move(pose, t, 2.0)
        offs = {}
        for k in keys:
            dy, dz = step(t + phase[k], G["stride"], G["lift"], G.get("duty", 0.5))
            offs[k] = (0, dy, dz)
        return legs(pose, offs)
    A.clip("Run", G["frames"], run)

    hk = Track([(0, 0), (0.28, 1, ease_out), (0.55, 0.7), (1, 0)])

    def hit(t):
        k = hk(t)
        pose = {"body": {"t": (0.02 * k, 0.07 * k, 0.04 * k), "r": (-10 * k, 0, 5 * k)}}
        if abd:
            pose[abd] = {"r": (-6 * k, 0, -4 * k)}
        spec.get("hit_extra", lambda p, k: None)(pose, k)
        return legs(pose, {kk: (0, 0.02 * k, 0.03 * k * (i % 2)) for i, kk in enumerate(keys)})
    A.clip("Hit", 9, hit)

    # Death 1.25 s: a last convulsion (legs scrabble), the legs give way and splay out flat, the body drops onto
    # its belly, tarsi end flat on the ground with the tips slightly curled up
    D = spec["death"]
    drop = Track([(0, 0), (0.15, 0.03), (0.45, -D["drop"] * 0.45, ease_in), (0.62, -D["drop"], ease_in),
                  (0.7, -D["drop"] + 0.025), (0.78, -D["drop"]), (1, -D["drop"])])
    splay = Track([(0, 0), (0.3, 0.1), (0.62, 1.0, ease_in), (0.72, 0.94), (0.82, 1.0), (1, 1.0)])
    tw = Track([(0, 0), (0.12, 1), (0.25, -0.6), (0.4, 0.3), (0.55, 0), (1, 0)])
    twitch = Track([(0, 0), (0.8, 0), (0.86, 1), (0.92, 0), (1, 0)])

    def death(t):
        c = splay(t)
        pose = {"body": {"t": (0, 0.0, drop(t)), "r": (4 * tw(t) + D.get("pitch", 4) * c, 0, 8 * tw(t) + D.get("roll", 3) * c)}}
        if abd:
            pose[abd] = {"r": (-6 * c, 0, 5 * c)}
        spec.get("death_extra", lambda p, t, c: None)(pose, t, c)
        offs = {}
        for i, k in enumerate(keys):
            d = legs.dirs[k]
            a0 = legs.ankle[k]
            out = D.get("splay", 0.12) + 0.03 * math.sin(i * 1.7)
            tgt_z = D.get("ankle_z", 0.05)
            sc = 0.06 * tw(t) * (1 if i % 2 else -1)                         # scrabbling legs
            lift = 0.05 * twitch(t) * (i % 3 == 0)                           # a final twitch of two legs
            offs[k] = (d.x * (out * c) + d.y * sc, d.y * (out * c) - d.x * sc, (tgt_z - a0.z) * c + lift, 0.0,
                       legs.flat_foot(k, smooth((t - 0.3) / 0.45), D.get("tip_up", 14)))
        return legs(pose, offs)
    A.clip("Death", 30, death)
