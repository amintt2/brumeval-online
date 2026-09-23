"""wraith: floating tattered spectre (~2.1 m). Gaunt legless body (only the long clawed hands show), deep hood whose
opening is a shadowed void with two burning eyes, bell sleeves and a long robe that tears into glowing wisps.
Every cloth material is Cloth* (client wind sway); tattered with alpha MASK, faint emissive wisps near the hem.
The leg bones (unused by a legless body) drive the lower robe: it trails and billows in every clip."""
import math

import bpy
import mathutils

import hanim as HA
import hbody as HB
import hchar as HC
import hgarment as HG
import hmats as HM
import hprops as PR
import hrig
from hutil import J0, conform, lerp, shell, thicken, tidy
from kit import materials as KM
from kit import qa, rig

V = mathutils.Vector
FLOAT = 0.28


def build():
    H = 2.05
    s = H / 1.8
    P = dict(H=H, no_legs=True, gaunt=1.0, muscle=0.0, bulk=0.82, limb=0.7, hands=("claw", "claw"), claw=0.35,
             finger_len=1.75, fingers=4, hand_r=0.85, ears=None, nose=0.6, brow=1.4, eye=1.3, mouth=0.9, neck=0.8,
             arm_drop=58, seed=9, ribs_show=True)
    B = HC.make_body(P, "human", tris=3800)
    arm, J, base, high, body = B["arm"], B["J"], B["base"], B["high"], B["low"]
    R = HG.Regions(J)
    hips, ch, nk, hd = J0(J, "hips"), J0(J, "chest"), J0(J, "neck"), J0(J, "head")
    up = (J0(J, "head", 1) - hd).normalized()
    # ---------------------------------------------------------------- materials
    m_skin = HM.skin("Skin", "undead", "#8f96a0", seed=21, veins=0.7)
    m_void = KM.flat("Void", "#050608", rough=0.9)
    m_eye = HM.glow("Glow_Eyes", "#8ff6ff", 22.0)
    z_hem = 0.02
    m_robe = HM.ghost_robe("Cloth_Robe", color="#191c22", glow_col="#4fd8c8", seed=3, z_lo=z_hem, z_hi=0.62)
    m_top = HM.ghost_robe("Cloth_Shroud", color="#16181d", glow_col="#4fd8c8", seed=5, z_lo=hips.z - 0.4, z_hi=hips.z - 0.3)
    m_sleeve = HM.cloth("Cloth_Sleeve", color="#15171c", kind="linen", seed=6, dirt=0.6, hem_dirt=0.0)
    wr_z = J0(J, "forearm.L", 1).z
    HM.tatter(m_sleeve, wr_z - 0.1, wr_z + 0.08, 2.2, holes=0.5, seed=6, strands=1.6)
    m_hood = HM.cloth("Cloth_Hood", color="#121418", kind="wool", seed=7, dirt=0.5, hem_dirt=0.0)
    sh_z = J0(J, "upper_arm.L").z
    HM.tatter(m_hood, sh_z - 0.3, sh_z - 0.15, 1.8, holes=0.35, seed=7)
    m_chain = HM.metal("Iron_Chain", kind="iron", rust=0.8, seed=8)
    body.data.materials.append(m_skin)
    # the face inside the hood is a shadowed void: head faces get a near-black material
    HG.paint_region([body, high], R, lambda c, co: c[0] == "torso" and co.z > nk.z + 0.02 * s, m_void)
    # ---------------------------------------------------------------- shroud (torso), sleeves, long robe, hood
    shroud = shell(base, R, lambda c, co: (c[0] == "torso" and co.z < nk.z + 0.01 * s) or
                   (c[0].startswith("arm") and c[1] < 0.3), 0.02 * s, "Shroud", m_top)
    conform(shroud, [high], 0.016 * s)
    HB.decimate_to(shroud, 1500)
    sleeves = []
    for side in ("L", "R"):
        sl = HG.sleeve(J, side, s, 0.06 * s, 0.075 * s, f"Sleeve{side}", m_sleeve, n=18, rings_n=10, start=0.22,
                       end=0.9, bell=0.07 * s, drop=0.16 * s)
        conform(sl, [high, shroud], 0.012 * s, iters=3)
        sleeves.append(sl)
    top_z = hips.z + 0.05 * s
    robe = HG.skirt(top_z, z_hem, (0.155 * s, 0.12 * s), (0.36 * s, 0.33 * s), s, "Cloth_Robe", m_robe, n=44,
                    rings_n=18, folds=9, fold_amp=0.09, cy=hips.y + 0.01, back_long=0.0, flare=1.6)
    conform(robe, [high, shroud], 0.012 * s, iters=3)
    hood = HG.hood(J, s, "Cloth_Hood", m_hood, depth=1.25, peak=0.14, mantle=(0.25, 0.19), hem_drop=0.3,
                   open_w=0.2, open_h=(-0.02, 0.15), brim=0.06)
    conform(hood, [high, shroud], 0.015 * s, iters=3)
    HB.decimate_to(hood, 1800)
    # ---------------------------------------------------------------- skinning
    src = HB.copy(body, "_BodySrc")
    rig.bind(body, arm, smooth=4)
    rig.bind(src, arm, smooth=4)
    HC.weights_from(src, shroud, arm, smooth=8)
    for sl, side in zip(sleeves, ("L", "R")):
        HG.seg_weights(sl, arm, [f"upper_arm.{side}", f"forearm.{side}", "chest"], power=3.0, smooth=6,
                       bias={f"forearm.{side}": 1.3})
    # robe: hips at the waist, the (legless) thigh / shin bones inside the robe drive its lower half
    HG.seg_weights(robe, arm, ["hips", "spine", "thigh.L", "thigh.R", "shin.L", "shin.R"], power=2.5, smooth=10,
                   bias={"hips": 1.4, "spine": 0.6})
    zc = HB.get_co(robe)[:, 2]
    HC.blend_weights_to(robe, arm, "hips", ((zc - (hips.z - 0.1 * s)) / (0.12 * s)).clip(0, 1))
    HG.seg_weights(hood, arm, ["head", "neck", "chest", "upper_arm.L", "upper_arm.R", "spine"], power=3.0, smooth=8,
                   bias={"head": 2.5})
    zc = HB.get_co(hood)[:, 2]
    HC.blend_weights_to(hood, arm, "head", ((zc - (hd.z + 0.0)) / (0.05 * s)).clip(0, 1))
    # ---------------------------------------------------------------- eyes + a rusted chain girdle
    eye_c = [hd + V((sg * 0.032, -0.088, 0)) * s + up * 0.097 * s for sg in (1, -1)]
    tb = HB.bvh(high)
    ec = []
    for e in eye_c:
        q, n, _, _ = tb.find_nearest(e)
        ec.append(q + n * 0.004 * s)
    eyes = PR.eye_glows(ec, 0.012 * s, m_eye, "EyeGlow")
    HC.parent_rigid(eyes, arm, "head")
    loop = HG.body_loop(robe, hips.z - 0.02 * s, hips.y, 0.2 * s, 0.17 * s, n=18, clearance=0.012 * s)
    links = []
    for k in range(18):
        a, b = V(loop[k]), V(loop[(k + 1) % 18])
        c = (a + b) / 2
        d = (b - a).normalized()
        nrm = V((c.x, c.y - hips.y, 0)).normalized()
        w = d.cross(nrm) if k % 2 else nrm
        pts = [tuple(c + d * math.cos(t) * 0.028 * s + w * math.sin(t) * 0.014 * s) for t in [2 * math.pi * j / 10 for j in range(10)]]
        links.append(PR.sweep([(*p, 1.0) for p in pts + [pts[0]]], 0.0045 * s, f"Link{k}", m_chain, res=5))
    hang = [V(loop[k]) for k in (2, 15)]
    for j, p0 in enumerate(hang):
        for i in range(4):
            c = p0 - V((0, 0, 0.045 * s * (i + 0.7)))
            d = V((0, 0, 1))
            w = V((1, 0, 0)) if i % 2 else V((0, 1, 0))
            pts = [tuple(c + d * math.cos(t) * 0.026 * s + w * math.sin(t) * 0.013 * s) for t in [2 * math.pi * q / 10 for q in range(10)]]
            links.append(PR.sweep([(*p, 1.0) for p in pts + [pts[0]]], 0.0045 * s, f"Hang{j}{i}", m_chain, res=5))
    chain = HB.join(links, "Chain")
    HG.seg_weights(chain, arm, ["hips", "spine", "thigh.L", "thigh.R"], power=3, smooth=4, bias={"hips": 5.0})
    tidy(eyes)
    tidy(chain)
    # ---------------------------------------------------------------- thickness
    thicken(shroud, 0.006 * s)
    for sl in sleeves:
        thicken(sl, 0.005 * s, full=True)
    thicken(robe, 0.006 * s, full=True)
    thicken(hood, 0.007 * s, full=True)
    cloths = [shroud, hood, robe] + sleeves
    # ---------------------------------------------------------------- clips (floating: no ground snap)
    hover = {"spine": (8, 0, 0), "chest": (6, 0, 0), "neck": (6, 0, 0), "head": (-8, 0, 0),
             "upper_arm.L": (-12, 6, 0), "upper_arm.R": (-12, -6, 0), "forearm.L": (-24, 0, 0), "forearm.R": (-24, 0, 0),
             "hand.L": (-10, 0, 0), "hand.R": (-10, 0, 0)}
    st = dict(snap=None, arms=18, elbow=-10, float=FLOAT, base=hover)

    def lift(p, z, rot=(0, 0, 0)):
        q = dict(p)
        q["root"] = {"rot": rot, "loc": (0, 0, z)}
        return q
    trail = lambda a, b=None: {"thigh.L": (a, 0, 0), "thigh.R": (a if b is None else b, 0, 0),  # noqa: E731
                               "shin.L": (a * 0.8, 0, 0), "shin.R": ((a if b is None else b) * 0.8, 0, 0)}
    i0 = hrig.add(trail(6, 3), {"upper_arm.L": (-4, -3, 0), "hand.L": (0, 0, 10), "chest": (-2, 0, 0)})
    i1 = hrig.add(trail(2, 7), {"upper_arm.R": (-4, 3, 0), "hand.R": (0, 0, -10), "chest": (2, 0, 0), "head": (2, 0, 4)})
    HA.clip(arm, st, "Idle", [(0, lift(i0, 0.0)), (18, lift(i1, 0.05)), (36, lift(i0, 0.0)), ("loop", 36)], cyclic=True)
    w0 = hrig.add(trail(20, 16), {"spine": (8, 0, 0), "upper_arm.L": (10, 0, 0), "upper_arm.R": (14, 0, 0)})
    w1 = hrig.add(trail(16, 22), {"spine": (9, 0, 0), "upper_arm.L": (14, 0, 0), "upper_arm.R": (10, 0, 0), "head": (0, 0, 3)})
    HA.clip(arm, st, "Walk", [(0, lift(w0, 0.0, (0, 0, 2))), (16, lift(w1, 0.04, (0, 0, -2))), (32, lift(w0, 0.0, (0, 0, 2))),
                              ("loop", 32)], cyclic=True)
    r0 = hrig.add(trail(55, 48), {"spine": (26, 0, 0), "chest": (8, 0, 0), "head": (-22, 0, 0),
                                  "upper_arm.L": (40, 10, 0), "upper_arm.R": (44, -10, 0), "forearm.L": (10, 0, 0),
                                  "forearm.R": (10, 0, 0)})
    r1 = hrig.add(trail(48, 58), {"spine": (28, 0, 0), "chest": (8, 0, 0), "head": (-24, 0, 0),
                                  "upper_arm.L": (46, 10, 0), "upper_arm.R": (40, -10, 0), "forearm.L": (14, 0, 0),
                                  "forearm.R": (8, 0, 0)})
    HA.clip(arm, st, "Run", [(0, lift(r0, 0.0)), (8, lift(r1, 0.05)), (16, lift(r0, 0.0)), ("loop", 16)], cyclic=True)
    # Attack (0.7 s): both claws rake downward
    a1 = hrig.add(trail(-10), {"upper_arm.L": (-100, -30, 0), "upper_arm.R": (-100, 30, 0), "forearm.L": (-40, 0, 0),
                               "forearm.R": (-40, 0, 0), "spine": (-12, 0, 0), "chest": (-8, 0, 0), "head": (8, 0, 0)})
    a2 = hrig.add(trail(35), {"upper_arm.L": (-20, 10, -20), "upper_arm.R": (-20, -10, 20), "forearm.L": (-10, 0, 0),
                              "forearm.R": (-10, 0, 0), "spine": (24, 0, 0), "chest": (12, 0, 0), "head": (-16, 0, 0)})
    HA.clip(arm, st, "Attack", [(0, lift({}, 0)), (7, lift(a1, 0.08)), (10, lift(a2, -0.06, (0, 0, 0))),
                                (12, lift(hrig.add(a2, {"spine": (3, 0, 0)}), -0.07)), (17, lift({}, 0))])
    # Attack2 (1.4 s): rises with arms spread (shriek), then dives forward with both claws
    b1 = hrig.add(trail(-20), {"upper_arm.L": (-40, -70, 0), "upper_arm.R": (-40, 70, 0), "forearm.L": (-10, 0, 0),
                               "forearm.R": (-10, 0, 0), "hand.L": (0, 0, 20), "hand.R": (0, 0, -20), "spine": (-20, 0, 0),
                               "chest": (-12, 0, 0), "neck": (-10, 0, 0), "head": (14, 0, 0)})
    b2 = hrig.add(trail(60), {"upper_arm.L": (-90, 0, -10), "upper_arm.R": (-90, 0, 10), "forearm.L": (0, 0, 0),
                              "forearm.R": (0, 0, 0), "spine": (34, 0, 0), "chest": (10, 0, 0), "head": (-26, 0, 0)})
    HA.clip(arm, st, "Attack2", [(0, lift({}, 0)), (10, lift(hrig.lerp({}, b1, 0.7), 0.2)), (19, lift(b1, 0.32)),
                                 (22, lift(hrig.add(b1, {"spine": (-3, 0, 0)}), 0.34)),
                                 (26, {**lift(b2, -0.05), "hips": {"rot": (10, 0, 0), "loc": (0, -0.35, 0)}}),
                                 (29, {**lift(b2, -0.07), "hips": {"rot": (8, 0, 0), "loc": (0, -0.3, 0)}}), (34, lift({}, 0))])
    h1 = hrig.add(trail(-25), {"spine": (-14, 0, 6), "chest": (-10, 0, 4), "head": (-18, 6, 8), "neck": (-6, 0, 0),
                               "upper_arm.L": (-10, -20, 0), "upper_arm.R": (-10, 20, 0)})
    HA.clip(arm, st, "Hit", [(0, lift({}, 0)), (2, lift(h1, 0.05, (0, 0, 0))), (5, lift(hrig.lerp(h1, {}, 0.5), 0.02)), (9, lift({}, 0))])
    # Death (1.4 s): shrieks upward, then collapses and sinks, the empty robe lying on the ground
    d1 = hrig.add(trail(-15), {"upper_arm.L": (-60, -50, 0), "upper_arm.R": (-60, 50, 0), "spine": (-16, 0, 0),
                               "head": (20, 0, 0), "chest": (-10, 0, 0)})
    d2 = hrig.add(trail(40), {"spine": (30, 0, 10), "chest": (20, 0, 6), "head": (-10, 0, 10), "upper_arm.L": (10, -10, 0),
                              "upper_arm.R": (20, 10, 0), "forearm.L": (-30, 0, 0), "forearm.R": (-20, 0, 0)})
    d3 = hrig.add(trail(70, 60), {"spine": (20, 0, 4), "chest": (14, 0, 0), "head": (-12, 8, 20), "upper_arm.L": (-30, -40, 0),
                                  "upper_arm.R": (-20, 40, 0), "forearm.L": (-10, 0, 0), "forearm.R": (-15, 0, 0)})
    HA.clip(arm, st, "Death", [(0, lift({}, 0)), (7, lift(d1, 0.15)), (16, lift(d2, -0.25, (20, 0, 5))),
                               (26, lift(hrig.add(d3, {"chest": (2, 0, 0)}), -FLOAT + 0.03, (82, 0, 10))),
                               (33, lift(d3, -FLOAT, (84, 0, 10)))])
    # ---------------------------------------------------------------- hide covered body, finish
    qa.delete_covered_body(body, cloths, margin=0.0, max_depth=0.3, shrink=0.02 * s)
    HC.fix_pokes(body, cloths, arm)
    bpy.data.objects.remove(src, do_unlink=True)
    return dict(arm=arm, body=body, cloths=cloths, gear=[eyes, chain], high=high, H=None,
                budget="humanoid", hero=("Idle", 10),
                closeups=[("hood", tuple(hd + V((0, -0.04, 0.1)) * s), 0.2, 15, 4),
                          ("claw", tuple(J0(J, "hand.L", 1)), 0.13, 60, 10),
                          ("hem", (0, 0, 0.25), 0.4, 30, 12),
                          ("chain", (0, -0.1, hips.z - 0.1), 0.28, 20, 5)])
