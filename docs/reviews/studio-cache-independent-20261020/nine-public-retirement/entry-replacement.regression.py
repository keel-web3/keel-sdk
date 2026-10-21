import contextlib,hashlib,importlib.util,io,json,os,pathlib,stat,tempfile,unittest
SOURCE=os.environ.get('KEEL_RETIRE_REVIEW_SOURCE','/private/tmp/keel-independent-nine-public-retention-20261021/cleanup-nine-public.initial-inspected.py')
spec=importlib.util.spec_from_file_location('actual_retirement',SOURCE);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class EntryReplacement(unittest.TestCase):
 def fixture(self,mode):
  with tempfile.TemporaryDirectory(prefix='keel-independent-retire-') as td:
   base=pathlib.Path(td);src=base/'source';src.mkdir(mode=0o700);root=base/'receipt';root.mkdir(mode=0o700);p=src/'public.bin';p.write_bytes(b'old exact public bytes');p.chmod(0o444);s=p.stat();row=dict(zip(('device','inode','links','bytes','allocatedBytes','uid','gid','mode','mtimeNs','ctimeNs'),m.signature(s)));row.update(path=str(p),sha256=hashlib.sha256(p.read_bytes()).hexdigest());calls=0;replaced=False;real_persist=m.persist
   def replace():
    nonlocal replaced
    f=src/'foreign.tmp';f.write_bytes(b'FOREIGN NEW OCCUPANT MUST SURVIVE');os.replace(f,p);replaced=True
   def scan(rows):
    nonlocal calls
    calls+=1
    if mode=='scan' and calls==2:replace()
   def persist(r,name,value):
    real_persist(r,name,value)
    if mode=='intent' and name=='unlink-intent-0.json':replace()
   m.persist=persist
   error=None
   try:
    with contextlib.redirect_stdout(io.StringIO()):
     try:r=m.retire(root,[row],True,lambda:{'healthy':True},scan)
     except BaseException as e:error=e;r=None
   finally:m.persist=real_persist
   if mode=='exact':
    self.assertIsNone(error);self.assertEqual(r['result'],'PASS');self.assertFalse(p.exists());self.assertEqual(r['removedCount'],1)
   else:
    self.assertTrue(replaced,'adversary must replace real path')
    self.assertTrue(p.exists(),'replacement foreign occupant was unlinked')
    self.assertEqual(p.read_bytes(),b'FOREIGN NEW OCCUPANT MUST SURVIVE')
    self.assertIsInstance(error,RuntimeError,'replacement must fail closed')
 def test_exact_public_file_can_retire(self):self.fixture('exact')
 def test_foreign_replacement_during_reference_scan_is_preserved(self):self.fixture('scan')
 def test_foreign_replacement_after_durable_intent_is_preserved(self):self.fixture('intent')
if __name__=='__main__':unittest.main(verbosity=2)
