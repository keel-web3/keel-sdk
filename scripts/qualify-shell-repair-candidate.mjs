import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { decodeFunctionData, encodeFunctionData, toHex } from 'viem';
import { buildKeelInlineShellFragments, buildKeelInlineLocalDocument, buildKeelInlinePreEncodedTokenURIGraph,
  buildKeelInlineRawPercentTokenURIGraph, buildKeelPreparedOneOfOneTokenURI, decodeKeelInlineGraphFragment } from '../packages/sdk/dist/inline-viewer-graph.js';

// Local file + Chromium qualification only. No RPC, wallet, signing or submission.
const [directory, siteRoot] = process.argv.slice(2).map(value => resolve(value));
if (!directory || !siteRoot) throw new Error('Supply candidate directory and maintained Site checkout.');
const sha = bytes => '0x'+createHash('sha256').update(bytes).digest('hex');
const report = JSON.parse(await readFile(resolve(directory,'candidate.json'),'utf8'));
const sourceSdkCommit = execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
assert.equal(report.sourceSdkCommit,sourceSdkCommit);
const sourceSiteCommit = execFileSync('git',['rev-parse','HEAD'],{cwd:siteRoot,encoding:'utf8'}).trim();
const abiDir = resolve(siteRoot,'apps/studio/public/docs/abi');
const abis = await Promise.all(['keel-harness/KeelHarnessBuilder.json','keel-harness/KeelRawTokenURIBuilder.json','keel-hold/KeelHold.json'].map(async name => {
  const bytes=await readFile(resolve(abiDir,name));return {name,sha256:sha(bytes),abi:JSON.parse(bytes.toString())};
}));
const decoded = decodeFunctionData({abi:abis[0].abi,data:report.registration.data});
assert.equal(decoded.functionName,'setShell');
assert.deepEqual(decoded.args,[report.shellId,report.objects[0].objectId,report.objects[1].objectId,2,report.objects[4].objectId]);
for(const object of report.objects) {
  const bytes=await readFile(resolve(directory,object.file));assert.equal(bytes.length,object.byteLength);assert.equal(sha(bytes),object.digest);
  assert.equal(decodeFunctionData({abi:abis[2].abi,data:object.weld.data}).functionName,'weldObject');
  for(const upload of object.candidateUploads) assert.equal(decodeFunctionData({abi:abis[2].abi,data:upload.data}).functionName,'castSlugs');
}
const metadata=JSON.parse(await readFile(resolve(directory,'shell-metadata.bin'),'utf8'));
assert.equal(metadata.version,'1.2.0');
const png=Buffer.from('89504e470d0a1a0a0000000d494844520000002000000010080600000077007d590000002b494441547801ecd0310d0000080341820b142210812083e59a74ff5c56cf7e3ee3790208102040800081030000ffffac8826e100000006494441540300324b46610c1980280000000049454e44ae426082','hex');
assert.equal(sha(png),'0x99ed562adddedc76e68a95987317fde599d637060940b13dabaac07313320f83');
const imageURI='data:image/png;base64,'+png.toString('base64');
const source=new TextEncoder().encode('<!doctype html><meta charset="utf-8"><title>Shell compatibility fixture</title><img id="owned" src="'+imageURI+'"><p>Water: 水 🐟</p><script>try{parent.document.getElementById("verify-seal").textContent="PWNED"}catch{}</script>');
const shell=await buildKeelInlineShellFragments();
const root=await buildKeelInlineLocalDocument({shell,modules:[],entry:{id:'shell-compatibility.html',mediaType:'text/html',source}});
const browserPackage=createRequire(resolve(siteRoot,'apps/studio/package.json'))('@playwright/test');
const browser=await browserPackage.chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const results=[];
const fixturePages=new Map();
const server=createServer((request,response)=>{const html=fixturePages.get(request.url);response.writeHead(html===undefined?404:200,{'content-type':'text/html; charset=utf-8'});response.end(html??'');});
server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;
try {
 for(const lane of ['registered','compact']) {
  const graph=await (lane==='registered'?buildKeelInlinePreEncodedTokenURIGraph(root,{legacyCarriage:'acknowledged'}):buildKeelInlineRawPercentTokenURIGraph(root));
  for(const side of ['prefix','suffix']) {
   const bytes=await readFile(resolve(directory,lane+'-'+side+'.bin'));
   assert.deepEqual(Buffer.from(graph.parts.find(part=>part.role==='shell-'+side).bytes),bytes,'Exact candidate shell fragments are used in the full URI');
  }
  const prepared=await buildKeelPreparedOneOfOneTokenURI({graph,chainId:report.chainId,collection:'0xabababababababababababababababababababab',collectionName:'Shell fixture',description:'Offline exact-pin qualification; no deployed collection',imageURI,
   manifestURI:'web3://'+report.store+':'+report.chainId+'/object/0x'+'12'.repeat(32),manifestDigest:'0x'+'12'.repeat(32),
   ...(lane==='registered'?{presentationPolicy:'raw-artifact'}:{})});
  // The legacy acknowledgement exercises compatibility only; fresh creator
  // Inline still uses the default compact lane. No creator intent is changed.
  const prefix=lane==='registered'?'data:application/json;base64,':'data:application/json;charset=utf-8,';
  const copied=prefix+Buffer.concat([prepared.encodedPrefix,graph.fragmentBytes,prepared.encodedSuffix]).toString();
  assert.equal(copied,prepared.tokenURI,'Complete COPY concatenation must match the SDK expected tokenURI');
  const token=JSON.parse(lane==='registered'?Buffer.from(copied.slice(prefix.length),'base64').toString():decodeURIComponent(copied.slice(prefix.length)));
  assert.equal(token.image,imageURI);assert.equal(sha(Buffer.from(token.image.split(',')[1],'base64')),sha(png));
  const animation=token.animation_url;
  const html=lane==='registered'?Buffer.from(animation.slice(animation.indexOf(',')+1),'base64').toString():decodeURIComponent(animation.slice(animation.indexOf(',')+1));
  // Base64 graph construction inserts defined whitespace at fragment boundaries.
  // Compare the exact decoded stored graph, not the unaligned local preview.
  assert.ok(html.startsWith(Buffer.from(decodeKeelInlineGraphFragment(graph.fragmentBytes,graph.mediaType)).toString()));
  const abi=abis[lane==='registered'?0:1].abi;
  const call=encodeFunctionData({abi,functionName:'preparedTokenURI',args:['0x'+'34'.repeat(32),sha(graph.fragmentBytes),toHex(prepared.encodedPrefix),toHex(prepared.encodedSuffix)]});
  assert.equal(decodeFunctionData({abi,data:call}).functionName,'preparedTokenURI');
  await writeFile(resolve(directory,lane+'-fixture.token-uri.txt'),copied);
  const page=await browser.newPage();const errors=[],remote=[];
  page.on('pageerror',error=>errors.push(error.message));
  fixturePages.set('/'+lane,html);
  await page.route(/^https?:\/\//,route=>{if(route.request().url()===origin+'/'+lane)return route.continue();remote.push(route.request().url());return route.abort();});
  try {
   await page.goto(origin+'/'+lane);
   await page.waitForFunction(()=>document.querySelector('[data-verification="verified"], [data-vault-verification="verified"]'));
   const frame=page.frames().find(frame=>frame.parentFrame()===page.mainFrame());assert.ok(frame,'Verified child artwork must mount');
   await frame.waitForFunction(()=>{const image=document.querySelector('#owned');return image?.complete&&image.naturalWidth===32&&image.naturalHeight===16;});
   assert.equal(await frame.locator('#owned').getAttribute('src'),imageURI);
   assert.match(await frame.locator('body').innerText(),/Water: 水 🐟/u);
   assert.ok(await page.locator('#verify-seal').count());assert.doesNotMatch(await page.locator('#verify-seal').innerText(),/PWNED/u);
   assert.doesNotMatch(await page.locator('iframe').first().getAttribute('sandbox'),/allow-same-origin/u);
   await page.waitForFunction(()=>document.querySelector('#keel-status')?.hidden===true);
   await page.screenshot({path:resolve(directory,lane+'-browser.png')});
   assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);
  } finally {await page.close();}
  // Corruption must fail before artwork mounts, on the same candidate shell.
  const corrupt=html.replace(/"digest":"0x[0-9a-f]{64}"/u,'"digest":"0x'+'00'.repeat(32)+'"');assert.notEqual(corrupt,html);
  const bad=await browser.newPage();
  fixturePages.set('/'+lane+'-corrupt',corrupt);
  await bad.route(/^https?:\/\//,route=>route.request().url()===origin+'/'+lane+'-corrupt'?route.continue():route.abort());
  try {await bad.goto(origin+'/'+lane+'-corrupt');
   await bad.waitForFunction(()=>document.querySelector('[data-verification="failed"], [data-vault-verification="failed"]'));
   assert.equal(await bad.locator('iframe').count(),0);
  } finally {await bad.close();}
  results.push({lane,requiredBuilder:prepared.requiredBuilder,tokenURIBytes:Buffer.byteLength(copied),tokenURIHash:sha(copied),animationHTMLBytes:Buffer.byteLength(html),imageBytes:png.length,imageSHA256:sha(png),copyAssembly:'exact-local-byte-concatenation',browser:'exact-decoded-document-on-localhost; verified-image-renders-protected-shell-no-external-network',directDataURINavigation:'unverified: blocked by environment Chromium administrator policy',tamper:'failed-no-artwork-frame',preparedTokenURISelector:call.slice(0,10),contractExecution:'not-performed'});
 }
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
const qualification={schema:'keel-shell-offline-qualification@1',sourceSdkCommit,sourceSiteCommit,generatorSha256:report.generatorSha256,qualifierSha256:sha(await readFile(new URL(import.meta.url))),objects:report.objects.map(({name,digest,byteLength})=>({name,digest,byteLength})),abis:abis.map(({name,sha256})=>({name,sha256})),registrationSelector:report.registration.data.slice(0,10),results,
 boundaries:['Synthetic collection/manifest/object identifiers: no actual collection is claimed.','Exact candidate fragments and operator-supplied public PNG fixture; not the complete actual saved project.','ABI compatibility and local COPY model are not deployed-runtime execution or live simulation.','Keeper/runtime/limits/fees/existing-object checks, exact transaction simulation and explicit approvals remain mandatory.'],transactions:0,signatures:0,livePublicationVerified:false};
await writeFile(resolve(directory,'offline-qualification.json'),JSON.stringify(qualification,null,2)+'\n');console.log(JSON.stringify(qualification,null,2));
