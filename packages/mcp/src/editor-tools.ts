import { createKeelEditorClient, connectKeelEditor } from '@keel/sdk/editor-client';
import type { ToolDefinition } from './types.js';

export const EDITOR_TOOL_DEFINITIONS: readonly ToolDefinition[] = ['list','read','update','open'].map(operation=>({
  descriptor:{
    name:`keel-editor-project-${operation}`,
    description:`${operation} projects in the connected KEEL desktop workspace without starting an editor chat. Set KEEL_EDITOR_SOCKET to the private workspace socket. Updates require the latest revision and preserve other projects; no wallet signing or publication.`,
    inputSchema:{type:'object',properties:operation==='list'?{}:{projectId:{type:'string'},...(operation==='update'?{revision:{type:'integer',minimum:0},patch:{type:'object',additionalProperties:true}}:{})},required:operation==='list'?[]:operation==='update'?['projectId','revision','patch']:['projectId'],additionalProperties:false},
  },
  async run(_context,value){
    if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Provide project inputs.');
    const input=value as Record<string,unknown>,allowed=operation==='list'?[]:operation==='update'?['projectId','revision','patch']:['projectId'];
    if(Object.keys(input).some(key=>!allowed.includes(key)))throw Error('Unknown editor input.');
    const socket=process.env.KEEL_EDITOR_SOCKET,connection=process.env.KEEL_EDITOR_CONNECTION;if(!socket&&!connection)throw Error('Connect this MCP to your KEEL workspace using KEEL_EDITOR_CONNECTION. No editor chat is needed.');
    const client=connection?await connectKeelEditor(connection):createKeelEditorClient(socket!);
    if(operation==='list')return client.listProjects();
    if(typeof input.projectId!=='string')throw Error('Choose a project ID from the workspace.');
    if(operation==='read')return client.readProject(input.projectId);
    if(operation==='open')return client.openProject(input.projectId);
    if(!Number.isSafeInteger(input.revision)||Number(input.revision)<0||!input.patch||typeof input.patch!=='object'||Array.isArray(input.patch))throw Error('Updates need the revision and a project patch.');
    return client.updateProject(input.projectId,input.revision as number,input.patch as Record<string,unknown>);
  },
}));
