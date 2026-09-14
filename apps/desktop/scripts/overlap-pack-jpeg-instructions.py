"""Pack overlapping direct-copy recipes into shared contiguous byte ranges.
Recipe IDs and every operation remain unchanged. Deterministic bounded greedy packing.
"""
import os,json
from pathlib import Path
BASE=Path('apps/desktop/artifacts/gator-raster-study/full-1080')
Q=int(os.environ.get('KEEL_JPEG_QUALITY','70'))
SOURCE=BASE/f'jpeg-shared-huffman-q{Q}-r2/substrings-24'
ROOT=SOURCE/'overlap-packed';ROOT.mkdir(exist_ok=True)
report=json.loads((SOURCE/'report.json').read_text());raw=(SOURCE/'instruction-ranges.bin').read_bytes()
records=[tuple(int.from_bytes(raw[i+j:i+j+2],'big') for j in range(0,6,2)) for i in range(0,len(raw),6)]
pages={p:(SOURCE/f'instructions/{p}.bin').read_bytes() for p,_,_ in records}
units=[pages[p][o:o+n] for p,o,n in records];count=len(units)
assert all(len(b)%6==0 for b in units)
prev=[None]*count;nxt=[None]*count;overlap=[0]*count;parent=list(range(count))
def find(i):
    while parent[i]!=i:parent[i]=parent[parent[i]];i=parent[i]
    return i
merges=0
for width in range(max(map(len,units))-6,0,-6):
    prefixes={}
    for i,b in enumerate(units):
        if prev[i] is None and len(b)>width:prefixes.setdefault(b[:width],[]).append(i)
    for left,b in enumerate(units):
        if nxt[left] is not None or len(b)<=width:continue
        options=prefixes.get(b[-width:],[])
        # Discard consumed heads; retain bounded deterministic candidate exploration.
        candidates=[i for i in options if prev[i] is None]
        prefixes[b[-width:]]=candidates
        for right in candidates[:16]:
            if find(left)==find(right):continue
            nxt[left]=right;prev[right]=left;overlap[right]=width;parent[find(right)]=find(left);merges+=1;break

(ROOT/'instructions').mkdir(exist_ok=True)
new_records=[None]*count;out_pages=[];page=bytearray();saved_overlap=0
for head in range(count):
    if prev[head] is not None:continue
    i=head
    while i is not None:
        b=units[i];shared=overlap[i] if i!=head else 0
        if len(page)+len(b)-shared>23000:
            out_pages.append(bytes(page));page.clear();shared=0
        if shared:assert bytes(page[-shared:])==b[:shared]
        new_records[i]=(len(out_pages),len(page)-shared,len(b));page.extend(b[shared:]);saved_overlap+=shared
        i=nxt[i]
if page:out_pages.append(bytes(page))
assert all(r is not None for r in new_records)
for i,b in enumerate(out_pages):(ROOT/f'instructions/{i}.bin').write_bytes(b)
new_catalog=b''.join(v.to_bytes(2,'big') for r in new_records for v in r)
(ROOT/'instruction-ranges.bin').write_bytes(new_catalog)
written=[(ROOT/f'instructions/{i}.bin').read_bytes() for i in range(len(out_pages))]
for i,(p,o,n) in enumerate(new_records):assert written[p][o:o+n]==units[i]
# Rebuild all 128 JPEGs from new recipe ranges; source data/maps are reused unchanged.
ids=json.loads(Path('apps/desktop/artifacts/gator-raster-study/sample-ids.json').read_text())
data={int(p.stem):p.read_bytes() for p in (SOURCE/'data').glob('*.bin')}
for token in ids:
    m=(SOURCE/f'token-{token}.map').read_bytes();expected=[];actual=[]
    for at in range(0,len(m),3):
        i=int.from_bytes(m[at:at+3],'big');p,o,n=new_records[i]
        for recipe,out in [(units[i],expected),(written[p][o:o+n],actual)]:
            for j in range(0,len(recipe),6):
                p,o,n=[int.from_bytes(recipe[j+k:j+k+2],'big') for k in range(0,6,2)];out.append(data[p][o:o+n])
    assert b''.join(actual)==b''.join(expected),token
instruction_bytes=sum(map(len,out_pages));old_instruction_bytes=sum(map(len,pages.values()))
old_allowance=report['addressAndRootAllowanceBytes']
allowance=(len(data)+len(out_pages))*20+len(ids)*6
size=report['preparedBinaryBytes']-old_instruction_bytes-old_allowance+instruction_bytes+allowance
r={'quality':Q,'size':1080,'tokens':len(ids),'preparedBinaryBytes':size,'baselineSubstringBytes':report['preparedBinaryBytes'],'savedBytes':report['preparedBinaryBytes']-size,'instructionBytes':instruction_bytes,'oldInstructionBytes':old_instruction_bytes,'addressAndRootAllowanceBytes':allowance,'merges':merges,'overlapBytes':saved_overlap,'allRecipesByteExact':True,'all128JPEGReassembliesByteExact':True,'readGas':'unmeasured','sourceArchiveIncluded':False,'scope':'New recipe carriers and catalog plus unchanged source data/maps and counted address/root allowances; original archive and chain state excluded'}
(ROOT/'report.json').write_text(json.dumps(r,indent=2));print(json.dumps(r),flush=True)
