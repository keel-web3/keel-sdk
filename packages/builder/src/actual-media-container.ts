import { classifyKeelAssetMotion } from "@keel/protocol";
import { assignTemporalWebPDelays } from "./temporal-webp.js";

/** Full bounded ISO box traversal, reusing the current SDK still-AVIF profile
 * (layered-svg.ts / asset-display.ts). A compatible brand can occur beyond a
 * short header sniff. AVIF sequence brands or any movie box require the actual
 * sequence decoder; a Sharp primary image is never its complete timeline.
 * Authority: https://aomediacodec.github.io/av1-avif/v1.2.0.html#brands */
export function actualAvifContainer(bytes: Uint8Array): { readonly sequence: boolean } | undefined {
  const text = (at: number) => String.fromCharCode(...bytes.subarray(at,at+4));
  if (bytes.length < 8 || text(4) !== "ftyp") return undefined;
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let at=0, count=0, avif=false, sequence=false, metadata=false, pixels=false;
  while (at<bytes.length) {
    if (++count>65_536 || at+8>bytes.length) throw new TypeError("The media container has incomplete or excessive ISO boxes; original retained.");
    let size=view.getUint32(at),header=8;const kind=text(at+4);
    if(size===1){if(at+16>bytes.length)throw new TypeError("The media container has a truncated extended box.");const n=view.getBigUint64(at+8);if(n>BigInt(Number.MAX_SAFE_INTEGER))throw new TypeError("The media box exceeds its exact size bound.");size=Number(n);header=16;}
    else if(size===0)size=bytes.length-at;
    if(size<header || size>bytes.length-at)throw new TypeError("The media container has invalid complete box bounds.");
    if(kind==="ftyp"){
      if(at!==0 || size<header+8 || (size-header)%4)throw new TypeError("The media file-type box is invalid or duplicated.");
      for(let p=at+header;p<at+size;p+=4){if(p===at+header+4)continue;const brand=text(p);if(brand==="avif")avif=true;if(brand==="avis"){avif=true;sequence=true;}}
    }
    if(kind==="moov")sequence=true;
    if(kind==="meta"&&size>header)metadata=true;
    if(kind==="mdat"&&size>header)pixels=true;
    at+=size;
  }
  if(!avif)return undefined;
  if(!pixels || !sequence&&!metadata)throw new TypeError("The complete AVIF image or sequence container is unavailable.");
  return {sequence};
}

/** A conservative GIF89a grammar walk, not a pixel decoder. Verify every image
 * block and its complete control/sub-block timeline before trusting pages.
 * Plain-text, interactive, unknown creator/application metadata and finite loop
 * translations retain native bytes until an exact preserving adapter exists.
 * Grammar: https://www.w3.org/Graphics/GIF/spec-gif89a.txt */
function actualGifTimeline(bytes:Uint8Array) {
  if(bytes.length<14 || !["GIF87a","GIF89a"].includes(String.fromCharCode(...bytes.subarray(0,6))))throw new TypeError("The complete GIF header is invalid.");
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),width=view.getUint16(6,true),height=view.getUint16(8,true);
  if(!width||!height)throw new TypeError("The complete GIF canvas is invalid.");
  let at=13+(bytes[10]!&128?3*2**((bytes[10]!&7)+1):0),blocks=0,pending:number|undefined,loop:number|undefined;
  const delays:number[]=[];
  const subblocks=()=>{let size=0;for(;;){if(++blocks>65_536||at>=bytes.length)throw new TypeError("The complete GIF sub-block sequence is unavailable.");const n=bytes[at++]!;if(!n)return size;if(n>bytes.length-at)throw new TypeError("The GIF has an incomplete sub-block.");at+=n;size+=n;}};
  while(at<bytes.length){
    if(++blocks>65_536)throw new TypeError("The GIF exceeds its bounded complete block count.");
    const kind=bytes[at++]!;
    if(kind===0x3b){if(at!==bytes.length || !delays.length || pending!==undefined)throw new TypeError("The GIF trailer or graphic-control coverage is invalid.");return{delays,loop};}
    if(kind===0x2c){
      if(at+9>bytes.length || delays.length>=1800)throw new TypeError("The GIF image descriptor is incomplete or excessive.");
      const left=view.getUint16(at,true),top=view.getUint16(at+2,true),w=view.getUint16(at+4,true),h=view.getUint16(at+6,true),flags=bytes[at+8]!;
      if(!w||!h||left+w>width||top+h>height||(flags&0x18))throw new TypeError("The GIF frame is outside its exact canvas.");
      at+=9+(flags&128?3*2**((flags&7)+1):0);
      if(at>=bytes.length || bytes[at]!<2 || bytes[at]!>8)throw new TypeError("The GIF LZW image profile is unavailable.");at++;
      if(!subblocks())throw new TypeError("The GIF omitted a complete image payload.");delays.push(pending??0);pending=undefined;continue;
    }
    if(kind!==0x21 || at>=bytes.length)throw new TypeError("The GIF has unsupported complete graphic blocks.");
    const label=bytes[at++]!;
    if(label===0xf9){
      if(pending!==undefined || at+6>bytes.length || bytes[at]!==4 || bytes[at+5]!==0 || (bytes[at+1]!&0xe2) || ((bytes[at+1]!>>>2)&7)>3)
        throw new TypeError("The GIF graphic control is duplicate, interactive or incomplete.");
      pending=view.getUint16(at+2,true)*10;at+=6;continue;
    }
    if(label===0xff){
      if(at+12>bytes.length || bytes[at++]!==11)throw new TypeError("The GIF application block is incomplete.");
      const app=String.fromCharCode(...bytes.subarray(at,at+11));at+=11;
      if(!["NETSCAPE2.0","ANIMEXTS1.0"].includes(app)||loop!==undefined||at+5>bytes.length||bytes[at]!==3||bytes[at+1]!==1||bytes[at+4]!==0)
        throw new TypeError("GIF application or creator metadata requires a preserving adapter; native source retained.");
      loop=view.getUint16(at+2,true);at+=5;continue;
    }
    throw new TypeError("GIF plain text, comments or unsupported metadata require a preserving adapter; native source retained.");
  }
  throw new TypeError("The complete GIF trailer is unavailable.");
}

export function assertActualImageSequence(bytes:Uint8Array, metadata:{readonly format?:string;readonly pages?:number;readonly loop?:number},
  timeline:{readonly frameTimesMs:readonly number[];readonly frameDurationsMs:readonly number[]}) {
  if(metadata.format==="png") {
    if(classifyKeelAssetMotion({mediaType:"image/png",bytes})!=="still")throw new TypeError("APNG or unknown complete PNG container motion requires a complete sequence/timeline/loop adapter; native source retained.");
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    // ICC/EXIF have exact correspondence checks after decode. Text and other
    // unmodelled ancillary/color semantics cannot silently disappear merely
    // because the RGBA raster is equal. pHYs/sRGB are native raster hints.
    for(let at=8;at<bytes.length;){const n=view.getUint32(at),kind=String.fromCharCode(...bytes.subarray(at+4,at+8));if(!["IHDR","PLTE","tRNS","IDAT","IEND","pHYs","sRGB","iCCP","eXIf"].includes(kind))throw new TypeError("PNG creator metadata or color semantics require an exact preserving adapter; native source retained.");at+=n+12;}
    if(timeline.frameDurationsMs.length!==1)throw new TypeError("The PNG decoder changed its complete still-image frame count.");
  }
  if(metadata.format==="heif") {const container=actualAvifContainer(bytes);if(!container || container.sequence)throw new TypeError("The complete AVIF sequence cannot be represented by a primary-image decode.");}
  if(metadata.format==="gif"){
    const parsed=actualGifTimeline(bytes);
    if(parsed.delays.length!==timeline.frameDurationsMs.length || parsed.delays.some((n,i)=>n!==timeline.frameDurationsMs[i]))throw new TypeError("The GIF decoder omitted or changed complete frame timing.");
    if(parsed.delays.length>1 && (parsed.loop!==0 || metadata.loop!==0 || parsed.delays.some(n=>n<=10)))throw new TypeError("Finite, interactive or clamped GIF loop/timing semantics retain native media.");
  }
  if(metadata.format==="webp"){
    const motion=classifyKeelAssetMotion({mediaType:"image/webp",bytes});
    if(motion==="unknown")throw new TypeError("The complete WebP container motion is unavailable.");
    if(motion==="animated") {
      const checked=assignTemporalWebPDelays(bytes,timeline);
      if(!Buffer.from(checked).equals(Buffer.from(bytes)))throw new TypeError("The WebP decoder changed raw complete ANMF frame durations.");
      const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let at=12,loop:number|undefined;
      while(at<bytes.length){const n=view.getUint32(at+4,true);if(String.fromCharCode(...bytes.subarray(at,at+4))==="ANIM")loop=view.getUint16(at+12,true);at+=8+n+(n&1);}
      if(loop!==metadata.loop)throw new TypeError("The complete WebP intrinsic loop count differs from its decoder.");
    }else if(timeline.frameDurationsMs.length!==1)throw new TypeError("The WebP decoder changed its complete still frame count.");
  }
}

export function assertActualCandidateContainer(bytes:Uint8Array, format:string, imageFormat:string|undefined) {
  const tag=(at:number)=>String.fromCharCode(...bytes.subarray(at,at+4));
  if(format==="webp"&&imageFormat==="webp" || format==="avif"&&actualAvifContainer(bytes)!==undefined)return;
  if(["mp4","mov"].includes(format)&&imageFormat===undefined&&tag(4)==="ftyp")return;
  if(format==="webm"&&imageFormat===undefined&&bytes[0]===0x1a&&bytes[1]===0x45&&bytes[2]===0xdf&&bytes[3]===0xa3)return;
  throw new TypeError("The actual candidate container differs from its bound media recipe; native source retained.");
}

/** Native inspection reports one complete declared cycle; it does not
 * translate loop counts, impose browser timer clamping or approve a candidate.
 * Keep the full bounded GIF grammar and exact decoder frame/timing coverage.
 * Unsupported interactive/unknown control remains actionable without changing
 * the retainable original. Other formats keep their complete-container guard. */
export function assertNativeImageSequence(bytes:Uint8Array,metadata:{readonly format?:string;readonly pages?:number;readonly loop?:number},
  timeline:{readonly frameTimesMs:readonly number[];readonly frameDurationsMs:readonly number[]}) {
  if(metadata.format!=="gif")return assertActualImageSequence(bytes,metadata,timeline);
  const parsed=actualGifTimeline(bytes);
  if(parsed.delays.length!==timeline.frameDurationsMs.length||parsed.delays.some((value,index)=>value!==timeline.frameDurationsMs[index]))
    throw new TypeError("The native GIF decoder omitted or changed complete declared frame timing.");
}
