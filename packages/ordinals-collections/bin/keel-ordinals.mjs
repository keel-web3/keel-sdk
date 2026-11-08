#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {recipeCheck,formCheck,marker} from '../src/mint.ts';
import {parseTx} from '../src/tx.ts';
import {scanBlocks} from '../indexer/loop.mjs';
import {rpcSource,esploraSource,recursionSource} from '../indexer/sources.mjs';
import {indexState} from '../src/end.ts';
import {validateChallenge} from '../src/challenge/index.mjs';
const read=async path=>JSON.parse(await readFile(path,'utf8'));
const args=process.argv.slice(2);
const path=args[2];
try {
 if(args[0]==='vectors' && args[1]==='--check') {
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('../spec/vectors/check.mjs',import.meta.url))],{stdio:'inherit'});process.exitCode=result.status??1;
 } else if(args[0]==='recipe' && args[1]==='check' && path) {
  const input=await read(path), errors=recipeCheck(input.recipe,input.refs);console.log(JSON.stringify({valid:errors.length===0,errors}));if(errors.length)process.exitCode=1;
 } else if(args[0]==='index' && args[1]==='compute' && path) {
  const input=await read(path), endpoint=process.env.KOC1_SOURCE_URL;
  if(!endpoint || !['rpc','esplora','recursion'].includes(input.source) || input.from > input.recipe.end.open || input.to < input.from) throw Error('source and full scan range required');
  const errors=recipeCheck(input.recipe,input.refs);if(errors.length)throw Error('invalid recipe');
  const factories={rpc:rpcSource,esplora:esploraSource,recursion:recursionSource}, source=factories[input.source](endpoint), candidates=[];
  const result=await scanBlocks({source,from:input.from,to:input.to,state:null,reduceBlock:(_,block)=>{
   for(const tx of block.transactions) {
    const parsed=parseTx(tx.raw);
    if(!parsed.outputs.some(o=>o.script===marker(input.recipe.id)))continue;
    const evidence=input.candidates?.[tx.txid];
    if(!evidence || !Array.isArray(evidence.charms) || !evidence.commitTx)throw Error('candidate evidence missing');
    candidates.push({...evidence,rawTx:tx.raw.toString('hex'),height:block.height,txIndex:tx.txIndex,id:tx.txid});
   }
   return null;
  }});
  const state=indexState(input.recipe,input.refs,candidates,input.to,Buffer.from(result.hash,'hex').reverse().toString('hex'),input.controls);
  console.log(JSON.stringify({height:state.h,blockhash:state.hash,count:state.count,over:state.over,indexRoot:state.indexRoot,membersRoot:state.membersRoot,overRoot:state.overRoot,assurance:'raw blocks verified; reference, control and charm evidence supplied by caller',verified:false}));
 } else if(args[0]==='token' && args[1]==='verify' && path) {
  const input=await read(path), errors=recipeCheck(input.recipe,input.refs);
  if(!Array.isArray(input.candidate?.charms)||!input.candidate?.commitTx)throw Error('candidate evidence required');
  const form=formCheck({...input.candidate,recipe:input.recipe,refs:input.refs});
  console.log(JSON.stringify({formValid:!form.error,reason:form.error??null,recipeErrors:errors,verified:false,status:'pending chain membership, position and burn evidence'}));
  process.exitCode=2;
 } else if(args[0]==='challenge' && args[1]==='verify' && path) {
  const input=await read(path);
  const resolver=id=>{const item=input.entries[id];if(!item || !Array.isArray(item.charms)||!item.commitTx)return null;const checked=formCheck({...item,recipe:input.recipe,refs:input.refs});return {entry:checked.error ? {...item,txid:id} : checked,validity:checked.error?'invalid':'valid'}};
  if(input.challenge.kind==='invalid')throw Error('independent invalidity evidence required');
  const valid=validateChallenge(input.challenge,input.cache,resolver,input.hostHashes);console.log(JSON.stringify({valid,assurance:'caller-supplied host hashes and chain evidence'}));if(!valid)process.exitCode=1;
 } else {console.error('Usage: keel-ordinals recipe check|index compute|token verify|challenge verify <evidence.json> | vectors --check');process.exitCode=2}
} catch (error) {console.error('Unable to complete command:', String(error.message ?? 'invalid input').replace(/https?:\/\/\S+/g,'[redacted]'));process.exitCode=1}
