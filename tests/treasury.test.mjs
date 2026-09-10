import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeFunctionData,parseAbi,zeroAddress,hashTypedData} from 'viem';
import {buildKeelGroupConfiguration,buildKeelGroupMemberPolicy,decodeKeelGroupMetadata,prepareKeelGroupExecution,buildKeelGroupExecution,buildKeelGroupPayout,prepareKeelTreasuryPayout,keelDefaultGroups} from '../packages/sdk/dist/treasury.js';
import {keelAccessGroupsAbi,keelFeeTreasuryAbi} from '../packages/sdk/dist/abi.js';
const treasury='0x0000000000000000000000000000000000001000',groups='0x0000000000000000000000000000000000002000',wallet='0x0000000000000000000000000000000000003000',manager='0x0000000000000000000000000000000000004000';
const members=[5,6,7].map(n=>'0x'+String(n).padStart(40,'0'));
function client(overrides={}){
 const values={requireSystemsActive:undefined,accessGroups:groups,payoutWallet:wallet,withdrawalsUnlockAt:50n,payoutRevision:3n,nextCustomPayoutAt:0n,customPayoutLimit:10n,group:[members,2n,4n,2n,true,true],hasCapability:true,manager,governanceEpoch:1n,paused:false,accountTier:3,executionPolicy:{maxValue:5n,minimumTier:3,enabled:true},...overrides};
 return {getBlock:async()=>({number:17n,timestamp:100n}),getChainId:async()=>31337,readContract:async call=>{assert.equal(call.blockNumber,17n);if(!(call.functionName in values))throw Error(call.functionName);return values[call.functionName]}};
}
test('group configuration sorts members and rejects two or duplicate wallets',()=>{
 const action=buildKeelGroupConfiguration(groups,keelDefaultGroups.treasury,[...members].reverse(),1n);
 const decoded=decodeFunctionData({abi:parseAbi(keelAccessGroupsAbi),data:action.data});assert.deepEqual(decoded.args,[keelDefaultGroups.treasury,members,true,1n]);
 assert.throws(()=>buildKeelGroupConfiguration(groups,keelDefaultGroups.treasury,members.slice(0,2),1n),/one bootstrap/);
 assert.throws(()=>buildKeelGroupConfiguration(groups,keelDefaultGroups.treasury,[members[0],members[0],members[1]],1n),/unique/);
});
test('omitted wallet resolves to configured default and approval threshold comes from chain',async()=>{
 const plan=await prepareKeelTreasuryPayout({client:client(),treasury,amount:1000n});
 assert.equal(plan.recipient,zeroAddress);assert.equal(plan.destination,wallet);assert.equal(plan.custom,false);assert.equal(plan.threshold,2n);assert.equal(plan.digest,hashTypedData(plan.typedData));
 assert.equal(plan.typedData.message.nonce,4n);assert.equal(plan.typedData.message.revision,2n);assert.equal(plan.revision,3n);
 assert.throws(()=>buildKeelGroupPayout(plan,[{signer:members[0],signature:'0x12'}]),/required number/);
 const action=buildKeelGroupPayout(plan,[{signer:members[1],signature:'0x12'},{signer:members[0],signature:'0x34'}]);
 const decoded=decodeFunctionData({abi:parseAbi(keelFeeTreasuryAbi),data:action.data});assert.equal(decoded.functionName,'payout');assert.equal(decoded.args[3],zeroAddress);assert.equal(decoded.args[6][0].signer,members[0]);
});
test('custom amount limit and global cooldown are checked before signing',async()=>{
 await assert.rejects(prepareKeelTreasuryPayout({client:client(),treasury,amount:11n,recipient:members[0]}),/limit/);
 await assert.rejects(prepareKeelTreasuryPayout({client:client({nextCustomPayoutAt:101n}),treasury,amount:10n,recipient:members[0]}),/Custom payouts are locked/);
 const plan=await prepareKeelTreasuryPayout({client:client(),treasury,amount:10n,recipient:members[0]});assert.equal(plan.custom,true);
});
test('wallet-change lock, pause, and missing capability prevent approval preparation',async()=>{
 for(const [overrides,pattern] of [[{withdrawalsUnlockAt:101n},/Withdrawals are locked/],[{paused:true},/paused/],[{hasCapability:false},/cannot approve/],[{accessGroups:zeroAddress},/incomplete/]])
 await assert.rejects(prepareKeelTreasuryPayout({client:client(overrides),treasury,amount:1n}),pattern);
});
test('bootstrap uses one signature and expired deadlines are rejected',async()=>{
 const plan=await prepareKeelTreasuryPayout({client:client({group:[[members[0]],1n,0n,1n,false,true]}),treasury,amount:1n});
 assert.equal(plan.threshold,1n);assert.equal(plan.quorumActive,false);assert(buildKeelGroupPayout(plan,[{signer:members[0],signature:'0x12'}]).data);
 await assert.rejects(prepareKeelTreasuryPayout({client:client(),treasury,amount:1n,deadline:100n}),/deadline/);
});

test('mixed-case wallet addresses keep the Ethereum checksum when sorting',()=>{
 const wallets=['0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266','0x70997970C51812dc3A010C7d01b50e0d17dc79C8','0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'];
 const action=buildKeelGroupConfiguration(groups,keelDefaultGroups.treasury,wallets,1n);
 const decoded=decodeFunctionData({abi:parseAbi(keelAccessGroupsAbi),data:action.data});
 assert.deepEqual(new Set(decoded.args[1]),new Set(wallets));
});

test('group execution obeys both manager policy and group capability',async()=>{
 const action={target:treasury,value:3n,data:'0x12345678'};
 const plan=await prepareKeelGroupExecution({client:client(),groups,groupId:keelDefaultGroups.operations,action});
 const call=buildKeelGroupExecution(plan,[{signer:members[0],signature:'0x12'},{signer:members[1],signature:'0x34'}]);
 assert.equal(call.target,groups);assert.equal(call.value,3n);
 const decoded=decodeFunctionData({abi:parseAbi(keelAccessGroupsAbi),data:call.data});assert.equal(decoded.functionName,'execute');assert.deepEqual(decoded.args[1],action);
 for(const overrides of [{accountTier:1},{executionPolicy:{maxValue:2n,minimumTier:3,enabled:true}},{executionPolicy:{maxValue:5n,minimumTier:3,enabled:false}}])
 await assert.rejects(prepareKeelGroupExecution({client:client(overrides),groups,groupId:keelDefaultGroups.operations,action}),/manager does not permit/);
 await assert.rejects(prepareKeelGroupExecution({client:client({hasCapability:false}),groups,groupId:keelDefaultGroups.operations,action}),/cannot approve/);
});


test('member admission policy is mutable and builders do not pin the old ceiling',()=>{
 const roster=Array.from({length:64},(_,i)=>'0x'+(i+1).toString(16).padStart(40,'0'));
 assert(buildKeelGroupConfiguration(groups,keelDefaultGroups.treasury,roster,1n,true,64).data);
 assert(buildKeelGroupConfiguration(groups,keelDefaultGroups.treasury,roster,1n).data);
 assert.throws(()=>buildKeelGroupConfiguration(groups,keelDefaultGroups.treasury,roster,1n,true,32),/policy/);
 const action=buildKeelGroupMemberPolicy(groups,64,2n);
 assert.deepEqual(decodeFunctionData({abi:parseAbi(keelAccessGroupsAbi),data:action.data}).args,[64,2n]);
 for(const maximum of [0,2,3.5,NaN,2**32]) assert.throws(()=>buildKeelGroupMemberPolicy(groups,maximum,1n),/uint32/);
});

test('packed roster metadata retains every flag and the full uint64 revision',()=>{
 const hex=word=>'0x'+word.toString(16).padStart(64,'0');
 for(const revision of [0n,1n,(1n<<64n)-1n]) for(const quorumActive of [false,true]) for(const enabled of [false,true]) {
  const word=revision|(quorumActive?1n<<64n:0n)|(enabled?1n<<65n:0n);
  assert.deepEqual(decodeKeelGroupMetadata(hex(word)),{revision,quorumActive,enabled});
 }
 assert.throws(()=>decodeKeelGroupMetadata(hex(1n<<66n)),/Unknown/);
 assert.throws(()=>decodeKeelGroupMetadata('0x01'),/bytes32/);
});

test('browser group ABI matches packaged compiled inputs, outputs, and event indexing',async()=>{
 const {ABIS}=await import('../packages/sdk/dist/abis/keel-kernel.generated.js');
 const type=item=>item.type.startsWith('tuple')?'('+item.components.map(type).join(',')+')'+item.type.slice(5):item.type;
 const key=item=>item.type+':'+(item.name??'')+'('+(item.inputs??[]).map(type).join(',')+')';
 for(const item of parseAbi(keelAccessGroupsAbi)) {
  const compiled=ABIS.KeelAccessGroups.find(candidate=>key(candidate)===key(item));
  assert(compiled,`Compiled ABI missing ${key(item)}`);
  assert.deepEqual((compiled.outputs??[]).map(type),(item.outputs??[]).map(type));
  assert.equal(compiled.stateMutability,item.stateMutability);
  if(item.type==='event') assert.deepEqual(compiled.inputs.map(x=>Boolean(x.indexed)),item.inputs.map(x=>Boolean(x.indexed)));
 }
});
