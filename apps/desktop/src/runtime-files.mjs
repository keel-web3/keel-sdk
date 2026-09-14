import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { resolveRuntimeReferences } from './runtime-library.mjs';

export function verifyRuntimeBytes(resource, bytes) {
  if (bytes.length !== resource.integrity.byteLength || `0x${createHash('sha256').update(bytes).digest('hex')}` !== resource.integrity.digest) throw Error(`The installed ${resource.id} library failed its byte check. Repair the app library before previewing.`);
  return bytes;
}

export async function loadRuntimeModules(references, directory) {
  const resources = resolveRuntimeReferences(references);
  if (resources.length && !directory) throw Error('The installed creative library is unavailable. Rebuild or repair the app.');
  return Promise.all(resources.map(async resource => ({ ...resource, bytes: verifyRuntimeBytes(resource, await readFile(path.join(directory, `${resource.id}.js`))) })));
}

/** Bare imports get an import map only in direct display. The canonical shell owns its own map. */
export function directRuntimeImports(html, references, origin) {
  const resources = resolveRuntimeReferences(references);
  if (!resources.length) return html;
  const imports = Object.fromEntries(resources.flatMap(resource => resource.aliases.map(alias => [alias, `${origin}/${resource.aliases.find(name => name.endsWith('.js') && !name.startsWith('.'))}`])));
  const map = `<script type="importmap">${JSON.stringify({ imports }).replaceAll('<', '\\u003c')}</script>`;
  // Insert before any creator script while preserving doctype and the original head.
  const head = /<head(?:\s[^>]*)?>/i.exec(html);
  const position = head ? head.index + head[0].length : /<!doctype[^>]*>/i.exec(html)?.[0].length ?? 0;
  return html.slice(0, position) + map + html.slice(position);
}
