import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {keccak256,padHex} from 'viem';
import {qualifyKeelRouted721Factory,qualifyKeelPreparedEnvelope} from '../packages/sdk/dist/prepared-envelope-capability.js';
const records=JSON.parse(readFileSync(new URL('./fixtures/prepared-envelope-capability-49d.json',import.meta.url)));
const old=JSON.parse(readFileSync(new URL('./fixtures/prepared-envelope-capability.json',import.meta.url)));
const fresh=()=>structuredClone(records.fixture);
const replace=(code,start,value)=>code.slice(0,2+start*2)+value.slice(2)+code.slice(2+start*2+value.length-2);
const join=f=>f.carriers.map(address=>f.codeByAddress[address.toLowerCase()].slice(2)).join('');
function update(f,creation){const first=Math.ceil((creation.length/2)/2);f.codeByAddress[f.carriers[0].toLowerCase()]='0x'+creation.slice(0,first*2);f.codeByAddress[f.carriers[1].toLowerCase()]='0x'+creation.slice(first*2);f.creationHash=keccak256('0x'+creation);f.codeByAddress[f.deployer.toLowerCase()]=replace(f.codeByAddress[f.deployer.toLowerCase()],84,f.creationHash);return f;}
function setup(f=fresh(),options={}){
 const requests=[],block={number:BigInt(f.block.number),hash:f.block.hash};let pins=0;
 const record=(kind,input={})=>{requests.push({kind,...input});options.onRead?.(requests);};
 const read={getChainId:async input=>{record('chain',input);return options.chainId??11155111;},getBlock:async(number,input)=>{record('block',{number,...input});return {...block,...(++pins===2&&options.reorg?{hash:'0x'+'ab'.repeat(32)}:{})};},getCode:async input=>{record('code',input);return f.codeByAddress[input.address.toLowerCase()]??'0x';},call:async input=>{record('call',input);if(input.to.toLowerCase()===f.factory.toLowerCase())return padHex(f.deployer,{size:32});if(input.to.toLowerCase()===f.deployer.toLowerCase())return f.creationHash;throw Error('unexpected call');}};
 return {input:{chainId:11155111,factory:f.factory,block,read,...(options.signal?{signal:options.signal}:{})},requests};
}
const rejected=(input,reason)=>assert.rejects(qualifyKeelRouted721Factory(input),error=>{assert.equal(error.code,'KEEL_PREPARED_ENVELOPE_UNQUALIFIED');assert.match(error.details.reason,reason);return true;});
test('49d fixture is hash-bound actual unlinked compiler artifact with exact declared links and explicit counterfactual scope',()=>{
 assert.match(records.scope,/UNDEPLOYED/);assert.equal(records.contractsCommit,'49d320dd019cbcc1a36aec33bb59a552f8a349a8');
 const meta=records.metadata.KeelRouted721;assert.equal(meta.artifactSHA256,'4c918fe34f6f385ccde5c4b384d6efdf86222bc6220ef46e4dcbf2e8d50b79bf');
 assert.equal(meta.metadata.compiler.version,'0.8.36+commit.8a079791');assert.equal(meta.metadata.settings.viaIR,true);assert.equal(meta.metadata.settings.optimizer.runs,50);assert.equal(meta.metadata.settings.evmVersion,'prague');assert.deepEqual(meta.metadata.settings.metadata,{appendCBOR:false,bytecodeHash:'none'});
 const source=records.sources.find(v=>v.path==='src/modules/keel-die/KEEL721.sol');assert.equal(meta.metadata.sources[source.path].keccak256,source.keccak256);
 let unlinked=records.creationTemplate;for(const {start,length} of records.creationLinks){assert.equal(length,20);assert.match(unlinked.slice(2+start*2,2+(start+length)*2),/^__\$[a-f0-9]{34}\$__$/);unlinked=replace(unlinked,start,'0x'+'00'.repeat(length));}
 assert.deepEqual(records.creationProfile.libraryStarts,[20383,20891,21235,21682]);assert.equal((unlinked.length-2)/2,26364);
 assert.equal(keccak256(unlinked),'0x7f636ad8e43975569ee1c2c2a00aea3bb441b89bb57f0e6b998a8bdbd2e68bf1');
 assert.equal(keccak256('0x'+join(fresh())),records.fixture.creationHash);
 assert.equal(createHash('sha256').update(Buffer.from(records.fixture.codeByAddress[records.fixture.library.toLowerCase()].slice(2),'hex')).digest('hex'),'0c0378cd53af45c0b9a0df29db7615bf122fc0ac68cc59918efcb98593293584');
});
test('both exact4015 and exact49d compiled dependency sets qualify, with full simulation still mandatory',async()=>{
 for(const fixture of [old.maintained,fresh()]){
  const {input}=setup(structuredClone(fixture));const result=await qualifyKeelRouted721Factory(input);
  assert.equal(result.scope,'routed721-factory');assert.equal(result.moduleHooks,true);assert.equal(result.requiresFullSimulation,true);assert.equal(result.collectionCreationCodeHash,fixture.creationHash);
  const envelope=await qualifyKeelPreparedEnvelope({...input,encodedPrefix:new Uint8Array(256001),encodedSuffix:new Uint8Array(2042)});
  assert.equal(envelope.capability.prefixMaxBytes,null);assert.equal(envelope.requiresFullSimulation,true);
 }
});
test('current compiled collection is not admitted by length or changed carrier getter alone',async()=>{
 let f=fresh(),creation='0x'+join(f);creation=replace(creation,0,'0xfe');update(f,creation.slice(2));await rejected(setup(f).input,/unknown maintained collection creation code/);
 f=fresh();f.creationHash='0x'+'ab'.repeat(32);await rejected(setup(f).input,/carriers/);
});
test('declared link masks cannot hide changed surrounding bytes or inconsistent library addresses',async()=>{
 let f=fresh(),creation='0x'+join(f);creation=replace(creation,20381,'0x'+'11'.repeat(20));update(f,creation.slice(2));await rejected(setup(f).input,/unknown maintained collection creation code/);
 f=fresh();creation=replace('0x'+join(f),records.creationProfile.libraryStarts[0],'0x'+'22'.repeat(20));update(f,creation.slice(2));await rejected(setup(f).input,/inconsistent metadata library links/);
});
test('new known template still requires complete actual library bytes and all immutable values',async()=>{
 for(const changed of ['library','factory','deployer']){
  const f=fresh(),key=f[changed].toLowerCase(),offset=changed==='factory'?3848:changed==='deployer'?941:0;
  f.codeByAddress[key]=replace(f.codeByAddress[key],offset,changed==='library'?'0xfe':'0x'+'01'.repeat(32));
  await rejected(setup(f).input,/library runtime|immutable mismatch|length or digest mismatch/);
 }
});
test('unknown current factory code never reaches its getter',async()=>{
 const f=fresh();f.codeByAddress[f.factory.toLowerCase()]='0x6000';const {input,requests}=setup(f);await rejected(input,/unknown factory runtime/);assert.equal(requests.filter(v=>v.kind==='call').length,0);
});
test('new template preserves provider-chain, pin and caller-cancellation fences',async()=>{
 await rejected(setup(fresh(),{chainId:1}).input,/provider chain/);await rejected(setup(fresh(),{reorg:true}).input,/pinned block/);
 const signal=new AbortController();const {input,requests}=setup(fresh(),{signal:signal.signal,onRead:rows=>{if(rows.length===3)signal.abort();}});
 await assert.rejects(qualifyKeelRouted721Factory(input),{name:'AbortError'});assert.equal(requests.length,3);
});
