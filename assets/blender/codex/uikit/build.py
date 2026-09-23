"""CX-9: real Blender geometry/material renders for the Brumeval UI.

blender --background --python build.py -- --samples 48
Optional --only panel_leather,button_hover; --draft stores separate previews.
"""
import sys
sys.dont_write_bytecode = True
import argparse, importlib, json, math, os, random, shutil, subprocess
from pathlib import Path
import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
KIT_ROOT = ROOT/'assets/blender'
if not (KIT_ROOT/'kit').exists(): KIT_ROOT=Path('C:/Users/amin2/mmorpg/assets/blender')
sys.path.insert(0,str(KIT_ROOT))
from kit import gpu
OUT=ROOT/'client/public/ui/kit'
ASSETS={}
def entry(key,size,slice=None,alpha=True,**extra):
    ASSETS[key]={'file':key+'.png','size':list(size),'alpha':alpha,**extra}
    if slice:ASSETS[key]['slice']={'top':slice[0],'right':slice[1],'bottom':slice[2],'left':slice[3]}
for kind in ['leather','stone']:entry('panel_'+kind,(512,512),(64,64,64,64),content_inset=[68]*4)
entry('corner',(128,128),orientation='top_left',usage='Rotate 0/90/180/270 degrees; native ornament size 64 px.')
entry('border_h',(256,24),(0,12,0,12));entry('border_v',(24,256),(12,0,12,0))
for state in ['normal','hover','pressed']:entry('button_'+state,(320,64),(20,48,20,48),content_inset=[14,50,14,50])
for kind in ['hp','mana','stamina']:
    entry('bar_frame_'+kind,(320,32),(12,24,12,24),aperture=[16,9,288,14])
    entry('bar_fill_'+kind,(256,16),(3,5,3,5),usage='Clip width by resource percentage; do not stretch brightness by value.')
for kind in ['item','skill']:entry('slot_'+kind,(128,128),(28,28,28,28),aperture=[15,15,98,98])
entry('minimap_ring',(512,512),aperture={'shape':'circle','center':[256,256],'radius':223})
entry('tooltip',(256,128),(20,20,20,20),content_inset=[24]*4)
entry('separator',(512,32),(0,32,0,32))
for kind in ['normal','attack','talk','grab']:
    for size in [32,64]:entry('cursor_'+kind+'_'+str(size),(size,size),hotspot=[round(size*.125)]*2)

def srgb(s):
    vals=[int(s[i:i+2],16)/255 for i in (1,3,5)]
    return tuple(v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in vals)+(1,)

def material(name,color,metallic=0,rough=.65,grain=0):
    m=bpy.data.materials.new(name);m.diffuse_color=srgb(color);m.use_nodes=True
    nt=m.node_tree;p=nt.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value=srgb(color);p.inputs['Metallic'].default_value=metallic;p.inputs['Roughness'].default_value=rough
    if grain:
        n=nt.nodes.new('ShaderNodeTexNoise');n.inputs['Scale'].default_value=grain;n.inputs['Detail'].default_value=3;n.inputs['Roughness'].default_value=.7
        ramp=nt.nodes.new('ShaderNodeValToRGB');base=srgb(color)
        ramp.color_ramp.elements[0].color=tuple(c*.68 for c in base[:3])+(1,)
        ramp.color_ramp.elements[1].color=tuple(min(1,c*1.18) for c in base[:3])+(1,)
        nt.links.new(n.outputs['Fac'],ramp.inputs[0]);nt.links.new(ramp.outputs[0],p.inputs['Base Color'])
        bump=nt.nodes.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.20;bump.inputs['Distance'].default_value=.012
        nt.links.new(n.outputs['Fac'],bump.inputs['Height']);nt.links.new(bump.outputs[0],p.inputs['Normal'])
    return m

def box(name,x,y,w,h,z,depth,mat,bevel=.015):
    bpy.ops.mesh.primitive_cube_add(size=1,location=(x,y,z))
    ob=bpy.context.object;ob.name=name;ob.dimensions=(w,h,depth);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    ob.data.materials.append(mat)
    if bevel:
        b=ob.modifiers.new('WornEdge','BEVEL');b.width=bevel;b.segments=3
        ob.modifiers.new('Normals','WEIGHTED_NORMAL')
    return ob

def line(name,points,r,mat,z=.075,cyclic=False):
    cu=bpy.data.curves.new(name,'CURVE');cu.dimensions='3D';cu.bevel_depth=r;cu.bevel_resolution=3
    spl=cu.splines.new('POLY');spl.points.add(len(points)-1)
    for p,v in zip(spl.points,points):p.co=(v[0],v[1],z,1)
    spl.use_cyclic_u=cyclic
    ob=bpy.data.objects.new(name,cu);bpy.context.collection.objects.link(ob);ob.data.materials.append(mat)
    return ob

def ringrect(w,h,inset,r,mat,z=.08):
    x=w/2-inset;y=h/2-inset;cut=min(.09,x*.15,y*.15)
    pts=[(-x+cut,-y),(x-cut,-y),(x,-y+cut),(x,y-cut),(x-cut,y),(-x+cut,y),(-x,y-cut),(-x,-y+cut)]
    return line('EngravedBorder',pts,r,mat,z,True)

def petal(cx,cy,angle,size,mat,z=.09):
    pts=[]
    for i in range(41):
        t=i/40*math.tau;u=size*(1-math.cos(t))*.5;v=size*.22*math.sin(t)
        pts.append((cx+u*math.cos(angle)-v*math.sin(angle),cy+u*math.sin(angle)+v*math.cos(angle)))
    line('LaurelFiligree',pts,.009,mat,z,True)

def corner(cx,cy,sx,sy,size,mat):
    for axis in [0,1]:
        pts=[]
        for i in range(49):
            t=i/48;u=size*t;v=.055*math.sin(t*math.pi*2)*(1-t)+.045
            pts.append((cx+sx*(u if axis==0 else v),cy+sy*(v if axis==0 else u)))
        line('CornerStem',pts,.012,mat)
        for j in range(3):
            q=.13+j*.115
            petal(cx+sx*(q if axis==0 else .045),cy+sy*(.045 if axis==0 else q),math.atan2(sy,sx)+(math.pi/2 if axis else 0),.10,mat)

def plaque(w,h,base,gold,ornate=True):
    box('Backing',0,0,w-.045,h-.045,0,.055,base,.04)
    ringrect(w,h,.055,.012,gold);ringrect(w,h,.09,.005,gold)
    if ornate:
        for sx in [-1,1]:
            for sy in [-1,1]:corner(sx*(w/2-.13),sy*(h/2-.13),-sx,-sy,.32,gold)

def polygon(name,pts,mat,z=.06):
    me=bpy.data.meshes.new(name);me.from_pydata([(x,y,z) for x,y in pts],[],[tuple(range(len(pts)))]);me.materials.append(mat)
    ob=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(ob)
    sol=ob.modifiers.new('SolidRelief','SOLIDIFY');sol.thickness=.035
    b=ob.modifiers.new('PolishedEdge','BEVEL');b.width=.012;b.segments=3
    ob.modifiers.new('Normals','WEIGHTED_NORMAL');return ob

def cursor(kind,gold,dark,ivory):
    # Shared 64px design; tip at x=y=8px. Geometry is supersampled by Cycles.
    def xy(points):return [((x-32)/100,(32-y)/100) for x,y in points]
    if kind=='normal':points=[(8,8),(42,33),(28,34),(36,52),(29,55),(22,38),(12,49)]
    elif kind=='attack':points=[(8,8),(20,12),(40,36),(45,31),(50,37),(44,43),(55,52),(51,57),(40,47),(34,52),(29,47),(34,41),(12,20)]
    elif kind=='talk':points=[(8,8),(51,8),(57,14),(57,40),(51,46),(28,46),(17,55),(18,46),(8,46),(4,40),(4,14)]
    else:points=[(8,8),(14,8),(16,26),(18,14),(24,14),(25,28),(28,17),(34,18),(34,31),(38,22),(44,25),(40,41),(35,53),(19,56),(10,47),(3,32),(8,28),(17,38)]
    line('CursorDarkOutline',xy(points),.026,dark,.025,True)
    polygon('CursorRelief',xy(points),ivory if kind in ['normal','attack'] else gold)
    line('CursorRim',xy(points),.010,gold,.085,True)
    if kind=='talk':
        for x in [19,30,41]:
            bpy.ops.mesh.primitive_uv_sphere_add(segments=16,ring_count=8,radius=.025,location=((x-32)/100,(32-27)/100,.10));bpy.context.object.data.materials.append(dark)
    if kind=='attack':line('BladeFuller',xy([(13,14),(35,38)]),.007,dark,.10)

def build(key):
    w,h=[v/100 for v in ASSETS[key]['size']]
    if key.startswith('cursor_'):w=h=.64
    gold=material('PatinatedGold','#9c8152',.78,.42,75)
    iron=material('DarkIron','#303333',.68,.58,42)
    leather=material('BlackenedLeather','#242825',0,.88,95)
    stone=material('CharcoalStone','#2b302f',0,.86,26)
    ivory=material('IvorySilver','#d1cab5',.35,.35,70)
    dark=material('Ink','#080c0d',0,.8)
    colors={'hp':'#873c37','mana':'#365e7b','stamina':'#687147'}
    if key.startswith('panel_'):plaque(w,h,leather if key.endswith('leather') else stone,gold)
    elif key=='tooltip':plaque(w,h,leather,gold,False)
    elif key.startswith('button_'):
        if key.endswith('hover'):gold=material('HoverGold','#c7a775',.65,.35);leather=material('HoverLeather','#343932',0,.8,90)
        if key.endswith('pressed'):gold=material('PressedGold','#766443',.6,.6);leather=material('PressedLeather','#171c19',0,.9,90)
        plaque(w,h,leather,gold,False)
        for s in [-1,1]:
            petal(s*(w/2-.24),0,0 if s<0 else math.pi,.13,gold)
    elif key.startswith('bar_frame_'):
        ringrect(w,h,.045,.026,iron);ringrect(w,h,.075,.010,gold)
        accent=material('ResourceGem',colors[key.removeprefix('bar_frame_')],.4,.28)
        for s in [-1,1]:polygon('ResourceCap',[(s*(w/2-.15),-.065),(s*(w/2-.09),0),(s*(w/2-.15),.065),(s*(w/2-.21),0)],accent,.105)
    elif key.startswith('bar_fill_'):
        fill=material('ResourceFill',colors[key.removeprefix('bar_fill_')],.2,.5,90)
        box('Fluid',0,0,w-.01,h-.012,0,.05,fill,.025)
        line('ResourceHighlight',[(-w/2+.04,h*.22),(w/2-.04,h*.22)],.004,ivory,.04)
    elif key.startswith('slot_'):
        ringrect(w,h,.065,.050,iron);ringrect(w,h,.075,.012,gold);ringrect(w,h,.125,.007,gold)
        for sx in [-1,1]:
            for sy in [-1,1]:petal(sx*(w/2-.14),sy*(h/2-.14),math.atan2(-sy,-sx),.14,gold)
        if key=='slot_skill':
            for s in [-1,1]:polygon('SkillMark',[(s*.49,0),(s*.55,.045),(s*.60,0),(s*.55,-.045)],gold,.12)
    elif key=='minimap_ring':
        for r,width,mat in [(2.42,.055,iron),(2.39,.014,gold),(2.28,.016,gold),(2.45,.007,gold)]:
            line('MapRing',[(r*math.cos(t*math.tau/256),r*math.sin(t*math.tau/256)) for t in range(256)],width,mat,.08,True)
        for i in range(48):
            a=i*math.tau/48;r=2.30;end=2.38 if i%4 else 2.41
            line('CompassTick',[(r*math.cos(a),r*math.sin(a)),(end*math.cos(a),end*math.sin(a))],.007,gold)
        for i in range(4):
            a=i*math.pi/2;petal(2.34*math.cos(a),2.34*math.sin(a),a,.17,gold)
    elif key=='corner':corner(-.50,.50,1,-1,.89,gold)
    elif key.startswith('border_'):
        horizontal=key.endswith('h');length=w if horizontal else h
        for side in [-1,1]:
            pts=[(-length/2+.015,side*.035),(length/2-.015,side*.035)]
            if not horizontal:pts=[(y,x) for x,y in pts]
            line('BorderRail',pts,.010,gold)
        for s in [-1,1]:petal(s*(length/2-.12) if horizontal else 0,0 if horizontal else s*(length/2-.12),0 if horizontal else math.pi/2,.08,gold)
    elif key=='separator':
        for s in [-1,1]:
            line('Divider',[(s*.22,0),(s*(w/2-.1),0)],.008,gold)
            petal(s*.08,0,0 if s>0 else math.pi,.16,gold)
        polygon('DividerDiamond',[(0,.09),(.07,0),(0,-.09),(-.07,0)],gold)
    elif key.startswith('cursor_'):cursor(key.split('_')[1],gold,dark,ivory)
    return w,h

def render(key,samples,draft):
    bpy.ops.wm.read_factory_settings(use_empty=True);importlib.reload(gpu)
    w,h=build(key);scene=bpy.context.scene
    camd=bpy.data.cameras.new('UIOrthographic');cam=bpy.data.objects.new('UIOrthographic',camd);scene.collection.objects.link(cam)
    cam.location=(0,0,10);camd.type='ORTHO';camd.ortho_scale=max(w,h);scene.camera=cam
    # Camera local -Z looks directly down world -Z without perspective distortion.
    def area(name,loc,power,size):
        ld=bpy.data.lights.new(name,'AREA');lo=bpy.data.objects.new(name,ld);scene.collection.objects.link(lo);lo.location=loc;ld.energy=power;ld.shape='DISK';ld.size=size;lo.rotation_euler=(Vector((0,0,0))-lo.location).to_track_quat('-Z','Y').to_euler()
    area('SoftUpperLeft',(-3,4,7),650,5);area('MutedFill',(4,-1,5),180,5)
    scene.world=bpy.data.worlds.new('UIWorld');scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.15,.17,.18,1);scene.world.node_tree.nodes['Background'].inputs[1].default_value=.35
    size=ASSETS[key]['size'];render_size=[n*2 for n in size]
    scene.render.resolution_x=render_size[0];scene.render.resolution_y=render_size[1];scene.render.resolution_percentage=100
    scene.render.film_transparent=True;scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA';scene.render.image_settings.color_depth='8'
    scene.view_settings.view_transform='AgX';scene.render.image_settings.compression=35
    dest=HERE/'previews/drafts' if draft else OUT;dest.mkdir(parents=True,exist_ok=True)
    path=dest/ASSETS[key]['file'];scene.render.filepath=str(path)
    with gpu.device(scene,samples=samples,wait=30):bpy.ops.render.render(write_still=True)
    py=os.environ.get('BRUMEVAL_IMAGE_PYTHON') or shutil.which('python')
    subprocess.run([py,str(HERE/'review.py'),'--resize',str(path),str(size[0]),str(size[1])],check=True)
    print('CX9 DONE '+key,flush=True)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--samples',type=int,default=48);parser.add_argument('--only');parser.add_argument('--draft',action='store_true');parser.add_argument('--manifest-only',action='store_true')
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    keys=[] if args.manifest_only else (args.only.split(',') if args.only else list(ASSETS))
    for key in keys:
        if key not in ASSETS:raise ValueError(key)
        render(key,args.samples,args.draft)
    if not args.draft:
        OUT.mkdir(parents=True,exist_ok=True)
        (OUT/'manifest.json').write_text(json.dumps({'version':1,'generator':'Blender Cycles orthographic physical relief','color_space':'sRGB','slice_units':'source pixels','slice_order':['top','right','bottom','left'],'assets':ASSETS},indent=2)+'\n',encoding='utf8')

if __name__=='__main__':main()
