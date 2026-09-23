"""Sand wyrm (boss, ≈9 m of body): a colossal desert worm rising ~4.3 m out of the sand. Continuous ribbed body with
overlapping sun-bleached armour plates along the back (one plate per segment, sculpted high -> low), soft ringed
underbelly, a circular maw ringed by three rows of inward-pointing teeth inside a wet fleshy funnel, guarded by four
armoured mandible petals that flare open. Rig: a spine bone chain (tail <- hips -> spine -> head) + 4 maw petals.
Clips: Idle Walk (slither) Run Attack (bite lunge) Attack2 (rear up and slam down) Hit Death
Special (burrow under z=0 and burst out)."""
import math
import random

import bmesh
import bpy
from mathutils import Matrix, Quaternion, Vector

import banim as A
import gk
import gmat
from kit import bake, gn, materials as M, rig

KEY = "sand_wyrm"

# centreline control points (y, z) from the tail tip to the maw, with radii
CTRL = [((4.7, 0.16), 0.1), ((3.9, 0.3), 0.26), ((3.1, 0.46), 0.4), ((2.3, 0.6), 0.52), ((1.5, 0.72), 0.63),
        ((0.75, 0.8), 0.72), ((0.1, 1.15), 0.78), ((-0.2, 1.9), 0.8), ((-0.28, 2.7), 0.78), ((-0.36, 3.4), 0.76),
        ((-0.66, 3.95), 0.84), ((-1.12, 4.12), 0.98)]
CTRL = [((p[0], p[1] + 0.12 * (r * 1.15 - r) * (1 if p[1] < 1.0 else 0)), r * 1.15) for p, r in CTRL]


def _catmull(P, n_out):
    """Centripetal-ish Catmull-Rom through the points, resampled to n_out points evenly by arc length."""
    pts = [Vector((0.0, p[0], p[1])) for p, r in P]
    rad = [r for p, r in P]
    dense, drad = [], []
    for i in range(len(pts) - 1):
        p0 = pts[max(i - 1, 0)]
        p1, p2 = pts[i], pts[i + 1]
        p3 = pts[min(i + 2, len(pts) - 1)]
        for k in range(20):
            t = k / 20
            t2, t3 = t * t, t * t * t
            q = 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
            dense.append(q)
            drad.append(rad[i] + (rad[i + 1] - rad[i]) * (t * t * (3 - 2 * t)))
    dense.append(pts[-1])
    drad.append(rad[-1])
    L = [0.0]
    for a, b in zip(dense[:-1], dense[1:]):
        L.append(L[-1] + (b - a).length)
    total = L[-1]
    out, orad, j = [], [], 0
    for k in range(n_out):
        s = total * k / (n_out - 1)
        while j < len(L) - 2 and L[j + 1] < s:
            j += 1
        f = (s - L[j]) / max(L[j + 1] - L[j], 1e-9)
        out.append(dense[j].lerp(dense[j + 1], f))
        orad.append(drad[j] + (drad[j + 1] - drad[j]) * f)
    return out, orad, total


N_RING = 90
CENT, RAD, LENGTH = None, None, None


def centre():
    global CENT, RAD, LENGTH
    if CENT is None:
        CENT, RAD, LENGTH = _catmull(CTRL, N_RING)
    return CENT, RAD


def frames(pts):
    """Tangent / 'up' (dorsal) / side frames along the centreline (all in the YZ plane: side = +X)."""
    out = []
    n = len(pts)
    for i in range(n):
        t = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
        side = Vector((1, 0, 0))
        up = side.cross(t).normalized()          # dorsal direction (perpendicular to tangent, in YZ plane)
        # the dorsal side of the lying part must point up (+Z); of the raised part, backwards (+Y)
        if up.z < 0 and abs(t.z) < 0.7:
            up = -up
        if abs(t.z) >= 0.7 and up.y < 0:
            up = -up
        out.append((t, up, t.cross(up).normalized()))
    return out


# ----------------------------------------------------------------------------- body
def body_mesh(seg=24, name="WyrmBody"):
    pts, rad = centre()
    F = frames(pts)
    verts, faces = [], []
    n = len(pts)
    for i in range(n):
        t, up, sd = F[i]
        r = rad[i]
        u = i / (n - 1)
        # segment rings: subtle constriction every segment (18 segments along the body)
        ring = 1.0 - 0.045 * (0.5 + 0.5 * math.cos(u * 18 * 2 * math.pi))
        for s in range(seg):
            a = 2 * math.pi * s / seg
            # flatter belly (ventral side = -up)
            c, sn = math.cos(a), math.sin(a)
            belly = 0.88 if c < 0 else 1.0
            verts.append(pts[i] + (up * c * belly + sd * sn) * r * ring)
    for i in range(n - 1):
        for s in range(seg):
            a, b = i * seg + s, i * seg + (s + 1) % seg
            faces.append((a, b, b + seg, a + seg))
    # tail cap
    verts.append(pts[0] - F[0][0] * rad[0] * 0.6)
    c0 = len(verts) - 1
    for s in range(seg):
        faces.append((c0, (s + 1) % seg, s))
    # head cap (hidden behind the maw funnel)
    verts.append(pts[-1] - F[-1][0] * 0.25)
    c1 = len(verts) - 1
    base = (n - 1) * seg
    for s in range(seg):
        faces.append((c1, base + s, base + (s + 1) % seg))
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    gk.cleanup(ob, keep_largest=False)
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


BODY_LAYERS = [
    {"type": "noise", "scale": 1.5, "amp": 0.02, "detail": 2},
    {"type": "ridges", "scale": 7.0, "amp": 0.012, "stretch": (3.0, 0.6, 0.6), "sharp": 3, "seed": 3},   # ring folds
    {"type": "bumps", "scale": 18.0, "amp": 0.006, "size": 0.35, "density": 0.5, "seed": 5, "store": "wart"},
    {"type": "noise", "scale": 12.0, "amp": 0.004, "detail": 4, "seed": 7},
]


def plates(mat, n_seg=17):
    """One overlapping armour plate per body segment on the dorsal side (sector of a flared ring + thickness)."""
    pts, rad = centre()
    F = frames(pts)
    n = len(pts)
    lows, highs = [], []
    for k in range(n_seg):
        i0 = int((k + 0.15) / 18 * (n - 1))
        i1 = min(int((k + 1.25) / 18 * (n - 1)), n - 1)
        if i1 - i0 < 3:
            continue
        verts, faces = [], []
        seg = 16
        span = math.radians(125)
        rows = 5
        for r_ in range(rows + 1):
            f = r_ / rows
            ii = int(round(i0 + (i1 - i0) * f))
            t, up, sd = F[ii]
            rr = rad[ii] * (1.06 + 0.06 * f)           # rear edge lifted -> overlaps the next plate
            for s in range(seg + 1):
                a = -span + 2 * span * s / seg
                edge = 1.0 - 0.1 * (abs(a) / span) ** 3
                verts.append(pts[ii] + (up * math.cos(a) + sd * math.sin(a)) * rr * edge)
        for r_ in range(rows):
            for s in range(seg):
                a0 = r_ * (seg + 1) + s
                faces.append((a0, a0 + 1, a0 + seg + 2, a0 + seg + 1))
        me = bpy.data.meshes.new(f"Plate{k}")
        me.from_pydata([tuple(v) for v in verts], [], faces)
        ob = bpy.data.objects.new(f"Plate{k}", me)
        bpy.context.scene.collection.objects.link(ob)
        gk.cleanup(ob, keep_largest=False)
        # outward normals
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        bm.normal_update()
        cen = pts[(i0 + i1) // 2]
        if sum(f.normal.dot(f.calc_center_median() - cen) for f in bm.faces) < 0:
            bmesh.ops.reverse_faces(bm, faces=bm.faces)
        bm.to_mesh(ob.data)
        bm.free()
        for p in ob.data.polygons:
            p.use_smooth = True
        gn.solidify(ob, 0.06, offset=-1.0)
        gn.apply(ob)
        gk.set_mat(ob, mat)
        hi = gk.dup(ob, f"_PlateHi{k}")
        gk.sculpt(hi, [{"type": "noise", "scale": 4.0, "amp": 0.008, "seed": k},
                       {"type": "cracks", "scale": 5.0, "amp": 0.01, "width": 0.04, "seed": k, "warp": 0.8},
                       {"type": "bumps", "scale": 25.0, "amp": -0.004, "size": 0.3, "density": 0.4, "seed": k + 3}],
                  subdiv=2, name=f"PlSc{k}")
        gn.apply(hi)
        lows.append(ob)
        highs.append(hi)
    return gk.join(lows, "Plates"), gk.join(highs, "_PlatesHigh")


def maw(flesh, tooth, chitin):
    """Fleshy funnel + 3 rings of teeth at the head end, 4 armoured petals (separate objects, one per bone)."""
    pts, rad = centre()
    F = frames(pts)
    t, up, sd = F[-1]
    c = pts[-1]
    R = rad[-1]
    Mx = Matrix((sd, up, t)).transposed()           # local x=side, y=up, z=forward
    prof = [(R * 1.02, 0.02), (R * 0.95, 0.06), (R * 0.72, -0.02), (R * 0.5, -0.22), (R * 0.32, -0.5), (R * 0.15, -0.8),
            (R * 0.05, -0.95)]
    fun = gk.lathe([(r, z) for r, z in prof], seg=28, name="Maw", cap_top=False, cap_bottom=True)
    for v in fun.data.vertices:
        v.co = c + Mx @ v.co
    fun.data.update()
    gk.cleanup(fun, keep_largest=False)
    # normals must face INTO the funnel (towards its axis / the viewer looking in)
    bm = bmesh.new()
    bm.from_mesh(fun.data)
    bm.normal_update()
    sc = 0.0
    for f in bm.faces:
        q = f.calc_center_median() - c
        radial = q - t * q.dot(t)
        sc += f.normal.dot(radial)
    if sc > 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.to_mesh(fun.data)
    bm.free()
    gk.set_mat(fun, flesh)
    teeth = []
    rnd = random.Random(9)
    for ring, (depth, rr, count, ln) in enumerate(((0.02, 0.93, 16, 0.42), (-0.2, 0.6, 13, 0.34), (-0.46, 0.38, 10, 0.26))):
        for k in range(count):
            a = 2 * math.pi * (k + 0.5 * ring) / count
            radial = sd * math.cos(a) + up * math.sin(a)
            base = c + t * depth + radial * R * rr
            tip = base - radial * ln * rnd.uniform(0.8, 1.15) - t * ln * 0.45
            teeth.append(gk.spike(base + radial * 0.02, tip, 0.065 * (1.0 - 0.2 * ring), seg=5, rings=3,
                                  bend=tuple(t * 0.03), name="Tooth"))
    for o in teeth:
        gk.set_mat(o, tooth)
    petals = {}
    for name, a in (("U", 0.5 * math.pi), ("D", 1.5 * math.pi), ("L", 0.0), ("R", math.pi)):
        radial = sd * math.cos(a) + up * math.sin(a)
        other = t.cross(radial).normalized()
        vs, fs = [], []
        rows, cols = 6, 8
        for i in range(rows + 1):
            f = i / rows
            wdt = 0.72 * R * (1 - 0.8 * f ** 1.5)
            for j in range(cols + 1):
                g = -1 + 2 * j / cols
                p = c + t * (0.05 + 0.85 * f) + radial * (R * (1.02 + 0.15 * f) - 0.35 * f * f) \
                    + other * (g * wdt) - radial * (0.1 * g * g * (1 - f))
                vs.append(p)
        for i in range(rows):
            for j in range(cols):
                a0 = i * (cols + 1) + j
                fs.append((a0, a0 + 1, a0 + cols + 2, a0 + cols + 1))
        me = bpy.data.meshes.new(f"Petal{name}")
        me.from_pydata([tuple(v) for v in vs], [], fs)
        ob = bpy.data.objects.new(f"Petal{name}", me)
        bpy.context.scene.collection.objects.link(ob)
        gk.cleanup(ob, keep_largest=False)
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        bm.normal_update()
        if sum(f.normal.dot(radial) for f in bm.faces) < 0:
            bmesh.ops.reverse_faces(bm, faces=bm.faces)
        bm.to_mesh(ob.data)
        bm.free()
        for p in ob.data.polygons:
            p.use_smooth = True
        gn.solidify(ob, 0.07, offset=-1.0)
        gn.apply(ob)
        # a hook-spike at the petal tip
        tipp = c + t * 0.9 + radial * (R * 1.17 - 0.35)
        hk = gk.spike(tipp - t * 0.1, tipp + t * 0.35 - radial * 0.25, 0.08, seg=6, rings=3, name="Hook")
        gk.set_mat(ob, chitin)
        gk.set_mat(hk, tooth)
        petals[name] = gk.join([ob, hk], f"Petal{name}")
    return fun, gk.join(teeth, "Teeth"), petals


# ----------------------------------------------------------------------------- rig
N_SPINE = 6
N_TAIL = 6


def rig_joints():
    pts, rad = centre()
    n = len(pts)
    # anchor ("hips") = the ground bend around index ~ 0.43 of the length
    ia = int(0.46 * (n - 1))
    ib = int(0.56 * (n - 1))
    J, P = {"root": ((0, 0, 0), (0, -0.5, 0))}, {}
    J["hips"] = (tuple(pts[ia]), tuple(pts[ib]))
    P["hips"] = "root"
    # tail chain from the anchor back to the tail tip
    prev, head_i = "hips", ia
    for k in range(N_TAIL):
        i1 = int(ia * (1 - (k + 1) / N_TAIL))
        nm = f"tail.{k + 1}"
        J[nm] = (tuple(pts[head_i]), tuple(pts[i1]))
        P[nm] = prev
        prev, head_i = nm, i1
    # spine chain from the bend up to the head
    ih = int(0.93 * (n - 1))
    prev, head_i = "hips", ib
    for k in range(N_SPINE):
        i1 = int(ib + (ih - ib) * (k + 1) / N_SPINE)
        nm = f"spine.{k + 1}"
        J[nm] = (tuple(pts[head_i]), tuple(pts[i1]))
        P[nm] = prev
        prev, head_i = nm, i1
    J["head"] = (tuple(pts[ih]), tuple(pts[-1] + (pts[-1] - pts[ih]).normalized() * 0.4))
    P["head"] = prev
    F = frames(pts)
    t, up, sd = F[-1]
    c = pts[-1]
    R = rad[-1]
    for name, a in (("U", 0.5 * math.pi), ("D", 1.5 * math.pi), ("L", 0.0), ("R", math.pi)):
        radial = sd * math.cos(a) + up * math.sin(a)
        h = c + radial * R * 0.95
        J[f"maw.{name}"] = (tuple(h), tuple(h + t * 0.7 + radial * 0.1))
        P[f"maw.{name}"] = "head"
    return J, P


SPINE = [f"spine.{k + 1}" for k in range(N_SPINE)]
TAIL = [f"tail.{k + 1}" for k in range(N_TAIL)]


def maw_open(amount, base=None):
    """Petal pose: open = rotate each petal outwards (around the axis perpendicular to head dir & radial)."""
    a = amount
    return {"maw.U": (-a, 0, 0), "maw.D": (a, 0, 0), "maw.L": (0, a * 0.2, -a), "maw.R": (0, -a * 0.2, a)}


def clips(R):
    key = R.key

    def wave(ph, amp_tail, amp_spine, lag=0.14, pitch=0.0):
        p = {}
        for k, b in enumerate(TAIL):
            p[b] = (0, 0, amp_tail * (0.6 + 0.12 * k) * math.sin(2 * math.pi * (ph - lag * (k + 1))))
        p["hips"] = {"rot": (0, 0, amp_tail * 0.4 * math.sin(2 * math.pi * ph)), "loc": (0, 0, 0)}
        for k, b in enumerate(SPINE):
            p[b] = (pitch * (1 if k < 3 else 0.5), amp_spine * math.sin(2 * math.pi * (ph + lag * (k + 1))),
                    amp_spine * 0.7 * math.sin(2 * math.pi * (ph + lag * (k + 1)) + 0.8))
        return p

    # Idle: slow menacing sway, maw breathing
    ks = []
    for f in range(0, 73, 6):
        ph = f / 72
        p = wave(ph, 4, 2.2)
        p["head"] = (6 + 3 * math.sin(2 * math.pi * ph), 0, 4 * math.sin(2 * math.pi * ph + 1))
        p.update(maw_open(8 + 8 * math.sin(2 * math.pi * ph)))
        ks.append((f, p))
    key("Idle", ks, cyclic=True)
    # Walk: lateral slither (in place)
    ks = []
    for f in range(0, 33, 2):
        ph = f / 32
        p = wave(ph, 12, 3.0, pitch=4)
        p["head"] = (8, 0, -5 * math.sin(2 * math.pi * ph))
        p.update(maw_open(5))
        ks.append((f, p))
    key("Walk", ks, cyclic=True)
    # Run: faster, bigger waves, raised part leaning forward
    ks = []
    for f in range(0, 21, 2):
        ph = f / 20
        p = wave(ph, 18, 4.0, lag=0.16, pitch=9)
        p["head"] = (12, 0, -6 * math.sin(2 * math.pi * ph))
        p.update(maw_open(12))
        ks.append((f, p))
    key("Run", ks, cyclic=True)
    # Attack: coil back, lunge forward-down with the maw flared, snap shut, recover (1.0 s)
    back = {b: (-7, 0, 0) for b in SPINE}
    back.update({"head": (-12, 0, 0)}, **maw_open(20))
    lunge = {b: (14 + 2 * k, 0, 0) for k, b in enumerate(SPINE)}
    lunge.update({"head": (12, 0, 0), "hips": {"rot": (0, 0, 0), "loc": (0, -0.3, 0)}}, **maw_open(55))
    bite = A.add(lunge, maw_open(-50))
    key("Attack", [(0, {}), (7, back), (11, lunge), (13, bite), (17, A.scale(bite, 0.7)), (24, {})])
    # Attack2: rear up and back (0.75 s telegraph), then slam the front body down onto the ground (1.5 s)
    rear = {b: (-9 - 2 * k, 0, 0) for k, b in enumerate(SPINE)}
    rear.update({"head": (-10, 0, 0), "hips": {"rot": (0, 0, 0), "loc": (0, 0.35, 0.25)}}, **maw_open(45))
    slam = {"spine.1": (48, 0, 0), "spine.2": (22, 0, 0), "spine.3": (14, 0, 0), "spine.4": (8, 0, 0), "spine.5": (6, 0, 0),
            "spine.6": (-4, 0, 0), "head": (-12, 0, 0), "hips": {"rot": (0, 0, 0), "loc": (0, -0.2, -0.05)}}
    slam.update(maw_open(10))
    impact = A.add(slam, {"spine.1": (4, 0, 0), "spine.2": (3, 0, 0), "head": (-4, 0, 0)})
    key("Attack2", [(0, {}), (8, A.scale(rear, 0.6)), (18, rear), (22, A.lerp(rear, slam, 0.6)), (25, slam), (27, impact),
                    (32, slam), (40, A.scale(slam, 0.35)), (48, {})])
    # Hit: recoil back + petals twitch
    rec = {b: (-6, 0, 3) for b in SPINE}
    rec.update({"head": (-14, 0, 6)}, **maw_open(30))
    key("Hit", [(0, {}), (3, rec), (7, A.scale(rec, -0.25)), (12, {})])
    # Death: shudder, then the raised body collapses sideways onto the sand, a last twitch
    sh1 = {b: (-4, 3, 0) for b in SPINE}
    sh1.update(maw_open(40))
    col = {"spine.1": (60, 25, 0), "spine.2": (20, 10, 0), "spine.3": (10, 6, 0), "spine.4": (6, 4, 0), "spine.5": (6, 0, 0),
           "spine.6": (-6, 0, 0), "head": (-18, 10, 0), "tail.1": (0, 0, 8), "tail.2": (0, 0, 10), "tail.3": (0, 0, 8)}
    col.update(maw_open(25))
    fin = A.add(col, {"spine.1": (6, 3, 0), "head": (-6, 0, 0)}, maw_open(-20))
    key("Death", [(0, {}), (5, sh1), (9, A.scale(sh1, -0.6)), (14, sh1), (26, A.lerp(sh1, col, 0.7)), (34, col),
                  (40, A.add(col, {"spine.1": (-5, 0, 0)})), (46, fin), (60, fin)])
    # Special: burrow — dive head first under the sand (z<0), then burst out with the maw flared (2.25 s)
    dive = {b: (18, 0, 0) for b in SPINE}
    dive.update({"head": (20, 0, 0), "root": {"rot": (0, 0, 0), "loc": (0, 0, -2.5)}}, **maw_open(-10))
    under = {"root": {"rot": (0, 0, 0), "loc": (0, 0, -5.6)}}
    under.update({b: (10, 0, 0) for b in SPINE})
    burst = {b: (-6, 0, 0) for b in SPINE}
    burst.update({"head": (-18, 0, 0), "root": {"rot": (0, 0, 0), "loc": (0, 0, 0.7)}}, **maw_open(60))
    key("Special", [(0, {}), (6, A.scale(dive, 0.3)), (14, dive), (20, under), (30, under), (38, burst),
                    (44, A.add(burst, {"root": {"loc": (0, 0, -0.6)}})), (54, {})])


# ----------------------------------------------------------------------------- build
def build(args, stage):
    mats = {
        "hide": gmat.hide("WyrmHide", c1="#a5885f", c2="#6f5639", belly="#cdb58c", wart="#8a6c48", seed=6,
                          back_dark=0.25, veins=0.1, pores=160.0),
        "chitin": gmat.chitin("WyrmChitin", c1="#b08d5e", c2="#5c432c", edge="#e2cf9f", seed=2),
        "flesh": gmat.flesh("WyrmFlesh", seed=4),
        "tooth": M.bone("WyrmTooth", color="#d8c9a3", dirt=0.6),
    }
    body = body_mesh(seg=24)
    gk.set_mat(body, mats["hide"])
    pl_low, pl_high = plates(mats["chitin"])
    fun, teeth, petals = maw(mats["flesh"], mats["tooth"], mats["chitin"])
    if stage == "shape":
        gk.clay_sheet([body, pl_low, fun, teeth] + list(petals.values()), gk.wip_path(f"{KEY}_clay.png"))
        return {}
    high = gk.sculpt_copy(body, BODY_LAYERS, subdiv=2, name="_WyrmHigh")
    gn.edge_wear(high)
    gn.apply(high)
    gk.sculpt(body, BODY_LAYERS, subdiv=1, max_scale=2.0, name="WyrmLowSc")
    gn.apply(body)
    body.name = "SandWyrm"
    print(f"[wyrm] tris body={gk.tris(body)} plates={gk.tris(pl_low)} maw={gk.tris(fun)} teeth={gk.tris(teeth)} "
          f"petals={sum(gk.tris(p) for p in petals.values())} high={gk.tris(high) + gk.tris(pl_high)}", flush=True)

    J, P = rig_joints()
    R = gk.Rigger(J, P, legs=())
    arm = R.arm
    chain = ["hips"] + SPINE + TAIL + ["head"]
    gk.weights_by_segments(body, arm, bones=chain, falloff=0.35, power=4.0, smooth=3)
    gk.weights_by_segments(pl_low, arm, bones=chain, falloff=0.35, power=4.0, smooth=1)
    for o in (fun, teeth):
        gk.rigid(o, arm, "head")
    for name, ob in petals.items():
        gk.assign_bone(ob, f"maw.{name}")
    pet = gk.join(list(petals.values()), "Petals")          # keeps the per-petal vertex groups
    gk.bind_groups(pet, arm)
    clips(R)
    R.bake()
    meshes = [body, pl_low, fun, teeth, pet]
    gk.ground_clamp(arm, meshes, clips=("Attack", "Attack2", "Hit", "Death"))
    if stage == "anim":
        gk.pose_sheet(KEY + "_anim", meshes, arm, gk.wip_path(""), side_clips=("Walk", "Attack2", "Special"))
        return {}
    for o in (fun, teeth, pet):
        o["kit_bake_direct"] = 1
    hi_all = gk.join([high, pl_high], "_WyrmHighAll")
    bake.bake_asset(meshes, KEY, size=2048, high=hi_all, extrusion=0.07, max_ray=0.18, ao_samples=48, samples=8)
    bpy.data.objects.remove(hi_all, do_unlink=True)
    return gk.finish(KEY, args, arm, meshes, "boss", expected=(None, 5.9, 4.3), hero=("Attack", 11),
                     extra_info={"body_length_m": round(LENGTH or 0, 2)})
