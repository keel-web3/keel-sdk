import { createServer } from 'node:net';
import { chmod, unlink } from 'node:fs/promises';
import { z } from 'zod';
import { withLayeredPreview } from './layered-project.mjs';

const identity = z.object({projectId:z.string().uuid()}).strict();
const revision = z.number().int().nonnegative();
// Local project editing never grants wallet access or changes publication receipts.
const editable = new Set(['title','intent','files','objectIds','runtimeModules','contractIds','targetNetworkId','creation','presentation','listing','metadata','notes','layered','layerCuration','directImage','svgRenderer','game']);
export function workspaceOperations(store, changed = () => {}, openProject) {
  return async (method, value) => {
    if (method === 'projects.list') { z.object({}).strict().parse(value); const current=store.read();return {revision:current.revision,projects:current.state.projects.map(({id,title})=>({id,title}))}; }
    if (method === 'projects.read') { const {projectId}=identity.parse(value);const current=store.read(),project=current.state.projects.find(p=>p.id===projectId);if(!project)throw Error('Project not found.');return {revision:current.revision,project,objects:current.state.objects.filter(o=>project.objectIds.includes(o.id))}; }
    if (method === 'projects.open') {
      const {projectId}=identity.parse(value);
      if(!store.read().state.projects.some(p=>p.id===projectId))throw Error('Project not found.');
      if(!openProject)throw Error('This workspace has no connected editor window.');
      await openProject(projectId);return {projectId,navigationRequested:true};
    }
    if (method === 'projects.update') {
      const input=identity.extend({revision,patch:z.record(z.string(),z.unknown())}).strict().parse(value);
      if(Object.keys(input.patch).some(key=>!editable.has(key)))throw Error('Unsupported project field. Wallets and publication receipts cannot be edited here.');
      const current=store.read();if(current.revision!==input.revision)throw Error('Workspace changed. Read the project again before updating.');
      const before=current.state.projects.find(p=>p.id===input.projectId);if(!before)throw Error('Project not found.');
      let next={...before,...input.patch};if(next.layered)next=withLayeredPreview(next);
      const saved=store.save({...current.state,projects:current.state.projects.map(p=>p.id===input.projectId?next:p)},input.revision);
      changed();return {revision:saved.revision,project:saved.state.projects.find(p=>p.id===input.projectId)};
    }
    if (method === 'objects.import') {
      const input=z.object({bytes:z.string().max(64*1024*1024),name:z.string().min(1).max(255),type:z.string().min(1).max(160),revision}).strict().parse(value);
      const bytes=Buffer.from(input.bytes,'base64');if(bytes.toString('base64')!==input.bytes)throw Error('Invalid binary object encoding.');
      const saved=store.importObject(bytes,input.name,input.type,input.revision);changed();return {revision:saved.revision,object:saved.state.objects.at(-1)};
    }
    throw Error('Unknown workspace operation.');
  };
}

/** Private local socket; only the current OS user can connect. No browser or chat dependency. */
export async function serveWorkspace({store,socketPath,changed,openProject}) {
  const run=workspaceOperations(store,changed,openProject), sockets=new Set();
  const server=createServer(socket=>{
    sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});
    socket.setTimeout(30000,()=>socket.destroy());let chunks=[],size=0,started=false;
    socket.on('data',async chunk=>{
      if(started)return;size+=chunk.length;if(size>64*1024*1024){socket.destroy();return;}chunks.push(chunk);
      if(!chunk.includes(10))return;started=true;
      try { const request=z.object({method:z.string(),input:z.unknown()}).strict().parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));chunks=[];socket.end(JSON.stringify({result:await run(request.method,request.input)})+'\n'); }
      catch(error){socket.end(JSON.stringify({error:String(error.message).slice(0,1500)})+'\n');}
    });
  });
  // Never unlink a possibly live endpoint to claim another editor's workspace.
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,resolve);});
  if(process.platform!=='win32')await chmod(socketPath,0o600);
  return {close:async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));if(process.platform!=='win32')await unlink(socketPath).catch(error=>{if(error.code!=='ENOENT')throw error;});}};
}
