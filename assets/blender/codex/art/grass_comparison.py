"""Rebuild the grass comparison from the preserved previous pass and latest angles."""
from pathlib import Path
from PIL import Image, ImageDraw
HERE=Path(__file__).resolve().parent/'previews'
files=['cliff-01-village.webp','house-02-profil.webp','forest-01-sentier.webp']
out=Image.new('RGB',(1440,1512),'#131b1b');draw=ImageDraw.Draw(out)
for row,name in enumerate(files):
 for col,folder in enumerate(['grass-before','angles']):
  im=Image.open(HERE/folder/name).convert('RGB').resize((720,480))
  out.paste(im,(col*720,row*504+24))
  draw.text((col*720+12,row*504+6),('AVANT' if col==0 else 'APRES')+' - '+name,fill='#e1dac7')
out.save(HERE/'grass-comparison.jpg',quality=94)
print(HERE/'grass-comparison.jpg')
