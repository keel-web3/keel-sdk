import test from "node:test";
import assert from "node:assert/strict";
import {decodeAbiParameters,decodeFunctionData} from "viem";
import {encodeKeelSelectedTokenIds,buildKeelSelectedTokenIdsSetupCall,keelSelectedTokenIdsAbi} from "../packages/sdk/dist/selected-token-ids.js";
test("selected token IDs use the existing manager mintData and preserve chosen order",()=>{
 const data=encodeKeelSelectedTokenIds(["13",3n],13n);assert.deepEqual(decodeAbiParameters([{type:"uint256[]"}],data),[[13n,3n]]);
});
test("duplicate, fractional, unsafe numeric, zero and out of range IDs fail before wallet submission",()=>{
 for(const ids of [[],["3","3"],[0n],[14n],["01"],["1.2"],[9007199254740993],[1n<<256n]])assert.throws(()=>encodeKeelSelectedTokenIds(ids,13n));
});
test("selection setup binds exact policy with no signing or capability claim",()=>{
 const r=buildKeelSelectedTokenIdsSetupCall("0x1111111111111111111111111111111111111111","0x2222222222222222222222222222222222222222");
 const call=decodeFunctionData({abi:keelSelectedTokenIdsAbi,data:r.data});assert.equal(call.functionName,"enableSelectedTokenIds");assert.equal(call.args[0],"0x2222222222222222222222222222222222222222");
 assert.equal(r.submission,"not-performed");assert.equal(r.capability,"requires-selected-chain-readback");
});

import {readFileSync} from "node:fs";
import {join} from "node:path";
import {prepareKeelTezosMint,prepareKeelTezosSelectedTokenIdsSetup,buildKeelTezosCollectionFA2Storage} from "../packages/sdk/dist/tezos-collection.js";
const TZ="tz1KqTpEZ7Yob7QbPE4Hy4Wo8fHG8LhKxZSx",KT="KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton",NET="NetXsqzbfFenSTS";
test("native Tezos selected mint binds exact IDs, recipient and zero payment",()=>{
 const r=prepareKeelTezosMint({network:NET,sender:TZ,collection:KT,mints:[{mode:"selected",quantity:2,tokenIds:["13",3],recipient:TZ}]});
 assert.equal(r.tokens,"2");assert.equal(r.paymentMutez,"0");assert.equal(r.operations[0].parameters.entrypoint,"strike_selected");
 assert.deepEqual(r.operations[0].parameters.value,{prim:"Pair",args:[{string:TZ},[{int:"13"},{int:"3"}]]});
 assert.match(r.caveat,/minter\/policy authorization/);assert.equal(r.submission,"not-performed");
 for(const tokenIds of [[3,3],[0],["1.5"]])assert.throws(()=>prepareKeelTezosMint({network:NET,sender:TZ,collection:KT,mints:[{mode:"selected",quantity:tokenIds.length,tokenIds}]}));
 assert.throws(()=>prepareKeelTezosMint({network:NET,sender:TZ,collection:KT,mints:[{mode:"selected",quantity:2,tokenIds:[13]}]}));
});
test("native Tezos selection setup carries an exact optional immutable policy",()=>{
 const r=prepareKeelTezosSelectedTokenIdsSetup({network:NET,sender:TZ,collection:KT,policy:KT});
 assert.equal(r.operation.parameters.entrypoint,"enable_selected_token_ids");assert.deepEqual(r.operation.parameters.value,{prim:"Some",args:[{string:KT}]});
 assert.deepEqual(prepareKeelTezosSelectedTokenIdsSetup({network:NET,sender:TZ,collection:KT}).operation.parameters.value,{prim:"None"});
});
test("new FA2 origination storage equals freshly compiled SmartPy storage",{skip:!process.env.KEEL_SELECTED_FA2_TARGETS},()=>{
 const compiled=JSON.parse(readFileSync(join(process.env.KEEL_SELECTED_FA2_TARGETS,"collection_route_collection/step_001_cont_0_storage.json"),"utf8"));
 assert.deepEqual(buildKeelTezosCollectionFA2Storage({administrator:TZ,keelIndex:KT,maxSupply:100}),compiled);
});
