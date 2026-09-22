"""Humanoid monsters built on the shared rig: goblin (≈1.2 m, club) and skeleton (rusty sword, glowing eyes).
Clips: Idle, Walk, Attack, Hit, Death."""
import math
import random

from mathutils import Vector

import geo as G
import humanoid as H
import parts as PT
from humanoid import arm_r, over, plus

# small, hunched proportions: short legs, long arms, big head
GOBLIN = dict(
    ankle=0.06, knee=0.3, hip=0.55, hip_w=0.085, toe_y=-0.13, toe_z=0.02,
    pelvis=0.585, spine=0.64, chest=0.745, neck=0.9, head=0.935, top=1.18,
    shoulder=0.87, shoulder_w=0.165, elbow=0.665, wrist=0.455, hand=0.1, arm_out=0.05,
)


# ============================================================================ GOBLIN
def goblin():
    L = dict(GOBLIN)
    rig = H.build_rig(L)
    P = H.Poser(rig, L)
    b = G.MeshBuilder()

    skin = PT.mat("Gob_Skin", "#7da846", 0.7)
    dskin = PT.mat("Gob_SkinDark", "#557a2e", 0.75)
    inner = PT.mat("Gob_EarInner", "#c07a6a", 0.7)
    leather = PT.mat("Gob_Leather", "#7a5030", 0.8)
    dleather = PT.mat("Gob_LeatherDark", "#4a2f1c", 0.85)
    cloth = PT.mat("Gob_Cloth", "#8c3a2a", 0.9)
    bone = PT.mat("Gob_Bone", "#e6dcc0", 0.7)
    wood = PT.mat("Gob_Wood", "#7b5231", 0.85)
    iron = PT.mat("Gob_Iron", "#5c6168", 0.5, 0.45)
    eye = PT.mat("Gob_Eye", "#ffd23a", 0.4, 0.0, emit="#ffb400", strength=1.6)
    pupil = PT.mat("Gob_Pupil", "#1a1208", 0.5)
    mouth = PT.mat("Gob_Mouth", "#3a1a14", 0.8)
    hairm = PT.mat("Gob_Hair", "#2a2420", 0.9)
    zh, zp, zs, zc, zn = L["hip"], L["pelvis"], L["spine"], L["chest"], L["neck"]

    # ---- legs: bowed, bare feet with claws
    PT.limb_pair(b, P, "thigh", [0.068, 0.062, 0.05], skin, ext0=0.03, ext1=0.01)
    PT.limb_pair(b, P, "shin", [0.05, 0.052, 0.04], skin, ext1=-0.01)
    for s in "LR":
        kn = P.head[f"shin.{s}"]
        b.add(G.ellipsoid((kn.x, -0.018, kn.z), (0.05, 0.045, 0.048), 7, 4), skin, f"shin.{s}")
        PT.bare_foot(b, P, s, skin, w=0.05, h=0.07, toe=0.17, heel=0.045, claw=bone)
    # ---- hips + loincloth (split flaps follow the thighs)
    b.add(G.loft([(0, 0.0, zh - 0.06, 0.12, 0.1), (0, 0.0, zp + 0.01, 0.135, 0.11), (0, 0.0, zs + 0.03, 0.13, 0.11)], 8), skin, "hips")
    b.add(G.loft([(0, 0.0, zp - 0.02, 0.142, 0.118), (0, 0.0, zp + 0.025, 0.14, 0.116)], 8), dleather, "hips")
    rings = [(zh + 0.02, 0.15, 0.125), (zh - 0.08, 0.16, 0.14), (zh - 0.15, 0.165, 0.145)]
    PT.apron(b, P, rings, cloth, span=0.7, n=2, jag=0.03, seed=3)
    PT.apron(b, P, rings, cloth, span=0.7, n=2, back=True, jag=0.03, seed=4)
    b.add(G.xform(G.box((0, 0, 0), 0.012, 0.012, 0.045), G.T(0.1, -0.1, zp - 0.02) @ G.R(0, 70, 20)), bone, "hips")
    b.add(G.ellipsoid((0.1 + 0.045 * 0.94, -0.1, zp - 0.005), 0.016, 5, 3), bone, "hips")
    b.add(G.ellipsoid((0.1 - 0.045 * 0.94, -0.1, zp - 0.035), 0.016, 5, 3), bone, "hips")
    # ---- pot belly, narrow chest, strap, pauldron
    b.add(G.loft([(0, 0.0, zs - 0.03, 0.13, 0.11), (0, -0.018, zs + 0.06, 0.148, 0.14), (0, -0.004, zc + 0.03, 0.132, 0.112)], 8),
          skin, "spine")
    b.add(G.loft([(0, 0.0, zc - 0.03, 0.13, 0.105), (0, 0.0, zc + 0.08, 0.155, 0.112), (0, 0.004, zn - 0.02, 0.14, 0.1),
                  (0, 0.01, zn + 0.03, 0.07, 0.062)], 8), skin, "chest")
    strap = [(0.13, -0.085, zn - 0.01), (0.03, -0.118, zc + 0.08), (-0.07, -0.118, zc + 0.0), (-0.13, -0.09, zc - 0.05)]
    b.add(G.sweep(strap, [(0.006, 0.018)] * 4, n=4, normal=(0, -1, 0)), dleather, "chest")
    b.add(G.sweep([(0.13, 0.08, zn - 0.01), (0.02, 0.112, zc + 0.08), (-0.1, 0.1, zc - 0.03)], [(0.006, 0.018)] * 3, n=4,
                  normal=(0, 1, 0)), dleather, "chest")
    sh = P.head["upper_arm.L"]
    pc = Vector((sh.x + 0.015, 0, sh.z + 0.02))
    b.add(G.xform(G.shell(Vector(), (0.085, 0.09, 0.07), 8, 4, phi0=math.pi * 0.45, phi1=math.pi), G.T(pc) @ G.R(0, 20, 0)),
          leather, "upper_arm.L")
    for dy in (-0.035, 0.03):
        base_p = pc + Vector((0.03, dy, 0.05))
        b.add(G.tube(base_p, base_p + Vector((0.035, 0, 0.07)), 0.016, 0.0, n=5), bone, "upper_arm.L")
    PT.neck(b, P, skin, r=0.045, bot=zn - 0.03, top=L["head"] + 0.06)
    # ---- long skinny arms, big hands
    for s in "LR":
        PT.limb(b, P, f"upper_arm.{s}", [0.045, 0.04, 0.036], skin, ext1=0.02)
        PT.ball(b, P, f"upper_arm.{s}", 0.0, 0.05, skin, rings=4)
        PT.limb(b, P, f"forearm.{s}", [0.04, 0.043, 0.034], skin, ext0=0.01, ext1=-0.01)
        PT.fist(b, P, s, skin, size=1.25)
    fa0, fa1 = P.head["forearm.R"], P.tail["forearm.R"]
    b.add(G.sweep([fa0.lerp(fa1, 0.62), fa0.lerp(fa1, 0.95)], [0.047, 0.043], n=7, normal=(1, 0, 0)), dleather, "forearm.R")
    # ---- head: big, pointy ears, hooked nose, glowing eyes, tusks, tuft
    c = Vector((0, -0.012, L["head"] + 0.125))
    F = PT.human_head(b, P, skin, r=(0.142, 0.135, 0.128), centre=c, jaw=0.95, chin=0.03, seg=10, rings=7)
    PT.eyes(b, F, eye, pupil, dx=0.055, dz=0.012, size=1.2)
    for sx in (1, -1):
        p = F.surf(sx * 0.055, c.z + 0.048, inset=0.0)
        b.add(G.xform(G.box((0, 0, 0), 0.045, 0.02, 0.013), G.T(p) @ G.R(0, sx * 18, 0)), dskin, "head")
        e0 = Vector((sx * 0.128, c.y + 0.012, c.z + 0.015))
        pts = [e0, e0 + Vector((sx * 0.1, 0.02, 0.025)), e0 + Vector((sx * 0.2, 0.05, 0.06))]
        b.add(G.sweep(pts, [(0.012, 0.055), (0.01, 0.038), (0.0, 0.0)], n=6, normal=(0, 1, 0)), skin, "head", ground=False)
        b.add(G.sweep([p_ + Vector((0, -0.008, 0)) for p_ in pts[:2]] + [pts[2] + Vector((-sx * 0.03, -0.006, -0.008))],
                      [(0.005, 0.034), (0.004, 0.022), (0.0, 0.0)], n=4, normal=(0, 1, 0)), inner, "head", ground=False)
    nz = F.surf(0, c.z - 0.005, inset=0.012)
    b.add(G.sweep([nz, nz + Vector((0, -0.05, -0.012)), nz + Vector((0, -0.075, -0.045))], [0.03, 0.02, 0.006], n=6,
                  normal=(1, 0, 0)), skin, "head")
    mo = F.surf(0, c.z - 0.065, inset=0.01)
    b.add(G.xform(G.box((0, 0, 0), 0.058, 0.012, 0.009), G.T(mo)), mouth, "head")
    for sx in (1, -1):
        t0 = mo + Vector((sx * 0.04, -0.006, -0.008))
        b.add(G.tube(t0, t0 + Vector((sx * 0.004, -0.004, 0.035)), 0.009, 0.0, n=4), bone, "head")
    for i, (dx, dy, lz) in enumerate(((0.0, 0.0, 0.07), (0.035, 0.02, 0.05), (-0.035, 0.025, 0.055))):
        t0 = c + Vector((dx, dy, 0.115))
        b.add(G.tube(t0, t0 + Vector((dx * 0.6, 0.03, lz)), 0.016, 0.0, n=4), hairm, "head", ground=False)
    # ---- crude spiked club (right hand), authored along the grip frame
    M = PT.grip_matrix(P, "R", tilt=20)
    rnd = random.Random(11)
    club = G.loft([(0, 0, 0.1, 0.028, 0.028), (0, 0, 0.3, 0.046, 0.046), (0, 0, 0.47, 0.066, 0.064), (0, 0, 0.56, 0.056, 0.056),
                   (0, 0, 0.6, 0.0, 0.0)], 7)
    b.add(G.jitter(club, 0.006, 5), wood, "hand.R", M=M, ground=False)
    b.add(G.tube((0, 0, -0.085), (0, 0, 0.13), 0.026, 0.026, n=6), dleather, "hand.R", M=M, ground=False)
    b.add(G.tube((0, 0, 0.29), (0, 0, 0.33), 0.05, 0.05, n=7), iron, "hand.R", M=M, ground=False)
    for k in range(6):
        a = math.radians(60 * k + rnd.uniform(-15, 15))
        z = 0.38 + 0.07 * (k % 3) + rnd.uniform(-0.01, 0.01)
        r = 0.05 + 0.012 * (z - 0.38) / 0.14
        p0 = Vector((math.cos(a) * r * 0.8, math.sin(a) * r * 0.8, z))
        b.add(G.tube(p0, p0 + Vector((math.cos(a), math.sin(a), 0.2)).normalized() * 0.055, 0.013, 0.0, n=4), iron, "hand.R",
              M=M, ground=False)

    body = b.build("goblin", rig)
    print(f"[goblin] triangles ~{b.tri_count()} {b.breakdown()}")

    # ---- animation
    st = H.stance(drop=0.045, width=1.6, feet=(0.05, -0.06), toe_out=18, hips=(8, 0, 0), spine=(12, 0, 0), chest=(12, 0, 0),
                  neck=(-14, 0, 0), head=(-16, 0, 0), sway=0.014, look=8.0, breathe=1.5,
                  arms={"L": dict(fwd=24, out=22, twist=-10, elbow=32), "R": dict(fwd=18, out=20, twist=10, elbow=55)})
    g = H.gait(frames=17, stride=0.56, lift=0.13, duty=0.4, drop=0.03, bob=0.028, lean=8.0, twist=12.0, sway=0.016, roll=3.0,
               arm_swing=42.0, elbow=45.0, elbow_swing=15.0, arm_out=18.0, width=1.25, toe_out=12.0,
               arms={"R": dict(swing=0.55, fwd=18, elbow=60, out=20, twist=10)})
    P.key_loop("Idle", 48, lambda t: H.idle_spec(P, t, st))
    P.key_loop("Walk", g["frames"], lambda p: H.gait_spec(P, p, g, st))
    base = H.idle_spec(P, 0, st)

    def club_arm(fwd, out, twist, elbow, wrist):
        return {"upper_arm.R": arm_r("R", fwd, out, twist), "forearm.R": (-elbow, 0, 0), "hand.R": (wrist, 0, 0)}

    wind = over(plus(base, {"hips": {"r": (-4, 0, -8), "t": (0, 0.02, -0.02)}, "spine": (-6, 0, -8), "chest": (-10, 0, -14),
                            "head": (8, 0, 14)}),
                {**club_arm(150, 25, 20, 70, 0), "upper_arm.L": arm_r("L", 50, 40), "forearm.L": (-40, 0, 0)})
    smash = over(plus(base, {"hips": {"r": (6, 0, 8), "t": (0, -0.05, -0.05)}, "spine": (8, 0, 8), "chest": (10, 0, 12),
                             "head": (-10, 0, -10)}),
                 {**club_arm(85, 10, 0, 5, 14), "upper_arm.L": arm_r("L", -20, 30), "forearm.L": (-30, 0, 0)})
    follow = over(plus(base, {"hips": {"r": (8, 0, 10), "t": (0, -0.05, -0.06)}, "spine": (10, 0, 10), "chest": (12, 0, 14),
                              "head": (-12, 0, -12)}),
                  {**club_arm(72, 5, -5, 10, 0), "upper_arm.L": arm_r("L", -25, 32), "forearm.L": (-30, 0, 0)})
    P.key_poses("Attack", [(0, base), (5, wind, "out"), (8, smash, "in"), (10, follow, "out"), (15, base, "smooth")])
    P.key_poses("Hit", H.hit_keys(base, strength=1.2))
    P.key_poses("Death", H.death_keys(P, body, base, "fwd", turn=-16, exclude=b.no_ground, arms={
        "upper_arm.R": arm_r("R", -6, 30, 0), "forearm.R": (4, 0, -90), "hand.R": (0, 0, 0), "head": (6, 0, 28)},
        fall_arms={"upper_arm.R": arm_r("R", 40, 50, 0), "forearm.R": (-20, 0, -90)}))
    return rig, body, P


# ============================================================================ SKELETON
def skeleton():
    L = dict(H.HUMAN, shoulder_w=0.19, hip_w=0.09)
    rig = H.build_rig(L)
    P = H.Poser(rig, L)
    b = G.MeshBuilder()

    bonem = PT.mat("Ske_Bone", "#e2d8be", 0.75)
    dbone = PT.mat("Ske_BoneDark", "#b3a78a", 0.8)
    socket = PT.mat("Ske_Socket", "#18161c", 0.9)
    glow = PT.mat("Ske_Glow", "#a8fbff", 0.3, 0.0, emit="#3fe8ff", strength=9.0)
    iron = PT.mat("Ske_Iron", "#5d4e45", 0.7, 0.4)
    rust = PT.mat("Ske_Rust", "#8e4d28", 0.85, 0.35)
    drust = PT.mat("Ske_RustDark", "#5c3520", 0.9, 0.3)
    rag = PT.mat("Ske_Rag", "#3f3a4a", 0.95)
    rope = PT.mat("Ske_Rope", "#6a5a42", 0.9)
    zh, zp, zs, zc, zn = L["hip"], L["pelvis"], L["spine"], L["chest"], L["neck"]

    # ---- legs: femur / tibia + fibula with knobby joints, bony feet
    for s, sx in (("L", 1), ("R", -1)):
        PT.limb(b, P, f"thigh.{s}", [0.026, 0.022, 0.025], bonem, n=6, ext0=-0.02, ext1=-0.02)
        hp, kn, an = P.head[f"thigh.{s}"], P.head[f"shin.{s}"], P.head[f"foot.{s}"]
        b.add(G.ellipsoid(hp + Vector((0, 0, -0.005)), 0.036, 6, 4), bonem, f"thigh.{s}")
        b.add(G.ellipsoid(kn + Vector((0, 0.004, 0.025)), (0.046, 0.036, 0.03), 7, 4), bonem, f"thigh.{s}")
        b.add(G.ellipsoid(kn + Vector((0, 0.004, -0.02)), (0.042, 0.036, 0.026), 7, 4), dbone, f"shin.{s}")
        b.add(G.ellipsoid(kn + Vector((0, -0.036, 0.0)), (0.022, 0.014, 0.026), 5, 3), bonem, f"shin.{s}")
        PT.limb(b, P, f"shin.{s}", [0.024, 0.02, 0.023], bonem, n=6, ext0=-0.03, ext1=-0.02)
        b.add(G.tube(kn + Vector((sx * 0.026, 0.01, -0.04)), an + Vector((sx * 0.022, 0.006, 0.03)), 0.01, 0.009, n=4), dbone,
              f"shin.{s}")
        b.add(G.ellipsoid(an + Vector((0, 0.0, -0.01)), (0.034, 0.04, 0.03), 6, 4), bonem, f"foot.{s}")
        PT.bare_foot(b, P, s, bonem, w=0.038, h=0.045, toe=0.16, heel=0.035)
    # ---- pelvis
    for sx in (1, -1):
        b.add(G.xform(G.ellipsoid((0, 0, 0), (0.07, 0.028, 0.06), 7, 4), G.T(sx * 0.085, 0.01, zp + 0.01) @ G.R(0, sx * 30, sx * 25)),
              bonem, "hips")
    b.add(G.loft([(0, 0.045, zp - 0.07, 0.022, 0.016), (0, 0.05, zp + 0.04, 0.04, 0.022)], 6), dbone, "hips")
    b.add(G.sweep([(0.085, -0.03, zh - 0.0), (0.035, -0.06, zh - 0.05), (-0.035, -0.06, zh - 0.05), (-0.085, -0.03, zh - 0.0)],
                  [0.014, 0.013, 0.013, 0.014], n=5, normal=(0, 0, 1)), bonem, "hips")
    # ---- spine column
    z = zp + 0.03
    while z < zn + 0.02:
        bone = "hips" if z < zs else ("spine" if z < zc else "chest")
        b.add(G.box((0, 0.05, z), 0.022, 0.019, 0.013), bonem if int(z * 100) % 2 else dbone, bone)
        z += 0.042
    for bone, z0, z1 in (("hips", zp, zs + 0.02), ("spine", zs - 0.02, zc + 0.02), ("chest", zc - 0.02, zn + 0.02)):
        b.add(G.tube((0, 0.045, z0), (0, 0.045, z1), 0.012, 0.012, n=4), dbone, bone)
    # ---- ribcage + sternum + clavicles
    for i, (w, dz) in enumerate(((0.8, 0.0), (0.93, 0.045), (1.0, 0.09), (0.98, 0.135), (0.9, 0.18))):
        zr = zn - 0.05 - dz
        for sx in (1, -1):
            pts = [(sx * 0.02, 0.055, zr), (sx * 0.1 * w, 0.045, zr - 0.012), (sx * 0.145 * w, -0.01, zr - 0.03),
                   (sx * 0.125 * w, -0.075, zr - 0.05), (sx * 0.05, -0.108, zr - 0.07)]
            b.add(G.sweep(pts, [(0.012, 0.007)] * 5, n=4, normal=(0, 0, 1)), bonem, "chest")
    b.add(G.box((0, -0.112, zn - 0.15), 0.018, 0.01, 0.11), bonem, "chest")
    for sx in (1, -1):
        b.add(G.tube((sx * 0.025, -0.1, zn - 0.035), (sx * 0.19, -0.015, L["shoulder"] + 0.02), 0.012, 0.011, n=4), bonem, "chest")
        b.add(G.xform(G.box((0, 0, 0), 0.055, 0.008, 0.07), G.T(sx * 0.1, 0.075, zc + 0.12) @ G.R(0, 0, sx * -18)), dbone, "chest")
    # neck vertebrae
    for zz in (zn + 0.005, zn + 0.045):
        b.add(G.box((0, 0.025, zz), 0.02, 0.018, 0.012), bonem, "neck")
    b.add(G.tube((0, 0.025, zn - 0.01), (0, 0.02, L["head"] + 0.04), 0.013, 0.012, n=4), dbone, "neck")
    # ---- arms: humerus, radius + ulna, bony hands
    for s, sx in (("L", 1), ("R", -1)):
        PT.limb(b, P, f"upper_arm.{s}", [0.022, 0.018, 0.021], bonem, n=6, ext0=-0.02, ext1=-0.02)
        sh, el = P.head[f"upper_arm.{s}"], P.head[f"forearm.{s}"]
        b.add(G.ellipsoid(sh, 0.034, 6, 4), bonem, f"upper_arm.{s}")
        b.add(G.ellipsoid(el + Vector((0, 0.004, 0.01)), (0.032, 0.03, 0.026), 6, 4), bonem, f"upper_arm.{s}")
        wr = P.tail[f"forearm.{s}"]
        for dy, r in ((-0.012, 0.011), (0.013, 0.01)):
            b.add(G.tube(el + Vector((0, dy, -0.015)), wr + Vector((0, dy, 0.01)), r, r * 0.9, n=4), bonem if dy < 0 else dbone,
                  f"forearm.{s}")
        PT.fist(b, P, s, bonem, size=0.82)
    # ---- skull: cranium, face, sockets with glowing eyes, nose hole, teeth, jaw
    c = Vector((0, 0.004, L["head"] + 0.125))
    b.add(G.ellipsoid(c, (0.098, 0.11, 0.104), 10, 6), bonem, "head")
    b.add(G.loft([(0, c.y - 0.03, c.z - 0.1, 0.06, 0.06), (0, c.y - 0.025, c.z - 0.06, 0.082, 0.078),
                  (0, c.y - 0.01, c.z - 0.01, 0.092, 0.095)], 8), bonem, "head")
    for sx in (1, -1):
        so = Vector((sx * 0.038, c.y - 0.088, c.z - 0.018))
        b.add(G.ellipsoid(so, (0.028, 0.022, 0.025), 7, 4), socket, "head")
        b.add(G.ellipsoid(so + Vector((0, -0.021, 0.001)), (0.0135, 0.009, 0.0125), 6, 3), glow, "head")
        b.add(G.ellipsoid((sx * 0.07, c.y - 0.06, c.z - 0.048), (0.026, 0.024, 0.02), 6, 3), bonem, "head")
    b.add(G.xform(G.loft([(0, 0, -0.018, 0.016, 0.006), (0, 0, 0.012, 0.0, 0.0)], 3), G.T(0, c.y - 0.1, c.z - 0.055)), socket, "head")
    for k in range(6):
        x = -0.03 + 0.012 * k
        b.add(G.box((x, c.y - 0.086 + abs(x) * 0.4, c.z - 0.092), 0.0048, 0.005, 0.009), bonem, "head")
    jaw = [(0.068, c.y + 0.0, c.z - 0.05), (0.062, c.y - 0.04, c.z - 0.115), (0.03, c.y - 0.075, c.z - 0.128),
           (-0.03, c.y - 0.075, c.z - 0.128), (-0.062, c.y - 0.04, c.z - 0.115), (-0.068, c.y + 0.0, c.z - 0.05)]
    b.add(G.sweep(jaw, [(0.012, 0.018)] * 6, n=4, normal=(0, 0, 1)), dbone, "head")
    for k in range(5):
        x = -0.024 + 0.012 * k
        b.add(G.box((x, c.y - 0.078 + abs(x) * 0.4, c.z - 0.112), 0.0045, 0.005, 0.008), bonem, "head")
    # ---- rusty gear: dented helmet, pauldron, belt, rags, tattered cape
    hm = G.shell(c + Vector((0, 0.004, 0.012)), (0.108, 0.12, 0.112), 10, 4, phi0=math.pi * 0.56, phi1=math.pi)
    b.add(G.jitter(hm, 0.006, 21), iron, "head")
    b.add(G.loft([(c.x, c.y + 0.004, c.z + 0.02, 0.1, 0.112), (c.x, c.y + 0.004, c.z + 0.04, 0.098, 0.11)], 10, cap0=False,
                 cap1=False), drust, "head")
    sh = P.head["upper_arm.L"]
    pd = G.shell(Vector(), (0.08, 0.085, 0.07), 8, 4, phi0=math.pi * 0.45, phi1=math.pi)
    b.add(G.jitter(G.xform(pd, G.T(sh + Vector((0.015, 0, 0.02))) @ G.R(0, 22, 0)), 0.005, 22), iron, "upper_arm.L")
    b.add(G.loft([(0, 0.01, zp - 0.02, 0.13, 0.085), (0, 0.01, zp + 0.012, 0.128, 0.084)], 8), rope, "hips")
    rings = [(zh + 0.04, 0.135, 0.1), (zh - 0.1, 0.15, 0.12), (zh - 0.24, 0.16, 0.13)]
    PT.apron(b, P, rings, rag, span=0.75, n=2, jag=0.06, seed=5)
    PT.apron(b, P, rings, rag, span=0.6, n=2, back=True, jag=0.07, seed=6)
    cv, cidx = PT._half_rings([(zn + 0.02, 0.2, 0.12, 0.03), (zn - 0.15, 0.25, 0.15, 0.04), (zs + 0.02, 0.24, 0.16, 0.05)], 6,
                              a0=0.25, a1=math.pi - 0.25)
    rnd = random.Random(9)
    for i in cidx[-1]:
        x, y, zz = cv[i]
        cv[i] = (x, y, zz - rnd.uniform(0.0, 0.12))
    b.add((cv, PT._half_faces(cidx)), rag, "chest")
    # ---- rusty sword (right hand)
    M = PT.grip_matrix(P, "R", tilt=10)
    b.add(G.tube((0, 0, -0.07), (0, 0, 0.08), 0.016, 0.016, n=5), rag, "hand.R", M=M, ground=False)
    b.add(G.ellipsoid((0, 0, -0.085), 0.02, 5, 3), drust, "hand.R", M=M, ground=False)
    b.add(G.box((0, 0, 0.09), 0.016, 0.085, 0.014), drust, "hand.R", M=M, ground=False)
    blade = G.loft([(0, 0, 0.1, 0.008, 0.036), (0, 0, 0.3, 0.008, 0.033), (0, 0, 0.36, 0.007, 0.026), (0, 0, 0.4, 0.007, 0.033),
                    (0, 0, 0.62, 0.006, 0.028), (0, 0, 0.72, 0.005, 0.016), (0, 0, 0.78, 0.0, 0.0)], 4, phase=0.0)
    b.add(G.jitter(blade, 0.003, 13), rust, "hand.R", M=M, ground=False)

    body = b.build("skeleton", rig)
    print(f"[skeleton] triangles ~{b.tri_count()} {b.breakdown()}")

    # ---- animation
    st = H.stance(drop=0.03, width=1.4, feet=(0.05, -0.05), toe_out=10, hips=(3, 0, 0), spine=(5, 0, 0), chest=(6, 0, 0),
                  neck=(-4, 0, 0), head=(-6, 5, 0), sway=0.01, look=6.0, breathe=0.5,
                  arms={"L": dict(fwd=10, out=16, twist=-5, elbow=30), "R": dict(fwd=10, out=12, twist=8, elbow=52)})
    g = H.gait(frames=20, stride=0.7, lift=0.14, duty=0.45, drop=0.05, bob=0.03, lean=6.0, twist=10.0, sway=0.012,
               arm_swing=30.0, elbow=35.0, arm_out=14.0,
               arms={"R": dict(swing=0.6, fwd=8, elbow=55, out=12, twist=8)})
    P.key_loop("Idle", 48, lambda t: H.idle_spec(P, t, st))
    P.key_loop("Walk", g["frames"], lambda p: H.gait_spec(P, p, g, st))
    base = H.idle_spec(P, 0, st)

    def sword(fwd, out, twist, elbow, wrist):
        return {"upper_arm.R": arm_r("R", fwd, out, twist), "forearm.R": (-elbow, 0, 0), "hand.R": (wrist, 0, 0)}

    wind = over(plus(base, {"hips": {"r": (0, 0, -12), "t": (0, 0.02, -0.01)}, "spine": (-2, 0, -12), "chest": (-4, 0, -22),
                            "head": (2, 0, 20)}),
                {**sword(95, 70, 40, 60, 10), "upper_arm.L": arm_r("L", 30, 20), "forearm.L": (-40, 0, 0)})
    slash = over(plus(base, {"hips": {"r": (2, 0, 10), "t": (0, -0.05, -0.04)}, "spine": (4, 0, 12), "chest": (6, 0, 24),
                             "head": (-6, 0, -22)}),
                 {**sword(85, 5, -10, 5, 70), "upper_arm.L": arm_r("L", -10, 25), "forearm.L": (-30, 0, 0)})
    follow = over(plus(base, {"hips": {"r": (3, 0, 14), "t": (0, -0.05, -0.05)}, "spine": (5, 0, 14), "chest": (8, 0, 30),
                              "head": (-8, 0, -26)}),
                  {**sword(70, -25, -30, 10, 65), "upper_arm.L": arm_r("L", -15, 28), "forearm.L": (-30, 0, 0)})
    P.key_poses("Attack", [(0, base), (5, wind, "out"), (8, slash, "in"), (10, follow, "out"), (15, base, "smooth")])
    P.key_poses("Hit", H.hit_keys(base, strength=1.1))
    P.key_poses("Death", H.death_keys(P, body, base, "back", turn=20, exclude=b.no_ground, arms={
        "upper_arm.R": arm_r("R", 10, 60, 0), "forearm.R": (-10, 0, 0), "hand.R": (75, 0, 0)}))
    return rig, body, P
