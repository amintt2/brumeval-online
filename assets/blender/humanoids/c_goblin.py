"""goblin_shaman: hunched ~1.2 m goblin caster. Bone mask with horns, feather crest, fur mantle, loincloth with
tattered flaps, tooth necklace and belt fetishes, gnarled staff crowned with a skull whose eyes glow green."""
import math

import mathutils

import hanim as HA
import hbody as HB
import hchar as HC
import hgarment as HG
import hmats as HM
import hprops as PR
import hrig
from hutil import J0, conform, frame_matrix, lerp, shell, thicken, tidy, transform
from kit import gn, qa, rig

V = mathutils.Vector


def _head_frame(J, s, hs):
    hd = J0(J, "head")
    up = (J0(J, "head", 1) - hd).normalized()
    fw, X = V((0, -1, 0)), V((1, 0, 0))
    sh = s * hs

    def Q(x, f, u):
        return hd + X * x * sh + fw * f * sh + up * u * sh
    return Q, hd, up, sh


def bone_mask(high, J, s, hs, m_bone, m_eye):
    """Beast-skull mask worn over the face: brow plate, cheek plates, long snout with a row of teeth, carved eye
    holes and nostrils, ridged horns curling up and back. Fused into ONE closed mesh (voxel remesh)."""
    Q, hd, up, sh = _head_frame(J, s, hs)
    E, Cp = HB.ellipsoid, HB.capsule
    parts = [E(Q(0, 0.078, 0.128), (0.074 * sh, 0.036 * sh, 0.058 * sh), seg=28, rings=16),     # brow plate
             E(Q(0, 0.1, 0.088), (0.052 * sh, 0.032 * sh, 0.05 * sh), seg=24, rings=14),         # face plate
             Cp(Q(0, 0.1, 0.09), Q(0, 0.172, 0.058), 0.034 * sh, 0.024 * sh, seg=20, flat=0.85),  # snout
             E(Q(0, 0.168, 0.056), (0.027 * sh, 0.022 * sh, 0.021 * sh), seg=16, rings=10)]       # snout tip
    for sg in (1, -1):
        parts.append(E(Q(sg * 0.047, 0.085, 0.082), (0.026 * sh, 0.028 * sh, 0.036 * sh), rot=(0, 0, sg * 20), seg=16, rings=10))
        parts.append(Cp(Q(sg * 0.03, 0.098, 0.128), Q(sg * 0.062, 0.078, 0.118), 0.013 * sh, 0.011 * sh, seg=12))  # brow ridge
        parts.append(Cp(Q(sg * 0.035, 0.11, 0.06), Q(sg * 0.02, 0.16, 0.043), 0.009 * sh, 0.007 * sh, seg=10))    # jaw line
        for k in range(4):   # teeth along the snout underside
            t = k / 3
            b0 = Q(sg * (0.028 - 0.012 * t), 0.115 + 0.045 * t, 0.042 - 0.006 * t)
            parts.append(Cp(b0, b0 - up * (0.022 - 0.006 * t) * sh + V((0, -0.002, 0)), 0.0048 * sh, 0.0012 * sh, seg=8))
        # horns: from the brow, up, out and curling back
        pts = []
        b0 = Q(sg * 0.045, 0.075, 0.15)
        for k in range(10):
            t = k / 9
            p = b0 + V((sg * (0.06 * t + 0.02 * t * t), 0, 0)) * sh + up * (0.11 * math.sin(t * 2.0)) * sh                 + V((0, 1, 0)) * (0.1 * t * t) * sh
            pts.append((p, (0.02 * (1 - 0.88 * t) + 0.002) * sh))
        for (a_, ra), (b_, rb) in zip(pts[:-1], pts[1:]):
            parts.append(Cp(a_, b_, ra, rb, seg=12))
        for k in range(1, 8):
            p, r = pts[k]
            parts.append(E(p, (r * 1.16, r * 1.16, r * 1.16), seg=10, rings=6))
    ob = HB.fuse(parts, 0.0015 * s / 0.667, "BoneMask")
    HB.keep_largest(ob)
    eyes = [Q(sg * 0.032, 0.09, 0.097) for sg in (1, -1)]
    cut = [E(e + V((0, -0.04, 0)) * sh, (0.017 * sh, 0.06 * sh, 0.014 * sh), rot=(0, 0, -sg * 10), seg=16, rings=10)
           for sg, e in zip((1, -1), eyes)]
    cut += [E(Q(sg * 0.009, 0.19, 0.06), (0.0055 * sh, 0.02 * sh, 0.007 * sh), seg=10, rings=6) for sg in (1, -1)]
    HB.carve(ob, cut, voxel=0.0015 * s / 0.667)
    HB.keep_largest(ob)
    HB.taubin(ob, 2)
    HB.decimate_to(ob, 1400)
    PR._mat(ob, m_bone)
    # eyes glowing in the sockets of the face, seen through the holes
    t = HB.bvh(high)
    glows = []
    for e in eyes:
        q, n, _, _ = t.find_nearest(e)
        c = q - n * 0.001 * s
        glows.append(HB.ellipsoid(c, (0.011 * sh, 0.007 * sh, 0.009 * sh), seg=12, rings=8))
    g = HB.join(glows, "EyeGlow")
    PR.smooth_all(g)
    PR._mat(g, m_eye)
    return ob, g


def skull_staff(J, s, mats):
    """Staff built upright around the grip (origin), top along +Z, skull facing -Y; placed in the right fist."""
    m_wood, m_bone, m_glow, m_feather, m_cord = mats
    L0, L1 = 0.45, 0.92
    shaft = PR.staff((0, 0, -L0), (0, 0.0, L1), 0.017, m_wood, seed=5, wobble=0.012, knots=5, name="StaffShaft", tris=650)
    parts = [shaft]
    top = V((0, 0, L1))
    # forked crown: three gnarled prongs cradling the skull
    for k in range(3):
        a = 2 * math.pi * k / 3 + 0.4
        d = V((math.cos(a), math.sin(a), 0))
        pts = [top - V((0, 0, 0.06)), top + d * 0.035 + V((0, 0, 0.03)), top + d * 0.05 + V((0, 0, 0.1)),
               top + d * 0.03 + V((0, 0, 0.16))]
        parts.append(PR.sweep([(*p, 1.0 - 0.6 * i / 3) for i, p in enumerate(pts)], 0.009, f"Prong{k}", m_wood,
                              res=7))
    skull, eyes = PR.mini_skull(top + V((0, -0.005, 0.1)), 0.52, m_bone, jaw_open=14, tris=800, name="StaffSkull")
    glows = PR.eye_glows(eyes, 0.012, m_glow, "StaffGlow")
    # soul stone hanging under the skull + feathers + cord wraps
    stone = HB.ellipsoid(top + V((0, -0.03, -0.1)), (0.018, 0.018, 0.03), seg=10, rings=8)
    PR._mat(stone, m_glow)
    cord = PR.sweep([(0, -0.02, L1 - 0.02), (0, -0.03, L1 - 0.07)], 0.0025, "StoneCord", m_cord, res=4)
    wraps = []
    for k in range(3):
        z = L1 - 0.05 - 0.03 * k
        pts = [(0.022 * math.cos(2 * math.pi * j / 12), 0.022 * math.sin(2 * math.pi * j / 12), z - 0.004 * j / 12)
               for j in range(13)]
        wraps.append(PR.sweep(pts, 0.004, f"Wrap{k}", m_cord, res=5))
    feathers = []
    for k, (a, ln) in enumerate(((2.2, 0.16), (3.0, 0.19), (3.8, 0.15))):
        base = V((0.024 * math.cos(a), 0.024 * math.sin(a), L1 - 0.08))
        d = V((math.cos(a) * 0.35, math.sin(a) * 0.35, -1)).normalized()
        feathers.append(PR.feather(base, d, ln, 0.035, m_feather, curl=0.1, name=f"StaffFeather{k}", seed=k + 3))
    charms = [PR.bone_charm(V((0.026 * math.cos(a), 0.026 * math.sin(a), L1 - 0.09)), 0.05, m_bone, m_cord, seed=k,
                            kind=kd, name=f"StaffCharm{k}") for k, (a, kd) in enumerate(((0.9, "bone"), (5.2, "tooth")))]
    rigid = HB.join(parts + [skull, stone, cord] + wraps + feathers + charms, "Staff")
    return rigid, glows, L0, L1


def build():
    H = 1.2
    s = H / 1.8
    hs = 1.2
    P = dict(H=H, head=hs, ears="goblin", nose=1.75, nose_hook=True, chin=0.012, jaw=1.12, brow=1.5, mouth=1.35,
             tusks=False, warts=7, eye=1.1, muscle=0.35, bulk=0.92, limb=0.86, belly=0.012, hunch=16, gaunt=0.25,
             hands=("claw", "fist"), claw=0.15, finger_len=1.35, fingers=4, toes=3, feet="bare", arm_drop=56,
             neck=1.2, seed=4, upper=0.3 * s, fore=0.29 * s, hand=0.19 * s, knee=0.46 * s, hip=0.86 * s)
    B = HC.make_body(P, "human", tris=5200)
    arm, J, base, high, body = B["arm"], B["J"], B["base"], B["high"], B["low"]
    R = HG.Regions(J)
    hips, ch, nk = J0(J, "hips"), J0(J, "chest"), J0(J, "neck")
    Q, hd, up, sh = _head_frame(J, s, hs)
    # ---------------------------------------------------------------- materials
    m_skin = HM.skin("Skin", "orc", "#6d7b48", seed=11, veins=0.35)
    m_fur = HM.fur("Fur_Mantle", color="#4d4034", tip="#8f806b", root="#1d1712", seed=3, direction="Z")
    HM.tatter(m_fur, ch.z - 0.13 * s, ch.z - 0.02 * s, 2.2, holes=0.0, seed=4, strands=1.6)
    m_loin = HM.leather("Leather_Loin", color="#4a3322", seed=5, wear=0.7, dirt=0.8)
    m_flap = HM.cloth("Cloth_Loin", color="#5b3a26", kind="burlap", seed=6, dirt=0.8, hem_dirt=0.9)
    HM.tatter(m_flap, J0(J, "thigh.L", 1).z + 0.06 * s, J0(J, "thigh.L", 1).z + 0.2 * s, 2.0, holes=0.35, seed=6)
    m_bone = HM.bone_cracked("Bone", color="#c9b894", seed=7)
    m_mask = HM.bone_cracked("Bone_Mask", color="#d6c7a3", seed=8, dirt=0.9)
    m_eye = HM.glow("Glow_Eyes", "#ffcf3a", 9.0)
    m_glow = HM.glow("Glow_Staff", "#8dff5a", 14.0)
    m_wood = HM.wood("Wood_Staff", color="#4e3a26", color2="#2a1d12", seed=9, dirt=0.6, wear=0.5, moss=0.15)
    m_feather = HM.feather("Feather", color="#26221f", tip="#a89f8a", band="#7a2a18", seed=2)
    m_cord = HM.leather("Cord", color="#3a2a1c", seed=12, wear=0.3)
    body.data.materials.append(m_skin)
    # ---------------------------------------------------------------- garments
    mantle = shell(base, R, lambda c, co: (c[0] == "torso" and co.z > ch.z - 0.13 * s and co.z < nk.z + 0.01 * s) or
                   (c[0].startswith("arm") and c[1] < 0.2), 0.03 * s, "Mantle", m_fur)
    loin = shell(base, R, lambda c, co: (c[0] == "torso" and co.z < hips.z + 0.035 * s) or
                 (c[0].startswith("leg") and c[1] < 0.2), 0.012 * s, "Loin", m_loin)
    conform(mantle, [high], 0.022 * s)
    conform(loin, [high], 0.008 * s)
    HB.decimate_to(mantle, 1500)
    HB.decimate_to(loin, 1000)
    # belt loop, flaps hanging from it (front + back)
    bz = hips.z + 0.01 * s
    loop = HG.body_loop(loin, bz, hips.y, 0.15 * s, 0.12 * s, n=40, clearance=0.004 * s)
    kn = J0(J, "thigh.L", 1)
    flaps = []
    for k, (i0, i1, bl) in enumerate(((36, 4, (0, -1, 0)), (16, 24, (0, 1, 0)))):
        a, b = V(loop[i0]), V(loop[i1])
        rows = HG.flap(a, b, (bz - kn.z) * 0.72, n_w=6, n_h=8, bulge=bl, bulge_amp=0.012 * s, flare=1.1, seed=k)
        f = HG.strip(rows, f"Flap{k}", m_flap)
        HB.outward_normals(f, lambda p: V((0, hips.y, p.z)))
        conform(f, [high, loin], 0.01 * s, iters=3)
        flaps.append(f)
    # ---------------------------------------------------------------- skinning
    src = HB.copy(body, "_BodySrc")
    rig.bind(body, arm, smooth=4)
    rig.bind(src, arm, smooth=4)
    HC.weights_from(src, mantle, arm, smooth=8)
    HC.weights_from(src, loin, arm, smooth=4)
    for f in flaps:
        HG.seg_weights(f, arm, ["hips", "thigh.L", "thigh.R"], power=2.0, smooth=6, bias={"hips": 2.2})
    # ---------------------------------------------------------------- head gear (rigid to the head)
    mask, eyeglow = bone_mask(high, J, s, hs, m_mask, m_eye)
    tb = HB.bvh(high)
    feathers = []
    for k in range(7):
        u = k / 6 - 0.5
        base_p = Q(u * 0.09, 0.02 - abs(u) * 0.04, 0.2 - abs(u) * 0.03)
        q, n, _, _ = tb.find_nearest(base_p)
        d = (up * 1.0 + V((u * 1.3, 0.35 + abs(u) * 0.3, 0))).normalized()
        feathers.append(PR.feather(q - n * 0.004 * s, d, (0.2 - abs(u) * 0.09) * s / 0.667, 0.04 * s / 0.667, m_feather,
                                   curl=-0.12, name=f"Crest{k}", seed=k))
    sz = Q(0, 0.0, 0.172).z
    strap_loop = HG.body_loop(high, sz, hd.y, 0.09 * s, 0.1 * s, n=32, clearance=0.003 * s)
    strap = HG.band(strap_loop, 0.016 * s / 0.667, 0.004 * s / 0.667, "Strap", m_cord, up=tuple(up), closed=True)
    headgear = HB.join([mask, eyeglow, strap] + feathers, "HeadGear")
    HC.parent_rigid(headgear, arm, "head")
    # ---------------------------------------------------------------- necklace + belt fetishes (skinned gear)
    nz = lerp(ch, nk, 0.55).z
    neck_loop = HG.body_loop(mantle, nz, lerp(ch, nk, 0.55).y, 0.1 * s, 0.09 * s, n=32, clearance=0.004 * s)
    necklace = PR.sweep([(*p, 1.0) for p in neck_loop + [neck_loop[0]]], 0.0035 * s / 0.667, "Necklace", m_cord, res=5)
    teeth = []
    for k in (28, 30, 31, 0, 1, 2, 4):
        p = V(neck_loop[k % 32])
        teeth.append(PR.bone_charm(p, 0.032, m_bone, m_cord, seed=k, kind="tooth" if k % 2 else "bone", name=f"Tooth{k}"))
    belt = HG.band(loop, 0.035 * s / 0.667 * 0.7, 0.01 * s, "Belt", m_cord, closed=True)
    fetish = []
    for k, kd in ((8, "skull"), (12, "bone"), (30, "bone"), (33, "tooth")):
        p = V(loop[k])
        out = (p - V((0, hips.y, p.z))).normalized()
        fetish.append(PR.bone_charm(p + out * 0.006, 0.055, m_bone, m_cord, seed=k, kind=kd, name=f"Fetish{k}"))
    pouch = PR.pouch(V(loop[20]) + (V(loop[20]) - V((0, hips.y, bz))).normalized() * 0.025 - V((0, 0, 0.03)), 0.075,
                     m_loin, name="Pouch")
    for g in [necklace] + teeth:
        HG.seg_weights(g, arm, ["chest", "neck", "spine"], power=3, smooth=4, bias={"chest": 2.0})
    for g in [belt, pouch] + fetish:
        HG.seg_weights(g, arm, ["hips", "spine", "thigh.L", "thigh.R"], power=3, smooth=4, bias={"hips": 3.0})
    # ---------------------------------------------------------------- staff (right fist)
    grip, axis, _, _ = PR.grip_frame(J, "R")
    staff, sglow, L0, L1 = skull_staff(J, s, (m_wood, m_bone, m_glow, m_feather, m_cord))
    M = frame_matrix(grip, axis, (0, 0, -1))
    skull_c = M @ V((0, 0, L1 + 0.1))
    for o in (staff, sglow):
        transform(o, M)
    staff = HB.join([staff, sglow], "Staff")
    HC.parent_rigid(staff, arm, "hand.R")
    gear = HC.join_gear([necklace, belt, pouch] + teeth + fetish, "Gear")
    for o in (gear, headgear, staff):
        tidy(o)
    # ---------------------------------------------------------------- thickness
    thicken(mantle, 0.008 * s, depth=0.02 * s)
    thicken(loin, 0.005 * s)
    for f in flaps:
        thicken(f, 0.004 * s, full=True)
    cloths = [mantle, loin]
    # ---------------------------------------------------------------- clips
    # staff tilt from vertical ~= sum of rx over upper_arm.R + forearm.R + hand.R + 90 (positive = head forward)
    carry = {"upper_arm.R": (-8, 8, 6), "forearm.R": (-52, 0, -8), "hand.R": (-16, 0, 0)}
    crouch = {"thigh.L": (-16, 0, 0), "thigh.R": (-16, 0, 0), "shin.L": (28, 0, 0), "shin.R": (28, 0, 0),
              "foot.L": (-12, 0, 0), "foot.R": (-12, 0, 0), "hips": {"rot": (6, 0, 0), "loc": (0, 0, 0)},
              "neck": (-10, 0, 0), "head": (-12, 0, 0), "upper_arm.L": (-10, 0, 0), "forearm.L": (-20, 0, 0)}
    st = dict(snap=body, arms=24, elbow=-14, stride=30, swing=10, base=hrig.add(crouch, carry))
    HA.idle(arm, st, dur=48, breathe=3.0, sway=2.5,
            extra=({"hand.L": (0, 0, 8), "forearm.L": (-6, 0, 0)}, {"hand.L": (0, 0, -8), "forearm.L": (-2, 0, 0)}))
    HA.walk(arm, st, dur=24, knee=44, bob=0.03, lean=6,
            extra=({"forearm.R": (8, 0, 0), "upper_arm.R": (-6, 0, 0)}, {}))
    HA.run(arm, st, dur=14, lean=18, extra=({"forearm.R": (20, 0, 0)}, {"forearm.R": (10, 0, 0)}))
    # Attack (0.7 s): staff swung back over the shoulder, then clubbed down in front
    wind = {"upper_arm.R": (-95, 18, 0), "forearm.R": (5, 0, 0), "hand.R": (-20, 0, 0), "spine": (-8, 0, -18),
            "chest": (-8, 0, -12), "head": (6, 0, 10), "upper_arm.L": (-20, 20, 0), "thigh.R": (6, 0, 0),
            "hips": {"rot": (0, 0, -6), "loc": (0, 0.02, 0)}}
    hitp = {"upper_arm.R": (-50, 0, 0), "forearm.R": (56, 0, 0), "hand.R": (64, 0, 0), "spine": (20, 0, 16),
            "chest": (10, 0, 10), "head": (-12, 0, -8), "upper_arm.L": (10, -10, 0), "thigh.L": (-26, 0, 0),
            "shin.L": (22, 0, 0), "hips": {"rot": (0, 0, 8), "loc": (0, -0.05, -0.02)}}
    HA.clip(arm, st, "Attack", [(0, {}), (6, wind), (10, hitp), (12, hrig.add(hitp, {"hand.R": (8, 0, 0), "spine": (3, 0, 0)})),
                                (17, {})])
    # Attack2 (1.4 s): long telegraphed overhead slam (staff raised high for 0.75 s, then smashed to the ground)
    up2 = {"upper_arm.R": (-130, 12, 0), "forearm.R": (30, 0, 0), "hand.R": (-10, 0, 0), "upper_arm.L": (-140, -12, 0),
           "forearm.L": (-30, 0, 0), "spine": (-14, 0, 0), "chest": (-10, 0, 0), "head": (10, 0, 0), "neck": (4, 0, 0),
           "thigh.L": (-8, 0, 0), "shin.L": (-8, 0, 0), "hips": {"rot": (-4, 0, 0), "loc": (0, 0.03, 0.03)}}
    slam = {"upper_arm.R": (-40, 0, 0), "forearm.R": (60, 0, 0), "hand.R": (70, 0, 0), "upper_arm.L": (-40, -20, 0),
            "forearm.L": (-30, 0, 0), "spine": (30, 0, 0), "chest": (14, 0, 0), "head": (-18, 0, 0),
            "thigh.L": (-42, 0, 0), "shin.L": (44, 0, 0), "thigh.R": (18, 0, 0), "shin.R": (24, 0, 0),
            "hips": {"rot": (8, 0, 0), "loc": (0, -0.08, -0.06)}}
    HA.clip(arm, st, "Attack2", [(0, {}), (8, hrig.lerp({}, up2, 0.65)), (18, up2),
                                 (21, hrig.add(up2, {"spine": (-4, 0, 0), "upper_arm.R": (-6, 0, 0)})),
                                 (24, slam), (27, hrig.add(slam, {"spine": (4, 0, 0), "hand.R": (6, 0, 0)})), (35, {})])
    # Shoot (0.8 s): cast - staff lifted high, then thrust forward with the clawed left hand
    gather = {"upper_arm.R": (-80, 20, 0), "forearm.R": (40, 0, 0), "hand.R": (40, 0, 0), "upper_arm.L": (-20, 30, -30),
              "forearm.L": (-80, 0, 0), "spine": (-6, 0, -16), "chest": (-6, 0, -10), "head": (4, 0, 10)}
    thrust = {"upper_arm.R": (-90, 0, 0), "forearm.R": (60, 0, 0), "hand.R": (65, 0, 0), "upper_arm.L": (-75, -10, 10),
              "forearm.L": (-5, 0, 0), "hand.L": (-30, 0, 0), "spine": (10, 0, 14), "chest": (6, 0, 8),
              "head": (-6, 0, -8), "thigh.L": (-22, 0, 0), "shin.L": (16, 0, 0)}
    HA.clip(arm, st, "Shoot", [(0, {}), (7, gather), (11, thrust), (14, hrig.lerp(thrust, {}, 0.1)), (19, {})])
    HA.hit(arm, st, 9)
    HA.death(arm, st, 32, direction=-1)
    # ---------------------------------------------------------------- hide covered body, finish
    qa.delete_covered_body(body, cloths, margin=0.0, max_depth=0.25, shrink=0.015 * s)
    HC.fix_pokes(body, cloths, arm)
    import bpy
    bpy.data.objects.remove(src, do_unlink=True)
    return dict(arm=arm, body=body, cloths=cloths, gear=[gear, headgear, staff] + flaps, high=high, H=1.3,
                budget="humanoid", hero=("Idle", 12),
                keyposes=[("Attack", 6), ("Attack", 10), ("Attack2", 18), ("Attack2", 24), ("Shoot", 7), ("Shoot", 11)],
                closeups=[("mask", tuple(Q(0, 0.06, 0.12)), 0.13 * sh / 0.9, 20, 5),
                          ("mask side", tuple(Q(0, 0.02, 0.12)), 0.14 * sh / 0.9, 75, 5),
                          ("staff skull", tuple(skull_c), 0.14, 115, 5),
                          ("belt", tuple(V((0, 0, hips.z - 0.03))), 0.2, 25, 8)])
