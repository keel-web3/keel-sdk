import { parseLayeredArt } from '@keel/sdk/layered-art';
import { runtimeReferences } from './runtime-library.mjs';
const safeJSON = value => JSON.stringify(value).replaceAll('<', '\\u003c');
export function layeredHTML(manifest, sealed, preview = false, mediaTypes = {}) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;background:transparent}body{display:grid;place-items:center}canvas{display:none}img{max-width:100%;max-height:100%;object-fit:contain}p{font:16px system-ui;padding:24px}</style></head><body><canvas></canvas><img hidden alt="Artwork"><p hidden></p><script src="layered-runtime.js"></script><script>
(async()=>{
const {renderLayeredSeed,openLayeredBundle,encodeLayeredCanvas,layeredManifestDigest}=KEEL_LAYERS;
const canvas=document.querySelector('canvas'),message=document.querySelector('p'),picture=document.querySelector('img');
const present=()=>{picture.src=canvas.toDataURL('image/png');picture.hidden=false;message.hidden=true;return new Promise(resolve=>canvas.toBlob(resolve,'image/png'));};
const resource=async id=>{if(globalThis.__KEEL_CONTENT__)return globalThis.__KEEL_CONTENT__.bytes('asset-'+id);const response=await fetch('./objects/'+id);if(!response.ok)throw Error('Layer resource unavailable');return new Uint8Array(await response.arrayBuffer());};
try {
${sealed ? `const descriptor=${safeJSON(sealed)};message.hidden=false;message.textContent='This artwork is sealed. A verified reveal key and seed are required.';
// The host must verify the reveal contract, committed manifest and seed before calling this entry point.
window.keelReveal=async ({key,seed,tokenId,manifestDigest})=>{if(!/^[a-f0-9]{64}$/.test(key)||typeof seed!=='string')throw Error('Invalid reveal inputs');const bundle=await openLayeredBundle(descriptor,await resource(descriptor.ciphertextDigest),Uint8Array.from(key.match(/../g).map(x=>parseInt(x,16))));if('0x'+await layeredManifestDigest(bundle.manifest)!==manifestDigest)throw Error('Revealed manifest does not match token context');const selection=await renderLayeredSeed(canvas,bundle.manifest,seed,tokenId,async id=>{const asset=bundle.assets.find(a=>a.id===id);if(!asset)throw Error('Layer missing');return asset;});return {selection,image:await present()};};` : `const manifest=${safeJSON(manifest)};
window.keelRender=async ({seed,tokenId,manifestDigest})=>{if(typeof seed!=='string'||typeof tokenId!=='string')throw Error('Verified token context required');if('0x'+await layeredManifestDigest(manifest)!==manifestDigest)throw Error('Manifest does not match token context');const selection=await renderLayeredSeed(canvas,manifest,seed,tokenId,async id=>({bytes:await resource(id),type:(${safeJSON(mediaTypes)})[id]||'image/png'}));
return {selection,image:await present()};};
${preview ? "await window.keelRender({seed:manifest.seed,tokenId:'1',manifestDigest:'0x'+await layeredManifestDigest(manifest)});" : "message.hidden=false;message.textContent='Waiting for verified token and reveal context.';"}`}
}catch(error){canvas.hidden=true;picture.hidden=true;message.hidden=false;message.textContent=error.message;throw error;}
})();
</script></body></html>`;
}
// Persist editable layer data, never a plaintext generated publication document.
export function withLayeredPreview(project) {
  if (!project.layered) return project;
  const art = parseLayeredArt(project.layered);
  const existing = project.runtimeModules.filter(m=>/^keel-layered-runtime-v\d+$/.test(m.id));
  const selected = !art.assembly && (!art.exceptions?.length || existing[0]?.id!=='keel-layered-runtime-v1') && existing.length === 1 ? existing : runtimeReferences('layered');
  return {...project,intent:{...project.intent,runtime:'html'},presentation:{...project.presentation,entryObjectId:undefined},runtimeModules:[...project.runtimeModules.filter(m=>!/^keel-layered-runtime-v\d+$/.test(m.id)),...selected],files:project.files};
}
