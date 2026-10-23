#!/usr/bin/env python3
"""Read-only postrun audit; no RPC, Docker access, signing, or execution."""
import collections, hashlib, json, subprocess
from pathlib import Path
P=Path('/Users/ravonus/dev/wt/studio-create-qualification-20261020/keel-site/docs/reviews/studio-publication-20261019/release/native-create-949-execution-20261020')
O=Path(__file__).parent
sha=lambda b:hashlib.sha256(b).hexdigest()
load=lambda p:json.loads(p.read_bytes())
plan=load(P/'program.json'); result=load(P/'native-execution.stdout.json'); factory=result['factory']
assert sha((P/'program.json').read_bytes())=='6c88643d56e4e181231480b8b4090bbe53e205849987407c06266b24e667e79f'
assert sha((P/'program-review.json').read_bytes())=='e81eebafe294fe97244cea9d6f3cc4bc5164490e86790db68088e0686d27dd9d'
assert result['result']=='PASS' and result['clientExitCode']==0 and result['operatorSha256']=='5f7f8beb57fdc4972f3416317f624f8e0f17904bbdb5a281e4da1f33ce2263ed' and result['planSha256']=='9c6a2edbdfd5f25cbcd371a154760506cc0e11bec5c976546e9ac5cc39ee819c'
assert result['reviewSha256']=='ece030e7221243e7a845472cb8e1967588d8a3d56c513338cfd39da5fce913a0'
assert result['originalBefore']==result['originalAfter'] and result['applicationMutation'] is result['databaseMutation'] is result['imageImportPermitted'] is False
assert result['images']=={'runner':'sha256:48144d982e4edaf62198f3ca583dd5ded6c7f1228c6cc39322fd5a90341cba43','client':'sha256:fe94404ea7a860e6397e0964ef8dbe7d9fa9bb2777a57dd90cf8c63d802d8369'}
hash_rows=load(P/'actual-native-receipt-hashes.json')+load(P/'actual-import-receipt-hashes.json')
for row in hash_rows:
    b=(P/'host'/row['path']).read_bytes(); assert len(b)==row['bytes'] and sha(b)==row['sha256']
receipt=(P/'host/qualification-receipt.json').read_bytes()
assert (json.dumps(result,indent=2)+'\n').encode()==receipt
raw=(P/'host/factory.stdout.json').read_bytes(); assert len(raw)==result['stdoutBytes'] and sha(raw)==result['stdoutSha256'] and json.loads(raw)==factory
assert not (P/'host/factory.stderr.log').read_bytes() and result['stderrBytes']==0
assert factory['schema']=='keel-current-sdk-native-prerequisites@1' and factory['status']=='PASS_EXACT_PUBLIC_THREE_CREATE_NATIVE_CHARACTERIZATION'
assert factory['sdkCommit']=='b524bf5fc19939c7523aada2e53f79e3360970ea' and factory['inputSHA256']==sha((P/'program.json').read_bytes()) and factory['requestSHA256']==plan['requestSHA256']=='b7c95872efa3e65f94888219a8bf89572e71c3ebd1515004ba022904e23c16d4'
assert factory['physicalHTTPBodyBytes']==len(json.dumps(plan['request'],separators=(',',':')).encode())==112205
assert factory['sourceAttempts']==[] and factory['productionUIProof'] is factory['publicationReady'] is factory['childRuntimeObserved'] is False
assert factory['signing']==factory['submission']=='not-performed'
assert factory['canonicalBlock']=={'number':str(int(plan['header']['number'],16)),'hash':plan['header']['hash']}
assert len(factory['nativeExecutions'])==1 and len(factory['result'])==1
e=factory['nativeExecutions'][0]; block=factory['result'][0]
assert e['binarySha256']=='3f9c2e9f2a9fb4267695bfc8493379001f81d1f7cca8b75eaa19133b0f20fcc8' and e['gethCommit']=='a579077007b98217c3e253a66e4b452ca0c32b96'
assert e['baseStateRoot']==plan['header']['stateRoot'] and e['blockHash']==plan['header']['hash'] and e['chainId']==11155111 and e['gasBudget']==10000000000
assert e['signing']==e['submission']=='not-performed' and e['state']=='ephemeral-proof-backed'
envelope_script="""import fs from 'node:fs';import crypto from 'node:crypto';let p=JSON.parse(fs.readFileSync(process.argv[1]));let b=JSON.stringify({schema:'keel-proof-executor@1',chainId:11155111,blockHash:p.header.hash,header:p.header,payload:p.request.params[0],limits:{gasBudget:10000000000,requests:10000,witnessBytes:64*1024*1024,responseBytes:256*1024*1024,wallTimeMs:180000}});console.log(JSON.stringify({bytes:Buffer.byteLength(b),sha256:crypto.createHash('sha256').update(b).digest('hex')}));"""
envelope=json.loads(subprocess.check_output(['/Users/ravonus/.nvm/versions/node/v22.22.1/bin/node','--input-type=module','-e',envelope_script,str(P/'program.json')]))
assert envelope['sha256']==e['requestSha256']=='fe543ca9fb6ee0a3d56fc87e068b987f69f653c8c811482bf71e5074212c3d7f'
assert block['parentHash']==plan['header']['hash'] and int(block['number'],16)==int(plan['header']['number'],16)+1 and int(block['timestamp'],16)>int(plan['header']['timestamp'],16)
assert len(block['calls'])==len(block['transactions'])==3 and block['stateRoot']!='0x'+'0'*64
calls=[]
for i,c in enumerate(block['calls']):
    assert int(c['status'],16)==1 and 'error' not in c and int(c['gasUsed'],16)<=int(plan['request']['params'][0]['blockStateCalls'][0]['calls'][i]['gas'],16)
    b=bytes.fromhex(c['returnData'][2:]); expected=plan['expected'][i]['expectedRuntime'];assert len(b)==expected['bytes'] and sha(b)==expected['sha256']
    calls.append({'index':i,'gasUsed':int(c['gasUsed'],16),'returnedBytes':len(b),'returnedSHA256':sha(b)})
physical=factory['physicalStateRequests'];methods=collections.Counter(r['method'] for r in physical)
assert all(r['status']==200 and r['method'] in ['eth_chainId','eth_getBlockByNumber','eth_getCode','eth_getProof'] for r in physical)
assert len(physical)==44 and max(r['physicalHTTPBodyBytes'] for r in physical)==283 and sum(r['physicalHTTPBodyBytes'] for r in physical)==10019
for role,row in result['cleanup'].items(): assert row['state']=='stopped' and row['retained'] is True and row['containerId']==result[role+'ContainerId']
before=load(P/'guard-before-native.stdout.json')['result'];after=load(P/'guard-after-native.stdout.json')['result'];assert before==after and before['healthy'] is before['running'] is before['workerPaused'] is True
assert before['configSha256']=='9543c71f9f506e5243c9a74a3d70007ab6919c9f4eb76c0fec8ad7cdb40a77eb' and before['hostConfigSha256']=='9ebb974a9d71321d58a0bb74a528d089a6a4337a54328460a9768ff260e56467'
health_rows=[json.loads(s) for s in (P/'health-window.jsonl').read_text().splitlines()]
health=[r for r in health_rows if r['schema']=='keel-bounded-public-health-read@1']
finished=[r for r in health_rows if r['schema']=='keel-bounded-public-health-window-finished@1']
assert len(health_rows)==len(health)+1 and len(finished)==1 and finished[0]['interrupted'] is True and finished[0]['configurationChange'] is False
assert health and all(r['status']==200 for r in health)
stop=load(P/'health-window-stop.json');assert stop['signal']=='SIGTERM' and stop['remoteContainerAction'] is False
imported=load(P/'native-import.stdout.json');assert imported==load(P/'host/native-receipt.json') and imported['result']=='PASS' and imported['originalBefore']==imported['originalAfter']==before and imported['actualImageId']==result['images']['runner']
assert imported['load']['inputSHA256']=='3ca58e95c5cf67d5990ad20b5e9bb7844137839f64dbd3281298bfd26e0c8714' and imported['load']['physicalInputBytes']==11032064 and imported['load']['archiveFileCreated'] is imported['load']['rawTarFileCreated'] is False
consumed=Path('/private/tmp/keel-native49d-bounded-20261020/one-native-3create-v1.claim.json').read_bytes();assert sha(consumed)=='cb58ad8b60a9d5028cb2b6fd4c5d1497579f787847eda7dd79b74b43f1b11a49'
audit={'schema':'independent-current-create-postrun-audit@1','decision':'PASS_PREREQUISITE_NATIVE_CHARACTERIZATION_ONLY','planSHA256':factory['inputSHA256'],'requestSHA256':factory['requestSHA256'],'nativeEnvelope':envelope,'durableReceipt':{'bytes':len(receipt),'sha256':sha(receipt),'exactReconstructedFromTerminal':True},'nativeImportReceiptSHA256':sha((P/'host/native-receipt.json').read_bytes()),'rawFactory':{'bytes':len(raw),'sha256':sha(raw)},'canonicalBlock':factory['canonicalBlock'],'resultBlock':{'number':block['number'],'hash':block['hash'],'parentHash':block['parentHash'],'stateRoot':block['stateRoot']},'calls':calls,'nativeEvidence':e,'physicalState':{'count':len(physical),'maximumRequestBytes':max(r['physicalHTTPBodyBytes'] for r in physical),'totalRequestBytes':sum(r['physicalHTTPBodyBytes'] for r in physical),'methods':dict(methods),'allHTTP200':True,'remoteSimulationCount':0},'originalFullGuardUnchanged':before,'cleanup':result['cleanup'],'healthHTTP200Observations':len(health),'ownedHealthStopRecorded':True,'originalPublicTimeoutClaimPreserved':True,'mayOfferExactSharedPrerequisitePacketForOwnerApproval':True,'ownerApprovalIsNotTransactionAuthorityForAgent':True,'childRuntimeObserved':False,'originalGIFQualified':False,'activationApproved':False,'publicationReady':False,'signing':'not-performed','submission':'not-performed','remainingSequence':['Obtain explicit owner approval for exact shared prerequisite transactions only; no automatic signing or spending.','Submit only after approval, verify each receipt and exact runtime/child bytes and selected-chain registrations/readbacks.','Run unchanged normal original GIF compiler and full proof on actual dependencies; preserve GIF gate.','Complete independent release/activation plan gates and own-Juniper exact Gator deployed UI unsigned wallet boundary.']}
(O/'current-create-postrun-949-audit.json').write_text(json.dumps(audit,indent=2)+'\n')
print(json.dumps(audit,indent=2))
