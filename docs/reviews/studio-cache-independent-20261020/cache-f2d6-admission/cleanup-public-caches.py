#!/usr/bin/env python3
"""One independently reviewed cleanup of hash-qualified public package caches.

Move each cache atomically into an exclusive private quarantine before unlinking.
Never changes cache permissions, follows symlinks, removes directory shells, or
changes application/database/container state. New original-path occupants survive.
"""
import argparse, ctypes, errno, fcntl, hashlib, importlib.util, json, os, re, signal, stat, sys
from pathlib import Path

BASE = Path('/home/ubuntu')
PREVIOUS = BASE/'keel-proof-qualification-ffb6dc04-423d-4264-9bae-6443d3d9d772'
ROOTS = ('/home/ubuntu/.cache/pnpm/v11', '/home/ubuntu/.npm/_cacache')
RESERVE = 1342177280

def require(ok, reason):
    if not ok: raise RuntimeError(reason)

def sha(path):
    with Path(path).open('rb') as f: return hashlib.file_digest(f, 'sha256').hexdigest()

def load(path):
    s=importlib.util.spec_from_file_location('retained_fe944_import',path)
    m=importlib.util.module_from_spec(s); s.loader.exec_module(m); return m

def immutable(path, mode, digest):
    s=path.lstat()
    require(stat.S_ISREG(s.st_mode) and s.st_uid==0 and stat.S_IMODE(s.st_mode)==mode and sha(path)==digest,'immutable_input_changed')

def dependency():
    require(PREVIOUS.resolve()==PREVIOUS and PREVIOUS.stat().st_uid==0 and stat.S_IMODE(PREVIOUS.stat().st_mode)==0o700,'retained_stage_root_changed')
    for name, mode, digest in [
        ('import-whole-studio.py',0o444,'678a06e47042918d319694f9c93bca156d218cf64913ee51ec56241940e05251'),
        ('whole-studio-plan.json',0o444,'e75c63a4903863927a16e65297faf79106c7a092d0df67dbb8c2e73617413fc1'),
        ('app-receipt.json',0o600,'71acc384008c655eeb1a2dcf286af7bcfb75ad1fe0bf8b6bceb17c4b8063f123')]:
        immutable(PREVIOUS/name,mode,digest)
    m=load(PREVIOUS/'import-whole-studio.py'); p=json.loads((PREVIOUS/'whole-studio-plan.json').read_bytes()); m.validate(p)
    receipt=json.loads((PREVIOUS/'app-receipt.json').read_bytes())
    require(receipt['result']=='PASS' and receipt['planSHA256']==sha(PREVIOUS/'whole-studio-plan.json') and receipt['actualImageId']==m.IMAGE and receipt['originalBefore']==receipt['originalAfter'] and receipt['allRootFSAndImageConfigFieldsVerified'] is True,'retained_import_not_qualified')
    return m.previous()  # Authenticated installed stream/core/original guard chain.

def identity(s):
    return (s.st_dev,s.st_ino,s.st_uid,s.st_gid,stat.S_IMODE(s.st_mode))

def expected(row): return tuple(row[k] for k in ['device','inode','uid','gid','mode'])

def open_absolute(path, ancestors):
    require(path.is_absolute() and '..' not in path.parts,'absolute_canonical_path_required')
    fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY|os.O_CLOEXEC)
    try:
        current=Path('/')
        for part in path.parts[1:]:
            child=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=fd); os.close(fd); fd=child; current/=part
            require(identity(os.fstat(fd))==expected(ancestors[str(current)]),'ancestor_identity_changed')
        return fd
    except BaseException: os.close(fd); raise

def walk(fd, prefix=''):
    rows={}
    for name in sorted(os.listdir(fd)):
        require(name not in ['.','..'] and '/' not in name,'invalid_cache_name')
        rel=prefix+name; s=os.stat(name,dir_fd=fd,follow_symlinks=False)
        require(stat.S_ISREG(s.st_mode) or stat.S_ISDIR(s.st_mode),'cache_symlink_or_special_file')
        rows[rel]=s
        if stat.S_ISDIR(s.st_mode):
            child=os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=fd)
            try:
                require(identity(os.fstat(child))==identity(s),'cache_directory_replaced')
                rows.update(walk(child,rel+'/'))
            finally: os.close(child)
    return rows

def open_parent(fd, relative, directories):
    parts=Path(relative).parts
    require(relative==str(Path(relative)) and parts and not Path(relative).is_absolute() and '..' not in parts,'invalid_relative_path')
    parent=os.dup(fd); prefix=[]
    try:
        for part in parts[:-1]:
            prefix.append(part); child=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=parent); os.close(parent); parent=child
            require(identity(os.fstat(parent))==expected(directories['/'.join(prefix)]),'cache_parent_replaced')
        return parent,parts[-1]
    except BaseException: os.close(parent); raise

def verify_file(fd, row):
    s=os.fstat(fd)
    require(stat.S_ISREG(s.st_mode) and identity(s)==expected(row) and s.st_nlink==row['links']==1 and s.st_size==row['bytes'] and s.st_blocks*512==row['allocatedBytes'] and s.st_mtime_ns==row['mtimeNs'] and s.st_ctime_ns==row['ctimeNs'],'cache_file_metadata_changed')
    with os.fdopen(os.dup(fd),'rb') as f: digest=hashlib.file_digest(f,'sha256').hexdigest()
    after=os.fstat(fd)
    require(digest==row['sha256'] and identity(after)==identity(s) and (after.st_nlink,after.st_size,after.st_blocks,after.st_mtime_ns,after.st_ctime_ns)==(s.st_nlink,s.st_size,s.st_blocks,s.st_mtime_ns,s.st_ctime_ns),'cache_file_content_changed')

def snapshot(fd, item):
    require(identity(os.fstat(fd))==expected(item),'cache_root_changed')
    rows=walk(fd); dirs={r['relativePath']:r for r in item['directories']}; files={r['relativePath']:r for r in item['files']}
    require(set(rows)==set(dirs)|set(files),'cache_tree_members_changed')
    for path,row in dirs.items(): require(stat.S_ISDIR(rows[path].st_mode) and identity(rows[path])==expected(row),'cache_directory_changed')
    for path,row in files.items():
        parent,name=open_parent(fd,path,dirs)
        try:
            f=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=parent)
            try: verify_file(f,row)
            finally: os.close(f)
        finally: os.close(parent)
    return {(s.st_dev,s.st_ino) for s in rows.values()}|{(os.fstat(fd).st_dev,os.fstat(fd).st_ino)}

def no_references(items, inode_set, docker, proc=Path('/proc')):
    paths=[Path(i['path']) for i in items]
    overlaps=lambda p:any(p==r or p.is_relative_to(r) or (p!=Path('/') and r.is_relative_to(p)) for r in paths)
    for p in proc.iterdir():
        if not p.name.isdigit() or int(p.name)==os.getpid(): continue
        try: started=identity(p.stat())
        except (FileNotFoundError,ProcessLookupError): continue
        unknown=[]; fd_count=0; maps=None
        # Missing cwd/exe can describe a live process with deleted paths. Check
        # the independent FD/maps/mount boundaries before deciding it is gone.
        for field in ['cwd','exe']:
            try:
                info=(p/field).stat()
                require((info.st_dev,info.st_ino) not in inode_set,'cache_process_'+field+'_inode_reference')
                target=Path(os.readlink(p/field))
                require(target.is_absolute(),'cache_process_path_unknown')
                require(not any(target==r or target.is_relative_to(r) for r in paths),'cache_process_path_reference')
            except (FileNotFoundError,ProcessLookupError): unknown.append(field)
        try:
            for f in (p/'fd').iterdir():
                try: info=f.stat()
                except (FileNotFoundError,ProcessLookupError): continue  # An individual FD closed.
                fd_count+=1
                require((info.st_dev,info.st_ino) not in inode_set,'cache_process_fd_reference')
        except (FileNotFoundError,ProcessLookupError): unknown.append('fd-directory')
        try:
            maps=(p/'maps').read_text(errors='replace')
            require(not any(str(r) in maps for r in paths),'cache_mapped_reference')
            for line in maps.splitlines():
                fields=line.split(None,5); major,minor=(int(v,16) for v in fields[3].split(':'))
                require((os.makedev(major,minor),int(fields[4])) not in inode_set,'cache_mapped_inode_reference')
        except (FileNotFoundError,ProcessLookupError): unknown.append('maps')
        try:
            for line in (p/'mountinfo').read_text().splitlines():
                fields=line.split(); separator=fields.index('-')
                decode=lambda value: re.sub(r'\\([0-7]{3})',lambda match:chr(int(match[1],8)),value)
                source,target=(Path(decode(fields[n])) for n in [3,4])
                require(target.is_absolute(),'cache_namespace_mount_path_invalid')
                require(source==Path('/') or not overlaps(source),'cache_namespace_mount_reference')
                # A renamed bind keeps its inode even when mountinfo's source
                # pathname no longer matches the original cache pathname.
                if source!=Path('/'):
                    info=(p/'root'/str(target).lstrip('/')).stat()
                    require((info.st_dev,info.st_ino) not in inode_set,'cache_namespace_mount_inode_reference')
                if target!=Path('/') and overlaps(target):
                    inaccessible=(source==Path('/systemd/inaccessible/dir') and fields[separator+1]=='tmpfs'
                        and {'ro','nosuid','nodev','noexec'}<=set(fields[5].split(',')))
                    require(inaccessible,'cache_namespace_mount_reference')
                    # systemd can hide /home behind an inaccessible tmpfs.
                    # Qualify only the observed missing namespace paths, not
                    # permission denials or an accessible foreign cache.
                    for cache in paths:
                        try: (p/'root'/str(cache).lstrip('/')).stat()
                        except FileNotFoundError: continue
                        raise RuntimeError('cache_namespace_mount_reference')
        except (FileNotFoundError,ProcessLookupError): unknown.append('mountinfo')
        # The observed Linux kernel threads have no userspace executable.
        # Qualify only that missing boundary; never skip the other checks.
        if unknown==['exe'] and fd_count==0 and maps=='':
            try:
                raw=(p/'stat').read_text(); fields=raw[raw.rfind(')')+2:].split()
                status=dict(line.split(':',1) for line in (p/'status').read_text().splitlines() if ':' in line)
                if int(fields[6]) & 0x00200000 and status.get('Kthread','').strip()=='1': unknown=[]
            except (FileNotFoundError,ProcessLookupError): pass
        try: ended=identity(p.stat())
        except (FileNotFoundError,ProcessLookupError): continue  # The whole PID actually exited.
        require(ended==started,'cache_process_identity_changed_during_scan')
        require(not unknown,'cache_process_reference_unknown_'+','.join(unknown))
        # PermissionError intentionally propagates: never bypass a denied read.
    for container in docker.request('GET','/containers/json?all=1&size=0'):
        for mount in container.get('Mounts',[]):
            source=mount.get('Source')
            if source: require(source!='/' and not overlaps(Path(source)),'cache_container_mount_reference')

def rename_no_replace(src_fd, src_name, dest_fd, dest_name):
    libc=ctypes.CDLL(None,use_errno=True); rename=libc.renameat2
    rename.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint]; rename.restype=ctypes.c_int
    if rename(src_fd,os.fsencode(src_name),dest_fd,os.fsencode(dest_name),1): raise OSError(ctypes.get_errno(),os.strerror(ctypes.get_errno()))
    os.fsync(src_fd); os.fsync(dest_fd)

def named_root_state(directory, name, owned):
    try: info=os.stat(name,dir_fd=directory,follow_symlinks=False)
    except FileNotFoundError: return 'absent'
    return 'owned' if stat.S_ISDIR(info.st_mode) and identity(info)==owned else 'foreign'

def reconcile_move(parent, fd, path, item, name, stage):
    owned=expected(item); require(identity(os.fstat(fd))==owned,'cache_open_root_identity_changed')
    return {'source':named_root_state(parent,path.name,owned),'quarantine':named_root_state(stage,name,owned)}

def restore_intent(parent, fd, path, item, name, stage, root, ancestors):
    row={'path':str(path),'restored':False,'durable':False}
    try:
        require(identity(os.fstat(parent))==expected(ancestors[str(path.parent)]),'restore_parent_changed')
        require(path.parent.resolve()==path.parent and identity(path.parent.lstat())==identity(os.fstat(parent)),'restore_parent_detached')
        state=reconcile_move(parent,fd,path,item,name,stage); row['observedBefore']=state
        if state['source']=='owned' and state['quarantine']!='owned':
            row.update(restored=True,durable=True,action='already_at_source')
            if state['quarantine']=='foreign': row['foreignQuarantinePreserved']=True
        else:
            require(state=={'source':'absent','quarantine':'owned'},'restore_conflict_or_missing_owned_root')
            rename_no_replace(stage,name,parent,path.name)
            state=reconcile_move(parent,fd,path,item,name,stage)
            require(state=={'source':'owned','quarantine':'absent'},'restore_identity_not_confirmed')
            row.update(restored=True,durable=True,action='restored_from_authenticated_quarantine')
    except BaseException as error:
        row['error']=type(error).__name__+': '+str(error)
        # A restore itself can complete daemon/filesystem-side before fsync or
        # interruption raises. Observe both names; never rename an unknown ID.
        try:
            state=reconcile_move(parent,fd,path,item,name,stage); row['observedAfterError']=state
            row['restored']=state['source']=='owned' and state['quarantine']!='owned'
            if state['quarantine']=='owned': row['retainedQuarantine']=str(root/name)
            if state['source']=='foreign': row['foreignSourcePreserved']=True
            if state['quarantine']=='foreign': row['foreignQuarantinePreserved']=True
        except BaseException as secondary: row['reconciliationFailure']=type(secondary).__name__+': '+str(secondary)
    return row

def erase_files(fd, item, removed):
    dirs={r['relativePath']:r for r in item['directories']}
    for row in item['files']:
        parent,name=open_parent(fd,row['relativePath'],dirs)
        try:
            f=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=parent)
            try:
                verify_file(f,row); require(identity(os.stat(name,dir_fd=parent,follow_symlinks=False))==identity(os.fstat(f)),'cache_leaf_replaced')
                os.unlink(name,dir_fd=parent); removed.append({'root':item['path'],'relativePath':row['relativePath'],'sha256':row['sha256'],'allocatedBytes':row['allocatedBytes']}); os.fsync(parent)
            finally: os.close(f)
        finally: os.close(parent)
    require(all(stat.S_ISDIR(s.st_mode) for s in walk(fd).values()),'cache_files_remain')

def validate(p):
    require(p['schema']=='keel-public-package-cache-cleanup@1' and re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}',p['id']),'schema_or_identity')
    require(tuple(i['path'] for i in p['caches'])==ROOTS and len(p['caches'][0]['files'])==688 and len(p['caches'][1]['files'])==200,'exact_two_cache_roots_and_files')
    require(sum(r['allocatedBytes'] for i in p['caches'] for r in i['files'])==488615936 and p['allocatedReclaimBytes']==488615936,'exact_file_allocation')
    require(p['rollbackAndMetadataReserveBytes']==RESERVE and p['preserveDirectoryShells'] is True and p['configurationOrCredentialCleanup'] is False and p['containerOrImageMutation'] is False and p['applicationActivation'] is False,'retention_and_scope')
    require(all(r['uid']==1000 and r['gid']==1000 and r['links']==1 and re.fullmatch('[0-9a-f]{64}',r['sha256']) for i in p['caches'] for r in i['files']),'single_link_hash_bound_public_files_only')

def cleanup(root, plan, docker, host, guard, ancestors, execute, plan_sha, review_sha):
    require(not(root/'cache-cleanup-consumed.json').exists() and not(root/'cache-cleanup-receipt.json').exists(),'already_consumed_or_receipted')
    handles=[]; intents=[]; removed=[]; primary=None
    before=guard.original(docker); result={'schema':'keel-public-package-cache-cleanup-result@1','result':'PREFLIGHT-ONLY','planSHA256':plan_sha,'originalBefore':before,'removed':removed,'directoryShellsRemoved':0,'applicationActivation':False,'databaseMutation':False,'configurationOrCredentialCleanup':False}
    free=lambda:os.statvfs('/var/lib/docker').f_bavail*os.statvfs('/var/lib/docker').f_frsize
    try:
        ids=set()
        for i,item in enumerate(plan['caches']):
            path=Path(item['path']); parent=open_absolute(path.parent,ancestors); cache=os.open(path.name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=parent)
            handles.append((parent,cache,path,item)); ids.update(snapshot(cache,item))
        no_references(plan['caches'],ids,docker); require(free()>=RESERVE,'rollback_reserve_required'); result['freeBeforeBytes']=free()
        require(not(root/'cache-cleanup-consumed.json').exists(),'already_consumed')
        if execute:
            # claim() is the installed durable one-shot file+directory fsync helper.
            host.consume(root,{'planSHA256':plan_sha,'reviewSHA256':review_sha},'cache-cleanup-consumed.json')
            stage=os.open(root,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
            try:
                for n,(parent,fd,path,item) in enumerate(handles):
                    require(identity(os.stat(path.name,dir_fd=parent,follow_symlinks=False))==identity(os.fstat(fd)),'cache_root_replaced')
                    name='quarantine-'+str(n)
                    require(named_root_state(stage,name,expected(item))=='absent','quarantine_destination_already_exists')
                    # Write intent before the syscall. Even a post-rename fsync
                    # failure or signal must leave an authenticated recovery set.
                    intents.append((parent,fd,path,item,name))
                    result['moveIntents']=[{'path':str(p),'quarantine':q,'rootIdentity':list(expected(i))} for _,_,p,i,q in intents]
                    host.persist(root,'cache-cleanup-move-intents.json',{'planSHA256':plan_sha,'intents':result['moveIntents']})
                    rename_no_replace(parent,path.name,stage,name)
                # Under root-owned0700 quarantine no new uid1000 traversal can begin.
                # Abort before any unlink if a process retained a cache FD across rename.
                ids=set()
                for parent,fd,path,item,name in intents:
                    require(reconcile_move(parent,fd,path,item,name,stage)=={'source':'absent','quarantine':'owned'},'uncertain_move_blocks_deletion')
                    ids.update(snapshot(fd,item))
                no_references(plan['caches'],ids,docker)
                for _,fd,_,item,_ in intents: erase_files(fd,item,removed)
                result['result']='PASS'
            except BaseException as e:
                result['primaryOperationFailure']=type(e).__name__+': '+str(e); raise
            finally:
                restoration=[restore_intent(parent,fd,path,item,name,stage,root,ancestors) for parent,fd,path,item,name in reversed(intents)]
                result['restoration']=restoration; os.close(stage)
            require(len(restoration)==len(intents) and all(r['restored'] and r['durable'] for r in restoration),'cache_shell_restore_conflict_foreign_occupant_preserved')
    except BaseException as e: primary=e; result.update(result='FAIL',failure=type(e).__name__+': '+str(e))
    finally:
        try: result['originalAfter']=guard.original(docker); require(result['originalAfter']==before,'original_state_changed')
        except BaseException as e: primary=primary or e; result.update(result='FAIL',finalGuardFailure=str(e))
        result['freeAfterBytes']=free(); result['removedAllocatedBytes']=sum(r['allocatedBytes'] for r in removed)
        for parent,fd,_,_ in handles: os.close(fd); os.close(parent)
        if execute: host.persist(root,'cache-cleanup-receipt.json',result)
    if primary: raise primary
    return result

def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--root',required=True); parser.add_argument('--plan-sha256',required=True); parser.add_argument('--review-sha256'); parser.add_argument('--execute',action='store_true'); a=parser.parse_args(); root=Path(a.root)
    require(sys.platform=='linux' and os.geteuid()==0 and root.resolve()==root and root.parent==BASE and root.stat().st_uid==0 and stat.S_IMODE(root.stat().st_mode)==0o700,'exclusive_root_linux_operator_required')
    plan_path=root/'cache-cleanup-plan.json'; immutable(plan_path,0o444,a.plan_sha256); p=json.loads(plan_path.read_bytes()); validate(p)
    require(root.name=='keel-proof-qualification-'+p['id'] and Path(__file__).resolve()==root/'cleanup-public-caches.py' and sha(__file__)==p['scriptSHA256'],'operator_identity')
    if a.execute:
        review_path=root/'cache-cleanup-review.json'; immutable(review_path,0o444,a.review_sha256); review=json.loads(review_path.read_bytes())
        require(review['schema']=='keel-public-package-cache-cleanup-review@1' and review['decision']=='APPROVE' and review['planSHA256']==a.plan_sha256 and review['scope']=='exact-888-public-cache-files-only' and review['blockingFindings']==[],'independent_cleanup_admission_required')
    prior,host,core,guard,_=dependency()
    with open('/run/lock/keel-studio-rollout.lock','rb') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB); signal.alarm(600)
        try: result=cleanup(root,p,core.Docker(),host,guard,p['ancestors'],a.execute,a.plan_sha256,a.review_sha256)
        finally: signal.alarm(0)
    print(json.dumps(result))

if __name__=='__main__':
    def interrupted(signum,frame): raise InterruptedError('cache_cleanup_interrupted_'+str(signum))
    for event in [signal.SIGINT,signal.SIGTERM,signal.SIGHUP,signal.SIGALRM]: signal.signal(event,interrupted)
    main()
