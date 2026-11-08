// URLs are supplied by the caller; exceptions never include them.
const validHash=s=>typeof s==='string' && /^[a-f0-9]{64}$/i.test(s);
async function request(fetcher,url,options) { let r; try {r=await fetcher(url,options)} catch {throw Error('block source request failed')} if(!r.ok)throw Error(`block source HTTP ${r.status}`);return r; }
const heightCheck=h=>{if(!Number.isSafeInteger(h)||h<0)throw Error('invalid height')};
export function esploraSource(base,{fetcher=fetch}={}) {
 const url=base.replace(/\/$/,'');
 return {async blockHash(h){heightCheck(h);const s=(await (await request(fetcher,`${url}/block-height/${h}`)).text()).trim();if(!validHash(s))throw Error('invalid block hash');return s.toLowerCase()},async rawBlock(hash){if(!validHash(hash))throw Error('invalid block hash');const r=await request(fetcher,`${url}/block/${hash}/raw`);const a=Buffer.from(await r.arrayBuffer());if(a.length>8*1024*1024)throw Error('block too large');return a}};
}
export function recursionSource(base,{fetcher=fetch}={}) {
 const url=base.replace(/\/$/,'');
 return {async blockHash(h){heightCheck(h);const s=(await (await request(fetcher,`${url}/r/blockhash/${h}`)).text()).trim().replace(/^"|"$/g,'');if(!validHash(s))throw Error('invalid block hash');return s.toLowerCase()},async rawBlock(hash){if(!validHash(hash))throw Error('invalid block hash');const s=(await (await request(fetcher,`${url}/r/block/${hash}`)).text()).trim();if(s.length>16*1024*1024 || s.length%2 || !/^[a-f0-9]+$/i.test(s))throw Error('invalid block hex');return Buffer.from(s,'hex')}};
}
export function rpcSource(url,{fetcher=fetch,authorization}={}) {
 let id=0;
 async function rpc(method,params){const headers={'content-type':'application/json'};if(authorization)headers.authorization=authorization;const r=await request(fetcher,url,{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});let data;try{data=await r.json()}catch{throw Error('invalid RPC response')}if(data.error || data.result===undefined)throw Error('RPC request failed');return data.result}
 return {async blockHash(h){heightCheck(h);const s=await rpc('getblockhash',[h]);if(!validHash(s))throw Error('invalid block hash');return s.toLowerCase()},async rawBlock(hash){if(!validHash(hash))throw Error('invalid block hash');const s=await rpc('getblock',[hash,0]);if(typeof s!=='string'||s.length>16*1024*1024||s.length%2||!/^[a-f0-9]+$/i.test(s))throw Error('invalid block hex');return Buffer.from(s,'hex')}};
}
