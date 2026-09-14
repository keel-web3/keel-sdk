import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {decodeRasterPNG,compilePNGStrips,assemblePNGStrips,verifyStripPNG} from '../../../packages/sdk/dist/raster-strips.js';
const root='apps/desktop/artifacts/gator-raster-study';
const ids=JSON.parse(await readFile(`${root}/sample-ids.json`,'utf8'));
const resolution=Number(process.env.KEEL_RASTER_SIZE||2160);if(![1080,2160].includes(resolution))throw Error('Unsupported study size');
const sampleFolder=resolution===2160?'samples':'samples-1080';
const reports=[];
for(const stripRows of [16,64]){
 const unique=new Map();let originalBytes=0,pngBytes=0,references=0;const start=Date.now();
 for(const [index,id] of ids.entries()){
  const source=await readFile(`${root}/${sampleFolder}/${id}.png`),pixels=await decodeRasterPNG(source),{recipe,chunks}=compilePNGStrips(pixels,stripRows),png=await assemblePNGStrips(recipe,async id=>chunks.get(id).bytes);verifyStripPNG(png,pixels);
  const decoded=await decodeRasterPNG(png);if(Buffer.compare(Buffer.from(decoded.data),Buffer.from(pixels.data)))throw Error('Independent PNG decoder pixel mismatch');
  for(const [digest,part] of chunks)unique.set(digest,part.bytes.length);
  originalBytes+=source.length;pngBytes+=png.length;references+=recipe.strips.length;
  if(index===0){await mkdir(`${root}/prepared-${resolution}-${stripRows}`,{recursive:true});await writeFile(`${root}/prepared-${resolution}-${stripRows}/token-${id}.png`,png);await writeFile(`${root}/prepared-${resolution}-${stripRows}/recipe.json`,JSON.stringify(recipe,null,2));}
  if((index+1)%16===0)console.log(JSON.stringify({stripRows,tokens:index+1,uniqueStrips:unique.size,uniqueBytes:[...unique.values()].reduce((a,b)=>a+b,0)}));
 }
 const result={resolution,stripRows,tokens:ids.length,uniqueStrips:unique.size,uniqueStripBytes:[...unique.values()].reduce((a,b)=>a+b,0),references,referenceBytesAt32BytesEach:references*32,fullPNGBytes:pngBytes,sourceCompositePNGBytes:originalBytes,exactRGBA:true,independentDecoder:'squoosh-png',seconds:(Date.now()-start)/1000};reports.push(result);await writeFile(`${root}/compression-results-${resolution}.json`,JSON.stringify({scope:'128 original token IDs, not a full-collection byte measurement',ids,results:reports},null,2));console.log(JSON.stringify(result));
}
