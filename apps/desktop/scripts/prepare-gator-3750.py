"""Reuse the measured per-layer codec choices at the requested 3750 resolution."""
import concurrent.futures,hashlib,json,subprocess
from pathlib import Path
from PIL import Image
root=Path('apps/desktop/artifacts/gator-ape-rebuild');out=root/'mixed-codec-test-3750';out.mkdir(exist_ok=True)
selected=json.loads((root/'mixed-codec-test-4000/alpha-0.985/selected.json').read_text());originals={r['path']:r for r in json.loads((root/'webp-token-0.json').read_text())}
def prepare(row):
 original=originals[row['path']];folder=out/original['objectId'];folder.mkdir(exist_ok=True)
 with Image.open(original['file']) as image:
  source=image.convert('RGBA').resize((3750,3750),Image.Resampling.LANCZOS);profile=image.info.get('icc_profile')
 png=folder/'source.png';source.save(png,compress_level=1,**({'icc_profile':profile} if profile else {}))
 if row['type']=='image/avif':
  file=folder/'layer.avif';command=['/opt/homebrew/bin/avifenc','-q',str(row['quality']),'--qalpha',str(row.get('alphaQuality',100)),'-y','444','-d','8','-s','6','-j','2',str(png),str(file)]
 else:
  file=folder/'layer.webp';command=['/opt/homebrew/bin/cwebp','-quiet','-lossless','-q','100','-m','6','-metadata','icc',str(png),'-o',str(file)]
 subprocess.run(command,check=True,capture_output=True)
 with Image.open(file) as check: assert check.size==(3750,3750) and check.info.get('icc_profile')==profile
 result={k:v for k,v in row.items() if k not in ['ssimBlack','ssimWhite','alphaChanges']};result.update(file=str(file.resolve()),bytes=file.stat().st_size,objectId=hashlib.sha256(file.read_bytes()).hexdigest(),width=3750,height=3750,similarityValidated=False)
 print(json.dumps({'path':row['path'],'bytes':result['bytes']}),flush=True);png.unlink();return result
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:rows=list(pool.map(prepare,selected))
(out/'selected.json').write_text(json.dumps(rows,indent=2));print(json.dumps({'totalLayerBytes':sum(r['bytes'] for r in rows),'resolution':3750,'originalsChanged':False}),flush=True)
