import pathlib,json,hashlib,os,sys
root=pathlib.Path('/private/tmp/keel-independent-gif-guided-review-20261020');private=pathlib.Path('/tmp/keel-private-gif-guided-review-20261020-01');tool=pathlib.Path('/tmp/keel-qa-receipt-activation-20261020/keel-site/docs/tools/gif-guided-review-only');p=json.loads((private/'packet.json').read_bytes());b=json.loads(pathlib.Path(p['bundleReceipt']['path']).read_bytes())
def record(p):
 v=p.read_bytes();return {'path':str(p),'bytes':len(v),'sha256':hashlib.sha256(v).hexdigest()}
def save(p,v):
 data=(json.dumps(v,indent=2)+'\n').encode();fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(data);f.flush();os.fsync(f.fileno())
 d=os.open(p.parent,os.O_RDONLY|os.O_DIRECTORY)
 try:os.fsync(d)
 finally:os.close(d)
 return record(p)
for name in ['review.before.private.json','review.consumed.json','review.after.private.json','review.uncertain-after.private.json','review.receipt.json','launcher.stdout','launcher.stderr','launcher-result.json','run-config.json']:
 assert not (private/name).exists(),name
r={'schema':'keel-reviewed-gif-guided-review-only@1','approved':True,'packetSHA256':record(private/'packet.json')['sha256'],'bundleReceiptSHA256':p['bundleReceipt']['sha256'],**{k:b[k]for k in ['bundleSHA256','sourceInputsSHA256','toolFilesSHA256','sdkBuiltTreeSHA256']},'commandSHA256':p['command']['sha256'],'beforeSnapshotSHA256':p['beforeSnapshot']['sha256'],'allowOneGuidedReview':True,'beforeReleaseRevision':13,'afterReleaseRevision':14,'allowRPC':False,'allowCompiler':False,'allowSimulation':False,'allowSigning':False,'allowSubmission':False}
review=save(root/'guided-review-admission.json',r);config=save(private/'run-config.json',{'packet':record(private/'packet.json'),'review':review})
command={'schema':'keel.independent-one-normal-guided-review-command@1','approved':True,'cwd':p['site']['root'],'argv':[sys.executable,str(tool/'launch-review.py'),str(private/'run-config.json')],'executions':1,'automaticRetry':False,'afterAnyUncertainOutcome':'Preserve consumed marker and files; readonly reconciliation only. No restoration, deletion, rename or rerun.','scope':{'creatorId':'ac001c30-ad5e-465a-b784-854be440f0be','releaseId':'0c6c734d-20c0-4d3a-959a-fb7ac8143af2','projectId':'fcf16528-aa7e-43c0-a7f0-8a4542ed96e6','projectRevision':1,'beforeReleaseRevision':13,'afterReleaseRevision':14,'socket':'/tmp/keel-diag-capacity-gif-deployed1/.s.PGSQL.55459','method':'normal changeReleasePlanning review','publicRPC':False,'compiler':False,'capture':False,'native':False,'signing':False,'submission':False,'publicationApproval':False,'activation':False},'files':[record(tool/x['path'])for x in b['toolFiles']]+[config,review,record(private/'packet.json'),record(pathlib.Path(p['bundleReceipt']['path'])),record(pathlib.Path(p['bundleDirectory'])/'normal-guided-review.mjs')],'limits':{'hostSeconds':45,'terminationGraceSeconds':2,'perStreamBytes':65536,'runtimeAbortSeconds':30,'statementMs':5000,'lockMs':1000},'allFutureOutputsAbsentAtReview':True}
cmd=save(root/'command-admission.json',command)
print(json.dumps({'review':review,'config':config,'command':cmd},indent=2))
