"""skeleton_archer: 1.8 m skeleton with cracked, grimy bones (one continuous fused mesh), glowing eyes, a tattered
hood + shoulder mantle + back cape, leather bracer, rope belt with ragged loin flaps, hip quiver full of arrows and
a recurve bow in the left fist."""
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
from hutil import J0, conform, lerp, thicken, tidy
from kit import rig

V = mathutils.Vector


def build():
    H = 1.8
    s = 1.0
    P = dict(H=H, bone=1.0, hands=("fist", "claw"), jaw_open=10, hunch=8)
    B = HC.make_body(P, "skeleton", tris=8200)
    arm, J, high, body = B["arm"], B["J"], B["high"], B["low"]
    hips, ch, nk, hd = J0(J, "hips"), J0(J, "chest"), J0(J, "neck"), J0(J, "head")
    sh = J0(J, "upper_arm.L")
    # ---------------------------------------------------------------- materials
    m_bone = HM.bone_cracked("Bone", color="#c2b391", seed=3, dirt=0.9, grime="#3f3222")
    m_hood = HM.cloth("Cloth_Hood", color="#2b2d27", kind="wool", seed=4, dirt=0.7, hem_dirt=0.0)
    m_flap = HM.cloth("Cloth_Rags", color="#3d3226", kind="linen", seed=5, dirt=0.8, hem_dirt=0.8)
    m_leather = HM.leather("Leather", color="#3b2a1c", seed=6, wear=0.8, dirt=0.7)
    m_rope = HM.leather("Rope", color="#4b3d2a", seed=7, wear=0.4, dirt=0.6)
    m_wood = HM.wood("Wood_Bow", color="#3e2c1c", color2="#21160d", seed=8, dirt=0.5, wear=0.6)
    m_string = HM.leather("String", color="#8b7b5e", seed=9, wear=0.1)
    m_iron = HM.metal("Iron", kind="iron", rust=0.7, seed=10)
    m_fletch = HM.feather("Feather", color="#1f1d1b", tip="#6e675c", band="#5a1e14", seed=4)
    m_eye = HM.glow("Glow_Eyes", "#6fd0ff", 14.0)
    body.data.materials.append(m_bone)
    # ---------------------------------------------------------------- hood + mantle + cape (one lofted mesh)
    cape_len = 0.52
    hem_drop = 0.2
    hood = HG.hood(J, s, "Cloth_Hood", m_hood, depth=1.08, peak=0.09, mantle=(0.24, 0.17), hem_drop=hem_drop,
                   open_w=0.21, open_h=(0.0, 0.16), brim=0.04, cape=(cape_len, 0.95), cape_fold=2.2)
    z_hem = sh.z - hem_drop - cape_len
    HM.tatter(m_hood, z_hem - 0.02, z_hem + 0.2, 1.5, holes=0.35, seed=4, strands=1.3)
    conform(hood, [high], 0.02, iters=3)
    HB.decimate_to(hood, 2200)
    # ---------------------------------------------------------------- belt + ragged flaps (front / back)
    bz = hips.z - 0.015
    loop = []
    for k in range(40):
        a = 2 * math.pi * k / 40
        loop.append(V((0.165 * math.sin(a), hips.y + 0.01 - 0.12 * math.cos(a), bz - 0.025 * math.cos(a))))
    belt = HG.band(loop, 0.03, 0.01, "Belt", m_rope, closed=True)
    HB.push_outside(belt, [high], 0.006, iters=2, smooth=0)
    kn = J0(J, "thigh.L", 1)
    HM.tatter(m_flap, kn.z + 0.05, kn.z + 0.22, 1.8, holes=0.45, seed=5, strands=1.5)
    flaps = []
    for k, (i0, i1, bl) in enumerate(((36, 4, (0, -1, 0)), (16, 24, (0, 1, 0)))):
        rows = HG.flap(loop[i0], loop[i1], (bz - kn.z) * 0.82, n_w=6, n_h=9, bulge=bl, bulge_amp=0.02, flare=1.2, seed=k)
        f = HG.strip(rows, f"Flap{k}", m_flap)
        HB.outward_normals(f, lambda p: V((0, hips.y, p.z)))
        conform(f, [high], 0.025, iters=3)
        flaps.append(f)
    # ---------------------------------------------------------------- bracer (left forearm)
    bracer = HG.sleeve(J, "L", s, 0.03, 0.026, "Bracer", m_leather, n=14, rings_n=5, start=0.63, end=0.92)
    HB.push_outside(bracer, [high], 0.01, iters=2, smooth=0)
    straps = []
    for t in (0.68, 0.86):
        el, wr = J0(J, "upper_arm.L", 1), J0(J, "forearm.L", 1)
        c = lerp(el, wr, max(0.0, min(1.0, (t - 0.527) / 0.473)))
        d = (wr - el).normalized()
        ax = d.orthogonal().normalized()
        ay = d.cross(ax)
        pts = [tuple(c + (ax * math.cos(a) + ay * math.sin(a)) * 0.033) for a in [2 * math.pi * j / 16 for j in range(16)]]
        straps.append(HG.band(pts, 0.012, 0.004, f"BracerStrap{int(t * 100)}", m_iron, up=tuple(d), closed=True))
    # ---------------------------------------------------------------- skinning
    rig.bind(body, arm, smooth=3)
    HG.seg_weights(hood, arm, ["head", "neck", "chest", "spine", "upper_arm.L", "upper_arm.R", "hips"], power=3.0,
                   smooth=10, bias={"head": 2.2, "chest": 1.4})
    zc = HB.get_co(hood)[:, 2]
    HC.blend_weights_to(hood, arm, "head", ((zc - (hd.z + 0.0)) / 0.05).clip(0, 1))
    for f in flaps:
        HG.seg_weights(f, arm, ["hips", "thigh.L", "thigh.R"], power=2.0, smooth=6, bias={"hips": 2.0})
    HG.seg_weights(bracer, arm, ["forearm.L", "hand.L", "upper_arm.L"], power=4, smooth=3, bias={"forearm.L": 4.0})
    for g in straps:
        HG.seg_weights(g, arm, ["forearm.L"], power=1, smooth=0)
    # ---------------------------------------------------------------- hip quiver (right side) + bow (left fist)
    qc = V((-0.2, hips.y + 0.07, hips.z - 0.08))
    qtop = qc + V((-0.02, 0.06, 0.24))
    qbot = qc - V((-0.02, 0.06, 0.24))
    quiver = PR.quiver(qtop, qbot, 0.045, m_leather, m_wood, m_fletch, m_iron, n_arrows=8, seed=3, name="Quiver")
    qstrap = PR.sweep([tuple(qtop - V((0, 0, 0.06))), tuple(lerp(qtop, V(loop[11]), 0.5) + V((0.0, 0.0, 0.02))), loop[11]],
                      0.006, "QuiverStrap", m_rope, res=5)
    for g in (belt, quiver, qstrap):
        HG.seg_weights(g, arm, ["hips", "spine", "thigh.R"], power=3, smooth=3, bias={"hips": 4.0})
    grip, axis, dirn, _ = PR.grip_frame(J, "L")
    bow, tips = PR.bow(grip, axis, dirn, 1.3, m_wood, m_leather, m_string, name="Bow")
    HC.parent_rigid(bow, arm, "hand.L")
    eyes = PR.eye_glows(B["eyes"], 0.011, m_eye, "EyeGlow")
    HC.parent_rigid(eyes, arm, "head")
    gear = HC.join_gear([belt, quiver, qstrap], "Gear")
    arm_gear = HC.join_gear([bracer] + straps, "BracerGear")
    for o in (gear, bow, eyes, arm_gear):
        tidy(o)
    # ---------------------------------------------------------------- thickness
    thicken(hood, 0.006, full=True)
    for f in flaps:
        thicken(f, 0.004, full=True)
    cloths = [hood]
    # ---------------------------------------------------------------- clips
    stance = {"spine": (6, 0, 0), "chest": (4, 0, 0), "neck": (4, 0, 0), "head": (-10, 0, 0),
              "thigh.L": (-6, 0, 0), "thigh.R": (-6, 0, 0), "shin.L": (10, 0, 0), "shin.R": (10, 0, 0),
              "foot.L": (-4, 0, 0), "foot.R": (-4, 0, 0), "forearm.L": (-8, 0, 0)}
    st = dict(snap=body, arms=26, elbow=-12, stride=24, swing=14, base=stance)
    HA.idle(arm, st, dur=56, breathe=1.5, sway=2.0,
            extra=({"head": (0, 3, 6), "hand.R": (0, 0, 6)}, {"head": (0, -2, -5), "hand.R": (0, 0, -4)}))
    HA.walk(arm, st, dur=26, knee=40, bob=0.02, lean=3)
    HA.run(arm, st, dur=16, lean=14)
    # Shoot (0.8 s): raise the bow, draw to the cheek, release, recover
    raise_ = {"upper_arm.L": (-78, 0, -12), "forearm.L": (10, 0, 0), "hand.L": (0, 0, 0),
              "upper_arm.R": (-50, 40, 20), "forearm.R": (-60, 0, 0), "spine": (0, 0, 30), "chest": (0, 0, 18),
              "neck": (0, 0, -12), "head": (-6, 0, -14), "thigh.L": (-10, 0, 0), "thigh.R": (8, 0, 0)}
    draw = hrig.add(raise_, {"upper_arm.R": (-30, 42, 30), "forearm.R": (-40, 0, 90), "chest": (0, 0, 6)})
    release = hrig.add(draw, {"upper_arm.R": (0, 8, 10), "forearm.R": (20, 0, 0), "hand.R": (0, 0, -20),
                              "upper_arm.L": (-4, 0, 0), "spine": (-3, 0, 0)})
    HA.clip(arm, st, "Shoot", [(0, {}), (5, raise_), (10, draw), (12, hrig.add(draw, {"upper_arm.R": (0, 2, 4)})),
                               (13, release), (16, hrig.lerp(release, {}, 0.4)), (20, {})])
    # Attack2 (1.5 s): power shot - slow heavy draw leaning back and aiming high (telegraph), release with recoil
    draw2 = hrig.add(draw, {"spine": (-10, 0, 0), "chest": (-6, 0, 0), "upper_arm.L": (-14, 0, 0), "head": (-6, 0, 0),
                            "thigh.R": (10, 0, 0), "shin.R": (8, 0, 0), "thigh.L": (-16, 0, 0), "shin.L": (6, 0, 0)})
    rel2 = hrig.add(draw2, {"upper_arm.R": (10, 14, 20), "forearm.R": (30, 0, 0), "hand.R": (0, 0, -30),
                            "spine": (-6, 0, 0), "upper_arm.L": (-10, 0, 0), "hips": {"rot": (0, 0, 0), "loc": (0, 0.05, 0)}})
    HA.clip(arm, st, "Attack2", [(0, {}), (6, raise_), (14, hrig.lerp(raise_, draw2, 0.6)), (22, draw2),
                                 (25, hrig.add(draw2, {"upper_arm.R": (0, 3, 6), "chest": (0, 0, 2)})),
                                 (26, rel2), (30, hrig.lerp(rel2, {}, 0.35)), (36, {})])
    # Attack (0.65 s): vicious bow-swipe backhand with the left arm
    wind = {"upper_arm.L": (-40, 50, 50), "forearm.L": (-50, 0, 0), "spine": (0, 0, 28), "chest": (0, 0, 18),
            "head": (0, 0, -14), "upper_arm.R": (-20, -10, 0), "thigh.L": (-8, 0, 0)}
    swipe = {"upper_arm.L": (-70, -20, -70), "forearm.L": (-5, 0, 0), "hand.L": (0, 0, -20), "spine": (8, 0, -30),
             "chest": (4, 0, -20), "head": (0, 0, 16), "upper_arm.R": (10, 10, 0), "thigh.L": (-24, 0, 0),
             "shin.L": (18, 0, 0), "hips": {"rot": (0, 0, -10), "loc": (0, -0.05, -0.02)}}
    HA.clip(arm, st, "Attack", [(0, {}), (6, wind), (9, swipe), (11, hrig.add(swipe, {"spine": (2, 0, -4)})), (16, {})])
    HA.hit(arm, st, 9)
    HA.death(arm, st, 32, direction=1)
    HC.fix_pokes(body, cloths, arm, passes=2, push=0.006, delete=False)
    return dict(arm=arm, body=body, cloths=cloths, gear=[gear, bow, eyes, arm_gear] + flaps, high=high, H=1.85,
                budget="humanoid", hero=("Idle", 14),
                keyposes=[("Shoot", 5), ("Shoot", 11), ("Shoot", 13), ("Attack", 6), ("Attack", 9), ("Attack2", 22),
                          ("Attack2", 26)],
                closeups=[("skull", tuple(hd + V((0, -0.04, 0.1))), 0.16, 20, 5),
                          ("hood side", tuple(hd + V((0, 0, 0.08))), 0.22, 80, 5),
                          ("ribs", tuple(lerp(ch, J0(J, "spine"), 0.5) + V((0, -0.02, 0))), 0.24, 30, 5),
                          ("quiver", tuple(qc + V((0, 0, 0.1))), 0.3, 250, 10),
                          ("bow hand", tuple(grip), 0.2, 40, 10)])
