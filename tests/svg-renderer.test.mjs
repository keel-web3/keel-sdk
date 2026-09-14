import test from 'node:test';
import assert from 'node:assert/strict';
import { keccak256, sha256, stringToHex } from 'viem';
import { inspectKeelSVG, readKeelSVG, verifyKeelSVG, prepareKeelSVGRead, keelSVGDataURI } from '../packages/sdk/dist/svg-renderer.js';
import { SVG_TOOL_DEFINITIONS } from '../packages/mcp/dist/svg-tools.js';
const contract='0x'+'1'.repeat(40), winner='0x'+'2'.repeat(40), h='0x'+'a'.repeat(64), code='0x6080604052';
const target={chainId:11155111,address:contract,tokenId:'1',codeHash:keccak256(code)};
function fixture(art='<path fill="#dfbe48" d="M1 1h1v1h-1z"/>') {
  const provenance={schema:'keel.svg-native@1',renderer:{chainId:'11155111',address:contract,tokenId:'1',codeHash:keccak256(code),method:'svg(uint256)'},artwork:{hash:'sha256',digest:sha256(stringToHex(art)),bytes:String(Buffer.byteLength(art))},generation:{source:contract,seed:h},proof:{schema:h,source:contract,job:h,statement:h,beneficiary:winner,kind:1,work:'77',seed:h},verification:{method:'same-block-contract-readback',storage:'evm-code-and-state'}};
  return {provenance,source:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 13 13" shape-rendering="crispEdges">\n<metadata id="keel-verification"><![CDATA[${JSON.stringify(provenance)}]]></metadata>\n<g id="keel-artwork">${art}</g>\n</svg>`};
}
function client(source=fixture().source) {
  const calls=[];
  return {calls,getChainId:async()=>11155111,getBlock:async(args)=>{calls.push(args);return{number:40n,hash:h};},getCode:async(args)=>{calls.push(args);return code;},readContract:async(args)=>{calls.push(args);return source;}};
}
test('passive SVG round-trips but labels alone remain unverified',()=>{
  const f=fixture(),r=inspectKeelSVG(f.source);assert.deepEqual(r.provenance,f.provenance);assert.equal(r.verification,'unverified');assert.equal(inspectKeelSVG(keelSVGDataURI(f.source)).source,f.source);
});
test('same-block readback checks target, deployed code and exact document',async()=>{
  const c=client(),r=await verifyKeelSVG(c,target,fixture().source);
  assert.equal(r.verification,'contract-readback');assert.equal(r.runtimePinned,true);assert.equal(r.blockNumber,'40');
  assert.equal(c.calls[0].blockTag,'finalized');assert.ok(c.calls.slice(1).every(x=>x.blockNumber===40n));
});
test('a forged accepted statement with a valid artwork digest is rejected',async()=>{
  const f=fixture(),changed=f.source.replace('"statement":"'+h+'"','"statement":"0x'+'b'.repeat(64)+'"');
  assert.equal(inspectKeelSVG(changed).verification,'unverified');
  await assert.rejects(verifyKeelSVG(client(),target,changed),/does not match/);
});
test('mutated artwork and disguised active content are rejected',()=>{
  assert.throws(()=>inspectKeelSVG(fixture().source.replace('M1 1h1','M2 1h1')),/digest/);
  for(const art of ['<script>alert(1)</script>','<image href="https://evil.test/a"/>','<path onload="alert(1)"/>','<foreignObject/>','<g><path/></svg>','<path fill="url(#x)"/>','<!-- hidden --><path/>','<path fill="red" fill="blue"/>','<path fill="&#35;fff"/>','<path/><metadata id="keel-verification"/>'])assert.throws(()=>inspectKeelSVG(fixture(art).source));
});
test('wrong chain, token, source and reviewed code hash cannot pass',async()=>{
  await assert.rejects(readKeelSVG(client(),{...target,chainId:1}),/network/);
  await assert.rejects(readKeelSVG(client(),{...target,tokenId:'2'}),/identity/);
  await assert.rejects(readKeelSVG(client(),{...target,address:winner}),/identity/);
  await assert.rejects(readKeelSVG(client(),{...target,codeHash:h}),/identity/);
  await assert.rejects(readKeelSVG({...client(),getCode:async()=> '0x'},target),/unavailable/);
});
test('finality missing, reorg, RPC failure and oversized input fail closed',async()=>{
  await assert.rejects(readKeelSVG({...client(),getBlock:async()=>({number:null,hash:null})},target),/finalized/);
  let at=0;await assert.rejects(readKeelSVG({...client(),getBlock:async()=>({number:40n,hash:at++?target.codeHash:h})},target),/snapshot changed/);
  await assert.rejects(readKeelSVG({...client(),readContract:async()=>{throw Error('RPC unavailable');}},target),/unavailable/);
  assert.throws(()=>inspectKeelSVG(' '.repeat(150001)),/limit/);
});
test('strict provenance and integer bounds',()=>{
  for(const v of ['-1','1e3','01',(1n<<256n).toString()])assert.throws(()=>prepareKeelSVGRead({...target,tokenId:v}));
  const f=fixture();assert.throws(()=>inspectKeelSVG(f.source.replace('"work":"77"',`"work":"${1n<<88n}"`)),/provenance/);
  assert.throws(()=>inspectKeelSVG(f.source.replace('"schema":"keel.svg-native@1"','"trusted":true,"schema":"keel.svg-native@1"')),/fields/);
});
test('MCP exposes inspection and unsigned read plans, never fake verification',async()=>{
  const inspect=SVG_TOOL_DEFINITIONS.find(x=>x.descriptor.name==='keel-svg-inspect');
  const result=await inspect.run({}, {svg:fixture().source});assert.equal(result.verification,'unverified');assert.ok(result.required.length);
  const plan=SVG_TOOL_DEFINITIONS.find(x=>x.descriptor.name==='keel-svg-call-plan');
  const call=await plan.run({}, {chainId:target.chainId,address:target.address,tokenId:'1'});assert.equal(call.method,'eth_call');assert.equal(call.verification,'not-performed');assert.match(call.data,/^0x[0-9a-f]+$/);
  await assert.rejects(plan.run({}, {...target,rpcUrl:'http://localhost/private'}));
});
