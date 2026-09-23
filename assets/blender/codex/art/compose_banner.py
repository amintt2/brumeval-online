"""Reproducible approved-logo layout on the bespoke panoramic Cycles render."""
import sys
from PIL import Image
path,logo_path=sys.argv[1:]
im=Image.open(path).convert('RGB');w,h=im.size
pixels=[]
for y in range(h):
    for x in range(w):
        u=x/w;v=y/h;blend=max(0,min(1,(.59-u)/.24))*.93
        edge=min(.35,((u-.54)**2+((v-.5)*.75)**2)*.7)
        pixels.append(tuple(int((c*(1-blend)+d*blend)*(1-edge)) for c,d in zip(im.getpixel((x,y)),[5,6,8])))
out=Image.new('RGB',(w,h));out.putdata(pixels);out=out.convert('RGBA')
logo=Image.open(logo_path).convert('RGBA');logo=logo.crop(logo.getchannel('A').getbbox())
logo.thumbnail((int(w*.37),int(h*.75)),Image.Resampling.LANCZOS)
out.alpha_composite(logo,(int(w*.24-logo.width/2),int((h-logo.height)/2)))
out.convert('RGB').save(path,quality=94)
