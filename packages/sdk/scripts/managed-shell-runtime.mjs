// Hybrid mounting uses the existing KEEL transport and recursive chunk reader.
import {createKeelChain} from '../../viewer/src/keel-rpc-view.js';
import {createKeelHoldObjectReader} from '../../viewer/src/chunk-store.ts';
import {encodeFunctionData,decodeFunctionResult,parseAbi,hexToBytes} from 'viem';
const abi=parseAbi([
 'function getObject(bytes32) view returns ((bytes32 digest,bytes32 indexDigest,address descriptorPointer,uint64 byteLength,uint64 storedByteLength,uint64 chunkCount,uint8 compression,bool composite,bool exists,string mediaType))',
 'function getObjectSlugPointers(bytes32,uint256,uint256) view returns(address[])',
 'function getObjectPartIds(bytes32,uint256,uint256) view returns(bytes32[])',
]);
(async()=>{
 await new Promise(r=>setTimeout(r,0));
 const c=globalThis.__KEEL_MANAGED_SHELL__;
 const chain=createKeelChain({rpc:c.rpcUrl,keelHold:c.store});
 if(Number(BigInt(await chain.request('eth_chainId',[])))!==c.chainId)throw Error('Wrong artwork network');
 const call=async(name,args)=>decodeFunctionResult({abi,functionName:name,data:await chain.call(c.store,encodeFunctionData({abi,functionName:name,args}))});
 const read=createKeelHoldObjectReader({
  getObject:async r=>{const v=await call('getObject',[r.objectId]);if(!v.exists)throw Error('Artwork object unavailable');return v},
  getObjectSlugPointers:r=>call('getObjectSlugPointers',[r.objectId,BigInt(r.offset),BigInt(r.limit)]),
  getObjectPartIds:r=>call('getObjectPartIds',[r.objectId,BigInt(r.offset),BigInt(r.limit)]),
  getCode:async r=>hexToBytes(await chain.request('eth_getCode',[r.address,'latest'])),
 },{maxConcurrentReads:4});
 const bytes=await read({chainId:c.chainId,store:c.store,objectId:c.objectId},new AbortController().signal);
 const actual='0x'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 if(actual!==c.digest.toLowerCase())throw Error('Artwork integrity mismatch');
 let html=decodeURIComponent(decodeURIComponent(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
 if(!html.includes('verify-corner'))throw Error('Canonical viewer unavailable');
 const context=globalThis.__KEEL_ONCHAIN_CONTEXT__;
 if(!context||typeof context.json!=='string')throw Error('Token context unavailable');
 const injection='<script>globalThis.__KEEL_ONCHAIN_CONTEXT__=Object.freeze('+JSON.stringify(context).replaceAll('<','\\u003c')+')</script>';
 html=html.replace(/<head(?:\s[^>]*)?>/i,m=>m+injection);
 document.open();document.write(html);document.close();
})().catch(e=>{document.getElementById('keel-loader-status').textContent=e.message;document.documentElement.dataset.keelLoader='failed'});
