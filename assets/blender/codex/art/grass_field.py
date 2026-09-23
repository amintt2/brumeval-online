"""Continuous deterministic vegetation fields in world metres, for CX-1 stills."""
import math
from mathutils import Vector, noise

def smooth(lo,hi,value):
    t=max(0.,min(1.,(value-lo)/(hi-lo)))
    return t*t*(3-2*t)

def field(x,y):
    # Domain warping breaks round, evenly sized noise islands.
    warp=noise.noise_vector(Vector((x*.065+19,y*.065-7,3.7)))
    wx=x+warp.x*3.2;wy=y+warp.y*3.2
    broad=noise.noise_vector(Vector((wx*.12+31,wy*.12,8.2))).x
    detail=noise.noise_vector(Vector((wx*.43,wy*.43+17,2.4))).y
    raw=.5+.58*broad+.22*detail
    density=.08+.92*smooth(.25,.72,raw)
    height=.68+.48*smooth(.22,.78,raw)
    return density,height

def path_fade(x,y):
    distance=abs(x-1.5*math.sin(y*.045))-3.65
    border=noise.noise_vector(Vector((x*.38,y*.38,14))).z
    return smooth(0,.75+.55*(border+.5),distance)
