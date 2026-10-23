from pathlib import Path
import subprocess,json,hashlib,shutil,os
r=Path(__file__).parent;old=Path('/private/tmp/keel-independent-native-movie-20261022-01');author=Path('/private/tmp/keel-native-movie-display-budget-20261022-01/keel-sdk');ev=r/'evidence'
def run(*args):return subprocess.check_output(args,text=True).strip()
def clone(src,dst,commit,branch):
 subprocess.run(['git','clone','--shared','--no-checkout',str(src),str(dst)],capture_output=True,check=True)
 af=dst/'.git/objects/info/alternates';seen=set();stores=[]
 def visit(p):
  p=p.resolve()
  if p in seen:return
  seen.add(p);a=p/'info/alternates'
  if a.exists():
   for s in a.read_text().splitlines():visit(Path(s) if s.startswith('/') else p/s)
  stores.append(str(p))
 for s in af.read_text().splitlines():visit(Path(s))
 af.write_text('\n'.join(stores)+'\n')
 subprocess.run(['git','-C',str(dst),'sparse-checkout','set','--no-cone','/*','!/docs/','!/node_modules/'],capture_output=True,check=True)
 subprocess.run(['git','-C',str(dst),'checkout','-b',branch,commit],capture_output=True,check=True)
clone(author,r/'keel-sdk','fefd8fc91c7e286143a8857edfbb5cdddafbcb56','codex/independent-native-movie-budget-20261022')
clone(old/'keel-site',r/'keel-site','5453cfd7cd2380baac494a05971bffa441406ab8','codex/independent-native-movie-budget-site-20261022')
aliases=[];refs=[]
for name in ['keel-sdk','keel-site']:
 source=old/name;target=r/name
 for root,dirs,files in os.walk(source):
  if '.git' in dirs:dirs.remove('.git')
  root=Path(root)
  if root.name=='node_modules':
   # Recreate aliases only; never copy the public package store or node_modules.
   for dirroot,subdirs,subfiles in os.walk(root):
    d=Path(dirroot)
    for child in list(subdirs)+subfiles:
     q=d/child
     if q.is_symlink():
      dest=target/q.relative_to(source);dest.parent.mkdir(parents=True,exist_ok=True);link=str(q.readlink()).replace(str(old),str(r));dest.symlink_to(link);aliases.append({'path':str(dest.relative_to(r)),'target':link,'exists':dest.exists()})
      if child in subdirs:subdirs.remove(child)
   dirs.clear()
  # Avoid generated trees and full docs traversal except explicit fixture pass below.
  dirs[:]=[d for d in dirs if d not in ['dist','.next','docs']]
 # Materialize tracked public fixture bytes from the previous independently tested tree.
 files=run('git','-C',str(source),'ls-files','docs').splitlines()
 for rel in files:
  q=source/rel
  if q.is_file() and q.suffix.lower() in ['.mp4','.mov','.webp','.avif','.gif','.png','.wav','.c']:
   out=target/rel;out.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(q,out);refs.append({'path':str(out.relative_to(r)),'bytes':out.stat().st_size,'sha256':hashlib.sha256(out.read_bytes()).hexdigest()})
# Exact retained test inputs required by original author/independent tests.
authorev=Path('/private/tmp/keel-native-movie-inspection-20261022-01/keel-sdk/docs/review/native-movie-inspection-20261022')
for dirname in ['inputs','edit-list-inputs','noedit-timeline-inputs','audio-coherent-inputs']:
 src=authorev/dirname
 if src.exists():shutil.copytree(src,ev/dirname)
shutil.copytree(old/'evidence/browser-results',ev/'browser-results')
# Additive Site tests are test-only exact copies, not Site production changes.
for file,src in [('native-movie-inspection.test.ts',authorev/'site-native-movie-inspection.test.ts'),('reviewer-native-gif-semantics.test.ts',old/'keel-site/apps/studio/tests/unit/reviewer-native-gif-semantics.test.ts')]:
 dst=r/'keel-site/apps/studio/tests/unit'/file;shutil.copyfile(src,dst);refs.append({'path':str(dst.relative_to(r)),'bytes':dst.stat().st_size,'sha256':hashlib.sha256(dst.read_bytes()).hexdigest()})
# Some retained SDK regressions address original review inputs under docs. Match exact bytes.
for rel in ['docs/review/temporal-display-metadata-20261022/reviewer-inputs/sar.mp4','docs/review/temporal-display-metadata-20261022/reviewer-inputs/title.mp4','docs/review/temporal-display-metadata-20261022/reviewer-inputs/sar.webp','docs/review/temporal-display-metadata-20261022/reviewer-inputs/title.webp']:
 dst=r/'keel-sdk'/rel;src=author/rel;dst.parent.mkdir(parents=True,exist_ok=True)
 if not dst.exists():shutil.copyfile(src,dst)
 assert dst.read_bytes()==src.read_bytes()
(ev/'setup.json').write_text(json.dumps({'sdk':'fefd8fc91c7e286143a8857edfbb5cdddafbcb56','site':'5453cfd7cd2380baac494a05971bffa441406ab8','runtime':'no outputs copied; fresh build required','aliases':aliases,'references':refs},indent=2)+'\n')
print(json.dumps({'aliases':len(aliases),'referenceFiles':len(refs),'referenceBytes':sum(v['bytes']for v in refs),'sdk':run('git','-C',str(r/'keel-sdk'),'rev-parse','HEAD')},indent=2))
