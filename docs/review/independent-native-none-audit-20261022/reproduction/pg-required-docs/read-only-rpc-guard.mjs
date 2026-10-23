import {createHash}from'node:crypto';
const sha=x=>createHash('sha256').update(x).digest('hex');
export const READ_METHODS=Object.freeze(['eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_getBlockByHash','eth_getCode','eth_call','eth_getProof','eth_getStorageAt','eth_getBalance','eth_getTransactionCount','eth_gasPrice','eth_maxPriorityFeePerGas','eth_feeHistory','eth_getTransactionReceipt','eth_getTransactionByHash','eth_getLogs','eth_estimateGas','net_version','web3_clientVersion']);
export function configuredRpcRecipientHashes(values){
 const invalid=()=>{throw new Error('Qualification configured RPC recipient is invalid.')};
 if(!Array.isArray(values))return invalid();
 return [...new Set(values.map(value=>{
  let url;try{if(typeof value!=='string')return invalid();url=new URL(value)}catch{return invalid()}
  const authority=/^[a-z][a-z\d+.-]*:\/\/([^/?#]*)/iu.exec(value)?.[1];
  if(!['https:','http:'].includes(url.protocol)||!authority||authority.includes('@')||url.username||url.password||url.href.includes('#'))return invalid();
  return sha(url.toString());
 }))];
}
export function readOnlyRpcGuard(realFetch,allowedURLHashes,observations,signingGuard){
 const urls=new Set(allowedURLHashes),methods=new Set(READ_METHODS);let terminal=false;
 const fail=(phase,evidence={})=>{terminal=true;observations.push({kind:'denied-before-disclosure',phase,...evidence});throw Object.assign(new Error('Qualification refused an unapproved or mutating RPC request before disclosure.'),{code:'KEEL_QUALIFICATION_RPC_DENIED',phase})};
 return async(resource,init)=>{
  if(terminal||signingGuard.snapshot().denials>0)return fail('terminal');
  const supported=typeof resource==='string'||resource instanceof URL;
  let recipientHash;if(supported){try{recipientHash=configuredRpcRecipientHashes([String(resource)])[0]}catch{}}
  if(!supported||recipientHash===undefined||!urls.has(recipientHash))return fail('recipient',{resourceType:resource instanceof URL?'URL':typeof resource,...(supported?{recipientSHA256:sha(String(resource))}:{}),...(recipientHash===undefined?{}:{canonicalRecipientSHA256:recipientHash})});
  if(init?.method!=='POST'||typeof init.body!=='string'||Buffer.byteLength(init.body)>64*1024*1024)return fail('request-shape');
  let values;try{const parsed=JSON.parse(init.body);values=Array.isArray(parsed)?parsed:[parsed]}catch{return fail('malformed-request')}
  if(!values.length||values.length>1000||values.some(x=>!x||x.jsonrpc!=='2.0'||(x.params!==undefined&&!Array.isArray(x.params))||!methods.has(x.method)))return fail('method');
  if(observations.length>=100000)return fail('qualification-observation-budget');
  const item={index:observations.length,methods:values.map(x=>x.method),physicalHTTPBodyBytes:Buffer.byteLength(init.body,'utf8'),physicalHTTPBodySHA256:sha(init.body),recipientSHA256:sha(String(resource)),canonicalRecipientSHA256:recipientHash,status:null};observations.push(item);
  const response=await realFetch(resource,{...init,redirect:'error'});item.status=response.status;
  if(response.status===401||response.status===403)terminal=true;
  return response;
 };
}
