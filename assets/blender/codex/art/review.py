"""Technical validation and contact sheet, Python + Pillow."""
from pathlib import Path
import hashlib, json
from PIL import Image, ImageDraw
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[3]; OUT=ROOT/'client/public/ui/art'
spec={'logo':(2048,2048),'logo_512':(512,512),'bg_login':(1920,1080),'bg_loading_1':(1920,1080),'bg_loading_2':(1920,1080),'bg_loading_3':(1920,1080),'launcher_banner':(1600,600)}
sheet=Image.new('RGB',(1000,1500),(21,24,27));d=ImageDraw.Draw(sheet);report=[]
for i,(key,size) in enumerate(spec.items()):
    path=OUT/(key+('.png' if key.startswith('logo') else '.webp'))
    im=Image.open(path);im.load();assert im.size==size,(key,im.size,size)
    if key.startswith('logo'):assert im.mode=='RGBA' and im.getchannel('A').getextrema()==(0,255)
    preview=im.convert('RGBA');preview.thumbnail((488,340),Image.Resampling.LANCZOS)
    x=(i%2)*500+(500-preview.width)//2;y=(i//2)*375
    sheet.paste(preview,(x,y),preview);d.text(((i%2)*500+12,y+346),key,fill=(223,207,170))
    report.append({'key':key,'size':size,'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
(HERE/'previews').mkdir(exist_ok=True);sheet.save(HERE/'previews/contact.png')
(HERE/'qa.json').write_text(json.dumps({'files':report,'checks':'dimensions, image decoding, logo transparency, SHA-256'},indent=2)+'\n')
print('PASS: 7 images, prescribed dimensions and logo transparency')
