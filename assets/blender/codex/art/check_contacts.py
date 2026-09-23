"""Verify actual castle contacts on the evaluated Geometry Nodes terrain."""
import sys,json,random
sys.dont_write_bytecode=True
from pathlib import Path
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
import bpy,numpy as np
import build as B
import cinematics as D
import terrain
B.C.reset();D.B=B;D.R=random.Random(20260923)
terrain.build_terrain(B,D.mesh,D.material);D.citadel()
bpy.context.view_layer.update()
ob=bpy.data.objects['ErodedCastleTerrain']
original=np.array([tuple(v.co) for v in ob.data.vertices])
evaluated=ob.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()
points=np.array([tuple(v.co) for v in evaluated.vertices])
assert len(points)==len(original)
assert np.isfinite(points).all()
lift=points[:,2]-original[:,2]
assert lift.min()>-1e-5, 'Contact node excavated existing terrain'
checks=[]
for label,x,y,minimum in [('left_tower',0,84,12.04),('front_platform',6,74.3,9.04),('right_tower',25,87,12.04)]:
 i=np.argmin((points[:,0]-x)**2+(points[:,1]-y)**2)
 assert points[i,2]>=minimum,(label,points[i].tolist(),minimum)
 checks.append({'support':label,'point':points[i].tolist(),'minimum_z':minimum})
i=np.argmin((points[:,0]-6)**2+(points[:,1]-82.9)**2)
assert lift[i]<.15, 'Portal filled by foundation contacts'
report={'finite':True,'vertices':len(points),'minimum_lift_m':float(lift.min()),'maximum_lift_m':float(lift.max()),'raised_vertices':int(np.count_nonzero(lift>1e-4)),'portal_lift_m':float(lift[i]),'contacts':checks}
(HERE/'contact-check.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print('CONTACT CHECK PASS',report,flush=True)
