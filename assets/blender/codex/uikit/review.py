"""Deterministic supersampling, asset validation and native-size UI composition."""
import argparse, hashlib, json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageChops
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[3]
OUT=ROOT/'client/public/ui/kit'
def font(size):
    for path in ['C:/Windows/Fonts/georgia.ttf','C:/Windows/Fonts/arial.ttf']:
        if Path(path).exists():return ImageFont.truetype(path,size)
    return ImageFont.load_default()
def nine(im,size,s):
    l,t,r,b=s['left'],s['top'],s['right'],s['bottom'];w,h=im.size;dw,dh=size
    assert dw>=l+r and dh>=t+b
    xs=[0,l,w-r,w];ys=[0,t,h-b,h];dx=[0,l,dw-r,dw];dy=[0,t,dh-b,dh]
    result=Image.new('RGBA',size)
    for j in range(3):
        for i in range(3):
            piece=im.crop((xs[i],ys[j],xs[i+1],ys[j+1]));nw=dx[i+1]-dx[i];nh=dy[j+1]-dy[j]
            if not nw or not nh or not piece.width or not piece.height:continue
            result.paste(piece.resize((nw,nh),Image.Resampling.LANCZOS),(dx[i],dy[j]))
    return result
def main():
    p=argparse.ArgumentParser();p.add_argument('--resize',nargs=3);a=p.parse_args()
    if a.resize:
        path,w,h=a.resize;im=Image.open(path).convert('RGBA');im.resize((int(w),int(h)),Image.Resampling.LANCZOS).save(path,optimize=True);return
    manifest=json.loads((OUT/'manifest.json').read_text());assets=manifest['assets'];records=[];ims={}
    for key,item in assets.items():
        path=OUT/item['file'];im=Image.open(path);assert im.size==tuple(item['size']),(key,im.size);assert im.mode=='RGBA',(key,im.mode)
        alpha=im.getchannel('A');assert alpha.getextrema()==(0,255),(key,alpha.getextrema())
        if key.startswith(('slot_','bar_frame_')) or key=='minimap_ring':assert alpha.getpixel((im.width//2,im.height//2))==0,key
        if key.startswith(('panel_','button_')) or key=='tooltip':assert alpha.getpixel((im.width//2,im.height//2))==255,key
        if 'slice' in item:
            s=item['slice'];assert s['left']+s['right']<im.width and s['top']+s['bottom']<im.height,key
            if all(s.values()):
                expanded=nine(im,(im.width+173,im.height+51),s)
                original=im.crop((0,0,s['left'],s['top']))
                retained=expanded.crop((0,0,s['left'],s['top']))
                assert all(e==(0,0) for e in ImageChops.difference(original,retained).getextrema()),key+' corner stretched'
        if 'hotspot' in item:assert all(0<=item['hotspot'][i]<im.size[i] for i in [0,1])
        ims[key]=im;records.append({'key':key,'size':im.size,'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'alpha_bbox':alpha.getbbox()})
    preview=HERE/'previews';preview.mkdir(exist_ok=True)
    sheet=Image.new('RGB',(1200,((len(ims)+4)//5)*190),'#171c1b');d=ImageDraw.Draw(sheet)
    for i,(key,im) in enumerate(ims.items()):
        x=(i%5)*240;y=(i//5)*190;show=im.copy();show.thumbnail((215,145))
        sheet.paste(show,(x+(240-show.width)//2,y+20),show);d.text((x+8,y+167),key,font=font(12),fill='#c7bda8')
    sheet.save(preview/'contact.png')
    # A composed UI at practical display sizes; all chrome comes from Blender PNGs.
    ui=Image.new('RGBA',(1280,800),'#151c1b');d=ImageDraw.Draw(ui)
    for y in range(800):d.line((0,y,1280,y),fill=(16+y//80,23+y//95,22+y//110))
    def put(key,x,y,size=None):
        im=ims[key]
        if size:im=nine(im,size,assets[key]['slice']) if 'slice' in assets[key] else im.resize(size,Image.Resampling.LANCZOS)
        ui.alpha_composite(im,(x,y))
    put('panel_leather',40,120,(490,620));put('panel_stone',565,290,(390,390));put('tooltip',760,560,(390,172))
    put('separator',65,190,(440,24));put('separator',585,352,(350,24))
    d=ImageDraw.Draw(ui);d.text((110,149),'Inventaire',font=font(28),fill='#ddd1b9');d.text((633,314),'Équipement',font=font(24),fill='#ddd1b9')
    for j in range(3):
        for i in range(4):put('slot_item',76+i*105,225+j*105,(88,88))
    for i in range(4):put('slot_skill',590+i*84,399,(76,76))
    for kind,y,value,label in [('hp',18,.78,'Vie'),('mana',50,.55,'Mana'),('stamina',82,.93,'Endurance')]:
        fill=ims['bar_fill_'+kind].resize((288,14));fill=fill.crop((0,0,int(288*value),14));ui.alpha_composite(fill,(56,y+9));put('bar_frame_'+kind,40,y)
        ImageDraw.Draw(ui).text((374,y+8),label,font=font(13),fill='#d4c9b3')
    put('button_normal',74,575,(422,64));put('button_hover',74,649,(200,55));put('button_pressed',290,649,(205,55))
    d=ImageDraw.Draw(ui);d.text((225,594),'Équiper',font=font(20),fill='#ddd1b9');d.text((125,666),'Utiliser',font=font(16),fill='#eadcbf');d.text((334,666),'Déposer',font=font(16),fill='#b7ad99')
    d.text((783,585),'Épée ancienne',font=font(22),fill='#d9c29c');d.text((783,622),'Une lame usée par de longs voyages.',font=font(14),fill='#c1bba9');d.text((783,653),'Attaque   24       Poids   3,2',font=font(15),fill='#c1bba9')
    # Neutral map placeholder; the delivered texture is only the transparent ring.
    d.ellipse((1018,28,1238,248),fill='#293b33');d.line((1050,200,1100,128,1194,76),fill='#77826a',width=3)
    put('minimap_ring',1000,10,(256,256));d=ImageDraw.Draw(ui);d.text((1104,128),'N',font=font(16),fill='#ded1b5')
    d.text((590,495),'Curseurs à taille native',font=font(16),fill='#c7bda8')
    for i,kind in enumerate(['normal','attack','talk','grab']):
        put('cursor_'+kind+'_32',600+i*78,526);put('cursor_'+kind+'_64',600+i*78,690)
    ui.convert('RGB').save(preview/'in_context.png')
    # Larger/smaller panel examples prove nine-slice preserves corner dimensions.
    stretch=Image.new('RGBA',(1050,460),'#121817')
    for key,x,y,size in [('panel_leather',10,10,(310,440)),('panel_stone',335,10,(700,220)),('button_hover',335,250,(700,64)),('tooltip',335,335,(400,115))]:
        stretch.alpha_composite(nine(ims[key],size,assets[key]['slice']),(x,y))
    stretch.convert('RGB').save(preview/'nine_slice.png')
    report={'asset_count':len(records),'total_bytes':sum(v['bytes'] for v in records),'checks':['expected dimensions','RGBA transparency','transparent frame apertures','opaque panel centers','valid nine-slice margins','nine-slice corner pixels unchanged','valid cursor hotspots'],'assets':records}
    (HERE/'qa.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf8')
    print(json.dumps({'assets':len(records),'bytes':report['total_bytes'],'result':'PASS'}))
if __name__=='__main__':main()
