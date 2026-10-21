import {KEEL_THREE_R180} from "./three-module.js";
import {KEEL_MODEL_VENDOR_MODULES} from "./model-viewer-vendor.js";
import {KEEL_MODEL_MEDIA_TYPES, KEEL_GLTF_SUPPORTED_EXTENSIONS, resolveKeelModelResourcePath, decodeKeelModelDataURI, parseKeelModelGLTF, keelModelMTLTexturePath, assertKeelModelTexture, inspectKeelModelMedia} from "./model-media.js";

export const KEEL_MODEL_DISPLAY_MODULE_ID = "keel.model-display" as const;
export const KEEL_MODEL_DISPLAY_MODULE_VERSION = "1.0.0" as const;
/** Updated only with a reviewed exact source revision, never a live-registration claim. */
export const KEEL_MODEL_DISPLAY_REVISION = Object.freeze({version: KEEL_MODEL_DISPLAY_MODULE_VERSION, digest: "0xa5edcc88564c9f43d3aa0010b267d92e1f15a4a479a4628c7fcd0109f0cb0232", byteLength: 20751});

const MODEL_RUNTIME = String.raw`
const entry=binding.original,content=globalThis.__KEEL_CONTENT__,modules=globalThis.__KEEL_MODULES__,root=document.getElementById("keel-asset-display");
if(!entry||!content||!root||!modules)throw new Error("KEEL model viewer requires its exact verified entry and module closure.");
const THREE=modules["three-r180-module"];
if(String(THREE?.REVISION)!=="180")throw new Error("KEEL model viewer requires pinned Three r180.");
const records=content.resources(),resources=binding.resources.map(r=>{const actual=records.find(v=>v.id===r.id);if(!actual||actual.role!=="asset"||actual.mediaType!==r.mediaType||actual.digest!==r.integrity.digest||actual.byteLength!==r.integrity.byteLength)throw new Error("Model presentation binding differs from verified original resource "+r.id);return{id:r.id,mediaType:r.mediaType,aliases:r.aliases,source:content.bytes(r.id)}});
const original=resources.find(r=>r.id===entry.id),assets=resources.filter(r=>r.id!==entry.id),profile=inspectKeelModelMedia(original,assets),byPath=new Map();
for(const r of resources)for(const alias of [r.id,...r.aliases])byPath.set(resolveKeelModelResourcePath("",alias),r);
const resolve=uri=>{const found=byPath.get(resolveKeelModelResourcePath("",uri));if(!found)throw new Error("Undeclared verified model dependency "+uri);return found};
let renderer,scene,model,camera,mixer,clips=[],scenes=[],sourceCameras=[],action,playing=true,disposed=false,last=performance.now(),frame=0;
const manager=new THREE.LoadingManager();
manager.setURLModifier(uri=>uri.startsWith("blob:")||uri.startsWith("data:")?uri:content.url(resolve(uri).id));
const ready=(async()=>{
 let result;
 if(profile.format==="gltf"){
  const GLTFLoader=modules["three-r180-gltf-loader"]?.GLTFLoader;if(!GLTFLoader)throw new Error("Missing exact verified GLTFLoader.");
  const loader=new GLTFLoader(manager);
  loader.register(parser=>{parser.textureLoader=new THREE.TextureLoader(manager);parser.fileLoader={load:(uri,onLoad,_progress,onError)=>{try{const b=uri.startsWith("data:")?decodeKeelModelDataURI(uri):content.bytes(resolve(uri).id);queueMicrotask(()=>onLoad(b.slice().buffer))}catch(error){queueMicrotask(()=>onError(error))}}};return{name:"KEEL_verified_memory_only"}});
  const bytes=original.source;result=await loader.parseAsync(entry.mediaType==="model/gltf+json"?new TextDecoder("utf-8",{fatal:true}).decode(bytes):bytes.slice().buffer,profile.entryPath.split("/").slice(0,-1).join("/")+(profile.entryPath.includes("/")?"/":""));
  scenes=result.scenes;model=result.scene;clips=result.animations;sourceCameras=result.cameras;
 }else{
  const OBJLoader=modules["three-r180-obj-loader"]?.OBJLoader;if(!OBJLoader)throw new Error("Missing exact verified OBJLoader.");
  const loader=new OBJLoader(manager),creators=[],materials=new Map();let pending=0,done,failed;const textures=new Promise((resolve,reject)=>{done=resolve;failed=reject});
  manager.onStart=()=>{pending++};manager.onLoad=()=>done();manager.onError=uri=>failed(new Error("Verified model texture decode failed: "+uri));
  if(profile.materialLibraryIds.length){
   const MTLLoader=modules["three-r180-mtl-loader"]?.MTLLoader;if(!MTLLoader)throw new Error("Missing exact verified MTLLoader.");
   for(const id of profile.materialLibraryIds){const r=resources.find(r=>r.id===id),path=r.aliases[0]??r.id,base=path.split("/").slice(0,-1).join("/")+(path.includes("/")?"/":""),creator=new MTLLoader(manager).parse(new TextDecoder("utf-8",{fatal:true}).decode(r.source),base);creators.push(creator);for(const name of Object.keys(creator.materialsInfo)){if(materials.has(name))throw new Error("Ambiguous verified OBJ material "+name);materials.set(name,creator)}creator.preload()}
   loader.setMaterials({create:name=>{const creator=materials.get(name);if(!creator)throw new Error("Undeclared verified OBJ material "+name);return creator.create(name)}});
  }
  if(pending)await textures;model=loader.parse(new TextDecoder("utf-8",{fatal:true}).decode(original.source));scenes=[model];
 }
 renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;
 renderer.domElement.setAttribute("aria-label",entry.name||"Verified KEEL model");Object.assign(renderer.domElement.style,{display:"block",width:"100%",height:"100%"});root.replaceChildren(renderer.domElement);root.dataset.modelState="ready";
 scene=new THREE.Scene();scene.background=new THREE.Color(/^#?[0-9a-f]{6}$/i.test(entry.background_color??"")?"#"+entry.background_color.replace(/^#/,""):"#05060b");scene.add(new THREE.HemisphereLight(0xffffff,0x444444,2));const sun=new THREE.DirectionalLight(0xffffff,2);sun.position.set(3,5,4);scene.add(sun);
 function mount(next){if(mixer){mixer.stopAllAction();mixer.uncacheRoot(model)}if(model?.parent===scene)scene.remove(model);model=next;scene.add(model);model.updateMatrixWorld(true);mixer=new THREE.AnimationMixer(model);action=undefined;if(clips.length){action=mixer.clipAction(clips[0]);action.play()}camera=undefined;model.traverse(n=>{if(!camera&&n.isCamera)camera=n});if(!camera){const bounds=new THREE.Box3().setFromObject(model),center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3()),radius=Math.max(size.x,size.y,size.z,.01);camera=new THREE.PerspectiveCamera(40,1,Math.max(radius/1000,.001),radius*1000);camera.position.set(center.x,center.y,center.z+radius*1.8);camera.lookAt(center)}last=performance.now()}
 mount(model);
 const draw=now=>{if(disposed)return;const width=Math.max(1,root.clientWidth),height=Math.max(1,root.clientHeight);renderer.setSize(width,height,false);if(camera.isPerspectiveCamera){camera.aspect=width/height;camera.updateProjectionMatrix()}if(playing)mixer.update(Math.max(0,(now-last)/1000));last=now;renderer.render(scene,camera);frame=requestAnimationFrame(draw)};frame=requestAnimationFrame(draw);
 return Object.freeze({sceneCount:scenes.length,clipNames:Object.freeze(clips.map(c=>c.name)),sourceCameraCount:sourceCameras.length,selectScene:index=>{if(!Number.isInteger(index)||!scenes[index])throw new RangeError("Unknown original model scene");mount(scenes[index])}});
})();
const modelViewer=Object.freeze({protocol:"keel-model-viewer@1",ready,
 play:async(index=0)=>{await ready;const selected=typeof index==="string"?clips.find(c=>c.name===index):clips[index];if(!selected)throw new RangeError("Unknown original model animation");mixer.stopAllAction();action=mixer.clipAction(selected);action.reset().play();playing=true;last=performance.now()},
 pause:async()=>{await ready;playing=false},seek:async seconds=>{await ready;if(!Number.isFinite(seconds)||seconds<0)throw new RangeError("Model animation time must be nonnegative");mixer.setTime(seconds);model.updateMatrixWorld(true);renderer.render(scene,camera)},
 dispose:async()=>{await ready;if(disposed)return;disposed=true;cancelAnimationFrame(frame);mixer.stopAllAction();for(const originalScene of scenes)originalScene.traverse(n=>{n.geometry?.dispose();for(const material of Array.isArray(n.material)?n.material:n.material?[n.material]:[]){for(const value of Object.values(material))if(value?.isTexture)value.dispose();material.dispose()}});renderer.dispose();root.replaceChildren()}});
ready.catch(error=>{root.dataset.modelState="failed";setTimeout(()=>{throw error},0)});
return modelViewer;
`;

export function keelModelDisplayModuleBytes(): Uint8Array {
  return new TextEncoder().encode([
    `const KEEL_MODEL_MEDIA_TYPES=${JSON.stringify(KEEL_MODEL_MEDIA_TYPES)},KEEL_GLTF_SUPPORTED_EXTENSIONS=${JSON.stringify(KEEL_GLTF_SUPPORTED_EXTENSIONS)};`,
    resolveKeelModelResourcePath.toString(), decodeKeelModelDataURI.toString(), parseKeelModelGLTF.toString(), keelModelMTLTexturePath.toString(), assertKeelModelTexture.toString(), inspectKeelModelMedia.toString(), "export function createModelViewer(binding){", MODEL_RUNTIME, "}",
  ].join("\n"));
}

/** Exact source byte profiles; selected-chain receipt/read-back is a separate requirement. */
export function keelModelViewerModuleProfiles(format: "gltf" | "obj", materialLibraries = false) {
  const three = [
    {moduleId: KEEL_THREE_R180.core.id, version: KEEL_THREE_R180.version, digest: KEEL_THREE_R180.core.digest.replace("sha256:", "0x"), byteLength: KEEL_THREE_R180.core.byteLength, aliases: ["three.core.min.js", "./three.core.min.js", "/content/three.core.min.js"], execution: "module" as const, phase: "runtime" as const, weight: 0},
    {moduleId: KEEL_THREE_R180.main.id, version: KEEL_THREE_R180.version, digest: KEEL_THREE_R180.main.digest.replace("sha256:", "0x"), byteLength: KEEL_THREE_R180.main.byteLength, aliases: ["three.module.min.js", "./three.module.min.js", "/content/three.module.min.js"], execution: "module" as const, phase: "runtime" as const, weight: 0},
  ];
  const ids = format === "gltf" ? ["three-r180-buffer-utils", "three-r180-gltf-loader"] : ["three-r180-obj-loader", ...(materialLibraries ? ["three-r180-mtl-loader"] : [])];
  return Object.freeze([...three, ...ids.map(id => KEEL_MODEL_VENDOR_MODULES.find(m => m.moduleId === id)!), {moduleId: KEEL_MODEL_DISPLAY_MODULE_ID, ...KEEL_MODEL_DISPLAY_REVISION, aliases: [KEEL_MODEL_DISPLAY_MODULE_ID], execution: "module" as const, phase: "render" as const, weight: 0}]);
}

export {KEEL_MODEL_VENDOR_MODULES};
