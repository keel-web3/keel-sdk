"""Create isolated resized layers/reference composites. Original images stay untouched."""
from PIL import Image
from pathlib import Path
from functools import lru_cache
import json,sys,hashlib
size=int(sys.argv[1]) if len(sys.argv)>1 else 1080
if size not in (1080,2160):raise ValueError('Choose a measured size')
root=Path('apps/desktop/artifacts/gator-raster-study');data=json.loads((root/'input.json').read_text());rows={r['path']:r for r in data['rows']}
ids=set(json.loads((root/'sample-ids.json').read_text()));tokens=[t for t in data['tokens'] if t['id'] in ids]
out=root/f'adaptive-{size}';(out/'assets').mkdir(parents=True,exist_ok=True);(out/'references').mkdir(exist_ok=True)
used={p for t in tokens for p in t['paths']};unique={rows[p]['objectId']:rows[p] for p in used}
for digest,row in unique.items():
    target=out/'assets'/f'{digest}.png'
    if target.exists():continue
    with Image.open(Path('apps/desktop/artifacts/gator-recovery/png-2160')/row['file']) as image:
        image=image.convert('RGBA')
        if size!=2160:image=image.resize((size,size),Image.Resampling.LANCZOS)
        image.save(target,compress_level=6)
@lru_cache(maxsize=16)
def load(digest):
    with Image.open(out/'assets'/f'{digest}.png') as image:return image.convert('RGBA')
manifest=[]
for i,token in enumerate(tokens):
    sources=[rows[p]['objectId'] for p in token['paths']];target=out/'references'/f'{token["id"]}.png'
    if not target.exists():
        image=Image.new('RGBA',(size,size))
        for source in sources:image.alpha_composite(load(source))
        image.save(target,compress_level=6)
    manifest.append({'tokenId':token['id'],'sources':sources})
    if i%32==0:print(json.dumps({'resolution':size,'references':i,'total':len(tokens)}),flush=True)
(out/'inputs.json').write_text(json.dumps(manifest));print(json.dumps({'ready':True,'size':size,'tokens':len(tokens),'sourceImages':len(unique)}),flush=True)
