// Native acceptance uses a fresh workspace; no wallet accounts or chain writes.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os'); const assert = require('node:assert/strict');
process.env.KEEL_DESKTOP_TEST_HIDDEN = '1';
BrowserWindow.prototype.show = function() {}; BrowserWindow.prototype.focus = function() {};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) { for (let i=0;i<150;i++) { try { if(await fn())return; } catch {} await wait(100); } throw Error(label); }
const timeout = setTimeout(()=>{console.error('Shared runtime acceptance timed out');app.exit(1);},60000);
(async()=>{
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-shared-library-ui-'));
  process.env.KEEL_DESKTOP_DATA_DIR = directory;
  const { WorkspaceStore, newProject } = await import('../src/workspace.mjs');
  const store = new WorkspaceStore(path.join(directory,'workspace.sqlite'));
  const project = newProject('Shared Three scene','three');
  project.files[0].content = '<!doctype html><html><head></head><body><script type="module">import * as THREE from "three";const scene=new THREE.Scene();const camera=new THREE.PerspectiveCamera(60,1,.1,100);camera.position.z=3;scene.add(new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshNormalMaterial()));const renderer=new THREE.WebGLRenderer();renderer.setSize(200,200);document.body.append(renderer.domElement);renderer.render(scene,camera);document.body.dataset.three=THREE.REVISION;</script></body></html>';
  store.save({...store.read().state,projects:[project]},0);store.close();
  require('../dist/main.cjs');
  await until(()=>BrowserWindow.getAllWindows().length,'Editor did not open');
  const window=BrowserWindow.getAllWindows()[0];window.webContents.setBackgroundThrottling(false);
  const errors=[]; window.webContents.on('console-message',e=>{if(e.level==='error'&&!e.message.includes('Electron Security Warning'))errors.push(e.message);});
  const run=source=>window.webContents.executeJavaScript(source,true);
  const click=label=>run(`[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(label)}).click()`);
  await until(()=>run('document.body.innerText.includes("Shared Three scene")'),'Saved project missing');
  await run('document.querySelector(".project-card").click()');
  async function rendered(canonical) {
    const outer=window.webContents.mainFrame.frames.find(frame=>frame.url.startsWith('keel-preview:'));
    if(!outer)return false;
    if(canonical && await outer.executeJavaScript('document.body.dataset.verification')!=='verified')return false;
    const content=canonical?outer.frames[0]:outer;
    return !!content && await content.executeJavaScript('document.body.dataset.three==="180" && !!document.querySelector("canvas")');
  }
  await until(()=>rendered(true),'Packaged shared Three graph did not verify and render');
  await click('Viewing');
  await until(()=>run('document.body.innerText.includes("YOUR NEW UPLOAD") && !document.body.innerText.includes("Measuring…")'),'Upload breakdown missing');
  const measurement=await run(`window.keel.request('projectPresentation',${JSON.stringify(project.id)})`);
  assert.ok(measurement.uploads.creatorPublicationBytes<5000);assert.equal(measurement.uploads.modules.length,2);
  fs.writeFileSync(path.resolve(__dirname,'../artifacts/shared-library-viewing.png'),(await window.webContents.capturePage()).toPNG());
  await run('[...document.querySelectorAll(".shell-choice-grid button")].find(e=>e.textContent.includes("Direct display")).click()');
  await until(()=>run('document.querySelector(".shell-choice-grid button.selected").textContent.includes("Direct display")'),'Direct display choice was not saved');
  await click('Preview'); await until(()=>rendered(false),'Shared library did not work in direct display');
  await run('[...document.querySelectorAll(".nav-item")].find(e=>e.textContent.includes("Wallets")).click()');
  await until(()=>run('[...document.querySelectorAll(".tezos-wallets .wallet-installer button")].some(e=>e.textContent.includes("Add Temple"))'),'Tezos installer missing');
  assert.equal(await run('[...document.querySelectorAll(".tezos-wallets .wallet-installer button")].some(e=>e.textContent.includes("Add Temple"))'),true);
  assert.equal(await run('[...document.querySelectorAll(".tezos-wallets .wallet-installer button")].some(e=>e.textContent.includes("Add MetaMask"))'),false);
  assert.equal(await run('document.querySelector(".tezos-wallets select").value'), 'beacon');
  assert.equal(await run('[...document.querySelectorAll(".tezos-wallets button")].some(e=>e.textContent==="Connect with Beacon")'),true);
  await run('document.querySelector(".tezos-wallets").scrollIntoView()');
  fs.writeFileSync(path.resolve(__dirname,'../artifacts/tezos-wallet-installer.png'),(await window.webContents.capturePage()).toPNG());
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({status:'passed',evidence:['packaged-pinned-Three-main-core','canonical-shell-WebGL','new-upload-accounting','direct-display-shared-import','Tezos-extension-download-controls','Beacon-fallback'],creatorUploadBytes:measurement.uploads.creatorPublicationBytes,errors}));
  clearTimeout(timeout);app.exit(0);
})().catch(error=>{console.error(error);app.exit(1);});
