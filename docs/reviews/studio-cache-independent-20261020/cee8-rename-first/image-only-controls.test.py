"""Actual helper/control-flow tests at an explicit Docker state double."""
import copy, importlib.util, json
from pathlib import Path
import unittest
ROOT=Path(__file__).parent
def load(name,path):
    s=importlib.util.spec_from_file_location(name,ROOT/path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
m=load('image_only','activate-image-only.py');g=load('guard','guarded-deployment-checks.py');oom=load('oom','candidate-oom-default.py')
PROFILE=json.loads((ROOT/'daemon-profile.json').read_bytes())
class Docker:
    def __init__(self,values):self.values={x['Id']:copy.deepcopy(x) for x in values};self.calls=[]
    def maybe_container(self,name):
        return copy.deepcopy(next((v for v in self.values.values() if name in (v['Id'],v['Name'].lstrip('/'))),None))
    def container(self,name):
        v=self.maybe_container(name)
        if v is None:raise RuntimeError('absent')
        return v
    def request(self,method,path,*a):
        assert method=='GET';return {'Name':'socket','Driver':'local','Options':{'type':'tmpfs'}}
    def action(self,identity,action,query=''):
        self.calls.append((identity,action));v=self.values[identity]
        if action=='stop':v['State']['Running']=False
        elif action=='start':v['State']['Running']=True
        elif action=='rename':v['Name']='/'+query.split('=',1)[1]
        else:raise AssertionError('unexpected action')
def baseline(v):return {'id':v['Id'],'image':v['Image'],'configSHA256':m.digest(v['Config']),'hostConfigSHA256':m.digest(v['HostConfig']),'mountsSHA256':m.mount_digest(g,v['Mounts'])}
class Controls(unittest.TestCase):
    def setUp(self):
        self.old={'Id':m.CURRENT_ID,'Image':m.CURRENT_IMAGE,'Name':'/'+m.CURRENT,'Config':{'Image':m.CURRENT_IMAGE,'Env':['PRIVATE=not-exported','KEEL_PUBLICATION_WORKER_PAUSED=1','KEEL_PUBLICATION_SIMULATION_BACKEND=proof'],'Labels':{'old':'retained'}},'HostConfig':{'OomKillDisable':None,'ReadonlyRootfs':True,'Mounts':[{'Type':'volume','Source':'socket','Target':'/run/keel-proof','ReadOnly':True}]},'Mounts':[{'Type':'volume','Name':'socket','Destination':'/run/keel-proof','RW':False}],'State':{'Running':True,'Health':{'Status':'healthy'},'OOMKilled':False}}
        self.runner=copy.deepcopy(self.old);self.runner.update(Id=m.RUNNER,Image='sha256:native',Name='/runner')
        self.plan={'activationId':'new','candidate':{'appImageId':'sha256:new'},'candidateName':'keel-candidate-new','failedName':'keel-failed-new','rollbackName':'keel-rollback-new','expectedCurrent':baseline(self.old),'existingRunner':baseline(self.runner),'existingSocket':{'Name':'socket','Driver':'local','Options':{'type':'tmpfs'}}}
        self.desired=m.desired_request(self.old,self.plan)
        self.new={'Id':'newid','Name':'/keel-candidate-new','Image':'sha256:new','Config':copy.deepcopy({k:v for k,v in self.desired.items() if k!='HostConfig'}),'HostConfig':copy.deepcopy(self.desired['HostConfig']),'Mounts':copy.deepcopy(self.old['Mounts']),'State':{'Running':False}}
    def test_request_has_only_image_label_and_explicit_oom_default_delta(self):
        before=copy.deepcopy(self.old);c=copy.deepcopy(self.desired);c['Image']=self.old['Config']['Image'];c['Labels']=self.old['Config']['Labels'];h=c.pop('HostConfig');h['OomKillDisable']=None
        self.assertEqual(c,self.old['Config']);self.assertEqual(h,self.old['HostConfig']);self.assertEqual(before,self.old)
    def test_current_baseline_is_strict_no_oom_projection(self):
        for section,key,value in (('HostConfig','OomKillDisable',False),('Config','Env',['PRIVATE=changed'])):
            v=copy.deepcopy(self.old);v[section][key]=value
            with self.assertRaisesRegex(RuntimeError,'baseline_raw'):m.assert_baseline(v,self.plan['expectedCurrent'],g)
    def test_no_silent_old_sdk_environment_marker(self):
        old=copy.deepcopy(self.old);old['Config']['Env'].append('KEEL_SDK_COMMIT=b524bf5fc19939c7523aada2e53f79e3360970ea')
        with self.assertRaisesRegex(RuntimeError,'metadata_needs_explicit_review'):m.desired_request(old,self.plan)
    def test_post_start_null_candidate_guard_and_profile_are_qualified(self):
        self.new['HostConfig']['OomKillDisable']=None
        self.assertTrue(m.assert_candidate(self.new,self.old,self.plan,self.desired,g,oom,PROFILE)['projected'])
    def test_foreign_full_config_or_socket_is_rejected(self):
        for mutation in ('env','mount','privileged','label'):
            n=copy.deepcopy(self.new)
            if mutation=='env':n['Config']['Env'].append('OTHER=x')
            if mutation=='label':n['Config']['Labels']['unexpected']='x'
            if mutation=='mount':n['Mounts'][0]['RW']=True
            if mutation=='privileged':n['HostConfig']['Privileged']=True
            with self.subTest(mutation=mutation),self.assertRaises((RuntimeError,g.DeploymentGuardError)):m.assert_candidate(n,self.old,self.plan,self.desired,g,oom,PROFILE)
    def test_response_lost_after_create_resolves_planned_name_and_retains_stopped(self):
        d=Docker([self.old,self.runner,self.new]);r=m.recover(d,self.old,self.plan,self.desired,g,oom,PROFILE)
        self.assertTrue(r['confirmed']);self.assertEqual(r['recoveredCandidateIds'],['newid']);self.assertFalse(d.container('newid')['State']['Running']);self.assertNotIn(m.RUNNER,[x[0] for x in d.calls])
    def test_response_lost_after_cutover_restores_old_without_runner_action(self):
        old=copy.deepcopy(self.old);old['Name']='/'+self.plan['rollbackName'];old['State']['Running']=False
        n=copy.deepcopy(self.new);n['Name']='/'+m.CURRENT;n['State']['Running']=True;n['HostConfig']['OomKillDisable']=None
        d=Docker([old,self.runner,n]);r=m.recover(d,self.old,self.plan,self.desired,g,oom,PROFILE)
        self.assertTrue(r['confirmed']);self.assertTrue(d.container(m.CURRENT_ID)['State']['Running']);self.assertEqual(d.container(m.CURRENT_ID)['Name'],'/'+m.CURRENT);self.assertFalse(d.container('newid')['State']['Running']);self.assertNotIn(m.RUNNER,[x[0] for x in d.calls])
    def test_foreign_current_occupant_preserved_no_old_restart(self):
        old=copy.deepcopy(self.old);old['Name']='/'+self.plan['rollbackName'];old['State']['Running']=False
        n=copy.deepcopy(self.new);n['Name']='/'+m.CURRENT;n['Config']['Env'].append('FOREIGN=yes')
        d=Docker([old,self.runner,n]);r=m.recover(d,self.old,self.plan,self.desired,g,oom,PROFILE)
        self.assertFalse(r['confirmed']);self.assertEqual(r['preservedForeignIds'],['newid']);self.assertEqual(d.calls,[])
    def test_runner_changed_prevents_old_start_and_is_never_stopped(self):
        old=copy.deepcopy(self.old);old['Name']='/'+self.plan['rollbackName'];old['State']['Running']=False
        runner=copy.deepcopy(self.runner);runner['Config']['Env'].append('drift=yes')
        d=Docker([old,runner]);r=m.recover(d,self.old,self.plan,self.desired,g,oom,PROFILE)
        self.assertFalse(r['confirmed']);self.assertEqual(d.calls,[])
if __name__=='__main__':unittest.main()
