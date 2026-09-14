// Hidden, isolated editor: create ordinary SVG renderers, export and persist them.
const {app,BrowserWindow,dialog}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
process.env.KEEL_DESKTOP_TEST_HIDDEN='1';
process.env.KEEL_DESKTOP_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'keel-svg-builder-'));
BrowserWindow.prototype.show=function(){};BrowserWindow.prototype.focus=function(){};
app.on('browser-window-created',(_,w)=>{w.hide();w.webContents.setBackgroundThrottling(false);});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check,message){for(let n=0;n<150;n++){if(await check())return;await pause(100);}throw Error(message);}
void(async()=>{
 const exported=path.join(process.env.KEEL_DESKTOP_DATA_DIR,'StudioArt.sol');
 dialog.showSaveDialog=async()=>({canceled:false,filePath:exported});require('../dist/main.cjs');
 await until(()=>BrowserWindow.getAllWindows().length,'Editor did not open');
 const window=BrowserWindow.getAllWindows()[0],errors=[];
 window.webContents.on('console-message',e=>{if(e.level==='error'&&!e.message.includes('Electron Security Warning'))errors.push(e.message);});
 const run=source=>window.webContents.executeJavaScript(source,true),text=()=>run('document.body.innerText');
 await until(async()=>(await text()).includes('Make it yours.'),'Editor home missing');
 await run('document.querySelector(".blank-project").open=true');
 await run(`(()=>{const e=document.querySelector('input[name=title]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'SVG creation test');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 await run('document.querySelector(".new-project").requestSubmit()');
 await until(async()=>(await text()).includes('All projects'),'Project did not open');
 async function click(label){await until(()=>run(`[...document.querySelectorAll('button')].some(e=>e.textContent.trim()===${JSON.stringify(label)}&&!e.disabled)`),'Button unavailable '+label);await run(`[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(label)}).click()`);}
 async function fill(label,value){await run(`(()=>{const e=[...document.querySelectorAll('label.field')].find(l=>l.querySelector('span')?.textContent===${JSON.stringify(label)}).querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await pause(50);}
 await click('SVG renderer');await until(()=>run('document.querySelector(".svg-builder-preview img")?.naturalWidth>0'),'Preview missing');
 const first=await run('document.querySelector(".svg-builder-preview img").src');
 await click('Next token');assert.notEqual(await run('document.querySelector(".svg-builder-preview img").src'),first);
 await click('Previous token');assert.equal(await run('document.querySelector(".svg-builder-preview img").src'),first);
 await click('Start with blocks');assert.notEqual(await run('document.querySelector(".svg-builder-preview img").src'),first);
 await fill('Renderer name','StudioArt');await fill('Primary','#ffcc00');
 assert.ok((await run('decodeURIComponent(document.querySelector(".svg-builder-preview img").src)')).includes('#ffcc00'));
 await click('Export Solidity renderer');await until(()=>fs.existsSync(exported)&&fs.statSync(exported).size>0,'Export missing');
 const source=fs.readFileSync(exported,'utf8');assert.match(source,/contract StudioArt is KeelSVGRenderer/);assert.match(source,/#ffcc00/);assert.doesNotMatch(source,/FRAY|mintAccepted/);
 await click('Save & preview');
 const saved=await run('window.keel.request("workspace")'),project=saved.state.projects.at(-1);
 assert.equal(project.svgRenderer.name,'StudioArt');assert.equal(project.svgRenderer.colors.primary,'#ffcc00');assert.equal(project.presentation.shell,'canonical');
 await click('SVG renderer');fs.mkdirSync(path.resolve(__dirname,'../artifacts'),{recursive:true});
 window.setSize(1440,1000);await pause(200);
 fs.writeFileSync(path.resolve(__dirname,'../artifacts/svg-builder-desktop.png'),(await window.webContents.capturePage()).toPNG());
 window.setSize(920,850);await pause(200);
 assert.equal(await run('document.querySelector(".main-panel").scrollWidth<=document.querySelector(".main-panel").clientWidth'),true);
 fs.writeFileSync(path.resolve(__dirname,'../artifacts/svg-builder-compact.png'),(await window.webContents.capturePage()).toPNG());
 await fill('Renderer name','bad name');assert.equal(await run(`[...document.querySelectorAll('button')].find(e=>e.textContent==='Export Solidity renderer').disabled`),true);
 await fill('Renderer name','StudioArt');
 await run(`(()=>{document.querySelector('.svg-builder details').open=true;const e=document.querySelector('[aria-label="SVG renderer artwork"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'<script>bad()</script>');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 await until(()=>run(`!!document.querySelector('.svg-builder [role=alert]')`),'Unsafe SVG not rejected');
 assert.equal(await run(`[...document.querySelectorAll('button')].find(e=>e.textContent==='Export Solidity renderer').disabled`),true);
 assert.ok(!errors.length,errors.join('\n'));
 const result={status:'PASS',checks:['ordinary SVG presets','deterministic token navigation','palette editing','Solidity export through native dialog','saved project recipe','canonical shell preserved','desktop and compact layout','unsafe artwork blocked','invalid contract name blocked'],errors};
 fs.writeFileSync(path.resolve(__dirname,'../artifacts/svg-builder-report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));app.exit(0);
})().catch(async error=>{console.error(error);const w=BrowserWindow.getAllWindows()[0];if(w)console.error((await w.webContents.executeJavaScript('document.body.innerText').catch(()=>'' )).slice(-3500));app.exit(1);});
