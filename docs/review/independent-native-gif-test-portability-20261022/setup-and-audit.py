import json, subprocess, hashlib, shutil, os, sys
from pathlib import Path
r=Path(__file__).parent; dst=r/'keel-sdk'; src=Path('/private/tmp/keel-sdk-native-gif-fixtures-20261022-01'); built=Path('/private/tmp/keel-independent-native-gif-20261022-02/keel-sdk'); ev=r/'evidence'; commit=sys.argv[1]
def cmd(args,**kw): return subprocess.check_output(args,text=True,**kw).strip()
def sha(b): return hashlib.sha256(b).hexdigest()
if not dst.exists():
 subprocess.run(['git','clone','--shared','--no-checkout',str(src),str(dst)],check=True,capture_output=True)
 # Flatten only this checkout's nested references to the same existing immutable object stores.
 own=dst/'.git/objects/info/alternates'; seen=set(); ordered=[]
 def visit(p):
  p=p.resolve()
  if p in seen:return
  seen.add(p); child=p/'info/alternates'
  if child.exists():
   for line in child.read_text().splitlines():visit(p/line if not line.startswith('/') else Path(line))
  ordered.append(str(p))
 for line in own.read_text().splitlines():visit(Path(line))
 own.write_text('\n'.join(ordered)+'\n')
 subprocess.run(['git','-C',str(dst),'sparse-checkout','set','--no-cone','/*','!/docs/','!/node_modules/'],check=True,capture_output=True)
 subprocess.run(['git','-C',str(dst),'checkout','-b','codex/independent-native-gif-portability-20261022',commit],check=True,capture_output=True)
assert cmd(['git','-C',str(dst),'rev-parse','HEAD'])==commit
assert not cmd(['git','-C',str(dst),'status','--porcelain'])
manifest=json.loads((built/'docs/review/independent-native-gif-entry-approved-20261022/raw/own-runtime-output-identities.json').read_text()); total=0
for row in manifest:
 p=built/row['path'];data=p.read_bytes();assert len(data)==row['bytes'] and sha(data)==row['sha256'],row
 target=dst/row['path'];target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data);total+=len(data)
links=[]
for parent in [built,*list((built/'packages').iterdir())]:
 n=parent/'node_modules'
 if not n.exists():continue
 if n.is_symlink(): candidates=[n]
 else:
  candidates=[]
  for d in n.iterdir():
   if d.is_symlink():candidates.append(d)
   elif d.is_dir() and d.name.startswith('@'):candidates.extend(q for q in d.iterdir() if q.is_symlink())
 for p in candidates:
  target=str(p.readlink());target=target.replace(str(built),str(dst));q=dst/p.relative_to(built);q.parent.mkdir(parents=True,exist_ok=True);q.symlink_to(target);links.append({'path':str(q.relative_to(dst)),'target':target,'exists':q.exists()})
old=cmd(['git','-C',str(dst),'show','189ec0b:tests/media-frame-request-snapshot.test.mjs'])+'\n'; new=(dst/'tests/media-frame-request-snapshot.test.mjs').read_text()
assert old.replace('../../evidence/browser-results/reviewer-native-finite.gif','./fixtures/native-gif-entry/reviewer-native-finite.gif').replace('../../evidence/browser-results/reviewer-native-clamped.gif','./fixtures/native-gif-entry/reviewer-native-clamped.gif')==new
original=(built/'reviewer-native-gif-mutable-input.test.mjs').read_text();mirror=(dst/'tests/native-gif-source-identity.test.mjs').read_text()
assert sha(original.encode())=='c71d19b0b8564712daecad4fff752ef6aacbc3956f6cffc4c0846b5e15afd5ff'
assert original.replace("from './packages/builder/", "from '../packages/builder/").replace("new URL('../evidence/browser-results/',", "new URL('./fixtures/native-gif-entry/',")==mirror
refs=[]
for file,expected in [('reviewer-native-finite.gif','19a488cb5a0d34f20c3d0d266797b65c62ab197554f7e484377954ee5acb83a5'),('reviewer-native-clamped.gif','35fd32e1ac822834d6e945ce225c13a0c48731397a5578b86bd9aafae3546435')]:
 p=dst/'tests/fixtures/native-gif-entry'/file;data=p.read_bytes();assert len(data)==126 and sha(data)==expected;assert data==(built.parent/'evidence/browser-results'/file).read_bytes();refs.append({'path':str(p.relative_to(dst)),'bytes':len(data),'sha256':sha(data)})
sourcefiles=cmd(['git','-C',str(dst),'diff','--name-only','189ec0b',commit,'--','packages']).splitlines();assert sourcefiles==[]
audit={'candidate':commit,'productionBase':'189ec0b0f0fd2d35e5b0c97cee23b85bcbd092ef','sourceChangeFiles':sourcefiles,'snapshotExactURLOnly':True,'mirrorExactImportURLOnly':True,'originalSHA256':sha(original.encode()),'mirrorSHA256':sha(mirror.encode()),'fixtures':refs,'reusedOwnRuntimeManifestSHA256':sha((built/'docs/review/independent-native-gif-entry-approved-20261022/raw/own-runtime-output-identities.json').read_bytes()),'reverifiedCopiedOwnOutputs':len(manifest),'reusedOwnRuntimeBytes':total,'dependencyAliases':links}
(ev/'setup-audit.json').write_text(json.dumps(audit,indent=2)+'\n'); (ev/'candidate.diff').write_text(cmd(['git','-C',str(dst),'diff','--binary','189ec0b',commit])+'\n');print(json.dumps({k:v for k,v in audit.items() if k!='dependencyAliases'},indent=2))
