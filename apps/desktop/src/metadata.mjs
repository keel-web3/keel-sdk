const MAX_METADATA_BYTES = 2_000_000;
const IMAGE_TYPES = /^image\/(?:png|jpeg|gif|webp|avif|svg\+xml|bmp)(?:;|$)/i;
export function parseMetadata(value) {
  const data = typeof value === 'string' ? JSON.parse(value) : value;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Metadata must be a JSON object.');
  const encoded = JSON.stringify(data);
  if (new TextEncoder().encode(encoded).length > MAX_METADATA_BYTES) throw new Error('Metadata exceeds the 2 MB editor budget. Keep large artwork in Files and reference it here.');
  for (const field of ['name', 'description', 'image', 'image_data', 'animation_url', 'external_url', 'background_color']) if (data[field] !== undefined && typeof data[field] !== 'string') throw new Error(`${field} must be text.`);
  if (data.attributes !== undefined) {
    if (!Array.isArray(data.attributes) || data.attributes.length > 200) throw new Error('Use an attributes array with up to 200 traits.');
    for (const item of data.attributes) {
      if (!item || typeof item !== 'object' || Array.isArray(item) || !['string', 'number', 'boolean'].includes(typeof item.value)) throw new Error('Every attribute needs a text, number or boolean value.');
      if (typeof item.value === 'number' && !Number.isFinite(item.value)) throw new Error('Trait numbers must be finite.');
      for (const key of ['trait_type', 'display_type']) if (item[key] !== undefined && typeof item[key] !== 'string') throw new Error(`Attribute ${key} must be text.`);
    }
  }
  return JSON.parse(encoded);
}
export function metadataDocument(project) {
  return { name: project.title, ...(project.listing?.artist ? { artist: project.listing.artist } : {}), ...(project.metadata ?? {}) };
}
export function referenceKind(value) {
  if (!value) return 'missing';
  if (typeof value !== 'string') return 'invalid';
  if (/^data:[^,]*,/i.test(value)) return 'embedded';
  if (/^keel-asset:\/\/[a-f0-9]{64}\/raw$/.test(value) || /^objects\/[a-f0-9]{64}$/.test(value)) return 'local';
  if (/^(?:ipfs|ar):\/\/[^\s]+$/.test(value)) return 'distributed';
  if (/^(?:ethereum|tezos|keel):/.test(value)) return 'contract reference';
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? 'web' : 'invalid'; } catch { return 'relative'; }
}
export function objectReference(value, objects) {
  const id = /^keel-asset:\/\/([a-f0-9]{64})\/raw$/.exec(value ?? '')?.[1] ?? /^objects\/([a-f0-9]{64})$/.exec(value ?? '')?.[1];
  return objects.find((item) => id ? item.id === id : item.name === value?.replace(/^\.\//, ''));
}
// Metadata is always the first choice. A missing cover can fall back to an image file.
export function projectCover(project, objects = []) {
  const metadata = metadataDocument(project);
  if (metadata.image || metadata.image_data) {
    if (metadata.image_data && !metadata.image) return { src: `data:image/svg+xml,${encodeURIComponent(metadata.image_data)}`, source: 'Metadata image', kind: 'embedded' };
    const object = objectReference(metadata.image, objects.filter((item) => project.objectIds.includes(item.id) || item.id === project.presentation.entryObjectId));
    if (object && IMAGE_TYPES.test(object.type)) return { src: `keel-asset://${object.id}/raw`, source: 'Metadata image', kind: 'local' };
    if (/^data:image\/(?:png|jpeg|gif|webp|avif|svg\+xml|bmp)[;,]/i.test(metadata.image)) return { src: metadata.image, source: 'Metadata image', kind: 'embedded' };
    if (['web', 'distributed'].includes(referenceKind(metadata.image))) return { src: `keel-cover://${project.id}/image`, source: 'Metadata image', kind: 'remote' };
    return { source: 'Cover reference needs attention', kind: 'unavailable' };
  }
  const selected = objects.find((item) => item.id === project.presentation.entryObjectId && IMAGE_TYPES.test(item.type));
  const fallback = selected ?? objects.find((item) => project.objectIds.includes(item.id) && IMAGE_TYPES.test(item.type));
  return fallback ? { src: `keel-asset://${fallback.id}/raw`, source: 'Artwork file · set a metadata cover', kind: 'local' } : { source: 'No cover image yet', kind: 'missing' };
}
export function metadataChecks(project, objects = []) {
  const data = metadataDocument(project);
  const cover = projectCover(project, objects);
  const refs = ['image', 'animation_url', 'external_url'].filter((key) => data[key]).map((key) => ({ key, value: data[key], kind: referenceKind(data[key]) }));
  const check = (id, title, status, detail) => ({ id, title, status, detail });
  return [
    check('name', 'Artwork name', data.name?.trim() ? 'pass' : 'attention', data.name?.trim() ? 'A name is present.' : 'Add a name for collectors.'),
    check('description', 'Description', data.description?.trim() ? 'pass' : 'attention', data.description?.trim() ? 'A description is present.' : 'Tell people what this work is.'),
    check('cover', 'Metadata cover', (data.image || data.image_data) && cover.src ? (cover.kind === 'remote' ? 'unknown' : 'pass') : 'attention', (data.image || data.image_data) && cover.src ? (cover.kind === 'remote' ? 'Remote image is set. Loading it in the preview does not establish lasting availability.' : 'An embedded or local image reference is set. The preview shows whether it loads.') : 'Set a cover so wallets and project cards can show the work.'),
    check('references', 'Portable references', refs.some((ref) => ['local', 'relative', 'invalid'].includes(ref.kind)) ? 'attention' : 'pass', refs.some((ref) => ['local', 'relative', 'invalid'].includes(ref.kind)) ? 'Local file references must become published URIs before release.' : 'No local-only references in the standard URI fields. Nested custom fields still need review.'),
    check('attributes', 'Traits', 'info', `${data.attributes?.length ?? 0} optional traits. Custom metadata is retained.`),
    check('dependencies', 'Onchain preservation', 'unknown', 'A local metadata check cannot establish publication or audit nested artwork dependencies.'),
  ];
}
export function readinessRating(checks) {
  const required = checks.filter((item) => item.status !== 'info');
  return { passed: required.filter((item) => item.status === 'pass').length, total: required.length, unknown: required.filter((item) => item.status === 'unknown').length };
}
export function indexCandidates(result) {
  return [...(result?.library ?? []), ...(result?.modules ?? [])];
}
export function exactIndexMatches(result, project) {
  const ids = new Set(project.objectIds);
  return indexCandidates(result).filter((record) => ['digest', 'sha256', 'contentHash', 'objectId'].some((field) => typeof record[field] === 'string' && ids.has(record[field].replace(/^0x/, '').toLowerCase())));
}
