from pathlib import Path
import subprocess,json,hashlib,shutil,os,re
r=Path(__file__).parent;srcsdk=Path('/private/tmp/keel-media-conversion-capabilities-20261022-01/keel-sdk');srcsite=Path('/private/tmp/keel-publish-entry-20261021-01');oldsite=Path('/private/tmp/keel-independent-temporal-normal-pg-20261022-02/keel-site');oldsdk=Path('/private/tmp/keel-independent-temporal-normal-pg-20261022-01/keel-sdk');ev=r/'evidence';aliases=[];docs=[]
def clone(src,dst,commit,branch):
 
 if dst.exists():
  assert subprocess.check_output(['git','-C',str(dst),'rev-parse','HEAD'],text=True).strip()==commit;return
 subprocess.run(['git','clone','--shared','--no-checkout',str(src),str(dst)],check=True,capture_output=True);a=dst/'.git/objects/info/alternates';seen=set();stores=[]
 def visit(p):
  p=p.resolve()
  if p in seen:return
  seen.add(p);q=p/'info/alternates'
  if q.exists():
   for s in q.read_text().splitlines():visit(Path(s)if s.startswith('/')else p/s)
  stores.append(str(p))
 for s in a.read_text().splitlines():visit(Path(s))
 a.write_text('\n'.join(stores)+'\n');subprocess.run(['git','-C',str(dst),'sparse-checkout','set','--no-cone','/*','!/docs/','!/node_modules/'],check=True,capture_output=True);subprocess.run(['git','-C',str(dst),'checkout','-b',branch,commit],check=True,capture_output=True)

old=Path('/private/tmp/keel-independent-codec-normal-20261022-02')
clone(srcsdk,r/'keel-sdk','d46961461df319e26d4c947030fddf06337ed7f7','codex/independent-media-capabilities-20261022')
target=r/'keel-sdk';names=set(re.findall(r"'([A-Z][^']+\.md)'",(target/'packages/mcp/scripts/package-skills.mjs').read_text().split('const documents = [',1)[1].split('];',1)[0]))|{'KEEL_PAYLOAD_STORAGE.md','KEEL_BINARY_RESOURCE_DELIVERY.md','KEEL_INLINE_PAYLOAD_BOUNDARIES.md'}
for doc in names:
 q=subprocess.run(['git','-C',str(target),'show','HEAD:docs/'+doc],capture_output=True)
 if q.returncode:assert doc in ['INLINE_RECORD.md','CONTENT_SYSTEM_STATUS.md','PROOF_MARKET_PACKING.md'];continue
 out=target/'docs'/doc;out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(q.stdout);docs.append({'path':str(out.relative_to(r)),'sha256':hashlib.sha256(q.stdout).hexdigest()})
for row in json.loads((old/'evidence/setup.json').read_text())['aliases']:
 if not row['path'].startswith('keel-sdk/'):continue
 out=r/row['path'];out.parent.mkdir(parents=True,exist_ok=True);link=row['target'].replace(str(old),str(r));out.symlink_to(link);aliases.append({'path':row['path'],'target':link,'exists':out.exists()})
shutil.copyfile('/private/tmp/keel-independent-codec-normal-20261022-01/keel-sdk/reviewer-acceptance-media-capability.test.mjs',target/'reviewer-acceptance-media-capability.test.mjs')
source=r/'evidence/acceptance-owned-temp/keel-acceptance-media-alg2BC/fixture.mov';source.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile('/private/tmp/keel-independent-codec-normal-20261022-01/evidence/acceptance-owned-temp/keel-acceptance-media-alg2BC/fixture.mov',source)
shutil.copyfile(old/'run-local.py',r/'run-local.py');(ev/'setup.json').write_text(json.dumps({'source':'d46961461df319e26d4c947030fddf06337ed7f7','production':'471b26a572531ccd56e926bdb8fd682ce2f4ab4e','aliases':aliases,'docs':docs,'outputCopies':0},indent=2)+'\n');print(len(aliases),'public/own aliases;0outputcopies')
