// Reuse the exact stored slot after checking its decoded program. Node and
// Electron can ship different zlib versions: equivalent gzip is not identical bytes.
import { gunzipSync, inflateSync } from 'node:zlib';
import { canonicalJson, createIntegrity } from '@keel/protocol';
import { decodeKeelInlineGraphFragment } from '@keel/sdk/inline-viewer-graph';
import { createKeelManagedObjectPlan } from '@keel/sdk/native-publication';
import { holdReader } from './engine-release.mjs';
import { RAW_PERCENT } from './publication.mjs';

export async function slotProgram(bytes) {
  const slot = JSON.parse(new TextDecoder().decode(bytes).trim().slice(1));
  const { embedded, ...metadata } = slot;
  if (!embedded || !['none', 'gzip', 'deflate'].includes(embedded.compression)) throw Error('Unsupported shared module slot.');
  const stored = Buffer.from(embedded.storedBase64, 'base64');
  if (stored.toString('base64') !== embedded.storedBase64) throw Error('Invalid shared module Base64.');
  const decoded = embedded.compression === 'gzip' ? gunzipSync(stored) : embedded.compression === 'deflate' ? inflateSync(stored) : stored;
  const integrity = await createIntegrity(decoded);
  if (canonicalJson(integrity) !== canonicalJson(slot.integrity)) throw Error('Shared module decoded integrity mismatch.');
  if (embedded.storedIntegrity && canonicalJson(await createIntegrity(stored)) !== canonicalJson(embedded.storedIntegrity)) throw Error('Shared module stored integrity mismatch.');
  return { metadata: canonicalJson(metadata), decoded };
}

export async function reusePublishedSlots({ doc, engineModuleIds, release, publicClient, chainId, hold }) {
  if (!release || release.chainId !== chainId || release.hold.toLowerCase() !== hold.toLowerCase()) return doc;
  const read = holdReader(async () => publicClient);
  const parts = [];
  for (const part of doc.document.parts) {
    const published = part.role === 'module' && engineModuleIds.has(part.moduleId)
      ? release.objects.find(p => p.moduleId === part.moduleId && p.version === part.moduleVersion) : undefined;
    if (!published) { parts.push(part); continue; }
    const stored = await read({ chainId, hold, objectId: published.objectId });
    const plan = await createKeelManagedObjectPlan(stored, { hold, mediaType: RAW_PERCENT, compression: 'none' });
    if (plan.objectId !== published.objectId || plan.digest !== published.digest || stored.length !== published.byteLength) throw Error(`Published slot identity mismatch: ${part.moduleId}`);
    const bytes = decodeKeelInlineGraphFragment(stored, RAW_PERCENT);
    const [local, remote] = await Promise.all([slotProgram(part.bytes), slotProgram(bytes)]);
    // A new program/version is not compression drift. Keep the new slot so the
    // usual missing-shared-module gate requires an explicit engine publication.
    if (local.metadata !== remote.metadata || !local.decoded.equals(remote.decoded)) { parts.push(part); continue; }
    parts.push({ ...part, bytes, byteLength: bytes.length, integrity: await createIntegrity(bytes) });
  }
  const rootBytes = new Uint8Array(Buffer.concat(parts.map(p => p.bytes)));
  return { ...doc, html: rootBytes, document: { ...doc.document, parts, rootBytes, byteLength: rootBytes.length, rootIntegrity: await createIntegrity(rootBytes) } };
}
