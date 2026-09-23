"""CX-2: Cycles still-life icons. Run with Blender --background --python this_file -- --only key.

Reads the original silhouette builders and shared kit, never modifies them.
BRUMEVAL_KIT_ROOT can point to the checkout containing the still-uncommitted kit.
"""
import sys
sys.dont_write_bytecode = True
import argparse, os, math, json, random
from pathlib import Path
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
sys.path[:0] = [str(ROOT / 'assets/blender'), str(ROOT / 'assets/blender/icons')]
KIT_ROOT = Path(os.environ.get('BRUMEVAL_KIT_ROOT', str(ROOT / 'assets/blender')))
if not (KIT_ROOT / 'kit').is_dir():
    KIT_ROOT = Path('C:/Users/amin2/mmorpg/assets/blender')
sys.path.append(str(KIT_ROOT))
import bpy
import numpy as np
from mathutils import Vector
import common as C
import geo as G
import iconlib as L
import items, abilities
from kit import materials as M, gpu

EXTRA = 'ore_copper ore_iron ore_mithril crystal_shard herb_brume herb_givre herb_braise ingot_copper ingot_iron ingot_mithril leather_strip cloth_bolt potion_hp_m potion_stamina helm_iron gloves_leather boots_leather ring_silver amulet_bone'.split()
OUT = ROOT / 'client/public/icons'
QA = HERE / 'previews'

def extra(key):
    iron = M.metal('Iron', kind='iron', rust=.22, grime=.22)
    leather = M.leather('Leather', color='#493023', stitches=True)
    if key.startswith(('ore_', 'ingot_')):
        kind = key.split('_')[1]
        metal = M.metal('OreMetal', kind={'copper':'copper','iron':'iron','mithril':'silver'}[kind],
                        color='#80a8b6' if kind == 'mithril' else None, rust=.18, grime=.25)
        if key.startswith('ingot'):
            for i in range(3):
                G.box('Ingot', (.82,.38,.21), metal, loc=((i%2-.5)*.48,(i%2)*.25,i*.19), bevel=.05)
            return dict(yaw=25,pitch=30)
        stone = M.rock('Gangue', color='#44443e', moss=0, dirt=.3)
        rnd = random.Random(29)
        G.ico('Gangue', .55, 4, stone, scale=(1,.8,.65), jitter=.025, seed=4, smooth=True)
        for i in range(14):
            a = rnd.uniform(0,math.tau)
            ob=G.ico('Vein', rnd.uniform(.12,.24), 3, metal,
                  loc=(.36*math.cos(a),-.23-abs(.10*math.sin(a)),rnd.uniform(-.20,.25)),
                  scale=(1.5,.40,.65),jitter=.022, seed=i, smooth=True)
            ob.rotation_euler[1]=rnd.uniform(-.8,.8)
        return dict(yaw=14,pitch=20)
    if key == 'crystal_shard':
        mat=M.crystal('Crystal', color='#a2b6d5', glow=.1, emit_strength=.7)
        for i in range(5):
            x=(i-2)*.17; h=.65+(.5 if i==2 else .07*i)
            ob=G.lathe('Shard',[(0,0),(.15,.08),(.14,h*.76),(0,h)],6,mat,smooth=False)
            ob.location=(x,abs(x)*.4,0); ob.rotation_euler[1]=x*.8
        return dict(yaw=15,pitch=15)
    if key.startswith('herb_'):
        color={'herb_brume':'#769780','herb_givre':'#a8c4d3','herb_braise':'#a24823'}[key]
        stem=M.wood('Stem', color='#44422b', dirt=.1)
        leaf=M.cloth('LeafHerb',color=color,dirt=.1)
        for j in range(3):
            x=(j-1)*.25
            G.tube('Stem',[(0,0,-.55),(x*.5,0,0),(x,0,.5+j*.1)],.018,10,stem)
            for k in range(4):
                z=-.25+k*.19
                for s in [-1,1]:
                    o=G.extrude('Leaf',[(0,0),(.14,.02),(.28,.18),(.14,.22),(.025,.08)],.015,leaf,bevel=.006)
                    G.place(o,loc=(x*.7,0,z),rot=(0,-s*40,0),scale=(s,1,1))
            petals={'herb_brume':3,'herb_givre':6,'herb_braise':5}[key]
            for k in range(petals):
                a=k*math.tau/petals
                if key=='herb_brume':
                    G.uvsphere('Bud',.035,20,12,leaf,loc=(x+.045*math.cos(a),-.025,.55+j*.1+.05*k),scale=(.8,.7,1.7))
                else:
                    petal=G.uvsphere('Petal',.065,24,16,leaf,loc=(x+.10*math.cos(a),-.035,.52+j*.1+.10*math.sin(a)),scale=(1,.27,2.2 if key=='herb_givre' else 1.4))
                    petal.rotation_euler[1]=math.pi/2-a
        G.torus('Binding',.10,.018,24,8,leather,loc=(0,0,-.38))
        return dict(yaw=10,pitch=7)
    if key.startswith('potion_'):
        items.potion_flask('#8a1824' if key=='potion_hp_m' else '#63783a', '#a63530' if key=='potion_hp_m' else '#8aab4c',big=False)
        band=M.metal('Collar',kind='bronze',rust=.05)
        for z in [.49,.54]:G.torus('DoseBand',.14,.021,32,12,band,loc=(0,0,z))
        if key=='potion_hp_m':
            for ob in bpy.context.scene.objects:
                if ob.type=='MESH':ob.scale.z*=1.3
        return dict(yaw=24,pitch=16)
    if key=='leather_strip':
        for j in range(3):
            path=[(-.5+i*.1,-.02*j,.16*math.sin(i*.45+j)+j*.17) for i in range(11)]
            G.ribbon('Strip',path,[.11]*11,leather)
        return dict(yaw=18,pitch=32)
    if key=='cloth_bolt':
        cloth=M.cloth('ClothBolt',color='#797264',kind='linen')
        G.cyl('Roll',.28,1.0,64,cloth,rot=(0,90,0))
        G.cyl('Core',.08,1.03,32,M.wood('Core'),rot=(0,90,0))
        for x in [-.27,.27]:
            G.torus('Binding',.283,.018,48,8,leather,loc=(x,0,0),rot=(0,90,0))
        return dict(yaw=25,pitch=23)
    if key=='ring_silver':
        silver=M.engraved_metal('Silver',kind='silver',rust=0)
        G.torus('Ring',.40,.075,64,16,silver,rot=(72,12,0))
        G.ico('Onyx',.17,2,M.crystal('Onyx',color='#293c39',glow=.05),loc=(0,-.13,.38),scale=(1,.6,1))
        return dict(yaw=15,pitch=18)
    if key=='amulet_bone':
        items.goblin_trinket()
        for o in list(bpy.context.scene.objects):
            if o.type=='MESH' and ('Disc' in o.name or 'Gem' in o.name):
                o.data.materials.clear(); o.data.materials.append(M.bone('AmuletBone'))
        return dict(yaw=0,pitch=10)
    if key=='helm_iron':
        G.lathe('Helm',[(.35,0),(.43,.15),(.44,.45),(.36,.7),(.18,.86),(0,.89)],48,iron)
        for s in [-1,1]:
            G.box('EyeSlit',(.28,.025,.052),M.flat('Dark',color='#090a09'),loc=(s*.19,-.425,.4),bevel=.008)
            G.box('Cheek',(.14,.12,.31),iron,loc=(s*.3,-.29,-.05),bevel=.045)
        G.box('Nasal',(.09,.13,.4),iron,loc=(0,-.44,.2),bevel=.018)
        return dict(yaw=19,pitch=12)
    if key=='gloves_leather':
        for s in [-1,1]:
            x=s*.27
            G.box('Palm',(.32,.16,.4),leather,loc=(x,0,0),bevel=.07)
            for j in range(4):
                G.rod('Finger',(x+(j-1.5)*.075,0,.14),(x+(j-1.5)*.085,-.025,.45-abs(j-1.5)*.06),.038,16,leather,smooth=True)
            G.rod('Thumb',(x+s*.14,0,-.08),(x+s*.23,-.01,.10),.06,16,leather,smooth=True)
            G.box('Cuff',(.36,.2,.14),leather,loc=(x,0,-.25),bevel=.04)
        return dict(yaw=18,pitch=15)
    if key=='boots_leather':
        for s in [-1,1]:
            x=s*.25
            G.box('Sole',(.38,.66,.07),M.leather('Sole',color='#211c18'),loc=(x,-.14,-.35),bevel=.03)
            G.uvsphere('Foot',.25,32,20,leather,loc=(x,-.14,-.21),scale=(.75,1.3,.6))
            G.lathe('Boot',[(.17,-.22),(.15,0),(.19,.42),(.21,.46)],32,leather).location.x=x
            for z in [-.04,.17,.37]:
                G.box('Buckle',(.11,.05,.08),iron,loc=(x,-.19,z),bevel=.01)
        return dict(yaw=23,pitch=17)
    raise ValueError(key)

def upgrade_materials():
    for mat in list(bpy.data.materials):
        if mat.get('kit') or not mat.node_tree: continue
        bs=next((n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None)
        if bs is None: continue
        name=mat.name.lower()
        if bs.inputs['Alpha'].default_value<.99: continue
        if bs.inputs['Emission Strength'].default_value>0 and max(bs.inputs['Emission Color'].default_value[:3])>0:
            bs.inputs['Emission Strength'].default_value *= .42
            color=tuple(bs.inputs['Emission Color'].default_value)
            nt=mat.node_tree;noise=nt.nodes.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=9;noise.inputs['Detail'].default_value=5
            ramp=nt.nodes.new('ShaderNodeValToRGB')
            ramp.color_ramp.elements[0].color=tuple(v*.12 for v in color[:3])+(1,)
            ramp.color_ramp.elements[1].color=color
            nt.links.new(noise.outputs['Fac'],ramp.inputs['Fac']);nt.links.new(ramp.outputs['Color'],bs.inputs['Emission Color'])
            nt.links.new(ramp.outputs['Color'],bs.inputs['Base Color'])
            continue
        replacement=None
        if any(t in name for t in ['gold','bronze','steel','iron','blade','silver','metal','chain']):
            kind='gold' if 'gold' in name else 'bronze' if 'bronze' in name else 'steel'
            replacement=M.engraved_metal('V2_'+mat.name,kind=kind,rust=.18,grime=.22,wear=.35)
        elif any(t in name for t in ['wood','haft','shaft','bark','cork']): replacement=M.wood('V2_'+mat.name,dirt=.3)
        elif any(t in name for t in ['leather','wrap','belt','strap','grip']): replacement=M.leather('V2_'+mat.name)
        elif any(t in name for t in ['cloth','robe','fabric','tunic']): replacement=M.cloth('V2_'+mat.name,color='#414555')
        elif any(t in name for t in ['bone','ivory','tooth','fang']): replacement=M.bone('V2_'+mat.name)
        elif 'fur' in name: replacement=M.fur('V2_'+mat.name)
        elif 'stone' in name: replacement=M.rock('V2_'+mat.name,moss=.15)
        if replacement: mat.user_remap(replacement)

def finish_geometry():
    for o in list(bpy.context.scene.objects):
        if o.type!='MESH':continue
        if len(o.data.polygons)<300 and not any(m.type=='BEVEL' for m in o.modifiers):
            b=o.modifiers.new('Soft worn edges','BEVEL'); b.width=.008; b.segments=3
            b.limit_method='ANGLE'
        for f in o.data.polygons:f.use_smooth=True
        n=o.modifiers.new('Weighted normals','WEIGHTED_NORMAL'); n.keep_sharp=True; n.weight=40

def render(key,opts,samples):
    scene=bpy.context.scene
    objs=[o for o in scene.objects if o.type=='MESH']
    cam=L._camera(opts.get('yaw',0),opts.get('pitch',0))
    extent=L._frame(cam,objs,min(opts.get('fill',.84),.86))
    L._world(.32); L._lights(cam,key=2.8,fill=.65,rim=2.0,key_col=(1,.85,.65),rim_col=(.65,.78,1))
    if key.startswith('ab_'):
        # A genuine rough stone surface behind the emblem, aligned with the camera.
        p=cam.location - cam.rotation_euler.to_quaternion() @ Vector((0,0,extent*4+3))
        bg=G.box('Backdrop',(extent*5,extent*5,.05),M.rock('Backdrop',color='#292b30',color2='#11151a',scale=3,moss=0,dirt=.1))
        bg.location=p; bg.rotation_euler=cam.rotation_euler
        cam.data.clip_end=max(cam.data.clip_end,extent*8+20)
    scene.render.resolution_x=scene.render.resolution_y=256
    scene.render.resolution_percentage=100
    scene.render.film_transparent=not key.startswith('ab_')
    scene.render.image_settings.file_format='PNG'; scene.render.image_settings.color_mode='RGBA'
    scene.view_settings.view_transform='AgX'
    scene.render.filepath=str(OUT/f'{key}.png')
    with gpu.device(scene,samples=samples,wait=30):
        scene.cycles.use_denoising=True
        bpy.ops.render.render(write_still=True)
    print('CX2 DONE',key,flush=True)

def main():
    p=argparse.ArgumentParser(); p.add_argument('--only',default=''); p.add_argument('--samples',type=int,default=48); p.add_argument('--no-preview',action='store_true')
    args=p.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    builders={**items.BUILDERS,**abilities.BUILDERS,**{k:(lambda k=k:extra(k)) for k in EXTRA}}
    keys=args.only.split(',') if args.only else list(builders)
    if set(keys)-builders.keys(): raise ValueError('Unknown keys: '+str(set(keys)-builders.keys()))
    OUT.mkdir(parents=True,exist_ok=True); QA.mkdir(parents=True,exist_ok=True)
    for key in keys:
        C.reset(); opts=builders[key]() or {}; upgrade_materials(); finish_geometry(); render(key,opts,args.samples)
    (HERE/'manifest.json').write_text(json.dumps({'size':[256,256],'engine':'Cycles','keys':list(builders),'kit_root':str(KIT_ROOT),'samples':args.samples},indent=2)+'\n')

if __name__=='__main__': main()
