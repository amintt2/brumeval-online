"""Verify the complete icon contract and produce labelled contact sheets (Python + Pillow)."""
import hashlib, json, re
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[3]
manifest=json.loads((HERE/'manifest.json').read_text())
keys=manifest['keys']
src=(ROOT/'shared/data.js').read_text(encoding='utf-8')
wanted=set(re.findall(r"icon:\s*'([a-z0-9_]+)'",src))|{'gold'}
block=re.search(r'export const ABILITIES = \{(.*?)\n\};',src,re.S).group(1)
wanted|={'ab_'+s for s in re.findall(r'^\s*([a-z_]+):\s*\{',block,re.M)}
assert wanted <= set(keys), sorted(wanted-set(keys))
assert len(keys)==53, len(keys)
out=HERE/'previews';out.mkdir(exist_ok=True)
report=[]
for key in keys:
    path=ROOT/'client/public/icons'/f'{key}.png'
    im=Image.open(path); im.load()
    assert im.size==(256,256),(key,im.size)
    assert im.mode=='RGBA',(key,im.mode)
    alpha=im.getchannel('A'); lo,hi=alpha.getextrema()
    assert hi==255,(key,hi)
    assert lo==255 if key.startswith('ab_') else lo==0,(key,lo)
    if not key.startswith('ab_'):
        bbox=alpha.point(lambda x:255 if x>20 else 0).getbbox()
        assert bbox and min(bbox[:2])>=3 and max(bbox[2:])<=253,(key,bbox)
    report.append({'key':key,'size':im.size,'alpha_extrema':[lo,hi],'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
for label,subset in [('objects',[k for k in keys if not k.startswith('ab_')]),('abilities',[k for k in keys if k.startswith('ab_')])]:
    for page in range((len(subset)+17)//18):
        group=subset[page*18:(page+1)*18]
        sheet=Image.new('RGB',(6*200,((len(group)+5)//6)*225),(23,25,27));d=ImageDraw.Draw(sheet)
        for i,key in enumerate(group):
            x=(i%6)*200;y=(i//6)*225
            im=Image.open(ROOT/'client/public/icons'/f'{key}.png').convert('RGBA')
            im.thumbnail((188,188),Image.Resampling.LANCZOS)
            sheet.paste(im,(x+6,y+3),im)
            d.text((x+7,y+194),key,fill=(220,205,172))
        sheet.save(out/f'{label}_{page+1}.png')
(HERE/'qa.json').write_text(json.dumps({'count':len(keys),'referenced_keys':len(wanted),'checks':'dimensions, RGBA, alpha, safe bounds, data coverage, SHA-256','files':report},indent=2)+'\n')
print(f'PASS: {len(keys)} icons; {len(wanted)} current game references; labelled sheets in {out}')
