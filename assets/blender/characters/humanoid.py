"""Procedural humanoid toolkit for Brumeval Online (Blender 5.0, headless).

* Landmarks (proportions) -> one shared Armature 'Rig' with the SPEC bone list.
* A pose solver working in CHARACTER SPACE (X = character's left, Y = back, Z = up), independent of
  Blender bone rolls:  rotations are XYZ euler degrees about those axes, applied at the joint, relative
  to the parent (FK), or absolute ('a'), plus analytic two-bone IK for legs / arms.
    pitch  rx > 0 : bends the torso / head FORWARD;  swings a hanging limb BACKWARD
    roll   ry > 0 : tilts towards the character's LEFT (+X) (for a hanging limb: tip goes right)
    yaw    rz > 0 : turns towards the character's LEFT
* Clips are keyed on every frame (linear), so what Blender shows is exactly what the glTF contains.
* Render helpers: pose contact sheets (review), UI class cards and portraits.
"""
import math
import os

import bpy
from mathutils import Euler, Matrix, Quaternion, Vector

import geo as G

TAU = math.tau

ORDER = ["root", "hips", "spine", "chest", "neck", "head",
         "upper_arm.L", "forearm.L", "hand.L", "upper_arm.R", "forearm.R", "hand.R",
         "thigh.L", "shin.L", "foot.L", "thigh.R", "shin.R", "foot.R"]
PARENT = {"root": None, "hips": "root", "spine": "hips", "chest": "spine", "neck": "chest", "head": "neck"}
for _s in "LR":
    PARENT.update({f"upper_arm.{_s}": "chest", f"forearm.{_s}": f"upper_arm.{_s}", f"hand.{_s}": f"forearm.{_s}",
                   f"thigh.{_s}": "hips", f"shin.{_s}": f"thigh.{_s}", f"foot.{_s}": f"shin.{_s}"})
CHAINS = {"leg.L": ("thigh.L", "shin.L"), "leg.R": ("thigh.R", "shin.R"),
          "arm.L": ("upper_arm.L", "forearm.L"), "arm.R": ("upper_arm.R", "forearm.R")}
DEFAULT_POLE = {"leg.L": (0.08, -1, 0), "leg.R": (-0.08, -1, 0), "arm.L": (0.4, 1, -0.3), "arm.R": (-0.4, 1, -0.3)}

# Default adult human, 1.80 m (head top), metres.
HUMAN = dict(
    ankle=0.085, knee=0.49, hip=0.92, hip_w=0.095, toe_y=-0.15, toe_z=0.03,
    pelvis=0.97, spine=1.07, chest=1.24, neck=1.47, head=1.535, top=1.80,
    shoulder=1.43, shoulder_w=0.20, elbow=1.15, wrist=0.895, hand=0.12, arm_out=0.04,
)


def scaled(L, s, **over):
    out = {k: v * s for k, v in L.items()}
    out.update(over)
    return out


# --------------------------------------------------------------------------- rig
def build_rig(L):
    arm = bpy.data.armatures.new("Rig")
    rig = bpy.data.objects.new("Rig", arm)
    bpy.context.scene.collection.objects.link(rig)
    for o in bpy.context.scene.objects:
        o.select_set(False)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")

    def eb(name, h, t, parent=None, connect=False):
        b = arm.edit_bones.new(name)
        b.head, b.tail, b.roll = h, t, 0.0
        if parent:
            b.parent = arm.edit_bones[parent]
            b.use_connect = connect
        return b

    eb("root", (0, 0, 0), (0, 0, L["pelvis"] * 0.3))
    eb("hips", (0, 0, L["pelvis"]), (0, 0, L["spine"]), "root")
    eb("spine", (0, 0, L["spine"]), (0, 0, L["chest"]), "hips", True)
    eb("chest", (0, 0, L["chest"]), (0, 0, L["neck"]), "spine", True)
    eb("neck", (0, 0, L["neck"]), (0, 0, L["head"]), "chest", True)
    eb("head", (0, 0, L["head"]), (0, 0, L["top"]), "neck", True)
    for s, sx in (("L", 1), ("R", -1)):
        sw, ao = L["shoulder_w"], L["arm_out"]
        sh = (sx * sw, 0, L["shoulder"])
        el = (sx * (sw + ao * 0.5), 0, L["elbow"])
        wr = (sx * (sw + ao), 0, L["wrist"])
        eb(f"upper_arm.{s}", sh, el, "chest")
        eb(f"forearm.{s}", el, wr, f"upper_arm.{s}", True)
        eb(f"hand.{s}", wr, (wr[0], 0, L["wrist"] - L["hand"]), f"forearm.{s}", True)
        hw = sx * L["hip_w"]
        eb(f"thigh.{s}", (hw, 0, L["hip"]), (hw, 0, L["knee"]), "hips")
        eb(f"shin.{s}", (hw, 0, L["knee"]), (hw, 0, L["ankle"]), f"thigh.{s}", True)
        eb(f"foot.{s}", (hw, 0, L["ankle"]), (hw, L["toe_y"], L["toe_z"]), f"shin.{s}", True)
    bpy.ops.object.mode_set(mode="OBJECT")
    rig.data.display_type = "STICK"
    return rig


# --------------------------------------------------------------------------- pose specs
def eq(r):
    return Euler([math.radians(a) for a in r], "XYZ").to_quaternion()


def side_r(side, r):
    """Rotation authored for the LEFT side, mirrored for the right."""
    return tuple(r) if side == "L" else (r[0], -r[1], -r[2])


def arm_r(side, fwd=0.0, out=0.0, twist=0.0):
    """Upper-arm rotation: fwd = swing forward (deg), out = abduction, twist = external rotation."""
    s = 1 if side == "L" else -1
    return (-fwd, -s * out, s * twist)


def vadd(a, b, w=1.0):
    return tuple(x + w * y for x, y in zip(a, b))


def _entry(v):
    if isinstance(v, dict):
        return dict(v)
    v = tuple(v)
    if len(v) == 3:
        return {"r": v}
    if len(v) == 6:
        return {"r": v[:3], "t": v[3:]}
    raise ValueError(f"bad pose entry {v}")


def norm(spec):
    out = {}
    for k, v in spec.items():
        if k == "IK":
            out["IK"] = dict(v)
        else:
            out[k] = _entry(v)
    return out


def plus(*specs):
    """Sum of specs: 'r'/'t' add up; absolute 'a'/'q' entries and IK targets: last one wins (None removes)."""
    out = {}
    for s in specs:
        for k, e in norm(s).items():
            if k == "IK":
                ik = out.setdefault("IK", {})
                for c, v in e.items():
                    if v is None:
                        ik.pop(c, None)
                    else:
                        ik[c] = v
                continue
            o = out.setdefault(k, {})
            for f in ("r", "t"):
                if f in e:
                    o[f] = vadd(o.get(f, (0, 0, 0)), e[f])
            for f in ("a", "q"):
                if f in e:
                    o[f] = e[f]
    return out


def over(base, changes):
    """Replace whole bone entries of `base` by those of `changes` (IK: None removes a chain)."""
    out = {k: (dict(v) if k != "IK" else dict(v)) for k, v in norm(base).items()}
    for k, e in norm(changes).items():
        if k == "IK":
            ik = out.setdefault("IK", {})
            for c, v in e.items():
                if v is None:
                    ik.pop(c, None)
                else:
                    ik[c] = v
        else:
            out[k] = dict(e)
    return out


def pivot(r, c):
    """Root entry rotating by euler `r` around world point `c` (instead of the feet)."""
    q = eq(r)
    c = Vector(c)
    return {"r": tuple(r), "t": tuple(c - q @ c)}


EASE = {
    "lin": lambda u: u,
    "smooth": lambda u: u * u * (3 - 2 * u),
    "in": lambda u: u * u,
    "out": lambda u: 1 - (1 - u) ** 2,
    "in3": lambda u: u ** 3,
    "out3": lambda u: 1 - (1 - u) ** 3,
}


# --------------------------------------------------------------------------- solver
class Poser:
    def __init__(self, rig, L):
        self.rig = rig
        self.L = L
        bones = rig.data.bones
        self.head = {b.name: b.head_local.copy() for b in bones}
        self.tail = {b.name: b.tail_local.copy() for b in bones}
        self.B = {b.name: b.matrix_local.to_quaternion() for b in bones}
        self.Bi = {k: q.inverted() for k, q in self.B.items()}
        self.pos, self.rd = {}, {}
        bpy.context.preferences.edit.keyframe_new_interpolation_type = "LINEAR"

    def length(self, b):
        return (self.tail[b] - self.head[b]).length

    def rest_dir(self, b):
        return (self.tail[b] - self.head[b]).normalized()

    # -- IK
    def _ik(self, b1, b2, Rp, J, target, pole):
        L1, L2 = self.length(b1), self.length(b2)
        d = Vector(target) - J
        D = max(abs(L1 - L2) + 1e-4, min(d.length, (L1 + L2) * 0.9995))
        dn = d.normalized()
        pl = Vector(pole)
        pn = pl - dn * pl.dot(dn)
        if pn.length < 1e-6:
            pn = Vector((0, -1, 0)) - dn * (-dn.y)
        pn.normalize()
        ca = max(-1.0, min(1.0, (L1 * L1 + D * D - L2 * L2) / (2 * L1 * D)))
        sa = math.sqrt(max(0.0, 1 - ca * ca))
        K = J + (dn * ca + pn * sa) * L1
        E = J + dn * D
        cur1 = Rp @ self.rest_dir(b1)
        q1abs = cur1.rotation_difference((K - J).normalized()) @ Rp
        cur2 = q1abs @ self.rest_dir(b2)
        q2abs = cur2.rotation_difference((E - K).normalized()) @ q1abs
        return Rp.inverted() @ q1abs, q1abs.inverted() @ q2abs

    def solve(self, spec):
        """spec -> {bone: (q_rel, t)}; also stores posed joint positions / absolute rotations."""
        spec = norm(spec)
        ik = spec.get("IK", {})
        Rd, pos, out, forced = {}, {}, {}, {}
        for b in ORDER:
            p = PARENT[b]
            e = spec.get(b, {})
            Rp = Rd[p] if p else Quaternion()
            t = Vector(e.get("t", (0, 0, 0)))
            pos[b] = (pos[p] + Rp @ (self.head[b] - self.head[p] + t)) if p else (self.head[b] + t)
            if b in forced:
                q = forced[b]
            elif "q" in e:
                q = Rp.inverted() @ Quaternion(e["q"])
            elif "a" in e:
                q = Rp.inverted() @ eq(e["a"])
            else:
                q = eq(e.get("r", (0, 0, 0)))
            for cname, (b1, b2) in CHAINS.items():
                if b == b1 and ik.get(cname) is not None:
                    v = ik[cname]
                    tgt, pole = (v["t"], v.get("pole", DEFAULT_POLE[cname])) if isinstance(v, dict) else (v, DEFAULT_POLE[cname])
                    q, forced[b2] = self._ik(b1, b2, Rp, pos[b], tgt, pole)
            Rd[b] = Rp @ q
            out[b] = (q, t)
        self.pos, self.rd = pos, Rd
        return out

    def point(self, b, frac=1.0):
        """Posed world position along bone b (0 = head, 1 = tail) from the last solve()."""
        return self.pos[b] + self.rd[b] @ ((self.tail[b] - self.head[b]) * frac)

    def delta(self, b):
        """Rest-space -> posed-space matrix of bone b (rigid skinning) from the last solve()."""
        return (Matrix.Translation(self.pos[b]) @ self.rd[b].to_matrix().to_4x4()
                @ Matrix.Translation(-self.head[b]))

    def to_rest(self, b, spec):
        """Matrix that maps geometry authored in the POSED space of `spec` back to the bind pose, so a prop
        skinned to bone b shows up exactly as authored when the character is in that pose."""
        self.solve(spec)
        return self.delta(b).inverted()

    # -- applying / keying
    def apply(self, solved, last=None):
        pbs = self.rig.pose.bones
        for b in ORDER:
            q, t = solved[b]
            ql = self.Bi[b] @ q @ self.B[b]
            if last is not None:
                if b in last and last[b].dot(ql) < 0:
                    ql.negate()
                last[b] = ql.copy()
            pb = pbs[b]
            pb.rotation_mode = "QUATERNION"
            pb.rotation_quaternion = ql
            pb.location = self.Bi[b] @ t

    def rest(self):
        for pb in self.rig.pose.bones:
            pb.rotation_quaternion = (1, 0, 0, 0)
            pb.location = (0, 0, 0)

    def key_clip(self, name, frames, fn):
        """fn(frame) -> solved pose; keys frames 0..frames (inclusive) into a new Action `name`."""
        rig = self.rig
        rig.animation_data_create()
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        rig.animation_data.action = act
        last = {}
        pbs = rig.pose.bones
        for f in range(frames + 1):
            self.apply(fn(f), last)
            for b in ORDER:
                pbs[b].keyframe_insert("rotation_quaternion", frame=f, group=b)
                pbs[b].keyframe_insert("location", frame=f, group=b)
        rig.animation_data.action = None
        self.rest()
        return act

    def key_loop(self, name, frames, spec_fn):
        """Seamless loop: spec_fn(phase 0..1) evaluated on every frame (phase 1 == phase 0)."""
        return self.key_clip(name, frames, lambda f: self.solve(spec_fn((f % frames) / frames)))

    def key_poses(self, name, keys):
        """keys: [(frame, spec[, ease])] -> solved to FK, slerped with easing between keys."""
        solved = []
        for k in keys:
            ease = k[2] if len(k) > 2 else "smooth"
            solved.append((k[0], self.solve(k[1]), EASE[ease]))

        def at(fr):
            for (f0, s0, _), (f1, s1, ease) in zip(solved, solved[1:]):
                if f0 <= fr <= f1:
                    u = ease((fr - f0) / max(f1 - f0, 1e-6))
                    return {b: (s0[b][0].slerp(s1[b][0], u), s0[b][1].lerp(s1[b][1], u)) for b in ORDER}
            return solved[-1][1] if fr > solved[-1][0] else solved[0][1]

        return self.key_clip(name, keys[-1][0], at)

    # -- ground contact
    def min_z(self, body, spec, exclude=None):
        """Lowest vertex (world z) of the skinned body posed with `spec` (vertices in `exclude` ignored)."""
        if self.rig.animation_data:
            self.rig.animation_data.action = None
        self.apply(self.solve(spec))
        bpy.context.view_layer.update()
        dg = bpy.context.evaluated_depsgraph_get()
        ev = body.evaluated_get(dg)
        me = ev.to_mesh()
        mw = body.matrix_world
        ex = exclude or set()
        z = min((mw @ v.co).z for v in me.vertices if v.index not in ex)
        ev.to_mesh_clear()
        self.rest()
        bpy.context.view_layer.update()
        return z


# --------------------------------------------------------------------------- procedural clips
def stance(**kw):
    st = dict(
        drop=0.02, width=1.3, feet=(0.03, -0.035), toe_out=9.0,
        hips=(0, 0, 0), spine=(1.5, 0, 0), chest=(0, 0, 0), neck=(0, 0, 0), head=(0, 0, 0),
        arms={"L": dict(fwd=4, out=8, twist=0, elbow=14, hand=(0, 0, 0)),
              "R": dict(fwd=4, out=8, twist=0, elbow=14, hand=(0, 0, 0))},
        arm_ik={}, sway=0.012, breathe=1.0, look=3.0,
    )
    arms = kw.pop("arms", {})
    st.update(kw)
    st["arms"] = {s: dict(st["arms"][s], **arms.get(s, {})) for s in "LR"}
    return st


def _arm_entries(side, a, br=0.0):
    return {
        f"upper_arm.{side}": arm_r(side, a["fwd"] + 0.8 * br, a["out"] + 1.4 * br, a["twist"]),
        f"forearm.{side}": (-(a["elbow"] + 1.5 * br), 0, 0),
        f"hand.{side}": side_r(side, a["hand"]),
    }


def idle_spec(P, t, st):
    """Idle at phase t (0..1): breathing, weight shift, small look-around, feet planted by IK."""
    w = TAU * t
    br = math.sin(w) * st["breathe"]
    sh = math.sin(w + 0.7)
    spec = {
        "hips": {"r": vadd(st["hips"], (0, 1.2 * sh, 0)),
                 "t": (st["sway"] * sh, 0, -st["drop"] - 0.006 * (0.5 - 0.5 * math.cos(w)))},
        "spine": vadd(st["spine"], (0.3 * br, -0.8 * sh, 0)),
        "chest": vadd(st["chest"], (-1.3 * br, -0.5 * sh, 0)),
        "neck": vadd(st["neck"], (0.6 * br, 0.4 * sh, 0)),
        "head": vadd(st["head"], (0.9 * br, 0.5 * sh, st["look"] * math.sin(w))),
        "IK": {},
    }
    for side in "LR":
        spec.update(_arm_entries(side, st["arms"][side], br))
    for side, sg, ff in (("L", 1, st["feet"][0]), ("R", -1, st["feet"][1])):
        an = P.head[f"foot.{side}"]
        spec["IK"][f"leg.{side}"] = {"t": (sg * abs(an.x) * st["width"], -ff, an.z), "pole": (sg * 0.12, -1, 0)}
        spec[f"foot.{side}"] = {"a": (0, 0, sg * st["toe_out"])}
    for side, v in st["arm_ik"].items():
        if v:
            tgt = v["t"](t) if callable(v["t"]) else v["t"]
            spec["IK"][f"arm.{side}"] = {"t": tgt, "pole": v.get("pole", DEFAULT_POLE[f"arm.{side}"])}
            if "hand" in v:
                spec[f"hand.{side}"] = v["hand"]
    return spec


def gait(**kw):
    g = dict(frames=19, stride=0.78, lift=0.17, duty=0.4, drop=0.06, bob=0.03, lean=9.0, twist=9.0,
             sway=0.012, roll=2.5, arm_swing=38.0, elbow=70.0, elbow_swing=18.0, arm_out=9.0,
             width=1.0, toe_out=4.0, strike=12.0, toeoff=38.0, run=True, head_bob=2.0, arms={})
    g.update(kw)
    return g


def _smooth(u):
    return u * u * (3 - 2 * u)


def gait_spec(P, p, g, st):
    """Walk / run cycle at phase p (0..1): foot trajectories + leg IK, hip bob, counter-twist, arm swing."""
    beta, S = g["duty"], g["stride"]
    w = TAU * p
    c2 = math.cos(2 * TAU * (p - beta / 2))
    z = -g["drop"] - st["drop"] + (-g["bob"] * c2 if g["run"] else g["bob"] * c2)
    sway = g["sway"] * math.cos(TAU * (p - beta / 2))
    tw = g["twist"] * math.cos(w)
    lean = g["lean"]
    spec = {
        "hips": {"r": vadd(st["hips"], (lean * 0.3, -g["roll"] * math.cos(TAU * (p - beta / 2)), -tw)), "t": (sway, 0, z)},
        "spine": vadd(st["spine"], (lean * 0.4, 0, tw * 0.45)),
        "chest": vadd(st["chest"], (lean * 0.3 + (1.5 * c2 if g["run"] else 0), 0, tw * 1.05)),
        "neck": vadd(st["neck"], (-lean * 0.35, 0, -tw * 0.25)),
        "head": vadd(st["head"], (-lean * 0.45 - g["head_bob"] * c2, 0, -tw * 0.25)),
        "IK": {},
    }
    foot_len = P.length("foot.L")
    for side, sg, off in (("L", 1, 0.0), ("R", -1, 0.5)):
        q = (p + off) % 1.0
        if q < beta:
            s = q / beta
            f = S / 2 - S * s
            u = 0.0
            if s < 0.2:
                pitch = g["strike"] * (1 - s / 0.2)
            elif s > 0.55:
                pitch = -g["toeoff"] * ((s - 0.55) / 0.45) ** 1.4
            else:
                pitch = 0.0
        else:
            s = (q - beta) / (1 - beta)
            f = -S / 2 + S * _smooth(s)
            u = g["lift"] * math.sin(math.pi * min(1.0, s * 1.12))
            pitch = -g["toeoff"] + (g["toeoff"] + g["strike"]) * _smooth(s)
        heel = foot_len * math.sin(math.radians(max(0.0, -pitch))) * 0.9
        an = P.head[f"foot.{side}"]
        spec["IK"][f"leg.{side}"] = {"t": (sg * abs(an.x) * g["width"], -f, an.z + u + heel), "pole": (sg * 0.1, -1, 0)}
        spec[f"foot.{side}"] = {"a": (-pitch, 0, sg * g["toe_out"])}
    for side, off in (("L", 0.0), ("R", 0.5)):
        a = g["arms"].get(side, {})
        osc = -math.cos(TAU * (p + off))
        sw = a.get("swing", 1.0)
        fwd = g["arm_swing"] * sw * osc + a.get("fwd", 0.0)
        bend = a.get("elbow", g["elbow"]) + g["elbow_swing"] * sw * max(0.0, osc)
        spec[f"upper_arm.{side}"] = arm_r(side, fwd, a.get("out", g["arm_out"]), a.get("twist", 0.0))
        spec[f"forearm.{side}"] = (-bend, 0, 0)
        spec[f"hand.{side}"] = side_r(side, a.get("hand", (0, 0, 0)))
        if a.get("ik"):
            v = a["ik"]
            tgt = v["t"](p) if callable(v["t"]) else v["t"]
            spec["IK"][f"arm.{side}"] = {"t": tgt, "pole": v.get("pole", DEFAULT_POLE[f"arm.{side}"])}
            if "hand" in v:
                spec[f"hand.{side}"] = v["hand"]
    return spec


def hit_keys(base, strength=1.0, frames=8):
    s = strength
    hit = plus(base, {
        "hips": {"t": (0, 0.035 * s, -0.015 * s), "r": (-4 * s, 0, 3 * s)},
        "spine": (-6 * s, 0, 0), "chest": (-12 * s, 2 * s, 5 * s), "neck": (-4 * s, 0, 0), "head": (-14 * s, 4 * s, 8 * s),
        "upper_arm.L": arm_r("L", -12 * s, 12 * s), "upper_arm.R": arm_r("R", -12 * s, 12 * s),
        "forearm.L": (-14 * s, 0, 0), "forearm.R": (-14 * s, 0, 0),
    })
    return [(0, base), (3, hit, "out"), (frames, base, "smooth")]


def death_keys(P, body, base, fall="back", turn=12.0, exclude=None, arms=None, frames=29):
    """Stagger, knees buckle, fall flat (backwards or face down) and settle; the final pose is lifted so the
    lowest body vertex rests on the ground (z = 0)."""
    back = fall == "back"
    sgn = -1 if back else 1
    arms = arms or {}
    reel = plus(base, {
        "hips": {"t": (0, 0.05 * (1 if back else -1), -0.06), "r": (-6 * (1 if back else -1), 0, turn * 0.3)},
        "spine": (-8 if back else 10, 0, 0), "chest": (-16 if back else 14, 0, 6), "head": (-22 if back else 16, 0, 14),
        "upper_arm.L": arm_r("L", 30, 40), "upper_arm.R": arm_r("R", 30, 40),
        "forearm.L": (-30, 0, 0), "forearm.R": (-30, 0, 0),
    })
    legs_bent = {"thigh.L": (-35, 0, 0), "shin.L": (60, 0, 0), "thigh.R": (-25, 0, 0), "shin.R": (45, 0, 0),
                 "foot.L": (-20, 0, 0), "foot.R": (-15, 0, 0), "IK": {"leg.L": None, "leg.R": None}}
    falling = over(reel, dict(legs_bent, **{
        "root": {"r": (sgn * 50, 0, turn), "t": (0, 0, -0.02)},
        "hips": {"t": (0, 0, -0.12)},
        "upper_arm.L": arm_r("L", 70 if back else 110, 55), "upper_arm.R": arm_r("R", 60 if back else 110, 55),
    }))
    final_arms = {
        "upper_arm.L": arm_r("L", 15 if back else 150, 70, 0), "upper_arm.R": arm_r("R", 5 if back else 150, 62, 0),
        "forearm.L": (-25, 0, 0), "forearm.R": (-35, 0, 0), "hand.L": (0, 0, 0), "hand.R": (0, 0, 0),
    }
    final_arms.update(arms)
    lie = over(base, dict(final_arms, **{
        "root": {"r": (sgn * 90, 0, turn)},
        "hips": {"t": (0, 0, 0)},
        "spine": (2 * sgn, 0, 0), "chest": (3 * sgn, 0, 4), "neck": (0, 0, 0),
        "head": (-10 if back else 8, 0, 35 if back else 70),
        "thigh.L": (-10 if back else 3, -8, 0), "shin.L": (14 if back else 5, 0, 0),
        "thigh.R": (-4 if back else 1, 6, 0), "shin.R": (6 if back else 8, 0, 0),
        "foot.L": (-25 if back else 55, 0, 0), "foot.R": (-20 if back else 50, 0, 0),
        "IK": {"leg.L": None, "leg.R": None, "arm.L": None, "arm.R": None},
    }))
    # lift so the lowest body vertex touches the ground
    lift = -P.min_z(body, lie, exclude)
    lie["root"]["t"] = (0, 0, lift + 0.004)
    bounce = plus(lie, {"root": {"t": (0, 0, 0.035)}, "chest": (-4 * sgn * -1, 0, 0), "head": (8 * (1 if back else -1), 0, 0),
                        "upper_arm.L": arm_r("L", 8, 8), "upper_arm.R": arm_r("R", 8, 8)})
    return [(0, base), (5, reel, "out"), (14, falling, "in"), (20, lie, "in"), (24, bounce, "out"), (frames, lie, "smooth")]


# --------------------------------------------------------------------------- rendering
def _set_light(name, rot, energy, color, angle=0.1):
    ld = bpy.data.lights.new(name, "SUN")
    ld.energy = energy
    ld.color = color
    ld.angle = angle
    lo = bpy.data.objects.new(name, ld)
    bpy.context.scene.collection.objects.link(lo)
    lo.rotation_euler = [math.radians(a) for a in rot]
    return lo


def _cleanup(objs):
    for o in objs:
        data = o.data
        bpy.data.objects.remove(o, do_unlink=True)
        if isinstance(data, bpy.types.Camera):
            bpy.data.cameras.remove(data)
        elif isinstance(data, bpy.types.Light):
            bpy.data.lights.remove(data)
        elif isinstance(data, bpy.types.Mesh) and data.users == 0:
            bpy.data.meshes.remove(data)


def _eval_points(objs):
    dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    for o in objs:
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        mw = o.matrix_world
        pts += [mw @ v.co for v in me.vertices]
        ev.to_mesh_clear()
    return pts


def _cam_basis(yaw, pitch):
    y, p = math.radians(yaw), math.radians(pitch)
    d = Vector((math.sin(y) * math.cos(p), -math.cos(y) * math.cos(p), math.sin(p)))  # centre -> camera
    right = Vector((math.cos(y), math.sin(y), 0.0))
    up = d.cross(right).normalized() * -1
    if up.z < 0:
        up = -up
    return d, right, up


def _render_setup(W, H, transparent, bg=(0.3, 0.32, 0.36), samples=32):
    scene = bpy.context.scene
    world = scene.world or bpy.data.worlds.new("_World")
    scene.world = world
    bgn = world.node_tree.nodes.get("Background")
    if bgn:
        bgn.inputs["Color"].default_value = (*bg, 1)
        bgn.inputs["Strength"].default_value = 0.9
    scene.render.engine = "BLENDER_EEVEE"
    scene.eevee.taa_render_samples = samples
    scene.render.resolution_x, scene.render.resolution_y = W, H
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = transparent
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA" if transparent else "RGB"
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"


def _pose_from_action(rig, action, frame):
    """Freeze the pose of `rig` at (action, frame). Works on rig copies too (Blender 5 slotted actions:
    the slot must be assigned explicitly when the object name differs from the one that authored it)."""
    act = bpy.data.actions.get(action)
    rig.animation_data_create()
    rig.animation_data.action = act
    if act is not None and len(act.slots) and rig.animation_data.action_slot is None:
        rig.animation_data.action_slot = act.slots[0]
    bpy.context.scene.frame_set(frame)
    rig.animation_data.action = None


def render_sheet(path, rig, body, entries, cell=260, yaw=35, pitch=14, labels=True):
    """Contact sheet for review: one copy of the character per (action, frame) side by side, on a ground."""
    scene = bpy.context.scene
    temp = []
    d, right, up = _cam_basis(yaw, pitch)
    height = max(v.z for v in (body.matrix_world @ Vector(c) for c in body.bound_box))
    spacing = max(1.25, height * 0.95)
    copies = []
    for i, (act, fr) in enumerate(entries):
        r2 = rig.copy()
        scene.collection.objects.link(r2)
        r2.animation_data_clear()
        r2.location = right * (i * spacing)
        b2 = body.copy()
        scene.collection.objects.link(b2)
        b2.parent = r2
        b2.modifiers["Armature"].object = r2
        _pose_from_action(r2, act, fr)
        copies += [r2, b2]
    rig.hide_render = body.hide_render = True
    rig.location.x += 1000
    bpy.context.view_layer.update()
    pts = _eval_points([o for o in copies if o.type == "MESH"])
    xs = [p.dot(right) for p in pts]
    ys = [p.dot(up) for p in pts]
    xs.append(0)
    W, H = cell * len(entries), int(cell * 1.35)
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    ext = max((max(xs) - min(xs)) * 1.06, (max(ys) - min(ys)) * 1.12 * W / H)
    centre = right * cx + up * cy
    centre -= d * centre.dot(d)
    cam_data = bpy.data.cameras.new("_SheetCam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = ext
    cam_data.clip_end = 200
    cam = bpy.data.objects.new("_SheetCam", cam_data)
    scene.collection.objects.link(cam)
    cam.location = centre + d * 40
    cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam
    temp.append(cam)
    gm = bpy.data.materials.get("_Ground") or bpy.data.materials.new("_Ground")
    gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.16, 0.2, 0.14, 1)
    gm.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 1.0
    me = bpy.data.meshes.new("_Ground")
    n = len(entries)
    x0, x1 = -1.5, (n - 1) * spacing + 1.5
    corners = [right * x0 + Vector((0, -3, 0)), right * x1 + Vector((0, -3, 0)), right * x1 + Vector((0, 3, 0)) , right * x0 + Vector((0, 3, 0))]
    me.from_pydata([tuple(c) for c in corners], [], [(0, 1, 2, 3)])
    me.materials.append(gm)
    ground = bpy.data.objects.new("_Ground", me)
    scene.collection.objects.link(ground)
    temp.append(ground)
    temp.append(_set_light("_Key", (50, 0, -35), 3.2, (1.0, 0.96, 0.9), 0.05))
    temp.append(_set_light("_Fill", (60, 0, 140), 1.0, (0.8, 0.88, 1.0)))
    _render_setup(W, H, False, bg=(0.42, 0.46, 0.52), samples=16)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print(f"[sheet] {path}")
    _cleanup(temp)
    for o in copies:
        bpy.data.objects.remove(o, do_unlink=True)
    rig.location.x -= 1000
    rig.hide_render = body.hide_render = False
    bpy.context.view_layer.update()


def render_ui(path, rig, body, action, frame, size, mode="full", yaw=32, pitch=6, lens=85, spec=None, poser=None):
    """UI art: 'full' = full body card, 'portrait' = head & shoulders. Transparent PNG, studio lights."""
    scene = bpy.context.scene
    temp = []
    if spec is not None and poser is not None:
        if rig.animation_data:
            rig.animation_data.action = None
        poser.apply(poser.solve(spec))
    else:
        _pose_from_action(rig, action, frame)
    bpy.context.view_layer.update()
    d, right, up = _cam_basis(yaw, pitch)
    pts = _eval_points([body])
    if mode == "portrait":
        pb = rig.pose.bones["head"]
        hh = rig.matrix_world @ pb.head
        ht = rig.matrix_world @ pb.tail
        chest = rig.matrix_world @ rig.pose.bones["chest"].head
        top = max(p.z for p in pts if (p - hh).length < 0.6)
        zc = (top + chest.z) / 2 + 0.02
        centre = Vector((hh.x, hh.y - 0.02, zc + 0.01))
        ext = (top - chest.z) * 1.14
        pts = [p for p in pts if abs(p.z - zc) < ext]
    else:
        xs = [p.dot(right) for p in pts]
        ys = [p.dot(up) for p in pts]
        centre = right * ((min(xs) + max(xs)) / 2) + up * ((min(ys) + max(ys)) / 2)
        centre -= d * centre.dot(d)
        centre.z = (min(p.z for p in pts) + max(p.z for p in pts)) / 2
        ext = max(max(xs) - min(xs), max(ys) - min(ys)) * 1.2
    cam_data = bpy.data.cameras.new("_UICam")
    cam_data.lens = lens
    cam_data.sensor_width = 36
    fov = 2 * math.atan(18 / lens)
    dist = (ext / 2) / math.tan(fov / 2)
    cam_data.clip_start = 0.05
    cam_data.clip_end = dist * 10
    cam = bpy.data.objects.new("_UICam", cam_data)
    scene.collection.objects.link(cam)
    cam.location = centre + d * dist
    cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam
    temp.append(cam)
    temp.append(_set_light("_Key", (55, 0, -40), 3.6, (1.0, 0.93, 0.82), 0.08))
    temp.append(_set_light("_Fill", (70, 0, 120), 1.1, (0.72, 0.82, 1.0), 0.2))
    temp.append(_set_light("_Rim", (-60, 0, 20), 3.2, (1.0, 0.86, 0.6), 0.05))
    temp.append(_set_light("_Top", (5, 0, 0), 0.8, (1.0, 1.0, 1.0), 0.3))
    _render_setup(size, size, True, bg=(0.28, 0.27, 0.3), samples=64)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print(f"[ui] {path}")
    _cleanup(temp)
    poser and poser.rest()
    bpy.context.view_layer.update()
