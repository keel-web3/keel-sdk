import test from 'node:test';
import assert from 'node:assert/strict';
import { AIMessage } from '@langchain/core/messages';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { runAgentProvider,serveAgentTools } from '../src/agent-providers.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

class TestModel extends BaseChatModel {
  constructor(){super({});this.calls=0;}
  _llmType(){return 'keel-test-model';}
  bindTools(){return this;}
  async _generate(messages){this.calls++;const message=this.calls===1?new AIMessage({content:'',tool_calls:[{id:'test-call',name:'keel_test',args:{title:'Draft'},type:'tool_call'}]}):new AIMessage('Created the local draft.');return {generations:[{text:'',message}]};}
}
test('LangChain runs the real model/tool loop and streams its result without an API key',async()=>{
  let invoked=0;let streamed='';const model=new TestModel();const entry={name:'keel_test',langchain:tool(async({title})=>{invoked++;return `created ${title}`;},{name:'keel_test',description:'Create a disposable test draft',schema:z.object({title:z.string()})})};
  const result=await runAgentProvider({chat:{provider:'openai',model:'test'},messages:[{role:'user',content:'Create a draft'}],systemPrompt:'Use the test tool.',tools:[entry],signal:new AbortController().signal,onText:text=>streamed+=text,readKey:()=>{throw Error('No keys in tests');},cwd:'/tmp',modelOverride:model});
  assert.equal(invoked,1);assert.equal(model.calls,2);assert.match(result.text,/Created/);assert.equal(result.text,streamed);
});
test('Claude tool server requires its private token and exposes only supplied tools',async()=>{
  const signal=new AbortController();const schema=z.object({name:z.string()}).strict();let calls=0;
  const endpoint=await serveAgentTools([{name:'keel_test',description:'A keyless test tool',schema,invoke:async({name})=>{calls++;return name;}}],signal.signal);
  const config=endpoint.config.mcpServers.keel_editor;
  try{
    assert.equal((await fetch(config.url,{method:'POST',body:'{}'})).status,403);
    assert.equal((await fetch(config.url,{method:'POST',headers:{...config.headers,Origin:'https://evil.example'},body:'{}'})).status,403);
    const transport=new StreamableHTTPClientTransport(new URL(config.url),{requestInit:{headers:config.headers}});
    const client=new Client({name:'keel-test',version:'1.0'});await client.connect(transport);
    assert.deepEqual((await client.listTools()).tools.map(t=>t.name),['keel_test']);
    const result=await client.callTool({name:'keel_test',arguments:{name:'OK'}});assert.equal(result.content[0].text,'OK');assert.equal(calls,1);
    await client.close();
  }finally{endpoint.close();signal.abort();}
});
