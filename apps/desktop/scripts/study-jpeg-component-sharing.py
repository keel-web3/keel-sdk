"""Share separate sequential JPEG component scans without changing encoded pixels."""
import os,io,json,re,subprocess
from pathlib import Path
from PIL import Image
BASE=Path('apps/desktop/artifacts/gator-raster-study/full-1080')
Q=int(os.environ.get('KEEL_JPEG_QUALITY','75'))
INTERVAL=int(os.environ.get('KEEL_JPEG_INTERVAL','1'))
ROOT=BASE/f'jpeg-component-sharing-q{Q}-r{INTERVAL}'
ROOT.mkdir(exist_ok=True)
scan=ROOT/'scans.txt';scan.write_text('0;\n1;\n2;\n')
ids=json.loads(Path('apps/desktop/artifacts/gator-raster-study/sample-ids.json').read_text())

def split(jpeg):
    assert jpeg[:2]==b'\xff\xd8'
    out=[jpeg[:2]];at=2;scans=0
    while at<len(jpeg):
        assert jpeg[at]==255
        marker=jpeg[at+1]
        if marker==217:
            out.append(jpeg[at:at+2]);at+=2;break
        n=int.from_bytes(jpeg[at+2:at+4],'big');out.append(jpeg[at:at+2+n]);at+=2+n
        if marker!=218:continue
        scans+=1;start=at
        # In entropy data FF00 is a literal byte and FFD0..D7 mark independent intervals.
        while True:
            boundary=jpeg.find(b'\xff',at);assert boundary>=0
            tag=jpeg[boundary+1]
            if tag==0:at=boundary+2;continue
            if 208<=tag<=215:
                out.append(jpeg[start:boundary+2]);start=boundary+2;at=start;continue
            if boundary>start:out.append(jpeg[start:boundary])
            at=boundary;break
    assert at==len(jpeg) and scans==3 and b''.join(out)==jpeg
    return out

library=[];dictionary={};groups={n:{} for n in [4,8,16,32,64]};group_refs={n:0 for n in groups};sizes=[];flat_refs=0;results=[]
for token in ids:
    im=Image.open(BASE/f'native-128-sample/token-{token}.png').convert('RGB')
    buf=io.BytesIO();im.save(buf,'JPEG',quality=Q,subsampling=2,optimize=False,progressive=False)
    original=buf.getvalue()
    result=subprocess.run(['/opt/homebrew/bin/jpegtran','-scans',str(scan),'-restart',f'{INTERVAL}B','-copy','none'],input=original,capture_output=True,check=True)
    jpeg=result.stdout
    expected=Image.open(io.BytesIO(original)).convert('RGB').tobytes()
    assert Image.open(io.BytesIO(jpeg)).convert('RGB').tobytes()==expected,token
    program=[]
    for part in split(jpeg):
        if part not in dictionary:dictionary[part]=len(library);library.append(part)
        program.append(dictionary[part])
    rebuilt=b''.join(library[i] for i in program);assert rebuilt==jpeg
    assert Image.open(io.BytesIO(rebuilt)).convert('RGB').tobytes()==expected
    flat_refs+=len(program);sizes.append(len(jpeg));results.append({'tokenId':token,'references':len(program),'jpegBytes':len(jpeg)})
    for width in groups:
        pieces=[tuple(program[at:at+width]) for at in range(0,len(program),width)]
        assert [i for part in pieces for i in part]==program
        for part in pieces:groups[width][part]=True;group_refs[width]+=1
    (ROOT/f'token-{token}.map').write_bytes(b''.join(i.to_bytes(3,'big') for i in program))
    if token in [0,31,2790,3193]:(ROOT/f'token-{token}.jpg').write_bytes(jpeg)
    if len(results)%32==0:print(json.dumps({'phase':'component-scans','tokens':len(results),'uniqueSections':len(library)}),flush=True)

image_bytes=sum(map(len,library));layouts=[]
for width,dictionary in groups.items():
    layouts.append({'groupWidth':width,'preparedBytes':image_bytes+len(library)*6+sum(len(g)*3 for g in dictionary)+len(dictionary)*6+group_refs[width]*3,'sharedGroups':len(dictionary),'groupReferences':group_refs[width]})
(ROOT/'library.bin').write_bytes(b''.join(library));ranges=[];at=0
for part in library:ranges.append([at,len(part)]);at+=len(part)
(ROOT/'ranges.json').write_text(json.dumps(ranges))
r={'quality':Q,'subsampling':'4:2:0','size':1080,'restartMCUs':INTERVAL,'componentScans':3,'tokens':len(ids),'imageFragmentBytes':image_bytes,'uniqueSections':len(library),'rangeCatalogBytes':len(library)*6,'groupLayouts':layouts,'bestPreparedBytes':min(v['preparedBytes'] for v in layouts),'minJPEGBytes':min(sizes),'maxJPEGBytes':max(sizes),'flatReferences':flat_refs,'all128DecodedJPEGsIdentical':True,'sourcePixelsExact':False,'readGas':'unmeasured','scope':'JPEG sections, range catalogs, shared instructions and maps; address/root allowances, source archive and chain state excluded','results':results}
(ROOT/'report.json').write_text(json.dumps(r,indent=2));print(json.dumps({k:v for k,v in r.items() if k!='results'}),flush=True)
