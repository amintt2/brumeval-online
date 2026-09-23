"""Geometry Nodes builders (created from Python) + modifier helpers.

    gn.displace(rock, strength=0.18, scale=1.4, subdiv=3, voronoi=0.6, strata=0.3, seed=4)
    gn.edge_wear(rock)                                    # stores 'wear' and 'cavity' point attributes for shaders
    gn.scatter(rock, moss_clump, density=25, up_min=0.55, scale=(0.6, 1.3), embed=0.02, seed=2)
    gn.instance_on_curve(path, link_obj, spacing=0.09, alternate=90)   # chains, planks, tiles, bricks
    gn.curve_to_mesh(curve, radius=0.05, taper=[(0, 1), (1, 0.2)])     # ropes, roots, tails, horns, branches
    tree = gn.branch_tree(seed=3, height=5)                             # recursive branch generator
    gn.apply(obj)                                         # apply modifiers (curves -> mesh)

All graphs realise their instances so the result bakes and exports as one normal mesh.
Template objects used as instances are hidden (hide_render) and should be deleted with gn.remove() after apply.
"""
import math
import random

import bpy
import mathutils

from .nodes import NB, sock


# =============================================================================== scaffolding
def _group(name):
    ng = bpy.data.node_groups.new(name, "GeometryNodeTree")
    ng.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    ng.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    nb = NB(ng)
    gi = nb.node("NodeGroupInput")
    go = nb.node("NodeGroupOutput")
    return ng, nb, gi, go


def _mod(obj, ng, name):
    md = obj.modifiers.new(name, "NODES")
    md.node_group = ng
    return md


def _obj_geo(nb, obj, as_instance=True, relative=False):
    oi = nb.node("GeometryNodeObjectInfo", {"transform_space": "RELATIVE" if relative else "ORIGINAL"})
    oi.inputs["Object"].default_value = obj
    try:
        oi.inputs["As Instance"].default_value = as_instance
    except KeyError:
        pass
    return oi.outputs["Geometry"]


def _instances_src(nb, instance):
    """Object -> geometry; Collection -> separate children (pick randomly)."""
    if isinstance(instance, bpy.types.Collection):
        ci = nb.node("GeometryNodeCollectionInfo", {"transform_space": "ORIGINAL"})
        ci.inputs["Collection"].default_value = instance
        ci.inputs["Separate Children"].default_value = True
        ci.inputs["Reset Children"].default_value = True
        return ci.outputs[0], True
    for o in ([instance] if not isinstance(instance, (list, tuple)) else instance):
        hide_template(o)
    return _obj_geo(nb, instance), False


def hide_template(obj):
    obj.hide_render = True
    obj.hide_viewport = False
    obj["kit_template"] = 1
    return obj


def template_collection(objs, name="_templates"):
    """Put objects in a (render-hidden) collection, e.g. several rock/leaf variants picked at random by scatter()."""
    col = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    if col.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(col)
    for o in objs:
        for c in list(o.users_collection):
            c.objects.unlink(o)
        col.objects.link(o)
        hide_template(o)
    col.hide_render = True
    return col


def _random(nb, dtype, lo, hi, seed, id_sock=None):
    r = nb.node("FunctionNodeRandomValue", {"data_type": dtype})
    typ = {"FLOAT": "VALUE", "FLOAT_VECTOR": "VECTOR", "INT": "INT", "BOOLEAN": "VALUE"}[dtype]
    if dtype != "BOOLEAN":
        nb.feed(sock(r.inputs, "Min", typ), lo)
        nb.feed(sock(r.inputs, "Max", typ), hi)
    else:
        nb.feed(sock(r.inputs, "Probability"), lo)
    sock(r.inputs, "Seed").default_value = seed
    if id_sock is not None:
        nb.feed(sock(r.inputs, "ID"), id_sock)
    return sock(r.outputs, "Value", {"FLOAT": "VALUE", "FLOAT_VECTOR": "VECTOR", "INT": "INT", "BOOLEAN": "BOOLEAN"}[dtype])


def _euler_to_rot(nb, vec):
    n = nb.node("FunctionNodeEulerToRotation")
    nb.feed(n.inputs[0], vec)
    return n.outputs[0]


def _rotate(nb, rot, by):
    n = nb.node("FunctionNodeRotateRotation", {"rotation_space": "LOCAL"})
    nb.feed(n.inputs["Rotation"], rot)
    nb.feed(n.inputs["Rotate By"], by)
    return n.outputs[0]


def _align(nb, rot, vec, axis="Z", pivot="AUTO"):
    n = nb.node("FunctionNodeAlignRotationToVector", {"axis": axis, "pivot_axis": pivot})
    if rot is not None:
        nb.feed(n.inputs["Rotation"], rot)
    nb.feed(n.inputs["Vector"], vec)
    return n.outputs[0]


# =============================================================================== displacement / wear
def displace(obj, strength=0.1, scale=2.0, detail=6.0, rough=0.55, seed=0, voronoi=0.4, vor_scale=None,
             strata=0.0, strata_scale=3.0, subdiv=0, crease=0.0, name="KitDisplace"):
    """Noise + voronoi (+ optional horizontal strata) displacement along the normal. `subdiv` levels of
    Catmull-Clark first (keep the result within budgets or bake it high->low)."""
    ng, nb, gi, go = _group(name)
    geo = gi.outputs[0]
    if subdiv:
        s = nb.node("GeometryNodeSubdivisionSurface", Mesh=geo, Level=subdiv)
        geo = s.outputs[0]
    pos = nb.node("GeometryNodeInputPosition").outputs[0]
    nrm = nb.node("GeometryNodeInputNormal").outputs[0]
    p = nb.vmath("ADD", pos, (seed * 3.1 % 50, seed * 7.7 % 50, seed * 1.3 % 50))
    n = nb.noise(p, scale, detail, rough, dist=0.2)
    h = nb.sub(n.outputs["Fac"], 0.5)
    if voronoi > 0:
        # smooth-F1 gives broad lumps (not turtle-shell domes); sparse cracks only where a mask noise allows
        vo = nb.voronoi(p, vor_scale or scale * 0.8, "SMOOTH_F1", rand=1.0, smooth=0.6)
        h = nb.add(h, nb.mul(nb.sub(0.5, vo.outputs["Distance"]), voronoi))
        ve = nb.voronoi(p, (vor_scale or scale * 0.8) * 1.3, "DISTANCE_TO_EDGE")
        cmask = nb.maprange(nb.noise(nb.vmath("ADD", p, (9.1, 3.3, 1.7)), scale * 0.6, 2.0).outputs["Fac"], 0.5, 0.62)
        h = nb.sub(h, nb.mul(nb.mul(nb.maprange(ve.outputs["Distance"], 0.0, 0.035, 1.0, 0.0), cmask), 0.3 * voronoi))
    if strata > 0:
        z = nb.sep(p)[2]
        st = nb.math("FRACT", nb.mul(nb.add(z, nb.mul(n.outputs["Fac"], 0.3)), strata_scale))
        h = nb.add(h, nb.mul(nb.sub(nb.math("POWER", st, 0.35), 0.5), strata))
    off = nb.vmath("SCALE", nrm, scale=nb.mul(h, strength))
    sp = nb.node("GeometryNodeSetPosition", Geometry=geo, Offset=off)
    nb.link(sp.outputs[0], go.inputs[0])
    return _mod(obj, ng, name)


def planar_cuts(obj, cuts=7, depth=(0.12, 0.3), seed=0, subdiv=0, up_bias=0.0, keep_bottom=True, name="KitCuts"):
    """Chipped / split-rock facets: each cut projects every point beyond a random plane back onto it
    (p -= n * max(0, p.n - d)), giving flat fractured faces with crisp edges (boulders, cliffs, ruins, crystals).
    depth = fraction of the object's extent (along the plane normal) removed by each cut."""
    rnd = random.Random(seed)
    me = obj.data
    pts = [v.co.copy() for v in me.vertices]
    ng, nb, gi, go = _group(name)
    geo = gi.outputs[0]
    if subdiv:
        geo = nb.node("GeometryNodeSubdivisionSurface", Mesh=geo, Level=subdiv).outputs[0]
    for i in range(cuts):
        while True:
            n = mathutils.Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1) + up_bias))
            if 0.2 < n.length <= 1.0 and not (keep_bottom and n.normalized().z < -0.45):
                break
        n.normalize()
        sup = max(p.dot(n) for p in pts)
        low = min(p.dot(n) for p in pts)
        d = sup - (sup - low) * rnd.uniform(*depth)
        pos = nb.node("GeometryNodeInputPosition").outputs[0]
        excess = nb.math("MAXIMUM", nb.sub(nb.vmath("DOT_PRODUCT", pos, tuple(n)), d), 0.0)
        off = nb.vmath("SCALE", tuple(-x for x in n), scale=excess)
        geo = nb.node("GeometryNodeSetPosition", Geometry=geo, Offset=off).outputs[0]
    nb.link(geo, go.inputs[0])
    return _mod(obj, ng, name)


def edge_wear(obj, attr="wear", cavity_attr="cavity", iterations=10, strength=12.0, name="KitEdgeWear"):
    """Store convexity ('wear', 0..1 on ridges/edges) and concavity ('cavity') as point attributes.
    Computed as the offset of each point from its blurred neighbourhood along the normal (curvature estimate).
    Shaders read them with an Attribute node (kit.materials does it automatically for 'wear' and 'moss')."""
    ng, nb, gi, go = _group(name)
    pos = nb.node("GeometryNodeInputPosition").outputs[0]
    nrm = nb.node("GeometryNodeInputNormal").outputs[0]
    bl = nb.node("GeometryNodeBlurAttribute", {"data_type": "FLOAT_VECTOR"})
    nb.feed(sock(bl.inputs, "Value", "VECTOR"), pos)
    bl.inputs["Iterations"].default_value = iterations
    d = nb.vmath("DOT_PRODUCT", nrm, nb.vmath("SUBTRACT", pos, sock(bl.outputs, "Value", "VECTOR")))
    wear = nb.clamp01(nb.mul(d, strength))
    cav = nb.clamp01(nb.mul(d, -strength))
    s1 = nb.node("GeometryNodeStoreNamedAttribute", {"data_type": "FLOAT", "domain": "POINT"}, Geometry=gi.outputs[0], Name=attr)
    nb.feed(sock(s1.inputs, "Value", "VALUE"), wear)
    s2 = nb.node("GeometryNodeStoreNamedAttribute", {"data_type": "FLOAT", "domain": "POINT"}, Geometry=s1.outputs[0], Name=cavity_attr)
    nb.feed(sock(s2.inputs, "Value", "VALUE"), cav)
    nb.link(s2.outputs[0], go.inputs[0])
    return _mod(obj, ng, name)


def store_up_mask(obj, attr="moss", lo=0.5, hi=0.85, noise_scale=2.0, seed=0, name="KitUpMask"):
    """Store an up-facing mask (with noise breakup) as a point attribute (e.g. 'moss' or 'snow')."""
    ng, nb, gi, go = _group(name)
    nrm = nb.node("GeometryNodeInputNormal").outputs[0]
    pos = nb.node("GeometryNodeInputPosition").outputs[0]
    z = nb.sep(nrm)[2]
    n = nb.noise(nb.vmath("ADD", pos, (seed, seed * 2, 0)), noise_scale, 4.0).outputs["Fac"]
    m = nb.mul(nb.smooth(z, lo, hi), nb.maprange(n, 0.35, 0.6))
    s = nb.node("GeometryNodeStoreNamedAttribute", {"data_type": "FLOAT", "domain": "POINT"}, Geometry=gi.outputs[0], Name=attr)
    nb.feed(sock(s.inputs, "Value", "VALUE"), m)
    nb.link(s.outputs[0], go.inputs[0])
    return _mod(obj, ng, name)


# =============================================================================== scattering
def scatter(target, instance, density=10.0, seed=0, up_min=None, attr_mask=None, attr_threshold=0.5,
            scale=(0.8, 1.2), rot_random=(0.3, 0.3, math.pi), align_normal=True, embed=0.0, distance_min=0.0,
            keep_target=True, realize=True, max_count=None, name="KitScatter"):
    """Scatter `instance` (object, list of objects -> random pick, or collection) on `target`'s surface.
    up_min: only faces whose normal z >= up_min (0.5 ~ 60 deg slopes). attr_mask: point attribute name (e.g. 'moss').
    embed: sink instances along the normal (metres) so they sit IN the surface (no floating)."""
    if isinstance(instance, (list, tuple)):
        instance = template_collection(list(instance), f"_tpl_{name}")
    ng, nb, gi, go = _group(name)
    geo = gi.outputs[0]
    sel = None
    nrm = nb.node("GeometryNodeInputNormal").outputs[0]
    if up_min is not None:
        sel = nb.math("GREATER_THAN", nb.sep(nrm)[2], up_min)
    if attr_mask:
        a = nb.node("GeometryNodeInputNamedAttribute", {"data_type": "FLOAT"}, Name=attr_mask)
        am = nb.math("GREATER_THAN", sock(a.outputs, "Attribute", "VALUE"), attr_threshold)
        sel = am if sel is None else nb.mul(sel, am)
    mode = "POISSON" if distance_min > 0 else "RANDOM"
    d = nb.node("GeometryNodeDistributePointsOnFaces", {"distribute_method": mode}, Mesh=geo)
    if mode == "POISSON":
        sock(d.inputs, "Distance Min").default_value = distance_min
        sock(d.inputs, "Density Max").default_value = density
    else:
        sock(d.inputs, "Density").default_value = density
    sock(d.inputs, "Seed").default_value = seed
    if sel is not None:
        nb.feed(sock(d.inputs, "Selection"), sel)
    pts = d.outputs["Points"]
    pnorm = d.outputs["Normal"]
    if embed:
        sp = nb.node("GeometryNodeSetPosition", Geometry=pts, Offset=nb.vmath("SCALE", pnorm, scale=-embed))
        pts = sp.outputs[0]
    rot = _align(nb, None, pnorm, "Z") if align_normal else None
    rr = _euler_to_rot(nb, _random(nb, "FLOAT_VECTOR", tuple(-r for r in rot_random), tuple(rot_random), seed + 1))
    rot = _rotate(nb, rot, rr) if rot is not None else rr
    sc = _random(nb, "FLOAT", scale[0], scale[1], seed + 2)
    src, is_col = _instances_src(nb, instance)
    iop = nb.node("GeometryNodeInstanceOnPoints", Points=pts, Instance=src, Rotation=rot, Scale=sc)
    if is_col:
        iop.inputs["Pick Instance"].default_value = True
        nb.feed(iop.inputs["Instance Index"], _random(nb, "INT", 0, len(instance.objects) - 1, seed + 3))
    out = iop.outputs[0]
    if realize:
        out = nb.node("GeometryNodeRealizeInstances", Geometry=out).outputs[0]
    if keep_target:
        j = nb.node("GeometryNodeJoinGeometry")
        nb.link(geo, j.inputs[0])
        nb.link(out, j.inputs[0])
        out = j.outputs[0]
    nb.link(out, go.inputs[0])
    return _mod(target, ng, name)


def points_object(points, normals=None, name="KitPoints"):
    """Mesh object made of loose vertices (+ 'dir' vector attribute) for instance_on_points()."""
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(p) for p in points], [], [])
    if normals is not None:
        at = me.attributes.new("dir", "FLOAT_VECTOR", "POINT")
        for i, n in enumerate(normals):
            at.data[i].vector = tuple(n)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def instance_on_points(points_obj, instance, align_attr="dir", scale=(0.8, 1.2), rot_random=(0.2, 0.2, math.pi),
                       seed=0, realize=True, name="KitOnPoints"):
    """Instance on every vertex of `points_obj`, Z axis aligned to the 'dir' attribute (e.g. leaf clusters)."""
    if isinstance(instance, (list, tuple)):
        instance = template_collection(list(instance), f"_tpl_{name}")
    ng, nb, gi, go = _group(name)
    a = nb.node("GeometryNodeInputNamedAttribute", {"data_type": "FLOAT_VECTOR"}, Name=align_attr)
    rot = _align(nb, None, sock(a.outputs, "Attribute", "VECTOR"), "Z")
    rot = _rotate(nb, rot, _euler_to_rot(nb, _random(nb, "FLOAT_VECTOR", tuple(-r for r in rot_random), tuple(rot_random), seed)))
    src, is_col = _instances_src(nb, instance)
    mp = nb.node("GeometryNodeMeshToPoints", Mesh=gi.outputs[0])
    iop = nb.node("GeometryNodeInstanceOnPoints", Points=mp.outputs[0], Instance=src, Rotation=rot,
                  Scale=_random(nb, "FLOAT", scale[0], scale[1], seed + 1))
    if is_col:
        iop.inputs["Pick Instance"].default_value = True
        nb.feed(iop.inputs["Instance Index"], _random(nb, "INT", 0, len(instance.objects) - 1, seed + 2))
    out = iop.outputs[0]
    if realize:
        out = nb.node("GeometryNodeRealizeInstances", Geometry=out).outputs[0]
    nb.link(out, go.inputs[0])
    return _mod(points_obj, ng, name)


# =============================================================================== curves
def make_curve(splines, name="KitCurve", kind="POLY", resolution=6):
    """Create a curve object. splines = [[(x,y,z,radius), ...], ...] (radius optional, default 1)."""
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.resolution_u = resolution
    for pts in splines:
        if kind == "BEZIER":
            sp = cu.splines.new("BEZIER")
            sp.bezier_points.add(len(pts) - 1)
            for bp, p in zip(sp.bezier_points, pts):
                bp.co = p[:3]
                bp.radius = p[3] if len(p) > 3 else 1.0
                bp.handle_left_type = bp.handle_right_type = "AUTO"
        else:
            sp = cu.splines.new(kind)
            sp.points.add(len(pts) - 1)
            for cp, p in zip(sp.points, pts):
                cp.co = (*p[:3], 1.0)
                cp.radius = p[3] if len(p) > 3 else 1.0
            if kind == "NURBS":
                sp.use_endpoint_u = True
                sp.order_u = min(4, len(pts))
    ob = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def curve_to_mesh(curve_obj, radius=0.05, profile_res=8, fill_caps=True, taper=None, resample=None, material=None,
                  smooth=True, profile=None, name="KitCurveMesh"):
    """Sweep a circle (or `profile` curve object) along the curve. Final radius = point radius * radius * taper(t).
    taper: [(t, factor), ...] float curve over the spline parameter (0 root -> 1 tip)."""
    ng, nb, gi, go = _group(name)
    cur = gi.outputs[0]
    if resample:
        rs = nb.node("GeometryNodeResampleCurve", Curve=cur)
        try:
            rs.mode = "LENGTH"
        except (AttributeError, TypeError):
            sock(rs.inputs, "Mode").default_value = "Length"
        sock(rs.inputs, "Length").default_value = resample
        cur = rs.outputs[0]
    scale = nb.mul(nb.node("GeometryNodeInputRadius").outputs[0], radius)
    if taper:
        fc = nb.node("ShaderNodeFloatCurve")
        c = fc.mapping.curves[0]
        pts = c.points
        pts[0].location = (taper[0][0], min(1.0, taper[0][1]))
        pts[1].location = (taper[-1][0], min(1.0, taper[-1][1]))
        for t, v in taper[1:-1]:
            pts.new(t, min(1.0, v))
        fc.mapping.update()
        sp = nb.node("GeometryNodeSplineParameter")
        nb.feed(sock(fc.inputs, "Value"), sp.outputs["Factor"])
        scale = nb.mul(scale, sock(fc.outputs, "Value"))
    if profile is not None:
        prof = _obj_geo(nb, profile, as_instance=False)
        hide_template(profile)
    else:
        prof = nb.node("GeometryNodeCurvePrimitiveCircle", Resolution=profile_res, Radius=1.0).outputs[0]
    cm = nb.node("GeometryNodeCurveToMesh", Curve=cur, **{"Profile Curve": prof, "Fill Caps": fill_caps})
    nb.feed(sock(cm.inputs, "Scale"), scale)
    out = cm.outputs[0]
    if smooth:
        out = nb.node("GeometryNodeSetShadeSmooth", Mesh=out).outputs[0]
    if material is not None:
        out = nb.node("GeometryNodeSetMaterial", Geometry=out, Material=material).outputs[0]
        curve_obj.data.materials.append(material)
    out = nb.node("GeometryNodeMergeByDistance", Geometry=out, Distance=0.0005).outputs[0]
    nb.link(out, go.inputs[0])
    return _mod(curve_obj, ng, name)


def instance_on_curve(curve_obj, instance, spacing=0.2, count=None, scale=1.0, random_rot=0.0, random_scale=0.0,
                      alternate=0.0, seed=0, realize=True, offset=(0.0, 0.0, 0.0), name="KitOnCurve"):
    """Place instances along a curve: the instance's +X axis follows the tangent, +Z the curve normal.
    alternate: degrees of extra roll around X on every other instance (90 for chain links).
    Model planks/tiles/bricks/links along +X centred on the origin."""
    if isinstance(instance, (list, tuple)):
        instance = template_collection(list(instance), f"_tpl_{name}")
    ng, nb, gi, go = _group(name)
    ctp = nb.node("GeometryNodeCurveToPoints", {"mode": "COUNT" if count else "LENGTH"}, Curve=gi.outputs[0])
    if count:
        sock(ctp.inputs, "Count").default_value = count
    else:
        sock(ctp.inputs, "Length").default_value = spacing
    tan = ctp.outputs["Tangent"]
    nrm = ctp.outputs["Normal"]
    rot = _align(nb, None, tan, "X")
    rot = _align(nb, rot, nrm, "Z", "X")
    idx = nb.node("GeometryNodeInputIndex").outputs[0]
    if alternate:
        par = nb.math("MODULO", idx, 2.0)
        roll = nb.xyz(nb.mul(par, math.radians(alternate)), 0.0, 0.0)
        rot = _rotate(nb, rot, _euler_to_rot(nb, roll))
    if random_rot:
        rot = _rotate(nb, rot, _euler_to_rot(nb, _random(nb, "FLOAT_VECTOR", (-random_rot,) * 3, (random_rot,) * 3, seed)))
    sc = nb.mul(_random(nb, "FLOAT", 1.0 - random_scale, 1.0 + random_scale, seed + 1), scale)
    src, is_col = _instances_src(nb, instance)
    iop = nb.node("GeometryNodeInstanceOnPoints", Points=ctp.outputs["Points"], Instance=src, Rotation=rot, Scale=sc)
    if is_col:
        iop.inputs["Pick Instance"].default_value = True
        nb.feed(iop.inputs["Instance Index"], _random(nb, "INT", 0, len(instance.objects) - 1, seed + 2))
    out = iop.outputs[0]
    if any(offset):
        tr = nb.node("GeometryNodeTranslateInstances", Instances=out, Translation=offset)
        tr.inputs["Local Space"].default_value = True
        out = tr.outputs[0]
    if realize:
        out = nb.node("GeometryNodeRealizeInstances", Geometry=out).outputs[0]
    nb.link(out, go.inputs[0])
    return _mod(curve_obj, ng, name)


# =============================================================================== recursive tree helper
def branch_tree(seed=0, height=5.0, radius=0.28, levels=3, children=(6, 4, 3), spread=(40, 65), length_ratio=(0.55, 0.45, 0.4),
                gravity=0.12, wobble=0.15, segs=(8, 5, 4), start=(0.35, 0.95), up_bias=0.35, twist=137.5, root_flare=1.35):
    """Recursive branch generator. Returns dict(splines=[[(x,y,z,r)...]], tips=[(pos, dir)], joints=[...]).
    Feed `splines` to make_curve(..., kind='BEZIER' or 'POLY') + curve_to_mesh(radius=1.0), and `tips` to
    points_object()/instance_on_points() to hang leaf clusters. Deterministic for a given seed.
    Children start slightly INSIDE their parent (hidden joints, no gaps)."""
    rnd = random.Random(seed)
    splines, tips = [], []

    def grow(p0, d, length, r0, level, nseg):
        pts = []
        p = mathutils.Vector(p0)
        d = d.normalized()
        seg = length / nseg
        for i in range(nseg + 1):
            t = i / nseg
            r = r0 * (1.0 - 0.75 * t)
            if level == 0 and i == 0:
                r *= root_flare
            pts.append((p.x, p.y, p.z, max(r, 0.004)))
            if i < nseg:
                d = (d + mathutils.Vector((rnd.uniform(-wobble, wobble), rnd.uniform(-wobble, wobble),
                                           rnd.uniform(-wobble, wobble) - gravity * level * 0.5))).normalized()
                p = p + d * seg
        splines.append(pts)
        if level + 1 >= levels:
            tips.append((tuple(pts[-1][:3]), tuple(d)))
            for k in range(len(pts) // 2, len(pts) - 1):
                if rnd.random() < 0.5:
                    tips.append((tuple(pts[k][:3]), tuple(d)))
            return
        n = children[min(level, len(children) - 1)]
        base_ang = rnd.uniform(0, 360)
        for c in range(n):
            t = start[0] + (start[1] - start[0]) * (c + rnd.uniform(0, 0.6)) / n if level == 0 else rnd.uniform(0.3, 0.95)
            k = min(int(t * (len(pts) - 1)), len(pts) - 2)
            f = t * (len(pts) - 1) - k
            a, b = mathutils.Vector(pts[k][:3]), mathutils.Vector(pts[k + 1][:3])
            pp = a.lerp(b, f)
            pr = pts[k][3] * (1 - f) + pts[k + 1][3] * f
            axis = (b - a).normalized()
            ang = math.radians(base_ang + c * twist)
            side = axis.orthogonal().normalized()
            side.rotate(mathutils.Quaternion(axis, ang))
            el = math.radians(rnd.uniform(*spread))
            nd = (axis * math.cos(el) + side * math.sin(el)).normalized()
            nd = (nd + mathutils.Vector((0, 0, up_bias))).normalized()
            cl = length * length_ratio[min(level, len(length_ratio) - 1)] * rnd.uniform(0.75, 1.15) * (1.15 - 0.4 * t)
            cr = pr * rnd.uniform(0.5, 0.7)
            grow(pp - nd * cr * 0.8, nd, cl, cr, level + 1, segs[min(level + 1, len(segs) - 1)])

    grow((0, 0, -0.05), mathutils.Vector((rnd.uniform(-0.05, 0.05), rnd.uniform(-0.05, 0.05), 1)), height * 0.75,
         radius, 0, segs[0])
    return {"splines": splines, "tips": tips}


# =============================================================================== misc modifiers
def voxel_remesh(obj, voxel=0.02, smooth_iters=0, adaptivity=0.0):
    """Fuse overlapping primitives into ONE watertight continuous mesh (bodies, rocks, creature hulls)."""
    md = obj.modifiers.new("KitRemesh", "REMESH")
    md.mode = "VOXEL"
    md.voxel_size = voxel
    md.adaptivity = adaptivity
    md.use_smooth_shade = True
    if smooth_iters:
        sm = obj.modifiers.new("KitSmooth", "CORRECTIVE_SMOOTH")
        sm.iterations = smooth_iters
        sm.smooth_type = "LENGTH_WEIGHTED"
        sm.use_only_smooth = True
    return md


def decimate(obj, ratio=0.5, name="KitDecimate"):
    md = obj.modifiers.new(name, "DECIMATE")
    md.decimate_type = "COLLAPSE"
    md.ratio = ratio
    md.use_collapse_triangulate = True
    return md


def bevel(obj, width=0.01, segments=2, angle=35.0, harden=True):
    md = obj.modifiers.new("KitBevel", "BEVEL")
    md.width = width
    md.segments = segments
    md.limit_method = "ANGLE"
    md.angle_limit = math.radians(angle)
    md.harden_normals = harden
    return md


def weighted_normals(obj):
    md = obj.modifiers.new("KitWN", "WEIGHTED_NORMAL")
    md.keep_sharp = True
    return md


def solidify(obj, thickness=0.01, offset=1.0, rim=True):
    md = obj.modifiers.new("KitSolidify", "SOLIDIFY")
    md.thickness = thickness
    md.offset = offset
    md.use_rim = rim
    md.use_even_offset = True
    # tag the generated inner shell + rim so kit.qa can ignore them (clothing test uses the outer surface)
    if obj.type == "MESH":
        if "kit_shell" not in obj.vertex_groups:
            obj.vertex_groups.new(name="kit_shell")
        md.shell_vertex_group = "kit_shell"
        md.rim_vertex_group = "kit_shell"
    return md


def apply(obj, keep=("ARMATURE",)):
    """Apply every modifier (except `keep` types). Curves/text are converted to meshes. Returns the mesh object."""
    for o in bpy.context.scene.objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    if obj.type in ("CURVE", "FONT", "SURFACE"):
        bpy.ops.object.convert(target="MESH")
        return bpy.context.view_layer.objects.active
    for md in list(obj.modifiers):
        if md.type in keep:
            continue
        try:
            bpy.ops.object.modifier_apply(modifier=md.name)
        except RuntimeError as e:
            print(f"[gn] WARN cannot apply {md.name}: {e}")
            obj.modifiers.remove(md)
    return obj


def remove(*objs):
    """Delete objects (templates) and their orphan data; also removes emptied _tpl_ collections."""
    for o in objs:
        if isinstance(o, bpy.types.Collection):
            for c in list(o.objects):
                remove(c)
            bpy.data.collections.remove(o)
            continue
        data = o.data
        bpy.data.objects.remove(o, do_unlink=True)
        if data is not None and data.users == 0:
            if isinstance(data, bpy.types.Mesh):
                bpy.data.meshes.remove(data)
            elif isinstance(data, bpy.types.Curve):
                bpy.data.curves.remove(data)


def remove_templates():
    for o in [o for o in bpy.data.objects if o.get("kit_template")]:
        remove(o)
    for c in [c for c in bpy.data.collections if c.name.startswith("_tpl_") or c.name == "_templates"]:
        bpy.data.collections.remove(c)
