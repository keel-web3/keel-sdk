import test from 'node:test';
import assert from 'node:assert/strict';
import {createKeelMarketplaceReader,refreshKeelShellMarketplaceInfo} from '../packages/sdk/dist/marketplace-reader.js';
import {buildKeelMarketplaceDirectory,normalizeKeelMarketplaceDirectory} from '../packages/viewer/src/keel-verification-chrome.js';

const collection='0x'+'11'.repeat(20),seller='0x'+'22'.repeat(20),market='0x'+'33'.repeat(20),hash='0x'+'44'.repeat(32);
const token={chainId:11155111,collection,tokenId:'2'};
const num=n=>BigInt(n).toString(16).padStart(64,'0');
const addr=a=>a.slice(2).padStart(64,'0');
const result=(...words)=>'0x'+words.join('');
const adapter={id:'keel-market',label:'KEEL market',protocol:'keel-market@1',contract:market,href:'https://onkeel.io/collect/11155111/'+collection+'/2',currency:'ETH'};
function fixture(options={}){
  const requests=[];
  const fetchImpl=async(endpoint,init)=>{
    const body=JSON.parse(init.body);requests.push({endpoint,...body});
    if(options.denied)throw new TypeError('Permission denied');
    let value;
    if(body.method==='eth_chainId')value=endpoint.includes('wrong')?'0x1':'0xaa36a7';
    else if(body.method==='eth_getBlockByNumber')value={number:'0x123',hash,timestamp:'0x'+Math.floor(Date.now()/1000).toString(16)};
    else if(body.method==='eth_call'){
      const data=body.params[0].data;
      assert.deepEqual(body.params[1],{blockHash:hash,requireCanonical:true});
      if(data.startsWith('0x6352211e'))value=result(addr(options.owner??seller));
      else if(data.startsWith('0x8de820f6'))value=result(addr(options.unlisted?'0x'+'00'.repeat(20):seller),addr(seller),num(10n**18n),num(0),num(0),num(0),num(options.expired?1:0),num(1),num(options.escrowed?1:0));
      else if(data.startsWith('0x081812fc'))value=result(addr(options.approved===false?'0x'+'00'.repeat(20):market));
      else if(data.startsWith('0xe985e9c5'))value=result(num(options.approved===false?0:1));
      else if(data.startsWith('0x46423aa7'))value=result(num(0),num(options.cancelled?1:0),num(options.filled?1:0),num(options.filled?1:0));
      else if(data.startsWith('0xf07ec373'))value=result(num(options.counter??0));
      else throw new Error('Unexpected call');
    }else throw new Error('Unexpected RPC method');
    return new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,result:value}),{status:200});
  };
  const reader=createKeelMarketplaceReader({rpc:{family:'ethereum',chainId:token.chainId,
    endpoints:options.failover?['https://wrong.publicnode.com','https://ethereum-sepolia-rpc.publicnode.com']:['https://ethereum-sepolia-rpc.publicnode.com'],fetchImpl},markets:[options.seaport?{...adapter,id:'opensea',label:'OpenSea',protocol:'seaport@1'}:adapter]});
  return {reader,requests};
}
const order=()=>({marketId:'opensea',...token,orderHash:hash,seller,counter:'0',startTime:'1',endTime:String(Math.floor(Date.now()/1000)+3600),price:'1',currency:'ETH',href:'https://opensea.io/assets/ethereum/'+collection+'/2',sourceURI:'https://api.opensea.io/api/v2/listings/example',observedAt:new Date().toISOString(),status:'active'});

test('optional listings reuse governed RPC, pin one block, coalesce simultaneous callers and cache',async()=>{
  const {reader,requests}=fixture();const [a,b]=await Promise.all([reader.read(token),reader.read(token)]);
  assert.equal(a,b);assert.equal(a.directory.links.length,1);assert.equal(a.directory.links[0].listing.price,'1');
  const count=requests.length;assert.equal(await reader.read(token),a);assert.equal(requests.length,count);
  assert.equal(requests.filter(r=>r.method==='eth_chainId').length,1);
  assert.equal(requests.filter(r=>r.method==='eth_getBlockByNumber').length,1);
  assert.equal(a.directory.links[0].listing.check,'onchain-sale');
  assert.equal(buildKeelMarketplaceDirectory(token,a.directory).links.length,2);
});
test('wrong-chain endpoints are rejected before any token read and fail over through KEEL',async()=>{
  const {reader,requests}=fixture({failover:true});const data=await reader.read(token);
  assert.equal(data.directory.links.length,1);
  assert.ok(!requests.some(r=>r.endpoint.includes('wrong')&&r.method==='eth_call'));
  assert.equal(data.rpc.servedBy,'https://ethereum-sepolia-rpc.publicnode.com');
});
test('gallery is permanent; unknown, unlisted, expired, sold and stale links remain hidden',async()=>{
  assert.deepEqual(buildKeelMarketplaceDirectory(token).links.map(l=>l.id),['onkeel']);
  const {reader}=fixture();const data=await reader.read(token),link=data.directory.links[0];
  for(const status of ['unknown','unlisted','sold'])assert.equal(buildKeelMarketplaceDirectory(token,{...data.directory,links:[{...link,listing:{...link.listing,status}}]}).links.length,1);
  assert.equal(buildKeelMarketplaceDirectory(token,data.directory,Date.now()+61_000).links.length,1);
  assert.equal(buildKeelMarketplaceDirectory({...token,tokenId:'3'},data.directory).links.length,1);
  assert.equal(buildKeelMarketplaceDirectory(token,{...data.directory,links:[{id:'opensea',label:'OpenSea',href:'https://opensea.io',kind:'marketplace'}]}).links.length,1);
});
test('expired, missing, unapproved and transferred onchain listings are hidden; escrow is supported',async()=>{
  for(const options of [{unlisted:true},{expired:true},{approved:false},{owner:collection}])assert.equal((await fixture(options).reader.read(token)).directory.links.length,0);
  assert.equal((await fixture({escrowed:true,owner:market,approved:false}).reader.read(token)).directory.links.length,1);
});
test('offchain order snapshots require current RPC ownership, approval, counter, fill and cancellation checks',async()=>{
  assert.equal((await fixture({seaport:true}).reader.read(token,[order()])).directory.links.length,1);
  for(const options of [{cancelled:true},{filled:true},{counter:1},{approved:false},{owner:collection}])assert.equal((await fixture({...options,seaport:true}).reader.read(token,[order()])).directory.links.length,0);
  assert.equal((await fixture({seaport:true}).reader.read(token)).directory.links.length,0);
  assert.equal((await fixture({seaport:true}).reader.read(token,[{...order(),observedAt:new Date(Date.now()-65_000).toISOString()}])).directory.links.length,0);
});
test('denied RPC and denied host updates do not call any verification or artwork failure path',async()=>{
  let written=0;const before=Object.freeze({state:'verified',checks:[{passed:true}]});
  const client={setMarketplaces:async()=>{written++;},fail(){assert.fail('Optional reads must not fail verification');},verification:()=>before};
  const denied=await refreshKeelShellMarketplaceInfo({reader:fixture({denied:true}).reader,client,token});
  assert.equal(denied.available,false);assert.equal(written,0);assert.equal(client.verification(),before);
  const rejected=await refreshKeelShellMarketplaceInfo({reader:fixture().reader,client:{...client,setMarketplaces:async()=>{throw new Error('Denied');}},token});
  assert.equal(rejected.available,false);assert.equal(client.verification(),before);
});
test('listing manifest rejects proof overrides, credentials and missing chain evidence',async()=>{
  const {directory}=await fixture().reader.read(token);
  assert.throws(()=>normalizeKeelMarketplaceDirectory({...directory,state:'verified'}));
  assert.throws(()=>normalizeKeelMarketplaceDirectory({...directory,links:[{...directory.links[0],href:'https://user:secret@opensea.io'}]}));
  assert.throws(()=>normalizeKeelMarketplaceDirectory({...directory,links:[{...directory.links[0],listing:{...directory.links[0].listing,chainId:undefined}}]}));
});
