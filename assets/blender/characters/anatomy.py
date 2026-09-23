"""Anatomy for the v0.2 humanoids: ONE continuous, watertight body built from metaballs (+ a sculpted head),
fused by voxel remesh (HIGH, for baking) and re-topologised by QuadriFlow (LOW, clean quads, game budget).

Everything is authored in the BIND pose (A-pose: arms ~42 deg below horizontal, see pipeline.APOSE) from the
joint positions of the rig, character facing -Y, metres, feet on z = 0.

    J = pipeline.joints(rig)                  # {bone: (head, tail)} in the A-pose
    high = body_high(J, BUILD["hero"], FACE["stern"])
    low = body_low(high, J, faces=3600)       # denser on the face and hands (space-warp trick)
"""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector
from mathutils.bvhtree import BVHTree

# metaball field: surface radius R = r * sqrt(1 - (t/s)^(1/3)) for an isolated element (t threshold, s stiffness)
MB_T, MB_S = 0.6, 2.0
MB_K = math.sqrt(1.0 - (MB_T / MB_S) ** (1.0 / 3.0))     # 0.575


# =============================================================================== presets
BUILD = {
    # m = muscle, fat = belly/softness, sh = shoulder width scale, arm/leg = limb thickness, hand = hand size
    "hero":    dict(m=1.0, fat=0.0, sh=1.0, arm=1.0, leg=1.0, hand=1.0, neck=1.0, female=False, chest=1.0, hips=1.0),
    "slim":    dict(m=0.75, fat=0.0, sh=0.94, arm=0.9, leg=0.92, hand=0.95, neck=0.92, female=False, chest=0.92, hips=0.96),
    "burly":   dict(m=1.25, fat=0.35, sh=1.1, arm=1.2, leg=1.1, hand=1.12, neck=1.15, female=False, chest=1.12, hips=1.05),
    "portly":  dict(m=0.8, fat=1.0, sh=1.02, arm=1.05, leg=1.05, hand=1.05, neck=1.08, female=False, chest=1.05, hips=1.1),
    "elder":   dict(m=0.6, fat=0.1, sh=0.92, arm=0.86, leg=0.88, hand=0.95, neck=0.9, female=False, chest=0.92, hips=0.95),
    "female":  dict(m=0.6, fat=0.15, sh=0.88, arm=0.84, leg=0.95, hand=0.86, neck=0.85, female=True, chest=0.9, hips=1.12),
    "goblin":  dict(m=0.9, fat=0.25, sh=0.95, arm=0.8, leg=0.85, hand=1.25, neck=0.8, female=False, chest=0.95, hips=0.95),
}

FACE = {
    # proportions of the head (metres) and facial features; 1.0 = average adult
    "stern":   dict(w=0.076, d=0.098, h=0.118, jaw=1.08, chin=1.1, brow=1.15, cheek=1.0, nose=1.05, nose_w=1.0,
                    lips=0.95, ears=1.0, ear_point=0.0, eye=1.0, age=0.2, nose_hook=0.0, sneer=0.0),
    "young":   dict(w=0.074, d=0.096, h=0.116, jaw=0.95, chin=0.95, brow=0.95, cheek=1.05, nose=0.95, nose_w=0.92,
                    lips=1.0, ears=0.95, ear_point=0.0, eye=1.02, age=0.0, nose_hook=0.0, sneer=0.0),
    "gaunt":   dict(w=0.072, d=0.097, h=0.119, jaw=0.95, chin=1.05, brow=1.1, cheek=1.2, nose=1.12, nose_w=0.95,
                    lips=0.85, ears=1.05, ear_point=0.0, eye=0.97, age=0.6, nose_hook=0.35, sneer=0.0),
    "old":     dict(w=0.074, d=0.097, h=0.117, jaw=0.95, chin=0.95, brow=1.15, cheek=1.1, nose=1.15, nose_w=1.08,
                    lips=0.85, ears=1.12, ear_point=0.0, eye=0.95, age=1.0, nose_hook=0.2, sneer=0.0),
    "woman":   dict(w=0.071, d=0.093, h=0.112, jaw=0.85, chin=0.88, brow=0.8, cheek=1.1, nose=0.88, nose_w=0.85,
                    lips=1.12, ears=0.9, ear_point=0.0, eye=1.05, age=0.25, nose_hook=0.0, sneer=0.0),
    "broad":   dict(w=0.08, d=0.1, h=0.12, jaw=1.2, chin=1.05, brow=1.2, cheek=1.05, nose=1.1, nose_w=1.2,
                    lips=1.0, ears=1.05, ear_point=0.0, eye=0.95, age=0.4, nose_hook=0.0, sneer=0.0),
    "goblin":  dict(w=0.095, d=0.11, h=0.118, jaw=1.05, chin=1.3, brow=1.45, cheek=1.2, nose=1.9, nose_w=1.05,
                    lips=1.1, ears=2.3, ear_point=1.0, eye=1.25, age=0.5, nose_hook=0.6, sneer=1.0),
}


# =============================================================================== metaball helpers
class MB:
    """A metaball object; elements are specified by their SURFACE radius (metres), not the field radius."""

    def __init__(self, name, res=0.006):
        self.data = bpy.data.metaballs.new(name)
        self.data.resolution = res
        self.data.render_resolution = res
        self.data.threshold = MB_T
        self.obj = bpy.data.objects.new(name, self.data)
        bpy.context.scene.collection.objects.link(self.obj)

    def _el(self, kind, co, R, rot=None, neg=False, stiff=MB_S):
        e = self.data.elements.new(type=kind)
        e.co = tuple(co)
        e.radius = R / MB_K
        e.stiffness = stiff
        e.use_negative = neg
        if rot is not None:
            e.rotation = rot
        return e

    def ball(self, co, R, neg=False, stiff=MB_S):
        return self._el("BALL", co, R, neg=neg, stiff=stiff)

    def capsule(self, a, b, R, neg=False, stiff=MB_S):
        a, b = Vector(a), Vector(b)
        d = b - a
        e = self._el("CAPSULE", (a + b) / 2, R, Vector((1, 0, 0)).rotation_difference(d.normalized()), neg, stiff)
        e.size_x = d.length / 2                  # capsule size_x = absolute half-length (ellipsoid sizes are relative)
        return e

    def ellipsoid(self, co, radii, frame=None, neg=False, stiff=MB_S):
        """radii (x, y, z) of the surface along the frame axes (frame = 3x3 Matrix columns or None = world)."""
        R = max(radii)
        rot = frame.to_quaternion() if frame is not None else None
        e = self._el("ELLIPSOID", co, R, rot, neg, stiff)
        e.size_x, e.size_y, e.size_z = (radii[0] / R, radii[1] / R, radii[2] / R)
        return e

    def to_mesh(self, name):
        dg = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(self.obj.evaluated_get(dg))
        me.name = name
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        bpy.data.objects.remove(self.obj, do_unlink=True)
        bpy.data.metaballs.remove(self.data)
        return ob


def frame_along(d, up=(0, 0, 1)):
    """3x3 frame whose Z axis is along d (X roughly perpendicular to `up`)."""
    z = Vector(d).normalized()
    u = Vector(up)
    if abs(z.dot(u)) > 0.95:
        u = Vector((0, -1, 0))
    x = u.cross(z).normalized()
    y = z.cross(x)
    return Matrix((x, y, z)).transposed()


def _line_factor(spacing=0.3):
    """Element radius / surface radius for an infinite line of balls spaced `spacing` * r apart (numeric)."""
    def field(d, r):
        xs = np.arange(-40, 41) * spacing * r
        q = 1.0 - (d * d + xs * xs) / (r * r)
        return (MB_S * np.clip(q, 0, None) ** 3).sum()
    lo, hi = 0.3, 3.0          # find r (for surface radius 1) with field(1, r) = t
    for _ in range(50):
        mid = (lo + hi) / 2
        if field(1.0, mid) > MB_T:
            hi = mid
        else:
            lo = mid
    return (lo + hi) / 2


_LF = None


def frame_xz(x, z):
    """Right-handed 3x3 frame with columns (x, z cross x, z)."""
    z = Vector(z).normalized()
    x = (Vector(x) - z * Vector(x).dot(z)).normalized()
    return Matrix((x, z.cross(x), z)).transposed()


def chain(mb, pts, radii, spacing=0.3):
    """Smooth tapered limb: a dense line of balls (field sums to a constant tube) with interpolated radii."""
    global _LF
    if _LF is None:
        _LF = _line_factor(spacing)
    for i in range(len(pts) - 1):
        a, b = Vector(pts[i]), Vector(pts[i + 1])
        L = (b - a).length
        r0 = min(radii[i], radii[i + 1])
        n = max(2, int(math.ceil(L / (spacing * r0 * _LF))))
        for k in range(n + (1 if i == len(pts) - 2 else 0)):
            t = k / n
            R = radii[i] + (radii[i + 1] - radii[i]) * t
            e = mb.data.elements.new(type="BALL")
            e.co = tuple(a.lerp(b, t))
            e.radius = R * _LF
            e.stiffness = MB_S


# =============================================================================== body
def _side_frame(J, side):
    """Arm frame (A-pose): a = down the arm, l = lateral (away from the body), f = forward (-Y)."""
    sh, el = (Vector(p) for p in J[f"upper_arm.{side}"])
    a = (el - sh).normalized()
    f = Vector((0, -1, 0))
    l = f.cross(a).normalized() if side == "R" else a.cross(f).normalized()
    if l.x * (1 if side == "L" else -1) < 0:
        l = -l
    return a, l, f


def body_elements(mb, J, B, bare_feet=False):
    s = (J["head"][1][2] - J["root"][0][2]) / 1.8        # overall scale (1 = 1.8 m)
    m, fat, fem = B["m"], B["fat"], B["female"]
    hip = Vector(J["hips"][0])
    spine = Vector(J["spine"][0])
    chest = Vector(J["chest"][0])
    neck0 = Vector(J["neck"][0])
    head0 = Vector(J["head"][0])
    shL = Vector(J["upper_arm.L"][0])
    shw = abs(shL.x)
    # ---- torso
    cw = 0.158 * s * B["chest"]
    mb.ellipsoid(chest + Vector((0, 0.005 * s, 0.07 * s)), (cw, 0.105 * s * B["chest"], 0.165 * s))           # ribcage
    mb.ellipsoid(chest + Vector((0, 0.012 * s, 0.14 * s)), (cw * 0.98, 0.085 * s, 0.07 * s))                # upper back
    for sx in (1, -1):
        if fem:
            mb.ellipsoid(chest + Vector((sx * 0.062 * s, -0.07 * s, 0.07 * s)), (0.058 * s, 0.05 * s, 0.056 * s))
        else:
            mb.ellipsoid(chest + Vector((sx * 0.066 * s, -0.062 * s, 0.1 * s)), (0.07 * s, 0.035 * s * m, 0.055 * s),
                         frame=Matrix.Rotation(math.radians(sx * -12), 3, "Y"))                               # pecs
        mb.ellipsoid(chest + Vector((sx * 0.1 * s, 0.03 * s, 0.07 * s)), (0.058 * s * (0.8 + 0.25 * m), 0.075 * s, 0.11 * s))  # lats
        mb.capsule(neck0 + Vector((sx * 0.03 * s, 0.02 * s, -0.01 * s)), shL * Vector((sx, 1, 1)) + Vector((-sx * 0.035 * s, 0.015 * s, 0.015 * s)),
                   0.04 * s * (0.8 + 0.25 * m))                                                              # trapezius
        mb.capsule(neck0 + Vector((sx * 0.02 * s, -0.035 * s, -0.035 * s)),
                   shL * Vector((sx, 1, 1)) + Vector((-sx * 0.03 * s, -0.03 * s, -0.005 * s)), 0.022 * s)      # clavicle
    belly = 0.118 * s + 0.035 * s * fat
    mb.ellipsoid(spine + Vector((0, -0.012 * s - 0.02 * s * fat, 0.05 * s)), (0.128 * s + 0.02 * s * fat, 0.092 * s + 0.03 * s * fat, belly))
    if fat > 0.3:
        mb.ellipsoid(spine + Vector((0, -0.05 * s * fat, 0.0)), (0.12 * s * fat, 0.09 * s * fat, 0.11 * s * fat))
    hw = 0.14 * s * B["hips"]
    mb.ellipsoid(hip + Vector((0, 0.0, -0.02 * s)), (hw, 0.098 * s, 0.1 * s))                                   # pelvis
    for sx in (1, -1):
        mb.ellipsoid(hip + Vector((sx * 0.066 * s, 0.05 * s, -0.08 * s)), (0.074 * s * B["hips"], 0.066 * s, 0.085 * s))  # glutes
    # ---- neck
    nr = 0.057 * s * B["neck"]
    mb.capsule(neck0 + Vector((0, 0.012 * s, -0.05 * s)), head0 + Vector((0, 0.005 * s, 0.03 * s)), nr)
    for sx in (1, -1):   # sternocleidomastoid
        mb.capsule(neck0 + Vector((sx * 0.022 * s, -0.035 * s, -0.02 * s)), head0 + Vector((sx * 0.045 * s, 0.01 * s, 0.035 * s)),
                   0.018 * s * B["neck"])
    # ---- arms (A-pose)
    for side in ("L", "R"):
        a, l, f = _side_frame(J, side)
        sh, el = (Vector(p) for p in J[f"upper_arm.{side}"])
        wr = Vector(J[f"forearm.{side}"][1])
        ar = B["arm"]
        # deltoid over the shoulder joint
        mb.ellipsoid(sh + l * 0.02 * s + Vector((0, 0.004, -0.004 * s)), (0.058 * s * ar * (0.85 + 0.2 * m), 0.062 * s * ar, 0.068 * s),
                     frame=frame_along(a))
        chain(mb, [sh + a * 0.02 * s, el], [0.05 * s * ar, 0.04 * s * ar])
        mb.ellipsoid(sh.lerp(el, 0.55) + f * 0.012 * s, (0.028 * s * ar * m, 0.03 * s * ar * m, 0.075 * s), frame=frame_along(a))  # biceps
        mb.ellipsoid(sh.lerp(el, 0.45) - f * 0.018 * s, (0.03 * s * ar, 0.032 * s * ar, 0.08 * s), frame=frame_along(a))         # triceps
        chain(mb, [el, el.lerp(wr, 0.35), wr], [0.04 * s * ar, 0.039 * s * ar, 0.028 * s * ar])
        mb.ellipsoid(el.lerp(wr, 0.25) + l * 0.008 * s, (0.036 * s * ar, 0.031 * s * ar, 0.07 * s), frame=frame_along(wr - el))   # forearm muscles
        hand_elements(mb, J, side, B, s)
    # ---- legs
    for side, sx in (("L", 1), ("R", -1)):
        th0, kn = (Vector(p) for p in J[f"thigh.{side}"])
        an = Vector(J[f"shin.{side}"][1])
        toe = Vector(J[f"foot.{side}"][1])
        lg = B["leg"]
        chain(mb, [th0 + Vector((0, 0.005, 0.02 * s)), th0.lerp(kn, 0.5), kn], [0.085 * s * lg, 0.07 * s * lg, 0.05 * s * lg])
        mb.ellipsoid(th0.lerp(kn, 0.45) + Vector((0.006 * sx, -0.022 * s, 0)), (0.05 * s * lg, 0.05 * s * lg * m ** 0.5, 0.16 * s),
                     frame=frame_along(kn - th0))                                                               # quads
        mb.ellipsoid(th0.lerp(kn, 0.3) + Vector((-sx * 0.035 * s, 0.0, 0)), (0.04 * s * lg, 0.05 * s * lg, 0.12 * s),
                     frame=frame_along(kn - th0))                                                               # adductors
        mb.ball(kn + Vector((0, -0.018 * s, 0)), 0.036 * s * lg)                                                 # knee cap
        chain(mb, [kn, kn.lerp(an, 0.4), an], [0.045 * s * lg, 0.04 * s * lg, 0.028 * s * lg])
        mb.ellipsoid(kn.lerp(an, 0.3) + Vector((0, 0.024 * s, 0)), (0.04 * s * lg, 0.04 * s * lg, 0.09 * s), frame=frame_along(an - kn))  # calf
        # foot: heel -> ball -> toes, flat sole at z ~ 0
        heel = Vector((an.x, an.y + 0.035 * s, 0.04 * s))
        ball_ = Vector((toe.x + sx * 0.004, toe.y + 0.045 * s, 0.03 * s))
        mb.capsule(an + Vector((0, 0.005, -0.01 * s)), heel, 0.032 * s)
        mb.ellipsoid(heel.lerp(ball_, 0.5) + Vector((0, 0, 0.012 * s)), (0.037 * s, 0.075 * s, 0.03 * s))
        mb.ellipsoid(ball_ + Vector((0, -0.02 * s, -0.005 * s)), (0.04 * s, 0.04 * s, 0.022 * s))
        if bare_feet:
            for k in range(4):
                p = ball_ + Vector((sx * (0.022 - 0.015 * k) * s, -0.06 * s, -0.012 * s))
                mb.capsule(p + Vector((0, 0.02, 0)), p, (0.011 - 0.001 * k) * s)


def hand_elements(mb, J, side, B, s):
    """Closed hand (fist around a grip along Y, the weapon convention of parts.grip_matrix), in the A-pose."""
    a, l, f = _side_frame(J, side)
    wr = Vector(J[f"hand.{side}"][0])
    hs = B["hand"] * s
    m = -l                                                    # medial (palm side)
    # palm / back of the hand
    mb.ellipsoid(wr + a * 0.045 * hs + l * 0.004 * hs, (0.018 * hs, 0.04 * hs, 0.048 * hs), frame=frame_xz(l, a))
    # thenar (thumb muscle) on the front-medial side
    mb.ellipsoid(wr + a * 0.03 * hs + m * 0.01 * hs + f * 0.022 * hs, (0.015 * hs, 0.018 * hs, 0.028 * hs), frame=frame_xz(l, a))
    g = wr + a * 0.085 * hs + m * 0.012 * hs                 # grip axis centre
    R = 0.021 * hs
    for k, (fy, fr) in enumerate(((-0.026, 0.0095), (-0.008, 0.01), (0.01, 0.0095), (0.026, 0.0085))):
        off = -f * fy * hs                                    # along the grip axis (index finger in front, -Y)
        pts = []
        for th in (-0.35, 0.35, 1.15, 1.95, 2.6):
            pts.append(g + off + (l * math.cos(th) + a * math.sin(th)) * (R + fr * hs * 0.4))
        pts[0] = pts[0] - a * 0.012 * hs
        for i in range(len(pts) - 1):
            mb.capsule(pts[i], pts[i + 1], fr * hs * (1.0 - 0.08 * i))
    # thumb: from the thenar, over the front of the fingers, tip pointing medial-down
    t0 = wr + a * 0.035 * hs + f * 0.018 * hs + m * 0.006 * hs
    t1 = g + f * 0.038 * hs + m * 0.004 * hs - a * 0.012 * hs
    t2 = g + f * 0.036 * hs + m * 0.022 * hs + a * 0.008 * hs
    mb.capsule(t0, t1, 0.011 * hs)
    mb.capsule(t1, t2, 0.0095 * hs)


# =============================================================================== head
def head_frame(J):
    """Head centre at EYE level (between the ears) and scale factor k (1 = adult 1.8 m head)."""
    h0, h1 = (Vector(p) for p in J["head"])
    hl = (h1 - h0).length
    k = hl / 0.265
    c = h1 - (h1 - h0).normalized() * 0.115 * k
    return c, k


def head_elements(mb, J, F):
    """Skull, jaw, cheekbones, brow ridge, nose, lips, chin, ears. Landmarks in metres around the eye-level centre
    (x = left, y = BACK, z = up); F scales the features."""
    c, k0 = head_frame(J)
    sw, sd, sh = F["w"] / 0.074, F["d"] / 0.097, F["h"] / 0.117

    def P(x, y, z):
        return c + Vector((x * sw, y * sd, z * sh)) * k0

    def R(r):
        return r * k0

    # cranium + forehead + occiput + temples
    mb.ellipsoid(P(0, 0.012, 0.028), (R(0.074 * sw), R(0.092 * sd), R(0.089 * sh)))
    mb.ball(P(0, -0.05, 0.04), R(0.042))
    mb.ellipsoid(P(0, 0.04, -0.01), (R(0.052), R(0.05), R(0.05)))
    for sx in (1, -1):
        mb.ellipsoid(P(sx * 0.047, -0.028, 0.012), (R(0.03), R(0.04), R(0.04)))
    # face block (maxilla), cheekbones, cheeks
    mb.ellipsoid(P(0, -0.04, -0.044), (R(0.063), R(0.057), R(0.066)))
    for sx in (1, -1):
        mb.ellipsoid(P(sx * 0.055, -0.05, -0.012), (R(0.02 * F["cheek"]), R(0.022), R(0.015)))
    # jaw: ramus + mandible body, chin
    jw = F["jaw"]
    for sx in (1, -1):
        mb.capsule(P(sx * 0.057, 0.0, -0.03), P(sx * 0.05 * jw, -0.004, -0.08), R(0.017 * jw))
        mb.capsule(P(sx * 0.05 * jw, -0.004, -0.08), P(sx * 0.018, -0.07, -0.102), R(0.017 * jw))
    ch = F["chin"]
    mb.ellipsoid(P(0, -0.083 - 0.004 * (ch - 1), -0.106), (R(0.021 * ch), R(0.016), R(0.018 * ch)))
    # muzzle + lips + mouth line
    lp = F["lips"]
    mb.ellipsoid(P(0, -0.082, -0.07), (R(0.029), R(0.022), R(0.026)))
    mb.ellipsoid(P(0, -0.098, -0.066), (R(0.021), R(0.0075 * lp), R(0.0062 * lp)))
    mb.ellipsoid(P(0, -0.096, -0.082), (R(0.018), R(0.0085 * lp), R(0.0068 * lp)))
    mb.capsule(P(-0.022, -0.106, -0.0745), P(0.022, -0.106, -0.0745), R(0.0022), neg=True, stiff=4.0)
    # brow ridge + glabella
    br = F["brow"]
    for sx in (1, -1):
        mb.capsule(P(sx * 0.012, -0.086, 0.02), P(sx * 0.05, -0.072, 0.019), R(0.0085 * br))
    mb.ball(P(0, -0.086, 0.017), R(0.01 * br))
    # eye sockets (negative; the eyeballs sit in them)
    es = F["eye"]
    for sx in (1, -1):
        mb.ellipsoid(P(sx * 0.032, -0.09, 0.0005), (R(0.0142 * es), R(0.011), R(0.0078 * es)), neg=True, stiff=3.0)
    # nose: nasion -> dorsum -> tip, alae, nostrils
    nl, nw, hk = F["nose"], F["nose_w"], F["nose_hook"]
    tip = P(0, -0.102 - 0.017 * nl, -0.036 - 0.008 * nl)
    top = P(0, -0.092, 0.005)
    mid = top.lerp(tip, 0.5) + Vector((0, -0.004 * hk, 0.004 * hk)) * k0
    mb.capsule(top, mid, R(0.0075 * nw))
    mb.capsule(mid, tip, R(0.0088 * nw))
    mb.ball(tip, R(0.0108 * nw))
    for sx in (1, -1):
        mb.ball(tip + Vector((sx * 0.0122 * nw, 0.012, -0.007)) * k0, R(0.0074 * nw))
        mb.ball(tip + Vector((sx * 0.0058 * nw, 0.004, -0.012)) * k0, R(0.0032), neg=True, stiff=4.0)
    # ears
    ek, ep = F["ears"], F["ear_point"]
    for sx in (1, -1):
        e0 = P(sx * 0.071, 0.012, -0.006)
        fr = Matrix.Rotation(math.radians(sx * -20), 3, "Z") @ Matrix.Rotation(math.radians(-8), 3, "X")
        mb.ellipsoid(e0 + Vector((sx * 0.006, 0, 0)) * k0, (R(0.0055), R(0.016 * ek ** 0.5), R(0.029 * ek ** 0.6)), frame=fr)
        mb.ellipsoid(e0 + Vector((sx * 0.011, -0.003, -0.004)) * k0, (R(0.004), R(0.007), R(0.011)), frame=fr, neg=True, stiff=3.0)
        if ep > 0:     # long pointed ear sweeping up and back
            tipp = e0 + Vector((sx * 0.065 * ek, 0.03 * ek, 0.045 * ek)) * k0
            mb.capsule(e0 + Vector((sx * 0.008, 0.004, 0.004)) * k0, tipp, R(0.008 * ek ** 0.5))
            mb.capsule(e0 + Vector((sx * 0.008, 0.0, 0.016)) * k0, e0.lerp(tipp, 0.55) + Vector((0, 0, 0.012)) * k0,
                       R(0.01 * ek ** 0.5))


def eye_positions(J, F):
    c, k0 = head_frame(J)
    sw, sd, sh = F["w"] / 0.074, F["d"] / 0.097, F["h"] / 0.117
    es = F["eye"]
    return [(c + Vector((sx * 0.032 * sw, -0.0745 * sd, 0.0)) * k0, 0.0112 * k0 * es) for sx in (1, -1)]


# =============================================================================== high / low
def _smooth(obj, iters=3, factor=0.5):
    md = obj.modifiers.new("Sm", "SMOOTH")
    md.iterations = iters
    md.factor = factor
    _apply(obj)


def _apply(obj):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    for md in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=md.name)


def body_high(J, B, F, voxel=0.0045, bare_feet=False, extra=None):
    """HIGH body: body metaballs + head metaballs (finer) fused by a voxel remesh -> watertight."""
    mb = MB("_BodyMB", 0.007)
    body_elements(mb, J, B, bare_feet)
    if extra:
        extra(mb)
    body = mb.to_mesh("_BodyHigh")
    mh = MB("_HeadMB", 0.0032)
    head_elements(mh, J, F)
    head = mh.to_mesh("_HeadHigh")
    # union
    for o in bpy.context.scene.objects:
        o.select_set(False)
    body.select_set(True)
    head.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    md = body.modifiers.new("Vox", "REMESH")
    md.mode = "VOXEL"
    md.voxel_size = voxel
    md.adaptivity = 0.0
    _apply(body)
    # smooth the body (capsule steps) but not the face
    c, k = head_frame(J)
    vg = body.vertex_groups.new(name="_smooth")
    for v in body.data.vertices:
        d = (v.co - c).length / k
        vg.add([v.index], float(min(1.0, max(0.0, (d - 0.12) / 0.06))), "REPLACE")
    md = body.modifiers.new("Sm", "SMOOTH")
    md.iterations = 12
    md.factor = 0.6
    md.vertex_group = "_smooth"
    _apply(body)
    if body.vertex_groups.get("_smooth"):
        body.vertex_groups.remove(body.vertex_groups["_smooth"])
    _smooth(body, 1, 0.3)
    for p in body.data.polygons:
        p.use_smooth = True
    return body


def _warp_fields(J):
    c, k = head_frame(J)
    fields = [(c + Vector((0, -0.03 * k, -0.02 * k)), 0.085 * k, 1.9)]      # face: ~3.6x more faces
    for side in ("L", "R"):
        w = Vector(J[f"hand.{side}"][0])
        a = (Vector(J[f"hand.{side}"][1]) - w).normalized()
        fields.append((w + a * 0.07, 0.07, 1.45))
    return fields


def _warp(co, fields, inverse=False):
    out = co.copy()
    for c, sig, kf in fields:
        c = np.array(c)
        d = co - c
        r = np.linalg.norm(d, axis=1)
        if not inverse:
            f = 1.0 + (kf - 1.0) * np.exp(-(r / sig) ** 2)
            out += d * (f - 1.0)[:, None]
        else:   # radial inversion by bisection (fields are far apart)
            infl = np.exp(-(r / (sig * kf)) ** 2) > 1e-4
            idx = np.nonzero(infl)[0]
            lo = np.zeros(len(idx))
            hi = r[idx].copy()
            for _ in range(40):
                mid = (lo + hi) / 2
                val = mid * (1.0 + (kf - 1.0) * np.exp(-(mid / sig) ** 2))
                big = val > r[idx]
                hi = np.where(big, mid, hi)
                lo = np.where(big, lo, mid)
            rr = (lo + hi) / 2
            scale = np.where(r[idx] > 1e-9, rr / np.maximum(r[idx], 1e-9), 1.0)
            out[idx] = c + d[idx] * scale[:, None]
    return out


def _get_co(me):
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", co)
    return co.reshape(-1, 3)


def _set_co(me, co):
    me.vertices.foreach_set("co", co.ravel())
    me.update()


def body_low(high, J, faces=3600, name="Body", seed=3):
    """LOW body: copy of the high, warped (face & hands enlarged), QuadriFlow remesh, un-warped, snapped back."""
    low = high.copy()
    low.data = high.data.copy()
    low.name = name
    low.data.name = name
    bpy.context.scene.collection.objects.link(low)
    fields = _warp_fields(J)
    md = low.modifiers.new("Dec", "DECIMATE")          # QuadriFlow input: ~80k faces is plenty (and 10x faster)
    md.ratio = min(1.0, 80000 / max(1, len(low.data.polygons)))
    _apply(low)
    _set_co(low.data, _warp(_get_co(low.data), fields))
    for o in bpy.context.scene.objects:
        o.select_set(False)
    low.select_set(True)
    bpy.context.view_layer.objects.active = low
    r = bpy.ops.object.quadriflow_remesh(target_faces=faces, use_mesh_symmetry=True, use_preserve_sharp=False,
                                         use_preserve_boundary=False, smooth_normals=False, seed=seed)
    if "FINISHED" not in r:
        raise RuntimeError("quadriflow failed")
    _set_co(low.data, _warp(_get_co(low.data), fields, inverse=True))
    snap(low, high)
    # QuadriFlow can emit a few flipped faces: make the closed body consistently outward
    bm = bmesh.new()
    bm.from_mesh(low.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(low.data)
    bm.free()
    for p in low.data.polygons:
        p.use_smooth = True
    return low


def snap(low, high, iters=1):
    """Project every low vertex onto the nearest high surface point (shrinkwrap)."""
    co_h = _get_co(high.data)
    polys = [tuple(p.vertices) for p in high.data.polygons]
    tree = BVHTree.FromPolygons([tuple(v) for v in co_h], polys)
    co = _get_co(low.data)
    for i in range(len(co)):
        q, _, _, _ = tree.find_nearest(Vector(co[i]))
        if q is not None:
            co[i] = q
    _set_co(low.data, co)


def relax(obj, iters=2, factor=0.4):
    md = obj.modifiers.new("Relax", "SMOOTH")
    md.iterations = iters
    md.factor = factor
    _apply(obj)
