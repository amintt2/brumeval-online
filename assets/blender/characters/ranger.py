"""Ranger / Rodeur (v0.2): linen shirt, stitched leather jerkin, bracers, gloves, trousers, tall boots,
hood with cowl + short tattered cloak, belt with pouches and a knife, quiver on the back, longbow in the LEFT hand,
arrow in the right hand."""
import math

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
from players import HERO_L, _limb_plate, cloth

RANGER_L = dict(HERO_L, shoulder_w=0.195, hip_w=0.093)


def quiver(ctx, leather, dark, wood, head_m, fletch, n=7):
    """Leather quiver (lathe) with a rim and a strap, arrows sticking out (instanced)."""
    J = ctx.J
    body = GR.lathe("Rng_Quiver", [(0.0, 0.045), (0.02, 0.052), (0.5, 0.058), (0.52, 0.064), (0.56, 0.064)], 10, leather,
                    cap1=False)
    rim = GR.lathe("Rng_QuiverRim", [(0.5, 0.066), (0.53, 0.069), (0.56, 0.067)], 10, dark, cap0=False, cap1=False)
    arrows = []
    for i in range(n):
        a = GR.arrow(f"Rng_Arrow{i}", wood, head_m, fletch, length=0.72)
        GR.xf(a, GR.R(180, 0, 0))                     # fletching up, heads inside the quiver
        ang = i * 2.4
        rr = 0.028 * math.sqrt((i + 0.5) / n)
        GR.xf(a, Matrix.Translation((math.cos(ang) * rr, math.sin(ang) * rr, 0.76 + 0.02 * (i % 3))) @ GR.R(4 * math.cos(ang), 4 * math.sin(ang), 0))
        arrows.append(a)
    q = GR.join([body, rim] + arrows, "Rng_Quiver")
    n0 = Vector(J["neck"][0])
    # on the back: diagonal, opening above the right shoulder
    M = Matrix.Translation((0.02, 0.2, n0.z - 0.55)) @ GR.R(0, 22, 0) @ GR.R(-8, 0, 0)
    GR.xf(q, M)
    return q


def ranger_dress(ctx):
    J = ctx.J
    linen = KM.cloth("Rng_Shirt", "#6b604c", "linen", seed=41, hem_dirt=0.2)
    jerkin = KM.leather("Rng_Jerkin", "#4a3522", seed=42, wear=0.7, stitches=True)
    leather = KM.leather("Rng_Leather", "#35251a", seed=43, wear=0.6)
    trou_m = KM.cloth("Rng_Trousers", "#2f3326", "wool", seed=44, hem_dirt=0.5)
    hood_m = KM.cloth("Rng_Hood", "#2c3a26", "wool", seed=45, hem_dirt=0.0)
    cloak = cloth("Cloth_Rng_Cloak", "#26331f", "wool", seed=46, hem_dirt=0.9)
    brass = KM.metal("Rng_Brass", "bronze", rust=0.4, grime=0.6, wear=0.8, seed=47)
    steel = KM.metal("Rng_Steel", "steel", rust=0.2, seed=48)
    wood = KM.wood("Rng_BowWood", "#5a3d22", "#2e1d10", seed=49, axis="Z")
    shaft = KM.wood("Rng_Shaft", "#8a6a44", "#5a4028", seed=50, axis="Z")
    fletch = KM.flat("Rng_Fletch", "#d8d2c4", 0.7)
    string = KM.flat("Rng_String", "#cfc6a8", 0.6)
    hair_m = CM.hair("Rng_Hair", "#5a3a22", color2="#24160c", tip="#8a6a44", seed=51)
    # ---- layers
    trou = O.trousers(ctx, "Rng_Trousers", trou_m, z_top=1.0, bottom=0.6, offset=0.009)
    ctx.cloth(trou, smooth=4)
    bts = O.boots(ctx, "Rng_Boots", leather, top=0.12, offset=0.013)
    ctx.cloth(bts, smooth=3)
    ctx.layer(trou, [bts])
    sh = O.shirt(ctx, "Rng_Shirt", linen, z_bot=0.93, sleeve=("forearm", 0.8), offset=0.01, neck=0.3)
    ctx.cloth(sh, smooth=5)
    jk = O.shirt(ctx, "Rng_Jerkin", jerkin, z_bot=0.86, sleeve=None, offset=0.024, neck=0.2,
                 offset_fn=lambda co: 0.024 + 0.02 * max(0.0, min(1.0, (1.0 - co.z) / 0.14)))
    ctx.cloth(jk, smooth=8, thickness=0.004)
    ctx.layer(sh, [jk])
    br = _limb_plate(ctx, "Rng_Bracers", "forearm", 0.3, 0.86, 0.022, leather)
    ctx.cloth(br, smooth=3, thickness=0.004)
    gl = O.gloves(ctx, "Rng_Gloves", leather, cuff=0.85, offset=0.004)
    ctx.cloth(gl, smooth=2)
    ctx.layer(sh, [br, gl])
    bl = O.belt(ctx, "Rng_Belt", leather, 0.97, height=0.045, offset=0.05, thickness=0.009, buckle_mat=brass)
    ctx.cloth(bl, smooth=12, hem=False)
    for i, (x, y, rz) in enumerate(((0.16, -0.07, 30), (-0.17, -0.05, -35))):
        pc = GR.pouch(f"Rng_Pouch{i}", leather, (0.065, 0.035, 0.075), seed=i + 3)
        GR.xf(pc, Matrix.Translation((x, y, 0.92)) @ GR.R(0, 0, rz))
        ctx.piece(pc, {"hips": 0.8, ("thigh.L" if x > 0 else "thigh.R"): 0.2})
    knife = GR.sword("Rng_Knife", steel, brass, leather, length=0.2, grip_len=0.1, guard_w=0.035, w0=0.016, w1=0.012,
                     pommel=0.014, guard_curve=0.004, fuller=0.0)
    GR.xf(knife, Matrix.Translation((0.12, 0.13, 0.97)) @ GR.R(180, 0, -30))
    ctx.piece(knife, {"hips": 0.85, "thigh.L": 0.15}, ground=False)
    # ---- hood + cowl, cloak
    hd = G.hood("Rng_Hood", J, face_open=(0.082, 0.118), size=1.02, peak=0.07, cowl_r=0.2, mat=hood_m)
    ctx.cloth(hd, smooth=6, thickness=0.005,
              post=O.blend_to_torso(lambda co: 0.0))
    hr = O.hair_cap(ctx, "Rng_Hair", hair_m, hairline=0.045, back=-0.05, offset=0.008, volume=0.006)
    ctx.piece(hr, "head", covers=True)
    ck = G.cape("Cloth_Rng_Cloak", ctx.body, J, length=0.78, width=0.22, seg=18, rows=16, clearance=0.08, flare=0.12,
                folds=4, fold_amp=0.025, hem_jag=0.07, seed=7, mat=cloak, top_z=J["neck"][0][2] - 0.02)
    ctx.cloth(ck, smooth=26, thickness=0.004,
              post=O.blend_to_torso(lambda co: max(0.3, min(1.0, (co.z - 0.75) / 0.5)), ("chest", "spine")))
    q = quiver(ctx, leather, brass, shaft, steel, fletch)
    ctx.piece(q, {"chest": 0.8, "spine": 0.2}, ground=False)
    # ---- longbow in the LEFT hand (v0.1 convention: bow axis along Y at rest, string towards +Z)
    bow = GR.longbow("Rng_Bow", wood, leather, string, length=1.5, depth=0.12)
    gc = GR.grip_center(ctx, "L")
    Mb = Matrix(((-1, 0, 0, 0), (0, 0, 1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
    GR.xf(bow, Matrix.Translation(gc) @ Mb)
    ctx.piece(bow, "hand.L", arms_down=True, ground=False)
    # arrow in the right hand along the hand bone (points down at rest)
    ar = GR.arrow("Rng_HandArrow", shaft, steel, fletch, length=0.72)
    gr = GR.grip_center(ctx, "R")
    GR.xf(ar, Matrix.Translation(gr + Vector((0, 0, 0.06))) @ GR.R(180, 0, 0))
    ctx.piece(ar, "hand.R", arms_down=True, ground=False)


def ranger_anim(ctx):
    P, body = ctx.P, ctx.body
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
        sp = plus(base, {"hips": {"r": (lean * 0.3, 0, twist * 0.3), "t": (0, 0.0, -0.03)}, "spine": (lean * 0.4, 0, twist * 0.3),
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
    P.key_poses("Hit", CL.hit_keys(base, 1.0))
    P.key_poses("Death", H.death_keys(P, body, base, "fwd", turn=14, exclude=None, arms={
        "upper_arm.L": arm_r("L", 178, 40, 0), "forearm.L": (-8, 0, 90), "hand.L": (0, 0, 0),
        "upper_arm.R": arm_r("R", -6, 28, 0), "forearm.R": (4, 0, 0), "hand.R": (0, 0, 0)},
        fall_arms={"upper_arm.L": arm_r("L", 60, 55, 0), "forearm.L": (-20, 0, 90),
                   "upper_arm.R": arm_r("R", 10, 65, 0), "forearm.R": (-5, 0, 0)}))
    P.key_poses("Roll", CL.roll_keys(P, body, base, None))


RANGER = hq.Spec("ranger", RANGER_L, build="hero", face="young", faces=3300,
                 skin=dict(tone="#b58a6c", tone2="#86584a", lips="#84483e", stubble=0.45, age=0.1, seed=7),
                 eyes=dict(iris="#5b6e3e", iris2="#2d3a1e"), dress=ranger_dress, animate=ranger_anim,
                 main_size=2048, cloth_size=1024, height=1.85, preview=("Attack", 8))
