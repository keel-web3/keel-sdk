import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createModuleObservationDocument } from '../../packages/builder/dist/module-observation.js';
const source = new Uint8Array(await readFile(new URL('uploads/solar.js', import.meta.url)));
const result = await createModuleObservationDocument(source, 'classic');
await mkdir(new URL('dist/', import.meta.url), { recursive: true });
await writeFile(new URL('dist/discovery-frame.html', import.meta.url), result.html);
await writeFile(new URL('dist/discovery.html', import.meta.url), `<!doctype html><meta charset="utf-8"><title>Unverified module discovery</title><h1>Sandbox global discovery</h1><p>Uploaded script: solar.js. Verification is not required.</p><pre id="observation">Waiting for the isolated sandbox…</pre><iframe sandbox="allow-scripts" src="discovery-frame.html" title="Isolated module"></iframe><script>const frame=document.querySelector('iframe');addEventListener('message',e=>{if(e.source===frame.contentWindow)document.querySelector('#observation').textContent=JSON.stringify(e.data,null,2)});</script>`);
