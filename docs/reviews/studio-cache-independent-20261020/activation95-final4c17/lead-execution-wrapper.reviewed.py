from pathlib import Path
import json,hashlib,subprocess,time,sys
base=Path('/private/tmp/keel-activation95-final-20261020')
cp=base/'commands.final.proposed.json';assert hashlib.sha256(cp.read_bytes()).hexdigest()=='8c5fa03cacadc5aeb6852055670386bcf4dbd8ed95c70bbb6fbce8aaa2452e6a'
c=json.loads(cp.read_bytes());review=Path(sys.argv[1]);assert hashlib.sha256(review.read_bytes()).hexdigest()==sys.argv[2]
out=Path('/private/tmp/keel-activation95-final-actual-20261020');out.mkdir(mode=0o700)
health=Path('/private/tmp/keel-activation95-health-window-20261020');assert not(health/'failure.json').exists()and not(health/'stop').exists()
rows=[]
for i,row in enumerate(c['files'],1):
 raw=Path(row['localPath']).read_bytes();assert len(raw)==row['bytes']and hashlib.sha256(raw).hexdigest()==row['sha256'];rows.append((f'{i:02d}-'+row['basename'],row['exclusiveReceiverArgv'],raw,100))
rows.append(('06-readonly-preflight',c['readonlyPreflightArgv'],b'',120))
rows.append(('07-reviewed-cutover',c['executeArgv'],b'',600))
for name,argv,raw,timeout in rows:
 start=time.monotonic();p=subprocess.run(argv,input=raw,capture_output=True,timeout=timeout)
 (out/(name+'.stdout')).write_bytes(p.stdout);(out/(name+'.stderr')).write_bytes(p.stderr)
 print(json.dumps({'step':name,'exitCode':p.returncode,'seconds':round(time.monotonic()-start,3),'stdoutBytes':len(p.stdout),'stderrBytes':len(p.stderr)}),flush=True)
 if p.returncode:
  print(p.stderr.decode(errors='replace')[-2200:],flush=True);raise SystemExit('STOP_UNCERTAIN_ACTIVATION_'+name)
 if name=='06-readonly-preflight':
  result=json.loads(p.stdout);assert result['mode']=='read-only-preflight'and result['productionActivated']is False
 if name=='07-reviewed-cutover':
  result=json.loads(p.stdout);assert result['productionActivated']is True and result['phase']=='runtime-healthy-awaiting-independent-live-QA';print(p.stdout.decode(),flush=True)
