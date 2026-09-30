// Trusted, bundled player. Messages carry validated asset data, never scripts.
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {createStyledAssetPlayer} from '@keel-engine/import/styled-asset';
const $=id=>document.getElementById(id),send=m=>parent.postMessage(m,'*');
let renderer,player=null,epoch=0,playing=true,time=0,duration=0,last=performance.now();
const camera=new THREE.PerspectiveCamera(40,1,.01,10000);let controls;
try{renderer=new THREE.WebGLRenderer({canvas:$('view'),alpha:true,antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;controls=new OrbitControls(camera,renderer.domElement);}catch(error){$('status').textContent='WebGL preview unavailable: '+error.message;}
function chooseClip(index){if(!player?.clips.length)return;player.play(index);time=0;duration=player.clips[index].duration;playing=true;$('play').textContent='Pause';}
$('clip').onchange=()=>chooseClip(Number($('clip').value));$('play').onclick=()=>{playing=!playing;$('play').textContent=playing?'Pause':'Play';};$('time').oninput=()=>{playing=false;time=Number($('time').value)*duration;$('play').textContent='Play';};
addEventListener('message',async event=>{
  if(event.source!==parent||event.data?.type!=='styled-asset-load')return;
  const id=event.data.id,generation=++epoch;player?.dispose();player=null;
  if(!renderer){send({type:'styled-asset-error',id,message:'WebGL context is unavailable in this browser.'});return;}
  try{
    const payload=event.data.asset;if(payload?.format!=='KEEL-IMPORTED-STYLED-ASSET'||typeof payload.glbBase64!=='string'||payload.glbBase64.length>96*1024*1024)throw Error('Invalid validated preview payload');
    const binary=atob(payload.glbBase64),glb=Uint8Array.from(binary,c=>c.charCodeAt(0));
    const made=await createStyledAssetPlayer({THREE,GLTFLoader,renderer,asset:{...payload,glb}});
    if(generation!==epoch){made.dispose();return;}player=made;
    const box=player.bounds,center=box.isEmpty()?new THREE.Vector3():box.getCenter(new THREE.Vector3()),radius=box.isEmpty()?1:Math.max(box.getSize(new THREE.Vector3()).length()/2,.01);
    camera.position.copy(center).add(new THREE.Vector3(1,.55,1.4).normalize().multiplyScalar(radius*3.2));camera.near=radius/1000;camera.far=radius*1000;camera.updateProjectionMatrix();controls.target.copy(center);controls.update();
    $('clip').replaceChildren(...player.clips.map((c,i)=>new Option(c.name||`Clip ${i+1}`,String(i))));
    $('controls').hidden=!player.clips.length;time=0;duration=player.clips[0]?.duration||0;playing=true;if(player.clips.length)chooseClip(0);
    $('status').textContent=`${payload.style.kind} · ${payload.animation.mode==='static-pose'?'static voxel pose':player.clips.length+' animation clips'} · imported by KEEL`;
    send({type:'styled-asset-loaded',id,style:player.style,clips:player.clips.length,staticPose:payload.animation.mode==='static-pose'});
  }catch(error){if(generation!==epoch)return;$('status').textContent=error.message;send({type:'styled-asset-error',id,message:error.message});}
});
function tick(now){requestAnimationFrame(tick);const dt=Math.min((now-last)/1000,.1);last=now;if(!player)return;try{if(playing&&duration)time=(time+dt)%duration;const r=$('view').getBoundingClientRect(),width=Math.max(1,Math.floor(r.width)),height=Math.max(1,Math.floor(r.height));renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();controls.update();player.render(camera,{width,height,time});$('time').value=duration?time/duration:0;$('time-label').textContent=time.toFixed(2)+' / '+duration.toFixed(2)+' s';}catch(error){$('status').textContent=error.message;player.dispose();player=null;}}
requestAnimationFrame(tick);send({type:'styled-asset-ready'});
