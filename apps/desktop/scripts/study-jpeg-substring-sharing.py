"""Exact substring dictionary across JPEG sections; direct copies, no recursive decoder.
Greedy, bounded candidate search. Includes physical split and instruction overhead.
"""
import os,json,io
from pathlib import Path
from PIL import Image
BASE=Path('apps/desktop/artifacts/gator-raster-study/full-1080')
Q=int(os.environ.get('KEEL_JPEG_QUALITY','75'))
MIN=int(os.environ.get('KEEL_JPEG_MIN_MATCH','24'))
SOURCE=BASE/f'jpeg-shared-huffman-q{Q}-r2'
ROOT=SOURCE/f'substrings-{MIN}';ROOT.mkdir(exist_ok=True)
report=json.loads((SOURCE/'report.json').read_text());source=(SOURCE/'library.bin').read_bytes()
ranges=json.loads((SOURCE/'ranges.json').read_text());sections=[source[o:o+n] for o,n in ranges]
pool=bytearray();index={};next_index=0;plans=[None]*len(sections)
ANCHOR=min(12,MIN);STRIDE=int(os.environ.get("KEEL_JPEG_ANCHOR_STRIDE","4"));CANDIDATES=4
assert MIN>=6 and STRIDE>=1

def append(literal):
    global next_index
    offset=len(pool);pool.extend(literal)
    while next_index+ANCHOR<=len(pool):
        key=bytes(pool[next_index:next_index+ANCHOR]);positions=index.setdefault(key,[])
        if len(positions)<CANDIDATES:positions.append(next_index)
        else:positions[-1]=next_index
        next_index+=STRIDE
    return offset,len(literal)

def physical(ops):
    result=[]
    for offset,length in ops:
        while length:
            n=min(length,23000-offset%23000);p=offset//23000;o=offset%23000
            if result and result[-1][0]==p and result[-1][1]+result[-1][2]==o:
                result[-1]=(p,result[-1][1],result[-1][2]+n)
            else:result.append((p,o,n))
            offset+=n;length-=n
    return result

for done,section_id in enumerate(sorted(range(len(sections)),key=lambda i:(-len(sections[i]),i)),1):
    section=sections[section_id];at=0;literal_start=0;candidate=[]
    while at+ANCHOR<=len(section):
        best_offset=0;best_length=0
        for offset in index.get(section[at:at+ANCHOR],[]):
            n=ANCHOR;limit=min(len(section)-at,len(pool)-offset)
            while n<limit and section[at+n]==pool[offset+n]:n+=1
            if n>best_length:best_offset,best_length=offset,n
        if best_length>=MIN:
            if literal_start<at:candidate.append(section[literal_start:at])
            candidate.append((best_offset,best_length));at+=best_length;literal_start=at
        else:at+=1
    if literal_start<len(section):candidate.append(section[literal_start:])
    # Reject decompositions whose newly stored literals + direct instructions cost more.
    if sum(len(x) for x in candidate if isinstance(x,bytes))+len(candidate)*6>=len(section)+6:
        candidate=[section]
    ops=[append(x) if isinstance(x,bytes) else x for x in candidate]
    assert b''.join(pool[o:o+n] for o,n in ops)==section
    plans[section_id]=physical(ops)
    if done%10000==0:print(json.dumps({'phase':'substring-dictionary','sections':done,'poolBytes':len(pool)}),flush=True)

(ROOT/'library.bin').write_bytes(pool)
(ROOT/'section-plans.json').write_text(json.dumps(plans))
# The runtime executes only direct carrier-range copies. Different section plans
# are flattened offline and repeated copy instruction groups shared across tokens.
groups={4:{},8:{},16:{}};refs={n:0 for n in groups};group_sequences={n:[] for n in groups}
read_ops=[];token_ids=json.loads(Path('apps/desktop/artifacts/gator-raster-study/sample-ids.json').read_text())
for token in token_ids:
    raw=(SOURCE/f'token-{token}.map').read_bytes();ids=[int.from_bytes(raw[i:i+3],'big') for i in range(0,len(raw),3)]
    ops=[op for i in ids for op in plans[i]]
    # Coalesce adjacent physical copies after section expansion as well.
    flat=[]
    for p,o,n in ops:
        if flat and flat[-1][0]==p and flat[-1][1]+flat[-1][2]==o:flat[-1]=(p,flat[-1][1],flat[-1][2]+n)
        else:flat.append((p,o,n))
    restored=b''.join(pool[p*23000+o:p*23000+o+n] for p,o,n in flat)
    expected=b''.join(sections[i] for i in ids);assert restored==expected,token
    im=Image.open(io.BytesIO(restored));im.load();assert im.size==(1080,1080)
    read_ops.append(len(flat))
    for width in groups:
        sequence=[]
        for at in range(0,len(flat),width):
            group=tuple(flat[at:at+width])
            if group not in groups[width]:groups[width][group]=len(groups[width])
            sequence.append(groups[width][group]);refs[width]+=1
        group_sequences[width].append((token,sequence))

layouts=[]
for width,dictionary in groups.items():
    instructions=sum(len(g)*6 for g in dictionary)
    # Six-byte range per group, three-byte group IDs. No per-image-section catalog.
    total=len(pool)+instructions+len(dictionary)*6+refs[width]*3
    layouts.append({'groupWidth':width,'preparedBytesBeforeAddressAndRootAllowance':total,'instructionBytes':instructions,'instructionRangeBytes':len(dictionary)*6,'tokenMapBytes':refs[width]*3,'uniqueGroups':len(dictionary)})
best=min(layouts,key=lambda v:v['preparedBytesBeforeAddressAndRootAllowance']);width=best['groupWidth']
# Write data and instruction carriers plus real binary range records and token maps.
(ROOT/'data').mkdir(exist_ok=True);(ROOT/'instructions').mkdir(exist_ok=True)
data_pages=0
for at in range(0,len(pool),23000):
    (ROOT/f'data/{data_pages}.bin').write_bytes(pool[at:at+23000]);data_pages+=1
page=bytearray();unit_pages=0;catalog=[];ordered=[None]*len(groups[width])
for group,i in groups[width].items():ordered[i]=group
for group in ordered:
    b=b''.join(v.to_bytes(2,'big') for op in group for v in op)
    if len(page)+len(b)>23000:
        (ROOT/f'instructions/{unit_pages}.bin').write_bytes(page);unit_pages+=1;page.clear()
    catalog.append((unit_pages,len(page),len(b)));page.extend(b)
if page:(ROOT/f'instructions/{unit_pages}.bin').write_bytes(page);unit_pages+=1
(ROOT/'instruction-ranges.bin').write_bytes(b''.join(v.to_bytes(2,'big') for record in catalog for v in record))
for token,sequence in group_sequences[width]:(ROOT/f'token-{token}.map').write_bytes(b''.join(i.to_bytes(3,'big') for i in sequence))
allowance=(data_pages+unit_pages)*20+len(token_ids)*6
(ROOT/'address-and-root-placeholders.bin').write_bytes(bytes(allowance))
# Independent read of the written files, using only the serialized recipe format.
data=[(ROOT/f'data/{i}.bin').read_bytes() for i in range(data_pages)]
units=[(ROOT/f'instructions/{i}.bin').read_bytes() for i in range(unit_pages)]
cat=(ROOT/'instruction-ranges.bin').read_bytes()
for token in token_ids:
    raw=(ROOT/f'token-{token}.map').read_bytes();out=[]
    for at in range(0,len(raw),3):
        i=int.from_bytes(raw[at:at+3],'big');r=cat[i*6:i*6+6]
        p,o,n=[int.from_bytes(r[j:j+2],'big') for j in range(0,6,2)]
        recipe=units[p][o:o+n]
        for j in range(0,len(recipe),6):
            p,o,n=[int.from_bytes(recipe[j+k:j+k+2],'big') for k in range(0,6,2)];out.append(data[p][o:o+n])
    old=(SOURCE/f'token-{token}.map').read_bytes();expected=b''.join(sections[int.from_bytes(old[i:i+3],'big')] for i in range(0,len(old),3))
    assert b''.join(out)==expected,token
r={'quality':Q,'size':1080,'tokens':len(token_ids),'minMatch':MIN,'anchorBytes':ANCHOR,'anchorStride':STRIDE,'poolBytes':len(pool),'originalImageBytes':len(source),'poolSavingBytes':len(source)-len(pool),'groupLayouts':layouts,'selectedGroupWidth':width,'preparedBinaryBytes':best['preparedBytesBeforeAddressAndRootAllowance']+allowance,'addressAndRootAllowanceBytes':allowance,'baselinePackedBytes':json.loads((SOURCE/'packed/report.json').read_text())['preparedBinaryBytes'] if (SOURCE/'packed/report.json').exists() else None,'all128DiskReassembliesByteExact':True,'all128DecodedJPEGsValid':True,'maxDirectCopiesPerImage':max(read_ops),'meanDirectCopiesPerImage':sum(read_ops)/len(read_ops),'readGas':'unmeasured','sourceArchiveIncluded':False,'scope':'Written direct-copy data and instruction carriers, binary catalogs and token maps, plus address/root allowances; source archive and chain state excluded'}
(ROOT/'report.json').write_text(json.dumps(r,indent=2));print(json.dumps(r),flush=True)
