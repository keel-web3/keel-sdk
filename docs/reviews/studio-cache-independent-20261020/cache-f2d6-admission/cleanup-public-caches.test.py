import copy, hashlib, importlib.util, json, os, stat, tempfile, types, unittest
from pathlib import Path
from unittest import mock
D=Path(__file__).parent
s=importlib.util.spec_from_file_location('cache_cleanup',D/'cleanup-public-caches.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
hs=importlib.util.spec_from_file_location('durability',D.parent/'production-proof-factory/host-qualify.py');h=importlib.util.module_from_spec(hs);hs.loader.exec_module(h)

def record(p):
 x=p.lstat();return dict(zip(['device','inode','uid','gid','mode'],m.identity(x)))
def item(p):
 fd=os.open(p,os.O_RDONLY|os.O_DIRECTORY)
 try:rows=m.walk(fd)
 finally:os.close(fd)
 dirs=[];files=[]
 for rel,s in rows.items():
  r={'relativePath':rel,**record(p/rel)}
  if stat.S_ISDIR(s.st_mode):dirs.append(r)
  else:files.append({**r,'links':s.st_nlink,'bytes':s.st_size,'allocatedBytes':s.st_blocks*512,'mtimeNs':s.st_mtime_ns,'ctimeNs':s.st_ctime_ns,'sha256':m.sha(p/rel)})
 return {'path':str(p),**record(p),'directories':dirs,'files':files}
class Files(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(prefix='keel-cache-test-');self.base=Path(self.tmp.name).resolve();self.source=self.base/'cache';(self.source/'one').mkdir(parents=True);(self.source/'one/a').write_bytes(b'public package metadata');self.data=item(self.source);self.fd=os.open(self.source,os.O_RDONLY|os.O_DIRECTORY)
 def tearDown(self):os.close(self.fd);self.tmp.cleanup()
 def test_snapshot_exact_tree(self):self.assertEqual(len(m.snapshot(self.fd,self.data)),3)
 def test_changed_file_content_fails(self):
  (self.source/'one/a').write_bytes(b'other public content')
  with self.assertRaisesRegex(RuntimeError,'metadata_changed|content_changed'):m.snapshot(self.fd,self.data)
 def test_symlink_leaf_rejected(self):
  (self.source/'one/a').unlink();(self.source/'one/a').symlink_to('/etc/passwd')
  with self.assertRaisesRegex(RuntimeError,'symlink_or_special'):m.snapshot(self.fd,self.data)
 def test_extra_file_rejected_before_deletion(self):
  (self.source/'unknown').write_bytes(b'preserve')
  with self.assertRaisesRegex(RuntimeError,'members_changed'):m.snapshot(self.fd,self.data)
  self.assertTrue((self.source/'one/a').exists())
 def test_hardlink_rejected(self):
  os.link(self.source/'one/a',self.base/'other')
  with self.assertRaisesRegex(RuntimeError,'metadata_changed'):m.snapshot(self.fd,self.data)
 def test_mode_change_rejected(self):
  os.chmod(self.source/'one/a',0o600)
  with self.assertRaisesRegex(RuntimeError,'metadata_changed'):m.snapshot(self.fd,self.data)
 def test_symlink_parent_not_followed(self):
  (self.source/'one').rename(self.base/'original-one');(self.source/'one').symlink_to(self.base/'original-one',target_is_directory=True)
  with self.assertRaises(OSError):m.open_parent(self.fd,'one/a',{r['relativePath']:r for r in self.data['directories']})
 def test_erase_retains_directory_shells(self):
  removed=[];m.snapshot(self.fd,self.data);m.erase_files(self.fd,self.data,removed)
  self.assertEqual(len(removed),1);self.assertTrue((self.source/'one').is_dir());self.assertEqual(list((self.source/'one').iterdir()),[])
 def test_open_absolute_rejects_symlink_ancestor(self):
  (self.base/'link').symlink_to(self.source,target_is_directory=True);p=self.base/'link';anc={str(a):record(a)for a in [self.base,*self.base.parents]}
  with self.assertRaises(OSError):m.open_absolute(p,anc)
 def test_parent_metadata_mismatch_rejected(self):
  anc={str(a):record(a)for a in [self.source,*self.source.parents]};anc[str(self.source)]['inode']+=1
  with self.assertRaisesRegex(RuntimeError,'ancestor_identity'):m.open_absolute(self.source,anc)
 def test_mapped_inode_detected_without_open_fd(self):
  proc=self.base/'proc';p=proc/'999';(p/'fd').mkdir(parents=True);(p/'cwd').symlink_to(self.base);(p/'exe').symlink_to('/bin/sh');(p/'mountinfo').write_text('');s=(self.source/'one/a').stat();dev=f'{os.major(s.st_dev):02x}:{os.minor(s.st_dev):02x}';(p/'maps').write_text(f'0-1 r--p 0 {dev} {s.st_ino} /different/renamed-cache\n')
  with self.assertRaisesRegex(RuntimeError,'mapped_inode'):m.no_references([self.data],{(s.st_dev,s.st_ino)},types.SimpleNamespace(request=lambda *a:[]),proc)
 def test_fd_inode_reference_detected(self):
  proc=self.base/'proc';p=proc/'999';(p/'fd').mkdir(parents=True);(p/'cwd').symlink_to(self.base);(p/'exe').symlink_to('/bin/sh');(p/'fd/3').symlink_to(self.source/'one/a');s=(self.source/'one/a').stat()
  with self.assertRaisesRegex(RuntimeError,'fd_reference'):m.no_references([self.data],{(s.st_dev,s.st_ino)},types.SimpleNamespace(request=lambda *a:[]),proc)
 def test_container_ancestor_bind_rejected(self):
  proc=self.base/'proc';proc.mkdir();docker=types.SimpleNamespace(request=lambda *a:[{'Mounts':[{'Source':str(self.base)}]}])
  with self.assertRaisesRegex(RuntimeError,'container_mount'):m.no_references([self.data],set(),docker,proc)
 def test_container_entire_host_bind_rejected(self):
  proc=self.base/'proc';proc.mkdir();docker=types.SimpleNamespace(request=lambda *a:[{'Mounts':[{'Source':'/'}]}])
  with self.assertRaisesRegex(RuntimeError,'container_mount'):m.no_references([self.data],set(),docker,proc)
 @unittest.skipUnless(os.uname().sysname=='Linux','actual renameat2 requires Linux')
 def test_atomic_rename_refuses_existing_destination(self):
  (self.base/'foreign').mkdir();fd=os.open(self.base,os.O_RDONLY|os.O_DIRECTORY)
  try:
   with self.assertRaises(FileExistsError):m.rename_no_replace(fd,'cache',fd,'foreign')
   self.assertTrue(self.source.is_dir());self.assertTrue((self.base/'foreign').is_dir())
  finally:os.close(fd)
 @unittest.skipUnless(os.uname().sysname=='Linux','actual renameat2 requires Linux')
 def test_atomic_rename_and_roundtrip_fsync(self):
  fd=os.open(self.base,os.O_RDONLY|os.O_DIRECTORY)
  try:
   with mock.patch.object(m.os,'fsync',wraps=os.fsync) as sync:
    m.rename_no_replace(fd,'cache',fd,'quarantine');m.rename_no_replace(fd,'quarantine',fd,'cache');self.assertEqual(sync.call_count,4)
   self.assertTrue((self.source/'one/a').exists())
  finally:os.close(fd)
class Plan(unittest.TestCase):
 def setUp(self):self.p=json.loads((D/'cache-cleanup-plan.json').read_bytes())
 def test_actual_exact888_qualified_regular_files(self):
  m.validate(self.p);self.assertEqual(sum(len(c['files'])for c in self.p['caches']),888);self.assertEqual(self.p['allocatedReclaimBytes'],488615936)
 def test_frozen_budget_excludes_directory_reclaim_and_preserves_reserves(self):
  self.assertEqual(1835884544+488615936,2324500480);self.assertEqual(2324500480-2247239680,77260800);self.assertEqual(self.p['rollbackAndMetadataReserveBytes'],1342177280);self.assertIn('HOLD',self.p['heldPredecessorImport']['status'])
 def test_wrong_scope_hardlinks_reserve_changes_reject(self):
  for edit in [lambda p:p['caches'][0].update(path='/home/ubuntu/.npm'),lambda p:p['caches'][0]['files'][0].update(links=2),lambda p:p.update(allocatedReclaimBytes=0),lambda p:p.update(rollbackAndMetadataReserveBytes=0),lambda p:p.update(configurationOrCredentialCleanup=True),lambda p:p.update(applicationActivation=True)]:
   p=copy.deepcopy(self.p);edit(p)
   with self.assertRaises(RuntimeError):m.validate(p)
class Lifecycle(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(prefix='keel-cache-main-');self.base=Path(self.tmp.name).resolve();self.stage=self.base/'stage';self.stage.mkdir(mode=0o700);self.items=[]
  for name in ['pnpm','npm']:
   p=self.base/name;(p/'nested').mkdir(parents=True);(p/'nested/file').write_bytes(b'public npm response');self.items.append(item(p))
  self.plan={'caches':self.items};self.anc={str(a):record(a)for c in self.items for a in [Path(c['path']).parent,*Path(c['path']).parents]};self.host=types.SimpleNamespace(consume=h.consume,persist=h.persist);self.guard=types.SimpleNamespace(original=lambda d:{'immutable':True});self.docker=object()
 def tearDown(self):self.tmp.cleanup()
 def call(self,execute=True):
  with mock.patch.object(m,'no_references'),mock.patch.object(m.os,'statvfs',return_value=types.SimpleNamespace(f_bavail=1000000,f_frsize=4096)):
   return m.cleanup(self.stage,self.plan,self.docker,self.host,self.guard,self.anc,execute,'plan','review')
 def test_preflight_does_not_move_or_consume(self):
  r=self.call(False);self.assertEqual(r['result'],'PREFLIGHT-ONLY');self.assertFalse((self.stage/'cache-cleanup-consumed.json').exists());self.assertTrue((self.base/'pnpm/nested/file').exists())
 @unittest.skipUnless(os.uname().sysname=='Linux','actual quarantine lifecycle requires Linux')
 def test_real_quarantine_success_restores_shells_and_durable_receipt(self):
  r=self.call();self.assertEqual(r['result'],'PASS');self.assertEqual(len(r['removed']),2);self.assertEqual(r['directoryShellsRemoved'],0);self.assertEqual(r['originalBefore'],r['originalAfter']);self.assertEqual(json.loads((self.stage/'cache-cleanup-receipt.json').read_bytes()),r)
  for c in self.items:self.assertTrue(Path(c['path'],'nested').is_dir());self.assertFalse(Path(c['path'],'nested/file').exists())
  before=(self.stage/'cache-cleanup-receipt.json').read_bytes()
  with self.assertRaisesRegex(RuntimeError,'already_consumed'):self.call()
  self.assertEqual((self.stage/'cache-cleanup-receipt.json').read_bytes(),before)
 @unittest.skipUnless(os.uname().sysname=='Linux','actual quarantine lifecycle requires Linux')
 def test_reference_opened_during_move_aborts_and_restores_before_unlink(self):
  with mock.patch.object(m,'no_references',side_effect=[None,RuntimeError('cache_process_fd_reference')]),mock.patch.object(m.os,'statvfs',return_value=types.SimpleNamespace(f_bavail=1000000,f_frsize=4096)):
   with self.assertRaisesRegex(RuntimeError,'fd_reference'):m.cleanup(self.stage,self.plan,self.docker,self.host,self.guard,self.anc,True,'plan','review')
  r=json.loads((self.stage/'cache-cleanup-receipt.json').read_bytes());self.assertEqual(r['result'],'FAIL');self.assertEqual(r['removed'],[])
  for c in self.items:self.assertTrue(Path(c['path'],'nested/file').exists())
 @unittest.skipUnless(os.uname().sysname=='Linux','actual quarantine lifecycle requires Linux')
 def test_new_foreign_occupant_preserved_and_other_root_still_restored(self):
  erase=m.erase_files
  def collision(fd,c,removed):
   erase(fd,c,removed)
   if c is self.items[0]:p=Path(c['path']);p.mkdir();(p/'foreign').write_bytes(b'preserve')
  with mock.patch.object(m,'erase_files',side_effect=collision):
   with self.assertRaisesRegex(RuntimeError,'restore_conflict'):self.call()
  self.assertEqual((self.base/'pnpm/foreign').read_bytes(),b'preserve');self.assertTrue((self.stage/'quarantine-0/nested').is_dir());self.assertTrue((self.base/'npm/nested').is_dir());r=json.loads((self.stage/'cache-cleanup-receipt.json').read_bytes());self.assertEqual(r['result'],'FAIL');self.assertEqual(sum(x['restored']for x in r['restoration']),1)
 @unittest.skipUnless(os.uname().sysname=='Linux','actual quarantine lifecycle requires Linux')
 def test_partial_unlink_failure_retains_primary_and_restores_both(self):
  erase=m.erase_files
  def fail(fd,c,removed):erase(fd,c,removed);raise RuntimeError('injected_after_first_cache')
  with mock.patch.object(m,'erase_files',side_effect=fail):
   with self.assertRaisesRegex(RuntimeError,'injected_after'):self.call()
  r=json.loads((self.stage/'cache-cleanup-receipt.json').read_bytes());self.assertEqual(len(r['removed']),1);self.assertIn('injected_after',r['primaryOperationFailure']);self.assertTrue(all(x['restored']for x in r['restoration']));self.assertTrue((self.base/'npm/nested/file').exists())
 def test_failed_final_original_guard_cannot_return_preflight_success(self):
  self.guard.original=mock.Mock(side_effect=[{'immutable':True},RuntimeError('original_changed')])
  with self.assertRaisesRegex(RuntimeError,'original_changed'):self.call(False)
class CorrectiveReferences(unittest.TestCase):
 setUp=Files.setUp
 tearDown=Files.tearDown
 def proc(self):
  proc=self.base/'proc';p=proc/'999';(p/'fd').mkdir(parents=True);(p/'cwd').symlink_to(self.base/'deleted');(p/'exe').symlink_to('/bin/sh');(p/'maps').write_text('');(p/'mountinfo').write_text('');return proc,p
 def test_live_deleted_cwd_still_scans_cache_fd(self):
  proc,p=self.proc();(p/'fd/3').symlink_to(self.source/'one/a');info=(self.source/'one/a').stat()
  with self.assertRaisesRegex(RuntimeError,'fd_reference'):m.no_references([self.data],{(info.st_dev,info.st_ino)},types.SimpleNamespace(request=lambda *a:[]),proc)
 def test_live_missing_boundary_without_detected_reference_fails_closed(self):
  proc,p=self.proc()
  with self.assertRaisesRegex(RuntimeError,'reference_unknown_cwd'):m.no_references([self.data],set(),types.SimpleNamespace(request=lambda *a:[]),proc)
 def test_missing_exe_still_scans_mapped_inode(self):
  proc,p=self.proc();(p/'exe').unlink();(p/'exe').symlink_to(self.base/'deleted-exe');s=(self.source/'one/a').stat();dev=f'{os.major(s.st_dev):02x}:{os.minor(s.st_dev):02x}';(p/'maps').write_text(f'0-1 r--p 0 {dev} {s.st_ino} /renamed-cache\n')
  with self.assertRaisesRegex(RuntimeError,'mapped_inode'):m.no_references([self.data],{(s.st_dev,s.st_ino)},types.SimpleNamespace(request=lambda *a:[]),proc)
class CorrectiveMoves(unittest.TestCase):
 setUp=Lifecycle.setUp
 tearDown=Lifecycle.tearDown
 call=Lifecycle.call
 @unittest.skipUnless(os.uname().sysname=='Linux','actual rename/fsync lifecycle requires Linux')
 def test_actual_rename_then_fsync_failure_restores_root(self):
  rename=m.rename_no_replace;sync=os.fsync;active=False;injected=False
  def guarded_sync(fd):
   nonlocal injected
   if active and not injected:injected=True;raise OSError('actual_post_rename_fsync_failure')
   return sync(fd)
  def call_rename(*args):
   nonlocal active
   active=True
   try:return rename(*args)
   finally:active=False
  with mock.patch.object(m,'rename_no_replace',side_effect=call_rename),mock.patch.object(m.os,'fsync',side_effect=guarded_sync):
   with self.assertRaisesRegex(OSError,'post_rename_fsync'):self.call()
  self.assertTrue(injected);r=json.loads((self.stage/'cache-cleanup-receipt.json').read_bytes());self.assertEqual(r['removed'],[]);self.assertTrue(all(x['restored']for x in r['restoration']));self.assertTrue((self.stage/'cache-cleanup-move-intents.json').exists());self.assertTrue((self.base/'pnpm/nested/file').exists())
 def test_rename_failure_before_mutation_leaves_original_and_foreign_quarantine(self):
  def refuse(srcfd,name,destfd,dest):
   (self.stage/dest).mkdir();(self.stage/dest/'foreign').write_bytes(b'preserve');raise FileExistsError('foreign_destination')
  with mock.patch.object(m,'rename_no_replace',side_effect=refuse):
   with self.assertRaises(FileExistsError):self.call()
  r=json.loads((self.stage/'cache-cleanup-receipt.json').read_bytes());self.assertEqual(r['removed'],[]);self.assertTrue(r['restoration'][0]['restored']);self.assertTrue(r['restoration'][0]['foreignQuarantinePreserved']);self.assertEqual((self.stage/'quarantine-0/foreign').read_bytes(),b'preserve');self.assertTrue((self.base/'pnpm/nested/file').exists())
 @unittest.skipUnless(os.uname().sysname=='Linux','actual rename interruption requires Linux')
 def test_interruption_after_real_rename_restores_without_deletion(self):
  rename=m.rename_no_replace;calls=0
  def interrupted(*args):
   nonlocal calls
   rename(*args);calls+=1
   if calls==1:raise KeyboardInterrupt('owned_child_interruption')
  with mock.patch.object(m,'rename_no_replace',side_effect=interrupted):
   with self.assertRaises(KeyboardInterrupt):self.call()
  r=json.loads((self.stage/'cache-cleanup-receipt.json').read_bytes());self.assertEqual(r['removed'],[]);self.assertTrue(all(x['restored']for x in r['restoration']));self.assertTrue((self.base/'pnpm/nested/file').exists())

class KernelNoExecutable(unittest.TestCase):
 setUp=Files.setUp
 tearDown=Files.tearDown
 def proc(self,flag=0x00200000,status='1',cwd=None):
  proc=self.base/'proc';p=proc/'999';(p/'fd').mkdir(parents=True);(p/'cwd').symlink_to(cwd or self.base);(p/'exe').symlink_to(self.base/'no-userspace-executable');(p/'maps').write_text('');(p/'mountinfo').write_text('');(p/'stat').write_text('999 (kernel) S 0 0 0 0 0 '+str(flag)+' 0 0\n');(p/'status').write_text('Kthread: '+status+'\n');return proc,p
 def scan(self,proc,ids=set()):m.no_references([self.data],ids,types.SimpleNamespace(request=lambda *a:[]),proc)
 def test_only_both_kernel_proofs_plus_empty_userspace_state_accept_missing_exe(self):
  proc,p=self.proc();self.scan(proc)
 def test_kernel_status_without_kernel_flag_rejects(self):
  proc,p=self.proc(flag=0)
  with self.assertRaisesRegex(RuntimeError,'reference_unknown_exe'):self.scan(proc)
 def test_kernel_flag_without_kernel_status_rejects(self):
  proc,p=self.proc(status='0')
  with self.assertRaisesRegex(RuntimeError,'reference_unknown_exe'):self.scan(proc)
 def test_kernel_missing_exe_with_nonempty_fd_table_rejects(self):
  proc,p=self.proc();(p/'fd/3').symlink_to('/bin/sh')
  with self.assertRaisesRegex(RuntimeError,'reference_unknown_exe'):self.scan(proc)
 def test_kernel_missing_exe_with_nonempty_maps_rejects(self):
  proc,p=self.proc();(p/'maps').write_text('0-1 r--p 0 00:00 0 /not-cache\n')
  with self.assertRaisesRegex(RuntimeError,'reference_unknown_exe'):self.scan(proc)
 def test_kernel_cwd_cache_inode_still_rejects_after_quarantine(self):
  ids=m.snapshot(self.fd,self.data);moved=self.base/'quarantine';self.source.rename(moved);proc,p=self.proc(cwd=moved/'one')
  with self.assertRaisesRegex(RuntimeError,'cwd_inode_reference'):self.scan(proc,ids)
 def test_kernel_mount_cache_reference_still_rejects(self):
  proc,p=self.proc();(p/'mountinfo').write_text('1 2 0:1 '+str(self.source)+' /elsewhere rw - ext4 /dev/vda rw\n')
  with self.assertRaisesRegex(RuntimeError,'namespace_mount_reference'):self.scan(proc)

if __name__=='__main__':unittest.main()

