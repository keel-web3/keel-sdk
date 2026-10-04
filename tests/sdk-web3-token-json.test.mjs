import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { buildKeelInlineShellFragments, buildKeelInlineLocalDocument, buildKeelInlineImageURI, buildKeelWeb3TokenJSONGraph } from '../packages/sdk/dist/inline-viewer-graph.js';
import { createMcpServer } from '../packages/mcp/dist/server.js';
import { buildKeelInlineRawPercentTokenURIGraph } from '../packages/sdk/dist/inline-viewer-graph.js';

const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/png;base64,aGVsbG8="/></svg>');
const original = { name: 'TokenGator #0', description: 'Quotes " / percent % / é', mml: 'https://example.org/0.mml', attributes: [{trait_type:'Skin',value:'Lava'}], image:'ipfs://old' };
const decode = uri => decodeURIComponent(uri.slice(uri.indexOf(',')+1));

test('web3 budgets the returned JSON, not an unused outer data URI encoding', async () => {
  const base = await buildKeelInlineLocalDocument({shell:await buildKeelInlineShellFragments(),modules:[],entry:{id:'entry',mediaType:'text/html',source:Buffer.from('<p>Budget boundary</p>')}});
  const documentWithComment = count => {
    const parts = [...base.parts.slice(0,-1),{kind:'creator',role:'entry',bytes:Buffer.from(`<!--${'%'.repeat(count)}-->`)},base.parts.at(-1)];
    return {...base,parts,rootBytes:Buffer.concat(parts.map(p=>Buffer.from(p.bytes)))};
  };
  const document = documentWithComment(420_000);
  await assert.rejects(buildKeelInlineRawPercentTokenURIGraph(document),/public-read ceiling/);
  const plan = await buildKeelWeb3TokenJSONGraph({document,metadata:original,imageURI:buildKeelInlineImageURI(svg,'image/svg+xml'),tokenId:'0'});
  assert.ok(plan.bytes.length < 2_000_000);
  assert.equal(decode(plan.metadata.animation_url),Buffer.from(document.rootBytes).toString());
  await assert.rejects(buildKeelWeb3TokenJSONGraph({document:documentWithComment(700_000),metadata:original,imageURI:buildKeelInlineImageURI(svg,'image/svg+xml'),tokenId:'0'}),/Complete web3 JSON/);
});

test('raw JSON preserves original fields, shares image payloads and carries the exact canonical HTML', async () => {
  const shell = await buildKeelInlineShellFragments();
  const document = await buildKeelInlineLocalDocument({ shell, modules: [], entry: { id:'entry', mediaType:'text/html', source:Buffer.from('<!doctype html><p>Gator zero</p>') } });
  const imageURI = buildKeelInlineImageURI(svg,'image/svg+xml');
  const plan = await buildKeelWeb3TokenJSONGraph({document,metadata:original,imageURI,tokenId:'0'});
  assert.equal(plan.tokenId,'0');
  const metadata = JSON.parse(Buffer.from(plan.bytes).toString());
  const {image,animation_url,...rest} = metadata;
  const {image:_old,...expected} = original;
  assert.deepEqual(rest,expected);
  assert.equal(decode(image),svg.toString());
  assert.equal(decode(animation_url),Buffer.from(document.rootBytes).toString());
  assert.deepEqual(Buffer.concat(plan.parts.map(p=>Buffer.from(p.bytes))),Buffer.from(plan.bytes));
  assert.equal(plan.parts.filter(p=>p.role==='image-asset').length,1);
  assert.equal(plan.completeDocumentBase64Layers,0);
  assert.equal(original.image,'ipfs://old');
  const patterned = await buildKeelWeb3TokenJSONGraph({document,metadata:original,imageURI,tokenId:'0',tokenIdFields:{name:{prefix:'TokenGator #',suffix:''}}});
  assert.deepEqual(patterned.bytes,plan.bytes);
  assert.equal(patterned.parts.filter(p=>p.role==='token-id').length,1);
  await assert.rejects(buildKeelWeb3TokenJSONGraph({document,metadata:original,imageURI,tokenId:'7',tokenIdFields:{name:{prefix:'TokenGator #',suffix:''}}}),/does not match/);
  for (const tokenId of ['-1','01','1.5',(1n<<256n).toString()]) await assert.rejects(buildKeelWeb3TokenJSONGraph({document,metadata:original,imageURI,tokenId}),/uint256/);
  await assert.rejects(buildKeelWeb3TokenJSONGraph({document,metadata:original,imageURI:'https://example.org/image.svg',tokenId:'0'}));
  const empty = await buildKeelWeb3TokenJSONGraph({document,metadata:{},imageURI,tokenId:'7'});
  assert.equal(JSON.parse(Buffer.from(empty.bytes).toString()).image,imageURI);
});

test('MCP external URI preparation keeps token zero and does not propose KEEL721 binding', async () => {
  const root = await mkdtemp('/tmp/keel-mcp-web3-json-');
  try {
    await writeFile(root+'/entry.html','<!doctype html><p>Gator zero</p>');
    await writeFile(root+'/image.svg',svg);
    await writeFile(root+'/metadata.json',JSON.stringify(original));
    const server = await createMcpServer({workspaceRoot:root});
    await server.handle({jsonrpc:'2.0',id:0,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'test',version:'1'}}});
    const args = {entry:'entry.html',entryMediaType:'text/html',imagePath:'image.svg',metadataPath:'metadata.json',metadataTransport:'web3-json',tokenId:'0',collection:'0xab2e21bffafdae462e9392375a413d36ea7c247c',chainId:11155111};
    const call = arguments_ => server.handle({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'keel-inline-prepare',arguments:arguments_}});
    const response = (await call(args)).result;
    assert.ok(!response.isError,JSON.stringify(response));
    assert.equal(response.structuredContent.web3Metadata.tokenId,'0');
    assert.equal(response.structuredContent.web3Metadata.mediaType,'application/json');
    assert.equal(response.structuredContent.web3Metadata.selectedChainBindingVerified,false);
    assert.equal(response.structuredContent.prepared,undefined);
    assert.equal((await call({...args,tokenId:'01'})).result.isError,true);
    assert.equal((await call({...args,carriage:'pinned'})).result.isError,true);
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('the standard SDK and MCP path shares each prepared layer across SVG and HTML',async()=>{
 const raw=Buffer.from('layer-data-+/=');
 const image=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/webp;base64,${raw.toString('base64')}"/></svg>`);
 const entry=Buffer.from('<!doctype html><p>Layers</p>');
 const document=await buildKeelInlineLocalDocument({shell:await buildKeelInlineShellFragments(),modules:[],assets:[{id:'layer',mediaType:'image/webp',source:raw,compression:'none'}],entry:{id:'entry',mediaType:'text/html',source:entry}});
 const graph=await buildKeelWeb3TokenJSONGraph({document,metadata:original,imageURI:buildKeelInlineImageURI(image,'image/svg+xml'),tokenId:'0'});
 const slots=graph.parts.filter(p=>p.role==='image-asset');assert.equal(slots.length,2);
 assert.deepEqual(slots[0].bytes,slots[1].bytes);
 const {compileKeelTokenMatrix,readKeelTokenMatrix}=await import('../packages/sdk/dist/token-matrix.js');
 const matrix=compileKeelTokenMatrix([{tokenId:0,parts:graph.parts}],4000);
 assert.equal(matrix.table.filter(p=>p.roles.includes('image-asset')).length,1);
 assert.deepEqual(Buffer.from(readKeelTokenMatrix(matrix,0)),Buffer.from(graph.bytes));
 assert.equal(decode(graph.metadata.animation_url),Buffer.from(document.rootBytes).toString());
  const web3Image={chainId:11155111,resolver:'0x1111111111111111111111111111111111111111'};
  await assert.rejects(
    buildKeelWeb3TokenJSONGraph({document,metadata:original,imageURI:buildKeelInlineImageURI(image,'image/svg+xml'),tokenId:'0',web3Image}),
    /web3Image is disabled for collector-facing Inline by default/u,
  );
  const linked=await buildKeelWeb3TokenJSONGraph({document,metadata:original,imageURI:buildKeelInlineImageURI(image,'image/svg+xml'),tokenId:'0',web3Image,presentationPolicy:'external-resolver'});
 assert.equal(linked.imageTransport,'web3-svg');
 assert.equal(linked.metadata.image,'web3://0x1111111111111111111111111111111111111111:11155111/tokenJSON/0?mime.type=svg');
 assert.deepEqual(Buffer.from(linked.imageResponse.bytes),image);
 assert.deepEqual(Buffer.concat(linked.imageResponse.parts.map(p=>Buffer.from(p.bytes))),image);
 assert.equal(linked.metadata.animation_url,graph.metadata.animation_url);
 assert.deepEqual(linked.parts.filter(p=>p.role==='image-asset').map(p=>p.integrity.digest),linked.imageResponse.parts.filter(p=>p.role==='image-asset').map(p=>p.integrity.digest));
 const imageMatrix=compileKeelTokenMatrix([{tokenId:0,parts:linked.imageResponse.parts}],4000);
 assert.deepEqual(Buffer.from(readKeelTokenMatrix(imageMatrix,0)),image);
 for(const bad of [{...web3Image,chainId:undefined},{...web3Image,chainId:0},{...web3Image,resolver:'0x'+'0'.repeat(40)}])await assert.rejects(buildKeelWeb3TokenJSONGraph({document,metadata:original,imageURI:buildKeelInlineImageURI(image,'image/svg+xml'),tokenId:'0',web3Image:bad,presentationPolicy:'external-resolver'}));
 const root=await mkdtemp('/tmp/keel-standard-layer-reuse-');
 try {
  await Promise.all([writeFile(root+'/layer.webp',raw),writeFile(root+'/image.svg',image),writeFile(root+'/entry.html',entry),writeFile(root+'/metadata.json',JSON.stringify(original))]);
  const server=await createMcpServer({workspaceRoot:root});await server.handle({jsonrpc:'2.0',id:0,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'shared-slots',version:'1'}}});
  const response=(await server.handle({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'keel-inline-prepare',arguments:{entry:'entry.html',entryMediaType:'text/html',assets:[{assetId:'layer',path:'layer.webp',mediaType:'image/webp',compression:'none'}],imagePath:'image.svg',metadataPath:'metadata.json',metadataTransport:'web3-json',tokenId:'0',chainId:11155111}}})).result;
  assert.ok(!response.isError,JSON.stringify(response));
  const actual=response.structuredContent.web3Metadata;
  assert.equal(actual.integrity.digest,graph.integrity.digest);
  const items=actual.parts.filter(p=>p.role==='image-asset');assert.equal(items.length,2);assert.equal(items[0].integrity.digest,items[1].integrity.digest);
  const linkedResponse=(await server.handle({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'keel-inline-prepare',arguments:{entry:'entry.html',entryMediaType:'text/html',assets:[{assetId:'layer',path:'layer.webp',mediaType:'image/webp',compression:'none'}],imagePath:'image.svg',metadataPath:'metadata.json',metadataTransport:'web3-json',tokenId:'0',chainId:11155111,web3ImageResolver:web3Image.resolver,presentationPolicy:'external-resolver'}}})).result;
  assert.ok(!linkedResponse.isError,JSON.stringify(linkedResponse));
  assert.equal(linkedResponse.structuredContent.web3Metadata.integrity.digest,linked.integrity.digest);
  assert.equal(linkedResponse.structuredContent.web3Metadata.imageResponse.integrity.digest,linked.imageResponse.integrity.digest);
  assert.equal(linkedResponse.structuredContent.web3Metadata.imageResponse.selectedChainBindingVerified,false);
 } finally {await rm(root,{recursive:true,force:true});}
});
