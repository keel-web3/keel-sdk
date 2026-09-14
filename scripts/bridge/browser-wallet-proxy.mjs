/** Test-only reverse proxy: inject an Anvil-backed EIP-1193 wallet on localhost.
 * No production bundle changes, external RPCs or user wallet keys. */
import http from 'node:http';
const upstream='http://127.0.0.1:4329',rpc='http://127.0.0.1:18547';
const wallet=`<script>
window.ethereum={isMetaMask:true,isKeelDisposableTestWallet:true,on(){},removeListener(){},async request({method,params}){
 if(method==='eth_requestAccounts')method='eth_accounts';
 if(method==='wallet_switchEthereumChain'){if(params[0].chainId!=='0x7a69')throw Object.assign(new Error('Disposable wallet only supports chain 31337'),{code:4902});return null;}
 const r=await fetch('${rpc}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params:params||[]})});const j=await r.json();if(j.error)throw Object.assign(new Error(j.error.message),{code:j.error.code});return j.result;
}};
</script>`;
http.createServer(async(req,res)=>{
 try{const headers={...req.headers};delete headers.host;delete headers['accept-encoding'];const r=await fetch(upstream+req.url,{method:req.method,headers,redirect:'manual'});const h=Object.fromEntries(r.headers);delete h['content-length'];delete h['content-encoding'];delete h['transfer-encoding'];res.writeHead(r.status,h);if((h['content-type']||'').includes('text/html'))res.end((await r.text()).replace('<head>','<head>'+wallet));else res.end(Buffer.from(await r.arrayBuffer()));}
 catch(e){res.writeHead(502);res.end(String(e));}
}).listen(4328,'127.0.0.1',()=>console.log('Local disposable wallet test proxy: http://127.0.0.1:4328'));
