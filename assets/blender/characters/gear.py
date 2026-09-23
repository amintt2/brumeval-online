"""Rigid gear for the v0.2 humanoids: weapons, shields, helmets, pauldrons, pouches...

Weapons are modelled in a LOCAL frame (Z = weapon axis from the grip centre, Y = up, X = side) and placed with
grip_frame(ctx, side) in the ARMS-DOWN rest frame (fist around a horizontal grip, weapon pointing forward -Y),
then registered with ctx.piece(obj, "hand.R", arms_down=True) which moves them into the bind pose.
"""
import math
import random

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

import garments as G


def T(x=0.0, y=0.0, z=0.0):
    return Matrix.Translation((x, y, z))


def R(rx=0.0, ry=0.0, rz=0.0):
    return (Matrix.Rotation(math.radians(rz), 4, "Z") @ Matrix.Rotation(math.radians(ry), 4, "Y")
            @ Matrix.Rotation(math.radians(rx), 4, "X"))


def xf(obj, M):
    obj.data.transform(M)
    obj.data.update()
    return obj


def store_local(obj, name="lp"):
    """Keep the authoring (local) position as a vector attribute for shaders (heraldry, patterns) that must stay
    attached to the object after it is moved into the bind pose."""
    me = obj.data
    at = me.attributes.get(name) or me.attributes.new(name, "FLOAT_VECTOR", "POINT")
    co = np.empty(len(me.vertices) * 3, dtype=np.float32)
    me.vertices.foreach_get("co", co)
    at.data.foreach_set("vector", co)
    return obj


# =============================================================================== primitives
def lathe(name, prof, seg=12, mat=None, cap0=True, cap1=True, smooth=True, phase=0.0):
    """Surface of revolution around local Z. prof = [(z, r), ...] bottom -> top (r may be (rx, ry))."""
    verts, faces = [], []
    for z, r in prof:
        rx, ry = (r, r) if not isinstance(r, (tuple, list)) else r
        for s in range(seg):
            a = 2 * math.pi * s / seg + phase
            verts.append((math.cos(a) * rx, math.sin(a) * ry, z))
    n = len(prof)
    for i in range(n - 1):
        for s in range(seg):
            s2 = (s + 1) % seg
            faces.append((i * seg + s, i * seg + s2, (i + 1) * seg + s2, (i + 1) * seg + s))
    if cap0 and _r(prof[0][1]) > 1e-6:
        verts.append((0, 0, prof[0][0]))
        c = len(verts) - 1
        for s in range(seg):
            faces.append((c, (s + 1) % seg, s))
    if cap1 and _r(prof[-1][1]) > 1e-6:
        verts.append((0, 0, prof[-1][0]))
        c = len(verts) - 1
        b = (n - 1) * seg
        for s in range(seg):
            faces.append((c, b + s, b + (s + 1) % seg))
    ob = G.new_obj(name, verts, faces, mat, smooth)
    _merge_close(ob)
    G.recalc_normals(ob)
    return ob


def _r(r):
    return r if not isinstance(r, (tuple, list)) else max(r)


def _merge_close(ob, d=1e-5):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=d)
    bm.to_mesh(ob.data)
    bm.free()


def loft(name, sections, mat=None, closed=True, cap0=True, cap1=True, smooth=True):
    """sections = [[(x, y, z), ...], ...] rings with the same point count -> quads (+ fan caps)."""
    n = len(sections[0])
    verts = [v for sec in sections for v in sec]
    faces = []
    for i in range(len(sections) - 1):
        for s in range(n if closed else n - 1):
            s2 = (s + 1) % n
            faces.append((i * n + s, i * n + s2, (i + 1) * n + s2, (i + 1) * n + s))
    if cap0:
        c = len(verts)
        verts.append(tuple(sum((Vector(p) for p in sections[0]), Vector()) / n))
        for s in range(n):
            faces.append((c, (s + 1) % n, s))
    if cap1:
        c = len(verts)
        verts.append(tuple(sum((Vector(p) for p in sections[-1]), Vector()) / n))
        b = (len(sections) - 1) * n
        for s in range(n):
            faces.append((c, b + s, b + (s + 1) % n))
    ob = G.new_obj(name, verts, faces, mat, smooth)
    _merge_close(ob)
    G.recalc_normals(ob)
    return ob


def box(name, size, mat=None, bevel=0.0, center=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, 0))
    ob = bpy.context.object
    ob.name = name
    ob.data.transform(Matrix.Diagonal((*size, 1.0)))
    ob.data.transform(T(*center))
    if mat is not None:
        ob.data.materials.append(mat)
    if bevel:
        md = ob.modifiers.new("Bv", "BEVEL")
        md.width = bevel
        md.segments = 2
        G._apply_all(ob)
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def ico(name, r, mat=None, subdiv=2, center=(0, 0, 0), scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdiv, radius=r, location=(0, 0, 0))
    ob = bpy.context.object
    ob.name = name
    ob.data.transform(T(*center) @ Matrix.Diagonal((*scale, 1.0)))
    if mat is not None:
        ob.data.materials.append(mat)
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def join(objs, name):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = bpy.context.object
    ob.name = name
    return ob


# =============================================================================== grip frames
def grip_center(ctx, side):
    """Centre of the closed fist (arms-down rest frame, P0) -- matches anatomy.hand_elements."""
    P0 = ctx.P0
    w = P0.head[f"hand.{side}"]
    a = (P0.tail[f"hand.{side}"] - w).normalized()
    sx = 1 if side == "L" else -1
    hs = ctx.B["hand"] * (ctx.L["top"] / 1.8)
    medial = Vector((-sx, 0, 0))
    return w + a * 0.085 * hs + medial * 0.012 * hs


def grip_frame(ctx, side, tilt=0.0, yaw=0.0, roll=0.0):
    """Local +Z = weapon axis pointing FORWARD (-Y) at rest (tilt > 0 tips it down), local +Y = up."""
    c = grip_center(ctx, side)
    return Matrix.Translation(c) @ R(0, 0, yaw) @ R(90 + tilt, 0, 0) @ R(0, 0, roll)


# =============================================================================== weapons
def blade_sections(length, w0, w1, t, tip, n=8, fuller=0.35, curve=0.0):
    """Double-edged blade cross-sections (8-gon: edges, bevels, flat with a fuller groove) along +Z."""
    secs = []
    for i in range(n + 1):
        u = i / n
        z = length * u
        if z > length - tip:
            k = (length - z) / tip
            w = (w0 + (w1 - w0) * (1 - tip / length)) * (k ** 0.8)
            th = t * max(0.25, k)
        else:
            w = w0 + (w1 - w0) * u
            th = t
        w = max(w, 0.0008)
        f = fuller if z < length * 0.72 else 0.0
        c = curve * u * u
        ring = [(w, c, z), (w * 0.6, th * 0.9 + c, z), (w * 0.15, th * (1 - 0.35 * f) + c, z), (-w * 0.15, th * (1 - 0.35 * f) + c, z),
                (-w * 0.6, th * 0.9 + c, z), (-w, c, z), (-w * 0.6, -th * 0.9 + c, z), (-w * 0.15, -th * (1 - 0.35 * f) + c, z),
                (w * 0.15, -th * (1 - 0.35 * f) + c, z), (w * 0.6, -th * 0.9 + c, z)]
        secs.append(ring)
    return secs


def sword(name, m_blade, m_hilt, m_grip, length=0.8, grip_len=0.15, guard_w=0.11, w0=0.028, w1=0.02, pommel=0.026,
          guard_curve=0.02, fuller=0.4, rust=None):
    """Arming sword along local +Z from the grip centre (grip -grip/2..+grip/2)."""
    g0, g1 = -grip_len / 2 - 0.004, grip_len / 2 + 0.004
    parts = []
    bl = loft(name + "_Blade", [[(x, y, z + g1 + 0.018) for x, y, z in sec]
                                for sec in blade_sections(length, w0, w1, 0.0045, 0.12, 10, fuller)], m_blade)
    parts.append(bl)
    # crossguard with curved quillons ending in knobs (rings perpendicular to X)
    rings = []
    for i in range(9):
        u = i / 8 * 2 - 1
        x = u * guard_w
        z = g1 + 0.008 + guard_curve * u * u
        h = 0.009 * (1.0 - 0.35 * abs(u)) + 0.004
        d = 0.011 * (1.0 - 0.3 * abs(u)) + 0.002
        rings.append([(x, -d, z - h), (x, d, z - h), (x, d, z + h), (x, -d, z + h)])
    gd = loft(name + "_Guard", rings, m_hilt)
    parts.append(gd)
    for sx in (1, -1):
        parts.append(ico(name + "_Knob", 0.011, m_hilt, 1, (sx * (guard_w + 0.004), 0, g1 + 0.008 + guard_curve)))
    # grip: leather wrap with ridges (lathe)
    prof = []
    for i in range(9):
        z = g0 + (g1 - g0) * i / 8
        prof.append((z, 0.0135 + (0.0012 if i % 2 else 0.0) + 0.002 * math.sin(math.pi * i / 8)))
    parts.append(lathe(name + "_Grip", prof, 8, m_grip, cap0=False, cap1=False))
    # pommel: wheel
    parts.append(lathe(name + "_Pommel", [(g0 - 0.003, 0.011), (g0 - 0.01, pommel * 0.9), (g0 - 0.022, pommel),
                                          (g0 - 0.036, pommel * 0.85), (g0 - 0.042, 0.008)], 12, m_hilt))
    ob = join(parts, name)
    _merge_close(ob, 1e-4)
    return ob


def heater_shield(name, m_face, m_rim, m_back, w=0.27, h=0.62, curv=0.06, thick=0.022):
    """Heater shield in local coords: face towards +Z, long axis along Y (top +Y), centred at the origin."""
    # outline: straight top, curved sides meeting at the point
    pts = []
    top = h * 0.42
    for i in range(9):                   # top edge, left -> right
        pts.append((-w + 2 * w * i / 8, top))
    for i in range(1, 17):               # right side down to the point
        t = i / 16
        y = top - h * t ** 1.25
        x = w * (1 - t ** 1.9)
        pts.append((x, y))
    for i in range(15, 0, -1):           # left side up
        t = i / 16
        x = -w * (1 - t ** 1.9)
        y = top - h * t ** 1.25
        pts.append((x, y))
    # rings: rim inset rings -> faceted, slightly domed face
    def z_of(x, y):
        return curv * (1 - (x / w) ** 2) + 0.01 * (1 - ((y - (top - h / 2)) / (h / 2)) ** 2)
    cen = Vector((0.0, top - h * 0.45))
    rings = []
    for k, s in enumerate((1.0, 0.94, 0.72, 0.45, 0.2)):
        ring = []
        for x, y in pts:
            p = cen + (Vector((x, y)) - cen) * s
            ring.append((p.x, p.y, z_of(p.x, p.y) + (0.004 if k == 0 else 0.0)))
        rings.append(ring)
    verts = [v for r in rings for v in r]
    faces = []
    N = len(pts)
    for r in range(len(rings) - 1):
        for i in range(N):
            j = (i + 1) % N
            faces.append((r * N + i, r * N + j, (r + 1) * N + j, (r + 1) * N + i))
    c = len(verts)
    verts.append((cen.x, cen.y, z_of(cen.x, cen.y)))
    b = (len(rings) - 1) * N
    for i in range(N):
        faces.append((c, b + i, b + (i + 1) % N))
    face = G.new_obj(name + "_Face", verts, faces, m_face)
    store_local(face)
    G.recalc_normals(face)
    G.outward_normals(face, lambda p: (p.x, p.y, p.z - 1.0))
    # back board: offset down by thick, reversed
    back_v = [(x, y, z - thick) for x, y, z in verts]
    back_f = [tuple(reversed(f)) for f in faces]
    back = G.new_obj(name + "_Back", back_v, back_f, m_back)
    # side wall + metal rim band (outer ring)
    rim_rings = []
    for dz, sc in ((-thick - 0.003, 1.012), (0.006, 1.012), (0.008, 0.965), (-0.004, 0.955)):
        ring = []
        for x, y in pts:
            p = cen + (Vector((x, y)) - cen) * sc
            ring.append((p.x, p.y, z_of(p.x, p.y) + dz))
        rim_rings.append(ring)
    rv = [v for r in rim_rings for v in r]
    rf = []
    for r in range(len(rim_rings)):
        r2 = (r + 1) % len(rim_rings)
        for i in range(N):
            j = (i + 1) % N
            rf.append((r * N + i, r * N + j, r2 * N + j, r2 * N + i))
    rim = G.new_obj(name + "_Rim", rv, rf, m_rim)
    G.recalc_normals(rim)
    # enarmes (straps) on the back + boss
    strap1 = box(name + "_Strap", (0.04, 0.2, 0.012), m_back, 0.003, (0.0, top - h * 0.36, -thick - 0.006))
    strap2 = box(name + "_Strap2", (0.04, 0.12, 0.012), m_back, 0.003, (0.0, top - h * 0.62, -thick - 0.006))
    boss = lathe(name + "_Boss", [(0.0, 0.05), (0.012, 0.047), (0.03, 0.03), (0.042, 0.0)], 14, m_rim)
    xf(boss, T(cen.x, cen.y + 0.02, z_of(cen.x, cen.y + 0.02) - 0.004))
    ob = join([face, back, rim, strap1, strap2, boss], name)
    return ob


def staff(name, m_wood, m_metal, m_crystal, length=1.75, seed=3, crystal_h=0.13, grip_z=0.0):
    """Gnarled staff (curve -> mesh via kit.gn) with a clawed head holding a glowing crystal, along local +Z.
    The origin is the grip centre; the staff spans grip_z - 0.62*length .. +0.38*length."""
    from kit import gn
    rnd = random.Random(seed)
    z0 = -0.62 * length
    pts = []
    for i in range(13):
        u = i / 12
        z = z0 + length * u
        pts.append((0.012 * math.sin(u * 7.1 + 1) + rnd.uniform(-0.004, 0.004), 0.01 * math.sin(u * 5.3), z,
                    1.0 - 0.25 * u + (0.25 if i == 12 else 0.0)))
    cu = gn.make_curve([pts], name + "_Curve", kind="NURBS", resolution=4)
    gn.curve_to_mesh(cu, radius=0.017, profile_res=7, taper=[(0, 0.8), (0.1, 1.0), (0.9, 0.9), (1, 1.15)])
    shaft = gn.apply(cu)
    gn.displace(shaft, strength=0.004, scale=18.0, detail=3.0, seed=seed, voronoi=0.0)
    gn.apply(shaft)
    shaft.name = name + "_Shaft"
    shaft.data.materials.clear()
    shaft.data.materials.append(m_wood)
    top = Vector((pts[-1][0], pts[-1][1], pts[-1][2]))
    parts = [shaft]
    # metal ferrule + collar
    parts.append(xf(lathe(name + "_Ferrule", [(0.0, 0.016), (0.05, 0.019), (0.07, 0.015)], 8, m_metal),
                    T(pts[0][0], pts[0][1], z0 - 0.01)))
    parts.append(xf(lathe(name + "_Collar", [(-0.03, 0.02), (-0.02, 0.025), (0.0, 0.024), (0.01, 0.021)], 10, m_metal),
                    T(top.x, top.y, top.z - 0.02)))
    # claws (4 curved prongs) around the crystal
    for k in range(4):
        a = k * math.pi / 2 + 0.4
        d = Vector((math.cos(a), math.sin(a), 0))
        cpts = [(top + d * 0.018 + Vector((0, 0, 0.0)))[:] + (1.0,),
                (top + d * 0.04 + Vector((0, 0, 0.05)))[:] + (0.8,),
                (top + d * 0.035 + Vector((0, 0, crystal_h * 0.8)))[:] + (0.6,),
                (top + d * 0.012 + Vector((0, 0, crystal_h + 0.02)))[:] + (0.3,)]
        cc = gn.make_curve([cpts], name + f"_Claw{k}", kind="NURBS", resolution=4)
        gn.curve_to_mesh(cc, radius=0.007, profile_res=5, taper=[(0, 1.0), (1, 0.25)])
        cl = gn.apply(cc)
        cl.data.materials.clear()
        cl.data.materials.append(m_metal)
        parts.append(cl)
    # crystal: elongated faceted bipyramid
    cry = lathe(name + "_Crystal", [(0.0, 0.0), (crystal_h * 0.3, 0.028), (crystal_h * 0.75, 0.024), (crystal_h, 0.0)], 6,
                m_crystal, smooth=False)
    xf(cry, T(top.x, top.y, top.z + 0.03) @ R(0, 0, 15))
    parts.append(cry)
    ob = join(parts, name)
    return ob


def longbow(name, m_wood, m_grip, m_string, length=1.62, depth=0.1):
    """Longbow in the local XZ plane: limbs along Z (grip at the origin), belly towards +Y, string at y = +depth."""
    from kit import gn
    pts = []
    for i in range(15):
        u = i / 14 * 2 - 1
        z = u * length / 2
        y = -depth * (1 - u * u) ** 1.2
        r = 1.0 - 0.55 * abs(u) ** 1.3
        pts.append((0.0, y, z, r))
    cu = gn.make_curve([pts], name + "_Curve", kind="NURBS", resolution=4)
    gn.curve_to_mesh(cu, radius=0.016, profile_res=7)
    bow = gn.apply(cu)
    bow.data.materials.clear()
    bow.data.materials.append(m_wood)
    bow.data.transform(Matrix.Diagonal((0.75, 1.0, 1.0, 1.0)))   # flatter limbs
    tipz = length / 2
    tip_y = 0.0
    grip = lathe(name + "_Grip", [(-0.06, 0.019), (-0.05, 0.021), (0.05, 0.021), (0.06, 0.019)], 8, m_grip, cap0=False, cap1=False)
    xf(grip, T(0, -depth, 0) @ Matrix.Diagonal((0.85, 1.0, 1.0, 1.0)))
    string = lathe(name + "_String", [(-tipz + 0.035, 0.0022), (tipz - 0.035, 0.0022)], 4, m_string)
    xf(string, T(0, 0.004, 0))
    nock_a = lathe(name + "_NockA", [(0, 0.009), (0.03, 0.006), (0.045, 0.0)], 6, m_grip)
    nock_b = lathe(name + "_NockB", [(0, 0.009), (0.03, 0.006), (0.045, 0.0)], 6, m_grip)
    xf(nock_a, T(0, tip_y, tipz - 0.04))
    xf(nock_b, T(0, tip_y, -tipz + 0.04) @ R(180, 0, 0))
    ob = join([bow, grip, string, nock_a, nock_b], name)
    xf(ob, T(0, depth, 0))            # grip at the origin, string at y = +depth
    return ob


def _segment(name, a, b, r, mat, seg=4):
    a, b = Vector(a), Vector(b)
    d = b - a
    ob = lathe(name, [(0.0, r), (d.length, r)], seg, mat)
    q = Vector((0, 0, 1)).rotation_difference(d.normalized())
    xf(ob, Matrix.Translation(a) @ q.to_matrix().to_4x4())
    return ob


def arrow(name, m_shaft, m_head, m_fletch, length=0.75):
    """Arrow along local +Z, nock at z=0."""
    shaft = lathe(name + "_Shaft", [(0.0, 0.0045), (length - 0.05, 0.0045)], 5, m_shaft)
    head = lathe(name + "_Head", [(length - 0.055, 0.005), (length - 0.05, 0.011), (length, 0.0)], 4, m_head, smooth=False)
    fl = []
    for k in range(3):
        a = k * 2 * math.pi / 3
        d = Vector((math.cos(a), math.sin(a), 0))
        v = [(0, 0, 0.02), (0, 0, 0.12), tuple(d * 0.016 + Vector((0, 0, 0.1))), tuple(d * 0.016 + Vector((0, 0, 0.035)))]
        v = [tuple(Vector(p) + d * 0.004) for p in v]
        f = G.new_obj(name + f"_F{k}", v, [(0, 1, 2, 3)], m_fletch)
        md = f.modifiers.new("Th", "SOLIDIFY")
        md.thickness = 0.0015
        G._apply_all(f)
        fl.append(f)
    return join([shaft, head] + fl, name)


def pouch(name, mat, size=(0.08, 0.04, 0.09), flap_mat=None, seed=0):
    """Leather pouch: rounded box + flap."""
    body = box(name, size, mat, bevel=0.012)
    gn_disp(body, 0.003, 30.0, seed)
    flap = box(name + "_Flap", (size[0] * 1.04, size[1] * 0.4, size[2] * 0.45), flap_mat or mat, bevel=0.008,
               center=(0, -size[1] * 0.35, size[2] * 0.28))
    return join([body, flap], name)


def gn_disp(obj, strength, scale, seed=0):
    from kit import gn
    sub = obj.modifiers.new("Sub", "SUBSURF")
    sub.levels = 1
    gn.displace(obj, strength=strength, scale=scale, detail=3.0, seed=seed, voronoi=0.0)
    gn.apply(obj)
    return obj
