"""Second-pass physical props and restrained spell illustrations; no external assets."""
import math, random
import bpy
from mathutils import Vector
import geo as G
import common as C
import items, abilities
from kit import materials as M

PALETTES={'warrior':'#bd8654','mage':'#aab8dc','ranger':'#a7b18a','heal':'#d2b77c'}

def mat(name,factory,**kw):return bpy.data.materials.get(name) or getattr(M,factory)(name,**kw)
def glass(name='OldGlass'):
    m=bpy.data.materials.new(name);bs=m.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value=(.80,.85,.80,1)
    bs.inputs['Roughness'].default_value=.075;bs.inputs['Transmission Weight'].default_value=1
    bs.inputs['IOR'].default_value=1.46;m['kit']='physical_glass'
    return m

def flask(key):
    colors={'potion_hp_s':'#59252a','potion_hp_m':'#63292d','potion_hp_l':'#702d32','potion_mp_s':'#354d64','potion_stamina':'#586447'}
    gm=glass();liquid=mat('Infusion','flat',color=colors[key],rough=.16)
    bs=liquid.node_tree.nodes.get('Principled BSDF');bs.inputs['Transmission Weight'].default_value=.5;bs.inputs['IOR'].default_value=1.33
    before=set(bpy.context.scene.objects)
    outer=[(0,.015),(.22,.015),(.31,.06),(.37,.17),(.38,.32),(.34,.48),(.20,.58),(.105,.64),(.105,.79),(.14,.80),(.14,.84),(.085,.84),(.08,.64),(.18,.56),(.31,.46),(.35,.31),(.34,.18),(.285,.08),(.20,.045),(0,.045)]
    G.lathe('ThickBlownGlass',outer,96,gm)
    G.lathe('LiquidMeniscus',[(0,.052),(.19,.052),(.275,.09),(.326,.18),(.338,.30),(.31,.44),(.20,.445),(0,.445)],96,liquid)
    cork=mat('AgedCork','wood',color='#66513b',color2='#3c3124',scale=4,dirt=.2)
    G.cyl('Cork',.087,.14,40,cork,loc=(0,0,.858),smooth=True,r2=.098)
    bronze=mat('OldBronze','engraved_metal',kind='bronze',rust=.22,grime=.22,wear=.35)
    G.torus('NeckWire',.112,.014,64,10,bronze,loc=(0,0,.71))
    if key in ['potion_hp_m','potion_hp_l']:
        for z in [.09,.14]:G.torus('BaseBinding',.335 if z>.1 else .30,.013,64,10,bronze,loc=(0,0,z))
    scale={'potion_hp_s':(1,1,1),'potion_hp_m':(.9,.9,1.22),'potion_hp_l':(1.07,1.07,1.36),'potion_mp_s':(.82,.82,1.28),'potion_stamina':(.9,.9,1.1)}[key]
    for ob in set(bpy.context.scene.objects)-before:
        ob.scale=tuple(ob.scale[i]*scale[i] for i in range(3));ob.location=tuple(ob.location[i]*scale[i] for i in range(3))
    return dict(yaw=20,pitch=10,fill=.84)

def gel():
    gm=glass('JarGlass')
    G.lathe('ApothecaryJar',[(0,0),(.28,0),(.33,.06),(.33,.48),(.28,.55),(.27,.63),(.30,.65),(.30,.69),(.245,.69),(.245,.57),(.30,.47),(.30,.07),(.26,.035),(0,.035)],96,gm)
    goo=mat('CloudedGel','flat',color='#717251',rough=.28)
    bs=goo.node_tree.nodes.get('Principled BSDF');bs.inputs['Subsurface Weight'].default_value=.23;bs.inputs['Transmission Weight'].default_value=.18
    nt=goo.node_tree;n=nt.nodes.new('ShaderNodeTexNoise');n.inputs['Scale'].default_value=16;n.inputs['Detail'].default_value=4
    ramp=nt.nodes.new('ShaderNodeValToRGB');ramp.color_ramp.elements[0].color=(*C.hex_color('#333c2d'),1);ramp.color_ramp.elements[1].color=(*C.hex_color('#8a8760'),1)
    nt.links.new(n.outputs['Fac'],ramp.inputs[0]);nt.links.new(ramp.outputs[0],bs.inputs['Base Color'])
    G.lathe('Gel',[(0,.04),(.27,.04),(.29,.08),(.29,.40),(.26,.44),(0,.44)],80,goo)
    cork=mat('JarCork','wood',color='#63513c',scale=4,dirt=.3)
    G.cyl('SealedCork',.248,.12,64,cork,loc=(0,0,.685),smooth=True)
    wax=mat('SealWax','flat',color='#514b38',rough=.6)
    G.torus('WaxSeal',.278,.025,64,10,wax,loc=(0,0,.64))
    return dict(yaw=24,pitch=17,fill=.82)

def pelt():
    rnd=random.Random(81)
    hide=mat('WolfHide','leather',color='#53483c',dirt=.35)
    fur=mat('WolfFur','fur',color='#655f55',tip='#b4ab97',root='#292a26',direction='Y',scale=1.8,bump=.6)
    vs=[];fs=[];nx=44;ny=55
    for j in range(ny+1):
        v=j/ny
        for i in range(nx+1):
            u=i/nx
            edge=.72+.24*math.sin(v*math.pi)+.07*math.sin(v*21)+.035*math.sin(v*63)
            x=(u-.5)*1.35*edge
            y=(v-.5)*1.55
            y+=.055*math.sin(u*17)+.025*math.sin(u*43)
            z=.13+.12*math.sin(v*math.pi)+.25*math.exp(-((u-.28)/.16)**2)+.30*math.exp(-((u-.79)/.17)**2)
            z+=.035*math.sin(v*11+u*5)
            vs.append((x,y,z))
    for j in range(ny):
        for i in range(nx):a=j*(nx+1)+i;fs.append((a,a+1,a+nx+2,a+nx+1))
    me=bpy.data.meshes.new('FoldedHide');me.from_pydata(vs,[],fs);me.materials.append(fur);ob=bpy.data.objects.new('FoldedHide',me);bpy.context.scene.collection.objects.link(ob)
    for f in me.polygons:f.use_smooth=True
    so=ob.modifiers.new('HideThickness','SOLIDIFY');so.thickness=.035
    # Thousands of short tapered locks catch the light, following the surface rather than a flat cutout.
    specs=[]
    for i in range(4200):
        p=Vector(vs[rnd.randrange(len(vs))]);p+=Vector((rnd.uniform(-.012,.012),rnd.uniform(-.012,.012),.012))
        direction=(.5*math.sin(p.y*8)+rnd.uniform(-.5,.5),-.5+rnd.uniform(-.4,.35),rnd.uniform(.3,.8))
        specs.append((tuple(p),direction,rnd.uniform(.004,.007),rnd.uniform(.035,.085)))
    G.locks('FurLocks',specs,fur,flat=.3,smooth=True)
    for s in [-1,1]:
        G.tube('FoldedLeg',[(s*.45,-.42,.18),(s*.58,-.68,.16),(s*.40,-.82,.20)],[.14,.10,.07],24,fur)
    G.pose(list(bpy.context.scene.objects),turn=-23)
    return dict(yaw=14,pitch=42,fill=.86)

def spark_material(name,color,strength=3):
    m=M.emissive(name,color=color,strength=strength);m['second_pass_emission']=True;return m

def sparks(center,color,count=35,spread=.5,seed=9):
    rnd=random.Random(seed);m=spark_material('DustSpell'+color,color,1.4)
    for i in range(count):
        p=Vector(center)+Vector((rnd.gauss(0,spread),rnd.uniform(-.15,.2),rnd.gauss(0,spread)))
        G.uvsphere('SpellDust',rnd.uniform(.003,.012),8,6,m,loc=p)

def threads(points,color,width=.01,n=7):
    rnd=random.Random(22);m=spark_material('Trail'+color,color,2.4)
    for k in range(n):
        jitter=Vector((rnd.uniform(-.035,.035),rnd.uniform(-.04,.04),rnd.uniform(-.035,.035)))
        pts=[tuple(Vector(p)+jitter*math.sin(math.pi*i/(len(points)-1))) for i,p in enumerate(points)]
        radii=[width*math.sin(math.pi*i/(len(points)-1))+.0007 for i in range(len(points))]
        G.tube('Filament',pts,radii,6,m)

def hands():
    skin=mat('Hands','skin',color='#96765c',dirt=.25,bump=.6)
    cloth=mat('Sleeve','cloth',color='#444950',dirt=.35)
    for s in [-1,1]:
        before=set(bpy.context.scene.objects)
        G.tube('Wrist',[(s*.46,0,-.57),(s*.35,-.02,-.33),(s*.28,-.07,-.16)],[.12,.105,.10],28,skin)
        G.uvsphere('Palm',.18,40,24,skin,loc=(s*.24,-.06,-.12),scale=(.8,.47,1.12))
        for j in range(4):
            x=s*(.15+j*.058);z=-.09+(3-j)*.012
            length=[.21,.255,.245,.19][j]
            pts=[];radii=[]
            for k in range(13):
                t=k/12
                pts.append((x+s*(.018*math.sin(t*math.pi)-.055*t*t),-.045+.082*math.sin(t*math.pi*.8),z+length*t))
                radii.append(.032*(1-.50*t)+.003*math.sin(t*math.pi*2)**2)
            G.tube('Finger',pts,radii,16,skin)
        G.tube('Thumb',[(s*.13,-.12,-.20),(s*.04,-.15,-.07),(s*.09,-.13,.025)],[.048,.04,.016],20,skin)
        # Fuse overlapping anatomy: no wrist seams, floating fingers or ball joints.
        parts=list(set(bpy.context.scene.objects)-before)
        bpy.ops.object.select_all(action='DESELECT')
        for ob in parts:ob.select_set(True)
        bpy.context.view_layer.objects.active=parts[0];bpy.ops.object.join()
        ob=bpy.context.object;ob.name='CuppedHand'
        bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
        remesh=ob.modifiers.new('ContinuousAnatomy','REMESH');remesh.mode='VOXEL';remesh.voxel_size=.009
        bpy.ops.object.modifier_apply(modifier=remesh.name)
        smooth=ob.modifiers.new('SoftenSkin','SMOOTH');smooth.factor=.8;smooth.iterations=4
        bpy.ops.object.modifier_apply(modifier=smooth.name)
        for face in ob.data.polygons:face.use_smooth=True
        G.cyl('Sleeve',.15,.24,32,cloth,loc=(s*.46,.015,-.54),rot=(0,-s*25,0),smooth=True)

def spell(key):
    ember=PALETTES['warrior'];blue=PALETTES['mage'];green=PALETTES['ranger']
    if key in ['ab_strike','ab_heavy_blow']:
        if key=='ab_strike':
            parts=abilities.mini_sword('Blade',1.3,.115,steel_hex='#969fa5');G.pose(parts,turn=10,roll=38)
        else:
            abilities.ab_heavy_blow()
            for o in list(bpy.context.scene.objects):
                if any(t in o.name for t in ['Burst','Swing']):bpy.data.objects.remove(o,do_unlink=True)
        arc=G.arc_points(.95,160,15,45,centre=(.15,-.13,-.05))
        threads(arc,ember,.006,9);sparks((.45,-.15,.15),ember,22,.20)
    elif key=='ab_whirlwind':
        parts=abilities.mini_sword('Blade',1.2,.105,steel_hex='#9aa3a8');G.pose(parts,roll=34)
        for j in range(3):threads(G.arc_points(.55+j*.12,30+j*70,220+j*40,36,centre=(0,.05,0)),ember,.005,3)
    elif key=='ab_war_cry':
        abilities.ab_war_cry()
        for o in list(bpy.context.scene.objects):
            if 'Wave' in o.name:bpy.data.objects.remove(o,do_unlink=True)
        for j in range(3):threads(G.arc_points(.33+j*.12,-30,85,27,centre=(.14,.03,.38)),ember,.004,2)
        sparks((.35,.05,.52),ember,45,.26)
    elif key=='ab_heal':
        hands();gold=PALETTES['heal']
        for r in [.20,.26]:threads(G.arc_points(r,0,355,80,centre=(0,.03,.37)),gold,.004,2)
        G.uvsphere('Grace',.043,32,20,spark_material('GraceLight',gold,7),loc=(0,-.01,.34))
        for j in range(4):
            pts=[(.1*math.sin(t*.18+j),.08,.12+t*.02) for t in range(36)]
            threads(pts,gold,.0025,1)
        sparks((0,0,.35),gold,22,.23)
    elif key=='ab_frost_nova':
        ice=mat('GlintstoneIce','crystal',color='#7588a1',glow=.10,emit_strength=.8)
        rock=mat('FrostEarth','rock',color='#3e474b',moss=0)
        G.uvsphere('Ground',.62,48,20,rock,loc=(0,.12,-.46),scale=(1,.5,.16))
        for i in range(11):
            a=i*2.4;x=.47*math.cos(a);y=.18*math.sin(a);h=.30+.48*(1-abs(x))
            ob=G.lathe('IceShard',[(0,0),(.09,.05),(.065,h*.78),(0,h)],6,ice,smooth=False)
            ob.location=(x,y,-.43);ob.rotation_euler[1]=x*.85
        threads(G.arc_points(.52,0,355,60,centre=(0,-.12,-.35)),blue,.004,3)
        sparks((0,0,.10),blue,30,.4)
    elif key in ['ab_firebolt','ab_fireball']:
        # One luminous glintstone focus with a wispy curved wake, no flat cartoon sun.
        crystal=mat('FocusCrystal','crystal',color='#7a7e9c',glow=.75,emit_strength=3.2)
        if key=='ab_firebolt':
            o=G.lathe('GlintDart',[(0,-.38),(.10,-.08),(.065,.38),(0,.60)],7,crystal,smooth=False);o.rotation_euler[1]=math.radians(42)
        else:
            G.ico('ArcaneFocus',.095,4,spark_material('ArcaneHeart','#889bcf',2.8),smooth=True)
        rnd=random.Random(134)
        for j in range(5):
            phase=rnd.uniform(0,math.tau);pts=[];radii=[];length=rnd.uniform(.55,.92)
            for i in range(49):
                t=i/48;r=.075+.17*math.sin(t*math.pi)
                twist=phase+t*(4.4+j*.62)
                pts.append((math.cos(twist)*r-length*t,.11*math.sin(twist),math.sin(twist)*r-length*t+.06*math.sin(t*11+phase)))
                radii.append(.001+.011*(1-t)**1.3*(.7+.3*math.sin(t*18+phase)**2))
            G.tube('ArcaneWisp',pts,radii,10,spark_material('ArcaneWisp'+str(j),['#667bad','#9aaccd','#65638e'][j%3],1.3))
        sparks((-.16,0,-.16),blue,45,.28)
    else:
        n={'ab_shot':1,'ab_piercing_shot':1,'ab_arrow_rain':5,'ab_rapid_fire':3}[key]
        for i in range(n):
            parts=abilities.arrow('Arrow'+str(i),1.4,fletch_hex='#5a6650')
            roll=40 if n==1 else 20+i*15
            G.pose(parts,roll=roll,loc=((i-(n-1)/2)*.16,.03*i,-.06*i),scale=.85 if n>2 else 1)
        pts=[(-.7+t*.9,-.12,-.7+t*.9+.06*math.sin(t*7)) for t in [i/35 for i in range(36)]]
        threads(pts,green,.004,5)
        if key=='ab_piercing_shot':sparks((.25,0,.25),green,38,.15)
        if key=='ab_arrow_rain':threads(G.arc_points(.50,190,350,40,centre=(0,.10,-.6)),green,.004,2)
    return dict(yaw=0,pitch=5,fill=.83)

def build(key):
    if key.startswith('potion_'):return flask(key)
    if key=='slime_gel':return gel()
    if key=='wolf_pelt':return pelt()
    if key.startswith('ab_'):return spell(key)
    return None

def mute_materials():
    for m in bpy.data.materials:
        if not m.node_tree or m.get('second_pass_emission'):continue
        bs=next((n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None)
        if bs is None:continue
        if bs.inputs['Transmission Weight'].default_value>.4:continue
        for name in ['Base Color','Emission Color']:
            socket=bs.inputs[name]
            if socket.is_linked:
                link=socket.links[0];source=link.from_socket;m.node_tree.links.remove(link)
                hue=m.node_tree.nodes.new('ShaderNodeHueSaturation');hue.inputs['Saturation'].default_value=.56
                m.node_tree.links.new(source,hue.inputs['Color']);m.node_tree.links.new(hue.outputs[0],socket)
            else:
                c=socket.default_value;grey=.2126*c[0]+.7152*c[1]+.0722*c[2]
                socket.default_value=tuple(grey*.44+c[i]*.56 for i in range(3))+(1,)
        if not m.get('kit'):
            bs.inputs['Emission Strength'].default_value=min(bs.inputs['Emission Strength'].default_value,.3)
