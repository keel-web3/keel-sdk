import legacyLayeredRuntimeV3 from './legacy-layered-runtime-v3.json' with { type: 'json' };
import legacyLayeredRuntimeV2 from './legacy-layered-runtime-v2.json' with { type: 'json' };
import legacyLayeredRuntime from './legacy-layered-runtime.json' with { type: 'json' };
import { LAYERED_RUNTIME } from '@keel/sdk/layered-runtime-info';
import { KEEL_ENGINE_CATALOG } from '@keel/sdk/engine';

// Browser-safe identities only. The installed library owns the bytes, not each project.
const names = {
  'three-r180-module': ['three', 'three.module.min.js', './three.module.min.js'],
  'three-r180-core': ['three.core.min.js', './three.core.min.js'],
};
export const runtimeLibrary = KEEL_ENGINE_CATALOG.runtimes
  .filter(runtime => ['three', 'p5'].includes(runtime.id))
  .map(runtime => ({ ...runtime, resources: runtime.resources
    .filter(resource => resource.referenceStatus === 'active' && resource.localPath && resource.integrity)
    .map(resource => ({ ...resource, aliases: names[resource.id] ?? ['p5', 'p5.min.js', './p5.min.js'] })) }));

runtimeLibrary.push({ id: 'layered', title: 'KEEL layered art', resources: [LAYERED_RUNTIME], publication: { status: 'not-claimed', receiptBacked: false, carriers: [] } });

export const installedRuntimeResources = [...runtimeLibrary.flatMap(runtime=>runtime.resources),legacyLayeredRuntime,legacyLayeredRuntimeV2,legacyLayeredRuntimeV3];

export function runtimeReferences(runtime) {
  if (runtime === 'html') return [];
  const entry = runtimeLibrary.find(item => item.id === runtime);
  if (!entry) throw Error('Choose an installed creative library: Three.js or p5.js.');
  return entry.resources.map(resource => ({ id: resource.id, version: resource.version, digest: resource.integrity.digest, byteLength: resource.integrity.byteLength }));
}

export function resolveRuntimeReferences(references = []) {
  const available = installedRuntimeResources;
  if (new Set(references.map(item => item.id)).size !== references.length) throw Error('Duplicate shared library reference.');
  const resources = references.map(ref => {
    const resource = available.find(item => item.id === ref.id);
    if (!resource || ref.version !== resource.version || ref.digest !== resource.integrity.digest || ref.byteLength !== resource.integrity.byteLength) throw Error(`Shared library ${ref.id} does not match its pinned identity. Choose the installed library again.`);
    return resource;
  });
  for (const resource of resources) for (const id of resource.dependencies) {
    if (!resources.some(item => item.id === id)) throw Error(`Shared library ${resource.id} needs ${id}. Choose the complete library.`);
  }
  // The canonical shell executes verified modules in graph order. Dependencies
  // must be declared first, even when a saved project's references arrive unordered.
  const ordered = []; const seen = new Set(); const visiting = new Set();
  function visit(resource) {
    if (seen.has(resource.id)) return;
    if (visiting.has(resource.id)) throw Error('Shared library dependencies contain a cycle.');
    visiting.add(resource.id);
    for (const id of resource.dependencies) visit(resources.find(item => item.id === id));
    visiting.delete(resource.id); seen.add(resource.id); ordered.push(resource);
  }
  resources.forEach(visit);
  return ordered;
}

export function projectWithRuntime(project, runtime) {
  return { ...project, intent: { ...project.intent, runtime: runtime === 'layered' ? 'html' : runtime }, runtimeModules: runtimeReferences(runtime) };
}
