from pathlib import Path
import subprocess,json,hashlib,shutil,os,re
r=Path(__file__).parent;srcsdk=Path('/private/tmp/keel-sdk-integration-20261022-01');srcsite=Path('/private/tmp/keel-publish-entry-20261021-01');oldsite=Path('/private/tmp/keel-independent-temporal-normal-pg-20261022-02/keel-site');oldsdk=Path('/private/tmp/keel-independent-temporal-normal-pg-20261022-01/keel-sdk');ev=r/'evidence';aliases=[];docs=[]
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

old=Path('/private/tmp/keel-independent-codec-normal-20261022-01')
clone(srcsdk,r/'keel-sdk','0dc7e6f342b228515b1eecf783c9fd3629802eef','codex/independent-none-audit-sdk-20261022')
clone(srcsite,r/'keel-site','230c8cff0e2075042cc0784c03beece7ddf14900','codex/independent-none-audit-site-20261022')
target=r/'keel-sdk'
names=set(re.findall(r"'([A-Z][^']+\.md)'",(target/'packages/mcp/scripts/package-skills.mjs').read_text().split('const documents = [',1)[1].split('];',1)[0]))|{'KEEL_PAYLOAD_STORAGE.md','KEEL_BINARY_RESOURCE_DELIVERY.md','KEEL_INLINE_PAYLOAD_BOUNDARIES.md'}
for doc in names:
 q=subprocess.run(['git','-C',str(target),'show','HEAD:docs/'+doc],capture_output=True)
 if q.returncode:assert doc in ['INLINE_RECORD.md','CONTENT_SYSTEM_STATUS.md','PROOF_MARKET_PACKING.md'];continue
 out=target/'docs'/doc;out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(q.stdout);docs.append({'path':str(out.relative_to(r)),'sha256':hashlib.sha256(q.stdout).hexdigest()})
for row in json.loads((old/'evidence/final-own-aliases.json').read_text()):
 if not row['path'].startswith(('keel-sdk/','keel-site/')):continue
 out=r/row['path'];out.parent.mkdir(parents=True,exist_ok=True);link=row['target'].replace(str(old),str(r));out.symlink_to(link);aliases.append({'path':row['path'],'target':link,'exists':out.exists()})
for name in ['reviewer-native-none-role-shape.test.mjs','reviewer-native-none-carriage.test.mjs']:
 shutil.copyfile(old/'keel-sdk'/name,r/'keel-sdk'/name)
rel='apps/studio/tests/integration/temporal-media-normal-continuation.test.ts';shutil.copyfile(old/'keel-site'/rel,r/'keel-site'/rel);test=r/'keel-site'/rel;assert hashlib.sha256(test.read_bytes()).hexdigest()=='90a28021b7e838e8a44ba06ee43ae79a240a599a9e74b4ca7cec929cb292fced'
rel='docs/reviews/studio-publication-20261022/temporal-normal-postgres';out=r/'keel-site'/rel;out.mkdir(parents=True,exist_ok=True)
for name in ['read-only-rpc-guard.mjs','rpc-observer.mjs','exact-case-sequence.mjs','qualified-inputs.json']:shutil.copyfile(old/'keel-site'/rel/name,out/name)
for name in ['run-local.py','run-pg.py']:shutil.copyfile(old/name,r/name)
(ev/'setup.json').write_text(json.dumps({'sdk':'0dc7e6f342b228515b1eecf783c9fd3629802eef','site':'230c8cff0e2075042cc0784c03beece7ddf14900','integrationSHA256':hashlib.sha256(test.read_bytes()).hexdigest(),'docs':docs,'aliases':aliases,'outputCopies':0},indent=2)+'\n');print(json.dumps({'publicAliases':len(aliases),'exactDocFiles':len(docs),'outputCopies':0},indent=2))
