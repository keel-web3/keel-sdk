import { concatHex, encodeAbiParameters, isAddress, keccak256, toHex, type Hex } from "viem";

const WORD_MAX = (1n << 256n) - 1n;
const INDEX_MAX = 0xffff_ffff;

export type KeelMintBatchSeedMode = "shared" | "derived";

/** Mirrors KeelMintSeededBatches. Materialization does not change this value. */
export function deriveKeelMintBatchSeed(seed: Hex, tokenId: bigint, mode: KeelMintBatchSeedMode): Hex {
  if (!/^0x[0-9a-fA-F]{64}$/.test(seed)) throw new TypeError("Batch seed must be bytes32.");
  if (typeof tokenId !== "bigint" || tokenId < 1n || tokenId >= 1n << 248n) throw new RangeError("Batch token ID must fit nonzero uint248.");
  if (mode === "shared") return seed;
  if (mode !== "derived") throw new TypeError("Batch seed mode must be shared or derived.");
  return keccak256(encodeAbiParameters(
    [{ type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }],
    [keccak256(toHex("keel.batch-seed@1")), seed, tokenId],
  ));
}

export interface KeelMintSeedField {
  readonly name: string;
  readonly bits: number;
  readonly offset: number;
  readonly wordIndex: number;
  readonly index: bigint;
}

export interface KeelMintSeedFieldInput {
  name: string;
  bits: number;
  /** Omit both placement values to pack after the preceding field. */
  offset?: number;
  wordIndex?: number;
}

export interface KeelMintSeedLayout {
  readonly fields: readonly KeelMintSeedField[];
  readonly byName: Readonly<Record<string, KeelMintSeedField>>;
  /** Highest word index plus one; sparse layouts do not allocate this many words. */
  readonly wordCount: number;
}

function integer(value: number, maximum: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new RangeError(`Invalid ${label}`);
  }
}

function word(value: bigint): void {
  if (typeof value !== "bigint" || value < 0n || value > WORD_MAX) {
    throw new RangeError("Value must fit uint256");
  }
}

/** Matches KeelMintSeeded.fieldIndex: word [17..48], offset [9..16], width [0..8]. */
export function keelMintSeedFieldIndex(wordIndex: number, offset: number, bits: number): bigint {
  integer(wordIndex, INDEX_MAX, "word index");
  integer(offset, 255, "bit offset");
  integer(bits, 256, "bit width");
  if (bits === 0 || offset + bits > 256) throw new RangeError("Field must fit one word");
  return (BigInt(wordIndex) << 17n) | (BigInt(offset) << 9n) | BigInt(bits);
}

export function decodeKeelMintSeedField(index: bigint): Omit<KeelMintSeedField, "name"> {
  if (typeof index !== "bigint" || index < 0n || index >> 49n !== 0n) {
    throw new RangeError("Invalid field index");
  }
  const bits = Number(index & 511n);
  const offset = Number((index >> 9n) & 255n);
  const wordIndex = Number(index >> 17n);
  keelMintSeedFieldIndex(wordIndex, offset, bits);
  return { index, bits, offset, wordIndex };
}

export const KEEL_FULL_SEED_FIELDS = Object.freeze([
  Object.freeze({ name: "seed", bits: 256 }),
]);

/** Explicit compact preset; choosing it limits the seed to 224 bits. */
export const KEEL_COMPACT_SEED_FIELDS = Object.freeze([
  Object.freeze({ name: "seed", bits: 224 }),
  Object.freeze({ name: "id", bits: 32 }),
]);

/** Names are resolved locally. Freeze/version the corresponding schema in the host. */
export function defineKeelMintSeedLayout(
  inputs: readonly KeelMintSeedFieldInput[] = KEEL_FULL_SEED_FIELDS,
): KeelMintSeedLayout {
  const fields: KeelMintSeedField[] = [];
  const byName: Record<string, KeelMintSeedField> = Object.create(null);
  const occupied = new Map<number, bigint>();
  let cursorWord = 0;
  let cursorBit = 0;
  let wordCount = 0;
  for (const input of inputs) {
    if (!input.name || Object.hasOwn(byName, input.name)) throw new Error("Empty or duplicate field name");
    integer(input.bits, 256, "bit width");
    if ((input.wordIndex === undefined) !== (input.offset === undefined)) {
      throw new Error("Supply both wordIndex and offset, or neither");
    }
    let wordIndex = input.wordIndex ?? cursorWord;
    let offset = input.offset ?? cursorBit;
    if (input.wordIndex === undefined && offset + input.bits > 256) {
      wordIndex += 1;
      offset = 0;
    }
    const index = keelMintSeedFieldIndex(wordIndex, offset, input.bits);
    const mask = ((1n << BigInt(input.bits)) - 1n) << BigInt(offset);
    const used = occupied.get(wordIndex) ?? 0n;
    if ((used & mask) !== 0n) throw new Error("Fields overlap");
    occupied.set(wordIndex, used | mask);
    const field = Object.freeze({ name: input.name, bits: input.bits, offset, wordIndex, index });
    fields.push(field);
    byName[input.name] = field;
    cursorWord = wordIndex;
    cursorBit = offset + input.bits;
    wordCount = Math.max(wordCount, wordIndex + 1);
  }
  return Object.freeze({ fields: Object.freeze(fields), byName: Object.freeze(byName), wordCount });
}

export function unpackKeelMintSeedField(value: bigint, index: bigint): bigint {
  word(value);
  const field = decodeKeelMintSeedField(index);
  return (value >> BigInt(field.offset)) & ((1n << BigInt(field.bits)) - 1n);
}

export function packKeelMintSeedField(original: bigint, index: bigint, value: bigint): bigint {
  word(original);
  word(value);
  const field = decodeKeelMintSeedField(index);
  const mask = (1n << BigInt(field.bits)) - 1n;
  if (value > mask) throw new RangeError("Value does not fit field");
  const offset = BigInt(field.offset);
  return (original & ~(mask << offset)) | (value << offset);
}

/** Sorts named updates into the grouped calldata expected by writeFields. */
export function prepareKeelMintSeedUpdates(layout: KeelMintSeedLayout, values: Readonly<Record<string, bigint>>) {
  const updates = Object.entries(values).map(([name, value]) => {
    const field = Object.hasOwn(layout.byName, name) ? layout.byName[name] : undefined;
    if (!field) throw new Error(`Unknown field: ${name}`);
    packKeelMintSeedField(0n, field.index, value);
    return { field, value };
  }).sort((a, b) => a.field.wordIndex - b.field.wordIndex || a.field.offset - b.field.offset);
  return {
    fields: updates.map(({ field }) => field.index),
    values: updates.map(({ value }) => value),
  };
}

/** Prepares complete words for initialization. Unspecified bits start at zero. */
export function packKeelMintSeedWords(layout: KeelMintSeedLayout, values: Readonly<Record<string, bigint>>) {
  const updates = prepareKeelMintSeedUpdates(layout, values);
  const words = new Map<number, bigint>();
  for (let i = 0; i < updates.fields.length; i += 1) {
    const index = updates.fields[i]!;
    const { wordIndex } = decodeKeelMintSeedField(index);
    words.set(wordIndex, packKeelMintSeedField(words.get(wordIndex) ?? 0n, index, updates.values[i]!));
  }
  return [...words].map(([wordIndex, value]) => ({ wordIndex, value }));
}

/** Hashes exactly the supplied ordered words; matches seedFromWords, including the empty range. */
export function hashKeelMintSeedWords(values: readonly bigint[]): Hex {
  return keccak256(concatHex(values.map(value => {
    word(value);
    return toHex(value, { size: 32 });
  })));
}

export type KeelMintSeedFormat = "uint" | "address" | "bytes32" | "bool";
export type KeelMintSeedSource =
  | { readonly kind: "field"; readonly name: string }
  | { readonly kind: "word"; readonly wordIndex: number }
  | { readonly kind: "words"; readonly start: number; readonly count: number }
  | { readonly kind: "host" };

export interface KeelMintSeedProfileInput {
  /** Every field is optional. Omitting fields entirely selects a full-width seed. */
  readonly fields?: readonly (Omit<KeelMintSeedFieldInput, "bits"> & {
    readonly bits?: number;
    readonly format?: KeelMintSeedFormat;
  })[];
  /** Defaults to the entire first word, regardless of its field names. */
  readonly seed?: KeelMintSeedSource;
}

export interface KeelMintSeedProfile {
  readonly profileId: Hex;
  readonly layout: KeelMintSeedLayout;
  readonly formats: readonly KeelMintSeedFormat[];
  readonly names: readonly Hex[];
  readonly formatCodes: readonly number[];
  readonly seed: KeelMintSeedSource;
  /** Zero delegates seed derivation to the host's getter. */
  readonly seedField: bigint;
}

export interface KeelMintSeedProfilePlan {
  readonly profile: KeelMintSeedProfile;
  readonly sequentialProfile: KeelMintSeedProfile;
  /** Actual occupied words, not the largest sparse index plus one. */
  readonly sequentialWords: number;
  readonly packedWords: number;
  readonly savedWords: number;
}

const FORMAT_CODES = { uint: 0, address: 1, bytes32: 2, bool: 3 } as const;

/** A profile is shared configuration, not extra per-record storage. */
export function defineKeelMintSeedProfile(input: KeelMintSeedProfileInput = {}): KeelMintSeedProfile {
  const inputs = input.fields ?? [{ name: "seed", format: "bytes32" as const }];
  const formats = inputs.map(field => field.format ?? "uint");
  const layout = defineKeelMintSeedLayout(inputs.map((field, i) => {
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(field.name) || ["__proto__", "constructor", "prototype"].includes(field.name)
      || new TextEncoder().encode(field.name).length > 32) {
      throw new Error("Profile names must be identifiers of at most 32 UTF-8 bytes");
    }
    const format = formats[i]!;
    if (!Object.hasOwn(FORMAT_CODES, format)) throw new Error("Unknown field format");
    const fixedBits = format === "address" ? 160 : format === "bytes32" ? 256 : format === "bool" ? 1 : undefined;
    const bits = field.bits ?? fixedBits ?? 256;
    if (fixedBits !== undefined && bits !== fixedBits) throw new RangeError(`${format} requires ${fixedBits} bits`);
    return { ...field, bits };
  }));
  const seed = Object.freeze({ ...(input.seed ?? { kind: "word" as const, wordIndex: 0 }) });
  let seedField = 0n;
  let start = 0;
  let count = 0;
  if (seed.kind === "field") {
    if (!Object.hasOwn(layout.byName, seed.name)) throw new Error("Unknown seed field");
    seedField = layout.byName[seed.name]!.index;
  } else if (seed.kind === "word") {
    seedField = keelMintSeedFieldIndex(seed.wordIndex, 0, 256);
  } else if (seed.kind === "words") {
    integer(seed.start, INDEX_MAX, "seed start"); integer(seed.count, INDEX_MAX, "seed count");
    if (seed.start + seed.count > INDEX_MAX + 1) throw new RangeError("Seed word range overflow");
    start = seed.start; count = seed.count;
  } else if (seed.kind !== "host") throw new Error("Unknown seed source");
  const names = layout.fields.map(field => toHex(field.name, { size: 32 }));
  const formatCodes = formats.map(format => FORMAT_CODES[format]);
  const profileId = keccak256(encodeAbiParameters(
    [{ type: "bytes32[]" }, { type: "uint64[]" }, { type: "uint8[]" }, { type: "uint64" }, { type: "uint8" }, { type: "uint32" }, { type: "uint32" }],
    [names, layout.fields.map(field => field.index), formatCodes, seedField, seed.kind === "words" ? 1 : seed.kind === "host" ? 2 : 0, start, count],
  ));
  return Object.freeze({ profileId, layout, formats: Object.freeze(formats), names: Object.freeze(names),
    formatCodes: Object.freeze(formatCodes), seed, seedField });
}

/** Plans a new profile; never apply a different layout to existing stored records.
 * Explicit word/offset assignments remain fixed. Automatic fields use best-fit
 * decreasing placement, retaining declaration order in the returned profile.
 * This heuristic never selects more occupied words than sequential placement.
 */
export function planKeelMintSeedProfile(input: KeelMintSeedProfileInput = {}): KeelMintSeedProfilePlan {
  const sequentialProfile = defineKeelMintSeedProfile(input);
  const fields = sequentialProfile.layout.fields;
  const occupied = new Map<number, bigint>();
  const placements = fields.map(field => ({ wordIndex: field.wordIndex, offset: field.offset }));
  const automatic: number[] = [];
  for (let i = 0; i < fields.length; i += 1) {
    const field = fields[i]!;
    if (input.fields?.[i]?.wordIndex === undefined) automatic.push(i);
    else occupied.set(field.wordIndex, (occupied.get(field.wordIndex) ?? 0n)
      | (((1n << BigInt(field.bits)) - 1n) << BigInt(field.offset)));
  }
  // At most 256 gap sizes; sparse word indices never allocate intervening words.
  const gaps: { wordIndex: number; offset: number }[][] = Array.from({ length: 257 }, () => []);
  for (const [wordIndex, mask] of [...occupied].sort(([a], [b]) => b - a)) {
    let offset = 0;
    while (offset < 256) {
      if ((mask & (1n << BigInt(offset))) !== 0n) { offset += 1; continue; }
      const start = offset;
      while (offset < 256 && (mask & (1n << BigInt(offset))) === 0n) offset += 1;
      gaps[offset - start]!.push({ wordIndex, offset: start });
    }
  }
  automatic.sort((a, b) => fields[b]!.bits - fields[a]!.bits || a - b);
  let nextWord = 0;
  for (const i of automatic) {
    const bits = fields[i]!.bits;
    let size = bits;
    while (size <= 256 && gaps[size]!.length === 0) size += 1;
    let position: { wordIndex: number; offset: number };
    if (size <= 256) position = gaps[size]!.pop()!;
    else {
      while (occupied.has(nextWord)) nextWord += 1;
      integer(nextWord, INDEX_MAX, "word index");
      position = { wordIndex: nextWord, offset: 0 };
      occupied.set(nextWord, 0n);
      size = 256;
    }
    placements[i] = position;
    if (size > bits) gaps[size - bits]!.push({ wordIndex: position.wordIndex, offset: position.offset + bits });
  }
  const candidate = defineKeelMintSeedProfile({ seed: sequentialProfile.seed, fields: fields.map((field, i) => ({
    name: field.name, bits: field.bits, format: sequentialProfile.formats[i]!, ...placements[i]!,
  })) });
  const wordCount = (profile: KeelMintSeedProfile) => new Set(profile.layout.fields.map(field => field.wordIndex)).size;
  const sequentialWords = wordCount(sequentialProfile);
  const candidateWords = wordCount(candidate);
  // Equal-size reshuffling buys no storage reduction. Keep the original identity.
  const profile = candidateWords < sequentialWords ? candidate : sequentialProfile;
  const packedWords = Math.min(candidateWords, sequentialWords);
  return Object.freeze({ profile, sequentialProfile, sequentialWords, packedWords, savedWords: sequentialWords - packedWords });
}

/** Accepts an actual 20-byte address, never an address hash or a lossy number. */
export function packKeelMintSeedProfileWords(
  profile: KeelMintSeedProfile,
  values: Readonly<Record<string, bigint | string | boolean>>,
) {
  const numeric: Record<string, bigint> = Object.create(null);
  const formats = new Map(profile.layout.fields.map((field, at) => [field.name, profile.formats[at]!]));
  for (const [name, value] of Object.entries(values)) {
    const format = formats.get(name);
    if (format === undefined) throw new Error(`Unknown field: ${name}`);
    if (format === "address") {
      if (typeof value !== "string" || !isAddress(value)) throw new TypeError("Expected an address");
      numeric[name] = BigInt(value);
    } else if (format === "bytes32") {
      if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/i.test(value)) throw new TypeError("Expected bytes32");
      numeric[name] = BigInt(value);
    } else if (format === "bool") {
      if (typeof value !== "boolean") throw new TypeError("Expected boolean");
      numeric[name] = value ? 1n : 0n;
    } else {
      if (typeof value !== "bigint") throw new TypeError("Expected bigint");
      numeric[name] = value;
    }
  }
  return packKeelMintSeedWords(profile.layout, numeric);
}
