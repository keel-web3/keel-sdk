"""Use the smallest sufficient field widths without changing any copy operation.
Widths widen automatically with the library; carrier size is not an artwork limit.
"""
import os,json,io
from pathlib import Path
from PIL import Image
BASE=Path('apps/desktop/artifacts/gator-raster-study/full-1080')
Q=int(os.environ.get('KEEL_JPEG_QUALITY','70'))
PARENT=BASE/f'jpeg-shared-huffman-q{Q}-r2/substrings-24'
SOURCE=PARENT/'overlap-packed';ROOT=SOURCE/'compact';ROOT.mkdir(exist_ok=True)
report=json.loads((SOURCE/'report.json').read_text());cat=(SOURCE/'instruction-ranges.bin').read_bytes()
records=[tuple(int.from_bytes(cat[i+j:i+j+2],'big') for j in range(0,6,2)) for i in range(0,len(cat),6)]
source_data={int(p.stem):p.read_bytes() for p in (PARENT/'data').glob('*.bin')}
page_width=max(1,(max(source_data).bit_length()+7)//8);assert page_width<=2
id_width=max(1,((len(records)-1).bit_length()+7)//8)
op_width=page_width+4
old_units={p:(SOURCE/f'instructions/{p}.bin').read_bytes() for p,_,_ in records}
(ROOT/'data').mkdir(exist_ok=True);(ROOT/'instructions').mkdir(exist_ok=True)
for i,b in source_data.items():(ROOT/f'data/{i}.bin').write_bytes(b)
for i,b in old_units.items():
    assert len(b)%6==0
    packed=bytearray()
    for at in range(0,len(b),6):packed.extend(int.from_bytes(b[at:at+2],'big').to_bytes(page_width,'big')+b[at+2:at+6])
    (ROOT/f'instructions/{i}.bin').write_bytes(packed)
new_records=[]
for p,o,n in records:
    assert o%6==0 and n%6==0
    new_records.append((p,o//6*op_width,n//6*op_width))
(ROOT/'instruction-ranges.bin').write_bytes(b''.join(v.to_bytes(2,'big') for r in new_records for v in r))
ids=json.loads(Path('apps/desktop/artifacts/gator-raster-study/sample-ids.json').read_text());map_bytes=0
for token in ids:
    old=(PARENT/f'token-{token}.map').read_bytes()
    packed=b''.join(int.from_bytes(old[at:at+3],'big').to_bytes(id_width,'big') for at in range(0,len(old),3))
    (ROOT/f'token-{token}.map').write_bytes(packed);map_bytes+=len(packed)
allowance=(len(source_data)+len(old_units))*20+len(ids)*6
(ROOT/'address-and-root-placeholders.bin').write_bytes(bytes(allowance))
# This descriptor is required by the new reader format and is included in the budget.
(ROOT/'codec.bin').write_bytes(b'KJC1'+bytes([page_width,id_width,op_width,16]))
new_units={i:(ROOT/f'instructions/{i}.bin').read_bytes() for i in old_units}
written_data={i:(ROOT/f'data/{i}.bin').read_bytes() for i in source_data}
for token in ids:
    packed=(ROOT/f'token-{token}.map').read_bytes();output=[];expected=[]
    for at in range(0,len(packed),id_width):
        index=int.from_bytes(packed[at:at+id_width],'big')
        p,o,n=records[index];old=old_units[p][o:o+n]
        p,o,n=new_records[index];new=new_units[p][o:o+n]
        for j in range(0,len(new),op_width):
            p=int.from_bytes(new[j:j+page_width],'big');o=int.from_bytes(new[j+page_width:j+page_width+2],'big');n=int.from_bytes(new[j+page_width+2:j+op_width],'big')
            output.append(written_data[p][o:o+n])
        for j in range(0,len(old),6):
            p,o,n=[int.from_bytes(old[j+k:j+k+2],'big') for k in range(0,6,2)];expected.append(source_data[p][o:o+n])
    rebuilt=b''.join(output);assert rebuilt==b''.join(expected),token
    im=Image.open(io.BytesIO(rebuilt));im.load();assert im.size==(1080,1080)
    original=Image.open(BASE/f'native-128-sample/token-{token}.png').convert('RGB')
    reference=io.BytesIO();original.save(reference,'JPEG',quality=Q,subsampling=2,optimize=False,progressive=False)
    assert im.convert('RGB').tobytes()==Image.open(io.BytesIO(reference.getvalue())).convert('RGB').tobytes(),token
    if token in [0,31,2790,3193]:(ROOT/f'preview-{token}.jpg').write_bytes(rebuilt)
files=[ROOT/f'data/{i}.bin' for i in source_data]+[ROOT/f'instructions/{i}.bin' for i in new_units]+[ROOT/f'token-{i}.map' for i in ids]+[ROOT/'instruction-ranges.bin',ROOT/'address-and-root-placeholders.bin',ROOT/'codec.bin']
size=sum(p.stat().st_size for p in files)
r={'quality':Q,'subsampling':'4:2:0','size':1080,'tokens':len(ids),'preparedBinaryBytes':size,'under5MillionBytes':size<5_000_000,'baselineBeforeCompactionBytes':report['preparedBinaryBytes'],'savedBytes':report['preparedBinaryBytes']-size,'pageIndexBytes':page_width,'unitIdBytes':id_width,'operationBytes':op_width,'dataBytes':sum(map(len,source_data.values())),'instructionBytes':sum(map(len,new_units.values())),'instructionRangeBytes':len(cat),'tokenMapBytes':map_bytes,'addressAndRootAllowanceBytes':allowance,'codecDescriptorBytes':8,'all128ReassembliesByteExact':True,'all128JPEGsDecoded':True,'all128MatchOrdinaryJPEGAtSelectedQuality':True,'readGas':'unmeasured','sourceArchiveIncluded':False,'sourcePixelsExact':False,'scope':'Actual encoded data, instructions, catalog, token maps, codec descriptor and address/root allowance; source archive and chain state excluded'}
(ROOT/'report.json').write_text(json.dumps(r,indent=2));print(json.dumps(r),flush=True)
