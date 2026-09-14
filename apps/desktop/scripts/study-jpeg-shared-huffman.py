"""Train shared JPEG Huffman tables on unique stored sections; preserve DCT data.
Local experiment only. Re-encoding entropy adds no image quantization.
"""
import io, os, json, re, math, heapq
from array import array
from collections import Counter
from pathlib import Path
from PIL import Image

BASE=Path('apps/desktop/artifacts/gator-raster-study/full-1080')
Q=int(os.environ.get('KEEL_JPEG_QUALITY','75'))
INTERVAL=int(os.environ.get('KEEL_JPEG_INTERVAL','2'))
INPUT_DIR=os.environ.get('KEEL_JPEG_INPUT_DIR')
ROOT=BASE/(f'jpeg-shared-huffman-q{Q}-r{INTERVAL}'+os.environ.get('KEEL_JPEG_HUFFMAN_SUFFIX',''))
ROOT.mkdir(exist_ok=True)
IDS=json.loads(Path('apps/desktop/artifacts/gator-raster-study/sample-ids.json').read_text())

def jpeg(im):
    out=io.BytesIO()
    im.save(out,'JPEG',quality=Q,subsampling=2,optimize=False,progressive=False,restart_marker_blocks=INTERVAL)
    return out.getvalue()

def segments(data):
    assert data[:2]==b'\xff\xd8'
    at=2;result=[]
    while True:
        assert data[at]==255
        marker=data[at+1];n=int.from_bytes(data[at+2:at+4],'big')
        result.append((marker,data[at:at+n+2]));at+=n+2
        if marker==0xda:break
    parts=[];start=at
    for m in re.finditer(b'\xff[\xd0-\xd7]',data[at:-2]):
        end=at+m.end();parts.append(data[start:end]);start=end
    parts.append(data[start:])
    return data[:at],result,parts

def canonical(counts,symbols):
    code=0;at=0;result={}
    for n,count in enumerate(counts,1):
        for _ in range(count):
            assert code < (1<<n)-1 # JPEG reserves all-ones codes for padding.
            result[symbols[at]]=(code,n);at+=1;code+=1
        code <<= 1
    assert at==len(symbols)
    return result

def decode_tables(header_segments):
    tables={};blocks=[];dimensions=None
    for marker,raw in header_segments:
        b=raw[4:]
        if marker==0xc4:
            at=0
            while at<len(b):
                key=b[at];counts=list(b[at+1:at+17]);n=sum(counts)
                codes=canonical(counts,list(b[at+17:at+17+n]));table=[None]*65536
                for symbol,(code,length) in codes.items():
                    for index in range(code<<(16-length),(code+1)<<(16-length)):
                        table[index]=(symbol,length)
                tables[key]=table;at+=17+n
        elif marker==0xc0:
            assert b[0]==8
            height=int.from_bytes(b[1:3],'big');width=int.from_bytes(b[3:5],'big')
            sampling={b[6+i*3]:b[7+i*3] for i in range(b[5])}
            maxh=max(v>>4 for v in sampling.values());maxv=max(v&15 for v in sampling.values())
            dimensions=(width,height,math.ceil(width/(8*maxh))*math.ceil(height/(8*maxv)))
        elif marker==0xda:
            for i in range(b[0]):
                component=b[1+2*i];selectors=b[2+2*i];hv=sampling[component]
                blocks.extend([(selectors>>4,16+(selectors&15))]*((hv>>4)*(hv&15)))
            assert b[-3:]==bytes([0,63,0])
    assert dimensions and len(blocks)==6
    return tables,blocks,dimensions

KEYS=[0,16,1,17]
class Bits:
    def __init__(self,b):
        b=b.replace(b'\xff\x00',b'\xff');self.value=int.from_bytes(b,'big');self.left=len(b)*8
    def get(self,n):
        assert 0<=n<=self.left
        self.left-=n
        return (self.value>>self.left)&((1<<n)-1)
    def symbol(self,table):
        prefix=((self.value>>(self.left-16))&65535) if self.left>=16 else ((self.value&((1<<self.left)-1))<<(16-self.left))|((1<<(16-self.left))-1)
        pair=table[prefix];assert pair is not None
        symbol,n=pair;self.get(n);return symbol

def decode_part(part,nmcus,tables,blocks):
    assert part[-2]==255 and (0xd0<=part[-1]<=0xd7 or part[-1]==0xd9)
    bits=Bits(part[:-2]);events=array('I')
    def event(key):
        symbol=bits.symbol(tables[key]);n=symbol if key<16 else symbol&15
        extra=bits.get(n);events.append((KEYS.index(key)<<24)|(symbol<<16)|extra)
        return symbol
    for _ in range(nmcus):
        for dc,ac in blocks:
            assert event(dc)<=11
            k=1
            while k<64:
                symbol=event(ac)
                if symbol==0:break
                if symbol==240:k+=16
                else:
                    assert (symbol&15)>0
                    k+=(symbol>>4)+1
                assert k<=64
    # Check unread padding without mutating the count during evaluation.
    remaining=bits.left;assert remaining<=7 and bits.get(remaining)==(1<<remaining)-1
    return events

def optimal(freq):
    # A dummy leaf prevents an all-ones real code. Bound lengths to JPEG's 16 bits.
    heap=[(count,(sym,)) for sym,count in freq.items() if count]
    heap.append((1,(256,)));heapq.heapify(heap);depth={sym:0 for _,syms in heap for sym in syms}
    while len(heap)>1:
        a,x=heapq.heappop(heap);b,y=heapq.heappop(heap)
        for sym in x+y:depth[sym]+=1
        heapq.heappush(heap,(a+b,x+y))
    counts=[0]*(max(33,max(depth.values())+1))
    for n in depth.values():counts[n]+=1
    for n in range(len(counts)-1,16,-1):
        while counts[n]>0:
            j=n-2
            while counts[j]==0:j-=1
            counts[n]-=2;counts[n-1]+=1;counts[j+1]+=2;counts[j]-=1
    n=16
    while counts[n]==0:n-=1
    counts[n]-=1
    symbols=sorted((s for s in depth if s!=256),key=lambda s:(depth[s],s))
    assert sum(counts[1:17])==len(symbols) and all(0<=n<=255 for n in counts[1:17])
    return counts[1:17],symbols,canonical(counts[1:17],symbols)

def encode_part(events,tail,codes):
    out=bytearray();value=0;length=0
    for event in events:
        book=event>>24;symbol=(event>>16)&255;extra=event&65535
        code,n=codes[book][symbol];m=symbol if KEYS[book]<16 else symbol&15
        value=(value<<(n+m))|(code<<m)|extra;length+=n+m
        while length>=8:
            length-=8;b=(value>>length)&255;out.append(b)
            if b==255:out.append(0)
        value &= (1<<length)-1
    if length:
        b=(value<<(8-length))|((1<<(8-length))-1);out.append(b)
        if b==255:out.append(0)
    return bytes(out)+tail

library=[];lookup={};programs=[];frequencies=[Counter() for _ in KEYS];events_list=[];old_header=None
for token in IDS:
    im=Image.open(BASE/f'native-128-sample/token-{token}.png').convert('RGB')
    original=(Path(INPUT_DIR)/f'token-{token}.jpg').read_bytes() if INPUT_DIR else jpeg(im)
    header,header_segments,parts=segments(original)
    if old_header is None:
        old_header=header;tables,blocks,dimensions=decode_tables(header_segments);stored_header_segments=header_segments
    assert header==old_header
    program=[]
    for position,part in enumerate(parts):
        mcus=min(INTERVAL,dimensions[2]-position*INTERVAL)
        key=(part,mcus)
        if key not in lookup:
            lookup[key]=len(library);library.append(part)
            events=decode_part(part,mcus,tables,blocks);events_list.append(events)
            for e in events:frequencies[e>>24][(e>>16)&255]+=1
        program.append(lookup[key])
    assert len(parts)==math.ceil(dimensions[2]/INTERVAL)
    programs.append((token,program,original))
    if len(programs)%32==0:print(json.dumps({'phase':'symbols','tokens':len(programs),'uniqueSections':len(library)}),flush=True)

trained=[optimal(f) for f in frequencies];codes=[t[2] for t in trained]
dht=b''.join(bytes([key])+bytes(t[0])+bytes(t[1]) for key,t in zip(KEYS,trained))
new_header=b'\xff\xd8'+b''.join(raw for marker,raw in stored_header_segments if marker not in [0xc4,0xda])+b'\xff\xc4'+(len(dht)+2).to_bytes(2,'big')+dht+next(raw for marker,raw in stored_header_segments if marker==0xda)
new_parts=[encode_part(events,old[-2:],codes) for events,old in zip(events_list,library)]
# Different original entropy sections must never silently collapse to different pixels.
new_library=list(dict.fromkeys([new_header]+new_parts));new_ids={part:i for i,part in enumerate(new_library)}
groups={4:{},8:{},16:{}};group_refs={g:0 for g in groups};flat_refs=0;image_sizes=[]
for token,program,original in programs:
    mapped=[new_ids[new_header]]+[new_ids[new_parts[i]] for i in program]
    rebuilt=b''.join(new_library[i] for i in mapped)
    assert Image.open(io.BytesIO(rebuilt)).convert('RGB').tobytes()==Image.open(io.BytesIO(original)).convert('RGB').tobytes(),token
    flat_refs+=len(mapped);image_sizes.append(len(rebuilt))
    for width in groups:
        split=[tuple(mapped[at:at+width]) for at in range(0,len(mapped),width)]
        assert [i for group in split for i in group]==mapped
        for group in split:groups[width][group]=True;group_refs[width]+=1
    if token in [0,31,2790,3193]:(ROOT/f'token-{token}.jpg').write_bytes(rebuilt)
    # Persist actual instructions for review, using uint24 IDs.
    (ROOT/f'token-{token}.map').write_bytes(b''.join(i.to_bytes(3,'big') for i in mapped))

layouts=[];image_bytes=sum(map(len,new_library));catalog_bytes=len(new_library)*6
for width,dictionary in groups.items():
    total=image_bytes+catalog_bytes+sum(len(g)*3 for g in dictionary)+len(dictionary)*6+group_refs[width]*3
    layouts.append({'groupWidth':width,'preparedBytes':total,'sharedGroups':len(dictionary),'groupReferences':group_refs[width]})
# Write the actual unique binary library and ranges, preserving section boundaries.
raw=b''.join(new_library);(ROOT/'library.bin').write_bytes(raw)
locations=[];at=0
for part in new_library:locations.append([at,len(part)]);at+=len(part)
(ROOT/'ranges.json').write_text(json.dumps(locations))
result={'quality':Q,'sourceEncoder':'external supplied JPEGs' if INPUT_DIR else 'Pillow libjpeg','subsampling':'4:2:0','restartMCUs':INTERVAL,'size':1080,'tokens':len(IDS),'imageFragmentBytes':image_bytes,'oldImageFragmentBytes':len(old_header)+sum(map(len,library)),'uniqueSections':len(new_library),'rangeCatalogBytes':catalog_bytes,'groupLayouts':layouts,'bestPreparedBytes':min(v['preparedBytes'] for v in layouts),'minJPEGBytes':min(image_sizes),'maxJPEGBytes':max(image_sizes),'all128DecodedJPEGsIdentical':True,'sourcePixelsExact':False,'readGas':'unmeasured','scope':'Binary image sections, 6-byte range records, shared uint24 instructions and maps; source archive, address tables, token roots and chain state excluded','huffmanTraining':'Symbol frequencies across unique stored sections, not all rendered repetitions'}
(ROOT/'report.json').write_text(json.dumps(result,indent=2));print(json.dumps(result),flush=True)
