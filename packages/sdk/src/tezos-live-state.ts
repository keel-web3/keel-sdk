import { blake2b } from "@noble/hashes/blake2b";
import { sha256 } from "@noble/hashes/sha256";

import { keelTezosAddressBytes, keelTezosChainIdBytes } from "./tezos-collection.js";
import type { TezosMichelineValue } from "./tezos-publication.js";

/**
 * LIVE TEZOS STATE AT VIEW TIME, WITH A FROZEN SNAPSHOT.
 *
 * Tezos marketplaces and indexers read the stored `token_metadata` big_map
 * (TzKT/DipDup and TezTok index big_map `update_key` diffs; neither evaluates
 * the TZIP-16 off-chain view). Showing changing state through metadata
 * therefore costs one `set_token_metadata` per token per change. This module is
 * the opt-in alternative for the token's own HTML: the metadata stays static and
 * the document reads the state the triggering action already wrote on chain.
 *
 * The path is the same one `onchain-data.ts` takes for EVM, with one difference:
 * the values are not only frozen. DECLARE the reads (a big_map value by key, or
 * a `run_script_view` call), FREEZE them into an embedded snapshot at
 * publish/mint time, and emit a `phase: "data"` fragment that publishes the
 * snapshot synchronously before any runtime or render module runs. The fragment
 * then tries the declared public RPC list (and TzKT for big_map reads) and
 * replaces a value only when the endpoint names the same chain, is not behind
 * the snapshot level, and the answer decodes to the declared type. A sandbox
 * that blocks the network (objkt's default iframe, a strict CSP, offline) leaves
 * the snapshot in place; nothing throws into the page.
 *
 * Carriage: the snapshot and the read plan are a plain JSON literal inside the
 * script. There is no Base64 lane and no packed blob to decode.
 */

export const KEEL_TEZOS_LIVE_STATE_PROTOCOL = "keel-tezos-live-state@1" as const;

/** Scalar types. `text` is Michelson `bytes` that the reader decodes as UTF-8 (TZIP-style strings stored as bytes). */
export type KeelTezosLiveScalar = "nat" | "int" | "mutez" | "string" | "bytes" | "text" | "bool" | "unit" | "address" | "timestamp";

/**
 * A declared Michelson type. `pair` and `record` are right combs in the
 * contract's own field order (SmartPy sorts record fields alphabetically:
 * `sp.record(token_id, generation)` is `pair (nat %generation) (nat %token_id)`).
 * When the read is resolved against a live contract the declared type is
 * compared with the contract's type and a mismatch is refused.
 */
export type KeelTezosLiveType =
  | KeelTezosLiveScalar
  | { readonly pair: readonly KeelTezosLiveType[] }
  | { readonly record: readonly (readonly [string, KeelTezosLiveType])[] }
  | { readonly option: KeelTezosLiveType }
  | { readonly list: KeelTezosLiveType }
  | { readonly map: readonly [KeelTezosLiveType, KeelTezosLiveType] };

export type KeelTezosLiveValue =
  | null
  | boolean
  | number
  | string
  | readonly KeelTezosLiveValue[]
  | { readonly [key: string]: KeelTezosLiveValue };

/** One big_map value, addressed by its key. */
export interface KeelTezosLiveBigMapRead {
  /** The variable name the artwork reads (`KEEL_TEZOS_LIVE.values.<name>`). */
  readonly name: string;
  readonly kind: "big_map";
  readonly contract: string;
  /** The big_map's storage annotation (without `%`). Resolved to its id from the contract storage. */
  readonly bigMap?: string;
  /** The big_map id, when already known (required for an offline snapshot). */
  readonly bigMapId?: number | string;
  readonly key: { readonly type: KeelTezosLiveType; readonly value: KeelTezosLiveValue };
  readonly value: KeelTezosLiveType;
  /** What an absent key reads as. Defaults to null. */
  readonly absent?: KeelTezosLiveValue;
}

/** One onchain view, simulated through `run_script_view`. */
export interface KeelTezosLiveViewRead {
  readonly name: string;
  readonly kind: "view";
  readonly contract: string;
  readonly view: string;
  /** Defaults to `unit`. */
  readonly input?: { readonly type: KeelTezosLiveType; readonly value: KeelTezosLiveValue };
  readonly returns: KeelTezosLiveType;
}

export type KeelTezosLiveRead = KeelTezosLiveBigMapRead | KeelTezosLiveViewRead;

/** A read with everything the browser needs precomputed (no hashing or packing at view time). */
export type KeelTezosLiveResolvedRead =
  | {
    readonly name: string; readonly kind: "big_map"; readonly contract: string; readonly bigMapId: string;
    readonly keyPacked: string; readonly scriptExpr: string; readonly type: KeelTezosLiveType; readonly absent: KeelTezosLiveValue;
  }
  | {
    readonly name: string; readonly kind: "view"; readonly contract: string; readonly view: string;
    readonly input: TezosMichelineValue; readonly type: KeelTezosLiveType;
  };

export interface KeelTezosLiveSnapshot {
  readonly level: number;
  readonly blockHash?: string;
  readonly values: Readonly<Record<string, KeelTezosLiveValue>>;
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;
const SCALARS = new Set<string>(["nat", "int", "mutez", "string", "bytes", "text", "bool", "unit", "address", "timestamp"]);
const COMPARABLE_SCALARS = new Set<string>(["nat", "int", "mutez", "string", "bytes", "text", "bool", "unit", "address", "timestamp"]);
const ADDRESS = /^(?:tz[1-4]|KT1)[1-9A-HJ-NP-Za-km-z]{33}$/u;
const KT1 = /^KT1[1-9A-HJ-NP-Za-km-z]{33}$/u;
const BLOCK_HASH = /^B[1-9A-HJ-NP-Za-km-z]{50}$/u;
const VIEW_NAME = /^[A-Za-z0-9_.%@]{1,31}$/u;
const MAX_TYPE_DEPTH = 16;
const MAX_READS = 32;
const MAX_ENDPOINTS = 6;
const SECRET = /(?:private|secret|mnemonic|seed|passphrase)/iu;

/* ------------------------------------------------------------------------ */
/* The decoder. ONE source, executed in Node (snapshot validation) and in the  */
/* token (live answers), so the two cannot drift.                              */
/* ------------------------------------------------------------------------ */

/**
 * `D(type, micheline, maxItems)` -> JS value, or throws. Readable Micheline only
 * (addresses and timestamps as strings, the RPC's `unparsing_mode: "Readable"`);
 * a timestamp given as seconds is also accepted. Integers become numbers when
 * they are safe and decimal strings when they are not, so nothing is rounded.
 */
const DECODER_SOURCE = String.raw`function D(t,n,m){
const E=w=>new Error("keel-tezos-live: value is not "+w);
const F=(n,k)=>{const o=[];let c=n;for(let i=0;i<k-1;i++){const a=Array.isArray(c)?c:(c&&c.prim==="Pair"&&Array.isArray(c.args))?c.args:null;if(!a||a.length<2)throw E("a pair");o.push(a[0]);c=a.length===2?a[1]:a.slice(1);}o.push(c);return o;};
if(typeof t==="string"){
if(t==="nat"||t==="int"||t==="mutez"){if(!n||typeof n.int!=="string"||!/^-?(?:0|[1-9][0-9]*)$/.test(n.int)||(t!=="int"&&n.int[0]==="-"))throw E(t);const v=Number(n.int);return Number.isSafeInteger(v)?v:n.int;}
if(t==="string"){if(!n||typeof n.string!=="string")throw E(t);return n.string;}
if(t==="bytes"||t==="text"){if(!n||typeof n.bytes!=="string"||!/^(?:[0-9a-fA-F]{2})*$/.test(n.bytes))throw E(t);const h=n.bytes.toLowerCase();if(t==="bytes")return h;const u=new Uint8Array(h.length/2);for(let i=0;i<u.length;i++)u[i]=parseInt(h.slice(i*2,i*2+2),16);return new TextDecoder("utf-8",{fatal:true}).decode(u);}
if(t==="bool"){if(n&&n.prim==="True")return true;if(n&&n.prim==="False")return false;throw E(t);}
if(t==="unit"){if(n&&n.prim==="Unit")return null;throw E(t);}
if(t==="address"){if(!n||typeof n.string!=="string"||!/^(?:tz[1-4]|KT1)[1-9A-HJ-NP-Za-km-z]{33}$/.test(n.string))throw E(t);return n.string;}
if(t==="timestamp"){let s;if(n&&typeof n.int==="string"&&/^-?[0-9]{1,15}$/.test(n.int))s=Number(n.int)*1000;else if(n&&typeof n.string==="string"&&/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(n.string))s=Date.parse(n.string);if(s===undefined||!Number.isFinite(s))throw E(t);return new Date(s).toISOString().replace(/\.[0-9]{3}Z$/,"Z");}
throw E("a known type");}
if(t&&t.option!==undefined){if(n&&n.prim==="None")return null;if(n&&n.prim==="Some"&&Array.isArray(n.args)&&n.args.length===1)return D(t.option,n.args[0],m);throw E("an option");}
if(t&&t.list!==undefined){if(!Array.isArray(n)||n.length>m)throw E("a bounded list");return n.map(x=>D(t.list,x,m));}
if(t&&t.map!==undefined){if(!Array.isArray(n)||n.length>m)throw E("a bounded map");return n.map(x=>{if(!x||x.prim!=="Elt"||!Array.isArray(x.args)||x.args.length!==2)throw E("a map entry");return [D(t.map[0],x.args[0],m),D(t.map[1],x.args[1],m)];});}
if(t&&Array.isArray(t.pair)){const v=F(n,t.pair.length);return t.pair.map((s,i)=>D(s,v[i],m));}
if(t&&Array.isArray(t.record)){const v=F(n,t.record.length);const o={};t.record.forEach((f,i)=>{o[f[0]]=D(f[1],v[i],m);});return o;}
throw E("a known type");}`;

const DEFAULT_MAX_ITEMS = 1024;
type Decoder = (type: KeelTezosLiveType, node: unknown, maxItems: number) => KeelTezosLiveValue;
const decoder = new Function(`"use strict";${DECODER_SOURCE};return D;`)() as Decoder;

/** Decode one Readable Micheline value against a declared type (the exact code the token runs). */
export function decodeKeelTezosLiveValue(type: KeelTezosLiveType, node: unknown, maxItems: number = DEFAULT_MAX_ITEMS): KeelTezosLiveValue {
  assertLiveType(type);
  return decoder(type, node, maxItems);
}

/* ------------------------------------------------------------------------ */
/* Types                                                                     */
/* ------------------------------------------------------------------------ */

function assertLiveType(type: unknown, depth = 0, comparable = false, label = "type"): asserts type is KeelTezosLiveType {
  if (depth > MAX_TYPE_DEPTH) throw new TypeError(`${label} nests deeper than ${MAX_TYPE_DEPTH}.`);
  if (typeof type === "string") {
    if (!SCALARS.has(type)) throw new TypeError(`${label} "${type}" is not a supported Michelson type.`);
    if (comparable && !COMPARABLE_SCALARS.has(type)) throw new TypeError(`${label} "${type}" is not comparable.`);
    return;
  }
  if (type === null || typeof type !== "object" || Array.isArray(type)) throw new TypeError(`${label} must be a type name or a type object.`);
  const keys = Object.keys(type);
  if (keys.length !== 1) throw new TypeError(`${label} must have exactly one of pair, record, option, list, map.`);
  const record = type as Record<string, unknown>;
  if (Array.isArray(record.pair)) {
    if (record.pair.length < 2 || record.pair.length > 16) throw new TypeError(`${label}.pair needs 2..16 members.`);
    record.pair.forEach((member, index) => assertLiveType(member, depth + 1, comparable, `${label}.pair[${index}]`));
    return;
  }
  if (Array.isArray(record.record)) {
    if (record.record.length < 2 || record.record.length > 16) throw new TypeError(`${label}.record needs 2..16 fields.`);
    const names = new Set<string>();
    for (const [index, field] of (record.record as unknown[]).entries()) {
      if (!Array.isArray(field) || field.length !== 2 || typeof field[0] !== "string" || !IDENTIFIER.test(field[0])) throw new TypeError(`${label}.record[${index}] must be [name, type].`);
      if (names.has(field[0])) throw new TypeError(`${label}.record repeats "${field[0]}".`);
      names.add(field[0]);
      assertLiveType(field[1], depth + 1, comparable, `${label}.record.${field[0]}`);
    }
    return;
  }
  if (record.option !== undefined) { assertLiveType(record.option, depth + 1, comparable, `${label}.option`); return; }
  if (record.list !== undefined) {
    if (comparable) throw new TypeError(`${label}: a list is not comparable and cannot be a big_map key.`);
    assertLiveType(record.list, depth + 1, false, `${label}.list`);
    return;
  }
  if (Array.isArray(record.map) && record.map.length === 2) {
    if (comparable) throw new TypeError(`${label}: a map is not comparable and cannot be a big_map key.`);
    assertLiveType(record.map[0], depth + 1, true, `${label}.map[0]`);
    assertLiveType(record.map[1], depth + 1, false, `${label}.map[1]`);
    return;
  }
  throw new TypeError(`${label} must have exactly one of pair, record, option, list, map.`);
}

function members(type: KeelTezosLiveType): readonly KeelTezosLiveType[] | undefined {
  if (typeof type === "string") return undefined;
  if ("pair" in type) return type.pair;
  if ("record" in type) return type.record.map((field) => field[1]);
  return undefined;
}

/** The declared type as a Michelson type (binary right comb, no annotations). */
export function keelTezosLiveMichelineType(type: KeelTezosLiveType): TezosMichelineValue {
  assertLiveType(type);
  const build = (node: KeelTezosLiveType): TezosMichelineValue => {
    if (typeof node === "string") return { prim: node === "text" ? "bytes" : node };
    const parts = members(node);
    if (parts !== undefined) {
      let out = build(parts[parts.length - 1] as KeelTezosLiveType);
      for (let index = parts.length - 2; index >= 0; index -= 1) out = { prim: "pair", args: [build(parts[index] as KeelTezosLiveType), out] };
      return out;
    }
    if ("option" in node) return { prim: "option", args: [build(node.option)] };
    if ("list" in node) return { prim: "list", args: [build(node.list)] };
    if ("map" in node) return { prim: "map", args: [build(node.map[0]), build(node.map[1])] };
    throw new TypeError("Unknown declared type.");
  };
  return build(type);
}

/** Strip annotations and expand n-ary pairs into binary right combs. */
function normalizeType(node: unknown): TezosMichelineValue {
  if (node === null || typeof node !== "object" || Array.isArray(node)) throw new TypeError("Contract type is not a Micheline primitive.");
  const prim = (node as { prim?: unknown }).prim;
  if (typeof prim !== "string") throw new TypeError("Contract type is not a Micheline primitive.");
  const args = ((node as { args?: unknown[] }).args ?? []).map(normalizeType);
  if (prim === "pair" && args.length > 2) {
    let out = args[args.length - 1] as TezosMichelineValue;
    for (let index = args.length - 2; index >= 0; index -= 1) out = { prim: "pair", args: [args[index] as TezosMichelineValue, out] };
    return out;
  }
  return args.length === 0 ? { prim } : { prim, args };
}

function sameType(declared: KeelTezosLiveType, contract: unknown): boolean {
  return JSON.stringify(keelTezosLiveMichelineType(declared)) === JSON.stringify(normalizeType(contract));
}

/* ------------------------------------------------------------------------ */
/* Values -> Micheline, PACK, script_expr                                    */
/* ------------------------------------------------------------------------ */

function hexOf(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

function bytesOfHex(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/u, "");
  if (!/^(?:[0-9a-fA-F]{2})*$/u.test(clean)) throw new TypeError("Invalid hex.");
  return Uint8Array.from(clean.match(/../gu) ?? [], (pair) => Number.parseInt(pair, 16));
}

const MICHELSON_STRING = /^[\x20-\x7e\n]*$/u;
const HEX = /^(?:0x)?(?:[0-9a-fA-F]{2})*$/u;
const MUTEZ_MAX = (1n << 63n) - 1n;

function integer(value: KeelTezosLiveValue, label: string): bigint {
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^-?(?:0|[1-9][0-9]*)$/u.test(value)) return BigInt(value);
  throw new TypeError(`${label} must be an integer (number or decimal string).`);
}

function timestampSeconds(value: KeelTezosLiveValue, label: string): bigint {
  if (typeof value === "number" || (typeof value === "string" && /^-?[0-9]+$/u.test(value))) return integer(value, label);
  if (typeof value === "string") {
    const ms = Date.parse(value);
    if (Number.isFinite(ms) && /T/u.test(value) && ms % 1000 === 0) return BigInt(ms / 1000);
  }
  throw new TypeError(`${label} must be whole UNIX seconds or an ISO-8601 UTC time.`);
}

/**
 * A JS value as Micheline for the declared type. `mode: "pack"` is the
 * Optimized_legacy form PACK uses (addresses as their binary bytes);
 * `"readable"` is what an RPC accepts as a view input.
 */
export function keelTezosLiveMichelineValue(type: KeelTezosLiveType, value: KeelTezosLiveValue, mode: "pack" | "readable" = "readable", label = "value"): TezosMichelineValue {
  assertLiveType(type);
  const build = (node: KeelTezosLiveType, item: KeelTezosLiveValue, path: string): TezosMichelineValue => {
    if (typeof node === "string") {
      switch (node) {
        case "nat": { const v = integer(item, path); if (v < 0n) throw new RangeError(`${path} must be >= 0.`); return { int: v.toString() }; }
        case "mutez": { const v = integer(item, path); if (v < 0n || v > MUTEZ_MAX) throw new RangeError(`${path} is out of mutez range.`); return { int: v.toString() }; }
        case "int": return { int: integer(item, path).toString() };
        case "string":
          if (typeof item !== "string" || !MICHELSON_STRING.test(item)) throw new TypeError(`${path} must be a Michelson string (printable ASCII and newline).`);
          return { string: item };
        case "bytes":
          if (typeof item !== "string" || !HEX.test(item)) throw new TypeError(`${path} must be even-length hex.`);
          return { bytes: item.replace(/^0x/u, "").toLowerCase() };
        case "text":
          if (typeof item !== "string") throw new TypeError(`${path} must be text.`);
          return { bytes: hexOf(new TextEncoder().encode(item)) };
        case "bool":
          if (typeof item !== "boolean") throw new TypeError(`${path} must be a boolean.`);
          return { prim: item ? "True" : "False" };
        case "unit":
          if (item !== null) throw new TypeError(`${path} must be null (unit).`);
          return { prim: "Unit" };
        case "address":
          if (typeof item !== "string" || !ADDRESS.test(item)) throw new TypeError(`${path} must be a tz1-4 or KT1 address.`);
          {
            const binary = keelTezosAddressBytes(item, path);
            return mode === "pack" ? { bytes: hexOf(binary) } : { string: item };
          }
        case "timestamp": return { int: timestampSeconds(item, path).toString() };
        default: throw new TypeError(`${path} has an unknown type.`);
      }
    }
    const parts = members(node);
    if (parts !== undefined) {
      let values: readonly KeelTezosLiveValue[];
      if ("record" in node) {
        if (item === null || typeof item !== "object" || Array.isArray(item)) throw new TypeError(`${path} must be an object.`);
        const object = item as Record<string, KeelTezosLiveValue>;
        const expected = node.record.map((field) => field[0]);
        const extra = Object.keys(object).filter((key) => !expected.includes(key));
        if (extra.length > 0) throw new TypeError(`${path} has unknown fields: ${extra.join(", ")}.`);
        values = expected.map((key) => { if (!Object.hasOwn(object, key)) throw new TypeError(`${path}.${key} is missing.`); return object[key] as KeelTezosLiveValue; });
      } else {
        if (!Array.isArray(item) || item.length !== parts.length) throw new TypeError(`${path} must be an array of ${parts.length}.`);
        values = item;
      }
      const built = parts.map((part, index) => build(part, values[index] as KeelTezosLiveValue, `${path}[${index}]`));
      let out = built[built.length - 1] as TezosMichelineValue;
      for (let index = built.length - 2; index >= 0; index -= 1) out = { prim: "Pair", args: [built[index] as TezosMichelineValue, out] };
      return out;
    }
    if ("option" in node) return item === null ? { prim: "None" } : { prim: "Some", args: [build(node.option, item, `${path}?`)] };
    if ("list" in node) {
      if (!Array.isArray(item)) throw new TypeError(`${path} must be an array.`);
      return item.map((entry, index) => build(node.list, entry, `${path}[${index}]`));
    }
    throw new TypeError(`${path}: map literals are not accepted as inputs (Michelson needs sorted, deduplicated keys).`);
  };
  return build(type, value, label);
}

const PRIM_CODES: Readonly<Record<string, number>> = { Elt: 0x04, None: 0x06, Pair: 0x07, Some: 0x09, True: 0x0a, False: 0x03, Unit: 0x0b };

function zarith(value: bigint): number[] {
  const negative = value < 0n;
  let rest = negative ? -value : value;
  const out: number[] = [];
  let first = Number(rest & 0x3fn) | (negative ? 0x40 : 0);
  rest >>= 6n;
  if (rest > 0n) first |= 0x80;
  out.push(first);
  while (rest > 0n) {
    let byte = Number(rest & 0x7fn);
    rest >>= 7n;
    if (rest > 0n) byte |= 0x80;
    out.push(byte);
  }
  return out;
}

function length32(length: number): number[] {
  return [(length >>> 24) & 255, (length >>> 16) & 255, (length >>> 8) & 255, length & 255];
}

function encodeMicheline(node: TezosMichelineValue): number[] {
  if (Array.isArray(node)) {
    const body = (node as readonly TezosMichelineValue[]).flatMap(encodeMicheline);
    return [0x02, ...length32(body.length), ...body];
  }
  const item = node as Record<string, unknown>;
  if (typeof item.int === "string") return [0x00, ...zarith(BigInt(item.int))];
  if (typeof item.string === "string") { const bytes = [...new TextEncoder().encode(item.string)]; return [0x01, ...length32(bytes.length), ...bytes]; }
  if (typeof item.bytes === "string") { const bytes = [...bytesOfHex(item.bytes)]; return [0x0a, ...length32(bytes.length), ...bytes]; }
  const code = PRIM_CODES[String(item.prim)];
  if (code === undefined || item.annots !== undefined) throw new TypeError(`PACK of ${String(item.prim)} is not supported here.`);
  const args = (item.args ?? []) as readonly TezosMichelineValue[];
  if (args.length === 0) return [0x03, code];
  if (args.length === 1) return [0x05, code, ...encodeMicheline(args[0] as TezosMichelineValue)];
  if (args.length === 2) return [0x07, code, ...encodeMicheline(args[0] as TezosMichelineValue), ...encodeMicheline(args[1] as TezosMichelineValue)];
  throw new TypeError("PACK of a primitive with more than two arguments is not supported here.");
}

/** Michelson `PACK` of a value of the declared (comparable) type: 0x05 followed by the binary Micheline. */
export function packKeelTezosLiveKey(type: KeelTezosLiveType, value: KeelTezosLiveValue): Uint8Array {
  assertLiveType(type, 0, true, "key type");
  return Uint8Array.from([0x05, ...encodeMicheline(keelTezosLiveMichelineValue(type, value, "pack", "key"))]);
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58check(prefix: readonly number[], payload: Uint8Array): string {
  const body = Uint8Array.from([...prefix, ...payload]);
  const checksum = sha256(sha256(body)).slice(0, 4);
  const bytes = Uint8Array.from([...body, ...checksum]);
  let number = 0n;
  for (const byte of bytes) number = number * 256n + BigInt(byte);
  let out = "";
  while (number > 0n) { out = BASE58[Number(number % 58n)] + out; number /= 58n; }
  for (const byte of bytes) { if (byte !== 0) break; out = `1${out}`; }
  return out;
}

/** Protocol expression address of exact Micheline binary, without PACK's 0x05 prefix. */
export function keelTezosExpressionHash(encoded: Uint8Array): string {
  if (encoded.length === 0) throw new TypeError("An encoded Micheline expression is required.");
  return base58check([13, 44, 64, 27], blake2b(encoded, { dkLen: 32 }));
}

/** The `expr...` big_map key hash the RPC addresses a value by: Base58Check("expr", blake2b-256(PACK(key))). */
export function keelTezosScriptExpr(type: KeelTezosLiveType, value: KeelTezosLiveValue): string {
  return keelTezosExpressionHash(packKeelTezosLiveKey(type, value));
}

/* ------------------------------------------------------------------------ */
/* Reading at publish time                                                   */
/* ------------------------------------------------------------------------ */

function assertNoSecrets(value: unknown, path = "input"): void {
  if (Array.isArray(value)) { value.forEach((item, index) => assertNoSecrets(item, `${path}[${index}]`)); return; }
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET.test(key)) throw new TypeError(`Private signer material is never accepted: ${path}.${key}`);
    assertNoSecrets(child, `${path}.${key}`);
  }
}

function assertNetwork(network: unknown): string {
  if (typeof network !== "string") throw new TypeError("network must be an exact Net... chain identity.");
  keelTezosChainIdBytes(network);
  return network;
}

function bigMapIdOf(value: unknown, label: string): string {
  const text = typeof value === "number" ? String(value) : value;
  if (typeof text !== "string" || !/^(?:0|[1-9][0-9]{0,15})$/u.test(text)) throw new TypeError(`${label} must be a non-negative big_map id.`);
  return text;
}

function assertReads(reads: unknown): readonly KeelTezosLiveRead[] {
  if (!Array.isArray(reads) || reads.length === 0 || reads.length > MAX_READS) throw new TypeError(`reads must list 1..${MAX_READS} declared reads.`);
  const names = new Set<string>();
  for (const [index, read] of (reads as Record<string, unknown>[]).entries()) {
    const label = `reads[${index}]`;
    if (read === null || typeof read !== "object") throw new TypeError(`${label} must be an object.`);
    if (typeof read.name !== "string" || !IDENTIFIER.test(read.name)) throw new TypeError(`${label}.name must be an identifier.`);
    if (names.has(read.name)) throw new TypeError(`Duplicate live variable "${read.name}".`);
    names.add(read.name);
    if (typeof read.contract !== "string" || !KT1.test(read.contract)) throw new TypeError(`${label}.contract must be a KT1 address.`);
    keelTezosAddressBytes(read.contract, `${label}.contract`);
    if (read.kind === "big_map") {
      if (read.bigMap === undefined && read.bigMapId === undefined) throw new TypeError(`${label} needs bigMap (storage annotation) or bigMapId.`);
      if (read.bigMap !== undefined && (typeof read.bigMap !== "string" || !/^[A-Za-z0-9_]{1,64}$/u.test(read.bigMap))) throw new TypeError(`${label}.bigMap must be a storage annotation without %.`);
      if (read.bigMapId !== undefined) bigMapIdOf(read.bigMapId, `${label}.bigMapId`);
      const key = read.key as { type?: unknown; value?: unknown } | undefined;
      if (key === undefined || key === null) throw new TypeError(`${label}.key is required.`);
      assertLiveType(key.type, 0, true, `${label}.key.type`);
      assertLiveType(read.value, 0, false, `${label}.value`);
    } else if (read.kind === "view") {
      if (typeof read.view !== "string" || !VIEW_NAME.test(read.view)) throw new TypeError(`${label}.view must be an onchain view name.`);
      if (read.input !== undefined) assertLiveType((read.input as { type?: unknown }).type, 0, false, `${label}.input.type`);
      assertLiveType(read.returns, 0, false, `${label}.returns`);
    } else {
      throw new TypeError(`${label}.kind must be "big_map" or "view".`);
    }
  }
  return reads as readonly KeelTezosLiveRead[];
}

function endpoint(value: unknown, label: string, allowLoopback: boolean): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) throw new TypeError(`${label} must be a bounded URL.`);
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.hostname.endsWith(".localhost");
  if (url.protocol !== "https:" && !(allowLoopback && loopback && url.protocol === "http:")) throw new TypeError(`${label} must be HTTPS${allowLoopback ? " (or loopback HTTP)" : ""}.`);
  if (url.username !== "" || url.password !== "") throw new TypeError(`${label} must not carry credentials.`);
  if (url.search !== "" || url.hash !== "") throw new TypeError(`${label} must not carry a query or fragment (API keys do not belong in a token).`);
  return url.toString().replace(/\/$/u, "");
}

async function json<T>(fetchImpl: typeof fetch, url: string, init?: { readonly method: "POST"; readonly body: unknown }): Promise<{ readonly status: number; readonly body: T | undefined }> {
  const response = await fetchImpl(url, init === undefined
    ? { headers: { accept: "application/json" } }
    : { method: "POST", headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify(init.body) });
  if (response.status === 404 || response.status === 204) return { status: response.status, body: undefined };
  if (!response.ok) throw new Error(`Tezos read HTTP ${response.status} for ${new URL(url).pathname}`);
  return { status: response.status, body: await response.json() as T };
}

function asPair(node: unknown): readonly [unknown, unknown] {
  const args = Array.isArray(node) ? node : (node as { prim?: string; args?: unknown[] })?.prim === "Pair" ? (node as { args: unknown[] }).args : undefined;
  if (!Array.isArray(args) || args.length < 2) throw new TypeError("Storage value does not follow its pair type.");
  return [args[0], args.length === 2 ? args[1] : args.slice(1)];
}

function typePair(node: { prim: string; args?: unknown[] }): readonly [unknown, unknown] {
  const args = node.args ?? [];
  if (args.length < 2) throw new TypeError("Malformed pair type.");
  return [args[0], args.length === 2 ? args[1] : { prim: "pair", args: args.slice(1) }];
}

function findBigMap(type: unknown, value: unknown, name: string): { readonly id: string; readonly keyType: unknown; readonly valueType: unknown } | undefined {
  const node = type as { prim?: string; args?: unknown[]; annots?: string[] };
  if (node?.prim === "big_map" && (node.annots ?? []).includes(`%${name}`)) {
    const id = (value as { int?: string })?.int;
    if (typeof id !== "string") throw new TypeError(`Storage big_map %${name} has no id.`);
    return { id, keyType: node.args?.[0], valueType: node.args?.[1] };
  }
  if (node?.prim === "pair") {
    const [leftType, rightType] = typePair(node as { prim: string; args?: unknown[] });
    const [leftValue, rightValue] = asPair(value);
    return findBigMap(leftType, leftValue, name) ?? findBigMap(rightType, rightValue, name);
  }
  return undefined;
}

function scriptSection(code: unknown, prim: string, name?: string): { readonly args: readonly unknown[] } | undefined {
  if (!Array.isArray(code)) return undefined;
  return code.find((section) => section?.prim === prim && (name === undefined || section.args?.[0]?.string === name)) as { readonly args: readonly unknown[] } | undefined;
}

export interface KeelTezosLiveStateReadInput {
  readonly network: string;
  /** Where the publish-time snapshot is read. Loopback HTTP is allowed (an Octez mockup or sandbox). */
  readonly rpcUrl: string;
  readonly reads: readonly KeelTezosLiveRead[];
  /** `head` (default) or a block hash to pin. */
  readonly block?: string;
  /** Compare declared key/value/view types with the contract's own (default true). */
  readonly checkTypes?: boolean;
  readonly maxItems?: number;
  readonly fetchImpl?: typeof fetch;
}

export interface KeelTezosLiveStateLayer {
  readonly network: string;
  readonly snapshot: KeelTezosLiveSnapshot;
  readonly reads: readonly KeelTezosLiveResolvedRead[];
  readonly typeChecks: readonly { readonly name: string; readonly checked: boolean; readonly detail: string }[];
}

/** Resolve the declared reads (big_map ids, packed keys, script_expr) without the network. */
export function resolveKeelTezosLiveReads(reads: readonly KeelTezosLiveRead[], bigMapIds: Readonly<Record<string, string>> = {}): readonly KeelTezosLiveResolvedRead[] {
  return assertReads(reads).map((read): KeelTezosLiveResolvedRead => {
    if (read.kind === "big_map") {
      const id = bigMapIds[read.name] ?? (read.bigMapId === undefined ? undefined : bigMapIdOf(read.bigMapId, `${read.name}.bigMapId`));
      if (id === undefined) throw new TypeError(`${read.name}: the big_map id is unknown offline; pass bigMapId or read the contract.`);
      const absent = read.absent ?? null;
      if (absent !== null) keelTezosLiveMichelineValue(read.value, absent, "readable", `${read.name}.absent`);
      return {
        name: read.name, kind: "big_map", contract: read.contract, bigMapId: id,
        keyPacked: hexOf(packKeelTezosLiveKey(read.key.type, read.key.value)),
        scriptExpr: keelTezosScriptExpr(read.key.type, read.key.value),
        type: read.value, absent,
      };
    }
    const input = read.input ?? { type: "unit" as const, value: null };
    return { name: read.name, kind: "view", contract: read.contract, view: read.view, input: keelTezosLiveMichelineValue(input.type, input.value, "readable", `${read.name}.input`), type: read.returns };
  });
}

/**
 * Read every declared value at one block. Resolves big_map ids from storage
 * annotations, compares declared types with the contract's, packs keys and
 * hashes them to `script_expr`, and decodes with the token's own decoder.
 */
export async function readKeelTezosLiveState(input: KeelTezosLiveStateReadInput): Promise<KeelTezosLiveStateLayer> {
  assertNoSecrets({ ...input, fetchImpl: undefined });
  const network = assertNetwork(input.network);
  const rpc = endpoint(input.rpcUrl, "rpcUrl", true);
  const reads = assertReads(input.reads);
  const fetchImpl = input.fetchImpl ?? fetch;
  const maxItems = input.maxItems ?? DEFAULT_MAX_ITEMS;
  const checkTypes = input.checkTypes ?? true;
  if (input.block !== undefined && input.block !== "head" && !BLOCK_HASH.test(input.block)) throw new TypeError("block must be head or a block hash.");

  const chain = (await json<string>(fetchImpl, `${rpc}/chains/main/chain_id`)).body;
  if (chain !== network) throw new Error(`rpcUrl serves ${String(chain)}, not ${network}.`);
  const header = (await json<{ level?: number; hash?: string }>(fetchImpl, `${rpc}/chains/main/blocks/${input.block ?? "head"}/header`)).body;
  const level = header?.level;
  if (typeof level !== "number" || !Number.isSafeInteger(level) || level < 0) throw new Error("The RPC returned no block level.");
  const blockHash = typeof header?.hash === "string" && BLOCK_HASH.test(header.hash) ? header.hash : undefined;
  const block = blockHash ?? input.block ?? "head";

  const scripts = new Map<string, { code?: unknown; storage?: unknown }>();
  const script = async (contract: string) => {
    if (!scripts.has(contract)) {
      const body = (await json<{ code?: unknown; storage?: unknown }>(fetchImpl, `${rpc}/chains/main/blocks/${block}/context/contracts/${contract}/script`)).body;
      if (body === undefined) throw new Error(`${contract} is not originated on ${network}.`);
      scripts.set(contract, body);
    }
    return scripts.get(contract) as { code?: unknown; storage?: unknown };
  };

  const ids: Record<string, string> = {};
  const typeChecks: { name: string; checked: boolean; detail: string }[] = [];
  for (const read of reads) {
    if (read.kind === "big_map") {
      if (read.bigMap !== undefined || checkTypes) {
        if (read.bigMap === undefined) { typeChecks.push({ name: read.name, checked: false, detail: "bigMapId given without a storage annotation; types not compared" }); continue; }
        const { code, storage } = await script(read.contract);
        const storageType = scriptSection(code, "storage")?.args[0];
        const found = findBigMap(storageType, storage, read.bigMap);
        if (found === undefined) throw new Error(`${read.contract} storage has no big_map %${read.bigMap}.`);
        if (read.bigMapId !== undefined && bigMapIdOf(read.bigMapId, "bigMapId") !== found.id) throw new Error(`${read.name}: bigMapId ${String(read.bigMapId)} is not %${read.bigMap} (${found.id}).`);
        ids[read.name] = found.id;
        if (checkTypes) {
          if (!sameType(read.key.type, found.keyType)) throw new TypeError(`${read.name}: declared key type ${JSON.stringify(keelTezosLiveMichelineType(read.key.type))} is not the contract's ${JSON.stringify(normalizeType(found.keyType))}.`);
          if (!sameType(read.value, found.valueType)) throw new TypeError(`${read.name}: declared value type ${JSON.stringify(keelTezosLiveMichelineType(read.value))} is not the contract's ${JSON.stringify(normalizeType(found.valueType))}.`);
          typeChecks.push({ name: read.name, checked: true, detail: `big_map %${read.bigMap} (${found.id}) key and value types match` });
        }
      }
    } else if (checkTypes) {
      const { code } = await script(read.contract);
      const view = scriptSection(code, "view", read.view);
      if (view === undefined) throw new Error(`${read.contract} has no onchain view "${read.view}".`);
      if (!sameType(read.input?.type ?? "unit", view.args[1])) throw new TypeError(`${read.name}: declared input type is not the view's ${JSON.stringify(normalizeType(view.args[1]))}.`);
      if (!sameType(read.returns, view.args[2])) throw new TypeError(`${read.name}: declared return type is not the view's ${JSON.stringify(normalizeType(view.args[2]))}.`);
      typeChecks.push({ name: read.name, checked: true, detail: `view ${read.view} input and return types match` });
    }
  }

  const resolved = resolveKeelTezosLiveReads(reads, ids);
  const values: Record<string, KeelTezosLiveValue> = {};
  for (const read of resolved) {
    if (read.kind === "big_map") {
      const answer = await json<unknown>(fetchImpl, `${rpc}/chains/main/blocks/${block}/context/big_maps/${read.bigMapId}/${read.scriptExpr}/normalized`, { method: "POST", body: { unparsing_mode: "Readable" } });
      values[read.name] = answer.body === undefined ? read.absent : decoder(read.type, answer.body, maxItems);
    } else {
      const answer = await json<{ data?: unknown }>(fetchImpl, `${rpc}/chains/main/blocks/${block}/helpers/scripts/run_script_view`, {
        method: "POST",
        body: { contract: read.contract, view: read.view, input: read.input, chain_id: network, unparsing_mode: "Readable" },
      });
      if (answer.body === undefined) throw new Error(`${read.name}: run_script_view is not served by ${rpc}.`);
      values[read.name] = decoder(read.type, answer.body.data, maxItems);
    }
  }
  return { network, snapshot: { level, ...(blockHash === undefined ? {} : { blockHash }), values }, reads: resolved, typeChecks };
}

/** Check an offline snapshot: every value must round-trip through its declared type exactly. */
export function assertKeelTezosLiveSnapshot(reads: readonly KeelTezosLiveResolvedRead[], snapshot: KeelTezosLiveSnapshot, maxItems: number = DEFAULT_MAX_ITEMS): void {
  if (snapshot === null || typeof snapshot !== "object") throw new TypeError("snapshot must be an object.");
  if (!Number.isSafeInteger(snapshot.level) || snapshot.level < 0) throw new TypeError("snapshot.level must be the block level the values were read at.");
  if (snapshot.blockHash !== undefined && !BLOCK_HASH.test(snapshot.blockHash)) throw new TypeError("snapshot.blockHash must be a block hash.");
  const names = new Set(reads.map((read) => read.name));
  for (const key of Object.keys(snapshot.values ?? {})) if (!names.has(key)) throw new TypeError(`snapshot.values.${key} is not a declared read.`);
  for (const read of reads) {
    if (!Object.hasOwn(snapshot.values ?? {}, read.name)) throw new TypeError(`snapshot.values.${read.name} is missing.`);
    const value = snapshot.values[read.name] as KeelTezosLiveValue;
    if (read.kind === "big_map" && JSON.stringify(value) === JSON.stringify(read.absent)) continue;
    const back = decoder(read.type, keelTezosLiveMichelineValue(read.type, value, "readable", `snapshot.values.${read.name}`), maxItems);
    if (JSON.stringify(back) !== JSON.stringify(value)) throw new TypeError(`snapshot.values.${read.name} is not in canonical form for its type (expected ${JSON.stringify(back)}).`);
  }
}

/* ------------------------------------------------------------------------ */
/* The fragment                                                              */
/* ------------------------------------------------------------------------ */

export interface KeelTezosLiveStateFragmentOptions {
  readonly network: string;
  readonly reads: readonly KeelTezosLiveResolvedRead[];
  readonly snapshot: KeelTezosLiveSnapshot;
  /** Public Tezos RPC bases tried in order at view time (HTTPS). Teia's documented CSP allows *.tzkt.io and mainnet.smartpy.io. */
  readonly rpcUrls: readonly string[];
  /** Optional TzKT API bases, used for big_map reads when every RPC fails. */
  readonly tzktUrls?: readonly string[];
  /** Global the fragment defines. Default KEEL_TEZOS_LIVE. */
  readonly globalName?: string;
  readonly moduleId?: string;
  /** Start one live read as soon as the document runs (default true). */
  readonly autoRefresh?: boolean;
  /** Poll interval; 0 (default) means read once. At least 30 s when set. */
  readonly refreshIntervalMs?: number;
  /** Per-request timeout. Default 8 s. */
  readonly timeoutMs?: number;
  readonly maxItems?: number;
  /** Test harnesses only: accept loopback HTTP endpoints. A published token must use HTTPS. */
  readonly allowLoopbackEndpoints?: boolean;
}

export interface KeelTezosLiveStateFragment {
  readonly moduleId: string;
  readonly phase: "data";
  readonly weight: number;
  readonly source: string;
  readonly digest: string;
  readonly byteLength: number;
  readonly globalName: string;
}

function scriptSafeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</gu, "\\u003c").replace(/>/gu, "\\u003e").replace(/\u2028/gu, "\\u2028").replace(/\u2029/gu, "\\u2029");
}

const RUNTIME_SOURCE = String.raw`
const FZ=v=>{if(v&&typeof v==="object"&&!Object.isFrozen(v)){for(const x of Object.values(v))FZ(x);Object.freeze(v);}return v;};
const snapshot=FZ({level:C.s.level,blockHash:C.s.blockHash||null,values:C.s.values});
const listeners=new Set();
let state=FZ({source:"snapshot",level:snapshot.level,blockHash:snapshot.blockHash,endpoint:null,checkedAt:null,status:"snapshot",reads:FZ(Object.fromEntries(C.q.map(q=>[q.name,"snapshot"]))),errors:[],values:snapshot.values});
const send=(url,body)=>{const ctl=typeof AbortController==="function"?new AbortController():null;const timer=ctl?setTimeout(()=>ctl.abort(),C.t):null;
const init={credentials:"omit",cache:"no-store",referrerPolicy:"no-referrer",headers:{accept:"application/json"}};if(ctl)init.signal=ctl.signal;
if(body!==undefined){init.method="POST";init.headers["content-type"]="application/json";init.body=JSON.stringify(body);}
return fetch(url,init).then(async r=>{if(r.status===404||r.status===204)return undefined;if(!r.ok)throw new Error("HTTP "+r.status);return r.json();}).finally(()=>{if(timer)clearTimeout(timer);});};
const level=v=>{if(!Number.isSafeInteger(v)||v<0)throw new Error("no block level");if(v<snapshot.level)throw new Error("endpoint is behind the snapshot");return v;};
async function fromRpc(base){
const chain=await send(base+"/chains/main/chain_id");if(chain!==C.n)throw new Error("wrong chain");
const head=await send(base+"/chains/main/blocks/head/header");const lv=level(head&&head.level);
const block=head&&typeof head.hash==="string"&&/^B[1-9A-HJ-NP-Za-km-z]{50}$/.test(head.hash)?head.hash:"head";
const values={},reads={};
for(const q of C.q){
if(q.kind==="big_map"){const v=await send(base+"/chains/main/blocks/"+block+"/context/big_maps/"+q.id+"/"+q.expr+"/normalized",{unparsing_mode:"Readable"});values[q.name]=v===undefined?q.absent:D(q.type,v,C.m);}
else{const v=await send(base+"/chains/main/blocks/"+block+"/helpers/scripts/run_script_view",{contract:q.contract,view:q.view,input:q.input,chain_id:C.n,unparsing_mode:"Readable"});if(v===undefined)throw new Error("run_script_view unavailable");values[q.name]=D(q.type,v.data,C.m);}
reads[q.name]="live";}
return {source:"rpc",endpoint:base,level:lv,blockHash:block==="head"?null:block,values,reads};}
async function fromTzkt(base){
const head=await send(base+"/v1/head");if(!head||head.chainId!==C.n)throw new Error("wrong chain");const lv=level(head.level);
const values={},reads={};let any=false;
for(const q of C.q){
if(q.kind!=="big_map"){reads[q.name]="kept";continue;}
const v=await send(base+"/v1/bigmaps/"+q.id+"/keys/"+q.expr+"?micheline=2");
values[q.name]=v===undefined||v.active===false?q.absent:D(q.type,v.value,C.m);reads[q.name]="live";any=true;}
if(!any)throw new Error("nothing TzKT can read");
return {source:"tzkt",endpoint:base,level:lv,blockHash:null,values,reads};}
const notify=()=>{for(const fn of listeners){try{fn(state);}catch(e){}}
try{if(typeof globalThis.dispatchEvent==="function"&&typeof CustomEvent==="function")globalThis.dispatchEvent(new CustomEvent("keel-tezos-live",{detail:state}));}catch(e){}};
let inflight=null;
function refresh(){
if(inflight)return inflight;
if(typeof fetch!=="function"){state=FZ({...state,status:"offline",checkedAt:Date.now(),errors:["fetch is unavailable"]});notify();return Promise.resolve(state);}
inflight=(async()=>{const errors=[];let got=null;
for(const base of C.r){try{got=await fromRpc(base);break;}catch(e){errors.push(base+": "+(e&&e.message||e));}}
if(!got)for(const base of C.z){try{got=await fromTzkt(base);break;}catch(e){errors.push(base+": "+(e&&e.message||e));}}
if(got){const reads={...state.reads};for(const q of C.q)reads[q.name]=got.reads[q.name]||"kept";
state=FZ({source:got.source,level:got.level,blockHash:got.blockHash,endpoint:got.endpoint,checkedAt:Date.now(),status:"live",reads,errors,values:{...state.values,...got.values}});}
else state=FZ({...state,status:"offline",checkedAt:Date.now(),errors});
notify();return state;})().catch(e=>{state=FZ({...state,status:"offline",checkedAt:Date.now(),errors:[String(e&&e.message||e)]});notify();return state;}).finally(()=>{inflight=null;});
return inflight;}
const api=Object.freeze({protocol:C.p,network:C.n,snapshot,get state(){return state;},get values(){return state.values;},refresh,
subscribe(fn){if(typeof fn!=="function")throw new TypeError("subscribe needs a function");listeners.add(fn);return()=>listeners.delete(fn);},
reads:FZ(C.q.map(q=>({name:q.name,kind:q.kind})))});
Object.defineProperty(globalThis,C.g,{value:api,enumerable:true,writable:false,configurable:false});
if(C.a&&typeof fetch==="function")setTimeout(()=>{refresh();},0);
if(C.i>0&&typeof setInterval==="function")setInterval(()=>{refresh();},C.i);
`;

/** Build the data-phase fragment: the frozen snapshot, published synchronously, plus the guarded live reader. */
export function buildKeelTezosLiveStateFragment(options: KeelTezosLiveStateFragmentOptions): KeelTezosLiveStateFragment {
  assertNoSecrets(options);
  const network = assertNetwork(options.network);
  const globalName = options.globalName ?? "KEEL_TEZOS_LIVE";
  if (!IDENTIFIER.test(globalName)) throw new TypeError(`"${globalName}" is not a usable global name.`);
  const allowLoopback = options.allowLoopbackEndpoints === true;
  if (!Array.isArray(options.rpcUrls) || options.rpcUrls.length === 0 || options.rpcUrls.length > MAX_ENDPOINTS) throw new TypeError(`rpcUrls must list 1..${MAX_ENDPOINTS} public RPC bases.`);
  const rpcUrls = options.rpcUrls.map((url, index) => endpoint(url, `rpcUrls[${index}]`, allowLoopback));
  const tzktUrls = (options.tzktUrls ?? []).map((url, index) => endpoint(url, `tzktUrls[${index}]`, allowLoopback));
  if (tzktUrls.length > MAX_ENDPOINTS) throw new TypeError(`tzktUrls lists at most ${MAX_ENDPOINTS} bases.`);
  const interval = options.refreshIntervalMs ?? 0;
  if (!Number.isSafeInteger(interval) || (interval !== 0 && interval < 30_000)) throw new RangeError("refreshIntervalMs must be 0 or at least 30000.");
  const timeout = options.timeoutMs ?? 8_000;
  if (!Number.isSafeInteger(timeout) || timeout < 500 || timeout > 60_000) throw new RangeError("timeoutMs must be 500..60000.");
  const maxItems = options.maxItems ?? DEFAULT_MAX_ITEMS;
  if (!Number.isSafeInteger(maxItems) || maxItems < 1 || maxItems > 65_536) throw new RangeError("maxItems must be 1..65536.");
  if (!Array.isArray(options.reads) || options.reads.length === 0 || options.reads.length > MAX_READS) throw new TypeError(`reads must list 1..${MAX_READS} resolved reads.`);
  for (const read of options.reads) {
    assertLiveType(read.type);
    if (read.kind === "big_map" && (!/^expr[1-9A-HJ-NP-Za-km-z]{50}$/u.test(read.scriptExpr) || !/^[0-9]+$/u.test(read.bigMapId))) throw new TypeError(`${read.name} is not a resolved big_map read.`);
  }
  assertKeelTezosLiveSnapshot(options.reads, options.snapshot, maxItems);
  const config = {
    p: KEEL_TEZOS_LIVE_STATE_PROTOCOL, n: network, g: globalName, r: rpcUrls, z: tzktUrls,
    t: timeout, i: interval, a: options.autoRefresh ?? true, m: maxItems,
    q: options.reads.map((read) => read.kind === "big_map"
      ? { name: read.name, kind: read.kind, id: read.bigMapId, expr: read.scriptExpr, type: read.type, absent: read.absent }
      : { name: read.name, kind: read.kind, contract: read.contract, view: read.view, input: read.input, type: read.type }),
    s: { level: options.snapshot.level, blockHash: options.snapshot.blockHash ?? null, values: options.snapshot.values },
  };
  const source = `(()=>{"use strict";const C=${scriptSafeJson(config)};${DECODER_SOURCE}${RUNTIME_SOURCE}})()`;
  const bytes = new TextEncoder().encode(source);
  return {
    moduleId: options.moduleId ?? "keel/tezos-live-state",
    phase: "data",
    weight: -32_767,
    source,
    digest: hexOf(sha256(bytes)),
    byteLength: bytes.byteLength,
    globalName,
  };
}

/**
 * Run the fragment the way a document would, with an injected (or absent)
 * fetch, and hand back the published API. With no fetch it proves the
 * offline/blocked-sandbox path: the snapshot is there synchronously.
 */
export function runKeelTezosLiveStateFragment(fragment: { readonly source: string; readonly globalName?: string }, environment: { readonly fetch?: typeof fetch } = {}) {
  const globalName = fragment.globalName ?? "KEEL_TEZOS_LIVE";
  if (!IDENTIFIER.test(globalName)) throw new TypeError("Invalid global name.");
  const scope: Record<string, unknown> = Object.create(null);
  const run = new Function("globalThis", "fetch", "setTimeout", "setInterval", "clearTimeout", "AbortController", "TextDecoder", "CustomEvent",
    `"use strict";${fragment.source};return globalThis[${JSON.stringify(globalName)}];`);
  const published = run(scope, environment.fetch, setTimeout, () => 0, clearTimeout, AbortController, TextDecoder, undefined) as {
    readonly protocol: string; readonly network: string;
    readonly snapshot: KeelTezosLiveSnapshot;
    readonly state: { readonly source: string; readonly status: string; readonly level: number; readonly values: Record<string, KeelTezosLiveValue>; readonly reads: Record<string, string>; readonly errors: readonly string[]; readonly endpoint: string | null };
    readonly values: Record<string, KeelTezosLiveValue>;
    refresh(): Promise<unknown>;
    subscribe(fn: (state: unknown) => void): () => void;
  } | undefined;
  if (!published || published.protocol !== KEEL_TEZOS_LIVE_STATE_PROTOCOL) throw new Error("keel-tezos-live: the fragment published nothing.");
  if (!Object.isFrozen(published) || !Object.isFrozen(published.snapshot)) throw new Error("keel-tezos-live: the published snapshot is not frozen.");
  return published;
}

export interface KeelTezosLiveStatePrepareInput extends Omit<KeelTezosLiveStateFragmentOptions, "reads" | "snapshot"> {
  readonly reads: readonly KeelTezosLiveRead[];
  /** Read the snapshot here at publish time (loopback allowed: an Octez mockup or sandbox). */
  readonly rpcUrl?: string;
  /** Or supply it (offline): values in canonical form, every big_map read with bigMapId. */
  readonly snapshot?: KeelTezosLiveSnapshot;
  readonly block?: string;
  readonly checkTypes?: boolean;
  readonly fetchImpl?: typeof fetch;
}

/**
 * Prepare the opt-in live-state module for one token: read (or accept) the
 * snapshot, build the fragment, execute it offline, and check that what it
 * publishes is exactly the snapshot. Read-only; nothing is signed or written.
 */
export async function prepareKeelTezosLiveState(input: KeelTezosLiveStatePrepareInput) {
  assertNoSecrets({ ...input, fetchImpl: undefined });
  const network = assertNetwork(input.network);
  if ((input.rpcUrl === undefined) === (input.snapshot === undefined)) throw new TypeError("Give exactly one of rpcUrl (read the snapshot now) or snapshot (offline).");
  let reads: readonly KeelTezosLiveResolvedRead[];
  let snapshot: KeelTezosLiveSnapshot;
  let typeChecks: KeelTezosLiveStateLayer["typeChecks"] = [];
  if (input.rpcUrl !== undefined) {
    const layer = await readKeelTezosLiveState({
      network, rpcUrl: input.rpcUrl, reads: input.reads,
      ...(input.block === undefined ? {} : { block: input.block }),
      ...(input.checkTypes === undefined ? {} : { checkTypes: input.checkTypes }),
      ...(input.maxItems === undefined ? {} : { maxItems: input.maxItems }),
      ...(input.fetchImpl === undefined ? {} : { fetchImpl: input.fetchImpl }),
    });
    reads = layer.reads; snapshot = layer.snapshot; typeChecks = layer.typeChecks;
  } else {
    reads = resolveKeelTezosLiveReads(input.reads);
    snapshot = input.snapshot as KeelTezosLiveSnapshot;
    typeChecks = reads.map((read) => ({ name: read.name, checked: false, detail: "offline snapshot: declared types not compared with the contract" }));
  }
  const fragment = buildKeelTezosLiveStateFragment({
    network, reads, snapshot, rpcUrls: input.rpcUrls,
    ...(input.tzktUrls === undefined ? {} : { tzktUrls: input.tzktUrls }),
    ...(input.globalName === undefined ? {} : { globalName: input.globalName }),
    ...(input.moduleId === undefined ? {} : { moduleId: input.moduleId }),
    ...(input.autoRefresh === undefined ? {} : { autoRefresh: input.autoRefresh }),
    ...(input.refreshIntervalMs === undefined ? {} : { refreshIntervalMs: input.refreshIntervalMs }),
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    ...(input.maxItems === undefined ? {} : { maxItems: input.maxItems }),
    ...(input.allowLoopbackEndpoints === undefined ? {} : { allowLoopbackEndpoints: input.allowLoopbackEndpoints }),
  });
  const offline = runKeelTezosLiveStateFragment(fragment);
  if (JSON.stringify(offline.values) !== JSON.stringify(snapshot.values) || offline.state.source !== "snapshot") throw new Error("keel-tezos-live: the offline fragment does not publish the snapshot.");
  return {
    schema: "keel.tezos-live-state@1" as const,
    protocol: KEEL_TEZOS_LIVE_STATE_PROTOCOL,
    network,
    reads,
    snapshot,
    typeChecks,
    fragment,
    scriptTag: `<script>${fragment.source}</script>`,
    endpoints: { rpc: input.rpcUrls, tzkt: input.tzktUrls ?? [] },
    usage: `The fragment is phase "data": put it before any module that reads ${fragment.globalName}. ${fragment.globalName}.values is the snapshot synchronously and the live values after a successful read; subscribe(fn) or the "keel-tezos-live" event reports each read; state.status is snapshot | live | offline.`,
    caveats: [
      "Marketplace thumbnails, displayUri and attributes come from the stored token_metadata and do not change; only the token's HTML shows live state.",
      "objkt documents that external requests from interactive tokens are blocked; Teia documents a connect-src allowlist that includes *.tzkt.io and mainnet.smartpy.io. Order rpcUrls accordingly. When the network is blocked the snapshot is what renders.",
      "A live value is accepted only from an endpoint that names the same chain, is not behind the snapshot level and decodes to the declared type; RPC answers are not proofs.",
    ],
    signing: "not-performed" as const,
    submission: "not-performed" as const,
  };
}
