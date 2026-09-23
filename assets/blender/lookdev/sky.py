"""Sky HDRIs: Cycles equirectangular panorama of a physical sky (Sky Texture, multiple-scattering model =
Blender 5's successor of Nishita) + procedural VOLUMETRIC clouds ray-marched inside the world shader
(a 'CloudDensity' node group sampled along each view ray through a cloud slab, with light-march samples
toward the sun, Henyey-Greenstein phase, Beer transmittance and aerial fade) + a thin cirrus layer.

Why ray-march in nodes instead of a Cycles volume object: a 120 km volume slab rendered with Cycles'
null-scattering volumes stays a firefly field after minutes of GPU time (measured: 100 s for 256x128 @16 spp,
still speckled). The node ray-march is deterministic, noise free with 16 AA samples, and fully controllable.

Outputs (client/public/env/):
    sky_<name>.hdr   1024x512 Radiance RGBE, linear, for image-based lighting (PMREM); sun disc clamped
    sky_<name>.webp  2048x1024 LDR (ACES-fitted tonemap, sRGB) for the visible sky background
    manifest.json    sun/moon direction (three.js coords), colours and suggested intensities per sky

Equirect layout = three.js convention: u=0.5 looks at +X, u=0.75 at +Z (three) = -Y (Blender), v=1 is up.
"""
import json
import math
import os
import time

import bpy
import numpy as np

from ld_common import (ENV_DIR, NB, PREVIEWS, TAU, label, lin_to_srgb, load_image, log, new_scene, render, resize,
                       save_hdr, save_png, save_webp, sheet)

# sun_az = azimuth in degrees in the three.js ground plane, from +X towards +Z (az 90 = +Z = Blender -Y).
# cloud: cov 0..1 coverage, base/thick metres, sigma = extinction per metre at density 1, scale = feature size (m)
# sun_rgb / amb_rgb: light colours reaching the clouds; E / A: their strength relative to the mean sky luminance.
SKIES = {
    "day": dict(sun_elev=50.0, sun_az=135.0, air=1.0, dust=1.3, ozone=1.0,
                cov=0.42, base=1500.0, thick=1100.0, sigma=0.03, scale=2600.0,
                sun_rgb=(1.0, 0.96, 0.9), amb_rgb=(0.62, 0.72, 0.9), E=3.2, A=1.15,
                cirrus=0.45, haze=0.12, ground="#3d3a2e", target=1.0, exposure=-0.35),
    "golden": dict(sun_elev=5.5, sun_az=200.0, air=1.5, dust=7.0, ozone=1.2,
                   cov=0.36, base=1800.0, thick=900.0, sigma=0.025, scale=3200.0,
                   sun_rgb=(1.0, 0.55, 0.26), amb_rgb=(0.55, 0.52, 0.62), E=5.0, A=0.9,
                   cirrus=0.85, haze=0.85, ground="#3e3326", target=0.55, exposure=0.3,
                   grade_hor=(1.35, 0.98, 0.66), grade_zen=(1.08, 0.94, 0.86)),
    "overcast": dict(sun_elev=34.0, sun_az=160.0, air=1.2, dust=5.0, ozone=1.0,
                     cov=0.96, base=900.0, thick=1600.0, sigma=0.018, scale=2300.0,
                     sun_rgb=(0.95, 0.95, 0.95), amb_rgb=(0.72, 0.76, 0.82), E=2.0, A=1.5,
                     cirrus=0.0, haze=0.4, ground="#35352f", target=0.7, exposure=-0.05),
    "night": dict(sun_elev=36.0, sun_az=240.0, night=True,
                  cov=0.32, base=1700.0, thick=800.0, sigma=0.022, scale=3300.0,
                  sun_rgb=(0.7, 0.8, 1.0), amb_rgb=(0.35, 0.42, 0.6), E=6.0, A=0.8,
                  cirrus=0.3, haze=0.0, ground="#1d2027", target=0.06, exposure=2.3),
}
SEEDS = {"day": 1.0, "golden": 2.0, "overcast": 3.0, "night": 4.0}
W_RENDER, H_RENDER = 2048, 1024
STEPS = 20          # primary ray-march steps through the cumulus slab
SEG = 4             # steps per render pass (SVM node budget)
MAX_DIST = 42000.0  # metres along the view ray (beyond: aerial fade to the horizon)


def sun_vec_blender(elev, az_three):
    """three.js azimuth (from +X towards +Z) -> Blender unit vector (three +Z = Blender -Y)."""
    e, a = math.radians(elev), math.radians(az_three)
    return (math.cos(e) * math.cos(a), -math.cos(e) * math.sin(a), math.sin(e))


def _camera(sc):
    cd = bpy.data.cameras.new("Pano")
    cd.type = "PANO"
    cd.panorama_type = "EQUIRECTANGULAR"
    cam = bpy.data.objects.new("Pano", cd)
    sc.collection.objects.link(cam)
    cam.rotation_euler = (math.radians(90), 0, math.radians(-90))  # looks at +X, image right = -Y
    sc.camera = cam
    return cam


# ------------------------------------------------------------------------------- cloud density node group
def _density_group(p, seed):
    """ShaderNodeTree group: Position (m) -> Density 0..1 (cumulus: coverage fbm, vertical profile, worley
    billows, wispy erosion)."""
    g = bpy.data.node_groups.new(f"CloudDensity_{seed:g}", "ShaderNodeTree")
    g.interface.new_socket("Position", in_out="INPUT", socket_type="NodeSocketVector")
    g.interface.new_socket("Density", in_out="OUTPUT", socket_type="NodeSocketFloat")
    nb = NB(g)
    gi = nb.node("NodeGroupInput")
    go = nb.node("NodeGroupOutput")
    pos = gi.outputs["Position"]
    z0, z1 = p["base"], p["base"] + p["thick"]
    ps = nb.sep(pos)
    h = nb.maprange(ps[2], z0, z1, 0.0, 1.0)
    cov = p["cov"]
    top = 0.55 + 0.4 * cov                      # thicker coverage -> flatter tops
    prof = nb.mul(nb.maprange(h, 0.0, 0.1, 0.0, 1.0, "SMOOTHSTEP"), nb.maprange(h, 0.25, top, 1.0, 0.0, "SMOOTHSTEP"))
    s = p["scale"]
    q = nb.vmath("MULTIPLY", pos, (1.0 / s, 1.0 / s, 1.0 / (s * 0.45)))
    q = nb.vmath("ADD", q, (seed * 3.1, seed * 1.7, seed * 0.9))
    cn = nb.noise(q, 1.0, 5.0, 0.55, dist=0.3).outputs["Fac"]
    lo, hi = 0.60 - cov * 0.34, 0.68 - cov * 0.26
    shape = nb.maprange(cn, lo, hi, 0.0, 1.0, "SMOOTHSTEP")
    shape = nb.sub(nb.mul(shape, prof), nb.mul(nb.sub(1.0, prof), 0.2))
    ero = nb.voronoi(nb.vmath("SCALE", q, scale=5.0), 1.0, "F1").outputs["Distance"]
    det = nb.noise(nb.vmath("SCALE", q, scale=17.0), 1.0, 3.0, 0.55).outputs["Fac"]
    d = nb.sub(nb.mul(shape, 1.7), nb.add(nb.mul(ero, 0.45), nb.mul(det, 0.35)))
    d = nb.math("MINIMUM", nb.math("MAXIMUM", d, 0.0), 1.0)
    nb.link(d, go.inputs["Density"])
    return g


def _gnode(nb, group, pos):
    n = nb.node("ShaderNodeGroup")
    n.node_tree = group
    nb.feed(n.inputs["Position"], pos)
    return n.outputs["Density"]


def _hg(nb, c, g):
    """Henyey-Greenstein phase * 4pi (isotropic = 1)."""
    den = nb.math("POWER", nb.sub(1.0 + g * g, nb.mul(c, 2.0 * g)), 1.5)
    return nb.math("DIVIDE", 1.0 - g * g, den)


def _clouds(nb, d, p, sun, skylum, seed, k0=0, k1=None):
    """Ray-march steps k0..k1 of the cumulus slab (Cycles SVM has a node budget: a full 20-step march in one
    world shader renders black, so the march is split into passes composited in numpy).
    Returns (transmittance socket, radiance vector socket) of this segment."""
    k1 = STEPS if k1 is None else k1
    grp = _density_group(p, seed)
    dz = nb.sep(d)[2]
    dzc = nb.math("MAXIMUM", dz, 0.012)
    z0, z1 = p["base"], p["base"] + p["thick"]
    t0 = nb.math("DIVIDE", z0, dzc)
    t1 = nb.math("MINIMUM", nb.math("DIVIDE", z1, dzc), MAX_DIST)
    t0c = nb.math("MINIMUM", t0, MAX_DIST)
    dt = nb.math("DIVIDE", nb.sub(t1, t0c), float(STEPS))
    # per-pixel jitter (deterministic white noise on the direction; AA samples average it out)
    wn = nb.node("ShaderNodeTexWhiteNoise", {"noise_dimensions": "3D"}, Vector=nb.vmath("SCALE", d, 5000.0))
    jit = nb.out(wn, "Value")
    c = nb.vmath("DOT_PRODUCT", d, sun)
    phase = nb.add(nb.mul(_hg(nb, c, 0.6), 0.65), nb.mul(_hg(nb, c, -0.25), 0.35))
    sunL = nb.vmath("SCALE", p["sun_rgb"], scale=nb.mul(phase, p["E"] * skylum))
    sig = p["sigma"]
    T = 1.0
    L = None
    for i in range(k0, k1):
        t = nb.add(t0c, nb.mul(dt, nb.add(float(i), jit)))
        pos = nb.vmath("SCALE", d, scale=t)
        den = _gnode(nb, grp, pos)
        # light march toward the sun: 3 samples (60 m, 220 m, 600 m)
        l1 = _gnode(nb, grp, nb.vmath("ADD", pos, nb.vmath("SCALE", sun, scale=60.0)))
        l2 = _gnode(nb, grp, nb.vmath("ADD", pos, nb.vmath("SCALE", sun, scale=220.0)))
        l3 = _gnode(nb, grp, nb.vmath("ADD", pos, nb.vmath("SCALE", sun, scale=600.0)))
        opt = nb.mul(nb.add(nb.add(nb.mul(l1, 100.0), nb.mul(l2, 240.0)), nb.mul(l3, 520.0)), sig)
        tl = nb.math("EXPONENT", nb.mul(opt, -1.0))
        # multiple-scattering approximation: never fully black inside
        tl = nb.add(nb.mul(tl, 0.85), nb.mul(nb.math("EXPONENT", nb.mul(opt, -0.18)), 0.15))
        hgt = nb.maprange(nb.sep(pos)[2], z0, z1, 0.0, 1.0)
        amb = nb.vmath("SCALE", p["amb_rgb"], scale=nb.mul(nb.add(0.35, nb.mul(hgt, 0.75)), p["A"] * skylum))
        S = nb.vmath("ADD", nb.vmath("SCALE", sunL, scale=tl), amb)
        a = nb.sub(1.0, nb.math("EXPONENT", nb.mul(nb.mul(den, dt), -sig)))
        contrib = nb.vmath("SCALE", S, scale=nb.mul(a, T))
        L = contrib if L is None else nb.vmath("ADD", L, contrib)
        T = nb.mul(T, nb.sub(1.0, a))
    # aerial perspective: far clouds (near the horizon) fade out
    fade = nb.math("EXPONENT", nb.mul(t0c, -1.0 / 26000.0))
    up = nb.maprange(dz, 0.0, 0.03, 0.0, 1.0, "SMOOTHSTEP")
    f = nb.mul(fade, up)
    T = nb.mixf(1.0, T, f)
    L = nb.vmath("SCALE", L, scale=f)
    return T, L


def _cirrus(nb, d, p, sun, skylum, seed):
    """High thin cirrus/cirrostratus streak layer at 8 km (2D, alpha + lit colour)."""
    dz = nb.math("MAXIMUM", nb.sep(d)[2], 0.02)
    t = nb.math("DIVIDE", 8000.0, dz)
    pos = nb.vmath("SCALE", d, scale=t)
    q = nb.vmath("MULTIPLY", pos, (1 / 14000.0, 1 / 5000.0, 0.0))
    q = nb.vmath("ADD", q, (seed * 1.3, seed * 2.9, 0.0))
    n = nb.noise(q, 1.0, 8.0, 0.6, dist=1.3).outputs["Fac"]
    streak = nb.noise(nb.vmath("MULTIPLY", q, (2.0, 22.0, 1.0)), 1.0, 6.0, 0.62).outputs["Fac"]
    a = nb.mul(nb.maprange(n, 0.5, 0.72, 0.0, 1.0, "SMOOTHSTEP"), nb.maprange(streak, 0.3, 0.72, 0.15, 1.0))
    a = nb.mul(a, nb.mul(p["cirrus"] * 0.5, nb.maprange(nb.sep(d)[2], 0.0, 0.08, 0.0, 1.0, "SMOOTHSTEP")))
    c = nb.vmath("DOT_PRODUCT", d, sun)
    ph = _hg(nb, c, 0.7)
    col = nb.vmath("ADD", nb.vmath("SCALE", p["sun_rgb"], scale=nb.mul(ph, 0.9 * skylum)),
                   nb.vmath("SCALE", p["amb_rgb"], scale=1.0 * skylum))
    return a, col


def _night_sky(nb, d, moon):
    """Deep blue gradient + horizon airglow + 3 star layers + faint milky way + moon disc with maria + halo."""
    z = nb.sep(d)[2]
    zc = nb.math("MAXIMUM", z, 0.0)
    grad = nb.ramp(nb.math("POWER", zc, 0.45), [(0.0, "#34466a"), (0.25, "#18253f"), (0.7, "#0b142a"), (1.0, "#070c1c")])
    st = []
    for sc_, amp, seed in ((240.0, 1.0, 0.0), (520.0, 0.5, 11.0), (1100.0, 0.28, 23.0)):
        v = nb.node("ShaderNodeTexVoronoi", {"feature": "F1", "voronoi_dimensions": "3D"},
                    Vector=nb.vmath("ADD", d, (seed, seed * 0.5, 0)), Scale=sc_, Randomness=1.0)
        pt = nb.maprange(v.outputs["Distance"], 0.085, 0.0, 0.0, 1.0, "SMOOTHSTEP")
        bright = nb.math("POWER", nb.bw(v.outputs["Color"]), 5.0)
        st.append(nb.mul(nb.mul(pt, bright), amp))
    stars = nb.add(nb.add(st[0], st[1]), st[2])
    bd = nb.math("ABSOLUTE", nb.vmath("DOT_PRODUCT", d, (0.35, 0.55, 0.76)))
    bmask = nb.maprange(bd, 0.3, 0.0, 0.0, 1.0, "SMOOTHSTEP")
    bn = nb.noise(nb.vmath("SCALE", d, 5.0), 1.0, 8.0, 0.62, dist=0.35).outputs["Fac"]
    band = nb.mul(bmask, nb.maprange(bn, 0.42, 0.75, 0.0, 1.0))
    stars = nb.mul(nb.add(stars, nb.mul(stars, nb.mul(band, 2.5))), nb.maprange(zc, 0.01, 0.25, 0.0, 1.0, "SMOOTHSTEP"))
    hor = nb.maprange(zc, 0.0, 0.2, 1.0, 0.0, "SMOOTHSTEP")
    col = nb.mix(grad, "#7d88a3", nb.mul(hor, 0.3))
    col = nb.vmath("SCALE", col, scale=0.05)
    col = nb.vmath("ADD", col, nb.vmath("SCALE", (0.30, 0.33, 0.45), scale=nb.mul(band, 0.012)))
    col = nb.vmath("ADD", col, nb.vmath("SCALE", (0.9, 0.93, 1.0), scale=nb.mul(stars, 1.6)))
    md = nb.vmath("DOT_PRODUCT", d, moon)
    ang = nb.math("ARCCOSINE", nb.math("MINIMUM", md, 1.0))
    disc = nb.maprange(ang, 0.0125, 0.0108, 0.0, 1.0, "SMOOTHSTEP")
    maria = nb.maprange(nb.noise(nb.vmath("SCALE", d, 700.0), 1.0, 5.0, 0.6).outputs["Fac"], 0.42, 0.62, 1.0, 0.62)
    halo = nb.add(nb.mul(nb.math("EXPONENT", nb.mul(ang, -60.0)), 0.06), nb.mul(nb.math("EXPONENT", nb.mul(ang, -8.0)), 0.012))
    col = nb.vmath("ADD", col, nb.vmath("SCALE", (0.86, 0.9, 1.0), scale=nb.mul(nb.mul(disc, maria), 30.0)))
    col = nb.vmath("ADD", col, nb.vmath("SCALE", (0.55, 0.65, 0.95), scale=halo))
    return col


def _world(sc, p, sun, skylum, with_clouds=True, mode="base"):
    nt = sc.world.node_tree
    nt.nodes.clear()
    nb = NB(nt)
    out = nb.node("ShaderNodeOutputWorld")
    tc = nb.node("ShaderNodeTexCoord")
    d = nb.vmath("NORMALIZE", tc.outputs["Generated"])
    if p.get("night"):
        sky = _night_sky(nb, d, sun)
    else:
        elev = math.asin(sun[2])
        rot = math.atan2(sun[0], sun[1])   # Blender sky: rotation 0 -> sun towards +Y, positive -> towards +X
        sk = nb.node("ShaderNodeTexSky", {"sky_type": "MULTIPLE_SCATTERING", "sun_disc": True,
                                          "sun_size": math.radians(0.9), "sun_intensity": 0.3,
                                          "sun_elevation": elev, "sun_rotation": rot, "altitude": 400.0,
                                          "air_density": p["air"], "aerosol_density": p["dust"],
                                          "ozone_density": p["ozone"]})
        nb.feed(sk.inputs[0], d)   # (name lookup of this socket fails in 5.0.1 world trees)
        sky = sk.outputs[0]
    seed = SEEDS[p["_name"]]
    if mode == "base":
        if with_clouds and p.get("cirrus", 0) > 0:
            ca, ccol = _cirrus(nb, d, p, sun, skylum, seed)
            sky = nb.vmath("ADD", nb.vmath("SCALE", sky, scale=nb.sub(1.0, ca)), nb.vmath("SCALE", ccol, scale=ca))
    else:  # ("L"|"T", k0, k1)
        T, L = _clouds(nb, d, p, sun, skylum, seed, mode[1], mode[2])
        sky = L if mode[0] == "L" else nb.xyz(T, T, T)
    bg = nb.node("ShaderNodeBackground", Strength=1.0)
    nb.link(sky, bg.inputs["Color"])
    nb.link(bg.outputs[0], out.inputs["Surface"])


def _setup(p, res, samples, with_clouds=True, skylum=1.0, mode="base"):
    sc = new_scene(res, samples)
    try:
        sc.world.cycles.sampling_method = "NONE"   # nothing to light: skip the importance map
    except Exception:
        pass
    _camera(sc)
    sun = sun_vec_blender(p["sun_elev"], p["sun_az"])
    _world(sc, p, sun, skylum, with_clouds, mode)
    return sc, sun


# ------------------------------------------------------------------------------- numpy post
def _dirs(H, W):
    v = (np.arange(H) + 0.5) / H          # row 0 = bottom (Blender image origin)
    elev = (v - 0.5) * math.pi
    u = (np.arange(W) + 0.5) / W
    phi = (u - 0.5) * TAU                  # u=0.5 -> +X ; u=0.75 -> three +Z = Blender -Y
    ce = np.cos(elev)[:, None]
    return elev, ce * np.cos(phi)[None, :], -ce * np.sin(phi)[None, :], np.sin(elev)[:, None] * np.ones((1, W))


def upper_mean(arr):
    H = arr.shape[0]
    elev = ((np.arange(H) + 0.5) / H - 0.5) * math.pi
    up = elev > 0
    wts = (np.sin(elev) * np.cos(elev))[up]
    return (arr[up, :, :3] * wts[:, None, None]).sum(axis=(0, 1)) / (wts.sum() * arr.shape[1])


def _smooth_noise(H, W, cell, seed):
    rng = np.random.default_rng(seed)
    gh, gw = H // cell + 2, W // cell + 2
    g = rng.normal(0, 1, (gh, gw))
    y = np.arange(H) / cell
    x = np.arange(W) / cell
    y0, x0 = y.astype(int), x.astype(int)
    fy, fx = (y - y0)[:, None], (x - x0)[None, :]
    fy, fx = fy * fy * (3 - 2 * fy), fx * fx * (3 - 2 * fx)
    a = g[y0][:, x0] * (1 - fx) + g[y0][:, x0 + 1] * fx
    b = g[y0 + 1][:, x0] * (1 - fx) + g[y0 + 1][:, x0 + 1] * fx
    return a * (1 - fy) + b * fy


def _ground_and_haze(arr, p, sun):
    """Lower hemisphere = dark earth lit by the sky (albedo * E / pi), fading into the horizon colour; plus a warm
    aerial haze band above the horizon, stronger toward the sun (Elden Ring golden haze)."""
    H, W = arr.shape[:2]
    elev, dx, dy, dz = _dirs(H, W)
    up = elev > 0
    rgb = arr[..., :3]
    hr = slice(H // 2, H // 2 + max(2, H // 120))
    hcol = rgb[hr].mean(axis=0)
    # blur the horizon colour along u so clouds at the horizon don't streak into the ground
    k = max(3, W // 64)
    hcol = np.stack([np.convolve(np.concatenate([hcol[-k:, c], hcol[:, c], hcol[:k, c]]), np.ones(k) / k, "same")[k:-k]
                     for c in range(3)], axis=1)
    E = upper_mean(arr) * math.pi
    alb = np.array([int(p["ground"][i:i + 2], 16) / 255.0 for i in (1, 3, 5)]) ** 2.2
    sun_e = 0.0 if p.get("night") else max(0.0, math.sin(math.radians(p["sun_elev"]))) * p["E"] * 0.35 * float(np.dot(E / math.pi, (0.2126, 0.7152, 0.0722)))
    L_ground = alb * (E + sun_e * np.array(p["sun_rgb"])) / math.pi
    var = 1.0 + 0.07 * _smooth_noise(H, W, 48, 3) + 0.03 * _smooth_noise(H, W, 12, 5)
    t = np.clip(-elev / math.radians(10.0), 0, 1)[:, None] ** 0.55
    ground = hcol[None, :, :] * (1 - t[..., None]) + (L_ground[None, None, :] * var[..., None]) * t[..., None]
    rgb[~up] = ground[~up]
    if p.get("grade_hor"):
        # colour grade of the sky dome: horizon tint -> zenith tint (golden-hour warmth, overcast grey...)
        g = np.clip(elev / math.radians(35.0), 0, 1)[:, None, None] ** 0.7
        gh, gz = np.array(p["grade_hor"], np.float32), np.array(p.get("grade_zen", (1, 1, 1)), np.float32)
        tint = gh * (1 - g) + gz * g
        rgb[up] = (rgb * tint)[up]
    if p.get("haze", 0) > 0:
        cosang = dx * sun[0] + dy * sun[1] + dz * sun[2]
        toward = np.clip((cosang + 0.2) / 1.2, 0, 1) ** 3
        band = np.exp(-np.clip(elev, 0, None) / math.radians(9.0))[:, None] * up[:, None]
        hz = hcol[None, :, :] * (0.7 + 1.1 * toward[..., None])
        a = (p["haze"] * band * (0.35 + 0.65 * toward))[..., None]
        rgb[:] = rgb * (1 - a * 0.75) + hz * a * 0.75
    arr[..., :3] = rgb
    arr[..., 3] = 1.0
    return arr


def tonemap(x, exposure=0.0):
    """ACES fitted (Narkowicz) + sRGB — the LDR background and previews."""
    x = np.clip(x * (2.0 ** exposure), 0, None)
    a, b, c, d, e = 2.51, 0.03, 2.43, 0.59, 0.14
    return lin_to_srgb(np.clip((x * (a * x + b)) / (x * (c * x + d) + e), 0, 1))


def measure_skylum(p):
    """Mean luminance of the clear sky (no clouds) — clouds are lit relative to it."""
    sc, _ = _setup(p, (128, 64), 4, with_clouds=False)
    arr = render(sc, f"skylum_{p['_name']}", samples=4)
    return float(np.dot(upper_mean(arr), (0.2126, 0.7152, 0.0722)))


def build_sky(name, samples=16, res=(W_RENDER, H_RENDER)):
    p = dict(SKIES[name])
    p["_name"] = name
    skylum = measure_skylum(p)
    t = time.time()
    sc, sun = _setup(p, res, samples, True, skylum, "base")
    arr = render(sc, f"sky_{name}_base", samples=samples)
    # cloud segments, composited front to back: C = sum_k (prod_{j<k} T_j) L_k ; final = sky * prod T + C
    Tacc = np.ones(arr.shape[:2] + (1,), np.float32)
    C = np.zeros(arr.shape[:2] + (3,), np.float32)
    for k0 in range(0, STEPS, SEG):
        k1 = min(STEPS, k0 + SEG)
        _world(sc, p, sun, skylum, True, ("L", k0, k1))
        Lk = render(sc, f"sky_{name}_L{k0}", samples=samples)[..., :3]
        _world(sc, p, sun, skylum, True, ("T", k0, k1))
        Tk = render(sc, f"sky_{name}_T{k0}", samples=samples)[..., :1]
        C += Tacc * Lk
        Tacc *= Tk
    arr[..., :3] = arr[..., :3] * Tacc + C
    log(f"sky {name}: {res} {samples} spp, {STEPS} march steps, {2 * math.ceil(STEPS / SEG) + 1} passes on "
        f"{render.last[0]} in {time.time() - t:.1f}s (clear-sky lum {skylum:.4g})")
    arr = _ground_and_haze(arr, p, sun)
    lum = float(np.dot(upper_mean(arr), (0.2126, 0.7152, 0.0722)))
    arr[..., :3] *= p["target"] / max(lum, 1e-9)
    # clamp the sun disc for PMREM (the client lights with a DirectionalLight along sunDirection)
    lumi = arr[..., :3] @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    cap = 48.0 * p["target"]
    over = lumi > cap
    arr[over, :3] *= (cap / lumi[over])[:, None]
    hdr = resize(arr, 1024, 512)
    hdr[..., 3] = 1
    sz_hdr = save_hdr(hdr, os.path.join(ENV_DIR, f"sky_{name}.hdr"))
    ldr = tonemap(arr[..., :3], p["exposure"])
    sz_webp = save_webp(ldr, os.path.join(ENV_DIR, f"sky_{name}.webp"), quality=86)
    log(f"sky {name}: hdr {sz_hdr // 1024} KB, webp {sz_webp // 1024} KB")
    e, a = math.radians(p["sun_elev"]), math.radians(p["sun_az"])
    sdir3 = [round(math.cos(e) * math.cos(a), 4), round(math.sin(e), 4), round(math.cos(e) * math.sin(a), 4)]
    H = arr.shape[0]
    hor = arr[H // 2 + 2: H // 2 + 12, :, :3].mean(axis=(0, 1))
    zen = arr[-60:, :, :3].mean(axis=(0, 1))
    amb = upper_mean(arr)

    def nrm(c):
        return [round(float(x), 4) for x in c / max(float(c.max()), 1e-9)]
    fogk = {"day": 0.78, "golden": 0.8, "overcast": 0.68, "night": 0.3}[name]
    return {
        "hdr": f"env/sky_{name}.hdr", "background": f"env/sky_{name}.webp",
        "sunDirection": sdir3, "sunElevationDeg": p["sun_elev"], "sunAzimuthDeg": p["sun_az"],
        "light": "moon" if p.get("night") else "sun",
        "lightColor": [round(c, 3) for c in p["sun_rgb"]],
        "lightIntensity": {"day": 3.0, "golden": 2.6, "overcast": 0.8, "night": 0.35}[name],
        "horizonColor": nrm(hor), "zenithColor": nrm(zen),
        "fogColor": [round(float(x), 4) for x in lin_to_srgb(np.clip(np.array(nrm(hor)) * fogk, 0, 1))],
        "ambientLinear": [round(float(x), 4) for x in amb],
        "backgroundExposure": p["exposure"],
        "bytes": {"hdr": sz_hdr, "webp": sz_webp},
    }


def write_manifest(entries):
    path = os.path.join(ENV_DIR, "manifest.json")
    data = {}
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            data = {}
    data["_doc"] = ("Sky HDRIs for IBL. Equirect, three.js layout (u=0.5 -> +X, u=0.75 -> +Z, v=1 up), so "
                    "RGBELoader + EquirectangularReflectionMapping needs no rotation. hdr = linear Radiance RGBE "
                    "1024x512, sun disc clamped: light the sun/moon with a DirectionalLight from sunDirection "
                    "(normalised, three.js world coords, points from the ground TO the sun). webp = 2048x1024 "
                    "tonemapped sRGB background (colorSpace SRGB). Upper-hemisphere mean luminance normalised: "
                    "day 1.0, golden 0.55, overcast 0.70, night 0.06 (keep toneMappingExposure ~1 and blend "
                    "envMapIntensity across the day cycle).")
    data.update(entries)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    return path


def preview(names):
    tiles = []
    for n in names:
        pth = os.path.join(ENV_DIR, f"sky_{n}.webp")
        if os.path.exists(pth):
            a = resize(load_image(pth), 1024, 512)
            tiles.append(label(a, f"SKY_{n}", 8, 8, 3))
    if tiles:
        save_png(sheet(tiles, 2, "LOOKDEV SKIES - LDR BACKGROUND"), os.path.join(PREVIEWS, "lookdev_sky.png"))
