import path from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {resolveAuthoredRuntime} from '../packages/mcp/dist/authored-runtime-resolution.js';
import {inferKeelAuthoredRuntime} from '../packages/sdk/dist/authored-project.js';
import {authoredRuntimeResolutionFixture} from './helpers/authored-published-fixture.mjs';
test('actual parsed imports infer exact supported runtime and preserve explicit version pins',()=>{
 const modules=source=>[{id:'scene-state',purpose:'State',source}];
 assert.equal(inferKeelAuthoredRuntime(modules('export function color(){return 1}')),undefined);
 assert.deepEqual(inferKeelAuthoredRuntime(modules('import {Vector3} from "three";')), {runtime:'three',version:'0.180.0'});
 assert.deepEqual(inferKeelAuthoredRuntime(modules('import {Vector3} from "three@0.180.0";')), {runtime:'three',version:'0.180.0'});
 assert.throws(()=>inferKeelAuthoredRuntime(modules('import {Vector3} from "three@0.179.0";')),/pinned version|supported/);
 assert.throws(()=>inferKeelAuthoredRuntime(modules('import {Vector3} from "three@0.180.0";'),{runtime:'three',version:'0.179.0'}),/conflicting/);
 assert.throws(()=>inferKeelAuthoredRuntime(modules('export function color(){}'),{runtime:'unknown'}),/qualified/);
});
for(const mode of ['http-401','http-403','http-429','http-503','malformed','oversized-header','oversized-stream','wrong-chain','wrong-version','source-digest','wrong-alias','wrong-license','missing-closure','wrong-fragment-codec','missing-reader-receipt'])test(`automatic runtime resolver ${mode} rejects without retry or alternate origin`,async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'keel-runtime-negative-')),wire=await authoredRuntimeResolutionFixture(),prior={fetch:globalThis.fetch,url:process.env.KEEL_STUDIO_URL,token:process.env.KEEL_STUDIO_AGENT_TOKEN};let requests=0;
 try{
 process.env.KEEL_STUDIO_URL='https://studio.invalid';process.env.KEEL_STUDIO_AGENT_TOKEN='keel_agent_'+'x'.repeat(32);
 globalThis.fetch=async(url,options)=>{requests++;assert.equal(new URL(url).origin,'https://studio.invalid');assert.equal(options.redirect,'error');assert.ok(options.signal);
  if(mode.startsWith('http-'))return new Response('credential-free failure',{status:Number(mode.slice(5))});
  if(mode==='malformed')return new Response('{',{headers:{'content-type':'application/json'}});
  if(mode==='oversized-header')return new Response('{}',{headers:{'content-type':'application/json','content-length':'1200001'}});
  if(mode==='oversized-stream')return new Response(' '.repeat(1200001),{headers:{'content-type':'application/json'}});
  if(mode==='wrong-chain')wire.chainId=1;if(mode==='wrong-version')wire.version='0.179.0';
  if(mode==='source-digest')wire.modules[0].binding.digest='sha256:'+'0'.repeat(64);
  if(mode==='wrong-alias')wire.modules[0].aliases=['unverified.js'];if(mode==='wrong-license')wire.modules[0].license='unknown';
  if(mode==='missing-closure')wire.modules.pop();if(mode==='wrong-fragment-codec')wire.modules[0].fragment.compression='gzip';
  if(mode==='missing-reader-receipt')delete wire.reader.builderDeploymentTransactionHash;
  return new Response(JSON.stringify(wire),{headers:{'content-type':'application/json'}});
 };
 await assert.rejects(resolveAuthoredRuntime({workspace:{root}},{runtime:'three',version:'0.180.0',chainId:11155111}));assert.equal(requests,1);
 }finally{globalThis.fetch=prior.fetch;if(prior.url===undefined)delete process.env.KEEL_STUDIO_URL;else process.env.KEEL_STUDIO_URL=prior.url;if(prior.token===undefined)delete process.env.KEEL_STUDIO_AGENT_TOKEN;else process.env.KEEL_STUDIO_AGENT_TOKEN=prior.token;await rm(root,{recursive:true,force:true})}
});
