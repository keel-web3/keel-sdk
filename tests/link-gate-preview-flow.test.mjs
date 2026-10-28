import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {gzipSync,brotliCompressSync,deflateRawSync} from 'node:zlib';
import {encodeFunctionData,parseAbi} from 'viem';
import {assertKeelLinkGate,scanKeelLinkGate,KeelLinkGateRefusal} from '../packages/sdk/dist/link-gate.js';
import {prepareKeelExplicitExternalPreview} from '../packages/sdk/dist/external-preview.js';
import {createKeelWalletRequest,encodeKeelWalletRequestQr,decodeKeelWalletRequestQr} from '../packages/sdk/dist/wallet-request.js';
import {createUploadPlan,createRecursiveUploadPlan} from '../packages/builder/dist/index.js';
import {prepareStudioArtifact} from '../packages/studio-core/dist/prepare.js';
import {buildKeelStorageGraph} from '../packages/studio-core/dist/keel-hold.js';
import {createMcpServer} from '../packages/mcp/dist/server.js';
import {build} from 'esbuild';
import {launchCspBrowser} from './helpers/marketplace-csp-browser.mjs';

const utf8=s=>Buffer.from(s), digest=b=>'0x'+createHash('sha256').update(b).digest('hex');
const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYGJAQoAHxcCAk+Uzr4AAAAASUVORK5CYII=','base64');
const proof=uri=>prepareKeelExplicitExternalPreview({uri,mediaType:'image/png',sourceBytes:image,expectedSourceIntegrity:{algorithm:'sha256',digest:digest(image),byteLength:image.length}});
const token=uri=>utf8('data:application/json,'+encodeURIComponent(JSON.stringify({name:'Exact original',image:uri})));
const scan=(bytes,externalPreviews)=>scanKeelLinkGate({route:'test',resources:[{id:'metadata',bytes}],externalPreviews});

test('a browser without Node codecs accepts plain calldata and PNG but blocks recognized gzip',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'keel-preview-browser-'));
  try {
    const calldata=[0xa9,0x05,0x9c,0xbb,...Array(64).fill(0)],source=utf8('fetch("https://hidden.invalid/script.js")'),packed=[...gzipSync(source)];
    const declared=[...utf8(JSON.stringify({embedded:{compression:'brotli',storedBase64:brotliCompressSync(source).toString('base64')}}))];
    const entry=`import {scanKeelLinkGate} from ${JSON.stringify(new URL('../packages/sdk/dist/link-gate.js',import.meta.url).pathname)};
      const scan=bytes=>scanKeelLinkGate({route:'browser-regression',resources:[{id:'bytes',bytes:new Uint8Array(bytes)}]});
      const results=[scan(${JSON.stringify(calldata)}),scan(${JSON.stringify([...image])}),scan(${JSON.stringify(packed)}),scan(${JSON.stringify(declared)})];
      document.body.textContent=JSON.stringify({node:typeof globalThis.process,statuses:results.map(r=>r.status),coverage:results.map(r=>r.coverage)});`;
    const bundled=await build({stdin:{contents:entry,resolveDir:process.cwd(),sourcefile:'browser-preview-regression.js'},bundle:true,platform:'browser',format:'iife',write:false});
    const html='<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\';script-src \'unsafe-inline\'"><body><script>'+bundled.outputFiles[0].text.replaceAll('</script','<\\/script')+'</script>';
    // Serve only this generated in-memory fixture, as the application tests do.
    // No filesystem route or browser file-access policy is changed.
    const server=createServer((request,response)=>{if(request.url!=='/'){response.writeHead(404);response.end();return;}response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});response.end(html);});
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const url='http://127.0.0.1:'+server.address().port+'/';
    let browser,result;
    try {
      browser=await launchCspBrowser('/usr/bin/chromium',{fixtureMode:'byte-policy'});
      const errors=[];browser.on(({method,params})=>{if(method==='Runtime.exceptionThrown') errors.push(params.exceptionDetails.exception?.description??params.exceptionDetails.text);});
      const {targetId}=await browser.send('Target.createTarget',{url:'about:blank'});
      const {sessionId}=await browser.send('Target.attachToTarget',{targetId,flatten:true});
      await browser.send('Page.enable',{},sessionId);
      await browser.send('Runtime.enable',{},sessionId);
      const navigation=await browser.send('Page.navigate',{url},sessionId);assert.equal(navigation.errorText,undefined,JSON.stringify(navigation));
      let last;
      for(let attempt=0;attempt<100;attempt++) {
        const evaluated=await browser.send('Runtime.evaluate',{expression:'document.body.textContent',returnByValue:true},sessionId);
        last=evaluated;
        try {result=JSON.parse(evaluated.result.value);break;}catch{}
        await new Promise(resolve=>setTimeout(resolve,50));
      }
      browser.assertHealthy();assert.ok(result,'Browser did not return its byte-policy observation: '+JSON.stringify({errors,last}));
    } finally {try {await browser?.close();} finally {await new Promise(resolve=>server.close(resolve));}}
    assert.equal(result.node,'undefined');assert.deepEqual(result.statuses,['clear','clear','blocked','blocked']);
    assert.deepEqual(result.coverage[0].uninspected,[]);assert.deepEqual(result.coverage[1].uninspected,[]);
    assert.ok(result.coverage[2].uninspected.some(reason=>reason.includes('gzip: codecs unavailable')));
    assert.ok(result.coverage[3].uninspected.some(reason=>reason.includes('brotli')));
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('declared Brotli and raw-deflate slots are decoded even without magic headers',()=>{
  for(const [compression,compress] of [['brotli',brotliCompressSync],['deflate',deflateRawSync]]) {
    const source=utf8('fetch("https://hidden.invalid/script.js")');
    const bytes=utf8(JSON.stringify({embedded:{compression,storedBase64:compress(source).toString('base64')}}));
    const report=scan(bytes,[]);assert.equal(report.status,'blocked');assert.ok(report.hits.some(hit=>hit.url==='https://hidden.invalid/script.js'));
    const clean=utf8(JSON.stringify({embedded:{compression,storedBase64:compress(utf8('const clean=1;')).toString('base64')}}));
    assert.equal(scan(clean,[]).status,'clear');
  }
});

test('a preview commitment never exempts a longer URI, including encoded views',async()=>{
  for(const uri of ['https://preview.example/x.png','https://preview.example/art%20image.png?v=1']) {
    const preview=await proof(uri);
    assert.equal(scan(token(uri),[preview]).status,'clear');
    for(const suffix of ['.extra/script.js','/script.js','?other=1','#code','.',',',';',')']) {
      for(const bytes of [token(uri+suffix),utf8(JSON.stringify({image:uri+suffix})),gzipSync(token(uri+suffix))]) {
        const report=scan(bytes,[preview]);
        assert.equal(report.status,'blocked',uri+suffix);
        assert.ok(report.hitCount>0);
      }
    }
  }
});

test('recognized content beyond bounded inspection refuses before planning',()=>{
  let bytes=utf8('fetch("https://hidden.invalid/script.js")');
  for(let depth=1;depth<=8;depth++) {
    bytes=gzipSync(bytes);
    const report=scan(bytes,[]);
    assert.equal(report.status,'blocked');
    if(depth>=7) {
      assert.ok(report.coverage.uninspected.some(reason=>reason.includes('nesting bound')));
      assert.throws(()=>assertKeelLinkGate({route:'upload-plan',resources:[{id:'packed',bytes}]}),error=>error instanceof KeelLinkGateRefusal && error.code==='inspection-incomplete');
    }
  }
  assert.equal(scan(utf8('const original = 1;'),[]).status,'clear');
});

test('exact external image evidence survives flat/recursive upload, graph and wallet/QR gates',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'keel-preview-flow-'));
  try {
    for(const uri of ['https://preview.example/x.png','ipfs://bafybeigdyrzt/test.png']) {
      const preview=await proof(uri), bytes=token(uri), options={externalPreviews:[preview]};
      for(const [name,build] of [['flat',createUploadPlan],['recursive',createRecursiveUploadPlan]]) {
        const outputDirectory=path.join(directory,name,uri.startsWith('ipfs:')?'ipfs':'https');
        await assert.rejects(build(bytes,{objectName:'metadata',mediaType:'application/json',compression:'none',outputDirectory}),KeelLinkGateRefusal);
        const plan=await build(bytes,{objectName:'metadata',mediaType:'application/json',compression:'none',outputDirectory,...options});
        assert.equal(plan.integrity.digest,digest(bytes));
        await assert.rejects(build(token(uri+'.other'),{objectName:'changed',mediaType:'application/json',outputDirectory:outputDirectory+'-changed',...options}),KeelLinkGateRefusal);
      }
      const prepared=await prepareStudioArtifact({id:'preview-metadata',name:'Preview metadata',description:'Exact preview evidence',assets:[{fileName:'metadata.json',mediaType:'application/json',bytes,entrypoint:true}],compression:'none'});
      await assert.rejects(buildKeelStorageGraph(prepared),KeelLinkGateRefusal);
      await assert.doesNotReject(buildKeelStorageGraph(prepared,options));
      const data=encodeFunctionData({abi:parseAbi(['function castSlugs(bytes[] slugs)']),functionName:'castSlugs',args:[['0x'+bytes.toString('hex')]]});
      const request={protocol:'keel-wallet-request@1',requestId:'preview',label:'Exact preview',family:'ethereum',chainId:11155111,to:'0x'+'11'.repeat(20),data,valueWei:'0',gasLimit:'200000'};
      await assert.rejects(createKeelWalletRequest(request),KeelLinkGateRefusal);
      const envelope=await createKeelWalletRequest(request,options);
      assert.deepEqual(envelope.request,request);
      await assert.rejects(encodeKeelWalletRequestQr(envelope),KeelLinkGateRefusal);
      const qr=await encodeKeelWalletRequestQr(envelope,options);
      assert.deepEqual((await decodeKeelWalletRequestQr(qr)).request,request);
      const wrong=await proof(uri+'.other');
      const mutableOptions={externalPreviews:[wrong]}, rejected=encodeKeelWalletRequestQr(envelope,mutableOptions);
      mutableOptions.externalPreviews[0]=preview;
      await assert.rejects(rejected,KeelLinkGateRefusal);
      await assert.rejects(createKeelWalletRequest(request,{externalPreviews:[wrong]}),KeelLinkGateRefusal);
      await assert.rejects(createKeelWalletRequest(request,{externalPreviews:[{schema:preview.schema,uri}]}),/commitment|plain/u);
    }
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('local MCP protocol upload, chain plan and wallet preparation carry exact preview evidence',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'keel-preview-mcp-'));
  try {
    const preview=await proof('https://preview.example/x.png'),externalPreviews=[preview],bytes=token(preview.uri);
    await writeFile(path.join(directory,'metadata.json'),bytes);
    await createUploadPlan(bytes,{objectName:'metadata',mediaType:'application/json',compression:'none',outputDirectory:path.join(directory,'materialized'),externalPreviews});
    const server=await createMcpServer({workspaceRoot:directory,pluginConfig:false});
    await server.handle({jsonrpc:'2.0',id:0,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'preview-regression',version:'1'}}});
    let id=0;
    const call=(name,args)=>server.handle({jsonrpc:'2.0',id:++id,method:'tools/call',params:{name,arguments:args}});
    for(const strategy of ['flat','recursive']) {
      const result=await call('upload-plan',{input:'metadata.json',objectName:'preview-'+strategy,mediaType:'application/json',compression:'none',strategy,externalPreviews});
      assert.equal(result.result.isError,undefined,JSON.stringify(result));
      assert.equal(result.result.structuredContent.status,'planned');
    }
    const chain=await call('chain-plan',{plan:'materialized/upload-plan.json',family:'ethereum',chainId:11155111,target:'0x'+'11'.repeat(20),externalPreviews});
    assert.equal(chain.result.isError,undefined,JSON.stringify(chain));
    const data=encodeFunctionData({abi:parseAbi(['function castSlugs(bytes[] slugs)']),functionName:'castSlugs',args:[['0x'+bytes.toString('hex')]]});
    const request={protocol:'keel-wallet-request@1',requestId:'preview',label:'Exact preview',family:'ethereum',chainId:11155111,to:'0x'+'11'.repeat(20),data,valueWei:'0'};
    const wallet=await call('wallet-request-prepare',{request,gas:{limit:200000},qr:true,externalPreviews});
    assert.equal(wallet.result.isError,undefined,JSON.stringify(wallet));
    assert.equal(wallet.result.structuredContent.status,'prepared-only');
    const refused=await call('upload-plan',{input:'metadata.json',objectName:'wrong-preview',mediaType:'application/json',externalPreviews:[await proof(preview.uri+'.other')]});
    assert.equal(refused.result.isError,true);
    assert.equal(refused.result.structuredContent.code,'external-link-found');
  } finally {await rm(directory,{recursive:true,force:true});}
});
