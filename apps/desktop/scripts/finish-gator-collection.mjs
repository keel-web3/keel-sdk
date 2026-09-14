/** Finish the currently running local codec batch, then check every available
 * token through SDK and MCP. Never signs or publishes, and never raises caps. */
import assert from 'node:assert/strict';
import {readFile,writeFile,stat} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createMcpServer} from '../../../packages/mcp/dist/server.js';
const root='apps/desktop/artifacts/gator-inline-sepolia/collection-matrix';
const progress='apps/desktop/artifacts/gator-ape-rebuild/collection-layers-3750/progress.json';
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const started=Date.now();
try {
  let previous=-1;
  while(true){
    const current=await json(progress);
    if(current.preparedSourceObjects!==previous){console.log(JSON.stringify(current));previous=current.preparedSourceObjects;}
    if(current.complete)break;
    assert.ok(Date.now()-(await stat(progress)).mtimeMs<15*60*1000,'Layer preparation stopped making progress');
    assert.ok(Date.now()-started<2*60*60*1000,'Layer preparation did not finish in two hours');
    await new Promise(resolve=>setTimeout(resolve,15000));
  }
  await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['apps/desktop/scripts/prepare-gator-collection-matrix.mjs'],{stdio:'inherit'});
    child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error('Collection graph preparation failed')));
  });
  const server=await createMcpServer({workspaceRoot:process.cwd()});
  await server.handle({jsonrpc:'2.0',id:0,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'gator-collection',version:'1'}}});
  const result=await server.handle({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'keel-token-matrix-prepare',arguments:{manifestPath:root+'/mcp-input.json',outputPath:root+'/mcp-plan.json'}}});
  assert.ok(result.result&&!result.result.isError,JSON.stringify(result));
  const sdk=await json(root+'/report.json'),mcp=await json(root+'/mcp-plan.json');
  assert.deepEqual(mcp.reads,sdk.reads.map(({tokenId,byteLength,digest})=>({tokenId,byteLength,digest})));
  const report={checkedAt:new Date().toISOString(),preparedTokens:mcp.populatedTokens,tokenCount:mcp.tokenCount,
    exactSDKMCPReads:true,sharedValueBytes:mcp.sharedValueBytes,matrixBytes:mcp.matrixBytes,complete:mcp.complete,
    pendingTokens:sdk.pendingTokens.length,sizeOrPreparationFailures:sdk.failures.length,published:false};
  await writeFile(root+'/mcp-acceptance.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
}catch(error){
  await writeFile(root+'/completion-error.json',JSON.stringify({checkedAt:new Date().toISOString(),error:error.message,published:false},null,2));
  console.error(error);process.exitCode=1;
}
