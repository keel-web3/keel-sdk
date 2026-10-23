import pathlib,base64,json,hashlib,subprocess
root=pathlib.Path('/private/tmp/keel-independent-cache-4355-real-20261020');source=pathlib.Path('/private/tmp/keel-independent-cache-4355-20261020/routing-import-494d/cleanup-public-caches.py').read_bytes();assert hashlib.sha256(source).hexdigest()=='028905e213821a2d75327cc6748f2a7121d5b521dac93095213d187d59ad4af8'
bootstrap="""import pathlib,tempfile,subprocess,os,sys,types,json,hashlib,base64
source=base64.b64decode(PAYLOAD);assert hashlib.sha256(source).hexdigest()=='028905e213821a2d75327cc6748f2a7121d5b521dac93095213d187d59ad4af8';module={'__name__':'independent_public_cache_source'};exec(compile(source,'frozen-cleanup-source.py','exec'),module)
assert sys.platform=='linux'and os.geteuid()==0
with tempfile.TemporaryDirectory(prefix='keel-cache-real-cwd-')as temp:
 base=pathlib.Path(temp);os.chmod(base,0o755);cache=base/'cache';(cache/'one').mkdir(parents=True);(cache/'one/a').write_bytes(b'x')
 for p in [cache,cache/'one',cache/'one/a']:os.chown(p,1000,1000)
 stage=base/'private-stage';stage.mkdir(mode=0o700);fd=os.open(cache,os.O_RDONLY|os.O_DIRECTORY)
 ids={(os.fstat(fd).st_dev,os.fstat(fd).st_ino)}|{(x.st_dev,x.st_ino)for x in module['walk'](fd).values()};os.close(fd)
 code="import sys,pathlib,os,json;print('READY',flush=True);sys.stdin.readline();print(json.dumps({'uid':os.getuid(),'relativeReadBytes':len(pathlib.Path('a').read_bytes())}),flush=True);sys.stdin.readline()"
 child=subprocess.Popen(['/usr/bin/python3','-c',code],cwd=cache/'one',user=1000,group=1000,env={'PATH':'/usr/bin:/bin'},stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 try:
  assert child.stdout.readline().strip()=='READY';os.rename(cache,stage/'quarantine');proc=base/'selected-proc';proc.mkdir();(proc/str(child.pid)).symlink_to('/proc/'+str(child.pid),target_is_directory=True)
  info=pathlib.Path('/proc/'+str(child.pid)+'/cwd').stat();rejected=False;reason=None
  try:module['no_references']([{'path':str(cache)}],ids,types.SimpleNamespace(request=lambda *a:[]),proc)
  except BaseException as error:rejected=True;reason=type(error).__name__+': '+str(error)
  child.stdin.write('check\\n');child.stdin.flush();access=json.loads(child.stdout.readline())
  result={'schema':'keel.independent-cache-real-linux-cwd-control@1','operatorSHA256':hashlib.sha256(source).hexdigest(),'platform':sys.platform,'childUID':access['uid'],'childAlive':child.poll()is None,'cwdInodeInQualifiedCacheSet':(info.st_dev,info.st_ino)in ids,'quarantineOwner':stage.stat().st_uid,'quarantineMode':oct(stage.stat().st_mode&511),'privateQuarantineRelativeReadBytes':access['relativeReadBytes'],'referenceRejected':rejected,'reason':reason,'onlyTestOwnedFilesystem':True,'productionActions':False};print(json.dumps(result),flush=True)
 finally:
  child.terminate()
  try:child.wait(timeout=3)
  except subprocess.TimeoutExpired:child.kill();child.wait(timeout=3)
  child.stdin.close();child.stdout.close();child.stderr.close()
assert rejected,'live non-root cwd reference remains accepted after private quarantine'
""".replace('PAYLOAD',repr(base64.b64encode(source).decode()))
(root/'real-cwd-linux-bootstrap.py').write_text(bootstrap);r=subprocess.run(['/usr/bin/ssh','-o','BatchMode=yes','-o','ConnectTimeout=8','windows','wsl -d Fray-Prover -- /usr/bin/python3 -'],input=bootstrap,text=True,capture_output=True,timeout=60);(root/'real-cwd-linux.stdout').write_text(r.stdout);(root/'real-cwd-linux.stderr').write_text(r.stderr);(root/'real-cwd-linux-process.json').write_text(json.dumps({'exitCode':r.returncode,'publicBootstrapSHA256':hashlib.sha256(bootstrap.encode()).hexdigest(),'productionActions':False},indent=2)+'\n');print(json.dumps({'exitCode':r.returncode,'stdoutBytes':len(r.stdout),'stderrBytes':len(r.stderr)}));raise SystemExit(r.returncode)
