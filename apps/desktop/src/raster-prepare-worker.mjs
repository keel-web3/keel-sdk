import {assembleLayerAPNG} from '@keel/sdk/raster-apng';
import {parentPort,workerData} from 'node:worker_threads';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {decodeRasterPNG,compilePNGStrips,assemblePNGStrips,verifyStripPNG,pngStripEnvelope} from '@keel/sdk/raster-strips';
try{
  if(workerData.kind==='apng'){
    const bytes=assembleLayerAPNG(workerData.frames.map(b=>Uint8Array.from(b)));
    await mkdir(workerData.directory,{recursive:true,mode:0o700});await writeFile(path.join(workerData.directory,'artwork.apng'),bytes,{flag:'wx',mode:0o600});
    await writeFile(path.join(workerData.directory,'recipe.json'),JSON.stringify({schema:'keel-layer-build-apng@1',source:workerData.source,frames:workerData.frames.length,plays:1,frameDelayMs:30,blend:'over',disposal:'none',publicationReady:false,compatibility:'Default-image readers show the first layer, not the final composition.'},null,2),{flag:'wx',mode:0o600});
    parentPort.postMessage({result:{directory:workerData.directory,message:'Saved a lossless APNG that builds this layer stack once. Save PNG in the editor for a flattened still. Marketplace playback has not been verified.'}});
  }else{
  const bytes=Uint8Array.from(workerData.bytes);
  if(bytes.length<33)throw Error('Missing PNG preview.');const v=new DataView(bytes.buffer),width=v.getUint32(16),height=v.getUint32(20);if(!width||!height||width*height>33_554_432)throw Error('Preview exceeds the 32 megapixel preparation budget.');
  const pixels=await decodeRasterPNG(bytes),result=compilePNGStrips(pixels,workerData.stripRows),png=await assemblePNGStrips(result.recipe,async id=>result.chunks.get(id).bytes),proof=verifyStripPNG(png,pixels);
  const folder=workerData.directory;await mkdir(path.join(folder,'strips'),{recursive:true,mode:0o700});
  for(const part of result.chunks.values())await writeFile(path.join(folder,'strips',part.digest),part.bytes,{flag:'wx',mode:0o600});
  const {header,footer}=pngStripEnvelope(result.recipe);await writeFile(path.join(folder,'header.bin'),header,{flag:'wx',mode:0o600});await writeFile(path.join(folder,'footer.bin'),footer,{flag:'wx',mode:0o600});
  await writeFile(path.join(folder,'artwork.png'),png,{flag:'wx',mode:0o600});
  const report={...result.recipe,proof,scope:'current-editor-preview',source:workerData.source,stripRows:workerData.stripRows,uniqueStrips:result.chunks.size,storedStripBytes:[...result.chunks.values()].reduce((n,c)=>n+c.bytes.length,0),pngBytes:png.length,sourcePNGBytes:bytes.length,readAssembly:'header + ordered raw IDAT strips + footer',contractAdapter:'not-deployed',coverage:'This preview only. Prepare every allowed strip combination before seed-based onchain selection.'};
  await writeFile(path.join(folder,'recipe.json'),JSON.stringify(report,null,2),{flag:'wx',mode:0o600});parentPort.postMessage({result:{directory:folder,message:`Prepared a standard PNG from ${result.recipe.strips.length} strips (${result.chunks.size} unique). Every pixel matches this preview. Files saved locally; contract publication is not yet connected.`,report}});
  }
}catch(error){parentPort.postMessage({error:error.message});}
