import {parseSVGRendererRecipe} from '@keel/sdk/svg-renderer-authoring';
import { parseLayeredArt } from '@keel/sdk/layered-art';
import { withLayeredPreview } from './layered-project.mjs';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { newProject, projectSchema } from './workspace.mjs';
import { parseMetadata } from './metadata.mjs';
import { projectWithRuntime } from './runtime-library.mjs';
import { safeContext } from './agent-context.mjs';
import { contractControls, createTrackedContract } from '@keel/sdk/contract-controls';
import { registerGameEngineTools } from './game-engine/agent-game-tools.mjs';
import { registerGameBuilderTools } from './game-engine/agent-builder-tools.mjs';
import { registerGameSoundTools } from './game-engine/agent-sound-tools.mjs';
import { registerGameCodecTools } from './game-engine/agent-codec-tools.mjs';
import { registerGameLevelTools } from './game-engine/agent-level-tools.mjs';

export const viewSchema = z.object({ page: z.enum(['Projects','Objects','Modules','GameEngine','Contracts','Wallets','Memory','Connections','Agents']), projectId: z.string().uuid().optional(), contractId: z.string().max(128).optional(), tab: z.enum(['Game','Builder','Sound','Level','Layers','SVG renderer','Preview','Source','Metadata','Viewing','Release','Manage','Resources','Notes']).optional(), search: z.string().max(160).optional() }).strict();
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const uuid = z.string().uuid();
const argsSchema = z.array(z.unknown()).max(64);
const SAFE_SDK = new Set(['keel-token-matrix-prepare','keel-layered-math','keel-layered-curation','keel-layered-check','keel-layered-select','keel-layered-sample','keel-layered-reveal-plan','keel-engine-catalog','keel-revision-plan','keel-project-decisions','keel-contract-controls','analyze','media-optimize','media-optimize-apply','build','verify','cost','upload-plan','chain-plan','ethereum-encode','publish-plan','module-resolve','module-lock','wallet-request-prepare','wallet-link','module-review-prepare','fray-auction-intake','keel-chain-guide','keel-studio-project-intake','keel-creator-collection-prepare','keel-inline-prepare','keel-shell-prepare','keel-tezos-shell-prepare']);
export const publicationIntentForProject = project => project?.publication ? 'existing-graph-revision' : 'new-object';

export function createAgentTools({ workspace, chats, chat, run, hooks, signal, emit }) {
  let calls = 0;
  const list = [];
  function register(name, description, schema, execute, accessLevel = 'workspace') {
    // All providers receive only capabilities enabled for this reply. Do not
    // advertise forbidden tools and leave the model to discover the setting by failing.
    if (chat.contextMode === 'none' && accessLevel !== 'chat') return;
    if (accessLevel === 'edit' && !chat.allowEdits) return;
    const invoke = async input => {
      signal.throwIfAborted();
      if (++calls > 30) throw Error('This reply reached its tool limit. Continue with another message.');
      const parsed = schema.parse(input);
      emit({ type: 'tool', name, status: 'running' });
      try {
        const output = await execute(parsed); signal.throwIfAborted();
        const cleaned = safeContext(output ?? { done: true });
        const text = JSON.stringify(cleaned);
        if (text.length > 90000) throw Error('Result is too large. Narrow the request.');
        emit({ type: 'tool', name, status: 'completed' });
        return text;
      } catch (error) { emit({ type: 'tool', name, status: 'failed', message: String(error.message).slice(0,500) }); throw error; }
    };
    list.push({ name, description, schema, inputSchema: z.toJSONSchema(schema), invoke, langchain: tool(invoke, {name, description, schema}) });
  }
  function access() { if (chat.contextMode === 'none') throw Error('Saved work is off for this chat. Use the Use saved work button above the message box to enable it.'); }
  function project(id = chat.projectId) {
    access();
    if (chat.projectId && id !== chat.projectId) throw Error('This chat is limited to its selected project. Start another chat to work on a different project.');
    const value = workspace.read().state.projects.find(item => item.id === id);
    if (!value) throw Error('Choose an existing project first.');
    return value;
  }
  function canEdit() { access(); if (!chat.allowEdits) throw Error('Draft creation and editing are disabled for this chat.'); }
  function action(kind, title, payload) { signal.throwIfAborted(); const item = chats.action(run, kind, title, payload); emit({type:'action', action:item}); return { actionId:item.id, status:'awaiting-creator', title }; }
  const noArgs = z.object({}).strict();
  register('keel_editor_context', 'See the current editor view and saved workspace inventory. Contains public labels only, never credentials.', noArgs, () => {
    access(); const state = workspace.read().state;
    return { view: hooks.view(), revision: workspace.read().revision, projects: state.projects.filter(item => !chat.projectId || item.id === chat.projectId).map(({id,title,intent})=>({id,title,intent})), networks: hooks.networks(), wallets: hooks.wallets() };
  });
  register('keel_read_project', 'Read one project, metadata, intent, attached files and contract identities. Use keel_read_source for source text.', z.object({projectId:uuid}).strict(), ({projectId}) => { const p = project(projectId); return {...p,...(p.layerCuration?{layerCuration:{mode:p.layerCuration.mode,supply:p.layerCuration.supply,candidates:p.layerCuration.candidates.length,set:p.layerCuration.set.length}}:{}),...(p.layered?{layered:{...p.layered,attributes:p.layered.attributes.map(a=>({id:a.id,name:a.name,items:a.items.length})),readWith:'keel_read_layers'}}:{}), files:p.files.map(({content,...file})=>({...file,characters:content.length})), fingerprint:digest(p)}; });
  register('keel_read_source', 'Read a bounded section of a source file. Offset is a character offset. Never reads files outside this saved project.', z.object({projectId:uuid,fileId:uuid,offset:z.number().int().min(0).default(0),length:z.number().int().min(1).max(24000).default(16000)}).strict(), ({projectId,fileId,offset,length}) => {
    const file = project(projectId).files.find(item=>item.id===fileId); if(!file)throw Error('Source file not found.');
    return {id:file.id,name:file.name,content:file.content.slice(offset,offset+length),offset,totalCharacters:file.content.length,fingerprint:digest(file)};
  });
  register('keel_create_project', 'Create a NEW local artwork draft with HTML inside KEEL’s canonical shell. Set runtime to three to link the shared Three.js r180 library, then import from "three". Set p5 for the shared p5.js library. Never bundle those libraries in artwork source. Only use when the creator asks to create work. Does not publish.', z.object({title:z.string().trim().min(1).max(160),html:z.string().max(200000).optional(),description:z.string().max(4000).optional(),runtime:z.enum(['html','three','p5']).default('html')}).strict(), input => {
    canEdit(); if(chat.projectId)throw Error('This chat already belongs to a project. Propose an edit here, or use a workspace chat to create another project.');
    const p = newProject(input.title, input.runtime); if(input.html!==undefined)p.files[0].content=input.html;
    if(input.description)p.metadata={name:input.title,description:input.description};
    const current=workspace.read(); signal.throwIfAborted(); workspace.save({...current.state,projects:[...current.state.projects,p]},current.revision);
    emit({type:'workspace'}); action('navigate',`Open ${p.title}`,{page:'Projects',projectId:p.id,tab:'Preview'});
    return {created:true,projectId:p.id,title:p.title,localOnly:true,runtimeModules:p.runtimeModules};
  }, 'edit');
  register('keel_edit_project', 'Prepare a reviewable edit to existing artwork, source, metadata or creative notes. Existing files and source changes are preserved until the creator applies this exact review.', z.object({projectId:uuid,summary:z.string().min(1).max(500),title:z.string().max(160).optional(),html:z.string().max(200000).optional(),fileId:uuid.optional(),fileName:z.string().max(160).optional(),metadataJson:z.string().max(64000).optional(),notes:z.string().max(4000).optional(),intentJson:z.string().max(8000).optional(),svgRendererJson:z.string().max(16000).optional(),layeredJson:z.string().max(2000000).optional(),layerCurationJson:z.string().max(8000000).optional(),runtime:z.enum(['html','three','p5']).optional()}).strict(), input => {
    canEdit(); const p=project(input.projectId); const next=structuredClone(p);
    if(input.title!==undefined)next.title=input.title;
    if(input.notes!==undefined)next.notes=input.notes;
    if(input.intentJson!==undefined){const patch=JSON.parse(input.intentJson);if(!patch||typeof patch!=='object'||Array.isArray(patch))throw Error('Intent must be an object.');next.intent={...next.intent,...patch};}
    if(input.metadataJson!==undefined)next.metadata=parseMetadata(JSON.parse(input.metadataJson));
    if(input.html!==undefined){
      const fileId=input.fileId??next.files.find(item=>item.type==='text/html')?.id;
      if(input.fileId&&!next.files.some(item=>item.id===input.fileId))throw Error('Selected source file no longer exists.');
      if(fileId)next.files=next.files.map(item=>item.id===fileId?{...item,content:input.html}:item);
      else next.files.push({id:randomUUID(),name:input.fileName??'index.html',type:'text/html',content:input.html});
    }
    if(input.runtime!==undefined)Object.assign(next,projectWithRuntime(next,input.runtime));
    if(input.layerCurationJson!==undefined)next.layerCuration=JSON.parse(input.layerCurationJson);
    if(input.svgRendererJson!==undefined)next.svgRenderer=parseSVGRendererRecipe(JSON.parse(input.svgRendererJson));
    if(input.layeredJson!==undefined)Object.assign(next,withLayeredPreview({...next,layered:parseLayeredArt(JSON.parse(input.layeredJson))}));
    projectSchema.parse(next);
    return action('project-edit',input.summary,{projectId:p.id,before:digest(p),previous:p,next});
  }, 'edit');
  register('keel_read_layers', 'Read layered project settings and attribute/item summaries. Drill down with attributeId, itemId and placementId to keep large projects readable.', z.object({projectId:uuid,attributeId:z.string().max(100).optional(),itemId:z.string().max(100).optional(),placementId:z.string().max(100).optional(),exceptionId:z.string().max(100).optional()}).strict(), input=>{
    const p=project(input.projectId);const art=p.layered;if(!art)throw Error('This project has no layers.');
    if(input.exceptionId){const rule=art.exceptions?.find(r=>r.id===input.exceptionId);if(!rule)throw Error('Exception not found.');return rule;}
    if(!input.attributeId)return {...art,exceptions:art.exceptions?.map(r=>({id:r.id,name:r.name,enabled:r.enabled,match:r.match,conditions:r.conditions.length,actions:r.actions.length})),attributes:art.attributes.map(a=>({id:a.id,name:a.name,items:a.items.length})),hint:'Read an attribute by its id, then an item and drawing piece.'};
    const a=art.attributes.find(a=>a.id===input.attributeId);if(!a)throw Error('Attribute not found.');
    if(!input.itemId)return {...a,items:a.items.map(i=>({id:i.id,name:i.name,weight:i.weight,variants:i.variants.length,pieces:i.placements.length}))};
    const i=a.items.find(i=>i.id===input.itemId);if(!i)throw Error('Item not found.');
    if(!input.placementId)return {...i,placements:i.placements.map(p=>({id:p.id,name:p.name,slot:p.slot,vertices:p.mask.length,mesh:!!p.mesh}))};
    const piece=i.placements.find(p=>p.id===input.placementId);if(!piece)throw Error('Drawing piece not found.');return piece;
  });
  register('keel_edit_layer_part', 'Propose an exact local layer edit without copying a whole large project. Settings JSON excludes attributes. Exception JSON has id, name, enabled, match all/any, conditions (attributeId/itemIds/mode include or exclude), and actions (kind move/hide/include/replace, attributeId/itemId, optional placementId, move slot, include/replace variantId). Conditions use original draw; no cascading. Attribute/item/piece JSON must include its stable id; existing nodes are replaced, new nodes are appended. Changes remain a creator review card.',z.object({projectId:uuid,summary:z.string().min(1).max(500),kind:z.enum(['settings','attribute','item','piece','exception']),attributeId:z.string().max(100).optional(),itemId:z.string().max(100).optional(),valueJson:z.string().max(128000)}).strict(),input=>{
    canEdit();const p=project(input.projectId),next=structuredClone(p);if(!next.layered)throw Error('Create layer settings with keel_edit_project.layeredJson first.');const value=JSON.parse(input.valueJson);if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Layer edit must be an object.');
    const upsert=(list,value)=>{if(typeof value.id!=='string')throw Error('Use a stable node id.');const index=list.findIndex(i=>i.id===value.id);if(index<0)list.push(value);else list[index]=value;};
    if(input.kind==='settings'){if('attributes' in value)throw Error('Edit attributes separately.');next.layered={...next.layered,...value};}
    else if(input.kind==='exception'){next.layered.exceptions??=[];upsert(next.layered.exceptions,value);}
    else if(input.kind==='attribute')upsert(next.layered.attributes,value);
    else{const a=next.layered.attributes.find(a=>a.id===input.attributeId);if(!a)throw Error('Attribute not found.');if(input.kind==='item')upsert(a.items,value);else{const item=a.items.find(i=>i.id===input.itemId);if(!item)throw Error('Item not found.');upsert(item.placements,value);}}
    Object.assign(next,withLayeredPreview(next));projectSchema.parse(next);return action('project-edit',input.summary,{projectId:p.id,before:digest(p),previous:p,next});
  },'edit');
  register('keel_check_layered_project', 'Run local checks, deterministic selection, sampling or reveal planning directly on a saved project, without sending a large manifest through chat.',z.object({projectId:uuid,operation:z.enum(['check','select','sample','math','reveal-plan']),count:z.number().int().min(1).max(1000).default(100),tokenId:z.string().regex(/^[1-9]\d{0,77}$/).default('1')}).strict(),async input=>{
    const p=project(input.projectId);if(!p.layered)throw Error('Project has no layer manifest.');const sdk=await import('@keel/sdk/layered-art');
    if(input.operation==='check'){const result=sdk.checkLayeredArt(p.layered,p.objectIds);return {...result,uniqueAssets:result.uniqueAssets.length,issueCount:result.issues.length,issues:result.issues.slice(0,100)};}
    if(input.operation==='math')return (await import('@keel/sdk/layered-math')).analyzeLayeredMath(p.layered,input.count,p.layered.seed);
    if(input.operation==='sample'){const result=await sdk.sampleLayeredArt(p.layered,input.count,p.layered.seed);return {...result,counts:undefined,failureCount:result.failures.length,failures:result.failures.slice(0,100),attributes:p.layered.attributes.map(a=>({id:a.id,name:a.name,observedItems:a.items.filter(i=>result.counts[`${a.id}/${i.id}`]>0).length}))};}
    if(input.operation==='select')return sdk.resolveLayeredArt(p.layered,await sdk.selectLayeredArt(p.layered,p.layered.seed,input.tokenId));
    return (await import('@keel/sdk/layered-reveal')).layeredRevealPlan(p.layered);
  });
  register('keel_layer_curation','Read, generate or curate saved candidates. Changes create an exact review card. Selection order is a local set, not a live token allocation.',z.object({projectId:uuid,operation:z.enum(['read','generate','assign','remove','stats']),candidateId:z.string().max(64).optional(),index:z.number().int().min(0).optional(),count:z.number().int().min(1).max(50).default(12),seed:z.string().max(128).default('1'),offset:z.number().int().min(0).default(0)}).strict(),async input=>{
    const p=project(input.projectId);if(!p.layered)throw Error('Create layer artwork first.');const sdk=await import('@keel/sdk/layered-curation');let value=p.layerCuration??sdk.newLayerCuration();
    if(input.operation==='read'&&input.candidateId){const candidate=value.candidates.find(c=>c.id===input.candidateId);if(!candidate)throw Error('Candidate not found.');return candidate;}
    if(input.operation==='read')return {mode:value.mode,supply:value.supply,versions:value.versions.map(v=>({id:v.id,name:v.manifest.name})),candidates:value.candidates.slice(input.offset,input.offset+50).map(({overrides,variantOverrides,...c})=>({...c,pinnedTraits:Object.keys(overrides).length,pinnedVariants:Object.keys(variantOverrides).length})),total:value.candidates.length,set:value.set.slice(input.offset,input.offset+50),setTotal:value.set.length,targets:value.targets};
    if(input.operation==='stats'){const result=await sdk.layerCurationStats(value);const counts=Object.entries(result.counts);return {...result,counts:Object.fromEntries(counts.slice(input.offset,input.offset+100)),countEntries:counts.length,failures:result.failures.slice(input.offset,input.offset+100),failureCount:result.failures.length};}
    canEdit();if(input.operation==='generate'){const start=value.candidates.length;for(let i=0;i<input.count;i++)value=(await sdk.addLayerCandidate(value,p.layered,{seed:input.seed,tokenId:String(start+i+1)})).state;}else{if(!input.candidateId)throw Error('Choose a candidate id.');value=input.operation==='assign'?sdk.assignLayerCandidate(value,input.candidateId,input.index):sdk.removeLayerCandidateFromSet(value,input.candidateId);}
    const next=projectSchema.parse({...p,layerCuration:value});return action('project-edit','Update collection candidate pool and set',{projectId:p.id,before:digest(p),previous:p,next});
  });
  register('keel_open_view', 'Show an editor page or project tab. Navigation is handled by the editor, preserving unsaved work. Background chats leave an Open button.', viewSchema, target => {
    access(); if(target.projectId)project(target.projectId);
    const item=chats.action(run,'navigate',`Open ${target.tab??target.page}`,target); emit({type:'navigate',action:item}); return {actionId:item.id,status:'navigation-requested',target};
  });
  register('keel_attach_asset', 'Suggest attaching an existing workspace asset to a project. Optionally select it as the displayed artwork or metadata image, while retaining the canonical shell.', z.object({projectId:uuid,objectId:z.string().regex(/^[a-f0-9]{64}$/),display:z.boolean().default(false),cover:z.boolean().default(false)}).strict(),input=>{
    canEdit();const p=project(input.projectId);const asset=workspace.read().state.objects.find(item=>item.id===input.objectId);if(!asset)throw Error('Import this file into KEEL first.');
    if(input.cover&&!asset.type.startsWith('image/'))throw Error('Choose an image for the metadata cover.');
    const next={...p,objectIds:[...new Set([...p.objectIds,asset.id])],...(input.display?{presentation:{...p.presentation,entryObjectId:asset.id}}:{}),...(input.cover?{metadata:{...p.metadata,image:`keel-asset://${asset.id}/raw`}}:{})};
    return action('project-edit',`Attach ${asset.name}`,{projectId:p.id,before:digest(p),previous:p,next});
  }, 'edit');
  register('keel_track_contract', 'Propose tracking an EVM contract or proxy with an uploaded ABI. This creates local controls and does not establish ownership or deploy anything.', z.object({projectId:uuid.optional(),name:z.string().min(1).max(160),address:z.string().regex(/^0x[0-9a-fA-F]{40}$/),chainId:z.number().int().positive(),kind:z.enum(['collection','standalone','custom','proxy','implementation']),abiJson:z.string().max(200000),implementation:z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional()}).strict(),input=>{
    canEdit();const projectId=input.projectId??chat.projectId;if(projectId)project(projectId);
    if(input.implementation&&input.kind!=='proxy')throw Error('An implementation link requires the proxy contract kind.');
    const record=createTrackedContract({name:input.name,address:input.address,chainId:input.chainId,kind:input.kind,source:'manual',abi:JSON.parse(input.abiJson),...(projectId?{projectId}:{}),...(input.implementation?{proxy:{kind:'custom',implementation:input.implementation}}:{})});
    if(workspace.read().state.contracts.some(c=>c.id===record.id))throw Error('This contract is already tracked. Use its existing controls.');
    return action('track-contract',`Track ${record.name}`,record);
  }, 'edit');
  register('keel_project_check', 'Run local metadata, shell, presentation and release-readiness checks against the actual saved project.', z.object({projectId:uuid}).strict(), ({projectId})=>{project(projectId);return hooks.checkProject(projectId);});
  register('keel_project_preview', 'Build the saved work using KEEL’s existing preview and canonical shell. Returns presentation facts and a button to view it.', z.object({projectId:uuid}).strict(), async ({projectId})=>{project(projectId);const result=await hooks.preview(projectId);return {result,view:action('navigate','View the artwork',{page:'Projects',projectId,tab:'Preview'})};});
  register('keel_remember', 'Propose a durable preference or project decision for the creator to review. No secrets. Project memories only apply to that project.', z.object({title:z.string().min(1).max(160),content:z.string().min(1).max(4000),projectId:uuid.optional()}).strict(), input=>{
    canEdit(); if(input.projectId)project(input.projectId); if(chat.projectId&&input.projectId!==chat.projectId)throw Error('Save this memory for the chat’s project.');
    return action('memory',`Remember: ${input.title}`,{id:randomUUID(),...input,enabled:true,source:'assistant'});
  }, 'edit');
  register('keel_search_memory', 'Find enabled saved notes relevant to this chat. Excludes other projects and disabled memories.', z.object({query:z.string().max(160)}).strict(), ({query})=>{access();return workspace.read().state.memories.filter(item=>item.enabled!==false&&(!item.projectId||item.projectId===chat.projectId)&&`${item.title} ${item.content}`.toLowerCase().includes(query.toLowerCase())).slice(0,12);});
  register('keel_search_chat', 'Find earlier messages in this chat when recent context omitted them.', z.object({query:z.string().min(1).max(160)}).strict(), ({query})=>chats.search(chat.id,query).map(({prompt,reply,status,createdAt})=>({prompt,reply:reply.slice(0,5000),status,createdAt})), 'chat');
  register('keel_find_modules', 'Search the connected Studio module library using a name, creator or digest. Catalog metadata is not publication proof.', z.object({query:z.string().min(1).max(160)}).strict(),({query})=>{access();return hooks.findModules(query);});
  register('keel_network_status', 'Inspect a saved target network and its current fees and setup. Does not change the selected chain.', z.object({profileId:uuid}).strict(),({profileId})=>{access();return hooks.networkStatus(profileId);});
  const contract = id => {
    access();const c=workspace.read().state.contracts.find(item=>item.id===id);if(!c)throw Error('Tracked contract not found.');
    if(chat.projectId){const p=project();if(c.projectId!==p.id&&!p.contractIds.includes(c.id))throw Error('Contract is not linked to this project.');}return c;
  };
  register('keel_contract_controls', 'List exact ABI methods for a tracked contract, including overloads and read/write modes.', z.object({contractId:z.string().max(128)}).strict(),({contractId})=>{const c=contract(contractId);return {id:c.id,name:c.name,chainId:c.chainId,address:c.address,controls:contractControls(c.abi)};});
  register('keel_read_contract', 'Read one tracked ABI method using a saved network. Checks chain identity before reading.', z.object({contractId:z.string().max(128),profileId:uuid,signature:z.string().max(4096),args:argsSchema}).strict(),input=>hooks.readContract({...input,contract:contract(input.contractId)}));
  register('keel_open_wallet', 'Open an installed wallet so the creator can unlock or view it. This does not connect, sign, or approve anything.', z.object({installationId:uuid}).strict(),({installationId})=>{access();return hooks.openWallet(installationId);});
  register('keel_prepare_transaction', 'Simulate and estimate one exact tracked contract call. Produces a review card; only a creator click can send it to the wallet. Use a connected account and matching saved network.', z.object({contractId:z.string().max(128),profileId:uuid,installationId:uuid,account:z.string().regex(/^0x[0-9a-fA-F]{40}$/),signature:z.string().max(4096),args:argsSchema,valueWei:z.string().regex(/^(0|[1-9]\d*)$/).max(78).default('0')}).strict(),async input=>{
    const review=await hooks.prepareTransaction({...input,contract:contract(input.contractId)});
    return action('wallet-review',`Review ${review.signature}`,{review,family:'ethereum'});
  });
  register('keel_prepare_tezos_transaction', 'Estimate a Tezos transfer or contract entrypoint for an already paired wallet. Produces a creator review; never signs or sends.', z.object({walletId:z.union([z.literal('beacon'),uuid]),label:z.string().min(1).max(160),destination:z.string().max(64),amountMutez:z.string().regex(/^(0|[1-9]\d*)$/).max(30),entrypoint:z.string().max(31).optional(),parameters:z.string().max(64000).optional()}).strict(),async input=>{access();return action('wallet-review',input.label,{review:await hooks.prepareTezos(input),family:'tezos'});});
  register('keel_sdk_catalog', 'Discover every SDK/MCP capability, exact input schema and whether it runs here or needs the Release guide. Filter by task words.', z.object({query:z.string().max(160).default('')}).strict(),async ({query})=>{
    const {TOOL_DEFINITIONS}=await import('@keel/mcp');const matches=TOOL_DEFINITIONS.filter(item=>`${item.descriptor.name} ${item.descriptor.description}`.toLowerCase().includes(query.toLowerCase()));return {matches:matches.length,tools:matches.map(item=>({...item.descriptor,...(!query?{inputSchema:undefined}:{}),execution:SAFE_SDK.has(item.descriptor.name)?(chat.contextMode==='none'?'requires-workspace-access':'local-tool'):'editor-release-or-network-guide'})),hint:query?'Use exact arguments for the selected tool.':'Search by exact tool name for its input schema.'};
  }, 'chat');
  let sdk;
  register('keel_sdk_call', 'Execute a discovered local KEEL SDK/MCP tool using its exact JSON arguments. Source files are copied to a private work folder for this reply. Uploads and publication use the Release guide.', z.object({name:z.string().max(120),argumentsJson:z.string().max(100000)}).strict(),async ({name,argumentsJson})=>{
    access();if(!SAFE_SDK.has(name))throw Error('This operation uses the Release or Network guide. Open that editor view for the creator.');
    const argumentsValue=JSON.parse(argumentsJson);
    if(name==='publish-plan'&&chat.projectId){
      if(!argumentsValue||typeof argumentsValue!=='object'||Array.isArray(argumentsValue))throw Error('publish-plan arguments must be an object.');
      const derived=publicationIntentForProject(project());
      if(argumentsValue.publicationIntent!==undefined&&argumentsValue.publicationIntent!==derived)throw Error(derived==='existing-graph-revision'?'This project is already published. Use its existing graph revision and reuse unchanged objects.':'This project has no publication yet. Use the new-object path.');
      argumentsValue.publicationIntent=derived;
    }
    if(!sdk){
      const root=path.join(hooks.workRoot,run.id);await mkdir(root,{recursive:true,mode:0o700});
      if(chat.projectId)for(const file of project().files){signal.throwIfAborted();const target=path.join(root,file.name);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,file.content,{mode:0o600,flag:'wx'});}
      const {createMcpServer}=await import('@keel/mcp');sdk=await createMcpServer({workspaceRoot:root});
      await sdk.handle({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'keel-editor-agent',version:'1.0'}}});
    }
    const result=await sdk.handle({jsonrpc:'2.0',id:2,method:'tools/call',params:{name,arguments:argumentsValue}});
    if(result.error||result.result?.isError)throw Error(result.error?.message??result.result.content?.[0]?.text??'SDK tool failed.');return result.result?.structuredContent??result.result;
  });
  registerGameEngineTools({ register, project, canEdit, access, action, hooks, digest });
  registerGameBuilderTools({ register, project, canEdit, access, action, hooks, digest, workspace, navigate: (title, target) => { signal.throwIfAborted(); const item = chats.action(run, 'navigate', title, target); emit({ type: 'navigate', action: item }); return item; } });
  registerGameSoundTools({ register, project, canEdit, access, action, hooks, digest, navigate: (title, target) => { signal.throwIfAborted(); const item = chats.action(run, 'navigate', title, target); emit({ type: 'navigate', action: item }); return item; } });
  registerGameCodecTools({ register, project, access, hooks, workspace });
  registerGameLevelTools({ register, project, canEdit, access, action, hooks, digest, navigate: (title, target) => { signal.throwIfAborted(); const item = chats.action(run, 'navigate', title, target); emit({ type: 'navigate', action: item }); return item; } });
  return list;
}
