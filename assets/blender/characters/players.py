"""Player classes: warrior (Guerrier), mage, ranger (Rôdeur)."""
import math

from mathutils import Vector

import geo as G
import humanoid as H
import parts as PT
from humanoid import arm_r, over, plus


# ============================================================================ WARRIOR
def warrior():
    L = dict(H.HUMAN, shoulder_w=0.215, hip_w=0.1)
    rig = H.build_rig(L)
    P = H.Poser(rig, L)
    b = G.MeshBuilder()

    skin = PT.mat("War_Skin", "#dfa27a", 0.65)
    hair = PT.mat("War_Hair", "#5a3822", 0.9)
    steel = PT.mat("War_Steel", "#b9c1cb", 0.38, 0.5)
    dsteel = PT.mat("War_SteelDark", "#707983", 0.45, 0.5)
    red = PT.mat("War_Red", "#c0392b", 0.75)
    dred = PT.mat("War_RedDark", "#7a2119", 0.8)
    leather = PT.mat("War_Leather", "#6e4427", 0.75)
    dleather = PT.mat("War_LeatherDark", "#3d2616", 0.85)
    gold = PT.mat("War_Gold", "#e3ae44", 0.35, 0.55)
    wood = PT.mat("War_Wood", "#7a4e2c", 0.85)
    white = PT.mat("War_EyeWhite", "#f2ede4", 0.5)
    dark = PT.mat("War_EyeDark", "#1d1612", 0.5)
    blade = PT.mat("War_Blade", "#dfe6ee", 0.25, 0.55)

    # ---- legs
    PT.limb_pair(b, P, "thigh", [0.095, 0.085, 0.066], dred, ext0=0.04, ext1=0.02)
    for s, sx in (("L", 1), ("R", -1)):
        kn = P.head[f"shin.{s}"]
        PT.limb(b, P, f"shin.{s}", [0.064, 0.067, 0.053], steel, ext0=-0.02, ext1=-0.12)
        b.add(G.ellipsoid((kn.x, -0.035, kn.z - 0.01), (0.058, 0.044, 0.062), 8, 4), steel, f"shin.{s}")
        PT.boot(b, P, s, leather, sole=dleather, w=0.056, h=0.105, toe=0.2, shaft_top=0.26, shaft_r=0.064,
                cuff=dleather, cuff_r=0.072, toe_mat=dleather)

    # ---- pelvis, belt, tabard
    b.add(G.loft([(0, 0.005, 0.83, 0.12, 0.095), (0, 0.0, 0.93, 0.172, 0.12), (0, 0.0, 1.07, 0.165, 0.118)], shape="chamfer"),
          dred, "hips")
    b.add(G.loft([(0, 0.0, 0.965, 0.182, 0.13), (0, 0.0, 1.035, 0.184, 0.132)], shape="chamfer"), leather, "hips")
    b.add(G.box((0, -0.136, 1.0), 0.04, 0.012, 0.032), gold, "hips")
    b.add(G.box((0, -0.14, 1.0), 0.022, 0.012, 0.016), dleather, "hips")
    for side_y, yy in ((-1, -0.128), (1, 0.128)):
        tab = G.loft([(0, yy + side_y * 0.012, 0.8, 0.085, 0.012), (0, yy, 0.97, 0.1, 0.012)], shape="rect")
        b.add(tab, red, "hips")
        b.add(G.box((0, yy + side_y * 0.014, 0.81), 0.087, 0.008, 0.012), gold, "hips")
    # ---- torso
    b.add(G.loft([(0, 0.0, 1.02, 0.162, 0.115), (0, 0.0, 1.27, 0.172, 0.124)], shape="chamfer"), red, "spine")
    b.add(G.loft([(0, 0.0, 1.195, 0.185, 0.135), (0, -0.004, 1.33, 0.225, 0.152), (0, 0.0, 1.44, 0.22, 0.138),
                  (0, 0.01, 1.51, 0.13, 0.092)], shape="chamfer"), steel, "chest")
    b.add(G.loft([(0, 0.0, 1.19, 0.184, 0.137), (0, 0.0, 1.225, 0.188, 0.14)], shape="chamfer"), gold, "chest")
    b.add(G.box((0, -0.148, 1.33), 0.012, 0.006, 0.1), dsteel, "chest")
    b.add(G.loft([(0, 0.01, 1.46, 0.09, 0.085), (0, 0.012, 1.53, 0.08, 0.075)], 8), dsteel, "chest")
    PT.neck(b, P, skin, r=0.05)

    # ---- arms
    for s, sx in (("L", 1), ("R", -1)):
        PT.limb(b, P, f"upper_arm.{s}", [0.066, 0.062, 0.055], red, ext0=0.0, ext1=0.02)
        PT.ball(b, P, f"upper_arm.{s}", 0.0, 0.072, red, seg=8, rings=4)
        el = P.head[f"forearm.{s}"]
        b.add(G.ellipsoid((el.x, el.y + 0.01, el.z), 0.056, 8, 4), dsteel, f"forearm.{s}")
        PT.limb(b, P, f"forearm.{s}", [0.056, 0.058, 0.047], steel, ext0=-0.02, ext1=-0.03)
        PT.fist(b, P, s, leather, size=1.05, glove_cuff=dleather)
        # pauldron: layered dome + red trim
        sh = P.head[f"upper_arm.{s}"]
        c = Vector((sh.x + sx * 0.02, 0.0, sh.z + 0.005))
        dome = G.shell(c, (0.112, 0.118, 0.1), 10, 4, phi0=math.pi * 0.42, phi1=math.pi)
        b.add(G.xform(dome, G.T(c) @ G.R(0, sx * 18, 0) @ G.T(-c)), steel, f"upper_arm.{s}")
        rim = G.loft([(0, 0, -0.012, 0.114, 0.12), (0, 0, 0.01, 0.111, 0.117)], 10, cap0=False, cap1=False)
        b.add(G.xform(rim, G.T(c) @ G.R(0, sx * 18, 0) @ G.T(0, 0, -0.022)), red, f"upper_arm.{s}")
        lame = G.loft([(0, 0, -0.03, 0.104, 0.11), (0, 0, 0.0, 0.114, 0.12)], 10, cap0=False, cap1=False)
        b.add(G.xform(lame, G.T(c) @ G.R(0, sx * 18, 0) @ G.T(0, 0, -0.036)), dsteel, f"upper_arm.{s}")

    # ---- head
    F = PT.human_head(b, P, skin, r=(0.106, 0.114, 0.13))
    PT.eyes(b, F, white, dark)
    PT.brows(b, F, hair, tilt=-16, bushy=1.2)
    PT.nose(b, F, skin, length=0.03)
    PT.ears(b, F, skin)
    # short beard on the jaw + moustache
    beard = G.shell(F.c + Vector((0, -0.004, -0.004)), (0.111, 0.12, 0.136), 10, 7, phi0=0.0, phi1=math.pi * 0.31,
                    keep=lambda d: d.y < 0.25)
    b.add(beard, hair, "head")
    m0 = F.surf(0, F.c.z - 0.047, inset=0.004)
    b.add(G.loft([(m0.x, m0.y - 0.002, m0.z - 0.012, 0.042, 0.012), (m0.x, m0.y, m0.z + 0.004, 0.03, 0.01)], 6), hair, "head")
    PT.mouth(b, F, PT.mat("War_Mouth", "#7a3526", 0.8), w=0.022, dz=-0.066)
    # helmet: dome (above the brows) + gold band + nose guard + cheek guards + red crest
    hc = F.c + Vector((0, 0.006, 0.036))
    hr = (0.118, 0.127, 0.118)
    b.add(G.shell(hc, hr, 12, 5, phi0=math.pi * 0.5, phi1=math.pi), steel, "head")
    b.add(G.loft([(hc.x, hc.y, hc.z - 0.008, 0.121, 0.13), (hc.x, hc.y, hc.z + 0.02, 0.119, 0.128)], 12, cap0=False, cap1=False),
          gold, "head")
    ng = F.surf(0, F.c.z + 0.01, inset=-0.016)
    b.add(G.box((0, ng.y, hc.z - 0.03), 0.008, 0.007, 0.034), steel, "head")
    for sx in (1, -1):
        p = Vector((hc.x + sx * 0.112, hc.y + 0.01, hc.z - 0.05))
        b.add(G.xform(G.box((0, 0, 0), 0.01, 0.045, 0.048), G.T(p) @ G.R(0, sx * -8, 0)), steel, "head")
    crest, rads = [], []
    for i in range(8):
        a = math.radians(-55 + 165 * i / 7)
        u = math.sin(math.pi * min(1.0, (i + 0.8) / 6.5))
        hgt = 0.03 + 0.04 * u
        dirv = Vector((0, math.sin(a) * hr[1], math.cos(a) * hr[2]))
        crest.append(hc + dirv + dirv.normalized() * hgt * 0.55)
        rads.append((0.014, hgt))
    b.add(G.sweep(crest, rads, n=6, normal=(1, 0, 0)), red, "head")

    # ---- sword (right hand)
    M = PT.grip_matrix(P, "R", tilt=12)
    b.add(G.tube((0, 0, -0.075), (0, 0, 0.085), 0.017, 0.016, n=6), dleather, "hand.R", M=M)
    b.add(G.ellipsoid((0, 0, -0.095), 0.026, 6, 4), gold, "hand.R", M=M)
    b.add(G.box((0, 0, 0.098), 0.02, 0.115, 0.016), gold, "hand.R", M=M)
    for sy in (1, -1):
        b.add(G.ellipsoid((0, sy * 0.118, 0.098), 0.021, 6, 4), gold, "hand.R", M=M)
    b.add(G.loft([(0, 0, 0.11, 0.009, 0.042), (0, 0, 0.72, 0.008, 0.036), (0, 0, 0.86, 0.006, 0.022), (0, 0, 0.94, 0, 0)],
                 4, phase=0.0), blade, "hand.R", M=M)
    b.add(G.loft([(0, 0, 0.114, 0.0105, 0.009), (0, 0, 0.66, 0.0095, 0.007)], 4, phase=0.0), dsteel, "hand.R", M=M)

    # ---- round shield (left forearm, outside)
    fa0, fa1 = P.head["forearm.L"], P.tail["forearm.L"]
    sc = fa0.lerp(fa1, 0.5) + Vector((0.085, 0.0, 0.0))
    Ms = G.T(sc) @ G.R(0, 90, 0)
    b.add(G.loft([(0, 0, -0.03, 0.27, 0.27), (0, 0, 0.0, 0.29, 0.29), (0, 0, 0.018, 0.27, 0.27)], 14), wood, "forearm.L", M=Ms)
    b.add(G.loft([(0, 0, 0.012, 0.25, 0.25), (0, 0, 0.03, 0.215, 0.215)], 14), red, "forearm.L", M=Ms)
    b.add(G.ring_band((0, 0, 0.012), 0.255, 0.3, 0.045, 14), steel, "forearm.L", M=Ms)
    b.add(G.ellipsoid((0, 0, 0.03), (0.075, 0.075, 0.05), 10, 5, phi0=math.pi / 2), steel, "forearm.L", M=Ms)
    b.add(G.box((0, 0, 0.033), 0.022, 0.215, 0.008), gold, "forearm.L", M=Ms)
    b.add(G.box((0, 0, 0.033), 0.215, 0.022, 0.008), gold, "forearm.L", M=Ms)
    b.add(G.box((0, 0, -0.04), 0.03, 0.12, 0.012), dleather, "forearm.L", M=Ms)

    body = b.build("warrior", rig)
    print(f"[warrior] triangles ~{b.tri_count()} {b.breakdown()}")

    # ---- animation
    st = H.stance(drop=0.03, width=1.5, feet=(0.06, -0.07), toe_out=12, spine=(3, 0, 0), chest=(-1, 0, 0),
                  arms={"L": dict(fwd=10, out=16, twist=-18, elbow=62, hand=(0, 0, 0)),
                        "R": dict(fwd=8, out=12, twist=8, elbow=48, hand=(8, 0, 0))})
    g = H.gait(arms={"L": dict(swing=0.3, fwd=14, elbow=78, twist=-32, out=16),
                     "R": dict(swing=0.75, fwd=4, elbow=52, out=12, hand=(10, 0, 0))})
    P.key_loop("Idle", 48, lambda t: H.idle_spec(P, t, st))
    P.key_loop("Walk", g["frames"], lambda p: H.gait_spec(P, p, g, st))
    base = H.idle_spec(P, 0, st)

    def sword(fwd, out, twist, elbow, hand=(0, 0, 0)):
        return {"upper_arm.R": arm_r("R", fwd, out, twist), "forearm.R": (-elbow, 0, 0), "hand.R": H.side_r("R", hand)}

    guard = {"upper_arm.L": arm_r("L", 18, 22, -28), "forearm.L": (-68, 0, 0)}
    wind = over(plus(base, {"hips": {"r": (0, 0, -10), "t": (0, 0.02, -0.01)}, "spine": (-4, 0, -12), "chest": (-8, 0, -20),
                            "head": (4, 0, 22)}),
                dict(sword(155, 35, 30, 75, (-10, 0, 0)), **guard))
    strike = over(plus(base, {"hips": {"r": (4, 0, 12), "t": (0, -0.06, -0.05)}, "spine": (8, 0, 12), "chest": (12, 0, 20),
                              "head": (-8, 0, -18)}),
                  dict(sword(84, 8, 0, 4, (62, 0, 0)), **guard))
    follow = over(plus(base, {"hips": {"r": (4, 0, 16), "t": (0, -0.06, -0.06)}, "spine": (10, 0, 14), "chest": (14, 0, 26),
                              "head": (-10, 0, -22)}),
                  dict(sword(55, -16, -15, 12, (55, 0, 0)), **guard))
    P.key_poses("Attack", [(0, base), (5, wind, "out"), (8, strike, "in"), (10, follow, "out"), (15, base, "smooth")])

    raise_ = over(plus(base, {"hips": {"t": (0, 0.01, -0.06)}, "spine": (-5, 0, 0), "chest": (-10, 0, 0), "neck": (-6, 0, 0),
                              "head": (-16, 0, 0)}),
                  {**sword(168, 14, 0, 8, (72, 0, 0)), "upper_arm.L": arm_r("L", 22, 48, -24), "forearm.L": (-55, 0, 0)})
    roar = plus(raise_, {"chest": (-3, 0, 0), "head": (-5, 0, 0), "upper_arm.L": arm_r("L", 0, 6)})
    P.key_poses("Cast", [(0, base), (7, raise_, "out"), (13, roar, "smooth"), (19, base, "smooth")])
    P.key_poses("Hit", H.hit_keys(base))
    P.key_poses("Death", H.death_keys(P, body, base, "back", turn=10, arms={
        "upper_arm.L": arm_r("L", 8, 28, -85), "forearm.L": (-8, 0, 0),
        "upper_arm.R": arm_r("R", 8, 66, 0), "forearm.R": (-6, 0, 0), "hand.R": H.side_r("R", (78, 0, 0))}))
    return rig, body, P


# ============================================================================ MAGE
def mage():
    L = H.scaled(H.HUMAN, 0.955, shoulder_w=0.19, hip_w=0.088, arm_out=0.04)
    rig = H.build_rig(L)
    P = H.Poser(rig, L)
    b = G.MeshBuilder()

    skin = PT.mat("Mag_Skin", "#eab894", 0.6)
    hair = PT.mat("Mag_Hair", "#8b5a33", 0.9)
    blue = PT.mat("Mag_Robe", "#2e6fd8", 0.75)
    dblue = PT.mat("Mag_RobeDark", "#1b3f8c", 0.85)
    purple = PT.mat("Mag_Mantle", "#6a3fa6", 0.75)
    hatm = PT.mat("Mag_Hat", "#274a9e", 0.75)
    gold = PT.mat("Mag_Gold", "#e8b54a", 0.35, 0.55)
    leather = PT.mat("Mag_Leather", "#5e3b24", 0.8)
    shoe = PT.mat("Mag_Shoe", "#3a2a22", 0.85)
    wood = PT.mat("Mag_Wood", "#6b4428", 0.85)
    gem = PT.mat("Mag_Gem", "#7fe8ff", 0.2, 0.0, emit="#58d6ff", strength=5.0)
    white = PT.mat("Mag_EyeWhite", "#f2ede4", 0.5)
    dark = PT.mat("Mag_EyeDark", "#1d2a44", 0.5)
    lips = PT.mat("Mag_Mouth", "#b8675c", 0.7)

    st = H.stance(drop=0.02, width=1.3, feet=(0.04, -0.03), toe_out=10, spine=(1, 0, 0), chest=(-1, 0, 0),
                  arms={"L": dict(fwd=6, out=9, twist=0, elbow=22, hand=(0, 0, 0)),
                        "R": dict(fwd=8, out=10, twist=6, elbow=82, hand=(0, 0, 0))})
    base = H.idle_spec(P, 0, st)
    zh, zp, zs, zc, zn = L["hip"], L["pelvis"], L["spine"], L["chest"], L["neck"]

    # ---- legs (mostly hidden by the robe) + shoes
    PT.limb_pair(b, P, "thigh", [0.078, 0.07, 0.056], dblue, ext0=0.03)
    PT.limb_pair(b, P, "shin", [0.055, 0.056, 0.045], dblue, ext1=-0.08)
    for s in "LR":
        PT.boot(b, P, s, shoe, sole=leather, w=0.05, h=0.09, toe=0.18, shaft_top=0.17, shaft_r=0.052)
    # ---- robe: waist part (hips) + split skirt (thighs) + inner lining
    b.add(G.loft([(0, 0.0, zh - 0.06, 0.175, 0.14), (0, 0.0, zp + 0.02, 0.168, 0.125), (0, 0.0, zs + 0.03, 0.158, 0.115)], 10),
          blue, "hips")
    PT.skirt(b, P, [(zh + 0.02, 0.178, 0.142), (zh - 0.26, 0.222, 0.178), (zh - 0.52, 0.262, 0.212), (0.13, 0.292, 0.242)],
             blue, n=6, hem=gold, trim=gold, inner=dblue, inner_to=0.45)
    b.add(G.loft([(0, 0.0, zp - 0.02, 0.172, 0.128), (0, 0.0, zp + 0.035, 0.17, 0.127)], 10), leather, "hips")
    b.add(G.box((0, -0.13, zp + 0.008), 0.028, 0.01, 0.026), gold, "hips")
    b.add(G.xform(G.box((0, 0, 0), 0.05, 0.028, 0.06), G.T(0.15, -0.06, zp - 0.07) @ G.R(0, 0, 25)), leather, "hips")
    b.add(G.xform(G.box((0, 0, 0), 0.052, 0.03, 0.012), G.T(0.15, -0.06, zp - 0.012) @ G.R(0, 0, 25)), gold, "hips")
    # ---- torso
    b.add(G.loft([(0, 0.0, zs - 0.03, 0.156, 0.113), (0, 0.0, zc + 0.03, 0.165, 0.12)], 10), blue, "spine")
    b.add(G.loft([(0, 0.0, zc - 0.03, 0.168, 0.124), (0, -0.004, zc + 0.12, 0.192, 0.134), (0, 0.0, zn - 0.03, 0.182, 0.124),
                  (0, 0.008, zn + 0.035, 0.1, 0.082)], 10), blue, "chest")
    for bone, z0, z1 in (("hips", zh - 0.06, zs + 0.03), ("spine", zs - 0.03, zc + 0.03), ("chest", zc - 0.03, zc + 0.14)):
        yy = -0.128 if bone != "chest" else -0.13
        b.add(G.box((0, yy, (z0 + z1) / 2), 0.016, 0.008, (z1 - z0) / 2), gold, bone)
    # mantle (shoulder cape) + gold edge + collar
    b.add(G.loft([(0, 0.012, zn + 0.07, 0.095, 0.088), (0, 0.012, zn - 0.02, 0.252, 0.168), (0, 0.014, zn - 0.13, 0.292, 0.196)],
                 12, cap0=False, cap1=False), purple, "chest")
    b.add(G.loft([(0, 0.014, zn - 0.145, 0.298, 0.202), (0, 0.014, zn - 0.12, 0.294, 0.199)], 12, cap0=False, cap1=False),
          gold, "chest")
    b.add(G.loft([(0, 0.01, zn + 0.05, 0.1, 0.092), (0, 0.01, zn + 0.1, 0.085, 0.08)], 10, cap0=False, cap1=False), purple, "chest")
    b.add(G.ellipsoid((0, -0.1, zn + 0.02), (0.03, 0.014, 0.03), 6, 4), gem, "chest")
    PT.neck(b, P, skin, r=0.046)
    # ---- arms: sleeves, bell cuffs, hands
    for s in "LR":
        PT.limb(b, P, f"upper_arm.{s}", [0.056, 0.053, 0.05], blue, ext1=0.02)
        PT.ball(b, P, f"upper_arm.{s}", 0.0, 0.054, blue, rings=4)
        PT.bell_sleeve(b, P, s, blue, r0=0.052, r1=0.09, ext=0.02, trim=gold)
        PT.fist(b, P, s, skin, size=0.95)
    # ---- head: young face, long auburn hair
    F = PT.human_head(b, P, skin, r=(0.1, 0.11, 0.125))
    PT.eyes(b, F, white, dark)
    PT.brows(b, F, hair, tilt=-4, bushy=0.95)
    PT.nose(b, F, skin, length=0.026)
    PT.ears(b, F, skin, size=0.95)
    PT.mouth(b, F, lips, w=0.018, dz=-0.066, h=0.0035)
    b.add(G.shell(F.c + Vector((0, 0.006, 0.004)), (0.11, 0.12, 0.134), 10, 6, phi0=math.pi * 0.25, phi1=math.pi * 0.62,
                  keep=lambda d: d.y > -0.35), hair, "head")
    b.add(G.loft([(0, F.c.y + 0.07, F.c.z - 0.24, 0.1, 0.035), (0, F.c.y + 0.075, F.c.z - 0.1, 0.108, 0.05),
                  (0, F.c.y + 0.06, F.c.z + 0.02, 0.1, 0.07)], 8), hair, "head")
    for sx in (1, -1):
        b.add(G.loft([(sx * 0.093, F.c.y - 0.01, F.c.z - 0.13, 0.022, 0.03), (sx * 0.1, F.c.y - 0.005, F.c.z + 0.03, 0.022, 0.045)], 6),
              hair, "head")
    # ---- pointed hat with a crooked tip (not used for ground contact)
    zb = F.c.z + 0.058
    b.add(G.loft([(0, 0.004, zb - 0.012, 0.25, 0.25), (0, 0.004, zb + 0.004, 0.245, 0.245), (0, 0.004, zb + 0.016, 0.16, 0.162)],
                 14), hatm, "head", ground=False)
    b.add(G.loft([(0, 0.004, zb, 0.132, 0.137), (0, 0.014, zb + 0.09, 0.104, 0.106), (0, 0.034, zb + 0.17, 0.072, 0.073),
                  (0, 0.07, zb + 0.228, 0.045, 0.046), (0, 0.12, zb + 0.258, 0.024, 0.024), (0, 0.175, zb + 0.252, 0, 0)], 10),
          hatm, "head", ground=False)
    b.add(G.loft([(0, 0.004, zb + 0.008, 0.137, 0.142), (0, 0.006, zb + 0.042, 0.124, 0.128)], 10, cap0=False, cap1=False),
          gold, "head", ground=False)
    b.add(G.xform(G.box((0, 0, 0), 0.022, 0.006, 0.022), G.T(0, -0.13, zb + 0.026) @ G.R(0, 45, 0)), gem, "head", ground=False)

    # ---- staff: authored upright in the idle pose, then mapped back to the bind pose
    M = P.to_rest("hand.R", base)
    fp = P.delta("hand.R") @ PT.fist_centre(P, "R")
    top = fp.z + 0.78
    ax = Vector((fp.x, fp.y, 0))
    staff = [
        (G.tube(ax + Vector((0, 0, 0.05)), ax + Vector((0, 0, top)), 0.019, 0.021, n=6), wood),
        (G.tube(ax + Vector((0, 0, 0.03)), ax + Vector((0, 0, 0.07)), 0.022, 0.024, n=6), gold),
        (G.tube(ax + Vector((0, 0, top - 0.03)), ax + Vector((0, 0, top + 0.01)), 0.027, 0.027, n=6), gold),
        (G.tube(ax + Vector((0, 0, fp.z + 0.06)), ax + Vector((0, 0, fp.z + 0.1)), 0.024, 0.024, n=6), leather),
        (G.ellipsoid(ax + Vector((0, 0, top + 0.12)), (0.042, 0.042, 0.068), 4, 2), gem),
    ]
    for k in range(3):
        a = math.radians(90 + 120 * k)
        dv = Vector((math.cos(a), math.sin(a), 0))
        pts = [ax + Vector((0, 0, top)), ax + dv * 0.045 + Vector((0, 0, top + 0.05)),
               ax + dv * 0.062 + Vector((0, 0, top + 0.12)), ax + dv * 0.02 + Vector((0, 0, top + 0.2))]
        staff.append((G.sweep(pts, [0.014, 0.012, 0.009, 0.0], n=5, normal=(0, 0, 1)), wood))
    for geo_, m_ in staff:
        b.add(geo_, m_, "hand.R", M=M, ground=False)

    body = b.build("mage", rig)
    print(f"[mage] triangles ~{b.tri_count()} {b.breakdown()}")

    # ---- animation
    g = H.gait(stride=0.72, arms={"L": dict(swing=0.9, elbow=60),
                                  "R": dict(swing=0.3, fwd=8, elbow=82, out=10, twist=6)})
    P.key_loop("Idle", 48, lambda t: H.idle_spec(P, t, st))
    P.key_loop("Walk", g["frames"], lambda p: H.gait_spec(P, p, g, st))

    def staff_arm(fwd, out, twist, elbow, wrist):
        return {"upper_arm.R": arm_r("R", fwd, out, twist), "forearm.R": (-elbow, 0, 0), "hand.R": (wrist, 0, 0)}

    wind = over(plus(base, {"hips": {"r": (0, 0, -8), "t": (0, 0.02, -0.01)}, "spine": (-4, 0, -10), "chest": (-6, 0, -18),
                            "head": (2, 0, 18)}),
                {**staff_arm(125, 22, 20, 45, 20), "upper_arm.L": arm_r("L", 35, 25), "forearm.L": (-45, 0, 0)})
    strike = over(plus(base, {"hips": {"r": (4, 0, 10), "t": (0, -0.05, -0.04)}, "spine": (8, 0, 10), "chest": (10, 0, 18),
                              "head": (-8, 0, -16)}),
                  {**staff_arm(80, 10, 0, 5, 30), "upper_arm.L": arm_r("L", -15, 20), "forearm.L": (-30, 0, 0)})
    follow = over(plus(base, {"hips": {"r": (4, 0, 14), "t": (0, -0.05, -0.05)}, "spine": (9, 0, 12), "chest": (12, 0, 22),
                              "head": (-9, 0, -20)}),
                  {**staff_arm(64, -8, -10, 8, 36), "upper_arm.L": arm_r("L", -20, 22), "forearm.L": (-30, 0, 0)})
    P.key_poses("Attack", [(0, base), (5, wind, "out"), (8, strike, "in"), (10, follow, "out"), (15, base, "smooth")])

    gather = over(plus(base, {"hips": {"t": (0, 0.015, -0.03)}, "spine": (-3, 0, 0), "chest": (-8, 0, 4), "neck": (-2, 0, 0),
                              "head": (-8, 0, 0)}),
                  {**staff_arm(150, 16, 0, 18, 76), "upper_arm.L": arm_r("L", 40, 30, -20), "forearm.L": (-95, 0, 0),
                   "hand.L": (-10, 0, 0)})
    release = over(plus(base, {"hips": {"r": (3, 0, 0), "t": (0, -0.05, -0.04)}, "spine": (6, 0, 0), "chest": (8, 0, -4),
                               "head": (-6, 0, 0)}),
                   {**staff_arm(98, 12, 0, 6, 52), "upper_arm.L": arm_r("L", 82, 12, 0), "forearm.L": (-8, 0, 0),
                    "hand.L": (60, 0, 0)})
    hold = plus(release, {"chest": (2, 0, 0), "upper_arm.L": arm_r("L", 4, 0)})
    P.key_poses("Cast", [(0, base), (7, gather, "out"), (11, release, "in"), (14, hold, "smooth"), (19, base, "smooth")])
    P.key_poses("Hit", H.hit_keys(base))
    P.key_poses("Death", H.death_keys(P, body, base, "back", turn=-12, exclude=b.no_ground, arms={
        "upper_arm.R": arm_r("R", 70, 50, 0), "forearm.R": (-20, 0, 0), "hand.R": (0, 0, 0)}))
    return rig, body, P


# ============================================================================ RANGER
def ranger():
    L = dict(H.HUMAN, shoulder_w=0.2, hip_w=0.092)
    rig = H.build_rig(L)
    P = H.Poser(rig, L)
    b = G.MeshBuilder()

    skin = PT.mat("Ran_Skin", "#e0a47c", 0.6)
    hair = PT.mat("Ran_Hair", "#6b4424", 0.9)
    green = PT.mat("Ran_Green", "#2e9e4f", 0.8)
    dgreen = PT.mat("Ran_GreenDark", "#1d6a36", 0.85)
    tunic = PT.mat("Ran_Tunic", "#3f7d3a", 0.8)
    leather = PT.mat("Ran_Leather", "#7a5230", 0.7)
    dleather = PT.mat("Ran_LeatherDark", "#4a3020", 0.8)
    trousers = PT.mat("Ran_Trousers", "#4d4638", 0.85)
    brass = PT.mat("Ran_Brass", "#c99b46", 0.35, 0.5)
    wood = PT.mat("Ran_BowWood", "#94602f", 0.6)
    string = PT.mat("Ran_String", "#ece4cc", 0.6)
    fletch = PT.mat("Ran_Fletch", "#c9402f", 0.7)
    steel = PT.mat("Ran_Steel", "#aab2bc", 0.35, 0.5)
    white = PT.mat("Ran_EyeWhite", "#f2ede4", 0.5)
    dark = PT.mat("Ran_EyeDark", "#243018", 0.5)
    lips = PT.mat("Ran_Mouth", "#a45a4c", 0.7)
    zh, zp, zs, zc, zn = L["hip"], L["pelvis"], L["spine"], L["chest"], L["neck"]

    # ---- legs + tall boots with folded cuffs
    PT.limb_pair(b, P, "thigh", [0.086, 0.079, 0.061], trousers, ext0=0.04, ext1=0.02)
    PT.limb_pair(b, P, "shin", [0.06, 0.061, 0.05], trousers, ext1=-0.1)
    for s in "LR":
        PT.boot(b, P, s, leather, sole=dleather, w=0.053, h=0.1, toe=0.2, shaft_top=0.36, shaft_r=0.063,
                cuff=dleather, cuff_r=0.074)
    # ---- short split tunic skirt + hips
    b.add(G.loft([(0, 0.0, zh - 0.07, 0.16, 0.125), (0, 0.0, zp + 0.02, 0.165, 0.12), (0, 0.0, zs + 0.03, 0.155, 0.112)], 10),
          tunic, "hips")
    PT.skirt(b, P, [(zh + 0.02, 0.17, 0.132), (zh - 0.12, 0.19, 0.15), (zh - 0.22, 0.2, 0.16)], tunic, n=5, hem=dgreen,
             hem_h=0.03)
    b.add(G.loft([(0, 0.0, zp - 0.025, 0.172, 0.13), (0, 0.0, zp + 0.03, 0.172, 0.13)], 10), dleather, "hips")
    b.add(G.box((0, -0.134, zp + 0.003), 0.03, 0.01, 0.026), brass, "hips")
    b.add(G.xform(G.box((0, 0, 0), 0.045, 0.03, 0.05), G.T(-0.15, -0.07, zp - 0.05) @ G.R(0, 0, -25)), leather, "hips")
    b.add(G.xform(G.box((0, 0, 0), 0.047, 0.032, 0.012), G.T(-0.15, -0.07, zp - 0.004) @ G.R(0, 0, -25)), dleather, "hips")
    b.add(G.xform(G.box((0, 0, 0), 0.018, 0.028, 0.11), G.T(0.165, 0.02, zp - 0.1) @ G.R(12, 0, 0)), dleather, "hips")
    b.add(G.xform(G.box((0, 0, 0), 0.03, 0.012, 0.012), G.T(0.165, 0.02, zp + 0.012) @ G.R(12, 0, 0)), brass, "hips")
    # ---- torso: tunic + leather jerkin + strap
    b.add(G.loft([(0, 0.0, zs - 0.03, 0.155, 0.112), (0, 0.0, zc + 0.03, 0.165, 0.12)], 10), tunic, "spine")
    b.add(G.loft([(0, 0.0, zs - 0.01, 0.16, 0.117), (0, 0.0, zc + 0.03, 0.17, 0.125)], shape="chamfer"),
          leather, "spine")
    b.add(G.loft([(0, 0.0, zc - 0.03, 0.172, 0.127), (0, -0.004, zc + 0.12, 0.2, 0.138), (0, 0.0, zn - 0.03, 0.19, 0.128),
                  (0, 0.008, zn + 0.035, 0.105, 0.084)], shape="chamfer"), leather, "chest")
    b.add(G.loft([(0, -0.118, zc + 0.02, 0.012, 0.012), (0, -0.136, zn - 0.02, 0.05, 0.012)], shape="rect"), tunic, "chest")
    strap = [(0.12, -0.145, zn - 0.16), (0.02, -0.146, zc + 0.07), (-0.08, -0.14, zc + 0.0), (-0.165, -0.1, zs + 0.06)]
    b.add(G.sweep(strap, [(0.006, 0.02)] * 4, n=4, normal=(0, -1, 0)), dleather, "chest")
    b.add(G.box((0.02, -0.15, zc + 0.07), 0.014, 0.006, 0.014), brass, "chest")
    PT.neck(b, P, skin, r=0.048)
    # ---- arms: green sleeves, leather bracers, bare hands
    for s in "LR":
        PT.limb(b, P, f"upper_arm.{s}", [0.058, 0.055, 0.05], tunic, ext1=0.02)
        PT.ball(b, P, f"upper_arm.{s}", 0.0, 0.062, tunic, rings=4)
        PT.limb(b, P, f"forearm.{s}", [0.05, 0.05, 0.043], tunic, ext0=-0.01, ext1=-0.02)
        h0, t0 = P.head[f"forearm.{s}"], P.tail[f"forearm.{s}"]
        b.add(G.sweep([h0.lerp(t0, 0.35), h0.lerp(t0, 0.97)], [(0.055, 0.057), (0.05, 0.052)], n=8, normal=(1, 0, 0)),
              leather, f"forearm.{s}")
        PT.fist(b, P, s, skin, size=1.0)
    # ---- head + hood + mantle
    F = PT.human_head(b, P, skin, r=(0.102, 0.112, 0.128))
    PT.eyes(b, F, white, dark)
    PT.brows(b, F, hair, tilt=-2, bushy=1.0)
    PT.nose(b, F, skin, length=0.028)
    PT.mouth(b, F, lips, w=0.02, dz=-0.066, h=0.0035)
    b.add(G.shell(F.c + Vector((0, 0.004, 0.02)), (0.11, 0.12, 0.13), 10, 5, phi0=math.pi * 0.52, phi1=math.pi * 0.8,
                  keep=lambda d: d.y < 0.0), hair, "head")
    hood_c = F.c + Vector((0, 0.014, 0.012))
    hood = G.shell(hood_c, (0.132, 0.142, 0.15), 12, 8, phi0=math.pi * 0.14, phi1=math.pi,
                   keep=lambda d: not (d.y < -0.2 and -0.8 < d.z < 0.62))

    def peak(v):  # pull the top-back of the hood into a soft point
        d = v - hood_c
        k = max(0.0, d.z / 0.15) * max(0.0, (d.y + 0.03) / 0.142)
        return v + Vector((0, 0.07, 0.045)) * k ** 1.5

    b.add(G.deform(hood, peak), green, "head")
    b.add(G.sweep([hood_c + Vector((0, 0.1, 0.07)), hood_c + Vector((0, 0.16, 0.0)), hood_c + Vector((0, 0.2, -0.1))],
                  [(0.05, 0.06), (0.03, 0.035), (0.0, 0.0)], n=6, normal=(1, 0, 0)), green, "head")
    b.add(G.loft([(0, 0.004, zn + 0.075, 0.11, 0.1), (0, 0.004, zn - 0.02, 0.245, 0.182), (0, 0.006, zn - 0.15, 0.292, 0.218)],
                 12, cap0=False, cap1=False), green, "chest")
    b.add(G.loft([(0, 0.006, zn - 0.165, 0.298, 0.224), (0, 0.006, zn - 0.14, 0.293, 0.22)], 12, cap0=False, cap1=False),
          dgreen, "chest")
    b.add(G.ellipsoid((0.0, -0.11, zn + 0.02), (0.022, 0.012, 0.022), 6, 3), brass, "chest")
    # ---- quiver on the back (opening over the right shoulder) with arrows
    q0, q1 = Vector((0.1, 0.235, zs + 0.02)), Vector((-0.1, 0.245, zn + 0.04))
    b.add(G.tube(q0, q1, 0.058, 0.064, n=8), leather, "chest")
    b.add(G.tube(q1 - (q1 - q0).normalized() * 0.03, q1 + (q1 - q0).normalized() * 0.005, 0.068, 0.068, n=8, cap0=False),
          dleather, "chest")
    b.add(G.tube(q0 - (q1 - q0).normalized() * 0.005, q0 + (q1 - q0).normalized() * 0.03, 0.062, 0.062, n=8), dleather, "chest")
    qd = (q1 - q0).normalized()
    side = qd.cross(Vector((0, 1, 0))).normalized()
    for i, (du, dv) in enumerate(((0.0, 0.0), (0.025, 0.018), (-0.025, 0.015), (0.012, -0.024), (-0.018, -0.02))):
        a0 = q1 + side * du + Vector((0, dv, 0)) - qd * 0.05
        a1 = a0 + qd * (0.13 + 0.02 * (i % 2))
        b.add(G.tube(a0, a1, 0.006, 0.006, n=4), wood, "chest")
        for k in range(3):
            ang = math.radians(120 * k + 20 * i)
            off = side * math.cos(ang) * 0.016 + Vector((0, math.sin(ang) * 0.016, 0))
            b.add(G.tube(a1 - qd * 0.075 + off * 0.3, a1 - qd * 0.01 + off, 0.004, 0.004, n=3), fletch if k else string, "chest")
    b.add(G.sweep([(0.13, 0.215, zn - 0.17), (0.12, 0.225, zc + 0.04), (0.1, 0.24, zs + 0.06)], [(0.006, 0.02)] * 3, n=4,
                  normal=(0, 1, 0)), dleather, "chest")

    # ---- bow in the LEFT hand: axis along Y at rest (vertical once the forearm points forward),
    #      back of the bow towards -Z (the target side when aiming), string towards +Z (the archer)
    fc = PT.fist_centre(P, "L")
    pts, rad = [], []
    for i in range(13):
        u = -1 + 2 * i / 12
        z = 0.1 * u * u - (0.03 * max(0.0, abs(u) - 0.82) / 0.18)
        pts.append(fc + Vector((0, 0.62 * u, z)))
        w = 0.021 if abs(u) < 0.12 else 0.018 - 0.008 * abs(u)
        rad.append((w, w * 0.62))
    b.add(G.sweep(pts, rad, n=6, normal=(1, 0, 0)), wood, "hand.L", ground=False)
    b.add(G.tube(fc + Vector((0, -0.07, 0.002)), fc + Vector((0, 0.07, 0.002)), 0.024, 0.024, n=6), dleather, "hand.L",
          ground=False)
    b.add(G.tube(pts[0] + Vector((0, 0.01, 0.012)), pts[-1] + Vector((0, -0.01, 0.012)), 0.0035, 0.0035, n=3), string, "hand.L",
          ground=False)
    # ---- arrow in the RIGHT hand, along the hand bone (points down when the arm hangs)
    fr = PT.fist_centre(P, "R")
    b.add(G.tube(fr + Vector((0, 0, 0.035)), fr + Vector((0, 0, -0.62)), 0.0065, 0.0065, n=4), wood, "hand.R", ground=False)
    b.add(G.tube(fr + Vector((0, 0, -0.62)), fr + Vector((0, 0, -0.68)), 0.014, 0.0, n=4), steel, "hand.R", ground=False)
    for k in range(3):
        ang = math.radians(120 * k)
        off = Vector((math.cos(ang), math.sin(ang), 0)) * 0.017
        b.add(G.tube(fr + Vector((0, 0, 0.025)) + off * 0.3, fr + Vector((0, 0, -0.06)) + off, 0.004, 0.004, n=3),
              fletch, "hand.R", ground=False)

    body = b.build("ranger", rig)
    print(f"[ranger] triangles ~{b.tri_count()} {b.breakdown()}")

    # ---- animation
    st = H.stance(drop=0.025, width=1.4, feet=(0.05, -0.05), toe_out=10, spine=(2, 0, 0), chest=(-1, 0, 0),
                  arms={"L": dict(fwd=6, out=13, twist=24, elbow=48, hand=(0, 0, 0)),
                        "R": dict(fwd=3, out=10, twist=0, elbow=12, hand=(0, 0, 0))})
    g = H.gait(stride=0.8, arms={"L": dict(swing=0.45, fwd=6, elbow=55, twist=18, out=12),
                                 "R": dict(swing=1.0, elbow=45)})
    P.key_loop("Idle", 48, lambda t: H.idle_spec(P, t, st))
    P.key_loop("Walk", g["frames"], lambda p: H.gait_spec(P, p, g, st))
    base = H.idle_spec(P, 0, st)
    hand_len = P.length("hand.R")

    def draw(aim=0.0, twist=-26.0, depth=1.0, lean=0.0, release=0.0):
        """Bow drawn towards the front: bow arm straight at the aim line, right hand anchored at the cheek
        (depth < 1 = partially drawn), arrow pointing from the anchor to the bow grip."""
        sp = plus(base, {"hips": {"r": (lean * 0.3, 0, twist * 0.3), "t": (0, 0.0, -0.02)}, "spine": (lean * 0.4, 0, twist * 0.3),
                         "chest": (-aim * 0.3 + lean * 0.3, 0, twist * 0.4), "neck": (-aim * 0.2, 0, -twist * 0.4),
                         "head": (-aim * 0.35, -4, -twist * 0.5)})
        P.solve(sp)
        sh = P.pos["upper_arm.L"]
        a = math.radians(aim)
        aimv = Vector((0, -math.cos(a), math.sin(a)))
        sp["IK"]["arm.L"] = {"t": sh + aimv * 0.6 + Vector((-0.07, 0, 0)), "pole": (1, 0.4, -0.6)}
        sp["hand.L"] = {"a": (-90 - aim, -8, 0)}
        P.solve(sp)
        grip = P.point("hand.L", 0.5)
        head = P.pos["head"]
        anchor = head + Vector((-0.07, -0.07, 0.03))
        string_pt = grip + (anchor - grip).normalized() * 0.16
        anchor = string_pt.lerp(anchor, depth) + Vector((-0.02, 0.09, -0.02)) * release
        d = (grip - anchor).normalized()
        q = Vector((0, 0, -1)).rotation_difference(d)
        sp["IK"]["arm.R"] = {"t": anchor - d * hand_len * 0.5, "pole": (-1, 1.2, 0.1)}
        sp["hand.R"] = {"q": tuple(q)}
        return sp

    P.key_poses("Attack", [(0, base), (4, draw(2, -18, 0.25), "out"), (8, draw(3, -26, 1.0), "smooth"),
                           (10, draw(3, -27, 1.0, release=1.0), "in"), (15, base, "smooth")])
    P.key_poses("Cast", [(0, base), (5, draw(6, -20, 0.3), "out"), (11, draw(8, -28, 1.0, lean=-3), "smooth"),
                         (13, draw(8, -29, 1.03, lean=-3), "lin"), (15, draw(8, -30, 1.0, lean=-4, release=1.3), "in"),
                         (19, base, "smooth")])
    P.key_poses("Hit", H.hit_keys(base))
    P.key_poses("Death", H.death_keys(P, body, base, "fwd", turn=14, exclude=b.no_ground, arms={
        "upper_arm.L": arm_r("L", 150, 40, 90), "forearm.L": (-20, 0, 0), "hand.L": (0, 0, 0),
        "upper_arm.R": arm_r("R", 20, 30, 0), "forearm.R": (-40, 0, 0)}))
    return rig, body, P
