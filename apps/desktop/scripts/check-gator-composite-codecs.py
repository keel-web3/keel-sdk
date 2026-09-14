import json,runpy,os
from pathlib import Path
from PIL import Image
ssim=runpy.run_path('apps/desktop/scripts/benchmark-gator-mixed-codecs.py')['ssim']
root=Path('apps/desktop/artifacts/gator-ape-rebuild');dimension=int(os.environ.get('KEEL_GATOR_SIZE','4525'));out=root/('mixed-codec-test' if dimension==4525 else f'mixed-codec-test-{dimension}')
audit=json.loads((root/'layer-audit.json').read_text());stack=next(r['stack'] for r in audit['tokens'] if r['tokenId']==0)
report=json.loads((out/'report.json').read_text());by_path={r['path']:r for r in report['layers']}
reference=Image.open(root/'reference-0.png').convert('RGB')
regions={'full':(0,0,4525,4525),'art':(350,1500,4250,3650),'head':(2500,1700,4200,2450),'jacket':(750,2150,2900,3150),'lava':(420,1510,1500,2500)}
for name,box in regions.items(): reference.crop(box).save(out/(name+'-reference.png'),compress_level=1)
results=[]
for threshold in [0.99,0.985,0.98,0.975,0.97]:
 folder=out/('composite-'+str(threshold));folder.mkdir(exist_ok=True);selected=[];canvas=Image.new('RGBA',(dimension,dimension))
 for name in stack:
  row=by_path[name];accepted=[c for c in row['candidates'] if min(c['ssimBlack'],c['ssimWhite'])>=threshold];best=min(accepted,key=lambda c:c['bytes'])
  selected.append({**best,'path':name,'width':dimension,'height':dimension,'sourcePath':row['sourcePath'],'sourceDigest':row['sourceDigest']})
  with Image.open(best['file']) as im: canvas=Image.alpha_composite(canvas,im.convert('RGBA'))
 canvas.convert('RGB').save(folder/'composite.png',compress_level=1)
 scores={}
 restored=canvas.convert('RGB').resize((4525,4525),Image.Resampling.LANCZOS)
 for name,box in regions.items():
  candidate=folder/(name+'.png');restored.crop(box).save(candidate,compress_level=1);scores[name]=ssim(out/(name+'-reference.png'),candidate)
 (folder/'selected.json').write_text(json.dumps(selected,indent=2))
 result={'resolution':dimension,'selectionFloor':threshold,'layerBytes':sum(r['bytes'] for r in selected),'ssimToPublishedPNG':scores,'allRegionsAbove99':min(scores.values())>=.99,'folder':str(folder)}
 results.append(result);print(json.dumps(result),flush=True)
(out/'composition-similarity.json').write_text(json.dumps(results,indent=2))
