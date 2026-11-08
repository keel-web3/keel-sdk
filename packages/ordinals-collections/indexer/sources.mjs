// URLs are supplied by the caller; exceptions never include them.
const validHash=s=>typeof s==='string' && /^[a-f0-9]{64}$/i.test(s);
async function request(fetcher,url,options) {
 for(let attempt=0;;attempt++) {
  let r;try {r=await fetcher(url,{...options,signal:AbortSignal.timeout(30000)})}catch{throw Error('block source request failed')}
  if(r.ok)return r;
  if(r.status===429 || r.status===503){
   const retry=Number(r.headers.get('retry-after'));await r.body?.cancel();
   const delay=Number.isFinite(retry)&&retry>0 ? Math.min(retry*1000,300000) : Math.min(1000*2**Math.min(attempt,5),30000);
   await new Promise(resolve=>setTimeout(resolve,delay));continue;
  }
  throw Error(`block source HTTP ${r.status}`);
 }
 throw Error('block source unavailable');
}
async function bounded(response,limit) {
 const declared=Number(response.headers.get('content-length'));
 if(Number.isFinite(declared) && declared>limit){await response.body?.cancel();throw Error('block response too large')}
 if(!response.body)throw Error('block response empty');
 const reader=response.body.getReader(), chunks=[];let size=0;
 try { for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw Error('block response too large')}chunks.push(value)} }
 finally {reader.releaseLock()}
 return Buffer.concat(chunks,size);
}

const heightCheck=h=>{if(!Number.isSafeInteger(h)||h<0)throw Error('invalid height')};
export function esploraSource(base,{fetcher=fetch}={}) {
 const url=base.replace(/\/$/,'');
 return {async blockHash(h){heightCheck(h);const s=(await (await request(fetcher,`${url}/block-height/${h}`)).text()).trim();if(!validHash(s))throw Error('invalid block hash');return s.toLowerCase()},async rawBlock(hash){if(!validHash(hash))throw Error('invalid block hash');const r=await request(fetcher,`${url}/block/${hash}/raw`);return bounded(r,8*1024*1024)}};
}
export function recursionSource(base,{fetcher=fetch}={}) {
 const url=base.replace(/\/$/,'');
 return {async blockHash(h){heightCheck(h);const s=(await (await request(fetcher,`${url}/r/blockhash/${h}`)).text()).trim().replace(/^"|"$/g,'');if(!validHash(s))throw Error('invalid block hash');return s.toLowerCase()},async rawBlock(hash){if(!validHash(hash))throw Error('invalid block hash');const s=(await bounded(await request(fetcher,`${url}/r/block/${hash}`),16*1024*1024)).toString('utf8').trim();if(s.length>16*1024*1024 || s.length%2 || !/^[a-f0-9]+$/i.test(s))throw Error('invalid block hex');return Buffer.from(s,'hex')}};
}
export function rpcSource(url,{fetcher=fetch,authorization}={}) {
 let id=0,active=0;const waiting=[];
 async function rpc(method,params){
  if(active>=2)await new Promise(resolve=>waiting.push(resolve));else active++;
  try{return await runRpc(method,params)}finally{if(waiting.length)waiting.shift()();else active--}
 }
 async function runRpc(method,params){
  const headers={'content-type':'application/json'};if(authorization)headers.authorization=authorization;
  for(let attempt=0;;attempt++) {
   const r=await request(fetcher,url,{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});let data;
   try{data=JSON.parse((await bounded(r,17*1024*1024)).toString('utf8'))}catch{throw Error('invalid or oversized RPC response')}
   if(!data.error && data.result!==undefined)return data.result;
   const code=data.error?.code, message=String(data.error?.message??'');
   if(code===429 || code===503 || /\b(429|503)\b|cooling down|rate limit/i.test(message) || (attempt<9 && code===-32603)) {await new Promise(resolve=>setTimeout(resolve,Math.min(1000*2**Math.min(attempt,5),30000)));continue}
   throw Error(`RPC ${method} failed (${Number.isInteger(code)?code:'unknown'})`);
  }
  throw Error('RPC retry budget exhausted');
 }
 return {async blockHash(h){heightCheck(h);const s=await rpc('getblockhash',[h]);if(!validHash(s))throw Error('invalid block hash');return s.toLowerCase()},async rawBlock(hash){if(!validHash(hash))throw Error('invalid block hash');const s=await rpc('getblock',[hash,0]);if(typeof s!=='string'||s.length>16*1024*1024||s.length%2||!/^[a-f0-9]+$/i.test(s))throw Error('invalid block hex');return Buffer.from(s,'hex')}};
}
