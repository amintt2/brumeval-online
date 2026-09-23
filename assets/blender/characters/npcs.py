"""Town NPCs (v0.2): npc_elder, npc_merchant, npc_blacksmith, npc_alchemist, npc_guard, npc_innkeeper.
Clips: Idle, Walk (in place)."""
import math

from mathutils import Matrix, Vector

import charmats as CM
import garments as G
import gear as GR
import humanoid as H
import hq
import outfits as O
from humanoid import arm_r
from kit import materials as KM
from players import HERO_L, _limb_plate, _plate_smooth, cloth


def _walk(P, st, **kw):
    g = H.gait(**kw)
    P.key_loop("Idle", 48, lambda t: H.idle_spec(P, t, st))
    P.key_loop("Walk", g["frames"], lambda p: H.gait_spec(P, p, g, st))


def _slow_gait(**kw):
    g = dict(frames=24, stride=0.5, lift=0.08, duty=0.6, drop=0.03, bob=0.015, lean=2.0, twist=5.0, sway=0.016, roll=2.5,
             arm_swing=18.0, elbow=22.0, elbow_swing=8.0, run=False, strike=10.0, toeoff=26.0, head_bob=1.0, width=1.1,
             toe_out=8.0)
    g.update(kw)
    return g


def walking_stick(name, wood, metal, length=1.45, seed=2):
    """Gnarled stick with a knotty head, local +Z up from the grip."""
    from kit import gn
    import random
    rnd = random.Random(seed)
    pts = []
    for i in range(10):
        u = i / 9
        z = -0.9 * length * 0.62 / 0.62 * 0.62 + length * u - 0.0
        pts.append((0.015 * math.sin(u * 8 + 1) + rnd.uniform(-0.004, 0.004), 0.012 * math.sin(u * 6.1), -0.62 * length + length * u,
                    1.0 - 0.2 * u))
    pts.append((0.05, 0.0, pts[-1][2] + 0.06, 1.2))
    pts.append((0.075, 0.0, pts[-1][2] - 0.02, 0.8))
    cu = gn.make_curve([pts], name + "_Curve", kind="NURBS", resolution=4)
    gn.curve_to_mesh(cu, radius=0.016, profile_res=7)
    ob = gn.apply(cu)
    gn.displace(ob, strength=0.004, scale=16.0, detail=3.0, seed=seed, voronoi=0.0)
    gn.apply(ob)
    ob.data.materials.clear()
    ob.data.materials.append(wood)
    fer = GR.lathe(name + "_Ferrule", [(0.0, 0.014), (0.045, 0.017), (0.06, 0.014)], 8, metal)
    GR.xf(fer, Matrix.Translation((pts[0][0], pts[0][1], pts[0][2] - 0.01)))
    return GR.join([ob, fer], name)


# ============================================================================ ELDER
ELDER_L = H.scaled(HERO_L, 0.96, shoulder_w=0.19, hip_w=0.09)


def elder_dress(ctx):
    robe_c = "#4a3524"
    top_m = KM.cloth("Eld_RobeTop", robe_c, "wool", seed=61, hem_dirt=0.0)
    robe = CM.trim(cloth("Cloth_Eld_Robe", robe_c, "wool", seed=62, hem_dirt=1.0), "#7a6a44", width=0.03, inset=0.02)
    mantle_m = KM.cloth("Eld_Mantle", "#5d4a32", "burlap", seed=63, hem_dirt=0.0)
    rope = KM.leather("Eld_Rope", "#8a7450", seed=64, wear=0.2)
    hair_m = CM.hair("Eld_Hair", "#d8d3ca", color2="#8f887c", tip="#f0ece4", seed=65)
    leather = KM.leather("Eld_Leather", "#3a2a1c", seed=66)
    wood = KM.bark("Eld_Stick", "oak", color="#5a4630", color2="#2b2117", seed=67, moss=0.15)
    iron = KM.metal("Eld_Iron", "iron", rust=0.6, seed=68)
    bts = O.boots(ctx, "Eld_Shoes", leather, top=0.75, offset=0.01)
    ctx.cloth(bts, smooth=3)
    top = O.shirt(ctx, "Eld_RobeTop", top_m, z_bot=0.98, sleeve=("forearm", 0.4), offset=0.016, neck=0.3)
    ctx.cloth(top, smooth=5)
    rb = G.skirt("Cloth_Eld_Robe", ctx.body, z_top=1.02, z_bot=0.04, seg=44, rings=18, flare=0.15, folds=8,
                 fold_amp=0.02, clearance=0.02, mat=robe, seed=8, back_long=0.02)
    ctx.cloth(rb, smooth=26, thickness=0.005)
    for side in ("L", "R"):
        sl = O.flared_sleeve(ctx, f"Cloth_Eld_Sleeve{side}", robe, side, t0=0.26, t1=1.0, flare=0.05, droop=0.03)
        ctx.cloth(sl, smooth=6, thickness=0.004)
    mt = O.mantle(ctx, "Eld_Mantle", mantle_m, drop=0.16, offset=0.03, sleeve=0.3)
    ctx.cloth(mt, smooth=6, thickness=0.005)
    ctx.layer(top, [mt])
    bl = O.belt(ctx, "Eld_Rope", rope, 0.99, height=0.03, offset=0.04, thickness=0.012)
    ctx.cloth(bl, smooth=12, hem=False)
    hr = O.hair_cap(ctx, "Eld_Hair", hair_m, hairline=0.075, back=-0.08, offset=0.008, volume=0.008, long=0.1)
    ctx.piece(hr, {"head": 0.85, "neck": 0.15}, covers=True)
    bd = O.beard(ctx, "Eld_Beard", hair_m, length=0.012, chin=0.03, moustache=True, long=0.2, width=1.0)
    ctx.piece(bd, {"head": 0.8, "neck": 0.2}, covers=True)
    idle = H.idle_spec(ctx.P0, 0, elder_stance())
    g = ctx.posed_grip("R", idle)
    st = walking_stick("Eld_Stick", wood, iron, (g.z + 0.02) / 0.62)
    GR.xf(st, Matrix.Translation(g))
    ctx.held(st, "hand.R", idle)


def elder_stance():
    return H.stance(drop=0.035, width=1.25, feet=(0.03, -0.03), toe_out=12, hips=(2, 0, 0), spine=(9, 0, 0), chest=(8, 0, 0),
                    neck=(-7, 0, 0), head=(-9, 0, 0), sway=0.008, look=4.5, breathe=1.2,
                    arms={"L": dict(fwd=16, out=9, twist=-22, elbow=58), "R": dict(fwd=22, out=12, twist=10, elbow=58)})


def elder_anim(ctx):
    P = ctx.P
    st = elder_stance()
    _walk(P, st, **_slow_gait(frames=26, stride=0.4, lift=0.065, duty=0.63, drop=0.04, bob=0.012, twist=4.0, arm_swing=10.0,
                              elbow=20.0, elbow_swing=6.0, toeoff=22.0, strike=8.0, width=1.15,
                              arms={"L": dict(swing=0.8, fwd=16, elbow=55, twist=-22, out=9),
                                    "R": dict(swing=0.8, fwd=28, elbow=76, out=12, twist=10)}))


ELDER = hq.Spec("npc_elder", ELDER_L, build="elder", face="old", faces=3000,
                skin=dict(tone="#c29c80", tone2="#93684f", lips="#8c5a52", stubble=0.0, age=1.0, seed=11, flush=0.6,
                          brow="#d8d3ca", brow_amt=0.6),
                eyes=dict(iris="#5a6a70", iris2="#2f3a3e"), dress=elder_dress, animate=elder_anim, kind="npc",
                main_size=1024, cloth_size=1024, height=1.75, preview=("Walk", 6))


# ============================================================================ MERCHANT (woman)
MERCH_L = H.scaled(HERO_L, 0.94, shoulder_w=0.175, hip_w=0.092)


def merchant_dress(ctx):
    dress_m = KM.cloth("Mer_Bodice", "#6a2a2a", "wool", seed=71, hem_dirt=0.0)
    skirt_m = CM.trim(cloth("Cloth_Mer_Skirt", "#3d4a5c", "wool", seed=72, hem_dirt=0.9), "#b08a3a", width=0.03, inset=0.02)
    apron_m = CM.trim(cloth("Cloth_Mer_Apron", "#b9ad90", "linen", seed=73, hem_dirt=0.6), "#6a2a2a", width=0.015, inset=0.01)
    shawl_m = CM.trim(cloth("Cloth_Mer_Shawl", "#7a5a2a", "wool", seed=74, hem_dirt=0.1), "#3d4a5c", width=0.02, inset=0.012)
    scarf_m = KM.cloth("Mer_Headscarf", "#8a3a22", "linen", seed=75, hem_dirt=0.0)
    blouse = KM.cloth("Mer_Blouse", "#c9bda4", "linen", seed=76, hem_dirt=0.0)
    leather = KM.leather("Mer_Leather", "#4a2e1c", seed=77)
    brass = KM.metal("Mer_Brass", "bronze", rust=0.3, seed=78)
    hair_m = CM.hair("Mer_Hair", "#4a2a18", color2="#1c0f08", tip="#7a4a2a", seed=79)
    bts = O.boots(ctx, "Mer_Shoes", leather, top=0.7, offset=0.01)
    ctx.cloth(bts, smooth=3)
    sh = O.shirt(ctx, "Mer_Blouse", blouse, z_bot=0.96, sleeve=("forearm", 0.7), offset=0.012, neck=0.3)
    ctx.cloth(sh, smooth=5)
    bod = O.shirt(ctx, "Mer_Bodice", dress_m, z_bot=0.95, sleeve=None, offset=0.02, neck=0.05)
    ctx.cloth(bod, smooth=6, thickness=0.003)
    ctx.layer(sh, [bod])
    sk = G.skirt("Cloth_Mer_Skirt", ctx.body, z_top=1.0, z_bot=0.06, seg=48, rings=18, flare=0.2, folds=11, fold_amp=0.02,
                 clearance=0.02, mat=skirt_m, seed=9)
    ctx.cloth(sk, smooth=26, thickness=0.005)
    ap = G.skirt("Cloth_Mer_Apron", ctx.body, z_top=0.99, z_bot=0.3, seg=48, rings=12, flare=0.2, folds=6, fold_amp=0.01,
                 clearance=0.034, mat=apron_m, seed=10, panels=[(-50, 50)])
    ctx.cloth(ap, smooth=26, thickness=0.003, covers=False)
    sw = O.mantle(ctx, "Cloth_Mer_Shawl", shawl_m, drop=0.2, offset=0.04, sleeve=0.3)
    ctx.cloth(sw, smooth=6, thickness=0.004)
    bl = O.belt(ctx, "Mer_Belt", leather, 1.0, height=0.035, offset=0.05, thickness=0.008, buckle_mat=brass)
    ctx.cloth(bl, smooth=12, hem=False)
    pc = GR.pouch("Mer_Purse", leather, (0.08, 0.035, 0.09), seed=4)
    GR.xf(pc, Matrix.Translation((-0.16, -0.08, 0.94)) @ GR.R(0, 0, -30))
    ctx.piece(pc, {"hips": 0.8, "thigh.R": 0.2})
    hr = O.hair_cap(ctx, "Mer_Hair", hair_m, hairline=0.05, back=-0.06, offset=0.008, volume=0.01)
    ctx.piece(hr, "head", covers=True)
    # headscarf: hood-like cap over the hair, tied at the nape
    sc = G.hood("Mer_Headscarf", ctx.J, face_open=(0.078, 0.14), size=1.0, peak=0.0, cowl_r=0.12, mat=scarf_m,
                cowl_z=ctx.J["neck"][0][2] + 0.04)
    ctx.cloth(sc, smooth=4, thickness=0.004, post=O.blend_to_torso(lambda co: 0.0))


def merchant_anim(ctx):
    P = ctx.P
    zp = ctx.L["pelvis"]
    st = H.stance(drop=0.02, width=1.2, feet=(0.03, -0.02), toe_out=12, spine=(0, 0, 0), chest=(-2, 0, 0), head=(2, 0, 0),
                  sway=0.014, look=5.0,
                  arms={"L": dict(fwd=10, out=10, elbow=70), "R": dict(fwd=10, out=10, elbow=70)},
                  arm_ik={"L": {"t": (0.05, -0.23, zp + 0.05), "pole": (1, 0.6, -0.4), "hand": (-20, 0, 25)},
                          "R": {"t": (-0.05, -0.235, zp + 0.06), "pole": (-1, 0.6, -0.4), "hand": (-20, 0, -25)}})
    _walk(P, st, **_slow_gait(frames=22, stride=0.46, arm_swing=16.0, elbow=20.0, elbow_swing=10.0, twist=5.0))


MERCHANT = hq.Spec("npc_merchant", MERCH_L, build="female", face="woman", faces=3000,
                   skin=dict(tone="#c89878", tone2="#9a6a52", lips="#9a4a48", stubble=0.0, age=0.3, seed=13, flush=0.7,
                             brow="#3a2214", eyeliner=0.7),
                   eyes=dict(iris="#6a4a2a", iris2="#2e1d10"), dress=merchant_dress, animate=merchant_anim, kind="npc",
                   main_size=1024, cloth_size=1024, height=1.72, preview=("Walk", 5))


# ============================================================================ BLACKSMITH
SMITH_L = H.scaled(HERO_L, 1.0, shoulder_w=0.215, hip_w=0.1, arm_out=0.085)


def smith_hammer(name, iron, wood, leather):
    head = GR.box(name + "_Head", (0.13, 0.055, 0.055), iron, 0.006, (0, 0, 0.0))
    face = GR.lathe(name + "_Face", [(0.0, 0.03), (0.02, 0.028)], 8, iron)
    GR.xf(face, Matrix.Translation((0.065, 0, 0)) @ GR.R(0, 90, 0))
    handle = GR.lathe(name + "_Handle", [(-0.38, 0.016), (-0.1, 0.017), (0.0, 0.015)], 8, wood)
    GR.xf(handle, Matrix.Translation((0, 0, 0)))
    wrap = GR.lathe(name + "_Wrap", [(-0.36, 0.019), (-0.22, 0.019)], 8, leather, cap0=False, cap1=False)
    ob = GR.join([head, face, handle, wrap], name)
    GR.xf(ob, Matrix.Translation((0, 0, 0.29)))           # grip centre at the origin (wrap)
    return ob


def smith_dress(ctx):
    shirt_m = KM.cloth("Smi_Shirt", "#5a4a38", "linen", seed=81, hem_dirt=0.3)
    trou_m = KM.cloth("Smi_Trousers", "#2d2a26", "wool", seed=82, hem_dirt=0.6)
    apron_m = KM.leather("Smi_Apron", "#4a2e1a", seed=83, wear=0.9, dirt=0.8)
    leather = KM.leather("Smi_Leather", "#2e1f14", seed=84)
    iron = KM.metal("Smi_Iron", "blackiron", rust=0.4, grime=0.8, seed=85)
    wood = KM.wood("Smi_Wood", "#5a3e26", "#2c1c10", seed=86)
    hair_m = CM.hair("Smi_Hair", "#2a1a10", color2="#0e0806", tip="#5a3a22", seed=87)
    trou = O.trousers(ctx, "Smi_Trousers", trou_m, z_top=1.0, bottom=0.6, offset=0.012)
    ctx.cloth(trou, smooth=4)
    bts = O.boots(ctx, "Smi_Boots", leather, top=0.3, offset=0.014)
    ctx.cloth(bts, smooth=3)
    ctx.layer(trou, [bts])
    sh = O.shirt(ctx, "Smi_Shirt", shirt_m, z_bot=0.95, sleeve=("upper_arm", 0.55), offset=0.012, neck=0.2)
    ctx.cloth(sh, smooth=5)
    # heavy leather apron: bib + skirt panel (front only), straps over the shoulders
    nb = O.nearest_bone(ctx)
    n0 = Vector(ctx.J["neck"][0])
    bib = G.region_shell(ctx.body, "Smi_Bib", lambda c, n: nb(c) in ("chest", "spine", "hips") and n.y < -0.35 and
                         abs(c.x) < 0.13 and 0.95 < c.z < n0.z - 0.1, [], 0.03, None, 2, apron_m, relax=0.4)
    _plate_smooth(bib, 4)
    ctx.cloth(bib, smooth=8, thickness=0.006)
    ap = G.skirt("Smi_ApronSkirt", ctx.body, z_top=0.99, z_bot=0.36, seg=48, rings=12, flare=0.12, folds=4, fold_amp=0.008,
                 clearance=0.045, mat=apron_m, seed=11, panels=[(-55, 55)])
    ctx.cloth(ap, smooth=24, thickness=0.006, covers=False)
    bl = O.belt(ctx, "Smi_Belt", leather, 0.99, height=0.05, offset=0.06, thickness=0.01, buckle_mat=iron)
    ctx.cloth(bl, smooth=12, hem=False)
    gl = O.gloves(ctx, "Smi_Gloves", leather, cuff=0.55, offset=0.006)
    ctx.cloth(gl, smooth=2)
    hr = O.hair_cap(ctx, "Smi_Hair", hair_m, hairline=0.06, back=-0.04, offset=0.005, volume=0.004)
    ctx.piece(hr, "head", covers=True)
    bd = O.beard(ctx, "Smi_Beard", hair_m, length=0.014, chin=0.035, moustache=True, width=1.05, long=0.05)
    ctx.piece(bd, "head", covers=True)
    hm = smith_hammer("Smi_Hammer", iron, wood, leather)
    idle = H.idle_spec(ctx.P0, 0, smith_stance())
    g = ctx.posed_grip("R", idle)
    GR.xf(hm, Matrix.Translation(g) @ GR.R(180, 0, 90))       # head down along the leg
    ctx.held(hm, "hand.R", idle)


def smith_stance():
    return H.stance(drop=0.03, width=1.45, feet=(0.05, -0.05), toe_out=14, spine=(2, 0, 0), chest=(-3, 0, 0), head=(-2, 0, 0),
                  sway=0.012, look=4.0, breathe=1.4,
                  arms={"L": dict(fwd=6, out=16, twist=-8, elbow=24), "R": dict(fwd=12, out=15, twist=6, elbow=40)})


def smith_anim(ctx):
    P = ctx.P
    st = smith_stance()
    _walk(P, st, **_slow_gait(frames=22, stride=0.6, lift=0.1, twist=7.0, arm_swing=24.0, width=1.2,
                              arms={"R": dict(swing=0.6, fwd=12, elbow=44, out=15)}))


SMITH = hq.Spec("npc_blacksmith", SMITH_L, build="burly", face="broad", faces=3200,
                skin=dict(tone="#a67656", tone2="#744634", lips="#7a4236", stubble=0.4, age=0.5, seed=17, flush=0.8),
                eyes=dict(iris="#4a3a2a", iris2="#20160e"), dress=smith_dress, animate=smith_anim, kind="npc",
                main_size=1024, cloth_size=1024, height=1.85, preview=("Walk", 5))


# ============================================================================ ALCHEMIST
ALCH_L = H.scaled(HERO_L, 0.95, shoulder_w=0.185, hip_w=0.09)


def flask(name, glass, liquid_col, cork, h=0.12, r=0.035, seed=0):
    liq = KM.crystal(name + "_Liquid", liquid_col, glow=0.5, emit_strength=2.0, seed=seed)
    b = GR.lathe(name, [(0.0, r * 0.7), (0.01, r), (h * 0.55, r), (h * 0.7, r * 0.35), (h * 0.95, r * 0.3)], 10, liq)
    ck = GR.lathe(name + "_Cork", [(h * 0.93, r * 0.33), (h * 1.08, r * 0.3)], 6, cork)
    return GR.join([b, ck], name)


def alch_dress(ctx):
    coat_m = CM.trim(cloth("Cloth_Alc_Coat", "#2e3a2e", "wool", seed=91, hem_dirt=0.8), "#8a7a4a", width=0.02, inset=0.012)
    top_m = KM.cloth("Alc_Coat", "#2e3a2e", "wool", seed=92, hem_dirt=0.0)
    vest_m = KM.leather("Alc_Vest", "#5a3a22", seed=93, stitches=True)
    trou_m = KM.cloth("Alc_Trousers", "#3a3226", "wool", seed=94)
    leather = KM.leather("Alc_Leather", "#3a2616", seed=95)
    brass = KM.metal("Alc_Brass", "bronze", rust=0.35, seed=96)
    lens = KM.crystal("Alc_Lens", "#c9a24a", glow=0.1, emit_strength=0.5, seed=97)
    hair_m = CM.hair("Alc_Hair", "#7a7066", color2="#2a2622", tip="#b8b0a4", grey=0.6, seed=98)
    cork = KM.wood("Alc_Cork", "#9a7a50", "#6a5030", seed=99)
    trou = O.trousers(ctx, "Alc_Trousers", trou_m, z_top=1.0, bottom=0.65, offset=0.01)
    ctx.cloth(trou, smooth=4)
    bts = O.boots(ctx, "Alc_Boots", leather, top=0.35, offset=0.013)
    ctx.cloth(bts, smooth=3)
    ctx.layer(trou, [bts])
    top = O.shirt(ctx, "Alc_Coat", top_m, z_bot=0.97, sleeve=("forearm", 0.82), offset=0.014, neck=0.35)
    ctx.cloth(top, smooth=5)
    vest = O.shirt(ctx, "Alc_Vest", vest_m, z_bot=0.95, sleeve=None, offset=0.026, neck=0.15)
    ctx.cloth(vest, smooth=6, thickness=0.004)
    ctx.layer(top, [vest])
    coat = G.skirt("Cloth_Alc_Coat", ctx.body, z_top=1.0, z_bot=0.3, seg=46, rings=14, flare=0.12, folds=7, fold_amp=0.015,
                   clearance=0.03, mat=coat_m, seed=12, front_gap=40)
    ctx.cloth(coat, smooth=24, thickness=0.005)
    ctx.layer(trou, [coat])
    bl = O.belt(ctx, "Alc_Belt", leather, 0.99, height=0.045, offset=0.055, thickness=0.009, buckle_mat=brass)
    ctx.cloth(bl, smooth=12, hem=False)
    # potion flasks on the belt
    cols = ("#c0402a", "#3a8acf", "#6ac04a")
    for i, (x, c) in enumerate(zip((0.12, 0.155, -0.14), cols)):
        f = flask(f"Alc_Flask{i}", None, c, cork, h=0.1, r=0.026, seed=i)
        GR.xf(f, Matrix.Translation((x, -0.1 + abs(x) * 0.25, 0.9)))
        ctx.piece(f, {"hips": 0.85, ("thigh.L" if x > 0 else "thigh.R"): 0.15})
    gl = O.gloves(ctx, "Alc_Gloves", leather, cuff=0.8, offset=0.004)
    ctx.cloth(gl, smooth=2)
    hr = O.hair_cap(ctx, "Alc_Hair", hair_m, hairline=0.075, back=-0.07, offset=0.012, volume=0.018)
    ctx.piece(hr, "head", covers=True)
    bd = O.beard(ctx, "Alc_Beard", hair_m, length=0.006, chin=0.012, moustache=True, sideburns=True, width=0.95)
    ctx.piece(bd, "head", covers=True)
    # goggles pushed up on the forehead
    c, k = ctx.head_c, ctx.head_k
    parts = []
    for sx in (1, -1):
        rim = GR.lathe(f"Alc_Gog{sx}", [(0.0, 0.021), (0.018, 0.02)], 12, brass, cap0=False)
        GR.xf(rim, Matrix.Translation(c + Vector((sx * 0.033, -0.083, 0.068)) * k) @ GR.R(-75, 0, 0))
        parts.append(rim)
    band = GR.lathe("Alc_GogBand", [(0.0, 0.089 * k), (0.016, 0.087 * k)], 24, leather, cap0=False, cap1=False)
    GR.xf(band, Matrix.Translation(c + Vector((0, 0.008, 0.052)) * k) @ GR.R(-12, 0, 0) @ Matrix.Diagonal((1, 1.1, 1, 1)))
    G.plate(band, 0.004, 0.0)
    gog = GR.join(parts + [band], "Alc_Goggles")
    ctx.piece(gog, "head")
    # a flask in the left hand
    f = flask("Alc_HandFlask", None, "#9a4ad0", cork, h=0.14, r=0.035, seed=7)
    idle = H.idle_spec(ctx.P0, 0, alch_stance())
    g = ctx.posed_grip("L", idle)
    GR.xf(f, Matrix.Translation(g + Vector((0, 0, -0.035))))
    ctx.held(f, "hand.L", idle)


def alch_stance():
    return H.stance(drop=0.025, width=1.25, feet=(0.03, -0.03), toe_out=10, spine=(5, 0, 0), chest=(4, 0, 0), neck=(-3, 0, 0),
                  head=(-5, 0, 0), sway=0.01, look=6.0,
                  arms={"L": dict(fwd=38, out=10, twist=-10, elbow=95, hand=(-30, 0, 0)), "R": dict(fwd=8, out=10, elbow=30)})


def alch_anim(ctx):
    P = ctx.P
    st = alch_stance()
    _walk(P, st, **_slow_gait(frames=22, stride=0.5, arms={"L": dict(swing=0.2, fwd=38, elbow=95, out=10, twist=-10,
                                                                    hand=(-30, 0, 0))}))


ALCHEMIST = hq.Spec("npc_alchemist", ALCH_L, build="slim", face="gaunt", faces=3000,
                    skin=dict(tone="#bf9a80", tone2="#8e6a52", lips="#86524a", stubble=0.2, age=0.7, seed=19),
                    eyes=dict(iris="#6a7a4a", iris2="#2e3a1e"), dress=alch_dress, animate=alch_anim, kind="npc",
                    main_size=1024, cloth_size=1024, height=1.72, preview=("Walk", 5))


# ============================================================================ GUARD
GUARD_L = dict(HERO_L, shoulder_w=0.205)


def spear(name, wood, iron, length=2.1):
    shaft = GR.lathe(name + "_Shaft", [(-0.9, 0.016), (length - 0.9, 0.014)], 8, wood)
    socket = GR.lathe(name + "_Socket", [(length - 0.95, 0.018), (length - 0.86, 0.017)], 8, iron)
    head = GR.loft(name + "_Head", [[(x, y, z + length - 0.86) for x, y, z in s]
                                    for s in GR.blade_sections(0.26, 0.03, 0.022, 0.006, 0.12, 6, 0.0)], iron)
    butt = GR.lathe(name + "_Butt", [(-0.95, 0.0), (-0.93, 0.016), (-0.88, 0.017)], 8, iron)
    return GR.join([shaft, socket, head, butt], name)


def kettle_helm(ctx, iron, leather):
    c, k = ctx.head_c, ctx.head_k
    base = c + Vector((0, 0.01, 0.045)) * k
    prof = [(0.0, 0.16 * k), (0.012, 0.155 * k), (0.02, 0.1 * k), (0.06, 0.097 * k), (0.1, 0.08 * k), (0.13, 0.045 * k),
            (0.142, 0.0)]
    h = GR.lathe("Grd_Helm", prof, 24, iron)
    GR.xf(h, Matrix.Translation(base) @ Matrix.Diagonal((1.0, 1.08, 1.0, 1.0)))
    G.plate(h, 0.004, 0.0)
    strap = GR.lathe("Grd_ChinStrap", [(0.0, 0.062 * k), (0.012, 0.062 * k)], 16, leather, cap0=False, cap1=False)
    GR.xf(strap, Matrix.Translation(c + Vector((0, -0.01, -0.05)) * k) @ GR.R(70, 0, 0))
    G.plate(strap, 0.003, 0.0)
    return GR.join([h, strap], "Grd_Helmet")


def guard_dress(ctx):
    gamb = KM.cloth("Grd_Gambeson", "#5c5040", "linen", seed=101, hem_dirt=0.3)
    mail = CM.chainmail("Grd_Mail", seed=102)
    tabard = CM.trim(cloth("Cloth_Grd_Tabard", "#1f3150", "wool", seed=103, hem_dirt=0.7), "#b09040", width=0.03, inset=0.015)
    trou_m = KM.cloth("Grd_Trousers", "#2a2a2a", "wool", seed=104)
    leather = KM.leather("Grd_Leather", "#35241a", seed=105)
    iron = KM.metal("Grd_Iron", "iron", rust=0.35, grime=0.6, seed=106)
    wood = KM.wood("Grd_Wood", "#6a4a2c", "#3a2616", seed=107, axis="Z")
    hair_m = CM.hair("Grd_Hair", "#3a2a1c", seed=108)
    trou = O.trousers(ctx, "Grd_Trousers", trou_m, z_top=1.0, bottom=0.6, offset=0.01)
    ctx.cloth(trou, smooth=4)
    bts = O.boots(ctx, "Grd_Boots", leather, top=0.3, offset=0.014)
    ctx.cloth(bts, smooth=3)
    ctx.layer(trou, [bts])
    gb = O.shirt(ctx, "Grd_Gambeson", gamb, z_bot=0.84, sleeve=("forearm", 0.85), offset=0.018, neck=0.3,
                 offset_fn=lambda co: 0.018 + 0.012 * max(0.0, min(1.0, (1.0 - co.z) / 0.15)))
    ctx.cloth(gb, smooth=6, thickness=0.004)
    ml = O.shirt(ctx, "Grd_Mail", mail, z_bot=0.9, sleeve=("upper_arm", 0.6), offset=0.032, neck=0.2)
    ctx.cloth(ml, smooth=6, thickness=0.003)
    ctx.layer(gb, [ml])
    tb = G.skirt("Cloth_Grd_Tabard", ctx.body, z_top=1.3, z_bot=0.55, seg=44, rings=16, flare=0.05, folds=6, fold_amp=0.01,
                 clearance=0.05, mat=tabard, seed=13, panels=[(-36, 36), (144, 216)], top_pad=0.012)
    ctx.cloth(tb, smooth=22, thickness=0.004, covers=False)
    bl = O.belt(ctx, "Grd_Belt", leather, 1.0, height=0.05, offset=0.07, thickness=0.01, buckle_mat=iron)
    ctx.cloth(bl, smooth=12, hem=False)
    gl = O.gloves(ctx, "Grd_Gloves", leather, cuff=0.82, offset=0.005)
    ctx.cloth(gl, smooth=2)
    ctx.layer(gb, [gl])
    hr = O.hair_cap(ctx, "Grd_Hair", hair_m, hairline=0.06, back=-0.06, offset=0.004, volume=0.003)
    ctx.piece(hr, "head", covers=True)
    bd = O.beard(ctx, "Grd_Beard", hair_m, length=0.005, chin=0.01, moustache=True, width=0.95)
    ctx.piece(bd, "head", covers=True)
    hm = kettle_helm(ctx, iron, leather)
    ctx.piece(hm, "head")
    idle = H.idle_spec(ctx.P0, 0, guard_stance())
    g = ctx.posed_grip("R", idle)
    sp = spear("Grd_Spear", wood, iron, 2.1)
    GR.xf(sp, Matrix.Translation((g.x, g.y, 0.95 + 0.03)) )
    ctx.held(sp, "hand.R", idle)


def guard_stance():
    return H.stance(drop=0.025, width=1.4, feet=(0.04, -0.04), toe_out=12, spine=(0, 0, 0), chest=(-3, 0, 0), head=(-2, 0, 0),
                  sway=0.008, look=7.0,
                  arms={"L": dict(fwd=4, out=12, twist=-4, elbow=14), "R": dict(fwd=24, out=14, twist=4, elbow=84)})


def guard_anim(ctx):
    P = ctx.P
    st = guard_stance()
    _walk(P, st, **_slow_gait(frames=20, stride=0.66, lift=0.11, twist=6.0, arm_swing=26.0,
                              arms={"R": dict(swing=0.15, fwd=24, elbow=84, out=14, twist=4)}))


GUARD = hq.Spec("npc_guard", GUARD_L, build="hero", face="stern", faces=3000,
                skin=dict(tone="#b88c6c", tone2="#86584a", lips="#80463e", stubble=0.5, age=0.35, seed=23),
                eyes=dict(iris="#4a5a6a", iris2="#20283a"), dress=guard_dress, animate=guard_anim, kind="npc",
                main_size=1024, cloth_size=1024, height=1.95, preview=("Walk", 5))


# ============================================================================ INNKEEPER
INN_L = H.scaled(HERO_L, 0.97, shoulder_w=0.205, hip_w=0.1, arm_out=0.09)


def tankard(name, wood, iron):
    body = GR.lathe(name, [(0.0, 0.0), (0.0, 0.04), (0.13, 0.037), (0.13, 0.033), (0.02, 0.033)], 12, wood, cap0=False)
    bands = [GR.lathe(f"{name}_B{i}", [(z, 0.041), (z + 0.012, 0.041)], 12, iron, cap0=False, cap1=False) for i, z in
             enumerate((0.015, 0.1))]
    for b in bands:
        G.plate(b, 0.003, 0.0)
    handle = GR.lathe(name + "_H", [(0.0, 0.008), (0.08, 0.008)], 6, iron)
    GR.xf(handle, Matrix.Translation((0.05, 0, 0.025)))
    return GR.join([body, handle] + bands, name)


def inn_dress(ctx):
    shirt_m = KM.cloth("Inn_Shirt", "#c2b294", "linen", seed=111, hem_dirt=0.2)
    vest_m = KM.cloth("Inn_Vest", "#5a2a1e", "wool", seed=112)
    apron_m = CM.trim(cloth("Cloth_Inn_Apron", "#d0c4a4", "linen", seed=113, hem_dirt=0.7), "#8a6a44", width=0.012, inset=0.01)
    trou_m = KM.cloth("Inn_Trousers", "#3a3024", "wool", seed=114)
    leather = KM.leather("Inn_Leather", "#3a2616", seed=115)
    brass = KM.metal("Inn_Brass", "bronze", rust=0.3, seed=116)
    wood = KM.wood("Inn_Wood", "#6a4a2a", "#3a2614", seed=117)
    iron = KM.metal("Inn_Iron", "iron", rust=0.4, seed=118)
    hair_m = CM.hair("Inn_Hair", "#6a3a1e", color2="#2a140a", tip="#9a6a3e", seed=119)
    trou = O.trousers(ctx, "Inn_Trousers", trou_m, z_top=1.0, bottom=0.62, offset=0.012)
    ctx.cloth(trou, smooth=4)
    bts = O.boots(ctx, "Inn_Boots", leather, top=0.45, offset=0.013)
    ctx.cloth(bts, smooth=3)
    ctx.layer(trou, [bts])
    sh = O.shirt(ctx, "Inn_Shirt", shirt_m, z_bot=0.95, sleeve=("forearm", 0.4), offset=0.013, neck=0.3)
    ctx.cloth(sh, smooth=5)
    vs = O.shirt(ctx, "Inn_Vest", vest_m, z_bot=0.97, sleeve=None, offset=0.024, neck=0.1)
    ctx.cloth(vs, smooth=6, thickness=0.004)
    ctx.layer(sh, [vs])
    ap = G.skirt("Cloth_Inn_Apron", ctx.body, z_top=1.02, z_bot=0.42, seg=48, rings=12, flare=0.1, folds=5, fold_amp=0.008,
                 clearance=0.045, mat=apron_m, seed=14, panels=[(-65, 65)])
    ctx.cloth(ap, smooth=24, thickness=0.004, covers=False)
    bl = O.belt(ctx, "Inn_Belt", leather, 1.03, height=0.04, offset=0.06, thickness=0.009, buckle_mat=brass)
    ctx.cloth(bl, smooth=12, hem=False)
    hr = O.hair_cap(ctx, "Inn_Hair", hair_m, hairline=0.085, back=-0.05, offset=0.006, volume=0.004, sides=-0.03)
    ctx.piece(hr, "head", covers=True)
    bd = O.beard(ctx, "Inn_Moustache", hair_m, length=0.004, chin=0.006, moustache=True, sideburns=True, width=1.0)
    ctx.piece(bd, "head", covers=True)
    tk = tankard("Inn_Tankard", wood, iron)
    idle = H.idle_spec(ctx.P0, 0, inn_stance())
    g = ctx.posed_grip("R", idle)
    GR.xf(tk, Matrix.Translation(g + Vector((0.045, 0, -0.05))) @ GR.R(0, 0, 180))
    ctx.held(tk, "hand.R", idle)


def inn_stance():
    return H.stance(drop=0.02, width=1.4, feet=(0.04, -0.04), toe_out=14, spine=(-3, 0, 0), chest=(-4, 0, 0), head=(3, 0, 0),
                  sway=0.016, look=5.0, breathe=1.4,
                  arms={"L": dict(fwd=8, out=18, twist=-6, elbow=40), "R": dict(fwd=30, out=16, twist=6, elbow=88)})


def inn_anim(ctx):
    P = ctx.P
    st = inn_stance()
    _walk(P, st, **_slow_gait(frames=22, stride=0.5, sway=0.024, roll=4.0, twist=6.0, width=1.25,
                              arms={"R": dict(swing=0.2, fwd=30, elbow=88, out=16)}))


INNKEEPER = hq.Spec("npc_innkeeper", INN_L, build="portly", face="broad", faces=3000,
                    skin=dict(tone="#c89a7a", tone2="#9a6450", lips="#9a5248", stubble=0.3, age=0.5, seed=29, flush=1.0),
                    eyes=dict(iris="#5a4a3a", iris2="#261c12"), dress=inn_dress, animate=inn_anim, kind="npc",
                    main_size=1024, cloth_size=1024, height=1.8, preview=("Walk", 5))
