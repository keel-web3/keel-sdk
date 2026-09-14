"""Candidate alpha compression with measured black/white matte error; no publication."""
import concurrent.futures,hashlib,json,runpy,subprocess
from pathlib import Path
from PIL import Image
helpers=runpy.run_path('apps/desktop/scripts/benchmark-gator-mixed-codecs.py');ssim=helpers['ssim'];matte=helpers['matte']
root=Path('apps/desktop/artifacts/gator-ape-rebuild/mixed-codec-test-4000')
report=json.loads((root/'report.json').read_text());by_path={r['path']:r for r in report['layers']}
tasks={}
for floor in ['0.985','0.98','0.975']:
 for row in json.loads((root/f'composite-{floor}/selected.json').read_text()): tasks[(row['path'],str(row['quality']))]=row

def optimize(row):
 source_path=Path(by_path[row['path']]['best']['file']).parent/'resized-source.png'
 if by_path[row['path']].get('fullyTransparent'):return {**row,'alphaQuality':100}
 # Every resized source was kept next to its original candidate directory.
 if not source_path.exists(): raise RuntimeError('Missing resized source: '+str(source_path))
 folder=source_path.parent/'alpha-optimized';folder.mkdir(exist_ok=True)
 quality=100 if row['quality']=='lossless' else row['quality'];target=folder/f'colour-{quality}-alpha-80.avif'
 subprocess.run(['/opt/homebrew/bin/avifenc','-q',str(quality),'--qalpha','80','-y','444','-d','8','-s','6','-j','2',str(source_path),str(target)],check=True,capture_output=True)
 original_file=Image.open(source_path);source=original_file.convert('RGBA');decoded_file=Image.open(target);decoded=decoded_file.convert('RGBA')
 assert source.size==decoded.size and original_file.info.get('icc_profile')==decoded_file.info.get('icc_profile')
 box=source.getchannel('A').getbbox();box=(max(0,box[0]-16),max(0,box[1]-16),min(source.width,box[2]+16),min(source.height,box[3]+16));scores=[]
 for colour in [0,255]:
  a=folder/f'{quality}-reference-{colour}.png';b=folder/f'{quality}-test-{colour}.png';matte(source,colour,box).save(a,compress_level=1);matte(decoded,colour,box).save(b,compress_level=1);scores.append(ssim(a,b));a.unlink();b.unlink()
 result={**row,'file':str(target.resolve()),'type':'image/avif','quality':quality,'alphaQuality':80,'bytes':target.stat().st_size,'ssimBlack':scores[0],'ssimWhite':scores[1],'objectId':hashlib.sha256(target.read_bytes()).hexdigest()}
 if result['bytes']>=row['bytes']:result={**row,'alphaQuality':100}
 print(json.dumps({'path':row['path'],'quality':quality,'oldBytes':row['bytes'],'bytes':result['bytes'],'ssim':scores}),flush=True)
 return result
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(optimize,tasks.values()))
lookup={(r['path'],str(r['quality'])):r for r in results}
for floor in ['0.985','0.98','0.975']:
 selected=[]
 for row in json.loads((root/f'composite-{floor}/selected.json').read_text()):
  key=(row['path'],'100' if row['quality']=='lossless' and not by_path[row['path']].get('fullyTransparent') else str(row['quality']))
  selected.append(lookup.get(key,row))
 out=root/f'alpha-{floor}';out.mkdir(exist_ok=True);(out/'selected.json').write_text(json.dumps(selected,indent=2))
 print(json.dumps({'folder':str(out),'sourceLayerBytes':sum(r['bytes'] for r in selected)}),flush=True)
(root/'alpha-optimization.json').write_text(json.dumps(results,indent=2))
