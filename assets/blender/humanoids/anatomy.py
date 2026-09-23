"""Anatomy recipes: skin-graph bodies (human-like: bandit, goblin, hag, wraith torso) and bony skeletons
(skeleton archer, lich) built on the same joints as the armature (hrig.joints)."""
import math

import mathutils

import hbody as HB

V = mathutils.Vector


def _j(J, b, end=0):
    return V(J[b][end])


def _lerp(a, b, t):
    return a + (b - a) * t


# =============================================================================== hands / feet
def hand(g, start, J, side, style="fist", fingers=4, fl=1.0, r=1.0, knuckle=1.0, claw=0.0):
    """Hand from the wrist node `start`. A-pose: the hand hangs along the forearm direction, palm facing the body,
    thumb forward (-Y). style: fist (curled, holds a weapon), open (relaxed), claw (long bent bony fingers)."""
    wr, tip = _j(J, f"hand.{side}"), _j(J, f"hand.{side}", 1)
    d = (tip - wr).normalized()
    sg = 1 if side == "L" else -1
    L = (tip - wr).length
    fwd = V((0, -1, 0))
    inward = d.cross(fwd).normalized() * (-sg)      # palm normal (towards the body)
    if inward.x * sg > 0:
        inward = -inward
    palm_c = wr + d * L * 0.3
    palm = g.chain(start, [(palm_c, (0.03 * r, 0.018 * r))])[0]
    knuck = wr + d * L * 0.52
    spread = (0.044 if style == "fist" else 0.07) * r
    ends = []
    for k in range(fingers):
        u = (k / max(fingers - 1, 1) - 0.5)
        base = knuck + fwd * (-u * spread) * 1.0 + d * (-abs(u) * 0.01)
        fr = (0.0105 if style == "fist" else 0.0085) * r * knuckle
        seg = 0.034 * fl * (1.0 - abs(u) * 0.35)
        if style == "fist":
            # curl towards the palm: bend 80 deg, 90 deg
            p1 = base + d * seg * 0.9
            p2 = p1 + (d * 0.3 + inward * 0.9).normalized() * seg * 0.8
            p3 = p2 + (d * -0.4 + inward * 0.9).normalized() * seg * 0.6
            pts = [(base, fr * 1.05), (p1, fr), (p2, fr * 0.95), (p3, fr * 0.85)]
        elif style == "claw":
            bend = (d + inward * (0.35 + claw)).normalized()
            p1 = base + d * seg * 1.3
            p2 = p1 + bend * seg * 1.1
            p3 = p2 + (d * 0.4 + inward * (0.9 + claw)).normalized() * seg * 1.0
            pts = [(base, fr), (p1, fr * 0.75), (p2, fr * 0.7), (p3, fr * 0.35)]
        else:  # open, relaxed slight curl
            bend = (d + inward * 0.35).normalized()
            p1 = base + d * seg
            p2 = p1 + bend * seg * 0.85
            p3 = p2 + (d + inward * 0.7).normalized() * seg * 0.7
            pts = [(base, fr), (p1, fr * 0.92), (p2, fr * 0.85), (p3, fr * 0.6)]
        ends.append(g.chain(palm, pts)[-1])
    # thumb: from the palm root towards the front
    tb = wr + d * L * 0.2 + fwd * 0.018 * r
    tdir = (d * 0.6 + fwd * 0.7 + inward * (0.4 if style == "fist" else 0.1)).normalized()
    t1 = tb + tdir * 0.03 * fl
    t2 = t1 + (tdir + inward * 0.6).normalized() * 0.026 * fl
    g.chain(palm, [(tb, 0.014 * r), (t1, 0.012 * r), (t2, 0.009 * r * (0.5 if style == "claw" else 1))])
    return palm


def foot(g, start, J, side, r=1.0, style="bare", toes=0):
    """Foot from the ankle node: heel spur + arch + ball + toes."""
    an, toe = _j(J, f"foot.{side}"), _j(J, f"foot.{side}", 1)
    ball = V((toe.x, _lerp(an, toe, 0.72).y, 0.035 * r))
    heel = g.chain(start, [(V((an.x, an.y + 0.045 * r, 0.035 * r)), (0.036 * r, 0.036 * r))])
    mid = g.chain(start, [(V((an.x, _lerp(an, toe, 0.4).y, 0.045 * r)), (0.042 * r, 0.036 * r)),
                          (ball, (0.045 * r, 0.03 * r))])
    if toes:
        for k in range(toes):
            u = k / max(toes - 1, 1) - 0.5
            tp = V((toe.x + u * 0.05 * r, toe.y - 0.02 * r, 0.018 * r))
            g.chain(mid[-1], [(tp, 0.012 * r)])
    else:
        g.chain(mid[-1], [(V((toe.x, toe.y, 0.028 * r)), (0.038 * r, 0.024 * r))])


# =============================================================================== human-like body
def human(J, P):
    """Skin graph for a human-like body. P: H, bulk (torso radius scale), limb (limb radius scale), head (scale),
    hands=('fist','open'), fingers, finger_len, ears ('human'|'goblin'|'pointed'|None), nose (scale),
    belly, bust, feet ('bare'|'boot'), toes, gaunt (0..1 thinner torso), neck (radius scale), no_legs.
    Returns (graph, parts, sculpt_ops)."""
    s = P["H"] / 1.8
    bulk, limb, hs = P.get("bulk", 1.0), P.get("limb", 1.0), P.get("head", 1.0)
    g = HB.Graph()
    hips, sp, ch, nk, hd = (_j(J, b) for b in ("hips", "spine", "chest", "neck", "head"))
    top = _j(J, "head", 1)
    gaunt = P.get("gaunt", 0.0)
    tw = bulk * (1 - 0.25 * gaunt)
    pel = g.v(hips + V((0, 0.005 * s, -0.02 * s)), (0.145 * s * tw, 0.105 * s * tw))
    waist = g.v(_lerp(hips, sp, 0.9), (0.125 * s * tw + P.get("belly", 0) * 0.3, 0.095 * s * tw + P.get("belly", 0)))
    g.link(pel, waist)
    chl = g.v(_lerp(sp, ch, 0.6) + V((0, 0.0, 0)), (0.145 * s * tw, 0.105 * s * tw + P.get("belly", 0) * 0.4))
    g.link(waist, chl)
    chu = g.v(_lerp(ch, nk, 0.45), (0.16 * s * tw, 0.108 * s * tw))
    g.link(chl, chu)
    ntop = g.v(_lerp(ch, nk, 0.92), (0.1 * s * tw, 0.075 * s * tw))
    g.link(chu, ntop)
    nr = 0.05 * s * P.get("neck", 1.0)
    neck = g.v(_lerp(nk, hd, 0.5), nr)
    g.link(ntop, neck)
    # head: a small skin node inside the skull, the shape comes from fleshy volumes (head())
    up = (top - hd).normalized()
    hj = g.v(hd + up * 0.07 * s * hs + V((0, -0.01, 0)) * s, (0.05 * s * hs, 0.055 * s * hs))
    g.link(neck, hj)
    parts, ops = [], []
    head(parts, ops, hd, up, s * hs, P)
    # arms
    for side, sg in (("L", 1), ("R", -1)):
        sh, el = _j(J, f"upper_arm.{side}"), _j(J, f"upper_arm.{side}", 1)
        wr = _j(J, f"forearm.{side}", 1)
        ar = 0.052 * s * limb
        shn = g.v(sh + V((-sg * 0.01, 0, 0.005)) * s, (ar * 1.15, ar * 1.1))
        g.link(chu, shn)
        bic = g.v(_lerp(sh, el, 0.45), (ar * 0.95, ar * 0.95))
        g.link(shn, bic)
        eln = g.v(el, (ar * 0.72, ar * 0.72))
        g.link(bic, eln)
        fa = g.v(_lerp(el, wr, 0.35), (ar * 0.8, ar * 0.72))
        g.link(eln, fa)
        wrn = g.v(wr, (ar * 0.52, ar * 0.42))
        g.link(fa, wrn)
        hs_side = P.get("hands", ("fist", "fist"))[0 if side == "L" else 1]
        hand(g, wrn, J, side, hs_side, P.get("fingers", 4), P.get("finger_len", 1.0) * s, s * P.get("hand_r", 1.0),
             claw=P.get("claw", 0.0))
    # legs
    if not P.get("no_legs"):
        for side, sg in (("L", 1), ("R", -1)):
            hp, kn = _j(J, f"thigh.{side}"), _j(J, f"thigh.{side}", 1)
            an = _j(J, f"shin.{side}", 1)
            lr = 0.08 * s * limb
            hpn = g.v(hp + V((0, 0.005, 0.01)) * s, (lr, lr))
            g.link(pel, hpn)
            th = g.v(_lerp(hp, kn, 0.45), (lr * 0.9, lr * 0.9))
            g.link(hpn, th)
            knn = g.v(kn, (lr * 0.66, lr * 0.66))
            g.link(th, knn)
            calf = g.v(_lerp(kn, an, 0.3) + V((0, 0.012, 0)) * s, (lr * 0.66, lr * 0.66))
            g.link(knn, calf)
            ann = g.v(an, (lr * 0.45, lr * 0.45))
            g.link(calf, ann)
            foot(g, ann, J, side, s * P.get("foot_r", 1.0), P.get("feet", "bare"), P.get("toes", 0))
    muscles(parts, ops, J, s, P)
    return g, parts, ops


def muscles(parts, ops, J, s, P):
    """Surface anatomy volumes: deltoids, pectorals, trapezius, clavicles, glutes, calves (scaled by P['muscle'])."""
    m = P.get("muscle", 0.7)
    E, Cp = HB.ellipsoid, HB.capsule
    ch, nk, hips = _j(J, "chest"), _j(J, "neck"), _j(J, "hips")
    bulk = P.get("bulk", 1.0)
    for side, sg in (("L", 1), ("R", -1)):
        sh, el = _j(J, f"upper_arm.{side}"), _j(J, f"upper_arm.{side}", 1)
        wr = _j(J, f"forearm.{side}", 1)
        if m > 0:
            parts.append(E(_lerp(sh, el, 0.18) + V((0, 0, 0.012)) * s, (0.05 * s * m ** 0.5, 0.052 * s * m ** 0.5, 0.055 * s), seg=16, rings=10))
            parts.append(E(_lerp(ch, nk, 0.35) + V((sg * 0.07, -0.075 * bulk, -0.02)) * s,
                           (0.07 * s, 0.03 * s * m, 0.055 * s), rot=(0, sg * 10, 0), seg=16, rings=10))
            parts.append(Cp(_lerp(ch, nk, 0.95) + V((0, 0.035, 0)) * s, sh + V((-sg * 0.03, 0.02, 0.012)) * s,
                            0.035 * s * m ** 0.5, 0.025 * s, seg=12))
            parts.append(E(_lerp(sh, el, 0.55) + V((0, -0.012, 0)) * s, (0.036 * s * m ** 0.5,) * 2 + (0.07 * s,), seg=12, rings=8))
            parts.append(E(_lerp(el, wr, 0.3), (0.034 * s * m ** 0.5, 0.032 * s * m ** 0.5, 0.06 * s), seg=12, rings=8))
        # clavicle (always, thin)
        parts.append(Cp(_lerp(ch, nk, 0.8) + V((sg * 0.02, -0.05, 0)) * s, sh + V((-sg * 0.02, -0.02, 0.018)) * s, 0.011 * s, 0.012 * s, seg=10))
        if not P.get("no_legs"):
            hp, kn = _j(J, f"thigh.{side}"), _j(J, f"thigh.{side}", 1)
            an = _j(J, f"shin.{side}", 1)
            parts.append(E(hips + V((sg * 0.065, 0.06, -0.06)) * s, (0.075 * s, 0.06 * s * max(m, 0.4), 0.08 * s), seg=16, rings=10))
            parts.append(E(_lerp(hp, kn, 0.4) + V((0, -0.02, 0)) * s, (0.06 * s * max(m, 0.5), 0.055 * s * max(m, 0.5), 0.14 * s), seg=16, rings=10))
            parts.append(E(_lerp(kn, an, 0.28) + V((0, 0.022, 0)) * s, (0.042 * s * max(m, 0.5), 0.042 * s * max(m, 0.5), 0.085 * s), seg=14, rings=8))
    if P.get("ribs_show"):
        for k in range(4):
            z = _lerp(_j(J, "spine"), ch, 0.5 + 0.2 * k).z
            for sg in (1, -1):
                ops.append(("push", (sg * 0.09 * s, -0.08 * s, z - 0.018 * s), (0.04 * s, 0.05 * s, 0.008 * s), -0.004 * s))




# =============================================================================== fleshy head
def head(parts, ops, hd, up, s, P):
    """Head volumes relative to the head joint (x right->left, f forward, u up), metres for a 1.8 m human * s.
    P: nose (scale), nose_hook, chin (forward, m), jaw (width scale), ears ('human'|'goblin'|'pointed'|None),
    gaunt (0..1 sunken cheeks), brow (scale), tusks (bool), warts (count), mouth (width scale), eye (scale)."""
    import random
    E, Cp = HB.ellipsoid, HB.capsule
    fw = V((0, -1, 0))
    X = V((1, 0, 0))

    def Q(x, f, u):
        return hd + X * x * s + fw * f * s + up * u * s
    ns = P.get("nose", 1.0)
    jw = P.get("jaw", 1.0)
    ch = P.get("chin", 0.0)
    gaunt = P.get("gaunt", 0.0)
    bw = P.get("brow", 1.0)
    mw = P.get("mouth", 1.0)
    ey = P.get("eye", 1.0)
    parts.append(E(Q(0, -0.012, 0.13), (0.073 * s, 0.093 * s, 0.087 * s), seg=28, rings=18))          # cranium
    parts.append(E(Q(0, 0.03, 0.14), (0.066 * s, 0.056 * s, 0.06 * s), seg=24, rings=14))            # forehead
    parts.append(E(Q(0, 0.045, 0.078), (0.056 * s * (1 - 0.1 * gaunt), 0.048 * s, 0.05 * s), seg=24, rings=14))
    parts.append(E(Q(0, 0.035 + ch * 0.5, 0.03), (0.05 * s * jw, 0.05 * s, 0.034 * s), seg=24, rings=14))  # jaw
    parts.append(E(Q(0, 0.074 + ch, 0.003 - ch * 0.4), (0.024 * s * jw, 0.019 * s, 0.022 * s), seg=16, rings=10))
    for sg in (1, -1):
        parts.append(E(Q(sg * 0.044 * jw, 0.01, 0.035), (0.011 * s, 0.02 * s, 0.02 * s), seg=12, rings=8))
        parts.append(E(Q(sg * 0.043, 0.06, 0.084), (0.017 * s, 0.014 * s, 0.011 * s), seg=12, rings=8))   # cheekbone
    # brow
    brw = [Q(-0.046, 0.072, 0.117), Q(-0.02, 0.083, 0.121), Q(0.02, 0.083, 0.121), Q(0.046, 0.072, 0.117)]
    for a_, b_ in zip(brw[:-1], brw[1:]):
        parts.append(Cp(a_, b_, 0.01 * s * bw, 0.01 * s * bw, seg=10))
    # nose
    tip = Q(0, 0.112 + 0.035 * (ns - 1), 0.066 - 0.012 * (ns - 1))
    parts.append(Cp(Q(0, 0.09, 0.113), tip, 0.0085 * s * ns ** 0.4, 0.011 * s * ns ** 0.6, seg=12))
    parts.append(E(tip, (0.013 * s * ns ** 0.6, 0.012 * s * ns ** 0.5, 0.012 * s * ns ** 0.5), seg=14, rings=10))
    if P.get("nose_hook"):
        parts.append(Cp(tip, tip + (fw * 0.004 - up * 0.022) * s * ns, 0.011 * s * ns ** 0.5, 0.006 * s, seg=10))
    for sg in (1, -1):
        parts.append(E(Q(sg * 0.014 * ns ** 0.5, 0.1 + 0.02 * (ns - 1), 0.062 - 0.01 * (ns - 1)),
                       (0.009 * s * ns ** 0.5, 0.009 * s, 0.007 * s), seg=10, rings=6))
    # lips
    parts.append(Cp(Q(-0.021 * mw, 0.093 + ch * 0.3, 0.04), Q(0.021 * mw, 0.093 + ch * 0.3, 0.04), 0.0058 * s, 0.0058 * s, seg=10))
    parts.append(Cp(Q(-0.018 * mw, 0.09 + ch * 0.6, 0.027), Q(0.018 * mw, 0.09 + ch * 0.6, 0.027), 0.0068 * s, 0.0068 * s, seg=10))
    ops.append(("push", tuple(Q(0, 0.1 + ch * 0.4, 0.0335)), (0.024 * s * mw, 0.01 * s, 0.003 * s), -0.004 * s))
    if P.get("tusks"):
        for sg in (1, -1):
            b0 = Q(sg * 0.02 * mw, 0.088 + ch * 0.6, 0.026)
            parts.append(Cp(b0, b0 + (up * 0.028 + fw * 0.006 + X * sg * 0.004) * s, 0.0055 * s, 0.0015 * s, seg=8))
    # eyes: socket dent + eyeball bulge
    for sg in (1, -1):
        ec = Q(sg * 0.032, 0.088, 0.097)
        ops.append(("push", tuple(ec), (0.019 * s * ey, 0.02 * s, 0.014 * s * ey), -0.013 * s * ey))
        if gaunt:
            ops.append(("push", tuple(Q(sg * 0.045, 0.06, 0.055)), 0.022 * s, -0.012 * s * gaunt))
            ops.append(("push", tuple(Q(sg * 0.066, 0.02, 0.12)), 0.022 * s, -0.008 * s * gaunt))
        ear = P.get("ears", "human")
        ec2 = Q(sg * 0.074, -0.004, 0.098)
        if ear == "human":
            parts.append(E(ec2 + X * sg * 0.004 * s, (0.009 * s, 0.021 * s, 0.03 * s), rot=(0, 0, sg * 18), seg=14, rings=10))
            rim = [ec2 + (X * sg * 0.009 + up * u + fw * f) * s for f, u in ((0.012, 0.02), (-0.005, 0.03), (-0.02, 0.012), (-0.017, -0.012), (-0.004, -0.028))]
            for a_, b_ in zip(rim[:-1], rim[1:]):
                parts.append(Cp(a_, b_, 0.0045 * s, 0.0045 * s, seg=8))
        elif ear in ("goblin", "pointed"):
            ln = (0.17 if ear == "goblin" else 0.07) * s
            base = ec2
            tipp = base + X * sg * ln + up * ln * 0.38 + fw * -0.03 * s
            mid = _lerp(base, tipp, 0.4) + up * 0.012 * s
            parts.append(Cp(base, mid, 0.032 * s, 0.028 * s, seg=14, flat=0.3))
            parts.append(Cp(mid, tipp, 0.028 * s, 0.003 * s, seg=14, flat=0.28))
            # rim + inner hollow
            parts.append(Cp(base + up * 0.026 * s, tipp, 0.006 * s, 0.002 * s, seg=8))
            ops.append(("push", tuple(_lerp(base, tipp, 0.35) + fw * 0.006 * s), (0.04 * s, 0.02 * s, 0.018 * s), -0.004 * s))
    rnd = random.Random(P.get("seed", 3))
    for _ in range(P.get("warts", 0)):
        x = rnd.uniform(-0.05, 0.05)
        c = Q(x, 0.075 + rnd.uniform(0, 0.03), rnd.uniform(0.02, 0.12))
        ops.append(("bump_near", tuple(c), 0.006 * s, 0.004 * s))
