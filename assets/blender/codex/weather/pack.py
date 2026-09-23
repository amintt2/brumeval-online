"""Pack Blender renders, verify sprite contracts, and generate an actual-frame animation review."""
import sys
sys.dont_write_bytecode=True
import argparse,json,math,hashlib,time
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw,ImageFont
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[3]
OUT=ROOT/'client/public/vfx/weather'
PREVIEW=HERE/'previews'


def over(im,blend):
    a=np.asarray(im,dtype=np.float32)/255
    yy,xx=np.indices(a.shape[:2]);checker=((xx//16+yy//16)%2)*.035+.085
    bg=np.stack([checker*.82,checker*.95,checker],axis=2)
    rgb=np.clip(bg+a[:,:,:3]*a[:,:,3:4],0,1) if blend=='additive' else a[:,:,:3]*a[:,:,3:4]+bg*(1-a[:,:,3:4])
    return Image.fromarray(np.uint8(rgb*255),'RGB')


def html(manifest):
    data=json.dumps(manifest,ensure_ascii=False)
    content='''<!doctype html><html lang="fr"><meta charset="utf-8"><title>Météo Brumeval — contrôle des animations</title>
<style>body{margin:24px;background:#10171b;color:#d8d6c9;font:15px system-ui}h1{font-size:24px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px}article{background:#182329;padding:14px;border:1px solid #485053}canvas{width:100%;image-rendering:auto}button,input{margin:8px}small{color:#abb7b9}h2{font-size:17px}</style>
<h1>Météo Brumeval — planches rendues dans Blender</h1><p>Les animations ci-dessous lisent les véritables fichiers livrés. Ordre : gauche à droite, puis haut en bas. Les effets ponctuels sont rejoués ici après une pause.</p>
<button id="pause">Pause</button><label>Vitesse <input id="speed" type="range" min="0.25" max="2" step="0.25" value="1"></label><main id="grid"></main>
<script>const manifest=__DATA__;let paused=false,t=0,last=performance.now();const cards=[];document.querySelector('#pause').onclick=e=>{paused=!paused;e.target.textContent=paused?'Reprendre':'Pause'};
for(const [key,m] of Object.entries(manifest)){const article=document.createElement('article');article.innerHTML=`<h2>${key}</h2><canvas width="512" height="512"></canvas><small>${m.frames} images · ${m.fps} i/s · ${m.loop?'boucle':'ponctuel'} · ${m.blending}</small><p class="frame"></p>`;document.querySelector('#grid').append(article);const img=new Image();img.src='../../../../../client/public/'+m.file;cards.push({m,img,c:article.querySelector('canvas'),label:article.querySelector('.frame')});}
function draw(now){if(!paused)t+=(now-last)/1000*+document.querySelector('#speed').value;last=now;for(const {m,img,c,label} of cards){const ctx=c.getContext('2d');const g=ctx.createLinearGradient(0,0,0,512);g.addColorStop(0,'#263742');g.addColorStop(.64,'#141f25');g.addColorStop(1,'#343932');ctx.fillStyle=g;ctx.fillRect(0,0,512,512);ctx.fillStyle='#10191b';for(let j=0;j<6;j++)ctx.fillRect(j*102+20,180+j%3*22,16,332);const duration=m.frames/m.fps,phase=t%(duration+(m.loop?0:.65));let f=Math.min(m.frames-1,Math.floor(phase*m.fps));const u=m.anchorUV?.[0]??.5,v=m.anchorUV?.[1]??.5,impactY=m.anchorUV?400:256;const dx=256-u*512,dy=impactY-v*512;if(m.anchorUV){ctx.strokeStyle='#7d8065';ctx.beginPath();ctx.moveTo(216,impactY);ctx.lineTo(296,impactY);ctx.stroke();ctx.fillStyle='#bdbea5';ctx.fillText('Point d’impact au sol',304,impactY+4);}ctx.globalCompositeOperation=m.blending==='additive'?'lighter':'source-over';if(img.complete&&img.naturalWidth)ctx.drawImage(img,(f%m.cols)*m.frameSize,Math.floor(f/m.cols)*m.frameSize,m.frameSize,m.frameSize,dx,dy,512,512);ctx.globalCompositeOperation='source-over';label.textContent=`Image ${f+1} / ${m.frames}`;}requestAnimationFrame(draw)}requestAnimationFrame(draw);</script></html>'''
    (PREVIEW/'animation.html').write_text(content.replace('__DATA__',data),encoding='utf-8')


def main():
    p=argparse.ArgumentParser();p.add_argument('--only',default='');a=p.parse_args()
    specs=json.loads((HERE/'render_spec.json').read_text(encoding='utf-8'));keys=a.only.split(',') if a.only else list(specs)
    manifest=json.loads((OUT/'manifest.json').read_text()) if (OUT/'manifest.json').exists() else {}
    previous=json.loads((HERE/'qa.json').read_text()) if (HERE/'qa.json').exists() else {'effects':{}}
    PREVIEW.mkdir(parents=True,exist_ok=True);reports=previous['effects']
    for key in keys:
        started=time.monotonic();spec=specs[key];size=spec['frameSize'];frames=[]
        for i in range(spec['frames']):
            image=Image.open(HERE/'frames'/key/f'{i:03}.png').convert('RGBA').resize((size,size),Image.Resampling.LANCZOS)
            # Clear negligible alpha so the reserved transparent frame border is exact.
            arr=np.array(image);arr[arr[:,:,3]<=1]=0;frames.append(Image.fromarray(arr))
        atlas=Image.new('RGBA',(spec['cols']*size,spec['rows']*size))
        for i,frame in enumerate(frames):atlas.paste(frame,((i%spec['cols'])*size,(i//spec['cols'])*size))
        path=OUT/f'{key}.webp';lossless=key not in ['fog_wisps','sandstorm']
        atlas.save(path,'WEBP',lossless=lossless,quality=90,alpha_quality=100,method=6,exact=True)
        reopened=Image.open(path).convert('RGBA');assert reopened.size==atlas.size
        original=np.array(atlas);decoded=np.array(reopened)
        alpha_exact=np.array_equal(original[:,:,3],decoded[:,:,3]);assert alpha_exact,f'{key}: alpha changed during compression'
        pixel_exact=np.array_equal(original,decoded)
        if lossless:assert pixel_exact,f'{key}: lossless round-trip changed pixels'
        weighted_error=float(np.abs((original[:,:,:3].astype(float)-decoded[:,:,:3].astype(float))/255*original[:,:,3:4]/255).mean())
        assert weighted_error<.0015,f'{key}: compression changed visible colour too much'
        # Review and all remaining measurements use the decoded delivered atlas.
        frames=[reopened.crop(((i%spec['cols'])*size,(i//spec['cols'])*size,(i%spec['cols']+1)*size,(i//spec['cols']+1)*size)) for i in range(spec['frames'])]
        arrays=[np.array(im) for im in frames];alphas=[ar[:,:,3].astype(float)/255 for ar in arrays]
        edges=[float(np.concatenate([al[:3,:].ravel(),al[-3:,:].ravel(),al[:, :3].ravel(),al[:,-3:].ravel()]).max()) for al in alphas]
        assert max(edges)==0,f'{key}: clipped sprite edge'
        energy=[float(al.mean()) for al in alphas]
        assert max(energy)>.0001,f'{key}: no visible effect'
        if not spec['loop']:assert energy[0]<.0001 and energy[-1]<.0001,f'{key}: nontransparent one-shot endpoint'
        # Perceptual premultiplied RGB: a low-alpha colour change must not count like an opaque pop.
        premul=[ar[:,:,:3].astype(float)/255*al[:,:,None] for ar,al in zip(arrays,alphas)]
        differences=[float(np.abs(premul[i+1]-premul[i]).mean()) for i in range(len(frames)-1)]
        seam=float(np.abs(premul[0]-premul[-1]).mean());median=float(np.median(differences))
        if spec['loop']:assert seam<max(.004,median*2.7),f'{key}: loop discontinuity'
        entry={k:spec[k] for k in ['file','cols','rows','frames','fps','loop','blending','size','frameSize','anchor']};entry['bytes']=path.stat().st_size
        if 'anchorUV' in spec:entry['anchorUV']=spec['anchorUV']
        manifest[key]=entry
        displays=[over(im,spec['blending']) for im in frames]
        displays[0].save(PREVIEW/f'{key}.webp',save_all=True,append_images=displays[1:],duration=round(1000/spec['fps']),loop=0,quality=90,method=5)
        sheet=Image.new('RGB',(4*size,spec['rows']*(size+24)),(20,28,32));draw=ImageDraw.Draw(sheet)
        for i,im in enumerate(displays):
            x=i%4*size;y=i//4*(size+24);sheet.paste(im,(x,y+24));draw.text((x+8,y+5),f'{key} / {i+1}',fill='#d0d4d3')
        sheet.save(PREVIEW/f'{key}-frames.jpg',quality=91)
        reports[key]={'pass':True,'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
          'dimensions':list(atlas.size),'frames':len(frames),'renderSeconds':spec.get('renderSeconds'),
          'packSeconds':round(time.monotonic()-started,3),'samples':spec.get('samples'),'supersample':spec.get('supersample'),
          'maxAlphaAt3PixelBorder':max(edges),'alphaMean':energy,'loopSeamDifference':seam,'medianAdjacentDifference':median,
          'losslessRoundTrip':pixel_exact,'alphaLossless':alpha_exact,'rgbEncoding':'lossless' if lossless else 'quality90',
          'alphaWeightedRgbMeanAbsoluteError':weighted_error,'nonEmptyFrames':sum(e>.00001 for e in energy)}
        print('WEATHER_PACKED',key,reports[key]['bytes'],flush=True)
    manifest={k:manifest[k] for k in sorted(manifest)}
    (OUT/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    report={'schema':1,'pass':all(r['pass'] for r in reports.values()),'effects':reports,'totalBytes':sum(r['bytes'] for r in reports.values()),
      'limitations':['Billboard flipbooks, not volumetric simulation in the client.','Client integration and depth/collision behaviour must be implemented by Claude.','Animation previews repeat one-shot effects for review.']}
    (HERE/'qa.json').write_text(json.dumps(report,indent=2),encoding='utf-8');html(manifest)
    overview=Image.new('RGB',(1024,560),(15,20,24));draw=ImageDraw.Draw(overview)
    for j,(key,spec) in enumerate(manifest.items()):
        i=int(np.argmax(reports[key]['alphaMean']));size=spec['frameSize'];x=i%spec['cols']*size;y=i//spec['cols']*size
        atlas=Image.open(OUT/f'{key}.webp').convert('RGBA');tile=over(atlas.crop((x,y,x+size,y+size)),spec['blending']).resize((256,256))
        px=j%4*256;py=j//4*280;overview.paste(tile,(px,py+24));draw.text((px+8,py+5),key,fill='#e0e0d7')
    overview.save(PREVIEW/'overview.png')


if __name__=='__main__':main()
