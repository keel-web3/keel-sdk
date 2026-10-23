"""Retained timeout invariant at the new pinned-helper/Popen boundary; no Docker."""
import hashlib,importlib.util,json,os,stat,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
FOLDER=Path('/Users/ravonus/dev/wt/studio-publication-20261019/release-proof-qualification/docs/reviews/studio-publication-20261019/release/final-candidate/activation-fe944')
spec=importlib.util.spec_from_file_location('actual_activation_popen_review',FOLDER/'activate-qualified-studio.py');a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)

class NewBoundarySameDurabilityInvariant(unittest.TestCase):
 def test_outer_timeout_durably_retains_partial_file_path_and_failure(self):
  with tempfile.TemporaryDirectory()as temporary:
   root=Path(temporary).resolve();(root/'snapshot-supervisor.cjs').write_bytes((FOLDER/'snapshot-supervisor.cjs').read_bytes());syncs=[];actual=os.fsync;writers=[];processes=[]
   class Process:
    def __init__(self,stderr):self.stderr=stderr;self.killed=False
    def poll(self):return -9 if self.killed else None
    def kill(self):self.killed=True
    def wait(self,timeout):return -9
   def popen(command,stdout,stderr):
    stdout.write(b'PGDMP-partial-review');read,write=os.pipe();writers.append(write);p=Process(os.fdopen(read,'rb'));processes.append(p);return p
   def fsync(fd):syncs.append('directory'if stat.S_ISDIR(os.fstat(fd).st_mode)else'file');actual(fd)
   try:
    with patch.object(a.subprocess,'Popen',popen),patch.object(a.time,'monotonic',side_effect=[0,200]),patch.object(a.os,'fsync',fsync):
     with self.assertRaisesRegex(RuntimeError,'^database_snapshot_failed_or_exceeded_budget$'):a.retain_database_snapshot(root,'a'*64,1024)
    data=(root/'retained-database-before.dump').read_bytes();record=json.loads((root/'database-snapshot-result.json').read_bytes())
    self.assertEqual(data,b'PGDMP-partial-review');self.assertIn('file',syncs);self.assertIn('directory',syncs);self.assertGreaterEqual(syncs.count('file'),3);self.assertEqual(record['result'],'FAIL');self.assertEqual(record['snapshotSHA256'],hashlib.sha256(data).hexdigest());self.assertTrue(processes[0].killed)
    print({'partialBytes':len(data),'syncs':syncs,'durableFailure':record['result'],'actualDockerCalls':0})
   finally:
    for fd in writers:os.close(fd)

if __name__=='__main__':unittest.main()
