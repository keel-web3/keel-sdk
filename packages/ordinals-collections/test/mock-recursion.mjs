import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {b,hex,cat,utf,u32,sha,dsha,reverse,publicPoint,cbor,push,serializeTx,parseTx,tapleaf,tapOutput,envelope,marker,escrow,merkle,compact} from '../src/core.ts';
import {indexRoot} from '../src/index/root.mjs';
import {inscriptionId} from '../src/shell/index.mjs';
export const load=name=>JSON.parse(readFileSync(new URL(`../spec/vectors/${name}.json`,import.meta.url)));
const key=publicPoint(6);
// Synthetic admission fixtures: placeholder signatures, real txid and Taproot
// commit binding. No Bitcoin client or network other than localhost is needed.
export class MockRecursion {
  constructor(){this.routes=new Map();this.assets=new Map();this.children=new Map();this.records=new Map();this.serial=0;this.stats={fetches:0,bytes:0};}
  add({metadata=null,body='',height=90,script,outputs,parent}={}) {
    const fields=[[7,utf('koc1')],...(metadata?[[5,cbor(metadata)]]:[])];
    if (!script) {
      const parts=fields.flatMap(([tag,value])=>Array.from({length:Math.ceil(value.length/520)},(_,i)=>cat(push(b([tag])),push(value.subarray(i*520,(i+1)*520)))));
      script=hex(cat(push(key),b('ac0063'),push(utf('ord')),...parts,b('00'),body?push(utf(body)):b(''),b('68')));
    }
    const q=tapOutput(key,tapleaf(script));
    const commit=hex(serializeTx({inputs:[{txid:hex(sha(utf(`commit-${this.serial++}`))),vout:0}],outputs:[{value:10000,script:'5120'+q.key}]},false));
    const tx={inputs:[{txid:parseTx(commit).txid,vout:0,witness:['00'.repeat(64),script,hex(cat(b([0xc0|q.parity]),b(key)))]}],outputs:outputs??[{value:330,script:'5120'+key}],locktime:this.serial};
    const raw=hex(serializeTx(tx)), txid=parseTx(raw).txid, id=txid+'00000000';
    const info={id:inscriptionId(id),height,charms:[]};
    this.routes.set(`/r/tx/${hex(reverse(txid))}`,raw);
    this.routes.set(`/r/tx/${hex(reverse(parseTx(commit).txid))}`,commit);
    this.routes.set(`/r/inscription/${inscriptionId(id)}`,info);
    const record={id,txid,rawTx:raw,commitTx:commit,metadata,height,info};
    this.records.set(id,record);this.children.set(id,[]);
    if(parent)this.children.get(parent).push(id);
    return record;
  }
  block(height,records){
    const header=cat(u32(1),b('00'.repeat(32)),merkle(records.map(r=>r.txid),true),u32(height),b('ffff7f20'),u32(0));
    // Serialization helpers are BE above, but only merkle/hash binding is used
    // for synthetic headers. Optional work checks have separate real vectors.
    const hash=hex(dsha(header));
    this.routes.set(`/r/block/${height}`,hex(cat(header,compact(records.length),...records.map(r=>b(r.rawTx)))));
    this.routes.set(`/r/blockhash/${height}`,hex(reverse(hash)));
    return hash;
  }
  async start(){
    this.server=createServer((req,res)=>{
      if(this.assets.has(req.url)){res.setHeader('content-type',req.url.endsWith('.js')?'text/javascript':'text/html');res.end(this.assets.get(req.url));return;}
      this.stats.fetches++;
      let value=this.routes.get(req.url);
      const match=/^\/r\/children\/([^/]+)\/inscriptions\/(\d+)$/.exec(req.url);
      if(match){
        const route=[...this.children.keys()].find(id=>inscriptionId(id)===match[1]);
        if(route){const page=Number(match[2]),ids=this.children.get(route),size=100;value={children:ids.slice(page*size,(page+1)*size).map(inscriptionId),more:(page+1)*size<ids.length,page};}
      }
      if(value===undefined){res.writeHead(404);res.end();return;}
      const text=JSON.stringify(value);this.stats.bytes+=Buffer.byteLength(text);res.setHeader('content-type','application/json');res.end(text);
    });
    await new Promise(resolve=>this.server.listen(0,'127.0.0.1',resolve));
    this.base=`http://127.0.0.1:${this.server.address().port}`;
    this.fetcher=(path,options)=>{if(!path.startsWith('/r/'))throw Error('non-recursion');return fetch(this.base+path,options)};
    return this;
  }
  async close(){await new Promise(resolve=>this.server.close(resolve));}
}
export function fixture({writers=2,seen=[],count=1}={}) {
  const mock=new MockRecursion(), r=structuredClone(load('shell-policy').cases[0].input.self.recipe);
  const refs=load('shell-policy').cases[0].input.self.refs;
  for(const ref of [...r.metadata.bundles,r.art.viewer,r.indexer]){
    const body=Buffer.from(refs[ref.id].bytes,'hex').toString(),record=mock.add({body,height:90});ref.id=record.id;ref.sha256=hex(sha(utf(body)));
  }
  const authorities=Array.from({length:3},()=>mock.add({metadata:{p:'koc1',op:'authority'}}));
  r.writers=authorities.map(a=>({authority:a.id}));delete r.id;delete r.height;delete r.txIndex;
  r.end={mode:'open',open:100};r.metadata={...r.metadata,cycle:true};
  // Existing recipeCheck requires the committed finite tree to use cycle for
  // an unbounded edition (metadata.order is independent).
  r.metadata.cycle=true;
  const recipeRecord=mock.add({metadata:r,height:99,outputs:[{value:330,script:'5120'+key},{value:0,script:marker('00'.repeat(36))}]});
  r.id=recipeRecord.id;r.height=99;r.txIndex=0;
  mock.block(99,[recipeRecord]);
  const mints=[];
  for(let i=0;i<count;i++){
    const metadata={p:'koc1',op:'mint',r:b(r.id),m:b(key),...(i===count-1&&seen.length?{seen}: {})};
    const record=mock.add({metadata,script:envelope(metadata,r.art.viewer.id),height:100,outputs:[{value:330,script:'5120'+key},{value:1000,script:escrow(r.payment,key).scriptPubKey},{value:0,script:marker(r.id)}]});
    mints.push(record);
  }
  const hash=mock.block(100,mints);
  const rows=mints.map((m,i)=>({id:m.id,txid:m.txid,height:100,txIndex:i,m:key,paymentOutpoint:m.txid+'00000001'}));
  for(let h=101;h<=106;h++)mock.routes.set(`/r/blockhash/${h}`,hex(reverse(sha(utf(`block-${h}`)))));
  mock.routes.set('/r/blockheight',106);
  const updates=[];
  for(let i=0;i<writers;i++){
    if(rows.length<=1000)updates.push(addUpdate(mock,r,authorities[i].id,rows));
    else {const first=addUpdate(mock,r,authorities[i].id,rows.slice(0,1000),{h:100});updates.push(addUpdate(mock,r,authorities[i].id,rows,{prev:first.id,prevRoot:first.metadata.root,new:rows.slice(1000)}));}
  }
  return {mock,r,authorities,mints,rows,updates,hash,self:mints.at(-1).id};
}
export function addUpdate(mock,recipe,authority,rows,{h=106,prev=null,prevRoot=null,...overrides}={}){
  const hash=hex(reverse(mock.routes.get(`/r/blockhash/${h}`))),root=indexRoot({recipe:recipe.id,height:h,blockhash:hash,members:rows,refunds:[]});
  const metadata={p:'koc1',op:'index',r:recipe.id,h,hash,root:root.indexRoot,count:rows.length,over:0,prev,prevRoot,new:prev?[]:rows,applied:[],...overrides};
  return mock.add({metadata,height:106,parent:authority});
}
