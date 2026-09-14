"""Local lossy-output investigation. Original PNGs and publication choices stay intact."""
import io, json, math, re, hashlib, os
from pathlib import Path
from PIL import Image, ImageChops, ImageStat

base = Path('apps/desktop/artifacts/gator-raster-study/full-1080')
root = base / ('jpeg-study' + os.environ.get('KEEL_JPEG_SUFFIX', ''))
root.mkdir(exist_ok=True)
source = base / 'native-128-sample'
subsampling = int(os.environ.get('KEEL_JPEG_SUBSAMPLING', '0'))
qualities = list(map(int, os.environ.get('KEEL_JPEG_QUALITIES', '95,90,85').split(',')))
assert subsampling in [0,1,2] and all(1 <= q <= 100 for q in qualities)
ids = json.loads(Path('apps/desktop/artifacts/gator-raster-study/sample-ids.json').read_text())

def encode(im, quality, restart=0):
    out = io.BytesIO()
    # Fixed Huffman tables allow reuse between images. Chroma sampling is explicit.
    im.save(out, 'JPEG', quality=quality, subsampling=subsampling, optimize=False,
            progressive=False, restart_marker_blocks=restart)
    return out.getvalue()

def pieces(jpeg):
    assert jpeg[:2] == b'\xff\xd8'
    at = 2
    while True:
        assert jpeg[at] == 255
        marker = jpeg[at + 1]
        n = int.from_bytes(jpeg[at + 2:at + 4], 'big')
        at += n + 2
        if marker == 0xda: break
    result = [jpeg[:at]]
    start = at
    for match in re.finditer(b'\xff[\xd0-\xd7]', jpeg[at:-2]):
        end = at + match.end()
        result.append(jpeg[start:end])
        start = end
    result.append(jpeg[start:])
    assert b''.join(result) == jpeg
    return result

previews=[]
for token in [0,3022,365,2834]:
    p=base / 'native-4000/references' / f'{token}.png'
    original=Image.open(p).convert('RGBA')
    assert original.getchannel('A').getextrema() == (255,255)
    rgb=original.convert('RGB')
    rgb.save(root/f'{token}-original.png',optimize=True)
    row={'tokenId':token,'ordinaryRGBPNGBytes':(root/f'{token}-original.png').stat().st_size,'variants':[]}
    for q in qualities:
        data=encode(rgb,q)
        (root/f'{token}-q{q}.jpg').write_bytes(data)
        decoded=Image.open(io.BytesIO(data)).convert('RGB')
        mse=sum(v*v for v in ImageStat.Stat(ImageChops.difference(rgb,decoded)).rms)/3
        row['variants'].append({'quality':q,'bytes':len(data),'psnrDB':10*math.log10(255**2/mse),'pixelExact':False})
    previews.append(row)
(root/'preview-sizes.json').write_text(json.dumps(previews,indent=2))
print(json.dumps({'previewSizes':previews}),flush=True)

results=[]
for q in qualities:
    for interval in map(int, os.environ.get("KEEL_JPEG_INTERVALS", "1,8,135").split(",")):
        dictionary={}; library=[]; byte_count=0; refs=0; sizes=[]
        group_sizes=list(map(int,os.environ.get("KEEL_JPEG_GROUPS","8").split(",")))
        group_dictionaries={g:{} for g in group_sizes}; group_refs={g:0 for g in group_sizes}
        for token in ids:
            im=Image.open(source/f'token-{token}.png').convert('RGB')
            jpeg=encode(im,q,interval)
            program=[]
            for b in pieces(jpeg):
                key=hashlib.sha256(b).digest()
                if key not in dictionary:
                    dictionary[key]=len(library);library.append(b);byte_count+=len(b)
                index=dictionary[key]
                assert library[index] == b
                program.append(index)
            restored=b''.join(library[i] for i in program)
            assert restored == jpeg
            # JPEG loss is intentional; assembly itself must add no further loss.
            assert Image.open(io.BytesIO(restored)).tobytes() == Image.open(io.BytesIO(jpeg)).tobytes()
            refs+=len(program);sizes.append(len(jpeg))
            for width in group_sizes:
                groups=[tuple(program[at:at+width]) for at in range(0,len(program),width)]
                assert [i for group in groups for i in group] == program
                for group in groups: group_dictionaries[width][group]=True;group_refs[width]+=1
        assert len(library)<2**24 and all(len(d)<2**24 for d in group_dictionaries.values())
        layouts=[]
        for width, dictionary_groups in group_dictionaries.items():
            group_bytes=sum(len(g)*3 for g in dictionary_groups)
            layouts.append({'groupWidth':width,'preparedBytes':byte_count+len(library)*6+group_bytes+len(dictionary_groups)*6+group_refs[width]*3,'groups':len(dictionary_groups),'groupReferences':group_refs[width]})
        best=min(layouts,key=lambda v:v['preparedBytes'])
        # Conservative authoring layouts, not a deployed contract or gas result.
        flat=byte_count+len(library)*6+refs*3
        shared=best["preparedBytes"]
        result={'quality':q,'subsampling':subsampling,'size':1080,'restartMCUs':interval,'tokens':len(ids),'imageFragmentBytes':byte_count,'uniqueFragments':len(library),'flatMapAndCatalogBytes':len(library)*6+refs*3,'flatPreparedBytes':flat,'sharedGroupPreparedBytes':shared,'sharedGroups':best['groups'],'groupLayouts':layouts,'selectedGroupWidth':best['groupWidth'],'flatReferences':refs,'minJPEGBytes':min(sizes),'maxJPEGBytes':max(sizes),'sumJPEGBytes':sum(sizes),'assemblyByteExact':True,'sourcePixelsExact':False,'readGas':'unmeasured','scope':'128 fixed original tokens; binary fragments, 6-byte range catalogs and uint24 maps; addresses, source archive, metadata and chain state excluded'}
        results.append(result)
        (root/'sharing-report.json').write_text(json.dumps(results,indent=2))
        print(json.dumps(result),flush=True)
