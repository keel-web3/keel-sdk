import {createMcpServer} from '../../../packages/mcp/dist/server.js';
import {writeFile} from 'node:fs/promises';
const server=await createMcpServer({workspaceRoot:process.cwd()}); let id=0;
async function call(method,params){const response=await server.handle({jsonrpc:'2.0',id:++id,method,params}); return response;}
await call('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'link2-conversion',version:'1'}});
const requests=[
['engine','resources/read',{uri:'keel://mcp/engine'}],
['plan','prompts/get',{name:'keel-project-plan',arguments:{request:'Convert Ethereum Link 2 0xac7e693f337739b195a5eef321aa62921d314085 using SDK/MCP defaults. Preserve all 22 editions and photographic frames, variation, random edition choice, 30 fps, scale/direction/scrubbing/pause/high-resolution/still-save controls. Compare lossless AVIF and WebP; accept only pixel-identical smaller files. Reuse existing MP4 encoder during loading; right-click Save MP4 once ready. Local preparation only; no mint or sale requested. Canonical shell, default storage selection from measured bytes.'}}],
['decisions','tools/call',{name:'keel-project-decisions',arguments:{outcome:'storage-only',runtime:'html',family:'ethereum',title:'Link 2 — KEEL conversion',chainId:1}}],
['intake','tools/call',{name:'keel-studio-project-intake',arguments:{title:'Link 2 — KEEL conversion',description:'Original Gysin–Vanetti photographic loops and interactive playback, with a locally generated MP4 download.',outcome:'storage-only'}}],
['endpoints','tools/call',{name:'keel-endpoint-config',arguments:{}}],
['capabilities','tools/call',{name:'keel-studio-capabilities',arguments:{}}],
['mp4-library','tools/call',{name:'keel-library-search',arguments:{query:'mp4',limit:25}}],
['encoder-library','tools/call',{name:'keel-library-search',arguments:{query:'encoder',limit:25}}],
];
for(const [name,method,params] of requests){let response;try{response=await call(method,params)}catch(e){response={error:e.message}}await writeFile(new URL('../evidence/mcp-'+name+'.json',import.meta.url),JSON.stringify({request:{method,params},response},null,2)+'\n');console.log(name,JSON.stringify(response).slice(0,5500));}
