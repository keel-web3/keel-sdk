#!/usr/bin/env python3
"""Retire exactly nine hash-verified public duplicates after protected retention."""
import argparse,fcntl,hashlib,importlib.util,json,os,signal,stat,sys,time
from pathlib import Path
sys.dont_write_bytecode=True
ROWS_SHA='2ab2726362ef169e6e2e3ebadc0886b26073611f342825feede8cd397627a46e'
RETENTION_SHA='fb7cb3dc7df41f4d95d9228870c37756d61279f2bd505db2b0715692e21cb87c'
GUARD_ROOT=Path('/home/ubuntu/keel-studio-image-only-b9b37f1a-1357-4e60-a02a-32ee90086bc9')
def need(ok,reason):
    if not ok:raise RuntimeError(reason)
def digest(x):return hashlib.sha256(json.dumps(x,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def fsyncdir(fd):os.fsync(fd)
def persist(root,name,value):
    with os.fdopen(os.open(root/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600),'w') as f:json.dump(value,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
    d=os.open(root,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:fsyncdir(d)
    finally:os.close(d)
def signature(s):return(s.st_dev,s.st_ino,s.st_nlink,s.st_size,s.st_blocks*512,s.st_uid,s.st_gid,stat.S_IMODE(s.st_mode),s.st_mtime_ns,s.st_ctime_ns)
def expected(r):return tuple(r[k] for k in ('device','inode','links','bytes','allocatedBytes','uid','gid','mode','mtimeNs','ctimeNs'))
def open_parent(path):
    need(path.is_absolute() and '..' not in path.parts,'canonical_source_path')
    fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:
        for part in path.parent.parts[1:]:
            child=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd);os.close(fd);fd=child
        return fd
    except BaseException:os.close(fd);raise
def bound_parent(parent,path):
    now=path.parent.lstat();anchored=os.fstat(parent)
    need(path.parent.resolve()==path.parent and (now.st_dev,now.st_ino)==(anchored.st_dev,anchored.st_ino),'source_parent_replaced')
    need(stat.S_ISDIR(anchored.st_mode) and anchored.st_uid==os.geteuid() and (os.geteuid()!=0 or anchored.st_gid==0) and not(stat.S_IMODE(anchored.st_mode)&0o022),'source_parent_owner_or_permissions_changed')
def verify(fd,row):
    before=os.fstat(fd);need(stat.S_ISREG(before.st_mode) and signature(before)==expected(row),'source_metadata_changed')
    os.lseek(fd,0,os.SEEK_SET);h=hashlib.sha256()
    while True:
        b=os.read(fd,4*1024*1024)
        if not b:break
        h.update(b)
    need(h.hexdigest()==row['sha256'] and signature(os.fstat(fd))==signature(before),'source_hash_or_identity_changed')
def entry_matches(parent,path,row):
    try:s=os.stat(path.name,dir_fd=parent,follow_symlinks=False)
    except FileNotFoundError:return False
    return stat.S_ISREG(s.st_mode) and signature(s)==expected(row)
def references(rows,docker,proc=Path('/proc')):
    keys={(r['device'],r['inode']) for r in rows};paths=[Path(r['path']) for r in rows]
    for p in proc.iterdir():
        if not p.name.isdigit() or int(p.name)==os.getpid():continue
        try:start=(p.stat().st_dev,p.stat().st_ino)
        except(FileNotFoundError,ProcessLookupError):continue
        unknown=[]
        try:
            for f in (p/'fd').iterdir():
                try:s=f.stat()
                except FileNotFoundError:continue
                need((s.st_dev,s.st_ino) not in keys,'active_public_file_fd')
        except(FileNotFoundError,ProcessLookupError):unknown.append('fd')
        try:
            for line in (p/'maps').read_text().splitlines():
                parts=line.split(None,5);major,minor=(int(x,16) for x in parts[3].split(':'))
                need((os.makedev(major,minor),int(parts[4])) not in keys,'active_public_file_map')
        except(FileNotFoundError,ProcessLookupError):unknown.append('maps')
        try:end=(p.stat().st_dev,p.stat().st_ino)
        except(FileNotFoundError,ProcessLookupError):continue
        need(start==end and not unknown,'live_process_references_unknown')
    # Stopped consumed test containers remain retained. Do not remove an input
    # visible to any currently running container, including ancestor binds.
    for c in docker.request('GET','/containers/json?all=0&size=0'):
        for mount in c.get('Mounts',[]):
            source=mount.get('Source')
            if source:
                source=Path(source)
                need(not any(source==p or source in p.parents for p in paths),'running_container_public_file_bind')
def retire(root,rows,execute,observe,scan):
    need(not any(os.path.lexists(root/n) for n in ('cleanup-consumed.json','before.json','result.json')),'scope_already_used')
    handles=[];result={'schema':'keel.exact-nine-public-retirement-result@1','result':'PREFLIGHT_ONLY','removedOnly':[],'directoriesRemoved':0,'privateFilesBackupsImagesContainersVolumesOrDataChanged':False,'rollbackOrApplicationActivation':False};primary=None;claimed=False
    try:
        before=observe();result['currentBefore']=before;v=os.statvfs(root);result['freeBytesBefore']=v.f_bavail*v.f_frsize
        # Authenticate and hash ALL nine before any unlink or consumption.
        for row in rows:
            path=Path(row['path']);parent=open_parent(path)
            try:fd=os.open(path.name,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=parent)
            except BaseException:os.close(parent);raise
            handles.append((parent,fd,path,row));bound_parent(parent,path);verify(fd,row);need(entry_matches(parent,path,row),'source_entry_changed')
        scan(rows);need(observe()==before,'current_changed_before_cleanup')
        if execute:
            persist(root,'cleanup-consumed.json',{'filesCanonicalSHA256':digest(rows),'automaticRetry':False});claimed=True
            persist(root,'before.json',{'files':rows,'current':before,'retentionReceiptSHA256':RETENTION_SHA,'restoration':'Protected offhost archive members00-08; separate exclusive restoration only. No inode/ctime promise.'})
            for index,(parent,fd,path,row) in enumerate(handles):
                scan(rows);bound_parent(parent,path);verify(fd,row);need(entry_matches(parent,path,row),'source_entry_changed_before_unlink')
                persist(root,'unlink-intent-'+str(index)+'.json',{'path':str(path),'device':row['device'],'inode':row['inode'],'sha256':row['sha256']})
                bound_parent(parent,path);need(entry_matches(parent,path,row),'source_entry_changed_after_intent')
                os.unlink(path.name,dir_fd=parent);fsyncdir(parent)
                need(os.fstat(fd).st_nlink==0,'source_still_linked_after_unlink')
            result['result']='PASS'
    except BaseException as error:primary=error;result.update(result='FAIL',failure=type(error).__name__+': '+str(error))
    finally:
        # Reconcile from held immutable handles even if interrupted after unlink
        # but before its acknowledgement. Never repeat an uncertain unlink.
        for parent,fd,path,row in handles:
            if os.fstat(fd).st_nlink==0:result['removedOnly'].append({'path':str(path),'sha256':row['sha256'],'bytes':row['bytes'],'allocatedBytes':row['allocatedBytes']})
            os.close(fd);os.close(parent)
        result['removedCount']=len(result['removedOnly']);result['removedPayloadBytes']=sum(r['bytes'] for r in result['removedOnly']);result['removedAllocatedBytes']=sum(r['allocatedBytes'] for r in result['removedOnly']);v=os.statvfs(root);result['freeBytesAfter']=v.f_bavail*v.f_frsize
        try:
            result['currentAfter']=observe();need(result.get('currentBefore')==result['currentAfter'],'current_changed_after_cleanup')
        except BaseException as error:primary=primary or error;result.update(result='FAIL',finalGuardFailure=type(error).__name__+': '+str(error))
        if claimed:persist(root,'result.json',result)
        print(json.dumps(result,indent=2))
    if primary:raise primary
    return result
def load(name,p):
    spec=importlib.util.spec_from_file_location(name,p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
def validate(plan):
    need(plan['schema']=='keel.exact-nine-retained-public-files@1' and len(plan['files'])==9 and digest(plan['files'])==ROWS_SHA,'exact_nine_metadata_required')
    need(plan['retentionReceiptSHA256']==RETENTION_SHA and plan['retainedArchiveSHA256']=='f3ddc1ae80c079989a331e04ee2958d4e6ea584c6aeda4311427cfb3e8d6feaf' and plan['retainedArchiveBytes']==330588160 and plan['payloadBytes']==330572918,'exact_retained_copy_required')
    need(all(r['uid']==r['gid']==0 and r['links']==1 for r in plan['files']) and plan['keepAllOtherFilesDirectoriesImagesContainersVolumesSnapshotsProjectsData'] is True and plan['privateFilesOrBackupsIncluded'] is False and plan['cleanupApproved'] is False and plan['automaticRetry'] is False,'scope_changed')
def stage_file(root,name,expected_sha):
    path=root/name;s=path.lstat()
    need(stat.S_ISREG(s.st_mode) and s.st_uid==0 and s.st_gid==0 and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==0o444 and sha(path)==expected_sha,'stage_file_changed')
    return path
def main():
    parser=argparse.ArgumentParser();parser.add_argument('plan');parser.add_argument('--execute-approved-sha256');parser.add_argument('--review-sha256');args=parser.parse_args();path=Path(args.plan);root=path.parent
    need(sys.platform=='linux' and os.geteuid()==0 and root.resolve()==root and root.parent==Path('/home/ubuntu') and root.stat().st_uid==0 and stat.S_IMODE(root.stat().st_mode)==0o700,'owned_cleanup_stage')
    need(path==root/'cleanup-plan.json','canonical_plan_filename');s=path.lstat();need(stat.S_ISREG(s.st_mode) and s.st_uid==s.st_gid==0 and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==0o444,'plan_metadata');plan=json.loads(path.read_bytes());validate(plan);need(str(root)==plan['remoteRoot'] and Path(__file__)==root/'cleanup-nine-public.py','operator_or_stage_changed');stage_file(root,'cleanup-nine-public.py',plan['operatorSHA256'])
    retention=json.loads(stage_file(root,'retention-receipt.json',RETENTION_SHA).read_bytes())
    need(retention['schema']=='keel.verified-nine-public-stage-retention@1' and retention['result']=='PASS_RETAINED_NO_SERVER_CLEANUP' and [{k:r[k] for k in plan['files'][0]} for r in retention['files']]==plan['files'] and retention['archiveSHA256']==plan['retainedArchiveSHA256'] and retention['regularPayloadBytes']==plan['payloadBytes'],'retention_receipt_identity_changed')
    need(GUARD_ROOT.resolve()==GUARD_ROOT and GUARD_ROOT.stat().st_uid==0 and stat.S_IMODE(GUARD_ROOT.stat().st_mode)==0o700,'existing_guard_root_changed');stage_file(GUARD_ROOT,'activate-image-only.py',plan['existingGuardSourceSHA256']);previous=json.loads(stage_file(GUARD_ROOT,'activation-plan.final.json',plan['existingGuardPlanSHA256']).read_bytes());m=load('guarded_current7b0',GUARD_ROOT/'activate-image-only.py');support,guard,oom=m.modules(GUARD_ROOT,previous);docker=support.Docker()
    def observe():
        current=docker.container(plan['expectedCurrent']['id']);m.assert_baseline(current,plan['expectedCurrent'],guard);guard.assert_publisher_paused(current);m.assert_runner(docker,previous,guard);m.check_image(docker,previous);need(m.digest(m.profile(docker))==oom.PROFILE_CANONICAL_SHA256,'daemon_profile_changed')
        return {'id':current['Id'],'image':current['Image'],'configSHA256':m.digest(current['Config']),'hostSHA256':m.digest(current['HostConfig']),'mountsSHA256':m.mount_digest(guard,current['Mounts']),'healthy':True,'publisherPaused':True,'runnerAndSocketExact':True}
    execute=args.execute_approved_sha256 is not None
    if execute:
        need(args.execute_approved_sha256==sha(path),'exact_plan_required');need(args.review_sha256 is not None,'review_required');rv=json.loads(stage_file(root,'cleanup-review.json',args.review_sha256).read_bytes());need(rv['decision']=='APPROVE_EXACT_NINE_PUBLIC_RETIREMENT' and rv['planSHA256']==sha(path) and rv['operatorSHA256']==sha(Path(__file__)) and rv['retentionReceiptSHA256']==RETENTION_SHA and rv['offhostArchiveAllNineFullHashesVerified'] is True,'independent_review_required')
    with os.fdopen(os.open(support.LOCK,os.O_RDWR|os.O_NOFOLLOW|os.O_CLOEXEC),'r+') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);signal.alarm(180)
        try:retire(root,plan['files'],execute,observe,lambda rows:references(rows,docker))
        finally:signal.alarm(0)
if __name__=='__main__':
    def interrupted(number,frame):raise InterruptedError('cleanup_interrupted_'+str(number))
    for sig in (signal.SIGINT,signal.SIGTERM,signal.SIGHUP,signal.SIGALRM):signal.signal(sig,interrupted)
    main()
