import test from "node:test";
import assert from "node:assert/strict";
import { buildKeelArtistContracts } from "../packages/sdk/dist/artist-contracts.js";
const ETH = {family:"ethereum",chainId:11155111};
const TEZ = {family:"tezos",network:"NetXsqzbfFenSTS"};
const A = "0x1111111111111111111111111111111111111111";
const KT = "KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton";
const manifest = () => ({artist:{key:"ravonus",name:"RAVONUS"},collections:[{key:"nocturnes-genesis",name:"NOCTURNES Genesis"},{key:"other",name:"Another collection"}], contracts:[
  {chain:ETH,address:A,role:"collection",collection:"nocturnes-genesis",name:"Genesis ERC-721"},
  {chain:TEZ,address:KT,role:"collection",collection:"nocturnes-genesis",name:"Genesis FA2"},
  {chain:ETH,address:null,role:"sale",collection:"nocturnes-genesis",name:"Global allocation sale"},
  {chain:ETH,address:A,role:"storage",collection:"other",name:"Shared storage"},
].map(entry=>({...entry,chain:{...entry.chain}}))});
test("one artist groups both chains and collection support contracts without claiming deployment or authority",()=>{
 const r=buildKeelArtistContracts(manifest()); assert.equal(r.artist.key,"ravonus"); assert.equal(r.groups.length,2);
 assert.equal(r.groups.find(g=>g.key==="nocturnes-genesis").contracts.length,3); assert.equal(r.contractCount,2);
 assert.equal(r.contracts.find(c=>c.role==="sale").status,"unconfigured"); assert.equal(r.authority,"not-established");
 assert.equal(r.attribution,"creator-declared"); assert.equal(r.submission,"not-performed");
});
test("commitment is order independent and changes with exact contract identity",()=>{
 const a=manifest(), b=manifest(); b.collections.reverse(); b.contracts.reverse();
 assert.equal(buildKeelArtistContracts(a).commitment,buildKeelArtistContracts(b).commitment);
 b.contracts[0].chain={family:"ethereum",chainId:31337}; assert.notEqual(buildKeelArtistContracts(a).commitment,buildKeelArtistContracts(b).commitment);
});
test("same address on different chains has separate identity and aliases cannot merge contracts",()=>{
 const m=manifest();m.contracts[3]={...m.contracts[3],chain:{family:"ethereum",chainId:31337}};
 const r=buildKeelArtistContracts(m); assert.equal(r.contractCount,3);
 assert.throws(()=>buildKeelArtistContracts({...m,contracts:[...m.contracts,{...m.contracts[0],address:"0x2222222222222222222222222222222222222222"}]}),/Ambiguous/);
});
test("native profile references are retained for both chains without asserting identity verification",()=>{
 const m=manifest();m.artist.profiles=[{chain:ETH,registry:A,creatorId:`0x${"ab".repeat(32)}`},{chain:TEZ,registry:KT,creatorId:`0x${"cd".repeat(32)}`}];
 const r=buildKeelArtistContracts(m);assert.equal(r.artist.profiles.length,2);assert.equal(r.attribution,"profile-reference-needs-readback");
 m.artist.profiles.push(m.artist.profiles[0]);assert.throws(()=>buildKeelArtistContracts(m),/Ambiguous artist profile/);
});
test("unknown collections, malformed network/address checksums, mainnet aliases and secret fields are rejected",()=>{
 for(const change of [m=>m.contracts[0].collection="missing",m=>m.contracts[1].chain.network="NetXsqzbfFenSTT",m=>m.contracts[1].address=KT.slice(0,-1)+"m",m=>m.contracts[0].chain.chainId="sepolia",m=>m.privateKey="never"]){const m=manifest();change(m);assert.throws(()=>buildKeelArtistContracts(m));}
});


test("multiple immutable infrastructure helpers share one artist and have an order-independent commitment",()=>{
 const a=manifest();a.contracts.push(...[{address:null,name:"Bridge recovery implementation"},{address:null,name:"Groth16 gateway"},{address:"0x3333333333333333333333333333333333333333",name:"Configured helper"}].map(x=>({chain:ETH,role:"infrastructure",collection:"nocturnes-genesis",...x})));
 const b=structuredClone(a);b.contracts.reverse();const result=buildKeelArtistContracts(a);assert.equal(result.groups.find(g=>g.key==="nocturnes-genesis").contracts.filter(c=>c.role==="infrastructure").length,3);assert.equal(result.commitment,buildKeelArtistContracts(b).commitment);assert.equal(result.contractCount,3);assert.equal(result.authority,"not-established");
 for(const entry of a.contracts.filter(c=>c.role==="infrastructure"))assert.throws(()=>buildKeelArtistContracts({...a,contracts:[...a.contracts,{...entry}]}),/Ambiguous/);
 const primary={...a.contracts[0],name:"Another primary",address:"0x4444444444444444444444444444444444444444"};assert.throws(()=>buildKeelArtistContracts({...a,contracts:[...a.contracts,primary]}),/Ambiguous/);
});
