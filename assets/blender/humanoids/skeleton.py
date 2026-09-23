"""Bony skeleton (skeleton archer, lich): capsules/ellipsoids that all overlap their neighbours, fused later by a
voxel remesh into ONE continuous watertight mesh, then carved (eye sockets, nose cavity...)."""
import math

import mathutils

import hbody as HB

V = mathutils.Vector


def _j(J, b, end=0):
    return V(J[b][end])


def _lerp(a, b, t):
    return a + (b - a) * t


def skeleton(J, P):
    """P: H, bone (radius scale), ribs, fingers, hands, jaw_open (deg), chest_w, skull (scale).
    Returns (parts, sculpt_ops, eye_centres)."""
    s = P["H"] / 1.8
    br = P.get("bone", 1.0)
    parts, ops = [], []
    C = HB.capsule
    E = HB.ellipsoid
    hips, sp, ch, nk, hd = (_j(J, b) for b in ("hips", "spine", "chest", "neck", "head"))
    up_h = (_j(J, "head", 1) - hd).normalized()
    # --- spine column (lumbar thick -> cervical thin), vertebral bodies + processes
    path = [hips + V((0, 0.035, -0.03)) * s, _lerp(hips, sp, 0.5) + V((0, 0.04, 0)) * s,
            sp + V((0, 0.045, 0)) * s, _lerp(sp, ch, 0.5) + V((0, 0.06, 0)) * s,
            ch + V((0, 0.065, 0)) * s, _lerp(ch, nk, 0.5) + V((0, 0.058, 0)) * s, nk + V((0, 0.035, 0)) * s,
            _lerp(nk, hd, 0.5) + V((0, 0.022, 0)) * s, hd + up_h * 0.06 * s + V((0, 0.02, 0)) * s]
    rad = [0.024, 0.023, 0.021, 0.018, 0.017, 0.016, 0.014, 0.013, 0.013]
    for k in range(len(path) - 1):
        parts.append(C(path[k], path[k + 1], rad[k] * s * br * 0.8, rad[k + 1] * s * br * 0.8, seg=10))
        n = 3 if k < 6 else 2
        for j in range(n):
            c = _lerp(path[k], path[k + 1], (j + 0.5) / n)
            rr = rad[k] * s * br
            parts.append(E(c, (rr * 1.15, rr * 1.0, rr * 0.55), seg=12, rings=8))
            if k < 7:
                parts.append(C(c + V((0, 0.01, 0)) * s, c + V((0, 0.038, -0.018)) * s, 0.0075 * s * br, 0.004 * s * br, seg=8))
                for sg in (1, -1):   # transverse processes
                    parts.append(C(c, c + V((sg * 0.03, 0.018, 0)) * s, 0.006 * s * br, 0.0045 * s * br, seg=6))
    # --- rib cage
    nrib = P.get("ribs", 8)
    cw = P.get("chest_w", 1.0)
    z_top = _lerp(ch, nk, 0.62).z
    z_bot = _lerp(sp, ch, 0.15).z
    yc = _lerp(sp, ch, 0.6).y - 0.02 * s
    back_y = path[4].y
    st_top = V((0, yc - 0.1 * s * cw, z_top - 0.02 * s))
    st_bot = V((0, yc - 0.108 * s * cw, z_bot + 0.1 * s))
    parts.append(C(st_top, _lerp(st_top, st_bot, 0.3), 0.02 * s * br, 0.014 * s * br, seg=10, flat=0.4))
    parts.append(C(_lerp(st_top, st_bot, 0.3), st_bot, 0.014 * s * br, 0.01 * s * br, seg=10, flat=0.4))
    parts.append(C(st_bot, st_bot + V((0, 0.005, -0.03)) * s, 0.008 * s * br, 0.004 * s, seg=8))  # xiphoid
    for i in range(nrib):
        t = i / max(nrib - 1, 1)
        z0 = z_top - (z_top - z_bot) * t * 0.92
        prof = math.sin(math.pi * (0.2 + 0.75 * t)) ** 0.7
        rw = 0.145 * s * cw * (0.55 + 0.45 * prof)
        rd = 0.1 * s * cw * (0.7 + 0.3 * prof)
        a_max = math.radians(150 if i < nrib - 2 else 110)
        drop = (0.07 + 0.05 * t) * s
        for sg in (1, -1):
            pts = [V((sg * 0.015 * s, back_y - 0.005 * s, z0 + 0.01 * s))]
            for k in range(1, 9):
                a = math.radians(12) + (a_max - math.radians(12)) * k / 8
                x = sg * rw * math.sin(a) * (1.0 + 0.08 * math.sin(a * 2))
                y = yc + rd * math.cos(a) + 0.02 * s * (1 - k / 8)
                z = z0 - drop * (k / 8) ** 1.25
                pts.append(V((x, y, z)))
            rr = 0.0078 * s * br
            for a_, b_ in zip(pts[:-1], pts[1:]):
                parts.append(C(a_, b_, rr, rr, seg=8, flat=0.55))
            if i < nrib - 2:   # costal cartilage to the sternum (true ribs)
                zt = min(pts[-1].z + (0.02 + 0.07 * t) * s, st_top.z)
                target = V((sg * 0.012 * s, _lerp(st_top, st_bot, (st_top.z - zt) / max(st_top.z - st_bot.z, 1e-3)).y, zt))
                mid = _lerp(pts[-1], target, 0.5) + V((sg * 0.012 * s, -0.01 * s, -0.01 * s))
                parts.append(C(pts[-1], mid, rr * 0.9, rr * 0.8, seg=8, flat=0.6))
                parts.append(C(mid, target, rr * 0.8, rr * 0.75, seg=8, flat=0.6))
    # --- shoulder girdle
    for side, sg in (("L", 1), ("R", -1)):
        sh = _j(J, f"upper_arm.{side}")
        acr = sh + V((-sg * 0.018, 0.005, 0.02)) * s
        cm = _lerp(st_top, acr, 0.5) + V((0, 0.0, 0.012)) * s
        parts.append(C(st_top + V((sg * 0.012, 0, 0.005)) * s, cm, 0.01 * s * br, 0.009 * s * br, seg=8))
        parts.append(C(cm, acr, 0.009 * s * br, 0.011 * s * br, seg=8))
        sc = V((sg * 0.085 * s, back_y + 0.02 * s, _lerp(sp, ch, 0.85).z))
        parts.append(E(sc, (0.045 * s, 0.01 * s, 0.06 * s), rot=(0, sg * 12, -sg * 20), seg=16, rings=8))
        parts.append(C(sc + V((-sg * 0.02, 0.012, 0.045)) * s, acr + V((0, 0.02, 0)) * s, 0.008 * s, 0.01 * s, seg=8))
        parts.append(C(sc + V((sg * 0.02, 0, 0.03)) * s, sh + V((0, 0.012, -0.005)) * s, 0.012 * s, 0.014 * s, seg=8))
    # --- pelvis
    pz = hips.z - 0.03 * s
    sac_t = V((0, path[0].y + 0.01 * s, pz + 0.045 * s))
    sac_b = V((0, path[0].y + 0.035 * s, pz - 0.07 * s))
    parts.append(C(sac_t, sac_b, 0.035 * s, 0.012 * s, seg=12, flat=0.55))
    for side, sg in (("L", 1), ("R", -1)):
        hj = _j(J, f"thigh.{side}")
        crest = []
        for k in range(6):
            a = math.radians(-20 + 125 * k / 5)
            crest.append(V((sg * (0.03 + 0.1 * math.sin(math.radians(20) + a * 0.8)) * s,
                            (0.045 * math.cos(a) - 0.01) * s + path[0].y * 0.3,
                            pz + (0.075 - 0.02 * abs(k - 2.5) / 2.5) * s)))
        for a_, b_ in zip(crest[:-1], crest[1:]):
            parts.append(C(a_, b_, 0.012 * s * br, 0.012 * s * br, seg=8))
        mid = _lerp(crest[2], hj, 0.45)
        parts.append(E(mid, (0.05 * s, 0.012 * s, 0.045 * s), rot=(10, 0, sg * 35), seg=16, rings=10))
        parts.append(E(_lerp(crest[4], hj, 0.5), (0.03 * s, 0.01 * s, 0.035 * s), rot=(0, 0, -sg * 20), seg=12, rings=8))
        parts.append(C(crest[0], sac_t + V((sg * 0.01, 0, -0.02)) * s, 0.014 * s, 0.014 * s, seg=8))
        parts.append(E(hj + V((-sg * 0.018, 0, 0.008)) * s, (0.026 * s, 0.028 * s, 0.028 * s), seg=12, rings=8))
        isch = V((sg * 0.055 * s, 0.01 * s, pz - 0.085 * s))
        pub = V((sg * 0.018 * s, -0.045 * s, pz - 0.06 * s))
        parts.append(C(hj + V((-sg * 0.02, 0, 0)) * s, isch, 0.014 * s, 0.013 * s, seg=8))
        parts.append(C(isch, pub, 0.012 * s, 0.01 * s, seg=8))
        parts.append(C(hj + V((-sg * 0.02, -0.01, 0.01)) * s, pub, 0.011 * s, 0.01 * s, seg=8))
        parts.append(C(pub, V((0, pub.y, pub.z)), 0.011 * s, 0.011 * s, seg=8))
    # --- limbs

    def long_bone(a, b, r, e1=1.6, e2=1.5):
        parts.append(C(a, b, r, r * 0.88, seg=10))
        parts.append(E(a, (r * e1,) * 3, seg=12, rings=8))
        parts.append(E(b, (r * e2 * 1.1, r * e2 * 0.9, r * e2 * 0.9), seg=12, rings=8))
    for side, sg in (("L", 1), ("R", -1)):
        sh, el = _j(J, f"upper_arm.{side}"), _j(J, f"upper_arm.{side}", 1)
        wr = _j(J, f"forearm.{side}", 1)
        long_bone(sh, el, 0.016 * s * br, 1.7, 1.5)
        off = V((0, 0.011, 0)) * s
        parts.append(C(el + off * 0.3, wr - off, 0.0095 * s * br, 0.012 * s * br, seg=8))   # radius
        parts.append(C(el - off * 0.2 + V((0, 0.012, 0.01)) * s, wr + off * 0.7, 0.012 * s * br, 0.008 * s * br, seg=8))  # ulna
        parts.append(E(el + V((0, 0.016, 0.008)) * s, (0.013 * s, 0.013 * s, 0.013 * s), seg=10, rings=6))  # olecranon
        parts.append(E(wr, (0.019 * s * br, 0.017 * s * br, 0.014 * s * br), seg=12, rings=8))
        style = P.get("hands", ("claw", "claw"))[0 if side == "L" else 1]
        bone_hand(parts, J, side, style, s * br, P.get("finger_len", 1.0), P.get("fingers", 4))
        hp, kn = _j(J, f"thigh.{side}"), _j(J, f"thigh.{side}", 1)
        an = _j(J, f"shin.{side}", 1)
        neck_end = hp + V((-sg * 0.035, 0, 0.012)) * s
        parts.append(C(neck_end, hp + V((0, 0, -0.03)) * s, 0.014 * s * br, 0.018 * s * br, seg=10))  # femoral neck
        parts.append(E(neck_end, (0.022 * s * br,) * 3, seg=12, rings=8))                             # femoral head
        parts.append(E(hp + V((sg * 0.012, 0.005, -0.01)) * s, (0.018 * s,) * 3, seg=10, rings=6))    # trochanter
        long_bone(hp + V((0, 0, -0.03)) * s, kn, 0.0185 * s * br, 1.2, 1.35)
        parts.append(E(kn + V((0, -0.026, 0.012)) * s, (0.018 * s, 0.011 * s, 0.021 * s), seg=12, rings=8))  # kneecap
        parts.append(E(kn + V((0, 0, -0.03)) * s, (0.028 * s, 0.024 * s, 0.018 * s), seg=12, rings=8))     # tibial plateau
        parts.append(C(kn + V((0, 0, -0.03)) * s, an + V((0, 0, 0.012)) * s, 0.017 * s * br, 0.013 * s * br, seg=10))
        parts.append(C(kn + V((sg * 0.022, 0.01, -0.035)) * s, an + V((sg * 0.02, 0.008, 0.012)) * s, 0.0075 * s * br, seg=8))
        parts.append(E(an, (0.022 * s, 0.02 * s, 0.018 * s), seg=12, rings=8))
        toe = _j(J, f"foot.{side}", 1)
        parts.append(E(V((an.x, an.y + 0.02 * s, 0.045 * s)), (0.022 * s, 0.045 * s, 0.028 * s), seg=12, rings=8))
        parts.append(E(V((an.x, an.y - 0.03 * s, 0.04 * s)), (0.026 * s, 0.03 * s, 0.022 * s), seg=12, rings=8))
        for k in range(5):
            u = k / 4 - 0.5
            base = V((an.x + u * 0.03 * s, an.y - 0.045 * s, 0.04 * s))
            mt = V((toe.x + u * 0.058 * s, _lerp(an, toe, 0.75).y, 0.016 * s))
            tp = V((toe.x + u * 0.062 * s, toe.y + 0.004 * s, 0.01 * s))
            big = (k == 0) if sg < 0 else (k == 4)
            big = (k == 4) if sg < 0 else (k == 0)
            rr = (0.0105 if big else 0.0078) * s * br
            parts.append(C(base, mt, rr, rr * 0.9, seg=8))
            parts.append(C(mt, tp, rr * 0.9, rr * 0.65, seg=8))
            parts.append(E(mt, (rr * 1.25,) * 3, seg=8, rings=6))
    eyes = skull(parts, ops, J, s * P.get("skull", 1.0), P.get("jaw_open", 0.0))
    cutters = [p for p in parts if isinstance(p, tuple)][0][1]
    parts = [p for p in parts if not isinstance(p, tuple)]
    return parts, ops, eyes, cutters


def bone_hand(parts, J, side, style, s, fl, n):
    wr, tip = _j(J, f"hand.{side}"), _j(J, f"hand.{side}", 1)
    d = (tip - wr).normalized()
    sg = 1 if side == "L" else -1
    fwd = V((0, -1, 0))
    inward = d.cross(fwd).normalized() * (-sg)
    if inward.x * sg > 0:
        inward = -inward
    L = (tip - wr).length
    C = HB.capsule
    parts.append(HB.ellipsoid(wr + d * L * 0.13, (0.02 * s, 0.022 * s, 0.013 * s), seg=12, rings=8))  # carpals
    for k in range(n):
        u = k / max(n - 1, 1) - 0.5
        b0 = wr + d * L * 0.12 + fwd * (-u * 0.026 * s)
        b1 = wr + d * L * 0.48 + fwd * (-u * 0.04 * s)
        seg = 0.03 * s * fl * (1 - abs(u) * 0.3)
        if style == "fist":
            p1 = b1 + (d + inward * 0.3).normalized() * seg
            p2 = p1 + (d * 0.2 + inward).normalized() * seg * 0.8
            p3 = p2 + (d * -0.5 + inward).normalized() * seg * 0.65
        elif style == "open":
            p1 = b1 + (d + inward * 0.12).normalized() * seg * 1.1
            p2 = p1 + (d + inward * 0.3).normalized() * seg * 0.85
            p3 = p2 + (d + inward * 0.5).normalized() * seg * 0.7
        else:  # claw: long and hooked
            p1 = b1 + (d + inward * 0.25).normalized() * seg * 1.25
            p2 = p1 + (d + inward * 0.8).normalized() * seg * 1.05
            p3 = p2 + (d * 0.3 + inward).normalized() * seg * 0.9
        r = 0.0062 * s
        parts.append(C(b0, b1, r * 0.9, r, seg=8))
        parts.append(HB.ellipsoid(b1, (r * 1.35,) * 3, seg=8, rings=6))
        for a, b, rr in ((b1, p1, r), (p1, p2, r * 0.85), (p2, p3, r * 0.7)):
            parts.append(C(a, b, rr, rr * 0.8, seg=8))
            parts.append(HB.ellipsoid(b, (rr * 1.15,) * 3, seg=8, rings=6))
    tb = wr + d * L * 0.1 + fwd * 0.018 * s
    tdir = (d * 0.5 + fwd * 0.8 + inward * 0.3).normalized()
    t1 = tb + tdir * 0.035 * s
    t2 = t1 + (tdir + inward * 0.6).normalized() * 0.026 * s
    parts.append(C(wr + d * L * 0.1, tb, 0.008 * s, 0.0075 * s, seg=8))
    parts.append(C(tb, t1, 0.0075 * s, 0.0065 * s, seg=8))
    parts.append(C(t1, t2, 0.0065 * s, 0.0045 * s, seg=8))


def skull(parts, ops, J, s, jaw_open=0.0):
    """Skull from overlapping volumes + carve ops (applied after the voxel fuse). Returns eye-socket centres."""
    hd = _j(J, "head")
    up = (_j(J, "head", 1) - hd).normalized()
    fw = V((0, -1, 0))
    X = V((1, 0, 0))
    E, C = HB.ellipsoid, HB.capsule

    def P(x, f, u):
        return hd + X * x * s + fw * f * s + up * u * s
    parts.append(E(P(0, -0.012, 0.125), (0.071 * s, 0.089 * s, 0.078 * s), seg=28, rings=18))        # cranium
    parts.append(E(P(0, 0.035, 0.13), (0.064 * s, 0.05 * s, 0.062 * s), seg=24, rings=14))           # forehead
    parts.append(E(P(0, 0.056, 0.075), (0.05 * s, 0.035 * s, 0.045 * s), seg=20, rings=12))          # mid face
    parts.append(E(P(0, 0.07, 0.042), (0.036 * s, 0.024 * s, 0.02 * s), seg=16, rings=10))           # maxilla
    brw = [P(-0.05, 0.068, 0.11), P(-0.022, 0.082, 0.117), P(0.0, 0.084, 0.114), P(0.022, 0.082, 0.117), P(0.05, 0.068, 0.11)]
    for a, b in zip(brw[:-1], brw[1:]):
        parts.append(C(a, b, 0.0085 * s, 0.0085 * s, seg=10))
    for sg in (1, -1):
        zyg = P(sg * 0.046, 0.066, 0.072)
        parts.append(E(zyg, (0.013 * s, 0.011 * s, 0.013 * s), seg=12, rings=8))
        parts.append(C(zyg, P(sg * 0.066, 0.005, 0.07), 0.009 * s, 0.007 * s, seg=8))
        parts.append(C(P(sg * 0.02, 0.082, 0.07), P(sg * 0.035, 0.08, 0.108), 0.008 * s, 0.009 * s, seg=8))
        parts.append(E(P(sg * 0.055, 0.005, 0.06), (0.012 * s, 0.014 * s, 0.014 * s), seg=10, rings=6))
    a = math.radians(jaw_open)

    def jaw_pt(x, f, u):
        pivot = P(0, 0.005, 0.058)
        v = P(x, f, u) - pivot
        vf, vu = v.dot(fw), v.dot(up)
        nf = vf * math.cos(a) + vu * math.sin(a)
        nu = -vf * math.sin(a) + vu * math.cos(a)
        return pivot + X * v.x + fw * nf + up * nu
    for k in range(10):
        ang = math.radians(-70 + 140 * k / 9)
        x, f = 0.03 * math.sin(ang), 0.058 + 0.03 * math.cos(ang)
        parts.append(C(P(x, f, 0.034), P(x, f, 0.02), 0.0052 * s, 0.0042 * s, seg=8))
        parts.append(C(jaw_pt(x * 0.95, f - 0.002, 0.004), jaw_pt(x * 0.95, f - 0.002, 0.017), 0.005 * s, 0.004 * s, seg=8))
    chin = jaw_pt(0, 0.07, -0.01)
    parts.append(E(chin, (0.024 * s, 0.014 * s, 0.017 * s), seg=12, rings=8))
    for sg in (1, -1):
        body_a = jaw_pt(sg * 0.022, 0.068, 0.0)
        ang_ = jaw_pt(sg * 0.05, 0.012, 0.004)
        cond = P(sg * 0.052, 0.004, 0.058)
        parts.append(C(chin, body_a, 0.012 * s, 0.011 * s, seg=8))
        parts.append(C(body_a, ang_, 0.011 * s, 0.011 * s, seg=8, flat=0.7))
        parts.append(C(ang_, cond, 0.01 * s, 0.009 * s, seg=8, flat=0.7))
    eyes, cutters = [], []
    for sg in (1, -1):
        cutters.append(E(P(sg * 0.031, 0.096, 0.091), (0.0235 * s, 0.05 * s, 0.021 * s), rot=(0, sg * -8, sg * -12), seg=20, rings=12))
        eyes.append(P(sg * 0.03, 0.062, 0.091))
        ops.append(("push", tuple(P(sg * 0.074, 0.0, 0.11)), (0.02 * s, 0.03 * s, 0.03 * s), -0.008 * s))
        ops.append(("push", tuple(P(sg * 0.042, 0.052, 0.045)), 0.014 * s, -0.005 * s))
    cutters.append(E(P(0, 0.105, 0.064), (0.0095 * s, 0.035 * s, 0.015 * s), rot=(-15, 0, 0), seg=16, rings=10))
    cutters.append(E(P(0, 0.105, 0.078), (0.005 * s, 0.03 * s, 0.01 * s), seg=12, rings=8))
    parts.append(("cutters", cutters))
    return eyes
