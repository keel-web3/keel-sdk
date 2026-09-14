import json,runpy
from pathlib import Path
from PIL import Image
ssim=runpy.run_path('apps/desktop/scripts/benchmark-gator-mixed-codecs.py')['ssim'];root=Path('apps/desktop/artifacts/gator-ape-rebuild');out=root/'mixed-codec-test'
image=Image.open(root/'reference-0.png').convert('RGB');regions={'full':(0,0,4525,4525),'art':(350,1500,4250,3650),'head':(2500,1700,4200,2450),'jacket':(750,2150,2900,3150),'lava':(420,1510,1500,2500)};results=[]
for size in [3840,3200,2800,2560,2160]:
 restored=image.resize((size,size),Image.Resampling.LANCZOS).resize(image.size,Image.Resampling.LANCZOS);scores={}
 for name,box in regions.items():
  file=out/('resolution-check-'+name+'.png');restored.crop(box).save(file,compress_level=1);scores[name]=ssim(out/(name+'-reference.png'),file);file.unlink()
 result={'resolution':size,'resamplingOnlyNoLossyCodec':True,'ssim':scores};results.append(result);print(json.dumps(result),flush=True)
(out/'resolution-similarity.json').write_text(json.dumps(results,indent=2))
