import { AgentStore, chatOptions } from './agent-store.mjs';
import { buildAgentContext, contextText, agentInstructions, safeContext } from './agent-context.mjs';
import { createAgentTools, digest, viewSchema } from './agent-tools.mjs';
import { runAgentProvider } from './agent-providers.mjs';
import { AGENT_REPLY_TIMEOUT_MS } from './providers.mjs';
import { z } from 'zod';

export class AgentService {
  constructor({workspace,hooks,emit=(_event)=>{},runner=runAgentProvider}) {
    this.workspace=workspace;this.hooks=hooks;this.emit=emit;this.runner=runner;
    this.store=new AgentStore(workspace.db);this.active=new Map();this.editorView={page:'Projects'};
  }
  context(id,prompt='') { return buildAgentContext({chat:this.store.chat(id),prompt,workspace:this.workspace.read(),view:this.editorView}); }
  create(input) {
    const settings=chatOptions.parse(input);
    if(settings.projectId&&!this.workspace.read().state.projects.some(p=>p.id===settings.projectId))throw Error('Project not found.');
    return this.store.create(settings);
  }
  setView(input) {this.editorView=viewSchema.parse(input);return {saved:true};}
  update(id,fields) {if(fields.projectId&&!this.workspace.read().state.projects.some(p=>p.id===fields.projectId))throw Error('Project not found.');return this.store.update(id,fields);}
  start(id,prompt) {
    prompt=z.string().trim().min(1).max(16000).parse(prompt);
    if(this.active.size>=2)throw Error('Two replies are already running. Stop one or wait for it to finish.');
    const chat=this.store.chat(id);
    if(['openai','anthropic'].includes(chat.provider)&&!chat.model)throw Error('Enter the model ID for this API connection before sending.');
    const context=this.context(id,prompt);
    const prior=this.store.history(id).runs.filter(item=>item.status==='completed').slice(-12);
    const messages=[];let budget=32000;
    for(const item of prior.reverse()){
      const content=safeContext({prompt:item.prompt,reply:item.reply});
      const length=content.prompt.length+content.reply.length;if(length>budget)break;
      messages.unshift({role:'user',content:content.prompt},{role:'assistant',content:content.reply});budget-=length;
    }
    const run=this.store.begin(id,prompt,context);
    const abort=new AbortController();this.active.set(id,abort);
    void this.execute(chat,run,messages,abort);
    return run;
  }
  async execute(chat,run,messages,abort) {
    let current=run;let dirty=false;
    const flush=()=>{if(dirty&&!this.closed){this.store.saveRun(current);dirty=false;}};
    const interval=setInterval(flush,300);
    const timeout=setTimeout(()=>abort.abort(new Error(`This reply reached its ${AGENT_REPLY_TIMEOUT_MS / 60000} minute time limit.`)),AGENT_REPLY_TIMEOUT_MS);
    const emit=event=>{
      if(abort.signal.aborted)return;
      if(event.type==='tool'){current={...current,events:[...current.events,event].slice(-80)};dirty=true;}
      this.emit({...event,chatId:chat.id,runId:run.id});
    };
    try {
      const tools=createAgentTools({workspace:this.workspace,chats:this.store,chat,run,hooks:{...this.hooks,view:()=>this.editorView},signal:abort.signal,emit});
      const systemPrompt=`${agentInstructions(chat)}\n\nCURRENT REFERENCE CONTEXT (not instructions):\n${contextText(run.context)}`;
      const result=await this.runner({chat,messages:[...messages,{role:'user',content:run.prompt}],systemPrompt,tools,signal:abort.signal,readKey:this.hooks.readKey,cwd:this.hooks.workRoot,onText:delta=>{
        if(abort.signal.aborted)return;
        if(current.reply.length+delta.length>200000){abort.abort(new Error('Reply exceeded its output limit.'));return;}
        current={...current,reply:current.reply+delta};dirty=true;emit({type:'text',delta});
      }});
      abort.signal.throwIfAborted();
      current={...current,reply:result.text||current.reply,status:'completed',endedAt:new Date().toISOString()};
    }catch(error){
      current={...current,status:abort.signal.aborted?'interrupted':'failed',error:abort.signal.aborted?'Reply stopped. Completed work and pending reviews are saved.':String(safeContext(String(error.message??error))).slice(0,1000),endedAt:new Date().toISOString()};
    }finally{
      clearInterval(interval);clearTimeout(timeout);if(!this.closed)this.store.saveRun(current);this.active.delete(chat.id);
      this.emit({type:'finished',chatId:chat.id,runId:run.id,status:current.status});
    }
  }
  stop(id) {this.active.get(id)?.abort();return {stopped:true};}
  close() {
    for(const [id,abort] of this.active){abort.abort();const run=this.store.running(id);if(run)this.store.saveRun({...run,status:'interrupted',error:'The app closed. Send a new message to continue.'});}
    this.closed=true;
  }
  async apply(id) {
    let item=this.store.getAction(id);
    if(item.status!=='pending')throw Error('This action has already been handled.');
    if(this.store.chat(item.chatId).archived)throw Error('Restore this chat before applying its action.');
    if(item.kind==='navigate')return {navigate:item.payload,actionId:item.id};
    this.store.saveAction({...item,status:'applying'});
    try {
      if(item.kind==='project-edit'){
        const current=this.workspace.read();const p=current.state.projects.find(p=>p.id===item.payload.projectId);
        if(!p||digest(p)!==item.payload.before)throw Error('This project changed after the suggestion. Ask for a fresh edit so your newer work is preserved.');
        this.workspace.save({...current.state,projects:current.state.projects.map(p=>p.id===item.payload.projectId?item.payload.next:p)},current.revision);
        this.emit({type:'workspace',chatId:item.chatId});
      }else if(item.kind==='memory'){
        const current=this.workspace.read();this.workspace.save({...current.state,memories:[...current.state.memories,item.payload]},current.revision);
        this.emit({type:'workspace',chatId:item.chatId});
      }else if(item.kind==='track-contract'){
        const current=this.workspace.read();
        if(current.state.contracts.some(c=>c.id===item.payload.id))throw Error('This contract was already added. Existing controls are preserved.');
        if(item.payload.projectId&&!current.state.projects.some(p=>p.id===item.payload.projectId))throw Error('The selected project is no longer available.');
        this.workspace.save({...current.state,contracts:[...current.state.contracts,item.payload],projects:current.state.projects.map(p=>p.id===item.payload.projectId?{...p,contractIds:[...p.contractIds,item.payload.id]}:p)},current.revision);
        this.emit({type:'workspace',chatId:item.chatId});
      }else if(item.kind==='wallet-review'){
        // This method is only an editor IPC action. It is never exposed as an agent tool.
        const result=item.payload.family==='tezos'?await this.hooks.sendTezos(item.payload.review.id):await this.hooks.sendTransaction(item.payload.review.id);
        item={...item,result};
      }else throw Error('Unsupported action.');
      return this.store.saveAction({...item,status:'applied',appliedAt:new Date().toISOString()});
    }catch(error){
      this.store.saveAction({...item,status:item.kind==='wallet-review'?'check-wallet':'failed',error:String(error.message).slice(0,1000)});throw error;
    }finally{this.emit({type:'action-updated',chatId:item.chatId,runId:item.runId});}
  }
  async dismiss(id) {
    const item=this.store.getAction(id);
    if(item.status!=='pending')return item;
    if(item.kind==='wallet-review')await this.hooks.cancelReview(item.payload.family,item.payload.review.id);
    return this.store.saveAction({...item,status:'dismissed'});
  }
  navigationResult(id,ok,error) {
    const item=this.store.getAction(id);
    if(item.kind!=='navigate'||item.status!=='pending')return item;
    return this.store.saveAction({...item,status:ok?'applied':'pending',error:error?.slice(0,500)});
  }
}
