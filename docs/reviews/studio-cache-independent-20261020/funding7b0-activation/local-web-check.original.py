from pathlib import Path
import os,stat,json,hashlib
base=Path('/private/tmp/keel-funding-image-build-20261021-01/image-context')
web=base/'web'
mf=Path('/private/tmp/keel-image-only-release-20261020/docs/reviews/studio-publication-20261020/release/funding-correction311/qualified-context-transfer.json')
b=mf.read_bytes()
assert hashlib.sha256(b).hexdigest()=='c5fb631c57f11c695d0e85ef5c6af0cf6ec42ae3462bb98aabd8835064e7625e'
d=json.loads(b)
assert base.resolve()==base and web.resolve()==web and not web.is_symlink()
before=web.lstat();rows=[]
def walk(p):
 s=p.lstat();rel=p.relative_to(base).as_posix();mode=stat.S_IMODE(s.st_mode)
 if stat.S_ISLNK(s.st_mode):row=[rel,'link',mode,0,os.readlink(p)]
 elif stat.S_ISDIR(s.st_mode):row=[rel,'dir',mode,0,None]
 elif stat.S_ISREG(s.st_mode):
  h=hashlib.sha256();fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
  try:
   fs=os.fstat(fd);assert (fs.st_dev,fs.st_ino,fs.st_size)==(s.st_dev,s.st_ino,s.st_size)
   while True:
    chunk=os.read(fd,1048576)
    if not chunk:break
    h.update(chunk)
   end=os.fstat(fd);assert (end.st_size,end.st_mtime_ns,end.st_ctime_ns)==(fs.st_size,fs.st_mtime_ns,fs.st_ctime_ns)
  finally:os.close(fd)
  row=[rel,'file',mode,s.st_size,h.hexdigest()]
 else:raise RuntimeError('nonregular_public_subset')
 rows.append(row)
 if row[1]=='dir':
  for child in sorted(p.iterdir()):walk(child)
walk(web)
rows.sort(key=lambda x:x[0])
expected=[r for r in d['entries']if r[0]=='web'or r[0].startswith('web/')]
assert rows==expected,('complete_exact_subset_mismatch',len(rows),len(expected),next(((a,z)for a,z in zip(rows,expected)if a!=z),None))
after=web.lstat()
assert (before.st_dev,before.st_ino,before.st_mtime_ns,before.st_ctime_ns)==(after.st_dev,after.st_ino,after.st_mtime_ns,after.st_ctime_ns)
print(json.dumps({'result':'PASS_EXACT_PUBLIC_WEB_SUBSET','path':str(web),'entries':len(rows),'regularBytes':sum(r[3]for r in rows if r[1]=='file'),'subsetSHA256':hashlib.sha256(json.dumps(rows,separators=(',',':')).encode()).hexdigest(),'rootIdentity':{k:getattr(before,k)for k in ['st_dev','st_ino','st_uid','st_gid','st_mode','st_mtime_ns','st_ctime_ns']},'noSymlinkFollow':True,'deletionPerformed':False}))
