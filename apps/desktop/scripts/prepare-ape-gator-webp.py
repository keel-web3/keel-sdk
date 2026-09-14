"""Native lossless copies, original resolution; full RGBA and ICC round-trip proof."""
import argparse, hashlib, json, subprocess, concurrent.futures
from pathlib import Path
from PIL import Image

p=argparse.ArgumentParser();p.add_argument('--root',default='apps/desktop/artifacts/gator-ape-rebuild');p.add_argument('--source',default='/tmp/keel-gator-recovery/public/layers');p.add_argument('--token',type=int);p.add_argument('--workers',type=int,default=2);a=p.parse_args()
root=Path(a.root).resolve(); source=Path(a.source).resolve();out=root/'webp';out.mkdir(exist_ok=True)
audit=json.loads((root/'layer-audit.json').read_text())
tokens=[t for t in audit['tokens'] if a.token is None or t['tokenId']==a.token]
if not tokens: raise RuntimeError('No matched tokens to prepare')
paths=sorted({p for t in tokens for p in t['stack']})
restored=Path('apps/desktop/artifacts/gator-recovery/recovered-backgrounds').resolve()
sha=lambda b:hashlib.sha256(b).hexdigest()
def prepare(name):
 original=(restored/Path(name).name) if name.startswith('Background/') else source/name
 data=original.read_bytes();source_hash=sha(data);file=out/(source_hash+'.webp');proof_file=out/(source_hash+'.json')
 if proof_file.exists():
  proof=json.loads(proof_file.read_text())
  if proof['sourceDigest']!=source_hash or sha(file.read_bytes())!=proof['objectId']:raise RuntimeError('Invalid conversion cache')
  return dict(proof,path=name)
 # Prevent silent precision loss or conversion of an animated source.
 if data[:8]!=b'\x89PNG\r\n\x1a\n' or data[24]==16:raise RuntimeError('Expected an 8-bit or indexed PNG: '+name)
 with Image.open(original) as im:
  if getattr(im,'n_frames',1)!=1:raise RuntimeError('Animated source needs an animation renderer')
  size=im.size;profile=im.info.get('icc_profile');rgba=im.convert('RGBA').tobytes()
 temporary=file.with_suffix('.tmp.webp')
 subprocess.run(['cwebp','-quiet','-lossless','-exact','-q','100','-m','6','-metadata','icc',str(original),'-o',str(temporary)],check=True)
 with Image.open(temporary) as im:
  if im.size!=size or im.convert('RGBA').tobytes()!=rgba:raise RuntimeError('Lossless pixel verification failed: '+name)
  if im.info.get('icc_profile')!=profile:raise RuntimeError('ICC verification failed: '+name)
 encoded=temporary.read_bytes();temporary.replace(file)
 proof={'sourcePath':str(original),'sourceDigest':source_hash,'objectId':sha(encoded),'file':str(file),'type':'image/webp','width':size[0],'height':size[1],'originalBytes':len(data),'storedBytes':len(encoded),'pixelDigest':sha(rgba),'proof':'exact-rgba-and-icc-roundtrip','lossless':True,'resized':False}
 proof_file.write_text(json.dumps(proof,indent=2));return dict(proof,path=name)
rows=[]
# Deduplicate byte-identical sources before workers; avoid cache-file races.
groups={}
for name in paths:
 original=(restored/Path(name).name) if name.startswith('Background/') else source/name
 groups.setdefault(sha(original.read_bytes()),[]).append(name)
with concurrent.futures.ThreadPoolExecutor(max_workers=max(1,min(a.workers,4))) as pool:
 for proof in pool.map(prepare,[names[0] for names in groups.values()]):
  rows.extend(dict(proof,path=name) for name in groups[proof['sourceDigest']])
  print(json.dumps({'preparedPaths':len(rows),'totalPaths':len(paths),'uniqueObjects':len({r['objectId'] for r in rows})}),flush=True)
manifest=root/('webp-token-'+str(a.token)+'.json' if a.token is not None else 'webp-assets.json');manifest.write_text(json.dumps(rows,indent=2))
unique={r['objectId']:r for r in rows}
print(json.dumps({'manifest':str(manifest),'paths':len(rows),'uniqueObjects':len(unique),'storedBytes':sum(r['storedBytes'] for r in unique.values()),'resized':False,'lossless':True}),flush=True)
