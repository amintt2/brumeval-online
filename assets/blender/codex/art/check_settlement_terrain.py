import sys
sys.dont_write_bytecode=True
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import build as B
import cinematics as D
import terrain
B.C.reset();terrain.build_terrain(B,D.mesh,D.material)
import bpy
ob=bpy.data.objects['ErodedCastleTerrain']
for x,y in [(5,44),(-7,51),(5,38),(-7,45)]:
 v=min(ob.data.vertices,key=lambda v:(v.co.x-x)**2+(v.co.y-y)**2)
 assert abs(v.co.z+.065)<1e-5, (x,y,v.co.z)
 print('SETTLEMENT_HEIGHT_PASS',x,y,list(v.co),flush=True)
