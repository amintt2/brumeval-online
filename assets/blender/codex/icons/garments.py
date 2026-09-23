"""Folded cloth and individually interleaved mail rings for the icon second pass."""
import math
import bpy
from mathutils import Vector
import geo as G
from kit import materials as M


def mesh(name, verts, faces, material):
    me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.materials.append(material)
    ob=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(ob)
    for face in me.polygons:face.use_smooth=True
    return ob


def surface(name, sample, material, rows=52, cols=96):
    verts=[tuple(sample(i/rows,j*math.tau/cols)) for i in range(rows+1) for j in range(cols)]
    faces=[]
    for i in range(rows):
        for j in range(cols):
            a=i*cols+j;b=i*cols+(j+1)%cols
            faces.append((a,b,b+cols,a+cols))
    ob=mesh(name,verts,faces,material)
    mod=ob.modifiers.new('Tissu epais','SOLIDIFY');mod.thickness=.012
    return ob


def torso(t,a,robe=False):
    # A continuous shoulder profile, a cinched waist and gravity-aligned folds.
    keys=([(0,.47,.27),(.36,.34,.22),(.55,.255,.175),(.78,.32,.20),(.89,.35,.205),(1,.125,.11)]
          if robe else [(0,.35,.215),(.25,.32,.20),(.66,.345,.215),(.87,.35,.21),(1,.125,.11)])
    for i in range(len(keys)-1):
        lo,hi=keys[i:i+2]
        if lo[0]<=t<=hi[0]:
            f=(t-lo[0])/(hi[0]-lo[0]);f=f*f*(3-2*f)
            rx=lo[1]+(hi[1]-lo[1])*f;ry=lo[2]+(hi[2]-lo[2])*f;break
    fold=(.025 if robe else .014)*(1-.65*t)*(math.sin(a*13+.25*math.sin(t*5))+.35*math.sin(a*23+t))
    return Vector(((rx+fold)*math.cos(a),(ry+fold)*math.sin(a),t*(1.36 if robe else 1.03)+.009*math.sin(a*9)*(1-t)**5))


def sleeve(t,a,side,robe=False):
    # Bent hanging arm with a soft elbow: neither a straight cylinder nor cone.
    ztop=1.16 if robe else .88
    center=Vector((side*(.30+.38*t),.035*math.sin(t*math.pi),ztop-.49*t-.06*math.sin(t*math.pi)))
    tangent=Vector((side*.38,.035*math.pi*math.cos(t*math.pi),-.49-.06*math.pi*math.cos(t*math.pi))).normalized()
    u=Vector((0,-1,0));v=tangent.cross(u).normalized()
    rad=(.135-.035*math.sin(t*math.pi)+(.035 if robe else -.015)*t)
    rad+=.012*math.sin(a*9+t*4)+.009*math.sin(t*21)*(math.sin(a)**2)
    return center+rad*(u*math.cos(a)+v*math.sin(a))


def rings(name,sample,material,rows,cols):
    verts=[];faces=[]
    for row in range(rows):
        t=(row+.5)/rows
        for col in range(cols):
            a=(col+.5*(row%2))*math.tau/cols
            p=sample(t,a);u=(sample(t,a+.001)-p).normalized()
            v=(sample(min(.9999,t+.001),a)-p).normalized();normal=u.cross(v).normalized()
            # Alternating tilted links overlap neighbours, giving real relief and self-shadow.
            v=(v+normal*(.38 if row%2 else -.38)).normalized()
            n=u.cross(v).normalized();p+=n*.012
            start=len(verts);major=.019;wire=.0045
            for j in range(12):
                q=j*math.tau/12;radial=u*math.cos(q)+v*math.sin(q)
                for k in range(5):
                    b=k*math.tau/5
                    verts.append(tuple(p+radial*(major+wire*math.cos(b))+n*(wire*math.sin(b))))
            for j in range(12):
                for k in range(5):
                    faces.append((start+j*5+k,start+((j+1)%12)*5+k,start+((j+1)%12)*5+(k+1)%5,start+j*5+(k+1)%5))
    return mesh(name,verts,faces,material)


def build(key):
    if key not in ('mage_robe','chainmail'):return None
    before=set(bpy.context.scene.objects);robe=key=='mage_robe'
    cloth=M.cloth('Cloth_AgedIndigo' if robe else 'Cloth_MailBacking',color='#333c50' if robe else '#272a2a',dirt=.38,wear=.3,scale=5)
    sample=lambda t,a:torso(t,a,robe)
    surface('ContinuousFoldedRobe' if robe else 'SoftMailBacking',sample,cloth)
    steel=None
    if not robe:
        steel=M.metal('Mail_PatinatedSteel',kind='steel',color='#636968',rust=.15,grime=.25,wear=.42,scratches=.5)
        rings('InterleavedTorsoMail',sample,steel,39,62)
    for side in (-1,1):
        arm=lambda t,a,s=side:sleeve(t,a,s,robe)
        surface('SoftBentSleeve',arm,cloth,32,64)
        if not robe:rings('InterleavedSleeveMail',arm,steel,21,25)
        else:
            border=M.cloth('Cloth_Cuff'+str(side),color='#655e4d',dirt=.4,scale=5)
            G.tube('WornCuff',[tuple(arm(.99,j*math.tau/96)) for j in range(97)],.009,6,border)
    leather=M.leather('WeatheredGarmentBelt',color='#41382e',wear=.6,dirt=.4)
    belt_t=.55 if robe else .27
    G.tube('PlainBelt',[tuple(sample(belt_t,j*math.tau/128)+Vector((0,0,.012))) for j in range(129)],.022,8,leather,flat_ratio=.4)
    if robe:
        # Rolled fabric collar and asymmetrical hanging sash, with no stars or luminous gems.
        G.tube('FoldedCollar',[tuple(sample(.995,j*math.tau/96)) for j in range(97)],.025,10,cloth)
        G.tube('HangingSash',[(-.08,-.202,.76),(-.10,-.228,.59),(-.075,-.26,.39),(-.10,-.27,.25)],[.032,.031,.03,.035],8,leather,flat_ratio=.22)
    G.pose(list(set(bpy.context.scene.objects)-before),turn=18)
    return dict(yaw=0,pitch=9,fill=.87)
