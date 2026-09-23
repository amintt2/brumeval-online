"""CPU-only geometry audit of house entrances after parent transforms and bevels."""
import sys,json
sys.dont_write_bytecode=True
from pathlib import Path
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
import build as B
import cinematics as D
import bpy
from mathutils import Vector

def points(ob):
    ev=ob.evaluated_get(bpy.context.evaluated_depsgraph_get())
    return [ev.matrix_world@v.co for v in ev.data.vertices]

def extent(ob,frame=None):
    pts=points(ob)
    if frame:pts=[frame.matrix_world.inverted()@p for p in pts]
    return [[min(p[i] for p in pts),max(p[i] for p in pts)] for i in range(3)]

B.C.reset();D.B=B;D.houses();bpy.context.view_layer.update()
report={'scope':'Evaluated mesh vertices, including bevel and G.pose world transforms; no render or collision simulation','houses':[]}
failures=[]
for i in range(5):
    objs=[o for o in bpy.context.scene.objects if o.get('access_house')==i]
    landing=next(o for o in objs if o.get('kind')=='landing');pivot=landing.parent;s=pivot.scale.x
    steps=sorted([o for o in objs if o.get('kind')=='step'],key=lambda o:o['index'])
    door=next(o for o in pivot.children if o.name.startswith('Porte'))
    l=extent(landing);d=extent(door);ll=extent(landing,pivot);dl=extent(door,pivot)
    details=[];ok=True
    for j,step in enumerate(steps):
        b=extent(step);bl=extent(step,pivot)
        nxt=steps[j+1] if j+1<len(steps) else landing;nb=extent(nxt);nl=extent(nxt,pivot)
        gap=(nl[1][0]-bl[1][1])*s
        rise=nb[2][1]-b[2][1]
        good=b[2][0]<=-.05+1e-5 and gap<=.002 and -.002<=rise<=.171
        ok &= good
        details.append({'name':step.name,'world_z':b[2],'next_gap_m':gap,'next_rise_m':rise,'pass':good})
    dz=l[2][1]-d[2][0]
    overlap=(min(ll[1][1],dl[1][1])-max(ll[1][0],dl[1][0]))*s
    ok &= abs(dz)<.002 and overlap>=0
    first_rise=extent(steps[0])[2][1]-(-.05)
    ok &= 0<first_rise<=.171
    rec={'house':i,'parent_scale':s,'landing_world_z':l[2],'door_world_z':d[2],
         'landing_to_threshold_delta_m':dz,'landing_door_overlap_m':overlap,
         'first_rise_above_earth_m':first_rise,'step_count':len(steps),'steps':details,'pass':bool(ok)}
    report['houses'].append(rec)
    if not ok:failures.append(i)
report['pass']=not failures
report['limitations']=['Checks visual access solids only; houses are closed facade meshes, not traversable interiors.',
    'Terrain reference is Earth top z=-0.05; local gravel and vegetation are not clearance-tested.',
    'No handrails; headroom and gameplay collision meshes are outside this audit.']
(HERE/'check_access.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report,indent=2))
assert not failures, 'Failed houses: '+str(failures)
