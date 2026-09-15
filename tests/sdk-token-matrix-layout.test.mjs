import test from 'node:test';
import assert from 'node:assert/strict';
import {compileKeelTokenMatrix,readKeelTokenMatrix} from '../packages/sdk/src/token-matrix.ts';
const tokens = Array.from({length:8},(_,tokenId)=>({tokenId,parts:[{role:'value',bytes:new TextEncoder().encode(String(tokenId))}]}));
test('custom block budget preserves all rows including short last block',()=>{
 const m=compileKeelTokenMatrix(tokens,8,{blockBytes:18,maxReadDepth:0});
 assert.equal(m.rowStride,6); assert.equal(m.rowsPerBlock,3);
 assert.deepEqual(m.blocks.map(x=>x.bytes.length),[18,18,12]);
 assert.deepEqual(m.deploymentLayout,{tokenCount:8,rowStride:6,rowsPerBlock:3,maxReadDepth:0});
 for(let id=0;id<8;id++)assert.equal(new TextDecoder().decode(readKeelTokenMatrix(m,id)),String(id));
});
test('larger chain budget is accepted as an explicit configuration',()=>{
 const m=compileKeelTokenMatrix(tokens,8,{blockBytes:65536,maxReadDepth:32});
 assert.equal(m.rowsPerBlock,10922);assert.equal(m.maxReadDepth,32);
});
test('default layout remains the previous SDK encoding',()=>{
 const m=compileKeelTokenMatrix(tokens,8);assert.equal(m.rowsPerBlock,3833);assert.equal(m.maxReadDepth,8);
});
test('invalid or unrepresentable configurations reject before block allocation',()=>{
 for(const blockBytes of [0,3,5,NaN,Infinity,-1,1.5,0x100000000,65536*6])assert.throws(()=>compileKeelTokenMatrix(tokens,8,{blockBytes}));
 for(const maxReadDepth of [-1,NaN,Infinity,1.5,0x100000000])assert.throws(()=>compileKeelTokenMatrix(tokens,8,{maxReadDepth}));
});
test('maximum uint16 row count and uint32 depth round trip',()=>{
 const m=compileKeelTokenMatrix(tokens,8,{blockBytes:65535*6,maxReadDepth:0xffffffff});
 assert.equal(m.rowsPerBlock,65535);assert.equal(m.deploymentLayout.maxReadDepth,0xffffffff);
});
