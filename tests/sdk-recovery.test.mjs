import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {createPublicClient,createWalletClient,http,encodeFunctionData,parseAbi,toHex,zeroHash} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {foundry} from 'viem/chains';
import {prepareKeelRecovery,buildKeelRecoveryCall,verifyKeelRecoveryPackets,prepareKeelRecoveryEnrollment,buildKeelRecoveryEnrollment} from '../packages/sdk/dist/recovery.js';
import {keelManagerAbi,keelRecoveryGroupsAbi} from '../packages/sdk/dist/abi.js';

// Fresh local chain and throwaway deterministic test keys only. No configured RPCs,
// deployment catalog or wallet files participate in this integration test.
test('recovery SDK agrees with deployed contracts and relays cold-only upgrades',async t=>{
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
 const child=spawn('anvil',['--host','127.0.0.1','--port',String(port),'--silent','--prune-history'],{stdio:'ignore'});
 t.after(()=>child.kill('SIGTERM'));
 const chain={...foundry,rpcUrls:{default:{http:[`http://127.0.0.1:${port}`]}}};
 const client=createPublicClient({chain,transport:http(chain.rpcUrls.default.http[0],{retryCount:0})});
 for(let i=0;;i++){try{assert.equal(await client.getChainId(),31337);break;}catch(e){if(i===60)throw e;await new Promise(r=>setTimeout(r,100));}}
 const accounts=Array.from({length:9},(_,i)=>privateKeyToAccount(toHex(BigInt(i+1),{size:32}))).sort((a,b)=>BigInt(a.address)<BigInt(b.address)?-1:1);
 const sender=accounts[8],cold=accounts[7],wallet=createWalletClient({account:sender,chain,transport:http(chain.rpcUrls.default.http[0])});
 await client.request({method:'anvil_setBalance',params:[sender.address,toHex(100n*10n**18n)]});
 const artifact=name=>JSON.parse(readFileSync(new URL(`../../keel-contracts/out/${name}.sol/${name}.json`,import.meta.url)));
 const deploy=async(name,args=[])=>{const a=artifact(name);const tx=await wallet.deployContract({abi:a.abi,bytecode:a.bytecode.object,args});const r=await client.waitForTransactionReceipt({hash:tx});assert.equal(r.status,'success');return r.contractAddress;};
 const receipts=[];
 const send=async call=>{const hash=await wallet.sendTransaction({to:call.target,data:call.data,value:call.value});const r=await client.waitForTransactionReceipt({hash});assert.equal(r.status,'success');receipts.push({selector:call.data.slice(0,10),gasUsed:r.gasUsed.toString()});return r;};
 const sign=async plan=>Promise.all(plan.requests.flatMap(request=>request.members.slice(0,Number(request.threshold)).map(async address=>{
  const account=accounts.find(a=>a.address.toLowerCase()===address.toLowerCase());assert.ok(account,'test signer exists');
  return {signer:address,digest:request.digest,signature:await account.signTypedData(request.typedData)};
 })));
 const managerAbi=parseAbi(keelManagerAbi),registryAbi=parseAbi(keelRecoveryGroupsAbi);
 const implementation=await deploy('KeelManager');
 const initializer=encodeFunctionData({abi:artifact('KeelManager').abi,functionName:'initialize',args:[accounts.slice(0,3).map(a=>a.address),[sender.address],[]]});
 const manager=await deploy('KeelManagerProxy',[implementation,initializer]);
 const registry=await client.readContract({address:manager,abi:parseAbi(['function recoveryGroups() view returns (address)']),functionName:'recoveryGroups'});
 let create;
 await t.test('chain mismatch and invalid two-member roster are rejected before signing',async()=>{
  const op={kind:'create',registry,creator:sender.address,salt:toHex(1n,{size:32}),members:[cold.address],verifyKeys:true};
  await assert.rejects(prepareKeelRecovery(client,op,1),/chain/);
  await assert.rejects(prepareKeelRecovery(client,{...op,members:accounts.slice(0,2).map(a=>a.address)},31337),/three/);
  create=await prepareKeelRecovery(client,op,31337);
 });
 await t.test('creation proofs and ABI call succeed against the registry',async()=>{
  const packets=await sign(create);await verifyKeelRecoveryPackets(client,create,packets);await send(buildKeelRecoveryCall(create,packets));
  const g=await client.readContract({address:registry,abi:registryAbi,functionName:'group',args:[create.groupId]});assert.equal(g[0][0],cold.address);assert.equal(g[4],true);
 });
 await t.test('only initial assignment requires the existing operational quorum',async()=>{
  const plan=await prepareKeelRecovery(client,{kind:'assign',resource:manager,resourceKind:'manager',nextGroup:create.groupId},31337);
  const packets=await sign(plan);assert.equal(plan.initialEnrollment,true);
  const enrollment=await prepareKeelRecoveryEnrollment(client,plan,packets);
  await send(buildKeelRecoveryEnrollment(enrollment,await sign({requests:[enrollment.request]})));
 });
 await t.test('cold upgrade needs no operational signatures and cannot replay',async()=>{
  const next=await deploy('KeelManager');
  const plan=await prepareKeelRecovery(client,{kind:'upgrade',resource:manager,implementation:next,initializer:'0x'},31337);
  assert.equal(plan.requests.length,1);assert.deepEqual(plan.requests[0].members,[cold.address]);
  const packets=await sign(plan);await verifyKeelRecoveryPackets(client,plan,packets);
  assert.throws(()=>buildKeelRecoveryCall(plan,[packets[0],packets[0]]),/duplicate/);
  const call=buildKeelRecoveryCall(plan,packets);assert.equal(call.authorization,'recovery');await send(call);
  await assert.rejects(client.estimateGas({account:sender.address,to:call.target,data:call.data}));
 });
 await t.test('root recovery restores new governors and leaves the manager paused',async()=>{
  const members=accounts.slice(3,6).map(a=>a.address);
  const plan=await prepareKeelRecovery(client,{kind:'manager',resource:manager,members},31337),packets=await sign(plan);
  await verifyKeelRecoveryPackets(client,plan,packets);await send(buildKeelRecoveryCall(plan,packets));
  assert.deepEqual(await client.readContract({address:manager,abi:managerAbi,functionName:'governors'}),members);
  assert.equal(await client.readContract({address:manager,abi:managerAbi,functionName:'paused'}),true);
 });
 await t.test('backup grows to two-thirds quorum and removal needs that cold quorum',async()=>{
  const plan=await prepareKeelRecovery(client,{kind:'rotate',registry,groupId:create.groupId,members:accounts.slice(3,6).map(a=>a.address),verifyKeys:true},31337),packets=await sign(plan);
  await verifyKeelRecoveryPackets(client,plan,packets);await send(buildKeelRecoveryCall(plan,packets));
  const remove=await prepareKeelRecovery(client,{kind:'assign',resource:manager,resourceKind:'manager',nextGroup:zeroHash},31337);
  assert.equal(remove.initialEnrollment,false);assert.equal(remove.requests[0].threshold,2n);
  await send(buildKeelRecoveryCall(remove,await sign(remove)));
 });
 console.log('Recovery transaction gas:',JSON.stringify(receipts));
});
