import copy,hashlib,importlib.util,json,os,stat,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
D=Path(__file__).parent;s=importlib.util.spec_from_file_location('retention',D/'retain-older-inputs.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class Cases(unittest.TestCase):
 def setUp(self):
  self.t=tempfile.TemporaryDirectory(prefix='keel-archive-retention-');self.base=Path(self.t.name).resolve();self.root=self.base/'stage';self.root.mkdir(mode=0o700);self.rows=[]
  for i in range(2):
   d=self.base/str(i);d.mkdir();p=d/'input.tar.gz';p.write_bytes(b'protected exact archive '+bytes([i]));x=p.stat();self.rows.append({'path':str(p),'device':x.st_dev,'inode':x.st_ino,'uid':x.st_uid,'gid':x.st_gid,'mode':stat.S_IMODE(x.st_mode),'links':1,'bytes':x.st_size,'allocatedBytes':x.st_blocks*512,'mtimeNs':x.st_mtime_ns,'ctimeNs':x.st_ctime_ns,'sha256':m.sha(p)})
 def tearDown(self):self.t.cleanup()
 def runflow(self,scan=lambda *a:None):return m.relocate(self.root,self.rows,True,observe=lambda:m.EXPECTED_OLD.copy(),scan=scan)
 def record(self):return json.loads((self.root/'result.json').read_bytes())
 def test_exact_plan_metadata_and_scope_cannot_be_changed(self):
  p=json.loads((D/'archive-retention-plan.json').read_bytes());m.validate(p)
  for key,value in [('uid',0),('links',2),('inode',1),('ctimeNs',0),('sha256','0'*64)]:
   changed=copy.deepcopy(p);changed['files'][0][key]=value
   with self.assertRaises(RuntimeError):m.validate(changed)
 def test_changed_archive_fails_before_any_rename_or_unlink(self):
  Path(self.rows[0]['path']).write_bytes(b'different input')
  with self.assertRaisesRegex(RuntimeError,'metadata_changed'):self.runflow()
  self.assertTrue(all(Path(r['path']).exists()for r in self.rows));self.assertFalse((self.root/'before.json').exists());self.assertEqual(self.record()['actualUnlinkedFiles'],[])
 @unittest.skipUnless(os.uname().sysname=='Linux','realrenameat2 requiresLinux')
 def test_postrename_error_reconciles_and_restores_exact_owned_file(self):
  rename=m.rename;count=0
  def uncertain(*args):
   nonlocal count
   rename(*args);count+=1
   if count==1:raise OSError('lost_after_real_rename')
  with patch.object(m,'rename',side_effect=uncertain):
   with self.assertRaisesRegex(OSError,'lost_after'):self.runflow()
  r=self.record();self.assertEqual(r['actualUnlinkedFiles'],[]);self.assertTrue(all(Path(v['path']).exists()for v in self.rows));self.assertTrue(r['restoration'][0]['restored'])
 @unittest.skipUnless(os.uname().sysname=='Linux','realrenameat2 requiresLinux')
 def test_fresh_reference_after_both_moves_prevents_all_unlinks(self):
  calls=0
  def reference(*args):
   nonlocal calls
   calls+=1
   if calls==2:raise RuntimeError('active_archive_fd')
  with self.assertRaisesRegex(RuntimeError,'active_archive_fd'):self.runflow(reference)
  self.assertEqual(calls,2);r=self.record();self.assertEqual(r['actualUnlinkedFiles'],[]);self.assertTrue(all(x['restored']for x in r['restoration']));self.assertTrue(all(Path(v['path']).exists()for v in self.rows))
 @unittest.skipUnless(os.uname().sysname=='Linux','realrenameat2 requiresLinux')
 def test_foreign_source_created_after_move_is_never_overwritten(self):
  calls=0;path=Path(self.rows[0]['path'])
  def foreign(*args):
   nonlocal calls
   calls+=1
   if calls==2:path.write_bytes(b'foreign occupant');raise RuntimeError('preserve_foreign')
  with self.assertRaisesRegex(RuntimeError,'preserve_foreign'):self.runflow(foreign)
  r=self.record();self.assertEqual(path.read_bytes(),b'foreign occupant');self.assertEqual(m.sha(self.root/'archive-0.tar.gz'),self.rows[0]['sha256']);self.assertEqual(r['actualUnlinkedFiles'],[]);self.assertTrue(Path(self.rows[1]['path']).exists())
 @unittest.skipUnless(os.uname().sysname=='Linux','realrenameat2 requiresLinux')
 def test_second_unlink_failure_is_precise_and_restores_undeleted_file(self):
  unlink=os.unlink;count=0
  def fail(name,*a,**kw):
   nonlocal count
   count+=1
   if count==2:raise OSError('second_unlink_failed')
   return unlink(name,*a,**kw)
  with patch.object(m.os,'unlink',side_effect=fail):
   with self.assertRaisesRegex(OSError,'second_unlink'):self.runflow()
  r=self.record();self.assertEqual(r['result'],'FAIL');self.assertEqual(r['actualUnlinkedFiles'],[self.rows[0]['path']]);self.assertTrue(Path(self.rows[1]['path']).exists());self.assertTrue(any(x.get('requiresProtectedCopyRestore')for x in r['restoration']))
 @unittest.skipUnless(os.uname().sysname=='Linux','realrenameat2 requiresLinux')
 def test_success_removes_only_two_files_and_keeps_directories_and_receipts(self):
  r=self.runflow();self.assertEqual(r['result'],'PASS');self.assertEqual(len(r['actualUnlinkedFiles']),2);self.assertTrue(all(Path(v['path']).parent.is_dir()for v in self.rows));self.assertEqual(r['originalBefore'],r['originalAfter']);self.assertTrue((self.root/'before.json').exists());self.assertTrue((self.root/'move-intent-1.json').exists());self.assertEqual(self.record(),r)
  original=(self.root/'result.json').read_bytes()
  with self.assertRaisesRegex(RuntimeError,'prior_attempt'):self.runflow()
  self.assertEqual((self.root/'result.json').read_bytes(),original)
if __name__=='__main__':unittest.main()
