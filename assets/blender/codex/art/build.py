"""CX-1 — deterministic Cycles key art, exclusively in the reserved art folders.
Blender --background --python build.py -- --only logo,bg_login --samples 32
The shared kit is read-only; BRUMEVAL_KIT_ROOT overrides its location.
"""
import sys
sys.dont_write_bytecode=True
import os, math, random, argparse, json
from pathlib import Path
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[3]
sys.path[:0]=[str(HERE),str(ROOT/'assets/blender'),str(ROOT/'assets/blender/icons')]
kitroot=Path(os.environ.get('BRUMEVAL_KIT_ROOT',str(ROOT/'assets/blender')))
if not (kitroot/'kit').is_dir(): kitroot=Path('C:/Users/amin2/mmorpg/assets/blender')
sys.path.append(str(kitroot))
import bpy
from mathutils import Vector
import common as C
import geo as G
from kit import materials as M, gpu
OUT=ROOT/'client/public/ui/art'
KEYS=['logo','logo_512','bg_login','bg_loading_1','bg_loading_2','bg_loading_3','launcher_banner']
R=random.Random(410)

def aim(o,p): o.rotation_euler=(Vector(p)-o.location).to_track_quat('-Z','Y').to_euler()
def camera(pos,target,lens=42,ortho=None):
    d=bpy.data.cameras.new('Camera'); o=bpy.data.objects.new('Camera',d); bpy.context.scene.collection.objects.link(o)
    o.location=pos; aim(o,target); d.lens=lens; d.clip_end=500
    if ortho: d.type='ORTHO'; d.ortho_scale=ortho
    bpy.context.scene.camera=o
    return o
def light(name,pos,power,color,size=5,target=(0,0,0),kind='AREA'):
    d=bpy.data.lights.new(name,kind); d.energy=power; d.color=color
    if kind=='AREA': d.shape='DISK'; d.size=size
    if kind=='SUN': d.angle=.06
    o=bpy.data.objects.new(name,d); bpy.context.scene.collection.objects.link(o); o.location=pos; aim(o,target)
    return o
def world(color=(.3,.4,.55),strength=.25):
    w=bpy.data.worlds.new('Atmosphere'); bpy.context.scene.world=w; w.use_nodes=True
    w.node_tree.nodes['Background'].inputs[0].default_value=(*color,1)
    w.node_tree.nodes['Background'].inputs[1].default_value=strength
def sunset():
    world(strength=.06)
    nt=bpy.context.scene.world.node_tree; sky=nt.nodes.new('ShaderNodeTexSky');sky.sky_type='MULTIPLE_SCATTERING'
    sky.sun_elevation=.13;sky.sun_rotation=2.1;sky.altitude=300;sky.air_density=1.2
    nt.links.new(sky.outputs[0],nt.nodes['Background'].inputs[0])
def fog(density=.015,color=(.48,.56,.62)):
    m=bpy.data.materials.new('Brume'); m.use_nodes=True; n=m.node_tree.nodes; n.clear()
    out=n.new('ShaderNodeOutputMaterial'); vol=n.new('ShaderNodeVolumePrincipled'); vol.inputs['Density'].default_value=density
    vol.inputs['Color'].default_value=(*color,1); vol.inputs['Anisotropy'].default_value=.35
    m.node_tree.links.new(vol.outputs['Volume'],out.inputs['Volume'])
    G.box('Brume',(160,180,65),m,loc=(0,45,22))
def rock(pos,scale,mat):
    o=G.ico('Rock',1,5,mat,loc=pos,scale=scale,jitter=.035,seed=R.randrange(50000))
    C.apply_transforms(o)
    for f in o.data.polygons: f.use_smooth=True
    return o
def terrain():
    ground=M.mud('Terre',wet=.4)
    G.box('Sol',(180,200,.5),ground,loc=(0,55,-.4))
    stone=M.rock('Roche',moss=.3)
    for i in range(75):
        x=R.uniform(-45,45); y=R.uniform(-8,85)
        if abs(x)<3: continue
        rock((x,y,0),(R.uniform(.25,1.5),R.uniform(.3,1.3),R.uniform(.2,.7)),stone)
    # Broken paving on a winding lane, with grass along its banks.
    for i in range(900):
        y=R.uniform(-12,65); x=R.uniform(-2.5,2.5)+math.sin(y*.09)*.8
        o=G.box('Pave',(R.uniform(.22,.45),R.uniform(.28,.55),.10),stone,loc=(x,y,-.075+R.uniform(0,.035)),bevel=.04)
        o.rotation_euler[2]=R.uniform(-.2,.2)
    verts=[]; faces=[]
    for i in range(11000):
        x=R.uniform(-35,35); y=R.uniform(-8,75)
        if abs(x-math.sin(y*.09)*.8)<2.8:continue
        h=R.uniform(.12,.5); w=R.uniform(.015,.04); a=R.uniform(0,math.tau)
        dx,dy=math.cos(a)*w,math.sin(a)*w; n=len(verts)
        verts.extend([(x-dx,y-dy,0),(x+dx,y+dy,0),(x+.12*math.sin(a),y+.12*math.cos(a),h)])
        faces.append((n,n+1,n+2))
    me=bpy.data.meshes.new('Herbes'); me.from_pydata(verts,[],faces); me.materials.append(M.cloth('Grass',color='#454827',dirt=.1))
    ob=bpy.data.objects.new('Herbes',me); bpy.context.scene.collection.objects.link(ob)
    return stone
def tree(x,y,h=12,dead=False):
    bark=bpy.data.materials.get('Ecorce') or M.bark('Ecorce',moss=.25)
    leaf=bpy.data.materials.get('LeafOak') or M.leaf_card('LeafOak',kind='oak',color='#384522',color2='#6b7036')
    verts=[]; faces=[]
    base=Vector((x,y,0))
    G.tube('Tronc',[tuple(base+Vector((.15*math.sin(i),0,h*i/6))) for i in range(7)],
           [.55*(1-i/7)**1.2 for i in range(7)],12,bark)
    for i in range(9):
        a=i*2.4; z=h*(.35+.055*i); r=h*(.32-.018*i)
        end=base+Vector((math.cos(a)*r,math.sin(a)*r,z+h*.18))
        G.tube('Branche',[tuple(base+Vector((0,0,z))),tuple(base.lerp(end,.72)+Vector((0,0,z*.25))),tuple(end)], [.19,.10,.018],10,bark)
        if not dead:
            for j in range(240):
                p=end+Vector((R.gauss(0,r*.43),R.gauss(0,r*.40),R.gauss(0,h*.055)))
                a=R.uniform(0,math.tau); ln=R.uniform(.24,.46)
                u=Vector((math.cos(a)*ln,math.sin(a)*ln,R.uniform(-.2,.2)))
                v=Vector((-math.sin(a)*ln*.5,math.cos(a)*ln*.5,R.uniform(.04,.19)))
                n=len(verts); verts.extend([tuple(p-u-v),tuple(p+u-v),tuple(p+u+v),tuple(p-u+v)])
                faces.append((n,n+1,n+2,n+3))
    if verts:
        me=bpy.data.meshes.new('Feuilles');me.from_pydata(verts,[],faces);me.materials.append(leaf)
        uv=me.uv_layers.new(name='UVMap')
        for f in me.polygons:
            for idx,co in zip(f.loop_indices,[(0,0),(1,0),(1,1),(0,1)]):uv.data[idx].uv=co
        ob=bpy.data.objects.new('Feuilles',me);bpy.context.scene.collection.objects.link(ob)
def house(x,y,s=1):
    plaster=bpy.data.materials.get('Enduit') or M.plaster('Enduit',color='#a39479',dirt=.35)
    wood=bpy.data.materials.get('Poutres') or M.wood('Poutres',color='#493423')
    slate=bpy.data.materials.get('Ardoise') or M.slate('Ardoise')
    stone=bpy.data.materials.get('Maconnerie') or M.stone_blocks('Maconnerie',moss=.25)
    glass=bpy.data.materials.get('Fenetre') or M.emissive('Fenetre',color='#ffb352',strength=2)
    def box(n,dim,mat,loc,bevel=.04): return G.box(n,tuple(v*s for v in dim),mat,loc=(x+loc[0]*s,y+loc[1]*s,loc[2]*s),bevel=bevel*s)
    box('Fondation',(5.2,6.1,.8),stone,(0,0,.3))
    box('Maison',(5,6,3.8),plaster,(0,0,2.2))
    # solid pitched roof, with hundreds of overlapping weathered slates
    for side in [-1,1]:
        for row in range(8):
            xx=side*(.15+row*.37); zz=6.4-abs(xx)*.9
            for col in range(17):
                tile=box('Tuile',(.51,.43,.075),slate,(xx,-3.3+col*.405+(row%2)*.1,zz))
                tile.rotation_euler[1]=side*math.atan(.9)
    for xx in [-2.45,0,2.45]: box('Montant',(.17,6.1,3.9),wood,(xx,0,2.2))
    for z in [.65,2.3,4.1]: box('Traverse',(5.1,6.1,.15),wood,(0,0,z))
    for side in [-1,1]:
        a=Vector((x+side*.3*s,y-3.09*s,.8*s));b=Vector((x+side*2.3*s,y-3.09*s,2.15*s))
        o=G.box('Contreventement',(.14*s,.16*s,(b-a).length),wood,loc=tuple((a+b)/2),bevel=.012*s)
        o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler()
    ob=G.extrude('Pignon',[(-2.5,4.05),(2.5,4.05),(0,6.4)],.14,plaster)
    ob.location=(x,y-3*s,0);ob.scale=(s,s,s)
    # front windows and mullions
    for xx in [-1.55,1.55]:
        box('Encadrement',(.94,.13,1.2),wood,(xx,-3.07,2.75))
        box('Vitre',(.74,.025,.98),glass,(xx,-3.15,2.75),.01)
        box('Croisillon',(.045,.04,1.02),wood,(xx,-3.18,2.75),.005)
        box('Croisillon',(.8,.04,.045),wood,(xx,-3.18,2.75),.005)
    box('Porte',(1.1,.18,1.9),wood,(0,-3.08,1.5))
    iron=bpy.data.materials.get('Ferrures') or M.metal('Ferrures',kind='iron',rust=.4)
    for z in [.86,1.8]:box('Penture',(.91,.04,.055),iron,(0,-3.19,z),.005)
    G.torus('Heurtoir',.07*s,.013*s,24,8,iron,loc=(x+.31*s,y-3.21*s,1.5*s),rot=(90,0,0))
    box('Cheminee',(.7,.85,2.8),stone,(1.3,1,5.8))
    for k in range(4): box('Marche',(1.6,.38,.15),stone,(0,-3.3-k*.3,.56-k*.14))
def arch(x,y,z=0,r=3):
    stone=bpy.data.materials.get('Crypte') or M.stone_blocks('Crypte',color='#66665e',moss=.25)
    for side in [-1,1]:
        for k in range(6):G.box('Pilier',(.9,1.2,.66),stone,loc=(x+side*r,y,z+k*.65+.33),bevel=.06)
    for i in range(17):
        a=i*math.pi/16
        o=G.box('Voussoir',(.68,1.25,.9),stone,loc=(x+r*math.cos(a),y,z+3.9+r*math.sin(a)),bevel=.04)
        o.rotation_euler[1]=math.pi/2-a
def grave(x,y):
    mat=bpy.data.materials.get('Tombe') or M.rock('Tombe',color='#646762',moss=.3)
    G.box('Stele',(.78,.24,1.5),mat,loc=(x,y,.75),bevel=.16)
    G.box('Socle',(1.02,.55,.18),mat,loc=(x,y,.09),bevel=.05)
    G.box('Dalle',(.85,1.9,.12),mat,loc=(x,y-.85,.03),bevel=.04)
    dark=bpy.data.materials.get('Gravure') or M.flat('Gravure',color='#252b29')
    G.box('Croix',(.08,.025,.55),dark,loc=(x,y-.13,.95))
    G.box('Croix',(.34,.025,.06),dark,loc=(x,y-.135,1.08))
def golem():
    # Frozen copy of Claude's game model keeps the illustration faithful and reproducible.
    src=HERE/'sources/golem.glb'
    if src.is_file():
        before=set(bpy.context.scene.objects)
        bpy.ops.import_scene.gltf(filepath=str(src))
        imported=set(bpy.context.scene.objects)-before
        for ob in imported:
            if ob.parent is None:ob.location+=Vector((0,14,0));ob.scale*=1.8
        for ob in imported:
            if ob.type=='ARMATURE':
                ob.animation_data_clear()
        light('Coeur',(0,12,5),150,(.23,.9,1),kind='POINT')
        return
    stone=M.rock('Golem',color='#5a625d',moss=.4); glow=M.emissive('Ame',color='#8de0dc',strength=5)
    for pos,sc in [((0,14,4),(2,1.15,2.4)),((0,14,7),(1,1,1)),((-1.2,14,1.5),(.85,.9,1.7)),((1.2,14,1.5),(.85,.9,1.7)),((-2.6,14,4),(.8,1,2)),((2.6,14,4),(.8,1,2))]:rock(pos,sc,stone)
    G.ico('Coeur',.42,3,glow,loc=(0,12.85,4.8))
    for x in [-.35,.35]:G.uvsphere('Oeil',.10,16,8,glow,loc=(x,13.04,7.1))
    light('Coeur', (0,12,5),150,(.23,.9,1),kind='POINT')
    for i in range(6):
        x=-.6+i*.24
        G.tube('Rune',[(x,12.9,3.6),(x+.12,12.83,3.95),(x,12.86,4.12)],.025,8,glow)

def landscape(key):
    global R
    R=random.Random(410)
    terrain()
    if key in ['bg_login','launcher_banner']:
        sunset()
        light('Soleil',(-22,30,35),3.4,(1,.70,.38),target=(0,0,0),kind='SUN')
        for x,y,s in [(-8,10,1),(8,14,1),(-10,25,.9),(12,29,1),(-4,39,1),(6,46,1)]:house(x,y,s)
        for x,y in [(-20,30),(23,40),(-24,48),(-18,7),(27,15)]:tree(x,y,14)
        # distant ruined citadel gives the valley a recognisable horizon
        st=M.stone_blocks('Citadelle',color='#686861',moss=.2)
        for x in [-8,-3,2,7]:
            G.cyl('Tour',2.2,18+(x%3),24,st,loc=(x,78,9+(x%3)/2))
            for a in range(10):
                t=a*math.tau/10
                G.box('Merlon',(.7,.7,1),st,loc=(x+2*math.cos(t),78+2*math.sin(t),18.5+x%3),bevel=.06)
        G.box('Rempart',(21,2.2,9),st,loc=(0,79,4.5))
        mountain=M.rock('Montagnes',color='#4b5556',moss=.2)
        for i in range(12):
            rock((-110+i*22,140+R.uniform(-4,10),4),(24,22,R.uniform(14,23)),mountain)
        fog(.003,(.7,.65,.49)); camera((1,-15,3.2),(0,26,5),37)
    elif key=='bg_loading_1':
        world((.2,.32,.5),.2); light('Lune',(-14,18,28),2.3,(.44,.65,1),kind='SUN')
        for i in range(32):
            x=R.uniform(-15,15); y=R.uniform(0,38)
            if abs(x)>2.5: grave(x,y)
        arch(0,27,r=4)
        for x,y in [(-12,12),(13,24),(-18,33),(18,38)]:tree(x,y,13,True)
        flame=M.emissive('Flamme',color='#ffb665',strength=4)
        for x,y in [(-4,4),(4,15),(-5,23)]:
            G.cyl('Bougie',.085,.35,20,M.flat('Cire',color='#c7b493'),loc=(x,y,.2))
            G.uvsphere('Flamme',.07,12,8,flame,loc=(x,y,.43),scale=(.65,.65,2))
            light('Cierge',(x,y,.55),30,(1,.4,.12),kind='POINT')
        fog(.024,(.28,.42,.60)); camera((2,-12,3.5),(0,21,3.8),39)
    elif key=='bg_loading_2':
        world((.12,.20,.24),.14)
        st=M.rock('Caverne',moss=.22)
        for s in [-1,1]:
            for j in range(8):rock((s*10,5+j*7,8),(R.uniform(3,5),5,R.uniform(8,12)),st)
        for y in [25,35]:arch(0,y,r=6)
        golem(); fog(.018,(.31,.43,.43))
        light('Fissure',(-5,13,22),2500,(.63,.83,1),size=4,target=(0,14,3))
        light('Reflet',(4,-3,8),1400,(1,.58,.27),size=6,target=(0,14,4))
        camera((5,-14,3),(0,14,4.2),41)
    else:
        world((.3,.4,.42),.32); light('Aube',(-8,25,35),2.5,(.75,.88,.86),kind='SUN')
        for j in range(7):
            for s in [-1,1]:
                for k in range(3):tree(s*(5+k*7+R.uniform(-1,1)),j*10+R.uniform(-2,2),R.uniform(12,20))
        arch(0,38,r=2.6); fog(.030,(.38,.51,.48))
        light('Clairiere',(-6,8,16),10000,(.70,.85,.78),size=5,target=(0,20,3))
        light('SousBois',(0,-5,7),2500,(.55,.70,.64),size=10,target=(0,15,3))
        camera((0,-13,2.8),(0,35,5.5),35)

def title(text,z,size,mat):
    d=bpy.data.curves.new(text,'FONT'); d.body=text; d.align_x='CENTER'; d.size=size; d.space_character=1.12
    font=Path(os.environ.get('BRUMEVAL_TITLE_FONT','C:/Windows/Fonts/constan.ttf'))
    if font.is_file():d.font=bpy.data.fonts.load(str(font))
    d.extrude=.025; d.bevel_depth=.008; d.bevel_resolution=3
    o=bpy.data.objects.new(text,d); bpy.context.scene.collection.objects.link(o)
    o.rotation_euler=(math.pi/2,0,0); o.location=(0,-.32,z); d.materials.append(mat)
def logo():
    world((.6,.66,.78),.4)
    gold=M.engraved_metal('OrPatine',kind='gold',rust=.08,grime=.2,wear=.35)
    iron=M.metal('FerNoir',kind='blackiron',rust=.2)
    shield=[(-1.35,2.85),(0,3.05),(1.35,2.85),(1.2,1.2),(0,.35),(-1.2,1.2)]
    G.extrude('Blason',shield,.18,gold,bevel=.06,bevel_segs=4)
    G.extrude('Ecu',[(x*.90,(z-1.7)*.9+1.7) for x,z in shield],.10,iron,y=-.12,bevel=.04,bevel_segs=4)
    # split gate and a branching ash tree: an original heraldic mark
    for s in [-1,1]:
        G.box('Tour',(.25,.09,.78),gold,loc=(s*.49,-.23,1.47),bevel=.02)
        for j in [-1,0,1]:G.box('Creneau',(.065,.09,.13),gold,loc=(s*.49+j*.09,-.23,1.91),bevel=.008)
    G.tube('Arbre',[(0,-.25,.88),(0,-.25,1.55),(.10,-.25,2.15),(0,-.25,2.65)],[.065,.06,.04,.008],12,gold)
    for s in [-1,1]:
        for j in range(3):
            z=1.6+j*.25
            G.tube('Rameau',[(0,-.25,z),(s*.28,-.25,z+.22),(s*(.48-j*.1),-.25,z+.3)],[.025,.016,.002],10,gold)
    title('BRUMEVAL',-.75,.9,gold); title('O N L I N E',-1.36,.30,gold)
    for s in [-1,1]:
        G.tube('Filet',[(s*.95,-.30,-1.27),(s*2.85,-.30,-1.27)],.008,8,gold)
    light('Or',(-4,-5,6),650,(1,.81,.5),4,target=(0,0,1))
    light('Argent',(4,0,4),900,(.55,.72,1),3,target=(0,0,1))
    light('Face',(0,-5,-1),140,(1,.85,.62),3,target=(0,0,0))
    camera((0,-15,.55),(0,0,.55),ortho=7.4)

def main():
    p=argparse.ArgumentParser(); p.add_argument('--only',default=''); p.add_argument('--samples',type=int,default=32); p.add_argument('--percent',type=int,default=100); p.add_argument('--no-preview',action='store_true');p.add_argument('--draft',action='store_true')
    a=p.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    keys=a.only.split(',') if a.only else KEYS
    if set(keys)-set(KEYS):raise ValueError('Unknown key')
    OUT.mkdir(parents=True,exist_ok=True)
    for key in keys:
        if key.startswith('logo') and (OUT/(key+'.png')).is_file():
            print('Logo validé conservé:',key,flush=True)
            continue
        C.reset()
        if key.startswith('logo'):logo()
        else:
            import cinematics
            cinematics.build(key,sys.modules[__name__])
        s=bpy.context.scene
        if key=='logo': w=h=2048
        elif key=='logo_512':w=h=512
        elif key=='launcher_banner':w,h=1600,600
        else:w,h=1920,1080
        s.render.resolution_x=w; s.render.resolution_y=h; s.render.resolution_percentage=a.percent
        s.render.film_transparent=key.startswith('logo')
        s.render.image_settings.file_format='PNG' if key.startswith('logo') else 'WEBP'
        s.render.image_settings.color_mode='RGBA' if key.startswith('logo') else 'RGB'
        s.render.image_settings.quality=92
        s.view_settings.view_transform='AgX';s.view_settings.look='AgX - Medium High Contrast'
        destination=HERE/'previews/drafts' if a.draft else OUT
        destination.mkdir(parents=True,exist_ok=True)
        s.render.filepath=str(destination/(key+('.png' if key.startswith('logo') else '.webp')))
        samples=a.samples
        with gpu.device(s,samples=samples,wait=30):
            s.cycles.use_denoising=True; s.cycles.max_bounces=6
            s.cycles.volume_bounces=1
            bpy.ops.render.render(write_still=True)
        if key=='launcher_banner':
            import subprocess,shutil
            subprocess.run([os.environ.get('BRUMEVAL_IMAGE_PYTHON',shutil.which('python') or 'python'),str(HERE/'compose_banner.py'),s.render.filepath,str(OUT/'logo.png')],check=True)
        print('CX1 DONE',key,flush=True)
    if not a.draft:
        (HERE/'manifest.json').write_text(json.dumps({'keys':KEYS,'engine':'Cycles','pass':2,'seed':20260923,'samples':a.samples,'percent':a.percent,'kit_root':str(kitroot),'approved_logo':'unchanged'},indent=2)+'\n')
if __name__=='__main__':main()
