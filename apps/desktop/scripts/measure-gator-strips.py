"""Read-only corpus study. Retains original 2160 layers; no publication or quantization."""
from pathlib import Path
from PIL import Image
import hashlib,json,time,zlib,struct
from functools import lru_cache

out=Path('apps/desktop/artifacts/gator-raster-study');out.mkdir(exist_ok=True)
source=Path('apps/desktop/artifacts/gator-recovery/png-2160')
data=json.loads((out/'input.json').read_text());rows={r['path']:r for r in data['rows']}
used={p for t in data['tokens'] for p in t['paths']};unique={rows[p]['objectId']:rows[p] for p in used}
sizes=[16,64];signatures={s:{} for s in sizes};start=time.monotonic()
for index,(digest,row) in enumerate(unique.items()):
    with Image.open(source/row['file']) as im:
        image=im.convert('RGBA')
        for size in sizes:
            parts=[]
            for y in range(0,2160,size):
                strip=image.crop((0,y,2160,min(2160,y+size)));lo,hi=strip.getchannel('A').getextrema()
                parts.append(None if hi==0 else (hashlib.sha256(strip.tobytes()).hexdigest(),lo==255))
            signatures[size][digest]=parts
    if index%100==0: print(json.dumps({'phase':'layer analysis','images':index,'total':len(unique),'seconds':round(time.monotonic()-start)}),flush=True)
report={'resolution':[2160,2160],'originalTokenCount':len(data['tokens']),'usedPaths':len(used),'uniqueSourceImages':len(unique),'uniqueSourcePNGBytes':sum(r['storedBytes'] for r in unique.values()),'layouts':[]}
for size in sizes:
    combos=set();total=0;single=0;multiple=0
    for token in data['tokens']:
        for index in range((2160+size-1)//size):
            keys=[]
            for p in reversed(token['paths']):
                item=signatures[size][rows[p]['objectId']][index]
                if item:
                    keys.append(item[0])
                    if item[1]: break
            total+=1;single+=len(keys)==1;multiple+=len(keys)>1
            combos.add(hashlib.sha256(json.dumps([min(size,2160-index*size),keys],separators=(',',':')).encode()).digest())
    report['layouts'].append({'stripRows':size,'references':total,'distinctVisibleSourceCombinations':len(combos),'singleSourceReferences':single,'overlapReferences':multiple,'referenceBytesAt32BytesEach':total*32,'note':'Source combination count; identical composited outputs may deduplicate further. Not a compressed byte estimate.'})
    print(json.dumps(report['layouts'][-1]),flush=True)
(out/'corpus-counts.json').write_text(json.dumps(report,indent=2))
# Evenly spread fixed token IDs, not new randomized Gators.
sample=sorted({i*31%4000 for i in range(128)});sample_dir=out/'samples';sample_dir.mkdir(exist_ok=True)
byid={t['id']:t for t in data['tokens']}
@lru_cache(maxsize=12)
def load(name):
    with Image.open(source/name) as image:return image.convert('RGBA')
for index,token_id in enumerate(sample):
    target=sample_dir/f'{token_id}.png'
    if not target.exists():
        image=Image.new('RGBA',(2160,2160))
        for p in byid[token_id]['paths']:image.alpha_composite(load(rows[p]['file']))
        image.save(target,compress_level=6)
    if index%16==0:print(json.dumps({'phase':'original token composites','done':index,'total':len(sample)}),flush=True)
(out/'sample-ids.json').write_text(json.dumps(sample));print(json.dumps({'complete':True,'seconds':round(time.monotonic()-start)}),flush=True)
