import copy,importlib.util,json,sys,unittest
from pathlib import Path
sys.dont_write_bytecode=True
OP=Path(sys.argv.pop(1));GUARD=Path(sys.argv.pop(1))
def load(name,path):
 s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
a=load('exact_operator',OP);g=load('exact_guard',GUARD)
class ActualDefaultRegression(unittest.TestCase):
 def fixture(self,flag=None):
  old={'Config':{'Image':'sha256:old','Env':['KEEL_PUBLICATION_WORKER_PAUSED=1'],'Labels':{},'User':'999:999'},'HostConfig':{'OomKillDisable':flag,'Binds':['data:/data:rw'],'Mounts':[],'CapAdd':None},'Mounts':[{'Type':'volume','Name':'data','Source':'/data-volume','Destination':'/data','RW':True}]}
  plan={'activationId':'synthetic-review','socketVolume':'synthetic-socket','candidate':{'appImageId':'sha256:new','binarySha256':'0'*64},'dependencies':{'catalogPath':'/data/studio/exact.json'}}
  return old,plan
 def test_pinned_null_default_explicit_false_without_old_mutation(self):
  old,plan=self.fixture();before=copy.deepcopy(old);request=a.runtime_request(old,plan);self.assertIs(request['HostConfig']['OomKillDisable'],False);self.assertEqual(old,before)
 def test_daemon_false_default_passes_full_application_guard(self):
  old,plan=self.fixture();request=a.runtime_request(old,plan);value={'Image':plan['candidate']['appImageId'],'Config':{k:copy.deepcopy(v)for k,v in request.items()if k!='HostConfig'},'HostConfig':copy.deepcopy(request['HostConfig']),'Mounts':copy.deepcopy(old['Mounts'])+[{'Type':'volume','Name':plan['socketVolume'],'Destination':'/run/keel-proof','RW':False}]};value['HostConfig']['OomKillDisable']=False;a.assert_application(value,old,plan,request,g)
 def test_explicit_false_preserved(self):
  old,plan=self.fixture(False);request=a.runtime_request(old,plan);self.assertIs(request['HostConfig']['OomKillDisable'],False)
 def test_explicit_true_preserved_not_coerced(self):
  old,plan=self.fixture(True);request=a.runtime_request(old,plan);self.assertIs(request['HostConfig']['OomKillDisable'],True)
 def test_guard_still_rejects_true_and_integer_zero(self):
  old,plan=self.fixture(False);request=a.runtime_request(old,plan)
  for drift in [True,0,None]:
   with self.subTest(drift=drift):
    actual=copy.deepcopy(request);actual['HostConfig']['OomKillDisable']=drift
    with self.assertRaises(g.DeploymentGuardError):g.assert_configuration_preserved(request,actual)
 def test_unrelated_host_permissions_still_rejected(self):
  old,plan=self.fixture(False);request=a.runtime_request(old,plan);actual=copy.deepcopy(request);actual['HostConfig']['CapAdd']=['SYS_ADMIN']
  with self.assertRaises(g.DeploymentGuardError):g.assert_configuration_preserved(request,actual)
if __name__=='__main__':unittest.main(verbosity=2)
