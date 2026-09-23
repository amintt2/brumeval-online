"""Visualize the procedural grass density mask used by cinematics.py."""
import sys
sys.dont_write_bytecode=True
from pathlib import Path
import bpy
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
import grass_field
size=384
pixels=[]
for j in range(size):
 y=-8+83*j/(size-1)
 for i in range(size):
  x=-26+52*i/(size-1)
  value=grass_field.field(x,y)[0]*grass_field.path_fade(x,y)
  pixels.extend((value,value,value,1))
im=bpy.data.images.new('Grass density, world XY',width=size,height=size)
im.pixels.foreach_set(pixels)
im.filepath_raw=str(HERE/'previews/grass-density.png');im.file_format='PNG';im.save()
print('Saved grass density mask: white dense, black sparse/path; buildings excluded separately.')
