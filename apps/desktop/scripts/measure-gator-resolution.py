"""Measure a separate 1080-square PNG library. Never replace source layer bytes."""
from PIL import Image
from pathlib import Path
import hashlib,json,time,sys
from concurrent.futures import ThreadPoolExecutor
root=Path('/tmp/keel-gator-recovery/public/layers')
size=int(sys.argv[1]) if len(sys.argv)>1 else 1080
if size<256 or size>4525:raise ValueError('Choose a size between 256 and 4525')
out=Path(f'apps/desktop/artifacts/gator-recovery/png-{size}')
out.mkdir(parents=True,exist_ok=True)
backgrounds=Path(sys.argv[2]) if len(sys.argv)>2 else None
def source_file(p):return backgrounds/p.name if backgrounds and p.parent.name=='Background' else p
# Deduplicate jobs before concurrent encoding; identical source files share one result.
jobs={}
for p in sorted(root.glob('*/*.png')):
 raw=source_file(p).read_bytes();digest=hashlib.sha256(raw).hexdigest()
 jobs.setdefault(digest,[]).append(p)
def prepare(pair):
 source,paths=pair;p=paths[0]
 with Image.open(source_file(p)) as image:
  image.load();resized=image.convert('RGBA').resize((size,size),Image.Resampling.LANCZOS)
  target=out/(source+'.png');resized.save(target,format='PNG',optimize=True,compress_level=9,icc_profile=image.info.get('icc_profile',b''))
  with Image.open(target) as restored:
   assert restored.convert('RGBA').tobytes()==resized.tobytes(),'Resized PNG failed lossless verification'
   assert restored.info.get('icc_profile',b'')==image.info.get('icc_profile',b''),'Colour profile changed'
  data=target.read_bytes();object_id=hashlib.sha256(data).hexdigest()
  bounds=resized.getbbox()
  return [{'path':str(file.relative_to(root)),'sourceDigest':source,'originalBytes':source_file(file).stat().st_size,'storedBytes':len(data),'objectId':object_id,'file':target.name,'width':size,'height':size,'bounds':bounds,'proof':'exact-resized-rgba-and-icc','sourcePixelsChanged':True} for file in paths]
rows=[];start=time.monotonic()
with ThreadPoolExecutor(max_workers=2) as pool:
 for result in pool.map(prepare,jobs.items()):
  rows.extend(result)
  if len(rows)%25< len(result) or len(rows)==915:
   (out.with_suffix('.json')).write_text(json.dumps(rows))
   print(json.dumps({'prepared':len(rows),'total':915,'sourceBytes':sum(r['originalBytes'] for r in rows),'pngBytes':sum(r['storedBytes'] for r in rows),'uniquePNGBytes':sum(r['storedBytes'] for r in {r['objectId']:r for r in rows}.values()),'seconds':round(time.monotonic()-start)}),flush=True)
(out.with_suffix('.json')).write_text(json.dumps(rows))
