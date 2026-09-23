"""Live Geometry Nodes contact skin between the castle and its terrain.

Only explicitly named load-bearing meshes supply footprints. The proxy geometry
is invisible but remains dependency-graph enabled. No gate, arch or ramp can
become a terrain-height source. Terrain is raised, never excavated.
"""
import math
import bpy
from mathutils import Vector, Matrix
from mathutils.geometry import convex_hull_2d

SUPPORTS = frozenset(('CourtineGauche', 'CourtineDroite', 'Tour',
                     'TerrasseChapelle', 'FondationChapelle', 'Nef',
                     'Contrefort', 'Beffroi', 'ContrefortTour'))
ATTRIBUTE = 'foundation_base_z'
MODIFIER = 'FoundationContactSkin'


def apply_foundation_contacts(terrain_ob, structure_objects):
    """Attach a live contact modifier; return JSON-compatible deterministic stats.

    Caller passes the objects created by citadel(), not the entire scene.
    Footprints use evaluated world vertices, including parent transforms. Tower
    circles therefore become their actual polygonal disks rather than AABBs.
    """
    if terrain_ob.type != 'MESH':
        raise TypeError('Foundation contact requires a mesh terrain')
    # Current ErodedCastleTerrain is authored directly in world coordinates.
    # Refuse silently wrong projection if that convention changes later.
    if any(abs(terrain_ob.matrix_world[r][c] - Matrix.Identity(4)[r][c]) > 1e-6
           for r in range(4) for c in range(4)):
        raise ValueError('Apply terrain object transforms before foundation contact')
    if MODIFIER in terrain_ob.modifiers:
        raise ValueError('Foundation contact modifier already exists')
    depsgraph = bpy.context.evaluated_depsgraph_get()
    vertices, faces, heights, records = [], [], [], []
    for source in sorted(structure_objects, key=lambda ob: ob.name):
        if source.type != 'MESH' or source.name.split('.')[0] not in SUPPORTS:
            continue
        evaluated = source.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        try:
            coords = [evaluated.matrix_world @ v.co for v in mesh.vertices]
        finally:
            evaluated.to_mesh_clear()
        if not coords:
            continue
        if not all(math.isfinite(c) for p in coords for c in p):
            raise ValueError('Non-finite support coordinates: ' + source.name)
        # Remove repeated XY positions before the convex hull operation.
        xy = sorted({(round(p.x, 7), round(p.y, 7)) for p in coords})
        points = [Vector(p) for p in xy]
        hull = convex_hull_2d(points)
        if len(hull) < 3:
            continue
        base = min(p.z for p in coords) + .06
        start = len(vertices)
        vertices.extend((points[i].x, points[i].y, 0.) for i in hull)
        heights.extend([base] * len(hull))
        faces.append(tuple(range(start, start + len(hull))))
        records.append({'name': source.name, 'base_z': round(base, 6),
                        'footprint_vertices': len(hull)})
    if not faces:
        raise ValueError('No explicitly allowed castle supports found')
    proxy_mesh = bpy.data.meshes.new('FoundationFootprintsXY')
    proxy_mesh.from_pydata(vertices, [], faces)
    proxy_mesh.update()
    attr = proxy_mesh.attributes.new(ATTRIBUTE, 'FLOAT', 'POINT')
    attr.data.foreach_set('value', heights)
    proxy = bpy.data.objects.new('FoundationContactProxy', proxy_mesh)
    bpy.context.scene.collection.objects.link(proxy)
    proxy.hide_render = True
    proxy.hide_set(True)  # not hide_viewport: preserve Object Info evaluation
    proxy['purpose'] = 'Geometry Nodes data source; XY footprint with base-height attribute'

    group = bpy.data.node_groups.new('CastleFoundationContact', 'GeometryNodeTree')
    group.interface.new_socket(name='Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')
    group.interface.new_socket(name='Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
    nodes, links = group.nodes, group.links
    def node(kind, label, x, y):
        n = nodes.new(kind); n.label = label; n.location = (x, y)
        return n
    def math_node(op, label, a, b=None, x=0, y=0):
        n = node('ShaderNodeMath', label, x, y); n.operation = op
        for index, value in enumerate((a, b)):
            if value is None: continue
            if isinstance(value, (float, int)): n.inputs[index].default_value = value
            else: links.new(value, n.inputs[index])
        return n.outputs[0]
    inp = node('NodeGroupInput', 'Original continuous terrain', -1000, 400)
    out = node('NodeGroupOutput', 'Raised contact skin', 1100, 400)
    info = node('GeometryNodeObjectInfo', 'World XY support footprints', -1000, 100)
    info.transform_space = 'ORIGINAL'; info.inputs['Object'].default_value = proxy
    info.inputs['As Instance'].default_value = False
    pos = node('GeometryNodeInputPosition', 'Terrain position', -1000, -180)
    separate = node('ShaderNodeSeparateXYZ', 'Keep original height', -800, -180)
    links.new(pos.outputs['Position'], separate.inputs[0])
    xypos = node('ShaderNodeCombineXYZ', 'Project query onto XY plane', -610, -100)
    links.new(separate.outputs['X'], xypos.inputs['X'])
    links.new(separate.outputs['Y'], xypos.inputs['Y'])
    proximity = node('GeometryNodeProximity', 'Distance to complete support footprint', -400, 150)
    proximity.target_element = 'FACES'
    links.new(info.outputs['Geometry'], proximity.inputs['Target'])
    links.new(xypos.outputs[0], proximity.inputs['Source Position'])
    named = node('GeometryNodeInputNamedAttribute', 'Support underside plus 6 cm overlap', -800, -430)
    named.data_type = 'FLOAT'; named.inputs['Name'].default_value = ATTRIBUTE
    sample = node('GeometryNodeSampleNearestSurface', 'Nearest support base height', -380, -210)
    sample.data_type = 'FLOAT'
    links.new(info.outputs['Geometry'], sample.inputs['Mesh'])
    links.new(named.outputs['Attribute'], sample.inputs['Value'])
    links.new(xypos.outputs[0], sample.inputs['Sample Position'])
    # Coplanar footprints may overlap. Nearest Surface alone arbitrarily picks
    # one face in that case; raycast the height-lifted footprints from above to
    # guarantee the highest supporting base wins inside the union.
    elevated_position = node('ShaderNodeCombineXYZ', 'Proxy XY with true support height', -380, -880)
    links.new(separate.outputs['X'], elevated_position.inputs['X'])
    links.new(separate.outputs['Y'], elevated_position.inputs['Y'])
    links.new(named.outputs['Attribute'], elevated_position.inputs['Z'])
    elevated = node('GeometryNodeSetPosition', 'Raise each proxy face to its base height', -130, -850)
    links.new(info.outputs['Geometry'], elevated.inputs['Geometry'])
    links.new(elevated_position.outputs[0], elevated.inputs['Position'])
    ray_start = node('ShaderNodeCombineXYZ', 'Vertical query from above castle', -130, -1100)
    links.new(separate.outputs['X'], ray_start.inputs['X'])
    links.new(separate.outputs['Y'], ray_start.inputs['Y'])
    ray_start.inputs['Z'].default_value = 1000.
    ray = node('GeometryNodeRaycast', 'Highest overlapping support wins', 130, -850)
    ray.data_type = 'FLOAT'
    links.new(elevated.outputs['Geometry'], ray.inputs['Target Geometry'])
    links.new(ray_start.outputs[0], ray.inputs['Source Position'])
    ray.inputs['Ray Direction'].default_value = (0., 0., -1.)
    ray.inputs['Ray Length'].default_value = 2000.
    hit_z = node('ShaderNodeSeparateXYZ', 'Highest base Z', 360, -850)
    links.new(ray.outputs['Hit Position'], hit_z.inputs[0])
    target = node('GeometryNodeSwitch', 'Inside: highest base; outside: nearest base', 580, -570)
    target.input_type = 'FLOAT'
    links.new(ray.outputs['Is Hit'], target.inputs['Switch'])
    links.new(sample.outputs['Value'], target.inputs['False'])
    links.new(hit_z.outputs['Z'], target.inputs['True'])
    noise = node('ShaderNodeTexNoise', 'Soft irregular transition width', -600, -620)
    noise.inputs['Scale'].default_value = .55; noise.inputs['Detail'].default_value = 2.
    links.new(xypos.outputs[0], noise.inputs['Vector'])
    width_variation = math_node('MULTIPLY', 'Width variation 0–0.5 m', noise.outputs['Fac'], .5, -340, -610)
    width = math_node('ADD', 'Transition width 1.5–2 m', width_variation, 1.5, -150, -610)
    ratio = math_node('DIVIDE', 'Normalized horizontal distance', proximity.outputs['Distance'], width, -130, 80)
    falloff = node('ShaderNodeMapRange', 'Smooth contact weight; exactly 1 inside footprint', 60, 40)
    falloff.interpolation_type = 'SMOOTHERSTEP'; falloff.clamp = True
    links.new(ratio, falloff.inputs['Value'])
    falloff.inputs['From Min'].default_value = 0.; falloff.inputs['From Max'].default_value = 1.
    falloff.inputs['To Min'].default_value = 1.; falloff.inputs['To Max'].default_value = 0.
    delta = math_node('SUBTRACT', 'Required height correction', target.outputs[0], separate.outputs['Z'], 0, -220)
    positive = math_node('MAXIMUM', 'Fill only; never excavate', delta, 0., 210, -220)
    lift = math_node('MULTIPLY', 'Preserve exact contact at distance zero', positive, falloff.outputs['Result'], 430, -80)
    offset = node('ShaderNodeCombineXYZ', 'Vertical lift only', 620, 0)
    links.new(lift, offset.inputs['Z'])
    setpos = node('GeometryNodeSetPosition', 'Raise existing connected terrain vertices', 850, 400)
    links.new(inp.outputs['Geometry'], setpos.inputs['Geometry'])
    links.new(offset.outputs[0], setpos.inputs['Offset'])
    links.new(setpos.outputs['Geometry'], out.inputs['Geometry'])
    modifier = terrain_ob.modifiers.new(MODIFIER, 'NODES'); modifier.node_group = group
    stats = {'node_group': group.name, 'modifier': modifier.name, 'proxy': proxy.name,
             'support_count': len(records), 'proxy_vertices': len(vertices),
             'proxy_faces': len(faces), 'transition_m': [1.5, 2.0],
             'contact_overlap_m': .06, 'fill_only': True, 'supports': records}
    stats['overlap_resolution'] = 'highest_vertical_raycast'
    terrain_ob['foundation_contact_group'] = group.name
    return stats
