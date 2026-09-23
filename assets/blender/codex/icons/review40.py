"""Actual 40 px review: all 53 icons plus the twelve targeted before/after pairs."""
import argparse, io, json, subprocess
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[3];PRE=HERE/'previews'
TARGETS=['potion_hp_s','potion_hp_m','potion_hp_l','potion_mp_s','potion_stamina','ab_firebolt','ab_fireball','ab_shot','ab_piercing_shot','ab_rapid_fire','ab_arrow_rain','ab_heavy_blow']
p=argparse.ArgumentParser();p.add_argument('--draft',action='store_true');args=p.parse_args()
keys=json.loads((HERE/'manifest.json').read_text())['keys']
font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',12)
small=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',10)
title=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',18)

def current(key):
    draft=PRE/'drafts'/f'{key}.png'
    path=draft if args.draft and key in TARGETS else ROOT/'client/public/icons'/f'{key}.png'
    return Image.open(path).convert('RGBA')

def paste(canvas,im,pos,size):
    im=im.resize((size,size),Image.Resampling.LANCZOS)
    canvas.paste(im,pos,im)

sheet=Image.new('RGB',(1040,42+((len(keys)+7)//8)*84),'#16191d');d=ImageDraw.Draw(sheet)
d.text((14,10),'53 icônes à leur taille réelle : 40 × 40 pixels',font=title,fill='#ded5c3')
for i,key in enumerate(keys):
    x=(i%8)*130;y=42+(i//8)*84
    paste(sheet,current(key),(x+45,y+3),40)
    d.text((x+4,y+49),key,font=small,fill='#d9d5c8')
sheet.save(PRE/'pass3-readability-40.png')

sheet=Image.new('RGB',(900,70+4*124),'#16191d');d=ImageDraw.Draw(sheet)
d.text((16,10),'Passe ciblée : avant / après à 40 px',font=title,fill='#ded5c3')
for i,key in enumerate(TARGETS):
    x=i%3*300;y=54+i//3*124
    old=subprocess.check_output(['git','show',f'47da7ad:client/public/icons/{key}.png'],cwd=ROOT)
    paste(sheet,Image.open(io.BytesIO(old)).convert('RGBA'),(x+26,y+16),40)
    paste(sheet,current(key),(x+102,y+16),40)
    d.text((x+28,y+62),'avant',font=small,fill='#9da5ad');d.text((x+104,y+62),'après',font=small,fill='#e5d7ae')
    d.text((x+14,y+86),key,font=font,fill='#d9d5c8')
sheet.save(PRE/'pass3-compare-40.png')

sheet=Image.new('RGB',(960,4*202),'#16191d');d=ImageDraw.Draw(sheet)
for i,key in enumerate(TARGETS):
    x=i%6*160;y=i//6*404
    paste(sheet,current(key),(x+5,y+5),150)
    d.text((x+4,y+162),key,font=small,fill='#d9d5c8')
    paste(sheet,current(key),(x+60,y+199),40)
    # White backing checks whether a transparent potion relies on a dark UI.
    d.rectangle((x+50,y+267,x+109,y+326),fill='#ddd8c8')
    paste(sheet,current(key),(x+60,y+277),40)
sheet.save(PRE/'pass3-targets.png')
print('Saved native 40 px full sheet, before/after pairs, and detail sheet.')
