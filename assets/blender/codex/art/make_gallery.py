"""Build a local, dependency-free gallery of the inspected angles and critiques."""
import json, hashlib
from PIL import Image
from pathlib import Path
HERE=Path(__file__).resolve().parent
OUT=HERE/'previews'
groups=[('house','Maison / accès','L’escalier est soutenu jusqu’au sol et le palier rejoint le seuil.','Maçonnerie encore régulière ; façade fermée, sans contrôle de navigation en jeu.'),('cliff','Falaise et château','Relief continu issu de bruit fractal et érosion ; accès et fondations conservés.','Roche encore trop arrondie par endroits ; architecture propre et cylindrique.'),('cliff_back','Château / arrière','Volumes et ouvertures vérifiés hors du cadrage principal.','Le contre-jour masque certains détails de matériaux.'),('cemetery','Cimetière','Ruine ouverte, tombes variées et arche qui cadre la destination.','Horizon et terrain encore plats ; végétation répétitive.'),('lair','Antre du Golem','Échelle humaine, contraste renforcé et colonnes brisées.','Style encore géométrique ; certains matériaux sont trop uniformes.'),('forest','Forêt','Fond densifié, racines raccourcies, stèle de pierre aux glyphes fins.','Ramifications encore régulières ; tache lumineuse marquée sur le sentier.')]
data=[]
for key,title,good,bad in groups:
 files=sorted((OUT/'angles').glob(key+'-*.webp'))
 data.append(dict(key=key,title=title,good=good,bad=bad,images=[dict(file='angles/'+p.name,before=('angles-before/'+p.name) if (OUT/'angles-before'/p.name).exists() else None,title=p.stem[len(key)+1:]) for p in files]))
html='''<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Brumeval — revue multiangle</title><style>
*{box-sizing:border-box}body{margin:0;background:#101719;color:#e2e1d9;font:16px system-ui,sans-serif}header{padding:22px 28px;border-bottom:1px solid #384142}h1{font-size:24px;margin:0 0 8px}p{line-height:1.5}header p{margin:0;color:#aab7b6}nav{display:flex;gap:8px;flex-wrap:wrap;padding:18px 28px}button{font:inherit;color:inherit;background:#202c2d;border:1px solid #465252;border-radius:7px;padding:9px 14px;cursor:pointer}button.active{background:#b59a62;color:#101719;border-color:#b59a62}button:disabled{opacity:.35;cursor:default}main{display:grid;grid-template-columns:minmax(0,1fr) 290px;gap:22px;padding:0 28px 28px}figure{margin:0}#hero{display:block;width:100%;height:min(64vh,740px);object-fit:contain;background:#080b0c;border:1px solid #384142}figcaption{padding:12px 0;color:#c6c9c3}.bar{display:flex;gap:8px;align-items:center;margin:8px 0 15px}.bar span{flex:1}.thumbs{display:flex;gap:9px;overflow:auto;padding:2px 0 12px}.thumbs button{padding:3px;min-width:112px}.thumbs img{display:block;width:108px;height:72px;object-fit:cover}.thumbs small{font-size:11px}aside{background:#172123;border:1px solid #354344;border-radius:10px;padding:18px;height:fit-content}aside h2{font-size:18px;margin:0 0 18px}aside h3{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:#bcac85}aside p{font-size:14px}a{color:#dcc48d}footer{border-top:1px solid #354344;padding:18px 28px;font-size:13px;color:#acb7b6} @media(max-width:850px){main{grid-template-columns:1fr}#hero{height:auto}header,nav,main{padding-left:15px;padding-right:15px}}
</style><header><h1>Brumeval — revue multiangle</h1><p>23 vues + 3 gros plans · 3 sous-agents · critiques positives et négatives · comparaison avant / après</p></header><nav id="tabs" aria-label="Scènes"></nav><main><section><figure><img id="hero" alt=""><figcaption id="caption"></figcaption></figure><div class="bar"><button id="prev" aria-label="Vue précédente">←</button><span id="count"></span><button id="before">Voir avant correction</button><button id="next" aria-label="Vue suivante">→</button></div><div class="thumbs" id="thumbs"></div></section><aside><h2 id="title"></h2><h3>Points positifs</h3><p id="good"></p><h3>Réserves artistiques</h3><p id="bad"></p><h3>Correction de la maison</h3><p>8 contremarches d’environ 16,16 cm. Marches pleines, ancrées sous le terrain. Palier aligné sur le seuil. Végétation retirée des accès.</p><p><a href="weathering/03-fondations.webp">Raccord des fondations, détail</a><br><a href="weathering/01-banniere.webp">Bannière vieillie, détail</a><br><a href="weathering/02-herse.webp">Pierre et fer, détail</a><br><a href="../WEATHERING_METHOD.md">Choix des masques par matière</a><br><a href="terrain-comparison.jpg">Terrain : avant / après</a><br><a href="../TERRAIN_METHOD.md">Méthode et références terrain</a><br><a href="grass-density.png">Carte de densité végétale</a><br><a href="grass-comparison.jpg">Herbe : avant / après</a><br><a href="../GRASS_REVIEW.md">Critique de la nouvelle herbe</a><br><a href="../check_access.json">Mesures des cinq accès</a><br><a href="angles/ACCESS_AND_CLIFF_REVIEW.md">Critique accès et falaise</a><br><a href="angles/FINAL_SCENE_REVIEW.md">Critique des autres scènes</a></p></aside></main><footer>Scènes Blender pour les illustrations fixes CX-1. Les captures vérifient les volumes et raccords représentés ; elles ne constituent pas un test de collisions dans le jeu. La direction artistique reste à relire.</footer><script>
const groups=DATA;let g=0,i=0,before=false;const el=id=>document.getElementById(id);
function draw(){const group=groups[g],im=group.images[i];el('tabs').innerHTML='';groups.forEach((x,j)=>{let b=document.createElement('button');b.textContent=x.title;b.className=j===g?'active':'';b.onclick=()=>{g=j;i=0;before=false;draw()};el('tabs').append(b)});el('hero').src=before&&im.before?im.before:im.file;el('hero').alt=group.title+' — '+im.title;el('caption').textContent=(before?'AVANT · ':'APRÈS · ')+group.title+' — '+im.title;el('title').textContent=group.title;el('good').textContent=group.good;el('bad').textContent=group.bad;el('count').textContent=(i+1)+' / '+group.images.length;el('before').disabled=!im.before;el('before').textContent=before?'Voir après correction':'Voir avant correction';el('thumbs').innerHTML='';group.images.forEach((x,j)=>{let b=document.createElement('button');b.className=j===i?'active':'';let image=document.createElement('img');image.src=x.file;image.alt=x.title;b.append(image);let s=document.createElement('small');s.textContent=x.title;b.append(s);b.onclick=()=>{i=j;before=false;draw()};el('thumbs').append(b)})}
function move(n){i=(i+n+groups[g].images.length)%groups[g].images.length;before=false;draw()}el('prev').onclick=()=>move(-1);el('next').onclick=()=>move(1);el('before').onclick=()=>{before=!before;draw()};document.addEventListener('keydown',e=>{if(e.key==='ArrowLeft')move(-1);if(e.key==='ArrowRight')move(1)});draw();
</script></html>'''.replace('DATA',json.dumps(data,ensure_ascii=False))
(OUT/'review.html').write_text(html,encoding='utf-8')
assert sum(len(g['images']) for g in data)==23
print('Gallery: 23 views, six scenes, before/after links verified')

checks=[]
for path in sorted((OUT/'angles').glob('*.webp')):
    im=Image.open(path);im.load()
    assert im.size==(960,640),(path.name,im.size)
    extrema=im.convert('RGB').getextrema()
    assert max(v[1] for v in extrema)>0,path.name
    checks.append(dict(file=path.name,size=im.size,extrema=extrema,sha256=hashlib.sha256(path.read_bytes()).hexdigest()))
assert len(checks)==23
(OUT/'angles/capture-check.json').write_text(json.dumps(checks,indent=2)+'\n',encoding='utf-8')
print('PASS: 23 decoded 960x640 nonblank captures with SHA-256')

# Close views make foundation contact and material wear reviewable at useful scale.
details=[]
for path in sorted((OUT/'weathering').glob('*.webp')):
    im=Image.open(path);im.load();assert im.size==(960,640)
    details.append(dict(file=path.name,size=im.size,sha256=hashlib.sha256(path.read_bytes()).hexdigest()))
assert len(details)==3
(OUT/'weathering/capture-check.json').write_text(json.dumps(details,indent=2)+'\n',encoding='utf-8')
print('PASS: 3 material/contact close views')
