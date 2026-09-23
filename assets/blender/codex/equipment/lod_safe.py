"""Equipment LODs with connected-piece quotas and measured silhouette safeguards.

Call after baking: export_lods(key, [mesh], out_dir).  Imported GLBs are supported:
coincident seam vertices are welded on temporary copies, retaining per-loop UVs.
No GPU operations. No source mesh, source material or source image is modified.

The requested ratios are goals, not permission to erase the blade, grip or string.
Actual ratios, per-component decisions and warnings are returned to the caller.
"""
import math
import bpy
import bmesh
from mathutils import Vector
from kit import export
from kit.lod import downscale_materials


def _activate(ob):
    bpy.ops.object.select_all(action='DESELECT');ob.select_set(True)
    bpy.context.view_layer.objects.active=ob


def _remove(ob):
    me=ob.data;bpy.data.objects.remove(ob,do_unlink=True)
    if me.users==0:bpy.data.meshes.remove(me)


def _tris(ob):return sum(len(p.vertices)-2 for p in ob.data.polygons)


def _copy(ob,name):
    dup=ob.copy();dup.data=ob.data.copy();dup.name=name
    bpy.context.collection.objects.link(dup)
    world=ob.matrix_world.copy();dup.parent=None;dup.matrix_world=world
    return dup


def _normal_map(me):
    result={}
    for p in me.polygons:
        for li in p.loop_indices:
            v=me.vertices[me.loops[li].vertex_index].co
            uv=me.uv_layers.active.data[li].uv if me.uv_layers.active else (0,0)
            key=tuple(round(float(a),7) for a in (*v,*uv))
            result[key]=tuple(me.corner_normals[li].vector)
    return result


def _restore_normals(me,normals):
    restored=[]
    for p in me.polygons:
        for li in p.loop_indices:
            v=me.vertices[me.loops[li].vertex_index].co
            uv=me.uv_layers.active.data[li].uv if me.uv_layers.active else (0,0)
            key=tuple(round(float(a),7) for a in (*v,*uv))
            restored.append(normals.get(key,tuple(p.normal)))
    me.normals_split_custom_set(restored)


def _prepared_copy(ob,name):
    dup=_copy(ob,name);_activate(dup)
    for modifier in list(dup.modifiers):
        if modifier.type=='ARMATURE':raise ValueError('lod_safe supports static equipment only')
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    # Remember the authored loop normals before welding UV/normal splits.
    normals=_normal_map(dup.data)
    bm=bmesh.new();bm.from_mesh(dup.data)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-7)
    bm.to_mesh(dup.data);bm.free();dup.data.update()
    _restore_normals(dup.data,normals)
    return dup


def _components(ob):
    count=len(ob.data.vertices);parent=list(range(count))
    def root(i):
        while parent[i]!=i:
            parent[i]=parent[parent[i]];i=parent[i]
        return i
    for edge in ob.data.edges:
        a,b=map(root,edge.vertices)
        if a!=b:parent[b]=a
    groups={}
    for i in range(count):groups.setdefault(root(i),[]).append(i)
    pieces=[];normals=_normal_map(ob.data)
    for index,vertices in enumerate(groups.values()):
        keep=set(vertices);piece=_copy(ob,f'{ob.name}_piece{index:03}')
        bm=bmesh.new();bm.from_mesh(piece.data);bm.verts.ensure_lookup_table()
        bmesh.ops.delete(bm,geom=[v for v in bm.verts if v.index not in keep],context='VERTS')
        bm.to_mesh(piece.data);bm.free();piece.data.update()
        if piece.data.polygons:
            _restore_normals(piece.data,normals);pieces.append(piece)
        else:_remove(piece)
    return pieces


_DIRECTIONS=[Vector((x,y,z)).normalized() for x in (-1,0,1) for y in (-1,0,1) for z in (-1,0,1) if x or y or z]


def _shape(ob):
    points=[ob.matrix_world@v.co for v in ob.data.vertices]
    lo=Vector(tuple(min(p[i] for p in points) for i in range(3)))
    hi=Vector(tuple(max(p[i] for p in points) for i in range(3)))
    supports=[(min(p.dot(d) for p in points),max(p.dot(d) for p in points)) for d in _DIRECTIONS]
    return {'lo':lo,'hi':hi,'extent':hi-lo,'supports':supports,'diagonal':(hi-lo).length}


def _wire_details(pieces):
    """Only remove dense thin decoration enclosed by a solid support, never a free string/shaft."""
    records=[]
    for ob in pieces:
        shape=_shape(ob);bm=bmesh.new();bm.from_mesh(ob.data)
        volume=abs(bm.calc_volume(signed=True)*ob.matrix_world.to_3x3().determinant());bm.free()
        bbox=max(1e-12,math.prod(shape['extent']))
        records.append((shape,volume/bbox))
    removable={}
    for i,(shape,fill) in enumerate(records):
        if _tris(pieces[i])<200 or fill>.055:continue
        for j,(support,support_fill) in enumerate(records):
            if i==j or support_fill<.20:continue
            margin=.0035
            if all(shape['lo'][k]>=support['lo'][k]-margin and shape['hi'][k]<=support['hi'][k]+margin for k in range(3)):
                removable[i]={'supportComponent':j,'volumeFraction':round(fill,5),
                               'reason':'dense thin decoration contained around solid support'};break
    return removable


def _downscale_shared_images(copies,scale,suffix):
    groups=[]
    for slot in copies[0].material_slots:
        mat=slot.material;by_image={}
        if mat and mat.node_tree:
            for node in mat.node_tree.nodes:
                if node.type=='TEX_IMAGE' and node.image:by_image.setdefault(node.image.as_pointer(),[]).append(node.name)
        groups.append(list(by_image.values()))
    made=downscale_materials(copies,scale,suffix)
    for slot,sets in zip(copies[0].material_slots,groups):
        for names in sets:
            first=slot.material.node_tree.nodes[names[0]].image
            for name in names[1:]:slot.material.node_tree.nodes[name].image=first
    return made


def _preserved(source,candidate):
    current=_shape(candidate);diag=max(source['diagonal'],1e-8)
    worst=0.
    for (a,b),(c,d) in zip(source['supports'],current['supports']):
        width=b-a
        if width<1e-7:continue
        # Retain even a thin component's thickness; prevent paper-thin blade collapse.
        ratio=(d-c)/width;worst=max(worst,1-ratio)
        if ratio<.84 or abs((a+b-c-d)/2)>diag*.035:return False,worst
    return True,worst


def _quota(piece,ratio,whole_diagonal):
    n=_tris(piece);shape=_shape(piece);dims=sorted(shape['extent']);long=dims[-1]
    elongated=long/max(dims[1],1e-7)>4
    structural=long>whole_diagonal*.16
    if n<=16:minimum=n
    elif structural and elongated:
        # Simple low-poly blades / taut strings already use nearly minimal topology.
        minimum=n if n<=110 else (72 if ratio>=.2 else 48)
    elif structural:minimum=48 if ratio>=.2 else 24
    else:minimum=16 if ratio>=.2 else 12
    target=min(n,max(minimum,round(n*ratio)))
    return target,shape,{'sourceTris':n,'minimumTris':minimum,'targetTris':target,
      'extent':[round(v,6) for v in shape['extent']],'elongated':elongated,'structural':structural}


def _reduce(piece,target,shape):
    original=_tris(piece);attempts=[]
    ratio=target/max(1,original)
    while True:
        reduced=_copy(piece,piece.name+'_reduced')
        if ratio<.999:
            _activate(reduced);md=reduced.modifiers.new('Piece-aware silhouette LOD','DECIMATE')
            md.decimate_type='COLLAPSE';md.ratio=ratio;md.use_collapse_triangulate=True
            bpy.ops.object.modifier_apply(modifier=md.name)
        good,worst=_preserved(shape,reduced) if reduced.data.polygons else (False,1.)
        n=_tris(reduced);attempts.append({'ratio':round(ratio,4),'tris':n,'silhouettePass':good})
        if good and n>=min(12,original):return reduced,attempts,worst
        _remove(reduced)
        if ratio>=.999:raise RuntimeError('Original component failed its own silhouette check')
        ratio=min(1.,max(ratio+.06,ratio*1.45))


def export_lods(key,objs,out_dir=None,ratios=(.30,.08),keep=False,tex_scale=(.5,.25),**kwargs):
    if kwargs:raise TypeError('Unsupported lod_safe options: '+', '.join(kwargs))
    sources=[];pieces=[];infos=[]
    source_tris=export.triangles(objs)
    if source_tris==0:raise ValueError('No triangles for equipment LOD')
    try:
        for ob in objs:
            if ob.type=='MESH':
                source=_prepared_copy(ob,key+'_lod_work');sources.append(source);pieces.extend(_components(source))
        all_points=[p.matrix_world@v.co for p in pieces for v in p.data.vertices]
        whole=(Vector(tuple(max(v[i] for v in all_points) for i in range(3)))-Vector(tuple(min(v[i] for v in all_points) for i in range(3)))).length
        wire_details=_wire_details(pieces)
        if key.startswith('eq_shield_'):
            # A few millimetres of rivet relief cannot affect a distant shield silhouette.
            # Restrict this rule to shields; never mistake a thin weapon string for decoration.
            for index,piece in enumerate(pieces):
                shape=_shape(piece)
                if shape['diagonal']<whole*.04 and max(shape['extent'])<.025:
                    wire_details[index]={'reason':'small shield surface decoration below 4% of overall diagonal'}
        for level,requested in enumerate(ratios,1):
            copies=[];reports=[];made=([],[])
            try:
                for index,piece in enumerate(pieces):
                    target,shape,report=_quota(piece,requested,whole)
                    if requested<=.1 and index in wire_details:
                        report.update(component=index,actualTris=0,removedDecoration=wire_details[index]);reports.append(report);continue
                    reduced,attempts,worst=_reduce(piece,target,shape);copies.append(reduced)
                    report.update(component=index,actualTris=_tris(reduced),attempts=attempts,maxSupportWidthLoss=round(worst,5));reports.append(report)
                bpy.ops.object.select_all(action='DESELECT')
                for ob in copies:ob.select_set(True)
                bpy.context.view_layer.objects.active=copies[0];bpy.ops.object.join()
                joined=bpy.context.object;copies=[joined];joined.name=f'{key}_lod{level}'
                # Set a true zero pivot without moving any world-space vertex.
                _activate(joined);bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
                if tex_scale and tex_scale[level-1]<1:
                    made=_downscale_shared_images(copies,tex_scale[level-1],f'_lod{level}')
                info=export.export_glb(key,out_dir,objects=copies,budget=None,animations=False,suffix=f'_lod{level}')
                actual=info['tris']/source_tris
                info.update(ratio=requested,requestedRatio=requested,actualRatio=round(actual,6),sourceTris=source_tris,
                            connectedComponents=len(pieces),components=reports,policy='component quotas + 26-direction support checks',
                            seamWeldDistance=1e-7)
                if actual>requested*1.25:
                    info.setdefault('warnings',[]).append(f'Silhouette preservation requires {actual:.1%} of LOD0, above requested {requested:.1%}.')
                if actual>.16 and requested<=.1:
                    info.setdefault('warnings',[]).append('LOD2 exceeds 16%; review component quotas and visual result before integration.')
                infos.append(info)
                print('SAFE_LOD',key,level,'tris',info['tris'],'ratio',round(actual,4),'pieces',len(pieces),'warnings',info.get('warnings',[]),flush=True)
            finally:
                if not keep:
                    for ob in copies:
                        if ob.name in bpy.data.objects:_remove(ob)
                    for mat in made[0]:
                        if mat.users==0:bpy.data.materials.remove(mat)
                    for image in made[1]:
                        if image.users==0:bpy.data.images.remove(image)
    finally:
        for ob in pieces+sources:
            if ob.name in bpy.data.objects:_remove(ob)
    return infos
