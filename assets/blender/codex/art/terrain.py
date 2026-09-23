"""Original deterministic heightfields: warped ridges, water/sediment transport and talus relaxation.

No imported terrain asset. NumPy operations keep the process reproducible inside Blender.
Call build_terrain(B, mesh, material) once from village(), replacing the old cliff and mountains.
"""
import math
import numpy as np
import bpy
from mathutils import noise as blender_noise


def smooth(a):
    a=np.clip(a,0,1)
    return a*a*(3-2*a)


def noise2(x,y,seed):
    """Smooth value noise on an independently seeded integer lattice."""
    xi=np.floor(x).astype(np.int64);yi=np.floor(y).astype(np.int64)
    fx=smooth(x-xi);fy=smooth(y-yi)
    def corner(dx,dy):
        n=(xi+dx)*374761393+(yi+dy)*668265263+seed*1442695041
        n=np.bitwise_xor(n,n>>13)*1274126177
        return (np.bitwise_and(np.bitwise_xor(n,n>>16),0xffffff)/8388607.5)-1
    return ((1-fx)*corner(0,0)+fx*corner(1,0))*(1-fy)+((1-fx)*corner(0,1)+fx*corner(1,1))*fy


def fractal(x,y,seed,octaves=5,ridged=False):
    out=np.zeros_like(x);amp=1.;total=0.
    for k in range(octaves):
        n=noise2(x,y,seed+k*107)
        if ridged:n=(1-np.abs(n))**2
        out+=n*amp;total+=amp;x=x*2.03+11.7;y=y*2.03-8.2;amp*=.48
    return out/total


def ridged(x,y,seed):
    """Gradient-noise ridged multifractal with feedback gain, not absolute lattice values."""
    ox=(seed%101)*1.713;oy=(seed%79)*2.193
    values=np.fromiter((blender_noise.ridged_multi_fractal((float(a)+ox,float(b)+oy,.731),1.,2.03,6.,1.,2.,noise_basis='PERLIN_ORIGINAL')
                        for a,b in zip(x.ravel(),y.ravel())),dtype=np.float64,count=x.size)
    return np.clip(values.reshape(x.shape)*.52,0,1.15)


def neighbour(a,axis,direction):
    # Replicated boundaries prevent opposite sides of the heightfield exchanging water.
    pad=[(0,0),(0,0)];pad[axis]=(1,1);b=np.pad(a,pad,mode='edge')
    if axis==0:return b[0:-2,:] if direction<0 else b[2:,:]
    return b[:,0:-2] if direction<0 else b[:,2:]


def erode(height,spacing,seed,iterations=55):
    """Rainfall, downhill water flux, entrained sediment, deposition and thermal talus.

    Sediment travels with outgoing water; capacity falls as flow slows, depositing at feet.
    This is a bounded artistic erosion simulation, not a geotechnical model.
    """
    h=height.copy();water=np.zeros_like(h);sed=np.zeros_like(h)
    rng=np.random.default_rng(seed);rain=.009*(.8+rng.random(h.shape)*.4)
    dirs=[(0,-1),(0,1),(1,-1),(1,1)]
    for _ in range(iterations):
        water+=rain
        level=h+water
        drops=[np.maximum(0,level-neighbour(level,*d)) for d in dirs]
        total=sum(drops)+1e-9
        outgoing=np.minimum(water*.6,total*.16)
        flux=[outgoing*d/total for d in drops]
        velocity=outgoing/(water+1e-9)
        slope=np.maximum.reduce(drops)/spacing
        capacity=np.maximum(.0003,velocity*slope*water*18)
        deposit=np.maximum(0,sed-capacity)*.25
        dissolve=np.minimum(np.maximum(0,capacity-sed)*.15,.035)
        h+=deposit-dissolve;sed+=dissolve-deposit
        concentration=sed/(water+1e-9)
        sediment_flux=[f*concentration for f in flux]
        water-=sum(flux);sed-=sum(sediment_flux)
        for d,f,sf in zip(dirs,flux,sediment_flux):
            inv=(d[0],-d[1]);water+=neighbour(f,*inv);sed+=neighbour(sf,*inv)
        water*=.975
        # Gravity transfers excess above a 48 degree repose angle, rather than global blur.
        if _%4==0:
            moves=[np.maximum(0,h-neighbour(h,*d)-spacing*1.11)*.08 for d in dirs]
            h-=sum(moves)
            for d,m in zip(dirs,moves):h+=neighbour(m,d[0],-d[1])
    h+=sed
    return h


def corridor(x,y):
    pts=[(34,55,0),(38,70,4),(28,79,8),(6,79,12.2),(6,85,12.2)]
    best=np.full(x.shape,1e9);level=np.zeros_like(x)
    for a,b in zip(pts,pts[1:]):
        dx=b[0]-a[0];dy=b[1]-a[1]
        t=np.clip(((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy),0,1)
        d=np.sqrt((x-a[0]-t*dx)**2+(y-a[1]-t*dy)**2)
        take=d<best;level=np.where(take,a[2]+t*(b[2]-a[2])-.14,level);best=np.minimum(best,d)
    return best,level


def make_mesh(name,x,y,h,mesh,material,mountain=False):
    rows,cols=h.shape
    verts=np.column_stack((x.ravel(),y.ravel(),h.ravel())).tolist()
    idx=np.arange((rows-1)*(cols-1)).reshape(rows-1,cols-1)
    starts=(np.arange(rows-1)[:,None]*cols+np.arange(cols-1)[None,:]).ravel()
    faces=np.column_stack((starts,starts+1,starts+cols+1,starts+cols)).tolist()
    mat=material(name+'Rock','rock',color='#647079' if mountain else '#626c70',color2='#394650',moss=.08,scale=1.3,strata=.12,bump=.75)
    ob=mesh(name,verts,faces,mat,True)
    gy,gx=np.gradient(h,float(y[1,0]-y[0,0]),float(x[0,1]-x[0,0]))
    steep=smooth((np.sqrt(gx*gx+gy*gy)-.35)/.85)
    high=smooth((h-35)/40) if mountain else smooth((h-3)/12)
    # Flat deposited soil is muted green-brown; exposed slopes are cold mineral rock.
    soil=np.array([.033,.041,.030]);rock=np.array([.069,.085,.094]);summit=np.array([.095,.116,.126])
    col=soil[None,None,:]*(1-steep[:,:,None])+rock[None,None,:]*steep[:,:,None]
    col=col*(1-high[:,:,None]*.25)+summit[None,None,:]*high[:,:,None]*.25
    variation=1+noise2(x*.18,y*.18,775)*.10
    colors=np.concatenate((col*variation[:,:,None],np.ones((*h.shape,1))),axis=2).astype(np.float32)
    attr=ob.data.color_attributes.new(name='TerrainSlopeAltitude',type='FLOAT_COLOR',domain='POINT')
    attr.data.foreach_set('color',colors.ravel())
    nt=mat.node_tree;bs=next(n for n in nt.nodes if n.type=='BSDF_PRINCIPLED')
    original=bs.inputs['Base Color'].links[0].from_socket if bs.inputs['Base Color'].links else None
    vc=nt.nodes.new('ShaderNodeVertexColor');vc.layer_name=attr.name
    # Keep the kit's mineral noise, weathering and strata; slope colour modulates rather than replaces it.
    if original:
        original_boost=nt.nodes.new('ShaderNodeMixRGB');original_boost.blend_type='MULTIPLY';original_boost.inputs[0].default_value=1
        original_boost.inputs[2].default_value=(3,3,3,1);nt.links.new(original,original_boost.inputs[1])
        mix=nt.nodes.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=.72
        nt.links.new(vc.outputs['Color'],mix.inputs[1]);nt.links.new(original_boost.outputs[0],mix.inputs[2])
        nt.links.new(mix.outputs[0],bs.inputs['Base Color'])
    else:nt.links.new(vc.outputs['Color'],bs.inputs['Base Color'])
    ob['generation']='domain-warp/ridged multifractal + hydraulic sediment transport + talus'
    ob['height_min']=float(h.min());ob['height_max']=float(h.max())
    return {'name':name,'vertices':len(verts),'quads':len(faces),'bounds':[[float(x.min()),float(x.max())],[float(y.min()),float(y.max())],[float(h.min()),float(h.max())]]}


def build_terrain(B,mesh,material):
    # Fine escarpment: 0.35m cells, enough to avoid a polygonal silhouette at hero distance.
    xx=np.linspace(-62,79,404);yy=np.linspace(37,151,327);x,y=np.meshgrid(xx,yy)
    wx=x+8*fractal(x*.026,y*.026,1901,3);wy=y+6*fractal(x*.031,y*.031,3203,3)
    ridges=ridged(wx*.067,wy*.067,8131)
    broad=fractal(wx*.021,wy*.021,1309,4)
    # A natural ridge exists before construction; only the occupied foundation is levelled.
    envelope=np.exp(-((wx-11)/34)**2-((wy-95)/25)**2)
    spur=np.exp(-((wx-31)/19)**2-((wy-111)/33)**2)
    h=-.09+envelope*(10+9*ridges)+spur*2.5
    h=erode(h,float(xx[1]-xx[0]),9907,65)
    # Broken rock ledges, not sinusoidal rings around a plinth.
    rough=ridged(wx*.30,wy*.30,9281)-.5
    h+=smooth((h-1)/5)*(rough*1.6+fractal(wx*.8,wy*.8,371,4)*.42)
    # Slanted bedding follows the original slope; unequal shelves weather differently.
    bedding=h+.13*x-.08*y+fractal(wx*.17,wy*.17,301,3)*.55
    ledges=(bedding/1.6-np.floor(bedding/1.6)-.5)*.32
    h+=smooth((h-2)/4)*ledges
    dx=np.maximum(np.maximum(-3.5-x,x-28.5),0)
    dy=np.maximum(np.maximum(82-y,y-100.5),0)
    pad=1-smooth(np.hypot(dx,dy)/2.8)
    h=h*(1-pad)+11.96*pad
    # Keep the settled village and all five house access footprints at the original grade.
    approach=smooth((y-55)/12)
    h=h*approach-.065*(1-approach)
    d,roadheight=corridor(x,y);blend=1-smooth((d-1.9)/2.4)
    # Ramp support must not bury the rising roadway under the plateau.
    h=h*(1-blend)+roadheight*blend
    # The inner castle area is protected except the outside approach at y<81.
    structural=(x>=-4)&(x<=29)&(y>=82)&(y<=100)
    h=np.where(structural,11.96,h)
    assert np.isfinite(h).all(), 'Non-finite castle height'
    foundation_error=float(np.max(np.abs(h[structural]-11.96)))
    assert foundation_error<1e-6, 'Foundation support moved'
    stats=[make_mesh('ErodedCastleTerrain',x,y,h,mesh,material)]
    # Talus fragments sit on the terrain, concentrated near the foot of the rock face.
    import random
    import geo as G
    rng=random.Random(22041)
    scree_mat=material('TerrainTalus','rock',color='#394344',color2='#242d2c',moss=.18,scale=2,bump=.8)
    prototype=G.ico('TalusPrototype',1,2,scree_mat,jitter=.16,seed=981)
    prototype.hide_render=True
    for i in range(460):
        ix=rng.randrange(1,len(xx)-1);iy=rng.randrange(1,len(yy)-1)
        if not .4<h[iy,ix]<9 or d[iy,ix]<4:continue
        slope=abs(h[iy,ix+1]-h[iy,ix-1])+abs(h[iy+1,ix]-h[iy-1,ix])
        if slope<.12:continue
        ob=bpy.data.objects.new('Eboulis',prototype.data);bpy.context.scene.collection.objects.link(ob)
        size=rng.uniform(.22,.75)
        ob.location=(float(x[iy,ix]),float(y[iy,ix]),float(h[iy,ix])-.10*size)
        ob.scale=(size*rng.uniform(.8,1.6),size,size*rng.uniform(.45,.85))
        ob.rotation_euler=(rng.uniform(-.4,.4),rng.uniform(-.4,.4),rng.uniform(0,6.28))
    bpy.data.objects.remove(prototype,do_unlink=True)

    xx=np.linspace(-200,200,501);yy=np.linspace(132,330,249);x,y=np.meshgrid(xx,yy)
    wx=x+24*fractal(x*.009,y*.009,6311,4)+5*fractal(x*.045,y*.045,4621,3)
    wy=y+21*fractal(x*.011,y*.011,7813,4)+6*fractal(x*.039,y*.039,4673,3)
    ridge=ridged(wx*.020,wy*.020,4253)
    large=fractal(wx*.007,wy*.007,2791,4)
    # Two oblique chains separated by a winding valley; no repeated isolated ellipsoids.
    crest1=189+20*np.sin(x*.015)+9*fractal(x*.016,y*.002,991,3)
    crest2=278+27*np.sin(x*.009+2)
    chains=np.maximum(np.exp(-((wy-crest1)/43)**2),.8*np.exp(-((wy-crest2)/48)**2))
    # Along-chain amplitude changes make deep saddles between peaks, avoiding a uniform wall.
    mass=smooth((noise2(wx*.014,wy*.005,2017)+.72)/1.35)
    h=chains*(9+79*mass**1.4)*(.36+ridge*1.05)
    h+=chains*large*8
    drainage=np.exp(-np.abs(noise2(wx*.052,wy*.033,9637))*17)
    branches=np.exp(-np.abs(noise2(wx*.12+noise2(wx*.04,wy*.04,63),wy*.10,721))*23)
    h-=chains*(drainage*4.5+branches*1.25)*smooth(h/12)
    edge=smooth((y-132)/17)*smooth((330-y)/16)*smooth((200-np.abs(x))/24)
    h=h*edge-.12
    h=erode(h,float(xx[1]-xx[0]),7219,85)
    h+=edge*smooth(h/12)*fractal(wx*.19,wy*.19,281,4)*.65
    h*=.64
    stats.append(make_mesh('ErodedMountainRanges',x,y,h,mesh,material,True))
    assert np.isfinite(h).all(), 'Non-finite mountain height'
    import json
    from pathlib import Path
    (Path(__file__).resolve().parent/'terrain-check.json').write_text(json.dumps({
        'terrain':stats,'foundation_height_m':11.96,'foundation_max_error_m':foundation_error,
        'finite_heights':True,'simulation':'simplified hydraulic transport + talus',
        'scope':'Blender illustration geometry; no in-game collision validation'
    },indent=2)+'\n',encoding='utf-8')
    print('TERRAIN_STATS',stats,flush=True)
    return stats
