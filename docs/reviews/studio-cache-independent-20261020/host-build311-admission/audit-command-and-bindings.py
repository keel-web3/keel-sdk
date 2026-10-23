from pathlib import Path
import json,hashlib,shlex,ast,subprocess
root=Path('/private/tmp/keel-image-only-release-20261020/docs/reviews/studio-publication-20261020/release/image-only311');out=Path('/private/tmp/keel-independent-host-build311-20261020');sha=lambda b:hashlib.sha256(b).hexdigest()
commandsPath=root/'host-build-commands.proposed.json';planPath=root/'host-build-plan.proposed.json';source=root/'build-public-delta.py';commands=json.loads(commandsPath.read_bytes());plan=json.loads(planPath.read_bytes());remote=plan['remoteRoot'];assert remote=='/home/ubuntu/keel-studio-image-delta-f31d041e-d2d4-401d-8fc7-c3e996078cca'
assert sha(commandsPath.read_bytes())=='fcffaa222a17255d1aa9a23e6109beee5ae3596e20cc55642b6e30516c24c9f5';assert sha(planPath.read_bytes())=='5174c328fe646976dbf123400c86ba8de66fabc64e1d36375d7e5e9ba4382afc';assert sha(source.read_bytes())=='9097abbc36dc7c2be9f27c819a19bc2498b3ca37e8af97bedff52a562a3a1a9c'
assert plan['sourceReviewSHA256']=='067ecf6616ce476a44253064f6be829911544889b9a3ac459022a787b39c021d';assert commands['remoteRoot']==remote;assert len(commands['files'])==7
prefix=commands['rootCreateArgv'][:-1]
assert prefix==['/usr/bin/ssh','-o','BatchMode=yes','-o','ConnectTimeout=12','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile=/Users/ravonus/dev/hashers/ops/servers/known_hosts','ubuntu@40.160.39.155']
records=[]
for record in commands['files']:
 path=Path(record['localPath']);raw=path.read_bytes();assert len(raw)==record['bytes'] and sha(raw)==record['sha256'];assert record['stdinLocalPath']==str(path);assert record['exclusiveReceiverArgv'][:-1]==prefix
 invocation=shlex.split(record['exclusiveReceiverArgv'][-1]);assert invocation[:5]==['sudo','-n','/usr/bin/python3','-B','-c'] and len(invocation)==6
 code=invocation[-1];tree=ast.parse(code)
 assert remote in code and record['basename'] in code and record['sha256'] in code
 for phrase in ['os.O_EXCL','os.O_NOFOLLOW','0o444','os.fsync(f.fileno())','os.fsync(fd)','root.resolve()==root','s.st_uid==0','0o700'] :assert phrase in code
 assert 'read('+str(record['bytes']+1)+')' in code and 'len(b)=='+str(record['bytes']) in code
 assert not any(isinstance(node,ast.Call) and isinstance(node.func,ast.Attribute) and node.func.attr in ('unlink','remove','rmdir','replace','rename','system','Popen','run') for node in ast.walk(tree))
 records.append({'basename':record['basename'],'bytes':len(raw),'sha256':sha(raw)})
assert {r['basename'] for r in records}==set(plan['files'])|{'host-build-plan.json'}
for r in records:
 if r['basename']!='host-build-plan.json':assert plan['files'][r['basename']]==r['sha256']
for key in ['readOnlyPreflightArgv','executeArgvRequiringIndependentAdmission']:
 assert commands[key][:-1]==prefix
 argv=shlex.split(commands[key][-1]);expected=['sudo','-n','/usr/bin/python3','-B',remote+'/build-public-delta.py',remote+'/host-build-plan.json']
 if key.startswith('execute'):expected+=['--execute-approved-sha256',sha(planPath.read_bytes())]
 assert argv==expected
for key,value in {'snapshotReserveBytes':268435456,'rollbackReserveBytes':1073741824}.items():assert plan['budget'][key]==value
assert plan['productionActivationApproved'] is False and plan['automaticRetryAllowed'] is False
q=Path('/tmp/keel-qa-receipt-activation-20261020/keel-site/docs/reviews/studio-publication-20261020/qa-pair311-fb3');inventory=json.loads((q/'evidence-manifest.json').read_bytes())
for entry in inventory:
 raw=(q/entry['path']).read_bytes();assert len(raw)==entry['bytes'] and sha(raw)==entry['sha256'],entry['path']
report={'sourceCommit':'71442a84578daecc935bd6d970d00deda1293fa6','buildSourceSHA256':sha(source.read_bytes()),'planSHA256':sha(planPath.read_bytes()),'proposedCommandsSHA256':sha(commandsPath.read_bytes()),'exclusivePublicFiles':records,'hostAndNamespaceExact':True,'exclusiveReceiversBoundedHashedFsyncedOnly':True,'executeArgvExactPlanHash':True,'qaEvidenceInventoryVerified':len(inventory),'actualHostActions':0}
(out/'command-audit.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'publicFileCount':len(records),'qaInventoryVerified':len(inventory),'auditSHA256':sha((out/'command-audit.json').read_bytes())}))
