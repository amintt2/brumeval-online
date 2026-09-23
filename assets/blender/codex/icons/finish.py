"""Deterministic supersampling and restrained bloom over a painted vignette."""
import sys, math, random
from pathlib import Path
from PIL import Image, ImageFilter, ImageChops
p=Path(sys.argv[1]);key=sys.argv[2]
im=Image.open(p).convert('RGBA').resize((256,256),Image.Resampling.LANCZOS)
if key.startswith('ab_'):
    rng=random.Random(23);pixels=[]
    for y in range(256):
        for x in range(256):
            r=min(1,math.hypot((x-128)/160,(y-118)/160));grain=rng.gauss(0,.8)
            pixels.append(tuple(max(0,int(v*(1-.65*r)+grain)) for v in [21,24,29])+(255,))
    canvas=Image.new('RGBA',(256,256));canvas.putdata(pixels);canvas.alpha_composite(im)
    bright=im.convert('RGB').point(lambda v:max(0,min(255,int((v-122)*1.8))))
    bright=ImageChops.multiply(bright,im.getchannel('A').convert('RGB'))
    glow=bright.filter(ImageFilter.GaussianBlur(7)).point(lambda v:int(v*.8))
    im=ImageChops.add(canvas.convert('RGB'),glow).convert('RGBA')
im.save(p)
