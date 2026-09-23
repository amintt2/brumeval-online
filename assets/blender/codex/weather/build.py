"""CX-6: seven deterministic weather flipbooks rendered by Blender Cycles.

Blender -b --python build.py -- --only fog_wisps --samples 16
The external Python/Pillow packer only downsamples, packs and produces QA previews.
"""
import sys
sys.dont_write_bytecode=True
import os,math,random,json,argparse,importlib,subprocess,shutil,time
from pathlib import Path
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[3]
BLENDER=ROOT/'assets/blender'
KITROOT=Path(os.environ.get('BRUMEVAL_KIT_ROOT','C:/Users/amin2/mmorpg/assets/blender'))
sys.path[:0]=[str(BLENDER),str(KITROOT)]
import bpy
from mathutils import Vector
import common as C
from kit import gpu

OUT=ROOT/'client/public/vfx/weather'
TAU=math.tau
SPECS={
 'rain_streaks':dict(frames=16,fps=20,loop=True,blending='normal',size=4.,anchor='center'),
 'rain_splash':dict(frames=16,fps=24,loop=False,blending='normal',size=1.2,anchor='center'),
 'snowflakes':dict(frames=24,fps=12,loop=True,blending='normal',size=4.,anchor='center'),
 'sandstorm':dict(frames=24,fps=12,loop=True,blending='normal',size=6.,anchor='center'),
 'fog_wisps':dict(frames=24,fps=12,loop=True,blending='normal',size=8.,anchor='center'),
 'lightning_flash':dict(frames=16,fps=24,loop=False,blending='additive',size=8.,anchor='center'),
 'embers':dict(frames=24,fps=16,loop=True,blending='additive',size=3.,anchor='center')}


def smooth(t):
    t=max(0,min(1,t));return t*t*(3-2*t)


class Nodes:
    def __init__(self,name):
        self.mat=bpy.data.materials.new(name);self.mat.use_nodes=True
        self.nt=self.mat.node_tree;self.nt.nodes.clear()
    def n(self,typ):return self.nt.nodes.new(typ)
    def plug(self,v,s):
        if isinstance(v,bpy.types.NodeSocket):self.nt.links.new(v,s)
        else:s.default_value=v
    def op(self,op,a,b=0):
        n=self.n('ShaderNodeMath');n.operation=op;self.plug(a,n.inputs[0]);self.plug(b,n.inputs[1]);return n.outputs[0]
    def vm(self,op,a,b):
        n=self.n('ShaderNodeVectorMath');n.operation=op;self.plug(a,n.inputs[0]);self.plug(b,n.inputs[1]);return n.outputs[0]
    def ramp(self,a,lo,hi,to0=0,to1=1):
        n=self.n('ShaderNodeMapRange');n.clamp=True
        for sock,val in zip(n.inputs[:5],[a,lo,hi,to0,to1]):self.plug(val,sock)
        return n.outputs[0]
    def noise(self,v,scale,detail=4):
        n=self.n('ShaderNodeTexNoise');n.noise_dimensions='4D';self.plug(v,n.inputs['Vector'])
        n.inputs['Scale'].default_value=scale;n.inputs['Detail'].default_value=detail;n.inputs['Roughness'].default_value=.65
        return n
    def output(self,color,alpha):
        em=self.n('ShaderNodeEmission');self.plug(color,em.inputs[0]);em.inputs[1].default_value=1
        tr=self.n('ShaderNodeBsdfTransparent');mix=self.n('ShaderNodeMixShader');self.plug(alpha,mix.inputs[0])
        self.plug(tr.outputs[0],mix.inputs[1]);self.plug(em.outputs[0],mix.inputs[2])
        out=self.n('ShaderNodeOutputMaterial');self.plug(mix.outputs[0],out.inputs['Surface'])
        return self.mat


def particle_material():
    g=Nodes('WeatherParticles');uv=g.n('ShaderNodeTexCoord').outputs['UV'];sep=g.n('ShaderNodeSeparateXYZ');g.plug(uv,sep.inputs[0])
    x=g.op('MULTIPLY',g.op('SUBTRACT',sep.outputs['X'],.5),2)
    y=g.op('MULTIPLY',g.op('SUBTRACT',sep.outputs['Y'],.5),2)
    radius=g.op('ADD',g.op('MULTIPLY',x,x),g.op('MULTIPLY',y,y))
    falloff=g.op('POWER',g.op('MAXIMUM',g.op('SUBTRACT',1,radius),0),1.8)
    vc=g.n('ShaderNodeVertexColor');vc.layer_name='ParticleColor'
    alpha=g.op('MULTIPLY',falloff,vc.outputs['Alpha'])
    return g.output(vc.outputs['Color'],alpha)


class Quads:
    def __init__(self):self.v=[];self.faces=[];self.colors=[]
    def quad(self,x,z,rx,rz,color,alpha=1,angle=0,depth=0):
        if alpha<=.0001:return
        n=len(self.v);c=math.cos(angle);s=math.sin(angle)
        for u,v in [(-1,-1),(1,-1),(1,1),(-1,1)]:
            px=u*rx;pz=v*rz;self.v.append((x+px*c-pz*s,depth,z+px*s+pz*c))
            self.colors.append((*color,max(0,min(1,alpha))))
        self.faces.append((n,n+1,n+2,n+3))
    def line(self,a,b,width,color,alpha=1,depth=0):
        x=(a[0]+b[0])/2;z=(a[1]+b[1])/2
        self.quad(x,z,width,math.dist(a,b)/2+width,color,alpha,-math.atan2(b[0]-a[0],b[1]-a[1]),depth)
    def install(self,material):
        old=bpy.data.objects.get('WeatherGeometry')
        if old:
            me=old.data;bpy.data.objects.remove(old,do_unlink=True);bpy.data.meshes.remove(me)
        me=bpy.data.meshes.new('WeatherGeometry');me.from_pydata(self.v,[],self.faces);me.materials.append(material)
        ob=bpy.data.objects.new('WeatherGeometry',me);bpy.context.collection.objects.link(ob)
        uv=me.uv_layers.new()
        for f in me.polygons:
            for li,p in zip(f.loop_indices,[(0,0),(1,0),(1,1),(0,1)]):uv.data[li].uv=p
        attr=me.color_attributes.new(name='ParticleColor',type='FLOAT_COLOR',domain='POINT')
        for a,c in zip(attr.data,self.colors):a.color=c


def edge(x,z,margin=.35):return smooth((1.83-abs(x))/margin)*smooth((1.83-abs(z))/margin)


def rain(t):
    r=random.Random(68001);q=Quads()
    for i in range(75):
        x=r.uniform(-1.8,1.8);phase=r.random();speed=1 if i%3 else 2
        z=1.95-3.9*((phase+t*speed)%1)
        length=r.uniform(.09,.27);width=r.uniform(.004,.010)
        alpha=r.uniform(.25,.75)*edge(x,z)
        q.quad(x,z,width,length,(.45,.53,.60),alpha,.13)
    return q


def snow(t):
    r=random.Random(68113);q=Quads()
    for i in range(73):
        phase=r.random();age=(phase+t)%1;base=r.uniform(-1.5,1.5)
        x=base+.19*math.sin(TAU*(age+phase))+.045*math.sin(TAU*(3*age+phase))
        z=1.95-age*3.9;radius=r.uniform(.013,.039);alpha=r.uniform(.30,.82)*edge(x,z)
        if i<20:
            turn=TAU*(age+phase);q.quad(x,z,radius*.32,radius*.32,(.71,.76,.80),alpha)
            for k in range(3):
                a=turn+k*math.pi/3
                q.line((x-math.cos(a)*radius,z-math.sin(a)*radius),(x+math.cos(a)*radius,z+math.sin(a)*radius),radius*.14,(.70,.75,.79),alpha)
        else:q.quad(x,z,radius*.45,radius*.6,(.65,.70,.76),alpha,phase*TAU)
    return q


def splash(t):
    r=random.Random(68443);q=Quads();life=math.sin(math.pi*t)**.7
    # Two expanding horizontal rings and ballistic crown droplets, viewed at a shallow angle.
    for ring in range(2):
        age=max(0,t-ring*.12);rad=.13+age*1.45;alpha=(1-age)**1.4*life*(.85 if ring==0 else .4)
        for j in range(90):
            a=TAU*j/90;b=TAU*(j+1)/90
            q.line((rad*math.cos(a),-.45+rad*.28*math.sin(a)),(rad*math.cos(b),-.45+rad*.28*math.sin(b)),.012,(.42,.53,.60),alpha)
    for i in range(23):
        a=r.uniform(0,TAU);v=r.uniform(1.0,2.7);start=r.uniform(.02,.10);age=max(0,t-start)
        x=math.cos(a)*age*r.uniform(1.0,1.7);z=-.45+v*age-3.1*age*age+math.sin(a)*age*.2
        alpha=life*smooth((.95-t)/.2)*smooth((t-start)/.07)
        if z<-.63:alpha*=smooth((z+.83)/.2)
        q.quad(x,z,.018,.033,(.52,.63,.70),alpha,math.cos(a)*.4)
    return q


def embers(t):
    r=random.Random(68487);q=Quads()
    for i in range(36):
        phase=r.random();age=(phase+t)%1
        x=r.uniform(-1.4,1.4)+.15*math.sin(age*TAU+phase*TAU)+.06*math.sin(age*TAU*3)
        z=-1.9+age*3.8;rad=r.uniform(.007,.019);alpha=edge(x,z)*math.sin(math.pi*age)**.5
        flicker=.65+.35*math.sin(TAU*(age*4+phase))**2
        color=(.88*flicker,.23*flicker,.045*flicker)
        q.quad(x,z,rad*5,rad*6,color,alpha*.14,phase*TAU,depth=.005)
        q.quad(x,z,rad,rad*1.7,(1,.48,.12),alpha)
        q.line((x,z),(x-.024*math.sin(age*TAU*3),z-.09),rad*.55,color,alpha*.4)
    return q


def lightning(t):
    q=Quads();r=random.Random(69529)
    # Fixed leader topology; natural flicker comes from discharge envelopes, not reshuffling branches.
    pulse=sum(amp*math.exp(-((t-center)/width)**2) for center,width,amp in [(2/15,.025,1),(4/15,.035,.82),(7/15,.025,.5)])
    pulse=min(1,pulse);pts=[(0,1.60)]
    for i in range(1,20):pts.append((r.uniform(-.22,.22)+math.sin(i*.8)*.13,1.60-i*.16))
    for j,(a,b) in enumerate(zip(pts,pts[1:])):
        q.line(a,b,.06,(.27,.39,.59),pulse*.23,depth=.01)
        q.line(a,b,.012,(.75,.85,1),pulse)
        if j in [4,8,11]:
            last=a;direction=-1 if j%2 else 1
            for k in range(5):
                nxt=(last[0]+direction*r.uniform(.12,.24),last[1]-r.uniform(.07,.19))
                q.line(last,nxt,.018,(.25,.35,.51),pulse*.13,depth=.01)
                q.line(last,nxt,.004,(.53,.69,.91),pulse*(1-k/6)*.7);last=nxt
    # Local atmospheric flash remains a transparent soft field.
    q.quad(0,.05,1.7,1.7,(.20,.29,.43),pulse*.085,depth=.03)
    return q


def atmosphere(key):
    g=Nodes(key+' procedural turbulence');uv=g.n('ShaderNodeTexCoord').outputs['UV']
    sep=g.n('ShaderNodeSeparateXYZ');g.plug(uv,sep.inputs[0])
    centered=g.vm('SUBTRACT',uv,(.5,.5,0));scale=(1.0,2.6,1) if key=='fog_wisps' else (1.3,1.1,1)
    p=g.vm('MULTIPLY',centered,scale)
    offset=g.n('ShaderNodeVectorMath');offset.operation='ADD';g.plug(p,offset.inputs[0])
    large=g.noise(offset.outputs[0],3.2,5)
    warped=g.vm('ADD',offset.outputs[0],g.vm('MULTIPLY',g.vm('SUBTRACT',large.outputs['Color'],(.5,.5,.5)),(.32,.14,.10)))
    fine=g.noise(warped,10,4);fine.inputs['Roughness'].default_value=.7
    density=g.op('MULTIPLY',g.ramp(large.outputs['Fac'],.33,.71),g.ramp(fine.outputs['Fac'],.18,.78,.28,1))
    # Four-sided zero-alpha feather prevents visible billboard rectangles or atlas clipping.
    border=1
    for value in [sep.outputs['X'],sep.outputs['Y']]:
        distance=g.op('MINIMUM',value,g.op('SUBTRACT',1,value))
        border=g.op('MULTIPLY',border,g.ramp(distance,.025,.22))
    density=g.op('MULTIPLY',density,border)
    alpha=g.op('MULTIPLY',density,.46 if key=='fog_wisps' else .55)
    color=(.30,.36,.39,1) if key=='fog_wisps' else (.27,.21,.135,1)
    mat=g.output(color,alpha)
    me=bpy.data.meshes.new('AtmosphereQuad');me.from_pydata([(-2,0,-2),(2,0,-2),(2,0,2),(-2,0,2)],[],[(0,1,2,3)])
    me.materials.append(mat);ob=bpy.data.objects.new('Atmosphere',me);bpy.context.collection.objects.link(ob)
    uvmap=me.uv_layers.new()
    for item,xy in zip(uvmap.data,[(0,0),(1,0),(1,1),(0,1)]):item.uv=xy
    grains=particle_material() if key=='sandstorm' else None
    def update(t):
        a=TAU*t;offset.inputs[1].default_value=(.22*math.cos(a),.08*math.sin(a),.18*math.sin(a))
        large.inputs['W'].default_value=.36*math.sin(a);fine.inputs['W'].default_value=.24*math.cos(a)
        if grains:
            r=random.Random(61237);q=Quads()
            for i in range(95):
                phase=r.random();age=(phase+t*2)%1
                x=-1.9+age*3.8;z=r.uniform(-1.7,1.7)+.045*math.sin(TAU*(age+phase))
                q.quad(x,z,r.uniform(.016,.058),r.uniform(.002,.005),(.35,.28,.17),r.uniform(.10,.30)*edge(x,z),.08,depth=-.01)
            q.install(grains)
    return update


def setup(res):
    C.reset();importlib.reload(gpu)
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.render.film_transparent=True
    scene.render.resolution_x=res;scene.render.resolution_y=res;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA';scene.render.image_settings.color_depth='8'
    scene.view_settings.view_transform='Standard';scene.view_settings.look='None';scene.view_settings.exposure=0
    scene.world=bpy.data.worlds.new('No world');scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[1].default_value=0
    cd=bpy.data.cameras.new('Camera');cam=bpy.data.objects.new('Camera',cd);bpy.context.collection.objects.link(cam)
    cam.location=(0,-10,0);cam.rotation_euler=(Vector((0,0,0))-cam.location).to_track_quat('-Z','Y').to_euler()
    cd.type='ORTHO';cd.ortho_scale=4;scene.camera=cam
    scene.cycles.max_bounces=2;scene.cycles.transparent_max_bounces=32;scene.cycles.use_denoising=False
    return scene


def main():
    p=argparse.ArgumentParser();p.add_argument('--only',default=','.join(SPECS));p.add_argument('--samples',type=int,default=16)
    p.add_argument('--frame-size',type=int,default=256);p.add_argument('--supersample',type=int,default=2);p.add_argument('--cpu',action='store_true')
    p.add_argument('--prototype',action='store_true',help='Render four representative frames only; no atlas or manifest change')
    a=p.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    if a.cpu:os.environ['BRUMEVAL_FORCE_CPU']='1'
    keys=a.only.split(',');assert all(k in SPECS for k in keys)
    frame_root=HERE/'frames';frame_root.mkdir(exist_ok=True);OUT.mkdir(parents=True,exist_ok=True)
    meta={}
    for key in keys:
        started=time.monotonic()
        scene=setup(a.frame_size*a.supersample);spec=dict(SPECS[key]);spec.update(cols=4,rows=math.ceil(spec['frames']/4),frameSize=a.frame_size,file=f'vfx/weather/{key}.webp')
        if key in ['sandstorm','fog_wisps']:update=atmosphere(key)
        else:
            material=particle_material();builder={'rain_streaks':rain,'rain_splash':splash,'snowflakes':snow,'embers':embers,'lightning_flash':lightning}[key]
            update=lambda t:builder(t).install(material)
        dest=frame_root/key;dest.mkdir(exist_ok=True)
        selected=[0,spec['frames']//4,spec['frames']//2,spec['frames']-1] if a.prototype else range(spec['frames'])
        with gpu.device(scene,samples=a.samples,wait=30):
            for i in selected:
                t=i/spec['frames'] if spec['loop'] else i/(spec['frames']-1)
                update(t);scene.render.filepath=str(dest/f'{i:03}.png');bpy.ops.render.render(write_still=True)
                print('WEATHER_FRAME',key,i+1,spec['frames'],flush=True)
        spec['renderSeconds']=round(time.monotonic()-started,3);spec['samples']=a.samples;spec['supersample']=a.supersample
        meta[key]=spec
    (HERE/'render_spec.json').write_text(json.dumps(meta,indent=2),encoding='utf-8')
    if not a.prototype:
        bundled=Path.home()/'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
        python=os.environ.get('BRUMEVAL_IMAGE_PYTHON') or (str(bundled) if bundled.exists() else shutil.which('python'))
        if not python:raise RuntimeError('Python with Pillow required for atlas packing')
        subprocess.run([python,str(HERE/'pack.py'),'--only',','.join(keys)],check=True)


if __name__=='__main__':main()
