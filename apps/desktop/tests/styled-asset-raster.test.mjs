import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {GameBuilderService} from '../src/game-engine/builder-service.mjs';
import {styledAssetProjectFiles} from '../src/game-engine/styled-asset-project.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=process.env.KEEL_GAME_ENGINE_ROOT||path.resolve(here,'../../../../keel-engine');
const runtimePath=path.join(root,'packages/import/src/styled-asset-runtime.ts');
const available=await fs.access(runtimePath).then(()=>true,()=>false),run=available?test:test.skip;
const workerPath=path.resolve(here,'../src/game-engine/builder-worker.mjs');
const readFixture=name=>fs.readFile(path.join(here,'fixtures/raster-import',name+'.keelasset'));
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const source=(await fs.readFile(path.resolve(here,'../src/game-engine/builder-styled-preview.mjs'),'utf8')).replace(/^import .*;\n/gm,'');

// The drawing surface captures every RGBA byte handed to Canvas. The importer,
// frame selection, animation, and SDK message dispatch are their real code.
function preview(runtime,{importer=runtime.importStyledAsset,sourceCode=source}={}){
  const elements=new Map(),events=new Map(),messages=[],players=[],draws=[];let raf,now=0,webglAttempts=0;
  const context2d={imageSmoothingEnabled:true,createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData:image=>draws.push(new Uint8Array(image.data))};
  const el=id=>{if(!elements.has(id))elements.set(id,{value:'0',hidden:false,textContent:'',style:{},replaceChildren(...items){this.children=items;},getContext:kind=>kind==='2d'?context2d:null,getBoundingClientRect:()=>({width:480,height:300})});return elements.get(id);};
  const parent={postMessage:message=>messages.push(message)};
  const context={THREE:{...THREE,WebGLRenderer:class{constructor(){webglAttempts++;throw Error('WebGL disabled for the raster test');}}},GLTFLoader,OrbitControls:class{},importStyledAsset:importer,createStyledAssetPlayer:runtime.createStyledAssetPlayer,styledRuntime:{createRasterCanvasPlayer:host=>{const player=runtime.createRasterCanvasPlayer(host);players.push(player);return player;}},document:{getElementById:el},parent,devicePixelRatio:1,performance:{now:()=>now},Uint8Array,TextDecoder,TextEncoder,AbortController,Option:class{constructor(label,value){this.label=label;this.value=value;}},atob,console,addEventListener:(name,fn)=>events.set(name,fn),requestAnimationFrame:fn=>{raf=fn;return 1;}};
  vm.runInNewContext(sourceCode,context);
  return {el,messages,players,draws,get webglAttempts(){return webglAttempts;},get pixels(){return draws.at(-1);},load:(asset,id=1,from=parent)=>events.get('message')({source:from,data:{type:'styled-asset-load',id,asset}}),tick:(delta=.1)=>{now+=delta*1000;raf(now);}};
}

run('real Fox .keelasset bytes survive SDK worker dispatch and project attachment intact',async()=>{
  const runtime=await import(pathToFileURL(runtimePath).href),service=new GameBuilderService({workerPath,root});
  try{
    const bytes=await readFixture('fox-walk');
    assert.equal(sha256(bytes),'aabc1f6fb28177635713d6d3977a39c6d7d732882565ee974b16c1cda782a0bb');
    // Exercise content sniffing as well as extension dispatch.
    const result=await service.importFile({bytes:new Uint8Array(bytes),name:'Fox',fileName:'Fox.bin'});
    assert.equal(result.kind,'styled-asset');assert.equal(result.animation.mode,'baked-frames');
    assert.equal(result.nativeDracoRequired,false);assert.equal(result.raster.animation.name,'Walk');
    assert.equal(result.raster.animation.frameCount,6);assert.equal(result.raster.width,64);
    assert.equal(result.playback.glbBase64,undefined,'the static first-frame GLB must not masquerade as animation');
    assert.equal(result.playback.raster,undefined,'keep decoded frame expansion out of the host transport');
    assert.deepEqual(Buffer.from(result.playback.packageBase64,'base64'),bytes);
    const imported=await runtime.importStyledAsset(Buffer.from(result.playback.packageBase64,'base64'));
    assert.equal(imported.envelope.native.byteLength,0);assert.equal(imported.envelope.native.encoding,'raster-frames');
    assert.equal(imported.raster.frames.length,6);assert.notDeepEqual(imported.raster.frames[0],imported.raster.frames[3]);
    const files=styledAssetProjectFiles(result,sha256(bytes)),reference=JSON.parse(files[0].content);
    assert.deepEqual(reference.raster,result.raster);
    const loader=await import('data:text/javascript;base64,'+Buffer.from(files[1].content.replace('@keel-engine/import/styled-asset',pathToFileURL(runtimePath).href)).toString('base64'));
    const rebuilt=await loader.build(async id=>{assert.equal(id,sha256(bytes));return bytes;});
    assert.deepEqual(rebuilt.raster.frames,imported.raster.frames);
    const draws=[],canvas={style:{},getContext:()=>({createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData:image=>draws.push(new Uint8Array(image.data))})};
    const player=await loader.createPlayer({canvas},async()=>bytes);player.seek(imported.raster.animation.duration/2);
    assert.deepEqual(draws.at(-1),imported.raster.frames[3]);player.dispose();
    let rendered=0;const sprite=await loader.createPlayer({THREE,renderer:{render(){rendered++;}}},async()=>bytes);
    assert.equal(sprite.model.isSprite,true);sprite.render(new THREE.Camera(),{width:64,height:64,time:imported.raster.animation.duration/2});
    assert.deepEqual(sprite.texture.image.data,imported.raster.frames[3]);assert.equal(rendered,1);sprite.dispose();
    const html=await service.styledPreview();assert.match(html,/raster-view/);assert.match(html,/Sprite direction/);
  }finally{service.close();}
});

run('SDK raster preview uses genuine transparent frames without WebGL, with pause, seek and direction controls',async()=>{
  const runtime=await import(pathToFileURL(runtimePath).href),service=new GameBuilderService({workerPath,root});
  try{
    const bytes=await readFixture('fox-walk-four-views'),result=await service.importFile({bytes,name:'Fox',fileName:'fox.keelasset'});
    const asset=await runtime.importStyledAsset(bytes),r=asset.raster,a=r.animation,p=preview(runtime);
    assert.equal(p.messages[0].type,'styled-asset-ready');await p.load(JSON.parse(JSON.stringify(result.playback)));
    assert.equal(p.messages.at(-1).type,'styled-asset-loaded',p.messages.at(-1).message);
    assert.equal(p.webglAttempts,0);assert.equal(p.el('raster-view').width,r.width);assert.equal(p.el('raster-view').height,r.height);
    assert.equal(p.el('view').hidden,true);assert.equal(p.el('raster-view').hidden,false);
    assert.equal(p.el('direction').children.length,4);assert.equal(p.el('direction').hidden,false);
    assert.deepEqual(p.pixels,r.frames[0]);
    assert.ok(p.pixels.some((value,i)=>i%4===3&&value===0),'transparent background reaches Canvas unchanged');
    assert.ok(p.pixels.some((value,i)=>i%4===3&&value>0),'the frame contains visible pixels');
    p.el('time').value='.5';p.el('time').oninput();p.tick();
    const middle=Math.floor(a.frameCount/2);assert.equal(p.players[0].time,a.duration/2);assert.deepEqual(p.pixels,r.frames[middle]);
    assert.notDeepEqual(p.pixels,r.frames[0],'scrubbing changes the source-derived pose');
    p.tick();assert.equal(p.players[0].time,a.duration/2,'scrubbing pauses playback');
    p.el('direction').value='2';p.el('direction').onchange();assert.deepEqual(p.pixels,r.frames[2*a.frameCount+middle]);
    assert.notDeepEqual(p.pixels,r.frames[middle],'changing direction selects its baked camera frame');
    p.el('play').onclick();p.tick();assert.ok(p.players[0].time>a.duration/2);
    p.el('time').value='1';p.el('time').oninput();p.tick();assert.deepEqual(p.pixels,r.frames[3*a.frameCount-1],'timeline endpoint holds the final frame of the selected view');
    p.el('clip').value='0';p.el('clip').onchange();assert.equal(p.players[0].time,0);assert.deepEqual(p.pixels,r.frames[2*a.frameCount]);
    const count=p.players.length;await p.load(result.playback,90,{});assert.equal(p.players.length,count);
    await p.load(result.playback,2);assert.equal(p.el('direction').value,'0');assert.deepEqual(p.pixels,r.frames[0]);
    assert.throws(()=>p.players[0].render({time:0}),/disposed/);
    const invalid={...result.playback,packageBase64:Buffer.from('globalThis.pwned=true').toString('base64')};
    await p.load(invalid,3);assert.equal(p.messages.at(-1).type,'styled-asset-error');assert.equal(p.el('raster-view').hidden,true);
    assert.throws(()=>p.players[1].render({time:0}),/disposed/);assert.equal(globalThis.pwned,undefined);
    await p.load(result.playback,4);assert.equal(p.messages.at(-1).type,'styled-asset-loaded');
    const native=await service.importFile({bytes:new Uint8Array(await fs.readFile(path.join(here,'fixtures/styled-import/original.keelasset'))),name:'native',fileName:'native.keelasset'});
    await p.load(native.playback,5);assert.equal(p.messages.at(-1).type,'styled-asset-error');assert.match(p.messages.at(-1).message,/WebGL disabled/);
    await p.load(result.playback,6);assert.equal(p.messages.at(-1).type,'styled-asset-loaded');assert.equal(p.webglAttempts,1);p.players.at(-1).dispose();
  }finally{service.close();}
});

run('static raster views remain selectable and an older asynchronous import cannot replace the current asset',async()=>{
  const runtime=await import(pathToFileURL(runtimePath).href),service=new GameBuilderService({workerPath,root});
  try{
    const rest=await service.importFile({bytes:await readFixture('fox-rest-four-views'),name:'Rest',fileName:'rest.keelasset'});
    const walk=await service.importFile({bytes:await readFixture('fox-walk'),name:'Walk',fileName:'walk.keelasset'});
    let release,first=true;const p=preview(runtime,{importer:async bytes=>{if(first){first=false;await new Promise(resolve=>{release=resolve;});}return runtime.importStyledAsset(bytes);}});
    const pending=p.load(walk.playback,1);await p.load(rest.playback,2);release();await pending;
    assert.equal(p.players.length,1);assert.equal(p.messages.at(-1).id,2);
    assert.equal(p.el('controls').hidden,false);assert.equal(p.el('clip').hidden,true);assert.equal(p.el('time').hidden,true);assert.equal(p.el('direction').hidden,false);
    const frame=p.pixels;p.el('direction').value='1';p.el('direction').onchange();assert.notDeepEqual(p.pixels,frame);
    p.tick();assert.equal(p.players[0].time,0);p.players[0].dispose();
  }finally{service.close();}
});

run('the actual bundled desktop preview decodes and paints the downloaded raster package',async()=>{
  const runtime=await import(pathToFileURL(runtimePath).href),service=new GameBuilderService({workerPath,root});
  try{
    const bytes=await readFixture('fox-walk'),result=await service.importFile({bytes,name:'Fox',fileName:'fox.keelasset'});
    const html=await service.styledPreview(),script=html.match(/<script>([\s\S]*)<\/script>$/)?.[1];assert.ok(script);
    const p=preview(runtime,{sourceCode:script}),asset=await runtime.importStyledAsset(bytes);
    await p.load(result.playback);assert.equal(p.messages.at(-1).type,'styled-asset-loaded',p.messages.at(-1).message);
    assert.deepEqual(p.pixels,asset.raster.frames[0]);p.el('time').value='.5';p.el('time').oninput();p.tick();
    assert.deepEqual(p.pixels,asset.raster.frames[3]);assert.equal(p.webglAttempts,0);
    await p.load({format:'invalid'},2);assert.equal(p.messages.at(-1).type,'styled-asset-error');
  }finally{service.close();}
});
