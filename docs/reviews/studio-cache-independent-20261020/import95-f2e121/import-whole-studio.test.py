import copy,importlib.util,json,unittest
from pathlib import Path
D=Path(__file__).parent;s=importlib.util.spec_from_file_location('whole_studio',D/'import-whole-studio.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class Cases(unittest.TestCase):
 def test_actual_frozen_plan_counts_full_raw_scratch_and_all_new_layers(self):
  p=json.loads((D/'whole-studio-plan.json').read_bytes());m.validate(p);self.assertEqual(m.capacity(p),2247132160);self.assertEqual(p['app']['archiveBytes'],692871680);self.assertEqual(p['newExpandedLayerTarBytes'],212083200);self.assertEqual(p['rollbackReserveBytes'],1073741824);self.assertEqual(p['metadataReserveBytes'],268435456)
 def test_only_qualified_cleanup_estimate_fits_no_directory_reclaim_assumed(self):
  p=json.loads((D/'whole-studio-plan.json').read_bytes());self.assertLessEqual(m.capacity(p),2324500480);self.assertEqual(2324500480-m.capacity(p),77368320);self.assertFalse(p['cleanupAllowed']);self.assertFalse(p['applicationActivation']);self.assertLess(1835884544,m.capacity(p));self.assertIsNone(p['releaseHold']);self.assertEqual(p['source']['siteCommit'],'4002803ccfcb20c39ffe5c555b68d8e197f379f8')
 def test_parent_mutation_missing_prefix_reserves_and_noncanonical_image_reject(self):
  original=json.loads((D/'whole-studio-plan.json').read_bytes())
  for edit in [lambda p:p['base']['rootFSLayers'].pop(),lambda p:p['app']['rootFSLayers'].__setitem__(0,'sha256:'+'0'*64),lambda p:p.update(rollbackReserveBytes=0),lambda p:p.update(metadataReserveBytes=0),lambda p:p['app'].update(index=p['base']['index']),lambda p:p['app'].update(archiveBytes=1),lambda p:p.update(cleanupAllowed=True)]:
   p=copy.deepcopy(original);edit(p)
   with self.assertRaises(RuntimeError):m.validate(p)
 def test_actual_image_row_is_accepted_by_unchanged_full_image_guard(self):
  spec=importlib.util.spec_from_file_location('host',D.parent/'production-proof-factory/host-qualify.py');h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h);p=json.loads((D/'whole-studio-plan.json').read_bytes());row=p['app'];actual={'Id':row['index'],'Os':'linux','Architecture':'amd64','RootFS':{'Layers':row['rootFSLayers']},'Config':row['imageConfig'],'Size':692810912}
  class Docker:
   def request(self,*args,**kwargs):return actual
  self.assertEqual(h.image(Docker(),row)['Id'],m.IMAGE)
  actual['Config']=copy.deepcopy(actual['Config']);actual['Config']['Env']=actual['Config']['Env']+['UNREVIEWED=1']
  with self.assertRaises(RuntimeError):h.image(Docker(),row)
if __name__=='__main__':unittest.main()
