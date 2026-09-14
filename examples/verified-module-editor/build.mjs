import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCreatorProject } from '../../packages/builder/dist/creator-module.js';
import { createKeelGlobalDeclarations } from '../../packages/builder/dist/module-global-types.js';
import { createLocalSandbox } from './local-sandbox.mjs';
import { createIntegrity } from '../../packages/protocol/dist/index.js';
const root = fileURLToPath(new URL('.', import.meta.url));
await mkdir(path.join(root, '.keel'), { recursive: true });
await writeFile(path.join(root, '.keel/globals.d.ts'), createKeelGlobalDeclarations(root, [path.join(root, 'src/art.ts')]));
const modules = JSON.parse(await readFile(path.join(root, 'keel.includes.json'), 'utf8'));
const outputDirectory = path.join(root, 'dist');
const plan = await buildCreatorProject({ root, outputDirectory, modules, surfaces: [{ name: 'art', entry: 'src/art.ts', isolation: 'sandbox' }] });
const scripts = plan.nodes.filter(node => node.mediaType === 'text/javascript');
if (scripts.length !== 1) throw new Error('This single-surface example must produce one bundled script.');
const bytes = new Uint8Array(await readFile(path.join(outputDirectory, scripts[0].file)));
const integrity = await createIntegrity(bytes);
const sandbox = await createLocalSandbox({ bytes, sha256: integrity.digest });
await writeFile(path.join(outputDirectory, 'sandbox.html'), sandbox.document.html);
await writeFile(path.join(outputDirectory, 'preview.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><title>KEEL module runtime check</title>
<style>body{background:#eef2f5;color:#152436;font:18px/24px system-ui;max-width:800px;margin:40px 16px}h1{font-size:32px;line-height:40px;margin:0 0 24px}p{margin:24px 0}iframe{display:block;width:100%;height:500px;border:1px solid #ced6df;background:white}code{font-size:15px}</style>
<h1>Verified module editor example</h1><p>The artwork imports the real thumbnail module. Its runtime comes from the SDK sandbox.</p>
<p id="status">Waiting for initialization…</p><iframe title="Artwork" sandbox="allow-scripts" src="sandbox.html"></iframe>
<p>This checks initialization and capture requests. It does not publish or mint anything.</p>
<script>const frame=document.querySelector('iframe');addEventListener('message',event=>{if(event.source!==frame.contentWindow||event.data?.protocol!=='keel-thumbnail-capture@1')return;document.querySelector('#status').textContent=event.data.action==='capture'?'Capture request received: '+event.data.label:'Module initialized: '+event.data.label;document.body.dataset.lastAction=event.data.action;});</script></html>`);
console.log(`Built exact creator bundle: ${integrity.digest}. Run npm run preview.`);
