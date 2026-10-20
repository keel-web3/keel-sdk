"""No-host inode reference adversary: cwd remains a capability after root rename."""
import pathlib,importlib.util,os,types,json,unittest
D=pathlib.Path('/private/tmp/keel-release-494d-20261020/docs/reviews/studio-publication-20261019/release/routing-import-494d')
s=importlib.util.spec_from_file_location('fixture',D/'cleanup-public-caches.test.py');f=importlib.util.module_from_spec(s);s.loader.exec_module(f)
class QuarantinedCwd(unittest.TestCase):
 def test_quarantined_cwd_directory_inode_is_still_an_active_reference(self):
  case=f.Files();case.setUp();self.addCleanup(case.tearDown);ids=f.m.snapshot(case.fd,case.data);moved=case.base/'quarantine';os.rename(case.source,moved)
  proc=case.base/'proc';pid=proc/'999';(pid/'fd').mkdir(parents=True);(pid/'cwd').symlink_to(moved/'one');(pid/'exe').symlink_to('/bin/sh');(pid/'maps').write_text('');(pid/'mountinfo').write_text('')
  rejected=False
  try:f.m.no_references([case.data],ids,types.SimpleNamespace(request=lambda *a:[]),proc)
  except RuntimeError:rejected=True
  info=(pid/'cwd').stat();print(json.dumps({'case':'cache-cwd-after-private-quarantine','cwdInodeIsQualifiedCacheDirectory':(info.st_dev,info.st_ino)in ids,'oldRootGone':not case.source.exists(),'rejected':rejected,'hostActions':False}),flush=True)
  self.assertTrue(rejected,'cwd inode remains an active cache capability after its pathname moves into quarantine')
if __name__=='__main__':unittest.main(verbosity=2)
