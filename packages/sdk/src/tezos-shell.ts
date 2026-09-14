import { bytesToHex, concatHex, keccak256, sha256, stringToHex, type Hex } from "viem";

export type TezosMicheline = { readonly bytes: string } | { readonly int: string } | { readonly string: string } | { readonly prim: string; readonly args: readonly TezosMicheline[] };
export type KeelTezosShellAction = "register" | "update" | "freeze";
export interface KeelTezosShellPrepareInput {
  readonly network: string;
  readonly builder: string;
  readonly creator: string;
  readonly action: KeelTezosShellAction;
  readonly salt?: Hex;
  readonly shellId?: Hex;
  readonly prefixObjectId?: Hex;
  readonly suffixObjectId?: Hex;
  readonly metadataObjectId?: Hex;
  readonly payloadMode?: "sandboxed-html" | "gzip-base64" | "pre-encoded-graph";
}
const ZERO = `0x${"00".repeat(32)}`;
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const MODES = { "sandboxed-html": 0, "gzip-base64": 1, "pre-encoded-graph": 2 } as const;
const PREFIXES = { KT1: [2, 90, 121], tz1: [6, 161, 159], tz2: [6, 161, 161], tz3: [6, 161, 164], tz4: [6, 161, 166], Net: [87, 82, 0] } as const;

function base58Check(value: string, prefix: keyof typeof PREFIXES, size: number): Uint8Array {
  if (typeof value !== "string" || !value.startsWith(prefix) || value.length > 64) throw new TypeError(`Invalid Tezos ${prefix} value.`);
  let n = 0n;
  for (const character of value) {
    const digit = ALPHABET.indexOf(character);
    if (digit < 0) throw new TypeError("Invalid Tezos Base58 alphabet.");
    n = n * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (n > 0n) { bytes.unshift(Number(n & 255n)); n >>= 8n; }
  for (const character of value) { if (character !== "1") break; bytes.unshift(0); }
  const decoded = Uint8Array.from(bytes);
  const head = PREFIXES[prefix];
  if (decoded.length !== head.length + size + 4 || head.some((byte, i) => decoded[i] !== byte)) throw new TypeError("Invalid Tezos Base58 prefix or length.");
  const body = decoded.slice(0, -4);
  const checksum = sha256(sha256(bytesToHex(body))).slice(2, 10);
  if (bytesToHex(decoded.slice(-4)).slice(2) !== checksum) throw new TypeError("Invalid Tezos Base58 checksum.");
  return decoded.slice(head.length, -4);
}

function addressBytes(value: string, contractOnly = false): Hex {
  const prefix = value.slice(0, 3) as keyof typeof PREFIXES;
  if (contractOnly && prefix !== "KT1") throw new TypeError("The builder must be an originated KT1 contract.");
  if (!["KT1", "tz1", "tz2", "tz3", "tz4"].includes(prefix)) throw new TypeError("Invalid Tezos address.");
  const payload = bytesToHex(base58Check(value, prefix, 20));
  return prefix === "KT1" ? concatHex(["0x01", payload, "0x00"]) : concatHex([`0x000${Number(prefix.slice(2)) - 1}`, payload]);
}
function bytes32(value: unknown, label: string, allowZero = false): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/u.test(value) || (!allowZero && value.toLowerCase() === ZERO)) throw new TypeError(`${label} must be a nonzero bytes32 value.`);
  return value.toLowerCase() as Hex;
}
function packedBytes(value: Hex): Hex {
  return concatHex(["0x0a", `0x${((value.length - 2) / 2).toString(16).padStart(8, "0")}`, value]);
}
const pair = (left: TezosMicheline, right: TezosMicheline): TezosMicheline => ({ prim: "Pair", args: [left, right] });
const binary = (value: Hex): TezosMicheline => ({ bytes: value.slice(2) });

/** Native PACK of (domain, (creator address, salt)), matching the SmartPy view. */
export function keelTezosCreatorShellId(creator: string, salt: Hex): Hex {
  const domain = keccak256(stringToHex("keel.shell.creator.v1"));
  return keccak256(concatHex(["0x050707", packedBytes(domain), "0x0707", packedBytes(addressBytes(creator)), packedBytes(bytes32(salt, "salt", true))]));
}

/** Explicit Tezos transaction parameters. No signing, RPC, origination, or submission. */
export function prepareKeelTezosShell(input: KeelTezosShellPrepareInput) {
  if (!input || typeof input !== "object") throw new TypeError("Tezos shell input must be an object.");
  const allowed = new Set(["network", "builder", "creator", "action", "salt", "shellId", "prefixObjectId", "suffixObjectId", "metadataObjectId", "payloadMode"]);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new TypeError(`Unsupported Tezos shell field: ${key}`);
  base58Check(input.network, "Net", 4);
  addressBytes(input.builder, true);
  addressBytes(input.creator);
  if (!["register", "update", "freeze"].includes(input.action)) throw new TypeError("Invalid shell action.");
  if (input.action !== "register" && input.salt !== undefined) throw new TypeError("Only registration accepts salt.");
  if (input.action === "register" && input.shellId !== undefined) throw new TypeError("Registration derives shellId from creator and salt.");
  const shellId = input.action === "register" ? keelTezosCreatorShellId(input.creator, bytes32(input.salt, "salt", true)) : bytes32(input.shellId, "shellId");
  let value: TezosMicheline;
  if (input.action === "freeze") {
    for (const key of ["prefixObjectId", "suffixObjectId", "metadataObjectId", "payloadMode"] as const) if (input[key] !== undefined) throw new TypeError("Freeze does not accept shell content.");
    value = binary(shellId);
  } else {
    const mode = input.payloadMode ?? "sandboxed-html";
    if (!Object.hasOwn(MODES, mode)) throw new TypeError("Invalid shell payload mode.");
    const record = pair(binary(bytes32(input.prefixObjectId, "prefixObjectId")), pair(binary(bytes32(input.suffixObjectId, "suffixObjectId")), pair({ int: String(MODES[mode]) }, binary(bytes32(input.metadataObjectId, "metadataObjectId")))));
    value = pair(binary(input.action === "register" ? bytes32(input.salt, "salt", true) : shellId), record);
  }
  const entrypoint = `${input.action}_shell` as const;
  return {
    schema: "keel.tezos-shell-prepare@1" as const, family: "tezos" as const,
    network: input.network, expectedSender: input.creator, shellId,
    status: "review-only" as const, chainReady: false as const,
    transaction: { kind: "transaction" as const, amount: "0" as const, destination: input.builder, parameters: { entrypoint, value } },
    signing: "not-performed" as const, submission: "not-performed" as const,
    caveat: "Selected-chain shell objects and registry state still require receipt-backed read-back before a wallet request.",
  };
}
