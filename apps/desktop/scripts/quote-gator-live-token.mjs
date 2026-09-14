import assert from 'node:assert/strict';
import {writeFile,readFile} from 'node:fs/promises';
import {parseAbi,encodeFunctionData,toHex,formatEther} from 'viem';
import {keelHoldAbi} from '@keel/sdk/abi';
import {createKeelManagedObjectPlan} from '@keel/sdk/native-publication';
import {compileKeelTokenMatrix} from '@keel/sdk/token-matrix';
import {openSession,readJSON,HOLD,SIGNER,CAP} from './gator-sepolia-session.mjs';
import {LIVE_ROOT} from './prepare-gator-live-token.mjs';
const s=await openSession(LIVE_ROOT),abi=parseAbi(keelHoldAbi),values=new Map();
for(const name of ['metadata','image']){const input=await readJSON(LIVE_ROOT+'/'+name+'-input.json');const parts=await Promise.all(input.tokens[0].parts.map(async p=>({role:p.role,bytes:await readFile(p.path)})));const m=compileKeelTokenMatrix([{tokenId:0,parts}],4000);for(const v of m.table)values.set(v.digest,v.bytes);for(const b of m.blocks)if(b.bytes.some(x=>x))values.set('row:'+b.index,b.bytes);}
const chunks=new Map();let newObjectCount=0,reusedBytes=0,newObjectBytes=0;
for(const [id,bytes] of values){
 const plan=await createKeelManagedObjectPlan(bytes,{hold:HOLD,mediaType:'text/plain',compression:'none'});
 const exists=await s.c.readContract({address:HOLD,abi,functionName:'objectExists',args:[plan.objectId]});
 if(exists){assert.deepEqual(await s.read(plan.objectId),Buffer.from(bytes));reusedBytes+=bytes.length;continue;}
 if(!id.startsWith('row:'))newObjectCount++;newObjectBytes+=bytes.length;
 for(const ch of plan.chunks)chunks.set(ch.id,ch);
}
const results=[],entries=[...chunks.values()];
for(let i=0;i<entries.length;i+=6)await Promise.all(entries.slice(i,i+6).map(async ch=>{const pointer=await s.c.readContract({address:HOLD,abi,functionName:'slugPointer',args:[ch.id]});if(pointer!=='0x'+'0'.repeat(40)){assert.equal(await s.c.getCode({address:pointer}),'0x00'+Buffer.from(ch.bytes).toString('hex'));results.push({id:ch.id,bytes:ch.bytes.length,reused:true,gas:'0'});return;}const gas=await s.c.estimateGas({account:SIGNER,to:HOLD,data:encodeFunctionData({abi,functionName:'castSlugs',args:[[toHex(ch.bytes)]]})});results.push({id:ch.id,bytes:ch.bytes.length,reused:false,gas:String(gas)});}));
const gas=results.reduce((n,r)=>n+BigInt(r.gas),0n),balance=await s.c.getBalance({address:SIGNER}),block=await s.c.getBlock();
const report={chainId:11155111,checkedAt:new Date().toISOString(),newObjects:newObjectCount,newObjectBytes,reusedObjectBytes:reusedBytes,newChunks:results.filter(x=>!x.reused).length,newStoredBytes:results.filter(x=>!x.reused).reduce((n,x)=>n+x.bytes,0),chunkGas:String(gas),chunkMaxETH:formatEther(gas*CAP),balanceETH:formatEther(balance),baseFeeGwei:Number(block.baseFeePerGas)/1e9,excluded:['object registration','two matrix contracts and bindings','collection URI update'],chunks:results};await writeFile(LIVE_ROOT+'/quote.json',JSON.stringify(report,null,2));console.log(JSON.stringify({...report,chunks:undefined}));
