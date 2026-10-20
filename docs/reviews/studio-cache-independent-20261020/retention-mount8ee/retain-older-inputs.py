#!/usr/bin/env python3
"""Remove exactly two older input archives only after verified protected retention.
Never extracts archives or changes any application, image, container or volume.
"""
import argparse,ctypes,fcntl,hashlib,http.client,json,os,re,signal,socket,stat,sys,time
from pathlib import Path
EXPECTED_PATHS=('/home/ubuntu/keel-studio-alias-171f635e-20261014/keel-showcase.tar.gz','/home/ubuntu/keel-studio-primary-0bd2db80-20261014/keel-showcase.tar.gz')
EXPECTED_HASHES=('7cd9852035ef222fb8dd806b28da05561cf2ec30127d0025b84c8d0bf2f61f01','8ac4dc36a1dbc44da7a12efa985497980a31b3d3e8bcec4f01a2477be731bd77')
EXPECTED_OLD={'id':'b6ff8c7a6f5c2282e29883de917f2d376a8e92efffecc45d115338e0516a5201','image':'sha256:a53c65ac2aee00217f206f07f4ddecbf9d55b5a43f60bf87858d9756259ba730','config':'9543c71f9f506e5243c9a74a3d70007ab6919c9f4eb76c0fec8ad7cdb40a77eb','host':'9ebb974a9d71321d58a0bb74a528d089a6a4337a54328460a9768ff260e56467','mounts':'8227ad2f93c93f7a55ba2006d6b73695ae8b04f636a637bc54b08dc65298996f','running':True,'healthy':True,'workerPaused':True}
def need(v,s):
 if not v:raise RuntimeError(s)
def digest(v):return hashlib.sha256(json.dumps(v,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def sha(p):
 with Path(p).open('rb')as f:return hashlib.file_digest(f,'sha256').hexdigest()
def save(root,name,value):
 with os.fdopen(os.open(root/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,0o600),'w')as f:json.dump(value,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
 fd=os.open(root,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(fd)
 finally:os.close(fd)
class Connection(http.client.HTTPConnection):
 def connect(self):
  self.sock=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);self.sock.settimeout(20);self.sock.connect('/var/run/docker.sock')
def docker(path):
 c=Connection('localhost',timeout=20)
 try:
  c.request('GET',path);r=c.getresponse();need(r.status==200,'docker_read_status_'+str(r.status));raw=r.read(4194305);need(len(raw)<=4194304,'docker_read_limit');return json.loads(raw)
 finally:c.close()
def original():
 v=docker('/containers/'+EXPECTED_OLD['id']+'/json');value={'id':v['Id'],'image':v['Image'],'config':digest(v['Config']),'host':digest(v['HostConfig']),'mounts':digest(sorted(v['Mounts'],key=lambda mount:json.dumps(mount,sort_keys=True,separators=(',',':'),allow_nan=False))),'running':v['State']['Running'],'healthy':v['State'].get('Health',{}).get('Status')=='healthy','workerPaused':'KEEL_PUBLICATION_WORKER_PAUSED=1'in v['Config'].get('Env',[])};need(value==EXPECTED_OLD,'original_runtime_changed');return value
def identity(s):return(s.st_dev,s.st_ino,s.st_uid,s.st_gid,stat.S_IMODE(s.st_mode))
def expected(r):return tuple(r[k]for k in ['device','inode','uid','gid','mode'])
def verify(fd,row,before_move=False):
 s=os.fstat(fd);need(stat.S_ISREG(s.st_mode)and identity(s)==expected(row)and s.st_nlink==row['links']==1 and s.st_size==row['bytes']and s.st_blocks*512==row['allocatedBytes']and s.st_mtime_ns==row['mtimeNs'],'archive_metadata_changed')
 if before_move:need(s.st_ctime_ns==row['ctimeNs'],'archive_ctime_changed_before_move')
 os.lseek(fd,0,os.SEEK_SET)
 with os.fdopen(os.dup(fd),'rb')as f:h=hashlib.file_digest(f,'sha256').hexdigest()
 a=os.fstat(fd);need(h==row['sha256']and identity(a)==identity(s)and(a.st_nlink,a.st_size,a.st_mtime_ns,a.st_ctime_ns)==(s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns),'archive_hash_or_identity_changed')
 return s.st_ctime_ns
def state(fd,name,row):
 try:s=os.stat(name,dir_fd=fd,follow_symlinks=False)
 except FileNotFoundError:return'absent'
 return'owned'if stat.S_ISREG(s.st_mode)and identity(s)==expected(row)else'foreign'
def rename(src,name,dst,target):
 lib=ctypes.CDLL(None,use_errno=True);call=lib.renameat2;call.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint];call.restype=ctypes.c_int
 if call(src,os.fsencode(name),dst,os.fsencode(target),1):raise OSError(ctypes.get_errno(),os.strerror(ctypes.get_errno()))
 os.fsync(src);os.fsync(dst)
def references(rows,quarantines,proc=Path('/proc'),query=docker):
 keys={(r['device'],r['inode'])for r in rows};paths=[Path(r['path'])for r in rows]+list(quarantines)
 for p in proc.iterdir():
  if not p.name.isdigit()or int(p.name)==os.getpid():continue
  unknown=[]
  try:start=(p.stat().st_dev,p.stat().st_ino)
  except(FileNotFoundError,ProcessLookupError):continue
  try:
   for f in(p/'fd').iterdir():
    try:s=f.stat()
    except FileNotFoundError:continue
    need((s.st_dev,s.st_ino)not in keys,'active_archive_fd')
  except(FileNotFoundError,ProcessLookupError):unknown.append('fd')
  try:
   for line in(p/'maps').read_text().splitlines():
    parts=line.split(None,5);major,minor=(int(x,16)for x in parts[3].split(':'));need((os.makedev(major,minor),int(parts[4]))not in keys,'active_archive_map')
  except(FileNotFoundError,ProcessLookupError):unknown.append('maps')
  try:end=(p.stat().st_dev,p.stat().st_ino)
  except(FileNotFoundError,ProcessLookupError):continue
  need(end==start and not unknown,'live_process_reference_unknown')
 for v in query('/containers/json?all=1&size=0'):
  for mount in v.get('Mounts',[]):
   if mount.get('Source'):
    source=Path(mount['Source']);need(not any(source==p or source in p.parents for p in paths),'archive_container_bind_reference')
 # Permission errors intentionally propagate. No skipped live PID on partial scan.
def open_parent(path):
 need(path.is_absolute()and'..'not in path.parts,'canonical_source_required');fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:
  for part in path.parent.parts[1:]:
   child=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd);os.close(fd);fd=child
  return fd
 except BaseException:os.close(fd);raise
def bound_parent(parent,path):
 need(path.parent.resolve()==path.parent and identity(path.parent.lstat())==identity(os.fstat(parent)),'source_parent_detached_or_replaced')
def recover(stage,handles,removed):
 result=[]
 for parent,fd,path,row,qname in reversed(handles):
  record={'path':str(path),'restored':False}
  try:
   bound_parent(parent,path)
   src,q=state(parent,path.name,row),state(stage,qname,row);record.update(sourceState=src,quarantineState=q)
   if src=='owned'and q!='owned':record.update(restored=True,action='source_already_owned')
   elif src=='absent'and q=='owned':rename(stage,qname,parent,path.name);need(state(parent,path.name,row)=='owned'and state(stage,qname,row)=='absent','restoration_uncertain');record.update(restored=True,action='restored_from_verified_quarantine')
   elif os.fstat(fd).st_nlink==0:record.update(action='already_unlinked_bytes_retained_offhost',requiresProtectedCopyRestore=True)
   else:record.update(action='preserved_no_overwrite',sourceState=src,quarantineState=q,retainedQuarantine=qname)
  except BaseException as error:record['error']=type(error).__name__+': '+str(error);record['sourceState']=state(parent,path.name,row);record['quarantineState']=state(stage,qname,row)
  result.append(record)
 return result
def relocate(root,rows,execute=False,observe=original,scan=references):
 need(not(root/'before.json').exists()and not(root/'result.json').exists(),'prior_attempt_requires_new_review');before=observe();space=os.statvfs(root);free_before=space.f_bavail*space.f_frsize;handles=[];intents=[];removed=[];result={'schema':'keel.two-retained-older-inputs-result@1','result':'PREFLIGHT-ONLY','originalBefore':before,'freeArchiveFilesystemBytesBefore':free_before,'removedOnly':removed,'directoriesRemoved':0,'imagesContainersVolumesProjectsOrRollbackChanged':False};primary=None;stage=os.open(root,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:
  for n,row in enumerate(rows):
   path=Path(row['path']);parent=open_parent(path);fd=os.open(path.name,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=parent);handles.append((parent,fd,path,row,'archive-'+str(n)+'.tar.gz'));verify(fd,row,True)
  scan(rows,[root/h[4]for h in handles]);need(observe()==before,'original_changed_before_move')
  if execute:
   save(root,'before.json',{'schema':'keel.two-retained-older-inputs-before@1','rows':rows,'original':before,'restorationPreserves':['bytes','uid','gid','mode','mtimeNs'],'inodeAndCTimePreservationPromised':False})
   for h in handles:
    parent,fd,path,row,q=h;bound_parent(parent,path);need(state(parent,path.name,row)=='owned'and state(stage,q,row)=='absent','move_source_or_destination_changed');intents.append(h);save(root,'move-intent-'+str(len(intents))+'.json',{'path':str(path),'quarantine':q,'expectedIdentity':list(expected(row))});rename(parent,path.name,stage,q)
   for parent,fd,path,row,q in handles:bound_parent(parent,path);need(state(stage,q,row)=='owned'and state(parent,path.name,row)=='absent','uncertain_move_blocks_unlink');verify(fd,row)
   scan(rows,[root/h[4]for h in handles]);need(observe()==before,'original_changed_before_unlink')
   for parent,fd,path,row,q in handles:
    need(state(stage,q,row)=='owned','quarantine_replaced');verify(fd,row);os.unlink(q,dir_fd=stage);removed.append({'path':str(path),'sha256':row['sha256'],'allocatedBytes':row['allocatedBytes']});os.fsync(stage);need(os.fstat(fd).st_nlink==0,'unexpected_retained_link')
   result['result']='PASS'
 except BaseException as error:primary=error;result.update(result='FAIL',failure=type(error).__name__+': '+str(error))
 finally:
  if execute:result['restoration']=recover(stage,intents,removed)
  result['actualUnlinkedFiles']=[str(path)for _,fd,path,_,_ in handles if os.fstat(fd).st_nlink==0]
  for parent,fd,_,_,_ in handles:os.close(fd);os.close(parent)
  os.close(stage);space=os.statvfs(root);result['freeArchiveFilesystemBytesAfter']=space.f_bavail*space.f_frsize
  try:result['originalAfter']=observe();need(result['originalAfter']==before,'original_changed_after')
  except BaseException as error:primary=primary or error;result.update(result='FAIL',finalGuardFailure=str(error))
  if execute:save(root,'result.json',result)
 if primary:raise primary
 return result

def validate(p):
 need(re.fullmatch('[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}',p['id'])is not None,'fresh_retention_identity')
 need(digest(p['files'])=='26c954a2f0911bc2e48bbf75f24951ff25fedb1824ac8f60fde0d8d62ad38c25','all_exact_source_metadata_required')
 need(p['schema']=='keel.two-protected-older-input-retention@1'and tuple(r['path']for r in p['files'])==EXPECTED_PATHS and tuple(r['sha256']for r in p['files'])==EXPECTED_HASHES,'exact_two_older_inputs_only')
 need([r['bytes']for r in p['files']]==[555623546,555608603]and[r['allocatedBytes']for r in p['files']]==[555630592,555614208]and all(r['links']==1 for r in p['files']),'exact_allocation_and_single_links')
 need(p['archivesExtracted']is False and p['applicationActivation']is False and p['keepAllOtherFilesDirectoriesImagesContainersVolumesDataAndRollback']is True,'retention_scope_changed')
def main():
 a=argparse.ArgumentParser();a.add_argument('--root',required=True);a.add_argument('--plan-sha256',required=True);a.add_argument('--review-sha256');a.add_argument('--execute',action='store_true');args=a.parse_args();root=Path(args.root)
 need(sys.platform=='linux'and os.geteuid()==0 and root.resolve()==root and root.parent==Path('/home/ubuntu')and root.stat().st_uid==0 and stat.S_IMODE(root.stat().st_mode)==0o700,'exclusive_linux_root_required')
 space=os.statvfs(root);need(space.f_bavail*space.f_frsize>=1048576,'receipt_metadata_space_required')
 need(root.stat().st_dev==2049,'archive_filesystem_changed')
 planfile=root/'archive-retention-plan.json';need(planfile.lstat().st_uid==0 and stat.S_IMODE(planfile.lstat().st_mode)==0o444 and not planfile.is_symlink()and sha(planfile)==args.plan_sha256,'plan_changed');p=json.loads(planfile.read_bytes());validate(p);need(root.name=='keel-older-input-retention-'+p['id']and Path(__file__).resolve()==root/'retain-older-inputs.py'and sha(__file__)==p['operatorSHA256'],'operator_or_identity_changed')
 if args.execute:
  reviewfile=root/'archive-retention-review.json';need(not reviewfile.is_symlink()and reviewfile.stat().st_uid==0 and stat.S_IMODE(reviewfile.stat().st_mode)==0o444 and sha(reviewfile)==args.review_sha256,'review_changed');r=json.loads(reviewfile.read_bytes());need(r['schema']=='keel.two-protected-older-input-retention-review@1'and r['scope']=='exact-two-older-input-archives-only'and r['decision']=='APPROVE'and r['planSHA256']==args.plan_sha256 and r['protectedLocalRetentionReceiptSHA256']==p['protectedLocalRetentionReceiptSHA256']and r['localFullHashesFreshlyVerified']is True and r['blockingFindings']==[],'independent_exact_retention_review_required')
 with open('/run/lock/keel-studio-rollout.lock','r+')as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);signal.alarm(180)
  try:result=relocate(root,p['files'],args.execute)
  finally:signal.alarm(0)
 print(json.dumps(result))
if __name__=='__main__':
 def interrupted(signum,frame):raise InterruptedError('retention_interrupted_'+str(signum))
 for event in [signal.SIGINT,signal.SIGTERM,signal.SIGHUP,signal.SIGALRM]:signal.signal(event,interrupted)
 main()
