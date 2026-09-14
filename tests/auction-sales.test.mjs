import test from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData } from "viem";
import { prepareKeelAuctionOutcomes, decodeKeelAuctionSalePolicy, keelAuctionAllocationId } from "../packages/sdk/dist/auction-sales.js";
import { keelMintReleaseAbi } from "../packages/sdk/dist/mint-releases.js";
const issuer = "0x1111111111111111111111111111111111111111";
const router = "0x2222222222222222222222222222222222222222";
const common = { chainId:31337n, issuer, router, auctionId:1n, bidder:{routeId:5n,releaseId:2n,supply:1} };
test("ordinary sales bind only their selected route, including editions", () => {
 const p = prepareKeelAuctionOutcomes({...common,bidder:{...common.bidder,supply:10}});
 assert.equal(p.mode,"ordinary"); assert.equal(p.bindings.length,1);
 assert.deepEqual(p.patrons,{supply:0,routeId:0n}); assert.equal(p.bindings[0].reserve,10);
 const tx = decodeFunctionData({abi:keelMintReleaseAbi,data:p.bindings[0].data});
 assert.equal(tx.functionName,"bindReleaseAllocation"); assert.deepEqual(tx.args,[2n,5n,issuer,p.allocationId]);
});
test("FRAY shared outcomes use one binding and reserve only the larger alternative", () => {
 const p = prepareKeelAuctionOutcomes({...common,patrons:{...common.bidder,supply:4}});
 assert.equal(p.mode,"fray"); assert.equal(p.bindings.length,1); assert.equal(p.bindings[0].reserve,4);
 assert.throws(() => prepareKeelAuctionOutcomes({...common,patrons:{routeId:5n,releaseId:3n,supply:4}}));
 const separate = prepareKeelAuctionOutcomes({...common,patrons:{routeId:7n,releaseId:3n,supply:4}});
 assert.equal(separate.bindings.length,2); assert.deepEqual(separate.bindings.map(b=>b.reserve),[1,4]);
});
test("allocation IDs separate houses and sales", () => {
 assert.notEqual(keelAuctionAllocationId(issuer,1n),keelAuctionAllocationId(issuer,2n));
 assert.notEqual(keelAuctionAllocationId(issuer,1n),keelAuctionAllocationId(router,1n));
});
test("packed policy covers independent standards and supply boundaries", () => {
 for (const supply of [1n,10n,0xffffffffn]) for (const b of [0n,1n]) for(const p of [0n,1n]) {
  const d=decodeKeelAuctionSalePolicy(supply|(b<<32n)|(p<<33n));
  assert.equal(d.bidderSupply,Number(supply)); assert.equal(d.bidderStandard,b ? "ERC1155":"ERC721"); assert.equal(d.patronStandard,p ? "ERC1155":"ERC721");
 }
 for (const invalid of [-1n,0n,1n<<34n]) assert.throws(()=>decodeKeelAuctionSalePolicy(invalid));
 for (const supply of [0,-1,1.5,2**32]) assert.throws(()=>prepareKeelAuctionOutcomes({...common,bidder:{...common.bidder,supply}}));
});

test("SDK sale call and event schemas match the canonical auction house ABI", async () => {
 const { readFile } = await import("node:fs/promises");
 const { keelAuctionSaleHouseAbi } = await import("../packages/sdk/dist/auction-sales.js");
 const source = await readFile(new URL("../../fun-art/packages/abi/src/generated/patrons-auction-house.ts", import.meta.url),"utf8");
 const canonical = JSON.parse(source.slice(source.indexOf("["),source.lastIndexOf(" as const;")));
 // Human-readable ABIs omit false flags and empty names; the wire schema is identical.
 const normalize = value => JSON.parse(JSON.stringify(value,(key,v)=>
  key==="internalType" || (key==="name" && v==="") ||
  ((key==="indexed" || key==="anonymous") && v===false) ? undefined : v));
 for(const entry of keelAuctionSaleHouseAbi) {
  const compiled=canonical.find(e=>e.type===entry.type&&e.name===entry.name);
  assert.ok(compiled,entry.name);assert.deepEqual(normalize(entry),normalize(compiled));
 }
});
