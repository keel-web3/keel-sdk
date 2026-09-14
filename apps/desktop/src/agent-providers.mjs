import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { runLocalAgent, localAgentCommand } from './providers.mjs';
import { AGENT_INSTRUCTIONS } from './agent-context.mjs';

/** Only the spawned Claude client receives this short-lived, authenticated endpoint. */
export async function serveAgentTools(tools, signal) {
  const token = randomBytes(32).toString('hex'); const transports = new Set();
  let expectedHost;
  const server = createServer(async (req,res) => {
    if (req.headers.host !== expectedHost || req.headers.origin || req.url !== '/mcp' || req.headers.authorization !== `Bearer ${token}`) { res.writeHead(403); res.end(); return; }
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
    let size=0; const chunks=[];
    try {
      for await (const chunk of req) {size+=chunk.length;if(size>300000)throw Error('Request too large.');chunks.push(chunk);}
      signal.throwIfAborted();
      const mcp = new McpServer({name:'keel_editor',version:'1.0'});
      for(const entry of tools)mcp.registerTool(entry.name,{description:entry.description,inputSchema:entry.schema},async input=>{
        try{return {content:[{type:'text',text:await entry.invoke(input)}]};}catch(error){return {isError:true,content:[{type:'text',text:String(error.message).slice(0,1000)}]};}
      });
      const transport = new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
      transports.add(transport);res.on('close',()=>{transports.delete(transport);void transport.close();void mcp.close();});
      await mcp.connect(transport);await transport.handleRequest(req,res,JSON.parse(Buffer.concat(chunks).toString('utf8')));
    }catch{if(!res.headersSent)res.writeHead(400);res.end();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  expectedHost=`127.0.0.1:${server.address().port}`;
  const close=()=>{for(const transport of transports)void transport.close();server.close();server.closeAllConnections();};
  signal.addEventListener('abort',close,{once:true});
  return {config:{mcpServers:{keel_editor:{type:'http',url:`http://${expectedHost}/mcp`,headers:{Authorization:`Bearer ${token}`}}}},close:()=>{signal.removeEventListener('abort',close);close();}};
}

export async function runAgentProvider({chat,messages,systemPrompt,tools,signal,onText,readKey,cwd,modelOverride}) {
  if(chat.provider==='codex'||chat.provider==='claude'){
    const endpoint=chat.provider==='claude'?await serveAgentTools(tools,signal):null;
    try{return await runLocalAgent(chat.provider,messages.map(item=>`${item.role.toUpperCase()}:\n${item.content}`).join('\n\n'),cwd,{
      command:await localAgentCommand(chat.provider),signal,onText,instructions:systemPrompt,model:chat.model||undefined,tools,mcpConfig:endpoint?.config,
      handleTool:async(name,args)=>{const entry=tools.find(item=>item.name===name);if(!entry)throw Error('Unknown KEEL tool.');return entry.invoke(args);},
    });}finally{endpoint?.close();}
  }
  if(!['openai','anthropic'].includes(chat.provider))throw Error('Unknown assistant connection.');
  if(!chat.model)throw Error('Choose a model ID for this API connection.');
  const {createAgent}=await import('langchain');
  let model=modelOverride;
  if(!model){
    const apiKey=readKey(chat.provider);
    if(chat.provider==='openai'){
      const {ChatOpenAI}=await import('@langchain/openai');
      model=new ChatOpenAI({model:chat.model,apiKey,maxRetries:0,timeout:120000,useResponsesApi:true,modelKwargs:{store:false},maxTokens:6000});
    }else{
      const {ChatAnthropic}=await import('@langchain/anthropic');
      model=new ChatAnthropic({model:chat.model,apiKey,maxRetries:0,timeout:120000,maxTokens:6000});
    }
  }
  const agent=createAgent({model,tools:tools.map(item=>item.langchain),systemPrompt:systemPrompt??AGENT_INSTRUCTIONS});
  let text='';
  // SQLite owns durable, per-chat history. No in-memory checkpointer can leak another chat.
  const stream=await agent.stream({messages},{signal,recursionLimit:40,streamMode:'messages',callbacks:[]});
  for await(const [chunk]of stream){
    if(chunk.type!=='ai'&&chunk._getType?.()!=='ai')continue;
    const delta=typeof chunk.content==='string'?chunk.content:chunk.content?.filter(item=>item.type==='text').map(item=>item.text).join('')??'';
    if(delta){text+=delta;if(text.length>200000)throw Error('Reply exceeded its output limit.');onText(delta);}
  }
  return {text,provider:chat.provider,model:chat.model};
}
