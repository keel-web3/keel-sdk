/**
 * One relay: the collection forwards the builder.
 *
 * EVM memory is quadratic. Every call frame that RETURNs N bytes must hold them in its own memory, so each frame
 * pays at least keelTokenURIForwardFloorGas(N) (~4.5M gas at 1.5MB). A Solidity relay that does
 * `return IRenderer(x).tokenURI(id)` decodes the child's string into memory and re-encodes it: ~3-4x the floor per
 * hop (measured: 16.1M renderer alone, 63.9M through a companion, 117.1M through the collection, one 1.55MB token).
 *
 * The standard route has exactly two big-byte frames: the registered KEEL builder, and the collection that called it
 * directly and forwarded its returndata unchanged with KeelRawStringReturn.forward. Live per-token state comes from a
 * small envelope module that returns KB, never the URI. These helpers check a callTracer tree and Solidity sources
 * against that route. Pure functions: no RPC, no signing.
 */
import {
  KEEL_STANDARD_COLLECTION_TOKEN_URI_READ_GAS,
  KEEL_TOKEN_URI_DIRECT_BUILDER_REMEDY,
  KEEL_TOKEN_URI_MAX_BIG_BYTE_FRAMES,
  keelTokenURIForwardFloorGas,
} from "@keel/protocol";

/** Below this complete return size every route is cheap; the route check reports not-applicable. */
export const KEEL_TOKEN_URI_ROUTE_MIN_BYTES = 32_768;
/** A frame is "big" when its output is at least this share of the final returned length. */
export const KEEL_TOKEN_URI_BIG_FRAME_SHARE = 0.9;
/** A forwarding frame may spend this multiple of the floor (plus fixed slack) on its own; more is a copying relay. */
export const KEEL_TOKEN_URI_RELAY_FLOOR_MULTIPLE = 2;
export const KEEL_TOKEN_URI_RELAY_SLACK_GAS = 100_000;
/** One-sentence form for tool descriptions, so an agent sees the rule whichever publication tool it opens first. */
export const KEEL_TOKEN_URI_ROUTE_RULE_SHORT = "TOKENURI RULE (one frame: the collection assembles the URI): a tokenURI read through the actual collection must cost <= 20M gas; use KeelComposed721, which copies the prepared Hold fragments into its own memory and returns them (a 966KB live token reads for 2.65M gas, a 1.65MB NOCTURNES token for 10.6M); live state comes from a small IKeelTokenURIComposer (KB); at most the builder and the collection may hold the bytes, the builder forwarded raw with KeelRawStringReturn.forward; never relay the URI through companions, renderers, clones or proxies (each Solidity relay hop costs ~3-4x the ~4.5M-gas memory floor of a 1.5MB return).";
/** The agent-facing rule, short and imperative, repeated by the MCP instructions, tool descriptions and skill. */
export const KEEL_TOKEN_URI_ROUTE_RULE = `ONE FRAME: THE COLLECTION ASSEMBLES THE URI. A complete tokenURI read through the actual collection must cost <= 20,000,000 gas. EVM memory is quadratic: every frame that returns N bytes pays ~3w + w^2/512 gas (w = N/32), ~4.5M per frame at 1.5MB, and a Solidity relay (return IRenderer(x).tokenURI(id)) decodes and re-encodes for ~3-4x that per hop (one 1.55MB token: 16.1M at the renderer, 63.9M via a companion, 117.1M via the collection). The standard is one frame: KeelComposed721 copies the prepared Hold fragments into its own memory and returns them (measured: 966KB for 2.65M gas; the 1.55MB NOCTURNES token for 10.55M, against 117.1M through the relay chain). At most two frames may ever hold the bytes: the registered KEEL builder (preEncodedTokenURIFragmentsWithImage / preparedTokenURI), forwarded raw, and the collection. ${KEEL_TOKEN_URI_DIRECT_BUILDER_REMEDY} No EIP-1167 clone or proxy in front of a large tokenURI. Most existing onchain art chains collection -> companion -> renderer; do not copy it.`;

/** The geth/reth callTracer frame shape (debug_traceCall with { tracer: "callTracer" }). */
export interface KeelCallTracerFrame {
  readonly type?: string;
  readonly from?: string;
  readonly to?: string;
  readonly gas?: string;
  readonly gasUsed?: string;
  readonly input?: string;
  readonly output?: string;
  readonly error?: string;
  readonly calls?: readonly KeelCallTracerFrame[];
}

export type KeelTokenURIRouteFindingCode = "token-uri-relay-chain" | "token-uri-copying-relay" | "token-uri-proxy-frame";

export interface KeelTokenURIRouteFinding {
  readonly code: KeelTokenURIRouteFindingCode;
  readonly detail: string;
  readonly address?: string;
}

export interface KeelTokenURIReadHop {
  readonly depth: number;
  readonly type: string;
  readonly address: string;
  readonly gasUsed: number;
  /** gasUsed minus every child frame's gasUsed: what this frame spent itself. */
  readonly selfGasUsed: number;
  readonly outputBytes: number;
  readonly forwardFloorGas: number;
  readonly role: "collection" | "proxy" | "relay" | "builder";
}

export interface KeelTokenURIReadRoute {
  readonly schema: "keel-token-uri-read-route@1";
  readonly status: "pass" | "fail" | "not-applicable" | "unverified";
  readonly finalReturnBytes?: number;
  readonly bigFrameThresholdBytes?: number;
  readonly totalGasUsed?: number;
  readonly standardReadGas: number;
  readonly maximumBigByteFrames: number;
  readonly bigByteFrames?: number;
  readonly hops: readonly KeelTokenURIReadHop[];
  readonly findings: readonly KeelTokenURIRouteFinding[];
  readonly note?: string;
  readonly remedy: string;
}

const outputBytes = (frame: KeelCallTracerFrame): number | undefined =>
  typeof frame.output === "string" && /^0x(?:[0-9a-fA-F]{2})*$/u.test(frame.output) ? (frame.output.length - 2) / 2 : undefined;
const gasOf = (frame: KeelCallTracerFrame): number | undefined => {
  if (typeof frame.gasUsed !== "string" || !/^0x[0-9a-fA-F]{1,16}$/u.test(frame.gasUsed)) return undefined;
  const value = Number(BigInt(frame.gasUsed));
  return Number.isSafeInteger(value) ? value : undefined;
};
/** Precompiles (identity 0x04 and friends) copy bytes for a frame; they are not a hop. */
const isPrecompile = (address: string | undefined): boolean =>
  typeof address === "string" && /^0x[0-9a-fA-F]{40}$/u.test(address) && BigInt(address) < 0x10000n;
const isDelegate = (frame: KeelCallTracerFrame): boolean => /^(?:DELEGATECALL|CALLCODE)$/iu.test(frame.type ?? "");

/**
 * Analyze one tokenURI read's callTracer tree: list the frames that held >= 90% of the final bytes and fail when
 * there are more than two (builder + collection), when a frame forwarding big bytes spent more than twice the
 * forward floor itself (a decode/re-encode relay), or when a proxy/delegate frame carried them.
 */
export function analyzeKeelTokenURIReadRoute(trace: unknown): KeelTokenURIReadRoute {
  const base = {
    schema: "keel-token-uri-read-route@1" as const,
    standardReadGas: Number(KEEL_STANDARD_COLLECTION_TOKEN_URI_READ_GAS),
    maximumBigByteFrames: KEEL_TOKEN_URI_MAX_BIG_BYTE_FRAMES,
    remedy: KEEL_TOKEN_URI_DIRECT_BUILDER_REMEDY,
  };
  if (trace === null || typeof trace !== "object" || Array.isArray(trace)) {
    return { ...base, status: "unverified", hops: [], findings: [], note: "No callTracer tree was available, so the frames carrying the tokenURI bytes are unknown." };
  }
  const top = trace as KeelCallTracerFrame;
  const finalBytes = outputBytes(top);
  const totalGasUsed = gasOf(top);
  if (finalBytes === undefined || totalGasUsed === undefined) {
    return { ...base, status: "unverified", hops: [], findings: [], note: "The callTracer tree has no output/gasUsed for the top frame (the node may strip outputs), so the route is unknown." };
  }
  if (finalBytes < KEEL_TOKEN_URI_ROUTE_MIN_BYTES) {
    return { ...base, status: "not-applicable", finalReturnBytes: finalBytes, totalGasUsed, hops: [], findings: [], note: `The complete return is ${finalBytes} bytes, below the ${KEEL_TOKEN_URI_ROUTE_MIN_BYTES}-byte route threshold.` };
  }
  const threshold = Math.ceil(finalBytes * KEEL_TOKEN_URI_BIG_FRAME_SHARE);
  const isBig = (frame: KeelCallTracerFrame) => !frame.error && !isPrecompile(frame.to) && (outputBytes(frame) ?? 0) >= threshold;
  const hops: KeelTokenURIReadHop[] = [];
  const findings: KeelTokenURIRouteFinding[] = [];
  let incomplete = false;
  const visit = (frame: KeelCallTracerFrame, depth: number): void => {
    const children = frame.calls ?? [];
    if (depth === 0 || isBig(frame)) {
      const gasUsed = gasOf(frame);
      const childGas = children.reduce((sum, child) => sum + (gasOf(child) ?? 0), 0);
      if (gasUsed === undefined || children.some((child) => gasOf(child) === undefined)) incomplete = true;
      const bytes = outputBytes(frame) ?? 0;
      const bigChild = children.some(isBig);
      const role: KeelTokenURIReadHop["role"] = depth === 0 ? "collection" : isDelegate(frame) ? "proxy" : bigChild ? "relay" : "builder";
      const hop: KeelTokenURIReadHop = {
        depth, type: String(frame.type ?? "CALL").toUpperCase(), address: String(frame.to ?? "").toLowerCase(),
        gasUsed: gasUsed ?? 0, selfGasUsed: Math.max(0, (gasUsed ?? 0) - childGas), outputBytes: bytes, forwardFloorGas: keelTokenURIForwardFloorGas(bytes), role,
      };
      hops.push(hop);
      if (role === "proxy") findings.push({ code: "token-uri-proxy-frame", address: hop.address, detail: `${hop.type} frame ${hop.address} (depth ${depth}) holds ${bytes} tokenURI bytes: a proxy/clone in front of the URI is one more frame paying the ${hop.forwardFloorGas}-gas memory floor.` });
      const allowed = KEEL_TOKEN_URI_RELAY_FLOOR_MULTIPLE * hop.forwardFloorGas + KEEL_TOKEN_URI_RELAY_SLACK_GAS;
      if (bigChild && hop.selfGasUsed > allowed) {
        findings.push({ code: "token-uri-copying-relay", address: hop.address, detail: `Frame ${hop.address} (depth ${depth}) spent ${hop.selfGasUsed} gas itself returning ${bytes} bytes it got from a child; a raw forward costs about ${hop.forwardFloorGas}. It decodes and re-encodes the URI (allowed ${allowed}).` });
      }
    }
    for (const child of children) visit(child, depth + 1);
  };
  visit(top, 0);
  const bigByteFrames = hops.length;
  if (bigByteFrames > KEEL_TOKEN_URI_MAX_BIG_BYTE_FRAMES) {
    findings.unshift({ code: "token-uri-relay-chain", detail: `${bigByteFrames} frames hold >= ${threshold} of the ${finalBytes} tokenURI bytes (${hops.map((hop) => `${hop.role} ${hop.address}`).join(" -> ")}); the standard is ${KEEL_TOKEN_URI_MAX_BIG_BYTE_FRAMES}: builder + collection.` });
  }
  return {
    ...base,
    status: findings.length ? "fail" : incomplete ? "unverified" : "pass",
    finalReturnBytes: finalBytes,
    bigFrameThresholdBytes: threshold,
    totalGasUsed,
    bigByteFrames,
    hops,
    findings,
    ...(incomplete && !findings.length ? { note: "Some frames carry no gasUsed, so the relay check is incomplete." } : {}),
  };
}

// ─── Solidity source lint ─────────────────────────────────────────────────────────────────────────────────────

export interface KeelTokenURIRelaySourceFinding {
  readonly code: "token-uri-source-relay" | "token-uri-source-decode-relay";
  readonly path: string;
  readonly line: number;
  readonly function: string;
  readonly snippet: string;
  readonly detail: string;
  readonly remedy: string;
}

/** Blank comments and string literals (keeping newlines and offsets) so patterns match code only. */
function codeOnly(source: string): string {
  let out = "";
  for (let index = 0; index < source.length;) {
    const char = source[index]!, next = source[index + 1];
    if (char === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") { out += " "; index += 1; }
    } else if (char === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      const stop = end < 0 ? source.length : end + 2;
      for (; index < stop; index += 1) out += source[index] === "\n" ? "\n" : " ";
    } else if (char === "\"" || char === "'") {
      out += char; index += 1;
      while (index < source.length && source[index] !== char && source[index] !== "\n") {
        if (source[index] === "\\") { out += " "; index += 1; }
        out += " "; index += 1;
      }
      if (index < source.length) { out += source[index]; index += 1; }
    } else { out += char; index += 1; }
  }
  return out;
}

/** Functions whose body produces a URI: tokenURI, uri, _tokenURI, renderTokenURI, contractURI. */
const URI_FUNCTION = /^_?(?:[A-Za-z0-9_]*TokenURI|tokenURI|uri|contractURI)$/u;
/** An external call that returns the URI string into this frame's memory. `.selector`/encodeCall references stay legal. */
const RELAY_CALL = /(?<!\bsuper)\.(tokenURI|uri|preparedTokenURI|preEncodedTokenURI[A-Za-z0-9_]*|renderTokenURI)\s*\(/gu;
const DECODE_RELAY = /abi\.decode\s*\([^;]*?\(\s*string\s*\)\s*\)/gu;

/**
 * Flag tokenURI/uri functions that pull the URI from another contract into memory and return it (a decode/re-encode
 * relay), including `abi.decode(data, (string))` of a staticcall result. The standard route forwards the builder's
 * returndata with KeelRawStringReturn.forward and builds calldata with abi.encodeCall/selector, which this allows.
 */
export function lintKeelTokenURIRelaySource(sources: readonly { readonly path: string; readonly content: string }[]): readonly KeelTokenURIRelaySourceFinding[] {
  const findings: KeelTokenURIRelaySourceFinding[] = [];
  for (const source of sources) {
    const code = codeOnly(source.content);
    const lineAt = (offset: number) => code.slice(0, offset).split("\n").length;
    const snippetAt = (offset: number) => (source.content.split("\n")[lineAt(offset) - 1] ?? "").trim().slice(0, 200);
    for (const header of code.matchAll(/\bfunction\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gu)) {
      const name = header[1]!;
      if (!URI_FUNCTION.test(name)) continue;
      // Skip the signature to the body's "{" (an interface declaration ends with ";").
      let cursor = header.index! + header[0].length, depth = 1;
      for (; cursor < code.length && depth > 0; cursor += 1) { if (code[cursor] === "(") depth += 1; else if (code[cursor] === ")") depth -= 1; }
      const open = code.indexOf("{", cursor), semi = code.indexOf(";", cursor);
      if (open < 0 || (semi >= 0 && semi < open)) continue;
      let end = open + 1;
      for (depth = 1; end < code.length && depth > 0; end += 1) { if (code[end] === "{") depth += 1; else if (code[end] === "}") depth -= 1; }
      const body = code.slice(open, end);
      for (const match of body.matchAll(RELAY_CALL)) {
        const offset = open + match.index!;
        findings.push({ code: "token-uri-source-relay", path: source.path, line: lineAt(offset), function: name, snippet: snippetAt(offset),
          detail: `${name}() calls .${match[1]}(...) on another contract and returns the result: the URI is decoded into this frame's memory and re-encoded, ~3-4x the memory floor per hop (1.55MB measured 16.1M at the renderer, 117.1M through two relays).`,
          remedy: KEEL_TOKEN_URI_DIRECT_BUILDER_REMEDY });
      }
      for (const match of body.matchAll(DECODE_RELAY)) {
        const offset = open + match.index!;
        findings.push({ code: "token-uri-source-decode-relay", path: source.path, line: lineAt(offset), function: name, snippet: snippetAt(offset),
          detail: `${name}() abi.decodes a string returned by another contract and re-encodes it; forward the returndata raw instead.`,
          remedy: KEEL_TOKEN_URI_DIRECT_BUILDER_REMEDY });
      }
    }
  }
  return findings;
}
