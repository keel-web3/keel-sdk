import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAbi,decodeFunctionData,encodeFunctionResult,hashTypedData,keccak256,zeroAddress,zeroHash} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {keelManagerAbi} from '../packages/sdk/dist/abi.js';
import {inspectKeelManagerModules,prepareKeelManagerModuleReplacement,buildKeelManagerModuleReplacementCall} from '../packages/sdk/dist/manager-modules.js';
const abi=parseAbi(keelManagerAbi),bindings=parseAbi(['function manager() view returns(address)','function presentationModule() view returns(address)','function composerManager() view returns(address)','function composerModuleId() view returns(bytes32)','function isValidSignature(bytes32 digest,bytes signature) view returns(bytes4)']);
const manager='0x1111111111111111111111111111111111111111',store='0x2222222222222222222222222222222222222222',collection='0x3333333333333333333333333333333333333333',consumer='0x4444444444444444444444444444444444444444',active='0x5555555555555555555555555555555555555555',replacement='0x6666666666666666666666666666666666666666';
const moduleId=keccak256('0x1234'),runtime='0x60016000',nextRuntime='0x60026000',hash=keccak256(runtime),nextHash=keccak256(nextRuntime),blockHash=keccak256('0xabcd');
const governor=privateKeyToAccount('0x'+'11'.repeat(32)); // Public local test fixture; never a deployer key.
const types={GovernanceAction:[{name:'target',type:'address'},{name:'value',type:'uint256'},{name:'dataHash',type:'bytes32'},{name:'nonce',type:'uint256'},{name:'deadline',type:'uint64'},{name:'epoch',type:'uint64'}]};
function fixture(){
 const state={chainId:11155111,nonce:7n,epoch:1n,frozen:false,active,revision:2n,hash,nextHash,runtime,nextRuntime,consumerManager:manager,resolve:active,reorg:false,unknown:false,contractGovernor:false,signatureMagic:'0x1626ba7e'};const calls=[];
 const pool={async request(req){calls.push(req);const p=req.params??[];
  if(req.method==='eth_chainId')return '0x'+state.chainId.toString(16);
  if(req.method==='eth_getBlockByNumber')return {number:'0x64',hash:state.reorg&&p[0]!=='latest'?zeroHash:blockHash,timestamp:'0x3e8'};
  if(req.method==='eth_getCode')return p[0].toLowerCase()===governor.address.toLowerCase()?(state.contractGovernor?runtime:'0x'):p[0].toLowerCase()===replacement.toLowerCase()?state.nextRuntime:state.runtime;
  if(req.method==='eth_call'){
   let parsed,chosen;try{parsed=decodeFunctionData({abi,data:p[0].data});chosen=abi;}catch{parsed=decodeFunctionData({abi:bindings,data:p[0].data});chosen=bindings;}
   const fn=parsed.functionName,a=parsed.args;let result;
   if(fn==='manager')result=manager;
   else if(fn==='presentationModule')result=consumer;
   else if(fn==='composerManager')result=state.consumerManager;
   else if(fn==='composerModuleId')result=moduleId;
   else if(fn==='isValidSignature')result=state.signatureMagic;
   else if(fn==='governors')result=[governor.address];
   else if(fn==='governanceState')result={threshold:1n,nonce:state.nonce,epoch:state.epoch,changeNonce:0n};
   else if(fn==='paused')result=false;
   else if(fn==='module')result=state.unknown?{active:zeroAddress,revision:0n,frozen:false,codeHash:zeroHash}:{active:state.active,revision:state.revision,frozen:state.frozen,codeHash:state.hash};
   else if(fn==='resolveModule')result=state.resolve;
   else if(fn==='governanceActionDigest')result=hashTypedData({domain:{name:'Keel Manager',version:'1',chainId:state.chainId,verifyingContract:manager},types,primaryType:'GovernanceAction',message:{target:a[0].target,value:a[0].value,dataHash:keccak256(a[0].data),nonce:state.nonce,deadline:a[1],epoch:state.epoch}});
   else throw Error('Unexpected call '+fn);
   return encodeFunctionResult({abi:chosen,functionName:fn,result});
  }throw Error('No writes allowed: '+req.method);
 }};return {pool,state,calls};
}
const input={chainId:11155111,manager,moduleId,replacement,replacementCodeHash:nextHash,expectedCurrent:active,expectedRevision:2n};
test('managed collection discovers its actual manager and verified replaceable composer',async()=>{
 const f=fixture(),r=await inspectKeelManagerModules(f.pool,{chainId:11155111,collection,store});
 assert.equal(r.consumer,consumer);assert.equal(r.manager,manager);assert.equal(r.modules[0].moduleId,moduleId);assert.equal(r.modules[0].status,'replaceable');assert.equal(r.modules[0].observedCodeHash,hash);assert.equal(r.writes,0);
 assert.ok(f.calls.every(c=>!c.method.startsWith('eth_send')));
});
test('contract governor signatures use the manager-compatible ERC-1271 check',async()=>{
 const f=fixture();f.state.contractGovernor=true;const p=await prepareKeelManagerModuleReplacement(f.pool,input);
 const call=await buildKeelManagerModuleReplacementCall(f.pool,p,[{signer:governor.address,signature:'0x1234'}]);assert.equal(call.target,manager);
 f.state.signatureMagic='0xffffffff';await assert.rejects(buildKeelManagerModuleReplacementCall(f.pool,p,[{signer:governor.address,signature:'0x1234'}]),/signature/);
});
test('replacement prepares and validates normal manager governance calldata with a real fixture signature',async()=>{
 const f=fixture(),p=await prepareKeelManagerModuleReplacement(f.pool,input);
 assert.equal(decodeFunctionData({abi,data:p.call.data}).functionName,'configureModule');
 const signature=await governor.signTypedData(p.request.typedData),call=await buildKeelManagerModuleReplacementCall(f.pool,p,[{signer:governor.address,signature}]);
 assert.equal(call.target,manager);assert.equal(decodeFunctionData({abi,data:call.data}).functionName,'executeGovernance');assert.equal(p.writes,0);
});
test('frozen, stale, wrong-chain, changed-runtime and consumer mismatch fail before signing',async()=>{
 for(const [mutate,pattern]of [[s=>s.frozen=true,/frozen/],[s=>s.revision=3n,/changed/],[s=>s.chainId=1,/chain/],[s=>s.nextRuntime=runtime,/runtime/]]){const f=fixture();mutate(f.state);await assert.rejects(prepareKeelManagerModuleReplacement(f.pool,input),pattern);}
 const f=fixture();f.state.consumerManager=replacement;await assert.rejects(inspectKeelManagerModules(f.pool,{chainId:11155111,manager,collection}),/binding mismatch/);
});
test('resolved code commitment, reorg and unknown module are distinct states',async()=>{
 const f=fixture();f.state.hash=zeroHash;await assert.rejects(inspectKeelManagerModules(f.pool,{chainId:11155111,manager,moduleIds:[moduleId]}),/runtime\/binding/);
 f.state.hash=hash;f.state.resolve=replacement;await assert.rejects(inspectKeelManagerModules(f.pool,{chainId:11155111,manager,moduleIds:[moduleId]}),/runtime\/binding/);
 f.state.resolve=active;f.state.reorg=true;await assert.rejects(inspectKeelManagerModules(f.pool,{chainId:11155111,manager,moduleIds:[moduleId]}),/reorganized/);
 f.state.reorg=false;f.state.unknown=true;const r=await inspectKeelManagerModules(f.pool,{chainId:11155111,manager,moduleIds:[moduleId]});assert.equal(r.modules[0].status,'unregistered');
});
test('nonce/revision changes and modified signing requests are rejected after preparation',async()=>{
 const f=fixture(),p=await prepareKeelManagerModuleReplacement(f.pool,input),sig=await governor.signTypedData(p.request.typedData);
 f.state.nonce++;await assert.rejects(buildKeelManagerModuleReplacementCall(f.pool,p,[{signer:governor.address,signature:sig}]),/changed/);f.state.nonce--;
 const modified=structuredClone(p);modified.call.target=replacement;await assert.rejects(buildKeelManagerModuleReplacementCall(f.pool,modified,[{signer:governor.address,signature:sig}]),/modified/);
 await assert.rejects(buildKeelManagerModuleReplacementCall(f.pool,p,[]),/quorum/);
 await assert.rejects(buildKeelManagerModuleReplacementCall(f.pool,p,[{signer:replacement,signature:sig}]),/signature/);
});
