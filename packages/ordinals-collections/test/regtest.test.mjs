import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {rpcSource,esploraSource,recursionSource} from '../indexer/sources.mjs';
import {scanBlocks} from '../indexer/loop.mjs';
import {indexRoot} from '../src/index/root.mjs';
const available=spawnSync('bitcoind',['--version'],{stdio:'ignore'}).status===0 && spawnSync('bitcoin-cli',['--version'],{stdio:'ignore'}).status===0;
test('regtest blocks produce identical roots through each source', {skip:!available,timeout:120000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'koc1-regtest-')), port=30000+Math.floor(Math.random()*20000), common=['-regtest',`-datadir=${dir}`,`-rpcport=${port}`];
 const run=(name,args)=>{const r=spawnSync(name,args,{encoding:'utf8',timeout:20000});if(r.status!==0)throw Error(`${name} failed`);return r.stdout.trim()};
 const cli=(...args)=>run('bitcoin-cli',[...common,'-rpcwait','-rpcwaittimeout=15',...args]);
 let started=false;
 try {
  run('bitcoind',[...common,'-daemon','-listen=0','-discover=0','-dnsseed=0','-server=1','-printtoconsole=0']);started=true;
  cli('createwallet','fixture');const addr=cli('-rpcwallet=fixture','getnewaddress');cli('-rpcwallet=fixture','generatetoaddress','3',addr);
  const genesis=cli('getblockhash','0'), hashes=[1,2,3].map(n=>cli('getblockhash',String(n))), blocks=new Map(hashes.map(h=>[h,cli('getblock',h,'0')]));
  const fetcher=async(url,opts)=>{
   if(opts?.method==='POST'){const q=JSON.parse(opts.body);return Response.json({result:q.method==='getblockhash'?(q.params[0]===0?genesis:hashes[q.params[0]-1]):blocks.get(q.params[0])})}
   if(url.includes('/block-height/')||url.includes('/r/blockhash/')){const h=Number(url.split('/').at(-1));return new Response(h===0?genesis:hashes[h-1])}
   const hash=url.split('/').find(x=>blocks.has(x)), hex=blocks.get(hash);
   return new Response(url.includes('/r/block/')?hex:Buffer.from(hex,'hex'));
  };
  const sources=[rpcSource('https://fixture.invalid',{fetcher}),esploraSource('https://fixture.invalid',{fetcher}),recursionSource('https://fixture.invalid',{fetcher})];
  const all=await Promise.all(sources.map(source=>scanBlocks({source,network:'regtest',from:1,to:3,state:[],reduceBlock:(roots,b)=>[...roots,indexRoot({recipe:'00'.repeat(36),height:b.height,blockhash:b.internalHash,members:[],refunds:[]}).indexRoot]})));
  assert.deepEqual(all[0],all[1]);assert.deepEqual(all[1],all[2]);assert.equal(all[0].state.length,3);
 } finally {if(started)try{cli('stop')}catch{};rmSync(dir,{recursive:true,force:true})}
});
