from pathlib import Path
import subprocess,hashlib,json,shutil,os
r=Path(__file__).parent;p=r/'keel-sdk';dst=r/'test-portability-sdk';src=Path('/private/tmp/keel-native-movie-test-closure-20261022-01/keel-sdk');e=r/'evidence';subprocess.run(['git','clone','--shared','--no-checkout',str(src),str(dst)],check=True,capture_output=True)
af=dst/'.git/objects/info/alternates';seen=set();stores=[]
def visit(q):
 q=q.resolve()
 if q in seen:return
 seen.add(q);a=q/'info/alternates'
 if a.exists():
  for s in a.read_text().splitlines():visit(Path(s)if s.startswith('/')else q/s)
 stores.append(str(q))
for s in af.read_text().splitlines():visit(Path(s))
af.write_text('\n'.join(stores)+'\n');subprocess.run(['git','-C',str(dst),'sparse-checkout','set','--no-cone','/*','!/docs/','!/node_modules/'],check=True,capture_output=True);subprocess.run(['git','-C',str(dst),'checkout','-b','codex/independent-native-movie-test-portability','b3f60c2980a613559da577063a741b3639245adc'],check=True,capture_output=True)
manifest=json.loads((e/'own-runtime-output-identities.json').read_text())
for row in manifest:
 b=(p/row['path']).read_bytes();assert hashlib.sha256(b).hexdigest()==row['sha256'];out=dst/row['path'];out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(b)
links=[]
for root,dirs,files in os.walk(p):
 root=Path(root)
 if '.git'in dirs:dirs.remove('.git')
 if root.name=='node_modules':
  for path,ds,fs in os.walk(root):
   for child in ds[:]+fs:
    q=Path(path)/child
    if q.is_symlink():
     out=dst/q.relative_to(p);out.parent.mkdir(parents=True,exist_ok=True);target=str(q.readlink()).replace(str(p),str(dst));out.symlink_to(target);links.append({'path':str(out.relative_to(dst)),'target':target})
     if child in ds:ds.remove(child)
  dirs.clear()
 dirs[:]=[d for d in dirs if d not in ['docs','dist','.next']]
refs=[]
for name in ['sar.mp4','title.mp4','sar.webp','title.webp']:
 f=dst/'tests/fixtures/native-movie-inspection'/name;b=f.read_bytes();orig=(p/'docs/review/temporal-display-metadata-20261022/reviewer-inputs'/name).read_bytes();assert b==orig;refs.append({'path':str(f.relative_to(dst)),'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()})
changes={'tests/native-movie-inspection.test.mjs':("../../evidence/inputs/","./fixtures/native-movie-inspection/"),'tests/native-movie-mcp.test.mjs':("../docs/review/temporal-display-metadata-20261022/reviewer-inputs/","./fixtures/native-movie-inspection/"),'tests/native-movie-preview.browser.test.mjs':("../docs/review/temporal-display-metadata-20261022/reviewer-inputs/","./fixtures/native-movie-inspection/")}
for rel,(before,after)in changes.items():assert(p/rel).read_text().replace(before,after)==(dst/rel).read_text()
assert subprocess.check_output(['git','-C',str(dst),'diff','--name-only','9f5bf42','b3f60c2','--','packages']).strip()==b''
row={'candidate':'b3f60c2980a613559da577063a741b3639245adc','runtimeSource':'9f5bf42309efae5ee933850c9afab618cf29121b','exactURLOnlyThreeTests':True,'fixtures':refs,'reverifiedOwnCopiedOutputs':len(manifest),'outputBytes':sum(x['bytes']for x in manifest),'runtimeManifestSHA256':hashlib.sha256((e/'own-runtime-output-identities.json').read_bytes()).hexdigest(),'aliases':links};(e/'test-portability-audit.json').write_text(json.dumps(row,indent=2)+'\n');print(json.dumps({k:v for k,v in row.items()if k!='aliases'},indent=2))
