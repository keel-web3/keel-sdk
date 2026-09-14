import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {buildCreatorProject} from '../packages/builder/dist/creator-module.js';
import {signal,defineTemplate} from '../packages/sdk/dist/module/template.js';
import {jsx} from '../packages/sdk/dist/module/jsx-runtime.js';

test('KEEL template declares ordinary document and mutable typed signals',()=>{
 const count=signal(0);count.value++;assert.equal(count.value,1);
 const template=defineTemplate({name:'example',title:'Example',target:'@keel/eth/sepolia'},jsx('main',{children:count}));
 assert.equal(template.document.title,'Example');assert.equal(template.manifest.name,'example');
});
test('TSX build uses KEEL runtime, types events, and never evaluates author code in Node',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'keel-template-test-'));await mkdir(path.join(root,'node_modules/@keel'),{recursive:true});
 await symlink(fileURLToPath(new URL('../packages/sdk',import.meta.url)),path.join(root,'node_modules/@keel/sdk'),'dir');
 await writeFile(path.join(root,'art.tsx'),`import {defineTemplate,signal} from '@keel/sdk/module';
 if(typeof window==='undefined')throw new Error('Author source executed in Node');
 const title=signal('Hello');
 export default defineTemplate({name:'hello',title:'Hello',target:'@keel/eth/sepolia'},<main><input value={title} onInput={event=>{title.value=event.currentTarget.value}}/><h1>{title}</h1></main>);`);
 const result=await buildCreatorProject({root,outputDirectory:path.join(root,'dist'),modules:[],surfaces:[{name:'art',entry:'art.tsx',isolation:'sandbox'}]});
 const js=result.nodes.find(node=>node.mediaType==='text/javascript');assert(js);const output=await readFile(path.join(root,'dist',js.file),'utf8');assert.match(output,/keel-template-node/);assert.doesNotMatch(output,/from ["']react/);
 await writeFile(path.join(root,'art.tsx'),`import {defineTemplate} from '@keel/sdk/module';export default defineTemplate({name:'bad',title:'Bad',target:'@keel/eth/sepolia'},<button onClick="bad">Click</button>);`);
 await assert.rejects(buildCreatorProject({root,outputDirectory:path.join(root,'dist'),modules:[],surfaces:[{name:'art',entry:'art.tsx',isolation:'sandbox'}]}),/not assignable/);
});
