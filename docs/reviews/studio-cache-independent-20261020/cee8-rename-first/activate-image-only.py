#!/usr/bin/env python3
"""Replace only Studio's image; retain the current runner/socket/catalog/data.

Default is read-only. This is a new current95 rollout, not the initial a53
backend/factory activation. Private Docker Env is used only in host memory.
"""
import argparse
import copy
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import sys
from urllib.parse import quote
sys.dont_write_bytecode=True

SDK="311d61526284248938e335d7ed879089408933be"
CURRENT="keel-showcase-paid-release-capacity-20261008"
CURRENT_ID="fa0eb0299164407e24e1cda31b21b196ea8a8071a1a39ce71efd414234ef1659"
CURRENT_IMAGE="sha256:fe455169d3d10b37696ed17053ff0be167649f5a490acd7e4cea61c2412d6ccb"
RUNNER="434316eff6e19951807f95ba8aee03a4db684d760039dfeb723c7bf9203a8649"
PROFILE_KEYS={"/version":("Version","GitCommit","ApiVersion","MinAPIVersion","Os","Arch","KernelVersion"),"/info":("ServerVersion","CgroupVersion","OomKillDisable","MemoryLimit","MemorySwap","DockerRootDir")}
GIB=1024**3

def require(ok,reason):
    if not ok:raise RuntimeError(reason)
def digest(x):return hashlib.sha256(json.dumps(x,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()
def file_sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def regular(root,name,expected):
    require(re.fullmatch(r'[a-zA-Z0-9_.-]+',name) is not None,'invalid_artifact_name')
    p=root/name;s=p.lstat()
    require(stat.S_ISREG(s.st_mode) and s.st_uid==0 and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==0o444,'artifact_metadata_changed')
    require(file_sha(p)==expected,'artifact_bytes_changed');return p
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
def modules(root,plan):
    files=plan['operatorFiles']
    return (load('image_only_support',regular(root,'reviewed-activation-support.py',files['reviewed-activation-support.py'])),
            load('image_only_guard',regular(root,'guarded-deployment-checks.py',files['guarded-deployment-checks.py'])),
            load('image_only_oom',regular(root,'candidate-oom-default.py',files['candidate-oom-default.py'])))
def mount_digest(guard,value):return digest(list(guard.mounts_signature(value)))
def profile(docker):
    return {'schema':'keel.current-docker-default-capabilities@1','readOnly':True,
      'daemon':{p:{k:v.get(k) for k in keys} for p,keys in PROFILE_KEYS.items() for v in [docker.request('GET',p)]}}
def assert_baseline(value,expected,guard,healthy=True):
    require(value['Id']==expected['id'] and value['Image']==expected['image'],'baseline_identity_changed')
    require(digest(value['Config'])==expected['configSHA256'] and digest(value['HostConfig'])==expected['hostConfigSHA256'],'baseline_raw_configuration_changed')
    require(mount_digest(guard,value['Mounts'])==expected['mountsSHA256'],'baseline_complete_mounts_changed')
    if healthy:require(value['State']['Running'] is True and value['State'].get('Health',{}).get('Status')=='healthy','baseline_not_healthy')
def assert_runner(docker,plan,guard):
    value=docker.container(RUNNER);assert_baseline(value,plan['existingRunner'],guard,False)
    require(value['State']['Running'] is True and value['State']['OOMKilled'] is False,'existing_runner_not_running')
    volume=docker.request('GET','/volumes/'+quote(plan['existingSocket']['Name'],safe=''))
    require({k:volume[k] for k in ('Name','Driver','Options')}==plan['existingSocket'],'existing_socket_changed')
    return value
def desired_request(old,plan):
    c=copy.deepcopy(old['Config']);h=copy.deepcopy(old['HostConfig'])
    require(not any('b524bf5fc19939c7523aada2e53f79e3360970ea' in item for item in c['Env']),'old_sdk_environment_metadata_needs_explicit_review')
    require('OomKillDisable' in h and h['OomKillDisable'] is None,'current95_oom_default_changed')
    h['OomKillDisable']=False # Explicit CREATE default, qualified START comparison below.
    c['Image']=plan['candidate']['appImageId']
    c['Labels']={**(c.get('Labels') or {}),'io.keel.studio.rollout.id':plan['activationId'],'io.keel.studio.rollout.role':'application'}
    return {**c,'HostConfig':h}
def assert_candidate(value,old,plan,desired,guard,oom,fresh_profile):
    require(value['Image']==plan['candidate']['appImageId'],'candidate_image_changed')
    expected={'Config':{k:v for k,v in desired.items() if k!='HostConfig'},'HostConfig':desired['HostConfig']}
    result=oom.assert_candidate_configuration(expected,{k:value[k] for k in ('Config','HostConfig')},fresh_profile,guard)
    require(guard.mounts_signature(value['Mounts'])==guard.mounts_signature(old['Mounts']),'candidate_mounts_changed')
    return result
def check_image(docker,plan):
    image=docker.image(plan['candidate']['appImageId']);a=plan['imageAudit']
    require(image['Id']==plan['candidate']['appImageId'] and image['Os']=='linux' and image['Architecture']=='amd64','candidate_image_identity_changed')
    require(type(image['Size']) is int and image['Size']==a['imageBytes'],'candidate_image_size_changed')
    require(digest(image['Config'])==a['configSHA256'] and digest(image['RootFS'])==a['rootFSSHA256'],'candidate_complete_image_changed')
    return image
def validate(plan):
    require(plan['schema']=='keel.current95-image-only-activation@1','plan_schema')
    require(re.fullmatch('[0-9a-f]{40}',plan['candidate']['siteCommit']) is not None and plan['candidate']['sdkCommit']==SDK,'source_tuple')
    require(re.fullmatch('sha256:[0-9a-f]{64}',plan['candidate']['appImageId']) is not None and plan['candidate']['appImageId']!=CURRENT_IMAGE,'new_immutable_image')
    require(re.fullmatch('[A-Za-z0-9_-]+',plan['candidate']['buildId']) is not None,'build_identity')
    require(plan['expectedCurrent']['id']==CURRENT_ID and plan['expectedCurrent']['image']==CURRENT_IMAGE and plan['existingRunner']['id']==RUNNER,'wrong_current95_baseline')
    require(re.fullmatch('[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}',plan['activationId']) is not None,'new_activation_uuid')
    names=[plan[k] for k in ('candidateName','rollbackName','failedName')]
    require(len(set(names))==3 and CURRENT not in names and all(re.fullmatch('keel-[a-z0-9_.-]{1,110}',n) for n in names),'unique_owned_names')
    require(type(plan['reserveBytes']) is int and plan['reserveBytes']>=GIB and plan['snapshotBudgetBytes']==256*1024**2,'preserve_rollback_snapshot_reserve')
    require(set(plan['approval'])=={'independentQA','independentReleaseReview','leadExecuteApproved'} and all(x is True for x in plan['approval'].values()),'required_approval_missing')
    require(set(plan['evidence'])=={'qa','releaseReview','import'},'exact_evidence_roles_required')
    require(plan['changes']=={'image':True,'rolloutLabels':True,'runner':False,'backendEnvironment':False,'catalog':False,'factories':False,'migrations':False,'data':False},'image_only_scope_changed')
def recover(docker,old,plan,desired,guard,oom,fresh_profile):
    """Resolve lost create/rename replies by immutable ID plus full config.

    Preserve every foreign occupant; never touch the shared runner, factories,
    socket, volumes or database. Only restore old95 after all owned apps stop.
    """
    owned={};foreign=[];errors=[]
    for lookup in (plan['candidateName'],CURRENT,plan['failedName']):
        try:
            v=docker.maybe_container(lookup)
            if v is None or v['Id']==old['Id']:continue
            try:assert_candidate(v,old,plan,desired,guard,oom,fresh_profile)
            except BaseException:foreign.append(v['Id']);continue
            owned[v['Id']]=v
        except BaseException:errors.append('candidate_lookup_unresolved')
    for identity in owned:
        try:
            # Repeat complete ownership immediately before mutation, then use ID.
            assert_candidate(docker.container(identity),old,plan,desired,guard,oom,fresh_profile)
            if docker.container(identity)['Name']=='/'+CURRENT:
                require(docker.maybe_container(plan['failedName']) is None,'failed_name_occupied')
                try:docker.action(identity,'rename','?name='+quote(plan['failedName'],safe=''))
                except BaseException:
                    # A lost reply is not a second rename. Reconcile the same
                    # fully authenticated ID at its already-applied name.
                    retained=docker.container(identity)
                    assert_candidate(retained,old,plan,desired,guard,oom,fresh_profile)
                    require(retained['Name']=='/'+plan['failedName'],'candidate_retention_rename_unconfirmed')
            retained=docker.container(identity)
            assert_candidate(retained,old,plan,desired,guard,oom,fresh_profile)
            require(retained['Name'] in ('/'+plan['candidateName'],'/'+plan['failedName']),'candidate_still_on_wakeup_name')
            docker.action(identity,'stop','?t=30')
            require(docker.container(identity)['State']['Running'] is False,'candidate_stop_unconfirmed')
        except BaseException:errors.append('owned_candidate_stop_or_retention_failed')
    try:
        require(not errors and not foreign,'ownership_unresolved')
        require(all(docker.container(i)['State']['Running'] is False for i in owned),'candidate_still_running')
        previous=docker.container(old['Id']);assert_baseline(previous,plan['expectedCurrent'],guard,False)
        assert_runner(docker,plan,guard)
        occupant=docker.maybe_container(CURRENT)
        require(occupant is None or occupant['Id']==old['Id'],'current_foreign_occupant_preserved')
        if previous['Name']!='/'+CURRENT:docker.action(old['Id'],'rename','?name='+quote(CURRENT,safe=''))
        if not previous['State']['Running']:docker.action(old['Id'],'start')
        # Caller waits for health using the unchanged reviewed bound.
    except BaseException:errors.append('old95_restore_unconfirmed')
    return {'confirmed':not errors and not foreign,'recoveredCandidateIds':sorted(owned),'preservedForeignIds':sorted(set(foreign)),'errors':errors,'runnerTouched':False,'databaseRestorePerformed':False}
def main():
    p=argparse.ArgumentParser();p.add_argument('plan');p.add_argument('--execute-approved-sha256');args=p.parse_args()
    path=Path(args.plan).resolve(strict=True);root=path.parent;raw=path.read_bytes();plan=json.loads(raw);validate(plan)
    require(root.stat().st_uid==0 and stat.S_IMODE(root.stat().st_mode)==0o700 and root.resolve()==root,'private_stage_root')
    require(file_sha(Path(__file__))==plan['operatorSHA256'],'operator_changed')
    for record in plan['evidence'].values():regular(root,record['path'],record['sha256'])
    support,guard,oom=modules(root,plan)
    regular(root,'snapshot-supervisor.cjs',support.SNAPSHOT_SUPERVISOR_SHA256)
    docker=support.Docker()
    lock=os.open(support.LOCK,os.O_RDWR|os.O_NOFOLLOW|os.O_CLOEXEC)
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    fresh_profile=profile(docker);require(digest(fresh_profile)==oom.PROFILE_CANONICAL_SHA256,'daemon_profile_changed')
    old=docker.container(CURRENT);assert_baseline(old,plan['expectedCurrent'],guard);guard.assert_publisher_paused(old)
    assert_runner(docker,plan,guard);check_image(docker,plan)
    for name in ('candidateName','rollbackName','failedName'):require(docker.maybe_container(plan[name]) is None,'planned_name_occupied')
    root_disk=fresh_profile['daemon']['/info']['DockerRootDir'];require(os.stat(root).st_dev==os.stat(root_disk).st_dev,'disk_device_changed')
    free=shutil.disk_usage(root_disk).free;require(free>=plan['reserveBytes']+plan['snapshotBudgetBytes'],'snapshot_rollback_reserve_missing')
    desired=desired_request(old,plan)
    receipt={'schema':'keel.current95-image-only-result@1','mode':'read-only-preflight','productionActivated':False,'candidate':plan['candidate'],'originalContainer':old['Id'],'existingRunner':RUNNER,'diskFreeBytes':free,'requiredBytes':plan['reserveBytes']+plan['snapshotBudgetBytes'],'runnerChanged':False,'catalogChanged':False,'factoriesChanged':False,'databaseRestorePerformed':False,'signaturesRequested':0,'transactionsSubmitted':0}
    if not args.execute_approved_sha256:print(json.dumps(receipt,indent=2));return
    require(args.execute_approved_sha256==hashlib.sha256(raw).hexdigest() and path.read_bytes()==raw,'exact_approved_plan_changed')
    claim=root/'activation-consumed.json'
    with os.fdopen(os.open(claim,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600),'w') as f:f.write(json.dumps({'planSHA256':args.execute_approved_sha256})+'\n');f.flush();os.fsync(f.fileno())
    fd=os.open(root,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(fd)
    finally:os.close(fd)
    for sig in (signal.SIGTERM,signal.SIGINT,signal.SIGHUP):signal.signal(sig,lambda *_:(_ for _ in ()).throw(InterruptedError('operator_interrupted')))
    replacement=None;receipt['mode']='execute';receipt['phase']='snapshot-before-candidate';support.safe_receipt(root,receipt)
    try:
        receipt['databaseSnapshot']=support.retain_database_snapshot(root,old['Id'],plan['snapshotBudgetBytes'])
        require(shutil.disk_usage(root_disk).free>=plan['reserveBytes'],'reserve_changed_after_snapshot')
        assert_baseline(docker.container(old['Id']),plan['expectedCurrent'],guard);assert_runner(docker,plan,guard)
        receipt['phase']='candidate-create-attempt';support.safe_receipt(root,receipt)
        replacement=docker.create(plan['candidateName'],desired)
        receipt['oomComparison']=assert_candidate(docker.container(replacement),old,plan,desired,guard,oom,profile(docker))
        require(docker.container(replacement)['State']['Running'] is False,'candidate_started_before_guard')
        assert_baseline(docker.container(CURRENT),plan['expectedCurrent'],guard)
        guard.assert_publisher_paused(docker.container(CURRENT))
        # Retire the proxy's wakeup name while the original is still healthy.
        # The proxy resolves that name for every start; it cannot wake this
        # original after the following immutable-ID stop.
        receipt['phase']='rename-running-original';support.safe_receipt(root,receipt)
        docker.action(old['Id'],'rename','?name='+quote(plan['rollbackName'],safe=''))
        previous=docker.container(old['Id']);assert_baseline(previous,plan['expectedCurrent'],guard)
        require(previous['Name']=='/'+plan['rollbackName'],'old_rollback_name_unconfirmed')
        require(docker.maybe_container(CURRENT) is None,'current_name_occupied_before_stop')
        receipt['phase']='stop-retained-original';support.safe_receipt(root,receipt)
        docker.action(old['Id'],'stop','?t=60');require(docker.container(old['Id'])['State']['Running'] is False,'old95_stop_unconfirmed')
        receipt['phase']='publish-candidate-name';support.safe_receipt(root,receipt)
        docker.action(replacement,'rename','?name='+quote(CURRENT,safe=''))
        receipt['oomComparison']=assert_candidate(docker.container(replacement),old,plan,desired,guard,oom,profile(docker))
        receipt['phase']='start-candidate';support.safe_receipt(root,receipt)
        docker.action(replacement,'start')
        receipt['phase']='wait-candidate-health';support.safe_receipt(root,receipt)
        live=support.wait_healthy(docker,replacement)
        receipt['oomComparison']=assert_candidate(live,old,plan,desired,guard,oom,profile(docker))
        guard.assert_publisher_paused(live);assert_runner(docker,plan,guard)
        assert_baseline(docker.container(old['Id']),plan['expectedCurrent'],guard,False)
        require(docker.container(old['Id'])['State']['Running'] is False,'old95_concurrent_runtime')
        receipt.update(phase='healthy-awaiting-independent-live-QA',productionActivated=True,newContainer=replacement,retainedRollbackContainer=old['Id'],retainedRollbackName=plan['rollbackName'])
        support.safe_receipt(root,receipt);print(json.dumps(receipt,indent=2))
    except BaseException as error:
        receipt.update(failedPhase=receipt['phase'],failureCode=str(error) if re.fullmatch('[a-z][a-z0-9_]{0,99}',str(error)) else 'unclassified',phase='failed',productionActivated=False,failureClass=type(error).__name__)
        # Snapshot failure precedes create; no runtime mutation is needed.
        if receipt.get('databaseSnapshot') is not None:
            try:receipt['rollback']=recover(docker,old,plan,desired,guard,oom,profile(docker))
            except BaseException:receipt['rollback']={'confirmed':False,'errors':['recovery_boundary_unavailable'],'runnerTouched':False,'databaseRestorePerformed':False}
            if receipt['rollback']['confirmed']:
                try:support.wait_healthy(docker,old['Id']);assert_baseline(docker.container(old['Id']),plan['expectedCurrent'],guard);assert_runner(docker,plan,guard)
                except BaseException:receipt['rollback']['confirmed']=False
        support.safe_receipt(root,receipt);raise RuntimeError('image_only_activation_failed_check_retained_receipt') from None

if __name__=='__main__':main()
