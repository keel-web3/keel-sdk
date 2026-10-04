// Trusted, bundled players. Messages carry validated asset data, never scripts.
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {importStyledAsset,createStyledAssetPlayer} from '@keel-engine/import/styled-asset';
import * as styledRuntime from '@keel-engine/import/styled-asset';
const $=id=>document.getElementById(id),send=m=>parent.postMessage(m,'*');
let renderer,controls,player=null,raster=null,epoch=0,playing=true,time=0,duration=0,last=performance.now();
const camera=new THREE.PerspectiveCamera(40,1,.01,10000);

function nativeRenderer(){
  if(renderer)return;
  renderer=new THREE.WebGLRenderer({canvas:$('view'),alpha:true,antialias:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;
  controls=new OrbitControls(camera,renderer.domElement);
}
function bytesOf(value){
  if(typeof value!=='string'||!value.length||value.length>96*1024*1024)throw Error('Invalid validated preview payload');
  const binary=atob(value);return Uint8Array.from(binary,c=>c.charCodeAt(0));
}
function chooseClip(index){
  if(!player?.clips.length)return;
  player.play(index);time=0;duration=player.clips[index].duration;playing=true;$('play').textContent='Pause';
}
$('clip').onchange=()=>chooseClip(Number($('clip').value));
$('direction').onchange=()=>player?.setDirection(Number($('direction').value));
$('play').onclick=()=>{playing=!playing;$('play').textContent=playing?'Pause':'Play';};
$('time').oninput=()=>{playing=false;time=Number($('time').value)*duration;if(raster&&time===duration)time=duration*(1-1e-12);$('play').textContent='Play';};

addEventListener('message',async event=>{
  if(event.source!==parent||event.data?.type!=='styled-asset-load')return;
  const id=event.data.id,generation=++epoch;player?.dispose();player=null;raster=null;
  $('view').hidden=true;$('raster-view').hidden=true;$('controls').hidden=true;
  $('status').textContent='Reconstructing the imported styled asset…';
  try{
    const payload=event.data.asset;
    if(payload?.format!=='KEEL-IMPORTED-STYLED-ASSET')throw Error('Invalid validated preview payload');
    let asset,made;
    if(payload.animation?.mode==='baked-frames'){
      // Revalidate the compact package in the trusted runtime, including frame
      // checksums and clip/direction metadata. Never play the static card GLB.
      asset=await importStyledAsset(bytesOf(payload.packageBase64));
      if(generation!==epoch)return;
      if(!asset.raster||asset.animation.mode!=='baked-frames')throw Error('Expected a raster sprite package');
      if(typeof styledRuntime.createRasterCanvasPlayer!=='function')throw Error('Update the engine to play raster sprite assets');
      made=styledRuntime.createRasterCanvasPlayer({canvas:$('raster-view'),asset});
    }else{
      asset={...payload,glb:bytesOf(payload.glbBase64)};
      nativeRenderer();
      made=await createStyledAssetPlayer({THREE,GLTFLoader,renderer,asset});
    }
    if(generation!==epoch){made.dispose();return;}player=made;raster=asset.raster??null;
    if(raster){$('raster-view').hidden=false;}
    else{
      $('view').hidden=false;
      const box=player.bounds,center=box.isEmpty()?new THREE.Vector3():box.getCenter(new THREE.Vector3()),radius=box.isEmpty()?1:Math.max(box.getSize(new THREE.Vector3()).length()/2,.01);
      camera.position.copy(center).add(new THREE.Vector3(1,.55,1.4).normalize().multiplyScalar(radius*3.2));camera.near=radius/1000;camera.far=radius*1000;camera.updateProjectionMatrix();controls.target.copy(center);controls.update();
    }
    $('clip').replaceChildren(...player.clips.map((c,i)=>new Option(c.name||`Clip ${i+1}`,String(i))));
    const directions=raster?.animation.directions??1;
    $('direction').replaceChildren(...Array.from({length:directions},(_,i)=>new Option(`View ${i+1} · ${Math.round(((raster?.camera.azimuth??0)+i*Math.PI*2/directions)*180/Math.PI)%360}°`,String(i))));
    $('direction').value='0';$('direction').hidden=directions<2;
    for(const name of['clip','play','time','time-label'])$(name).hidden=!player.clips.length;
    $('controls').hidden=!player.clips.length&&directions<2;
    time=0;duration=player.clips[0]?.duration||0;playing=true;last=performance.now();if(player.clips.length)chooseClip(0);
    const detail=raster?`raster sprite · ${raster.width} × ${raster.height} · ${raster.animation.name} · ${raster.animation.frameCount} frames × ${directions} views`:asset.animation.mode==='static-pose'?'static voxel pose':player.clips.length+' animation clips';
    $('status').textContent=`${asset.style.kind} · ${detail} · imported by KEEL`;
    send({type:'styled-asset-loaded',id,style:asset.style,clips:player.clips.length,staticPose:asset.animation.mode==='static-pose',...(raster?{raster:{width:raster.width,height:raster.height,animation:raster.animation}}:{})});
  }catch(error){if(generation!==epoch)return;$('status').textContent=error.message;send({type:'styled-asset-error',id,message:error.message});}
});
function tick(now){
  requestAnimationFrame(tick);const dt=Math.max(0,Math.min((now-last)/1000,.1));last=now;if(!player)return;
  try{
    if(playing&&duration)time=(time+dt)%duration;
    if(raster)player.render({time});
    else{
      const r=$('view').getBoundingClientRect(),width=Math.max(1,Math.floor(r.width)),height=Math.max(1,Math.floor(r.height));
      renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();controls.update();player.render(camera,{width,height,time});
    }
    $('time').value=duration?time/duration:0;$('time-label').textContent=time.toFixed(2)+' / '+duration.toFixed(2)+' s';
  }catch(error){$('status').textContent=error.message;player.dispose();player=null;}
}
requestAnimationFrame(tick);send({type:'styled-asset-ready'});
