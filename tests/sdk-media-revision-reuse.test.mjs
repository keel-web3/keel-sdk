import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {keelAssetDisplayModuleBytes,keelAssetDisplayModuleRevision} from '../packages/sdk/dist/asset-display.js';
import {buildKeelInlineLocalDocument,buildKeelInlineModuleFragment,buildKeelInlineShellFragments} from '../packages/sdk/dist/inline-viewer-graph.js';
const digest=bytes=>'0x'+createHash('sha256').update(bytes).digest('hex');
test('canonical media bytes survive minified browser bundling unchanged',async()=>{
 const canonical=keelAssetDisplayModuleBytes();
 assert.equal(digest(canonical),keelAssetDisplayModuleRevision('1.2.0').digest);
 const result=await build({entryPoints:[fileURLToPath(new URL('../packages/sdk/src/asset-display.ts',import.meta.url))],bundle:true,minify:true,format:'esm',platform:'browser',write:false});
 const browser=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
 assert.deepEqual(browser.keelAssetDisplayModuleBytes(),canonical);
});
test('already-published canonical 1.1 media remains usable without publishing a new renderer',async()=>{
 const bytes=new Uint8Array(await readFile(new URL('./fixtures/asset-display-1.1.0.js',import.meta.url)));
 assert.equal(digest(bytes),keelAssetDisplayModuleRevision('1.1.0').digest);
 const shell=await buildKeelInlineShellFragments({repositoryRoot:fileURLToPath(new URL('../',import.meta.url))});
 const module=await buildKeelInlineModuleFragment({moduleId:'keel.asset-display',version:'1.1.0',mediaType:'text/javascript',aliases:['keel.asset-display'],decodedBytes:bytes,execution:'classic',phase:'render',compression:'none'});
 const entry={id:'pixel.png',mediaType:'image/png',source:new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64'))};
 const root=await buildKeelInlineLocalDocument({shell,modules:[module],entry});
 assert.equal(root.parts.find(part=>part.role==='module').moduleVersion,'1.1.0');
 const changed=bytes.slice();changed[100]^=1;
 const forged=await buildKeelInlineModuleFragment({moduleId:'keel.asset-display',version:'1.1.0',mediaType:'text/javascript',aliases:['keel.asset-display'],decodedBytes:changed,execution:'classic',phase:'render',compression:'none'});
 await assert.rejects(buildKeelInlineLocalDocument({shell,modules:[forged],entry}),/canonical revision/);
});
