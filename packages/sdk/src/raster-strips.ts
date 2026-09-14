/** Node authoring compiler. Prepared strips join into ONE ordinary PNG zlib stream.
 * Each strip starts a fresh deflate dictionary and a PNG row independent of its predecessor.
 * Rendering/blending belongs in authoring; read-time assembly never decodes pixels.
 */
import {createHash} from 'node:crypto';
import {constants,deflateRawSync,inflateSync} from 'node:zlib';
import {readFile} from 'node:fs/promises';
import decodePNG,{init as initPNG} from '@jsquash/png/decode.js';

export type RasterPixels={width:number;height:number;data:Uint8Array|Uint8ClampedArray};
export type PNGStrip={digest:string;rows:number;filteredBytes:number;adler:number;bytes:Uint8Array};
export type PNGStripRecipe={schema:'keel-png-strips@1';width:number;height:number;strips:Omit<PNGStrip,'bytes'>[];pixelDigest:string;publicationReady:false};
let pngReady:Promise<void>|undefined;
/** Authoring decode only. Editor previews are rendered to sRGB before entering this compiler. */
export async function decodeRasterPNG(input:Uint8Array){
  if(input.length<33||input.length>128*1024*1024||!Buffer.from(input.subarray(0,8)).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('Invalid PNG source.');
  const view=new DataView(input.buffer,input.byteOffset,input.byteLength),w=view.getUint32(16),h=view.getUint32(20);if(!w||!h||w*h>33_554_432||input[24]!==8)throw Error('Prepare an 8-bit PNG under 32 megapixels.');
  pngReady??=(async()=>{await initPNG(new WebAssembly.Module(await readFile(new URL(import.meta.resolve('@jsquash/png/codec/pkg/squoosh_png_bg.wasm')))));})();await pngReady;return decodePNG(Uint8Array.from(input).buffer);
}
export const rasterHash=(b:Uint8Array|Uint8ClampedArray):string=>{const hash=createHash('sha256');hash.update(new Uint8Array(b.buffer,b.byteOffset,b.byteLength));return hash.digest('hex');};
const crcTable=Uint32Array.from({length:256},(_,i)=>{for(let k=0;k<8;k++)i=i&1?0xedb88320^(i>>>1):i>>>1;return i>>>0;});
export function pngChunk(type:string,data:Uint8Array){
  const out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);out.write(type,4,4,'ascii');out.set(data,8);let crc=0xffffffff;
  for(let i=4;i<out.length-4;i++)crc=crcTable[(crc^out[i]!)&255]!^(crc>>>8);
  out.writeUInt32BE((crc^0xffffffff)>>>0,out.length-4);return out;
}
export function pngHeader(width:number,height:number){const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',ihdr),pngChunk('sRGB',Buffer.from([0]))]);}
function adler(bytes:Uint8Array){let a=1,b=0;for(const x of bytes){a=(a+x)%65521;b=(b+a)%65521;}return ((b<<16)|a)>>>0;}
function combine(a:number,b:number,length:number){const lo=((a&65535)+(b&65535)-1+65521)%65521;const hi=((a>>>16)+(b>>>16)+(length%65521)*((a&65535)-1))%65521;return (((hi+65521)%65521)*65536+lo)>>>0;}
export {adler as pngAdler,combine as combinePNGAdler};
function dimensions(image:RasterPixels){if(!Number.isSafeInteger(image.width)||!Number.isSafeInteger(image.height)||image.width<1||image.height<1||image.width*image.height>33_554_432||image.data.length!==image.width*image.height*4)throw Error('Invalid raster dimensions or RGBA length.');}
function filtered(image:RasterPixels){
  const stride=image.width*4,out=Buffer.alloc((stride+1)*image.height);
  for(let y=0;y<image.height;y++){
    const start=y*stride;let subScore=0,upScore=0;
    for(let x=0;x<stride;x++){const v=image.data[start+x]!,sub=(v-(x>=4?image.data[start+x-4]!:0))&255,up=(v-(y?image.data[start+x-stride]!:0))&255;subScore+=Math.min(sub,256-sub);upScore+=Math.min(up,256-up);}
    // The first row cannot reference pixels in a preceding, independently chosen strip.
    const useUp=y>0&&upScore<subScore;out[y*(stride+1)]=useUp?2:1;
    for(let x=0;x<stride;x++)out[y*(stride+1)+1+x]=(image.data[start+x]!-(useUp?image.data[start+x-stride]!:x>=4?image.data[start+x-4]!:0))&255;
  }return out;
}
export function preparePNGStrip(image:RasterPixels):PNGStrip{
  dimensions(image);const raw=filtered(image);
  // SYNC_FLUSH leaves a byte-aligned NONFINAL block; a fresh compressor has no cross-strip references.
  const compressed=deflateRawSync(raw,{level:9,finishFlush:constants.Z_SYNC_FLUSH});
  const bytes=pngChunk('IDAT',compressed);return {digest:rasterHash(bytes),rows:image.height,filteredBytes:raw.length,adler:adler(raw),bytes};
}
/** Prepared placements must already include their masks/meshes. Cache keys use actual strip
 * pixels, so a changed trait/placement cannot silently reuse an earlier composition.
 * Flat full-canvas layers use this directly. Other placements can supply rasterized strips.
 */
export async function compileLayerStripStack(width:number,height:number,layerCount:number,load:(index:number,y:number,rows:number)=>Promise<Uint8Array>,options:{stripRows?:number;cache?:Map<string,PNGStrip>;composite:(layers:Uint8Array[],width:number,rows:number)=>Promise<Uint8Array>}){
  const stripRows=options.stripRows??16;if(!Number.isSafeInteger(width)||width<1||!Number.isSafeInteger(height)||height<1||width*height>33_554_432||!Number.isSafeInteger(layerCount)||layerCount<1||layerCount>256||!Number.isSafeInteger(stripRows)||stripRows<1||stripRows>256)throw Error('Invalid layer strip dimensions.');
  const cache=options.cache??new Map<string,PNGStrip>(),chunks=new Map<string,PNGStrip>(),strips:PNGStripRecipe['strips']=[];
  const stats={strips:0,cacheHits:0,singleLayer:0,overlapping:0,empty:0,hiddenLayersSkipped:0};
  for(let y=0;y<height;y+=stripRows){const rows=Math.min(stripRows,height-y),layers:Uint8Array[]=[],keys:string[]=[];
    for(let i=layerCount-1;i>=0;i--){const data=await load(i,y,rows);if(data.length!==width*rows*4)throw Error('Layer strip dimensions changed.');let visible=false,opaque=true;for(let a=3;a<data.length;a+=4){visible ||= data[a]!==0;opaque &&= data[a]===255;}
      if(visible){layers.unshift(data);keys.unshift(rasterHash(data));}if(opaque){stats.hiddenLayersSkipped+=i;break;}}
    stats.strips++;if(layers.length===1)stats.singleLayer++;else if(layers.length>1)stats.overlapping++;else stats.empty++;
    const key=rasterHash(Buffer.from(JSON.stringify([width,rows,...keys])));let part=cache.get(key);
    if(part){stats.cacheHits++;}else{const pixels=layers.length===0?new Uint8Array(width*rows*4):layers.length===1?layers[0]!:await options.composite(layers,width,rows);part=preparePNGStrip({width,height:rows,data:pixels});if(cache.size>=8192)cache.clear();cache.set(key,part);}
    chunks.set(part.digest,part);const {bytes,...ref}=part;strips.push(ref);
  }
  // Pixel digest is filled by an independent full-render comparison, not inferred from compressed hashes.
  const recipe:PNGStripRecipe={schema:'keel-png-strips@1',width,height,strips,pixelDigest:'',publicationReady:false};return {recipe,chunks,stats};
}
export function compilePNGStrips(image:RasterPixels,stripRows=16){
  dimensions(image);if(!Number.isSafeInteger(stripRows)||stripRows<1||stripRows>256)throw Error('Choose 1–256 rows per strip.');
  const chunks=new Map<string,PNGStrip>(),strips:PNGStripRecipe['strips']=[];
  for(let y=0;y<image.height;y+=stripRows){const rows=Math.min(stripRows,image.height-y),part=preparePNGStrip({width:image.width,height:rows,data:image.data.subarray(y*image.width*4,(y+rows)*image.width*4)});chunks.set(part.digest,part);const {bytes,...ref}=part;strips.push(ref);}
  const recipe:PNGStripRecipe={schema:'keel-png-strips@1',width:image.width,height:image.height,strips,pixelDigest:rasterHash(image.data),publicationReady:false};
  return {recipe,chunks};
}
/** Constant-size checksum arithmetic per selected strip; no rasterization or recompression. */
export function pngStripEnvelope(recipe:PNGStripRecipe){
  if(recipe.schema!=='keel-png-strips@1'||!Number.isSafeInteger(recipe.width)||recipe.width<1||!Number.isSafeInteger(recipe.height)||recipe.height<1||recipe.width*recipe.height>33_554_432||recipe.strips.length<1||recipe.strips.length>recipe.height)throw Error('Invalid strip recipe.');
  let sum=1,rows=0;for(const part of recipe.strips){if(!/^[a-f0-9]{64}$/.test(part.digest)||!Number.isSafeInteger(part.rows)||part.rows<1||part.rows>256||part.filteredBytes!==part.rows*(recipe.width*4+1)||!Number.isSafeInteger(part.adler)||part.adler<0||part.adler>0xffffffff||(part.adler&65535)>=65521||(part.adler>>>16)>=65521)throw Error('Invalid PNG strip reference.');rows+=part.rows;sum=combine(sum,part.adler,part.filteredBytes);}
  if(rows!==recipe.height)throw Error('PNG strip heights do not match.');
  const ending=Buffer.alloc(6);ending[0]=3;ending[1]=0;ending.writeUInt32BE(sum,2);
  return {header:Buffer.concat([pngHeader(recipe.width,recipe.height),pngChunk('IDAT',Buffer.from([0x78,0x9c]))]),footer:Buffer.concat([pngChunk('IDAT',ending),pngChunk('IEND',Buffer.alloc(0))])};
}
export async function assemblePNGStrips(recipe:PNGStripRecipe,resolve:(digest:string)=>Promise<Uint8Array>){
  const {header,footer}=pngStripEnvelope(recipe),parts:Uint8Array[]=[header];let total=header.length+footer.length;
  for(const ref of recipe.strips){const bytes=await resolve(ref.digest);if(rasterHash(bytes)!==ref.digest||bytes.length<12||Buffer.from(bytes.subarray(4,8)).toString()!=='IDAT'||new DataView(bytes.buffer,bytes.byteOffset).getUint32(0)!==bytes.length-12)throw Error('PNG strip integrity check failed.');total+=bytes.length;if(total>256*1024*1024)throw Error('PNG reconstruction exceeds its byte budget.');parts.push(bytes);}parts.push(footer);return Buffer.concat(parts);
}
/** Independent verifier: inflate the assembled stream, undo row filters, compare every RGBA byte. */
export function verifyStripPNG(bytes:Uint8Array,expected:RasterPixels){
  dimensions(expected);const data:Uint8Array[]=[];for(let at=8;at<bytes.length;){const view=new DataView(bytes.buffer,bytes.byteOffset+at),size=view.getUint32(0),type=Buffer.from(bytes.subarray(at+4,at+8)).toString();if(at+12+size>bytes.length)throw Error('Truncated PNG');const body=bytes.subarray(at+8,at+8+size);if(!pngChunk(type,body).equals(Buffer.from(bytes.subarray(at,at+12+size))))throw Error('PNG CRC mismatch');if(type==='IDAT')data.push(body);at+=12+size;}
  const stride=expected.width*4,raw=inflateSync(Buffer.concat(data),{maxOutputLength:(stride+1)*expected.height}),pixels=Buffer.alloc(stride*expected.height);
  if(raw.length!==(stride+1)*expected.height)throw Error('PNG scanline length mismatch');
  for(let y=0;y<expected.height;y++){const filter=raw[y*(stride+1)];if(filter!==1&&filter!==2)throw Error('Unexpected strip filter');for(let x=0;x<stride;x++){const i=y*stride+x;pixels[i]=(raw[y*(stride+1)+1+x]!+(filter===1?(x>=4?pixels[i-4]!:0):y?pixels[i-stride]!:0))&255;}}
  if(!pixels.equals(Buffer.from(expected.data)))throw Error('Reconstructed PNG pixels changed.');return {pixelDigest:rasterHash(pixels),exactRGBA:true};
}
