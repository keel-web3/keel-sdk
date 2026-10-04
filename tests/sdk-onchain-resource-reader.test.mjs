import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createKeelOnchainResourceReader,decodeKeelBinaryObjectRecord,decodeKeelBinaryPointers} from '../packages/sdk/dist/onchain-resource-reader.js';
const req=createRequire(import.meta.url);
const {encodeAbiParameters,parseAbiParameters}=req('viem');
const store='0x'+'11'.repeat(20),builder='0x'+'22'.repeat(20),carrier='0x'+'33'.repeat(20),object='0x'+'44'.repeat(32),block='0x'+'55'.repeat(32);
const storeCode=Buffer.from([1,2,3]),builderCode=Buffer.from([4,5,6]);
const commit=b=>({algorithm:'sha256',digest:'0x'+createHash('sha256').update(b).digest('hex'),byteLength:b.length});
const tuple=parseAbiParameters('(bytes32 digest,bytes32 indexDigest,address descriptorPointer,uint64 byteLength,uint64 storedByteLength,uint32 slugCount,uint8 compression,bool composite,bool exists,string mediaType)');
const raw=Buffer.from('water 🌊\0fire 🔥\nкорабль');const stored=gzipSync(raw);
const record=(change={})=>encodeAbiParameters(tuple,[{digest:commit(stored).digest,indexDigest:'0x'+'00'.repeat(32),descriptorPointer:carrier,byteLength:BigInt(stored.length),storedByteLength:BigInt(stored.length),slugCount:1,compression:0,composite:false,exists:true,mediaType:'application/octet-stream',...change}]);
const pointers=encodeAbiParameters(parseAbiParameters('address[]'),[[carrier]]);
const baseItem={id:'test',chainId:31337,store,objectId:object,integrity:commit(raw),onchain:{storeKind:'keel-hold',compression:'gzip',storedIntegrity:commit(stored)}};
const verify=async(b,c)=>{assert.equal(b.length,c.byteLength,'length commitment');assert.equal(commit(b).digest,c.digest,'SHA commitment');return b};
function fixture(t,{override,urls=['http://localhost:8545'],containers}={}){
 const prior=globalThis.fetch,log=[];t.after(()=>globalThis.fetch=prior);
 globalThis.fetch=async(url,opts)=>{
  const q=JSON.parse(opts.body);log.push({url,method:q.method,params:q.params});let result;
  if(override){const got=await override({url,q,log});if(got!==undefined)return got instanceof Response?got:Response.json({jsonrpc:'2.0',id:q.id,result:got});}
  if(q.method==='eth_chainId')result='0x7a69';
  else if(q.method==='eth_getBlockByNumber'||q.method==='eth_getBlockByHash')result={hash:block,number:'0x1'};
  else if(q.method==='eth_getCode')result=q.params[0]===store?'0x'+storeCode.toString('hex'):q.params[0]===builder?'0x'+builderCode.toString('hex'):'0x00'+stored.toString('hex');
  else if(q.method==='eth_call'){
   assert.deepEqual(q.params[1],{blockHash:block,requireCanonical:true});const selector=q.params[0].data.slice(0,10);
   if(selector==='0x54c1823e')result='0x'+'0'.repeat(24)+store.slice(2);
   else if(selector==='0x2660fd5c'||selector==='0x0646e2be')result='0x'+'0'.repeat(63)+'1';
   else if(selector==='0x05144857')result=record();
   else if(selector==='0x144658f2')result=pointers;
   else throw Error('unknown selector');
  }else throw Error('unknown method');
  return Response.json({jsonrpc:'2.0',id:q.id,result});
 };
 const reader=createKeelOnchainResourceReader({chainId:31337,store,builder,storeCodeIntegrity:commit(storeCode),builderCodeIntegrity:commit(builderCode),rpcUrls:urls,containers,verify,decompress:async(c,b,len)=>{assert.equal(c,'gzip');const out=gunzipSync(b,{maxOutputLength:len});assert.equal(out.length,len);return out}});
 return {reader,log};
}
test('actual Unicode/binary bytes, concurrent cache and independent output memory',async t=>{
 const {reader,log}=fixture(t);const [a,b]=await Promise.all([reader.resolve(baseItem),reader.resolve(baseItem)]);assert.deepEqual(Buffer.from(a),raw);assert.deepEqual(Buffer.from(b),raw);a.fill(0);assert.deepEqual(Buffer.from(b),raw);assert.deepEqual(Buffer.from(await reader.resolve(baseItem)),raw);
 assert.equal(log.filter(r=>r.method==='eth_getCode'&&r.params[0]===carrier).length,1);assert.equal((await reader.snapshot()).chainId,31337);
});
test('exact shared member ranges do not alias cache or adjacent members',async t=>{
 const {reader}=fixture(t);const off=6,len=9,item={...baseItem,integrity:commit(raw.subarray(off,off+len)),onchain:{...baseItem.onchain,range:{offset:off,containerIntegrity:commit(raw)}}};
 const member=await reader.resolve(item);assert.deepEqual(Buffer.from(member),raw.subarray(off,off+len));member.fill(0);assert.deepEqual(Buffer.from(await reader.resolve(baseItem)),raw);
 await assert.rejects(reader.resolve({...item,onchain:{...item.onchain,range:{offset:raw.length,containerIntegrity:commit(raw)}}}),/exceeds/);
});
test('wrong code, builder binding, registration and sealing each fail before carrier bytes',async t=>{
 for(const kind of ['code','builder','registration','seal'])await t.test(kind,async t=>{
  const {reader,log}=fixture(t,{override:({q})=>{
   if(kind==='code'&&q.method==='eth_getCode'&&q.params[0]===store)return'0x01';
   if(q.method==='eth_call'){
    const s=q.params[0].data.slice(0,10);
    if(kind==='builder'&&s==='0x54c1823e')return'0x'+'0'.repeat(24)+builder.slice(2);
    if((kind==='registration'&&s==='0x2660fd5c')||(kind==='seal'&&s==='0x0646e2be'))return'0x'+'0'.repeat(64);
   }
  }});await assert.rejects(reader.resolve(baseItem));assert.equal(log.filter(q=>q.method==='eth_getCode'&&q.params[0]===carrier).length,0);
 });
});
test('canonical ABI records/pointers reject offsets, length, padding, media and stubs',()=>{
 assert.equal(decodeKeelBinaryObjectRecord(record(),commit(stored)).count,1);
 for(const change of [{byteLength:1n},{storedByteLength:1n},{compression:1},{composite:true},{exists:false},{slugCount:0},{slugCount:1025},{mediaType:'A'.repeat(257)},{mediaType:''},{mediaType:'text/javascript'}])assert.throws(()=>decodeKeelBinaryObjectRecord(record(change),commit(stored)));
 const badMedia=Buffer.from(record().slice(2),'hex');badMedia[384]=255;assert.throws(()=>decodeKeelBinaryObjectRecord('0x'+badMedia.toString('hex'),commit(stored)));
 assert.throws(()=>decodeKeelBinaryObjectRecord(record({byteLength:0n,storedByteLength:0n}),commit(Buffer.alloc(0))));
 assert.throws(()=>decodeKeelBinaryObjectRecord(record().slice(0,-2),commit(stored)));
 assert.throws(()=>decodeKeelBinaryObjectRecord('0x'+record().slice(2)+'00',commit(stored)));
 assert.throws(()=>decodeKeelBinaryObjectRecord('0x'+'0'.repeat(63)+'1'+record().slice(66),commit(stored)));
 const p=Buffer.from(pointers.slice(2),'hex');p[64]=1;assert.throws(()=>decodeKeelBinaryPointers('0x'+p.toString('hex'),1));
 assert.throws(()=>decodeKeelBinaryPointers(pointers,2));assert.throws(()=>decodeKeelBinaryPointers(pointers+'00',1));
 assert.throws(()=>decodeKeelBinaryPointers(encodeAbiParameters(parseAbiParameters('address[]'),[['0x'+'00'.repeat(20)]]),1));
});
test('oversized or truncated JSON-RPC response is rejected within response bound',async t=>{
 for(const response of ['{',' '.repeat(2200)])await t.test(String(response.length),async t=>{const{reader}=fixture(t,{override:()=>new Response(response)});await assert.rejects(reader.resolve(baseItem));});
});
test('failed concurrent cache shares rejection and never re-reads object',async t=>{
 const {reader,log}=fixture(t,{override:({q})=>q.method==='eth_call'&&q.params[0].data.startsWith('0x05144857')?record({digest:'0x'+'77'.repeat(32)}):undefined});
 const result=await Promise.allSettled([reader.resolve(baseItem),reader.resolve(baseItem)]);assert.ok(result.every(r=>r.status==='rejected'));await assert.rejects(reader.resolve(baseItem));assert.equal(log.filter(q=>q.method==='eth_call'&&q.params[0].data.startsWith('0x05144857')).length,1);
});
test('fallback endpoint must prove exact chain and same canonical block',async t=>{
 for(const fail of ['chain','block','none'])await t.test(fail,async t=>{
  const {reader,log}=fixture(t,{urls:['http://localhost:8545','http://127.0.0.1:8546'],override:({url,q})=>{
   if(url.includes('localhost')&&q.method==='eth_getCode')return new Response('offline',{status:503});
   if(url.includes('127.0.0.1')&&fail==='chain'&&q.method==='eth_chainId')return'0x1';
   if(url.includes('127.0.0.1')&&fail==='block'&&q.method==='eth_getBlockByNumber')return{hash:'0x'+'99'.repeat(32),number:'0x1'};
  }});
  if(fail==='none')assert.deepEqual(Buffer.from(await reader.resolve(baseItem)),raw);else await assert.rejects(reader.resolve(baseItem),/fallback RPC/);
  if(fail!=='none')assert.equal(log.filter(q=>q.url.includes('127.0.0.1')&&q.method==='eth_getCode').length,0);
 });
});
test('stable container refs reject conflicting table and stay immutable after construction',async t=>{
 const fields={chainId:31337,compression:'gzip',integrity:{algorithm:'sha256',byteLength:raw.length,digest:commit(raw).digest},objectId:object,store,storedIntegrity:{algorithm:'sha256',byteLength:stored.length,digest:commit(stored).digest}};
 const binding={id:commit(Buffer.from(JSON.stringify(fields))).digest,...fields};
 const {reader}=fixture(t,{containers:[binding]});binding.integrity.byteLength=1;binding.store=builder;
 const ref={id:'ref',integrity:commit(raw),onchain:{containerId:binding.id,offset:0}};
 assert.deepEqual(Buffer.from(await reader.resolve(ref)),raw);
 await assert.rejects(reader.resolve({...ref,onchain:{containerId:'0x'+'77'.repeat(32),offset:0}}),/Unknown/);
 await assert.rejects(reader.resolve({...ref,store,onchain:{...ref.onchain,compression:'gzip'}}),/Ambiguous/);
 assert.throws(()=>fixture(t,{containers:[binding,binding]}),/conflicting/);
 assert.throws(()=>fixture(t,{containers:[{...binding,store,compression:'custom'}]}),/conflicting/);
});
test('wrong container content-ID fails before any chain transport',async t=>{
 const binding={id:'0x'+'66'.repeat(32),chainId:31337,store,objectId:object,compression:'gzip',storedIntegrity:commit(stored),integrity:commit(raw)};
 const {reader,log}=fixture(t,{containers:[binding]});await assert.rejects(reader.resolve({id:'ref',integrity:commit(raw),onchain:{containerId:binding.id,offset:0}}),/SHA commitment/);assert.equal(log.length,0);
});

test('zero resource/code commitments reject before binary transport',async t=>{
 const {reader,log}=fixture(t);
 await assert.rejects(reader.resolve({...baseItem,integrity:commit(Buffer.alloc(0))}),/Empty/);
 await assert.rejects(reader.resolve({...baseItem,onchain:{...baseItem.onchain,storedIntegrity:commit(Buffer.alloc(0))}}),/Empty/);
 assert.equal(log.length,0);
 assert.throws(()=>createKeelOnchainResourceReader({chainId:31337,store,builder,storeCodeIntegrity:commit(Buffer.alloc(0)),builderCodeIntegrity:commit(builderCode),rpcUrls:['http://localhost:8545'],verify,decompress:async()=>raw}),/empty/);
});
