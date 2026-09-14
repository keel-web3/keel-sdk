"""Resumable, source-digest-bound preparation of every used collection layer.
Originals and the 14 approved test assets are never modified. Per-layer SSIM is
an engineering gate, not proof that every final composition is visually approved.
"""
import concurrent.futures, hashlib, json, os, re, subprocess, time
from pathlib import Path
from PIL import Image, ImageChops

ROOT = Path('apps/desktop/artifacts/gator-ape-rebuild')
OUT = ROOT / 'collection-layers-3750'
POLICY = 'gator-3750-rgba-ssim99-v1'

def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def save_json(path, value):
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(value, indent=2))
    temp.replace(path)

def run(command):
    return subprocess.run(command, check=True, capture_output=True, text=True, timeout=600)

def matte(image, colour, bounds):
    result = Image.new('RGB', image.size, (colour,)*3)
    result.paste(image, mask=image.getchannel('A'))
    return result.crop(bounds)

def ssim(a,b):
    output = run(['/opt/homebrew/bin/ffmpeg','-hide_banner','-threads','1','-i',str(a),'-threads','1','-i',str(b),
                  '-filter_complex_threads','1','-filter_complex','[0:v]format=gbrp[a];[1:v]format=gbrp[b];[a][b]ssim',
                  '-frames:v','1','-f','null','-'])
    matches = re.findall(r'All:([0-9.]+)',output.stderr)
    if not matches: raise ValueError('Missing SSIM result')
    return float(matches[-1])

def prepare(item, approved):
    source_path = Path(item['sourcePath'])
    if digest(source_path) != item['sha256']: raise ValueError('Source digest changed: '+str(source_path))
    folder = OUT / item['sha256']; folder.mkdir(parents=True,exist_ok=True)
    report = folder/'report.json'
    if report.exists():
        cached=json.loads(report.read_text())
        if cached.get('policy')==POLICY and digest(cached['best']['file'])==cached['best']['objectId']: return cached
    exact = [approved[p] for p in item['paths'] if p in approved]
    if exact:
        first=exact[0]
        if any(r['objectId']!=first['objectId'] for r in exact): raise ValueError('Approved alias conflict')
        if digest(first['file']) != first['objectId']: raise ValueError('Approved asset changed')
        if digest(first['sourcePath']) != first['sourceDigest']: raise ValueError('Approved source changed')
        result={'policy':POLICY,'sourceDigest':first['sourceDigest'],'inventorySourceDigest':item['sha256'],'approvedSourceOverride':first['sourceDigest']!=item['sha256'],'paths':item['paths'],'best':first,'approvedExistingBytes':True}
        save_json(report,result); return result
    with Image.open(source_path) as original:
        icc=original.info.get('icc_profile')
        source=original.convert('RGBA').resize((3750,3750),Image.Resampling.LANCZOS)
    source_file=folder/'source.png'
    source.save(source_file,compress_level=1,**({'icc_profile':icc} if icc else {}))
    alpha=source.getchannel('A'); bounds=alpha.getbbox() or (0,0,1,1)
    for colour in [0,255]: matte(source,colour,bounds).save(folder/f'ref-{colour}.png',compress_level=1)
    candidates=[]
    for codec,quality in [('webp','lossless'),('avif',80),('avif',90),('avif',95)]:
        if codec=='avif' and quality>80 and any(c['type']=='image/avif' and c['accepted'] for c in candidates): break
        file=folder/f'{codec}-{quality}.{codec}'
        if codec=='webp':
            run(['/opt/homebrew/bin/cwebp','-quiet','-lossless','-q','100','-m','6','-metadata','icc',str(source_file),'-o',str(file)])
        else:
            run(['/opt/homebrew/bin/avifenc','-q',str(quality),'--qalpha','100','-y','444','-d','8','-s','6','-j','1','--ignore-exif','--ignore-xmp',str(source_file),str(file)])
        with Image.open(file) as decoded:
            if decoded.size!=(3750,3750) or decoded.info.get('icc_profile')!=icc: raise ValueError('Resolution or ICC changed')
            restored=decoded.convert('RGBA')
        if ImageChops.difference(alpha,restored.getchannel('A')).getbbox(): raise ValueError('Alpha changed')
        scores=[]
        for colour in [0,255]:
            rendered=matte(restored,colour,bounds)
            reference=matte(source,colour,bounds)
            if codec=='webp':
                if ImageChops.difference(rendered,reference).getbbox(): raise ValueError('Lossless visible pixels changed')
                scores.append(1.0)
            else:
                candidate=folder/f'candidate-{colour}.png';rendered.save(candidate,compress_level=1)
                scores.append(ssim(folder/f'ref-{colour}.png',candidate));candidate.unlink()
        candidates.append({'file':str(file.resolve()),'objectId':digest(file),'bytes':file.stat().st_size,'type':'image/'+codec,
                           'quality':quality,'width':3750,'height':3750,'ssimBlack':scores[0],'ssimWhite':scores[1],
                           'alphaExact':True,'accepted':min(scores)>=0.99})
    best=min((c for c in candidates if c['accepted']),key=lambda c:c['bytes'])
    result={'policy':POLICY,'sourceDigest':item['sha256'],'sourcePath':str(source_path),'paths':item['paths'],
            'best':best,'candidates':candidates,'approvedExistingBytes':False,'finalCompositionValidated':False}
    save_json(report,result)
    for file in [source_file,folder/'ref-0.png',folder/'ref-255.png']:file.unlink()
    return result

if __name__=='__main__':
    OUT.mkdir(parents=True,exist_ok=True)
    inventory=json.loads((ROOT/'all-used-layer-inventory.json').read_text())
    approved={r['path']:r for r in json.loads((ROOT/'mixed-codec-test-3750/selected.json').read_text())}
    objects=inventory['objects']
    limit=int(os.environ.get('KEEL_LAYER_BATCH_LIMIT','0'))
    if limit:objects=objects[:limit]
    results=[];started=time.time()
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        pending={pool.submit(prepare,item,approved):item for item in objects}
        for future in concurrent.futures.as_completed(pending):
            result=future.result();results.append(result)
            selected=[{**r['best'],'path':p,'sourceDigest':r['sourceDigest']} for r in results for p in r['paths']]
            save_json(OUT/'selected.json',sorted(selected,key=lambda r:r['path']))
            unique={r['best']['objectId']:r['best']['bytes'] for r in results}
            status={'preparedSourceObjects':len(results),'requiredSourceObjects':inventory['uniqueOriginalPNGObjects'],
                    'preparedPaths':len(selected),'requiredPaths':inventory['usedPaths'],'uniqueEncodedBytes':sum(unique.values()),
                    'complete':len(results)==inventory['uniqueOriginalPNGObjects'],'elapsedSeconds':round(time.time()-started),
                    'published':False,'originalsChanged':False,'allCompositionsValidated':False}
            save_json(OUT/'progress.json',status); print(json.dumps(status),flush=True)
