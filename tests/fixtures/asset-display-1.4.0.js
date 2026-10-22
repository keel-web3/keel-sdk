"use strict";(()=>{
const fail=m=>{throw new Error("KEEL asset display: "+m)},entry=globalThis.__KEEL_ENTRY__,content=globalThis.__KEEL_CONTENT__,root=document.getElementById("keel-asset-display")||document.body;
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
fail("unsupported media type "+entry.mediaType);
})();