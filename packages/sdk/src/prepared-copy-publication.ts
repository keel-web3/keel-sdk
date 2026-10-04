import { assertKeelFreshPayloadCarriage, inspectKeelInlinePayloadCarriage } from "./inline-transport-audit.js";
import { createIntegrity, type Integrity } from "@keel/protocol";
import { assertKeelInlineImageBytes } from "./collector-policy.js";
import { assertKeelInlineNoExternalDependencies, decodeKeelInlineGraphFragment } from "./inline-viewer-graph.js";
import { KEEL_INLINE_MAX_TOKEN_URI_BYTES, keelInlineReadGasLimit } from "./presentation.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const profiles = {
  "application/vnd.keel.token-uri-raw-percent-fragment": "KeelRawTokenURIBuilder",
  "application/vnd.keel.token-uri-percent-fragment": "KeelPercentTokenURIBuilder",
  "application/vnd.keel.token-uri-base64-fragment": "KeelHarnessBuilder",
  "application/vnd.keel.token-uri-base64-body-fragment": "KeelHarnessBuilder",
} as const;

/** The existing fragment's media type selects its COPY builder; there is no
 * encoder/composer fallback for incompatible binary or a different transport. */
export function keelPreparedCopyBuilder(mediaType: string): string {
  if (!Object.hasOwn(profiles, mediaType)) throw new TypeError("Publication requires a supported prepared COPY fragment, not raw binary or a custom transport.");
  return profiles[mediaType as keyof typeof profiles];
}

export function isKeelPreparedCopyMediaType(mediaType: string): boolean {
  return Object.hasOwn(profiles, mediaType);
}

export interface KeelPreparedCopyReadInput {
  readonly chainId: number;
  readonly store: string;
  readonly mediaType: string;
  readonly graphBytes: Uint8Array;
  readonly graphIntegrity: Integrity;
  /** Complete URI built by the matching canonical preparation, including the
   * image and live envelope. Never substitute compressed asset size. */
  readonly expectedTokenURI: string;
  readonly returnedTokenURI: string;
  readonly callGasLimit: bigint;
  readonly blockGasLimit: bigint;
}

function dataURI(value: unknown, media: string): Uint8Array {
  if (typeof value !== "string" || !value.startsWith(`data:${media}`)) throw new TypeError(`Prepared COPY needs a self-contained data:${media} URI.`);
  const comma = value.indexOf(",");
  if (comma < 5) throw new TypeError("Incomplete prepared data URI.");
  const header = value.slice(0, comma), payload = value.slice(comma + 1);
  if (/;base64$/u.test(header)) {
    if (payload.length === 0 || payload.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(payload)) throw new TypeError("Noncanonical prepared Base64 URI.");
    const bytes = new Uint8Array(Buffer.from(payload, "base64"));
    if (Buffer.from(bytes).toString("base64") !== payload) throw new TypeError("Noncanonical prepared Base64 URI.");
    return bytes;
  }
  return encoder.encode(decodeURIComponent(payload));
}

function auditCreatorItems(html: Uint8Array): void {
  const text = decoder.decode(html), marker = "globalThis.__KEEL_ITEMS__=";
  const start = text.indexOf(marker);
  if (start < 0) {
    assertKeelInlineNoExternalDependencies(html, "Prepared COPY creator HTML");
    return;
  }
  // The registered shell contains explanatory protocol names. Audit its exact
  // data-only resource array, including packed creator bytes, not its own UI
  // code. Parse balanced JSON without evaluating any creator JavaScript.
  const first = start + marker.length;
  if (text[first] !== "[") throw new TypeError("Malformed canonical resource array.");
  let depth = 0, quoted = false, escaped = false;
  for (let at = first; at < text.length; at++) {
    const c = text[at];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") {
      if (--depth === 0) {
        const json = text.slice(first, at + 1);
        if (!Array.isArray(JSON.parse(json))) throw new TypeError("Invalid canonical resource array.");
        assertKeelInlineNoExternalDependencies(encoder.encode(json), "Prepared COPY creator resources");
        return;
      }
    }
  }
  throw new TypeError("Incomplete canonical resource array.");
}

/** Verifies a complete caller-supplied read against the exact prepared graph.
 * This is a fail-closed byte/route check, not authentication of an RPC call,
 * registration, wallet authority, a receipt, or visual/browser behavior. */
export async function assertKeelPreparedCopyRead(input: KeelPreparedCopyReadInput) {
  // Snapshot caller-owned values before the first async digest.
  const graphBytes = new Uint8Array(input.graphBytes);
  const graphIntegrity = { ...input.graphIntegrity };
  const { chainId, store, mediaType, expectedTokenURI, returnedTokenURI, callGasLimit, blockGasLimit } = input;
  const requiredBuilder = keelPreparedCopyBuilder(mediaType);
  if (!Number.isSafeInteger(chainId) || chainId < 1 || !/^0x[0-9a-f]{40}$/iu.test(store) || /^0x0{40}$/iu.test(store)) throw new TypeError("Prepared COPY needs an exact selected-chain store.");
  if (typeof callGasLimit !== "bigint" || typeof blockGasLimit !== "bigint" || callGasLimit <= 0n || callGasLimit > keelInlineReadGasLimit(blockGasLimit)) throw new RangeError("The complete collection read exceeds the selected-chain public RPC gas boundary.");
  const actual = await createIntegrity(graphBytes);
  if (actual.algorithm !== graphIntegrity.algorithm || actual.digest.toLowerCase() !== graphIntegrity.digest?.toLowerCase() || actual.byteLength !== graphIntegrity.byteLength) throw new TypeError("Prepared COPY source bytes do not match the publish plan commitment.");
  if (typeof expectedTokenURI !== "string" || typeof returnedTokenURI !== "string" || expectedTokenURI !== returnedTokenURI) throw new TypeError("The complete returned tokenURI differs from canonical preparation. Extra wrapping, transcoding, hexadecimal transport and runtime encoding are not COPY reuse.");
  const returnedBytes = encoder.encode(returnedTokenURI);
  if (returnedBytes.byteLength > KEEL_INLINE_MAX_TOKEN_URI_BYTES) throw new RangeError("The complete returned tokenURI exceeds the public-reader byte limit.");
  const graphText = decoder.decode(graphBytes);
  const at = expectedTokenURI.indexOf(graphText);
  if (graphText.length === 0 || at < 0 || expectedTokenURI.indexOf(graphText, at + graphText.length) >= 0) throw new TypeError("The complete URI must copy the exact prepared graph once, without another encoding layer.");
  const raw = mediaType === "application/vnd.keel.token-uri-raw-percent-fragment";
  if (raw && !expectedTokenURI.startsWith("data:application/json;charset=utf-8,")) throw new TypeError("Compact COPY cannot add a complete-metadata Base64 layer.");
  if (!raw && !expectedTokenURI.startsWith("data:application/json;base64,")) throw new TypeError("Preserve the existing prepared Base64/percent envelope.");
  const metadata = JSON.parse(decoder.decode(dataURI(expectedTokenURI, "application/json"))) as Record<string, unknown>;
  if (raw && (typeof metadata.animation_url !== "string" || !metadata.animation_url.startsWith("data:text/html;charset=utf-8,"))) throw new TypeError("Compact COPY cannot add a complete-HTML Base64 layer.");
  const html = dataURI(metadata.animation_url, "text/html");
  const sourceHTML = decodeKeelInlineGraphFragment(graphBytes, mediaType);
  if (!decoder.decode(html).includes(decoder.decode(sourceHTML))) throw new TypeError("Returned animation does not contain the exact decoded prepared graph.");
  auditCreatorItems(html);
  assertKeelFreshPayloadCarriage(html);
  const payloadCarriage = inspectKeelInlinePayloadCarriage(html);
  if (typeof metadata.image !== "string" || !metadata.image.startsWith("data:image/")) throw new TypeError("Prepared COPY needs the self-contained original collector image.");
  const imageHeader = metadata.image.slice(5, metadata.image.indexOf(",")).split(";", 1)[0]!;
  assertKeelInlineImageBytes(dataURI(metadata.image, imageHeader), imageHeader);
  return Object.freeze({
    schema: "keel-prepared-copy-read-check@1" as const,
    policy: "prepared-copy" as const, chainId, store: store.toLowerCase(), mediaType,
    requiredBuilder, readOperation: "copy-prepared-fragments" as const,
    graphIntegrity: actual, tokenURIIntegrity: await createIntegrity(returnedBytes),
    completeTokenURIBytes: returnedBytes.byteLength, payloadCarriage,
    callGasLimit: callGasLimit.toString(), blockGasLimit: blockGasLimit.toString(),
    selectedChainReadAuthenticated: false as const,
    caveat: "Caller-supplied read bytes and gas cap only; authenticate the selected-chain call, registration, receipts and authority separately.",
  });
}

export type KeelPreparedCopyReadCheck = Awaited<ReturnType<typeof assertKeelPreparedCopyRead>>;
export type KeelPreparedCopyPublishEvidence = Pick<KeelPreparedCopyReadInput,
  "graphBytes" | "expectedTokenURI" | "returnedTokenURI" | "callGasLimit" | "blockGasLimit">;
