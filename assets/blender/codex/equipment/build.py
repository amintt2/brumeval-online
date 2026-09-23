"""Brumeval hand equipment: deterministic geometry -> procedural PBR bake -> GLB/LOD/QA.
Blender -b --python build.py -- --only eq_sword_1 [--geometry-only] [--no-sheets]
"""
import sys
sys.dont_write_bytecode = True
import os, math, json, argparse, importlib, struct, hashlib
from pathlib import Path
ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).resolve().parent
kit_root = ROOT / 'assets/blender'
if not (kit_root / 'kit').exists():
    kit_root = Path(os.environ.get('BRUMEVAL_KIT_ROOT', 'C:/Users/amin2/mmorpg/assets/blender'))
sys.path.insert(0, str(kit_root))
import bpy, bmesh
from mathutils import Vector
import common as C
from kit import materials as M, bake, export, lod, qa, render, gpu
OUT = ROOT / 'client/public/models'
PRE = HERE / 'previews'
KEYS = [f'eq_{family}_{i}' for family, count in [('sword',5),('greatsword',2),('staff',4),('bow',4),('shield',3)] for i in range(1,count+1)]

def mesh(name, verts, faces, mat, smooth=False):
    me = bpy.data.meshes.new(name); me.from_pydata(verts, [], faces); me.update()
    ob = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(ob)
    ob.data.materials.append(mat)
    bm = bmesh.new(); bm.from_mesh(me); bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = smooth
    return ob

def bevel(ob, width=.003, segments=2):
    C.apply_transforms(ob)
    md = ob.modifiers.new('Forged rounded edges', 'BEVEL'); md.width=width; md.segments=segments
    C.activate(ob); bpy.ops.object.modifier_apply(modifier=md.name)
    return ob

def tube(name, points, radius, mat, sides=8):
    # Parallel reference Y is stable for all authored sweeps in the XZ plane.
    closed=len(points)>3 and (Vector(points[0])-Vector(points[-1])).length<1e-7
    if closed:points=points[:-1]
    vertices=[]
    for i, p in enumerate(points):
        prev=(i-1)%len(points) if closed else max(0,i-1)
        nex=(i+1)%len(points) if closed else min(i+1,len(points)-1)
        tangent=Vector(points[nex])-Vector(points[prev])
        tangent.normalize(); a=tangent.cross(Vector((0,1,0))).normalized(); b=tangent.cross(a).normalized()
        r=radius[i] if isinstance(radius,list) else radius
        vertices.extend(tuple(Vector(p)+r*(math.cos(j*math.tau/sides)*a+math.sin(j*math.tau/sides)*b)) for j in range(sides))
    faces=[] if closed else [tuple(reversed(range(sides)))]
    for i in range(len(points) if closed else len(points)-1):
        nex=(i+1)%len(points)
        for j in range(sides): faces.append((i*sides+j,i*sides+(j+1)%sides,nex*sides+(j+1)%sides,nex*sides+j))
    if not closed:faces.append(tuple((len(points)-1)*sides+j for j in range(sides)))
    return mesh(name,vertices,faces,mat,True)

def mats(i):
    result=dict(steel=M.metal('WeatheredSteel',kind='steel',rust=.70 if i==1 else .12,grime=.22,wear=.55,scale=3.8,seed=i,bump=.5),
        edge=M.metal('HonedEdge',kind='steel',rust=.03,grime=.08,wear=.65,scale=3,seed=23,bump=.16),
        iron=M.metal('BlackenedIron',kind='blackiron',rust=.3,grime=.35,wear=.5,scale=3,seed=i+9,bump=.5),
        bronze=M.engraved_metal('ChasedBronze',kind='bronze',rust=.16,grime=.28,scale=1.3,seed=i),
        leather=M.leather('WornGrip',color='#34261e',scale=5,seed=i,wear=.6,dirt=.25,bump=.4),
        wood=M.wood('AgedHeartwood',color='#58402b',color2='#21170f',scale=2,seed=i,dirt=.2,wear=.3,bump=.4),
        gem=M.crystal('InsetCrystal',color=['#91b9ca','#8acbd4','#df6c27','#a1b98a'][min(i-1,3)],glow=.18,emit_strength=1.2,seed=i))
    # Rust is a muted ferric crust, rather than bright orange paint.
    nt=result['steel'].node_tree; bs=next(n for n in nt.nodes if n.type=='BSDF_PRINCIPLED')
    color=bs.inputs['Base Color']; source=color.links[0].from_socket
    sat=nt.nodes.new('ShaderNodeHueSaturation');sat.inputs['Saturation'].default_value=.62
    nt.links.new(source,sat.inputs['Color']);nt.links.new(sat.outputs['Color'],color)
    return result

def grip(m, length=.22, radius=.025):
    C.cylinder('Grip core',r=radius,depth=length,verts=16,mat=m['leather'],smooth=True)
    # Thin leather seam winds over core; tightly seated, no floating rings.
    points=[((radius+.0008)*math.cos(t*math.tau*7),(radius+.0008)*math.sin(t*math.tau*7),-.47*length+t*.94*length) for t in [j/112 for j in range(113)]]
    tube('Leather lacing',points,.0018,m['leather'],4)
    for z in [-length*.49,length*.49]:
        C.cylinder('Grip ferrule',r=radius+.005,depth=.019,verts=16,mat=m['bronze'],loc=(0,0,z),smooth=True)

def sword(i, great=False):
    m=mats(i); length=(1.18+.17*i) if great else [.73,.91,1.02,.82,1.10][i-1]
    if not great and i==3:
        m['steel']=M.engraved_metal('RunedSteel',kind='steel',pattern='runes',rust=.10,grime=.25,scale=.85,seed=3,glow='#526b70',glow_strength=.45)
    if not great and i==5:
        m['steel']=M.engraved_metal('CeremonialSteel',kind='silver',pattern='filigree',rust=.06,grime=.3,scale=.7,seed=5)
    handle=.36 if great else .22; grip(m,handle,.029 if great else .024)
    z0=handle/2+.033; width=(.080 if great else [.045,.047,.052,.065,.042][i-1])
    # Full lenticular section with sharpened edge strips and intentional tapered shoulders.
    rings=[(0,1),(.06,1.04),(.30,.96),(.70,.82),(.89,.60),(1,.018)]
    verts=[]
    for t,w in rings:
        cx=(.045*math.sin(t*math.pi/2) if i==4 and not great else 0)
        thick=min(1,w*2)
        verts.extend([(cx-width*w,0,z0+t*length),(cx-width*w*.72,-.008*thick,z0+t*length),(cx,-.014*thick,z0+t*length),(cx+width*w*.72,-.008*thick,z0+t*length),(cx+width*w,0,z0+t*length),(cx+width*w*.72,.008*thick,z0+t*length),(cx,.014*thick,z0+t*length),(cx-width*w*.72,.008*thick,z0+t*length)])
    faces=[tuple(reversed(range(8)))]
    for r in range(len(rings)-1):
        for j in range(8): faces.append((r*8+j,r*8+(j+1)%8,(r+1)*8+(j+1)%8,(r+1)*8+j))
    faces.append(tuple(range(40,48)))
    blade=mesh('Tapered forged blade',verts,faces,m['steel']); blade.data.materials.append(m['edge'])
    for p in blade.data.polygons:
        if p.index>0 and (p.index-1)%8 in (0,3,4,7):p.material_index=1
    span=.24 if great else .16+.012*i
    pts=[(x,0,z0-.009-(.045 if i%2 else -.025)*(abs(x)/span)**1.5) for x in [(-1+j/12)*span for j in range(25)]]
    tube('Swept crossguard',pts,[.012+.008*(1-abs(j-12)/12) for j in range(25)],m['bronze'] if i>2 else m['iron'],10)
    C.sphere('Pommel',r=.037,segments=16,rings=8,mat=m['bronze'],loc=(0,0,-handle/2-.034),scale=(1,.7,1.25))
    if i>=3:
        C.ico('Pommel stone',r=.018,subdiv=2,mat=m['gem'],loc=(0,-.021,-handle/2-.034),scale=(1,.5,1))
        for side in [-1,1]:
            tube('Guard leaf',[(side*.055,0,z0),(side*.10,0,z0+.025),(side*.145,0,z0+.008)],.007,m['bronze'],8)
    if i==5 or great:
        # An inset narrow metal fuller is seated on the front ridge.
        tube('Fuller inlay',[(0,-.0145,z0+.10),(0,-.0145,z0+length*.73)],.0023,m['bronze'],6)

def staff(i):
    m=mats(i); low=-.58; top=.86+.10*i
    pts=[(.026*math.sin(j*.8+i)*max(0,abs(j/20-.4)),.012*math.sin(j*.55),low+(top-low)*j/20) for j in range(21)]
    tube('Grown wooden shaft',pts,[.020+.008*(j/20)**2 for j in range(21)],m['wood'],12)
    grip(m,.24,.025)
    for z in [low+.035,top-.12]: C.cylinder('Shaft collar',r=.029,depth=.09,verts=16,mat=m['bronze'],loc=(0,0,z),smooth=True)
    if i==1:
        tube('Shepherd crook',[(.03+math.cos(t)*.10,0,top+math.sin(t)*.14) for t in [j/20*math.pi*1.65-.3 for j in range(21)]],.024,m['wood'],10)
        C.ico('Clouded focus',r=.055,subdiv=2,mat=m['gem'],loc=(.02,0,top+.055),scale=(.75,.75,1.25))
    else:
        C.cone('Crystal socket',r1=.027,r2=.052,depth=.10,verts=16,mat=m['bronze'] if i!=3 else m['iron'],loc=(0,0,top-.03),smooth=True)
        for side in [-1,1]:
            tube('Crown prong',[(0,0,top-.12),(side*.075,0,top+.01),(side*(.115 if i==3 else .095),0,top+.18),(side*.048,0,top+.30)], [.024,.020,.014,.007],m['bronze'] if i!=3 else m['iron'],10)
        gem=C.ico('Focus crystal',r=.092,subdiv=2,mat=m['gem'],loc=(0,0,top+.13),scale=(.7,.65,1.7))
        if i==4:
            C.torus('Astral meridian',major=.13,minor=.007,seg=40,minor_seg=6,mat=m['bronze'],loc=(0,0,top+.13),rot=(math.pi/2,.4,0))

def bow(i):
    m=mats(i); half=[.56,.78,.72,.84][i-1];brace=.15 if i>=3 else .11
    curvature=[.13,.11,.18,.22][i-1]
    thickness=[.024,.026,.025,.033][i-1]
    if i==2:
        m['wood']=M.wood('Copperwood',color='#98522f',color2='#472719',scale=1.2,seed=22,dirt=.15,wear=.35,bump=.35)
    elif i==3:
        m['wood']=M.wood('PaleAsh',color='#bca47a',color2='#76654b',scale=1.2,seed=33,dirt=.12,wear=.35,bump=.3)
        m['bronze']=M.metal('ElvenGold',kind='gold',rust=.05,grime=.12,wear=.5,scale=2,seed=33,bump=.25)
    elif i==4:
        m['wood']=M.metal('RoyalGoldLimbs',kind='gold',color='#c89932',rust=.04,grime=.14,wear=.55,scale=2,seed=44,bump=.25)
        m['bronze']=M.metal('DarkInlay',kind='blackiron',rust=.05,grime=.12,wear=.4,scale=2,seed=44,bump=.25)
    if i in (2,3,4):
        # Long, thin limbs have few texels across their width. Limit albedo microcontrast
        # to avoid unstable grain/engraving at atlas seams; roughness and bump stay intact.
        means={2:[(.22,.075,.028,1),(.20,.11,.043,1)],3:[(.40,.31,.20,1),(.52,.33,.065,1)],4:[(.52,.29,.055,1),(.025,.022,.018,1)]}[i]
        for material,mean in zip([m['wood'],m['bronze']],means):
            nt=material.node_tree;bs=next(n for n in nt.nodes if n.type=='BSDF_PRINCIPLED')
            source=bs.inputs['Base Color'].links[0].from_socket
            mix=nt.nodes.new('ShaderNodeMixRGB');mix.inputs[0].default_value=.45;mix.inputs[2].default_value=mean
            nt.links.new(source,mix.inputs[1]);nt.links.new(mix.outputs[0],bs.inputs['Base Color'])
    for side in [-1,1]:
        points=[]
        for j in range(25):
            t=j/24; recur=curvature*math.sin(t*math.pi)-brace*t**5
            points.append((recur,0,side*half*t))
        tube('Carved flexible limb',points,[thickness*(1-.65*j/24) for j in range(25)],m['wood'],12)
        if i>=2:
            tube('Metal limb binding',[(p[0],-thickness*(1-.65*j/24)*.85,p[2]) for j,p in enumerate(points) if 3<=j<17],.0055 if i>=3 else .0045,m['bronze'],6)
    grip(m,.19,.028)
    # String ends are attached to limb tips; string is offset from the hand at full brace.
    tip=-brace
    tube('Taut bowstring',[(tip,0,-half),(tip,0,half)],.0016,m['leather'],6)
    if i>=3:
        for side in [-1,1]:
            t=.13/half; x=curvature*math.sin(t*math.pi)-brace*t**5
            C.ico('Grip cabochon',r=.023 if i==4 else .018,subdiv=2,mat=m['gem'],loc=(x,-thickness*(1-.65*t)*.85,side*.13),scale=(.8,.4,1.3))
    # Bow fires toward -Y like the other assets; braced string sits behind the grip at +Y.
    for ob in bpy.context.scene.objects:
        if ob.type=='MESH':
            C.apply_transforms(ob)
            for v in ob.data.vertices:v.co.x,v.co.y=v.co.y,-v.co.x

def shield(i):
    m=mats(i)
    if i==1: outline=[(.34*math.cos(t),.34*math.sin(t)) for t in [j*math.tau/48 for j in range(48)]]
    elif i==2: outline=[(-.29,.38),(0,.43),(.29,.38),(.31,.12),(.20,-.25),(0,-.48),(-.20,-.25),(-.31,.12)]
    else: outline=[(-.34,.48),(-.12,.46),(0,.53),(.12,.46),(.34,.48),(.30,-.27),(0,-.57),(-.30,-.27)]
    # Front towards -Y; hand grip is at (0,0,0), rear shield face at y=-.065.
    n=len(outline); verts=[(x,-.07,z) for x,z in outline]+[(x,-.115,z) for x,z in outline]
    faces=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(j,(j+1)%n,(j+1)%n+n,j+n) for j in range(n)]
    body=mesh('Shield core',verts,faces,m['wood'] if i<3 else m['steel']); bevel(body,.007,2)
    border=[(x,-.115,z) for x,z in outline]+[(outline[0][0],-.115,outline[0][1])]
    tube('Rolled shield rim',border,.019,m['iron'] if i==1 else m['bronze'],8)
    C.sphere('Shield boss',r=.10,segments=20,rings=10,mat=m['iron'],loc=(0,-.117,0),scale=(1,.60,1))
    tube('Hand grip',[(0,-.074,-.11),(0,0,-.075),(0,0,.075),(0,-.074,.11)],.022,m['leather'],10)
    for j,(x,z) in enumerate(outline):
        if i==1 and j%4:continue
        C.sphere('Rim rivet',r=.009,segments=8,rings=4,mat=m['bronze'],loc=(x*.92,-.123,z*.92),scale=(1,.6,1))
    if i>=2:
        for side in [-1,1]:
            tube('Heraldic branch',[(0,-.12,-.27),(side*.085,-.12,-.08),(side*.15,-.12,.11),(side*.11,-.12,.30)],.008,m['bronze'],8)
            for z in [.08,.20]:tube('Heraldic leaf',[(side*.13,-.122,z),(side*.21,-.122,z+.065)],.006,m['bronze'],6)

def sheets(key,ob,geometry_only=False):
    # Hand attachments extend below z=0. The kit's ground plane would hide pommels/lower limbs.
    with gpu.lock_only(wait=120):
        with render.Stage(ground=False) as st:
            render.turntable(st,[ob],key,str(PRE),256)
            render.hero(st,[ob],key,str(PRE))
        if not geometry_only:
            with render.Stage(ground=False) as st:
                for kind in ('wire','normals','uv'):render.override_sheet(st,[ob],key,str(PRE),kind,256)

def lod_views(levels):
    for level in levels:
        C.reset();importlib.reload(gpu)
        bpy.ops.import_scene.gltf(filepath=level['path'])
        meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
        with gpu.lock_only(wait=120):
            with render.Stage(ground=False) as st:
                render.hero(st,meshes,Path(level['path']).stem,str(PRE),size=384)

def texture_fingerprints(path):
    raw=Path(path).read_bytes();length=struct.unpack_from('<I',raw,12)[0]
    doc=json.loads(raw[20:20+length]);blob=raw[28+length:];result=[]
    for im in doc.get('images',[]):
        view=doc['bufferViews'][im['bufferView']];start=view.get('byteOffset',0)
        result.append(hashlib.sha256(blob[start:start+view['byteLength']]).hexdigest())
    return sorted(result)

def build(key,args):
    C.reset(); importlib.reload(gpu)
    sys.path.insert(0,str(HERE))
    import lod_safe
    if args.views:
        bpy.ops.import_scene.gltf(filepath=str(OUT/f'{key}.glb'))
        objects=[o for o in bpy.context.scene.objects if o.type=='MESH']
        sheets(key,objects[0])
        rep=json.loads((PRE/f'{key}_qa.json').read_text());lod_views(rep['info']['lods'])
        print('ALL VIEWS COMPLETE',key,flush=True)
        return
    if args.lod_views:
        rep=json.loads((PRE/f'{key}_qa.json').read_text());lod_views(rep['info']['lods'])
        print('LOD VIEWS COMPLETE',key,flush=True)
        return
    if args.lod_only or args.finalize:
        bpy.ops.import_scene.gltf(filepath=str(OUT/f'{key}.glb'))
        objects=[o for o in bpy.context.scene.objects if o.type=='MESH']
        report_path=PRE/f'{key}_qa.json';rep=json.loads(report_path.read_text())
        if args.finalize:
            # glTF import has triangulated the geometry: explicit tangents can now be exported.
            before=texture_fingerprints(OUT/f'{key}.glb')
            info=export.export_glb(key,str(OUT),objects=objects,budget='prop',animations=False)
            rep['info']['glb_bytes']=info['bytes']
            rep['info']['finalization_images_unchanged']=before==texture_fingerprints(OUT/f'{key}.glb')
        levels=lod_safe.export_lods(key,objects,str(OUT))
        rep['info']['lods']=levels;qa.save(rep,str(PRE))
        if not args.no_sheets:lod_views(levels)
        print('SAFE LODS COMPLETE',key,flush=True)
        return
    family,i=key.removeprefix('eq_').rsplit('_',1); i=int(i)
    if family=='greatsword': sword(i,True)
    else: globals()[family](i)
    objects=[o for o in bpy.context.scene.objects if o.type=='MESH']
    for o in objects:C.apply_transforms(o)
    # Join BEFORE baking to avoid hundreds of individual bake invocations.
    ob=C.join(objects,key)
    count=export.triangles([ob])
    if count>5000:
        mod=ob.modifiers.new('Budget reduction','DECIMATE');mod.ratio=4900/count
        C.activate(ob);bpy.ops.object.modifier_apply(modifier=mod.name)
    if args.geometry_only:
        sheets(key,ob,True)
        return
    # The long bow's narrow curved inlay needs continuous charts instead of many projected slivers.
    uv_method='CHARTS' if key in ('eq_bow_2','eq_bow_4') else 'SMART'
    baked=bake.bake_asset([ob],key,size=1024,samples=8,ao_samples=64,ao_distance=.025,tex_dir=str(PRE/'tex'),ao_in_base=0,uv_method=uv_method)
    # Slender assembled props should not carry near-black ambient shadows into every lighting setup.
    # Keep contact AO subtle (35% strength), in the exported ORM itself, never in baseColor.
    for group in baked.values():
        im=group['images']['orm']; pixels=bake.img_to_np(im);pixels[...,0]=.65+.35*pixels[...,0]
        bake.np_to_img(im,pixels);im.pack()
        bake.save_image(im,str(PRE/'tex'/f'{im.name}.png'))
    C.activate(ob);tri=ob.modifiers.new('Explicit triangles for tangent export','TRIANGULATE')
    bpy.ops.object.modifier_apply(modifier=tri.name)
    info=export.export_glb(key,str(OUT),objects=[ob],budget='prop',animations=False)
    levels=lod_safe.export_lods(key,[ob],str(OUT))
    rep=qa.run(key,[ob],budget='prop',glb=info,grounded=False,centred=False)
    rep['info']['attachment']={'origin':[0,0,0],'long_axis':'Blender +Z / glTF +Y','front':'Blender -Y / glTF +Z'}
    rep['info']['lods']=levels;qa.save(rep,str(PRE))
    if not args.no_sheets:
        # Inspect the delivered GLB (including WebP compression), not just Blender's source images.
        C.reset();importlib.reload(gpu)
        bpy.ops.import_scene.gltf(filepath=info['path'])
        delivered=[o for o in bpy.context.scene.objects if o.type=='MESH']
        assert len(delivered)==1, 'Equipment must remain one exported mesh'
        sheets(key,delivered[0])
        lod_views(levels)
    print('EQUIPMENT COMPLETE',key,json.dumps(info),flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--only',nargs='+',choices=KEYS)
    parser.add_argument('--geometry-only',action='store_true')
    parser.add_argument('--no-sheets',action='store_true')
    parser.add_argument('--lod-only',action='store_true')
    parser.add_argument('--finalize',action='store_true')
    parser.add_argument('--lod-views',action='store_true')
    parser.add_argument('--views',action='store_true')
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    OUT.mkdir(parents=True,exist_ok=True);PRE.mkdir(parents=True,exist_ok=True)
    render.TMP=str(PRE/'tmp');Path(render.TMP).mkdir(exist_ok=True)
    for key in args.only or KEYS:build(key,args)
