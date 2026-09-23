"""Dwellings & camp: tent (goblin hide teepee), campfire, swamp_hut (on stilts), snow_cabin (log cabin under snow).

Built directly at game resolution (real planks / logs / poles / stones as geometry, bevelled), procedural shader
materials baked straight onto the mesh (no high poly needed: the relief comes from the shader bump + AO).
Rows of planks / boards / logs are laid with the kit's Geometry-Nodes instance_on_curve; moss, reeds and stones
are GN scatters. Front = -Y.
"""
import math
import random

import bpy

import pk
from pk import M, V, gn
from p_mats import charred_wood, flame, hide


# =============================================================================== shared bits
def row(inst, p0, p1, spacing, seed=0, rand_rot=0.0, rand_scale=0.0, name="Row"):
    """GN instance_on_curve along the straight line p0 -> p1 (instance axes: X = along the row, Y = world up,
    Z = across; see pk notes). Returns the realised mesh object; the template is removed."""
    cu = gn.make_curve([[tuple(p0), tuple(p1)]], name=name + "Curve", kind="POLY")
    gn.instance_on_curve(cu, inst, spacing=spacing, random_rot=rand_rot, random_scale=rand_scale, seed=seed,
                         name=name)
    ob = gn.apply(cu)
    ob.name = name
    return ob


def board_tpl(name, width, length, thick, mat, seed=0, axis="Y"):
    """Plank template for row(): X = width (along the row), `axis` Y (vertical boards) or Z (deck boards)."""
    if axis == "Y":
        size = (width * 0.94, length, thick)
    else:
        size = (width * 0.94, thick, length)
    b = pk.box("_" + name, size, (0, 0, 0), mat, bevel=min(width, thick) * 0.2, seg=1)
    rnd = random.Random(seed)
    for v in b.data.vertices:                      # warped, uneven old boards
        k = v.co.y if axis == "Y" else v.co.z
        v.co.x += 0.012 * math.sin(k * 3.0 + rnd.uniform(0, 6))
    return b


def rock_piece(name, size, mat, seed=0, sub=2):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=sub, radius=1.0)
    r = bpy.context.object
    r.name = name
    r.scale = size
    pk.C.apply_transforms(r)
    r.data.materials.append(mat)
    gn.planar_cuts(r, cuts=5, depth=(0.05, 0.15), seed=seed)
    gn.displace(r, strength=min(size) * 0.25, scale=2.5 / max(size), detail=4, voronoi=0.3, seed=seed)
    gn.apply(r)
    pk.smooth_all(r)
    return r


def log(name, p0, p1, r, mat, verts=10, seed=0, bark_bumps=0.12):
    """Round log between two points, slightly irregular, capped."""
    b = pk.beam(name, p0, p1, r, verts=verts, mat=mat, r1=r * 0.92)
    rnd = random.Random(seed)
    for v in b.data.vertices:
        v.co += v.normal * r * bark_bumps * (rnd.random() - 0.5)
    return b


# =============================================================================== campfire
def build_campfire(args):
    """≈1.6 m ring of soot-blackened stones, charred logs in a teepee with glowing cracks, ash bed, emissive
    flame tongues (own 'FireGlow' material so the client can find the fire)."""
    rnd = random.Random(5)
    stone = M.rock("CampStone", color="#6d6861", color2="#4a4640", strata=0.2, scale=2.5, seed=2, dirt=0.9,
                   wear=0.12, moss=0.1, lichen=0.1)
    pk.overlay_ground_dirt(stone, "#1c1712", 0.35, 0.9, 3)      # soot creeping up from the fire side
    char = charred_wood("CharredWood", seed=3, ember_strength=3.0)
    objs = []
    n = 12
    for i in range(n):
        a = 2 * math.pi * i / n + rnd.uniform(-0.08, 0.08)
        s = rnd.uniform(0.15, 0.21)
        r = rock_piece(f"Stone{i}", (s * 1.25, s, s * 0.8), stone, seed=10 + i)
        pk.transform(r, (math.cos(a) * 0.64, math.sin(a) * 0.64, s * 0.35), (0, 0, math.degrees(a) + rnd.uniform(-20, 20)))
        objs.append(r)
    # ash bed
    ash_r = [pk.ring(32, 0.52 * f, z=z) for z, f in ((-0.03, 1.0), (0.03, 0.9), (0.06, 0.55), (0.07, 0.1))]
    ash = pk.loft("Ash", ash_r, char)
    gn.displace(ash, strength=0.02, scale=8.0, detail=3, voronoi=0.0, seed=1, subdiv=1)
    gn.apply(ash)
    pk.delete_bottom(ash, z=0.0)
    objs.append(ash)
    # teepee logs + two lying logs
    for i in range(5):
        a = 2 * math.pi * i / 5 + 0.3
        p0 = (math.cos(a) * 0.4, math.sin(a) * 0.4, 0.04)
        p1 = (math.cos(a + 0.4) * 0.05, math.sin(a + 0.4) * 0.05, 0.62 + rnd.uniform(-0.05, 0.05))
        objs.append(log(f"Log{i}", p0, p1, rnd.uniform(0.045, 0.06), char, seed=i))
    objs.append(log("LogA", (-0.42, -0.12, 0.07), (0.38, 0.2, 0.09), 0.07, char, seed=11))
    objs.append(log("LogB", (-0.2, 0.4, 0.08), (0.25, -0.38, 0.1), 0.065, char, seed=12))
    # flame tongues (lofted, drifting, elliptic cross-sections)
    fl = flame("FireGlow")
    tongues = []
    for i in range(7):
        a = 2 * math.pi * i / 7 + rnd.uniform(-0.3, 0.3)
        rr = 0.12 if i else 0.0
        cx, cy = math.cos(a) * rr, math.sin(a) * rr
        h = rnd.uniform(0.55, 0.95) if i else 1.05
        w = rnd.uniform(0.09, 0.13) if i else 0.17
        dx, dy = rnd.uniform(-0.12, 0.12), rnd.uniform(-0.12, 0.12)
        rings = []
        for k in range(7):
            t = k / 6
            rad = w * math.sin(math.pi * min(1.0, 0.25 + t * 0.85)) * (1 - t) ** 0.6 + 0.004
            ox = cx + dx * t * t + 0.03 * math.sin(t * 7 + i)
            oy = cy + dy * t * t
            rings.append(pk.ring(10, rad, rad * 0.62, z=0.06 + h * t, cx=ox, cy=oy, phase=a))
        tongues.append(pk.loft(f"Flame{i}", rings, fl))
    flames = pk.join(tongues, "Flames")
    objs.append(flames)
    return pk.finish("campfire", objs, args, budget="prop", expected=(1.6, 1.6, 1.05), size=1024,
                     group_sizes={"FireGlow": 256}, open_ok=True, ao_distance=0.3)


# =============================================================================== tent
def build_tent(args):
    """Goblin hide teepee ≈3.5 m wide, ≈3.3 m tall with poles: stitched mismatched hides sagging between nine
    poles, soot-blackened smoke hole, open entrance flap on the front (-Y), horned skull totem, hem stones."""
    rnd = random.Random(7)
    hidem = hide("HideTent", seed=2)
    wood = M.wood("PoleWood", color="#5b4630", color2="#2e2118", seed=4, axis="Z", weathered=0.4, wear=0.3)
    bonem = M.bone("Bone", seed=2)
    stone = M.rock("HemStone", color="#6a665e", color2="#4d4943", scale=3.0, seed=6, moss=0.3)
    rope = M.leather("Rope", color="#6e5a3c", seed=1)
    NP = 9
    R, H = 1.72, 2.85
    apex = V((0.0, 0.08, H))
    door = -math.pi / 2
    DOOR_TOP, DOOR_W = 1.75, math.radians(24)
    step = 2 * math.pi / NP
    pole0 = door + step / 2                                       # a pole on each side of the door

    def door_half(z):
        """Half angle of the entrance opening at height z (0 above the door: the cover closes there)."""
        if z >= DOOR_TOP:
            return 0.0
        f = 1.0 - z / DOOR_TOP
        return DOOR_W * math.sqrt(f)

    def cover_pt(a, t, z):
        frac = ((a - pole0) / step) % 1.0
        sag = 0.14 * (1 - t) ** 0.8 * math.sin(math.pi * frac)       # hides sag between the poles
        r = R * (1 - t) - sag
        return V((math.cos(a) * r, math.sin(a) * r, z)) + (apex - V((0, 0, H))) * t

    # the entrance is part of the parametrisation (clean straight edges, no stair-stepped deleted faces)
    rows, cols = 16, 72
    verts, faces = [], []
    for j in range(rows):
        t = j / (rows - 1) * 0.955
        z = 0.02 + (H - 0.02) * t
        w = door_half(z)
        for i in range(cols + 1):
            a = door + w + (2 * math.pi - 2 * w) * i / cols
            p = cover_pt(a, t, z)
            if j == 0:
                p.z += 0.04 * math.sin(i * 1.7) + 0.02                # uneven hem
            verts.append(p)
    W = cols + 1
    for j in range(rows - 1):
        for i in range(cols):
            k = j * W + i
            faces.append((k, k + 1, k + W + 1, k + W))
    cover = pk.mesh_obj("Cover", verts, faces, hidem, smooth=True)
    pk.clean(cover, dist=1e-3)                                       # welds the closed part above the door
    gn.displace(cover, strength=0.02, scale=3.0, detail=3, voronoi=0.0, seed=3)
    gn.solidify(cover, 0.022, offset=-1.0)
    gn.apply(cover)
    objs = [cover]
    # entrance flaps rolled back along both door edges, lashed with rope
    for sgn in (-1, 1):
        pts = []
        for k in range(7):
            z = 0.12 + (DOOR_TOP - 0.12) * k / 6
            t = (z - 0.02) / (H - 0.02)
            a = door + sgn * (door_half(z) + 0.035)
            p = cover_pt(a, t, z)
            p += V((math.cos(a), math.sin(a), 0)) * 0.03
            pts.append((p.x, p.y, p.z, 1.0 - 0.55 * k / 6))
        c = gn.make_curve([pts], name=f"Flap{sgn}", kind="NURBS")
        gn.curve_to_mesh(c, radius=0.075, profile_res=10, material=hidem)
        objs.append(gn.apply(c))
        mid = V(pts[2][:3])
        a = door + sgn * (door_half(mid.z) + 0.035)
        tie = pk.C.torus(f"Tie{sgn}", major=0.085, minor=0.013, seg=12, minor_seg=6, mat=rope,
                         loc=tuple(mid), rot=(math.pi / 2, 0, a))
        objs.append(tie)
    # poles poking out of the smoke hole
    for k in range(NP):
        a = pole0 + step * k
        p0 = V((math.cos(a) * (R + 0.02), math.sin(a) * (R + 0.02), -0.05))
        d = (apex - p0)
        p1 = apex + d.normalized() * rnd.uniform(0.35, 0.6)
        objs.append(pk.beam(f"Pole{k}", p0, p1, 0.045, verts=8, mat=wood, r1=0.03))
    lash = pk.C.torus("Lashing", major=0.13, minor=0.035, seg=16, minor_seg=6, mat=rope, loc=tuple(apex + V((0, 0, 0.05))))
    objs.append(lash)
    # horned skull totem hung on the cover above the door (resting against the hides, tilted with the slope)
    sk = pk.C.sphere("Skull", r=0.12, segments=14, rings=10, mat=bonem, loc=(0, 0, 0))
    sk.scale = (0.9, 1.1, 0.85)
    pk.C.apply_transforms(sk)
    snout = pk.C.sphere("Snout", r=0.065, segments=10, rings=8, mat=bonem, loc=(0, -0.12, -0.06))
    snout.scale = (0.85, 1.3, 0.8)
    pk.C.apply_transforms(snout)
    horns = []
    for sgn in (-1, 1):                                  # short curled horns (sideways, up, then forward)
        pts = [(sgn * 0.08, 0.0, 0.04, 1.0), (sgn * 0.17, 0.0, 0.08, 0.85), (sgn * 0.24, -0.03, 0.15, 0.65),
               (sgn * 0.25, -0.08, 0.23, 0.45), (sgn * 0.21, -0.13, 0.27, 0.2)]
        c = gn.make_curve([pts], name=f"Horn{sgn}", kind="NURBS")
        gn.curve_to_mesh(c, radius=0.03, profile_res=8, material=bonem)
        horns.append(gn.apply(c))
    skull = pk.join([sk, snout] + horns, "SkullTotem")
    zs = 2.02
    ts = (zs - 0.02) / (H - 0.02)
    surf = cover_pt(door, ts, zs)
    slope = math.degrees(math.atan2(R, H))               # cone half angle from the vertical
    pk.transform(skull, (surf.x, surf.y - 0.06, zs), (-slope * 0.8, 0, 0))
    objs.append(skull)
    objs.append(pk.beam("SkullPeg", (surf.x, surf.y + 0.12, zs + 0.1), (surf.x, surf.y - 0.1, zs + 0.06), 0.018,
                        verts=6, mat=wood))
    # hem stones holding the hides down
    for k in range(10):
        a = 2 * math.pi * k / 10 + 0.4
        if abs(math.atan2(math.sin(a - door), math.cos(a - door))) < 0.35:
            continue
        s = rnd.uniform(0.1, 0.15)
        r = rock_piece(f"Hem{k}", (s * 1.3, s, s * 0.7), stone, seed=30 + k, sub=2)
        pk.transform(r, (math.cos(a) * (R + 0.08), math.sin(a) * (R + 0.08), s * 0.25))
        objs.append(r)
    return pk.finish("tent", objs, args, budget="building", expected=(3.7, 3.7, 3.35), size=2048, open_ok=True,
                     ao_distance=0.5)


BUILDERS = {
    "campfire": build_campfire,
    "tent": build_tent,
}
