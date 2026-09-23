"""Rigging / skinning / procedural-animation helpers for the `creatures` asset group (Blender 5.0).

Only used by assets/blender/creatures/*.py. Everything is deterministic.

Key ideas
---------
* Bones are declared in armature space (head, tail, parent). The armature object is named 'Rig'.
* Skinning lives in body.py (continuous skin-modifier body + heat weights, smoothed).
* Animation poses are authored as *armature-space* deltas per bone, relative to the rest pose:
      {'bone': {'r': (rx, ry, rz) degrees, 't': (x, y, z) metres, 's': (sx, sy, sz) or scalar}}
  Rotations use Blender XYZ euler order around the ARMATURE axes (X = right, Y = back, Z = up; creatures
  face -Y), applied about the bone head, composed hierarchically (a child rotates with its parent).
  They are converted to the bone-local quaternion / location / scale channels that Blender keys.
* Clips are sampled on every frame from a pose function f(frame) -> pose dict, from frame 0 to N inclusive,
  so looping clips can be made perfectly seamless (pose(N) == pose(0)).
"""
import math

import bpy
from mathutils import Euler, Matrix, Quaternion, Vector

FPS = 24


# --------------------------------------------------------------------------- math helpers
def clamp(x, a=0.0, b=1.0):
    return a if x < a else b if x > b else x


def smooth(x):
    x = clamp(x)
    return x * x * (3 - 2 * x)


def ease_out(x):
    x = clamp(x)
    return 1 - (1 - x) ** 3


def ease_in(x):
    x = clamp(x)
    return x ** 3


def lerp(a, b, t):
    if isinstance(a, (tuple, list)):
        return tuple(ai + (bi - ai) * t for ai, bi in zip(a, b))
    return a + (b - a) * t


def wave(t, cycles=1.0, phase=0.0):
    """sin() over a normalised loop time t in [0,1] -> seamless for integer `cycles`."""
    return math.sin(2 * math.pi * (t * cycles + phase))


def wavec(t, cycles=1.0, phase=0.0):
    return math.cos(2 * math.pi * (t * cycles + phase))


class Track:
    """Keyframed value over normalised time: Track([(0, v0), (0.3, v1), (1, v2)], ease=smooth).
    Values may be floats or tuples. Each key may carry its own easing: (t, v, ease_fn)."""

    def __init__(self, keys, ease=smooth):
        self.keys = [(k[0], k[1], k[2] if len(k) > 2 else ease) for k in keys]

    def __call__(self, t):
        ks = self.keys
        if t <= ks[0][0]:
            return ks[0][1]
        for (t0, v0, _), (t1, v1, e1) in zip(ks, ks[1:]):
            if t <= t1:
                u = (t - t0) / (t1 - t0) if t1 > t0 else 1.0
                return lerp(v0, v1, e1(u))
        return ks[-1][1]


def add(*vs):
    """Component-wise sum of 3-tuples (None entries ignored)."""
    out = [0.0, 0.0, 0.0]
    for v in vs:
        if v is None:
            continue
        for i in range(3):
            out[i] += v[i]
    return tuple(out)


# --------------------------------------------------------------------------- armature
def build_armature(bones, name="Rig"):
    """bones: list of (name, head, tail, parent_or_None[, roll_deg]). Returns the armature object."""
    arm = bpy.data.armatures.new(name)
    arm.display_type = "STICK"
    rig = bpy.data.objects.new(name, arm)
    bpy.context.scene.collection.objects.link(rig)
    for o in bpy.context.scene.objects:
        o.select_set(False)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    for b in bones:
        bname, head, tail, parent = b[:4]
        roll = b[4] if len(b) > 4 else 0.0
        eb = arm.edit_bones.new(bname)
        eb.head = Vector(head)
        eb.tail = Vector(tail)
        eb.roll = math.radians(roll)
        if parent:
            eb.parent = arm.edit_bones[parent]
            eb.use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in rig.pose.bones:
        pb.rotation_mode = "QUATERNION"
    return rig


def bone_segments(rig):
    """{name: (head, tail)} in armature space (rest pose)."""
    return {b.name: (b.head_local.copy(), b.tail_local.copy()) for b in rig.data.bones}


# --------------------------------------------------------------------------- animation
class Animator:
    """Converts armature-space pose deltas to bone-local channels and keys them."""

    def __init__(self, rig):
        self.rig = rig
        self.rest = {}
        for b in rig.data.bones:
            R = b.matrix_local.to_3x3().normalized()
            self.rest[b.name] = (R, R.inverted())
        self._prevq = {}

    def _local(self, bone, spec):
        R, Ri = self.rest[bone]
        rot = spec.get("r")
        loc = spec.get("t")
        scl = spec.get("s")
        dq = spec.get("q")
        if rot or dq is not None:
            e = Euler([math.radians(a) for a in rot], "XYZ").to_matrix() if rot else Matrix.Identity(3)
            if dq is not None:  # armature-space delta quaternion (e.g. from IK), applied after the euler
                e = dq.to_matrix() @ e
            q = (Ri @ e @ R).to_quaternion()
        else:
            q = Quaternion()
        t = Ri @ Vector(loc) if loc else Vector()
        if scl is None:
            s = Vector((1, 1, 1))
        else:
            if not isinstance(scl, (tuple, list)):
                scl = (scl, scl, scl)
            S = Matrix.Diagonal(Vector(scl))
            M = Ri @ S @ R
            s = Vector((M[0][0], M[1][1], M[2][2]))
        return q, t, s

    def key(self, frame, pose):
        for pb in self.rig.pose.bones:
            q, t, s = self._local(pb.name, pose.get(pb.name, {}))
            prev = self._prevq.get(pb.name)
            if prev is not None and prev.dot(q) < 0:
                q = -q
            self._prevq[pb.name] = q.copy()
            pb.rotation_quaternion = q
            pb.location = t
            pb.scale = s
            pb.keyframe_insert("rotation_quaternion", frame=frame)
            pb.keyframe_insert("location", frame=frame)
            pb.keyframe_insert("scale", frame=frame)

    def clip(self, name, frames, pose_fn):
        """Create action `name` sampled at frames 0..frames (inclusive). pose_fn(t) gets t in [0,1]."""
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        ad = self.rig.animation_data or self.rig.animation_data_create()
        ad.action = act
        self._prevq = {}
        for f in range(frames + 1):
            self.key(f, pose_fn(f / frames))
        act.use_frame_range = True
        act.frame_start = 0
        act.frame_end = frames
        # linear keys: every frame is keyed anyway, avoid bezier overshoot
        try:
            for layer in act.layers:
                for strip in layer.strips:
                    for bag in strip.channelbags:
                        for fc in bag.fcurves:
                            for kp in fc.keyframe_points:
                                kp.interpolation = "LINEAR"
        except AttributeError:
            pass
        ad.action = None
        return act

    # ------------------------------------------------------------------ kinematics
    def _basis(self, bone, spec):
        q, t, s = self._local(bone, spec)
        return Matrix.Translation(t) @ q.to_matrix().to_4x4() @ Matrix.Diagonal((*s, 1.0))

    def fk(self, pose, upto=None):
        """Armature-space pose matrices {bone: Matrix4} (like pose_bone.matrix). If `upto` is given only
        that bone and its ancestors are evaluated."""
        bones = self.rig.data.bones
        need = None
        if upto is not None:
            need = set()
            b = bones[upto]
            while b:
                need.add(b.name)
                b = b.parent
        out = {}

        def ev(b):
            if b.name in out:
                return out[b.name]
            basis = self._basis(b.name, pose.get(b.name, {}))
            if b.parent is None:
                m = b.matrix_local @ basis
            else:
                m = ev(b.parent) @ (b.parent.matrix_local.inverted() @ b.matrix_local) @ basis
            out[b.name] = m
            return m

        for b in bones:
            if need is None or b.name in need:
                ev(b)
        return out

    def world_delta(self, mats, bone):
        """Accumulated armature-space delta rotation G (pose_rot = G @ rest_rot) of `bone`."""
        W = mats[bone].to_3x3().normalized()
        return (W @ self.rest[bone][1]).to_quaternion()

    def solve_leg(self, pose, upper, lower, target, pole, foot=None, foot_rot=None):
        """Two-bone IK: rotate `upper`/`lower` so the tail of `lower` reaches `target` (armature space),
        bending towards the `pole` direction. The foot keeps its rest orientation in armature space,
        optionally rotated by the euler `foot_rot` (degrees). Writes 'q' entries into `pose` (in place)."""
        bones = self.rig.data.bones
        bu, bl = bones[upper], bones[lower]
        parent = bu.parent.name
        mats = self.fk(pose, upto=parent)
        Gp = self.world_delta(mats, parent)
        # head of the upper bone in the posed parent frame (+ its own translation if any)
        rel = bu.parent.matrix_local.inverted() @ bu.matrix_local
        tspec = pose.get(upper, {}).get("t")
        S = (mats[parent] @ rel @ Matrix.Translation(self.rest[upper][1] @ Vector(tspec) if tspec else Vector())).translation
        a = (bu.tail_local - bu.head_local).length
        b = (bl.tail_local - bl.head_local).length
        T = Vector(target)
        dv = T - S
        d = clamp(dv.length, abs(a - b) + 1e-4, a + b - 1e-4)
        dirv = dv.normalized()
        P = Vector(pole)
        perp = P - dirv * P.dot(dirv)
        if perp.length < 1e-6:
            perp = Vector((0, -1, 0))
        perp.normalize()
        ca = clamp((a * a + d * d - b * b) / (2 * a * d), -1.0, 1.0)
        al = math.acos(ca)
        knee = S + a * (math.cos(al) * dirv + math.sin(al) * perp)
        ankle = S + d * dirv
        up_dir = (knee - S).normalized()
        lo_dir = (ankle - knee).normalized()
        rest_up = (bu.tail_local - bu.head_local).normalized()
        rest_lo = (bl.tail_local - bl.head_local).normalized()
        base_u = self._euler_q(pose.get(upper, {}).get("r"))
        Gu_pre = Gp @ base_u
        Du = rest_up.rotation_difference(Gu_pre.inverted() @ up_dir)
        Gu = Gu_pre @ Du
        base_l = self._euler_q(pose.get(lower, {}).get("r"))
        Gl_pre = Gu @ base_l
        Dl = rest_lo.rotation_difference(Gl_pre.inverted() @ lo_dir)
        Gl = Gl_pre @ Dl
        # _local() composes the delta as q @ euler -> express the IK result (euler then Du) accordingly
        pose.setdefault(upper, {})["q"] = base_u @ Du @ base_u.inverted()
        pose.setdefault(lower, {})["q"] = base_l @ Dl @ base_l.inverted()
        if foot:
            want = self._euler_q(foot_rot)
            pose.setdefault(foot, {}).pop("r", None)
            pose[foot]["q"] = Gl.inverted() @ want
        return knee, ankle

    @staticmethod
    def _euler_q(rot):
        if not rot:
            return Quaternion()
        return Euler([math.radians(x) for x in rot], "XYZ").to_quaternion()

    def rest_pose(self):
        for pb in self.rig.pose.bones:
            pb.rotation_quaternion = Quaternion()
            pb.location = Vector()
            pb.scale = Vector((1, 1, 1))


def delta_q(spec):
    """Total armature-space delta rotation of a pose spec ('q' @ euler 'r')."""
    e = Animator._euler_q(spec.get("r"))
    q = spec.get("q")
    return q @ e if q is not None else e


def blend_delta(spec_a, spec_b, w):
    """Slerp between the rotations of two pose specs (w = weight of b)."""
    qa, qb = delta_q(spec_a), delta_q(spec_b)
    if qa.dot(qb) < 0:
        qb = -qb
    return qa.slerp(qb, w)


def merge(*poses):
    """Merge pose dicts; for the same bone, rotations/translations add and scales multiply."""
    out = {}
    for p in poses:
        for bone, spec in p.items():
            o = out.setdefault(bone, {})
            for k, v in spec.items():
                if k == "s":
                    v = v if isinstance(v, (tuple, list)) else (v, v, v)
                    o["s"] = tuple(a * b for a, b in zip(o.get("s", (1, 1, 1)), v))
                else:
                    o[k] = add(o.get(k), v)
    return out
