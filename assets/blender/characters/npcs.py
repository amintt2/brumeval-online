"""Village NPCs: Ancien Aldric (npc_elder) and Marchande Élise (npc_merchant). Clips: Idle, Walk."""
import math
import random

from mathutils import Vector

import geo as G
import humanoid as H
import parts as PT


# ============================================================================ ELDER
def elder():
    L = H.scaled(H.HUMAN, 0.97, shoulder_w=0.19, hip_w=0.09, arm_out=0.04)
    rig = H.build_rig(L)
    P = H.Poser(rig, L)
    b = G.MeshBuilder()

    skin = PT.mat("Eld_Skin", "#e2a98c", 0.65)
    white = PT.mat("Eld_White", "#efeeea", 0.9)
    robe = PT.mat("Eld_Robe", "#74502f", 0.85)
    drobe = PT.mat("Eld_RobeDark", "#4b3120", 0.9)
    rope = PT.mat("Eld_Rope", "#d1b87f", 0.9)
    wood = PT.mat("Eld_Wood", "#6f4d31", 0.85)
    dwood = PT.mat("Eld_WoodDark", "#4a3220", 0.85)
    shoe = PT.mat("Eld_Shoe", "#3b2a20", 0.9)
    scroll = PT.mat("Eld_Scroll", "#efe2bf", 0.8)
    ribbon = PT.mat("Eld_Ribbon", "#b8342c", 0.7)
    gem = PT.mat("Eld_Gem", "#6ee08c", 0.3, 0.0, emit="#3fd070", strength=2.5)
    gold = PT.mat("Eld_Gold", "#e0ae48", 0.35, 0.55)
    eyew = PT.mat("Eld_EyeWhite", "#efe9df", 0.5)
    eyed = PT.mat("Eld_EyeDark", "#2a3a4a", 0.5)
    zh, zp, zs, zc, zn = L["hip"], L["pelvis"], L["spine"], L["chest"], L["neck"]

    st = H.stance(drop=0.035, width=1.25, feet=(0.03, -0.03), toe_out=12, hips=(2, 0, 0), spine=(9, 0, 0), chest=(8, 0, 0),
                  neck=(-7, 0, 0), head=(-9, 0, 0), sway=0.008, look=4.5, breathe=1.2,
                  arms={"L": dict(fwd=16, out=7, twist=-22, elbow=58),
                        "R": dict(fwd=22, out=12, twist=10, elbow=58)})
    base = H.idle_spec(P, 0, st)

    # ---- legs + shoes
    PT.limb_pair(b, P, "thigh", [0.078, 0.07, 0.056], drobe, ext0=0.03)
    PT.limb_pair(b, P, "shin", [0.054, 0.055, 0.045], drobe, ext1=-0.08)
    for s in "LR":
        PT.boot(b, P, s, shoe, sole=dwood, w=0.05, h=0.088, toe=0.18, shaft_top=0.14, shaft_r=0.05)
    # ---- long robe
    b.add(G.loft([(0, 0.0, zh - 0.06, 0.178, 0.142), (0, 0.0, zp + 0.02, 0.17, 0.13), (0, 0.0, zs + 0.03, 0.162, 0.12)], 10),
          robe, "hips")
    PT.skirt(b, P, [(zh + 0.02, 0.18, 0.145), (zh - 0.28, 0.222, 0.182), (zh - 0.56, 0.258, 0.214), (0.09, 0.28, 0.236)],
             robe, n=6, hem=drobe, hem_h=0.05, inner=drobe, inner_to=0.45)
    b.add(G.loft([(0, 0.0, zs - 0.03, 0.162, 0.12), (0, 0.0, zc + 0.03, 0.17, 0.126)], 10), robe, "spine")
    b.add(G.loft([(0, 0.0, zc - 0.03, 0.172, 0.128), (0, -0.004, zc + 0.12, 0.19, 0.136), (0, 0.0, zn - 0.03, 0.18, 0.126),
                  (0, 0.008, zn + 0.035, 0.098, 0.082)], 10), robe, "chest")
    # robe overlap line
    b.add(G.box((0.035, -0.132, (zc + zn) / 2), 0.012, 0.006, (zn - zc) / 2), drobe, "chest")
    b.add(G.box((0.035, -0.127, (zs + zc) / 2 + 0.015), 0.012, 0.006, (zc - zs) / 2 + 0.03), drobe, "spine")
    # hood lying on the back + collar
    b.add(G.ellipsoid((0, 0.1, zn - 0.03), (0.15, 0.08, 0.11), 10, 5), robe, "chest")
    b.add(G.loft([(0, 0.01, zn + 0.0, 0.11, 0.098), (0, 0.01, zn + 0.06, 0.1, 0.09)], 10, cap0=False, cap1=False), drobe, "chest")
    # rope belt with hanging ends, scroll, amulet
    b.add(G.loft([(0, 0.0, zp - 0.005, 0.176, 0.136), (0, 0.0, zp + 0.025, 0.176, 0.136)], 10), rope, "hips")
    for i, (x0, ln) in enumerate(((0.07, 0.26), (0.1, 0.2))):
        pts = [Vector((x0, -0.13, zp)), Vector((x0 + 0.01, -0.145, zp - ln * 0.5)), Vector((x0 + 0.005, -0.15, zp - ln))]
        b.add(G.sweep(pts, [0.011, 0.01, 0.009], n=5, normal=(1, 0, 0)), rope, "hips")
        b.add(G.ellipsoid(pts[-1] + Vector((0, 0, -0.01)), 0.018, 6, 3), rope, "hips")
    sc0 = Vector((-0.16, -0.07, zp - 0.03))
    b.add(G.tube(sc0 + Vector((0.0, 0, -0.1)), sc0 + Vector((-0.012, 0, 0.1)), 0.026, 0.026, n=7), scroll, "hips")
    b.add(G.tube(sc0 + Vector((-0.001, 0, -0.012)), sc0 + Vector((-0.002, 0, 0.012)), 0.029, 0.029, n=7), ribbon, "hips")
    b.add(G.ellipsoid((0.0, -0.137, zc + 0.04), (0.03, 0.012, 0.036), 6, 3), gold, "chest")
    b.add(G.ellipsoid((0.0, -0.147, zc + 0.04), (0.017, 0.008, 0.02), 4, 2), gem, "chest")
    PT.neck(b, P, skin, r=0.045)
    # ---- arms
    for s in "LR":
        PT.limb(b, P, f"upper_arm.{s}", [0.056, 0.053, 0.05], robe, ext1=0.02)
        PT.ball(b, P, f"upper_arm.{s}", 0.0, 0.06, robe, rings=4)
        PT.bell_sleeve(b, P, s, robe, r0=0.052, r1=0.088, ext=0.015, trim=drobe)
        PT.fist(b, P, s, skin, size=0.95)
    # ---- head: bald crown, white fringe, bushy brows, big nose, long beard + moustache
    F = PT.human_head(b, P, skin, r=(0.102, 0.112, 0.128))
    PT.eyes(b, F, eyew, eyed, size=0.9)
    PT.brows(b, F, white, tilt=-14, bushy=1.55, dz=0.034)
    PT.nose(b, F, skin, length=0.042, width=0.021, droop=0.5)
    PT.ears(b, F, skin, size=1.15)
    b.add(G.shell(F.c + Vector((0, 0.008, 0.0)), (0.112, 0.122, 0.136), 12, 7, phi0=math.pi * 0.3, phi1=math.pi * 0.62,
                  keep=lambda d: d.y > -0.3), white, "head")
    b.add(G.shell(F.c + Vector((0, -0.006, -0.006)), (0.112, 0.122, 0.134), 10, 6, phi0=0.0, phi1=math.pi * 0.38,
                  keep=lambda d: d.y < 0.3), white, "head")
    c = F.c
    beard = [(0, c.y - 0.06, c.z - 0.06, 0.092, 0.07), (0, c.y - 0.1, c.z - 0.14, 0.088, 0.062),
             (0, c.y - 0.13, c.z - 0.24, 0.072, 0.046), (0, c.y - 0.145, c.z - 0.34, 0.05, 0.032), (0, c.y - 0.15, c.z - 0.45, 0, 0)]
    b.add(G.loft(beard, 8), white, "head")
    for sx in (1, -1):
        m0 = F.surf(sx * 0.012, c.z - 0.045, inset=-0.004)
        pts = [m0, m0 + Vector((sx * 0.03, -0.004, -0.012)), m0 + Vector((sx * 0.052, 0.004, -0.05))]
        b.add(G.sweep(pts, [0.015, 0.013, 0.004], n=5, normal=(0, -1, 0)), white, "head")

    # ---- gnarled walking stick: authored upright, planted on the ground, in the idle pose
    M = P.to_rest("hand.R", base)
    fp = P.delta("hand.R") @ PT.fist_centre(P, "R")
    rnd = random.Random(7)
    pts, rad = [], []
    for i in range(8):
        z = (fp.z + 0.13) * i / 7
        j = 0.0 if i in (0, 7) else 0.012
        pts.append(Vector((fp.x + rnd.uniform(-j, j), fp.y + rnd.uniform(-j, j), z)))
        rad.append(0.017 + 0.005 * i / 7)
    b.add(G.sweep(pts, rad, n=6, normal=(1, 0, 0)), wood, "hand.R", M=M, ground=False)
    b.add(G.ellipsoid(pts[-1] + Vector((0, 0, 0.02)), (0.034, 0.034, 0.04), 6, 4), dwood, "hand.R", M=M, ground=False)
    b.add(G.sweep([pts[-2] + Vector((0.0, 0, 0.02)), pts[-2] + Vector((0.03, -0.02, 0.06)), pts[-2] + Vector((0.045, -0.02, 0.1))],
                  [0.009, 0.007, 0.0], n=4, normal=(0, 0, 1)), wood, "hand.R", M=M, ground=False)

    body = b.build("npc_elder", rig)
    print(f"[npc_elder] triangles ~{b.tri_count()} {b.breakdown()}")

    g = H.gait(frames=26, stride=0.4, lift=0.065, duty=0.63, drop=0.04, bob=0.012, lean=2.0, twist=4.0, sway=0.016, roll=2.0,
               arm_swing=10.0, elbow=20.0, elbow_swing=6.0, run=False, strike=8.0, toeoff=22.0, head_bob=1.0, toe_out=10.0,
               width=1.15, arms={"L": dict(swing=0.8, fwd=16, elbow=55, twist=-22, out=7),
                                 "R": dict(swing=1.2, fwd=22, elbow=58, out=12, twist=10)})
    P.key_loop("Idle", 48, lambda t: H.idle_spec(P, t, st))
    P.key_loop("Walk", g["frames"], lambda p: H.gait_spec(P, p, g, st))
    return rig, body, P


# ============================================================================ MERCHANT
def merchant():
    L = H.scaled(H.HUMAN, 0.955, shoulder_w=0.174, hip_w=0.089, arm_out=0.045)
    rig = H.build_rig(L)
    P = H.Poser(rig, L)
    b = G.MeshBuilder()

    skin = PT.mat("Mer_Skin", "#eeb894", 0.6)
    hair = PT.mat("Mer_Hair", "#4a2a18", 0.85)
    scarf = PT.mat("Mer_Scarf", "#cf4436", 0.75)
    band = PT.mat("Mer_Band", "#f2bd3c", 0.7)
    blouse = PT.mat("Mer_Blouse", "#f4eddd", 0.8)
    bodice = PT.mat("Mer_Bodice", "#1f8a86", 0.75)
    skirt = PT.mat("Mer_Skirt", "#e8962c", 0.8)
    dskirt = PT.mat("Mer_SkirtDark", "#b06a22", 0.85)
    hem = PT.mat("Mer_Hem", "#b8362a", 0.8)
    apron_m = PT.mat("Mer_Apron", "#f6eed8", 0.85)
    sash = PT.mat("Mer_Sash", "#7b3b92", 0.75)
    leather = PT.mat("Mer_Leather", "#8a5a32", 0.75)
    stock = PT.mat("Mer_Stocking", "#6b4a33", 0.85)
    shoe = PT.mat("Mer_Shoe", "#55341f", 0.8)
    gold = PT.mat("Mer_Gold", "#ecb748", 0.3, 0.6)
    lips = PT.mat("Mer_Lips", "#c2554b", 0.6)
    eyew = PT.mat("Mer_EyeWhite", "#f3eee4", 0.5)
    eyed = PT.mat("Mer_EyeDark", "#3a2412", 0.5)
    zh, zp, zs, zc, zn = L["hip"], L["pelvis"], L["spine"], L["chest"], L["neck"]

    # ---- legs (hidden by the long skirt) + shoes
    PT.limb_pair(b, P, "thigh", [0.078, 0.07, 0.055], stock, ext0=0.03)
    PT.limb_pair(b, P, "shin", [0.052, 0.053, 0.042], stock, ext1=-0.08)
    for s in "LR":
        PT.boot(b, P, s, shoe, sole=leather, w=0.046, h=0.082, toe=0.17, shaft_top=0.12, shaft_r=0.047)
    # ---- skirt, apron, waist, sash, pouch
    b.add(G.loft([(0, 0.0, zh - 0.06, 0.168, 0.135), (0, 0.0, zp + 0.02, 0.152, 0.118), (0, 0.0, zs + 0.03, 0.138, 0.106)], 10),
          skirt, "hips")
    rings = [(zh + 0.02, 0.17, 0.138), (zh - 0.26, 0.228, 0.19), (zh - 0.52, 0.272, 0.228), (0.085, 0.298, 0.25)]
    PT.skirt(b, P, rings, skirt, n=6, hem=hem, hem_h=0.055, inner=dskirt, inner_to=0.45)
    ap = [(zh + 0.0, 0.19, 0.16), (zh - 0.26, 0.25, 0.212), (0.3, 0.296, 0.254)]
    PT.apron(b, P, ap, apron_m, span=0.95)
    PT.apron(b, P, [(0.33, 0.297, 0.255), (0.295, 0.3, 0.259)], band, span=0.97, n=3)
    b.add(G.loft([(0, 0.0, zp - 0.005, 0.158, 0.124), (0, 0.0, zp + 0.045, 0.148, 0.116)], 10), sash, "hips")
    b.add(G.ellipsoid((0.11, -0.1, zp + 0.02), (0.035, 0.022, 0.03), 6, 4), sash, "hips")
    for dx, ln in ((0.1, 0.16), (0.125, 0.12)):
        b.add(G.sweep([(dx, -0.11, zp + 0.01), (dx + 0.01, -0.12, zp - ln * 0.6), (dx + 0.02, -0.118, zp - ln)],
                      [(0.02, 0.006), (0.022, 0.006), (0.024, 0.005)], n=4, normal=(1, 0, 0)), sash, "hips")
    pc = Vector((-0.165, -0.05, zp - 0.06))
    b.add(G.ellipsoid(pc, (0.045, 0.035, 0.055), 7, 4), leather, "hips")
    b.add(G.tube(pc + Vector((0, 0, 0.04)), pc + Vector((0, 0, 0.07)), 0.022, 0.03, n=6), leather, "hips")
    b.add(G.xform(G.disc((0, 0, 0), 0.018, 8, 0.005), G.T(pc + Vector((0.012, -0.012, 0.075))) @ G.R(60, 0, 20)), gold, "hips")
    # ---- bodice + blouse
    b.add(G.loft([(0, 0.0, zs - 0.03, 0.136, 0.104), (0, 0.0, zc + 0.03, 0.148, 0.112)], 10), bodice, "spine")
    b.add(G.loft([(0, 0.0, zc - 0.03, 0.15, 0.113), (0, -0.01, zc + 0.1, 0.162, 0.13), (0, -0.004, zc + 0.14, 0.16, 0.122)], 10),
          bodice, "chest")
    b.add(G.loft([(0, -0.004, zc + 0.11, 0.155, 0.12), (0, 0.0, zn - 0.02, 0.152, 0.108), (0, 0.006, zn + 0.03, 0.088, 0.075)], 10),
          blouse, "chest")
    for i in range(3):
        z = zs + 0.02 + i * 0.07
        for sx in (1, -1):
            bone = "spine" if z < zc else "chest"
            b.add(G.xform(G.box((0, 0, 0), 0.028, 0.004, 0.0045), G.T(0, -0.113 - 0.012 * (z > zc), z + 0.02) @ G.R(0, sx * 32, 0)),
                  blouse, bone)
    b.add(G.loft([(0, 0.004, zn - 0.005, 0.082, 0.074), (0, 0.004, zn + 0.01, 0.083, 0.075)], 10, cap0=False, cap1=False), gold, "chest")
    b.add(G.ellipsoid((0, -0.1, zn - 0.045), (0.016, 0.008, 0.02), 6, 3), gold, "chest")
    PT.neck(b, P, skin, r=0.042)
    # ---- arms: puffy sleeves, bare forearms
    for s in "LR":
        PT.limb(b, P, f"upper_arm.{s}", [0.052, 0.05, 0.046], blouse, ext1=0.02)
        PT.ball(b, P, f"upper_arm.{s}", 0.28, 0.074, blouse, rings=5, scale=(1.0, 1.0, 1.35))
        el = P.head[f"forearm.{s}"]
        b.add(G.loft([(el.x, 0, el.z - 0.03, 0.05, 0.05), (el.x, 0, el.z + 0.03, 0.056, 0.056)], 8), blouse, f"forearm.{s}")
        PT.limb(b, P, f"forearm.{s}", [0.044, 0.042, 0.035], skin, ext0=-0.01, ext1=0.0)
        PT.fist(b, P, s, skin, size=0.88)
    # ---- head: headscarf with band and knot, dark hair, braid, earrings
    F = PT.human_head(b, P, skin, r=(0.096, 0.106, 0.121), jaw=0.78)
    PT.eyes(b, F, eyew, eyed, size=1.05, dx=0.04)
    PT.brows(b, F, hair, tilt=-6, bushy=0.75, dx=0.042, dz=0.032)
    PT.nose(b, F, skin, length=0.02, width=0.014)
    PT.mouth(b, F, lips, w=0.02, dz=-0.062, h=0.006)
    PT.ears(b, F, skin, size=0.85)
    c = F.c
    for sx in (1, -1):
        b.add(G.ellipsoid((sx * 0.094, c.y + 0.01, c.z - 0.05), 0.011, 6, 3), gold, "head")
    b.add(G.shell(c + Vector((0, 0.004, 0.006)), (0.104, 0.115, 0.13), 12, 7, phi0=math.pi * 0.3, phi1=math.pi * 0.7,
                  keep=lambda d: d.y < 0.3 and (abs(d.x) > 0.62 or d.z > 0.55)), hair, "head")
    b.add(G.shell(c + Vector((0, 0.01, 0.018)), (0.112, 0.124, 0.136), 12, 7, phi0=math.pi * 0.4, phi1=math.pi,
                  keep=lambda d: d.z > 0.42 or d.y > -0.3), scarf, "head")
    b.add(G.loft([(0, 0.004, c.z + 0.036, 0.109, 0.121), (0, 0.004, c.z + 0.062, 0.106, 0.118)], 12, cap0=False, cap1=False),
          band, "head")
    kn = Vector((0, c.y + 0.125, c.z - 0.035))
    for sx in (1, -1):
        b.add(G.ellipsoid(kn + Vector((sx * 0.028, 0, 0)), (0.034, 0.026, 0.028), 6, 4), scarf, "head")
        b.add(G.sweep([kn + Vector((sx * 0.02, 0.005, -0.01)), kn + Vector((sx * 0.04, 0.025, -0.1)), kn + Vector((sx * 0.055, 0.03, -0.18))],
                      [(0.03, 0.007), (0.034, 0.007), (0.028, 0.006)], n=4, normal=(1, 0, 0)), scarf, "head")
    b.add(G.ellipsoid(kn + Vector((0, 0.01, 0.0)), (0.02, 0.02, 0.022), 6, 3), band, "head")
    # braid over the right shoulder
    br = [Vector((-0.085, c.y + 0.035, c.z - 0.05)), Vector((-0.11, c.y + 0.0, c.z - 0.15)),
          Vector((-0.12, c.y - 0.05, c.z - 0.25)), Vector((-0.115, c.y - 0.085, c.z - 0.34))]
    b.add(G.sweep(br, [0.026, 0.028, 0.024, 0.016], n=6, normal=(1, 0, 0)), hair, "head")
    for k in range(3):
        p = br[k].lerp(br[k + 1], 0.5)
        b.add(G.ellipsoid(p, 0.03 - 0.004 * k, 6, 3), hair, "head")
    b.add(G.ellipsoid(br[-1] + Vector((0, -0.004, -0.015)), (0.02, 0.02, 0.016), 6, 3), band, "head")

    body = b.build("npc_merchant", rig)
    print(f"[npc_merchant] triangles ~{b.tri_count()} {b.breakdown()}")

    # ---- animation: hands clasped in front while idle
    st = H.stance(drop=0.02, width=1.2, feet=(0.03, -0.02), toe_out=12, spine=(0, 0, 0), chest=(-2, 0, 0), head=(2, 0, 0),
                  sway=0.014, look=5.0,
                  arms={"L": dict(fwd=10, out=8, elbow=70), "R": dict(fwd=10, out=8, elbow=70)},
                  arm_ik={"L": {"t": (0.045, -0.2, zp + 0.035), "pole": (1, 0.6, -0.4), "hand": (-20, 0, 25)},
                          "R": {"t": (-0.045, -0.205, zp + 0.045), "pole": (-1, 0.6, -0.4), "hand": (-20, 0, -25)}})
    g = H.gait(frames=22, stride=0.46, lift=0.08, duty=0.6, drop=0.03, bob=0.015, lean=2.0, twist=5.0, sway=0.02, roll=3.0,
               arm_swing=16.0, elbow=20.0, elbow_swing=10.0, run=False, strike=12.0, toeoff=28.0, head_bob=1.0, width=1.1,
               toe_out=8.0)
    P.key_loop("Idle", 48, lambda t: H.idle_spec(P, t, st))
    P.key_loop("Walk", g["frames"], lambda p: H.gait_spec(P, p, g, st))
    return rig, body, P
