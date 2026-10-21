from pathlib import Path
import hashlib,json,re,shlex,math
ROOT=Path('/private/tmp/keel-qa-history17cb-runtime-20261021')
RAW=Path('/private/tmp/keel-17cb-public-roles-actual-20261021')
sha=lambda b:hashlib.sha256(b).hexdigest()
load=lambda p:json.loads(p.read_bytes())
IMAGE='sha256:17cb5aac36536e3d6026ba32b3bb3a66adc04af5bb7207082ee472dce66320c9'
before=None;roles=[];parsed={}
for role in ['tree','sdk','http']:
 step={'tree':'13-one-tree-role','sdk':'14-one-sdk-role','http':'15-one-http-role'}[role]
 p=RAW/(step+'.stdout');raw=p.read_bytes();durable=RAW/('durable-'+role+'-raw.stdout');assert raw==durable.read_bytes()
 x=json.loads(raw);inner=json.loads(x['stdout']);parsed[role]=inner
 assert x['schema']=='keel.actual-fe455-public-test@1' and x['result']==inner['result']=='PASS'and x['role']==role and x['image']==IMAGE and x['exitCode']==0 and x['nativeOrRPCInvoked']is False
 assert x['authenticatedContainerId']==x['retainedStoppedContainerId']and re.fullmatch('[a-f0-9]{64}',x['authenticatedContainerId'])
 assert all(k not in x for k in ['primaryFailure','cleanupFailure','originalGuardFailure'])
 assert x['before']==x['after']
 if before is None:before=x['before']
 assert x['before']==before and before['healthy']is True and before['workerPaused']is True
 assert before['originalId']=='5c97c6f105e06838a3a82f42003b76cd3f896b2cc072ac1afbcd72456fc97735'and before['runnerId']=='434316eff6e19951807f95ba8aee03a4db684d760039dfeb723c7bf9203a8649'
 assert x['oomComparison']=={'schema':'keel.candidate-oom-comparison@1','projected':True,'expected':False,'actual':None,'hostProfileSHA256':'de90264866cfea2742d916546b3df4121d338e036f9f60d24555df5887d83cdd','scope':'new-owned-candidate-comparison-only'}
 assert (RAW/(step+'.stderr')).read_bytes()==b''
 command=[c for c in load(RAW/'results.json')if c['step']==step];assert len(command)==1
 assert command[0]['exitCode']==0 and command[0]['stdoutBytes']==len(raw) and command[0]['stderrBytes']==0 and command[0]['stdoutSHA256']==sha(raw)
 verifier=[v for v in load(RAW/'durable-records.json')if v['role']==role];assert len(verifier)==1 and verifier[0]['bytes']==len(raw) and verifier[0]['sha256']==sha(raw) and verifier[0]['byteIdentical']is True and verifier[0]['exitCode']==0
 assert set(verifier[0])=={'role','argv','exitCode','bytes','sha256','byteIdentical','elapsedSeconds'}
 assert isinstance(verifier[0]['elapsedSeconds'],(int,float))and not isinstance(verifier[0]['elapsedSeconds'],bool)and math.isfinite(verifier[0]['elapsedSeconds'])and verifier[0]['elapsedSeconds']>=0
 remoteRoot='/home/ubuntu/keel-studio-image-qualification-fefa0600-ecc0-4584-b211-8cd0d139e601'
 reader=("import os,stat,sys;from pathlib import Path;r=Path("+repr(remoteRoot)+");s=r.lstat();assert r.resolve()==r and stat.S_ISDIR(s.st_mode) and s.st_uid==s.st_gid==0 and stat.S_IMODE(s.st_mode)==0o700;d=os.open(r,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW);f=os.open("+repr(role+'-result.json')+",os.O_RDONLY|os.O_NOFOLLOW,dir_fd=d);s=os.fstat(f);assert stat.S_ISREG(s.st_mode) and s.st_uid==s.st_gid==0 and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==0o600 and 0<s.st_size<131072;b=os.read(f,131073);os.close(f);os.close(d);assert len(b)==s.st_size;sys.stdout.buffer.write(b)")
 assert verifier[0]['argv']==['/usr/bin/ssh','-o','BatchMode=yes','-o','ConnectTimeout=12','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile=/Users/ravonus/dev/hashers/ops/servers/known_hosts','ubuntu@40.160.39.155','sudo -n /usr/bin/python3 -B -c '+shlex.quote(reader)]
 events=[];warnings=[]
 for line in x['stderr'].splitlines():
  if not line.startswith('KEEL_OBSERVER '):
   warnings.append(line);continue
  e=json.loads(line[len('KEEL_OBSERVER '):]);events.append(e)
  stats=e.get('cgroup',{}).get('events')
  if stats:
   counters=dict(s.split()for s in stats.splitlines());assert int(counters['oom'])==int(counters['oom_kill'])==int(counters['oom_group_kill'])==0
 if role!='tree':assert events and any(e['phase']=='exit'and e['code']==0 for e in events)
 expected_warnings=['(node:43) [DEP0040] DeprecationWarning: The `punycode` module is deprecated. Please use a userland alternative instead.','(Use `node --trace-deprecation ...` to show where the warning was created)'] if role=='sdk'else[]
 assert warnings==expected_warnings,('unexpected_stderr',role,warnings)
 roles.append({'role':role,'stdoutSHA256':sha(raw),'durableSHA256':sha(durable.read_bytes()),'bytes':len(raw),'durableBytesExactStdout':True,'retainedStoppedId':x['retainedStoppedContainerId'],'exitCode':0,'runnerEnforcedStoppedAndOOMFalse':True,'fullCreatedConfigSHA256':x['fullCreatedConfigSHA256'],'fullCreatedHostSHA256':x['fullCreatedHostSHA256'],'elapsedSeconds':x['elapsedSeconds'],'observerSamples':len(events),'observedCgroupPeakBytes':max((int(e['cgroup']['peak'])for e in events if e.get('cgroup',{}).get('peak')),default=None),'allObservedOOMCountersZero':True,'retainedExactNodeDeprecationWarning':warnings})
assert len(set(r['retainedStoppedId']for r in roles))==3
assert before=={'originalId':'5c97c6f105e06838a3a82f42003b76cd3f896b2cc072ac1afbcd72456fc97735','configSHA256':'a519e731b1b84be411ef1b8841b6814613267cdb375e12b1ff98a1d4de09dd5e','hostSHA256':'186e487039113f582118064bce13b98c79f75eca5b3fa0d788c7d79b8fb14049','mountsSHA256':'74cc304b0955c822f88ffdbcbff56d89857f5ea3d7c51246ec106f00247ade89','runnerId':'434316eff6e19951807f95ba8aee03a4db684d760039dfeb723c7bf9203a8649','workerPaused':True,'healthy':True}
t=parsed['tree'];assert t['entries']==36065 and t['completeAppTreeSHA256']=='89e7e64f96909cbb7ae7d553e057ef51b882e290073afb468de63edc362ac39d'and t['nativeSimulationPerformed']is False and t['networkUsed']is False
assert t['onlyExternalDifferences']==[] and t['externalDependencyEntries']==16129 and t['unchangedNativeOpsBootstrapWorkerSHA256']=='0abb465788d32be2a0047bcf4c91dd5745be0848ecb8dfda511714f6f89ebbc8'
s=parsed['sdk'];assert s['uid']==999 and s['node']=='v22.23.1'and s['buildId']=='jfjIfW1-d41RR-j-i-YgL'
assert s['runtimeSource']['siteCommit']=='71cb0e31bab5e4ee93af9d3b3185978e46f1fe8e' and s['runtimeSource']['sdkCommit']==s['runtimeSource']['compiledSdkCommit']=='311d61526284248938e335d7ed879089408933be'
assert s['canonicalSDKDistFiles']==1360 and s['canonicalSDKDistAllBytesPreserved']is True and s['workerResolution']['sockets']==0 and s['proofFactoryImported']is True
assert s['nativeReceipt']['sdkCommit']=='64e5fa37667ac424ae87019c7609581dfc2ea364' and s['nativeReceipt']['binarySha256']=='8a2970e2cebc1f4b51bd228ab7fa53208e2d247030f46037991351115f12a3b5'
assert s['compiledFactory']['result']=='PASS' and len(s['compiledFactory']['results'])==2 and s['mediaCapabilities']['image']['available']is True and s['mediaCapabilities']['movie']['available']is True
assert s['network']=='none' and s['signing']==s['submission']=='not-performed'and s['actualPublicationVerified']is False
assert s['publishedReader']=={'algorithm':'sha256','digest':'0x978e5fed29103cc72a2272f908421f14a587009d959aa40d3a1853af130bae1a','byteLength':251050}
assert s['canonicalChromeSHA256']=='e8adffa099db16ee1740f338c8766d0cb48032752055c5aed48ec6b5df8a22e6'
assert [(v['codecProfile'],v['prefixSha256'],v['suffixSha256'],v['prefixBytes'],v['suffixBytes'])for v in s['compiledFactory']['results']]==[('native','4a5405a5794aa91206ef4cebebee127d8917735d4d33546a0bbf8c6bead9a58e','b40f97a95bf3ed016e6cf773486679ab842d90b40e820ffc8bde7d096c62cbf8',15108,143728),('lzma-js','4a5405a5794aa91206ef4cebebee127d8917735d4d33546a0bbf8c6bead9a58e','bc4af94db06fb2cd3af01e8ee45149ce3af6940ad1b3e64f2b850068d173e578',15108,157664)]
h=parsed['http'];
assert h['siteCommit']=='71cb0e31bab5e4ee93af9d3b3185978e46f1fe8e' and h['buildId']=='jfjIfW1-d41RR-j-i-YgL'
assert h['actualPackagedStandaloneServer']is True and h['walletGateEnabled']is True and h['authenticationSent']is False and h['externalNetwork']=='none'
assert h['database']=='unreachable-synthetic'and h['workerPaused']is True and h['signing']is False and h['transactionSubmission']is False
public={(c['path'],c['method']):c for c in h['checks']if c['status']==200};assert set(public)=={(p,m)for p in ['/.well-known/keel.json','/.well-known/keel-capabilities']for m in ['GET','HEAD']}
assert public[('/.well-known/keel.json','GET')]['bodyBytes']==10686 and public[('/.well-known/keel.json','GET')]['sha256']=='2e4896620cb0d443576d1ae37202f04702a11868f32de958d6b545c4e5c3da9f'
assert all(public[(p,'HEAD')]['bodyBytes']==0 for p in ['/.well-known/keel.json','/.well-known/keel-capabilities'])
denied=[c for c in h['checks']if(c['path'],c['method'])not in public];assert len(denied)==16 and all(c['status']==401 for c in denied)
assert {c['path']for c in denied if c['method']=='GET'}=={'/.well-known/private.json','/.well-known/keel.json/other','/.well-known/keel-capabilities/private','/api/mcp','/api/studio/projects','/api/agent/drafts'}
for p in ['/.well-known/keel.json','/.well-known/keel-capabilities']:assert {c['method']for c in denied if c['path']==p}=={'POST','PUT','PATCH','DELETE','OPTIONS'}
for x in parsed.values():assert x['productionActivated']is False
result={'schema':'keel.qa-history17cb-actual-runtime-receipt-audit@1','result':'PASS_ACTUAL_ISOLATED_IMAGE_ROLES_ONLY','image':IMAGE,'roles':roles,'beforeAfterOriginalAndRunnerExact':before,'fullTreeEntries':36065,'all1360CoreDistFilesCheckedInActualImage':True,'canonicalCompiledFactoryNativeAndLzmaGoldens':True,'readerChromeAndMediaChecks':True,'workerChildZeroSockets':True,'http':{'exactPublicGETHEAD200':4,'privateAndWrongMethod401':16,'manifestBytes':10686,'manifestSHA256':'2e4896620cb0d443576d1ae37202f04702a11868f32de958d6b545c4e5c3da9f','actualPackagedServer':True,'authenticated':False,'scope':'isolated no-network loopback server, not deployed browser or upstream RPC'},'runtimeVersions':s['versions'],'runtimeNode':s['node'],'sourceTestsNode':'v22.22.1','nativeExecutorReceiptSourceRemains64e':True,'noNewNativeOrPrivateProgramExecuted':True,'actualRolesExecutedBy':'root sole host operator, QA independently audited durable raw output and frozen controls','qaHostActions':0,'activationAuthority':False,'mandatoryAfterSeparateActivation':['own exact-source Gator normal deployed simulation to unsigned wallet','real GIF normal deployed simulation to unsigned wallet','historical authenticated MIME/hash/decode/render on this exact new build']}
(ROOT/'runtime-receipt-audit.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
