import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createMcpServer } from "../packages/mcp/dist/index.js";
const recipe = { schema: "keel-media-edit@1", mode: "original", format: "original", quality: 82, noSound: false };
async function call(server, name, args) {
  return server.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
}
test("local media MCP shares reversible pipeline and returns source-bound handoff without writes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "keel-media-tools-"));
  try {
    const bytes = Buffer.from([0, 1, 2, 255]);
    await writeFile(path.join(root, "source.bin"), bytes);
    const server = await createMcpServer({ workspaceRoot: root });
    await server.handle({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "media-test", version: "1" } } });
    const response = await call(server, "keel-media-candidate", { inputPath: "source.bin", recipe });
    assert.equal(response.result.isError, undefined, response.result.content[0]?.text);
    const result = response.result.structuredContent;
    assert.equal(result.bytesBase64, bytes.toString("base64"));
    assert.deepEqual(result.sourceIntegrity, result.outputIntegrity);
    assert.equal(result.mediaEdits.edits[0].sourcePath, "source.bin");
    assert.equal(result.mediaEdits.edits[0].sourceSha256, result.sourceIntegrity.digest);
    assert.equal(result.mediaEdits.edits[0].candidatePath, undefined);
    assert.equal(result.persisted, false);
    assert.deepEqual(await readFile(path.join(root, "source.bin")), bytes);
    assert.deepEqual(await readdir(root), ["source.bin"]);
    const denied = await call(server, "keel-media-candidate", { inputPath: "../outside.bin", recipe });
    assert.equal(denied.result.isError, true);
    assert.match(denied.result.content[0].text, /workspace/);
    const badRecipe = await call(server, "keel-media-candidate", { inputPath: "source.bin", recipe: { ...recipe, noSound: true } });
    assert.equal(badRecipe.result.isError, true);
    assert.match(badRecipe.result.content[0].text, /Original mode/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('agent layer recipe is executed and returned unchanged for Studio re-editing',async()=>{
 const {createRequire}=await import('node:module');const require=createRequire(new URL('../packages/builder/dist/media-preparation.js',import.meta.url));const sharp=require('sharp');
 const root=await mkdtemp(path.join(os.tmpdir(),'keel-media-layer-'));
 try {
  const bytes=await sharp({create:{width:12,height:8,channels:4,background:'#fa8033'}}).png().toBuffer();await writeFile(path.join(root,'source.png'),bytes);
  const server=await createMcpServer({workspaceRoot:root});await server.handle({jsonrpc:'2.0',id:0,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'layer-test',version:'1'}}});
  const layered={...recipe,mode:'lossless',format:'webp',layers:[{left:2,top:1,width:4,height:3,opacity:0.5,rotate:90}]};
  const response=await call(server,'keel-media-candidate',{inputPath:'source.png',recipe:layered});assert.equal(response.result.isError,undefined,response.result.content[0]?.text);
  assert.deepEqual(response.result.structuredContent.recipe,layered);assert.deepEqual(response.result.structuredContent.mediaEdits.edits[0].recipe,layered);assert.deepEqual(await readFile(path.join(root,'source.png')),bytes);assert.deepEqual(await readdir(root),['source.png']);
 }finally{await rm(root,{recursive:true,force:true});}
});
