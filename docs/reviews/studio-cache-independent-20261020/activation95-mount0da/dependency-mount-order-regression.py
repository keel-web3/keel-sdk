import copy,hashlib,importlib.util,json,sys,unittest
sys.dont_write_bytecode=True
from pathlib import Path
HELPER=Path(sys.argv.pop(1))
s=importlib.util.spec_from_file_location('exact_dependency_helper',HELPER);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class FullMountMultiset(unittest.TestCase):
 def setUp(self):
  self.old={'Id':m.OLD_ID,'Image':m.OLD_IMAGE,'Config':{'syntheticConfig':True},'HostConfig':{'syntheticHost':True},'Mounts':[{'Type':'volume','Name':'keel-showcase-ovh','Source':'/var/lib/docker/volumes/keel-showcase-ovh/_data','Destination':'/data','Driver':'local','Mode':'rw','RW':True,'Propagation':''},{'Type':'volume','Name':'synthetic-original-anonymous','Source':'/var/lib/docker/volumes/synthetic-original-anonymous/_data','Destination':'/var/lib/postgresql/data','Driver':'local','Mode':'rw','RW':True,'Propagation':'','Nested':{'ordered':[1,2],'typed':True}}]}
  self.previous=m.CONFIG_SHA,m.HOST_SHA,m.MOUNTS_SHA
  m.CONFIG_SHA=m.digest(self.old['Config']);m.HOST_SHA=m.digest(self.old['HostConfig']);m.MOUNTS_SHA=m.digest(self.old['Mounts'])
 def tearDown(self):m.CONFIG_SHA,m.HOST_SHA,m.MOUNTS_SHA=self.previous
 def reject(self,change):
  x=copy.deepcopy(self.old);change(x)
  with self.assertRaises(RuntimeError):m.assert_old(x)
 def test_baseline(self):m.assert_old(self.old)
 def test_outer_permutation_preserves_all_full_elements(self):
  x=copy.deepcopy(self.old);x['Mounts'].reverse();before=copy.deepcopy(x);self.assertEqual(sorted(json.dumps(y,sort_keys=True)for y in x['Mounts']),sorted(json.dumps(y,sort_keys=True)for y in self.old['Mounts']));m.assert_old(x);self.assertEqual(x,before)
 def test_missing(self):self.reject(lambda x:x['Mounts'].pop())
 def test_duplicate(self):self.reject(lambda x:x['Mounts'].append(copy.deepcopy(x['Mounts'][0])))
 def test_unknown_field(self):self.reject(lambda x:x['Mounts'][0].update(Unreviewed='extra'))
 def test_rw(self):self.reject(lambda x:x['Mounts'][0].update(RW=False))
 def test_source(self):self.reject(lambda x:x['Mounts'][0].update(Source='/foreign'))
 def test_type(self):self.reject(lambda x:x['Mounts'][0].update(Type='bind'))
 def test_name(self):self.reject(lambda x:x['Mounts'][0].update(Name='foreign'))
 def test_mode(self):self.reject(lambda x:x['Mounts'][0].update(Mode='ro'))
 def test_destination(self):self.reject(lambda x:x['Mounts'][0].update(Destination='/foreign'))
 def test_driver(self):self.reject(lambda x:x['Mounts'][0].update(Driver='foreign'))
 def test_propagation(self):self.reject(lambda x:x['Mounts'][0].update(Propagation='shared'))
 def test_nested_array_order(self):self.reject(lambda x:x['Mounts'][1]['Nested']['ordered'].reverse())
 def test_scalar_type(self):self.reject(lambda x:x['Mounts'][0].update(RW=1))
 def test_original_config_unchanged(self):self.reject(lambda x:x['Config'].update(Unreviewed=True))
 def test_original_host_config_unchanged(self):self.reject(lambda x:x['HostConfig'].update(CapAdd=['SYS_ADMIN']))
if __name__=='__main__':unittest.main(verbosity=2)
