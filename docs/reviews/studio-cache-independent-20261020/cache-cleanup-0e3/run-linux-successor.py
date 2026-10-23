import pathlib,tarfile,io,gzip,base64,json,hashlib,subprocess,ast
repo=pathlib.Path('/private/tmp/keel-release-494d-20261020');base=repo/'docs/reviews/studio-publication-20261019/release';cache=base/'routing-import-494d';out=pathlib.Path('/private/tmp/keel-independent-cache-cleanup-20261020');repro=(out/'cache-adversarial.test.py').read_bytes();assert hashlib.sha256(repro).hexdigest()=='9ba4710f1cf653bdd907b96c3ec311d0c921b7242f84a4e78798ce1e00f79f2a'
files=[('routing-import-494d/'+n,cache/n)for n in ['cleanup-public-caches.py','cleanup-public-caches.test.py','cache-cleanup-plan.json','import-whole-studio.py','import-whole-studio.test.py','whole-studio-plan-HELD.json']]+[('production-proof-factory/host-qualify.py',base/'production-proof-factory/host-qualify.py')]
stream=io.BytesIO()
with tarfile.open(fileobj=stream,mode='w')as t:
 for name,p in files:
  b=p.read_bytes();x=tarfile.TarInfo(name);x.size=len(b);x.mode=0o600;t.addfile(x,io.BytesIO(b))
 x=tarfile.TarInfo('original-reviewer-adversarial.py');x.size=len(repro);x.mode=0o600;t.addfile(x,io.BytesIO(repro))
payload=gzip.compress(stream.getvalue(),mtime=0)
bootstrap="""import pathlib,tempfile,tarfile,io,gzip,base64,json,hashlib,subprocess,sys,ast
raw=base64.b64decode(PAYLOAD)
with tempfile.TemporaryDirectory(prefix='keel-independent-cache-0e3-')as temp:
 root=pathlib.Path(temp)
 with tarfile.open(fileobj=io.BytesIO(gzip.decompress(raw)),mode='r:')as t:
  for x in t.getmembers():
   assert x.isfile() and not pathlib.Path(x.name).is_absolute() and '..'not in pathlib.Path(x.name).parts
   p=root/x.name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(t.extractfile(x).read())
 original=(root/'original-reviewer-adversarial.py').read_text();old="D=pathlib.Path('/private/tmp/keel-release-494d-20261020/docs/reviews/studio-publication-20261019/release/routing-import-494d')";new='D=pathlib.Path('+repr(str(root/'routing-import-494d'))+')'
 assert original.count(old)==1;bound=original.replace(old,new);assert bound.replace(new,old)==original;(root/'reviewer-adversarial-bound.py').write_text(bound)
 results=[]
 for file in [root/'routing-import-494d/cleanup-public-caches.test.py',root/'routing-import-494d/import-whole-studio.test.py',root/'reviewer-adversarial-bound.py']:
  r=subprocess.run(['/usr/bin/python3',str(file)],capture_output=True,text=True,timeout=90);results.append({'file':file.name,'exitCode':r.returncode,'stdout':r.stdout,'stderr':r.stderr})
 record={'schema':'keel.independent-cache-successor-linux-controls@1','platform':sys.platform,'python':sys.version,'operatorSHA256':hashlib.sha256((root/'routing-import-494d/cleanup-public-caches.py').read_bytes()).hexdigest(),'maintainedTestSHA256':hashlib.sha256((root/'routing-import-494d/cleanup-public-caches.test.py').read_bytes()).hexdigest(),'originalReviewerSHA256':hashlib.sha256(original.encode()).hexdigest(),'reviewerImportRootLiteralOnlyRebound':True,'allReviewerAssertionBytesIdentical':True,'tests':results,'temporaryRootRemovedOnExit':True,'productionActions':False};print(json.dumps(record));code=next((x['exitCode']for x in results if x['exitCode']),0)
sys.exit(code)
""".replace('PAYLOAD',repr(base64.b64encode(payload).decode()))
(out/'successor-linux-bootstrap.py').write_text(bootstrap);r=subprocess.run(['/usr/bin/ssh','-o','BatchMode=yes','-o','ConnectTimeout=8','windows','wsl -d Fray-Prover -- /usr/bin/python3 -'],input=bootstrap,text=True,capture_output=True,timeout=120);(out/'successor-linux.stdout').write_text(r.stdout);(out/'successor-linux.stderr').write_text(r.stderr);(out/'successor-linux-process.json').write_text(json.dumps({'exitCode':r.returncode,'argv':['/usr/bin/ssh','-o','BatchMode=yes','-o','ConnectTimeout=8','windows','wsl -d Fray-Prover -- /usr/bin/python3 -'],'payloadSHA256':hashlib.sha256(payload).hexdigest(),'scope':'public-source tests in exclusive temporary root; no production host'},indent=2)+'\n');print(json.dumps({'exitCode':r.returncode,'stdoutBytes':len(r.stdout),'stderrBytes':len(r.stderr)}));raise SystemExit(r.returncode)
