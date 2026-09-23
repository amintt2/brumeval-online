"""Props & accessories for the humanoids group (all procedural: curves -> Geometry Nodes sweeps, fused volumes,
lofts). Every function returns mesh object(s) in world space, in the character's REST pose, with materials."""
import math
import random

import bmesh
import bpy
import mathutils

import hbody as HB
import hgarment as HG
import skeleton as SK
from kit import gn

V = mathutils.Vector


def _link(ob):
    bpy.context.scene.collection.objects.link(ob)
    return ob


def _mat(ob, mat):
    ob.data.materials.clear()
    ob.data.materials.append(mat)
    return ob


def smooth_all(ob, on=True):
    for p in ob.data.polygons:
        p.use_smooth = on
    return ob


# =============================================================================== grip frames
def grip_frame(J, side):
    """(centre of the fist hole, grip axis (thumb side, ~ -Y at rest), hand direction, palm normal (inward))."""
    wr, tip = V(J[f"hand.{side}"][0]), V(J[f"hand.{side}"][1])
    d = (tip - wr).normalized()
    sg = 1 if side == "L" else -1
    fwd = V((0, -1, 0))
    inward = d.cross(fwd).normalized() * (-sg)
    if inward.x * sg > 0:
        inward = -inward
    axis = inward.cross(d).normalized()
    if axis.y > 0:
        axis = -axis
    L = (tip - wr).length
    c = wr + d * L * 0.5 + inward * 0.018 * (L / 0.17)
    return c, axis, d, inward


# =============================================================================== curves -> meshes
def sweep(points, radius, name, mat, taper=None, res=8, caps=True, kind="POLY", resample=None, profile=None):
    """points = [(x,y,z[,r]), ...] -> tube mesh (Geometry Nodes curve-to-mesh, applied)."""
    cu = gn.make_curve([points], name=name, kind=kind)
    gn.curve_to_mesh(cu, radius=radius, profile_res=res, fill_caps=caps, taper=taper, material=mat, resample=resample,
                     profile=profile)
    ob = gn.apply(cu)
    ob.name = name
    HB.clean(ob, 1e-6)
    return ob


def gnarled_path(a, b, n=9, wobble=0.02, seed=0, bend=None):
    rnd = random.Random(seed)
    a, b = V(a), V(b)
    d = b - a
    side = d.orthogonal().normalized()
    side2 = d.normalized().cross(side)
    pts = []
    for i in range(n):
        t = i / (n - 1)
        p = a + d * t
        if 0 < i < n - 1:
            p += side * rnd.uniform(-wobble, wobble) + side2 * rnd.uniform(-wobble, wobble)
        if bend is not None:
            p += V(bend) * math.sin(math.pi * t)
        pts.append(p)
    return pts


def staff(bottom, top, radius, mat, seed=0, wobble=0.012, knots=4, name="Staff", tris=900):
    """Gnarled wooden staff: swept tube with taper + knots (small fused bumps) + GN displacement."""
    pts = gnarled_path(bottom, top, 12, wobble, seed)
    rnd = random.Random(seed + 3)
    rad = [(p.x, p.y, p.z, 1.0 + 0.25 * math.sin(i * 1.7 + seed) + (0.3 if i in (2, 7) else 0)) for i, p in enumerate(pts)]
    ob = sweep(rad, radius, name, mat, taper=[(0, 0.85), (0.5, 1.0), (1.0, 0.75)], res=10)
    parts = [ob]
    for k in range(knots):
        t = rnd.uniform(0.15, 0.85)
        p = V(bottom).lerp(V(top), t)
        dirn = (V(top) - V(bottom)).normalized().orthogonal().normalized()
        dirn.rotate(mathutils.Quaternion((V(top) - V(bottom)).normalized(), rnd.uniform(0, 6.28)))
        parts.append(HB.ellipsoid(p + dirn * radius * 0.7, (radius * 0.55,) * 3, seg=12, rings=8))
    ob = HB.fuse(parts, max(radius * 0.18, 0.0025), name)
    gn.displace(ob, strength=radius * 0.18, scale=18.0 / max(radius * 10, 0.1), detail=5, voronoi=0.3, seed=seed)
    gn.apply(ob)
    HB.decimate_to(ob, tris)
    return _mat(ob, mat)


# =============================================================================== small skull (staff heads, fetishes)
def mini_skull(center, scale, mat, jaw_open=0.0, tris=900, name="MiniSkull", yaw=0.0, pitch=0.0):
    """A real (fused + carved) skull at `center` (centre of the cranium), facing -Y, scaled (1 = human)."""
    c = V(center)
    hd = c - V((0, 0, 0.11 * scale))
    J = {"head": ((hd.x, hd.y, hd.z), (hd.x, hd.y, hd.z + 0.24 * scale))}
    parts, ops = [], []
    eyes = SK.skull(parts, ops, J, scale, jaw_open)
    cutters = [p for p in parts if isinstance(p, tuple)][0][1]
    parts = [p for p in parts if not isinstance(p, tuple)]
    vx = max(0.0025 * scale, 0.0012)
    ob = HB.fuse(parts, vx, name)
    HB.keep_largest(ob)
    HB.sculpt(ob, ops)
    HB.carve(ob, cutters, voxel=vx)
    HB.keep_largest(ob)
    HB.taubin(ob, 3)
    HB.decimate_to(ob, tris)
    if yaw or pitch:
        R = (mathutils.Matrix.Rotation(math.radians(yaw), 4, "Z") @ mathutils.Matrix.Rotation(math.radians(pitch), 4, "X"))
        M = mathutils.Matrix.Translation(c) @ R @ mathutils.Matrix.Translation(-c)
        ob.data.transform(M)
        eyes = [M @ e for e in eyes]
    return _mat(ob, mat), eyes


def eye_glows(eyes, r, mat, name="EyeGlow"):
    obs = [HB.ellipsoid(e, (r, r * 0.8, r * 0.9), seg=12, rings=8, name=name) for e in eyes]
    ob = HB.join(obs, name)
    smooth_all(ob)
    return _mat(ob, mat)


# =============================================================================== blades
def dagger(grip, axis, length=0.28, mat_blade=None, mat_grip=None, mat_guard=None, curve=0.0, name="Dagger"):
    """Dagger centred on the grip point, blade along +axis (thumb side), pommel along -axis."""
    g = V(grip)
    a = V(axis).normalized()
    side = a.orthogonal().normalized()
    flat = a.cross(side).normalized()
    parts = []
    # blade: lofted diamond section, tapering to a point, slight curve
    rings = []
    blade_len = length * 0.62
    base = g + a * 0.055
    nseg = 8
    for i in range(nseg + 1):
        t = i / nseg
        w = 0.022 * (1 - t ** 1.6) + 0.0015
        th = 0.005 * (1 - t) + 0.001
        c = base + a * blade_len * t + side * curve * blade_len * t * t
        rings.append([tuple(c + side * w), tuple(c + flat * th), tuple(c - side * w * 0.9), tuple(c - flat * th)])
    blade = HB.loft(rings, name + "_blade", closed_start=True, closed_end=False)
    bm = bmesh.new()
    bm.from_mesh(blade.data)
    tipv = bm.verts.new(tuple(base + a * (blade_len + 0.03) + side * curve * blade_len))
    last = [v for v in bm.verts if (v.co - (base + a * blade_len + side * curve * blade_len)).length < 0.03 and v is not tipv]
    edges_b = [e for e in bm.edges if e.is_boundary]
    for e in edges_b:
        bm.faces.new((e.verts[0], e.verts[1], tipv))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(blade.data)
    bm.free()
    for p in blade.data.polygons:
        p.use_smooth = False
    _mat(blade, mat_blade)
    parts.append(blade)
    # guard (crossbar), grip (wrapped), pommel
    guard = sweep([tuple(g + a * 0.05 - side * 0.045), tuple(g + a * 0.052), tuple(g + a * 0.05 + side * 0.045)], 0.007,
                  name + "_guard", mat_guard, taper=[(0, 0.8), (0.5, 1.0), (1, 0.8)], res=6)
    parts.append(guard)
    grip_o = sweep([tuple(g - a * 0.055), tuple(g + a * 0.05)], 0.0125, name + "_grip", mat_grip, res=8)
    parts.append(grip_o)
    pom = HB.ellipsoid(g - a * 0.065, (0.016, 0.016, 0.016), seg=12, rings=8, name=name + "_pommel")
    _mat(pom, mat_guard)
    parts.append(pom)
    ob = HB.join(parts, name)
    return ob


# =============================================================================== bow / arrows / quiver
def bow(grip, axis, fwd, length=1.35, mat_wood=None, mat_wrap=None, mat_string=None, name="Bow"):
    """Recurve bow centred on the grip; limbs along +/-axis, bending away from the archer (towards -fwd... i.e.
    the belly faces the archer). fwd = direction the arrow flies."""
    g = V(grip)
    a = V(axis).normalized()
    f = V(fwd).normalized()
    half = length / 2
    pts = []
    for i in range(15):
        t = -1 + 2 * i / 14
        along = a * half * t
        bend = f * (0.09 * (1 - t * t)) - f * (0.03 * max(0.0, abs(t) - 0.8) / 0.2)   # recurve tips
        r = 1.0 - 0.55 * abs(t) ** 1.3
        p = g + along + bend - f * 0.09
        pts.append((p.x, p.y, p.z, r))
    limbs = sweep(pts, 0.017, name + "_limbs", mat_wood, res=8)
    tips = [V(pts[0][:3]), V(pts[-1][:3])]
    string = sweep([tuple(tips[0]), tuple(tips[1])], 0.0022, name + "_string", mat_string, res=4)
    wrap = sweep([tuple(g - a * 0.07 - f * 0.0), tuple(g + a * 0.07)], 0.021, name + "_wrap", mat_wrap, res=8)
    return HB.join([limbs, string, wrap], name), tips


def arrow(tail, head_dir, length=0.75, mat_shaft=None, mat_fletch=None, mat_head=None, name="Arrow", roll=0.0):
    t = V(tail)
    d = V(head_dir).normalized()
    shaft = sweep([tuple(t), tuple(t + d * length)], 0.0045, name + "_shaft", mat_shaft, res=6)
    tip0 = t + d * length
    side = d.orthogonal().normalized()
    side.rotate(mathutils.Quaternion(d, roll))
    hd = sweep([(*(tip0 - d * 0.005), 1.0), (*(tip0 + d * 0.05), 0.05)], 0.011, name + "_head", mat_head, res=4)
    fl = []
    for k in range(3):
        sd = side.copy()
        sd.rotate(mathutils.Quaternion(d, k * 2.094))
        a0 = t + d * 0.03
        a1 = t + d * 0.14
        a2 = t + d * 0.1
        quad = HG.strip([[a0, a0 + sd * 0.004], [a2, a2 + sd * 0.016], [a1, a1 + sd * 0.012]], name + "_f")
        # give the vane a tiny thickness so it is a closed surface
        gn.solidify(quad, 0.0015, offset=0.0)
        gn.apply(quad)
        _mat(quad, mat_fletch)
        fl.append(quad)
    return HB.join([shaft, hd] + fl, name)


def quiver(top, bottom, radius, mat_leather, mat_shaft, mat_fletch, mat_head, n_arrows=7, seed=0, name="Quiver"):
    top, bottom = V(top), V(bottom)
    d = (top - bottom).normalized()
    rnd = random.Random(seed)
    pts = [(*bottom, 0.85), (*bottom.lerp(top, 0.5), 1.0), (*top, 1.08)]
    body = sweep(pts, radius, name + "_body", mat_leather, res=12, caps=True)
    rim = sweep([(*(top + d.orthogonal().normalized() * radius * 1.12 * math.cos(a) + d.cross(d.orthogonal().normalized()) * radius * 1.12 * math.sin(a)),)
                 for a in [2 * math.pi * k / 16 for k in range(17)]], 0.007, name + "_rim", mat_leather, res=6)
    arrows = []
    side = d.orthogonal().normalized()
    side2 = d.cross(side)
    for k in range(n_arrows):
        ang = 2 * math.pi * k / n_arrows + rnd.uniform(-0.3, 0.3)
        rr = radius * rnd.uniform(0.2, 0.7)
        base = bottom + d * 0.06 + side * math.cos(ang) * rr + side2 * math.sin(ang) * rr
        tilt = (d + side * math.cos(ang) * 0.06 + side2 * math.sin(ang) * 0.06).normalized()
        ln = (top - bottom).length + rnd.uniform(0.1, 0.18)
        # arrows stored head down: tail (fletching) sticks out at the top
        tail = base + tilt * ln
        arrows.append(arrow(tail, -tilt, ln - 0.02, mat_shaft, mat_fletch, mat_head, name + f"_a{k}", roll=ang))
    return HB.join([body, rim] + arrows, name)


# =============================================================================== jewellery / head gear
def crown(center, radius, height, mat_gold, mat_gem, n_spikes=7, name="Crown", tilt=0.0):
    c = V(center)
    parts = []
    band_pts = [(c.x + radius * math.sin(2 * math.pi * k / 40), c.y - radius * 1.08 * math.cos(2 * math.pi * k / 40), c.z) for k in range(41)]
    band = sweep([(*p, 1.0) for p in band_pts], height * 0.18, name + "_band", mat_gold, res=6)
    parts.append(band)
    band2 = sweep([(p[0], p[1], p[2] - height * 0.15, 1.0) for p in band_pts], height * 0.09, name + "_band2", mat_gold, res=6)
    parts.append(band2)
    gems = []
    for k in range(n_spikes):
        a = 2 * math.pi * (k + 0.5) / n_spikes
        base = V((c.x + radius * math.sin(a), c.y - radius * 1.08 * math.cos(a), c.z + height * 0.05))
        out = V((math.sin(a), -math.cos(a) * 1.08, 0)).normalized()
        tall = height * (1.25 if k == n_spikes // 2 else 0.85 + 0.25 * ((k % 2) == 0))
        tip = base + V((0, 0, tall)) + out * height * 0.18
        parts.append(sweep([(*base, 1.0), (*(base + (tip - base) * 0.55 + out * height * 0.05), 0.55), (*tip, 0.08)], height * 0.14,
                           name + f"_sp{k}", mat_gold, res=6))
        gp = V((c.x + radius * 1.07 * math.sin(a + math.pi / n_spikes), c.y - radius * 1.07 * 1.08 * math.cos(a + math.pi / n_spikes), c.z - height * 0.05))
        gem = HB.ellipsoid(gp, (height * 0.09,) * 3, seg=8, rings=6, name=name + f"_g{k}")
        _mat(gem, mat_gem)
        gems.append(gem)
    # front jewel
    fg = HB.ellipsoid(c + V((0, -radius * 1.14, height * 0.1)), (height * 0.16, height * 0.1, height * 0.2), seg=10, rings=8, name=name + "_fg")
    _mat(fg, mat_gem)
    gems.append(fg)
    return HB.join(parts, name), HB.join(gems, name + "Gems")


def lantern(hang, size, mat_iron, mat_glass, name="Lantern"):
    """Iron cage lantern hanging from `hang` (ring at the top)."""
    h = V(hang)
    s = size
    parts = []
    top = h - V((0, 0, 0.06 * s))
    ring_ = sweep([(h.x + 0.03 * s * math.cos(a), h.y, h.z - 0.03 * s + 0.03 * s * math.sin(a), 1.0) for a in [2 * math.pi * k / 12 for k in range(13)]],
                  0.006 * s, name + "_ring", mat_iron, res=6)
    parts.append(ring_)
    cap = sweep([(top.x, top.y, top.z, 0.3), (top.x, top.y, top.z - 0.05 * s, 1.0), (top.x, top.y, top.z - 0.07 * s, 1.05)], 0.08 * s,
                name + "_cap", mat_iron, res=8)
    parts.append(cap)
    bot = top - V((0, 0, 0.26 * s))
    base = sweep([(bot.x, bot.y, bot.z, 1.05), (bot.x, bot.y, bot.z - 0.03 * s, 1.0), (bot.x, bot.y, bot.z - 0.05 * s, 0.4)], 0.08 * s,
                 name + "_base", mat_iron, res=8)
    parts.append(base)
    for k in range(6):
        a = 2 * math.pi * k / 6
        o = V((math.cos(a), math.sin(a), 0)) * 0.075 * s
        parts.append(sweep([(*(top - V((0, 0, 0.06 * s)) + o), 1), (*(top - V((0, 0, 0.16 * s)) + o * 1.15), 1), (*(bot + o), 1)],
                           0.0055 * s, name + f"_bar{k}", mat_iron, res=5))
    glass = HB.ellipsoid(top - V((0, 0, 0.165 * s)), (0.062 * s, 0.062 * s, 0.1 * s), seg=16, rings=10, name=name + "_glass")
    _mat(glass, mat_glass)
    smooth_all(glass)
    return HB.join(parts, name), glass


def feather(base, direction, length, width, mat, curl=0.15, name="Feather", seed=0):
    """Feather as a thin (solidified) curved vane with a quill."""
    b = V(base)
    d = V(direction).normalized()
    side = d.orthogonal().normalized()
    rnd = random.Random(seed)
    side.rotate(mathutils.Quaternion(d, rnd.uniform(0, 3.14)))
    nrm = d.cross(side)
    rings = []
    for i in range(9):
        t = i / 8
        w = max(width * math.sin(math.pi * min(1.0, 0.1 + t * 0.95)) ** 0.7 * (1 - 0.3 * t), width * 0.08)
        c = b + d * length * t + nrm * curl * length * t * t
        rings.append([tuple(c - side * w * 0.45), tuple(c), tuple(c + side * w * 0.55)])
    bm = bmesh.new()
    R = [[bm.verts.new(p) for p in r] for r in rings]
    for i in range(len(R) - 1):
        for k in range(2):
            bm.faces.new((R[i][k], R[i][k + 1], R[i + 1][k + 1], R[i + 1][k]))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = _link(bpy.data.objects.new(name, me))
    gn.solidify(ob, 0.002, offset=0.0)
    gn.apply(ob)
    smooth_all(ob)
    for g in list(ob.vertex_groups):
        ob.vertex_groups.remove(g)
    return _mat(ob, mat)


def bone_charm(top, length, mat_bone, mat_cord, seed=0, kind="bone", name="Charm"):
    """Fetish hanging from `top`: cord + bone / tooth / tiny skull."""
    t = V(top)
    rnd = random.Random(seed)
    parts = []
    cord_len = rnd.uniform(0.03, 0.07)
    parts.append(sweep([(*t, 1), (*(t - V((0, 0, cord_len))), 1)], 0.0022, name + "_cord", mat_cord, res=4))
    b0 = t - V((0, 0, cord_len))
    if kind == "bone":
        a = b0
        b = b0 - V((rnd.uniform(-0.01, 0.01), rnd.uniform(-0.01, 0.01), length))
        o = HB.capsule(a, b, 0.006, 0.0045, seg=8, name=name + "_b")
        k1 = HB.ellipsoid(a, (0.009, 0.007, 0.007), seg=8, rings=6)
        k2 = HB.ellipsoid(b, (0.0085, 0.0065, 0.0065), seg=8, rings=6)
        bb = HB.fuse([o, k1, k2], 0.0015, name + "_bone")
        HB.decimate_to(bb, 110)
    elif kind == "tooth":
        bb = HB.capsule(b0, b0 - V((0, -0.004, length * 0.7)), 0.007, 0.0015, seg=8, name=name + "_tooth")
    else:
        bb, _ = mini_skull(b0 - V((0, 0, 0.035 * length / 0.06)), 0.28 * length / 0.06, mat_bone, tris=220, name=name + "_sk")
    _mat(bb, mat_bone)
    parts.append(bb)
    for p in parts:
        smooth_all(p)
    return HB.join(parts, name)


def pouch(center, size, mat, flap_mat=None, name="Pouch", facing=(0, -1, 0)):
    """Leather belt pouch: rounded box + overhanging flap + button, fused, lightly crumpled."""
    c = V(center)
    f = V(facing).normalized()
    yaw = math.degrees(math.atan2(f.x, -f.y))
    body = HB.superellipsoid(c, (size * 0.5, size * 0.26, size * 0.46), 0.45, rot=(0, 0, yaw))
    flap = HB.superellipsoid(c + V((0, 0, size * 0.3)) + f * size * 0.04, (size * 0.54, size * 0.3, size * 0.14), 0.4, rot=(0, 0, yaw))
    btn = HB.ellipsoid(c + V((0, 0, size * 0.2)) + f * size * 0.3, (size * 0.07,) * 3, seg=10, rings=6)
    ob = HB.fuse([body, flap, btn], size * 0.02, name)
    gn.displace(ob, strength=size * 0.025, scale=6.0, detail=3, voronoi=0.0)
    gn.apply(ob)
    HB.decimate_to(ob, 320)
    return _mat(ob, mat)
