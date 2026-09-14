import { parseStudioCapabilities } from '@keel/sdk/studio-capabilities';
import { rpcUrl } from './contract-rpc.mjs';

export function studioUrl(value) {
  const url = new URL(rpcUrl(value));
  if (url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) throw new Error('Use the Studio origin without a path, query or fragment.');
  return url.origin;
}
export async function inspectStudio(value, fetcher = fetch) {
  const base = studioUrl(value);
  const response = await fetcher(`${base}/.well-known/keel-capabilities`, { redirect: 'error', signal: AbortSignal.timeout(10000), headers: { accept: 'application/json' } });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Studio returned HTTP ${response.status}.`); }
  const reader = response.body?.getReader(); if (!reader) throw new Error('Studio returned no capability document.');
  const chunks = []; let length = 0;
  for (;;) { const { value, done } = await reader.read(); if (done) break; length += value.length; if (length > 512_000) { await reader.cancel(); throw new Error('Studio capability document is too large.'); } chunks.push(value); }
  return { studioUrl: base, observedAt: new Date().toISOString(), capabilities: parseStudioCapabilities(JSON.parse(Buffer.concat(chunks).toString('utf8'))) };
}
export async function searchStudio(value, query) { const { searchKeelIndexes } = await import('@keel/mcp'); return searchKeelIndexes({ studioUrl: studioUrl(value), query, limit: 24 }); }
