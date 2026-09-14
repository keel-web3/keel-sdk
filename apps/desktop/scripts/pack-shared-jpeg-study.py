"""Materialize and verify the binary JPEG study layout, including address allowances.
No deployment, signing, or original-source edits. Physical carriers can split sections.
"""
import json, os, io
from pathlib import Path
from PIL import Image
BASE=Path('apps/desktop/artifacts/gator-raster-study/full-1080')
SOURCE=BASE/os.environ.get('KEEL_JPEG_PACKAGE_SOURCE','jpeg-shared-huffman-q60-r2')
ROOT=SOURCE/'packed';ROOT.mkdir(exist_ok=True)
report=json.loads((SOURCE/'report.json').read_text())
raw=(SOURCE/'library.bin').read_bytes();ranges=json.loads((SOURCE/'ranges.json').read_text())
sections=[raw[o:o+n] for o,n in ranges]
WIDTH=min(report['groupLayouts'],key=lambda v:v['preparedBytes'])['groupWidth']

class Pages:
    def __init__(self,kind):
        self.root=ROOT/kind;self.root.mkdir(exist_ok=True)
        self.pages=[];self.page=bytearray();self.ranges=[]
    def add(self,b):
        ids=[]
        for at in range(0,len(b),23000):
            piece=b[at:at+23000]
            if len(self.page)+len(piece)>23000:self.flush()
            ids.append(len(self.ranges));self.ranges.append((len(self.pages),len(self.page),len(piece)));self.page.extend(piece)
        return ids
    def flush(self):
        if self.page:
            b=bytes(self.page);(self.root/f'{len(self.pages)}.bin').write_bytes(b);self.pages.append(b);self.page.clear()
    def finish(self,name):
        self.flush()
        packed=b''.join(v.to_bytes(2,'big') for record in self.ranges for v in record)
        (ROOT/name).write_bytes(packed)
    def read_disk(self,index,catalog):
        record=catalog[index*6:index*6+6]
        p,o,n=[int.from_bytes(record[i:i+2],'big') for i in range(0,6,2)]
        # Disk pages are loaded separately after construction to verify written bytes.
        return self.loaded[p][o:o+n]
    def load(self):self.loaded=[(self.root/f'{i}.bin').read_bytes() for i in range(len(self.pages))]

data=Pages('data');expanded=[data.add(s) for s in sections];data.finish('data-ranges.bin')
unit=Pages('instructions');dictionary={};programs=[]
for file in sorted(SOURCE.glob('token-*.map')):
    original=file.read_bytes();ids=[int.from_bytes(original[i:i+3],'big') for i in range(0,len(original),3)]
    flat=[x for i in ids for x in expanded[i]];groups=[]
    for at in range(0,len(flat),WIDTH):
        b=b''.join(i.to_bytes(3,'big') for i in flat[at:at+WIDTH])
        if b not in dictionary:
            part=unit.add(b);assert len(part)==1;dictionary[b]=part[0]
        groups.append(dictionary[b])
    packed=b''.join(i.to_bytes(3,'big') for i in groups)
    (ROOT/file.name).write_bytes(packed);programs.append((file.name,ids))
unit.finish('instruction-ranges.bin');data.load();unit.load()
dc=(ROOT/'data-ranges.bin').read_bytes();uc=(ROOT/'instruction-ranges.bin').read_bytes()
for name,ids in programs:
    tokenmap=(ROOT/name).read_bytes();parts=[]
    for at in range(0,len(tokenmap),3):
        group=unit.read_disk(int.from_bytes(tokenmap[at:at+3],'big'),uc)
        for i in range(0,len(group),3):parts.append(data.read_disk(int.from_bytes(group[i:i+3],'big'),dc))
    restored=b''.join(parts);expected=b''.join(sections[i] for i in ids)
    assert restored==expected
    im=Image.open(io.BytesIO(restored));im.load();assert im.size==(1080,1080)

# Deployed addresses/root references are unavailable, but their binary allowance is counted.
address_bytes=(len(data.pages)+len(unit.pages))*20;root_bytes=len(programs)*6
(ROOT/'address-table-placeholders.bin').write_bytes(bytes(address_bytes))
(ROOT/'token-root-placeholders.bin').write_bytes(bytes(root_bytes))
written=[data.root/f'{i}.bin' for i in range(len(data.pages))]+[unit.root/f'{i}.bin' for i in range(len(unit.pages))]+[ROOT/n for n,_ in programs]+[ROOT/'data-ranges.bin',ROOT/'instruction-ranges.bin',ROOT/'address-table-placeholders.bin',ROOT/'token-root-placeholders.bin']
total=sum(p.stat().st_size for p in written)
result={'tokens':len(programs),'size':1080,'quality':report['quality'],'subsampling':report['subsampling'],'preparedBinaryBytes':total,'dataBytes':sum(map(len,data.pages)),'dataRangeBytes':len(dc),'instructionBytes':sum(map(len,unit.pages)),'instructionRangeBytes':len(uc),'tokenMapBytes':sum((ROOT/n).stat().st_size for n,_ in programs),'addressTableAllowanceBytes':address_bytes,'tokenRootAllowanceBytes':root_bytes,'under5MillionBytes':total<5_000_000,'all128DiskReassembliesByteExact':True,'all128JPEGsDecoded':True,'sourceArchiveIncluded':False,'sourcePixelsExact':False,'readGas':'unmeasured','publicChainPublished':False,'scope':'Actual binary data, range catalogs, shared instructions, token maps, plus counted placeholder addresses and root records; source archive, NFT metadata and EVM registry state excluded'}
(ROOT/'report.json').write_text(json.dumps(result,indent=2));print(json.dumps(result),flush=True)
