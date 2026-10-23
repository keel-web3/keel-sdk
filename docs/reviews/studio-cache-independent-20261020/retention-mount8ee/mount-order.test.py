"""Exercise actual original-state guards; only the outer Mounts order is free."""
import copy,importlib.util,json,os,unittest
from pathlib import Path
BASE=Path(os.environ.get('KEEL_MOUNT_TEST_BASE',Path(__file__).parent))
def load(name,path):
 s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
class MountOrder(unittest.TestCase):
 def setUp(self):
  self.modules=[load('retention_original',BASE/'retain-older-inputs.py'),load('native_original',BASE/'resume95/native95-host-controls.py')]
  self.value={'Id':'owned','Image':'image','Config':{'Env':['KEEL_PUBLICATION_WORKER_PAUSED=1','A=2']},'HostConfig':{'ReadonlyRootfs':False,'Binds':['/data:/data']},'Mounts':[{'Type':'bind','Source':'/a','Destination':'/a','RW':True,'Future':{'bool':True,'list':[1,2]}},{'Type':'volume','Source':'/b','Destination':'/b','RW':False}],'State':{'Running':True,'Health':{'Status':'healthy'}}}
 def check(self,mutate=None,passes=False):
  for m in self.modules:
   v=copy.deepcopy(self.value);baseline={'id':v['Id'],'image':v['Image'],'config':m.digest(v['Config']),'host':m.digest(v['HostConfig']),'mounts':m.digest(sorted(v['Mounts'],key=lambda r:json.dumps(r,sort_keys=True,separators=(',',':')))),'running':True,'healthy':True}
   if hasattr(m,'EXPECTED_OLD'):
    m.EXPECTED_OLD={**baseline,'workerPaused':True};m.docker=lambda _:v;run=m.original
   else:
    m.EXPECTED={**baseline,'paused':True};m.inspect=lambda _:v;run=m.old
   if mutate:mutate(v)
   with self.subTest(module=m.__name__):
    if passes:self.assertEqual(run()['mounts'],baseline['mounts'])
    else:
     with self.assertRaises(RuntimeError):run()
 def test_outer_permutation_passes(self):self.check(lambda v:v['Mounts'].reverse(),True)
 def test_baseline_passes(self):self.check(passes=True)
 def test_source_change_fails(self):self.check(lambda v:v['Mounts'][0].update(Source='/foreign'))
 def test_destination_change_fails(self):self.check(lambda v:v['Mounts'][0].update(Destination='/foreign'))
 def test_rw_change_fails(self):self.check(lambda v:v['Mounts'][0].update(RW=False))
 def test_unknown_field_addition_fails(self):self.check(lambda v:v['Mounts'][0].update(Unreviewed='value'))
 def test_unknown_field_removal_fails(self):self.check(lambda v:v['Mounts'][0].pop('Future'))
 def test_nested_order_change_fails(self):self.check(lambda v:v['Mounts'][0]['Future']['list'].reverse())
 def test_json_type_change_fails(self):self.check(lambda v:v['Mounts'][0]['Future'].update(bool=1))
 def test_duplicate_mount_fails(self):self.check(lambda v:v['Mounts'].append(copy.deepcopy(v['Mounts'][0])))
 def test_removed_mount_fails(self):self.check(lambda v:v['Mounts'].pop())
 def test_env_order_change_fails(self):self.check(lambda v:v['Config']['Env'].reverse())
 def test_host_change_fails(self):self.check(lambda v:v['HostConfig'].update(ReadonlyRootfs=True))
 def test_unhealthy_fails(self):self.check(lambda v:v['State']['Health'].update(Status='unhealthy'))
 def test_unpaused_fails(self):self.check(lambda v:v['Config']['Env'].remove('KEEL_PUBLICATION_WORKER_PAUSED=1'))
if __name__=='__main__':unittest.main()
