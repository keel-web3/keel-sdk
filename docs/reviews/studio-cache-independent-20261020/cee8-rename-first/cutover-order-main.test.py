"""Actual operator main and recovery with an explicit Docker/PG boundary double.
No daemon, PostgreSQL, host operation, private input or artifact qualification.
The stage ownership shim applies only to test-owned temporary files.
"""
import copy,hashlib,importlib.util,io,json,os,stat,sys,tempfile,types,unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch
from urllib.parse import unquote
sys.dont_write_bytecode=True
HERE=Path(__file__).parent

def load(name,p):
 s=importlib.util.spec_from_file_location(name,p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
m=load('successor',HERE/'activate-image-only.py');oldm=load('consumed_baseline',HERE.parent/'image-only-observer311/activate-image-only.py')
g=load('guard',HERE/'guarded-deployment-checks.py');oom=load('oom',HERE/'candidate-oom-default.py');support0=load('support',HERE/'reviewed-activation-support.py');PROFILE=json.loads((HERE/'daemon-profile.json').read_bytes())
def baseline(module,v):return {'id':v['Id'],'image':v['Image'],'configSHA256':module.digest(v['Config']),'hostConfigSHA256':module.digest(v['HostConfig']),'mountsSHA256':module.mount_digest(g,v['Mounts'])}
class Daemon:
 def __init__(self,module,old,runner,plan,fault=None,wake_at=None,foreign=None):
  self.m=module;self.values={x['Id']:copy.deepcopy(x)for x in[old,runner]};self.plan=plan;self.calls=[];self.fault=fault;self.fired=False;self.wake_at=wake_at;self.pending_wake=False;self.foreign=foreign;self.wake_events=[]
 def maybe_container(self,name):return copy.deepcopy(next((v for v in self.values.values()if name in(v['Id'],v['Name'].lstrip('/'))),None))
 def container(self,name):
  v=self.maybe_container(name)
  if v is None:raise RuntimeError('absent')
  # Hold the source's successful stopped-state read, then deliver a late
  # name-based wake before it executes the following statement.
  if self.pending_wake and name==self.m.CURRENT_ID and not v['State']['Running']:
   self.pending_wake=False;self.wake_current()
  return v
 def wake_current(self):
  v=self.maybe_container(self.m.CURRENT)
  if v is None:self.wake_events.append('current_name_absent');return
  self.wake_events.append(v['Id'])
  if not v['State']['Running']:
   try:self.action(v['Id'],'start',external=True)
   except RuntimeError:self.wake_events.append('start_rejected')
 def request(self,method,path,*args):
  assert method=='GET';return self.plan['existingSocket']
 def image(self,identity):return {'Id':identity,'Os':'linux','Architecture':'amd64','Size':713038494,'Config':{},'RootFS':{}}
 def create(self,name,desired):
  v={'Id':'newid','Name':'/'+name,'Image':desired['Image'],'Config':copy.deepcopy({k:x for k,x in desired.items()if k!='HostConfig'}),'HostConfig':copy.deepcopy(desired['HostConfig']),'Mounts':copy.deepcopy(self.values[self.m.CURRENT_ID]['Mounts']),'State':{'Running':False,'Health':{'Status':'healthy'},'OOMKilled':False}}
  self.values[v['Id']]=v;self.calls.append(('newid','create',name))
  if self.fault==('create','after'):self.fired=True;raise RuntimeError('lost_create_response')
  return v['Id']
 def action(self,identity,action,query='',external=False):
  v=self.values[identity];target=unquote(query.split('=',1)[1])if action=='rename'else''
  step=('rename_old'if identity==self.m.CURRENT_ID and action=='rename'and target==self.plan['rollbackName'] else 'stop_old'if identity==self.m.CURRENT_ID and action=='stop'else 'rename_candidate'if identity=='newid'and action=='rename'and target==self.m.CURRENT else 'start_candidate'if identity=='newid'and action=='start'else action)
  self.calls.append((identity,action,target))
  if step=='rename_old'and self.foreign=='rollback'and 'foreign'not in self.values:self.values['foreign']={'Id':'foreign','Name':'/'+self.plan['rollbackName'],'Image':'foreign','Config':{},'HostConfig':{},'Mounts':[],'State':{'Running':True}}
  if not self.fired and self.fault==(step,'before'):self.fired=True;raise RuntimeError('injected_before_'+step)
  if action=='rename':
   if self.maybe_container(target)is not None:raise RuntimeError('docker_api_status_409')
   v['Name']='/'+target
  elif action=='stop':v['State']['Running']=False
  elif action=='start':
   if identity=='newid'and self.values[self.m.CURRENT_ID]['State']['Running']:
    v['State']['ExitCode']=128;v['State']['Error']='port_already_allocated';v['HostConfig']['OomKillDisable']=None;raise RuntimeError('docker_api_status_500')
   # Existing API accepts both204 and already-started304; this has no retry.
   v['State']['Running']=True;v['State']['Health']={'Status':'healthy'};v['HostConfig']['OomKillDisable']=None
  else:raise AssertionError(action)
  if step=='stop_old'and self.wake_at=='stopped_read':self.pending_wake=True
  if step=='rename_candidate'and self.wake_at=='candidate_published'and not external:self.wake_current()
  if step=='rename_old'and self.foreign in('current','rollback'):
   if self.foreign=='current':self.values['foreign']={'Id':'foreign','Name':'/'+self.m.CURRENT,'Image':'foreign','Config':{},'HostConfig':{},'Mounts':[],'State':{'Running':True}}
  if not self.fired and self.fault==(step,'after'):self.fired=True;raise RuntimeError('lost_'+step+'_response')
class Cases(unittest.TestCase):
 def run_operator(self,module=m,fault=None,wake_at=None,foreign=None,snapshot_failure=False):
  t=tempfile.TemporaryDirectory();self.addCleanup(t.cleanup);root=Path(t.name).resolve()
  old={'Id':module.CURRENT_ID,'Image':module.CURRENT_IMAGE,'Name':'/'+module.CURRENT,'Config':{'Image':module.CURRENT_IMAGE,'Env':['PRIVATE=fixture-not-exported','KEEL_PUBLICATION_WORKER_PAUSED=1'],'Labels':{'old':'retained'}},'HostConfig':{'OomKillDisable':None,'ReadonlyRootfs':True,'Mounts':[{'Type':'volume','Source':'socket','Target':'/run/keel-proof','ReadOnly':True}]},'Mounts':[{'Type':'volume','Name':'socket','Destination':'/run/keel-proof','RW':False}],'State':{'Running':True,'Health':{'Status':'healthy'},'OOMKilled':False}}
  runner=copy.deepcopy(old);runner.update(Id=module.RUNNER,Image='sha256:native',Name='/runner')
  plan={'schema':'keel.current95-image-only-activation@1','activationId':'07a4de5e-f373-49bb-9e05-952906a8c4a4','candidate':{'siteCommit':'0c7b01e3acae5ec787568d6b5931b002654b4de0','sdkCommit':module.SDK,'buildId':'F2eKiuWl2rvz5hqBZQ9wi','appImageId':'sha256:'+'c'*64},'candidateName':'keel-candidate-test','rollbackName':'keel-rollback-test','failedName':'keel-failed-test','expectedCurrent':baseline(module,old),'existingRunner':baseline(module,runner),'existingSocket':{'Name':'socket','Driver':'local','Options':{'type':'tmpfs'}},'reserveBytes':1073741824,'snapshotBudgetBytes':268435456,'operatorSHA256':hashlib.sha256(Path(module.__file__).read_bytes()).hexdigest(),'operatorFiles':{},'imageAudit':{'imageBytes':713038494,'configSHA256':module.digest({}),'rootFSSHA256':module.digest({})},'approval':{'independentQA':True,'independentReleaseReview':True,'leadExecuteApproved':True},'evidence':{},'changes':{'image':True,'rolloutLabels':True,'runner':False,'backendEnvironment':False,'catalog':False,'factories':False,'migrations':False,'data':False}}
  for key in('qa','releaseReview','import'):
   p=root/(key+'.json');p.write_text('{"fixture":"not-real-approval"}');p.chmod(0o444);plan['evidence'][key]={'path':p.name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
  shutil_src=HERE/'snapshot-supervisor.cjs';(root/shutil_src.name).write_bytes(shutil_src.read_bytes());(root/shutil_src.name).chmod(0o444)
  path=root/'plan.json';path.write_text(json.dumps(plan));digest=hashlib.sha256(path.read_bytes()).hexdigest();d=Daemon(module,old,runner,plan,fault,wake_at,foreign)
  class OwnedPath(type(Path())):
   def stat(self,*,follow_symlinks=True):
    v=super().stat(follow_symlinks=follow_symlinks)
    if str(self).startswith(str(root)):
     values=list(v);values[4]=0;return os.stat_result(values)
    return v
   def lstat(self):return self.stat(follow_symlinks=False)
  lock=root/'rollout.lock';lock.touch();opened=[];open0=os.open;stat0=os.stat
  def stat_owned(p,*a,**kw):return stat0(root,*a,**kw)if str(p)==PROFILE['daemon']['/info']['DockerRootDir']else stat0(p,*a,**kw)
  def open_owned(p,*args,**kw):
   fd=open0(p,*args,**kw)
   if str(p)==str(lock):opened.append(fd)
   return fd
  def snapshot(*args):
   if snapshot_failure:raise RuntimeError('snapshot_fixture_failure')
   return {'path':'fixture-only.dump','bytes':1,'sha256':'0'*64}
  def healthy(docker,identity):
   v=docker.container(identity);module.require(v['State']['Running'],'runtime_exited_during_health_check');return v
  support=types.SimpleNamespace(Docker=lambda:d,LOCK=str(lock),SNAPSHOT_SUPERVISOR_SHA256=support0.SNAPSHOT_SUPERVISOR_SHA256,safe_receipt=support0.safe_receipt,retain_database_snapshot=snapshot,wait_healthy=healthy)
  failure=None
  with patch.object(module,'Path',OwnedPath),patch.object(module,'modules',return_value=(support,g,oom)),patch.object(module,'profile',return_value=PROFILE),patch.object(module.shutil,'disk_usage',return_value=types.SimpleNamespace(free=3*1024**3)),patch.object(module.os,'open',side_effect=open_owned),patch.object(module.os,'stat',side_effect=stat_owned),patch.object(g,'docker_processes',return_value=[(1,'node runtime-supervisor.mjs')]),patch.object(module.signal,'signal',return_value=None),patch.object(sys,'argv',['operator',str(path),'--execute-approved-sha256',digest]),redirect_stdout(io.StringIO()):
   try:module.main()
   except RuntimeError as e:failure=str(e)
   finally:
    for fd in opened:os.close(fd)
  self.assertTrue((root/'activation-receipt.json').exists(),'preflight fixture failed: '+str(failure));record=json.loads((root/'activation-receipt.json').read_bytes());return d,record,failure,old
 def restored(self,d,record,old):
  self.assertTrue(record['rollback']['confirmed']);self.assertEqual(d.container(m.CURRENT)['Id'],old['Id']);self.assertTrue(d.container(old['Id'])['State']['Running']);self.assertFalse(d.container('newid')['State']['Running']);self.assertNotIn(m.RUNNER,[x[0]for x in d.calls]);self.assertFalse(record['productionActivated'])
 def test_original_stop_first_reproduces_late_wake_port_failure(self):
  d,r,e,old=self.run_operator(oldm,wake_at='stopped_read');self.assertIsNotNone(e);self.assertIn(oldm.CURRENT_ID,d.wake_events);self.assertEqual(d.container('newid')['State']['Error'],'port_already_allocated');self.restored(d,r,old)
 def test_rename_first_late_wake_finds_name_gap_and_cannot_restart_old(self):
  d,r,e,old=self.run_operator(wake_at='stopped_read');self.assertIsNone(e);self.assertTrue(r['productionActivated']);self.assertEqual(d.wake_events,['current_name_absent']);self.assertFalse(d.container(old['Id'])['State']['Running']);self.assertTrue(d.container('newid')['State']['Running']);self.assertEqual([x[1]for x in d.calls],['create','rename','stop','rename','start'])
 def test_candidate_wake_after_publication_is_idempotent_start(self):
  d,r,e,old=self.run_operator(wake_at='candidate_published');self.assertIsNone(e);self.assertTrue(r['productionActivated']);self.assertEqual(d.wake_events,['newid']);self.assertFalse(d.container(old['Id'])['State']['Running']);self.assertEqual([x for x in d.calls if x[0]==m.CURRENT_ID and x[1]=='start'],[])
 def test_normal_name_wake_remains_supported_outside_cutover(self):
  d,r,e,old=self.run_operator();d.values['newid']['State']['Running']=False;d.wake_current();self.assertTrue(d.container('newid')['State']['Running']);self.assertEqual(d.wake_events,['newid'])
 def test_failures_before_and_lost_responses_after_every_cutover_mutation_restore(self):
  for step in('rename_old','stop_old','rename_candidate','start_candidate'):
   for when in('before','after'):
    with self.subTest(step=step,when=when):
     d,r,e,old=self.run_operator(fault=(step,when));self.assertIsNotNone(e);self.assertTrue(d.fired);self.restored(d,r,old);self.assertIn('failedPhase',r);self.assertTrue(r['failureCode'].startswith(('lost_','injected_')))
 def test_lost_create_response_resolves_owned_name(self):
  d,r,e,old=self.run_operator(fault=('create','after'));self.assertIsNotNone(e);self.restored(d,r,old)
 def test_foreign_rollback_name_prevents_retirement_preserves_original(self):
  d,r,e,old=self.run_operator(foreign='rollback');self.assertIsNotNone(e);self.restored(d,r,old);self.assertEqual(d.container('foreign')['Name'],'/keel-rollback-test');self.assertNotIn('foreign',[x[0]for x in d.calls])
 def test_foreign_current_in_gap_is_preserved_and_old_not_stopped(self):
  d,r,e,old=self.run_operator(foreign='current');self.assertIsNotNone(e);self.assertFalse(r['rollback']['confirmed']);self.assertTrue(d.container(old['Id'])['State']['Running']);self.assertTrue(d.container('foreign')['State']['Running']);self.assertNotIn('foreign',[x[0]for x in d.calls]);self.assertNotIn((old['Id'],'stop',''),d.calls)
 def test_snapshot_failure_cannot_create_or_rename(self):
  d,r,e,old=self.run_operator(snapshot_failure=True);self.assertIsNotNone(e);self.assertEqual(d.calls,[]);self.assertEqual(r['failedPhase'],'snapshot-before-candidate');self.assertTrue(d.container(old['Id'])['State']['Running'])
class RecoveryCases(unittest.TestCase):
 def setUp(self):
  self.fixtures=load('recovery_existing_fixture',HERE.parent/'image-only-observer311/image-only-controls.test.py');self.fixtures.m=m;f=self.fixtures.Controls();f.setUp();self.f=f
 def scenario(self,mode=None,location='current',foreign_failed=False):
  f=self.f;old=copy.deepcopy(f.old);old['Name']='/'+f.plan['rollbackName'];old['State']['Running']=False
  n=copy.deepcopy(f.new);n['Name']='/'+(m.CURRENT if location=='current'else f.plan['failedName']);n['State']['Running']=True;n['HostConfig']['OomKillDisable']=None
  class D(self.fixtures.Docker):
   def action(self,identity,action,query=''):
    is_retention=identity=='newid'and action=='rename'and query.endswith(f.plan['failedName'])
    if is_retention and mode=='before':raise RuntimeError('rename_reply_failed_before_apply')
    super().action(identity,action,query)
    if is_retention and mode=='after':raise RuntimeError('rename_reply_lost_after_apply')
  values=[old,f.runner,n]
  if foreign_failed:
   foreign=copy.deepcopy(n);foreign['Id']='foreign';foreign['Name']='/'+f.plan['failedName'];foreign['Config']['Env'].append('FOREIGN=yes');values.append(foreign)
  d=D(values);r=m.recover(d,f.old,f.plan,f.desired,self.fixtures.g,self.fixtures.oom,self.fixtures.PROFILE);return d,r
 def test_retention_rename_applied_reply_lost_is_reconciled_then_stopped(self):
  d,r=self.scenario('after');self.assertTrue(r['confirmed']);self.assertFalse(d.container('newid')['State']['Running']);self.assertTrue(d.container(m.CURRENT_ID)['State']['Running']);self.assertEqual(len([x for x in d.calls if x==('newid','rename')]),1)
 def test_retention_rename_not_applied_never_stops_wakeup_named_candidate_or_starts_old(self):
  d,r=self.scenario('before');self.assertFalse(r['confirmed']);self.assertTrue(d.container('newid')['State']['Running']);self.assertFalse(d.container(m.CURRENT_ID)['State']['Running']);self.assertEqual(d.calls,[])
 def test_already_failed_name_owned_candidate_is_found_and_stopped(self):
  d,r=self.scenario(location='failed');self.assertTrue(r['confirmed']);self.assertEqual(r['recoveredCandidateIds'],['newid']);self.assertFalse(d.container('newid')['State']['Running']);self.assertTrue(d.container(m.CURRENT_ID)['State']['Running'])
 def test_foreign_failed_name_preserved_blocks_old_restore(self):
  d,r=self.scenario(foreign_failed=True);self.assertFalse(r['confirmed']);self.assertIn('foreign',r['preservedForeignIds']);self.assertTrue(d.container('newid')['State']['Running']);self.assertFalse(d.container(m.CURRENT_ID)['State']['Running']);self.assertNotIn('foreign',[x[0]for x in d.calls])
if __name__=='__main__':unittest.main()
