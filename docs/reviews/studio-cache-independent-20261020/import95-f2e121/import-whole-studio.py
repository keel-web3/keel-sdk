#!/usr/bin/env python3
"""One reviewed fresh Studio image stdin import. Never cleans files or starts containers."""
import argparse,fcntl,hashlib,importlib.util,json,os,re,signal,stat,sys
from pathlib import Path
BASE=Path('/home/ubuntu')
PREVIOUS=BASE/'keel-proof-qualification-ffb6dc04-423d-4264-9bae-6443d3d9d772'
IMAGE='sha256:95bdda05a7596553251e9d4ba9fe72758abc5137fcb661efed80ca94ab5e6bcb'
PARENT='sha256:fe94404ea7a860e6397e0964ef8dbe7d9fa9bb2777a57dd90cf8c63d802d8369'
NATIVE='sha256:d97ddf2aba94cb963646fdf05bc8dc8c99b7e69b8c19bad85c06bea7c67fc9f5'
RESERVE,METADATA=1073741824,268435456

def require(ok,reason):
 if not ok:raise RuntimeError(reason)
def sha(p):
 with Path(p).open('rb')as f:return hashlib.file_digest(f,'sha256').hexdigest()
def immutable(p,mode,digest):
 i=p.lstat();require(stat.S_ISREG(i.st_mode)and i.st_uid==0 and stat.S_IMODE(i.st_mode)==mode and sha(p)==digest,'immutable_dependency_changed')
def previous():
 require(PREVIOUS.resolve()==PREVIOUS and PREVIOUS.stat().st_uid==0 and stat.S_IMODE(PREVIOUS.stat().st_mode)==0o700,'previous_stage_root')
 for name,mode,digest in [('import-whole-studio.py',0o444,'678a06e47042918d319694f9c93bca156d218cf64913ee51ec56241940e05251'),('whole-studio-plan.json',0o444,'e75c63a4903863927a16e65297faf79106c7a092d0df67dbb8c2e73617413fc1'),('app-receipt.json',0o600,'71acc384008c655eeb1a2dcf286af7bcfb75ad1fe0bf8b6bceb17c4b8063f123')]:immutable(PREVIOUS/name,mode,digest)
 s=importlib.util.spec_from_file_location('actual_prior_sdk_stage',PREVIOUS/'import-whole-studio.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m);p=json.loads((PREVIOUS/'whole-studio-plan.json').read_bytes());m.validate(p);r=json.loads((PREVIOUS/'app-receipt.json').read_bytes());require(r['result']=='PASS'and r['phase']=='app'and r['planSHA256']==sha(PREVIOUS/'whole-studio-plan.json')and r['actualImageId']==PARENT and r['originalBefore']==r['originalAfter']and r['allRootFSAndImageConfigFieldsVerified']is True and r['load']['inputSHA256']==p['app']['archiveSHA256']and r['load']['physicalInputBytes']==p['app']['archiveBytes'],'previous_actual_import_not_qualified');prior,host,core,guard,_=m.previous();return prior,host,core,guard,p

def validate(p):
 require(p['schema']=='keel-whole-studio-stdin-import@1'and re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}',p['id']),'schema_or_identity')
 require(p['app']['index']==IMAGE and p['base']['index']==PARENT and p['runner']['index']==NATIVE,'exact_images')
 require(len(p['base']['rootFSLayers'])==34 and p['app']['rootFSLayers'][:34]==p['base']['rootFSLayers'],'all_parent_layers')
 require(p['app']['archiveBytes']==692871680 and p['app']['archiveSHA256']=='f015350eb2566bd9557d5033795713ba1d5aa97c04a55e84a837541e4d071407'and p['app']['expandedBytes']==1979348992,'actual_archive')
 require(p['newExpandedLayerTarBytes']==212083200 and p['rollbackReserveBytes']==RESERVE and p['metadataReserveBytes']==METADATA,'actual_expansion_and_reserves')
 require(p['applicationActivation']is False and p['cleanupAllowed']is False and p['transactionSubmission']is False,'import_only')
def capacity(p):return RESERVE+METADATA+p['app']['archiveBytes']+p['newExpandedLayerTarBytes']

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--root',required=True);parser.add_argument('--plan-sha256',required=True);parser.add_argument('--review-sha256');parser.add_argument('--execute',action='store_true');a=parser.parse_args();root=Path(a.root)
 require(os.geteuid()==0 and root.resolve()==root and root.parent==BASE and root.stat().st_uid==0 and stat.S_IMODE(root.stat().st_mode)==0o700,'exclusive_root')
 path=root/'whole-studio-plan.json';immutable(path,0o444,a.plan_sha256);p=json.loads(path.read_bytes());validate(p);require(not a.execute or p.get('releaseHold') is None,'held_predecessor_requires_final_discovery_fix_tuple');require(root.name=='keel-proof-qualification-'+p['id']and Path(__file__).resolve()==root/'import-whole-studio.py'and sha(__file__)==p['scriptSHA256'],'operator_identity')
 if a.execute:
  path=root/'whole-studio-review.json';immutable(path,0o444,a.review_sha256);r=json.loads(path.read_bytes());require(r['schema']=='keel-whole-studio-stdin-import-review@1'and r['decision']=='APPROVE'and r['planSHA256']==a.plan_sha256 and r['allowedPhases']==['app']and r['blockingFindings']==[],'independent_import_admission')
 prior,host,core,guard,old=previous();require(old['app']==p['base']and old['runner']==p['runner'],'previous_image_descriptors_changed')
 with open('/run/lock/keel-studio-rollout.lock','rb')as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);docker=core.Docker();before=guard.original(docker);require(docker.request('GET','/info')['DockerRootDir']=='/var/lib/docker','docker_filesystem_changed');require(host.image(docker,p['base'])is not None and host.image(docker,p['runner'])is not None,'parent_or_native_missing');require(host.image(docker,p['app'])is None,'already_loaded_requires_review');free=lambda:os.statvfs('/var/lib/docker').f_bavail*os.statvfs('/var/lib/docker').f_frsize;require(free()>=capacity(p),'full_raw_scratch_new_layers_and_reserves_required');require(not(root/'app-consumed.json').exists(),'already_consumed')
  result={'schema':'keel-whole-studio-stdin-import-result@1','phase':'app','result':'PREFLIGHT-ONLY','planSHA256':a.plan_sha256,'originalBefore':before,'freeBeforeBytes':free(),'requiredBytes':capacity(p),'applicationActivation':False,'databaseMutation':False,'cleanupPerformed':False,'transactionSubmission':False}
  if not a.execute:print(json.dumps(result));return
  prior.claim(root,'app',{'planSHA256':a.plan_sha256,'reviewSHA256':a.review_sha256});primary=None
  try:
   signal.alarm(600)
   try:result['load']=prior.stream_load(p['app'],sys.stdin.buffer)
   finally:signal.alarm(0)
   image=host.image(docker,p['app']);require(image is not None,'loaded_image_missing');result.update(result='PASS',actualImageId=image['Id'],allRootFSAndImageConfigFieldsVerified=True)
  except BaseException as error:primary=error;result.update(result='FAIL',failure=type(error).__name__+': '+str(error))
  finally:
   try:
    result['originalAfter']=guard.original(docker);require(result['originalAfter']==before,'original_changed');require(host.image(docker,p['base'])is not None and host.image(docker,p['runner'])is not None,'retained_parent_or_native_changed')
   except BaseException as error:primary=primary or error;result.update(result='FAIL',finalGuardFailure=str(error))
   result['freeAfterBytes']=free()
   try:host.persist(root,'app-receipt.json',result)
   except BaseException as error:print(json.dumps({**result,'persistenceFailure':str(error)}),file=sys.stderr);raise
  print(json.dumps(result))
  if primary:raise primary
if __name__=='__main__':
 def interrupted(signum,frame):raise InterruptedError('import_interrupted_'+str(signum))
 for event in [signal.SIGINT,signal.SIGTERM,signal.SIGHUP,signal.SIGALRM]:signal.signal(event,interrupted)
 main()
