"""Non-destructive shader additions for fortress limestone and portcullis iron.

World-space drainage, low-level damp and sheltered oxidation supplement the kit.
Existing base-colour, roughness, metallic and normal connections are retained.
"""
import bpy


class Graph:
    def __init__(self,material):
        self.nt=material.node_tree
        self.bs=next(n for n in self.nt.nodes if n.type=='BSDF_PRINCIPLED')
    def node(self,kind,label):
        n=self.nt.nodes.new(kind);n.label='Weathering / '+label
        return n
    def plug(self,value,socket):
        if isinstance(value,bpy.types.NodeSocket):self.nt.links.new(value,socket)
        else:socket.default_value=value
    def source(self,name):
        s=self.bs.inputs[name]
        return s.links[0].from_socket if s.links else (tuple(s.default_value) if hasattr(s.default_value,'__len__') else s.default_value)
    def math(self,op,a,b=0):
        n=self.node('ShaderNodeMath',op);n.operation=op;self.plug(a,n.inputs[0]);self.plug(b,n.inputs[1]);return n.outputs[0]
    def vector(self,op,a,b):
        n=self.node('ShaderNodeVectorMath',op);n.operation=op;self.plug(a,n.inputs[0]);self.plug(b,n.inputs[1]);return n.outputs[0]
    def remap(self,v,lo,hi,a=0,b=1):
        n=self.node('ShaderNodeMapRange','bounded mask');n.clamp=True
        for s,val in zip(n.inputs[:5],[v,lo,hi,a,b]):self.plug(val,s)
        return n.outputs[0]
    def noise(self,vec,scale,detail=4):
        n=self.node('ShaderNodeTexNoise','fractal mineral/weather variation');self.plug(vec,n.inputs['Vector'])
        n.inputs['Scale'].default_value=scale;n.inputs['Detail'].default_value=detail;n.inputs['Roughness'].default_value=.66
        return n
    def mix(self,a,b,factor,mode='MIX'):
        n=self.node('ShaderNodeMixRGB',mode);n.blend_type=mode
        self.plug(factor,n.inputs[0]);self.plug(a,n.inputs[1]);self.plug(b,n.inputs[2]);return n.outputs[0]
    def value_mix(self,a,b,f):return self.math('ADD',self.math('MULTIPLY',a,self.math('SUBTRACT',1,f)),self.math('MULTIPLY',b,f))
    def finish(self,color,rough,normal_height,metal=None,depth=.003):
        self.plug(color,self.bs.inputs['Base Color']);self.plug(rough,self.bs.inputs['Roughness'])
        if metal is not None:self.plug(metal,self.bs.inputs['Metallic'])
        previous=self.source('Normal')
        bump=self.node('ShaderNodeBump','subtle surface weather over kit masonry relief')
        bump.inputs['Strength'].default_value=.18;bump.inputs['Distance'].default_value=depth
        self.plug(normal_height,bump.inputs['Height']);self.plug(previous,bump.inputs['Normal'])
        self.plug(bump.outputs['Normal'],self.bs.inputs['Normal'])


def masks(g,distance):
    geom=g.node('ShaderNodeNewGeometry','world position, no per-object resets')
    pos=geom.outputs['Position']
    broad=g.noise(pos,.23,4)
    # Low-amplitude world-space warp avoids ruler-straight drainage bands.
    centered=g.vector('SUBTRACT',broad.outputs['Color'],(.5,.5,.5))
    warped=g.vector('ADD',pos,g.vector('MULTIPLY',centered,(.32,.32,.06)))
    stretched=g.vector('MULTIPLY',warped,(3.1,3.1,.17))
    run=g.noise(stretched,1,5).outputs['Fac']
    streak=g.remap(run,.58,.77)
    ao=g.node('ShaderNodeAmbientOcclusion','sheltered joints and contact zones');ao.inputs['Distance'].default_value=distance
    ao.samples=8
    cavity=g.remap(ao.outputs['AO'],.35,1,1,0)
    z=g.node('ShaderNodeSeparateXYZ','altitude');g.plug(pos,z.inputs[0])
    return pos,broad.outputs['Fac'],streak,cavity,z.outputs['Z']


def stone_weather(material):
    if material.get('castle_weathering_v1'):return
    g=Graph(material);base=g.source('Base Color');rough=g.source('Roughness')
    pos,broad,streak,cavity,z=masks(g,.35)
    # Broad tonal modulation stays within 12%, so the ashlar and mortar remain dominant.
    variation=g.remap(broad,.15,.85,.72,1.07)
    color=g.mix(base,variation,1,'MULTIPLY')
    low=g.remap(z,12.1,17,1,0)
    moisture=g.math('MULTIPLY',low,g.remap(broad,.30,.70,.10,.55))
    sheltered=g.math('MULTIPLY',cavity,.25)
    runoff=g.math('MULTIPLY',streak,g.math('ADD',.24,g.math('MULTIPLY',low,.30)))
    dark=g.math('MINIMUM',g.math('ADD',runoff,sheltered),.62)
    color=g.mix(color,(.35,.40,.36,1),dark,'MULTIPLY')
    # Moss is sparse in humid lower patches, not painted randomly over upper towers.
    moss=g.math('MULTIPLY',moisture,g.remap(g.noise(pos,3.7,5).outputs['Fac'],.48,.70))
    color=g.mix(color,(.039,.049,.027,1),g.math('MULTIPLY',moss,.45))
    rough=g.value_mix(rough,.90,g.math('MINIMUM',g.math('ADD',moss,dark),.45))
    micro=g.noise(pos,65,3).outputs['Fac']
    g.finish(color,rough,micro,depth=.002)
    material['castle_weathering_v1']=True


def iron_weather(material):
    if material.get('castle_weathering_v1'):return
    g=Graph(material);base=g.source('Base Color');rough=g.source('Roughness');metal=g.source('Metallic')
    pos,broad,streak,cavity,z=masks(g,.12)
    patch=g.noise(pos,5.8,5).outputs['Fac']
    vor=g.node('ShaderNodeTexVoronoi','broken oxidation borders');vor.feature='DISTANCE_TO_EDGE'
    g.plug(pos,vor.inputs['Vector']);vor.inputs['Scale'].default_value=12
    borders=g.remap(vor.outputs['Distance'],.015,.085,1,0)
    humid=g.remap(z,12,16,1,0)
    seed=g.math('ADD',patch,g.math('ADD',g.math('MULTIPLY',cavity,.16),g.math('MULTIPLY',humid,.08)))
    islands=g.remap(seed,.64,.83)
    broken=g.math('MULTIPLY',islands,g.math('ADD',.6,g.math('MULTIPLY',borders,.4)))
    oxide=g.math('MINIMUM',g.math('ADD',broken,g.math('MULTIPLY',streak,.07)),.80)
    fine=g.noise(pos,48,4).outputs['Fac']
    rust=g.mix((.031,.017,.009,1),(.112,.051,.019,1),fine)
    color=g.mix(base,rust,oxide)
    rough=g.value_mix(rough,.92,oxide);metal=g.value_mix(metal,.02,oxide)
    height=g.math('MULTIPLY',fine,oxide)
    g.finish(color,rough,height,metal,depth=.0012)
    material['castle_weathering_v1']=True


def apply_castle_weathering(stone,iron):
    if stone is not None:stone_weather(stone)
    if iron is not None:iron_weather(iron)
    return {'stone':stone.name if stone else None,'iron':iron.name if iron else None,'world_ground_reference_m':12}


def aged_banner_material(name,color):
    """Opaque aged wool: geometry supplies the torn hem and holes; shader supplies fibres and fading."""
    from kit import materials as M
    material=bpy.data.materials.get(name)
    if material and material.get('aged_banner_v1'):return material
    material=material or M.cloth(name,color=color,kind='wool',scale=5,dirt=.25,wear=.06,hem_dirt=.16,bump=.65)
    g=Graph(material);base=g.source('Base Color');rough=g.source('Roughness')
    tex=g.node('ShaderNodeTexCoord','banner local bounds for dirty hem')
    gen=tex.outputs['Generated'];obj=tex.outputs['Object']
    z=g.node('ShaderNodeSeparateXYZ','hem to top');g.plug(gen,z.inputs[0])
    broad=g.noise(obj,.75,4).outputs['Fac']
    faded=g.remap(broad,.24,.78,.07,.30)
    color_out=g.mix(base,(.08,.095,.105,1),faded)
    hem=g.remap(z.outputs['Z'],0,.30,.38,0)
    stain=g.math('MULTIPLY',hem,g.remap(g.noise(obj,5.2,4).outputs['Fac'],.20,.75,.35,1))
    color_out=g.mix(color_out,(.046,.041,.025,1),stain)
    fibres=g.noise(g.vector('MULTIPLY',obj,(90,70,7)),1,3).outputs['Fac']
    thread=g.remap(fibres,.20,.80,.88,1.04)
    color_out=g.mix(color_out,thread,1,'MULTIPLY')
    g.finish(color_out,g.value_mix(rough,.95,.35),fibres,depth=.0005)
    material['aged_banner_v1']=True
    return material
