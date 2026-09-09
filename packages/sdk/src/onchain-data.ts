import { createHash } from "node:crypto";

import {
  decodeKeelDataPack,
  encodeKeelDataPack,
  type KeelDataValue,
  type KeelOrderedModule,
} from "./data-layer.js";

/**
 * ON-CHAIN DATA AS SCRIPT VARIABLES.
 *
 * The problem this exists for: almost every KEEL artwork that reads a chain
 * ends up hand-rolling the same three things -- a call to fetch the values, a
 * bespoke way to get them into the document, and a prayer that they are there
 * before the render code looks. The third is the one that bites, because when
 * it fails it fails as `undefined` deep inside a draw call rather than as an
 * error anyone can read.
 *
 * So this module is the whole path, once: DECLARE the reads, FETCH them from
 * any JSON-RPC (a local anvil is the point), FREEZE them into a data pack, and
 * emit an init fragment that publishes them as globals BEFORE any other module
 * runs. `orderKeelModules` already guarantees that ordering -- the fragment
 * declares `phase: "data"`, and data always precedes runtime, which always
 * precedes render.
 *
 * What a creator writes afterwards is just `KEEL.data.health`.
 */

/** A single call to make. Static return types only -- see `decodeWord`. */
export interface KeelOnchainRead {
  /** The variable name the artwork reaches for. Must be a valid identifier. */
  readonly name: string;
  readonly address: string;
  /** Solidity signature, e.g. `"bornBodyOf(uint256)"`. */
  readonly signature: string;
  readonly args?: readonly (string | number | bigint)[];
  /**
   * The return types, in order. Static types only: `uint<n>`, `int<n>`, `bool`,
   * `address`, `bytes32`. A dynamic return is refused rather than mis-decoded.
   */
  readonly returns: readonly string[];
  /** Take one member out of a multi-value return instead of the whole tuple. */
  readonly pick?: number;
}

export interface KeelOnchainDataOptions {
  readonly rpcUrl: string;
  readonly reads: readonly KeelOnchainRead[];
  /** Block to read at. Defaults to `latest`; pin it for a reproducible build. */
  readonly blockTag?: string;
  /** Injected for tests and for runtimes with their own transport. */
  readonly fetchImpl?: typeof fetch;
}

export interface KeelOnchainDataLayer {
  readonly chainId: number;
  readonly blockNumber: number;
  readonly values: Readonly<Record<string, KeelDataValue>>;
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;
const STATIC_TYPE = /^(?:bool|address|bytes32|u?int(?:8|16|24|32|40|48|56|64|72|80|88|96|128|160|192|224|256)?)$/u;

function keccakSelector(signature: string): string {
  /* Why a local keccak and not a dependency: this package deliberately has no
     chain library, so that an artwork can use it without pulling one in. The
     selector is the only hashing it needs. */
  return `0x${keccak256(new TextEncoder().encode(signature)).slice(0, 8)}`;
}

/* Minimal keccak-256. Present because the whole point of this module is that it
   works with nothing installed; it is used once per read, at build time. */
const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const ROT = [
  [0, 36, 3, 41, 18], [1, 44, 10, 45, 2], [62, 6, 43, 15, 61], [28, 55, 25, 21, 56], [27, 20, 39, 8, 14],
];
const MASK = (1n << 64n) - 1n;
const rotl = (x: bigint, n: number): bigint => ((x << BigInt(n)) | (x >> BigInt(64 - n))) & MASK;

function keccakF(state: bigint[]): void {
  for (let round = 0; round < 24; round += 1) {
    const c = [0, 1, 2, 3, 4].map((x) => state[x]! ^ state[x + 5]! ^ state[x + 10]! ^ state[x + 15]! ^ state[x + 20]!);
    for (let x = 0; x < 5; x += 1) {
      const d = c[(x + 4) % 5]! ^ rotl(c[(x + 1) % 5]!, 1);
      for (let y = 0; y < 5; y += 1) state[x + 5 * y] = state[x + 5 * y]! ^ d;
    }
    const b: bigint[] = new Array(25).fill(0n);
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) b[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(state[x + 5 * y]!, ROT[x]![y]!);
    }
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        state[x + 5 * y] = b[x + 5 * y]! ^ (~b[((x + 1) % 5) + 5 * y]! & b[((x + 2) % 5) + 5 * y]! & MASK);
      }
    }
    state[0] = state[0]! ^ RC[round]!;
  }
}

export function keccak256(input: Uint8Array): string {
  const rate = 136;
  const padded = new Uint8Array(Math.ceil((input.length + 1) / rate) * rate);
  padded.set(input);
  padded[input.length] = 0x01;
  padded[padded.length - 1] = (padded[padded.length - 1] as number) | 0x80;
  const state: bigint[] = new Array(25).fill(0n);
  for (let offset = 0; offset < padded.length; offset += rate) {
    for (let i = 0; i < rate / 8; i += 1) {
      let lane = 0n;
      for (let b = 7; b >= 0; b -= 1) lane = (lane << 8n) | BigInt(padded[offset + i * 8 + b] as number);
      state[i] = state[i]! ^ lane;
    }
    keccakF(state);
  }
  let out = "";
  for (let i = 0; i < 4; i += 1) {
    let lane = state[i]!;
    for (let b = 0; b < 8; b += 1) {
      out += (lane & 0xffn).toString(16).padStart(2, "0");
      lane >>= 8n;
    }
  }
  return out;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/* Why hand-rolled and not `Buffer`: this module is meant to be the default one
   for on-chain-to-script, so it must not assume a Node runtime. The alphabet is
   base64url so the payload survives a data URI without escaping. */
function base64url(bytes: Uint8Array): string {
  let out = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] as number;
    const b = bytes[index + 1];
    const c = bytes[index + 2];
    out += B64[a >> 2];
    out += B64[((a & 3) << 4) | ((b ?? 0) >> 4)];
    if (b === undefined) break;
    out += B64[((b & 15) << 2) | ((c ?? 0) >> 6)];
    if (c === undefined) break;
    out += B64[c & 63];
  }
  return out;
}

function encodeArg(value: string | number | bigint): string {
  if (typeof value === "string" && value.startsWith("0x")) return value.slice(2).toLowerCase().padStart(64, "0");
  return BigInt(value).toString(16).padStart(64, "0");
}

/**
 * Decode one 32-byte word. Static types only, and that is deliberate: a dynamic
 * return needs an offset table, and silently mis-reading one would hand an
 * artwork a number that looks plausible and is wrong. Refuse instead.
 */
function decodeWord(type: string, word: string): KeelDataValue {
  if (!STATIC_TYPE.test(type)) {
    throw new TypeError(`On-chain reads support static return types only; got "${type}".`);
  }
  if (type === "bool") return BigInt(`0x${word}`) !== 0n;
  if (type === "address") return `0x${word.slice(24)}`;
  if (type === "bytes32") return `0x${word}`;
  const raw = BigInt(`0x${word}`);
  const bits = Number(/\d+/u.exec(type)?.[0] ?? 256);
  const signed = type.startsWith("int") && raw >= 1n << BigInt(bits - 1);
  const value = signed ? raw - (1n << BigInt(bits)) : raw;
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    /* Why a string and not a bigint: the pack is canonical CBOR of
       JSON-compatible values, and a number that does not survive the round trip
       must not pretend to. */
    return value.toString();
  }
  return Number(value);
}

/** Read every declared value from a chain. Works against a local anvil. */
export async function readOnchainData(options: KeelOnchainDataOptions): Promise<KeelOnchainDataLayer> {
  const call = options.fetchImpl ?? fetch;
  const blockTag = options.blockTag ?? "latest";
  let id = 0;
  const rpc = async (method: string, params: readonly unknown[]): Promise<string> => {
    const response = await call(options.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: (id += 1), method, params }),
    });
    if (!response.ok) throw new Error(`${method} failed: HTTP ${response.status}`);
    const body = (await response.json()) as { result?: string; error?: { message?: string } };
    if (body.error) throw new Error(`${method} failed: ${body.error.message ?? "unknown RPC error"}`);
    if (typeof body.result !== "string") throw new Error(`${method} returned no result.`);
    return body.result;
  };

  const chainId = Number(BigInt(await rpc("eth_chainId", [])));
  const blockNumber = Number(BigInt(await rpc("eth_blockNumber", [])));

  const values: Record<string, KeelDataValue> = {};
  for (const read of options.reads) {
    if (!IDENTIFIER.test(read.name)) throw new TypeError(`"${read.name}" is not a usable variable name.`);
    if (Object.hasOwn(values, read.name)) throw new TypeError(`Duplicate on-chain variable "${read.name}".`);
    const data = `${keccakSelector(read.signature)}${(read.args ?? []).map(encodeArg).join("")}`;
    const raw = (await rpc("eth_call", [{ to: read.address, data }, blockTag])).slice(2);
    if (raw.length < read.returns.length * 64) {
      throw new Error(`${read.name}: ${read.signature} returned ${raw.length / 2} bytes, too few for ${read.returns.length} values.`);
    }
    const decoded = read.returns.map((type, index) => decodeWord(type, raw.slice(index * 64, index * 64 + 64)));
    values[read.name] = read.pick === undefined
      ? (decoded.length === 1 ? decoded[0]! : decoded)
      : (decoded[read.pick] ?? null);
  }
  return { chainId, blockNumber, values: Object.freeze(values) };
}

/**
 * The init script, and the reason this module exists.
 *
 * Why the pack is CBOR WITHOUT gzip here: init has to be SYNCHRONOUS. The
 * document's other modules run immediately after this fragment, and the only
 * gzip a browser gives us is `DecompressionStream`, which is async -- so a
 * gzipped payload would publish its globals a microtask too late and every
 * consumer would read `undefined`. That is exactly the failure this module is
 * meant to make impossible, so the trade is made here rather than left to a
 * caller to get wrong. Storage-side packs may still be gzipped;
 * `encodeKeelDataPack` takes the flag.
 */
export function buildOnchainDataFragment(
  layer: KeelOnchainDataLayer,
  options: { readonly moduleId?: string; readonly globalName?: string } = {},
): KeelOrderedModule & { readonly source: string; readonly digest: string; readonly byteLength: number } {
  const globalName = options.globalName ?? "KEEL";
  if (!IDENTIFIER.test(globalName)) throw new TypeError(`"${globalName}" is not a usable global name.`);
  const payload: KeelDataValue = {
    chainId: layer.chainId,
    blockNumber: layer.blockNumber,
    values: { ...layer.values } as Record<string, KeelDataValue>,
  };
  const pack = encodeKeelDataPack(payload, "none");
  const base64 = base64url(pack);
  /* Why three statements: chaining off `createHash` types as `unknown` under
     this package's node shim. `raster-strips.ts` splits it the same way. */
  const hash = createHash("sha256");
  hash.update(pack);
  const digest = hash.digest("hex");
  const source = `(()=>{const P="${base64}";`
    + `const b=atob(P.replace(/-/g,"+").replace(/_/g,"/"));`
    + `const u=new Uint8Array(b.length);for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i);`
    + `let o=5;const d=new TextDecoder();`
    + `const L=(a)=>{if(a<24)return a;const n=a===24?1:a===25?2:a===26?4:8;let v=0;`
    + `for(let i=0;i<n;i++)v=v*256+u[o++];return v;};`
    + `const R=()=>{const h=u[o++],m=h>>5,a=h&31;`
    + `if(m===7)return a===20?false:a===21?true:null;`
    + `if(m===0)return L(a);if(m===1)return -1-L(a);`
    + `if(m===3){const n=L(a),s=d.decode(u.subarray(o,o+n));o+=n;return s;}`
    + `if(m===4){const n=L(a),r=[];for(let i=0;i<n;i++)r.push(R());return r;}`
    + `if(m===5){const n=L(a),r={};for(let i=0;i<n;i++){const k=R();r[k]=R();}return r;}`
    + `throw new Error("keel-onchain-data: bad pack");};`
    + `const P0=R();const data=Object.freeze(P0.values||{});`
    + `const api=Object.freeze({protocol:"keel-onchain-data@1",chainId:P0.chainId,blockNumber:P0.blockNumber,data,digest:"${digest}"});`
    /* Why defineProperty and not assignment: the whole contract of this layer is
       that the values are there and cannot be replaced by a later module. */
    + `Object.defineProperty(globalThis,"${globalName}",{value:api,enumerable:true,writable:false,configurable:false});`
    + `Object.defineProperty(globalThis,"__KEEL_ONCHAIN_DATA__",{value:api,enumerable:true,writable:false,configurable:false});`
    + `})()`;
  return {
    moduleId: options.moduleId ?? "keel/onchain-data",
    /* Data always precedes runtime, which always precedes render. This is what
       makes "it is there before anything looks" a property rather than a hope. */
    phase: "data",
    weight: -32_768,
    source,
    digest,
    byteLength: pack.byteLength,
  };
}

/**
 * Run the fragment the way a document would and hand back what it published.
 *
 * Why it ships beside the builder rather than living in a test: "we made sure
 * init works" has to be something a creator can run against their own build, in
 * the sandbox or in CI, not something we assert once on our machine.
 */
export function verifyOnchainDataFragment(
  fragment: { readonly source: string },
  globalName = "KEEL",
): { readonly chainId: number; readonly blockNumber: number; readonly data: Record<string, KeelDataValue> } {
  const scope: Record<string, unknown> = Object.create(null);
  const run = new Function("globalThis", `"use strict";${fragment.source};return globalThis["${globalName}"];`);
  const published = run(scope) as { chainId: number; blockNumber: number; data: Record<string, KeelDataValue> } | undefined;
  if (!published) throw new Error("keel-onchain-data: the fragment published nothing.");
  if (Object.isFrozen(published) !== true) throw new Error("keel-onchain-data: the published object is not frozen.");
  return published;
}

/** Round-trip check: what the chain said is what the document will read. */
export function assertOnchainDataRoundTrip(layer: KeelOnchainDataLayer, fragment: { readonly source: string }): void {
  const published = verifyOnchainDataFragment(fragment);
  if (published.chainId !== layer.chainId || published.blockNumber !== layer.blockNumber) {
    throw new Error("keel-onchain-data: the fragment does not carry the block it was built from.");
  }
  for (const [name, value] of Object.entries(layer.values)) {
    const seen = JSON.stringify(published.data[name]);
    if (seen !== JSON.stringify(value)) {
      throw new Error(`keel-onchain-data: "${name}" reads ${seen} in the document and ${JSON.stringify(value)} on chain.`);
    }
  }
}

export { decodeKeelDataPack };
