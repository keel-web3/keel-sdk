const assert = require('node:assert/strict');
const fs = require('node:fs');
const {createRequire} = require('node:module');
const root = process.env.KEEL_ROUTING_REVIEW_ROOT ?? '/Users/ravonus/dev/wt/studio-wallet-capable-routing-20261020/keel-site';
const req = createRequire('/Users/ravonus/dev/wt/studio-publication-20261019/qa-final/keel-site/apps/studio/package.json');
const ts = req('typescript');
const cache = new Map();
function load(rel) {
 if (cache.has(rel)) return cache.get(rel).exports;
 const mod={exports:{}};cache.set(rel,mod);
 const source=fs.readFileSync(root+'/'+rel,'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 new Function('require','exports','module',code)(name => name==='../../../lib/wallet-read-policy' ? load('apps/studio/src/lib/wallet-read-policy.ts') : req(name),mod.exports,mod);
 return mod.exports;
}
(async()=>{
 const {createCapableWalletReadProvider}=load('apps/studio/src/features/wallet/transactions/wallet-first-rpc.ts');
 const results=[];
 for (const message of ['invalid state root','state-root mismatch','failed to verify proof','block hash no longer canonical']) {
  let walletPayloads=0,managedPayloads=0;
  const reader=createCapableWalletReadProvider({chainId:11155111,isCurrent:()=>true,
   provider:{request:async q=>{if(q.method==='eth_chainId')return '0xaa36a7';walletPayloads++;throw Object.assign(new Error(message),{status:503});}},
   managed:{request:async q=>{if(q.method==='eth_chainId')return '0xaa36a7';managedPayloads++;return {qa:'alternate proof result'};}}});
  let outcome='success';try{await reader.request({method:'eth_getProof',params:['0x'+'11'.repeat(20),[],{blockHash:'0x'+'22'.repeat(32),requireCanonical:true}]});}catch{outcome='rejected';}
  results.push({message,walletPayloads,managedPayloads,outcome,required:'rejected with zero alternate payloads'});
 }
 console.log(JSON.stringify({scope:'actual frozen source; synthetic providers only; zero network/signing',results},null,2));
 assert.ok(results.every(x=>x.outcome==='rejected'&&x.managedPayloads===0),'An observed proof/reorg semantic failure must stay terminal even with outer503');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
