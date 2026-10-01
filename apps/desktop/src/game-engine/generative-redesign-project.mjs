// A reviewed redesign adds a recipe, resolved build and trusted loader. This
// module never replaces a source file, executes a program, or contacts a model.
import { opsHash } from './builder-ops-hash.mjs';
import { writeBuildFile } from './builder-project.mjs';

export const GENERATIVE_ASSET_FORMAT = 'keel-generative-asset@1';
export const GENERATIVE_RUNTIME = '@keel-engine/builder/generative';

/** The runtime boundary has already validated the program and resolved ops. */
export function generativeAssetRecipe(candidate) {
  if (candidate?.validation?.ok !== true || candidate.validation.errors?.length ||
      candidate?.program?.format !== 'keel-generative-program@1' ||
      !Array.isArray(candidate.ops) || !candidate.ops.length ||
      typeof candidate.seed !== 'string' || !candidate.seed.length ||
      !/^keel-generative-runtime@\d+\.\d+\.\d+$/.test(candidate.runtimeVersion ?? '') ||
      !/^[a-f0-9]{64}$/.test(candidate.source?.objectId ?? '') ||
      typeof candidate.source?.name !== 'string' || !candidate.settings) {
    throw Error('Preview and validate a generative candidate before accepting it.');
  }
  const { provider, model, mode, theme, guidance, style } = candidate.settings;
  if (!['codex', 'claude'].includes(provider) || !['original', 'theme'].includes(mode) ||
      typeof theme !== 'string' || typeof guidance !== 'string' ||
      (mode === 'theme' && !theme.trim()) ||
      !['original', 'pixel', 'dither', 'voxel'].includes(style?.kind)) {
    throw Error('The candidate is missing its reviewed authoring settings.');
  }
  // Explicit fields prevent source descriptors, provider output and preview
  // transport data from leaking into the reusable asset or generated code.
  return JSON.parse(JSON.stringify({
    format: GENERATIVE_ASSET_FORMAT,
    program: candidate.program,
    seed: candidate.seed,
    source: { objectId: candidate.source.objectId, name: candidate.source.name },
    settings: { provider, ...(model ? { model } : {}), mode, theme, guidance,
      style: { kind: style.kind, pixelSize: style.pixelSize, toneLevels: style.toneLevels, screen: style.screen } },
    engineRuntime: GENERATIVE_RUNTIME,
    engineRuntimeVersion: candidate.runtimeVersion,
  }));
}

function projectFiles(stem, recipe, ops) {
  const recipeName = `${stem}.generative.json`;
  const loader = `// Trusted deterministic runtime; the recipe contains JSON data, never provider-authored JavaScript.\nimport { buildGenerativeProgram, GENERATIVE_RUNTIME_VERSION } from '${GENERATIVE_RUNTIME}';\nimport recipe from './${recipeName}' with { type: 'json' };\nexport { recipe };\n// The host applies this saved visual style when rendering the native geometry.\nexport const style = recipe.settings.style;\nexport function build(seed = recipe.seed) {\n  if (GENERATIVE_RUNTIME_VERSION !== recipe.engineRuntimeVersion) throw new Error('Generative runtime version mismatch: expected ' + recipe.engineRuntimeVersion + ', received ' + GENERATIVE_RUNTIME_VERSION);\n  const result = buildGenerativeProgram(recipe.program, seed);\n  if (!result.ok) throw new Error('Generative recipe validation failed: ' + JSON.stringify(result.errors ?? result.validation ?? []));\n  return { ...result, style };\n}\nexport default build;\n`;
  return [
    { name: `assets/${recipeName}`, type: 'application/json', content: `${JSON.stringify(recipe, null, 2)}\n` },
    { name: `assets/${stem}.generative.mjs`, type: 'text/javascript', content: loader },
    { name: `builds/${stem}.build.json`, type: 'application/json', content: writeBuildFile(stem, ops) },
  ];
}

/**
 * Pure, append-only attachment. Exact re-acceptance is idempotent. A conflicting
 * filename (including a short-hash collision) allocates another stem instead
 * of overwriting even one byte of an existing project file.
 */
export function withGenerativeAsset(project, candidate) {
  const recipe = generativeAssetRecipe(candidate);
  const id = (String(recipe.program.id || 'asset').toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'asset');
  const hash = /^[a-f0-9]{64}$/.test(candidate.artifactId ?? '') ? candidate.artifactId.slice(0, 24) : opsHash([recipe, candidate.ops]);
  const base = `redesign-${id}-${hash}`;
  let incoming;
  for (let index = 0; ; index++) {
    incoming = projectFiles(index ? `${base}-${index}` : base, recipe, candidate.ops);
    const conflicts = incoming.some(file => project.files.some(prior => prior.name === file.name &&
      (prior.type !== file.type || prior.content !== file.content)));
    if (!conflicts) break;
  }
  const added = incoming.filter(file => !project.files.some(prior => prior.name === file.name))
    .map(file => ({ id: globalThis.crypto.randomUUID(), ...file }));
  const objectIds = project.objectIds ?? [];
  if (!added.length && objectIds.includes(recipe.source.objectId)) return project;
  return { ...project, files: [...project.files, ...added],
    objectIds: objectIds.includes(recipe.source.objectId) ? [...objectIds] : [...objectIds, recipe.source.objectId] };
}
