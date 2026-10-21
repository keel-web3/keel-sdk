import importlib.util,os,pathlib,tempfile,unittest
SOURCE=os.environ.get('KEEL_RETIRE_REVIEW_SOURCE','/private/tmp/keel-image-only-release-20261020/docs/reviews/studio-publication-20261020/release/history-prefix311/nine-public-retirement/cleanup-nine-public.py')
s=importlib.util.spec_from_file_location('actual',SOURCE);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class Docker:
 def __init__(self,mounts=()):self.mounts=mounts
 def request(self,method,path):
  assert(method,path)==('GET','/containers/json?all=0&size=0')
  return [{'Mounts':self.mounts}]
class References(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(prefix='keel-retire-reference-',dir='/private/tmp');self.root=pathlib.Path(self.tmp.name);self.f=self.root/'public';self.f.write_bytes(b'synthetic');s=self.f.stat();self.rows=[dict(path=str(self.f),device=s.st_dev,inode=s.st_ino)];self.proc=self.root/'proc';self.pid=self.proc/'999998';(self.pid/'fd').mkdir(parents=True);(self.pid/'maps').write_text('')
 def tearDown(self):self.tmp.cleanup()
 def run_refs(self,mounts=()):m.references(self.rows,Docker(mounts),self.proc)
 def test_no_references_passes(self):self.run_refs()
 def test_actual_fd_reference_rejected(self):
  (self.pid/'fd'/'5').symlink_to(self.f)
  with self.assertRaisesRegex(RuntimeError,'active_public_file_fd'):self.run_refs()
 def test_map_inode_reference_rejected(self):
  s=self.f.stat();(self.pid/'maps').write_text(f'0000-1000 r--p 0000 {os.major(s.st_dev):x}:{os.minor(s.st_dev):x} {s.st_ino} /synthetic\n')
  with self.assertRaisesRegex(RuntimeError,'active_public_file_map'):self.run_refs()
 def test_running_container_exact_bind_rejected(self):
  with self.assertRaisesRegex(RuntimeError,'running_container_public_file_bind'):self.run_refs([{'Source':str(self.f)}])
 def test_running_container_ancestor_bind_rejected(self):
  with self.assertRaisesRegex(RuntimeError,'running_container_public_file_bind'):self.run_refs([{'Source':str(self.root)}])
 def test_unrelated_bind_is_not_reference(self):self.run_refs([{'Source':'/unrelated/public'}])
 def test_still_live_missing_fd_directory_rejected(self):
  (self.pid/'fd').rmdir()
  with self.assertRaisesRegex(RuntimeError,'live_process_references_unknown'):self.run_refs()
if __name__=='__main__':unittest.main(verbosity=2)
