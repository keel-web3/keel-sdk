import { keccak256, type Hex } from 'viem';
import { compileKeelTokenMatrix, type KeelMatrixToken, type KeelMatrixOptions } from './token-matrix.js';

export const KEEL_METADATA_STORAGE_DEFAULT = 'compact-matrix' as const;
export type KeelMetadataStorage = typeof KEEL_METADATA_STORAGE_DEFAULT | 'json' | 'none';
export interface KeelCollectorMetadataToken {
  readonly tokenId: number;
  /** Marketplace fields taken from the actual generator/importer output. */
  readonly metadata: Readonly<Record<string, unknown>>;
  /** Full generated record, independently addressable from marketplace traits. */
  readonly details?: Readonly<Record<string, unknown>>;
}
export interface KeelCollectorMetadataOptions extends KeelMatrixOptions {
  readonly storage?: KeelMetadataStorage;
  readonly dictionaryBytes?: number;
}

/** One native dictionary slug can supply many fragments in a single Hold read.
 * Offsets are half-open byte ranges; byte offsets are never UTF-16 indices.
 * Oversize fragments retain the existing object/composite route.
 */
export function packKeelMatrixDictionary(matrix: ReturnType<typeof compileKeelTokenMatrix>, maxBytes = 23_000) {
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 23_000) throw new RangeError('Dictionary slug budget must be 1..23000 bytes.');
  const pages: { index: number; bytes: Uint8Array; slugId: Hex; entries: { key: number; offset: number; length: number }[] }[] = [];
  const objects: typeof matrix.table = [];
  let slices: Uint8Array[] = [], entries: { key: number; offset: number; length: number }[] = [], size = 0;
  const flush = () => {
    if (!entries.length) return;
    const bytes = new Uint8Array(size); let at = 0;
    for (const slice of slices) { bytes.set(slice, at); at += slice.length; }
    pages.push({ index: pages.length, bytes, slugId: keccak256(bytes), entries });
    slices = []; entries = []; size = 0;
  };
  for (const value of matrix.table) {
    if (value.bytes.length > maxBytes) { flush(); objects.push(value); continue; }
    if (size + value.bytes.length > maxBytes) flush();
    entries.push({ key: value.id, offset: size, length: value.bytes.length });
    slices.push(value.bytes); size += value.bytes.length;
  }
  flush();
  const locations = new Map(pages.flatMap(page => page.entries.map(entry => [entry.key, page.index] as const)));
  const readPlan = matrix.rows.map(row => {
    const template = matrix.templates[row.templateId - 1]!;
    const keys = new Set(template.commands.filter(n => n !== 0xffff).map(n => n >= 0x8000 ? row.choices[n - 0x8000]! : n));
    const dictionaryPages = [...new Set([...keys].flatMap(key => locations.has(key) ? [locations.get(key)!] : []))].sort((a, b) => a - b);
    const objectKeys = [...keys].filter(key => !locations.has(key));
    return { tokenId: row.tokenId, rowBlock: Math.floor(row.tokenId / matrix.rowsPerBlock), dictionaryPages, objectKeys,
      nativeSlugReads: 1 + dictionaryPages.length, objectReads: objectKeys.length };
  });
  return { schema: 'keel-packed-matrix-dictionary@1' as const, pages, objects, readPlan,
    dictionaryBytes: pages.reduce((n, p) => n + p.bytes.length, 0), base64Layers: 0 as const };
}

const encoder = new TextEncoder();
function documentParts(value: unknown): KeelMatrixToken['parts'] {
  const parts: { role: string; bytes: Uint8Array }[] = [];
  const ancestors = new Set<object>();
  const push = (path: string, text: string) => {
    if (parts.length >= 512) throw new RangeError('Metadata exceeds the 512-fragment matrix limit; split the full record into reusable modules.');
    parts.push({ role: path, bytes: encoder.encode(text) });
  };
  const walk = (item: unknown, path: string, depth: number) => {
    if (depth > 32) throw new RangeError('Metadata nesting exceeds 32 levels.');
    if (item === null || typeof item === 'boolean' || typeof item === 'string' || typeof item === 'number') {
      if (typeof item === 'number' && !Number.isFinite(item)) throw new TypeError('Metadata numbers must be finite.');
      // Escape exactly once at the JSON output boundary. Never Base64/hex values.
      push(`${path}/value`, JSON.stringify(item)); return;
    }
    if (typeof item !== 'object' || item === null || ancestors.has(item)) throw new TypeError('Metadata must contain acyclic JSON values.');
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) throw new TypeError('Metadata requires plain objects.');
    ancestors.add(item);
    const array = Array.isArray(item);
    if (array && Object.keys(item).length !== item.length) throw new TypeError('Metadata arrays must be dense and have no extra properties.');
    const entries = array ? item.map((v, i) => [String(i), v] as const) : Object.keys(item).sort().map(key => [key, (item as Record<string, unknown>)[key]] as const);
    push(`${path}/open`, array ? '[' : '{');
    entries.forEach(([key, child], i) => {
      const next = `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`;
      if (array) { if (i) push(`${next}/separator`, ','); }
      else push(`${next}/key`, `${i ? ',' : ''}${JSON.stringify(key)}:`);
      walk(child, next, depth + 1);
    });
    push(`${path}/close`, array ? ']' : '}'); ancestors.delete(item);
  };
  walk(value, '', 0);
  return parts;
}

export function validateKeelMarketplaceMetadata(metadata: Readonly<Record<string, unknown>>) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new TypeError('Marketplace metadata must be an object.');
  if (metadata.attributes !== undefined) {
    if (!Array.isArray(metadata.attributes) || metadata.attributes.length > 128) throw new TypeError('Metadata attributes must be a bounded array.');
    const names = new Set<string>();
    for (const attribute of metadata.attributes) {
      if (!attribute || typeof attribute !== 'object' || typeof attribute.trait_type !== 'string' || !attribute.trait_type.trim() || names.has(attribute.trait_type)) throw new TypeError('Marketplace trait names must be nonempty and unique.');
      names.add(attribute.trait_type);
      if (!['string', 'number', 'boolean'].includes(typeof attribute.value) || (typeof attribute.value === 'number' && !Number.isFinite(attribute.value))) throw new TypeError('Invalid marketplace trait value.');
      if (attribute.display_type !== undefined && !['number', 'boost_number', 'boost_percentage', 'date'].includes(attribute.display_type)) throw new TypeError('Unsupported marketplace display type.');
      if (attribute.display_type !== undefined && typeof attribute.value !== 'number') throw new TypeError('Numeric marketplace display types require numeric values.');
    }
  }
  return metadata;
}

/** Default import path: shared dictionary + templates + binary 16-bit rows.
 * JSON is the consumer-facing result, not a stored document per token.
 * Raw JSON and disabled metadata are explicit creator choices.
 */
export function compileKeelCollectorMetadata(tokens: readonly KeelCollectorMetadataToken[], tokenCount: number, options: KeelCollectorMetadataOptions = {}) {
  const storage = options.storage ?? KEEL_METADATA_STORAGE_DEFAULT;
  if (!['compact-matrix', 'json', 'none'].includes(storage)) throw new TypeError('Unknown metadata storage choice.');
  if (storage === 'none') return { schema: 'keel-collector-metadata@1' as const, storage, enabled: false as const, base64Layers: 0 as const };
  const compile = (rows: readonly KeelMatrixToken[]) => {
    const matrix = compileKeelTokenMatrix(rows, tokenCount, options);
    return { matrix, dictionary: packKeelMatrixDictionary(matrix, options.dictionaryBytes) };
  };
  const marketplace = compile(tokens.map(token => ({ tokenId: token.tokenId,
    parts: storage === 'json' ? [{ role: 'raw-json', bytes: encoder.encode(JSON.stringify(validateKeelMarketplaceMetadata(token.metadata))) }] : documentParts(validateKeelMarketplaceMetadata(token.metadata)) })));
  const full = tokens.filter(token => token.details !== undefined).map(token => ({ tokenId: token.tokenId,
    parts: storage === 'json' ? [{ role: 'raw-json', bytes: encoder.encode(JSON.stringify(token.details)) }] : documentParts(token.details) }));
  return { schema: 'keel-collector-metadata@1' as const, storage, enabled: true as const, base64Layers: 0 as const,
    marketplace, ...(full.length ? { details: compile(full) } : {}),
    warnings: tokens.filter(t => !Array.isArray(t.metadata.attributes) || !t.metadata.attributes.length).map(t => `Token ${t.tokenId} has no marketplace traits; no traits were invented.`) };
}
