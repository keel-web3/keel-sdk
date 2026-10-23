import pathlib,importlib.util,json,threading,os,inspect,sys,time
s=importlib.util.spec_from_file_location('helpers','/tmp/keel-release-a33-execution-20261020/run.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m);assert len(sys.argv)==4;m.ROOT=pathlib.Path(sys.argv[3]);m.ROOT.mkdir(mode=0o700,exist_ok=False);p=pathlib.Path(sys.argv[1]);assert m.digest(p)==sys.argv[2];c=json.loads(p.read_bytes());assert c['root']=='/home/ubuntu/keel-proof-qualification-9d94c44e-ad0f-45d1-b258-540e204f6ebd';m.SSH=c['executeArgv'][:10];m.write('admitted-commands.json',p.read_bytes());inspect.signature(m.report).bind('ACTUAL-GATOR-NATIVE-PASS',receiptSHA256='digest',productionActivated=False)
for row in c['files']:assert pathlib.Path(row['localPath']).stat().st_size==row['bytes']and m.digest(row['localPath'])==row['sha256']
assert pathlib.Path(c['stdinLocalPath']).stat().st_size==c['stdinBytes']and m.digest(c['stdinLocalPath'])==c['stdinSHA256']
source=m.PROXY/'proxy-runtime-read.py';assert m.digest(source)=='0745563e340e0b1b2892350379a5772dca68b50bc8a173e18c191ac81e53b5b3';pred=json.loads(m.run('00-fresh-proxy-predicate',m.SSH+['sudo -n /usr/bin/python3 -'],60,input_path=source));assert pred['result']=='PASS'and pred['configSha256']=='1780f5bbf66082e8caa5d878b678adf5218c35e8cd0cc1fbafad063f5a93155b';m.state('01-original-before-normal-health',running=False,free=1342177280);t=threading.Thread(target=m.health_loop);t.start()
def guard(name):m.check_health();return m.state(name,free=1342177280)
try:
 assert m.HEALTH_READY.wait(42);guard('02-original-before-late-inputs')
 for i,row in enumerate(c['files']):
  v=json.loads(m.run('03-install-late-%02d'%i,row['argv'],60,input_path=row['localPath']));assert v['sha256']==row['sha256']and v['installedExclusive']is True
 guard('04-original-before-preflight');m.run('05-readonly-preflight',c['readOnlyPreflightArgv'],60);guard('06-original-before-one-native')
 m.write('07-local-one-shot.json',json.dumps({'commandsSHA256':m.digest(p),'argv':c['executeArgv'],'stdinSHA256':c['stdinSHA256']}).encode());fd=os.open(m.ROOT,os.O_RDONLY|os.O_DIRECTORY);os.fsync(fd);os.close(fd)
 raw=m.run('08-one-gator-native-execute',c['executeArgv'],1020,input_path=c['stdinLocalPath']);d=m.durable('09-actual-durable-native-receipt',c['root'],'qualification-receipt.json',raw);m.report('ACTUAL-GATOR-NATIVE-PASS',receiptSHA256=d['sha256'],productionActivated=False)
except BaseException as error:
 m.report('GATOR-NATIVE-STOPPED',failure=type(error).__name__+': '+str(error));raise
finally:m.STOP.set();t.join(45)
