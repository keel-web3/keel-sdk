import React from 'react';
import {DEFAULT_DIRECT_IMAGE,directImageCompatibility,type DirectImageSettings} from '@keel/sdk/direct-image';
import type {Project,Shared} from './types';
import {api} from './client';
import {Field} from './ui';

export function DirectImageEditor({project,change,save,action,capture,ready,notice,previewPNG,apngFrames}:{project:Project;change:(p:Partial<Project>)=>void;save:()=>Promise<any>;action:Shared['action'];capture:{tokenId:string;overrides:Record<string,string>;variantOverrides:Record<string,string>};ready:boolean;previewPNG:string;apngFrames:()=>Promise<string[]>;notice:(s:string)=>void}){
  const settings=project.directImage;
  if(!settings)return <details className="disclosure direct-image-settings"><summary>Direct image renderer</summary><p>For collections that display an image directly. Choose PNG or SVG for still artwork, or GIF and WebP for animation.</p><button onClick={()=>change({directImage:{...DEFAULT_DIRECT_IMAGE}})}>Set up direct image</button></details>;
  const info=directImageCompatibility(settings);
  return <details className="disclosure direct-image-settings" open><summary>Direct image renderer</summary>
    <p>These choices apply to the collection’s image. Your HTML renderer keeps its own settings.</p>
    <Field label="Artwork"><select value={settings.motion} onChange={e=>change({directImage:e.target.value==='animation'?{motion:'animation',format:'gif'}:{motion:'still',format:'png'}})}><option value="still">Still image</option><option value="animation">Animation</option></select></Field>
    <Field label="Direct image format"><select value={settings.format} onChange={e=>change({directImage:{...settings,format:e.target.value as DirectImageSettings['format']}})}>{settings.motion==='still'?<><option value="png">PNG · default, lossless</option><option value="apng">APNG · builds up the layers</option><option value="svg">SVG · reusable layer stack</option><option value="webp">WebP · optional</option></>:<><option value="apng">APNG · layer-build animation</option><option value="gif">GIF</option><option value="webp">Animated WebP</option></>}</select></Field>
    {info.notes.map(note=><p key={note}>{note}</p>)}
    {settings.format==='apng'&&<button disabled={!ready} onClick={()=>void action(async()=>{const frames=await apngFrames();await save();const result=await api('prepareRasterAPNG',{projectId:project.id,frames,tokenId:capture.tokenId});if(result)notice(result.message);})}>Save layer-build APNG</button>}
    {settings.format==='png'&&<div className="raster-preparation"><button disabled={!ready||!previewPNG} onClick={()=>void action(async()=>{await save();const result=await api('prepareRasterPreview',{projectId:project.id,dataUrl:previewPNG,tokenId:capture.tokenId,stripRows:16});if(result)notice(result.message);})}>Prepare reusable PNG strips</button><p>Creates a normal PNG plus reusable pieces of this preview. Your masks, meshes and layer rules are preserved in the rendered pixels. Preparing all collection combinations and publishing them are separate steps.</p></div>}
    {settings.format==='svg'&&<button disabled={!ready} onClick={()=>void action(async()=>{await save();const result=await api('exportLayeredSVG',{projectId:project.id,...capture});if(result)notice(result.message);})}>Save SVG of this preview</button>}
    <p>Layers are stored as reusable binary chunks. The recipe keeps your rarity, selections and layering rules together.</p>
    <details><summary>Publication status</summary><p>Local PNG strips, layer-build APNG and SVG export are available. Contract rendering, collection coverage and marketplace compatibility still need verification before publication.</p></details>
    <button onClick={()=>void action(async()=>{await save();const result=await api('exportDirectImagePackage',project.id);if(result)notice(result.message);})}>Prepare direct image files</button>
    <button onClick={()=>change({directImage:undefined})}>Remove direct image setup</button>
  </details>;
}
