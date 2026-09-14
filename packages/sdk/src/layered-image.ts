/** Node authoring codec. Never included in the collector's shared renderer. */
import { readFile } from 'node:fs/promises';
import {layerDigest} from './layered-art.js';
import encodeWebP, { init as initWebPEncode } from '@jsquash/webp/encode.js';
import decodeWebP, { init as initWebPDecode } from '@jsquash/webp/decode.js';
import decodePNG, { init as initPNG } from '@jsquash/png/decode.js';
const hash=(bytes:Uint8Array|Uint8ClampedArray)=>layerDigest(new Uint8Array(bytes));
let ready:Promise<void>|undefined;
async function codecs(){
  ready??=(async()=>{
    const wasm=async(name:string)=>new WebAssembly.Module(await readFile(new URL(import.meta.resolve(name))));
    await initPNG(await wasm('@jsquash/png/codec/pkg/squoosh_png_bg.wasm'));
    await initWebPEncode(await wasm('@jsquash/webp/codec/enc/webp_enc.wasm'));
    await initWebPDecode(await wasm('@jsquash/webp/codec/dec/webp_dec.wasm'));
  })();return ready;
}
async function inspectPNG(bytes:Uint8Array){
  const b=bytes,view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),ascii=(start:number,end:number)=>new TextDecoder().decode(b.subarray(start,end));if(b.length<33||![137,80,78,71,13,10,26,10].every((v,i)=>b[i]===v)||ascii(12,16)!=='IHDR')throw Error('Choose a valid PNG attribute image.');
  const width=view.getUint32(16),height=view.getUint32(20);
  if(!width||!height||width*height>33_554_432)throw Error('Layer conversion supports up to 32 megapixels. The original file is preserved.');
  if(b[24]===16)throw Error('This PNG has 16-bit channels. WebP cannot preserve that precision; keep the original PNG.');
  let compressedProfile:Uint8Array|undefined,customColour=false;
  for(let at=8;at+12<=b.length;){const size=view.getUint32(at),type=ascii(at+4,at+8);if(at+12+size>b.length)throw Error('Truncated PNG chunk.');if(type==='acTL')throw Error('Animated PNG layers need an animation renderer. The original is preserved.');if(type==='cICP')throw Error('Unsupported PNG colour profile.');if(type==='cHRM')customColour=true;if(type==='iCCP'){const data=b.subarray(at+8,at+8+size),end=data.indexOf(0);if(compressedProfile||end<1||end>79||data[end+1]!==0)throw Error('Invalid PNG colour profile.');compressedProfile=data.slice(end+2);}if(type==='gAMA'&&size===4&&view.getUint32(at+8)!==45455)customColour=true;at+=12+size;}
  let profile:Uint8Array|undefined;if(compressedProfile){try{const reader=new Blob([Uint8Array.from(compressedProfile)]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();const parts:Uint8Array[]=[];let size=0;for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1048576){await reader.cancel();throw Error('Profile too large');}parts.push(value);}profile=new Uint8Array(size);let at=0;for(const part of parts){profile.set(part,at);at+=part.length;}const text=new TextDecoder();if(size<128||new DataView(profile.buffer).getUint32(0)!==size||text.decode(profile.subarray(36,40))!=='acsp'||text.decode(profile.subarray(16,20))!=='RGB ')throw Error('Unsupported profile');}catch{throw Error('Invalid or unsupported PNG colour profile.');}}else if(customColour)throw Error('This PNG has a custom colour profile or gamma without ICC. Keep the original.');
  return {width,height,profile};
}
/** Exact RGBA comparison includes RGB underneath fully transparent pixels. */
export async function prepareLosslessLayerWebP(input:Uint8Array){
  if(input.byteLength>128*1024*1024)throw Error('Layer conversion input exceeds its memory budget. The original is preserved.');
  const {profile,...dimensions}=await inspectPNG(input);await codecs();
  const original=await decodePNG(Uint8Array.from(input).buffer);
  if(original.width!==dimensions.width||original.height!==dimensions.height)throw Error('PNG dimensions do not match its header.');
  let bytes=new Uint8Array(await encodeWebP(original,{lossless:1,exact:1,near_lossless:100,alpha_quality:100,quality:100,method:6}));
  if(profile)bytes=withICC(bytes,profile,original.width,original.height,original.data.some((v,i)=>i%4===3&&v!==255));
  const restored=await decodeWebP(bytes.buffer);
  if(restored.width!==original.width||restored.height!==original.height||original.data.length!==restored.data.length||original.data.some((value,index)=>value!==restored.data[index]))throw Error('Lossless conversion failed pixel verification. Keep the original.');
  return {bytes,type:'image/webp' as const,sourceDigest:await hash(input),digest:await hash(bytes),pixelDigest:await hash(original.data),...dimensions,originalBytes:input.byteLength,storedBytes:bytes.byteLength,proof:'exact-rgba-roundtrip' as const,colourProfile:profile?'preserved-icc':'default',codec:'libwebp-lossless-exact',lossless:true as const};
}

// Extended WebP layout: https://developers.google.com/speed/webp/docs/riff_container
function withICC(encoded:Uint8Array,profile:Uint8Array,width:number,height:number,alpha:boolean):Uint8Array<ArrayBuffer>{
 const chunk=(name:string,data:Uint8Array)=>{const out=new Uint8Array(8+data.length+(data.length%2));out.set(new TextEncoder().encode(name));new DataView(out.buffer).setUint32(4,data.length,true);out.set(data,8);return out;};
 const vp8x=new Uint8Array(10);vp8x[0]=0x20|(alpha?0x10:0);for(let i=0;i<3;i++){vp8x[4+i]=((width-1)>>(i*8))&255;vp8x[7+i]=((height-1)>>(i*8))&255;}
 const imageChunks:Uint8Array[]=[];for(let at=12;at+8<=encoded.length;){const size=new DataView(encoded.buffer,encoded.byteOffset,encoded.byteLength).getUint32(at+4,true);const name=new TextDecoder().decode(encoded.subarray(at,at+4));if(name!=='VP8X'&&name!=='ICCP')imageChunks.push(encoded.slice(at,at+8+size+(size%2)));at+=8+size+(size%2);}
 const parts=[chunk('VP8X',vp8x),chunk('ICCP',profile),...imageChunks],out=new Uint8Array(12+parts.reduce((n,p)=>n+p.length,0));out.set(new TextEncoder().encode('RIFF'));new DataView(out.buffer).setUint32(4,out.length-8,true);out.set(new TextEncoder().encode('WEBP'),8);let at=12;for(const part of parts){out.set(part,at);at+=part.length;}return out;
}

/** @deprecated Explicit WebP conversion only. Use optimizeLayerPNG from layered-png to keep PNG. */
export const prepareLosslessLayerPNG=prepareLosslessLayerWebP;
