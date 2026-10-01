// Real React event/lifecycle tests with a keyless API fixture and a tiny trusted
// preview-protocol fixture. The actual styled renderer is tested separately.
// Opt in with KEEL_TEST_REDESIGN_UI=1 (and optionally CHROMIUM_BIN). Chromium
// needs local sockets; restricted runners should run the pure/service tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const chromium = process.env.CHROMIUM_BIN || '/usr/bin/chromium';
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, label) {
  for (let i = 0; i < 150; i++) { try { if (await read()) return; } catch {} await delay(30); }
  throw Error(label);
}
const previewDocument = `<script>addEventListener('message',e=>{if(e.source===parent&&e.data.type==='styled-asset-load')parent.postMessage({type:'styled-asset-loaded',id:e.data.id},'*')});parent.postMessage({type:'styled-asset-ready'},'*')<\/script>`;

test('redesign panel: explicit source, races, cancellation, seed-only review and save retry', {
  skip: process.env.KEEL_TEST_REDESIGN_UI !== '1' ? 'Set KEEL_TEST_REDESIGN_UI=1 to run local Chromium UI acceptance' : !existsSync(chromium) ? `Chromium unavailable at ${chromium}` : false,
  timeout: 60_000,
}, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'keel-redesign-panel-'));
  let browser, socket;
  try {
    await build({ stdin: { resolveDir: desktop, loader: 'tsx', contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {QueryClientProvider} from '@tanstack/react-query';
      import {queryClient} from './src/client';
      import {GenerativeRedesignPanel} from './src/game-engine/generative-redesign-panel';
      const a='a'.repeat(64), b='b'.repeat(64);
      const initial={id:'project',title:'Private project',notes:'NEVER SEND',files:[{id:'original',name:'builds/main.build.json',type:'application/json',content:'ORIGINAL'}],objectIds:[]};
      const state={revision:1,state:{objects:[{id:a,name:'fox.glb'},{id:b,name:'tree.obj'}]}};
      queryClient.setQueryData(['workspace'],state);
      queryClient.setQueryData(['game-redesign-reference'],{programReference:{},providers:['codex','claude'],styles:{kinds:['original','pixel','dither','voxel'],screens:['bayer8','dots'],defaults:{kind:'original',pixelSize:4,toneLevels:4,screen:'bayer8'}}});
      let root; const calls=[],pending=[],saves=[],changes=[],savePending=[];
      window.test={ready:false,a,b,calls,pending,saves,changes,savePending,current:null,
        resolve(name,patch={}){const p=pending.find(item=>item.name===name&&!item.done);if(!p)throw Error('No pending '+name);p.done=true;const v=p.value;
          const candidate=name==='gameRedesignPreview'?{...window.test.current,seed:v.seed}:{runtimeVersion:'keel-generative-runtime@1.0.0',requestId:v.requestId,artifactId:'c'.repeat(64),program:{format:'keel-generative-program@1',id:'fox',title:'Candidate fox',ops:[{op:'box',from:[0,0,0],to:[1,1,1],role:'primary'}]},seed:v.seed,ops:[{op:'new',name:'fox'},{op:'box',from:[0,0,0],to:[1,1,1],role:'primary'}],playback:{},validation:{ok:true,errors:[]},source:{objectId:v.objectId,name:'fox'},settings:{provider:v.provider,...(v.model?{model:v.model}:{}),mode:v.mode,theme:v.theme,guidance:v.guidance,style:v.style}};
          Object.assign(candidate,patch);window.test.current=candidate;p.resolve(candidate);},
        unmount(){root.unmount();},finishSave(error){const p=savePending.shift();error?p.reject(Error(error)):p.resolve(true);}};
      window.keel={request(name,value){calls.push({name,value});if(name==='gameRedesignCancel')return Promise.resolve({cancelled:true});if(name==='gameRedesignAccept')return Promise.resolve(window.test.current);return new Promise((resolve,reject)=>pending.push({name,value,resolve,reject}));}};
      root=createRoot(document.getElementById('app'));root.render(<QueryClientProvider client={queryClient}><GenerativeRedesignPanel project={initial} change={patch=>changes.push(patch)} persist={next=>{saves.push(next);return new Promise((resolve,reject)=>savePending.push({resolve,reject}));}}/></QueryClientProvider>);
      window.test.ready=true;
    ` }, outfile: path.join(directory, 'panel.js'), bundle: true, format: 'iife', platform: 'browser', plugins: [{ name: 'preview-fixture', setup(b) {
      b.onResolve({ filter: /styled-asset-project\.mjs$/ }, () => ({ path: 'preview-fixture', namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `export const STYLED_PREVIEW_URL=${JSON.stringify('data:text/html;base64,' + Buffer.from(previewDocument).toString('base64'))}; export const styledImportable=(name='')=>/\\.keelasset(?:\\.json)?$/i.test(name);`, loader: 'js' }));
    } }] });
    const page = path.join(directory, 'panel.html');
    await writeFile(page, '<!doctype html><html><body><div id="app"></div><script src="panel.js"></script></body></html>');
    browser = spawn(chromium, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${directory}/browser`, 'about:blank'], { stdio: 'ignore' });
    await until(() => existsSync(path.join(directory, 'browser/DevToolsActivePort')), 'Chromium did not expose its test debugging port');
    const [port] = (await readFile(path.join(directory, 'browser/DevToolsActivePort'), 'utf8')).split('\n');
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    let seq = 0; const pending = new Map();
    socket.addEventListener('message', event => { const result = JSON.parse(event.data); const p = pending.get(result.id); if (p) { pending.delete(result.id); result.error ? p.reject(Error(result.error.message)) : p.resolve(result.result); } });
    const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
    const run = async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result?.value; };
    const navigate = async () => {
      await run('if(window.test)window.test.ready=false');
      await send('Page.navigate', { url: pathToFileURL(page).href });
      await until(() => run(`window.test?.ready && document.querySelector('[aria-label="Redesign source model"]')`), 'Panel did not mount');
      await until(() => run(`document.querySelector('[aria-label="Redesign screen"]').value==='bayer8'`), 'Engine screens did not load');
    };
    const input = async (label, value) => { await run(`(()=>{const el=document.querySelector('[aria-label=${JSON.stringify(label)}]');const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`); };
    const click = async label => { await until(() => run(`[...document.querySelectorAll('button')].some(e=>e.textContent===${JSON.stringify(label)}&&!e.disabled)`), `Button not enabled: ${label}`); await run(`[...document.querySelectorAll('button')].find(e=>e.textContent===${JSON.stringify(label)}&&!e.disabled).click()`); };
    const count = name => run(`test.calls.filter(c=>c.name===${JSON.stringify(name)}).length`);
    const resolve = async (name, patch = {}) => { await run(`test.resolve(${JSON.stringify(name)},${JSON.stringify(patch)})`); };
    const generate = async () => { await input('Redesign source model', 'a'.repeat(64)); await click('Generate redesign'); await resolve('gameRedesignGenerate'); await until(() => run(`[...document.querySelectorAll('button')].some(e=>e.textContent==='Accept as new asset'&&!e.disabled)`), 'Validated candidate did not become reviewable'); };

    await t.test('explicit selection; independent Original/Theme and visual style; bounded payload; repeated clicks', async () => {
      await navigate();
      assert.equal(await run(`document.querySelector('[aria-label="Redesign source model"]').value`), '');
      assert.equal(await run(`[...document.querySelectorAll('button')].find(e=>e.textContent==='Generate redesign').disabled`), true);
      assert.equal(await count('gameRedesignGenerate'), 0);
      await input('Redesign source model', 'a'.repeat(64)); await input('Redesign design mode', 'theme');
      assert.equal(await run(`[...document.querySelectorAll('button')].find(e=>e.textContent==='Generate redesign').disabled`), true);
      await input('Redesign theme', 'Lunar explorer'); await input('Redesign provider', 'claude'); await input('Redesign model override', 'custom-model'); await input('Redesign guidance', 'Keep ears'); await input('Redesign visual style', 'dither');
      await run(`{const b=[...document.querySelectorAll('button')].find(e=>e.textContent==='Generate redesign');b.click();b.click();}`);
      assert.equal(await count('gameRedesignGenerate'), 1);
      const payload = await run(`test.calls.find(c=>c.name==='gameRedesignGenerate').value`);
      assert.deepEqual(Object.keys(payload).sort(), ['requestId','objectId','provider','model','seed','mode','theme','guidance','style'].sort());
      assert.equal(payload.mode, 'theme'); assert.equal(payload.theme, 'Lunar explorer'); assert.equal(payload.style.kind, 'dither'); assert.equal(payload.provider, 'claude');
      assert.doesNotMatch(JSON.stringify(payload), /Private project|NEVER SEND|ORIGINAL/);
      assert.equal(await run(`document.querySelector('[aria-label="Redesign seed"]').maxLength`), 128);
    });

    await t.test('source/settings invalidation and Cancel discard late provider responses', async () => {
      await navigate(); await input('Redesign source model', 'a'.repeat(64)); await click('Generate redesign');
      await input('Redesign source model', 'b'.repeat(64)); assert.equal(await count('gameRedesignCancel'), 1);
      await resolve('gameRedesignGenerate');
      await until(async () => await count('gameRedesignCancel') === 2, 'Late response was not cleaned up');
      assert.equal(await run(`document.body.textContent.includes('Candidate fox')`), false);
      await click('Generate redesign'); await input('Redesign visual style', 'pixel'); await resolve('gameRedesignGenerate');
      assert.equal(await run(`document.body.textContent.includes('Candidate fox')`), false);
      await click('Generate redesign'); await click('Cancel'); await resolve('gameRedesignGenerate');
      assert.equal(await run(`document.body.textContent.includes('Candidate fox')`), false);
      assert.equal(await run('test.saves.length'), 0);
    });

    await t.test('seed-only variation requires new preview; accept persists before consuming and preserves source', async () => {
      await navigate(); await generate(); await input('Redesign seed', 'variation-2');
      assert.equal(await run(`[...document.querySelectorAll('button')].find(e=>e.textContent==='Accept as new asset').disabled`), true);
      await click('Preview seed variation'); assert.equal(await count('gameRedesignPreview'), 1); assert.equal(await count('gameRedesignGenerate'), 1);
      await resolve('gameRedesignPreview'); await click('Accept as new asset');
      await until(() => run('test.saves.length===1'), 'Accept did not attempt save');
      assert.equal(await count('gameRedesignCancel'), 0, 'candidate retained until persist succeeds');
      assert.equal(await run('test.changes.length'), 0);
      const saved = await run('test.saves[0]'); assert.equal(saved.files.length, 4); assert.equal(saved.files[0].content, 'ORIGINAL');
      assert.equal(JSON.parse(saved.files.find(f => f.name.endsWith('.generative.json')).content).seed, 'variation-2');
      await run('test.finishSave()'); await until(async () => await count('gameRedesignCancel') === 1, 'Saved candidate not cleaned up');
      assert.equal(await run('test.changes.length'), 1);
    });

    await t.test('failed save retains candidate; repeat Accept is gated and retry needs no provider', async () => {
      await navigate(); await generate();
      await run(`{const b=[...document.querySelectorAll('button')].find(e=>e.textContent==='Accept as new asset');b.click();b.click();}`);
      await until(() => run('test.saves.length===1'), 'Accept did not begin'); assert.equal(await count('gameRedesignAccept'), 1);
      await run(`test.finishSave('disk fixture failure')`); await until(() => run(`document.body.textContent.includes('disk fixture failure')`), 'Save error not reported');
      assert.equal(await count('gameRedesignCancel'), 0); assert.equal(await run('test.changes.length'), 0);
      await click('Accept as new asset'); await until(() => run('test.saves.length===2'), 'Retry did not save');
      assert.equal(await count('gameRedesignGenerate'), 1); await run('test.finishSave()');
      await until(() => run('test.changes.length===1'), 'Retry did not complete');
    });

    await t.test('Keep source discards without persistence and unmount cleans pending authoring', async () => {
      await navigate(); await generate(); await click('Keep source');
      assert.equal(await count('gameRedesignCancel'), 1); assert.equal(await run('test.saves.length'), 0);
      await click('Generate redesign'); await run('test.unmount()');
      assert.equal(await count('gameRedesignCancel'), 2); await resolve('gameRedesignGenerate');
      await until(async () => await count('gameRedesignCancel') === 3, 'Unmounted late response leaked');
      assert.equal(await run(`document.getElementById('app').childElementCount`), 0);
    });

    await t.test('failed validation cannot be accepted', async () => {
      await navigate(); await input('Redesign source model', 'a'.repeat(64)); await click('Generate redesign');
      await resolve('gameRedesignGenerate', { validation: { ok: false, errors: [{ path: 'ops.0', message: 'Out of budget' }] } });
      await until(() => run(`document.body.textContent.includes('Out of budget')`), 'Validation error not shown');
      assert.equal(await run(`[...document.querySelectorAll('button')].find(e=>e.textContent==='Accept as new asset').disabled`), true);
      assert.equal(await count('gameRedesignAccept'), 0);
    });
  } finally {
    socket?.close(); browser?.kill('SIGTERM');
    if (browser && browser.exitCode === null) await Promise.race([new Promise(resolve => browser.once('exit', resolve)), delay(1500)]);
    await rm(directory, { recursive: true, force: true });
  }
});
