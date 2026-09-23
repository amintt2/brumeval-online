"""Exterior look-development: eight cliff views and three views per other scene."""
import sys
sys.dont_write_bytecode=True
from pathlib import Path
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
import build as B
import cinematics as D
import bpy
import argparse, importlib

def main():
    p=argparse.ArgumentParser();p.add_argument('--views',default='');p.add_argument('--only',default='cliff');p.add_argument('--samples',type=int,default=24)
    args=p.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    sets={
      'cliff':('bg_login',[
        ('01-village',(-6,-10,1.6),(4,35,7.6),32),
        ('02-front-bas',(6,27,2),(12,86,23),32),
        ('03-gauche',(-29,39,8),(11,88,21),28),
        ('04-droite',(47,39,8),(12,87,21),28),
        ('05-strates',(-14,58,3),(7,86,14),32),
        ('06-remparts',(35,57,17),(12,87,24),38),
        ('07-silhouette',(-23,70,22),(12,88,26),32),
        ('08-ensemble',(12,13,16),(12,87,24),32)]),
      'cliff_back':('bg_login',[
        ('09-arriere-gauche',(-27,118,15),(12,90,24),24),
        ('10-arriere',(12,132,20),(12,90,27),14),
        ('11-arriere-droite',(55,120,20),(12,90,28),16)]),
      'house':('bg_login',[
        ('01-entree',(-12,6,1.6),(-9.8,12.5,1.7),28),
        ('02-profil',(-3,11,1.1),(-9.8,12.0,.8),32),
        ('03-sol',(-11,7,.35),(-9.8,12.5,.6),30)]),
      'cemetery':('bg_loading_1',[
        ('01-frontal',(-2,-9,1.6),(0,25,3.8),32),
        ('02-tombes',(-10,1,1.6),(1,29,4),32),
        ('03-chapelle',(7,19,2),(1,47,4),32)]),
      'lair':('bg_loading_2',[
        ('01-entree',(4,-12,1.6),(0,15,4),32),
        ('02-gauche',(-7,-1,2),(0,14,4),32),
        ('03-colonnes',(7,5,2),(0,14,4),28)]),
      'forest':('bg_loading_3',[
        ('01-sentier',(-1,-9,1.6),(0,28,3.4),31),
        ('02-racines',(-8,-3,1.2),(0,25,3),31),
        ('03-stele',(5,15,1.6),(0,31,2.4),32)])}
    out=HERE/'previews/angles';out.mkdir(parents=True,exist_ok=True)
    for group in args.only.split(','):
        key,views=sets[group];B.C.reset();importlib.reload(B.gpu);D.build(key,B)
        s=bpy.context.scene;s.render.resolution_x=960;s.render.resolution_y=640;s.render.resolution_percentage=100
        s.render.use_persistent_data=True
        s.render.image_settings.file_format='WEBP';s.render.image_settings.color_mode='RGB';s.render.image_settings.quality=90
        s.view_settings.view_transform='AgX';s.view_settings.look='AgX - Medium High Contrast';s.render.film_transparent=False
        with B.gpu.device(s,samples=args.samples,wait=30):
            s.cycles.use_denoising=True;s.cycles.max_bounces=6;s.cycles.volume_bounces=1
            for name,pos,target,lens in views:
                if args.views and name not in args.views.split(','):continue
                cam=s.camera;cam.location=pos;B.aim(cam,target);cam.data.lens=lens
                s.render.filepath=str(out/(group+'-'+name+'.webp'));bpy.ops.render.render(write_still=True)
                print('ANGLE DONE',group,name,flush=True)

if __name__=='__main__':main()
