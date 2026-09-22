"""Slime ("Gluant"): ~0.8 m glossy green gumdrop blob with big eyes, blush, open smile and a leaf sprout.

Rig: root -> body -> (top, eyes, mouth). Squash & stretch is done with bone SCALE + location.
"""
import math

from mathutils import Euler, Matrix, Vector

import common as C
import meshkit as M
import rigkit as R
from rigkit import Track, ease_in, ease_out, smooth

PREVIEW = ("Idle", 0)
CLIPS = ("Idle", "Walk", "Attack", "Hit", "Death")
SHEET = [("Idle", [0, 12, 24, 36]), ("Walk", [0, 4, 9, 14, 16]), ("Attack", [0, 4, 6, 8, 11]),
         ("Hit", [0, 2, 5, 9]), ("Death", [0, 4, 10, 20, 29])]

# gumdrop profile (radius, height)
PROFILE = [(0.0, 0.0), (0.36, 0.0), (0.455, 0.03), (0.51, 0.09), (0.53, 0.17), (0.52, 0.26), (0.49, 0.35),
           (0.44, 0.44), (0.375, 0.53), (0.295, 0.61), (0.205, 0.68), (0.12, 0.735), (0.05, 0.768), (0.0, 0.782)]
EYE_Z = 0.37
MOUTH_Z = 0.235
TOP_Z = 0.47


def _radius_at(z):
    for (r0, z0), (r1, z1) in zip(PROFILE[1:], PROFILE[2:]):
        if z0 <= z <= z1:
            u = (z - z0) / (z1 - z0)
            return r0 + (r1 - r0) * u, math.atan2(r0 - r1, z1 - z0)
    return PROFILE[-2][0], 0.0


def _lean(z):
    """the upper part of the drop leans slightly backwards (+Y) for a cute silhouette"""
    return 0.05 * max(0.0, (z - 0.45) / 0.33) ** 2


def surface(phi_deg, z, inset=0.0):
    """Point on the body surface at azimuth phi (0 = front/-Y, + = character's left/+X) and height z,
    plus a rotation matrix whose local -Y axis is the outward normal."""
    r, tilt = _radius_at(z)
    phi = math.radians(phi_deg)
    p = Vector((math.sin(phi) * (r - inset), -math.cos(phi) * (r - inset) + _lean(z), z))
    rot = Euler((-tilt, 0, phi), "XYZ").to_matrix()
    return p, rot


def place(obj, phi, z, inset=0.0, local=(0, 0, 0), extra_rot=(0, 0, 0)):
    p, rot = surface(phi, z, inset)
    e = Euler([math.radians(a) for a in extra_rot], "XYZ").to_matrix()
    Mx = Matrix.Translation(p + rot @ Vector(local)) @ (rot @ e).to_4x4()
    obj.data.transform(Mx)
    obj.data.update()
    return obj


def leaf(name, length, width, thick, mat):
    L, W, T = length, width, thick
    verts = [(0, 0, 0), (0, 0, L), (-W, 0, 0.42 * L), (W, 0, 0.42 * L), (0, -T, 0.45 * L), (0, T, 0.45 * L)]
    faces = [(0, 2, 4), (2, 1, 4), (1, 3, 4), (3, 0, 4), (0, 5, 2), (2, 5, 1), (1, 5, 3), (3, 5, 0)]
    return M.from_pydata(name, verts, faces, mat)


def build():
    body_mat = M.vcol_material("slime_gel", rough=0.16, emit=C.hex_color("#3fcf55"), emit_strength=0.22)
    eye_mat = C.material("slime_eye", C.hex_color("#15171c"), rough=0.08)
    white = C.material("slime_shine", C.hex_color("#ffffff"), rough=0.2, emit=C.hex_color("#ffffff"), emit_strength=0.6)
    mouth_mat = C.material("slime_mouth", C.hex_color("#3b1322"), rough=0.5)
    tongue_mat = C.material("slime_tongue", C.hex_color("#ff6f8a"), rough=0.45)
    cheek_mat = C.material("slime_blush", C.hex_color("#ff8ea6"), rough=0.6, emit=C.hex_color("#ff7a96"), emit_strength=0.15)
    leaf_mat = C.material("slime_leaf", C.hex_color("#63b536"), rough=0.6)
    stem_mat = C.material("slime_stem", C.hex_color("#7a8f2e"), rough=0.7)

    rig = R.build_armature([
        ("root", (0, 0, 0), (0, 0, 0.18), None),
        ("body", (0, 0, 0), (0, 0, TOP_Z), "root"),
        ("top", (0, 0, TOP_Z), (0, 0.04, 0.8), "body"),
        ("eyes", (0, -0.43, EYE_Z), (0, -0.43, EYE_Z + 0.1), "body"),
        ("mouth", (0, -0.5, MOUTH_Z), (0, -0.5, MOUTH_Z + 0.06), "body"),
    ])

    # ---- body: lathe gumdrop, slightly leaning back at the tip, gradient colours
    body = M.lathe("slime_body", PROFILE, n=20, mat=body_mat, smooth=True, phase=0.5)
    for v in body.data.vertices:
        v.co.y += _lean(v.co.z)
    lo, mid, hi = C.hex_color("#23873a"), C.hex_color("#46be4a"), C.hex_color("#9fec76")

    def grad(co, n):
        z = co.z
        if z < 0.34:
            c = R.lerp(lo, mid, smooth(z / 0.34))
        else:
            c = R.lerp(mid, hi, smooth((z - 0.34) / 0.44))
        # soft front-top sheen
        return c

    M.vertex_colors(body, grad)

    def wbody(co):
        w = smooth((co.z - TOP_Z) / 0.24)
        return {"body": 1 - w, "top": w}

    R.blended(body, wbody)
    parts = [body]

    # ---- eyes (glossy black with two highlights each)
    for side in (1, -1):
        phi = 21 * side
        eye = M.ellipsoid(f"eye{side}", (0.072, 0.034, 0.098), eye_mat, seg=10, rings=6)
        place(eye, phi, EYE_Z, inset=0.012)
        R.rigid(eye, "eyes")
        hl = M.ellipsoid(f"eyehl{side}", (0.026, 0.012, 0.03), white, seg=6, rings=4)
        place(hl, phi, EYE_Z, inset=0.012, local=(-0.022, -0.032, 0.04))
        R.rigid(hl, "eyes")
        hl2 = M.ellipsoid(f"eyehl2{side}", (0.012, 0.008, 0.013), white, seg=5, rings=3)
        place(hl2, phi, EYE_Z, inset=0.012, local=(0.025, -0.028, -0.035))
        R.rigid(hl2, "eyes")
        cheek = M.ellipsoid(f"cheek{side}", (0.055, 0.014, 0.03), cheek_mat, seg=8, rings=5)
        place(cheek, 40 * side, 0.265, inset=0.006)
        R.rigid(cheek, "body")
        parts += [eye, hl, hl2, cheek]

    # ---- open smile (D shape) with a little tongue
    mouth = M.ellipsoid("mouth", (0.07, 0.026, 0.05), mouth_mat, seg=10, rings=6)
    for v in mouth.data.vertices:
        if v.co.z > 0:
            v.co.z *= 0.12
    place(mouth, 0, MOUTH_Z, inset=0.012)
    tongue = M.ellipsoid("tongue", (0.038, 0.02, 0.02), tongue_mat, seg=6, rings=4)
    place(tongue, 0, MOUTH_Z, inset=0.012, local=(0, -0.014, -0.028))
    R.rigid(mouth, "mouth")
    R.rigid(tongue, "mouth")
    parts += [mouth, tongue]

    # ---- glossy shine on the upper-left
    for i, (phi, z, rx, rz) in enumerate(((-38, 0.6, 0.075, 0.035), (-52, 0.52, 0.025, 0.02))):
        sh = M.ellipsoid(f"shine{i}", (rx, 0.012, rz), white, seg=8, rings=4)
        place(sh, phi, z, inset=0.004, extra_rot=(0, 25, 0))
        R.blended(sh, wbody)
        parts.append(sh)

    # ---- leaf sprout on the tip
    tip = Vector((0, _lean(0.78), 0.765))
    stem = M.cone("stem", 0.018, 0.012, 0.085, n=6, mat=stem_mat, loc=tip, rot=(-12, 0, 0))
    R.rigid(stem, "top")
    parts.append(stem)
    stem_top = tip + Euler((math.radians(-12), 0, 0)).to_matrix() @ Vector((0, 0, 0.08))
    for side, yaw in ((1, 20), (-1, 200)):
        lf = leaf(f"leaf{side}", 0.15 if side > 0 else 0.12, 0.05, 0.012, leaf_mat)
        M.transform(lf, loc=stem_top, rot=(0, 58 * side, yaw))
        R.rigid(lf, "top")
        parts.append(lf)

    R.skin(parts, rig, "Slime")
    mesh = rig.children[0]
    for p in mesh.data.polygons:  # smooth jelly body, crisp details
        p.use_smooth = mesh.data.materials[p.material_index].name in ("slime_gel", "slime_eye", "slime_blush", "slime_shine")

    animate(rig)
    return rig


# ------------------------------------------------------------------------------------------------ animation
def sq(k, extra_xy=1.0):
    """volume-preserving squash/stretch scale (armature axes)."""
    xy = extra_xy / math.sqrt(max(k, 0.05))
    return (xy, xy, k)


def rock(theta, sxy, base=0.44):
    """Translation that makes a lean of `theta` degrees (about X) pivot on the base edge instead of the
    base centre, so the jelly rolls onto its rim rather than sinking into the ground."""
    if abs(theta) < 1e-6:
        return (0.0, 0.0, 0.0)
    th = math.radians(theta)
    py = -math.copysign(base * sxy, theta)
    return (0.0, py - py * math.cos(th), -py * math.sin(th))


def body(k, lean=0.0, extra_xy=1.0):
    s = sq(k, extra_xy)
    return {"s": s, "r": (lean, 0, 0), "t": rock(lean, s[0])}


def animate(rig):
    A = R.Animator(rig)

    # Idle: 2 s jelly breathing, top wobble, one blink
    blink = Track([(0, 1), (0.6, 1), (0.64, 0.08), (0.69, 0.08), (0.74, 1), (1, 1)])

    def idle(t):
        k = 1 + 0.045 * R.wave(t, 2)
        return {
            "body": {"s": sq(k)},
            "top": {"r": (4.0 * R.wave(t, 2, -0.12), 3.0 * R.wave(t, 1), 0)},
            "eyes": {"s": (1, 1, blink(t))},
            "mouth": {"s": (1 + 0.06 * R.wave(t, 2), 1, 1 + 0.12 * R.wave(t, 2))},
        }

    A.clip("Idle", 48, idle)

    # Walk: hopping bounce, 20 frames (0.83 s). t=0 is the landing squash.
    t_off, t_land, hop = 0.2, 0.72, 0.3
    kz = Track([(0, 0.8), (0.1, 0.76), (0.2, 1.24, ease_out), (0.42, 1.05), (0.66, 1.1), (0.72, 1.12),
                (0.8, 0.72, ease_out), (0.9, 0.84), (1.0, 0.8)])
    lean = Track([(0, 0), (0.12, -4), (0.22, 9), (0.5, 4), (0.72, -5), (0.84, 0), (1, 0)])
    lag = Track([(0, 5), (0.12, 7), (0.24, -12), (0.46, -5), (0.72, 6), (0.82, 12), (0.92, 6), (1, 5)])
    mouthw = Track([(0, 1), (0.2, 1.1), (0.4, 1.6), (0.65, 1.3), (0.78, 0.9), (1, 1)])
    squint = Track([(0, 0.84), (0.1, 0.9), (0.2, 1.0), (0.72, 1.0), (0.8, 0.8), (1, 0.84)])

    def walk(t):
        if t_off < t < t_land:
            u = (t - t_off) / (t_land - t_off)
            z = 4 * hop * u * (1 - u)
        else:
            z = 0.0
        return {
            "root": {"t": (0, 0, z)},
            "body": body(kz(t), lean(t)),
            "top": {"r": (lag(t), 0, 0)},
            "eyes": {"s": (1, 1, squint(t))},
            "mouth": {"s": (1 + 0.3 * (mouthw(t) - 1), 1, mouthw(t))},
        }

    A.clip("Walk", 20, walk)

    # Attack: wind-up, lunge forward (-Y) through the air, slam squash, return. 15 frames (0.63 s)
    ay = Track([(0, 0), (0.26, 0.1), (0.44, -0.42, ease_out), (0.62, -0.44), (1, 0)])
    az = Track([(0, 0), (0.26, 0), (0.36, 0.2, ease_out), (0.52, 0.0, ease_in), (1, 0)])
    ak = Track([(0, 1), (0.26, 0.74), (0.36, 1.28, ease_out), (0.5, 1.1), (0.58, 0.6, ease_in), (0.74, 0.88), (0.88, 1.05), (1, 1)])
    axy = Track([(0, 1), (0.5, 1), (0.58, 1.12), (0.74, 1.0), (1, 1)])
    al = Track([(0, 0), (0.26, -16), (0.4, 24), (0.58, 10), (0.8, -3), (1, 0)])
    at = Track([(0, 0), (0.26, -10), (0.42, -12), (0.58, 20), (0.76, -6), (1, 0)])
    am = Track([(0, 1), (0.28, 0.8), (0.4, 2.0), (0.58, 1.3), (1, 1)])
    ae = Track([(0, 1), (0.2, 0.7), (0.38, 0.72), (0.5, 1.1), (0.7, 1), (1, 1)])

    def attack(t):
        return {
            "root": {"t": (0, ay(t), az(t))},
            "body": body(ak(t), al(t), axy(t)),
            "top": {"r": (at(t), 0, 0)},
            "eyes": {"s": (1, 1, ae(t))},
            "mouth": {"s": (1 + 0.35 * (am(t) - 1), 1, am(t))},
        }

    A.clip("Attack", 15, attack)

    # Hit: squish backwards with eyes squeezed shut. 9 frames (0.375 s)
    hy = Track([(0, 0), (0.3, 0.12, ease_out), (1, 0)])
    hk = Track([(0, 1), (0.25, 0.66, ease_out), (0.55, 1.14), (0.8, 0.95), (1, 1)])
    hl = Track([(0, 0), (0.25, -12), (0.6, 5), (1, 0)])
    ht = Track([(0, 0), (0.3, -14), (0.62, 10), (1, 0)])
    he = Track([(0, 1), (0.14, 0.12), (0.6, 0.12), (1, 1)])

    def hit(t):
        return {
            "root": {"t": (0, hy(t), 0)},
            "body": body(hk(t), hl(t)),
            "top": {"r": (ht(t), 0, 0)},
            "eyes": {"s": (1.1, 1, he(t))},
            "mouth": {"s": (0.8, 1, 0.6)},
        }

    A.clip("Hit", 9, hit)

    # Death: shock stretch, collapse, small rebound, melt into a flat puddle (eyes closed). 29 frames
    dk = Track([(0, 1), (0.12, 1.26, ease_out), (0.34, 0.52, ease_in), (0.48, 0.7), (0.78, 0.13, ease_in), (1, 0.12)])
    dxy = Track([(0, 1), (0.12, 0.88), (0.34, 1.28), (0.48, 1.18), (0.78, 1.72), (1, 1.78)])
    dt = Track([(0, 0), (0.12, -10), (0.34, 12), (0.55, -8), (0.78, 4), (1, 0)])
    dtz = Track([(0, 0), (0.34, 0), (0.6, 25), (1, 30)])
    de = Track([(0, 1), (0.12, 1.25), (0.3, 0.25), (0.6, 0.1), (1, 0.1)])
    dm = Track([(0, 1), (0.12, 1.6), (0.4, 0.6), (1, 0.5)])

    def death(t):
        return {
            "body": {"s": (dxy(t), dxy(t), dk(t))},
            "top": {"r": (dt(t), 0, dtz(t))},
            "eyes": {"s": (1, 1, de(t))},
            "mouth": {"s": (1, 1, dm(t))},
        }

    A.clip("Death", 29, death)
    A.rest_pose()
