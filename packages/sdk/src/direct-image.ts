/** Direct metadata.image delivery. Independent of the HTML/canonical-shell renderer. */
import { canonicalLayerJSON, layerDigest, parseLayeredArt } from './layered-art.js';
export type DirectImageSettings = { format:'png'|'svg'|'gif'|'webp'|'apng'; motion:'still'|'animation' };
export const DEFAULT_DIRECT_IMAGE:DirectImageSettings={format:'png',motion:'still'};
export function parseDirectImageSettings(value:unknown):DirectImageSettings {
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Choose direct image settings.');
  const v=value as Record<string,unknown>;
  if(Object.keys(v).some(k=>!['format','motion'].includes(k))||!['png','svg','gif','webp','apng'].includes(v.format as string)||!['still','animation'].includes(v.motion as string))throw Error('Invalid direct image format.');
  if(v.motion==='animation'&&!['gif','webp','apng'].includes(v.format as string)||v.motion==='still'&&v.format==='gif')throw Error('Choose PNG, SVG or WebP for a still image; APNG, GIF or WebP for animation.');
  return {format:v.format as DirectImageSettings['format'],motion:v.motion as DirectImageSettings['motion']};
}
export function directImageCompatibility(value:unknown){
  const settings=parseDirectImageSettings(value);
  return {settings,mediaType:`image/${settings.format==='svg'?'svg+xml':settings.format}`,notes:[
    ...(settings.format==='png'?['PNG keeps full colour and transparency. Transparent layers must be composited before its image stream is encoded.']:[]),
    ...(settings.format==='svg'?['SVG can describe the chosen layer stack without JavaScript. Save image returns SVG; use Export PNG for a PNG copy.']:[]),
    ...(settings.format==='apng'?['APNG builds the image by blending raster frames. Save image preserves those frames. Apps that ignore animation can show only the first layer; use Export PNG for the completed still.']:[]),
    ...(settings.format==='gif'?['GIF has palette limits and single-colour transparency. Some artwork needs colour reduction; compare the result before accepting it.']:[]),
    ...(settings.format==='webp'?['WebP is optional. Check the receiving marketplace and apps support it.']:[]),
    ...(settings.motion==='animation'?['Frame timing, blend and disposal settings are part of the image recipe. Storage chunk boundaries do not become animation frames.']:[]),
  ]};
}
export type RawImageChunk={digest:string;bytes:Uint8Array};
export type ChunkedImageObject={digest:string;byteLength:number;mediaType:string;chunks:{digest:string;byteLength:number}[]};
/** Upload bytes as bytes. JSON contains references only, never base64 image objects.
 * The byte limit is supplied by the selected storage adapter, not inferred from a chain name.
 */
export async function chunkDirectImageObject(bytes:Uint8Array,mediaType:string,maxChunkBytes:number) {
  if(!Number.isSafeInteger(maxChunkBytes)||maxChunkBytes<256||maxChunkBytes>1048576)throw Error('Choose a storage chunk budget between 256 bytes and 1 MB.');
  if(!bytes.length||bytes.length>512*1024*1024)throw Error('Empty object or object exceeds this local preparation budget.');
  if(!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mediaType))throw Error('Invalid object media type.');
  const chunks:RawImageChunk[]=[],refs:ChunkedImageObject['chunks']=[],seen=new Set<string>();
  for(let at=0;at<bytes.length;at+=maxChunkBytes){const part=bytes.slice(at,at+maxChunkBytes),digest=await layerDigest(part);refs.push({digest,byteLength:part.length});if(!seen.has(digest)){seen.add(digest);chunks.push({digest,bytes:part});}}
  const object:ChunkedImageObject={digest:await layerDigest(bytes),byteLength:bytes.length,mediaType,chunks:refs};
  return {object,chunks};
}
export async function reconstructDirectImageObject(object:ChunkedImageObject,resolve:(digest:string)=>Promise<Uint8Array>) {
  if(!Number.isSafeInteger(object.byteLength)||object.byteLength<1||object.byteLength>512*1024*1024||!Array.isArray(object.chunks)||!object.chunks.length||object.chunks.length>2_097_152)throw Error('Invalid direct image object.');
  let total=0;for(const chunk of object.chunks){if(!/^[a-f0-9]{64}$/.test(chunk.digest)||!Number.isSafeInteger(chunk.byteLength)||chunk.byteLength<1||chunk.byteLength>1048576)throw Error('Invalid image chunk reference.');total+=chunk.byteLength;}if(total!==object.byteLength)throw Error('Image chunk lengths do not match the object.');
  const bytes=new Uint8Array(object.byteLength);let at=0;
  for(const part of object.chunks){const chunk=await resolve(part.digest);if(chunk.length!==part.byteLength||await layerDigest(chunk)!==part.digest)throw Error('Image chunk integrity check failed.');bytes.set(chunk,at);at+=chunk.length;}
  if(await layerDigest(bytes)!==object.digest)throw Error('Reconstructed image digest does not match.');return bytes;
}
/** Frozen authoring recipe to be stored alongside raw chunks by a collection adapter.
 * A recipe commitment alone does not implement its selection/compositing logic onchain.
 */
export function directImageRecipe(artwork:unknown,settings:unknown) {
  const manifest=parseLayeredArt(artwork),output=parseDirectImageSettings(settings);
  return {schema:'keel-direct-image-recipe@1',output,manifest,
    selection:{algorithm:'keel-layered-art@1',modes:['picked','weighted-seed','curated-set'],contractInputs:['manifest digest','renderer code identity','frozen allocation or per-token seed'],seedAuthority:manifest.reveal.mode},
    composition:output.format==='svg'?'script-free-svg-stack':output.format==='apng'?'apng-over-stack':'composite-then-encode',
    storage:{encoding:'raw-bytes',references:'sha256',reuse:'identical-chunks'},
    publicationReady:false,required:['Executable selected-chain selection and image renderer adapter','Contract-stored recipe and verified chunk references','Receipt and read-back of the final metadata.image',...(output.motion==='animation'?['Animation frames, timing, blend and disposal recipe plus format encoder']:[])],
  };
}
export function encodeDirectImageRecipe(artwork:unknown,settings:unknown) {return new TextEncoder().encode(canonicalLayerJSON(directImageRecipe(artwork,settings)));}
