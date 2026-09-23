"""Player classes (v0.2 dark-fantasy look): warrior (Guerrier), mage, ranger (Rôdeur).
Clips: Idle Walk Attack Cast Hit Death + Roll."""
import math

import bpy
from mathutils import Matrix, Vector

import anatomy as A
import charmats as CM
import clips as CL
import garments as G
import gear as GR
import humanoid as H
import hq
import outfits as O
from humanoid import arm_r, over, plus
from kit import gn
from kit import materials as KM

HERO_L = dict(H.HUMAN, shoulder=1.45, neck=1.48, shoulder_w=0.2, hip_w=0.095, arm_out=0.075)


def cloth(name, color, kind="wool", seed=0, hem_dirt=0.5, **kw):
    """Wind-swaying cloth (Cloth* name) sharing the 'Cloth' texture set."""
    return CM.group(KM.cloth(name, color, kind, seed=seed, hem_dirt=hem_dirt, **kw), "Cloth")


# ============================================================================ WARRIOR
def warrior_dress(ctx):
    J = ctx.J
    steel = KM.metal("War_Steel", "steel", rust=0.22, grime=0.6, wear=0.75, seed=1, scratches=0.7)
    plate = KM.engraved_metal("War_Plate", "steel", pattern="filigree", rust=0.12, grime=0.7, wear=0.7, seed=2, scale=0.8)
    dark = KM.metal("War_DarkSteel", "blackiron", rust=0.3, grime=0.5, wear=0.8, seed=3)
    mail = CM.chainmail("War_Mail", seed=4)
    leather = KM.leather("War_Leather", "#3a2616", seed=5, wear=0.6)
    strap = KM.leather("War_Strap", "#5b3b22", seed=6, wear=0.7)
    brass = KM.metal("War_Brass", "bronze", rust=0.35, grime=0.6, wear=0.8, seed=7)
    gambeson = KM.cloth("War_Gambeson", "#4a3b2a", "linen", seed=8, hem_dirt=0.3)
    tabard = CM.trim(cloth("Cloth_War_Tabard", "#5a1612", "wool", seed=9, hem_dirt=0.6), "#a07a34", width=0.03, inset=0.012)
    cape_m = cloth("Cloth_War_Cape", "#2e0e0d", "wool", seed=10, hem_dirt=0.9)
    hair_m = CM.hair("War_Beard", "#3b2a1c", color2="#1a110b", tip="#6a4c33", axis=(0, 0, 1), seed=11)
    wood = KM.wood("War_ShieldWood", "#4d3421", "#2a1b10", seed=12, axis="Y")
    blade = KM.metal("War_Blade", "steel", rust=0.08, grime=0.3, wear=0.9, seed=13, scratches=1.0)
    grip = KM.leather("War_Grip", "#24160d", seed=14)
    shield_face = shield_paint("War_ShieldFace", "#5a1612", "#a07a34", "#2a2420")

    # ---- under layers: trousers (padded), boots, mail shirt + mail skirt, gambeson collar
    trou = O.trousers(ctx, "War_Trousers", gambeson, z_top=1.0, bottom=0.55, offset=0.01)
    ctx.cloth(trou, smooth=4)
    bts = O.boots(ctx, "War_Boots", leather, top=0.35, offset=0.016)
    ctx.cloth(bts, smooth=3)
    shirt = O.shirt(ctx, "War_Mail", mail, z_bot=0.93, sleeve=("forearm", 0.8), offset=0.012, neck=0.25)
    ctx.cloth(shirt, smooth=5)
    mskirt = G.skirt("War_MailSkirt", ctx.body, z_top=1.0, z_bot=0.6, seg=40, rings=8, flare=0.07, folds=10,
                     fold_amp=0.008, clearance=0.02, mat=mail, seed=2, front_gap=18)
    ctx.cloth(mskirt, smooth=18, thickness=0.006)
    ctx.layer(trou, [bts, mskirt])
    # ---- plate: breastplate (smoothed torso shell), pauldrons, vambraces, greaves, gauntlets
    nb = O.nearest_bone(ctx)
    n0 = Vector(J["neck"][0])
    bp = G.region_shell(ctx.body, "War_Breastplate",
                        lambda c, n: nb(c) in ("chest", "spine") and 1.02 < c.z < n0.z - 0.02 and abs(c.x) < 0.2,
                        [((0, 0, 1.02), (0, 0, -1), 0.4), (n0 + Vector((0, 0, -0.03)), (0, 0.3, 1), 0.2)],
                        offset=0.034, smooth=0, mat=plate, relax=0.0)
    _plate_smooth(bp, 25)
    _ridge(bp, 0.012)
    ctx.cloth(bp, smooth=10, thickness=0.006)
    ctx.layer(shirt, [bp])
    for side, sx in (("L", 1), ("R", -1)):
        pa = pauldron(ctx, side, plate, dark)
        ctx.piece(pa, {f"upper_arm.{side}": 0.7, "chest": 0.3}, covers=True)
    vam = _limb_plate(ctx, "War_Vambrace", "forearm", 0.25, 0.8, 0.028, steel)
    ctx.cloth(vam, smooth=3, thickness=0.004)
    gl = O.gloves(ctx, "War_Gauntlets", leather, cuff=0.78, offset=0.005)
    ctx.cloth(gl, smooth=2)
    grv = _limb_plate(ctx, "War_Greaves", "shin", 0.08, 0.62, 0.03, steel, front_only=True)
    ctx.cloth(grv, smooth=3, thickness=0.004)
    for side in ("L", "R"):
        kn = Vector(J[f"shin.{side}"][0])
        cop = GR.lathe(f"War_Knee{side}", [(0.0, 0.045), (0.012, 0.043), (0.028, 0.03), (0.036, 0.0)], 10, dark)
        GR.xf(cop, Matrix.Translation(kn + Vector((0, -0.05, 0.005))) @ GR.R(90, 0, 0))
        ctx.piece(cop, {f"shin.{side}": 0.6, f"thigh.{side}": 0.4}, covers=True)
    # ---- tabard (front/back panels) + belt
    tb = G.skirt("Cloth_War_TabardPanels", ctx.body, z_top=1.04, z_bot=0.5, seg=44, rings=14, flare=0.05, folds=7,
                 fold_amp=0.012, clearance=0.042, mat=tabard, seed=5, panels=[(-38, 38), (142, 218)], back_long=0.08)
    ctx.cloth(tb, smooth=22, thickness=0.004)
    bl = O.belt(ctx, "War_Belt", strap, 1.02, height=0.05, offset=0.05, thickness=0.01, buckle_mat=brass)
    ctx.cloth(bl, smooth=10, hem=False)
    pch = GR.pouch("War_Pouch", strap, (0.07, 0.035, 0.08), seed=3)
    GR.xf(pch, Matrix.Translation((0.15, -0.09, 0.96)) @ GR.R(0, 0, 25))
    ctx.piece(pch, {"hips": 0.8, "thigh.L": 0.2})
    # ---- helmet + aventail, beard
    helm = helmet(ctx, plate, dark, brass)
    ctx.piece(helm, "head", covers=True)
    av = aventail(ctx, mail)
    ctx.cloth(av, smooth=6, thickness=0.004, post=O.blend_to_torso(lambda co: 0.0))
    bd = O.beard(ctx, "War_Beard", hair_m, length=0.008, chin=0.018, moustache=True)
    ctx.piece(bd, "head", covers=True)
    # ---- cape
    cp = G.cape("Cloth_War_Cape", ctx.body, J, length=1.12, width=0.21, seg=20, rows=22, clearance=0.075, flare=0.2,
                folds=5, fold_amp=0.03, hem_jag=0.05, seed=4, mat=cape_m, top_z=1.46)
    ctx.cloth(cp, smooth=30, thickness=0.004,
              post=O.blend_to_torso(lambda co: max(0.25, min(1.0, (co.z - 0.7) / 0.6)), ("chest", "spine")))
    # ---- weapons: sword (right hand), heater shield (left forearm)
    sw = GR.sword("War_Sword", blade, brass, grip, length=0.82, grip_len=0.14, guard_w=0.12)
    GR.xf(sw, GR.grip_frame(ctx, "R", tilt=14))
    ctx.piece(sw, "hand.R", arms_down=True, ground=False)
    sh = GR.heater_shield("War_Shield", shield_face, dark, wood, w=0.27, h=0.66)
    fa0, fa1 = ctx.P0.head["forearm.L"], ctx.P0.tail["forearm.L"]
    c = fa0.lerp(fa1, 0.5) + Vector((0.115, 0.0, 0.0))
    GR.xf(sh, Matrix.Translation(c) @ GR.R(0, 90, 0) @ Matrix.Translation((0, 0.05, 0.0)))
    ctx.piece(sh, "forearm.L", arms_down=True, ground=False)


def shield_paint(name, field, charge, dark):
    """Heraldic paint on weathered wood, read from the shield-local 'lp' attribute (face = +Z, top = +Y):
    per-pale field with a gold chevron and a central sun disc; chipped paint shows the wood."""
    from kit.materials import _finish, _new, coords
    m, nb, bsdf = _new(name, "shield_paint")
    lp = nb.node("ShaderNodeAttribute", {"attribute_type": "GEOMETRY", "attribute_name": "lp"}).outputs["Vector"]
    x, y, z = nb.sep(lp)
    v = coords(nb, "OBJECT", 1.0, 3)
    grain = nb.wave(nb.vmath("MULTIPLY", lp, (60.0, 4.0, 60.0)), 1.0, 6.0, 3.0, "BANDS", "X", "SIN").outputs["Fac"]
    wood = nb.mix("#3a2717", "#6a4a2c", grain)
    ax = nb.math("ABSOLUTE", x)
    chev = nb.math("ABSOLUTE", nb.sub(y, nb.sub(0.05, nb.mul(ax, 0.9))))
    chev = nb.maprange(chev, 0.05, 0.04, 0.0, 1.0)
    disc = nb.maprange(nb.math("SQRT", nb.add(nb.mul(x, x), nb.mul(nb.sub(y, 0.14), nb.sub(y, 0.14)))), 0.07, 0.065, 0.0, 1.0)
    rays = nb.math("SINE", nb.mul(nb.math("ARCTAN2", x, nb.sub(y, 0.14)), 12.0))
    ring = nb.mul(nb.maprange(nb.math("SQRT", nb.add(nb.mul(x, x), nb.mul(nb.sub(y, 0.14), nb.sub(y, 0.14)))), 0.075, 0.08, 1.0, 0.0),
                  nb.maprange(rays, 0.2, 0.5))
    ring = nb.mul(ring, nb.maprange(nb.math("SQRT", nb.add(nb.mul(x, x), nb.mul(nb.sub(y, 0.14), nb.sub(y, 0.14)))), 0.105, 0.1, 0.0, 1.0))
    paint = nb.mix(field, nb.mix(field, "#000000", 0.35), nb.math("GREATER_THAN", x, 0.0))
    paint = nb.mix(paint, charge, nb.math("MAXIMUM", chev, nb.math("MAXIMUM", disc, ring)))
    chip = nb.noise(nb.vmath("SCALE", lp, scale=14.0), 1.0, 8.0, 0.7).outputs["Fac"]
    edge = nb.maprange(nb.add(nb.mul(chip, 1.0), 0.0), 0.62, 0.66)
    col = nb.mix(paint, wood, edge)
    scr = nb.noise(nb.vmath("MULTIPLY", lp, (200.0, 8.0, 200.0)), 1.0, 2.0).outputs["Fac"]
    col = nb.mix(col, nb.mix(wood, "#000000", 0.3), nb.mul(nb.maprange(scr, 0.62, 0.7), 0.6))
    h = nb.sub(nb.mul(grain, 0.1), nb.mul(edge, 0.3))
    rough = nb.mixf(0.62, 0.85, edge)
    return _finish(m, nb, bsdf, col, rough, h, bump=1.0, bump_dist=0.003, dirt=0.6, dirt_color="#1a120c", wear=0.4,
                   vec=v, cavity_dist=0.05)


def _plate_smooth(ob, iters):
    bm = __import__("bmesh").new()
    bm.from_mesh(ob.data)
    inner = [v for v in bm.verts if not v.is_boundary]
    for _ in range(iters):
        __import__("bmesh").ops.smooth_vert(bm, verts=inner, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def _ridge(ob, amount):
    """Central ridge on a breastplate (front, x ~ 0)."""
    for v in ob.data.vertices:
        if v.co.y < 0:
            v.co.y -= amount * max(0.0, 1 - abs(v.co.x) / 0.05) ** 2
    ob.data.update()


def _limb_plate(ctx, name, bone, t0, t1, offset, mat, front_only=False):
    """Plate shell around both limbs between fractions t0..t1 of `bone` (vambraces / greaves)."""
    nb = O.nearest_bone(ctx)
    cuts = []
    for s in ("L", "R"):
        p0, d = O.along(ctx, f"{bone}.{s}", t0)
        p1, _ = O.along(ctx, f"{bone}.{s}", t1)
        dom = O.limb_domain(ctx, {f"{bone}.{s}", f"{bone.replace('forearm', 'upper_arm').replace('shin', 'thigh')}.{s}",
                                  f"{bone.replace('forearm', 'hand').replace('shin', 'foot')}.{s}"})
        cuts += [(p0, -d, 0.13, dom), (p1, d, 0.13, dom)]

    def keep(c, n):
        b = nb(c)
        if b not in (f"{bone}.L", f"{bone}.R"):
            return False
        if front_only and n.y > 0.35:
            return False
        return True
    ob = G.region_shell(ctx.body, name, keep, cuts, offset, None, 2, mat, relax=0.4)
    _plate_smooth(ob, 6)
    return ob


def pauldron(ctx, side, mat, trim_mat):
    """Layered pauldron: a dome over the shoulder + 3 overlapping lames down the upper arm (bind pose)."""
    J = ctx.J
    sh, el = (Vector(p) for p in J[f"upper_arm.{side}"])
    a = (el - sh).normalized()
    sx = 1 if side == "L" else -1
    out = Vector((sx, 0, 0))
    parts = []
    # dome: sphere cap centred a little inside the shoulder, clipped by a plane
    c = sh + out * 0.012 + Vector((0, 0.0, 0.02))
    R0 = 0.098
    rings, seg = 5, 14
    verts, faces = [], []
    up = (Vector((0, 0, 1)) + out * 0.5).normalized()
    for r in range(rings + 1):
        th = math.radians(8 + 92 * r / rings)
        for s in range(seg):
            ph = 2 * math.pi * s / seg
            # local frame: up axis, x = out, y = forward
            x = out - up * out.dot(up)
            x.normalize()
            y = up.cross(x)
            d = up * math.cos(th) + (x * math.cos(ph) + y * math.sin(ph)) * math.sin(th)
            rr = R0 * (1.0 + 0.1 * math.cos(ph)) * (1.05 if r == rings else 1.0)
            verts.append(c + d * rr)
    for r in range(rings):
        for s in range(seg):
            s2 = (s + 1) % seg
            faces.append((r * seg + s, r * seg + s2, (r + 1) * seg + s2, (r + 1) * seg + s))
    top = len(verts)
    verts.append(c + up * R0)
    for s in range(seg):
        faces.append((top, (s + 1) % seg, s))
    dome = G.new_obj(f"War_PauldronDome{side}", verts, faces, mat)
    # cut the medial part (neck side) off with a plane so it does not cross the collar
    bm = __import__("bmesh").new()
    bm.from_mesh(dome.data)
    kill = [f for f in bm.faces if (f.calc_center_median() - sh).dot(out) < -0.045]
    __import__("bmesh").ops.delete(bm, geom=kill, context="FACES")
    bm.to_mesh(dome.data)
    bm.free()
    G.outward_normals(dome, lambda p: c)
    GR.xf(dome, Matrix.Identity(4))
    G.plate(dome, 0.006, 0.0)
    parts.append(dome)
    # lames: open bands around the upper arm, each slightly smaller & lower, overlapping
    for i in range(3):
        cc = sh + a * (0.075 + 0.036 * i) + out * 0.004
        rad = 0.074 - 0.006 * i
        lv, lf = [], []
        n = 12
        for h, dz in ((0, 0.022), (1, -0.022)):
            for s in range(n + 1):
                ph = -math.pi * 0.72 + 1.44 * math.pi * s / n
                x = out - a * out.dot(a)
                x.normalize()
                y = a.cross(x)
                d = x * math.cos(ph) + y * math.sin(ph)
                lv.append(cc + d * (rad + 0.006 * (1 - h)) - a * dz)
        for s in range(n):
            lf.append((s, s + 1, n + 1 + s + 1, n + 1 + s))
        lame = G.new_obj(f"War_Lame{side}{i}", lv, lf, mat)
        G.outward_normals(lame, lambda p, cc=cc: cc + a * (p - cc).dot(a))
        G.plate(lame, 0.005, 0.0)
        parts.append(lame)
    ob = GR.join(parts, f"War_Pauldron{side}")
    return ob


def helmet(ctx, mat, dark, brass):
    """Open-faced bascinet: head shell (above the brows, down to the jaw at the sides/back), pointed crown,
    brass-edged rolled rim and a nasal bar."""
    c, k = ctx.head_c, ctx.head_k

    def keep(p, n):
        q = (p - c) / k
        if q.z > 0.03:
            return True
        if q.y > -0.035 and q.z > -0.085:
            return True
        return False
    hm = G.region_shell(ctx.body, "War_Helm", keep, [], 0.021 * k, None, 3, mat, relax=0.4)
    _plate_smooth(hm, 8)
    for v in hm.data.vertices:          # pointed crown (slightly back)
        q = (v.co - c) / k
        if q.z > 0.07:
            v.co.z += 0.03 * k * ((q.z - 0.07) / 0.06) ** 2
    hm.data.update()
    rim = O.rim_tube(ctx, "War_HelmRim", hm, brass, radius=0.005)
    G.plate(hm, 0.004, 0.001)
    nasal = GR.box("War_Nasal", (0.014, 0.008, 0.075), dark, 0.002, tuple(c + Vector((0, -0.104, -0.012)) * k))
    parts = [hm, nasal] + ([rim] if rim else [])
    return GR.join(parts, "War_Helmet")


def aventail(ctx, mat):
    """Mail curtain from the helmet's lower edge over the neck and the top of the shoulders."""
    c, k = ctx.head_c, ctx.head_k
    n0 = Vector(ctx.J["neck"][0])
    nb = O.nearest_bone(ctx)

    def keep(p, n):
        q = (p - c) / k
        b = nb(p)
        if b == "head":
            return q.z < 0.0 and (q.y > -0.02 or q.z < -0.1)
        if b == "neck":
            return True
        if b == "chest":
            return (p - n0).length < 0.2 and p.z > n0.z - 0.1
        return False
    return G.region_shell(ctx.body, "War_Aventail", keep, [], 0.024, None, 3, mat, relax=0.4)


def warrior_anim(ctx):
    P, body = ctx.P, ctx.body
    ex = None
    st = H.stance(drop=0.035, width=1.5, feet=(0.07, -0.08), toe_out=12, spine=(4, 0, 0), chest=(-1, 0, 0), head=(-2, 0, 0),
                  arms={"L": dict(fwd=16, out=18, twist=-22, elbow=70, hand=(0, 0, 0)),
                        "R": dict(fwd=8, out=14, twist=8, elbow=40, hand=(10, 0, 0))}, sway=0.014, breathe=1.3)
    g = H.gait(stride=0.8, lift=0.15, bob=0.035, lean=8.0, twist=8.0,
               arms={"L": dict(swing=0.3, fwd=18, elbow=80, twist=-32, out=18),
                     "R": dict(swing=0.8, fwd=4, elbow=46, out=13, hand=(12, 0, 0))})
    P.key_loop("Idle", 48, lambda t: H.idle_spec(P, t, st))
    P.key_loop("Walk", g["frames"], lambda p: H.gait_spec(P, p, g, st))
    base = H.idle_spec(P, 0, st)

    def sword(fwd, out, twist, elbow, hand=(0, 0, 0)):
        return {"upper_arm.R": arm_r("R", fwd, out, twist), "forearm.R": (-elbow, 0, 0), "hand.R": H.side_r("R", hand)}

    guard = {"upper_arm.L": arm_r("L", 30, 26, -30), "forearm.L": (-78, 0, 0)}
    # heavy overhead-diagonal slash: long wind-up, fast strike, heavy follow-through, slow recovery
    wind = over(plus(base, {"hips": {"r": (-3, 0, -14), "t": (0, 0.035, -0.02)}, "spine": (-6, 0, -14), "chest": (-10, 0, -24),
                            "head": (6, 0, 26)}), dict(sword(158, 38, 34, 80, (-14, 0, 0)), **guard))
    strike = over(plus(base, {"hips": {"r": (6, 0, 14), "t": (0, -0.08, -0.07)}, "spine": (10, 0, 14), "chest": (14, 0, 24),
                              "head": (-8, 0, -20)}), dict(sword(86, 8, 0, 4, (64, 0, 0)), **guard))
    follow = over(plus(base, {"hips": {"r": (7, 0, 19), "t": (0, -0.09, -0.09)}, "spine": (12, 0, 16), "chest": (16, 0, 30),
                              "head": (-10, 0, -24)}), dict(sword(50, -18, -16, 14, (58, 0, 0)), **guard))
    P.key_poses("Attack", [(0, base), (5, wind, "out"), (8, strike, "in3"), (10, follow, "out"), (15, base, "smooth")])
    raise_ = over(plus(base, {"hips": {"t": (0, 0.01, -0.07)}, "spine": (-6, 0, 0), "chest": (-12, 0, 0), "neck": (-6, 0, 0),
                              "head": (-16, 0, 0)}),
                  {**sword(170, 14, 0, 8, (72, 0, 0)), "upper_arm.L": arm_r("L", 26, 50, -24), "forearm.L": (-60, 0, 0)})
    roar = plus(raise_, {"chest": (-4, 0, 0), "head": (-6, 0, 0), "upper_arm.L": arm_r("L", 0, 8)})
    P.key_poses("Cast", [(0, base), (7, raise_, "out"), (13, roar, "smooth"), (19, base, "smooth")])
    P.key_poses("Hit", CL.hit_keys(base, 1.0))
    P.key_poses("Death", H.death_keys(P, body, base, "back", turn=10, exclude=ex, arms={
        "upper_arm.L": arm_r("L", 8, 28, 0), "forearm.L": (-8, 0, -85),
        "upper_arm.R": arm_r("R", 8, 66, 0), "forearm.R": (-6, 0, 90), "hand.R": (0, 0, 0)}))
    P.key_poses("Roll", CL.roll_keys(P, body, base, ex, arms={"upper_arm.L": arm_r("L", 60, 30, -30), "forearm.L": (-90, 0, 0)}))


WARRIOR = hq.Spec("warrior", HERO_L, build="hero", face="stern", faces=3400,
                  skin=dict(tone="#b07e62", tone2="#80503e", lips="#7d4238", stubble=0.6, age=0.3, seed=2),
                  eyes=dict(iris="#5d6f78", iris2="#2e3a3c"), dress=warrior_dress, animate=warrior_anim,
                  main_size=2048, cloth_size=1024, height=1.9, preview=("Walk", 5))
