/** Browser-safe declarations and bytes for KEEL's reusable normal-media module. */
export const KEEL_ASSET_DISPLAY_MODULE_ID = "keel.asset-display" as const;
export const KEEL_ASSET_DISPLAY_MODULE_VERSION = "1.5.0" as const;

export const KEEL_ASSET_DISPLAY_MEDIA_TYPES = Object.freeze([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/svg+xml",
  "audio/wav",
  "audio/mpeg",
  "audio/ogg",
  "audio/flac",
  "audio/aac",
  "audio/mp4",
  "video/mp4",
  "video/webm",
] as const);

export type KeelAssetDisplayMediaType = (typeof KEEL_ASSET_DISPLAY_MEDIA_TYPES)[number];
export type KeelAssetDisplayKind = "image" | "video" | "audio";

/** Map a supported direct creator asset to the canonical display behavior. */
export function keelAssetDisplayKind(mediaType: string): KeelAssetDisplayKind {
  if ((KEEL_ASSET_DISPLAY_MEDIA_TYPES as readonly string[]).includes(mediaType)) {
    if (mediaType.startsWith("image/")) return "image";
    if (mediaType.startsWith("video/")) return "video";
    if (mediaType.startsWith("audio/")) return "audio";
    throw new TypeError("Unsupported asset-display media kind.");
  }
  throw new TypeError(`The canonical KEEL asset-display module does not support ${mediaType}.`);
}

/** Pick a quiet surround from opaque edge pixels; never change artwork pixels. */
export function keelAssetBackground(metadataColor: unknown, edgeRGBA: ArrayLike<number>): string {
  if (typeof metadataColor === "string" && /^#?[0-9a-f]{6}$/i.test(metadataColor)) return "#" + metadataColor.replace(/^#/, "").toLowerCase();
  const bins = new Map<string, {count: number; rgb: number[]}>();
  const samples = Math.floor(edgeRGBA.length / 4);
  for (let i = 0; i + 3 < edgeRGBA.length; i += 4) {
    if (edgeRGBA[i + 3]! < 250) continue;
    const rgb = [edgeRGBA[i]!, edgeRGBA[i + 1]!, edgeRGBA[i + 2]!];
    const key = rgb.map(v => Math.floor(v / 8)).join(",");
    const bin = bins.get(key) ?? {count: 0, rgb: [0, 0, 0]};
    bin.count++; for (let c = 0; c < 3; c++) bin.rgb[c] = bin.rgb[c]! + rgb[c]!;
    bins.set(key, bin);
  }
  const best = [...bins.values()].sort((a, b) => b.count - a.count)[0];
  if (!best || best.count < Math.max(3, samples * .6)) return "#05060b";
  return "#" + best.rgb.map(v => Math.round(v / best.count).toString(16).padStart(2, "0")).join("");
}

/**
 * This browser-only, no-network module is published once per chain. The
 * protected shell injects a frozen descriptor for the verified direct media
 * entrypoint; this module is not creator-authored HTML and never has wallet
 * authority. Models use their separate exact complete loader closure.
 */
const KEEL_ASSET_DISPLAY_MODULE_SOURCE = `"use strict";(()=>{const render=entry=>{
const fail=m=>{throw new Error("KEEL asset display: "+m)},content=globalThis.__KEEL_CONTENT__,root=document.getElementById("keel-asset-display")||document.body;
if(!entry||typeof entry.id!=="string"||typeof entry.mediaType!=="string"||typeof entry.url!=="string"||!content||typeof content.bytes!=="function")fail("missing verified entry descriptor");
const pickBackground=function keelAssetBackground(metadataColor, edgeRGBA) {
    if (typeof metadataColor === "string" && /^#?[0-9a-f]{6}$/i.test(metadataColor))
        return "#" + metadataColor.replace(/^#/, "").toLowerCase();
    const bins = new Map();
    const samples = Math.floor(edgeRGBA.length / 4);
    for (let i = 0; i + 3 < edgeRGBA.length; i += 4) {
        if (edgeRGBA[i + 3] < 250)
            continue;
        const rgb = [edgeRGBA[i], edgeRGBA[i + 1], edgeRGBA[i + 2]];
        const key = rgb.map(v => Math.floor(v / 8)).join(",");
        const bin = bins.get(key) ?? { count: 0, rgb: [0, 0, 0] };
        bin.count++;
        for (let c = 0; c < 3; c++)
            bin.rgb[c] = bin.rgb[c] + rgb[c];
        bins.set(key, bin);
    }
    const best = [...bins.values()].sort((a, b) => b.count - a.count)[0];
    if (!best || best.count < Math.max(3, samples * .6))
        return "#05060b";
    return "#" + best.rgb.map(v => Math.round(v / best.count).toString(16).padStart(2, "0")).join("");
};let background=pickBackground(entry.background_color,[]);
const matchBackground=e=>{const c=document.createElement("canvas");c.width=c.height=16;const x=c.getContext("2d"),edges=[];if(x){try{x.drawImage(e,0,0,16,16);const p=x.getImageData(0,0,16,16).data;for(let y=0;y<16;y++)for(let z=0;z<16;z++)if(y===0||y===15||z===0||z===15){const i=(y*16+z)*4;edges.push(p[i],p[i+1],p[i+2],p[i+3]);}}catch{}}background=pickBackground(entry.background_color,edges);for(const n of [document.documentElement,document.body,root])n.style.background=background;return background;};
const style=e=>{Object.assign(e.style,{display:"block",width:"100%",height:"100%",maxWidth:"100%",maxHeight:"100%",objectFit:"contain",background});return e},mount=e=>{root.replaceChildren(e);return e};
// Canvas PNG export is only safe after complete container inspection proves a still.
// Unknown motion remains native; a missing WebCodecs API never freezes animation.
const stillRaster=(b,m)=>{if(!(b instanceof Uint8Array)||b.length<20||b.length>33554432)return false;const v=new DataView(b.buffer,b.byteOffset,b.byteLength),tag=o=>String.fromCharCode(...b.subarray(o,o+4));let at=0,n=0;
if(m==="image/webp"){if(tag(0)!=="RIFF"||tag(8)!=="WEBP"||v.getUint32(4,true)!==b.length-8)return false;at=12;let images=0;while(at<b.length){if(++n>65536||at+8>b.length)return false;const t=tag(at),size=v.getUint32(at+4,true),end=at+8+size+size%2;if(end>b.length||t==="VP8X"&&size!==10)return false;if(t==="ANIM"||t==="ANMF"||t==="VP8X"&&(b[at+8]&2)!==0)return false;if(t==="VP8 "||t==="VP8L"){if(!size||++images!==1)return false}at=end}return images===1}
if(m==="image/avif"){let brand=false,meta=false,data=false;while(at<b.length){if(++n>65536||at+8>b.length)return false;let size=v.getUint32(at),header=8;const t=tag(at+4);if(size===1){if(at+16>b.length)return false;size=v.getUint32(at+8)*4294967296+v.getUint32(at+12);header=16}if(size===0)size=b.length-at;if(!Number.isSafeInteger(size)||size<header||at+size>b.length)return false;const end=at+size;if(t==="moov")return false;if(t==="ftyp"){if(at!==0||size<header+8||(size-header)%4)return false;for(let i=at+header;i<end;i+=4){if(i===at+header+4)continue;const value=tag(i);if(value==="avis")return false;if(value==="avif")brand=true}}if(t==="meta")meta=true;if(t==="mdat")data=true;at=end}return brand&&meta&&data}return false};
if(entry.mediaType.startsWith("image/")){const e=document.createElement("img");e.alt=entry.name||"Verified KEEL image";if(entry.mediaType==="image/avif"||entry.mediaType==="image/webp"){const still=stillRaster(content.bytes(entry.id),entry.mediaType);e.onload=()=>{matchBackground(e);if(!still){e.style.background=background;return}const c=document.createElement("canvas"),x=c.getContext("2d");if(!x)fail("2D canvas is unavailable");c.width=e.naturalWidth;c.height=e.naturalHeight;c.title="Right-click to save this verified image as PNG";c.setAttribute("aria-label",e.alt);Object.assign(c.style,{display:"block",width:"auto",height:"auto",maxWidth:"100%",maxHeight:"100%",margin:"auto",background});x.drawImage(e,0,0);mount(c)};e.onerror=()=>fail("image decode failed");if(!still){Object.assign(e.style,{display:"block",width:"auto",height:"auto",maxWidth:"100%",maxHeight:"100%",margin:"auto",background});mount(e)}e.src=entry.url;return}style(e);e.onload=()=>{e.style.background=matchBackground(e)};e.src=entry.url;mount(e);return}
if(entry.mediaType.startsWith("video/")){const e=style(document.createElement("video"));e.src=entry.url;e.controls=true;e.autoplay=true;e.loop=true;e.muted=true;e.playsInline=true;mount(e);return}
if(entry.mediaType.startsWith("audio/")){const record=content.resources().find(r=>r.id===entry.id);if(!record||record.mediaType!==entry.mediaType||record.digest!==entry.digest||record.byteLength!==entry.byteLength||entry.url!==content.url(entry.id))fail("audio source differs from its verified resource");const section=document.createElement("section");Object.assign(section.style,{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:"16px",width:"100%",height:"100%",background});if(entry.preview){const p=entry.preview,r=content.resources().find(r=>r.id===p.id);if(!r||!r.mediaType.startsWith("image/")||r.digest!==p.digest||r.byteLength!==p.byteLength)fail("audio cover differs from its verified resource");const image=document.createElement("img");image.alt=entry.name||"Verified KEEL audio cover";Object.assign(image.style,{display:"block",maxWidth:"100%",maxHeight:"calc(100% - 70px)",objectFit:"contain"});image.onerror=()=>fail("audio cover decode failed");image.src=content.url(p.id);section.append(image)}const audio=document.createElement("audio");audio.controls=true;audio.preload="metadata";audio.autoplay=false;audio.setAttribute("aria-label",entry.name||"Verified KEEL audio");Object.assign(audio.style,{display:"block",width:"min(600px,100%)",height:"54px"});audio.onerror=()=>fail("audio decode failed for "+entry.mediaType);audio.onloadedmetadata=()=>{if(!Number.isFinite(audio.duration)||audio.duration<=0)fail("audio duration is not a complete decoded file")};audio.src=entry.url;section.append(audio);mount(section);return}
fail("unsupported media type "+entry.mediaType);
};Object.defineProperty(globalThis,"__KEEL_ASSET_DISPLAY__",{value:Object.freeze({mount:render}),writable:false,configurable:false});if(globalThis.__KEEL_ENTRY__)render(globalThis.__KEEL_ENTRY__);
})();`;

/** Exact decoded bytes Studio verifies before using or publishing this module. */
export function keelAssetDisplayModuleBytes(): Uint8Array {
  return new TextEncoder().encode(KEEL_ASSET_DISPLAY_MODULE_SOURCE);
}

/** Exact released revisions compatible with the direct-media entry contract.
 * Selection still requires same-chain registration and byte read-back.
 * Never replace an existing published renderer just because the SDK is newer.
 */
export const KEEL_ASSET_DISPLAY_SUPPORTED_REVISIONS = Object.freeze([
  Object.freeze({version: "1.5.0", digest: "0xa00a81a869a5bb589f2156a5ef19ea2fa1f01f7173cff7212e28ccbb9ed5baf0", byteLength: 6821}),
  Object.freeze({version: "1.4.0", digest: "0x16a440e2b29572c3d45e3d9c31f7c444a867be5c5ac251fecfedaddcb1261dfb", byteLength: 5056}),
  Object.freeze({version: "1.3.0", digest: "0x4f88f47a332061125a3a6a0133d2a70f5b6d641c4d0c84dd7c0302626f8034dc", byteLength: 9648}),
  Object.freeze({version: "1.2.0", digest: "0x9db2505b726d6c0b9821ce2c90df96c4e37b6c1607fe4dd565f883b3531bed8b", byteLength: 7810}),
  Object.freeze({version: "1.1.0", digest: "0x53957405312b1fe3b187a5c49b13d13a08fd6e960953c815c6e49b53637d97f4", byteLength: 6172}),
] as const);

export function keelAssetDisplayModuleRevision(version: string) {
  return KEEL_ASSET_DISPLAY_SUPPORTED_REVISIONS.find(revision => revision.version === version);
}
