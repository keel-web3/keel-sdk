"""Additive namespace controls; maintained assertions are untouched."""
import importlib.util, os, tempfile, types, unittest
from pathlib import Path
from unittest import mock

HERE=Path(__file__).parent
spec=importlib.util.spec_from_file_location('namespace_cleanup',HERE/'cleanup-public-caches.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class Namespace(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='keel-cache-namespace-')
        self.base=Path(self.tmp.name).resolve();self.cache=self.base/'cache';self.cache.mkdir()
        self.proc=self.base/'proc';self.pid=self.proc/'999999';(self.pid/'fd').mkdir(parents=True)
        (self.pid/'cwd').symlink_to(self.base);(self.pid/'exe').symlink_to('/bin/sh')
        (self.pid/'maps').write_text('');self.root=self.pid/'root';self.root.mkdir()
        self.target=self.base.parent;(self.root/str(self.target).lstrip('/')).mkdir(parents=True)
        self.items=[{'path':str(self.cache)}];info=self.cache.stat();self.inodes={(info.st_dev,info.st_ino)}
        self.docker=types.SimpleNamespace(request=lambda *args:[])
        self.mount()
    def tearDown(self):self.tmp.cleanup()
    def mount(self,source='/systemd/inaccessible/dir',target=None,flags='ro,nosuid,nodev,noexec,relatime',fs='tmpfs'):
        target=str(self.target) if target is None else target
        (self.pid/'mountinfo').write_text(f'295 271 0:24 {source} {target} {flags} - {fs} tmpfs rw,size=793724k\n')
    def run_scan(self):m.no_references(self.items,self.inodes,self.docker,self.proc)
    def test_observed_inaccessible_namespace_with_both_paths_absent(self):
        self.items.append({'path':str(self.base/'npm-cache')});self.run_scan()
    def test_ordinary_tmpfs_ancestor_is_not_exempt(self):
        self.mount(source='/different-root')
        with self.assertRaisesRegex(RuntimeError,'namespace_mount_reference'):self.run_scan()
    def test_each_required_hardening_flag_is_required(self):
        for flag in ['ro','nosuid','nodev','noexec']:
            with self.subTest(flag=flag):
                self.mount(flags=','.join(x for x in ['ro','nosuid','nodev','noexec'] if x!=flag))
                with self.assertRaisesRegex(RuntimeError,'namespace_mount_reference'):self.run_scan()
    def test_other_filesystem_is_not_exempt(self):
        self.mount(fs='ext4')
        with self.assertRaisesRegex(RuntimeError,'namespace_mount_reference'):self.run_scan()
    def test_visible_foreign_namespace_cache_is_not_exempt(self):
        (self.root/str(self.cache).lstrip('/')).mkdir(parents=True)
        with self.assertRaisesRegex(RuntimeError,'namespace_mount_reference'):self.run_scan()
    def test_namespace_permission_denial_propagates(self):
        denied=self.root/str(self.cache).lstrip('/');original=Path.stat
        def checked(path,*args,**kwargs):
            if path==denied:raise PermissionError('test namespace access denial')
            return original(path,*args,**kwargs)
        with mock.patch.object(Path,'stat',checked):
            with self.assertRaises(PermissionError):self.run_scan()
    def test_renamed_bind_at_unrelated_target_retains_inode_reference(self):
        (self.root/'unrelated').symlink_to(self.cache,target_is_directory=True)
        self.mount(source=str(self.base/'quarantine'),target='/unrelated')
        with self.assertRaisesRegex(RuntimeError,'namespace_mount_inode_reference'):self.run_scan()
    def test_original_source_bind_is_rejected(self):
        (self.root/'unrelated').mkdir();self.mount(source=str(self.cache),target='/unrelated')
        with self.assertRaisesRegex(RuntimeError,'namespace_mount_reference'):self.run_scan()
    def test_escaped_mount_target_still_checks_actual_inode(self):
        (self.root/'a b').symlink_to(self.cache,target_is_directory=True)
        self.mount(source=str(self.base/'quarantine'),target=r'/a\040b')
        with self.assertRaisesRegex(RuntimeError,'namespace_mount_inode_reference'):self.run_scan()
    def test_missing_mount_target_is_unknown_and_blocks(self):
        self.mount(source=str(self.base/'quarantine'),target='/absent')
        with self.assertRaisesRegex(RuntimeError,'reference_unknown_mountinfo'):self.run_scan()
    def test_linux_nsfs_root_is_an_inode_label_and_target_is_checked(self):
        (self.root/'network-namespace').write_bytes(b'namespace descriptor fixture')
        self.mount(source='net:[4026532287]',target='/network-namespace',fs='nsfs')
        self.run_scan()
        (self.root/'network-namespace').unlink()
        (self.root/'network-namespace').symlink_to(self.cache,target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError,'namespace_mount_inode_reference'):self.run_scan()
    def test_kernel_readlink_deleted_executable_name_needs_no_existing_path(self):
        original=os.readlink
        def link(path,*args,**kwargs):
            if Path(path)==self.pid/'exe':return '/usr/lib/example-daemon (deleted)'
            return original(path,*args,**kwargs)
        with mock.patch.object(os,'readlink',link):self.run_scan()
    def test_deleted_cache_executable_name_still_rejected(self):
        original=os.readlink
        def link(path,*args,**kwargs):
            if Path(path)==self.pid/'exe':return str(self.cache/'program')+' (deleted)'
            return original(path,*args,**kwargs)
        with mock.patch.object(os,'readlink',link):
            with self.assertRaisesRegex(RuntimeError,'cache_process_path_reference'):self.run_scan()

if __name__=='__main__':unittest.main()
