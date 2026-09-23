"""Validate delivered GLBs rather than the generator; write a compact review gallery.
Run with Python + Pillow after build.py. No Blender dependency.
"""
from pathlib import Path
import json, struct, io, hashlib
from PIL import Image, ImageDraw
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[3]
KEYS=[f'eq_{family}_{i}' for family,count in [('sword',5),('greatsword',2),('staff',4),('bow',4),('shield',3)] for i in range(1,count+1)]
out=ROOT/'client/public/models'; pre=HERE/'previews'
records=[]
for key in KEYS:
    variants=[]
    for level in range(3):
        path=out/(key+('' if level==0 else f'_lod{level}')+'.glb')
        raw=path.read_bytes(); magic,version,length=struct.unpack_from('<III',raw)
        assert magic==0x46546c67 and version==2 and length==len(raw),path
        n=struct.unpack_from('<I',raw,12)[0]; doc=json.loads(raw[20:20+n]); binary=raw[28+n:]
        assert not doc.get('skins') and not doc.get('animations'),path
        assert len(doc['materials'])==1,path
        assert all('uri' not in b for b in doc['buffers']),path
        tris=sum(doc['accessors'][p['indices']]['count']//3 for mesh in doc['meshes'] for p in mesh['primitives'])
        assert tris<=5000 and len(raw)<=2*1024**2,(path,tris,len(raw))
        dims=[]
        for im in doc['images']:
            assert im['mimeType']=='image/webp',(path,im)
            bv=doc['bufferViews'][im['bufferView']]; start=bv.get('byteOffset',0)
            with Image.open(io.BytesIO(binary[start:start+bv['byteLength']])) as image:
                image.load(); assert max(image.size)<=1024
                dims.append(image.size)
        # Equipment pivot must not be silently moved to the base by export.
        for node in doc['nodes']:
            assert node.get('translation',[0,0,0])==[0,0,0],(path,node)
        variants.append(dict(file=path.name,triangles=tris,bytes=len(raw),textures=dims,sha256=hashlib.sha256(raw).hexdigest()))
    assert variants[1]['triangles']<variants[0]['triangles'] and variants[2]['triangles']<variants[1]['triangles'],key
    report=json.loads((pre/f'{key}_qa.json').read_text())
    assert not report['fails'],(key,report['fails'])
    for suffix in ['', '_turntable','_wire','_normals','_uv']:
        with Image.open(pre/f'{key}{suffix}.png') as image:image.verify()
    records.append(dict(key=key,variants=variants,warnings=report['warns']))
(pre/'delivery-checks.json').write_text(json.dumps(records,indent=2),encoding='utf-8')
sheet=Image.new('RGB',(6*240,3*272),'#1a1a1a');draw=ImageDraw.Draw(sheet)
for i,key in enumerate(KEYS):
    with Image.open(pre/f'{key}.png') as image:sheet.paste(image.convert('RGB').resize((240,240)),((i%6)*240,(i//6)*272))
    draw.text(((i%6)*240+8,(i//6)*272+248),key,fill='#d8c8a2')
sheet.save(pre/'equipment-sheet.jpg',quality=93)
cards=''.join(f'<article><h2>{r["key"]}</h2><img src="{r["key"]}.png"><p>{r["variants"][0]["triangles"]} triangles · {r["variants"][0]["bytes"]//1024} Ko</p><p>'+ ' · '.join(f'<a href="{r["key"]}_{s}.png">{label}</a>' for s,label in [('turntable','8 angles'),('wire','Maillage'),('normals','Normales'),('uv','UV')])+'</p></article>' for r in records)
(pre/'review.html').write_text('<!doctype html><html lang="fr"><meta charset="utf-8"><title>Brumeval — équipements</title><style>body{background:#17191b;color:#d9d1bd;font:16px system-ui;max-width:1500px;margin:32px auto;padding:20px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:24px}article{background:#25282b;padding:16px;border:1px solid #554b36}img{width:100%}h2{font-size:18px}a{color:#d6b578}</style><h1>18 équipements — revue CX-3</h1><p>Textures procédurales cuites, pivot à la prise en main, 3 niveaux de détail. Assets prêts à intégrer par Claude ; attache aux personnages à vérifier dans le jeu.</p><main>'+cards+'</main></html>',encoding='utf-8')
print(f'PASS: {len(KEYS)*3} GLB, textures WebP embarquées, budgets, pivots, LOD et {len(KEYS)*5} images QA.')
