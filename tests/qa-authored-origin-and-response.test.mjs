import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {resolveAuthoredRuntime} from '../packages/mcp/dist/authored-runtime-resolution.js';
import {authoredRuntimeResolutionFixture} from './helpers/authored-published-fixture.mjs';
for(const mode of ['cross-origin','denial-redaction','redirect','wrong-content-type','invalid-utf8','malformed-pin'])test(`QA authored authority ${mode}`,async()=>{
 const root=await mkdtemp('/private/tmp/keel-qa-authored-origin-'),prior={fetch:globalThis.fetch,url:process.env.KEEL_STUDIO_URL,token:process.env.KEEL_STUDIO_AGENT_TOKEN};let requests=0;
 try{
 process.env.KEEL_STUDIO_URL='https://studio.invalid';process.env.KEEL_STUDIO_AGENT_TOKEN='keel_agent_'+'q'.repeat(32);
 globalThis.fetch=async(url,options)=>{requests++;assert.equal(new URL(url).origin,'https://studio.invalid');assert.ok(!String(url).includes(process.env.KEEL_STUDIO_AGENT_TOKEN));assert.equal(options.headers.authorization,'Bearer '+process.env.KEEL_STUDIO_AGENT_TOKEN);assert.equal(options.redirect,'error');
 if(mode==='denial-redaction')return new Response('private sentinel DO_NOT_EXPOSE',{status:403});
 if(mode==='redirect')return new Response('',{status:302,headers:{location:'https://unapproved.invalid'}});
 if(mode==='wrong-content-type')return new Response('{}',{headers:{'content-type':'text/html'}});
 if(mode==='invalid-utf8')return new Response(Uint8Array.of(0xff),{headers:{'content-type':'application/json'}});
 const body=await authoredRuntimeResolutionFixture();body.pin.blockHash='not-a-hash';return new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
 };
 await assert.rejects(resolveAuthoredRuntime({workspace:{root}},{runtime:'three',version:'0.180.0',chainId:11155111,...(mode==='cross-origin'?{studioUrl:'https://unapproved.invalid'}:{})}),error=>{assert.ok(!error.message.includes('DO_NOT_EXPOSE'));assert.ok(!error.message.includes(process.env.KEEL_STUDIO_AGENT_TOKEN));return true;});
 assert.equal(requests,mode==='cross-origin'?0:1);
 }finally{globalThis.fetch=prior.fetch;if(prior.url===undefined)delete process.env.KEEL_STUDIO_URL;else process.env.KEEL_STUDIO_URL=prior.url;if(prior.token===undefined)delete process.env.KEEL_STUDIO_AGENT_TOKEN;else process.env.KEEL_STUDIO_AGENT_TOKEN=prior.token;await rm(root,{recursive:true,force:true});}
});
