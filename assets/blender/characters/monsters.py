"""Humanoid monsters (v0.2): goblin (~1.2 m, crude spiked club) and skeleton (rusty sword, glowing eyes).
Clips: Idle Walk Attack Hit Death + Attack2 (telegraphed heavy attack) + Run."""
import math
import random

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
import pipeline as PL
from humanoid import arm_r, over, plus
from kit import gn
from kit import materials as KM
from players import cloth

# ============================================================================ GOBLIN
GOBLIN_L = dict(
    ankle=0.06, knee=0.3, hip=0.55, hip_w=0.085, toe_y=-0.13, toe_z=0.02,
    pelvis=0.585, spine=0.64, chest=0.745, neck=0.9, head=0.935, top=1.18,
    shoulder=0.87, shoulder_w=0.15, elbow=0.665, wrist=0.455, hand=0.1, arm_out=0.07,
)


def spiked_club(name, wood, iron, length=0.62, seed=4):
    """Knotted club (curve -> mesh, displaced) with iron nails scattered on the head (kit.gn.scatter)."""
    rnd = random.Random(seed)
    pts = []
    for i in range(8):
        u = i / 7
        pts.append((0.008 * math.sin(u * 5), 0.006 * math.cos(u * 4), -0.1 + length * u, 0.55 + 0.9 * u ** 1.6))
    cu = gn.make_curve([pts], name + "_Curve", kind="NURBS", resolution=4)
    gn.curve_to_mesh(cu, radius=0.028, profile_res=8)
    club = gn.apply(cu)
    gn.displace(club, strength=0.008, scale=9.0, detail=4.0, seed=seed, voronoi=0.4)
    gn.apply(club)
    club.data.materials.clear()
    club.data.materials.append(wood)
    # nails only on the upper third: scatter on a temporary copy of the head region
    nail = GR.lathe(name + "_NailTpl", [(-0.012, 0.004), (0.0, 0.0045), (0.035, 0.0)], 4, iron, smooth=False)
    head = club.copy()
    head.data = club.data.copy()
    bpy.context.scene.collection.objects.link(head)
    bm = __import__("bmesh").new()
    bm.from_mesh(head.data)
    kill = [f for f in bm.faces if f.calc_center_median().z < length * 0.55]
    __import__("bmesh").ops.delete(bm, geom=kill, context="FACES")
    bm.to_mesh(head.data)
    bm.free()
    gn.scatter(head, nail, density=260.0, seed=seed, scale=(0.8, 1.2), rot_random=(0.3, 0.3, 3.1), embed=0.012,
               keep_target=False, distance_min=0.02)
    nails = gn.apply(head)
    gn.remove(nail)
    nails.data.materials.clear()
    nails.data.materials.append(iron)
    return GR.join([club, nails], name)


def goblin_dress(ctx):
    J = ctx.J
    rag = cloth("Cloth_Gob_Rag", "#4a3a26", "burlap", seed=121, hem_dirt=0.9)
    leather = KM.leather("Gob_Leather", "#3a2616", seed=122, wear=0.8, dirt=0.8)
    fur_m = KM.fur("Gob_Fur", "#5a4a3a", "#8a7a66", "#1e1812", seed=123)
    wood = KM.bark("Gob_Club", "oak", color="#4a3622", color2="#20150c", seed=124, moss=0.2)
    iron = KM.metal("Gob_Iron", "iron", rust=0.8, grime=0.8, seed=125)
    bone = KM.bone("Gob_Bone", seed=126)
    # loincloth (tattered front/back flaps) + belt
    lc = G.skirt("Cloth_Gob_Loincloth", ctx.body, z_top=ctx.L["pelvis"] + 0.02, z_bot=ctx.L["knee"] + 0.04, seg=36, rings=10,
                 flare=0.05, folds=5, fold_amp=0.008, clearance=0.018, mat=rag, seed=6, hem_jag=0.05,
                 panels=[(-50, 50), (130, 230)])
    ctx.cloth(lc, smooth=22, thickness=0.004)
    bl = O.belt(ctx, "Gob_Belt", leather, ctx.L["pelvis"] + 0.02, height=0.035, offset=0.03, thickness=0.008,
                buckle_mat=bone)
    ctx.cloth(bl, smooth=10, hem=False)
    # hide shoulder pad (left) with fur
    sh = Vector(J["upper_arm.L"][0])
    pad = GR.ico("Gob_Pad", 0.075, fur_m, 2, tuple(sh + Vector((0.01, 0.0, 0.015))), (1.0, 1.15, 0.6))
    bm = __import__("bmesh").new()
    bm.from_mesh(pad.data)
    kill = [f for f in bm.faces if f.calc_center_median().z < sh.z + 0.0]
    __import__("bmesh").ops.delete(bm, geom=kill, context="FACES")
    bm.to_mesh(pad.data)
    bm.free()
    G.plate(pad, 0.01, 0.0)
    ctx.piece(pad, {"upper_arm.L": 0.6, "chest": 0.4}, covers=True)
    # bone necklace: small teeth on a cord round the neck
    n0 = Vector(J["neck"][0])
    sec = G.section(ctx.body, n0 + Vector((0, 0, -0.02)), (0, 0.35, 1), near=n0, radius=0.2, n=20)
    parts = []
    if sec:
        loop, c, nrm = sec
        for i, p in enumerate(loop):
            if p.y < c.y:
                d = (p - c).normalized()
                t = GR.lathe(f"Gob_Tooth{i}", [(0.0, 0.006), (0.02, 0.0)], 5, bone)
                GR.xf(t, Matrix.Translation(p + d * 0.014) @ GR.R(180, 0, 0))
                parts.append(t)
        cord = G.band("Gob_Cord", loop, c, nrm, 0.006, offset=0.008, thickness=0.004, mat=leather)
        parts.append(cord)
    if parts:
        ctx.cloth(GR.join(parts, "Gob_Necklace"), smooth=6, hem=False, covers=False)
    # tusks
    c, k = ctx.head_c, ctx.head_k
    for sx in (1, -1):
        tk = GR.lathe(f"Gob_Tusk{sx}", [(0.0, 0.006 * k), (0.018 * k, 0.0)], 5, bone)
        GR.xf(tk, Matrix.Translation(c + Vector((sx * 0.02, -0.098, -0.085)) * k) @ GR.R(-10, sx * 10, 0))
        ctx.piece(tk, "head")
    club = spiked_club("Gob_Club", wood, iron)
    GR.xf(club, GR.grip_frame(ctx, "R", tilt=20))
    ctx.piece(club, "hand.R", arms_down=True, ground=False)


def goblin_anim(ctx):
    P, body = ctx.P, ctx.body
    st = H.stance(drop=0.045, width=1.6, feet=(0.05, -0.06), toe_out=18, hips=(8, 0, 0), spine=(12, 0, 0), chest=(12, 0, 0),
                  neck=(-14, 0, 0), head=(-16, 0, 0), sway=0.014, look=8.0, breathe=1.5,
                  arms={"L": dict(fwd=24, out=22, twist=-10, elbow=32), "R": dict(fwd=18, out=20, twist=10, elbow=55)})
    g = H.gait(frames=17, stride=0.56, lift=0.13, duty=0.4, drop=0.03, bob=0.028, lean=8.0, twist=12.0, sway=0.016, roll=3.0,
               arm_swing=42.0, elbow=45.0, elbow_swing=15.0, arm_out=18.0, width=1.25, toe_out=12.0,
               arms={"R": dict(swing=0.55, fwd=18, elbow=60, out=20, twist=10)})
    P.key_loop("Idle", 48, lambda t: H.idle_spec(P, t, st))
    P.key_loop("Walk", g["frames"], lambda p: H.gait_spec(P, p, g, st))
    r = CL.run_gait(frames=12, stride=0.8, lift=0.2, lean=20.0, arm_out=20.0, width=1.2, toe_out=10.0,
                    arms={"R": dict(swing=0.5, fwd=30, elbow=70, out=22, twist=10)})
    P.key_loop("Run", r["frames"], lambda p: H.gait_spec(P, p, r, st))
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
    P.key_poses("Attack", [(0, base), (5, wind, "out"), (8, smash, "in3"), (10, follow, "out"), (15, base, "smooth")])
    # Attack2: two-handed overhead leap-smash: crouch & raise (0.65 s), hop forward in place, SLAM, stuck, recover (1.45 s)
    both = {"upper_arm.L": arm_r("L", 165, 8, 10), "forearm.L": (-60, 0, 0), "hand.L": (0, 0, 0)}
    raise1 = over(plus(base, {"hips": {"r": (-8, 0, 0), "t": (0, 0.04, -0.1)}, "spine": (-10, 0, 0), "chest": (-14, 0, 0),
                              "head": (6, 0, 0)}), {**club_arm(170, 10, 0, 70, -10), **both})
    raise2 = plus(raise1, {"hips": {"t": (0, 0.01, -0.03)}, "chest": (-4, 0, 0), "head": (-4, 0, 0)})   # shaking, held
    hop = over(plus(base, {"hips": {"r": (-4, 0, 0), "t": (0, -0.04, 0.1)}, "spine": (-6, 0, 0), "chest": (-10, 0, 0)}),
               {**club_arm(175, 6, 0, 40, -10), **both, "IK": {"leg.L": None, "leg.R": None},
                "thigh.L": (-40, 0, 0), "shin.L": (60, 0, 0), "thigh.R": (-30, 0, 0), "shin.R": (50, 0, 0)})
    slam = over(plus(base, {"hips": {"r": (20, 0, 0), "t": (0, -0.1, -0.16)}, "spine": (16, 0, 0), "chest": (18, 0, 0),
                            "head": (-14, 0, 0)}),
                {**club_arm(70, 6, 0, 0, 30), "upper_arm.L": arm_r("L", 72, 4, 10), "forearm.L": (-12, 0, 0)})
    stuck = plus(slam, {"hips": {"t": (0, 0, 0.02)}, "chest": (-3, 0, 0)})
    P.key_poses("Attack2", [(0, base), (8, raise1, "out"), (15, raise2, "smooth"), (19, hop, "in"), (22, slam, "in3"),
                            (28, stuck, "out"), (35, base, "smooth")])
    P.key_poses("Hit", CL.hit_keys(base, 1.2))
    P.key_poses("Death", H.death_keys(P, body, base, "fwd", turn=-16, exclude=None, arms={
        "upper_arm.R": arm_r("R", -6, 30, 0), "forearm.R": (4, 0, -90), "hand.R": (0, 0, 0), "head": (6, 0, 28)},
        fall_arms={"upper_arm.R": arm_r("R", 40, 50, 0), "forearm.R": (-20, 0, -90)}))


GOBLIN = hq.Spec("goblin", GOBLIN_L, build="goblin", face="goblin", faces=3000, bare_feet=True,
                 skin=dict(tone="#6f8a42", tone2="#3e5222", lips="#4a3a2a", stubble=0.0, age=0.6, seed=31, flush=0.2,
                           brow="#2a3014", brow_amt=0.5, kind="orc"),
                 eyes=dict(iris="#d8b030", iris2="#8a5a10", sclera="#c8b87a"), dress=goblin_dress, animate=goblin_anim,
                 kind="monster", main_size=1024, cloth_size=512, height=1.22, preview=("Attack2", 20))


# ============================================================================ SKELETON
SKEL_L = dict(H.HUMAN, shoulder=1.44, neck=1.47, shoulder_w=0.19, hip_w=0.09, arm_out=0.08)


def _bone_piece(name, a, b, r, mat, seg=8, knob=1.9):
    a, b = Vector(a), Vector(b)
    L = (b - a).length
    prof = [(0.0, r * 1.2), (0.03 * L, r * knob), (0.1 * L, r * knob * 0.95), (0.22 * L, r * 1.05), (0.5 * L, r * 0.9),
            (0.78 * L, r * 1.0), (0.9 * L, r * knob * 0.9), (0.97 * L, r * knob), (L, r * 1.1)]
    ob = GR.lathe(name, prof, seg, mat)
    q = Vector((0, 0, 1)).rotation_difference((b - a).normalized())
    GR.xf(ob, Matrix.Translation(a) @ q.to_matrix().to_4x4())
    return ob


def skeleton_body(ctx):
    """Bones authored in the ARMS-DOWN frame (P0), each rigid on its bone, moved into the bind pose."""
    P0 = ctx.P0
    bone_m = KM.bone("Ske_Bone", "#c2b08a", seed=131, dirt=0.9)
    pieces = []   # (obj, bone)

    def add(ob, bone):
        pieces.append((ob, bone))
        return ob

    Hd, Tl = P0.head, P0.tail
    # limbs
    for s, sx in (("L", 1), ("R", -1)):
        add(_bone_piece(f"Humerus{s}", Hd[f"upper_arm.{s}"] + Vector((0, 0, -0.01)), Tl[f"upper_arm.{s}"], 0.014, bone_m), f"upper_arm.{s}")
        for k, off in enumerate((0.009, -0.009)):
            add(_bone_piece(f"Radius{s}{k}", Hd[f"forearm.{s}"] + Vector((0, off, 0)), Tl[f"forearm.{s}"] + Vector((0, off * 0.6, 0)),
                            0.008, bone_m, 6, 1.7), f"forearm.{s}")
        add(_bone_piece(f"Femur{s}", Hd[f"thigh.{s}"] + Vector((-sx * 0.02, 0, 0.01)), Tl[f"thigh.{s}"], 0.017, bone_m), f"thigh.{s}")
        add(_bone_piece(f"Tibia{s}", Hd[f"shin.{s}"], Tl[f"shin.{s}"], 0.014, bone_m), f"shin.{s}")
        add(_bone_piece(f"Fibula{s}", Hd[f"shin.{s}"] + Vector((sx * 0.018, 0.01, -0.02)), Tl[f"shin.{s}"] + Vector((sx * 0.02, 0.01, 0.02)),
                        0.006, bone_m, 5, 1.6), f"shin.{s}")
        add(GR.ico(f"Patella{s}", 0.018, bone_m, 1, tuple(Hd[f"shin.{s}"] + Vector((0, -0.03, 0.01))), (1, 0.6, 1.1)), f"shin.{s}")
        # foot: tarsal block + 5 toe bones
        an, to = Hd[f"foot.{s}"], Tl[f"foot.{s}"]
        add(GR.ico(f"Tarsal{s}", 0.03, bone_m, 2, tuple(an.lerp(to, 0.25) + Vector((0, 0.02, -0.03))), (0.9, 1.5, 0.7)), f"foot.{s}")
        for t in range(5):
            x = to.x + sx * (0.022 - 0.011 * t)
            add(_bone_piece(f"Toe{s}{t}", (x, an.y - 0.03, 0.03), (x + sx * 0.004 * t, to.y - 0.015 + 0.008 * t, 0.012), 0.0055,
                            bone_m, 5, 1.5), f"foot.{s}")
        # hand: fist of finger bones around the grip (+ metacarpals)
        gc = GR.grip_center(ctx, s)
        w = Hd[f"hand.{s}"]
        for f_i, fy in enumerate((-0.024, -0.008, 0.008, 0.024)):
            base = w + Vector((0, fy, -0.07))
            add(_bone_piece(f"Meta{s}{f_i}", w + Vector((0, fy * 0.5, -0.015)), base, 0.005, bone_m, 5, 1.5), f"hand.{s}")
            p1 = gc + Vector((sx * 0.022, fy, -0.012))
            p2 = gc + Vector((0, fy, -0.03))
            p3 = gc + Vector((-sx * 0.02, fy, -0.012))
            add(_bone_piece(f"Fin{s}{f_i}a", base, p1, 0.0048, bone_m, 5, 1.4), f"hand.{s}")
            add(_bone_piece(f"Fin{s}{f_i}b", p1, p2, 0.0042, bone_m, 5, 1.4), f"hand.{s}")
            add(_bone_piece(f"Fin{s}{f_i}c", p2, p3, 0.0038, bone_m, 5, 1.4), f"hand.{s}")
        add(_bone_piece(f"Thumb{s}", w + Vector((-sx * 0.01, -0.025, -0.03)), gc + Vector((-sx * 0.012, -0.04, 0.0)), 0.0055,
                        bone_m, 5, 1.4), f"hand.{s}")
        # clavicle + scapula
        sh = Hd[f"upper_arm.{s}"]
        add(_bone_piece(f"Clav{s}", Hd["neck"] + Vector((sx * 0.02, -0.05, -0.04)), sh + Vector((-sx * 0.01, -0.02, 0.01)), 0.008,
                        bone_m, 6, 1.4), "chest")
        sc = GR.ico(f"Scap{s}", 0.07, bone_m, 2, tuple(sh + Vector((-sx * 0.07, 0.085, -0.07))), (0.75, 0.18, 1.0))
        add(sc, "chest")
    # pelvis: two iliac wings + sacrum
    hip = Hd["hips"]
    for sx in (1, -1):
        wing = GR.ico(f"Ilium{sx}", 0.075, bone_m, 2, tuple(hip + Vector((sx * 0.075, 0.0, -0.02))), (0.8, 0.45, 0.85))
        add(wing, "hips")
        add(_bone_piece(f"Pubis{sx}", hip + Vector((sx * 0.07, -0.02, -0.07)), hip + Vector((sx * 0.01, -0.055, -0.1)), 0.011, bone_m),
            "hips")
    add(GR.ico("Sacrum", 0.04, bone_m, 2, tuple(hip + Vector((0, 0.045, -0.04))), (0.8, 0.6, 1.2)), "hips")
    # spine: vertebrae from the sacrum to the skull
    z0, z1 = hip.z, Hd["head"].z
    n = 17
    for i in range(n):
        u = i / (n - 1)
        z = z0 + (z1 - z0) * u
        y = 0.045 - 0.02 * math.sin(u * math.pi) + 0.02 * u
        bone = "hips" if z < Hd["spine"].z else ("spine" if z < Hd["chest"].z else ("chest" if z < Hd["neck"].z else "neck"))
        r = 0.022 - 0.01 * u
        v = GR.lathe(f"Vert{i}", [(-r * 0.45, r * 0.85), (-r * 0.2, r), (r * 0.2, r), (r * 0.45, r * 0.85)], 8, bone_m)
        GR.xf(v, Matrix.Translation((0, y, z)))
        add(v, bone)
        sp = _bone_piece(f"Spinous{i}", (0, y + r * 0.8, z), (0, y + r * 2.2, z - 0.012), 0.004, bone_m, 4, 1.3)
        add(sp, bone)
    # ribcage: 7 pairs of curved ribs + sternum
    ch = Hd["chest"]
    for i in range(7):
        z = ch.z + 0.16 - 0.035 * i
        w = 0.1 + 0.035 * math.sin(math.pi * (i + 1) / 8)
        for sx in (1, -1):
            pts = []
            for k in range(8):
                a = math.radians(-100 + 170 * k / 7)          # from the spine (back) round to the front
                pts.append((sx * math.sin(math.radians(90) - a) * w * 0 + sx * w * math.cos(a), 0.035 - 0.105 * math.sin(a) *
                            (1.0 if a > 0 else 0.55), z - 0.03 * k / 7 - 0.012 * (a > 0), 1.0 - 0.3 * (k / 7)))
            cu = gn.make_curve([pts], f"Rib{i}{sx}", kind="NURBS", resolution=3)
            gn.curve_to_mesh(cu, radius=0.0065, profile_res=5)
            rib = gn.apply(cu)
            rib.data.materials.clear()
            rib.data.materials.append(bone_m)
            rib.data.transform(Matrix.Diagonal((1.0, 1.0, 1.0, 1.0)))
            add(rib, "chest")
    add(GR.box("Sternum", (0.03, 0.014, 0.17), bone_m, 0.006, (0, -0.075, ch.z + 0.07)), "chest")
    # skull (metaballs, eye sockets and nasal cavity carved) + jaw
    c, k = ctx.head_c, ctx.head_k
    mb = A.MB("_SkullMB", 0.004)
    mb.ellipsoid(c + Vector((0, 0.012, 0.03)) * 1.0, (0.068 * k, 0.088 * k, 0.085 * k))
    mb.ellipsoid(c + Vector((0, -0.04, -0.035)) * 1.0, (0.052 * k, 0.05 * k, 0.05 * k))
    for sx in (1, -1):
        mb.ellipsoid(c + Vector((sx * 0.031, -0.085, 0.0)) * k, (0.019 * k, 0.03 * k, 0.017 * k), neg=True, stiff=3.0)
        mb.ellipsoid(c + Vector((sx * 0.052, -0.045, -0.02)) * k, (0.016 * k, 0.03 * k, 0.012 * k))     # cheekbones
    mb.ellipsoid(c + Vector((0, -0.095, -0.035)) * k, (0.011 * k, 0.03 * k, 0.017 * k), neg=True, stiff=3.0)
    mb.capsule(c + Vector((-0.05, -0.02, 0.015)) * k, c + Vector((0.05, -0.02, 0.015)) * k, 0.014 * k)  # brow
    skull = mb.to_mesh("Skull")
    skull.data.transform(Matrix.Translation(Vector((0, 0, 0))))
    # translate: c already applied above via k-scaled offsets? (ellipsoid centres used raw c + offsets)
    skull.data.materials.clear()
    skull.data.materials.append(bone_m)
    for p in skull.data.polygons:
        p.use_smooth = True
    md = skull.modifiers.new("Dec", "DECIMATE")
    md.ratio = min(1.0, 1400 / max(1, len(skull.data.polygons)))
    gn.apply(skull)
    add(skull, "head")
    teeth = []
    for t in range(10):
        a = math.radians(-60 + 120 * t / 9)
        p = c + Vector((math.sin(a) * 0.028, -0.07 - math.cos(a) * 0.022, -0.075)) * k
        teeth.append(GR.box(f"Tooth{t}", (0.007, 0.006, 0.012), bone_m, 0.0015, tuple(p)))
    add(GR.join(teeth, "Teeth"), "head")
    jaw_pts = [c + Vector((sx * 0.05, 0.0, -0.035)) * k for sx in (1,)]
    for sx in (1, -1):
        add(_bone_piece(f"Ramus{sx}", c + Vector((sx * 0.052, 0.002, -0.03)) * k, c + Vector((sx * 0.046, -0.01, -0.085)) * k,
                        0.007, bone_m, 5, 1.4), "head")
        add(_bone_piece(f"Mandible{sx}", c + Vector((sx * 0.046, -0.01, -0.085)) * k, c + Vector((0, -0.075, -0.1)) * k,
                        0.008, bone_m, 5, 1.3), "head")
    # map each piece into the bind pose and skin it rigidly, then join into ONE body
    objs = []
    for ob, bone in pieces:
        if bone != "head" or True:
            PL.to_bind(ob, ctx.deltas, bone)
        for g in list(ob.vertex_groups):
            ob.vertex_groups.remove(g)
        vg = ob.vertex_groups.new(name=bone)
        vg.add(list(range(len(ob.data.vertices))), 1.0, "REPLACE")
        objs.append(ob)
    body = GR.join(objs, "Body")
    return None, body


def skeleton_eyes(ctx):
    glow = KM.emissive("Ske_EyeGlow", "#7fd8ff", strength=8.0)
    c, k = ctx.head_c, ctx.head_k
    eyes = []
    for sx in (1, -1):
        e = GR.ico(f"SkeEye{sx}", 0.0085 * k, glow, 2, tuple(c + Vector((sx * 0.031, -0.075, 0.0)) * k))
        eyes.append(e)
    ctx.piece(GR.join(eyes, "Ske_Eyes"), "head")


def skeleton_dress(ctx):
    rag = cloth("Cloth_Ske_Rag", "#3a3446", "burlap", seed=141, hem_dirt=1.0)
    rust = KM.metal("Ske_Rust", "iron", rust=0.9, grime=0.8, seed=142)
    leather = KM.leather("Ske_Leather", "#2a1c12", seed=143, wear=0.9, dirt=0.9)
    blade = KM.metal("Ske_Blade", "iron", rust=0.75, grime=0.6, wear=0.7, seed=144, scratches=0.8)
    lc = G.skirt("Cloth_Ske_Rag", ctx.body, z_top=1.0, z_bot=0.55, seg=36, rings=10, flare=0.06, folds=6, fold_amp=0.012,
                 clearance=0.025, mat=rag, seed=15, hem_jag=0.08, panels=[(-60, 40), (150, 240)])
    ctx.cloth(lc, smooth=20, thickness=0.003, covers=False)
    bl = O.belt(ctx, "Ske_Belt", leather, 0.99, height=0.035, offset=0.03, thickness=0.007, buckle_mat=rust)
    ctx.cloth(bl, smooth=10, hem=False, covers=False)
    # rusted open helmet (dome with a broken brim)
    c, k = ctx.head_c, ctx.head_k
    base = c + Vector((0, 0.012, 0.035)) * k
    prof = [(0.0, 0.1 * k), (0.01, 0.1 * k), (0.06, 0.092 * k), (0.1, 0.07 * k), (0.125, 0.035 * k), (0.132, 0.0)]
    hm = GR.lathe("Ske_Helm", prof, 20, rust)
    GR.xf(hm, Matrix.Translation(base) @ Matrix.Diagonal((1.0, 1.1, 1.0, 1.0)))
    gn.displace(hm, strength=0.003, scale=20.0, detail=3.0, seed=4, voronoi=0.3)
    gn.apply(hm)
    G.plate(hm, 0.004, 0.0)
    ctx.piece(hm, "head")
    sw = GR.sword("Ske_Sword", blade, rust, leather, length=0.74, grip_len=0.12, guard_w=0.09, w0=0.03, w1=0.02, fuller=0.2)
    gn.displace(sw, strength=0.0015, scale=30.0, detail=2.0, seed=6, voronoi=0.5)
    gn.apply(sw)
    GR.xf(sw, GR.grip_frame(ctx, "R", tilt=18))
    ctx.piece(sw, "hand.R", arms_down=True, ground=False)


def skeleton_anim(ctx):
    P, body = ctx.P, ctx.body
    st = H.stance(drop=0.03, width=1.4, feet=(0.05, -0.05), toe_out=10, hips=(3, 0, 0), spine=(5, 0, 0), chest=(6, 0, 0),
                  neck=(-4, 0, 0), head=(-6, 5, 0), sway=0.01, look=6.0, breathe=0.5,
                  arms={"L": dict(fwd=10, out=16, twist=-5, elbow=30), "R": dict(fwd=10, out=12, twist=8, elbow=52)})
    g = H.gait(frames=20, stride=0.7, lift=0.14, duty=0.45, drop=0.05, bob=0.03, lean=6.0, twist=10.0, sway=0.012,
               arm_swing=30.0, elbow=35.0, arm_out=14.0, arms={"R": dict(swing=0.6, fwd=8, elbow=55, out=12, twist=8)})
    P.key_loop("Idle", 48, lambda t: H.idle_spec(P, t, st))
    P.key_loop("Walk", g["frames"], lambda p: H.gait_spec(P, p, g, st))
    r = CL.run_gait(frames=14, stride=1.05, lean=14.0, arm_out=14.0, twist=14.0,
                    arms={"R": dict(swing=0.5, fwd=20, elbow=70, out=14, twist=8)})
    P.key_loop("Run", r["frames"], lambda p: H.gait_spec(P, p, r, st))
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
    P.key_poses("Attack", [(0, base), (5, wind, "out"), (8, slash, "in3"), (10, follow, "out"), (15, base, "smooth")])
    # Attack2: two-handed overhead cleave, long rattling wind-up, heavy chop, blade stuck in the ground, wrench free
    both = {"upper_arm.L": arm_r("L", 150, -5, 20), "forearm.L": (-70, 0, 0)}
    up1 = over(plus(base, {"hips": {"r": (-6, 0, 6), "t": (0, 0.05, -0.04)}, "spine": (-8, 0, 4), "chest": (-14, 0, 6),
                           "neck": (-6, 0, 0), "head": (-10, 0, 0)}), {**sword(165, 8, 0, 70, -20), **both})
    up2 = plus(up1, {"chest": (-4, 0, 2), "head": (-4, 6, 0)})
    chop = over(plus(base, {"hips": {"r": (18, 0, -4), "t": (0, -0.1, -0.14)}, "spine": (16, 0, 0), "chest": (20, 0, -4),
                            "head": (-16, 0, 0)}),
                {**sword(62, 4, 0, 4, 40), "upper_arm.L": arm_r("L", 60, -4, 20), "forearm.L": (-18, 0, 0)})
    stuck = plus(chop, {"hips": {"t": (0, 0.01, 0.01)}, "chest": (-2, 0, 4), "head": (-4, 0, 6)})
    wrench = plus(chop, {"hips": {"r": (-8, 0, 6), "t": (0, 0.03, 0.05)}, "chest": (-10, 0, 8)})
    P.key_poses("Attack2", [(0, base), (8, up1, "out"), (16, up2, "smooth"), (19, chop, "in3"), (26, stuck, "out"),
                            (30, wrench, "smooth"), (36, base, "smooth")])
    P.key_poses("Hit", CL.hit_keys(base, 1.1))
    P.key_poses("Death", H.death_keys(P, body, base, "back", turn=20, exclude=None, arms={
        "upper_arm.R": arm_r("R", 10, 60, 0), "forearm.R": (-10, 0, 0), "hand.R": (75, 0, 0)}))


SKELETON = hq.Spec("skeleton", SKEL_L, build="slim", face="stern", faces=3000, body_fn=skeleton_body,
                   eyes_fn=skeleton_eyes, dress=skeleton_dress, animate=skeleton_anim, kind="monster",
                   main_size=1024, cloth_size=512, height=1.85, preview=("Attack2", 19))
