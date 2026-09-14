/** Optional lossy PNG previews and an explicitly shared project palette. */
import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../../../packages/studio-core/package.json',import.meta.url));
const sharp=require('sharp');sharp.concurrency(2);
const base='apps/desktop/artifacts/gator-raster-study/full-1080',root=`${base}/png-quantization-study`;
await mkdir(root,{recursive:true});const previews=[];
for(const id of [0,3022,365,2834]) {
 const source=`${base}/native-4000/references/${id}.png`,original=await sharp(source).removeAlpha().raw().toBuffer();
 const variants=[];
 for(const dither of [0,1]) {
  const file=`${root}/${id}-palette-q90-d${dither}.png`;
  await sharp(source).removeAlpha().png({palette:true,quality:90,colours:256,dither,effort:7,compressionLevel:9}).toFile(file);
  const bytes=await readFile(file),pixels=await sharp(bytes).removeAlpha().raw().toBuffer();assert.equal(pixels.length,original.length);
  let squared=0,maxError=0;for(let i=0;i<pixels.length;i++){const e=Math.abs(pixels[i]-original[i]);squared+=e*e;maxError=Math.max(e,maxError);}
  variants.push({requestedQuality:90,dither,bytes:bytes.length,psnrDB:10*Math.log10(255**2/(squared/pixels.length)),maxChannelError:maxError,pixelExact:pixels.equals(original),palette:true});
 }
 previews.push({tokenId:id,variants});console.log(JSON.stringify(previews.at(-1)));
}
await writeFile(`${root}/preview-sizes.json`,JSON.stringify(previews,null,2));
const ids=JSON.parse(await readFile('apps/desktop/artifacts/gator-raster-study/sample-ids.json','utf8'));
const tiles=[];
for(const id of ids) tiles.push(await sharp(`${base}/native-128-sample/token-${id}.png`).removeAlpha().resize(256,256).png().toBuffer());
await sharp({create:{width:2048,height:Math.ceil(tiles.length/8)*256,channels:3,background:'#000000'}}).composite(tiles.map((input,i)=>({input,left:(i%8)*256,top:Math.floor(i/8)*256}))).png({palette:true,quality:90,colours:256,dither:0,effort:7,compressionLevel:9}).toFile(`${root}/shared-palette-training.png`);
console.log(JSON.stringify({sharedPaletteTrainingTiles:ids.length,scope:'Palette derived from 256px thumbnails of the fixed 128-token sample; global-palette full-resolution quality must be measured separately.'}));
