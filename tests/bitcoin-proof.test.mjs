import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {decodeBitcoinProofValues,encodeBitcoinProofValues,bitcoinFirstEnvelopeLocator} from '../packages/protocol/dist/index.js';
const golden=JSON.parse(fs.readFileSync(new URL('./fixtures/bitcoin-proof-v3.json',import.meta.url),'utf8'));
test('281-byte public values round trip exact guest output',()=>{
 const values=decodeBitcoinProofValues(golden.publicValues);
 assert.equal(encodeBitcoinProofValues(values),golden.publicValues);
 assert.equal(values.claimKind,0);assert.equal(values.payloadLen,51n);
 assert.equal(values.originHeight,959616);assert.equal(values.blockHeight,959700);
 assert.equal(values.tipHeight-values.blockHeight,values.confirmations);
});
test('old layout, invalid bytes, and oversized coordinates fail closed',()=>{
 assert.throws(()=>decodeBitcoinProofValues(golden.publicValues.slice(0,490)));
 assert.throws(()=>decodeBitcoinProofValues(golden.publicValues+'00'));
 assert.throws(()=>decodeBitcoinProofValues(golden.publicValues.slice(0,-2)+'zz'));
 const v=decodeBitcoinProofValues(golden.publicValues);
 for(const value of [-1,4294967296,0.5]) assert.throws(()=>encodeBitcoinProofValues({...v,sourceInput:value}));
 assert.throws(()=>encodeBitcoinProofValues({...v,payloadLen:1n<<64n}));
 assert.throws(()=>encodeBitcoinProofValues({...v,claimKind:2}));
});
test('locator preserves internal txid order and identifies input, not inscription ordinal',()=>{
 const v=decodeBitcoinProofValues(golden.publicValues);
 assert.equal(bitcoinFirstEnvelopeLocator(v.sourceTxid,3),`ord://f9beb4d9/${v.sourceTxid}/input/3/envelope/0`);
 assert.throws(()=>bitcoinFirstEnvelopeLocator(v.sourceTxid,-1));
});
