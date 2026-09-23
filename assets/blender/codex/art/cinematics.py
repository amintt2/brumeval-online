"""Second-pass compositions. Metres, deterministic meshes, physical Cycles lighting."""
import math, random
import bpy
from mathutils import Vector, noise
import geo as G
import common as C
from kit import materials as M, gn
import grass_field
import terrain as landscape
import weathering
import foundation_contact

B=None
R=random.Random(20260923)

def mesh(name,vs,fs,mat,smooth=True):
    me=bpy.data.meshes.new(name);me.from_pydata(vs,[],fs);me.materials.append(mat)
    ob=bpy.data.objects.new(name,me);bpy.context.scene.collection.objects.link(ob)
    for p in me.polygons:p.use_smooth=smooth
    return ob

def material(name,factory,**kw):
    return bpy.data.materials.get(name) or getattr(M,factory)(name,**kw)

def ground(paving=False,settlement=False):
    def occupied(x,y):
        if not settlement:return False
        for hx,hy,sc,angle in [(-9,16,1.05,-14),(9,25,.83,18),(-12,32,.78,-7),(5,44,.73,28),(-7,51,.9,-20)]:
            a=math.radians(angle);dx=x-hx;dy=y-hy
            lx=(math.cos(a)*dx+math.sin(a)*dy)/sc;ly=(-math.sin(a)*dx+math.cos(a)*dy)/sc
            if (abs(lx)<2.85 and abs(ly)<3.45) or (abs(lx)<1.30/sc and -8<ly<-3):return True
        return False
    mud=material('ForestFloor','mud',color='#30352a',wet=.3)
    stone=material('RoadStone','cobblestone',color='#64675e',gap_color='#2d3026',stone=.23,scale=1,seed=12)
    # One continuous road surface: physically displaced, never scattered loose tiles.
    vs=[];fs=[];nx=45;ny=240
    for j in range(ny+1):
        y=-14+j*.4
        bend=1.5*math.sin(y*.045)
        for i in range(nx+1):
            x=(i/nx-.5)*7+bend
            z=-.005+.012*noise.noise_vector(Vector((x*5,y*5,0)))[0]-.075*(abs(i/nx-.5)*2)**8
            vs.append((x,y,z))
    for j in range(ny):
        for i in range(nx):
            a=j*(nx+1)+i;fs.append((a,a+1,a+nx+2,a+nx+1))
    mesh('CheminContinu',vs,fs,stone if paving else mud)
    G.box('Earth',(190,210,.5),mud,loc=(0,55,-.3))
    # Preserve the old scene RNG stream: vegetation changes must not move buildings.
    centers=[]
    for i in range(9000):
        x=R.uniform(-26,26);y=R.uniform(-8,75)
        if abs(x-1.5*math.sin(y*.045))<3.75 or occupied(x,y):continue
        if noise.noise_vector(Vector((x*.24,y*.24,0)))[0]<-.2:continue
        R.uniform(.08,.27);R.uniform(.16,.31);R.uniform(0,math.tau)
        centers.append((x,y))
    # New seed locations are uniform candidates; only the continuous field controls coverage.
    seeds=random.Random(84101)
    centers=[]
    for _ in range(7500):
        x=seeds.uniform(-26,26);y=seeds.uniform(-8,75)
        if abs(x-1.5*math.sin(y*.045))>3.65 and not occupied(x,y):centers.append((x,y))
    blades=random.Random(71023)
    palette=[material('GrassMeadow'+str(i),'flat',color=color,rough=.88)
             for i,color in enumerate(['#48563b','#606343','#77714c','#394b32'])]
    gv=[];gf=[];colors=[]
    def clear(x,y):
        return abs(x-1.5*math.sin(y*.045))>3.65 and not occupied(x,y)
    for cx,cy in centers:
        radius=blades.uniform(.45,.85)
        for j in range(168):
            angle=blades.uniform(0,math.tau);distance=radius*math.sqrt(blades.random())
            x=cx+math.cos(angle)*distance;y=cy+math.sin(angle)*distance
            density,height_scale=grass_field.field(x,y)
            if blades.random()>density*grass_field.path_fade(x,y):continue
            h=blades.uniform(.16,.47)*(1-.3*distance/radius)*height_scale
            width=blades.uniform(.018,.042);lean=blades.uniform(.08,.24)
            a=blades.uniform(0,math.tau);dx=math.cos(a);dy=math.sin(a)
            if not clear(x,y) or not clear(x+dx*lean,y+dy*lean):continue
            n=len(gv);color=blades.choices(range(4),[4,4,1,3])[0]
            for t,taper in [(0,.55),(.35,1),(.72,.55),(1,0)]:
                px=x+dx*lean*t*t;py=y+dy*lean*t*t
                for side in [-1,1]:
                    gv.append((px-dy*width*taper*side/2,py+dx*width*taper*side/2,-.055+h*t))
            for k in range(3):
                q=n+k*2;gf.append((q,q+1,q+3,q+2));colors.append(color)
    ob=mesh('HerbesBordure',gv,gf,palette[0],False)
    for mat in palette[1:]:ob.data.materials.append(mat)
    for face,color in zip(ob.data.polygons,colors):face.material_index=color
    ob['blade_count']=len(gv)//8
    ob['vegetation_version']='warped-noise-meadow-v2'
    gravel=material('Gravel','rock',color='#53574c',moss=.25,bump=.6)
    for i in range(100):
        x=R.uniform(-23,23);y=R.uniform(-6,70)
        if abs(x)<3.2 or occupied(x,y):continue
        B.rock((x,y,-.05),(R.uniform(.15,.7),R.uniform(.2,.9),R.uniform(.15,.5)),gravel)

def cloak_hero(pos,scale=1,heading=0):
    before=set(bpy.context.scene.objects)
    cloth=material('Voyageur','cloth',color='#22272b',kind='wool',dirt=.35,wear=.45,bump=.7)
    leather=material('VoyageurCuir','leather',color='#29241e')
    iron=material('VoyageurAcier','metal',kind='steel',rust=.12,grime=.25,wear=.5)
    vs=[];fs=[];rings=26;n=56
    for j in range(rings):
        t=j/(rings-1);z=.13+1.42*t
        width=.44-.20*t+.16*math.exp(-((t-.91)/.16)**2)
        for k in range(n):
            a=k*math.tau/n
            pleat=.032*math.sin(14*a+.6*t)*(1-t*.5)
            vs.append(((width+pleat)*math.cos(a),(.26+.09*(1-t)+pleat)*math.sin(a),z+.02*math.sin(a*7)*(1-t)))
    for j in range(rings-1):
        for k in range(n):a=j*n+k;b=j*n+(k+1)%n;fs.append((a,b,b+n,a+n))
    ob=mesh('CapePlis',vs,fs,cloth);so=ob.modifiers.new('Woven hem','SOLIDIFY');so.thickness=.012
    G.uvsphere('Capuche',.23,40,24,cloth,loc=(0,0,1.65),scale=(.85,1,1.25))
    for s in [-1,1]:
        G.uvsphere('Botte',.12,24,16,leather,loc=(s*.16,.05,.10),scale=(1,1.6,.8))
        G.tube('Bras',[(s*.33,0,1.36),(s*.43,.04,1.02),(s*.38,.15,.8)],[.10,.085,.06],18,cloth)
    # Scabbard and a narrow catching edge, almost black except in rim light.
    G.tube('Fourreau',[(-.23,-.26,.24),(.26,-.25,1.30)],[.045,.055],12,leather)
    G.rod('Lame',(.38,.17,.78),(.51,.26,.05),.022,4,iron,r1=.004)
    G.rod('Garde',(.28,.17,.78),(.48,.17,.78),.025,12,iron)
    objs=list(set(bpy.context.scene.objects)-before)
    G.pose(objs,turn=heading,loc=pos,scale=scale)

def torch(pos,power=240):
    iron=material('TorchIron','metal',kind='blackiron',rust=.4)
    ember=material('FlameAmber','emissive',color='#ffbf6b',strength=7)
    G.cyl('TorchStem',.055,1.8,16,iron,loc=(pos[0],pos[1],pos[2]+.9))
    G.uvsphere('Flamme',.065,20,12,ember,loc=(pos[0],pos[1],pos[2]+1.95),scale=(.7,.7,2))
    for dz in [1.76,2.14]: G.cyl('LanternCap',.15,.07,8,iron,loc=(pos[0],pos[1],pos[2]+dz))
    for j in range(4):
        a=j*math.tau/4
        G.cyl('LanternBar',.012,.37,8,iron,loc=(pos[0]+.13*math.cos(a),pos[1]+.13*math.sin(a),pos[2]+1.95))
    G.cyl('LanternRoof',.19,.17,8,iron,loc=(pos[0],pos[1],pos[2]+2.23),r2=.04)
    B.light('Torch', (pos[0],pos[1]-.1,pos[2]+2),power,(1,.37,.1),kind='POINT')

def tree(x,y,h=14,r=.5,dead=False,seed=1):
    bark=material('AncientBark','bark',color='#403d34',color2='#24251e',moss=.16,scale=2.5,bump=.65)
    if not bark.get('softened'):
        bs=bark.node_tree.nodes.get('Principled BSDF');socket=bs.inputs['Base Color']
        if socket.is_linked:
            old=socket.links[0].from_socket;bark.node_tree.links.remove(socket.links[0])
            mix=bark.node_tree.nodes.new('ShaderNodeMixRGB');mix.inputs[0].default_value=.50;mix.inputs[2].default_value=(.052,.050,.037,1)
            bark.node_tree.links.new(old,mix.inputs[1]);bark.node_tree.links.new(mix.outputs[0],socket)
        bark['softened']=True
    leaf=material('LeafCanopy','leaf_card',kind='oak',color='#303b23',color2='#58613b',seed=seed)
    rr=random.Random(seed)
    info=gn.branch_tree(seed=seed,height=h,radius=r,levels=3,children=(8,4,3),wobble=.23,gravity=.1,
                        root_flare=1.45,spread=(37,72),length_ratio=(.60,.53,.4),start=(.38,.97))
    for spline in info['splines']:
        pts=[(a+x,b+y,c) for a,b,c,_ in spline]
        G.tube('AncientBranch',pts,[p[3] for p in spline],12 if len(pts)>6 else 8,bark)
    for k in range(8):
        a=k*math.tau/8+rr.uniform(-.2,.2);length=r*rr.uniform(2.6,4.4)
        while abs(x+math.cos(a)*length-1.5*math.sin((y+math.sin(a)*length)*.045))<3.8 and length>.7:length*=.72
        pts=[(x+math.cos(a)*r*.3,y+math.sin(a)*r*.3,r*1.05),
             (x+math.cos(a)*length*.3,y+math.sin(a)*length*.3,.23),
             (x+math.cos(a+.08)*length*.6,y+math.sin(a+.08)*length*.6,.10),
             (x+math.cos(a+.18)*length*.85,y+math.sin(a+.18)*length*.85,-.01),
             (x+math.cos(a+.28)*length,y+math.sin(a+.28)*length,-.14)]
        G.tube('ContrefortRacine',pts,[r*.38,r*.25,r*.14,r*.055,.01],16,bark)
    if dead:return
    vs=[];fs=[]
    for tip,direction in info['tips']:
        for j in range(22):
            p=Vector(tip)+Vector((x+rr.gauss(0,.6),y+rr.gauss(0,.6),rr.gauss(0,.3)))
            a=rr.uniform(0,math.tau);size=rr.uniform(.18,.34)
            u=Vector((math.cos(a)*size,math.sin(a)*size,rr.uniform(-.14,.14)))
            v=Vector((-math.sin(a)*size*.45,math.cos(a)*size*.45,rr.uniform(.01,.12)))
            n=len(vs);vs += [tuple(p-u-v),tuple(p+u-v),tuple(p+u+v),tuple(p-u+v)];fs.append((n,n+1,n+2,n+3))
    ob=mesh('LeafCanopy',vs,fs,leaf,False);uv=ob.data.uv_layers.new()
    for f in ob.data.polygons:
        for i,v in zip(f.loop_indices,[(0,0),(1,0),(1,1),(0,1)]):uv.data[i].uv=v

def fern(x,y,scale=1):
    mat=material('Fern','cloth',color='#46523b',dirt=.2,bump=.2)
    vs=[];fs=[]
    for k in range(7):
        a=k*math.tau/7;d=Vector((math.cos(a),math.sin(a),0));side=Vector((-d.y,d.x,0));origin=Vector((x,y,.03))
        for j in range(1,15):
            t=j/15;p=origin+d*(t*.9*scale)+Vector((0,0,math.sin(t*math.pi)*.45*scale))
            for s in [-1,1]:
                width=math.sin(t*math.pi)*.21*scale
                tip=p+side*s*width+d*.07*scale;n=len(vs)
                vs.extend([tuple(p),tuple(tip-d*.035*scale),tuple(tip+d*.035*scale),tuple(p+d*.06*scale)])
                fs.append((n,n+1,n+2,n+3))
    mesh('Fougere',vs,fs,mat,False)

def mushrooms(x,y):
    ivory=material('FungusStem','bone',color='#afa183',dirt=.2,bump=.2)
    cap=material('FungusCap','leather',color='#765444',dirt=.15)
    for i in range(4):
        xx=x+R.uniform(-.3,.3);yy=y+R.uniform(-.2,.2);h=R.uniform(.12,.28)
        G.cyl('Stipe',.03,h,12,ivory,loc=(xx,yy,h/2))
        G.uvsphere('Cap',h*.55,24,12,cap,loc=(xx,yy,h),scale=(1,1,.4))

def arch(x,y,z=0,r=2,height=3,depth=.8):
    mat=material('CathedralStone','stone_blocks',color='#686b64',color2='#454a46',moss=.15,scale=.7)
    for s in [-1,1]:
        G.box('Jambage',(r*.3,depth,height),mat,loc=(x+s*r,y,z+height/2),bevel=.045)
        G.box('Chapiteau',(r*.43,depth*1.15,.22),mat,loc=(x+s*r,y,z+height),bevel=.035)
    # True radial voussoirs share their joint planes; no floating boxes on large spans.
    for i in range(20):
        a=i*math.pi/20;b=(i+1)*math.pi/20;vs=[]
        for yy in [y-depth/2,y+depth/2]:
            for radius,theta in [(r-.24,a),(r+.24,a),(r+.24,b),(r-.24,b)]:
                vs.append((x+radius*math.cos(theta),yy,z+height+radius*math.sin(theta)))
        ob=mesh('Voussoir',vs,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],mat,False)
        bevel=ob.modifiers.new('JointUsure','BEVEL');bevel.width=.008;bevel.segments=2


def chapel(x,y,z=0,scale=1,ruined=False):
    before=set(bpy.context.scene.objects)
    stone=material('AbbeyStone','stone_blocks',color='#626f75',color2='#3d494e',mortar_color='#414b4e',moss=.20,scale=1.5,dirt=.5)
    roof=material('AbbeySlate','slate',color='#343e43',moss=.15)
    if not ruined:G.box('Nef',(7,13,7),stone,loc=(0,3,3.5),bevel=.05)
    else:
        # Open-roof ruin with irregular wall breaks, not a solid closed box.
        for side in [-1,1]:
            pts=[(-6.5,0),(6.5,0)]+[(6.5-i,5.5+R.uniform(-.65,.9)) for i in range(14)]
            ob=G.extrude('MurRuine',pts,.65,stone,bevel=.045);ob.rotation_euler[2]=math.pi/2;ob.location=(side*3.5,3,0)
            G.box('FacadeRuine',(2.1,.7,6),stone,loc=(side*2.45,-3.5,3),bevel=.06)
        arch(0,-3.5,0,r=1.4,height=3.6,depth=.7)
        G.box('FondRuine',(7,.65,5.8),stone,loc=(0,9.5,2.9),bevel=.08)
        wood=material('RoofWreck','wood',color='#3a3229',dirt=.5)
        for beam_y in [-1,2,5,8]:
            for side in [-1,1]:G.tube('CharpenteBrisee',[(side*3.6,beam_y,5.7),(side*R.uniform(.4,1.3),beam_y+.1,R.uniform(7.2,8))],[.16,.06],8,wood)
        for i in range(30):B.rock((R.uniform(-4.4,4.4),R.uniform(-5,10),.12),(R.uniform(.2,.5),R.uniform(.2,.5),R.uniform(.2,.6)),stone)
    # Dark inset gothic window and several nested archivolts.
    dark=material('WindowDark','flat',color='#0c1518')
    if not ruined:
        G.extrude('Lancette',[(-.7,0),(.7,0),(.7,2.0),(0,2.8),(-.7,2.0)],.04,dark).location=(0,-3.55,2.7)
        arch(0,-3.7,0,r=1.2,height=2.8,depth=.3)
    else:B.light('MoonThroughRoof',(0,3,5),90,(.42,.58,.77),kind='POINT')
    for side in [-1,1]:
        for j in range(4):
            G.box('Contrefort',(.8,1.1,6.5),stone,loc=(side*3.7,-2+j*3.5,3.2),bevel=.06)
        if not ruined:
            o=G.box('ToitNef',(4.4,13.7,.25),roof,loc=(side*1.7,3,8),bevel=.04);o.rotation_euler[1]=side*math.radians(38)
    G.box('Beffroi',(2.8,2.8,12),stone,loc=(-1.6,6,6),bevel=.08)
    if not ruined:
        G.cyl('Fleche',2.2,7,8,roof,loc=(-1.6,6,15.3),r2=0)
    else:
        for j in range(7):
            G.box('Rupture',(.45,.5,R.uniform(.4,1.6)),stone,loc=(-2.7+j*.4,4.8,12),bevel=.03)
    objs=list(set(bpy.context.scene.objects)-before);G.pose(objs,loc=(x,y,z),scale=scale)

def citadel():
    before=set(bpy.context.scene.objects)
    stone=material('Fortress','stone_blocks',color='#737e85',color2='#4c5b65',mortar_color='#4d575d',moss=.10,scale=1.65,dirt=.3,wear=.65)
    roof=material('FortressSlate','slate',color='#293842',moss=.1)
    # Preserve the layout RNG while the old ring-shaped cliff is replaced.
    for _ in range(26):
        R.uniform(1.3,3);R.uniform(1.5,3.4);R.uniform(.8,2.8)
    # Split curtain wall leaves a real traversable portal, closed by an iron grille.
    G.box('CourtineGauche',(6.4,5,9),stone,loc=(1.2,85,16),bevel=.09)
    G.box('CourtineDroite',(18.4,5,9),stone,loc=(16.8,85,16),bevel=.09)
    G.box('DessusPorte',(3.2,5,3.3),stone,loc=(6,85,18.85),bevel=.07)
    arch(6,82.3,12,r=1.7,height=3.3,depth=.65)
    iron=material('GateIron','metal',kind='blackiron',rust=.38)
    weathering.apply_castle_weathering(stone,iron)
    for j in range(9):G.cyl('Herse',.035,4.7,10,iron,loc=(4.6+j*.35,82.9,14.4))
    for z in [12.8,14.2,15.6]:G.box('HerseTraverse',(3.2,.07,.06),iron,loc=(6,82.9,z))
    # A terraced stone approach gives the fortress a credible entrance and scale.
    path=[Vector((34,55,0)),Vector((38,70,4)),Vector((28,79,8)),Vector((6,79,12.2)),Vector((6,85,12.2))]
    for start,end in zip(path,path[1:]):
        length=(end-start).length;steps=max(3,int(length/.55))
        for j in range(steps):
            t=(j+.5)/steps;p=start.lerp(end,t);direction=end-start
            ob=G.box('RampeTaillee',(3.1,length/steps+.025,.3+max(0,p.z)),stone,loc=(p.x,p.y,(p.z-.3)/2),bevel=.025)
            ob.rotation_euler[2]=-math.atan2(direction.x,direction.y)
        d=(end-start).normalized();side=Vector((d.y,-d.x,0))*1.7
        for sign in [-1,1]:
            G.tube('GardeCorpsRampe',[tuple(start+side*sign+Vector((0,0,.5))),tuple(end+side*sign+Vector((0,0,.5)))],.13,8,stone)
    G.box('TerrasseChapelle',(7.2,10.5,3.2),stone,loc=(7,79,10.6),bevel=.08)
    for x in [3.8,10.2]:G.box('FondationChapelle',(1.1,3.8,8),stone,loc=(x,76,8),bevel=.07)
    for x,y,h,r in [(0,84,15,2.2),(12,91,24,4),(25,87,17,2.6),(18,97,29,2.2)]:
        G.cyl('Tour',r,h,40,stone,loc=(x,y,12+h/2))
        for floor in range(3):
            for j in range(7):
                a=math.pi+j*math.pi/6
                o=G.box('Meurtriere',(.21,.035,1.4),material('ArrowSlit','flat',color='#151d20'),loc=(x+(r+.015)*math.cos(a),y+(r+.015)*math.sin(a),15+floor*(h-4)/3),bevel=.025)
                o.rotation_euler[2]=a-math.pi/2
        for z in [13,12+h*.48,12+h-.2]:
            G.torus('Corniche',r+.05,.12,48,8,stone,loc=(x,y,z))
        for j in range(6):
            a=j*math.tau/6
            ob=G.box('ContrefortTour',(.65,.9,h*.5),stone,loc=(x+(r+.15)*math.cos(a),y+(r+.15)*math.sin(a),12+h*.25),bevel=.07)
            ob.rotation_euler[2]=a-math.pi/2
        if x in [12,18]:
            G.cyl('Fleche',r*1.28,9,12,roof,loc=(x,y,16.5+h),r2=0)
        for j in range(12):
            a=j*math.tau/12
            G.box('Creneau',(.7,.7,1.2),stone,loc=(x+r*math.cos(a),y+r*math.sin(a),12+h+.45),bevel=.05)
    for i in range(30):G.box('Merlon',(.65,.9,.95),stone,loc=(-1.5+i*.92,82.8,20.8),bevel=.04)
    chapel(4,91,13,.7)
    castle_banners(iron)
    bpy.context.view_layer.update()
    stats=foundation_contact.apply_foundation_contacts(bpy.data.objects['ErodedCastleTerrain'],set(bpy.context.scene.objects)-before)
    import json
    (B.HERE/'foundation-contact.json').write_text(json.dumps(stats,indent=2)+'\n',encoding='utf-8')

def castle_banners(iron):
    cloth=weathering.aged_banner_material('BannerOldCloth','#283f4b')
    for index,sx in enumerate([-.5,24.]):
        vs=[];fs=[];nx=36;ny=80
        for j in range(ny+1):
            v=j/ny
            for i in range(nx+1):
                u=i/nx
                fray=.065*math.sin(u*71+index)+.045*math.sin(u*127)
                vs.append((sx+(u-.5)*1.3+.06*math.sin(v*6)*v,
                           81.93-.13*math.sin(u*math.tau+v*3)*v-.10*v,
                           19.62-3.4*v+fray*v**12))
        for j in range(ny):
            for i in range(nx):
                u=(i+.5)/nx;v=(j+.5)/ny
                # Small physical tears concentrate near the exposed lower hem.
                if ((u-.23)/.065)**2+((v-.86)/.048)**2<1:continue
                if ((u-.81)/.045)**2+((v-.72)/.038)**2<1:continue
                if j>ny-4 and i in [2+index,14-index]:continue
                q=j*(nx+1)+i;fs.append((q,q+nx+1,q+nx+2,q+1))
        ob=mesh('BannierePatinee'+str(index),vs,fs,cloth,True)
        ob.modifiers.new('EpaisseurTissu','SOLIDIFY').thickness=.004
        for side in [-1,1]:
            G.rod('ConsoleBanniere',(sx+side*.72,82.65,19.68),(sx+side*.72,81.93,19.68),.045,12,iron)
            G.tube('AttacheBanniere',[(sx+side*.50,81.93,19.62),(sx+side*.50,81.93,19.72)],.022,10,iron)
        G.rod('TraverseBanniere',(sx-.76,81.93,19.68),(sx+.76,81.93,19.68),.04,12,iron)


def houses():
    # Each raised threshold has a solid staircase: no translated floating treads.
    for i,(x,y,s,angle) in enumerate([(-9,16,1.05,-14),(9,25,.83,18),(-12,32,.78,-7),(5,44,.73,28),(-7,51,.9,-20)]):
        before=set(bpy.context.scene.objects);B.house(0,0,1)
        for ob in list(set(bpy.context.scene.objects)-before):
            if ob.name.startswith('Marche'):bpy.data.objects.remove(ob,do_unlink=True)
        elevation=.65 if i==0 else 0
        st=material('TavernFoundation','stone_blocks',color='#59656a',color2='#3e494d',mortar_color='#40494b',moss=.22,scale=1.4)
        if i==0:
            G.box('LowerStorey',(5.3,6.2,.8),st,loc=(0,0,-.35),bevel=.05)
            G.box('AubergeSign',(1.05,.14,.7),material('SignWood','wood'),loc=(2.8,-3.5,2.6),bevel=.06)
        base=(-.065-elevation)/s;threshold=.55
        count=math.ceil((threshold-base)*s/.17)
        rise=(threshold-base)/count;run=.33/s
        landing=G.box('PalierMaison'+str(i),(1.9/s,.66/s,threshold-base),st,loc=(0,-3.1-.33/s,(threshold+base)/2),bevel=.016)
        landing['access_house']=i;landing['threshold_m']=threshold*s+elevation;landing['kind']='landing'
        for j in range(count):
            top=base+rise*(j+1);cy=-3.1-.66/s-(count-j-.5)*run
            step=G.box('EscalierMaison'+str(i),(1.9/s,run+.01,top-base),st,loc=(0,cy,(top+base)/2),bevel=.012)
            step['access_house']=i;step['kind']='step';step['rise_m']=rise*s;step['run_m']=run*s;step['index']=j
        objs=list(set(bpy.context.scene.objects)-before);G.pose(objs,turn=angle,loc=(x,y,elevation),scale=s)


def mist(density=.009,night=False):
    B.fog(density,(.40,.51,.61) if night else (.56,.61,.61))

def motes(center,count=90,radius=7,color='#cfb477'):
    mat=material('Dust'+color,'emissive',color=color,strength=.6)
    for i in range(count):
        p=(center[0]+R.uniform(-radius,radius),center[1]+R.uniform(-radius,radius),center[2]+R.uniform(-3,5))
        G.uvsphere('Poussiere',R.uniform(.005,.019),8,6,mat,loc=p)

def raven(x,y,z,scale=1):
    mat=material('Raven','flat',color='#10191c',rough=.9)
    G.uvsphere('Corbeau',.12,16,10,mat,loc=(x,y,z),scale=(.7,1.3,.7))
    for s in [-1,1]:
        mesh('Aile',[(x,y,z),(x+s*.28*scale,y+.12,z+.1*scale),(x+s*.54*scale,y+.25,z-.03),(x+s*.27*scale,y-.09,z-.08)],[(0,1,2,3)],mat,False)

def grave(x,y,angle=0):
    before=set(bpy.context.scene.objects)
    kind=R.randrange(4);stone=material('OldGraves','rock',color='#616c68',color2='#414a49',moss=.35,scale=2,dirt=.5)
    dark=material('GraveCuts','flat',color='#252d2b')
    if kind==0:B.grave(0,0)
    elif kind==1:
        G.extrude('SteleOgivale',[(-.43,0),(.43,0),(.43,1.20),(.25,1.52),(0,1.68),(-.25,1.52),(-.43,1.2)],.25,stone,bevel=.07,bevel_segs=3)
        G.torus('MedallionFuneraire',.16,.015,32,8,dark,loc=(0,-.143,1.08),rot=(90,0,0))
        G.box('SocleTombe',(1.02,.6,.23),stone,loc=(0,0,.065),bevel=.06)
        G.box('DalleBrisee',(.9,1.8,.1),stone,loc=(0,-.7,.025),bevel=.045)
    elif kind==2:
        outline=[(-.15,0),(.15,0),(.15,.86),(.53,.86),(.53,1.10),(.15,1.10),(.15,1.64),(-.15,1.64),(-.15,1.10),(-.53,1.10),(-.53,.86),(-.15,.86)]
        G.extrude('CroixAncienne',outline,.26,stone,bevel=.065,bevel_segs=3)
        G.box('SocleCroix',(.82,.68,.32),stone,loc=(0,0,.1),bevel=.07)
    else:
        G.box('TombeBasse',(1.1,2.1,.48),stone,loc=(0,-.5,.17),bevel=.11)
        for side in [-1,1]:
            ob=G.box('CouvercleFendu',(.6,2.2,.14),stone,loc=(side*.31,-.5,.48),bevel=.04);ob.rotation_euler[1]=side*.045
    objs=list(set(bpy.context.scene.objects)-before)
    G.pose(objs,turn=angle,tilt=R.uniform(-5,5) if kind!=3 else 0,loc=(x,y,-.07),scale=R.uniform(.85,1.25))


def village(banner=False):
    ground(True,settlement=True);B.sunset();bpy.context.scene.world.node_tree.nodes['Background'].inputs[1].default_value=.06
    B.light('SoleilRasant',(-40,0,38),3.6,(1,.83,.61),target=(12,87,16),kind='SUN')
    B.light('CielBleu',(2,-7,15),1600,(.40,.60,1),size=22,target=(0,20,0))
    B.light('RemplissageFroid',(45,-30,35),.65,(.47,.66,1),target=(12,87,16),kind='SUN')
    landscape.build_terrain(B,mesh,material)
    houses();citadel();tree(-14,3,17,.65,seed=24);tree(15,34,15,.5,seed=88)
    cloak_hero((-4,-.5,-.055),1.05);torch((-5,2,0),220)
    for x,y in [(-6,3),(-8,7),(7,15),(6,7)]:fern(x,y,1.6)
    for _ in range(9):R.uniform(0,20);R.uniform(20,42) # retain unrelated scene randomness
    mist(.0012);motes((-3,3,2),40,4)
    # A narrow physical sun shaft crosses the road behind the traveller.
    lamp=B.light('RayonDore',(-9,15,18),32000,(1,.72,.40),target=(4,26,0),kind='SPOT')
    lamp.data.spot_size=.34;lamp.data.spot_blend=.3;lamp.data.shadow_soft_size=.4
    if banner:
        B.camera((-14,-17,3.7),(8,40,12),30)
    else:B.camera((-6,-10,1.6),(4,35,7.6),32)

def cemetery():
    ground();B.world((.18,.29,.46),.22)
    B.light('Moon',(-15,30,28),4.5,(.45,.64,1),target=(0,3,0),kind='SUN')
    B.light('MoonFill',(-8,-8,7),1100,(.40,.58,.85),size=14,target=(0,12,0))
    for i in range(35):
        x=R.uniform(-14,14);y=R.uniform(-1,37)
        if abs(x)>3:grave(x,y,R.uniform(-20,20))
    arch(0,20,r=3.2,height=4.2);chapel(1,47,0,.85,ruined=True)
    tree(-9,5,13,.5,True,43);tree(11,19,16,.65,True,33);tree(-16,30,17,.55,True,56)
    for x,y in [(-3.8,1),(4,10),(-4,18)]:torch((x,y,0),120)
    for i in range(7):raven(R.uniform(-6,5),R.uniform(13,27),R.uniform(5.7,8.5),R.uniform(.45,.8))
    mist(.0018,True);B.camera((-2,-9,1.6),(0,25,3.8),32)

def lair():
    # Keep the approved direction of the first composition, replacing empty foreground with scale cues.
    ground(True);B.world((.12,.20,.27),.22)
    rockmat=material('CaveRock','rock',color='#424d4d',scale=.7,moss=.16)
    for s in [-1,1]:
        for j in range(7):B.rock((s*11,6+j*7,8),(4,5,R.uniform(8,13)),rockmat)
    B.golem();arch(0,28,r=6,height=6)
    stone=material('BrokenPillar','stone_blocks',color='#676d64',moss=.2)
    for x,y,h in [(-5,7,3.8),(6,16,5),(-6,23,6),(7,28,3)]:
        ob=G.cyl('ColonneBrisee',.6,h,32,stone,loc=(x,y,h/2))
        for v in ob.data.vertices:
            if v.co.z>h*.45:v.co.z+=R.uniform(-.35,.30)
        for k in range(12):
            a=k*math.tau/12
            G.cyl('Cannelure',.065,h*.84,10,stone,loc=(x+.57*math.cos(a),y+.57*math.sin(a),h*.45))
        G.cyl('Base',.85,.35,24,stone,loc=(x,y,.18))
        for k in range(7):B.rock((x+R.uniform(-1,1),y+R.uniform(-1,1),.1),(.3,.3,.2),stone)
    cloak_hero((-1.5,2,0),.95)
    B.light('GolemRim',(3,21,16),5200,(.5,.80,1),size=3,target=(0,14,4))
    B.light('AmberRim',(-5,6,9),650,(1,.59,.30),size=5,target=(0,14,4))
    B.light('CoreHalo',(0,12,4.5),160,(.32,.86,1),kind='POINT')
    motes((0,12,4),130,7,color='#acc9c7');mist(.003)
    B.camera((4,-12,1.6),(0,15,4.0),32)

def forest():
    ground();B.world((.31,.43,.49),.40)
    for i in range(24):
        s=-1 if i%2 else 1;x=s*R.uniform(4.7,23);y=R.uniform(0,70)
        tree(x,y,R.uniform(11,21),R.uniform(.28,.8),seed=100+i)
    tree(-5,-1,20,.95,seed=8);tree(7,4,17,.7,seed=91)
    for i in range(85):
        x=R.uniform(-12,12);y=R.uniform(-2,38)
        if abs(x)>3:fern(x,y,R.uniform(.6,1.7))
    for x,y in [(-4,1),(5,4),(-5,11)]:mushrooms(x,y)
    stone=material('WaypointStone','rock',color='#495a55',color2='#2d3838',moss=.2,scale=1.8)
    stele=G.extrude('SteleAncienne',[(-.7,0),(.68,0),(.91,2.75),(.23,4.0),(-.55,3.45)],.9,stone,bevel=.1,bevel_segs=3)
    stele.location=(0,31,0)
    rune=material('WaypointGlyph','emissive',color='#b5c8ac',strength=1.7)
    for z in [.8,1.65,2.5]:
        for pts in [[(0,30.535,z-.20),(0,30.535,z+.26)],[(-.18,30.535,z+.04),(0,30.535,z+.19),(.18,30.535,z+.04)],[(-.12,30.535,z-.16),(0,30.535,z-.04),(.12,30.535,z-.16)]]:
            G.tube('GlypheGrave',pts,.017,8,rune)
    B.light('WaypointLight',(0,30,2),60,(.65,.78,.57),kind='POINT')
    # Distant undulating terrain and a dense second line prevent an infinite flat horizon.
    earth=material('DistantMoss','rock',color='#344039',color2='#242f2b',moss=.6,scale=.8)
    bark=bpy.data.materials['AncientBark']
    for i in range(7):B.rock((-55+i*18,105+R.uniform(-8,15),0),(18,28,R.uniform(4,8)),earth)
    for i in range(55):
        x=R.uniform(-52,52);y=R.uniform(73,130);h=R.uniform(13,23);r=R.uniform(.18,.45)
        G.tube('TroncLointain',[(x,y,0),(x+.5,y,h*.5),(x+R.uniform(-2,2),y,h)],[r,r*.62,.02],10,bark)
        for side in [-1,1]:G.tube('BrancheLointaine',[(x,y,h*.5),(x+side*2,y+.8,h*.75),(x+side*3.5,y+1,h*.93)],[r*.35,r*.15,.005],8,bark)
    B.light('SoleilCanopy',(-18,-5,30),1.0,(.77,.87,.72),target=(0,25,0),kind='SUN')
    for x,y in [(7,15),(-4,30)]:
        lamp=B.light('CanopyBeam',(x,y,19),24000,(.8,.91,.82),target=(x-8,y-6,0),kind='SPOT')
        lamp.data.spot_size=.30;lamp.data.spot_blend=.90
    B.light('ForestFill',(0,-6,8),1500,(.45,.65,.66),size=12,target=(0,18,3))
    mist(.003);motes((1,13,3),100,8,color='#b7d4c4')
    B.camera((-1,-9,1.6),(0,28,3.4),31)

def build(key,base):
    global B,R
    B=base;R=random.Random(20260923)
    {'bg_login':village,'bg_loading_1':cemetery,'bg_loading_2':lair,'bg_loading_3':forest,'launcher_banner':lambda:village(True)}[key]()
