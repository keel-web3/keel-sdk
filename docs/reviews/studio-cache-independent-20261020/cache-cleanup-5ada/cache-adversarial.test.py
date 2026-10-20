"""Independent no-host adversaries for frozen5ada. Only test-owned temp files."""
import pathlib,importlib.util,os,json,types,unittest
from unittest.mock import patch
D=pathlib.Path('/private/tmp/keel-release-494d-20261020/docs/reviews/studio-publication-20261019/release/routing-import-494d')
s=importlib.util.spec_from_file_location('maintained_cache_fixture',D/'cleanup-public-caches.test.py');f=importlib.util.module_from_spec(s);s.loader.exec_module(f);m=f.m
class MissingCwdReference(unittest.TestCase):
 def test_unresolved_cwd_does_not_hide_live_cache_fd(self):
  case=f.Files();case.setUp();self.addCleanup(case.tearDown)
  proc=case.base/'proc';p=proc/'999';(p/'fd').mkdir(parents=True);(p/'cwd').symlink_to(case.base/'removed-cwd');(p/'exe').symlink_to('/bin/sh');(p/'fd/3').symlink_to(case.source/'one/a');(p/'maps').write_text('');(p/'mountinfo').write_text('');st=(case.source/'one/a').stat()
  rejected=False
  try:m.no_references([case.data],{(st.st_dev,st.st_ino)},types.SimpleNamespace(request=lambda *a:[]),proc)
  except RuntimeError:rejected=True
  print(json.dumps({'case':'deleted-cwd-with-retained-cache-fd','cacheFDExists':(p/'fd/3').exists(),'rejected':rejected,'hostOrRPC':False}),flush=True)
  self.assertTrue(rejected,'a missing cwd path must not skip remaining reference checks for a live PID')
class PostMoveError(unittest.TestCase):
 def test_rename_postmutation_error_is_reconciled_and_shell_restored(self):
  case=f.Lifecycle();case.setUp();self.addCleanup(case.tearDown)
  count=0
  def actual_move_then_error(srcfd,name,destfd,dest):
   nonlocal count
   os.rename(name,dest,src_dir_fd=srcfd,dst_dir_fd=destfd);count+=1
   if count==1:raise OSError('injected fsync/interrupt after successful rename')
  with patch.object(m,'rename_no_replace',side_effect=actual_move_then_error):
   with self.assertRaises(OSError):case.call()
  receipt=json.loads((case.stage/'cache-cleanup-receipt.json').read_bytes());states={pathlib.Path(c['path']).name:pathlib.Path(c['path']).is_dir()for c in case.items}
  print(json.dumps({'case':'post-rename-error-before-bookkeeping','sourceRootStates':states,'quarantineRootPresent':(case.stage/'quarantine-0').is_dir(),'restoration':receipt.get('restoration'),'removed':receipt['removed'],'hostOrRPC':False}),flush=True)
  self.assertTrue(all(states.values()),'a successful rename followed by fsync failure must still be reconciled/restored')
if __name__=='__main__':unittest.main(verbosity=2)
