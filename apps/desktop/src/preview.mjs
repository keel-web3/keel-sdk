import {selectLayeredArt,layeredDrawList} from '@keel/sdk/layered-art';
import { layeredHTML } from './layered-project.mjs';
import { gzipSync } from 'node:zlib';
import { planKeelAssetPresentation } from '@keel/sdk/presentation';
import { KEEL_ASSET_DISPLAY_MEDIA_TYPES } from '@keel/sdk/asset-display';
import { loadRuntimeModules } from './runtime-files.mjs';

const escapeHTML = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
let graphTools;
const tools = () => graphTools ??= import('@keel/sdk/inline-viewer-graph');
const aliases = (name) => [name, `./${name}`];

/** Creator content for formats without a registered direct-media module. Never shell chrome. */
export function assetContent(object) {
  const uri = `objects/${object.id}`;
  const style = '<style>html,body{height:100%;margin:0;background:#090b13;color:#e9eaff;font:14px system-ui}body{display:grid;place-items:center}img,video{max-width:100%;max-height:100%;object-fit:contain}audio{width:min(85%,500px)}main{padding:32px;text-align:center}p{color:#9aa8d5}</style>';
  const media = object.type.startsWith('image/') ? `<img src="${uri}" alt="${escapeHTML(object.name)}">`
    : object.type.startsWith('video/') ? `<video src="${uri}" controls autoplay muted loop playsinline></video>`
    : object.type.startsWith('audio/') ? `<audio src="${uri}" controls></audio>`
    : `<main><h1>${escapeHTML(object.name)}</h1><p>Original file preserved. Choose a renderer or use Export original to open it in its own app.</p><p>${escapeHTML(object.type)} · ${object.byteLength.toLocaleString()} bytes</p></main>`;
  return `<!doctype html><html><head><meta charset="utf-8">${style}</head><body>${media}</body></html>`;
}

export async function canonicalPreview({ store, project, shell, runtimeDirectory }) {
  const sdk = await tools();
  const objects = store.read().state.objects;
  if (project.layered) project={...project,presentation:{...project.presentation,entryObjectId:undefined},files:[{id:'layered-local-preview',name:'keel-layered.html',type:'text/html',content:layeredHTML(project.layered,undefined,true,Object.fromEntries(objects.map(o=>[o.id,o.type])))}]};
  const selected = project.presentation.entryObjectId && objects.find((object) => object.id === project.presentation.entryObjectId);
  const allAttached=objects.filter(object=>project.objectIds.includes(object.id));
  const previewIds=project.layered?layeredDrawList(project.layered,await selectLayeredArt(project.layered,project.layered.seed,'1')).map(piece=>piece.objectId):project.objectIds;
  const attached = new Set(previewIds);
  const directMedia = selected && KEEL_ASSET_DISPLAY_MEDIA_TYPES.includes(selected.type) && selected.byteLength;
  const assetObjects = directMedia ? [selected] : objects.filter((object) => attached.has(object.id));
  const sharedModules = selected ? [] : await loadRuntimeModules(project.runtimeModules, runtimeDirectory);
  const previewBytes = sharedModules.reduce((total, module) => total + module.bytes.length, 0) + assetObjects.reduce((total, object) => total + object.byteLength, 0) + (selected ? 0 : project.files.reduce((total, file) => total + Buffer.byteLength(file.content), 0));
  if (previewBytes > 256 * 1024 * 1024) throw new Error('Your files are preserved. This preview would expand more than 256 MB in the embedded browser. Use direct display or a streaming renderer; publication uses the RPC reconstruction route.');
  let local;
  let originalByteLength = 0;
  let compressedByteLength = 0;
  const creatorModuleIds = new Set();
  if (directMedia) {
    const source = store.object(selected.id);
    originalByteLength = source.length;
    compressedByteLength = selected.compressedByteLength ?? gzipSync(source, { level: 9 }).length;
    local = await sdk.buildKeelInlineLocalDocument({ shell, modules: [await sdk.buildKeelInlineAssetDisplayModuleFragment()], entry: { id: `asset-${selected.id}`, mediaType: selected.type, source, aliases: [selected.name] } });
  } else {
    const entry = selected ? { id: 'entry.html', content: selected.type === 'text/html' ? new TextDecoder('utf-8', { fatal: true }).decode(store.object(selected.id)) : assetContent(selected), type: 'text/html' } : project.files.find((file) => file.name === (project.layered ? 'keel-layered.html' : 'index.html')) ?? project.files.find((file) => file.type === 'text/html');
    if (!entry) throw new Error('Choose an HTML entry or an object to display in Shell.');
    const modules = await Promise.all(sharedModules.map(module => sdk.buildKeelInlineModuleFragment({ moduleId: module.id, version: module.version, mediaType: module.mediaType, decodedBytes: module.bytes, aliases: module.aliases, execution: module.format === 'classic-script' ? 'classic' : 'module' })));
    const assets = [];
    for (const file of selected ? [] : project.files.filter((file) => file.id !== entry.id)) {
      const source = Buffer.from(file.content); if (!source.length) continue;
      originalByteLength += source.length; compressedByteLength += gzipSync(source, { level: 9 }).length;
      if (file.type === 'text/javascript') {
        creatorModuleIds.add(`local-${file.id}`);
        modules.push(await sdk.buildKeelInlineModuleFragment({ moduleId: `local-${file.id}`, version: 'local', mediaType: file.type, decodedBytes: source, aliases: aliases(file.name), execution: 'module' }));
      }
      else assets.push({ id: `file-${file.id}`, mediaType: file.type, source, aliases: aliases(file.name) });
    }
    for (const object of assetObjects) {
      if (!object.byteLength || selected?.type === 'text/html' && object.id === selected.id) continue;
      const source = store.object(object.id);
      originalByteLength += source.length; compressedByteLength += object.compressedByteLength ?? gzipSync(source, { level: 9 }).length;
      assets.push({ id: `asset-${object.id}`, mediaType: object.type, source, aliases: aliases(`objects/${object.id}`) });
    }
    const source = Buffer.from(entry.content);
    originalByteLength += source.length; compressedByteLength += gzipSync(source, { level: 9 }).length;
    local = await sdk.buildKeelInlineLocalDocument({ shell, modules, assets, entry: { id: 'entry.html', mediaType: 'text/html', source } });
  }
  // Artist-authored JavaScript is new work even though the viewer executes it as a module.
  const measured = { ...local, parts: local.parts.map(part => creatorModuleIds.has(part.moduleId) ? { ...part, kind: 'creator' } : part) };
  const saver = sdk.measureKeelInlineCompactGraph(measured);
  const sharedOriginalByteLength = sharedModules.reduce((sum, module) => sum + module.bytes.length, 0);
  const sharedCompressedByteLength = sharedModules.reduce((sum, module) => sum + gzipSync(module.bytes, { level: 9 }).length, 0);
  const uploads = {
    ...(project.layered?{scope:'preview-token-1',collectionAssetBytes:allAttached.reduce((n,o)=>n+o.byteLength,0),collectionAssetCount:allAttached.length}:{}),
    creatorByteLength: originalByteLength, creatorCompressedByteLength: compressedByteLength,
    creatorPublicationBytes: saver.creatorPublicationBytes,
    sharedOriginalByteLength, sharedCompressedByteLength,
    sharedPublicationBytes: saver.graphByteLength - saver.creatorPublicationBytes,
    modules: sharedModules.map(({ id, version, integrity }) => ({ id, version, ...integrity })),
    reuseStatus: 'selected-network-verification-required',
  };
  // A full Inline read still includes shared resources. Reuse reduces new storage, not read size.
  return { html: Buffer.from(local.rootBytes).toString('utf8'), byteLength: local.byteLength, saver, uploads, plan: planKeelAssetPresentation({ originalByteLength: originalByteLength + sharedOriginalByteLength, compressedByteLength: compressedByteLength + sharedCompressedByteLength, graphByteLength: saver.graphByteLength, mode: project.presentation.delivery }), evidence: 'local-byte-verification-only', published: false };
}
