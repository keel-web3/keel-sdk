import test from "node:test";
import assert from "node:assert/strict";
import {createMcpServer} from "../packages/mcp/dist/index.js";
const init={protocolVersion:"2024-11-05",capabilities:{},clientInfo:{name:"artist-test",version:"1"}};
test("MCP exposes artist hierarchy and native selected-ID setup through the shared system",async()=>{
 const server=await createMcpServer({workspaceRoot:process.cwd()});await server.handle({jsonrpc:"2.0",id:1,method:"initialize",params:init});
 const manifest={artist:{key:"ravonus",name:"RAVONUS"},collections:[{key:"genesis",name:"Genesis"}],contracts:[{chain:{family:"tezos",network:"NetXsqzbfFenSTS"},address:null,role:"collection",collection:"genesis",name:"Genesis FA2"}]};
 const r=await server.handle({jsonrpc:"2.0",id:2,method:"tools/call",params:{name:"keel-artist-contracts",arguments:{manifestJson:JSON.stringify(manifest)}}});
 assert.equal(r.error,undefined);assert.equal(r.result.isError,undefined);const text=JSON.parse(r.result.content.find(c=>c.type==="text").text);
 assert.equal(text.groups[0].contracts[0].status,"unconfigured");assert.equal(text.submission,"not-performed");
 const t=await server.handle({jsonrpc:"2.0",id:3,method:"tools/call",params:{name:"keel-tezos-token-selection-prepare",arguments:{network:"NetXsqzbfFenSTS",sender:"tz1KqTpEZ7Yob7QbPE4Hy4Wo8fHG8LhKxZSx",collection:"KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton"}}});
 assert.equal(t.result.isError,undefined);assert.equal(JSON.parse(t.result.content[0].text).operation.parameters.entrypoint,"enable_selected_token_ids");
});
