import json, subprocess, concurrent.futures
from pathlib import Path
from PIL import Image
import numpy as np
root=Path('apps/desktop/artifacts/gator-ape-rebuild')
rows=json.loads((root/'webp-token-0.json').read_text())
out=root/'webp-audit';out.mkdir(exist_ok=True)
def check(row):
    target=out/(row['objectId']+'.webp')
    subprocess.run(['/opt/homebrew/bin/cwebp','-quiet','-lossless','-q','100','-m','6','-metadata','icc',row['file'],'-o',str(target)],check=True)
    with Image.open(row['file']) as im:
        original=np.asarray(im.convert('RGBA'));icc=im.info.get('icc_profile')
    with Image.open(target) as im:
        encoded=np.asarray(im.convert('RGBA'));same_icc=im.info.get('icc_profile')==icc
    assert original.shape==encoded.shape
    visible=original[:,:,3]>0
    alpha_differences=int(np.count_nonzero(original[:,:,3]!=encoded[:,:,3]))
    visible_differences=int(np.count_nonzero(original[visible]!=encoded[visible]))
    assert alpha_differences==0 and visible_differences==0 and same_icc
    result={'path':row['path'],'exactBytes':Path(row['file']).stat().st_size,'optimizedBytes':target.stat().st_size,'alphaDifferences':alpha_differences,'visibleChannelDifferences':visible_differences,'hiddenRGBDifferences':int(np.count_nonzero(original[~visible,:3]!=encoded[~visible,:3])),'iccPreserved':same_icc,'dimensions':[original.shape[1],original.shape[0]]}
    print(json.dumps(result),flush=True)
    return result
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    results=list(pool.map(check,rows))
report={'layers':results,'exactBytes':sum(r['exactBytes'] for r in results),'optimizedBytes':sum(r['optimizedBytes'] for r in results),'originalsChanged':False,'proof':'All alpha and all RGB with alpha above zero equal; fully transparent RGB may differ; ICC preserved.'}
(out/'report.json').write_text(json.dumps(report,indent=2))
print(json.dumps({k:v for k,v in report.items() if k!='layers'}),flush=True)
