#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {recipeCheck,formCheck,marker} from '../src/mint.ts';
import {parseTx} from '../src/tx.ts';
import {scanBlocks} from '../indexer/loop.mjs';
import {blockCache} from '../indexer/cache.mjs';
import {rpcSource,esploraSource,recursionSource} from '../indexer/sources.mjs';
import {indexState} from '../src/end.ts';
import {verifyTokenEvidence} from '../src/verify/token.mjs';
import {validateChallenge,verifyPosition,applyChallenge} from '../src/challenge/index.mjs';
const read=async path=>JSON.parse(await readFile(path,'utf8'));
const args=process.argv.slice(2);
const path=args[2];
try {
 if(args[0]==='vectors' && args[1]==='--check') {
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('../spec/vectors/check.mjs',import.meta.url))],{stdio:'inherit'});process.exitCode=result.status??1;
 } else if(args[0]==='recipe' && args[1]==='check' && path) {
  const input=await read(path), errors=recipeCheck(input.recipe,input.refs);console.log(JSON.stringify({valid:errors.length===0,errors,assurance:'reference bytes and positions supplied by caller'}));if(errors.length)process.exitCode=1;
 } else if(args[0]==='index' && args[1]==='compute' && path) {
  const input=await read(path), endpoint=process.env.KOC1_SOURCE_URL;
  if((!endpoint && !input.offline) || !['rpc','esplora','recursion'].includes(input.source) || input.from > input.recipe.end.open || input.to < input.from) throw Error('source and full scan range required');
  const errors=recipeCheck(input.recipe,input.refs);if(errors.length)throw Error('invalid recipe');
  const factories={rpc:rpcSource,esplora:esploraSource,recursion:recursionSource}, source=input.offline ? null : factories[input.source](endpoint), cache=input.cacheDir ? blockCache(input.cacheDir) : undefined, candidates=[], markerBytes=Buffer.from(marker(input.recipe.id),'hex');
  const result=await scanBlocks({source,cache,offline:input.offline===true,from:input.from,to:input.to,state:null,reduceBlock:(_,block)=>{
   for(const tx of block.transactions) {
    if(tx.raw.indexOf(markerBytes)<0)continue;
    const parsed=parseTx(tx.raw);
    if(!parsed.outputs.some(o=>o.script===marker(input.recipe.id)))continue;
    const evidence=input.candidates?.[tx.txid];
    if(!evidence || !Array.isArray(evidence.charms) || !evidence.commitTx)throw Error('candidate evidence missing');
    candidates.push({...evidence,rawTx:tx.raw.toString('hex'),height:block.height,txIndex:tx.txIndex,id:tx.txid});
   }
   return null;
  }});
  const state=indexState(input.recipe,input.refs,candidates,input.to,Buffer.from(result.hash,'hex').reverse().toString('hex'),input.controls);
  console.log(JSON.stringify({height:state.h,blockhash:state.hash,count:state.count,over:state.over,indexRoot:state.indexRoot,membersRoot:state.membersRoot,overRoot:state.overRoot,assurance:input.offline ? 'cached block snapshot; current best chain not checked; reference, control and charm evidence supplied by caller' : 'raw blocks verified; reference, control and charm evidence supplied by caller',verified:false}));
 } else if(args[0]==='token' && args[1]==='verify' && path) {
  const input=await read(path), result=verifyTokenEvidence(input);
  console.log(JSON.stringify(result));process.exitCode=2;
 } else if(args[0]==='challenge' && args[1]==='verify' && path) {
  const input=await read(path);
  if(input.recipe?.id!==input.cache?.r || recipeCheck(input.recipe,input.refs).length)throw Error('challenge recipe evidence invalid');
  const resolver=id=>{
   const item=input.entries[id];if(!item || typeof item.rawTx!=='string')return null;
   let tx;try{tx=parseTx(item.rawTx)}catch{return null}
   if(tx.txid!==id || tx.end!==Buffer.from(item.rawTx,'hex').length)return null;
   const location={txid:id,height:item.height,txIndex:item.txIndex};
   if(input.challenge.kind==='invalid' && id===input.challenge.mint && verifyPosition(input.challenge,location,input.hostHashes)) {
    const marks=tx.outputs.filter(o=>o.script.startsWith('6a284b4f4331'));
    if(!tx.outputs[0] || tx.outputs[0].value<330 || marks.length!==1 || tx.outputs[2]?.script!==marker(input.recipe.id) || tx.outputs[2]?.value!==0) return {entry:location,validity:'invalid'};
   }
   if(!Array.isArray(item.charms)||!item.commitTx)return {entry:location,validity:'unknown'};
   const checked=formCheck({...item,recipe:input.recipe,refs:input.refs});
   return checked.error ? {entry:location,validity:'unknown'} : {entry:checked,validity:'valid'};
  };
  const valid=validateChallenge(input.challenge,input.cache,resolver,input.hostHashes);
  const patched=valid ? applyChallenge(input.cache.entries,input.challenge,resolver).map(x=>x.txid) : undefined;
  console.log(JSON.stringify({valid,patched,assurance:'caller-supplied host hashes and chain evidence',...(valid?{}:{status:'invalid or insufficient evidence'})}));if(!valid)process.exitCode=1;
 } else {console.error('Usage: keel-ordinals recipe check|index compute|token verify|challenge verify <evidence.json> | vectors --check');process.exitCode=2}
} catch (error) {console.error('Unable to complete command:', String(error.message ?? 'invalid input').replace(/https?:\/\/\S+/g,'[redacted]'));process.exitCode=1}
