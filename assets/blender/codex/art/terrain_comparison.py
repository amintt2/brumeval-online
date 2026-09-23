"""Compare old block-like terrain with procedural terrain from identical cameras."""
from pathlib import Path
from PIL import Image, ImageDraw
HERE=Path(__file__).resolve().parent/'previews'
files=['cliff-01-village.webp','cliff-03-gauche.webp','cliff_back-10-arriere.webp']
out=Image.new('RGB',(1440,1512),'#131b1b');draw=ImageDraw.Draw(out)
for row,name in enumerate(files):
 for col,folder in enumerate(['terrain-before','angles']):
  im=Image.open(HERE/folder/name).convert('RGB').resize((720,480))
  out.paste(im,(col*720,row*504+24))
  draw.text((col*720+12,row*504+6),('AVANT' if col==0 else 'APRES')+' - '+name,fill='#e1dac7')
out.save(HERE/'terrain-comparison.jpg',quality=94)
