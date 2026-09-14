import { layeredAssetIds, parseLayeredArt, canonicalLayerJSON, layerDigest, layeredManifestDigest } from './layered-art.js';
const AAD=new TextEncoder().encode('keel-layered-sealed@1');
export type SealedLayerDescriptor={schema:'keel-layered-sealed@1';algorithm:'AES-256-GCM';iv:string;ciphertextDigest:string;keyCommitment:string;byteLength:number};
const hex=(bytes:Uint8Array)=>[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
const unhex=(value:string,size:number)=>{if(!new RegExp(`^[a-f0-9]{${size*2}}$`).test(value))throw Error('Invalid encrypted layer descriptor.');return Uint8Array.from(value.match(/../g)!.map(v=>parseInt(v,16)));};
/** Returns a secret key to its local caller. Never include it in public manifests, logs or model context. */
export async function sealLayeredBundle(value:unknown,assets:{id:string;type:string;bytes:Uint8Array}[]) {
  const manifest=parseLayeredArt(value);if(!manifest.reveal.encrypted||manifest.reveal.mode==='visible')throw Error('Choose an encrypted reveal first.');
  const wanted=layeredAssetIds(manifest);
  if(assets.length!==wanted.length||new Set(assets.map(a=>a.id)).size!==assets.length||wanted.some(id=>!assets.some(a=>a.id===id)))throw Error('Supply exactly the layer files referenced by the manifest.');
  let offset=0;const entries=[];
  for(const asset of assets){if(await layerDigest(asset.bytes)!==asset.id)throw Error('Original layer bytes do not match their identity.');if(!asset.type.startsWith('image/'))throw Error('Layer source must be an image.');entries.push({id:asset.id,type:asset.type,offset,length:asset.bytes.length});offset+=asset.bytes.length;}
  if(offset>128*1024*1024)throw Error('This encrypted bundle exceeds the 128 MB local preparation budget.');
  const header=new TextEncoder().encode(canonicalLayerJSON({manifest,assets:entries}));if(header.length>2_500_000)throw Error('Encoded layer header exceeds the 2.5 MB encryption budget.');const bytes=new Uint8Array(4+header.length+offset);new DataView(bytes.buffer).setUint32(0,header.length);bytes.set(header,4);let position=4+header.length;for(const asset of assets){bytes.set(asset.bytes,position);position+=asset.bytes.length;}
  const key=crypto.getRandomValues(new Uint8Array(32)),iv=crypto.getRandomValues(new Uint8Array(12));
  const aes=await crypto.subtle.importKey('raw',key,'AES-GCM',false,['encrypt']);
  const ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:AAD,tagLength:128},aes,bytes));
  const descriptor:SealedLayerDescriptor={schema:'keel-layered-sealed@1',algorithm:'AES-256-GCM',iv:hex(iv),ciphertextDigest:await layerDigest(ciphertext),keyCommitment:await layerDigest(key),byteLength:ciphertext.length};
  return {descriptor,ciphertext,key,manifestDigest:await layeredManifestDigest(manifest)};
}
export async function openLayeredBundle(descriptor:SealedLayerDescriptor,ciphertext:Uint8Array,key:Uint8Array) {
  if(ciphertext.length>128*1024*1024+2_500_020)throw Error('Encrypted bundle exceeds the local decryption budget.');
  if(descriptor.schema!=='keel-layered-sealed@1'||descriptor.algorithm!=='AES-256-GCM'||key.length!==32||ciphertext.length!==descriptor.byteLength||await layerDigest(ciphertext)!==descriptor.ciphertextDigest||await layerDigest(key)!==descriptor.keyCommitment)throw Error('Encrypted layer integrity or key commitment mismatch.');
  const aes=await crypto.subtle.importKey('raw',Uint8Array.from(key),'AES-GCM',false,['decrypt']);
  const bytes=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:unhex(descriptor.iv,12),additionalData:AAD,tagLength:128},aes,Uint8Array.from(ciphertext)));
  if(bytes.length<4)throw Error('Invalid encrypted layer payload.');const length=new DataView(bytes.buffer).getUint32(0);if(length>2_500_000||4+length>bytes.length)throw Error('Invalid encrypted layer header.');
  const header=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(4,4+length)));const manifest=parseLayeredArt(header.manifest);const assets:{id:string;type:string;bytes:Uint8Array}[]=[];let offset=0;
  if(!Array.isArray(header.assets)||header.assets.length>16384)throw Error('Invalid encrypted asset table.');
  for(const entry of header.assets){if(entry.offset!==offset||!Number.isSafeInteger(entry.length)||entry.length<0||4+length+offset+entry.length>bytes.length||typeof entry.type!=='string'||!entry.type.startsWith('image/'))throw Error('Invalid encrypted asset range.');const data=bytes.slice(4+length+offset,4+length+offset+entry.length);if(await layerDigest(data)!==entry.id)throw Error('Decrypted layer digest mismatch.');assets.push({id:entry.id,type:entry.type,bytes:data});offset+=entry.length;if(offset>128*1024*1024)throw Error('Decrypted assets exceed the local budget.');}
  if(4+length+offset!==bytes.length)throw Error('Unexpected encrypted bundle bytes.');
  const wanted=new Set(layeredAssetIds(manifest));if(assets.length!==wanted.size||assets.some(a=>!wanted.delete(a.id))||wanted.size)throw Error('Decrypted manifest and asset table disagree.');
  return {manifest,assets};
}
export function layeredRevealPlan(value:unknown) {
  const manifest=parseLayeredArt(value);const mode=manifest.reveal.mode;
  return {schema:'keel-layered-reveal-plan@1',mode,encrypted:manifest.reveal.encrypted,revealAt:manifest.reveal.revealAt,
    required:mode==='visible'?['Verify original layers and renderer module bindings on the selected network.']:[
      'Freeze the manifest, renderer revision, weights, conditions, collection and complete token allocation before requesting randomness.',
      ...(manifest.reveal.encrypted?['Encrypt the complete manifest and layer bytes; keep private keys, thumbnails and trait names out of public staging.','Commit the SHA-256 hash of the 32 raw encryption-key bytes.','Wait for finalized seed and reveal time before preparing any key-release calldata.']:[]),
      ...(mode==='chainlink'?['Verify the selected-network coordinator, subscription funding, key hash, confirmations and consumer registration.','Bind one request ID; do not allow replacement requests or allocation changes.']:mode==='future-block'?['Commit one fixed future block; settle permissionlessly within 256 blocks. Expiry stalls permanently; no reroll.']:['Commit the creator root before allocation; creator controls its timing and can withhold it.']),
    ],limits:[...(manifest.reveal.encrypted?['The creator already knows the key and can leak or withhold it. Public VRF randomness is not a secret encryption key.']:[]),'Publicly readable image bytes cannot be made exclusive to one HTML renderer; reuse declarations govern permission, not byte confidentiality.','Weighted selection can produce duplicate trait combinations. Sample checks do not prove collection uniqueness.'],publicationReady:false,signing:'not-performed'};
}
