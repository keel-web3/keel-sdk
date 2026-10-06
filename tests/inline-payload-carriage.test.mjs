import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import path from 'node:path';
import {createIntegrity} from '../packages/protocol/dist/index.js';
import {buildEmbeddedKeelViewerSlot,buildKeelInlineShellFragments,buildKeelInlineLocalDocument,
  buildKeelInlineTokenURIGraph,inspectKeelInlinePayloadCarriage,assertKeelFreshPayloadCarriage,assertKeelFreshPayloadAudit,
  auditKeelInlineTokenURI,assertKeelPreparedCopyRead,buildKeelInlineImageURI,
  createKeelPublishReviewPlan,verifyKeelPublishReviewPlan,readKeelInlineTokenAudit} from '../packages/sdk/dist/index.js';
import {createMcpServer} from '../packages/mcp/dist/index.js';

const utf8=s=>new TextEncoder().encode(s);
const decode=b=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(b);
const image=buildKeelInlineImageURI(utf8('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="red"/></svg>'),'image/svg+xml');
const htmlFor=item=>`<!doctype html><script>globalThis.__KEEL_ITEMS__=[null,${JSON.stringify(item)}];</script>`;
const tokenFor=html=>'data:application/json;charset=utf-8,'+encodeURIComponent(JSON.stringify({name:'Exact art',image,animation_url:'data:text/html;charset=utf-8,'+encodeURIComponent(html)}));
const uriMedia='application/vnd.keel.token-uri-raw-percent-fragment';
const store='0x'+'11'.repeat(20),chainId=11155111;
const encodedItem=(encoding='base64')=>({id:'compressed.js',mediaType:'text/javascript',embedded:{compression:'gzip',
  [encoding==='base64'?'storedBase64':'storedHex']:gzipSync(utf8('globalThis.answer=42;')).toString(encoding)}});

test('fresh text is byte-identical through the stored slot, script JSON and both URI layers',async()=>{
  const source='\uFEFFglobalThis.answer="π 水 🐟";\r\n// % # ? & " \\ \u2028 </ScRiPt>';
  const built=await buildEmbeddedKeelViewerSlot({id:'exact.js',mediaType:'text/javascript',role:'module',bytes:utf8(source)});
  assert.equal(built.item.embedded.storedText,source);
  assert.equal(built.item.embedded.compression,'none');
  assert.equal(Object.hasOwn(built.item.embedded,'storedBase64'),false);
  assert.doesNotMatch(decode(built.fragment),/<\/script/iu);
  const replay=JSON.parse(decode(built.fragment).slice(1));
  assert.deepEqual(utf8(replay.embedded.storedText),utf8(source));
  const audit=await auditKeelInlineTokenURI(tokenFor(htmlFor(replay)));
  assert.equal(audit.completeDocumentBase64Layers,0);
  assert.equal(audit.freshPayloadPolicySatisfied,true);
  assert.equal(audit.carriage.packedPayloadBytes,utf8(source).length);
  assert.equal(audit.carriage.addedTextBytes,0);
  assert.equal(audit.browserVerified,false);
});

test('fresh canonical graph refuses hidden compressed Base64 body under raw-percent outer HTML',async()=>{
  const shell=await buildKeelInlineShellFragments();
  const plain=await buildKeelInlineLocalDocument({shell,modules:[],entry:{id:'entry',mediaType:'text/javascript',source:utf8('globalThis.answer=42;')}});
  const graph=await buildKeelInlineTokenURIGraph(plain);
  assert.equal(graph.mediaType,uriMedia);
  assert.equal(inspectKeelInlinePayloadCarriage(plain.rootBytes).requiresExistingPreparedReuse,false);
  const packed=await buildKeelInlineLocalDocument({shell,modules:[],entry:{id:'entry',mediaType:'text/javascript',source:utf8('globalThis.answer=42;'),compression:'gzip'}});
  await assert.rejects(buildKeelInlineTokenURIGraph(packed),/forbids new storedBase64\/storedHex/);
  await assert.rejects(buildKeelInlineTokenURIGraph(packed,{existingParts:[]}),/forbids new storedBase64\/storedHex/);
});

for(const encoding of ['base64','hex']) test(`audit measures ${encoding} inflation while fresh publication rejects it`,async()=>{
  const item=encodedItem(encoding),html=htmlFor(item),audit=await auditKeelInlineTokenURI(tokenFor(html));
  const packed=gzipSync(utf8('globalThis.answer=42;'));
  assert.equal(audit.completeDocumentBase64Layers,0);
  assert.equal(audit.freshPayloadPolicySatisfied,false);
  assert.equal(audit.carriage.packedPayloadBytes,packed.length);
  assert.equal(audit.carriage.payloadTextCarriageBytes,packed.toString(encoding).length);
  assert.equal(audit.carriage.addedTextBytes,packed.toString(encoding).length-packed.length);
  assert.throws(()=>assertKeelFreshPayloadCarriage(utf8(html)),/forbids new/);
  const graphBytes=utf8(encodeURIComponent(encodeURIComponent(html)));
  await assert.rejects(assertKeelPreparedCopyRead({chainId,store,mediaType:uriMedia,graphBytes,graphIntegrity:await createIntegrity(graphBytes),
    expectedTokenURI:tokenFor(html),returnedTokenURI:tokenFor(html),callGasLimit:30000000n,blockGasLimit:60000000n}),/forbids new/);
});

test('a compressed child cannot bypass the body policy by claiming to be an image',()=>{
  const item=encodedItem();item.mediaType='image/gif';item.embedded.compression='none';
  assert.throws(()=>inspectKeelInlinePayloadCarriage(utf8(htmlFor(item))),/GIF/);
});

test('actual direct image carriage retains original bytes',()=>{
  const gif=Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==','base64');
  const result=inspectKeelInlinePayloadCarriage(utf8(htmlFor({id:'art.gif',mediaType:'image/gif',embedded:{compression:'none',storedBase64:gif.toString('base64')}})));
  assert.equal(result.requiresExistingPreparedReuse,false);
  assert.equal(result.payloads[0].directImage,true);
  assert.equal(result.packedPayloadBytes,gif.length);
  assert.throws(()=>assertKeelFreshPayloadCarriage(utf8(htmlFor({id:'art.gif',mediaType:'image/gif',embedded:{compression:'none',storedHex:gif.toString('hex')}}))),/forbids new/);
  const svg=utf8('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  assert.throws(()=>assertKeelFreshPayloadCarriage(utf8(htmlFor({id:'art.svg',mediaType:'image/svg+xml',embedded:{compression:'none',storedBase64:Buffer.from(svg).toString('base64')}}))),/forbids new/);
});

test('audit rejects headers and URL delimiters that would make native decoding differ',async()=>{
  const good=tokenFor('<!doctype html><body>Exact</body>');
  const metadata=JSON.parse(decodeURIComponent(good.slice(good.indexOf(',')+1)));
  const custom=value=>'data:application/json;charset=utf-8,'+encodeURIComponent(JSON.stringify({...metadata,animation_url:value}));
  for(const bad of ['data:text/html; base64,PGgxPnRlc3Q8L2gxPg==','data:text/htmlx,Exact','data:text/html;charset=utf-8,Exact#lost'])
    await assert.rejects(auditKeelInlineTokenURI(custom(bad)),/header|canonical|fragment/);
  await assert.rejects(auditKeelInlineTokenURI(good.replace('application/json','application/jsonx')),/header/);
});

test('text byte corruption, conflicting representations and false compression fail',async()=>{
  await assert.rejects(buildEmbeddedKeelViewerSlot({id:'bad.js',mediaType:'text/javascript',bytes:Uint8Array.of(0xff),role:'module'}),/encoded data|UTF-8/);
  for(const embedded of [{storedText:'x',storedBase64:'eA==',compression:'none'},{storedText:'x',compression:'gzip'},{storedHex:'f',compression:'none'}])
    assert.throws(()=>inspectKeelInlinePayloadCarriage(utf8(htmlFor({id:'bad',mediaType:'text/javascript',embedded}))),/exactly one|compression none|Malformed/);
});

test('serialized fresh-plan audit derives representation policy and totals instead of trusting flags',()=>{
  const audit=inspectKeelInlinePayloadCarriage(utf8(htmlFor({id:'entry',mediaType:'text/javascript',embedded:{compression:'none',storedText:'exact'}})));
  assert.doesNotThrow(()=>assertKeelFreshPayloadAudit(audit));
  const base64=structuredClone(audit);base64.payloads[0].encoding='base64';
  assert.throws(()=>assertKeelFreshPayloadAudit(base64),/newly encoded body/);
  const inconsistent=structuredClone(audit);inconsistent.packedPayloadBytes++;
  assert.throws(()=>assertKeelFreshPayloadAudit(inconsistent),/totals disagree/);
  const unknown=structuredClone(audit);unknown.bypass=true;
  assert.throws(()=>assertKeelFreshPayloadAudit(unknown),/Invalid fresh/);
});

function abi(text){const b=Buffer.from(text);return '0x'+(32n).toString(16).padStart(64,'0')+BigInt(b.length).toString(16).padStart(64,'0')+b.toString('hex').padEnd(Math.ceil(b.length/32)*64,'0');}
function fakeRPC(tokenURI,alter=()=>undefined){
  const calls=[];
  const fetcher=async(_url,opts)=>{const q=JSON.parse(opts.body);calls.push(q);
    let result=q.method==='eth_chainId'?'0xaa36a7':q.method==='eth_getCode'?'0x6000':q.method==='eth_call'?abi(tokenURI):
      {number:'0x100',hash:'0x'+'ab'.repeat(32),gasLimit:'0x3938700'};
    const changed=alter(q,result,calls);if(changed!==undefined)result=changed;
    return new Response(JSON.stringify({jsonrpc:'2.0',id:q.id,result}),{headers:{'content-type':'application/json'}});
  };
  return {calls,fetcher};
}
const target={rpcUrl:'https://rpc.example.invalid',chainId,collection:'0x'+'22'.repeat(20),tokenId:'1'};

test('public audit pins the full call to a block, rechecks identity and never signs or submits',async()=>{
  const token=tokenFor(htmlFor({id:'entry',mediaType:'text/javascript',embedded:{compression:'none',storedText:'globalThis.answer=42;'}}));
  const f=fakeRPC(token),r=await readKeelInlineTokenAudit(target,f.fetcher);
  assert.equal(r.audit.completeTokenURIBytes,Buffer.byteLength(token));
  assert.equal(r.blockNumber,'256');assert.equal(r.submission,'not-performed');assert.equal(r.signing,'not-performed');
  assert.equal(r.publicationReady,false);assert.equal(r.browserVerified,false);
  assert.deepEqual(f.calls.map(c=>c.method),['eth_chainId','eth_getBlockByNumber','eth_getCode','eth_call','eth_getBlockByNumber','eth_chainId']);
  assert.equal(f.calls[3].params[1],'0x100');
  assert.equal(f.calls[3].params[0].data,'0xc87b56dd'+'1'.padStart(64,'0'));
});

test('public read rejects chain drift, block drift, ABI corruption and oversize before evidence',async()=>{
  const token=tokenFor('<!doctype html><body>Exact</body>');
  const alterations=[
    q=>q.method==='eth_chainId'?'0x1':undefined,
    (q,r)=>q.method==='eth_getBlockByNumber'&&q.params[0]!=='latest'?{...r,hash:'0x'+'cd'.repeat(32)}:undefined,
    q=>q.method==='eth_call'?'0x00':undefined,
    q=>q.method==='eth_call'?'0x'+(64n).toString(16).padStart(64,'0')+abi(token).slice(66):undefined,
    q=>q.method==='eth_call'?abi(token).slice(0,-1)+'1':undefined,
  ];
  for(const alter of alterations)await assert.rejects(readKeelInlineTokenAudit(target,fakeRPC(token,alter).fetcher),/chain|block|ABI/i);
  await assert.rejects(readKeelInlineTokenAudit(target,fakeRPC('x'.repeat(2000001)).fetcher),/oversized|byte limit/);
  await assert.rejects(readKeelInlineTokenAudit({...target,tokenId:(1n<<256n).toString()},fakeRPC(token).fetcher),/Invalid exact token/);
});

test('MCP exposes the body rule and a read-only public-token audit, and blocks explicit encoded preparation',async t=>{
  const dir=await mkdtemp('/tmp/keel-body-default-');t.after(()=>rm(dir,{recursive:true,force:true}));
  const server=await createMcpServer({workspaceRoot:dir});
  const init=await server.handle({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'body-default-test',version:'1'}}});
  assert.match(init.result.instructions,/storedText/);
  assert.match(init.result.instructions,/keel-inline-token-audit/);
  const list=await server.handle({jsonrpc:'2.0',id:2,method:'tools/list',params:{}});
  assert(list.result.tools.some(t=>t.name==='keel-inline-token-audit'));
  await writeFile(path.join(dir,'entry.js'),'document.body.textContent="Exact water";');
  const result=await server.handle({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'keel-inline-prepare',arguments:{entry:'entry.js',entryMediaType:'text/javascript',entryCompression:'gzip'}}});
  assert.equal(result.result.isError,true);
  assert.match(result.result.content[0].text,/storedBase64\/storedHex|Unsupported|not supported/);
});
