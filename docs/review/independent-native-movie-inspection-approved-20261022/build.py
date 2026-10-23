import subprocess,json,time,os,sys
from pathlib import Path
r=Path(__file__).parent;e=r/'evidence';old=Path('/private/tmp/keel-independent-native-gif-20261022-02');steps=json.loads((old/'evidence/fresh-runtime-build.json').read_text());rows=[]
for i,row in enumerate(steps):
 cwd=Path(row['cwd'].replace(str(old),str(r)));name=['protocol','viewer','sdk','builder','studio-core','ethereum-adapter','viewer-runtime','proof-runtime','canonical-runtime','layered-runtime','storage-runtime','mint-queue','mcp'][i]
 t=time.time();p=subprocess.run(row['command'],cwd=cwd,capture_output=True);(e/f'build-{name}.stdout').write_bytes(p.stdout);(e/f'build-{name}.stderr').write_bytes(p.stderr);result={'command':row['command'],'cwd':str(cwd),'exit':p.returncode,'elapsed':time.time()-t};rows.append(result);(e/'fresh-runtime-build.json').write_text(json.dumps(rows,indent=2)+'\n');print(json.dumps(result),flush=True)
 if p.returncode:sys.exit(p.returncode)
