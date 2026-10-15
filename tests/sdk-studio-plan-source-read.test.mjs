import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {encodeAbiParameters} from 'viem';
import {prepareKeelCreatorInline, readKeelPreparedInlineSources, decodeKeelPreparedDenseCopyFragment, buildKeelPreparedDenseCopyShell, buildKeelOnchainContainerBinding, encodeKeelDenseTransport, serializeKeelDenseTransportJSON} from '../packages/sdk/dist/index.js';

const store='0x'+ '11'.repeat(20);
const poster={mediaType:'image/png',bytes:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1sAAAAASUVORK5CYII=','base64')};
const resources=[
 {id:'index.html',role:'entrypoint',mediaType:'text/html',aliases:['./index.html'],bytes:Buffer.from('<!doctype html><script src="./game.js"></script>'+ '<!-- exact🔥%# -->'.repeat(300))},
 {id:'game.js',role:'module',mediaType:'text/javascript',aliases:['./game.js'],bytes:Buffer.from('globalThis.exactGame="🔥%#";'.repeat(300))},
 {id:'assets/data.bin',role:'asset',mediaType:'application/octet-stream',aliases:['./assets/data.bin'],bytes:Buffer.from(Array.from({length:256},(_,i)=>i))},
];
const html=plan=>Buffer.concat([plan.shell.prefix,...plan.objects.slice(0,plan.request.bodyObjectIds.length),plan.shell.suffix].map(o=>Buffer.from(decodeKeelPreparedDenseCopyFragment(o.bytes))));

test('ordinary modular paths reach the production byte reader with exact source, codecs and independent IDs',async()=>{
 for(const compression of ['auto','none']){
  const plan=await prepareKeelCreatorInline({chainId:31337,store,resources,poster,compression});
  const read=await readKeelPreparedInlineSources({htmlBytes:html(plan),chainId:31337,store:plan.store,tableDigest:plan.table.digest});
  assert.equal(read.resources.length,resources.length);
  for(const [i,r] of read.resources.entries()){
   assert.equal(r.id,resources[i].id);assert.deepEqual(Buffer.from(r.bytes),resources[i].bytes);
   assert.deepEqual(r.aliases,resources[i].aliases);assert.equal(r.integrity.digest,plan.resources[i].sourceIntegrity.digest);
   assert.equal(r.compression,plan.resources[i].compression);
  }
  assert.equal(read.decodedSourceBytes,resources.reduce((n,r)=>n+r.bytes.length,0));
  assert.equal(read.browserVerified,false);assert.equal(read.selectedChainBindingVerified,false);
  assert.equal(read.onchainStorage.status,'not-inspected');
  await assert.rejects(readKeelPreparedInlineSources({htmlBytes:html(plan),chainId:31337,store:plan.store,tableDigest:plan.table.digest,maximumDecodedSourceBytes:resources[0].bytes.length}),/intake byte budget/);
 }
});

test('unsupported identities, alias collisions, Raw and creator-owned shell choices fail before claiming preparation',async()=>{
 for(const bad of [
  [{...resources[0],id:'unsupported:entry'}],
  [resources[0],{...resources[1],aliases:['./index.html']}],
  [resources[0],{...resources[1],aliases:['index.html']}],
  [resources[0],{...resources[1],aliases:['./bad\u0000name']}],
 ])await assert.rejects(prepareKeelCreatorInline({chainId:31337,store,resources:bad,poster}));
 await assert.rejects(prepareKeelCreatorInline({chainId:31337,store,resources,poster,payloadStorage:'raw'}),/Raw|raw/);
 await assert.rejects(prepareKeelCreatorInline({chainId:31337,store,resources,poster,viewer:'none'}),/shell|viewer/);
});

test('identical bytes share one physical pack and table row while logical IDs, aliases and member copies stay independent',async()=>{
 const first={id:'one.bin',role:'asset',mediaType:'application/octet-stream',aliases:['./one.bin'],bytes:resources[2].bytes};
 const second={...first,id:'two.bin',aliases:['./two.bin']};
 const plan=await prepareKeelCreatorInline({chainId:31337,store,resources:[resources[0],first,second],poster});
 assert.equal(plan.resources.length,3);assert.equal(plan.optimization.physicalPayloadCount,2);assert.equal(plan.optimization.sharedLogicalResourceCount,1);
 assert.equal(plan.resources[1].carrier.objectId,plan.resources[2].carrier.objectId);
 assert.equal(plan.objects.filter(object=>object.objectId===plan.resources[1].carrier.objectId).length,1);
 assert.equal(plan.table.bytes.length,64+128*2);assert.equal(plan.request.bodyObjectIds.length,6);
 assert.equal(plan.resources.flatMap(resource=>resource.descriptor.containerBindings).length,2);
 const read=await readKeelPreparedInlineSources({htmlBytes:html(plan),chainId:31337,store:plan.store,tableDigest:plan.table.digest});
 assert.deepEqual(read.resources.map(resource=>resource.id),['index.html','one.bin','two.bin']);
 assert.deepEqual(read.resources[1].aliases,['./one.bin']);assert.deepEqual(read.resources[2].aliases,['./two.bin']);
 assert.deepEqual(Buffer.from(read.resources[1].bytes),first.bytes);assert.deepEqual(Buffer.from(read.resources[2].bytes),second.bytes);
 assert.equal(read.reader.payloads,2);assert.equal(read.reader.decodeCount,2);
 read.resources[1].bytes.fill(0);assert.deepEqual(Buffer.from(read.resources[2].bytes),second.bytes);
 assert.equal(plan.newStoredBytes,plan.objects.reduce((sum,object)=>sum+object.newBytes,0));
});

test('table, stored, decoded and member faults cannot pass a prepared source import',async()=>{
 const plan=await prepareKeelCreatorInline({chainId:31337,store,resources,poster});
 const read=(htmlBytes,tableDigest=plan.table.digest)=>readKeelPreparedInlineSources({htmlBytes,chainId:31337,store:plan.store,tableDigest});
 await assert.rejects(read(html(plan),'0x'+'ff'.repeat(32)),/packtable|mismatch/);
 const source=html(plan).toString('utf8');
 const pack=plan.resources[0].pack;
 const changed=pack.storedDense[0]==='A'?'B':'A';
 await assert.rejects(read(Buffer.from(source.replace(pack.storedDense,changed+pack.storedDense.slice(1)))),/commitment|mismatch/);
 const decodedHash=plan.resources[0].sourceIntegrity.digest;
 await assert.rejects(read(Buffer.from(source.replaceAll(decodedHash,'0x'+'ef'.repeat(32)))),/binding|mismatch/);
 const itemLength='"byteLength":'+plan.resources[0].sourceIntegrity.byteLength;
 await assert.rejects(read(Buffer.from(source.replace(itemLength,'"byteLength":'+(plan.resources[0].sourceIntegrity.byteLength+1)))),/binding|mismatch|length|exceeds/);
 await assert.rejects(readKeelPreparedInlineSources({htmlBytes:html(plan),chainId:31337,store:'0x'+'22'.repeat(20),tableDigest:plan.table.digest}),/binding|chain|selected/);
});

test('fresh descriptors order static imports, side effects and re-exports for the unchanged registered loader',async()=>{
 const modular=[resources[0],
  {id:'main.js',aliases:['./main.js'],role:'module',mediaType:'text/javascript',bytes:Buffer.from('import {answer} from "./exports.js";import "./side.js";globalThis.result=answer;')},
  {id:'exports.js',aliases:['./exports.js'],role:'module',mediaType:'text/javascript',bytes:Buffer.from('export {answer} from "./leaf.js";')},
  {id:'side.js',aliases:['./side.js'],role:'module',mediaType:'text/javascript',bytes:Buffer.from('globalThis.sideReady=true;')},
  {id:'leaf.js',aliases:['./leaf.js'],role:'module',mediaType:'text/javascript',bytes:Buffer.from('export const answer=42;')},
 ];
 const plan=await prepareKeelCreatorInline({chainId:31337,store,resources:modular,poster});
 assert.deepEqual(plan.resources.map(resource=>resource.id),modular.map(resource=>resource.id));
 assert.deepEqual(plan.playbackModuleOrder,['leaf.js','exports.js','side.js','main.js']);
 const read=await readKeelPreparedInlineSources({htmlBytes:html(plan),chainId:31337,store:plan.store,tableDigest:plan.table.digest});
 assert.deepEqual(read.resources.map(resource=>resource.id),['index.html','leaf.js','exports.js','side.js','main.js']);
 for(const resource of read.resources)assert.deepEqual(Buffer.from(resource.bytes),modular.find(source=>source.id===resource.id).bytes);
});

test('cyclic and undeclared fresh imports stop before producing or inspecting storage objects',async()=>{
 for(const modules of [
  [{id:'one.js',bytes:Buffer.from('import {two} from "./two.js";export const one=two;')},{id:'two.js',bytes:Buffer.from('import {one} from "./one.js";export const two=one;')}],
  [{id:'one.js',bytes:Buffer.from('import {missing} from "./absent.js";')}],
 ]){
  let objectReads=0;
  await assert.rejects(prepareKeelCreatorInline({chainId:31337,store,resources:[resources[0],...modules.map(module=>({...module,role:'module',mediaType:'text/javascript'}))],poster,readSlug:async()=>{objectReads++;return null;}}),/Cyclic|Undeclared/);
  assert.equal(objectReads,0);
 }
});

test('a suspended storage read cannot change original Buffer-backed creator sources',async()=>{
 const original=Buffer.from('globalThis.original=42;');
 const supplied=Buffer.from(original);
 let enter,release,first=true;
 const entered=new Promise(resolve=>{enter=resolve;});
 const held=new Promise(resolve=>{release=resolve;});
 const pending=prepareKeelCreatorInline({chainId:31337,store,resources:[resources[0],{id:'game.js',role:'module',mediaType:'text/javascript',bytes:supplied}],poster,
  readSlug:async()=>{if(first){first=false;enter();await held;}return null;}});
 await entered;
 supplied.write('globalThis.original=77;');release();
 const plan=await pending;
 const read=await readKeelPreparedInlineSources({htmlBytes:html(plan),chainId:31337,store:plan.store,tableDigest:plan.table.digest});
 assert.deepEqual(Buffer.from(read.resources.find(resource=>resource.id==='game.js').bytes),original);
});

test('metadata and alias mutation while storage awaits cannot change the selected chain, poster or preparation policy',async()=>{
 const aliases=['./game.js'],originalPoster=Buffer.from(poster.bytes);
 let enter,release,first=true;
 const entered=new Promise(resolve=>{enter=resolve;}),held=new Promise(resolve=>{release=resolve;});
 const input={chainId:31337,store,description:'Original terms',compression:'none',resources:[resources[0],{...resources[1],aliases}],poster:{mediaType:poster.mediaType,bytes:Buffer.from(originalPoster)},
  readSlug:async()=>{if(first){first=false;enter();await held;}return null;}};
 const pending=prepareKeelCreatorInline(input);await entered;
 input.chainId=1;input.compression='brotli';input.description='Changed terms';aliases[0]='./changed.js';input.poster.bytes.fill(0);input.poster.mediaType='image/gif';release();
 const plan=await pending;
 assert.equal(plan.chainId,31337);assert.equal(plan.request.description,'Original terms');
 assert.deepEqual(plan.resources[1].descriptor.aliases,['./game.js']);
 assert.ok(plan.resources.every(resource=>resource.compression==='none'));
 assert.equal(plan.posterURI,'data:image/png;base64,'+originalPoster.toString('base64'));
 const read=await readKeelPreparedInlineSources({htmlBytes:html(plan),chainId:31337,store:plan.store,tableDigest:plan.table.digest});
 assert.deepEqual(Buffer.from(read.resources[1].bytes),resources[1].bytes);
});

test('explicit URI81 LZMA and PPMd imports replay exact bytes without changing their declared transport',async()=>{
 const digest=bytes=>'0x'+createHash('sha256').update(bytes).digest('hex');
 const entry=Buffer.from('<!doctype html><p>Optional codec fixture</p>');
 const binary=Buffer.from(Array.from({length:256*1024},(_,i)=>i&255));
 for(const codec of ['lzma','ppmd']){
  const packed=codec==='lzma'?execFileSync('xz',['--format=lzma','--stdout','--lzma1=dict=4MiB'],{input:binary}):await readFile(new URL('./fixtures/ppmd/byte-ramp.k7',import.meta.url));
  const shell=await buildKeelPreparedDenseCopyShell({codecProfile:codec+'-js',binaryPayloadCarriage:'uri81',embeddedContainerDelivery:{chainId:31337,store}});
  const files=[{id:'index.html',role:'entrypoint',mediaType:'text/html',bytes:entry,stored:entry,compression:'none'},{id:'data.bin',role:'asset',mediaType:'application/octet-stream',bytes:binary,stored:packed,compression:codec}];
  const packs=[],items=[],rows=[];
  for(const [i,file]of files.entries()){
   const objectId='0x'+(i+1).toString(16).padStart(64,'0');
   const binding=await buildKeelOnchainContainerBinding({chainId:31337,store,objectId,compression:file.compression,bytes:file.bytes,storedBytes:file.stored});
   packs.push({containerId:binding.id,objectId,storedIntegrity:binding.storedIntegrity,storedDense:encodeKeelDenseTransport(file.stored,'uri81-block-v1')});
   items.push({id:file.id,aliases:['./'+file.id],role:file.role,mediaType:file.mediaType,integrity:binding.integrity,onchain:{containerId:binding.id,offset:0},containerBindings:[binding]});
   rows.push({byteLength:BigInt(file.stored.length),digest:digest(file.stored),objectId,containerId:binding.id});
  }
  const table=encodeAbiParameters([{type:'tuple[]',components:[{name:'byteLength',type:'uint256'},{name:'digest',type:'bytes32'},{name:'objectId',type:'bytes32'},{name:'containerId',type:'bytes32'}]}],[rows]);
  const document=Buffer.from(Buffer.from(shell.prefix).toString()+packs.map(serializeKeelDenseTransportJSON).join(',')+Buffer.from(shell.containerBridge).toString()+','+items.map(serializeKeelDenseTransportJSON).join(',')+Buffer.from(shell.suffix).toString());
  const read=await readKeelPreparedInlineSources({htmlBytes:document,chainId:31337,store,tableDigest:digest(Buffer.from(table.slice(2),'hex'))});
  assert.equal(read.transportProfile,'uri81-block-v1');assert.equal(read.resources[1].compression,codec);
  assert.deepEqual(Buffer.from(read.resources[0].bytes),entry);assert.deepEqual(Buffer.from(read.resources[1].bytes),binary);
  assert.equal(read.selectedChainBindingVerified,false);assert.equal(read.browserVerified,false);
 }
});
