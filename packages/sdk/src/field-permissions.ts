import {
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  hashTypedData,
  keccak256,
  parseAbi,
  sha256,
  type Address,
  type Hex,
} from "viem";

import { assertKeelTezosEntrypoint, keelTezosAddressBytes, keelTezosChainIdBytes } from "./tezos-collection.js";
import type { TezosMichelineValue, TezosTransactionOperation } from "./tezos-publication.js";

/**
 * KEEL field permissions: creator-defined, user-editable token fields.
 *
 * One KF v1 schema and one value wire format serve both chains byte for byte
 * (keel-contracts `KeelFieldCodec.sol` and `keel_field_codec.py`). This module
 * builds schemas from JSON definitions, converts JSON values to wire bytes,
 * mirrors every onchain check with the same reason names, renders the same
 * `fields`/`attributes` JSON, describes a form for Studio, and prepares
 * review-only EVM calls or Tezos operations. Nothing here signs or submits.
 */

export const KEEL_FIELD_PERMISSIONS = "keel.field-permissions@1" as const;
export const KEEL_FIELD_FORM = "keel.field-form@1" as const;

export const KEEL_FIELD_KINDS = Object.freeze({ bool: 0, uint: 1, int: 2, enum: 3, color: 4, bytes: 5, string: 6 } as const);
export type KeelFieldKind = keyof typeof KEEL_FIELD_KINDS;
export const KEEL_FIELD_CHARSETS = Object.freeze({ lower: 1, upper: 2, digit: 4, space: 8, punct: 16, utf8: 32 } as const);
export type KeelFieldCharset = keyof typeof KEEL_FIELD_CHARSETS;
export const KEEL_FIELD_SCHEMA_REASONS = Object.freeze([
  "HEADER", "FIELD_COUNT", "KIND", "WIDTH", "RANGE", "OFFSET", "LENGTHS", "CHARSET", "OPTIONS", "NAME", "LABEL",
  "VALIDATOR", "RENDER_SIZE", "WORDS", "FLAGS", "INCOMPATIBLE", "TRUNCATED",
] as const);
export const KEEL_FIELD_VALUE_REASONS = Object.freeze([
  "UNKNOWN_FIELD", "RETIRED", "FROZEN", "LENGTH", "BOOL", "RANGE", "STEP", "OPTION", "CHARSET", "UTF8", "VALIDATOR",
  "TRAILING", "EMPTY",
] as const);
export type KeelFieldSchemaReason = (typeof KEEL_FIELD_SCHEMA_REASONS)[number];
export type KeelFieldValueReason = (typeof KEEL_FIELD_VALUE_REASONS)[number];

/** Gate atoms, numbered as onchain (EVM `ATOM_*`, Tezos `atom` variant order). */
export const KEEL_FIELD_ATOMS = Object.freeze({
  creator: 0, account: 1, "account-set": 2, merkle: 3, signed: 4, "token-owner": 5, "pointer-owner": 6,
} as const);

const FLAG_COLLECTION = 1, FLAG_LISTED = 2, FLAG_RETIRED = 4, FLAG_ALPHA = 8, FLAG_APPROVED_ONLY = 16;
const HEADER = 8, RECORD = 40, MAX_FIELDS = 64, MAX_VALUE_BYTES = 128, MAX_SCHEMA_BYTES = 16_384;
const MAX_CONTEXT_BYTES = 3072, MAX_VALIDATORS = 8, MAX_RULES = 16, MAX_ATOMS = 4;
const MAX_SAFE = (1n << 53n) - 1n, TWO64 = 1n << 64n, TWO63 = 1n << 63n;
const ANY_TOKEN = (1n << 256n) - 1n;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** A schema the registries would refuse, with the onchain reason (`InvalidFieldSchema(code)`, `FIELD_SCHEMA_<reason>`). */
export class KeelFieldSchemaError extends Error {
  readonly reason: KeelFieldSchemaReason;
  readonly code: number;
  constructor(reason: KeelFieldSchemaReason, detail?: string) {
    super(`Field schema refused: ${reason}${detail ? ` (${detail})` : ""}.`);
    this.name = "KeelFieldSchemaError";
    this.reason = reason;
    this.code = KEEL_FIELD_SCHEMA_REASONS.indexOf(reason) + 1;
  }
}

/** A value the registries would refuse (`InvalidFieldValue(field, code)`, `("FIELD_VALUE_<reason>", field)`). */
export class KeelFieldValueError extends Error {
  readonly reason: KeelFieldValueReason;
  readonly code: number;
  readonly field: number;
  constructor(reason: KeelFieldValueReason, field: number, detail?: string) {
    super(`Field value refused: ${reason} at field ${field}${detail ? ` (${detail})` : ""}.`);
    this.name = "KeelFieldValueError";
    this.reason = reason;
    this.code = KEEL_FIELD_VALUE_REASONS.indexOf(reason) + 1;
    this.field = field;
  }
}

const schemaFail = (reason: KeelFieldSchemaReason, detail?: string): never => { throw new KeelFieldSchemaError(reason, detail); };
const valueFail = (reason: KeelFieldValueReason, field: number, detail?: string): never => { throw new KeelFieldValueError(reason, field, detail); };

// ---------------------------------------------------------------------------
// Bytes
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();
const utf8 = (value: string): Uint8Array => encoder.encode(value);
const hexOf = (bytes: Uint8Array): Hex => `0x${Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("")}` as Hex;

function bytesOf(value: Uint8Array | string, label: string): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/u.test(value)) throw new TypeError(`${label} must be 0x-prefixed even-length hex.`);
  const out = new Uint8Array((value.length - 2) / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(value.slice(2 + 2 * i, 4 + 2 * i), 16);
  return out;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

function readUint(data: Uint8Array, at: number, n: number): bigint {
  let value = 0n;
  for (let i = 0; i < n; i += 1) value = (value << 8n) | BigInt(data[at + i] as number);
  return value;
}

function uintBytes(value: bigint, n: number): Uint8Array {
  const out = new Uint8Array(n);
  let rest = value;
  for (let i = n - 1; i >= 0; i -= 1) { out[i] = Number(rest & 255n); rest >>= 8n; }
  return out;
}

const signed64 = (value: bigint): bigint => (value >= TWO63 ? value - TWO64 : value);
const bitLength = (value: bigint): number => (value <= 0n ? 0 : value.toString(2).length);
const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

function natural(value: unknown, label: string, max?: bigint): bigint {
  let result: bigint;
  if (typeof value === "bigint") result = value;
  else if (typeof value === "number" && Number.isSafeInteger(value)) result = BigInt(value);
  else if (typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value)) result = BigInt(value);
  else throw new TypeError(`${label} must be a nonnegative integer.`);
  if (result < 0n || (max !== undefined && result > max)) throw new RangeError(`${label} is out of range.`);
  return result;
}

function integer(value: unknown, label: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^-?(?:0|[1-9][0-9]*)$/u.test(value)) return BigInt(value);
  throw new TypeError(`${label} must be an integer.`);
}

// ---------------------------------------------------------------------------
// Schema model
// ---------------------------------------------------------------------------

/** One creator-defined field, as JSON. Ordering is the field index; new fields only append. */
export interface KeelFieldDefinition {
  readonly name: string;
  readonly kind: KeelFieldKind;
  /** Token scope (default) or one shared value per collection. */
  readonly scope?: "token" | "collection";
  /** Also published as a marketplace attribute. */
  readonly listed?: boolean;
  /** Kept for layout compatibility; no longer edited or rendered. */
  readonly retired?: boolean;
  readonly default?: boolean | number | string | bigint;
  readonly min?: number | string | bigint;
  readonly max?: number | string | bigint;
  /** UINT/INT values must be min + k*step. */
  readonly step?: number | string | bigint;
  /** Explicit bit width (defaults to the minimum for the range). */
  readonly width?: number;
  readonly options?: readonly string[];
  /** ENUM options an editor may choose (all when omitted). */
  readonly selectable?: readonly string[];
  readonly alpha?: boolean;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly charset?: readonly KeelFieldCharset[];
  /** 1-based index into the collection's validator table (0 = none). */
  readonly validator?: number;
  /** The validator must be KEEL-approved at edit time. */
  readonly approvedOnly?: boolean;
}

export interface KeelFieldSchemaDefinition {
  readonly fields: readonly KeelFieldDefinition[];
  /** Opaque UI descriptor stored after the names (labels, widgets, help text). */
  readonly ui?: Readonly<Record<string, unknown>>;
}

/** A decoded field record. Bounds are exact integers (INT bounds are signed). */
export interface KeelField {
  readonly index: number;
  readonly name: string;
  readonly kind: KeelFieldKind;
  readonly kindCode: number;
  readonly flags: number;
  readonly scope: "token" | "collection";
  readonly listed: boolean;
  readonly retired: boolean;
  readonly alpha: boolean;
  readonly approvedOnly: boolean;
  readonly width: number;
  readonly validator: number;
  readonly bitOffset: number;
  readonly minLength: number;
  readonly maxLength: number;
  readonly min: bigint;
  readonly max: bigint;
  readonly default: bigint;
  /** Raw param word: UINT/INT step, ENUM selectable mask, STRING charset mask. */
  readonly param: bigint;
  readonly options?: readonly string[];
  readonly selectable?: readonly string[];
  readonly charset?: readonly KeelFieldCharset[];
}

export interface KeelFieldSchema {
  readonly bytes: Uint8Array;
  readonly hex: Hex;
  readonly fields: readonly KeelField[];
  readonly tokenWords: number;
  readonly collectionWords: number;
  readonly ui: unknown;
  /** Byte ranges of each field's names entry (name plus ENUM labels), for compatibility checks. */
  readonly nameEntries: readonly (readonly [number, number])[];
}

const KIND_NAMES = Object.keys(KEEL_FIELD_KINDS) as KeelFieldKind[];
const CHARSET_NAMES = Object.keys(KEEL_FIELD_CHARSETS) as KeelFieldCharset[];

function asciiClass(c: number): number {
  if (c >= 0x61 && c <= 0x7a) return 1;
  if (c >= 0x41 && c <= 0x5a) return 2;
  if (c >= 0x30 && c <= 0x39) return 4;
  if (c === 0x20) return 8;
  if (c < 0x21 || c > 0x7e || c === 0x22 || c === 0x5c || c === 0x3c || c === 0x3e) return 0;
  return 16;
}

function checkText(data: Uint8Array, start: number, length: number, name: boolean): boolean {
  if (length === 0 || length > 32) return false;
  for (let i = 0; i < length; i += 1) {
    const c = data[start + i] as number;
    const cls = asciiClass(c);
    if (name ? !(cls === 1 || cls === 4 || c === 0x5f) : cls === 0) return false;
  }
  return true;
}

function valueRenderMax(kind: number, flags: number, maxLen: number, maxLabel: number): number {
  if (kind === 0) return 5;
  if (kind === 1 || kind === 2) return 17;
  if (kind === 3) return maxLabel + 2;
  if (kind === 4) return (flags & FLAG_ALPHA) !== 0 ? 11 : 9;
  if (kind === 5) return 4 + 2 * maxLen;
  return 2 + maxLen;
}

interface RawField {
  kind: number; flags: number; width: number; validator: number; bitOffset: number; minLen: number; maxLen: number;
  min: bigint; max: bigint; dflt: bigint; param: bigint;
}

function rawField(schema: Uint8Array, index: number): RawField {
  const at = HEADER + index * RECORD;
  return {
    kind: schema[at] as number, flags: schema[at + 1] as number, width: schema[at + 2] as number,
    validator: schema[at + 3] as number, bitOffset: Number(readUint(schema, at + 4, 2)),
    minLen: schema[at + 6] as number, maxLen: schema[at + 7] as number,
    min: readUint(schema, at + 8, 8), max: readUint(schema, at + 16, 8),
    dflt: readUint(schema, at + 24, 8), param: readUint(schema, at + 32, 8),
  };
}

function checkFixed(f: RawField): void {
  if (f.minLen !== 0 || f.maxLen !== 0) schemaFail("LENGTHS");
  if (f.width === 0 || f.width > 64) schemaFail("WIDTH");
  if (f.kind === 0) {
    if (f.width !== 1) schemaFail("WIDTH");
    if (f.min !== 0n || f.max !== 1n || f.dflt > 1n || f.param !== 0n) schemaFail("RANGE");
  } else if (f.kind === 1) {
    if (f.min > f.max || f.max > MAX_SAFE || f.dflt < f.min || f.dflt > f.max) schemaFail("RANGE");
    if (f.width < bitLength(f.max - f.min)) schemaFail("WIDTH");
    if (f.param > 1n && (f.dflt - f.min) % f.param !== 0n) schemaFail("RANGE");
  } else if (f.kind === 2) {
    const lo = signed64(f.min), hi = signed64(f.max), d = signed64(f.dflt);
    const abs = (v: bigint): bigint => (v < 0n ? -v : v);
    if (lo > hi || abs(lo) > MAX_SAFE || abs(hi) > MAX_SAFE || d < lo || d > hi) schemaFail("RANGE");
    if (f.width < bitLength(hi - lo)) schemaFail("WIDTH");
    if (f.param > 1n && (d - lo) % f.param !== 0n) schemaFail("RANGE");
  } else if (f.kind === 3) {
    if (f.min !== 0n || f.max > 63n || f.dflt > f.max) schemaFail("OPTIONS");
    if (f.width < (f.max === 0n ? 1 : bitLength(f.max))) schemaFail("WIDTH");
    if (f.max < 63n && (f.param >> (f.max + 1n)) !== 0n) schemaFail("OPTIONS");
    if (f.param !== 0n && ((f.param >> f.dflt) & 1n) === 0n) schemaFail("OPTIONS");
  } else {
    if (f.width !== ((f.flags & FLAG_ALPHA) !== 0 ? 32 : 24)) schemaFail("WIDTH");
    if (f.min !== 0n || f.max !== 0n || f.param !== 0n || (f.dflt >> BigInt(f.width)) !== 0n) schemaFail("RANGE");
  }
}

function checkVariable(f: RawField): void {
  if (f.width !== 0 || f.bitOffset !== 0) schemaFail("WIDTH");
  if (f.min !== 0n || f.max !== 0n || f.dflt !== 0n) schemaFail("RANGE");
  if (f.maxLen === 0 || f.minLen > f.maxLen || f.maxLen > MAX_VALUE_BYTES) schemaFail("LENGTHS");
  if (f.kind === 6 ? (f.param === 0n || f.param >= 64n) : f.param !== 0n) schemaFail("CHARSET");
}

function place(cursor: number, width: number): number {
  const word = cursor >> 8;
  const capacity = word === 0 ? 192 : 256;
  let next = cursor;
  if ((next & 255) + width > capacity) next = (word + 1) << 8;
  if ((next >> 8) >= 4) schemaFail("OFFSET");
  return next;
}

const usedWords = (cursor: number): number => (cursor === 0 ? 0 : ((cursor - 1) >> 8) + 1);
const decoder = new TextDecoder("utf-8", { fatal: true });

/** Fully validate KF v1 bytes exactly as the registries do and decode them. */
export function decodeKeelFieldSchema(input: Uint8Array | string): KeelFieldSchema {
  const schema = bytesOf(input, "schema");
  if (schema.length < HEADER || schema.length > MAX_SCHEMA_BYTES) schemaFail("HEADER");
  if (schema[0] !== 0x4b || schema[1] !== 0x46 || schema[2] !== 1 || schema[4] !== 0 || schema[7] !== 0) schemaFail("HEADER");
  const count = schema[3] as number;
  if (count === 0 || count > MAX_FIELDS) schemaFail("FIELD_COUNT");
  if (schema.length < HEADER + count * RECORD) schemaFail("TRUNCATED");
  const raws: RawField[] = [];
  let tokenCursor = 0, collectionCursor = 0;
  for (let i = 0; i < count; i += 1) {
    const f = rawField(schema, i);
    raws.push(f);
    if (f.kind > 6) schemaFail("KIND");
    if (f.flags >= 32) schemaFail("FLAGS");
    if ((f.flags & FLAG_ALPHA) !== 0 && f.kind !== 4) schemaFail("FLAGS");
    if (f.validator > MAX_VALIDATORS) schemaFail("VALIDATOR");
    if ((f.flags & FLAG_APPROVED_ONLY) !== 0 && f.validator === 0) schemaFail("FLAGS");
    if (f.kind >= 5) { checkVariable(f); continue; }
    checkFixed(f);
    const collection = (f.flags & FLAG_COLLECTION) !== 0;
    const cursor = place(collection ? collectionCursor : tokenCursor, f.width);
    if (f.bitOffset !== cursor) schemaFail("OFFSET");
    if (collection) collectionCursor = cursor + f.width; else tokenCursor = cursor + f.width;
  }
  // Names section: names unique, ENUM labels present.
  let cursor = HEADER + count * RECORD, maxRender = 0;
  const names: string[] = [], labels: (string[] | undefined)[] = [], entries: [number, number][] = [];
  for (let i = 0; i < count; i += 1) {
    const f = raws[i] as RawField;
    const start = cursor;
    if (cursor >= schema.length) schemaFail("TRUNCATED");
    const nameLength = schema[cursor] as number;
    if (cursor + 1 + nameLength > schema.length) schemaFail("TRUNCATED");
    if (!checkText(schema, cursor + 1, nameLength, true)) schemaFail("NAME");
    const name = decoder.decode(schema.subarray(cursor + 1, cursor + 1 + nameLength));
    if (names.includes(name)) schemaFail("NAME", `duplicate ${name}`);
    names.push(name);
    cursor += 1 + nameLength;
    let maxLabel = 0;
    if (f.kind === 3) {
      if (cursor >= schema.length) schemaFail("TRUNCATED");
      if (BigInt(schema[cursor] as number) !== f.max + 1n) schemaFail("OPTIONS");
      const options = Number(f.max) + 1;
      cursor += 1;
      const list: string[] = [];
      for (let k = 0; k < options; k += 1) {
        if (cursor >= schema.length) schemaFail("TRUNCATED");
        const labelLength = schema[cursor] as number;
        if (cursor + 1 + labelLength > schema.length) schemaFail("TRUNCATED");
        if (!checkText(schema, cursor + 1, labelLength, false)) schemaFail("LABEL");
        list.push(decoder.decode(schema.subarray(cursor + 1, cursor + 1 + labelLength)));
        maxLabel = Math.max(maxLabel, labelLength);
        cursor += 1 + labelLength;
      }
      labels.push(list);
    } else labels.push(undefined);
    maxRender += nameLength + 4 + valueRenderMax(f.kind, f.flags, f.maxLen, maxLabel);
    entries.push([start, cursor]);
  }
  if (maxRender + 11 > MAX_CONTEXT_BYTES) schemaFail("RENDER_SIZE");
  const tokenWords = usedWords(tokenCursor), collectionWords = usedWords(collectionCursor);
  if (schema[5] !== tokenWords || schema[6] !== collectionWords) schemaFail("WORDS");
  let ui: unknown = null;
  if (cursor < schema.length) {
    try { ui = JSON.parse(decoder.decode(schema.subarray(cursor))); } catch { ui = null; }
  }
  const fields = raws.map((f, index): KeelField => {
    const kind = KIND_NAMES[f.kind] as KeelFieldKind;
    const options = labels[index];
    const isInt = f.kind === 2;
    return {
      index, name: names[index] as string, kind, kindCode: f.kind, flags: f.flags,
      scope: (f.flags & FLAG_COLLECTION) !== 0 ? "collection" : "token",
      listed: (f.flags & FLAG_LISTED) !== 0, retired: (f.flags & FLAG_RETIRED) !== 0,
      alpha: (f.flags & FLAG_ALPHA) !== 0, approvedOnly: (f.flags & FLAG_APPROVED_ONLY) !== 0,
      width: f.width, validator: f.validator, bitOffset: f.bitOffset, minLength: f.minLen, maxLength: f.maxLen,
      min: isInt ? signed64(f.min) : f.min, max: isInt ? signed64(f.max) : f.max,
      default: isInt ? signed64(f.dflt) : f.dflt, param: f.param,
      ...(options ? { options, selectable: f.param === 0n ? options : options.filter((_, k) => ((f.param >> BigInt(k)) & 1n) === 1n) } : {}),
      ...(f.kind === 6 ? { charset: CHARSET_NAMES.filter(c => (f.param & BigInt(KEEL_FIELD_CHARSETS[c])) !== 0n) } : {}),
    };
  });
  return { bytes: schema, hex: hexOf(schema), fields, tokenWords, collectionWords, ui, nameEntries: entries };
}

function colorNumber(value: unknown, alpha: boolean, label: string): bigint {
  if (typeof value !== "string" || !(alpha ? /^#[0-9a-fA-F]{8}$/u : /^#[0-9a-fA-F]{6}$/u).test(value)) {
    throw new TypeError(`${label} must be a ${alpha ? "#rrggbbaa" : "#rrggbb"} color.`);
  }
  return BigInt(`0x${value.slice(1)}`);
}

/** Encode JSON field definitions as KF v1 bytes (the same bytes on EVM and Tezos) and validate them. */
export function buildKeelFieldSchema(definition: KeelFieldSchemaDefinition): KeelFieldSchema {
  if (!definition || typeof definition !== "object" || !Array.isArray(definition.fields)) throw new TypeError("A field schema needs a fields array.");
  const fields: readonly KeelFieldDefinition[] = definition.fields;
  if (fields.length === 0 || fields.length > MAX_FIELDS) schemaFail("FIELD_COUNT");
  const records: Uint8Array[] = [], names: Uint8Array[] = [];
  const cursors = { token: 0, collection: 0 };
  for (const [index, f] of fields.entries()) {
    const label = `fields[${index}]`;
    if (!f || typeof f !== "object" || !Object.hasOwn(KEEL_FIELD_KINDS, f.kind)) throw new TypeError(`${label}.kind must be one of ${KIND_NAMES.join(", ")}.`);
    const kind = KEEL_FIELD_KINDS[f.kind];
    const collection = f.scope === "collection";
    let flags = (collection ? FLAG_COLLECTION : 0) | (f.listed ? FLAG_LISTED : 0) | (f.retired ? FLAG_RETIRED : 0) | (f.approvedOnly ? FLAG_APPROVED_ONLY : 0);
    let lo = 0n, hi = 0n, dflt = 0n, param = 0n, width = 0, minLen = 0, maxLen = 0;
    if (kind === 0) {
      lo = 0n; hi = 1n; dflt = f.default === true ? 1n : 0n; width = 1;
    } else if (kind === 1 || kind === 2) {
      lo = integer(f.min, `${label}.min`); hi = integer(f.max, `${label}.max`);
      dflt = f.default === undefined ? lo : integer(f.default, `${label}.default`);
      param = f.step === undefined ? 0n : natural(f.step, `${label}.step`, TWO64 - 1n);
      width = f.width ?? Math.max(1, bitLength(hi - lo));
    } else if (kind === 3) {
      const options = f.options;
      if (!Array.isArray(options) || options.length === 0) schemaFail("OPTIONS", `${label} needs options`);
      hi = BigInt((options as readonly string[]).length - 1);
      const at = f.default === undefined ? 0 : (options as readonly string[]).indexOf(String(f.default));
      if (at < 0) schemaFail("OPTIONS", `${label}.default is not an option`);
      dflt = BigInt(at);
      if (f.selectable !== undefined) {
        for (const option of f.selectable) {
          const k = (options as readonly string[]).indexOf(option);
          if (k < 0) schemaFail("OPTIONS", `${label}.selectable has ${option}`);
          param |= 1n << BigInt(k);
        }
      }
      width = f.width ?? Math.max(1, bitLength(hi));
    } else if (kind === 4) {
      const alpha = f.alpha === true;
      flags |= alpha ? FLAG_ALPHA : 0;
      dflt = colorNumber(f.default ?? (alpha ? "#00000000" : "#000000"), alpha, `${label}.default`);
      width = alpha ? 32 : 24;
    } else {
      minLen = f.minLength ?? 0; maxLen = f.maxLength ?? 0;
      if (!Number.isInteger(minLen) || !Number.isInteger(maxLen) || minLen < 0 || maxLen > 255) schemaFail("LENGTHS", label);
      if (kind === 6) {
        for (const c of f.charset ?? (["lower", "upper", "digit", "space"] as const)) {
          if (!Object.hasOwn(KEEL_FIELD_CHARSETS, c)) schemaFail("CHARSET", `${label}.charset has ${c}`);
          param |= BigInt(KEEL_FIELD_CHARSETS[c as KeelFieldCharset]);
        }
      }
    }
    if (!Number.isInteger(width) || width < 0 || width > 255) schemaFail("WIDTH", label);
    let offset = 0;
    if (kind < 5) {
      const scope = collection ? "collection" : "token";
      let cursor = cursors[scope];
      const capacity = cursor >> 8 === 0 ? 192 : 256;
      if ((cursor & 255) + width > capacity) cursor = ((cursor >> 8) + 1) << 8;
      offset = cursor;
      cursors[scope] = cursor + width;
    }
    const validator = f.validator ?? 0;
    if (!Number.isInteger(validator) || validator < 0 || validator > 255) schemaFail("VALIDATOR", label);
    const word = (v: bigint): Uint8Array => uintBytes(((v % TWO64) + TWO64) % TWO64, 8);
    records.push(concat([
      Uint8Array.of(kind, flags, width, validator), uintBytes(BigInt(offset), 2), Uint8Array.of(minLen, maxLen),
      word(lo), word(hi), word(dflt), word(param),
    ]));
    const name = utf8(f.name ?? "");
    if (name.length > 255) schemaFail("NAME", label);
    names.push(Uint8Array.of(name.length), name);
    if (kind === 3) {
      const options = f.options as readonly string[];
      names.push(Uint8Array.of(options.length));
      for (const option of options) {
        const text = utf8(option);
        if (text.length > 255) schemaFail("LABEL", label);
        names.push(Uint8Array.of(text.length), text);
      }
    }
  }
  const words = (cursor: number): number => usedWords(cursor);
  const header = Uint8Array.of(0x4b, 0x46, 1, fields.length, 0, words(cursors.token), words(cursors.collection), 0);
  const ui = definition.ui && Object.keys(definition.ui).length > 0 ? utf8(canonicalJson(definition.ui)) : new Uint8Array();
  return decodeKeelFieldSchema(concat([header, ...records, ...names, ui]));
}

/** Sorted-key compact ASCII JSON, matching the Python reference (`sort_keys=True`, `ensure_ascii`, no spaces). */
function canonicalJson(value: unknown): string {
  return compactJson(value).replace(/[\u0080-\uffff]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

function compactJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(compactJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.keys(value as Record<string, unknown>).sort().map(k => `${JSON.stringify(k)}:${compactJson((value as Record<string, unknown>)[k])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

/** The append-only check a schema update must pass (frozen fields must stay byte-identical). */
export function checkKeelFieldSchemaCompatible(previous: KeelFieldSchema, next: KeelFieldSchema, frozenMask: bigint = 0n): void {
  if (next.fields.length < previous.fields.length) schemaFail("INCOMPATIBLE", "fields removed");
  for (const a of previous.fields) {
    const b = next.fields[a.index] as KeelField;
    const scopeAlpha = FLAG_COLLECTION | FLAG_ALPHA;
    if (a.kindCode !== b.kindCode || (a.flags & scopeAlpha) !== (b.flags & scopeAlpha) || a.width !== b.width
      || a.bitOffset !== b.bitOffset || a.min !== b.min || a.default !== b.default || (a.kind === "enum" && a.max !== b.max)) {
      schemaFail("INCOMPATIBLE", a.name);
    }
    const [s0, e0] = previous.nameEntries[a.index] as readonly [number, number];
    const [s1, e1] = next.nameEntries[a.index] as readonly [number, number];
    if (!sameBytes(previous.bytes.subarray(s0, e0), next.bytes.subarray(s1, e1))) schemaFail("INCOMPATIBLE", `${a.name} names`);
    if (((frozenMask >> BigInt(a.index)) & 1n) === 1n) {
      const at = HEADER + a.index * RECORD;
      if (!sameBytes(previous.bytes.subarray(at, at + RECORD), next.bytes.subarray(at, at + RECORD))) schemaFail("INCOMPATIBLE", `${a.name} frozen`);
    }
  }
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

/** JSON value of one field: boolean, integer (number/string/bigint), option label, `#rrggbb[aa]`, `0x…`, or text. */
export type KeelFieldJsonValue = boolean | number | string | bigint;

function utf8Sequence(v: Uint8Array, i: number, end: number): number {
  const c = v[i] as number;
  let n: number, lo = 0x80, hi = 0xbf;
  if (c >= 0xc2 && c <= 0xdf) n = 2;
  else if (c >= 0xe0 && c <= 0xef) { n = 3; if (c === 0xe0) lo = 0xa0; if (c === 0xed) hi = 0x9f; }
  else if (c >= 0xf0 && c <= 0xf4) { n = 4; if (c === 0xf0) lo = 0x90; if (c === 0xf4) hi = 0x8f; }
  else return 0;
  if (i + n > end) return 0;
  const second = v[i + 1] as number;
  if (second < lo || second > hi) return 0;
  for (let k = 2; k < n; k += 1) { const next = v[i + k] as number; if (next < 0x80 || next > 0xbf) return 0; }
  return n;
}

function wireLength(f: KeelField, values: Uint8Array, cursor: number): number {
  let n: number;
  if (f.kindCode === 0 || f.kindCode === 3) n = 1;
  else if (f.kindCode === 4) n = f.alpha ? 4 : 3;
  else if (f.kindCode <= 2) n = 8;
  else {
    if (cursor >= values.length) valueFail("LENGTH", f.index);
    n = 1 + (values[cursor] as number);
  }
  if (cursor + n > values.length) valueFail("LENGTH", f.index);
  return n;
}

/** Built-in check of one wire value, mirroring `KeelFieldCodec.checkValue`. */
export function checkKeelFieldWire(f: KeelField, wire: Uint8Array): void {
  const index = f.index;
  if (f.retired) valueFail("RETIRED", index);
  if (f.kindCode >= 5) {
    const length = wire.length - 1;
    if (length < f.minLength || length > f.maxLength) valueFail("LENGTH", index);
    if (f.kindCode === 6) {
      for (let i = 1; i < wire.length;) {
        const c = wire[i] as number;
        if (c >= 0x80) {
          if ((f.param & 32n) === 0n) valueFail("CHARSET", index);
          const n = utf8Sequence(wire, i, wire.length);
          if (n === 0) valueFail("UTF8", index);
          i += n;
          continue;
        }
        if ((BigInt(asciiClass(c)) & f.param) === 0n) valueFail("CHARSET", index);
        i += 1;
      }
    }
    return;
  }
  const raw = readUint(wire, 0, wire.length);
  if (f.kindCode === 0) { if (raw > 1n) valueFail("BOOL", index); return; }
  if (f.kindCode === 1) {
    if (raw < f.min || raw > f.max) valueFail("RANGE", index);
    if (f.param > 1n && (raw - f.min) % f.param !== 0n) valueFail("STEP", index);
    return;
  }
  if (f.kindCode === 2) {
    const v = signed64(raw);
    if (v < f.min || v > f.max) valueFail("RANGE", index);
    if (f.param > 1n && (v - f.min) % f.param !== 0n) valueFail("STEP", index);
    return;
  }
  if (f.kindCode === 3) {
    if (raw > f.max) valueFail("RANGE", index);
    if (f.param !== 0n && ((f.param >> raw) & 1n) === 0n) valueFail("OPTION", index);
  }
}

/** Whole-edit built-in validation (`checkValues`): mask, per-field wire, trailing bytes. */
export function checkKeelFieldValues(schema: KeelFieldSchema, mask: bigint, values: Uint8Array | string): void {
  const data = bytesOf(values, "values");
  const count = schema.fields.length;
  if (mask === 0n) valueFail("EMPTY", 0);
  if (count < 64 && (mask >> BigInt(count)) !== 0n) valueFail("UNKNOWN_FIELD", count);
  let cursor = 0;
  for (const f of schema.fields) {
    if (((mask >> BigInt(f.index)) & 1n) === 0n) continue;
    const n = wireLength(f, data, cursor);
    checkKeelFieldWire(f, data.subarray(cursor, cursor + n));
    cursor += n;
  }
  if (cursor !== data.length) valueFail("TRAILING", count);
}

/** JSON value → KF v1 wire bytes for one field, checked with the onchain rules. */
export function encodeKeelFieldValue(f: KeelField, value: KeelFieldJsonValue): Uint8Array {
  let wire: Uint8Array;
  const label = `field ${f.name}`;
  switch (f.kind) {
    case "bool":
      if (typeof value !== "boolean") throw new TypeError(`${label} must be a boolean.`);
      wire = Uint8Array.of(value ? 1 : 0); break;
    case "uint":
    case "int": {
      const v = integer(value, label);
      if (v < -TWO63 || v >= TWO64) valueFail("RANGE", f.index);
      wire = uintBytes(((v % TWO64) + TWO64) % TWO64, 8); break;
    }
    case "enum": {
      const k = typeof value === "string" ? (f.options ?? []).indexOf(value) : Number(integer(value, label));
      if (k < 0 || k > 255) valueFail("RANGE", f.index, String(value));
      wire = Uint8Array.of(k); break;
    }
    case "color": wire = uintBytes(colorNumber(value, f.alpha, label), f.alpha ? 4 : 3); break;
    case "bytes": {
      const data = bytesOf(String(value), label);
      if (data.length > 255) valueFail("LENGTH", f.index);
      wire = concat([Uint8Array.of(data.length), data]); break;
    }
    default: {
      if (typeof value !== "string") throw new TypeError(`${label} must be a string.`);
      const data = utf8(value);
      if (data.length > 255) valueFail("LENGTH", f.index);
      wire = concat([Uint8Array.of(data.length), data]);
    }
  }
  checkKeelFieldWire(f, wire);
  return wire;
}

/** Wire bytes → JSON value (UINT/INT as decimal strings to stay exact). */
export function decodeKeelFieldValue(f: KeelField, wire: Uint8Array | string): KeelFieldJsonValue {
  const data = bytesOf(wire, "wire");
  if (f.kind === "bool") return data[0] === 1;
  if (f.kind === "uint") return readUint(data, 0, 8).toString();
  if (f.kind === "int") return signed64(readUint(data, 0, 8)).toString();
  if (f.kind === "enum") return (f.options ?? [])[data[0] as number] ?? String(data[0]);
  if (f.kind === "color") return `#${hexOf(data).slice(2)}`;
  if (f.kind === "bytes") return hexOf(data.subarray(1));
  return decoder.decode(data.subarray(1));
}

export interface KeelFieldEdit {
  readonly mask: bigint;
  readonly values: Hex;
  readonly fields: readonly string[];
}

/** `{ name: value }` → (mask, concatenated wire in field order), every value checked. */
export function encodeKeelFieldEdit(schema: KeelFieldSchema, values: Readonly<Record<string, KeelFieldJsonValue>>): KeelFieldEdit {
  if (!values || typeof values !== "object") throw new TypeError("values must be an object of field names.");
  const byName = new Map(schema.fields.map(f => [f.name, f]));
  const chosen = Object.keys(values).map(name => {
    const f = byName.get(name);
    if (!f) valueFail("UNKNOWN_FIELD", schema.fields.length, name);
    return f as KeelField;
  }).sort((a, b) => a.index - b.index);
  if (chosen.length === 0) valueFail("EMPTY", 0);
  let mask = 0n;
  const parts = chosen.map(f => { mask |= 1n << BigInt(f.index); return encodeKeelFieldValue(f, values[f.name] as KeelFieldJsonValue); });
  const wire = concat(parts);
  checkKeelFieldValues(schema, mask, wire);
  return { mask, values: hexOf(wire), fields: chosen.map(f => f.name) };
}

/** Split an edit's concatenated wire into per-field wire values (for indexers reading `FieldsEdited`). */
export function splitKeelFieldEdit(schema: KeelFieldSchema, mask: bigint, values: Uint8Array | string): Record<number, Hex> {
  const data = bytesOf(values, "values");
  checkKeelFieldValues(schema, mask, data);
  const out: Record<number, Hex> = {};
  let cursor = 0;
  for (const f of schema.fields) {
    if (((mask >> BigInt(f.index)) & 1n) === 0n) continue;
    const n = wireLength(f, data, cursor);
    out[f.index] = hexOf(data.subarray(cursor, cursor + n));
    cursor += n;
  }
  return out;
}

/** Field names → mask (unknown names are refused). */
export function keelFieldMask(schema: KeelFieldSchema, fields: readonly (string | number)[]): bigint {
  let mask = 0n;
  for (const item of fields) {
    const f = typeof item === "number" ? schema.fields[item] : schema.fields.find(x => x.name === item);
    if (!f) throw new TypeError(`Unknown field ${String(item)}.`);
    mask |= 1n << BigInt(f.index);
  }
  if (mask === 0n) throw new TypeError("Name at least one field.");
  return mask;
}

/** Canonical wire of a field's default value (what an untouched token reads). */
export function keelFieldDefaultWire(f: KeelField): Uint8Array {
  if (f.kindCode >= 5) return Uint8Array.of(0);
  if (f.kind === "bool" || f.kind === "enum") return Uint8Array.of(Number(f.default));
  if (f.kind === "color") return uintBytes(f.default, f.alpha ? 4 : 3);
  return uintBytes(((f.default % TWO64) + TWO64) % TWO64, 8);
}

// ---------------------------------------------------------------------------
// Rendering (same bytes as KeelFieldReader / keel_field_codec.render)
// ---------------------------------------------------------------------------

function renderValue(f: KeelField, wire: Uint8Array): string {
  if (f.kind === "bool" || f.kind === "uint" || f.kind === "int") return String(decodeKeelFieldValue(f, wire));
  if (f.kind === "string") return `"${decoder.decode(wire.subarray(1))}"`;
  return `"${String(decodeKeelFieldValue(f, wire))}"`;
}

export interface KeelFieldRender {
  /** `"fields":{...}` — the member the context gains (window.__KEEL_CONTEXT__.fields). */
  readonly fields: string;
  /** EVM token JSON fragment `,"attributes":[{"trait_type":..,"value":..}]` (empty when nothing is listed). */
  readonly attributes: string;
  /** Tezos TZIP-21 `token_info["attributes"]` value `[{"name":..,"value":..}]` (empty when nothing is listed). */
  readonly tezosAttributes: string;
}

/** Render current values (wire per field index; missing fields read their defaults). */
export function renderKeelFields(schema: KeelFieldSchema, current: Readonly<Record<number, Uint8Array | string>> = {}): KeelFieldRender {
  const live = schema.fields.filter(f => !f.retired);
  const wire = (f: KeelField): Uint8Array => (current[f.index] !== undefined ? bytesOf(current[f.index] as Uint8Array | string, `current[${f.index}]`) : keelFieldDefaultWire(f));
  const listed = live.filter(f => f.listed);
  const fields = `"fields":{${live.map(f => `"${f.name}":${renderValue(f, wire(f))}`).join(",")}}`;
  const attributes = listed.length === 0 ? "" : `,"attributes":[${listed.map(f => `{"trait_type":"${f.name}","value":${renderValue(f, wire(f))}}`).join(",")}]`;
  const tezosAttributes = listed.length === 0 ? "" : `[${listed.map(f => `{"name":"${f.name}","value":${renderValue(f, wire(f))}}`).join(",")}]`;
  return { fields, attributes, tezosAttributes };
}

// ---------------------------------------------------------------------------
// Form descriptor for Studio
// ---------------------------------------------------------------------------

export interface KeelFieldFormInput {
  readonly index: number;
  readonly name: string;
  readonly label: string;
  readonly kind: KeelFieldKind;
  readonly widget: "toggle" | "number" | "select" | "color" | "text" | "hex";
  readonly scope: "token" | "collection";
  readonly listed: boolean;
  readonly editable: boolean;
  readonly frozen: boolean;
  readonly default: KeelFieldJsonValue;
  readonly min?: string;
  readonly max?: string;
  readonly step?: string;
  readonly options?: readonly { readonly value: string; readonly label: string; readonly selectable: boolean }[];
  readonly alpha?: boolean;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly charset?: readonly KeelFieldCharset[];
  readonly customValidator: boolean;
  readonly help?: string;
}

/**
 * What Studio should render for a schema: one input per live field with its limits. `editableMask`
 * (fields the chosen rule grants) and `frozenMask` (space plus token freezes) gate editing.
 */
export function keelFieldForm(schema: KeelFieldSchema, options: { readonly editableMask?: bigint; readonly frozenMask?: bigint } = {}) {
  const editableMask = options.editableMask ?? (1n << BigInt(schema.fields.length)) - 1n;
  const frozenMask = options.frozenMask ?? 0n;
  const ui = (schema.ui && typeof schema.ui === "object" ? schema.ui : {}) as Record<string, Record<string, unknown> | undefined>;
  const inputs = schema.fields.filter(f => !f.retired).map((f): KeelFieldFormInput => {
    const hint = ui[f.name] ?? {};
    const frozen = ((frozenMask >> BigInt(f.index)) & 1n) === 1n;
    const widget = f.kind === "bool" ? "toggle" : f.kind === "uint" || f.kind === "int" ? "number" : f.kind === "enum" ? "select" : f.kind === "color" ? "color" : f.kind === "bytes" ? "hex" : "text";
    return {
      index: f.index, name: f.name, label: typeof hint.label === "string" ? hint.label : f.name, kind: f.kind, widget,
      scope: f.scope, listed: f.listed, frozen, editable: !frozen && ((editableMask >> BigInt(f.index)) & 1n) === 1n,
      default: decodeKeelFieldValue(f, keelFieldDefaultWire(f)),
      ...(f.kind === "uint" || f.kind === "int" ? { min: f.min.toString(), max: f.max.toString(), step: (f.param > 1n ? f.param : 1n).toString() } : {}),
      ...(f.kind === "enum" ? { options: (f.options ?? []).map(o => ({ value: o, label: o, selectable: (f.selectable ?? []).includes(o) })) } : {}),
      ...(f.kind === "color" ? { alpha: f.alpha } : {}),
      ...(f.kindCode >= 5 ? { minLength: f.minLength, maxLength: f.maxLength } : {}),
      ...(f.kind === "string" ? { charset: f.charset ?? [] } : {}),
      customValidator: f.validator !== 0,
      ...(typeof hint.help === "string" ? { help: hint.help } : {}),
    };
  });
  return { schema: KEEL_FIELD_FORM, fields: inputs };
}

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

export type KeelFieldAtom =
  | { readonly kind: "creator" }
  | { readonly kind: "account"; readonly account: string }
  | { readonly kind: "account-set" }
  | { readonly kind: "merkle"; readonly root: string }
  /** EVM: issuer address (EOA or ERC-1271). Tezos: issuer public key (edpk/sppk/p2pk). */
  | { readonly kind: "signed"; readonly issuer: string }
  | { readonly kind: "token-owner" }
  | { readonly kind: "pointer-owner" };

export interface KeelFieldRule {
  readonly ruleId: number;
  readonly fields: readonly (string | number)[];
  /** All must pass (AND). The editor names the rule (OR across rules). */
  readonly atoms: readonly KeelFieldAtom[];
  /** Restrict the rule to one token. */
  readonly tokenId?: number | string | bigint;
}

export type KeelFieldWitness =
  | { readonly kind: "merkle"; readonly leafToken?: number | string | bigint | null; readonly leafFields: readonly (string | number)[]; readonly proof: readonly string[] }
  | { readonly kind: "signed"; readonly grantFields: readonly (string | number)[]; readonly nonce: number | string | bigint; readonly deadline: number | string | bigint; readonly bindValues: boolean; readonly signature: string };

type Family = "evm" | "tezos";

function family(value: unknown): Family {
  if (value !== "evm" && value !== "tezos") throw new TypeError('family must be "evm" or "tezos".');
  return value;
}

function ruleId(value: unknown): number {
  const id = Number(natural(value, "ruleId", BigInt(MAX_RULES - 1)));
  return id;
}

function checkAtoms(atoms: readonly KeelFieldAtom[]): void {
  if (!Array.isArray(atoms) || atoms.length === 0 || atoms.length > MAX_ATOMS) throw new RangeError(`A rule needs 1..${MAX_ATOMS} atoms.`);
  for (const atom of atoms) if (!atom || !Object.hasOwn(KEEL_FIELD_ATOMS, atom.kind)) throw new TypeError(`Unknown gate atom ${String((atom as { kind?: unknown })?.kind)}.`);
}

// ---------------------------------------------------------------------------
// EVM
// ---------------------------------------------------------------------------

export const KEEL_FIELD_REGISTRY_EVM_ABI = parseAbi([
  "function claimSpace(address collection)",
  "function transferSpaceAdmin(address collection, address admin)",
  "function setSchema(address collection, bytes schema)",
  "function setValidators(address collection, address[] validators)",
  "function setRule(address collection, uint8 ruleId, uint64 fieldMask, uint8[] kinds, bytes32[] data, bool tokenFiltered, uint256 tokenFilter)",
  "function disableRule(address collection, uint8 ruleId)",
  "function setAccounts(address collection, uint8 ruleId, address[] accounts, bool allowed)",
  "function setPointer(address collection, uint256 tokenId, address target, uint256 targetTokenId, uint8 standard)",
  "function clearPointer(address collection, uint256 tokenId)",
  "function freezeSchema(address collection)",
  "function freezeFields(address collection, uint64 mask)",
  "function freezeTokenFields(address collection, uint256 tokenId, uint64 mask)",
  "function setPaused(address collection, bool paused)",
  "function setNotify(address collection, bool enabled)",
  "function cancelGrantNonces(address collection, address issuer, uint256[] nonces)",
  "function edit(address collection, uint256 tokenId, uint8 ruleId, uint64 mask, bytes values, bytes[] witnesses)",
  "function grantDigest(address collection, uint8 ruleId, uint256 tokenId, address editor, uint64 fieldMask, bytes32 valueDigest, uint256 nonce, uint64 deadline) view returns (bytes32)",
  "function merkleLeaf(address collection, uint8 ruleId, address account, uint256 leafToken, uint64 leafMask) view returns (bytes32)",
  "function schemaOf(address collection) view returns (bytes)",
  "function fieldValue(address collection, uint256 tokenId, uint8 index) view returns (bytes)",
]);

export const KEEL_FIELD_GRANT_TYPES = Object.freeze({
  FieldGrant: [
    { name: "collection", type: "address" }, { name: "ruleId", type: "uint8" }, { name: "tokenId", type: "uint256" },
    { name: "editor", type: "address" }, { name: "fieldMask", type: "uint64" }, { name: "valueDigest", type: "bytes32" },
    { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint64" },
  ],
} as const);

export interface KeelFieldEvmCall { readonly to: Address; readonly data: Hex; readonly value: "0"; readonly functionName: string }

type EvmFunction = (typeof KEEL_FIELD_REGISTRY_EVM_ABI)[number]["name"];
function evmCall(registry: Address, functionName: EvmFunction, args: readonly unknown[]): KeelFieldEvmCall {
  const data = encodeFunctionData({ abi: KEEL_FIELD_REGISTRY_EVM_ABI, functionName, args } as never) as Hex;
  return { to: registry, data, value: "0", functionName };
}

function evmAtom(atom: KeelFieldAtom): readonly [number, Hex] {
  const zero = `0x${"00".repeat(32)}` as Hex;
  const padded = (account: string): Hex => `0x${getAddress(account).slice(2).toLowerCase().padStart(64, "0")}` as Hex;
  switch (atom.kind) {
    case "account": return [1, padded(atom.account)];
    case "signed": return [4, padded(atom.issuer)];
    case "merkle": {
      const root = bytesOf(atom.root, "merkle root");
      if (root.length !== 32 || root.every(b => b === 0)) throw new TypeError("merkle root must be a nonzero 32-byte value.");
      return [3, hexOf(root)];
    }
    default: return [KEEL_FIELD_ATOMS[atom.kind], zero];
  }
}

/** OpenZeppelin-style double-hashed leaf bound to chain and registry (`KeelFieldRegistry.merkleLeaf`). */
export function keelFieldEvmMerkleLeaf(input: { readonly chainId: number | bigint; readonly registry: string; readonly collection: string; readonly ruleId: number; readonly account: string; readonly tokenId?: number | string | bigint | null; readonly fieldMask: bigint }): Hex {
  const leafToken = input.tokenId === undefined || input.tokenId === null ? ANY_TOKEN : natural(input.tokenId, "tokenId");
  const inner = keccak256(encodeAbiParameters(
    [{ type: "uint256" }, { type: "address" }, { type: "address" }, { type: "uint8" }, { type: "address" }, { type: "uint256" }, { type: "uint64" }],
    [BigInt(input.chainId), getAddress(input.registry), getAddress(input.collection), ruleId(input.ruleId), getAddress(input.account), leafToken, input.fieldMask],
  ));
  return keccak256(inner);
}

// ---------------------------------------------------------------------------
// Tezos (Micheline and PACK)
// ---------------------------------------------------------------------------

const mBytes = (bytes: Uint8Array): TezosMichelineValue => ({ bytes: hexOf(bytes).slice(2) });
const mInt = (value: bigint | number): TezosMichelineValue => ({ int: String(value) });
const mString = (value: string): TezosMichelineValue => ({ string: value });
const mBool = (value: boolean): TezosMichelineValue => ({ prim: value ? "True" : "False" });
const mUnit: TezosMichelineValue = { prim: "Unit" };
const mNone: TezosMichelineValue = { prim: "None" };
const mSome = (value: TezosMichelineValue): TezosMichelineValue => ({ prim: "Some", args: [value] });
const mLeft = (value: TezosMichelineValue): TezosMichelineValue => ({ prim: "Left", args: [value] });
const mRight = (value: TezosMichelineValue): TezosMichelineValue => ({ prim: "Right", args: [value] });
function mPair(values: readonly TezosMichelineValue[]): TezosMichelineValue {
  let result = values[values.length - 1] as TezosMichelineValue;
  for (let i = values.length - 2; i >= 0; i -= 1) result = { prim: "Pair", args: [values[i] as TezosMichelineValue, result] };
  return result;
}
/** Constructor `index` of an `n`-way right-comb `or`: Right^index(Left v), the last one Right^(n-1) v. */
function mVariant(index: number, count: number, value: TezosMichelineValue): TezosMichelineValue {
  let result = index === count - 1 ? value : mLeft(value);
  for (let i = 0; i < index; i += 1) result = mRight(result);
  return result;
}

function tezosAddress(value: string, label: string): string {
  keelTezosAddressBytes(value, label);
  return value;
}

function tezosKey(value: string, label: string): string {
  if (typeof value !== "string" || !/^(edpk|sppk|p2pk|BLpk)[1-9A-HJ-NP-Za-km-z]{40,90}$/u.test(value)) throw new TypeError(`${label} must be a Tezos public key (edpk/sppk/p2pk/BLpk).`);
  return value;
}

function zarith(value: bigint): Uint8Array {
  const out: number[] = [];
  let rest = value < 0n ? -value : value;
  out.push(Number(rest & 0x3fn) | (value < 0n ? 0x40 : 0) | (rest > 0x3fn ? 0x80 : 0));
  rest >>= 6n;
  while (rest > 0n) { out.push(Number(rest & 0x7fn) | (rest > 0x7fn ? 0x80 : 0)); rest >>= 7n; }
  return Uint8Array.from(out);
}
const packInt = (value: bigint): Uint8Array => concat([Uint8Array.of(0x00), zarith(value)]);
const packBytes = (value: Uint8Array): Uint8Array => concat([Uint8Array.of(0x0a), uintBytes(BigInt(value.length), 4), value]);
const packPair = (parts: readonly Uint8Array[]): Uint8Array => {
  let result = parts[parts.length - 1] as Uint8Array;
  for (let i = parts.length - 2; i >= 0; i -= 1) result = concat([Uint8Array.of(0x07, 0x07), parts[i] as Uint8Array, result]);
  return result;
};
const packOption = (value: Uint8Array | null): Uint8Array => (value === null ? Uint8Array.of(0x03, 0x06) : concat([Uint8Array.of(0x05, 0x09), value]));
const sha = (value: Uint8Array): Uint8Array => bytesOf(sha256(value), "sha256");

const GRANT_DOMAIN = utf8("keel.field.grant.v1");

/** sha256(sha256(PACK(leaf record))) — the Tezos registry's `merkle_leaf` view. */
export function keelFieldTezosMerkleLeaf(input: { readonly network: string; readonly registry: string; readonly collection: string; readonly ruleId: number; readonly account: string; readonly tokenId?: number | string | bigint | null; readonly fieldMask: bigint }): Hex {
  const token = input.tokenId === undefined || input.tokenId === null ? null : packInt(natural(input.tokenId, "tokenId"));
  const body = packPair([
    packBytes(keelTezosChainIdBytes(input.network)), packBytes(keelTezosAddressBytes(input.registry, "registry")),
    packBytes(keelTezosAddressBytes(input.collection, "collection")), packInt(BigInt(ruleId(input.ruleId))),
    packBytes(keelTezosAddressBytes(input.account, "account")), packOption(token), packInt(input.fieldMask),
  ]);
  return hexOf(sha(sha(concat([Uint8Array.of(0x05), body]))));
}

/** Exact bytes a Tezos issuer signs (`signing_payload` view): a 0x05-prefixed PACK, so wallets show it as Micheline. */
export function keelFieldTezosGrantPayload(input: { readonly network: string; readonly registry: string; readonly collection: string; readonly ruleId: number; readonly tokenId: number | string | bigint; readonly editor: string; readonly fieldMask: bigint; readonly values?: Uint8Array | string | null; readonly nonce: number | string | bigint; readonly deadline: number | string | bigint }): Hex {
  const digest = input.values === undefined || input.values === null ? new Uint8Array() : sha(bytesOf(input.values, "values"));
  const body = packPair([
    packBytes(GRANT_DOMAIN), packBytes(keelTezosChainIdBytes(input.network)), packBytes(keelTezosAddressBytes(input.registry, "registry")),
    packBytes(keelTezosAddressBytes(input.collection, "collection")), packInt(BigInt(ruleId(input.ruleId))),
    packInt(natural(input.tokenId, "tokenId")), packBytes(keelTezosAddressBytes(input.editor, "editor")),
    packInt(input.fieldMask), packBytes(digest), packInt(natural(input.nonce, "nonce")), packInt(integer(input.deadline, "deadline")),
  ]);
  return hexOf(concat([Uint8Array.of(0x05), body]));
}

function tezosAtom(atom: KeelFieldAtom): TezosMichelineValue {
  const n = 7;
  switch (atom.kind) {
    case "account": return mVariant(1, n, mString(tezosAddress(atom.account, "account")));
    case "merkle": {
      const root = bytesOf(atom.root, "merkle root");
      if (root.length !== 32) throw new TypeError("merkle root must be 32 bytes.");
      return mVariant(3, n, mBytes(root));
    }
    case "signed": return mVariant(4, n, mString(tezosKey(atom.issuer, "issuer")));
    default: return mVariant(KEEL_FIELD_ATOMS[atom.kind], n, mUnit);
  }
}

function tezosCall(registry: string, entrypoint: string, value: TezosMichelineValue): TezosTransactionOperation {
  assertKeelTezosEntrypoint("KeelFieldRegistry", entrypoint);
  return { kind: "transaction", amount: "0", destination: registry, parameters: { entrypoint, value } };
}

// ---------------------------------------------------------------------------
// Merkle trees (sorted pairs on both chains)
// ---------------------------------------------------------------------------

export interface KeelFieldAllowEntry { readonly account: string; readonly tokenId?: number | string | bigint | null; readonly fields: readonly (string | number)[] }

/** Build an allowlist tree for a MERKLE atom: each entry may edit `fields` of `tokenId` (any token when omitted). */
export function buildKeelFieldMerkleTree(input: {
  readonly family: Family; readonly schema: KeelFieldSchema; readonly registry: string; readonly collection: string; readonly ruleId: number;
  readonly chainId?: number | bigint | undefined; readonly network?: string | undefined; readonly entries: readonly KeelFieldAllowEntry[];
}) {
  const chain = family(input.family);
  if (!Array.isArray(input.entries) || input.entries.length === 0 || input.entries.length > 65_536) throw new RangeError("An allowlist needs 1..65,536 entries.");
  const leaves = input.entries.map(entry => {
    const fieldMask = keelFieldMask(input.schema, entry.fields);
    const tokenId = entry.tokenId === undefined || entry.tokenId === null ? null : natural(entry.tokenId, "tokenId");
    const leaf = chain === "evm"
      ? keelFieldEvmMerkleLeaf({ chainId: input.chainId ?? 0, registry: input.registry, collection: input.collection, ruleId: input.ruleId, account: entry.account, tokenId, fieldMask })
      : keelFieldTezosMerkleLeaf({ network: String(input.network), registry: input.registry, collection: input.collection, ruleId: input.ruleId, account: entry.account, tokenId, fieldMask });
    return { account: entry.account, tokenId: tokenId === null ? null : tokenId.toString(), fieldMask, leaf };
  });
  const hashPair = (a: Hex, b: Hex): Hex => {
    const [lo, hi] = a < b ? [a, b] : [b, a];
    const joined = concat([bytesOf(lo, "node"), bytesOf(hi, "node")]);
    return chain === "evm" ? keccak256(joined) : hexOf(sha(joined));
  };
  const proofs = leaves.map(() => [] as Hex[]);
  let level = leaves.map((l, i) => ({ hash: l.leaf, members: [i] }));
  while (level.length > 1) {
    const next: { hash: Hex; members: number[] }[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i] as { hash: Hex; members: number[] }, right = level[i + 1];
      if (!right) { next.push(left); continue; }
      for (const m of left.members) (proofs[m] as Hex[]).push(right.hash);
      for (const m of right.members) (proofs[m] as Hex[]).push(left.hash);
      next.push({ hash: hashPair(left.hash, right.hash), members: [...left.members, ...right.members] });
    }
    level = next;
  }
  return { root: (level[0] as { hash: Hex }).hash, leaves: leaves.map((l, i) => ({ ...l, fieldMask: l.fieldMask.toString(), proof: proofs[i] as Hex[] })) };
}

// ---------------------------------------------------------------------------
// Prepare: schema, grant, revoke, freeze, edit
// ---------------------------------------------------------------------------

interface Target { readonly family: Family; readonly registry: string; readonly collection: string }

function target(input: Target): { chain: Family; registry: string; collection: string } {
  const chain = family(input.family);
  if (chain === "evm") return { chain, registry: getAddress(input.registry), collection: getAddress(input.collection) };
  if (!String(input.registry).startsWith("KT1")) throw new TypeError("registry must be a KT1 contract.");
  return { chain, registry: tezosAddress(input.registry, "registry"), collection: tezosAddress(input.collection, "collection") };
}

/** A review-only preparation: EVM `calls` or Tezos `operations`, never signed or submitted. */
export type KeelFieldPrepared<E extends object = object> = {
  readonly schema: typeof KEEL_FIELD_PERMISSIONS;
  readonly step: string;
  readonly family: Family;
  readonly status: "review-only";
  readonly calls?: readonly KeelFieldEvmCall[];
  readonly operations?: readonly TezosTransactionOperation[];
  readonly signing: "not-performed";
  readonly submission: "not-performed";
} & E;

function envelope<E extends object = object>(chain: Family, step: string, calls: readonly (KeelFieldEvmCall | TezosTransactionOperation)[], extra: E = {} as E): KeelFieldPrepared<E> {
  return {
    schema: KEEL_FIELD_PERMISSIONS, step, family: chain, status: "review-only",
    ...(chain === "evm" ? { calls: calls as readonly KeelFieldEvmCall[] } : { operations: calls as readonly TezosTransactionOperation[] }), ...extra,
    signing: "not-performed", submission: "not-performed",
  } as KeelFieldPrepared<E>;
}

function schemaOf(value: KeelFieldSchema | KeelFieldSchemaDefinition | Uint8Array | string): KeelFieldSchema {
  if (value instanceof Uint8Array || typeof value === "string") return decodeKeelFieldSchema(value);
  if ((value as KeelFieldSchema).hex !== undefined && (value as KeelFieldSchema).bytes instanceof Uint8Array) return decodeKeelFieldSchema((value as KeelFieldSchema).bytes);
  return buildKeelFieldSchema(value as KeelFieldSchemaDefinition);
}

function ruleCall(t: ReturnType<typeof target>, schema: KeelFieldSchema, rule: KeelFieldRule): KeelFieldEvmCall | TezosTransactionOperation {
  checkAtoms(rule.atoms);
  const id = ruleId(rule.ruleId);
  const mask = keelFieldMask(schema, rule.fields);
  const filter = rule.tokenId === undefined ? null : natural(rule.tokenId, "rule tokenId");
  if (t.chain === "evm") {
    const atoms = rule.atoms.map(evmAtom);
    return evmCall(t.registry as Address, "setRule", [t.collection, id, mask, atoms.map(a => a[0]), atoms.map(a => a[1]), filter !== null, filter ?? 0n]);
  }
  return tezosCall(t.registry, "set_rule", mPair([mString(t.collection), mInt(id), mInt(mask), rule.atoms.map(tezosAtom), filter === null ? mNone : mSome(mInt(filter))]));
}

/**
 * Publish (or append to) a collection's field schema: optional claim, the schema bytes, an optional
 * validator table and rules. The claim must come from the collection's live authority.
 */
export function prepareKeelFieldSchema(input: Target & {
  readonly schema: KeelFieldSchema | KeelFieldSchemaDefinition | Uint8Array | string;
  readonly claim?: boolean; readonly previousSchema?: Uint8Array | string; readonly frozenMask?: bigint;
  readonly validators?: readonly string[]; readonly rules?: readonly KeelFieldRule[];
  readonly notify?: boolean; readonly metadataPatch?: boolean;
}) {
  const t = target(input);
  const schema = schemaOf(input.schema);
  if (input.previousSchema !== undefined) checkKeelFieldSchemaCompatible(decodeKeelFieldSchema(input.previousSchema), schema, input.frozenMask ?? 0n);
  const validators = input.validators ?? [];
  if (validators.length > MAX_VALIDATORS) throw new RangeError(`At most ${MAX_VALIDATORS} validators.`);
  for (const f of schema.fields) if (f.validator > validators.length && input.validators !== undefined) throw new RangeError(`Field ${f.name} names validator ${f.validator} beyond the table.`);
  const calls: (KeelFieldEvmCall | TezosTransactionOperation)[] = [];
  if (t.chain === "evm") {
    const r = t.registry as Address;
    if (input.claim) calls.push(evmCall(r, "claimSpace", [t.collection]));
    calls.push(evmCall(r, "setSchema", [t.collection, schema.hex]));
    if (input.validators !== undefined) calls.push(evmCall(r, "setValidators", [t.collection, validators.map(v => getAddress(v))]));
    for (const rule of input.rules ?? []) calls.push(ruleCall(t, schema, rule));
    if (input.notify !== undefined) calls.push(evmCall(r, "setNotify", [t.collection, input.notify]));
    if (input.metadataPatch !== undefined) throw new TypeError("metadataPatch is Tezos-only; EVM collections bind a reader (setFieldReader).");
  } else {
    if (input.claim) calls.push(tezosCall(t.registry, "claim_space", mString(t.collection)));
    calls.push(tezosCall(t.registry, "set_schema", mPair([mString(t.collection), mBytes(schema.bytes)])));
    if (input.validators !== undefined) calls.push(tezosCall(t.registry, "set_validators", mPair([mString(t.collection), validators.map(v => mString(tezosAddress(v, "validator")))])));
    for (const rule of input.rules ?? []) calls.push(ruleCall(t, schema, rule));
    if (input.notify !== undefined) throw new TypeError("notify is EVM-only; Tezos uses metadataPatch to rewrite token_info attributes.");
    if (input.metadataPatch !== undefined) calls.push(tezosCall(t.registry, "set_metadata_patch", mPair([mString(t.collection), mBool(input.metadataPatch)])));
  }
  return envelope(t.chain, "field-schema", calls, {
    schemaHex: schema.hex, bytes: schema.bytes.length, fields: schema.fields.map(f => ({ index: f.index, name: f.name, kind: f.kind, scope: f.scope })),
    tokenWords: schema.tokenWords, collectionWords: schema.collectionWords,
  });
}

export type KeelFieldGrant =
  | { readonly grant: "rule"; readonly rule: KeelFieldRule }
  | { readonly grant: "accounts"; readonly ruleId: number; readonly accounts: readonly string[] }
  | { readonly grant: "pointer"; readonly tokenId: number | string | bigint; readonly target: string; readonly targetTokenId: number | string | bigint; readonly standard?: "erc721" | "erc1155" | "fa2" }
  | { readonly grant: "merkle"; readonly ruleId: number; readonly fields: readonly (string | number)[]; readonly entries: readonly KeelFieldAllowEntry[]; readonly chainId?: number | bigint; readonly network?: string; readonly extraAtoms?: readonly KeelFieldAtom[] }
  | { readonly grant: "signature"; readonly ruleId: number; readonly tokenId: number | string | bigint; readonly editor: string; readonly fields: readonly (string | number)[]; readonly values?: Readonly<Record<string, KeelFieldJsonValue>>; readonly nonce: number | string | bigint; readonly deadline: number | string | bigint; readonly chainId?: number | bigint; readonly network?: string };

/**
 * Open fields to editors: a rule, an account set, an owner pointer, a merkle allowlist (tree + rule),
 * or a signature request for an issuer (EIP-712 typed data on EVM, PACKed payload on Tezos).
 */
export function prepareKeelFieldGrant(input: Target & { readonly schema: KeelFieldSchema | KeelFieldSchemaDefinition | Uint8Array | string } & KeelFieldGrant) {
  const t = target(input);
  const schema = schemaOf(input.schema);
  const evm = t.chain === "evm";
  switch (input.grant) {
    case "rule": return envelope(t.chain, "field-grant", [ruleCall(t, schema, input.rule)], { grant: "rule" });
    case "accounts": {
      const id = ruleId(input.ruleId);
      if (!Array.isArray(input.accounts) || input.accounts.length === 0) throw new TypeError("Name at least one account.");
      const call = evm
        ? evmCall(t.registry as Address, "setAccounts", [t.collection, id, input.accounts.map(a => getAddress(a)), true])
        : tezosCall(t.registry, "set_accounts", mPair([mString(t.collection), mInt(id), input.accounts.map(a => mString(tezosAddress(a, "account"))), mBool(true)]));
      return envelope(t.chain, "field-grant", [call], { grant: "accounts" });
    }
    case "pointer": {
      const tokenId = natural(input.tokenId, "tokenId"), targetTokenId = natural(input.targetTokenId, "targetTokenId");
      const call = evm
        ? evmCall(t.registry as Address, "setPointer", [t.collection, tokenId, getAddress(input.target), targetTokenId, input.standard === "erc1155" ? 1 : 0])
        : tezosCall(t.registry, "set_pointer", mPair([mString(t.collection), mInt(tokenId), mString(tezosAddress(input.target, "target")), mInt(targetTokenId)]));
      return envelope(t.chain, "field-grant", [call], { grant: "pointer", ownership: evm ? (input.standard === "erc1155" ? "balanceOf" : "ownerOf") : "FA2 get_balance view" });
    }
    case "merkle": {
      const tree = buildKeelFieldMerkleTree({ family: t.chain, schema, registry: t.registry, collection: t.collection, ruleId: input.ruleId, chainId: input.chainId, network: input.network, entries: input.entries });
      const atoms: KeelFieldAtom[] = [{ kind: "merkle", root: tree.root }, ...(input.extraAtoms ?? [])];
      return envelope(t.chain, "field-grant", [ruleCall(t, schema, { ruleId: input.ruleId, fields: input.fields, atoms })], { grant: "merkle", root: tree.root, proofs: tree.leaves, witnessAtom: 0 });
    }
    case "signature": {
      const id = ruleId(input.ruleId);
      const fieldMask = keelFieldMask(schema, input.fields);
      const tokenId = natural(input.tokenId, "tokenId");
      const nonce = natural(input.nonce, "nonce");
      const deadline = natural(input.deadline, "deadline", TWO64 - 1n);
      const bound = input.values === undefined ? null : encodeKeelFieldEdit(schema, input.values);
      if (bound && bound.mask !== fieldMask) throw new TypeError("A value-bound grant must cover exactly the fields of its values.");
      if (evm) {
        if (input.chainId === undefined) throw new TypeError("chainId is required for an EVM grant.");
        const typedData = {
          domain: { name: "KEEL Field Permissions", version: "1", chainId: Number(input.chainId), verifyingContract: t.registry as Address },
          primaryType: "FieldGrant" as const, types: KEEL_FIELD_GRANT_TYPES,
          message: { collection: t.collection as Address, ruleId: id, tokenId, editor: getAddress(input.editor), fieldMask, valueDigest: bound ? sha256(bound.values) : (`0x${"00".repeat(32)}` as Hex), nonce, deadline },
        };
        return envelope(t.chain, "field-grant", [], {
          grant: "signature", signer: "issuer", typedData, digest: hashTypedData(typedData as never),
          witness: { kind: "signed", grantFields: input.fields, nonce: nonce.toString(), deadline: deadline.toString(), bindValues: bound !== null },
          ...(bound ? { boundValues: bound.values } : {}),
        });
      }
      if (input.network === undefined) throw new TypeError("network is required for a Tezos grant.");
      const payload = keelFieldTezosGrantPayload({ network: input.network, registry: t.registry, collection: t.collection, ruleId: id, tokenId, editor: tezosAddress(input.editor, "editor"), fieldMask, values: bound?.values ?? null, nonce, deadline });
      return envelope(t.chain, "field-grant", [], {
        grant: "signature", signer: "issuer", payload, signingType: "MICHELINE (0x05 PACK, signed raw)",
        witness: { kind: "signed", grantFields: input.fields, nonce: nonce.toString(), deadline: deadline.toString(), bindValues: bound !== null },
        ...(bound ? { boundValues: bound.values } : {}),
      });
    }
    default: throw new TypeError("Unsupported field grant.");
  }
}

export type KeelFieldRevoke =
  | { readonly revoke: "rule"; readonly ruleId: number }
  | { readonly revoke: "accounts"; readonly ruleId: number; readonly accounts: readonly string[] }
  | { readonly revoke: "pointer"; readonly tokenId: number | string | bigint }
  /** EVM: issuer address. Tezos: issuer key hash (tz1/tz2/tz3). */
  | { readonly revoke: "nonces"; readonly issuer: string; readonly nonces: readonly (number | string | bigint)[] }
  | { readonly revoke: "admin"; readonly admin: string };

/** Withdraw access: disable a rule (voids its outstanding signatures and proofs), remove accounts, clear a pointer, cancel nonces or hand the space over. */
export function prepareKeelFieldRevoke(input: Target & KeelFieldRevoke) {
  const t = target(input);
  const evm = t.chain === "evm";
  let call: KeelFieldEvmCall | TezosTransactionOperation;
  switch (input.revoke) {
    case "rule": call = evm ? evmCall(t.registry as Address, "disableRule", [t.collection, ruleId(input.ruleId)]) : tezosCall(t.registry, "disable_rule", mPair([mString(t.collection), mInt(ruleId(input.ruleId))])); break;
    case "accounts": call = evm
      ? evmCall(t.registry as Address, "setAccounts", [t.collection, ruleId(input.ruleId), input.accounts.map(a => getAddress(a)), false])
      : tezosCall(t.registry, "set_accounts", mPair([mString(t.collection), mInt(ruleId(input.ruleId)), input.accounts.map(a => mString(tezosAddress(a, "account"))), mBool(false)])); break;
    case "pointer": call = evm ? evmCall(t.registry as Address, "clearPointer", [t.collection, natural(input.tokenId, "tokenId")]) : tezosCall(t.registry, "clear_pointer", mPair([mString(t.collection), mInt(natural(input.tokenId, "tokenId"))])); break;
    case "nonces": {
      const nonces = input.nonces.map((n, i) => natural(n, `nonces[${i}]`));
      if (nonces.length === 0) throw new TypeError("Name at least one nonce.");
      if (evm) call = evmCall(t.registry as Address, "cancelGrantNonces", [t.collection, getAddress(input.issuer), nonces]);
      else {
        if (!/^tz[1-4]/u.test(input.issuer)) throw new TypeError("Tezos nonce cancellation names the issuer key hash (tz1/tz2/tz3/tz4).");
        call = tezosCall(t.registry, "cancel_grant_nonces", mPair([mString(t.collection), mString(tezosAddress(input.issuer, "issuer")), nonces.map(n => mInt(n))]));
      }
      break;
    }
    case "admin": call = evm ? evmCall(t.registry as Address, "transferSpaceAdmin", [t.collection, getAddress(input.admin)]) : tezosCall(t.registry, "transfer_space_admin", mPair([mString(t.collection), mString(tezosAddress(input.admin, "admin"))])); break;
    default: throw new TypeError("Unsupported field revoke.");
  }
  return envelope(t.chain, "field-revoke", [call], { revoke: input.revoke });
}

export type KeelFieldFreeze =
  | { readonly freeze: "fields"; readonly fields: readonly (string | number)[] }
  | { readonly freeze: "token"; readonly tokenId: number | string | bigint; readonly fields: readonly (string | number)[] }
  | { readonly freeze: "schema" }
  | { readonly freeze: "pause" }
  | { readonly freeze: "unpause" };

/** Freeze fields (irreversible), freeze one token's fields (admin or holder), weld the schema, or pause/unpause edits. */
export function prepareKeelFieldFreeze(input: Target & { readonly schema?: KeelFieldSchema | KeelFieldSchemaDefinition | Uint8Array | string } & KeelFieldFreeze) {
  const t = target(input);
  const evm = t.chain === "evm";
  const mask = (): bigint => {
    if (input.schema === undefined) throw new TypeError("schema is required to name fields.");
    return keelFieldMask(schemaOf(input.schema), (input as { fields: readonly (string | number)[] }).fields);
  };
  let call: KeelFieldEvmCall | TezosTransactionOperation;
  switch (input.freeze) {
    case "fields": call = evm ? evmCall(t.registry as Address, "freezeFields", [t.collection, mask()]) : tezosCall(t.registry, "freeze_fields", mPair([mString(t.collection), mInt(mask())])); break;
    case "token": {
      const tokenId = natural(input.tokenId, "tokenId");
      call = evm ? evmCall(t.registry as Address, "freezeTokenFields", [t.collection, tokenId, mask()]) : tezosCall(t.registry, "freeze_token_fields", mPair([mString(t.collection), mInt(tokenId), mInt(mask())]));
      break;
    }
    case "schema": call = evm ? evmCall(t.registry as Address, "freezeSchema", [t.collection]) : tezosCall(t.registry, "freeze_schema", mString(t.collection)); break;
    case "pause":
    case "unpause": call = evm ? evmCall(t.registry as Address, "setPaused", [t.collection, input.freeze === "pause"]) : tezosCall(t.registry, "set_paused", mPair([mString(t.collection), mBool(input.freeze === "pause")])); break;
    default: throw new TypeError("Unsupported field freeze.");
  }
  return envelope(t.chain, "field-freeze", [call], { freeze: input.freeze, irreversible: input.freeze === "fields" || input.freeze === "token" || input.freeze === "schema" });
}

/**
 * An editor's edit: JSON values are converted to wire bytes and checked with the onchain rules
 * before anything is prepared. `witnesses` are keyed by atom index of the claimed rule.
 */
export function prepareKeelFieldEdit(input: Target & {
  readonly schema: KeelFieldSchema | KeelFieldSchemaDefinition | Uint8Array | string; readonly tokenId: number | string | bigint;
  readonly ruleId: number; readonly values: Readonly<Record<string, KeelFieldJsonValue>>;
  readonly witnesses?: Readonly<Record<number, KeelFieldWitness>>; readonly editor?: string;
}) {
  const t = target(input);
  const schema = schemaOf(input.schema);
  const edit = encodeKeelFieldEdit(schema, input.values);
  const id = ruleId(input.ruleId);
  const tokenId = natural(input.tokenId, "tokenId");
  const witnesses = input.witnesses ?? {};
  const indexes = Object.keys(witnesses).map(Number);
  if (indexes.some(i => !Number.isInteger(i) || i < 0 || i >= MAX_ATOMS)) throw new RangeError("Witness keys are atom indexes 0..3.");
  let call: KeelFieldEvmCall | TezosTransactionOperation;
  if (t.chain === "evm") {
    const length = indexes.length === 0 ? 1 : Math.max(...indexes) + 1;
    const list: Hex[] = Array.from({ length }, () => "0x" as Hex);
    for (const i of indexes) {
      const w = witnesses[i] as KeelFieldWitness;
      list[i] = w.kind === "merkle"
        ? encodeAbiParameters([{ type: "uint256" }, { type: "uint64" }, { type: "bytes32[]" }], [w.leafToken === undefined || w.leafToken === null ? ANY_TOKEN : natural(w.leafToken, "leafToken"), keelFieldMask(schema, w.leafFields), w.proof.map(p => hexOf(bytesOf(p, "proof")))])
        : encodeAbiParameters([{ type: "uint64" }, { type: "uint256" }, { type: "uint64" }, { type: "bool" }, { type: "bytes" }], [keelFieldMask(schema, w.grantFields), natural(w.nonce, "nonce"), natural(w.deadline, "deadline", TWO64 - 1n), w.bindValues, hexOf(bytesOf(w.signature, "signature"))]);
    }
    call = evmCall(t.registry as Address, "edit", [t.collection, tokenId, id, edit.mask, edit.values, list]);
  } else {
    const entries = indexes.sort((a, b) => a - b).map(i => {
      const w = witnesses[i] as KeelFieldWitness;
      const value = w.kind === "merkle"
        ? mLeft(mPair([w.leafToken === undefined || w.leafToken === null ? mNone : mSome(mInt(natural(w.leafToken, "leafToken"))), mInt(keelFieldMask(schema, w.leafFields)), w.proof.map(p => mBytes(bytesOf(p, "proof")))]))
        : mRight(mPair([mInt(keelFieldMask(schema, w.grantFields)), mInt(natural(w.nonce, "nonce")), mInt(integer(w.deadline, "deadline")), mBool(w.bindValues), mString(String(w.signature))]));
      return { prim: "Elt", args: [mInt(i), value] } as TezosMichelineValue;
    });
    call = tezosCall(t.registry, "edit", mPair([mString(t.collection), mInt(tokenId), mInt(id), mInt(edit.mask), mBytes(bytesOf(edit.values, "values")), entries]));
  }
  return envelope(t.chain, "field-edit", [call], { mask: edit.mask.toString(), values: edit.values, fields: edit.fields, ...(input.editor ? { expectedSender: input.editor } : {}) });
}

/**
 * KEEL721's field-binding surface (admin `setFieldReader`, `FieldReaderSet`).
 *
 * Kept out of `keel721Abi` on purpose: the canonical shell embeds the digest of the
 * published-view reader bundle, and that bundle carries `keel721Abi`, so adding these
 * entries there would change the registered shell bytes. Combine the two when encoding.
 */
export const keel721FieldBindingAbi = [
  "function setFieldReader(address reader)",
  "event FieldReaderSet(address indexed reader,address indexed registry)",
] as const;
