"""Mage (v0.2): layered robes (robe top, long robe skirt, bell sleeves, mantle, stole, sash), pointed hat,
long greying hair + goatee, gnarled staff with a glowing crystal (right hand), grimoire on the hip."""
from mathutils import Matrix, Vector

import charmats as CM
import clips as CL
import garments as G
import gear as GR
import humanoid as H
import hq
import outfits as O
from humanoid import arm_r, over, plus
from kit import materials as KM
from players import HERO_L, cloth

MAGE_L = H.scaled(HERO_L, 0.975, shoulder_w=0.19, hip_w=0.09, arm_out=0.075)


def magic_tome(name, cover, metal, pages):
    """Small grimoire: leather cover with metal corners, cream page block."""
    body = GR.box(name, (0.13, 0.045, 0.17), cover, 0.006)
    pg = GR.box(name + "_Pages", (0.12, 0.038, 0.16), pages, 0.002, (0.008, 0, 0))
    corners = [GR.box(name + f"_C{i}", (0.03, 0.05, 0.03), metal, 0.003, (0.05, 0, sz * 0.07)) for i, sz in enumerate((1, -1))]
    return GR.join([body, pg] + corners, name)


def mage_dress(ctx):
    J = ctx.J
    robe_c = "#1d1f3a"
    robe_top = KM.cloth("Mage_RobeTop", robe_c, "wool", seed=21, hem_dirt=0.0)
    robe = CM.trim(cloth("Cloth_Mage_Robe", robe_c, "wool", seed=22, hem_dirt=0.9), "#8c6d2e", width=0.045, inset=0.03)
    sleeves = CM.trim(cloth("Cloth_Mage_Sleeves", "#2a1f44", "wool", seed=23, hem_dirt=0.3), "#8c6d2e", width=0.025, inset=0.01)
    mantle_m = CM.trim(KM.cloth("Mage_Mantle", "#3a2458", "wool", seed=24, hem_dirt=0.0), "#9a7a3a", width=0.02, inset=0.008)
    stole = CM.trim(cloth("Cloth_Mage_Stole", "#5b1e1e", "silk", seed=25, hem_dirt=0.2), "#b08a40", width=0.012, inset=0.006)
    hat_m = KM.cloth("Mage_Hat", "#22203a", "wool", seed=26, hem_dirt=0.0)
    leather = KM.leather("Mage_Leather", "#3b2718", seed=27)
    gold = KM.metal("Mage_Gold", "gold", rust=0.2, grime=0.6, wear=0.8, seed=28)
    wood = KM.bark("Mage_StaffWood", "dead", color="#4a3a2a", color2="#261c14", seed=29, moss=0.0)
    crystal = KM.crystal("Mage_Crystal", "#63c8ff", glow=0.9, emit_strength=6.0, seed=30)
    hair_m = CM.hair("Mage_Hair", "#2c2622", color2="#120e0b", tip="#6d665e", grey=0.35, seed=31)
    pages = KM.flat("Mage_Pages", "#b7a88a", 0.8)
    # ---- body layers
    bts = O.boots(ctx, "Mage_Boots", leather, top=0.45, offset=0.012)
    ctx.cloth(bts, smooth=3)
    top = O.shirt(ctx, "Mage_RobeTop", robe_top, z_bot=0.98, sleeve=("forearm", 0.45), offset=0.014, neck=0.3)
    ctx.cloth(top, smooth=5)
    rb = G.skirt("Cloth_Mage_Robe", ctx.body, z_top=1.04, z_bot=0.045, seg=48, rings=20, flare=0.19, folds=9,
                 fold_amp=0.022, clearance=0.02, mat=robe, seed=3, back_long=0.02, front_short=0.02)
    ctx.cloth(rb, smooth=26, thickness=0.005)
    for side in ("L", "R"):
        sl = O.flared_sleeve(ctx, f"Cloth_Mage_Sleeve{side}", sleeves, side, t0=0.28, t1=1.08, flare=0.075, droop=0.05)
        ctx.cloth(sl, smooth=6, thickness=0.004)
    mt = O.mantle(ctx, "Mage_Mantle", mantle_m, drop=0.21, offset=0.034, sleeve=0.4)
    ctx.cloth(mt, smooth=6, thickness=0.005)
    ctx.layer(top, [mt])
    bl = O.belt(ctx, "Mage_Sash", leather, 1.02, height=0.06, offset=0.045, thickness=0.01, buckle_mat=gold)
    ctx.cloth(bl, smooth=12, hem=False)
    # stole: two strips from behind the neck down the front to the knees
    n0 = Vector(J["neck"][0])
    for sx, nm in ((1, "L"), (-1, "R")):
        pts = [(sx * 0.07, -0.03, n0.z + 0.02)] + [(sx * (0.075 + 0.005 * i), -0.1, n0.z - 0.08 - 0.09 * i) for i in range(9)]
        st = O.ribbon(ctx, "Cloth_Mage_Stole" + nm, stole, pts, width=0.075, clear_objs=[ctx.body, top, mt, rb, bl],
                      clearance=0.018)
        ctx.cloth(st, smooth=20, thickness=0.003, covers=False)
    # ---- hair (long, under the hat), goatee
    hr = O.hair_cap(ctx, "Mage_Hair", hair_m, hairline=0.05, back=-0.09, offset=0.01, volume=0.012, long=0.12)
    ctx.piece(hr, {"head": 0.85, "neck": 0.15}, covers=True)
    bd = O.beard(ctx, "Mage_Goatee", hair_m, length=0.006, chin=0.03, moustache=True, sideburns=False, width=0.55, long=0.05)
    ctx.piece(bd, "head", covers=True)
    hat = O.wizard_hat(ctx, "Mage_Hat", hat_m, leather, brim=0.23, height=0.4, bend=0.13, seed=2)
    ctx.piece(hat, "head")
    # ---- staff (right hand, vertical) + grimoire on the left hip
    stf = GR.staff("Mage_Staff", wood, gold, crystal, length=1.78, seed=5)
    idle = H.idle_spec(ctx.P0, 0, stance())
    g = ctx.posed_grip("R", idle)
    GR.xf(stf, Matrix.Translation(g) @ GR.R(0, 4, 0))
    ctx.held(stf, "hand.R", idle)
    tome = magic_tome("Mage_Tome", leather, gold, pages)
    GR.xf(tome, Matrix.Translation((0.2, -0.02, 0.9)) @ GR.R(0, -8, 80))
    ctx.piece(tome, {"hips": 0.7, "thigh.L": 0.3}, ground=False)


def stance():
    return H.stance(drop=0.02, width=1.3, feet=(0.04, -0.03), toe_out=10, spine=(2, 0, 0), chest=(-1, 0, 0),
                    arms={"L": dict(fwd=8, out=11, twist=0, elbow=26, hand=(0, 0, 0)),
                          "R": dict(fwd=10, out=12, twist=6, elbow=84, hand=(0, 0, 0))}, breathe=1.1)


def mage_anim(ctx):
    P, body = ctx.P, ctx.body
    st = stance()
    g = H.gait(stride=0.7, lift=0.13, bob=0.028, arms={"L": dict(swing=0.9, elbow=55),
                                                      "R": dict(swing=0.3, fwd=10, elbow=84, out=12, twist=6)})
    P.key_loop("Idle", 48, lambda t: H.idle_spec(P, t, st))
    P.key_loop("Walk", g["frames"], lambda p: H.gait_spec(P, p, g, st))
    base = H.idle_spec(P, 0, st)

    def staff_arm(fwd, out, twist, elbow, wrist):
        return {"upper_arm.R": arm_r("R", fwd, out, twist), "forearm.R": (-elbow, 0, 0), "hand.R": (wrist, 0, 0)}

    wind = over(plus(base, {"hips": {"r": (0, 0, -10), "t": (0, 0.03, -0.02)}, "spine": (-5, 0, -12), "chest": (-8, 0, -20),
                            "head": (3, 0, 20)}),
                {**staff_arm(130, 24, 22, 48, 22), "upper_arm.L": arm_r("L", 38, 28), "forearm.L": (-50, 0, 0)})
    strike = over(plus(base, {"hips": {"r": (5, 0, 12), "t": (0, -0.06, -0.05)}, "spine": (9, 0, 11), "chest": (11, 0, 20),
                              "head": (-8, 0, -16)}),
                  {**staff_arm(80, 10, 0, 5, 30), "upper_arm.L": arm_r("L", -15, 22), "forearm.L": (-30, 0, 0)})
    follow = over(plus(base, {"hips": {"r": (5, 0, 15), "t": (0, -0.06, -0.06)}, "spine": (10, 0, 13), "chest": (13, 0, 24),
                              "head": (-9, 0, -20)}),
                  {**staff_arm(62, -8, -10, 8, 36), "upper_arm.L": arm_r("L", -20, 24), "forearm.L": (-30, 0, 0)})
    P.key_poses("Attack", [(0, base), (5, wind, "out"), (8, strike, "in3"), (10, follow, "out"), (15, base, "smooth")])
    gather = over(plus(base, {"hips": {"t": (0, 0.02, -0.04)}, "spine": (-4, 0, 0), "chest": (-10, 0, 4), "neck": (-2, 0, 0),
                              "head": (-9, 0, 0)}),
                  {**staff_arm(150, 16, 0, 18, 76), "upper_arm.L": arm_r("L", 42, 32, -20), "forearm.L": (-95, 0, 0),
                   "hand.L": (-10, 0, 0)})
    release = over(plus(base, {"hips": {"r": (4, 0, 0), "t": (0, -0.06, -0.05)}, "spine": (7, 0, 0), "chest": (9, 0, -4),
                               "head": (-6, 0, 0)}),
                   {**staff_arm(98, 12, 0, 6, 52), "upper_arm.L": arm_r("L", 84, 12, 0), "forearm.L": (-8, 0, 0),
                    "hand.L": (60, 0, 0)})
    hold = plus(release, {"chest": (2, 0, 0), "upper_arm.L": arm_r("L", 4, 0)})
    P.key_poses("Cast", [(0, base), (7, gather, "out"), (11, release, "in3"), (14, hold, "smooth"), (19, base, "smooth")])
    P.key_poses("Hit", CL.hit_keys(base, 1.1))
    P.key_poses("Death", H.death_keys(P, body, base, "back", turn=-12, exclude=None, arms={
        "upper_arm.R": arm_r("R", 70, 50, 0), "forearm.R": (-20, 0, 0), "hand.R": (0, 0, 0),
        "neck": (14, 0, 0), "head": (24, 0, 30)}))
    P.key_poses("Roll", CL.roll_keys(P, body, base, None))


MAGE = hq.Spec("mage", MAGE_L, build="slim", face="gaunt", faces=3200,
               skin=dict(tone="#c09478", tone2="#8a5e4a", lips="#8a4a44", stubble=0.3, age=0.55, seed=5, flush=0.3),
               eyes=dict(iris="#6e8fa8", iris2="#2c3d52"), dress=mage_dress, animate=mage_anim,
               main_size=2048, cloth_size=2048, height=2.05, preview=("Cast", 11))
