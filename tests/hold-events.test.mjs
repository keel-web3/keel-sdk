import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeAbiParameters,encodeEventTopics,toHex} from 'viem';
import {keelObjectWeldedEvent,unpackKeelObjectMetadata,decodeKeelObjectWeldedLog} from '../packages/sdk/dist/hold-events.js';

const digest=`0x${'11'.repeat(32)}`,objectId=`0x${'22'.repeat(32)}`,indexDigest=`0x${'33'.repeat(32)}`;
const pointer='0x0000000000000000000000000000000000001234';
const max64=(1n<<64n)-1n,max32=(1n<<32n)-1n;
function packed(length,stored,count,compression,composite){return toHex(length|(stored<<64n)|(count<<128n)|(BigInt(compression)<<160n)|(BigInt(composite)<<168n),{size:32});}

test('packed fields preserve boundary values and never overlap',()=>{
 for(const length of [1n,255n,256n,1n<<63n,max64]) for(const stored of [1n,max64])
 for(const count of [1n,128n,256n,max32]) for(const compression of [0,1,2,3]) {
   assert.deepEqual(unpackKeelObjectMetadata(packed(length,stored,count,compression,false)),{
     byteLength:length,storedByteLength:stored,slugCount:count,compression,composite:false,
   });
 }
 // Fixed bytes independently pin the field order and composite bit.
 const word=`0x${'00'.repeat(10)}0100ffffffffffffffffffffffffffffffffffffffff`;
 assert.deepEqual(unpackKeelObjectMetadata(word),{byteLength:max64,storedByteLength:max64,slugCount:max32,compression:0,composite:true});
});

test('one packed log expands to all frontend fields and keeps digest topics',()=>{
 const metadata=packed(100n,75n,3n,1,false);
 const topics=encodeEventTopics({abi:[keelObjectWeldedEvent],eventName:'ObjectWelded',args:{objectId,digest,indexDigest}});
 const data=encodeAbiParameters([{type:'address'},{type:'bytes32'},{type:'string'}],[pointer,metadata,'text/html']);
 assert.equal(topics.length,4);
 assert.equal((data.length-2)/2,160);
 assert.deepEqual(decodeKeelObjectWeldedLog({topics,data}),{
   objectId,digest,indexDigest,descriptorPointer:pointer,metadata,mediaType:'text/html',
   byteLength:100n,storedByteLength:75n,slugCount:3n,compression:1,composite:false,
 });
 assert.throws(()=>decodeKeelObjectWeldedLog({topics:[],data}));
 assert.throws(()=>decodeKeelObjectWeldedLog({topics,data:'0x'}));
});

test('unsupported bits, compression and malformed words are rejected',()=>{
 for(const word of [toHex(1n<<169n,{size:32}),packed(1n,1n,1n,4,false),packed(1n,1n,1n,1,true),'0x01',`0x${'gg'.repeat(32)}`]) {
   assert.throws(()=>unpackKeelObjectMetadata(word));
 }
});
