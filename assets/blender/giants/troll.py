"""Troll (≈3 m): hunched forest troll, warty grey-green hide, long arms, tusks, hide loincloth + belt,
tree-trunk club with an iron band and spikes in the right hand."""
import math

import bmesh
import bpy
from mathutils import Quaternion, Vector

import banim as A
import common as C
import gk
import gmat
from kit import bake, gn, materials as M, qa, rig

KEY = "troll"

# ----------------------------------------------------------------------------- skeleton (faces -Y)
SH = (0.64, 0.02, 2.36)      # left shoulder joint
EL = (0.9, 0.12, 1.72)
WR = (1.0, -0.12, 1.12)
HD = (1.04, -0.2, 0.8)
HIP = (0.34, 0.06, 1.24)
KN = (0.42, -0.14, 0.66)
AN = (0.42, 0.06, 0.13)
TO = (0.44, -0.36, 0.04)


def L(p, s=1):
    return (p[0] * s, p[1], p[2])


def joints():
    J = {
        "root": ((0, 0, 0), (0, 0, 0.35)),
        "hips": ((0, 0.06, 1.24), (0, 0.06, 1.55)),
        "spine": ((0, 0.06, 1.55), (0, 0.04, 1.95)),
        "chest": ((0, 0.04, 1.95), (0, -0.05, 2.45)),
        "neck": ((0, -0.12, 2.4), (0, -0.4, 2.52)),
        "head": ((0, -0.4, 2.52), (0, -0.6, 2.82)),
        "jaw": ((0, -0.5, 2.5), (0, -0.82, 2.36)),
    }
    for s, n in ((1, "L"), (-1, "R")):
        J[f"upper_arm.{n}"] = (L(SH, s), L(EL, s))
        J[f"forearm.{n}"] = (L(EL, s), L(WR, s))
        J[f"hand.{n}"] = (L(WR, s), L(HD, s))
        J[f"thigh.{n}"] = (L(HIP, s), L(KN, s))
        J[f"shin.{n}"] = (L(KN, s), L(AN, s))
        J[f"foot.{n}"] = (L(AN, s), L(TO, s))
    return J


PARENTS = {"hips": "root", "spine": "hips", "chest": "spine", "neck": "chest", "head": "neck", "jaw": "head"}
for _n in ("L", "R"):
    PARENTS.update({f"upper_arm.{_n}": "chest", f"forearm.{_n}": f"upper_arm.{_n}", f"hand.{_n}": f"forearm.{_n}",
                    f"thigh.{_n}": "hips", f"shin.{_n}": f"thigh.{_n}", f"foot.{_n}": f"shin.{_n}"})
LEGS = [("L", "thigh.L", "shin.L", "foot.L"), ("R", "thigh.R", "shin.R", "foot.R")]


FINGERS = (-0.075, 0.0, 0.075)


def finger(w, h, d, side, off, s):
    base = w.lerp(h, 0.75) + side * off + Vector((s * 0.02, 0, 0))
    return base, base + d * 0.24 + side * off * 0.4 + Vector((0, -0.05, 0))


# ----------------------------------------------------------------------------- body sculpt
def body_meta(res):
    m = gk.Meta("TrollMB", res=res)
    # torso: pelvis, pot belly, barrel chest, hunched upper back, traps
    m.ellipsoid((0, 0.06, 1.32), (0.44, 0.36, 0.3), stiff=3)
    m.ellipsoid((0, -0.12, 1.62), (0.47, 0.42, 0.42), stiff=3)
    m.ellipsoid((0, 0.02, 2.02), (0.56, 0.44, 0.44), rot=(-12, 0, 0), stiff=3)
    m.ellipsoid((0, 0.2, 2.34), (0.52, 0.4, 0.3), rot=(-25, 0, 0), stiff=3)
    for s in (1, -1):
        m.ellipsoid((0.3 * s, 0.05, 2.46), (0.26, 0.3, 0.2), rot=(0, -18 * s, 0), stiff=3)     # trapezius
        m.ellipsoid((0.26 * s, -0.3, 2.12), (0.26, 0.16, 0.22), rot=(10, 0, 12 * s), stiff=4)   # pecs
        m.ellipsoid((0.4 * s, 0.1, 1.72), (0.18, 0.3, 0.34), stiff=4)                          # flanks
    # neck + head (juts forward, heavy brow, long nose, underbite jaw)
    m.capsule((0, -0.1, 2.36), (0, -0.42, 2.5), 0.2)
    m.ellipsoid((0, -0.52, 2.66), (0.2, 0.22, 0.17), rot=(-15, 0, 0))          # cranium
    m.ellipsoid((0, -0.7, 2.66), (0.2, 0.08, 0.05), rot=(10, 0, 0), stiff=6)    # brow ridge
    m.ellipsoid((0, -0.64, 2.46), (0.21, 0.2, 0.12), rot=(10, 0, 0))            # jaw
    m.ellipsoid((0, -0.76, 2.5), (0.14, 0.08, 0.07), stiff=5)                   # lower lip / chin
    m.limb([((0, -0.72, 2.64), 0.045), ((0, -0.84, 2.58), 0.055), ((0, -0.9, 2.53), 0.04)], stiff=6)   # nose
    for s in (1, -1):
        m.ellipsoid((0.2 * s, -0.46, 2.66), (0.15, 0.035, 0.07), rot=(0, -25 * s, -40 * s), stiff=6)  # ears
        m.ellipsoid((0.13 * s, -0.66, 2.55), (0.07, 0.06, 0.06), stiff=5)                            # cheeks

    def arm(s):
        sh, el, wr, hd = L(SH, s), L(EL, s), L(WR, s), L(HD, s)
        m.ball(sh, 0.27, stiff=3)                                             # deltoid
        m.limb([(sh, 0.22), (el, 0.17)])
        m.ellipsoid(Vector(sh).lerp(Vector(el), 0.45) + Vector((0, 0.05, 0)), (0.17, 0.19, 0.3), stiff=4)
        m.limb([(el, 0.17), (Vector(el).lerp(Vector(wr), 0.35), 0.2), (wr, 0.12)])
        # hand: palm + 3 thick fingers + thumb
        w, h = Vector(wr), Vector(hd)
        m.ellipsoid(w.lerp(h, 0.4), (0.13, 0.17, 0.17), stiff=5)
        d = (h - w).normalized()
        side = Vector((0, -1, 0))
        for off in FINGERS:
            base, tip = finger(w, h, d, side, off, s)
            m.limb([(base, 0.06), (tip, 0.047)], stiff=7)
        tb = w.lerp(h, 0.35) + Vector((0, -0.13, 0))
        m.limb([(tb, 0.058), (tb + Vector((-0.02 * s, -0.12, -0.12)), 0.045)], stiff=7)

    def leg(s):
        hp, kn, an = L(HIP, s), L(KN, s), L(AN, s)
        m.limb([(hp, 0.25), (kn, 0.18)])
        m.ellipsoid(Vector(hp).lerp(Vector(kn), 0.4) + Vector((0.02 * s, -0.03, 0)), (0.2, 0.22, 0.3), stiff=4)
        m.limb([(kn, 0.17), (an, 0.12)])
        m.ellipsoid(Vector(kn).lerp(Vector(an), 0.3) + Vector((0, 0.07, 0)), (0.15, 0.15, 0.22), stiff=4)   # calf
        m.ellipsoid((an[0], an[1] - 0.14, 0.09), (0.15, 0.26, 0.085), stiff=5)                         # foot
        for off in (-0.07, 0.0, 0.07):
            b = Vector((an[0] + off, an[1] - 0.3, 0.07))
            m.limb([(b, 0.05), (b + Vector((off * 0.3, -0.12, -0.02)), 0.04)], stiff=7)

    for s in (1, -1):
        arm(s)
        leg(s)
    return m


SKIN_LAYERS = [
    {"type": "noise", "scale": 2.2, "amp": 0.025, "detail": 2},                       # lumpy mass
    {"type": "noise", "scale": 7.0, "amp": 0.008, "detail": 3, "seed": 3},
    {"type": "bumps", "scale": 10.0, "amp": 0.013, "size": 0.3, "density": 0.35, "seed": 5, "store": "wart"},
    {"type": "bumps", "scale": 24.0, "amp": 0.004, "size": 0.4, "density": 0.5, "seed": 7},
    {"type": "ridges", "scale": 8.0, "amp": 0.004, "stretch": (1, 1, 3.0), "sharp": 3, "seed": 9},   # skin folds
]


# ----------------------------------------------------------------------------- accessories
def ray_radius(target, z, ang, cx=0.0, cy=0.0, far=2.0, reach=None):
    """Distance from the vertical axis (cx, cy) to the OUTERMOST torso/leg surface at height z, direction ang
    (0 = -Y front). Rays go from the axis outwards and keep going through the body (legs below the crotch) up to
    `reach` metres (default: stop at the first gap wider than 0.25 m so a hanging arm is never picked)."""
    d = Vector((math.sin(ang), -math.cos(ang), 0))
    o = Vector((cx, cy, z))
    best = None
    travelled = 0.0
    for _ in range(8):
        ok, loc, n, idx = target.ray_cast(o, d, distance=far - travelled)
        if not ok:
            break
        dist = Vector((loc.x - cx, loc.y - cy, 0)).length
        entering = n.dot(d) < 0
        if entering and best is not None and dist - best > 0.25:
            break                                   # a separate part further out (arm): ignore
        if not entering:
            best = dist
        travelled = dist + 1e-3
        o = loc + d * 1e-3
    return best if best is not None else 0.3


def _outward(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.normal_update()
    score = sum((f.normal.dot(Vector((f.calc_center_median().x, f.calc_center_median().y, 0)))) for f in bm.faces)
    if score < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()


def loincloth(body, mat, z_top=1.52, length0=0.7, side_cut=0.5, flare0=0.03, flare1=0.07, seg=32, rows=7, name="Loincloth",
              step=0.1):
    L0 = length0
    verts, faces = [], []
    for r in range(rows + 1):
        t = r / rows
        for s in range(seg):
            a = 2 * math.pi * s / seg
            sd = abs(math.sin(a))
            length = L0 - side_cut * sd ** 1.2 + L0 * (0.085 * math.sin(7 * a + 1.0) + 0.057 * math.sin(13 * a))
            z = z_top - length * t
            # widest body section between the waist and this height (the cloth hangs outside it: never inside legs)
            rb = max(ray_radius(body, z_top - (z_top - z) * k / 4.0, a) for k in range(5))
            flare = flare0 + flare1 * t ** 1.5 * (1 - sd)
            rr = rb + flare
            verts.append((rr * math.sin(a), -rr * math.cos(a), z))
    for r in range(rows):
        for s in range(seg):
            a0, b0 = r * seg + s, r * seg + (s + 1) % seg
            faces.append((a0, b0, b0 + seg, a0 + seg))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    gk.cleanup(ob, keep_largest=False)
    _outward(ob)
    for p in ob.data.polygons:
        p.use_smooth = True
    gk.set_mat(ob, mat)
    return ob


def ring_tube(body, mat, z, r_add, thick, name, flat=None, wobble=0.02):
    pts = []
    n = 32
    for s in range(n):
        a = 2 * math.pi * s / n
        r = ray_radius(body, z, a) + r_add
        pts.append((r * math.sin(a), -r * math.cos(a), z + wobble * math.sin(3 * a)))
    ob = gk.tube(pts, [thick] * n, seg=8, name=name, closed=True, flat=flat)
    gk.set_mat(ob, mat)
    return ob


def club(wood, iron):
    grip = Vector((-1.03, -0.19, 0.95))
    d = Vector((0.05, -0.94, -0.3)).normalized()
    prof = [(-0.18, 0.08), (-0.1, 0.07), (0.0, 0.066), (0.2, 0.07), (0.45, 0.1), (0.7, 0.15), (0.95, 0.2),
            (1.15, 0.24), (1.33, 0.25), (1.45, 0.2), (1.52, 0.1)]
    pts, rads = [], []
    for t, r in prof:
        wob = Vector((0.02 * math.sin(t * 9.0), 0, 0.02 * math.cos(t * 7.0))) * (1.0 if t > 0.3 else 0.0)
        pts.append(grip + d * t + wob)
        rads.append(r)
    parts = [gk.tube(pts, rads, seg=12, name="ClubTrunk")]
    side0 = d.orthogonal().normalized()
    for t, ang, ln in ((0.85, 1.2, 0.18), (1.1, -2.0, 0.22), (1.3, 3.0, 0.16), (0.55, -0.6, 0.1)):
        p = grip + d * t
        side = side0.copy()
        side.rotate(Quaternion(d, ang))
        r = min(prof, key=lambda k: abs(k[0] - t))[1]
        parts.append(gk.spike(p + side * r * 0.4, p + side * (r + ln) + d * 0.05, r * 0.45, seg=7, rings=2, name="Stub"))
    for o in parts:
        gk.set_mat(o, wood)
    wood_ob = gk.join(parts, "ClubWood")
    gk.sculpt(wood_ob, [{"type": "ridges", "scale": 5.0, "amp": 0.012, "stretch": (1, 1, 0.3), "sharp": 2}], subdiv=1)
    gn.apply(wood_ob)
    bc = grip + d * 1.2
    other = d.cross(side0)
    ring = [bc + (side0 * math.cos(2 * math.pi * s / 24) + other * math.sin(2 * math.pi * s / 24)) * 0.262 for s in range(24)]
    band = gk.tube(ring, [0.03] * 24, seg=6, name="Band", closed=True, loop_axis=tuple(d), flat=(0.45, 1.8))
    iron_parts = [band]
    for k in range(6):
        a = 2 * math.pi * k / 6 + 0.3
        nrm = side0 * math.cos(a) + other * math.sin(a)
        c = grip + d * (1.2 + (0.1 if k % 2 else -0.1)) + nrm * 0.21
        iron_parts.append(gk.spike(c, c + nrm * 0.17, 0.035, seg=6, rings=2, name="ClubSpike"))
    for o in iron_parts:
        gk.set_mat(o, iron)
    iron_ob = gk.join(iron_parts, "ClubIron")
    return gk.join([wood_ob, iron_ob], "Club")


def teeth_claws(bone_mat, eye_mat=None):
    parts = []
    eyes = []
    if eye_mat is not None:
        for s in (1, -1):
            e = gk.rounded_box((0.07, 0.05, 0.045), 0.7, cuts=2, name="Eye", loc=(0.1 * s, -0.715, 2.615), rot=(0, 0, -15 * s))
            gk.set_mat(e, eye_mat)
            eyes.append(e)
    for s in (1, -1):   # lower tusks jutting up from the jaw
        parts.append(gk.spike((0.1 * s, -0.8, 2.43), (0.16 * s, -0.86, 2.62), 0.035, seg=7, rings=3,
                              bend=(0.02 * s, -0.03, 0), name="Tusk"))
        parts.append(gk.spike((0.05 * s, -0.84, 2.45), (0.06 * s, -0.87, 2.52), 0.016, seg=6, rings=2, name="Tooth"))
    for s in (1, -1):   # claws on fingers and toes
        w, h = Vector(L(WR, s)), Vector(L(HD, s))
        d = (h - w).normalized()
        side = Vector((0, -1, 0))
        for off in FINGERS:
            base, tip = finger(w, h, d, side, off, s)
            parts.append(gk.spike(tip - d * 0.03, tip + d * 0.07 + Vector((0, -0.02, 0)), 0.03, seg=6, rings=2,
                                  bend=(0, -0.015, 0), name="Claw"))
        an = L(AN, s)
        for off in (-0.07, 0.0, 0.07):
            b = Vector((an[0] + off, an[1] - 0.3, 0.07))
            tip = b + Vector((off * 0.3, -0.12, -0.02))
            parts.append(gk.spike(tip + Vector((0, 0.01, 0.0)), tip + Vector((off * 0.1, -0.08, -0.03)), 0.03, seg=6,
                                  rings=2, name="ToeClaw"))
    for o in parts:
        gk.set_mat(o, bone_mat)
    return gk.join(parts + eyes, "Horn")


# ----------------------------------------------------------------------------- animation
def clips(R):
    stance = {"hips": {"rot": (4, 0, 0), "loc": (0, 0, -0.05)}, "spine": (6, 0, 0), "neck": (-4, 0, 0), "head": (-8, 0, 0),
              "upper_arm.L": (-6, -4, 0), "upper_arm.R": (-12, 2, 0), "forearm.L": (-18, 0, 0), "forearm.R": (-22, 0, 0),
              "hand.R": (-8, 0, 0)}
    B = A.Biped(R, dict(stance=stance, stride=0.8, lift=0.2, walk_frames=28, bob=0.05, sway=0.05, arm_swing=16,
                        lean=5, run_stride=1.15, run_lift=0.3, run_frames=18, run_lean=16, run_bob=0.08, heavy=0.7,
                        jaw=True, swing_R=0.45))
    B.idle(frames=60)
    B.walk()
    B.run()
    # Attack: one-handed diagonal club smash (1.0 s)
    wind = {"hips": {"rot": (-4, 0, -12), "loc": (0, 0.06, -0.02)}, "spine": (-6, 0, -12), "chest": (-4, -4, -22),
            "head": (-6, 0, 18), "upper_arm.R": (-125, 35, 0), "forearm.R": (-65, 0, 0), "hand.R": (-15, 0, 0),
            "upper_arm.L": (-35, -12, 0), "forearm.L": (-30, 0, 0), "jaw": (10, 0, 0),
            "ik_foot.R": {"loc": (0, -0.12, 0.14)}}
    strike = {"hips": {"rot": (6, 0, 10), "loc": (0, -0.1, -0.08)}, "spine": (10, 0, 10), "chest": (8, 4, 26),
              "head": (-10, 0, -10), "upper_arm.R": (-82, -12, 0), "forearm.R": (-12, 0, 0), "hand.R": (-22, 0, 0),
              "upper_arm.L": (10, -18, 0), "forearm.L": (-25, 0, 0), "jaw": (22, 0, 0),
              "ik_foot.R": {"loc": (0, -0.34, 0)}}
    follow = A.add(strike, {"spine": (5, 0, 4), "chest": (3, 0, 8), "upper_arm.R": (25, -12, 0),
                            "hips": {"loc": (0, -0.02, -0.03)}})
    B.key("Attack", [(0, {}), (4, A.scale(wind, 0.45)), (9, wind), (12, strike), (15, follow), (24, {})])
    # Attack2: telegraphed two-handed overhead slam (0.7 s wind-up, 1.5 s)
    antic = {"hips": {"rot": (8, 0, 0), "loc": (0, 0.02, -0.12)}, "spine": (12, 0, 0), "upper_arm.R": (-30, 10, 0),
             "upper_arm.L": (-30, -10, 0), "forearm.R": (-30, 0, 0), "forearm.L": (-30, 0, 0)}
    up = {"hips": {"rot": (-6, 0, 0), "loc": (0, 0.1, 0.04)}, "spine": (-10, 0, 0), "chest": (-16, 0, 0), "neck": (-6, 0, 0),
          "head": (-18, 0, 0), "upper_arm.R": (-168, 8, 0), "upper_arm.L": (-160, -8, 0), "forearm.R": (-55, 0, 0),
          "forearm.L": (-70, 0, 0), "hand.R": (-20, 0, 0), "jaw": (28, 0, 0),
          "ik_foot.R": {"loc": (0, -0.05, 0.05)}}
    slam = {"hips": {"rot": (12, 0, 0), "loc": (0, -0.16, -0.26)}, "spine": (20, 0, 0), "chest": (14, 0, 0), "neck": (-10, 0, 0),
            "head": (-12, 0, 0), "upper_arm.R": (-84, -6, 0), "upper_arm.L": (-80, 6, 0), "forearm.R": (-8, 0, 0),
            "forearm.L": (-20, 0, 0), "hand.R": (-12, 0, 0), "jaw": (20, 0, 0),
            "ik_foot.R": {"loc": (0, -0.4, 0)}, "ik_foot.L": {"loc": (0, 0.1, 0)}}
    B.key("Attack2", [(0, {}), (6, antic), (13, A.lerp(antic, up, 0.8)), (17, up), (21, slam),
                      (24, A.add(slam, {"hips": {"loc": (0, 0, -0.03)}, "spine": (3, 0, 0)})), (30, A.scale(slam, 0.5)),
                      (36, {})])
    B.hit()
    B.death(frames=52, fall_x=82.0, lift=1.25)


# ----------------------------------------------------------------------------- build
def build(args, stage):
    mats = {
        "skin": gmat.hide("TrollHide", c1="#5f6552", c2="#3a3d31", belly="#8d8567", wart="#8b7a58", seed=3),
        "horn": M.bone("TrollHorn", color="#b9a27a", dirt=0.8),
        "eye": M.emissive("TrollEye", color="#e0a030", strength=2.5),
        "loin": M.leather("Cloth_TrollLoin", color="#4b3526", wear=0.5, dirt=0.7),
        "belt": M.leather("TrollBelt", color="#2e2219", wear=0.6, dirt=0.5),
        "wood": M.bark("TrollClub", kind="oak", moss=0.25, seed=5),
        "iron": M.metal("TrollIron", kind="blackiron", rust=0.65, grime=0.6, wear=0.5),
    }
    base = body_meta(0.018).to_mesh("TrollBase")
    if stage == "shape":
        hi = gk.sculpt_copy(base, SKIN_LAYERS, subdiv=1, name="TrollHigh")
        extra = [teeth_claws(mats["horn"], mats["eye"]), club(mats["wood"], mats["iron"]), loincloth(base, mats["loin"]),
                 ring_tube(base, mats["belt"], 1.5, 0.035, 0.03, "Belt", flat=(1.0, 1.6))]
        gk.clay_sheet([hi] + extra, gk.wip_path(f"{KEY}_clay.png"))
        return {}
    gk.set_mat(base, mats["skin"])
    high = gk.sculpt_copy(base, SKIN_LAYERS, subdiv=1, name="_TrollHigh")
    gn.edge_wear(high)
    gn.apply(high)
    body = gk.retopo(base, faces=4600, layers=SKIN_LAYERS, max_scale=2.5, name="Troll")
    gk.set_mat(body, mats["skin"])
    horn = teeth_claws(mats["horn"], mats["eye"])
    weapon = club(mats["wood"], mats["iron"])
    loin = loincloth(base, mats["loin"])
    bt = ring_tube(base, mats["belt"], 1.5, 0.035, 0.03, "Belt", flat=(1.0, 1.6))
    bpy.data.objects.remove(base, do_unlink=True)
    print(f"[troll] tris body={gk.tris(body)} horn={gk.tris(horn)} club={gk.tris(weapon)} loin={gk.tris(loin)} "
          f"belt={gk.tris(bt)} high={gk.tris(high)}", flush=True)

    R = gk.Rigger(joints(), PARENTS, legs=LEGS, pole_dist=1.2)
    arm = R.arm
    src = gk.dup(body, "_BodySrc")
    rig.bind(body, arm, smooth=3)
    rig.bind(src, arm, smooth=3)
    rig.transfer_weights(src, horn, arm, smooth=1)
    rig.transfer_weights(src, loin, arm, smooth=25, factor=0.7)
    rig.transfer_weights(src, bt, arm, smooth=12)
    gk.rigid(weapon, arm, "hand.R")
    gn.solidify(loin, 0.012, offset=-1.0)
    bpy.data.objects.remove(src, do_unlink=True)
    clips(R)
    R.bake()
    meshes = [body, horn, loin, bt, weapon]
    gk.ground_clamp(arm, meshes)
    if stage == "anim":
        gk.pose_sheet(KEY + "_anim", meshes, arm, gk.wip_path(""))
        return {}
    qa.delete_covered_body(body, [loin], margin=0.012, max_depth=0.3, shrink=0.01)
    for o in (horn, weapon, loin, bt):
        o["kit_bake_direct"] = 1
    high.hide_render = False
    bake.bake_asset(meshes, KEY, size=2048, high=high, extrusion=0.05, max_ray=0.12, ao_samples=48, samples=8,
                    group_sizes={"Cloth_TrollLoin": 1024})
    bpy.data.objects.remove(high, do_unlink=True)
    return gk.finish(KEY, args, arm, meshes, "beast", expected=(None, None, 2.95), body=body, cloths=[loin],
                     hero=("Attack2", 16))
