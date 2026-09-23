"""Golem ("Golem ancien", boss ≈4 m): an ancient construct of carved, chipped stone plates held together by a dark
basalt core veined with glowing cyan rune channels; engraved glowing runes on the plates, moss and hanging roots,
crystals on the back, an amber heart-core in the chest, glowing eyes, hinged stone jaw.

Plates: rounded boxes -> high = GN subdivision + planar cuts (chipped facets) + cracks/erosion sculpt; low = decimated
high (same silhouette). Plates are rigid per bone (it is a construct); the core body is one continuous mesh with
smooth skin weights. Clips: Idle Walk Run Attack Attack2 (double-fist slam) Hit Death Special (roar + ground stomp).
Keeps the old golem footprint (≈3.9 x 2.5 m, ≈4.1 m tall)."""
import math

import bpy
from mathutils import Vector

import banim as A
import gk
import gmat
from kit import bake, gn, materials as M, rig

KEY = "golem"

SH = (1.02, 0.1, 3.1)
EL = (1.36, 0.16, 2.28)
WR = (1.46, -0.04, 1.42)
HD = (1.48, -0.12, 0.8)
HIP = (0.55, 0.05, 1.45)
KN = (0.62, -0.18, 0.82)
AN = (0.62, 0.05, 0.24)
TO = (0.62, -0.55, 0.06)


def L(p, s=1):
    return (p[0] * s, p[1], p[2])


def joints():
    J = {
        "root": ((0, 0, 0), (0, 0, 0.4)),
        "hips": ((0, 0.05, 1.45), (0, 0.05, 1.9)),
        "spine": ((0, 0.05, 1.9), (0, 0.08, 2.4)),
        "chest": ((0, 0.08, 2.4), (0, 0.0, 3.25)),
        "neck": ((0, -0.15, 3.2), (0, -0.45, 3.35)),
        "head": ((0, -0.45, 3.35), (0, -0.62, 3.85)),
        "jaw": ((0, -0.45, 3.35), (0, -0.92, 3.18)),
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


# ----------------------------------------------------------------------------- core body (glowing basalt)
def core_meta(res):
    m = gk.Meta("GolemCore", res=res)
    m.ellipsoid((0, 0.05, 1.6), (0.62, 0.45, 0.35), stiff=3)
    m.ellipsoid((0, 0.05, 2.15), (0.62, 0.45, 0.45), stiff=3)
    m.ellipsoid((0, 0.1, 2.8), (0.85, 0.55, 0.55), stiff=3)
    m.ellipsoid((0, 0.3, 3.1), (0.75, 0.45, 0.35), rot=(-20, 0, 0), stiff=3)
    m.capsule((0, -0.1, 3.15), (0, -0.5, 3.45), 0.26)
    m.ellipsoid((0, -0.6, 3.55), (0.3, 0.3, 0.3))
    for s in (1, -1):
        sh, el, wr, hd = L(SH, s), L(EL, s), L(WR, s), L(HD, s)
        m.ball(sh, 0.34, stiff=3)
        m.limb([(sh, 0.28), (el, 0.24), (wr, 0.24), (hd, 0.22)])
        hp, kn, an, to = L(HIP, s), L(KN, s), L(AN, s), L(TO, s)
        m.limb([(hp, 0.3), (kn, 0.25), (an, 0.22)])
        m.ellipsoid((an[0], an[1] - 0.2, 0.15), (0.22, 0.35, 0.12), stiff=5)
    return m


# ----------------------------------------------------------------------------- plates
# (bone, centre, size, rot, round, taper) — left side only for mirrored entries (mirror=True)
def plate_specs():
    P = []

    def add(bone, c, size, rot=(0, 0, 0), rnd=0.25, taper=0.0, mirror=True, cuts=3):
        if mirror:
            for s, n in ((1, "L"), (-1, "R")):
                b = bone.replace("$", n)
                P.append((b, (c[0] * s, c[1], c[2]), size, (rot[0], rot[1] * s, rot[2] * s), rnd, taper, cuts))
        else:
            P.append((bone, c, size, rot, rnd, taper, cuts))

    # torso
    add("chest", (0.46, -0.42, 2.9), (0.78, 0.42, 0.8), (6, 6, -10), 0.3)                 # pecs (core gap between)
    add("chest", (0.0, -0.42, 3.36), (0.7, 0.34, 0.26), (-8, 0, 0), 0.35, mirror=False)    # collar stone above the core
    add("spine", (0.0, -0.38, 2.28), (1.02, 0.38, 0.36), (4, 0, 0), 0.35, mirror=False)    # abdomen bands
    add("spine", (0.0, -0.3, 1.94), (0.9, 0.38, 0.3), (0, 0, 0), 0.35, mirror=False)
    add("chest", (0.0, 0.5, 3.08), (1.7, 0.6, 1.0), (-18, 0, 0), 0.3, 0.12, mirror=False, cuts=4)   # back slab
    add("spine", (0.0, 0.45, 2.2), (1.2, 0.46, 0.7), (-6, 0, 0), 0.3, mirror=False)
    add("chest", (1.06, 0.1, 3.3), (0.86, 0.92, 0.62), (0, 14, 0), 0.4)                 # pauldron boulders
    add("hips", (0.0, 0.05, 1.62), (1.15, 0.9, 0.46), (0, 0, 0), 0.35, mirror=False)      # pelvis
    add("hips", (0.6, 0.0, 1.52), (0.42, 0.72, 0.5), (0, 16, 0), 0.35)
    # head (brow + skull) and jaw
    add("head", (0.0, -0.62, 3.66), (0.72, 0.62, 0.52), (-6, 0, 0), 0.35, mirror=False)
    add("head", (0.0, -0.92, 3.8), (0.82, 0.22, 0.16), (14, 0, 0), 0.3, mirror=False)
    add("jaw", (0.0, -0.78, 3.28), (0.6, 0.5, 0.2), (8, 0, 0), 0.35, mirror=False)
    # arms
    add("upper_arm.$", (1.24, 0.14, 2.66), (0.5, 0.56, 0.78), (0, 20, 0), 0.35)
    add("forearm.$", (1.43, 0.06, 1.84), (0.68, 0.68, 0.84), (4, 6, 0), 0.3, 0.1)
    add("hand.$", (1.48, -0.12, 1.02), (0.74, 0.78, 0.72), (0, 4, 0), 0.5)
    # legs
    add("thigh.$", (0.6, -0.06, 1.12), (0.58, 0.6, 0.62), (-8, 6, 0), 0.35)
    add("shin.$", (0.63, -0.1, 0.52), (0.6, 0.62, 0.54), (6, 0, 0), 0.35)
    add("foot.$", (0.63, -0.22, 0.16), (0.64, 0.92, 0.3), (0, 0, 0), 0.35)
    return P


def build_plates(stone):
    lows, highs = [], []
    for i, (bone, c, size, rot, rnd, taper, cuts) in enumerate(plate_specs()):
        hi = gk.rounded_box(size, rnd * 0.45, cuts=cuts, name=f"_PlateHi{i}", loc=c, rot=rot, taper=taper)
        gk.set_mat(hi, stone)
        gn.planar_cuts(hi, cuts=8, depth=(0.05, 0.15), seed=100 + i, subdiv=3)
        gk.sculpt(hi, [{"type": "noise", "scale": 3.0, "amp": 0.012, "detail": 3, "seed": i},
                       {"type": "cracks", "scale": 2.5, "amp": 0.022, "width": 0.05, "seed": i, "store": "crack"},
                       {"type": "noise", "scale": 14.0, "amp": 0.006, "detail": 4, "seed": i + 7}], name=f"PlateSc{i}")
        gn.apply(hi)
        lo = gk.dup(hi, f"Plate{i}")
        n = sum(len(p.vertices) - 2 for p in lo.data.polygons)
        vol = size[0] * size[1] * size[2]
        target = int(260 + 700 * min(1.0, vol / 1.2))
        gn.decimate(lo, target / n)
        gn.apply(lo)
        for o in (hi, lo):
            gk.assign_bone(o, bone)
        lows.append(lo)
        highs.append(hi)
    low = gk.join(lows, "Plates")
    high = gk.join(highs, "_PlatesHigh")
    return low, high


def extras(mats):
    """Eyes, heart-core, back crystals, hanging roots (rigid per bone via vertex groups)."""
    out = []
    for s in (1, -1):
        e = gk.rounded_box((0.16, 0.08, 0.07), 0.6, cuts=2, name="Eye", loc=(0.17 * s, -0.9, 3.62), rot=(0, 0, -12 * s))
        gk.set_mat(e, mats["eye"])
        gk.assign_bone(e, "head")
        out.append(e)
    core = gk.rounded_box((0.44, 0.3, 0.52), 0.7, cuts=3, name="Heart", loc=(0, -0.48, 2.86))
    gk.sculpt(core, [{"type": "cells", "scale": 9.0, "amp": 0.03}], subdiv=1)
    gn.apply(core)
    gk.set_mat(core, mats["heart"])
    gk.assign_bone(core, "chest")
    out.append(core)
    for i, (x, y, z, rx, ry, h, r) in enumerate(((0.35, 0.75, 3.5, -38, 14, 0.75, 0.14), (-0.28, 0.8, 3.52, -42, -12, 0.9, 0.15),
                                                 (0.02, 0.9, 3.28, -58, 0, 0.62, 0.12), (0.62, 0.62, 3.3, -30, 38, 0.5, 0.1),
                                                 (-0.62, 0.66, 3.2, -30, -40, 0.45, 0.09), (0.15, 0.95, 3.0, -70, 10, 0.4, 0.08))):
        base = Vector((x, y, z))
        d = Vector((0, 0, 1))
        d.rotate(__import__("mathutils").Euler((math.radians(rx), math.radians(ry), 0)))
        cr = gk.spike(base - d * 0.15, base + d * h, r, seg=5, rings=2, name="Crystal")
        gk.set_mat(cr, mats["crystal"])
        gk.assign_bone(cr, "chest")
        out.append(cr)
    # roots hanging down the back from the hump
    import random
    rnd = random.Random(7)
    for i in range(7):
        x0 = -0.75 + i * 0.25 + rnd.uniform(-0.06, 0.06)
        pts, rad = [], []
        y0 = 0.72 + 0.1 * (1 - abs(x0))
        for k in range(8):
            t = k / 7
            pts.append((x0 + 0.08 * math.sin(t * 5 + i), y0 + 0.12 * t + 0.03 * math.sin(t * 9 + i), 3.45 - t * (0.9 + 0.5 * rnd.random())))
            rad.append(0.055 * (1 - 0.6 * t) + 0.012)
        rt = gk.tube(pts, rad, seg=6, name="Root")
        gk.set_mat(rt, mats["root"])
        gk.assign_bone(rt, "chest")
        out.append(rt)
    return gk.join(out, "GolemParts")


def moss_clumps(plates, moss_mat):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=0.14)
    clump = bpy.context.object
    clump.name = "_MossClump"
    clump.scale = (1.0, 0.8, 0.25)
    import common as C
    C.apply_transforms(clump)
    gk.set_mat(clump, moss_mat)
    gk.sculpt(clump, [{"type": "noise", "scale": 18.0, "amp": 0.03, "detail": 3}], subdiv=1)
    gn.apply(clump)
    gn.decimate(clump, 0.5)
    gn.apply(clump)
    mo = gk.dup(plates, "Moss")
    for g in list(mo.vertex_groups):
        mo.vertex_groups.remove(g)
    gn.scatter(mo, clump, density=3.5, up_min=0.75, scale=(0.6, 1.3), rot_random=(0.1, 0.1, 3.14), embed=0.03,
               seed=5, keep_target=False, distance_min=0.2)
    gn.apply(mo)
    gn.remove(clump)
    gk.set_mat(mo, moss_mat)
    return mo


# ----------------------------------------------------------------------------- animation
def clips(R):
    stance = {"hips": {"rot": (4, 0, 0), "loc": (0, 0, -0.06)}, "spine": (4, 0, 0), "chest": (4, 0, 0), "neck": (-4, 0, 0),
              "head": (-6, 0, 0), "upper_arm.L": (-6, -4, 0), "upper_arm.R": (-6, 4, 0), "forearm.L": (-14, 0, 0),
              "forearm.R": (-14, 0, 0)}
    B = A.Biped(R, dict(stance=stance, stride=0.95, lift=0.22, walk_frames=32, bob=0.07, sway=0.09, arm_swing=12,
                        lean=4, run_stride=1.35, run_lift=0.3, run_frames=22, run_lean=12, run_bob=0.1, heavy=1.0,
                        jaw=True))
    B.idle(frames=72)
    B.walk()
    B.run()
    # Attack: right haymaker (1.1 s)
    wind = {"hips": {"rot": (-2, 0, -14), "loc": (0, 0.08, -0.04)}, "spine": (-4, 0, -12), "chest": (-6, -4, -24),
            "head": (-6, 0, 18), "upper_arm.R": (-60, 70, 0), "forearm.R": (-70, 0, 0), "upper_arm.L": (-30, -14, 0),
            "forearm.L": (-30, 0, 0), "ik_foot.R": {"loc": (0, -0.1, 0.16)}}
    punch = {"hips": {"rot": (8, 0, 16), "loc": (0, -0.18, -0.12)}, "spine": (12, 0, 14), "chest": (8, 4, 30),
             "head": (-6, 0, -14), "upper_arm.R": (-85, -10, 0), "forearm.R": (-10, 0, 0), "upper_arm.L": (12, -18, 0),
             "forearm.L": (-30, 0, 0), "jaw": (10, 0, 0), "ik_foot.R": {"loc": (0, -0.38, 0)}}
    B.key("Attack", [(0, {}), (5, A.scale(wind, 0.5)), (11, wind), (15, punch),
                     (18, A.add(punch, {"chest": (3, 0, 5), "upper_arm.R": (8, 0, 0)})), (27, {})])
    # Attack2: double-fist slam (0.75 s wind-up)
    rear = {"hips": {"rot": (-8, 0, 0), "loc": (0, 0.12, 0.05)}, "spine": (-10, 0, 0), "chest": (-14, 0, 0), "neck": (-6, 0, 0),
            "head": (-16, 0, 0), "upper_arm.R": (-165, 22, 0), "upper_arm.L": (-165, -22, 0), "forearm.R": (-45, 0, 0),
            "forearm.L": (-45, 0, 0), "jaw": (22, 0, 0)}
    slam = {"hips": {"rot": (14, 0, 0), "loc": (0, -0.18, -0.28)}, "spine": (20, 0, 0), "chest": (14, 0, 0), "neck": (-10, 0, 0),
            "head": (-10, 0, 0), "upper_arm.R": (-78, 6, 0), "upper_arm.L": (-78, -6, 0), "forearm.R": (-8, 0, 0),
            "forearm.L": (-8, 0, 0), "jaw": (12, 0, 0), "ik_foot.R": {"loc": (0, -0.3, 0)}, "ik_foot.L": {"loc": (0, 0.12, 0)}}
    B.key("Attack2", [(0, {}), (6, A.scale(slam, 0.2)), (14, A.scale(rear, 0.85)), (18, rear), (22, slam),
                      (25, A.add(slam, {"hips": {"loc": (0, 0, -0.04)}, "spine": (3, 0, 0)})), (31, A.scale(slam, 0.55)),
                      (38, {})])
    B.hit()
    B.death(frames=56, fall_x=80.0, lift=0.75, knee_drop=0.55)
    # Special: roar (arms wide, chest open) then a right-foot ground stomp (2.2 s)
    roar = {"hips": {"rot": (-8, 0, 0), "loc": (0, 0.1, 0.02)}, "spine": (-10, 0, 0), "chest": (-18, 0, 0), "neck": (-10, 0, 0),
            "head": (-22, 0, 0), "upper_arm.L": (-40, -70, 0), "upper_arm.R": (-40, 70, 0), "forearm.L": (-50, 0, 0),
            "forearm.R": (-50, 0, 0), "jaw": (35, 0, 0)}
    lift = {"hips": {"rot": (6, 6, 0), "loc": (-0.12, 0.02, 0.02)}, "spine": (8, 4, 0), "chest": (6, 0, 0), "head": (-4, 0, 0),
            "upper_arm.L": (-25, -35, 0), "upper_arm.R": (-25, 35, 0), "forearm.L": (-40, 0, 0), "forearm.R": (-40, 0, 0),
            "jaw": (15, 0, 0), "ik_foot.R": {"rot": (-10, 0, 0), "loc": (0, -0.25, 0.75)}}
    stomp = {"hips": {"rot": (10, -2, 0), "loc": (0, -0.08, -0.22)}, "spine": (12, 0, 0), "chest": (10, 0, 0), "head": (-8, 0, 0),
             "upper_arm.L": (-10, -30, 0), "upper_arm.R": (-10, 30, 0), "forearm.L": (-25, 0, 0), "forearm.R": (-25, 0, 0),
             "jaw": (25, 0, 0), "ik_foot.R": {"loc": (0, -0.35, 0)}}
    B.key("Special", [(0, {}), (6, A.scale(roar, 0.3)), (14, roar), (24, A.add(roar, {"chest": (-3, 0, 0), "jaw": (4, 0, 0)})),
                      (32, lift), (38, A.add(lift, {"ik_foot.R": {"loc": (0, 0, 0.08)}})), (42, stomp),
                      (45, A.add(stomp, {"hips": {"loc": (0, 0, -0.04)}})), (53, A.scale(stomp, 0.4)), (60, {})])


# ----------------------------------------------------------------------------- build
def build(args, stage):
    mats = {
        "core": gmat.stone_core("GolemCore", color="#1f2226", glow="#3fd0ff", strength=6.0, seed=2),
        "stone": gmat.carved_stone("GolemStone", color="#7f786c", color2="#57524a", rune="#46d7ff", strength=5.0, seed=4,
                                   moss=0.5),
        "moss": M.moss("GolemMoss", seed=3),
        "root": M.bark("GolemRoot", kind="dead", moss=0.2, seed=8),
        "crystal": M.crystal("GolemCrystal", color="#5fd8ff", glow=0.8, emit_strength=4.0),
        "eye": M.emissive("GolemEye", color="#8ff0ff", strength=8.0),
        "heart": M.crystal("GolemHeart", color="#ffa23a", glow=1.0, emit_strength=7.0),
    }
    base = core_meta(0.03).to_mesh("GolemCoreBase")
    plates, plates_hi = build_plates(mats["stone"])
    parts = extras(mats)
    if stage == "shape":
        gk.clay_sheet([base, plates, parts], gk.wip_path(f"{KEY}_clay.png"))
        return {}
    gk.set_mat(base, mats["core"])
    core_hi = gk.sculpt_copy(base, [{"type": "cells", "scale": 3.0, "amp": 0.03},
                                    {"type": "noise", "scale": 10.0, "amp": 0.008}], subdiv=1, name="_CoreHigh")
    core = gk.retopo(base, faces=2400, name="GolemBody")
    gk.set_mat(core, mats["core"])
    bpy.data.objects.remove(base, do_unlink=True)
    moss = moss_clumps(plates, mats["moss"])
    print(f"[golem] tris core={gk.tris(core)} plates={gk.tris(plates)} parts={gk.tris(parts)} moss={gk.tris(moss)} "
          f"high={gk.tris(plates_hi) + gk.tris(core_hi)}", flush=True)

    R = gk.Rigger(joints(), PARENTS, legs=LEGS, pole_dist=1.4)
    arm = R.arm
    rig.bind(core, arm, smooth=4)
    gk.bind_groups(plates, arm)
    gk.bind_groups(parts, arm)
    rig.transfer_weights(plates, moss, arm, smooth=0)
    clips(R)
    R.bake()
    meshes = [core, plates, parts, moss]
    gk.ground_clamp(arm, meshes)
    if stage == "anim":
        gk.pose_sheet(KEY + "_anim", meshes, arm, gk.wip_path(""))
        return {}
    for o in (parts, moss, core):
        o["kit_bake_direct"] = 1
    high = gk.join([plates_hi, core_hi], "_GolemHigh")
    bake.bake_asset(meshes, KEY, size=2048, high=high, extrusion=0.06, max_ray=0.16, ao_samples=48, samples=8)
    bpy.data.objects.remove(high, do_unlink=True)
    return gk.finish(KEY, args, arm, meshes, "boss", expected=(3.9, 2.6, 4.1), hero=("Special", 16))
