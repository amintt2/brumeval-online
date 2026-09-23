"""Humanoid armature + character-space posing for the `humanoids` group (on top of kit.rig).

Joints come from a proportion dict (so goblins, hags and a 2.4 m lich share the same 18 SPEC bones).
Poses are written in CHARACTER SPACE, independent of bone rolls:
    {bone: (rx, ry, rz)}  degrees, rotation about the character axes X (= character's LEFT), Y (= BACK), Z (= UP),
                          applied at the joint relative to the parent (FK).
        rx > 0 : torso / neck / head bend FORWARD ; a limb hanging down swings BACKWARD ; knee (shin) bends
        rx < 0 : a hanging limb (thigh, arm) swings FORWARD ; elbow (forearm) bends forward/up
        ry > 0 : tilt towards the character's LEFT (+X) ; lowers the LEFT arm / raises the RIGHT arm
        rz > 0 : turn (yaw) towards the character's LEFT
    {bone: {"rot": (rx, ry, rz), "loc": (x, y, z)}}   loc = translation in metres in character space
                                                        (root / hips only; y < 0 = forward).
Mirror a pose with rig.mirror_pose (swap .L/.R, negate ry and rz) - valid for these character-space values.
"""
import math

import bpy
import mathutils

from kit import rig

BONES = list(rig.HUMANOID)
PARENT = dict(rig._PARENT)


def joints(P):
    """Joint positions from proportions. P keys (metres, all optional except H):
    H height (top of the head at rest, before hunch), hip (hip joint height), knee, ankle,
    pelvis, spine, chest, neck_z, head_z (bone heads; 'head'/'neck' are anatomy scales), shoulder (height), shoulder_w, hip_w,
    arm_drop (deg below horizontal), upper, fore, hand (lengths), hunch (deg: spine/chest/neck lean forward),
    toe (foot length forward)."""
    s = P["H"] / 1.8
    g = lambda k, d: P.get(k, d * s)  # noqa: E731
    hip, knee, ankle = g("hip", 0.93), g("knee", 0.5), g("ankle", 0.09)
    pelvis, spine, chest, neck, head = g("pelvis", 0.98), g("spine", 1.1), g("chest", 1.28), g("neck_z", 1.46), g("head_z", 1.56)
    top = g("top", 1.8)
    sh_z, sh_w, hip_w = g("shoulder", 1.42), g("shoulder_w", 0.19), g("hip_w", 0.1)
    upper, fore, hand = g("upper", 0.29), g("fore", 0.26), g("hand", 0.17)
    toe = g("toe", 0.15)
    hunch = math.radians(P.get("hunch", 0.0))
    arm_drop = math.radians(P.get("arm_drop", 50.0))
    # hunch: spine curls forward progressively (chest and neck lean, head raised back to look ahead)
    def lean(base, z, k):
        dz = z - base[2]
        a = hunch * k
        return mathutils.Vector((0, base[1] - dz * math.sin(a), base[2] + dz * math.cos(a)))
    J = {}
    root = mathutils.Vector((0, 0, 0))
    p_pel = mathutils.Vector((0, 0, pelvis))
    p_sp = mathutils.Vector((0, 0, spine))
    p_ch = lean(p_sp, chest, 0.5)
    p_nk = p_ch + (lean(mathutils.Vector((0, 0, chest)), neck, 1.0) - mathutils.Vector((0, 0, chest)))
    p_hd = p_nk + (lean(mathutils.Vector((0, 0, neck)), head, 0.7) - mathutils.Vector((0, 0, neck)))
    p_top = p_hd + mathutils.Vector((0, -0.01 * s, top - head))
    J["root"] = (tuple(root), (0, 0, 0.25 * s))
    J["hips"] = (tuple(p_pel), tuple(p_sp))
    J["spine"] = (tuple(p_sp), tuple(p_ch))
    J["chest"] = (tuple(p_ch), tuple(p_nk))
    J["neck"] = (tuple(p_nk), tuple(p_hd))
    J["head"] = (tuple(p_hd), tuple(p_top))
    # shoulder height follows the chest lean
    sh_off = sh_z - chest
    sh_c = p_ch + (lean(mathutils.Vector((0, 0, chest)), chest + sh_off, 1.0) - mathutils.Vector((0, 0, chest)))
    for side, sg in (("L", 1), ("R", -1)):
        sh = mathutils.Vector((sg * sh_w, sh_c.y + P.get("shoulder_y", 0.0), sh_c.z))
        d = mathutils.Vector((sg * math.cos(arm_drop), 0.0, -math.sin(arm_drop)))
        el = sh + d * upper
        wr = el + d * fore + mathutils.Vector((0, -0.02 * s, 0))
        hd = wr + d * hand
        J[f"upper_arm.{side}"] = (tuple(sh), tuple(el))
        J[f"forearm.{side}"] = (tuple(el), tuple(wr))
        J[f"hand.{side}"] = (tuple(wr), tuple(hd))
        J[f"thigh.{side}"] = ((sg * hip_w, 0, hip), (sg * hip_w * P.get("knee_in", 1.0), -0.01 * s, knee))
        J[f"shin.{side}"] = ((sg * hip_w * P.get("knee_in", 1.0), -0.01 * s, knee), (sg * hip_w, 0.02 * s, ankle))
        J[f"foot.{side}"] = ((sg * hip_w, 0.02 * s, ankle), (sg * hip_w * 1.05, -toe + 0.01 * s, 0.03 * s))
    return J


def armature(P, name="Rig"):
    J = joints(P)
    arm = rig.armature(J, PARENT, name)
    arm["h_joints"] = {k: [list(a), list(b)] for k, (a, b) in J.items()}
    return arm, J


# =============================================================================== character-space poses
def _rest3(arm):
    return {b.name: b.matrix_local.to_3x3().normalized() for b in arm.data.bones}


def to_local(arm, pose, _cache={}):
    """Character-space pose dict -> kit.rig pose dict with quaternions (bone local)."""
    R = _rest3(arm)
    out = {}
    for bn, v in pose.items():
        if bn not in R:
            continue
        rot, loc = (0, 0, 0), None
        if isinstance(v, dict):
            rot, loc = v.get("rot", (0, 0, 0)), v.get("loc")
        else:
            rot = v
        e = mathutils.Euler(tuple(math.radians(a) for a in rot), "XYZ")
        Rc = e.to_matrix()
        Rb = R[bn]
        q = (Rb.inverted() @ Rc @ Rb).to_quaternion()
        entry = {"rot": tuple(q)}
        if loc is not None:
            # pose location is expressed in the bone's rest frame (parent-relative, rest orientation)
            entry["loc"] = tuple(Rb.inverted() @ mathutils.Vector(loc))
        out[bn] = entry
    return out


def add(*poses):
    """Merge poses: rotations/locations of the same bone are ADDED (small-angle layering, e.g. breathing on a stance)."""
    out = {}
    for p in poses:
        for k, v in p.items():
            rot = v.get("rot", (0, 0, 0)) if isinstance(v, dict) else v
            loc = v.get("loc") if isinstance(v, dict) else None
            if k in out:
                r0 = out[k].get("rot", (0, 0, 0))
                l0 = out[k].get("loc")
                rot = tuple(a + b for a, b in zip(r0, rot))
                if l0 is not None:
                    loc = tuple(a + b for a, b in zip(l0, loc)) if loc is not None else l0
            out[k] = {"rot": tuple(rot)}
            if loc is not None:
                out[k]["loc"] = tuple(loc)
    return out


def lerp(a, b, t):
    """Blend two character-space poses."""
    keys = set(a) | set(b)
    out = {}
    for k in keys:
        va = a.get(k, (0, 0, 0))
        vb = b.get(k, (0, 0, 0))
        ra = va.get("rot", (0, 0, 0)) if isinstance(va, dict) else va
        rb = vb.get("rot", (0, 0, 0)) if isinstance(vb, dict) else vb
        la = va.get("loc", (0, 0, 0)) if isinstance(va, dict) else (0, 0, 0)
        lb = vb.get("loc", (0, 0, 0)) if isinstance(vb, dict) else (0, 0, 0)
        out[k] = {"rot": tuple(x + (y - x) * t for x, y in zip(ra, rb)),
                  "loc": tuple(x + (y - x) * t for x, y in zip(la, lb))}
    return out


def mirror(p):
    return rig.mirror_pose(p)


def clip(arm, name, keys, cyclic=False, interpolation="BEZIER"):
    """keys = [(frame, character-space pose), ..., ("loop", frame)] -> one Action (via kit.rig.clip)."""
    ks = []
    prev = {}
    for f, p in keys:
        if f == "loop":
            ks.append((f, p))
            continue
        lp = to_local(arm, p)
        # quaternion sign continuity (spins > 180 deg, e.g. a 360 spin, interpolate the right way)
        for bn, e in lp.items():
            q = mathutils.Quaternion(e["rot"])
            if bn in prev and q.dot(prev[bn]) < 0:
                q.negate()
            prev[bn] = q
            e["rot"] = tuple(q)
        ks.append((f, lp))
    if ks and ks[-1][0] == "loop":
        ks[-1] = ("loop", ks[-1][1])
    return rig.clip(arm, name, ks, cyclic=cyclic, interpolation=interpolation)


def pose_now(arm, p):
    """Apply a character-space pose immediately (for checks / renders)."""
    rig.pose(arm, to_local(arm, p))
    bpy.context.view_layer.update()


def set_action(arm, act):
    arm.animation_data_create()
    arm.animation_data.action = act
    try:
        if act is not None and act.slots:
            arm.animation_data.action_slot = act.slots[0]
    except AttributeError:
        pass
