"""Targeted third pass: 40 px silhouettes, ruby liquids, fire and distinct attacks."""
import math, random
import bpy
from mathutils import Vector
import geo as G
import common as C
import abilities
import second_pass as S
from kit import materials as M

KEYS = ['potion_hp_s','potion_hp_m','potion_hp_l','potion_mp_s','potion_stamina',
        'ab_firebolt','ab_fireball','ab_shot','ab_piercing_shot','ab_rapid_fire','ab_arrow_rain','ab_heavy_blow']

def light_mat(name, color, strength=1):
    return S.spark_material(name,color,strength)

def potion(key):
    small=key in ('potion_hp_s','potion_mp_s')
    large=key=='potion_hp_l'
    gm=S.glass('ClearBlownGlass');bs=gm.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value=(.97,.98,1,1);bs.inputs['Roughness'].default_value=.035
    color='#990d29' if key.startswith('potion_hp') else '#1143ad' if key=='potion_mp_s' else '#668b20'
    liquid=M.flat('LuminousInfusion',color=color,rough=.13)
    bs=liquid.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Transmission Weight'].default_value=.58;bs.inputs['IOR'].default_value=1.33
    bs.inputs['Emission Color'].default_value=(*C.hex_color(color),1)
    bs.inputs['Emission Strength'].default_value=.65;liquid['second_pass_emission']=True
    if small:
        outer=[(0,.02),(.20,.02),(.31,.09),(.38,.23),(.39,.36),(.33,.52),(.12,.63),(.105,.73),(.14,.735),(.14,.78),(.083,.78),(.080,.635),(.30,.505),(.36,.35),(.35,.235),(.28,.105),(.18,.05),(0,.05)]
        contents=[(0,.054),(.18,.054),(.275,.11),(.343,.24),(.354,.35),(.32,.46),(0,.46)]
        neck=.67;top=.80;depth=1
    elif large:
        # A broad, flattened pilgrim flask, not a stretched copy of the small vial.
        outer=[(0,.02),(.31,.02),(.40,.07),(.43,.21),(.43,.54),(.36,.70),(.16,.79),(.115,.84),(.115,.97),(.155,.975),(.155,1.025),(.09,1.025),(.09,.855),(.14,.81),(.33,.72),(.405,.55),(.405,.22),(.375,.095),(.29,.05),(0,.05)]
        contents=[(0,.055),(.285,.055),(.367,.10),(.397,.24),(.397,.54),(.355,.64),(0,.64)]
        neck=.89;top=1.035;depth=.56
    else:
        outer=[(0,.02),(.21,.02),(.30,.08),(.34,.22),(.31,.43),(.24,.61),(.12,.72),(.105,.84),(.14,.845),(.14,.895),(.08,.895),(.08,.73),(.215,.615),(.285,.43),(.31,.22),(.275,.10),(.19,.05),(0,.05)]
        contents=[(0,.055),(.19,.055),(.265,.11),(.303,.225),(.28,.43),(.24,.54),(0,.54)]
        neck=.78;top=.90;depth=.86
    shell=G.lathe('BlownGlassSilhouette',outer,112,gm);shell.scale.y=depth
    fluid=G.lathe('BrightLiquidWithMeniscus',contents,112,liquid);fluid.scale.y=depth
    cork=M.wood('OldCork',color='#80684b',color2='#51422f',scale=4,dirt=.18)
    cap=G.cyl('Cork',.09,.125,48,cork,loc=(0,0,top+.015),smooth=True,r2=.103);cap.scale.y=depth
    bronze=M.engraved_metal('FlaskNeckBronze',kind='bronze',rust=.12,grime=.15,wear=.4)
    ring=G.torus('ThinNeckBinding',.117,.009,64,10,bronze,loc=(0,0,neck));ring.scale.y=depth
    if large:
        for s in [-1,1]:
            G.torus('FlaskShoulderEye',.057,.013,40,10,bronze,loc=(s*.345,0,.73),rot=(90,0,0))
        # Two small lower clamps add material, keeping the central liquid readable.
        for s in [-1,1]:G.box('FlaskClamp',(.07,.035,.20),bronze,loc=(s*.31,-.20,.18),bevel=.015)
    return dict(yaw=12 if large else 17,pitch=7,fill=.85,potion_lighting=True)

def fire(key):
    orange=light_mat('HotOrange','#f46a16',1.1)
    ember=light_mat('DeepEmber','#a72b07',.85)
    gold=light_mat('YellowFireCore','#ffa439',1.15)
    rnd=random.Random(611)
    if key=='ab_fireball':
        firemat=M.flat('TurbulentFireSurface',color='#c74409',rough=.7)
        nt=firemat.node_tree;bs=nt.nodes.get('Principled BSDF')
        tex=nt.nodes.new('ShaderNodeTexNoise');tex.inputs['Scale'].default_value=5;tex.inputs['Detail'].default_value=4;tex.inputs['Roughness'].default_value=.7
        ramp=nt.nodes.new('ShaderNodeValToRGB')
        ramp.color_ramp.elements[0].position=.22;ramp.color_ramp.elements[0].color=(*C.hex_color('#8a1704'),1)
        ramp.color_ramp.elements[1].position=.76;ramp.color_ramp.elements[1].color=(*C.hex_color('#ffb53c'),1)
        ramp.color_ramp.elements.new(.52).color=(*C.hex_color('#dc4b08'),1)
        nt.links.new(tex.outputs['Fac'],ramp.inputs['Fac']);nt.links.new(ramp.outputs['Color'],bs.inputs['Base Color']);nt.links.new(ramp.outputs['Color'],bs.inputs['Emission Color'])
        bs.inputs['Emission Strength'].default_value=1.4;firemat['second_pass_emission']=True
        G.ico('FlamingSphere',.35,5,firemat,jitter=.035,seed=61,smooth=True)
        G.ico('GoldenCore',.105,4,gold,loc=(-.085,-.29,.06),jitter=.018,seed=32,smooth=True)
        for j in range(14):
            a=j*math.tau/14;r=rnd.uniform(.27,.35);x=r*math.cos(a);z=r*math.sin(a)
            pts=[(x*(1+t*.55)+.07*math.sin(t*8+a),rnd.uniform(-.10,.04),z*(1+t*.4)+t*.33) for t in [k/18 for k in range(19)]]
            G.tube('LickingFlame',pts,[.040*(1-k/18)**1.1+.001 for k in range(19)],8,orange if j%3 else ember)
        S.sparks((0,0,.08),'#e97c28',18,.30,seed=64)
    else:
        before=set(bpy.context.scene.objects)
        G.lathe('FireDart',[(0,-.54),(.055,-.30),(.115,.02),(.095,.27),(.048,.53),(0,.77)],24,orange)
        G.lathe('DartHeart',[(0,-.30),(.040,-.11),(.056,.23),(0,.67)],24,gold).location.y=-.065
        for j in range(5):
            a=j*math.tau/5
            pts=[(.06*math.cos(a)+.055*math.sin(t*7+a),.045*math.sin(a),.2-t*1.05) for t in [k/30 for k in range(31)]]
            G.tube('FireWake',pts,[.028*(1-k/30)+.001 for k in range(31)],8,ember if j%2 else orange)
        G.pose(list(set(bpy.context.scene.objects)-before),roll=40)
    return dict(yaw=0,pitch=0,fill=.85)

def arrow_between(name,start,end,scale=1):
    start=Vector(start);end=Vector(end);length=(end-start).length
    parts=abilities.arrow(name,length=length/scale,fletch_hex='#627352',scale=scale)
    pivot=G.pose(parts,loc=tuple(start));pivot.rotation_mode='QUATERNION'
    pivot.rotation_quaternion=(end-start).to_track_quat('Z','Y')
    return parts

def arrows(key):
    green='#a3b47d'
    if key=='ab_shot':
        arrow_between('SingleArrow',(-.44,0,-.57),(.48,0,.61),1.05)
    elif key=='ab_piercing_shot':
        iron=M.metal('PuncturedPlate',kind='steel',rust=.23,grime=.24,wear=.6,bump=.5)
        # Four solid torn plate quarters leave an actual opening for the shaft.
        for side in [-1,1]:
            outline=[(.085,-.08),(.11,.075),(.055,.13),(.065,.36),(.43,.36),(.46,-.34),(.12,-.34)]
            ob=G.extrude('BrokenPlate',[(x*side,z) for x,z in outline],.075,iron,bevel=.012)
            ob.location=(.04,.025,.06)
        arrow_between('PenetratingArrow',(-.52,-.33,-.62),(.62,.34,.72),.90)
        shardmat=M.metal('FreshFracture',kind='silver',rust=.07,wear=.5)
        for i,(x,z) in enumerate([(-.19,.18),(.19,.23),(.22,-.13),(-.18,-.21)]):
            shard=G.ico('FlyingPlateShard',.055,1,shardmat,loc=(x,-.16,z),scale=(1,.25,1.7))
            shard.rotation_euler[2]=math.radians(i*22)
        S.sparks((.04,-.17,.06),'#d8b777',15,.13,seed=7)
    elif key=='ab_rapid_fire':
        # Three clean arrows, separated tips and fletching; narrow fan, parallel wake.
        for j in range(3):
            x=(j-1)*.28
            arrow_between('RapidArrow'+str(j),(x-.32,0,-.48),(x+.29+(j-1)*.065,0,.60),.68)
            S.threads([(x-.54,-.045,-.82),(x-.43,-.045,-.65),(x-.32,-.045,-.48)],green,.009,2)
    else:
        # Top-down oblique rain: arrows converge onto a physically horizontal impact ring.
        earth=M.rock('ArrowImpactGround',color='#303930',moss=.20,bump=.5)
        G.uvsphere('ImpactGround',.52,48,24,earth,loc=(0,0,-.42),scale=(1,.80,.08))
        ringmat=light_mat('RangerTarget',green,1.0)
        G.torus('ImpactCircle',.40,.014,80,8,ringmat,loc=(0,0,-.365))
        for j,(x,y) in enumerate([(-.28,-.12),(.24,-.08),(.02,.26),(-.20,.20),(.20,.22)]):
            arrow_between('FallingArrow'+str(j),(x-.12,y+.10,.61+(j%2)*.10),(x,y,-.35),.57)
        return dict(yaw=12,pitch=42,fill=.84)
    return dict(yaw=0,pitch=5,fill=.85)

def heavy():
    abilities.ab_heavy_blow()
    for ob in list(bpy.context.scene.objects):
        if any(t in ob.name for t in ('Burst','Swing')):bpy.data.objects.remove(ob,do_unlink=True)
    ember='#c89461'
    S.threads(G.arc_points(.98,162,17,48,centre=(.15,.09,-.15)),ember,.028,8)
    # Ground-plane shockwave sits at the head's strike, clearly distinct from sword slash.
    for r,w in [(.23,.024),(.39,.016),(.56,.008)]:
        pts=[(.42+r*math.cos(a),-.19+.12*math.sin(a),-.23+.22*r*math.sin(a)) for a in [j*math.tau/64 for j in range(65)]]
        G.tube('ImpactShockwave',pts,w,8,light_mat('ImpactRing'+str(r),ember,1.6))
    S.sparks((.45,-.15,-.15),'#d9a571',28,.19,seed=36)
    return dict(yaw=0,pitch=5,fill=.84)

def build(key):
    if key not in KEYS:return None
    if key.startswith('potion_'):return potion(key)
    if key in ('ab_firebolt','ab_fireball'):return fire(key)
    if key=='ab_heavy_blow':return heavy()
    return arrows(key)
