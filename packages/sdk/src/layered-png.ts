/** Node authoring only. Preserve PNG pixels, precision and colour; never quantize. */
import { deflateSync, inflateSync } from 'node:zlib';
import { layerDigest } from './layered-art.js';

const signature = new Uint8Array([137,80,78,71,13,10,26,10]);
const table = Uint32Array.from({length:256}, (_, n) => {
  for (let i=0;i<8;i++) n=n&1?(n>>>1)^0xedb88320:n>>>1;
  return n>>>0;
});
function crc(bytes:Uint8Array) { let n=0xffffffff;for(const byte of bytes)n=table[(n^byte)&255]!^(n>>>8);return (n^0xffffffff)>>>0; }
function join(parts:Uint8Array[]) {const result=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const part of parts){result.set(part,at);at+=part.length;}return result;}
function chunk(type:string,data:Uint8Array) {const out=new Uint8Array(data.length+12),view=new DataView(out.buffer);view.setUint32(0,data.length);out.set(new TextEncoder().encode(type),4);out.set(data,8);view.setUint32(out.length-4,crc(out.subarray(4,-4)));return out;}

export async function optimizeLayerPNG(input:Uint8Array) {
  if(input.length>128*1024*1024)throw Error('PNG optimization exceeds its memory budget. The original is preserved.');
  if(input.length<45||!signature.every((b,i)=>input[i]===b))throw Error('Choose a valid PNG image.');
  const view=new DataView(input.buffer,input.byteOffset,input.byteLength);
  const chunks:{type:string;raw:Uint8Array;data:Uint8Array}[]=[];
  let ended=false,idatEnded=false,hasIDAT=false,animated=false;
  for(let at=8;at<input.length;){
    if(at+12>input.length||ended)throw Error('Truncated PNG or bytes after IEND.');
    const size=view.getUint32(at),end=at+12+size;
    if(end>input.length)throw Error('Truncated PNG chunk.');
    const type=new TextDecoder().decode(input.subarray(at+4,at+8));
    if(!/^[A-Za-z]{4}$/.test(type)||crc(input.subarray(at+4,end-4))!==view.getUint32(end-4))throw Error('PNG chunk integrity check failed.');
    if(!chunks.length&&(type!=='IHDR'||size!==13)||chunks.length&&type==='IHDR')throw Error('Invalid PNG header order.');
    if(type==='IDAT'){if(idatEnded)throw Error('PNG image chunks must be consecutive.');hasIDAT=true;}
    else if(hasIDAT)idatEnded=true;
    if(type==='acTL'||type==='fcTL'||type==='fdAT')animated=true;
    if(type==='IEND'){if(size||!hasIDAT)throw Error('Invalid PNG end.');ended=true;}
    chunks.push({type,raw:input.slice(at,end),data:input.slice(at+8,end-4)});at=end;
  }
  if(!ended)throw Error('PNG end is missing.');
  const header=chunks[0]!.data,h=new DataView(header.buffer,header.byteOffset,header.byteLength);
  const width=h.getUint32(0),height=h.getUint32(4),depth=header[8]!,colour=header[9]!;
  const channels:Record<number,number>={0:1,2:3,3:1,4:2,6:4};
  const depths:Record<number,number[]>={0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]};
  if(!width||!height||width*height>33_554_432||!depths[colour]?.includes(depth)||header[10]!==0||header[11]!==0||header[12]!>1)throw Error('Unsupported PNG dimensions or header. The original is preserved.');
  // Animation chunks carry independent compressed frames. Keep the complete original.
  if(animated)return {bytes:Uint8Array.from(input),type:'image/png' as const,width,height,originalBytes:input.length,storedBytes:input.length,sourceDigest:await layerDigest(input),digest:await layerDigest(input),proof:'original-animation-preserved' as const,removedTextBytes:0,lossless:true as const};
  const row=(w:number,rows:number)=>w>0&&rows>0?(Math.ceil(w*channels[colour]!*depth/8)+1)*rows:0;
  const passes=header[12]===0?[[0,0,1,1]]:[[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]];
  const passSizes=passes.map(([x,y,dx,dy])=>[Math.max(0,Math.ceil((width-x!)/dx!)),Math.max(0,Math.ceil((height-y!)/dy!))]);
  const expected=passSizes.reduce((n,[w,h])=>n+row(w!,h!),0);
  const compressed=join(chunks.filter(c=>c.type==='IDAT').map(c=>c.data));
  const filtered=inflateSync(compressed,{maxOutputLength:expected});
  if(filtered.length!==expected)throw Error('PNG scanline length does not match its dimensions.');
  let offset=0;for(const [w,h] of passSizes){if(!w||!h)continue;const stride=Math.ceil(w*channels[colour]!*depth/8)+1;for(let y=0;y<h;y++){if(filtered[offset]!>4)throw Error('Invalid PNG scanline filter.');offset+=stride;}}
  const recoded=deflateSync(filtered,{level:9});
  const encoded=recoded.length<compressed.length?recoded:compressed;
  let emitted=false,removedTextBytes=0;const parts:Uint8Array[]=[signature];
  for(const c of chunks){
    if(['tEXt','iTXt','zTXt'].includes(c.type)){removedTextBytes+=c.raw.length;continue;}
    if(c.type==='IDAT'){if(!emitted){parts.push(chunk('IDAT',encoded));emitted=true;}continue;}
    parts.push(c.raw);
  }
  const candidate=join(parts),bytes=candidate.length<input.length?candidate:Uint8Array.from(input);
  // The filtered stream is unchanged, including 16-bit precision and hidden RGB.
  const restored=inflateSync(encoded,{maxOutputLength:expected});
  if(filtered.length!==restored.length||filtered.some((b,i)=>restored[i]!==b))throw Error('PNG lossless verification failed.');
  return {bytes,type:'image/png' as const,width,height,originalBytes:input.length,storedBytes:bytes.length,sourceDigest:await layerDigest(input),digest:await layerDigest(bytes),proof:'exact-png-image-stream' as const,imageStreamDigest:await layerDigest(filtered),removedTextBytes:bytes===candidate?removedTextBytes:0,lossless:true as const};
}
