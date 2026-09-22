"""Reusable low-poly body parts for the humanoid characters (heads, limbs, hands, boots, weapon grips).
All parts are authored in the rig's REST pose (world space) and rigidly weighted to one bone."""
import math

from mathutils import Vector

import common as C
import geo as G


def mat(name, hexc, rough=0.8, metal=0.0, emit=None, strength=2.0):
    return C.material(name, C.hex_color(hexc), rough=rough, metal=metal,
                      emit=C.hex_color(emit) if emit else None, emit_strength=strength)


# --------------------------------------------------------------------------- limbs
def limb(b, P, bone, radii, m, n=8, ext0=0.0, ext1=0.0, ry_scale=1.0, offset=(0, 0, 0), ground=True):
    """Tube along `bone` (rest), radii = [r_head, (r_mid...), r_tail]; ext0/ext1 extend past the joints."""
    h, t = P.head[bone], P.tail[bone]
    d = (t - h).normalized()
    p0, p1 = h - d * ext0, t + d * ext1
    off = Vector(offset)
    pts = [p0.lerp(p1, i / (len(radii) - 1)) + off for i in range(len(radii))]
    rr = [(r, r * ry_scale) for r in radii]
    b.add(G.sweep(pts, rr, n=n, normal=(1, 0, 0), phase=math.pi / n), m, bone, ground=ground)


def limb_pair(b, P, bone, radii, m, **kw):
    for s in "LR":
        limb(b, P, f"{bone}.{s}", radii, m, **kw)


def ball(b, P, bone, frac, r, m, seg=8, rings=5, offset=(0, 0, 0), scale=(1, 1, 1)):
    c = P.head[bone].lerp(P.tail[bone], frac) + Vector(offset)
    b.add(G.ellipsoid(c, (r * scale[0], r * scale[1], r * scale[2]), seg, rings), m, bone)


# --------------------------------------------------------------------------- hands & feet
def fist(b, P, side, m, size=1.0, thumb=True, glove_cuff=None):
    w = P.head[f"hand.{side}"]
    L = P.length(f"hand.{side}")
    sx = 1 if side == "L" else -1
    c = Vector((w.x - sx * 0.004, w.y - 0.004, w.z - L * 0.5))
    hx, hy, hz = 0.036 * size, 0.047 * size, 0.056 * size
    b.add(G.loft([(c.x, c.y, c.z - hz, hx * 0.85, hy * 0.9), (c.x, c.y, c.z - hz * 0.2, hx, hy),
                  (c.x, c.y, c.z + hz, hx * 0.9, hy * 0.85)], shape="chamfer"), m, f"hand.{side}")
    if thumb:
        tp = Vector((c.x - sx * hx * 0.7, c.y - hy * 0.95, c.z + hz * 0.1))
        b.add(G.ellipsoid(tp, (0.017 * size, 0.017 * size, 0.03 * size), 6, 4), m, f"hand.{side}")
    if glove_cuff is not None:
        b.add(G.loft([(w.x, w.y, w.z - 0.02, 0.046 * size, 0.05 * size), (w.x, w.y, w.z + 0.045, 0.05 * size, 0.054 * size)], 8),
              glove_cuff, f"forearm.{side}")


def boot(b, P, side, m, sole=None, w=0.052, h=0.1, toe=0.19, heel=0.06, shaft_top=0.3, shaft_r=0.06, toe_mat=None,
         cuff=None, cuff_r=0.068):
    """Boot: foot wedge (foot bone) + shaft up the shin (shin bone) + optional cuff."""
    an = P.head[f"foot.{side}"]
    x = an.x
    # rings along the foot length (local z -> world -Y), local y -> world z (height), local x -> world x
    Mf = G.frame((x, an.y, 0.0), (1, 0, 0), (0, 0, 1), (0, -1, 0))
    rings = [(0, h * 0.5, -heel, w * 0.85, h * 0.5),
             (0, h * 0.58, -heel * 0.3, w, h * 0.58),
             (0, h * 0.45, toe * 0.45, w * 1.05, h * 0.45),
             (0, h * 0.34, toe * 0.8, w * 0.95, h * 0.34),
             (0, h * 0.26, toe, w * 0.6, h * 0.24)]
    b.add(G.loft(rings, 8), toe_mat or m, f"foot.{side}", M=Mf)
    if sole is not None:
        b.add(G.box((x, an.y - (toe - heel) * 0.5, 0.012), w * 1.1, (toe + heel) * 0.5 + 0.006, 0.012), sole, f"foot.{side}")
    if shaft_top > 0:
        b.add(G.loft([(x, 0.005, an.z - 0.02, shaft_r * 0.95, shaft_r), (x, 0.0, shaft_top, shaft_r, shaft_r * 1.03)], 8),
              m, f"shin.{side}")
    if cuff is not None:
        b.add(G.loft([(x, 0.0, shaft_top - 0.035, cuff_r, cuff_r), (x, 0.0, shaft_top + 0.02, cuff_r * 1.06, cuff_r * 1.06)], 8),
              cuff, f"shin.{side}")


def bare_foot(b, P, side, m, w=0.05, h=0.08, toe=0.2, heel=0.05, toes=True, claw=None):
    an = P.head[f"foot.{side}"]
    x = an.x
    Mf = G.frame((x, an.y, 0.0), (1, 0, 0), (0, 0, 1), (0, -1, 0))
    rings = [(0, h * 0.5, -heel, w * 0.8, h * 0.5), (0, h * 0.62, 0.0, w, h * 0.62),
             (0, h * 0.35, toe * 0.6, w * 1.2, h * 0.35), (0, h * 0.22, toe, w * 1.1, h * 0.22)]
    b.add(G.loft(rings, 8), m, f"foot.{side}", M=Mf)
    if toes and claw is not None:
        for i, dx in enumerate((-0.03, 0.0, 0.03)):
            p0 = Vector((x + dx * (w / 0.05), -toe + 0.01, 0.02))
            b.add(G.tube(p0, p0 + Vector((0, -0.03, -0.012)), 0.009, 0.0, n=4), claw, f"foot.{side}")


# --------------------------------------------------------------------------- heads
class Face:
    """Head frame helper: centre + radii; `surf(x, z)` = point on the front surface."""

    def __init__(self, c, r):
        self.c = Vector(c)
        self.r = r

    def surf(self, x, z, inset=0.0):
        rx, ry, rz = self.r
        dx, dz = x / rx, (z - self.c.z) / rz
        k = max(0.0, 1 - dx * dx - dz * dz)
        return Vector((self.c.x + x, self.c.y - ry * math.sqrt(k) + inset, z))


def human_head(b, P, skin, r=(0.105, 0.115, 0.132), centre=None, jaw=0.82, chin=0.012, seg=10, rings=8):
    hb = P.head["head"]
    c = Vector(centre) if centre else Vector((0.0, -0.012, hb.z + r[2] * 0.97))

    def shape(v):
        dz = (v.z - c.z) / r[2]
        if dz < 0:
            k = -dz
            v.x = c.x + (v.x - c.x) * (1 - (1 - jaw) * k)
            v.y -= chin * k * (1 if v.y < c.y else 0.3)
        return v

    b.add(G.deform(G.ellipsoid(c, r, seg, rings), shape), skin, "head")
    return Face(c, r)


def eyes(b, F, white, dark, dx=0.043, dz=0.004, size=1.0, glow=None, pupil_only=False):
    for sx in (1, -1):
        p = F.surf(sx * dx, F.c.z + dz, inset=0.012)
        if not pupil_only:
            b.add(G.ellipsoid(p, (0.021 * size, 0.012 * size, 0.017 * size), 6, 4), white, "head")
        q = p + Vector((sx * 0.002, -0.009 * size, -0.001))
        b.add(G.ellipsoid(q, (0.011 * size, 0.008 * size, 0.013 * size), 6, 4), glow or dark, "head")


def brows(b, F, m, dx=0.045, dz=0.03, w=0.03, h=0.009, tilt=12.0, bushy=1.0):
    for sx in (1, -1):
        p = F.surf(sx * dx, F.c.z + dz, inset=0.004)
        M = G.T(p) @ G.R(0, sx * -tilt, 0) @ G.R(0, 0, sx * 12)
        b.add(G.box((0, 0, 0), w * bushy, 0.012 * bushy, h * bushy), m, "head", M=M)


def nose(b, F, m, length=0.035, width=0.017, dz=-0.028, droop=0.3):
    top = F.surf(0, F.c.z + dz + 0.03, inset=0.01)
    tip = F.surf(0, F.c.z + dz, inset=0.0) + Vector((0, -length, -length * droop))
    b.add(G.tube(top, tip, width * 0.6, width, n=5, cap1=True), m, "head")
    b.add(G.ellipsoid(tip, (width * 1.1, width * 0.9, width * 0.9), 6, 4), m, "head")


def ears(b, F, m, size=1.0, dz=0.0):
    rx = F.r[0]
    for sx in (1, -1):
        p = Vector((F.c.x + sx * rx * 0.96, F.c.y + 0.012, F.c.z + dz))
        b.add(G.ellipsoid(p, (0.014 * size, 0.026 * size, 0.036 * size), 6, 4), m, "head")


def mouth(b, F, m, w=0.03, dz=-0.068, h=0.006):
    p = F.surf(0, F.c.z + dz, inset=0.006)
    b.add(G.box(p, w, 0.008, h), m, "head")


def neck(b, P, m, r=0.052, bot=None, top=None):
    nb, hb = P.head["neck"], P.head["head"]
    z0 = bot if bot is not None else nb.z - 0.04
    z1 = top if top is not None else hb.z + 0.05
    b.add(G.loft([(0, 0.004, z0, r * 1.1, r * 1.05), (0, 0.004, z1, r, r)], 8), m, "neck")


# --------------------------------------------------------------------------- weapons
def fist_centre(P, side):
    w = P.head[f"hand.{side}"]
    sx = 1 if side == "L" else -1
    return Vector((w.x - sx * 0.004, w.y - 0.004, w.z - P.length(f"hand.{side}") * 0.5))


def grip_matrix(P, side, tilt=0.0, yaw=0.0, roll=0.0):
    """Local frame of a gripped weapon: local +Z = weapon 'up' (blade / staff head), pointing FORWARD (-Y) in
    the rest pose (arm hanging, fist closed around a horizontal grip); local Y = up; `tilt` > 0 tips it down."""
    return G.T(fist_centre(P, side)) @ G.R(0, 0, yaw) @ G.R(90 + tilt, 0, 0) @ G.R(0, 0, roll)


# --------------------------------------------------------------------------- robes / skirts
def _half_rings(rings, n, a0=-math.pi / 2, a1=math.pi / 2, dy=0.0):
    """Vertices of half-ellipse rings (x >= 0 side) from the FRONT (-Y) round the left side to the BACK."""
    verts, idx = [], []
    for ring in rings:
        z, rx, ry = ring[:3]
        cy = ring[3] if len(ring) > 3 else dy
        row = []
        for k in range(n + 1):
            a = a0 + (a1 - a0) * k / n
            row.append(len(verts))
            verts.append((rx * math.cos(a), cy + ry * math.sin(a), z))
        idx.append(row)
    return verts, idx


def _half_faces(idx):
    faces = []
    for up, lo in zip(idx, idx[1:]):
        for k in range(len(up) - 1):
            faces.append((lo[k], lo[k + 1], up[k + 1], up[k]))
    return faces


def skirt(b, P, rings, m, n=6, hem=None, hem_h=0.035, trim=None, inner=None, inner_to=None):
    """Long robe / skirt hanging from the hips, split in a left and a right half weighted to the THIGHS so
    walking or running legs never poke through (the halves open like a slit robe).
    rings: [(z, rx, ry[, cy])] from the top (≈ hip joint) down to the hem."""
    verts, idx = _half_rings(rings, n)
    geo = (verts, _half_faces(idx))
    b.sym(geo, m, "thigh")
    if hem is not None:
        z, rx, ry = rings[-1][:3]
        cy = rings[-1][3] if len(rings[-1]) > 3 else 0.0
        hv, hidx = _half_rings([(z + hem_h, rx * 1.015 + 0.004, ry * 1.015 + 0.004, cy),
                                (z - 0.004, rx * 1.03 + 0.006, ry * 1.03 + 0.006, cy)], n)
        b.sym((hv, _half_faces(hidx)), hem, "thigh")
    if trim is not None:
        pts, rad = [], []
        for ring in rings:
            z, rx, ry = ring[:3]
            cy = ring[3] if len(ring) > 3 else 0.0
            pts.append((0.012, cy - ry - 0.004, z))
            rad.append((0.012, 0.006))
        b.sym(G.sweep(pts, rad, n=4, normal=(1, 0, 0)), trim, "thigh")
    if inner is not None:
        z_end = inner_to if inner_to is not None else rings[len(rings) // 2][0]
        top = rings[0]
        rr = [(top[0], top[1] * 0.97, top[2] * 0.97)] + [(r[0], r[1] * 0.93, r[2] * 0.93) for r in rings[1:] if r[0] >= z_end]
        b.add(G.loft([(0, 0, z, rx, ry) for z, rx, ry in rr], n * 2, cap0=False, cap1=False), inner, "hips")


def bell_sleeve(b, P, side, m, r0=0.052, r1=0.092, ext=0.03, trim=None, n=8):
    h, t = P.head[f"forearm.{side}"], P.tail[f"forearm.{side}"]
    d = (t - h).normalized()
    pts = [h - d * 0.01, h.lerp(t, 0.55), t + d * ext]
    b.add(G.sweep(pts, [r0, (r0 + r1) * 0.47, r1], n=n, normal=(1, 0, 0), cap1=False), m, f"forearm.{side}")
    if trim is not None:
        p0, p1 = t + d * (ext - 0.022), t + d * (ext + 0.004)
        b.add(G.sweep([p0, p1], [r1 * 1.02 + 0.003, r1 * 1.04 + 0.004], n=n, normal=(1, 0, 0), cap0=False, cap1=False),
              trim, f"forearm.{side}")


def apron(b, P, rings, m, span=0.95, n=3, bone="thigh", back=False, jag=0.0, seed=1):
    """Front (or back) panel following a skirt (same ring format), split in two halves weighted like the skirt.
    jag > 0 roughens the bottom edge (tattered cloth)."""
    a0, a1 = (-math.pi / 2, -math.pi / 2 + span) if not back else (math.pi / 2 - span, math.pi / 2)
    verts, idx = _half_rings(rings, n, a0=a0, a1=a1)
    if jag > 0:
        import random
        rnd = random.Random(seed)
        for i in idx[-1]:
            x, y, z = verts[i]
            verts[i] = (x, y, z - rnd.uniform(0.0, jag))
    b.sym((verts, _half_faces(idx)), m, bone)
