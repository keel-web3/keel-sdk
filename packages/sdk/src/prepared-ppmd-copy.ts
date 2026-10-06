import {gzipSync,gunzipSync} from "node:zlib";
import {createHash} from "node:crypto";
import {minify} from "terser";
import {buildCompactInlineKeelShell,buildKeelDecoderModule,buildKeelDenseTransportDecoder,type KeelStandaloneViewerItem} from "./verification-shell.js";
import {packKeelInlineDescriptors,unpackKeelInlineDescriptors} from "./inline-descriptor-columns.js";
import {encodeKeelDenseTransport,serializeKeelDenseTransportJSON} from "./dense-transport.js";
import {decodePpmd} from "./decoders/index.js";

const integrity=(bytes:Uint8Array)=>{const hash=createHash("sha256");hash.update(bytes);return {algorithm:"sha256" as const,digest:`0x${hash.digest("hex")}` as const,byteLength:bytes.length};};
const utf8=(s:string)=>new TextEncoder().encode(s);

/** Registered, explicit shared-decoder boot: resources retain their individual
 * identities; only immutable physical carriage and shell code are compressed.
 * Compressors run at preparation time and must replay the exact source bytes. */
export async function buildKeelPreparedPpmdCopyShell(input: {
  readonly embeddedContainerDelivery:{readonly chainId:number;readonly store:string};
  readonly binaryPayloadCarriage?: "base90" | "uri81";
  readonly items:readonly KeelStandaloneViewerItem[];
  readonly fitViewport?:{readonly width:number;readonly height:number};
  readonly optionalMarketplaceInfo?:import("./marketplace-reader.js").KeelShellMarketplaceConfig;
  readonly ppmdCompressor:(bytes:Uint8Array)=>Uint8Array|Promise<Uint8Array>;
  readonly gzipCompressor?:(bytes:Uint8Array)=>Uint8Array|Promise<Uint8Array>;
}) {
  if(!Array.isArray(input.items)||!input.items.length||input.items.length>128||typeof input.ppmdCompressor!=="function")throw new TypeError("PPMd boot requires bounded descriptors and a build-time compressor");
  const carriage=input.binaryPayloadCarriage??"base90";
  if(!["base90","uri81"].includes(carriage))throw new TypeError("Shared PPMd COPY requires Base90 or URI81 carriage");
  const transportProfile=carriage==="base90"?"base90-v1":"uri81-block-v1";
  const canonical=await buildCompactInlineKeelShell({codecProfile:"ppmd-js",binaryPayloadCarriage:carriage,decoderDelivery:"preloaded",contextCarriage:"columns-v1",embeddedContainerDelivery:input.embeddedContainerDelivery,...(input.fitViewport?{fitViewport:input.fitViewport}:{}),...(input.optionalMarketplaceInfo?{optionalMarketplaceInfo:input.optionalMarketplaceInfo}:{})});
  const raw=Buffer.from(canonical.suffix).toString(),close=raw.lastIndexOf("</script>");
  if(!raw.startsWith("];")||close<2)throw new TypeError("Missing canonical boot boundaries");
  const compact=async(s:string,module=false)=>{
    const out=await minify(s,{module,compress:{passes:3},mangle:true,format:{comments:false}});
    if(!out.code)throw new Error("Canonical boot minification failed");return out.code;
  };
  const columns=serializeKeelDenseTransportJSON(packKeelInlineDescriptors(input.items));
  const {chainId,store}=input.embeddedContainerDelivery;
  const expand='globalThis.__KEEL_ITEMS__=('+unpackKeelInlineDescriptors.toString()+')(globalThis.__KEEL_ITEMS__,'+chainId+','+JSON.stringify(store)+');';
  const decoded=utf8('];globalThis.__KEEL_ITEMS__=[null,'+columns+'];'+expand+await compact(raw.slice(2,close))+raw.slice(close));
  if(decoded.length>2_000_000)throw new RangeError("Canonical boot output exceeds its bound");
  const suffixPacked=await input.ppmdCompressor(decoded.slice());
  if(!(suffixPacked instanceof Uint8Array)||suffixPacked.length>2_000_000)throw new RangeError("Invalid PPMd boot bytes");
  const replay=await decodePpmd(suffixPacked,{decodedByteLength:decoded.length,maxDictionaryBytes:67108864});
  if(!Buffer.from(replay).equals(Buffer.from(decoded)))throw new TypeError("PPMd compressor changed canonical boot bytes");
  const decoder=await buildKeelDecoderModule({codecs:["ppmd"]}),transport=await buildKeelDenseTransportDecoder(transportProfile);
  const module=utf8(await compact(decoder.javascript+transport.javascript+';export const codecs=KEEL_RESOURCE_DECODERS,wire=KEEL_DENSE_TRANSPORT;',true));
  const modulePacked=input.gzipCompressor?await input.gzipCompressor(module.slice()):gzipSync(module,{level:9});
  if(!(modulePacked instanceof Uint8Array)||modulePacked.length>2_000_000||!Buffer.from(gunzipSync(modulePacked,{maxOutputLength:module.length})).equals(Buffer.from(module)))throw new TypeError("Gzip compressor changed boot decoder bytes");
  const boot={profile:"keel.prepared-ppmd-boot@3",transportProfile,prefix64:gzipSync(canonical.prefix,{level:9}).toString("base64"),decoder64:Buffer.from(modulePacked).toString("base64"),suffixDense:encodeKeelDenseTransport(suffixPacked,transportProfile),storedByteLength:suffixPacked.length,decodedByteLength:decoded.length,suffixSHA256:integrity(decoded).digest};
  const prefix=utf8(Buffer.from(canonical.prefix).toString().replace("globalThis.__KEEL_EMBEDDED_CONTAINERS__=[","const __KEEL_PREPARED_DENSE_PACKS__=["));
  // Every payload crosses the script-safe JSON serializer. Both surrounding
  // data-URI layers must use toKeelDenseTransportDataURL before publication.
  const suffix=utf8('];const __KEEL_PREPARED_BOOT__='+serializeKeelDenseTransportJSON(boot)+';queueMicrotask(async()=>{if(document.readyState==="loading")await new Promise(done=>document.addEventListener("DOMContentLoaded",done,{once:true}));const b=__KEEL_PREPARED_BOOT__,utf8=async s=>new TextDecoder().decode(await new Response(new Blob([Uint8Array.from(atob(s),c=>c.charCodeAt(0))]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());const u=URL.createObjectURL(new Blob([await utf8(b.decoder64)],{type:"text/javascript"}));let d;try{d=await import(u)}finally{URL.revokeObjectURL(u)}globalThis.__KEEL_BOOT_RESOURCE_DECODERS__=d.codecs;globalThis.__KEEL_BOOT_DENSE_TRANSPORT__=d.wire;const s=await d.codecs.decodePpmd(d.wire.decodeKeelDenseTransport(b.suffixDense,{profile:b.transportProfile,byteLength:b.storedByteLength}),{decodedByteLength:b.decodedByteLength,maxDictionaryBytes:67108864});const h="0x"+Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",s)),v=>v.toString(16).padStart(2,"0")).join("");if(h!==b.suffixSHA256)throw Error("Boot integrity mismatch");globalThis.__KEEL_EMBEDDED_CONTAINERS__=__KEEL_PREPARED_DENSE_PACKS__;const text=new TextDecoder().decode(s),end=text.lastIndexOf("<"+"/script>"),script=document.createElement("script");if(!text.startsWith("];" )||end<2)throw Error("Boot boundaries invalid");script.textContent=text.slice(2,end);document.head.append(script);script.remove()});</script></body></html>');
  return {...canonical,prefix,suffix,containerBridge:new Uint8Array(),prefixIntegrity:integrity(prefix),suffixIntegrity:integrity(suffix),canonicalPrefixIntegrity:canonical.prefixIntegrity,canonicalSuffixIntegrity:integrity(decoded),shellBootEncoding:"base64" as const,shellBootCompression:"ppmd" as const,itemDescriptorCarriage:"columns-v1" as const,contextCarriage:"columns-v1" as const,bootProfile:boot.profile,payloadPreparation:"build-time" as const,contractOperation:"verified-copy" as const,boot};
}
