import importlib.util,pathlib,tempfile,unittest,types,os,json
from unittest.mock import patch
D=pathlib.Path(__file__).parent;s=importlib.util.spec_from_file_location('fixture',D/'retention.test.py');f=importlib.util.module_from_spec(s);s.loader.exec_module(f);m=f.m
class Adversarial(unittest.TestCase):
 def setUp(self):self.f=f.Cases();self.f.setUp();self.addCleanup(self.f.tearDown);self.proc=self.f.base/'proc';self.p=self.proc/'999999';(self.p/'fd').mkdir(parents=True);(self.p/'maps').write_text('')
 def scan(self):return m.references(self.f.rows,[],self.proc,query=lambda*a:[])
 def test_inode_alias_fd_is_rejected(self):
  (self.p/'fd/7').symlink_to(self.f.rows[0]['path'])
  with self.assertRaisesRegex(RuntimeError,'active_archive_fd'):self.scan()
 def test_missing_fd_directory_does_not_hide_archive_mapping(self):
  (self.p/'fd').rmdir();r=self.f.rows[0];major,minor=os.major(r['device']),os.minor(r['device']);(self.p/'maps').write_text(f"0-1 r--p 0 {major:02x}:{minor:02x} {r['inode']} /renamed-archive\n")
  with self.assertRaisesRegex(RuntimeError,'active_archive_map'):self.scan()
 def test_unknown_still_live_boundary_fails_closed(self):
  (self.p/'fd').rmdir()
  with self.assertRaisesRegex(RuntimeError,'live_process_reference_unknown'):self.scan()
 def test_postunlink_exception_records_actual_loss_and_restores_other_inode(self):
  real=os.unlink;done=False
  def uncertain(name,*a,**kw):
   nonlocal done
   real(name,*a,**kw)
   if not done:done=True;raise OSError('reviewer_after_actual_unlink')
  with patch.object(m.os,'unlink',side_effect=uncertain):
   with self.assertRaisesRegex(OSError,'reviewer_after_actual_unlink'):self.f.runflow()
  r=self.f.record();self.assertEqual(r['result'],'FAIL');self.assertEqual(r['actualUnlinkedFiles'],[self.f.rows[0]['path']]);self.assertEqual(r['removedOnly'],[]);self.assertTrue(pathlib.Path(self.f.rows[1]['path']).exists());self.assertTrue(any(x.get('requiresProtectedCopyRestore')for x in r['restoration']))
if __name__=='__main__':unittest.main(verbosity=2)
