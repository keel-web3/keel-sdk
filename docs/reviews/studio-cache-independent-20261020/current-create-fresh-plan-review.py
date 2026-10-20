#!/usr/bin/env python3
"""Independently recompute a prepare-only current three-CREATE plan from raw RPC bytes."""
import datetime, hashlib, json, re, sys, time
from pathlib import Path
sha=lambda b:hashlib.sha256(b).hexdigest()
compact=lambda v:json.dumps(v,separators=(',',':'),ensure_ascii=False).encode()
load=lambda p:json.loads(p.read_bytes())
directory=Path(sys.argv[1]).resolve()
packet_path=Path('/Users/ravonus/dev/wt/native-public-durability-20261020/docs/reviews/studio-publication-20261020/native-prerequisites/public-run-01/unsigned.json')
packet_bytes=packet_path.read_bytes(); assert sha(packet_bytes)=='ef45b0d16c25698af7691005be8a883ccddaff9f0ac189408f4f2a1a6c86f324'
packet=json.loads(packet_bytes); sender='0x764E3EE7A844d9165937c41fd08086e43b997149'
plan_bytes=(directory/'fresh-plan.json').read_bytes(); plan=json.loads(plan_bytes)
header=plan['header']; tag=header['number']
methods=[('eth_chainId',[]),('eth_getBlockByNumber',['latest',False]),('eth_getTransactionCount',[sender,tag]),('eth_getTransactionCount',[sender,'pending']),('eth_getBalance',[sender,tag]),('eth_getCode',[sender,tag]),('eth_maxPriorityFeePerGas',[]),('eth_gasPrice',[])]+[('eth_getCode',[r['address'],tag]) for r in packet['emptyAddresses']]+[('eth_getBlockByNumber',[tag,False]),('eth_chainId',[]),('eth_getTransactionCount',[sender,'pending'])]
assert len(methods)==17 and len(list(directory.glob('*-*.request.json')))==17
responses=[]; physical=[]; request_bytes=response_bytes=0
for i,(method,params) in enumerate(methods,1):
    name=f'{i:02d}-{method}'; req=(directory/(name+'.request.json')).read_bytes(); body=(directory/(name+'.response.body')).read_bytes(); r=load(directory/(name+'.receipt.json'))
    assert json.loads(req)=={'jsonrpc':'2.0','id':i,'method':method,'params':params}
    assert r['id']==i and r['method']==method and r['httpStatus']==200 and r['outcome']=='RPC_RESULT' and r['bodyComplete'] is True
    assert len(req)==r['requestBytes'] and sha(req)==r['requestSHA256'] and len(body)==r['bodyBytes']==r['observedBytes'] and sha(body)==r['bodySHA256']
    assert len(req)<=524288 and len(body)<=2097152
    value=json.loads(body); assert value['id']==i and value['jsonrpc']=='2.0' and 'error' not in value
    responses.append(value['result']); request_bytes+=len(req);response_bytes+=len(body)
    physical.append({'id':i,'method':method,'requestSHA256':sha(req),'bodySHA256':sha(body),'requestBytes':len(req),'responseBytes':len(body)})
assert request_bytes<=1048576 and response_bytes<=4194304
snapshot={'chain':responses[0],'header':responses[1],'confirmedNonce':responses[2],'pendingNonce':responses[3],'balance':responses[4],'senderCode':responses[5],'priority':responses[6],'gasPrice':responses[7],'emptyCodes':[{'address':row['address'],'code':responses[8+i]} for i,row in enumerate(packet['emptyAddresses'])],'after':responses[14],'finalChain':responses[15],'finalPendingNonce':responses[16]}
assert snapshot==load(directory/'snapshot.json') and snapshot['header']==header
assert responses[0]==responses[15]=='0xaa36a7' and responses[2]==responses[3]==responses[16]=='0x128'
assert snapshot['after']['hash']==header['hash'] and snapshot['after']['number']==tag
assert responses[5]==packet['senderCode']['hex'] and all(r['code']=='0x' for r in snapshot['emptyCodes'])
q=lambda v:int(v,16)
for key in ['number','timestamp','gasLimit','baseFeePerGas']: assert re.fullmatch(r'0x(?:0|[1-9a-f][0-9a-f]*)',header[key])
assert q(header['timestamp'])>=1791294816
priority=q(responses[6]); fee=2*q(header['baseFeePerGas'])+priority
assert priority<=1000000000 and fee<=2000000000
ceilings=[q(r['transaction']['gas']) for r in packet['transactions']]
assert ceilings==[9012324,61379375,31884460] and sum(ceilings)<=q(header['gasLimit'])
assert q(responses[4])>=sum(ceilings)*fee
calls=[{'from':sender,'nonce':row['transaction']['nonce'],'value':'0x0','data':row['transaction']['data'],'gas':row['transaction']['gas'],'maxPriorityFeePerGas':responses[6],'maxFeePerGas':hex(fee)} for row in packet['transactions']]
request={'jsonrpc':'2.0','id':18,'method':'eth_simulateV1','params':[{'blockStateCalls':[{'calls':calls}],'validation':True,'traceTransfers':False},tag]}
assert compact(request)==(directory/'cumulative.request.json').read_bytes()
expected={'schema':'keel-public-native-fresh-plan@1','status':'PREPARED_NOT_EXECUTED','recipeSHA256':'cb26ae70d01b2d8b256bf760a2eff19b2642cc56296899adce2070c65608dcb8','staticPacketSHA256':sha(packet_bytes),'contractsCommit':packet['contractsCommit'],'chainId':11155111,'sender':sender,'nonce':'0x128','header':header,'priority':responses[6],'maxFeePerGas':hex(fee),'feesChangedFromStatic':fee!=q(packet['feeQuote']['maxFeePerGas']) or priority!=q(packet['feeQuote']['maxPriorityFeePerGas']),'expected':[{'index':r['index'],'address':r['predictedAddress'],'initcode':r['initcode'],'expectedRuntime':r['expectedRuntime']} for r in packet['transactions']],'expectedChildren':packet['children'],'gas':{'maximumExecutionGas':'16777216','maximumTotalGas':str(q(header['gasLimit'])),'separateStateGas':True,'transactionCeilings':list(map(str,ceilings)),'sumCeilings':str(sum(ceilings)),'perDimensionMeasurement':'UNOBSERVED; total ceil is not execution gas'},'request':request,'requestSHA256':sha(compact(request)),'signing':False,'submission':False,'privateProgram':False,'stateOverrides':False}
assert plan==expected
result=load(directory/'result.json'); claim=load(directory/'claim.json')
assert result['mode']=='prepare' and result['status']=='PREPARED_NOT_ADMITTED_NO_SIMULATION' and result['requests']==17 and result['planSHA256']==sha(plan_bytes) and result['recipeSHA256']==expected['recipeSHA256'] and result['totals']=={'requestBytes':request_bytes,'responseBytes':response_bytes,'simulations':0}
assert result['publicationReady'] is False and result['signing'] is False and result['submission'] is False
assert claim['mode']=='prepare' and claim['admissionSHA256'] is None
consumed=Path('/private/tmp/keel-native49d-bounded-20261020/one-native-3create-v1.claim.json').read_bytes()
assert sha(consumed)=='cb58ad8b60a9d5028cb2b6fd4c5d1497579f787847eda7dd79b74b43f1b11a49'
age=time.time()-q(header['timestamp'])
if '--historical' not in sys.argv: assert -120<=age<=120, age
print(json.dumps({'schema':'independent-current-create-fresh-plan-audit@1','result':'PASS','directory':str(directory),'planBytes':len(plan_bytes),'planSHA256':sha(plan_bytes),'requestBytes':len(compact(request)),'requestSHA256':sha(compact(request)),'canonicalBlock':{'number':tag,'hash':header['hash'],'timestamp':header['timestamp']},'headerAgeSecondsAtReview':age,'checkedAtUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),'nonce':296,'chainId':11155111,'priorityFee':priority,'maxFeePerGas':fee,'ceilings':ceilings,'requestCount':17,'publicSimulations':0,'physicalRequestBytes':request_bytes,'physicalResponseBytes':response_bytes,'rawRPC':physical,'expectedRuntimeCount':len(expected['expected'])+len(expected['expectedChildren']),'originalConsumedClaimPreserved':True,'historicalFixture':'--historical' in sys.argv},indent=2))
