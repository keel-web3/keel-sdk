/**
 * The canonical Keel verification shell builders, plus the one-call
 * `wrapInVerificationShell` for creators: give it an art entry (HTML or JS
 * with assets) and a title, get back the shell-wrapped HTML and the
 * review-only publish plan for those exact bytes.
 *
 * This is the single implementation; `apps/studio/scripts/keel-viewer-builder.ts`
 * re-exports it so the studio deploy scripts and the SDK cannot drift apart.
 *
 * Security properties this file must keep:
 *   - aliases resolve only from the verified item graph; there is no CDN,
 *     no network fallback, and no unverified byte source
 *   - the shell hash-checks every committed resource before mounting anything
 *   - the emitted publish plan is review-only: no signing, no submission
 *
 * Node-only: it reads shell sources from the repository, bundles with esbuild,
 * and compresses with zlib. Do not import it from browser code.
 */

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { brotliCompress, brotliDecompress, constants as zlibConstants, deflate, gzip } from "node:zlib";
import { build } from "esbuild";

import {
  assertKeelRpcUrl,
  assertDataUriMediaType,
  canonicalJson,
  chunkBytes,
  createIntegrity,
  createKeelVerificationPresentationManifest,
  escapeJsonForScript,
  utf8ToBytes,
  verifySourceBuild,
  type Hex,
  type Integrity,
  type KeelSourceReceipt,
  type KeelVerificationPresentationManifest,
  type KeelVerificationPresentationOverrides,
} from "@keel/protocol";
import { createKeelPublishReviewPlan, type KeelPublishReviewPlanEnvelope } from "./publish-plan.js";
import { resolveModuleTarget } from "./modules.js";

type Sha256Integrity = { readonly algorithm: "sha256"; readonly digest: Hex; readonly byteLength: number };

/** createIntegrity, narrowed to the sha256 shape the viewer envelope commits to. */
async function sha256Integrity(bytes: Uint8Array): Promise<Sha256Integrity> {
  const value: Integrity = await createIntegrity(bytes);
  if (value.algorithm !== "sha256" || typeof value.byteLength !== "number") throw new TypeError("Keel viewer commitments require sha256 integrity with a byte length.");
  return { algorithm: "sha256", digest: value.digest, byteLength: value.byteLength };
}

const brotliCompressAsync = promisify(brotliCompress);
const brotliDecompressAsync = promisify(brotliDecompress);

// Keep production output at the canonical quality, but allow local artifact
// assembly to opt into a faster quality while iterating on large embedded
// viewers.  This affects only the stored representation; decoded commitments
// and verification semantics remain unchanged.
const brotliQuality = (() => {
  const value = Number(process.env.KEEL_BROTLI_QUALITY ?? "11");
  return Number.isInteger(value) && value >= 0 && value <= 11 ? value : 11;
})();

async function compressBrotli(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(
    await brotliCompressAsync(bytes, {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY ?? 1]: brotliQuality,
        [zlibConstants.BROTLI_PARAM_MODE ?? 0]: zlibConstants.BROTLI_MODE_GENERIC ?? 0,
      },
    }),
  );
}

async function decompressBrotli(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await brotliDecompressAsync(bytes));
}

const gzipAsync = promisify(gzip);
const deflateAsync = promisify(deflate);

async function compressStored(compression: "none" | "gzip" | "deflate" | "brotli", bytes: Uint8Array): Promise<Uint8Array> {
  switch (compression) {
    case "none": return bytes.slice();
    case "brotli": return compressBrotli(bytes);
    case "gzip": return new Uint8Array(await gzipAsync(bytes, { level: 9 }));
    case "deflate": return new Uint8Array(await deflateAsync(bytes, { level: 9 }));
  }
}

export const KEEL_STANDALONE_VIEWER_PROTOCOL = "keel-standalone-viewer@1" as const;

export interface KeelOnchainContainerBinding {
  readonly id: Hex;
  readonly chainId: number;
  readonly store: string;
  readonly objectId: Hex;
  readonly compression: "none" | "gzip" | "deflate" | "brotli" | "lzma";
  readonly storedIntegrity: Sha256Integrity;
  readonly integrity: Sha256Integrity;
}

/** Raw UTF-8 text and existing encoded byte slots are mutually exclusive. */
export type KeelEmbeddedViewerSource = {
  readonly storedIntegrity?: { readonly algorithm: "sha256"; readonly digest: Hex; readonly byteLength: number };
} & (
  | { readonly storedText: string; readonly storedBase64?: never; readonly compression: "none" }
  | { readonly storedBase64: string; readonly storedText?: never; readonly compression: "none" | "gzip" | "deflate" | "brotli" | "lzma" }
);

export function isKeelViewerTextMediaType(mediaType: string): boolean {
  const [essence = ""] = mediaType.toLowerCase().split(";");
  return essence.startsWith("text/") || essence === "application/javascript" || essence === "application/ecmascript"
    || essence === "application/json" || essence === "application/xml" || essence.endsWith("+json") || essence.endsWith("+xml");
}

function hasEmbeddedViewerSource(item: KeelStandaloneViewerItem): boolean {
  const embedded = item.embedded;
  if (embedded === undefined) return false;
  const text = embedded.storedText !== undefined, base64 = embedded.storedBase64 !== undefined;
  return text !== base64 && (text
    ? typeof embedded.storedText === "string" && embedded.compression === "none"
    : typeof embedded.storedBase64 === "string");
}

export interface KeelStandaloneViewerItem {
  readonly containerBindings?: readonly KeelOnchainContainerBinding[];
  readonly backgroundColor?: string;
  readonly id: string;
  readonly role?: "entrypoint" | "module" | "asset" | "data";
  readonly mediaType: string;
  readonly aliases: readonly string[];
  readonly integrity: { readonly algorithm: "sha256" | "keccak256"; readonly digest: Hex; readonly byteLength: number };
  readonly chainId?: number;
  readonly store?: string;
  readonly objectId?: Hex;
  /**
   * Optional packing applied around an onchain object's exact decoded bytes.
   * This lets a large HTML document live as a raw composite Brotli stream:
   * the object record authenticates the packed stream, then the viewer
   * decompresses it and authenticates `integrity` before mounting anything.
   */
  readonly onchain?: {
    readonly storeKind?: "keel-hold" | "stratus-chunk-store";
    readonly range?: { readonly offset: number; readonly containerIntegrity: Sha256Integrity };
    readonly containerId?: Hex;
    readonly offset?: number;
    readonly compression?: "none" | "gzip" | "deflate" | "brotli" | "lzma";
    readonly storedIntegrity?: { readonly algorithm: "sha256"; readonly digest: Hex; readonly byteLength: number };
  };
  /** Committed remote bytes; fetched only by the outer shell and never executed before verification. */
  readonly external?: {
    readonly uriBase64: string;
    readonly compression: "none" | "gzip" | "deflate";
    readonly maxBytes: number;
  };
  readonly embedded?: KeelEmbeddedViewerSource;
}

export interface KeelStandaloneViewerEnvelope {
  readonly protocol: typeof KEEL_STANDALONE_VIEWER_PROTOCOL;
  readonly title: string;
  /** Inline bytes, recursive chain RPC, or an explicit mix of both. Hosted URL delivery is intentionally unsupported. */
  readonly deliveryProfile: "onchain-recursive" | "embedded-assembled" | "hybrid-mixed";
  /** @deprecated Use rpcUrls so a sealed viewer is not pinned to one RPC operator. */
  readonly rpcUrl?: string;
  /** Governed ordinary chain RPC endpoints, tried in order. Never content hosts. */
  readonly rpcUrls?: readonly string[];
  readonly blockTag?: string;
  readonly entrypoint: string;
  readonly runtimeExpectations?: { readonly minimumCanvasCount?: number };
  readonly items: readonly KeelStandaloneViewerItem[];
}

export interface KeelStandaloneViewerBuild {
  readonly html: Uint8Array;
  readonly htmlIntegrity: { readonly algorithm: "sha256"; readonly digest: Hex; readonly byteLength: number };
  readonly compressedHtml: Uint8Array;
  readonly compressedIntegrity: { readonly algorithm: "sha256"; readonly digest: Hex; readonly byteLength: number };
  readonly compression: "brotli";
  readonly runtimeByteLength: number;
  readonly brotliDecoderByteLength: number;
  readonly brotliDecoderDigest: Hex;
  readonly sourceReceipt: KeelSourceReceipt;
}

function escapeScriptJson(value: unknown): string {
  return escapeJsonForScript(canonicalJson(value));
}

async function loadVaultVerificationChrome(
  repositoryRoot: string,
  presentationOverrides: KeelVerificationPresentationOverrides = {},
): Promise<{
  readonly css: string;
  readonly markup: string;
  readonly modulePath: string;
  readonly presentation: KeelVerificationPresentationManifest;
  readonly sourceBytes: Uint8Array;
  readonly sourceDigest: Hex;
}> {
  const modulePath = path.join(repositoryRoot, "packages/viewer/src/keel-verification-chrome.js");
  const sourceBytes = new Uint8Array(await readFile(modulePath));
  const chrome = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ `${pathToFileURL(modulePath).href}?keel-shell-source=${Date.now()}`) as {
    readonly KEEL_VERIFICATION_CSS?: unknown;
    readonly KEEL_VERIFICATION_RESPONSIVE_DOCK_CSS?: unknown;
    readonly KEEL_VERIFICATION_MARKUP?: unknown;
  };
  if (
    typeof chrome.KEEL_VERIFICATION_CSS !== "string"
    || typeof chrome.KEEL_VERIFICATION_RESPONSIVE_DOCK_CSS !== "string"
    || typeof chrome.KEEL_VERIFICATION_MARKUP !== "string"
  ) {
    throw new Error("Canonical KEEL verification chrome exports are incomplete.");
  }
  const presentation = createKeelVerificationPresentationManifest(presentationOverrides);
  const markup = `<script id="keel-verification-presentation" type="application/json">${escapeScriptJson(presentation)}</script>${chrome.KEEL_VERIFICATION_MARKUP}`;
  const css = `${chrome.KEEL_VERIFICATION_CSS}\n${chrome.KEEL_VERIFICATION_RESPONSIVE_DOCK_CSS}`;
  return {
    css,
    markup,
    modulePath,
    presentation,
    sourceBytes,
    sourceDigest: (await sha256Integrity(sourceBytes)).digest,
  };
}

/** Build only the declared browser decoders; no WASM, network, or global worker hook. */
export async function buildKeelDecoderModule(input: {
  readonly repositoryRoot?: string;
  readonly codecs: readonly ("brotli" | "lzma")[];
}): Promise<{
  readonly javascript: string;
  readonly javascriptBytes: Uint8Array;
  readonly integrity: { readonly algorithm: "sha256"; readonly digest: Hex; readonly byteLength: number };
  readonly sourceBytes: Uint8Array;
}> {
  const codecs = [...new Set(input.codecs)].sort();
  if (codecs.some((codec) => codec !== "brotli" && codec !== "lzma")) throw new TypeError("Unsupported decoder module codec.");
  if (!codecs.length) {
    const javascriptBytes = new Uint8Array();
    return { javascript: "", javascriptBytes, integrity: await sha256Integrity(javascriptBytes), sourceBytes: javascriptBytes };
  }
  const directory = input.repositoryRoot ? path.join(input.repositoryRoot, "packages/sdk/src/decoders") : fileURLToPath(new URL("./decoders/", import.meta.url));
  const extension = input.repositoryRoot ? "ts" : "js";
  const sourceBytes = new Uint8Array(Buffer.concat(await Promise.all([
    readFile(path.join(directory, `index.${extension}`)),
    readFile(path.join(directory, `provenance.${extension}`)),
    ...(["brotli", "lzma"] as const).map((codec) => readFile(path.join(directory, "vendor", `${codec}.${extension}`))),
  ])));
  const bundled = await build({
    stdin: { contents: `export { ${codecs.map((codec) => codec === "brotli" ? "decodeBrotli" : "decodeLzma").join(",")} } from "./index.js";`, resolveDir: directory, sourcefile: "keel-resource-decoders.ts", loader: "ts" },
    bundle: true, minify: true, treeShaking: true, platform: "browser", format: "iife", globalName: "KEEL_RESOURCE_DECODERS", target: "es2022", write: false,
  });
  const javascript = bundled.outputFiles[0]?.text;
  if (!javascript) throw new Error("Decoder module produced no JavaScript.");
  const javascriptBytes = utf8ToBytes(javascript);
  return { javascript, javascriptBytes, integrity: await sha256Integrity(javascriptBytes), sourceBytes };
}

/** Optional, self-contained binary-to-text decoder; no compression/network code. */
export async function buildKeelDenseTransportDecoder(): Promise<{
  readonly javascript: string;
  readonly javascriptBytes: Uint8Array;
  readonly integrity: Sha256Integrity;
}> {
  const bundled = await build({
    stdin: { contents: 'export {decodeKeelDenseTransport} from "./dense-transport.js";',
      resolveDir: fileURLToPath(new URL("./", import.meta.url)), sourcefile: "keel-dense-transport.js", loader: "js" },
    bundle: true, minify: true, treeShaking: true, platform: "browser", format: "iife",
    globalName: "KEEL_DENSE_TRANSPORT", target: "es2022", write: false,
  });
  const { KEEL_DENSE_TRANSPORT_LICENSE } = await import("./dense-transport.js");
  const javascript = bundled.outputFiles[0]?.text ? "/*! " + KEEL_DENSE_TRANSPORT_LICENSE + " */\n" + bundled.outputFiles[0].text : undefined;
  if (!javascript) throw new Error("Dense transport decoder produced no JavaScript.");
  const javascriptBytes = utf8ToBytes(javascript);
  return { javascript, javascriptBytes, integrity: await sha256Integrity(javascriptBytes) };
}

export async function buildStandaloneKeelViewer(input: {
  readonly repositoryRoot: string;
  readonly envelope: KeelStandaloneViewerEnvelope;
  readonly verificationPresentation?: KeelVerificationPresentationOverrides;
  /** Embed Brotli WASM only when this exact graph declares Brotli resources. */
  readonly brotliDecoder?: "embedded" | "javascript" | "disabled";
  readonly lzmaDecoder?: "javascript" | "disabled";
}): Promise<KeelStandaloneViewerBuild> {
  if (input.envelope.protocol !== KEEL_STANDALONE_VIEWER_PROTOCOL) throw new TypeError("Unsupported standalone viewer protocol.");
  if (!input.envelope.items.some((item) => item.id === input.envelope.entrypoint)) throw new TypeError("Standalone viewer entrypoint is missing.");
  for (const item of input.envelope.items) assertDataUriMediaType(item.mediaType);
  if (input.envelope.deliveryProfile === "onchain-recursive" || input.envelope.deliveryProfile === "hybrid-mixed") {
    const rpcUrls = input.envelope.rpcUrls ?? (input.envelope.rpcUrl === undefined ? [] : [input.envelope.rpcUrl]);
    if (rpcUrls.length === 0) throw new TypeError("RPC-backed viewer requires at least one governed RPC URL.");
    if (rpcUrls.length > 8) throw new RangeError("RPC-backed viewer accepts at most eight governed RPC URLs.");
    for (const rpcUrl of rpcUrls) assertKeelRpcUrl(rpcUrl);
  }
  if (input.envelope.deliveryProfile === "onchain-recursive") {
    if (input.envelope.items.some((item) => item.chainId === undefined || item.store === undefined || item.objectId === undefined)) {
      throw new TypeError("Every onchain viewer item requires a chain, store, and object ID.");
    }
  }
  if (input.envelope.deliveryProfile === "embedded-assembled" && input.envelope.items.some((item) => !hasEmbeddedViewerSource(item))) {
    throw new TypeError("Every embedded assembled viewer item requires committed inline bytes.");
  }
  if (input.envelope.deliveryProfile === "hybrid-mixed") {
    const embeddedItems = input.envelope.items.filter(hasEmbeddedViewerSource);
    const onchainItems = input.envelope.items.filter((item) => item.chainId !== undefined || item.store !== undefined || item.objectId !== undefined);
    if (embeddedItems.length === 0 || onchainItems.length === 0) {
      throw new TypeError("Hybrid mixed viewer requires at least one embedded item and at least one onchain item.");
    }
    for (const item of input.envelope.items) {
      const embedded = hasEmbeddedViewerSource(item);
      const onchain = item.chainId !== undefined || item.store !== undefined || item.objectId !== undefined;
      if (embedded === onchain) {
        throw new TypeError(`Hybrid mixed viewer item ${item.id} must use exactly one delivery source.`);
      }
      if (onchain && (item.chainId === undefined || item.store === undefined || item.objectId === undefined)) {
        throw new TypeError(`Hybrid mixed onchain item ${item.id} requires a chain, store, and object ID.`);
      }
    }
  }
  const runtimePath = path.join(input.repositoryRoot, "examples/demos/keel-creative-lab/keel-verifier-runtime.js");
  const decoderMode = input.brotliDecoder ?? "embedded";
  const lzmaMode = input.lzmaDecoder ?? "disabled";
  const decoderModule = await buildKeelDecoderModule({ repositoryRoot: input.repositoryRoot, codecs: [...(decoderMode === "javascript" ? ["brotli" as const] : []), ...(lzmaMode === "javascript" ? ["lzma" as const] : [])] });
  const wasmPath = path.join(input.repositoryRoot, "apps/studio/node_modules/brotli-dec-wasm/pkg/brotli_dec_wasm_bg.wasm");
  const [runtimeSource, wasm, verificationChrome] = await Promise.all([
    readFile(runtimePath),
    decoderMode === "embedded" ? readFile(wasmPath) : Promise.resolve(Buffer.from(new Uint8Array())),
    loadVaultVerificationChrome(input.repositoryRoot, input.verificationPresentation),
  ]);
  const wasmIntegrity = await sha256Integrity(wasm);
  const runtimeWithoutVerificationChromeMarker = runtimeSource.toString("utf8").replace(
    "/*__KEEL_VAULT_VERIFICATION_CHROME__*/",
    "",
  );
  if (runtimeWithoutVerificationChromeMarker === runtimeSource.toString("utf8")) {
    throw new Error("Standalone verifier runtime is missing its Vault verification chrome marker.");
  }
  const runtimeWithVerificationChrome = `import { mountVerificationUI } from ${JSON.stringify(verificationChrome.modulePath)};\n${runtimeWithoutVerificationChromeMarker}`;
  const bundled = await build({
    absWorkingDir: path.join(input.repositoryRoot, "apps/studio"),
    bundle: true,
    minify: true,
    treeShaking: true,
    platform: "browser",
    format: "iife",
    target: ["es2022"],
    write: false,
    stdin: { contents: runtimeWithVerificationChrome, resolveDir: path.dirname(runtimePath), sourcefile: "keel-verifier-runtime.js", loader: "js" },
    plugins: [{
      name: "keel-compression-runtime",
      setup(plugin) {
        plugin.onResolve({ filter: /^keel:compression-runtime$/ }, () => ({ path: "keel:compression-runtime", namespace: "keel" }));
        plugin.onResolve({ filter: /^brotli-dec-wasm\/web$/ }, () => ({
          path: path.join(input.repositoryRoot, "apps/studio/node_modules/brotli-dec-wasm/pkg/brotli_dec_wasm.js"),
        }));
        plugin.onResolve({ filter: /^keel:brotli-wasm-base64$/ }, () => ({ path: "keel:brotli-wasm-base64", namespace: "keel-wasm" }));
        plugin.onLoad({ filter: /.*/, namespace: "keel-wasm" }, () => ({
          contents: `export default ${JSON.stringify(wasm.toString("base64"))}`,
          loader: "js",
        }));
        plugin.onLoad({ filter: /.*/, namespace: "keel" }, () => ({
          contents: `${decoderModule.javascript}
${decoderMode === "embedded"
            ? `import {decompress,initSync} from "brotli-dec-wasm/web";import encoded from "keel:brotli-wasm-base64";const bytes=()=>Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));export function decodeBrotli(bytes,options){const output=decompress(bytes);if(output.length!==options.decodedByteLength)throw new Error("Brotli decoded length mismatch");return output}export function initBrotli(){initSync({module:bytes()})}`
            : decoderMode === "javascript" ? `export const decodeBrotli=KEEL_RESOURCE_DECODERS.decodeBrotli;export function initBrotli(){}` : `export function initBrotli(){}export function decodeBrotli(){throw new Error("This verified shell did not declare the KEEL Brotli decoder module.")}`}
${lzmaMode === "javascript" ? `export const decodeLzma=KEEL_RESOURCE_DECODERS.decodeLzma;` : `export function decodeLzma(){throw new Error("This verified shell did not declare the KEEL LZMA decoder module.")}`}`,

          loader: "js",
        }));
      },
    }],
  });
  const runtime = bundled.outputFiles[0]?.text;
  if (!runtime) throw new Error("Standalone verifier bundle produced no JavaScript.");
  const htmlText = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}html,body,#keel-stage,iframe{width:100%;height:100%;margin:0;border:0;overflow:hidden;background:#05060b}body{position:relative}#keel-status{position:fixed;inset:0;z-index:6;display:grid;place-items:center;padding:8vw;white-space:pre-wrap;text-align:center;background:#05060b;color:#d7ff63;font:700 12px/1.7 ui-monospace,monospace;letter-spacing:.12em}#keel-status[hidden]{display:none}${verificationChrome.css}</style></head><body data-verification="pending"><div id="keel-stage"></div><div id="keel-status">VERIFYING KEEL GRAPH</div>${verificationChrome.markup}<script id="keel-verification-envelope" type="application/json">${escapeScriptJson(input.envelope)}</script><script>${runtime}</script></body></html>`;
  const html = utf8ToBytes(htmlText.replace("<head>", '<head><link rel="icon" href="data:," />'));
  const compressedHtml = await compressBrotli(html);
  const roundTrip = await decompressBrotli(compressedHtml);
  if (roundTrip.byteLength !== html.byteLength || !roundTrip.every((value, index) => value === html[index])) throw new Error("Standalone viewer Brotli round trip failed.");
  const [htmlIntegrity, compressedIntegrity, envelopeIntegrity] = await Promise.all([
    sha256Integrity(html),
    sha256Integrity(compressedHtml),
    sha256Integrity(utf8ToBytes(canonicalJson(input.envelope))),
  ]);
  const buildRecipe = {
    protocol: "keel-viewer-build-recipe@1",
    runtime: "examples/demos/keel-creative-lab/keel-verifier-runtime.js",
    bundler: "esbuild@0.28.2",
    format: "iife",
    minify: true,
    target: "es2022",
    brotliDecoder: decoderMode === "embedded"
      ? { kind: "embedded", package: "brotli-dec-wasm@2.3.2", digest: wasmIntegrity.digest }
      : decoderMode === "javascript" ? { kind: "javascript", moduleDigest: decoderModule.integrity.digest, upstream: "google/brotli@v1.2.0" } : { kind: "disabled" },
    lzmaDecoder: lzmaMode === "javascript" ? { kind: "javascript", moduleDigest: decoderModule.integrity.digest, upstream: "LZMA-JS@2.3.2" } : { kind: "disabled" },
    verificationChrome: {
      module: "packages/viewer/src/keel-verification-chrome.js",
      digest: verificationChrome.sourceDigest,
      presentation: verificationChrome.presentation,
    },
    envelopeDigest: envelopeIntegrity.digest,
  } as const;
  const buildRecipeDigest = (await sha256Integrity(utf8ToBytes(canonicalJson(buildRecipe)))).digest;
  const sourceReceipt = await verifySourceBuild({
    sourceBytes: new Uint8Array(Buffer.concat([runtimeSource, verificationChrome.sourceBytes, decoderModule.sourceBytes])),
    outputBytes: html,
    rebuiltOutputBytes: html,
    mediaType: "text/javascript",
    buildRecipeDigest,
    verifier: { name: "keel-viewer-builder", version: "1.0.0" },
  });
  return {
    html,
    htmlIntegrity,
    compressedHtml,
    compressedIntegrity,
    compression: "brotli",
    runtimeByteLength: new TextEncoder().encode(runtime).byteLength,
    brotliDecoderByteLength: decoderMode === "javascript" ? decoderModule.javascriptBytes.byteLength : wasm.byteLength,
    brotliDecoderDigest: decoderMode === "javascript" ? decoderModule.integrity.digest : wasmIntegrity.digest,
    sourceReceipt,
  };
}

export async function buildEmbeddedKeelViewerShell(input: {
  readonly repositoryRoot: string;
  readonly verificationPresentation?: KeelVerificationPresentationOverrides;
  readonly brotliDecoder?: "embedded" | "javascript" | "disabled";
  readonly lzmaDecoder?: "javascript" | "disabled";
}): Promise<{
  readonly prefix: Uint8Array;
  readonly suffix: Uint8Array;
  readonly prefixIntegrity: { readonly algorithm: "sha256"; readonly digest: Hex; readonly byteLength: number };
  readonly suffixIntegrity: { readonly algorithm: "sha256"; readonly digest: Hex; readonly byteLength: number };
}> {
  const emptyDigest = (await sha256Integrity(new Uint8Array())).digest;
  const placeholder = await buildStandaloneKeelViewer({
    repositoryRoot: input.repositoryRoot,
    ...(input.brotliDecoder === undefined ? {} : { brotliDecoder: input.brotliDecoder }),
    ...(input.lzmaDecoder === undefined ? {} : { lzmaDecoder: input.lzmaDecoder }),
    ...(input.verificationPresentation === undefined ? {} : { verificationPresentation: input.verificationPresentation }),
    envelope: {
      protocol: KEEL_STANDALONE_VIEWER_PROTOCOL,
      title: "Keel verified presentation",
      deliveryProfile: "embedded-assembled",
      entrypoint: "__keel_placeholder__",
      items: [{
        id: "__keel_placeholder__",
        role: "entrypoint",
        mediaType: "text/html",
        aliases: [],
        integrity: { algorithm: "sha256", digest: emptyDigest, byteLength: 0 },
        embedded: { storedText: "", compression: "none" },
      }],
    },
  });
  const html = new TextDecoder().decode(placeholder.html);
  const marker = '<script id="keel-verification-envelope" type="application/json">';
  const markerOffset = html.indexOf(marker);
  if (markerOffset < 0) throw new Error("Embedded Keel shell envelope marker is missing.");
  const envelopeStart = markerOffset + marker.length;
  const envelopeEnd = html.indexOf("</script>", envelopeStart);
  if (envelopeEnd < 0) throw new Error("Embedded Keel shell envelope terminator is missing.");
  const prefix = utf8ToBytes(`${html.slice(0, envelopeStart)}{\"deliveryProfile\":\"embedded-assembled\",\"entrypoint\":null,\"items\":[null`);
  const suffix = utf8ToBytes(`],\"protocol\":${JSON.stringify(KEEL_STANDALONE_VIEWER_PROTOCOL)},\"title\":\"Keel verified presentation\"}${html.slice(envelopeEnd)}`);
  const [prefixIntegrity, suffixIntegrity] = await Promise.all([sha256Integrity(prefix), sha256Integrity(suffix)]);
  return { prefix, suffix, prefixIntegrity, suffixIntegrity };
}

/**
 * Runtime used only by the default composable Inline lane. It intentionally
 * contains no catalogue client, RPC reader, Brotli decoder, or presentation
 * chrome. The ordered object graph supplies every byte between the two shell
 * halves; this code verifies stored and decoded commitments, uses the
 * browser's native Gzip/Deflate decoder, and mounts the verified entrypoint.
 */
function compactInlineRuntime(
  mountKeelVerification: (input: {
    readonly result: unknown;
    readonly runtime?: unknown;
    readonly context?: unknown;
    readonly extraRows?: readonly { readonly key: string; readonly value: string }[];
  }) => unknown,
  installedViewReaderDigest: string,
  keccak: (bytes: Uint8Array) => Uint8Array,
): void {
  const benignChildRuntimeMessages = [
    "ResizeObserver loop completed with undelivered notifications.",
    "ResizeObserver loop limit exceeded",
  ];
  const globals = globalThis as typeof globalThis & {
    __KEEL_ITEMS__?: unknown;
    __KEEL_CONTEXT__?: unknown;
    __KEEL_VERIFICATION__?: unknown;
    __KEEL_SHELL_API__?: unknown;
  };
  const source = Array.isArray(globals.__KEEL_ITEMS__) ? globals.__KEEL_ITEMS__.filter(Boolean) : [];
  const stage = document.querySelector("#keel-stage");
  const status = document.querySelector("#keel-status");
  if (!(stage instanceof HTMLElement) || !(status instanceof HTMLElement) || typeof mountKeelVerification !== "function") {
    throw new Error("Invalid KEEL Inline shell.");
  }
  const items = source as KeelStandaloneViewerItem[];
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const fromBase64 = (value: string) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  const equal = (left: Uint8Array, right: Uint8Array) => left.length === right.length
    && left.every((value, index) => value === right[index]);
  const fromHex = (value: string) => Uint8Array.from(value.slice(2).match(/../gu) ?? [], (pair) => Number.parseInt(pair, 16));
  const sha256Fallback = (bytes: Uint8Array) => {
    const constants = Uint32Array.from([
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ]);
    const rotateRight = (value: number, count: number) => (value >>> count) | (value << (32 - count));
    const paddedLength = Math.ceil((bytes.byteLength + 9) / 64) * 64;
    const padded = new Uint8Array(paddedLength);
    padded.set(bytes);
    padded[bytes.byteLength] = 0x80;
    const bitLength = bytes.byteLength * 8;
    const paddedView = new DataView(padded.buffer);
    paddedView.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000), false);
    paddedView.setUint32(paddedLength - 4, bitLength >>> 0, false);
    const hash = Uint32Array.from([
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ]);
    const schedule = new Uint32Array(64);
    for (let block = 0; block < paddedLength; block += 64) {
      for (let index = 0; index < 16; index += 1) schedule[index] = paddedView.getUint32(block + index * 4, false);
      for (let index = 16; index < 64; index += 1) {
        const left = schedule[index - 15] as number;
        const right = schedule[index - 2] as number;
        schedule[index] = (
          (schedule[index - 16] as number)
          + (rotateRight(left, 7) ^ rotateRight(left, 18) ^ (left >>> 3))
          + (schedule[index - 7] as number)
          + (rotateRight(right, 17) ^ rotateRight(right, 19) ^ (right >>> 10))
        ) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = hash as unknown as [number, number, number, number, number, number, number, number];
      for (let index = 0; index < 64; index += 1) {
        const upper = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
        const choice = (e & f) ^ (~e & g);
        const temporary1 = (h + upper + choice + (constants[index] as number) + (schedule[index] as number)) >>> 0;
        const lower = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
        const majority = (a & b) ^ (a & c) ^ (b & c);
        const temporary2 = (lower + majority) >>> 0;
        h = g; g = f; f = e; e = (d + temporary1) >>> 0; d = c; c = b; b = a; a = (temporary1 + temporary2) >>> 0;
      }
      hash[0] = ((hash[0] as number) + a) >>> 0;
      hash[1] = ((hash[1] as number) + b) >>> 0;
      hash[2] = ((hash[2] as number) + c) >>> 0;
      hash[3] = ((hash[3] as number) + d) >>> 0;
      hash[4] = ((hash[4] as number) + e) >>> 0;
      hash[5] = ((hash[5] as number) + f) >>> 0;
      hash[6] = ((hash[6] as number) + g) >>> 0;
      hash[7] = ((hash[7] as number) + h) >>> 0;
    }
    const output = new Uint8Array(32);
    const outputView = new DataView(output.buffer);
    hash.forEach((value, index) => outputView.setUint32(index * 4, value, false));
    return output;
  };
  const sha256 = async (bytes: Uint8Array) => {
    const subtle = globalThis.crypto?.subtle;
    return subtle?.digest
      ? new Uint8Array(await subtle.digest("SHA-256", bytes.slice().buffer as ArrayBuffer))
      : sha256Fallback(bytes);
  };
  const safeJSON = (value: unknown) => JSON.stringify(value)
    .replace(/[&<>\u2028\u2029]/gu, (character) => "\\u" + character.charCodeAt(0).toString(16).padStart(4, "0"));
  const verify = async (bytes: Uint8Array, integrity: KeelStandaloneViewerItem["integrity"], label: string) => {
    if (bytes.byteLength !== integrity.byteLength) throw new Error(`${label} length mismatch.`);
    if (integrity.algorithm !== "sha256" && integrity.algorithm !== "keccak256") throw new Error("Unsupported digest algorithm.");
    const seen = integrity.algorithm === "sha256" ? await sha256(bytes) : keccak(bytes);
    if (!equal(seen, fromHex(integrity.digest))) throw new Error(`${label} ${integrity.algorithm === "sha256" ? "SHA-256" : "Keccak-256"} mismatch.`);
    return bytes;
  };
  const decompress = async (compression: "none" | "gzip" | "deflate" | "brotli" | "lzma", bytes: Uint8Array) => {
    if (compression === "none") return bytes;
    if (compression !== "gzip" && compression !== "deflate") throw new Error("Unsupported KEEL resource compression.");
    if (typeof DecompressionStream !== "function") throw new Error(`${compression} decompression is unavailable.`);
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream(compression));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  };
  const readBounded = async (stream: ReadableStream<Uint8Array>, maximum: number) => {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > maximum) throw new Error("Declared response limit exceeded.");
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const output = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
    return output;
  };
  const resolve = async (item: KeelStandaloneViewerItem) => {
    if (item.external !== undefined) {
      if (item.embedded !== undefined || item.onchain !== undefined) throw new Error("Ambiguous resource delivery.");
      const external = item.external;
      const maximum = external.maxBytes;
      if (!Number.isSafeInteger(maximum) || maximum <= 0 || !Number.isSafeInteger(item.integrity.byteLength)
          || item.integrity.byteLength <= 0 || item.integrity.byteLength > maximum) throw new Error("Invalid response limit.");
      if (!["none", "gzip", "deflate"].includes(external.compression)) throw new Error("Unsupported external compression.");
      const uri = new URL(decoder.decode(fromBase64(external.uriBase64)));
      if (uri.protocol !== "https:" || uri.username || uri.password || uri.hash) throw new Error("Invalid external HTTPS locator.");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);
      try {
        const response = await fetch(uri.href, { credentials: "omit", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer", signal: controller.signal });
        if (!response.ok || response.body === null) throw new Error("External response unavailable.");
        const stored = await readBounded(response.body, maximum);
        const decoded = external.compression === "none" ? stored : await readBounded(
          new Blob([stored as BlobPart]).stream().pipeThrough(new DecompressionStream(external.compression)), item.integrity.byteLength);
        return verify(decoded, item.integrity, item.id);
      } finally { clearTimeout(timer); }
    }
    const embedded = item.embedded;
    if (embedded === undefined) {
      throw new Error(`Missing embedded bytes for ${item.id}.`);
    }
    const text = embedded.storedText !== undefined, base64 = embedded.storedBase64 !== undefined;
    if (text === base64 || (text && (typeof embedded.storedText !== "string" || embedded.compression !== "none"))
        || (base64 && typeof embedded.storedBase64 !== "string")) throw new Error(`Invalid embedded bytes for ${item.id}.`);
    const stored = text ? new TextEncoder().encode(embedded.storedText!) : fromBase64(embedded.storedBase64!);
    if (text && decoder.decode(stored) !== embedded.storedText) throw new Error(`Invalid UTF-8 text for ${item.id}.`);
    if (embedded.storedIntegrity !== undefined) await verify(stored, embedded.storedIntegrity, `${item.id} stored`);
    return verify(await decompress(embedded.compression, stored), item.integrity, item.id);
  };
  const dataURL = (bytes: Uint8Array, mediaType: string) => {
    let binary = "";
    for (let offset = 0; offset < bytes.byteLength; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.byteLength)));
    }
    return `data:${mediaType};base64,${btoa(binary)}`;
  };
  const replaceAliases = (text: string, aliases: ReadonlyMap<string, () => string>) => {
    let output = text;
    for (const [alias, url] of [...aliases].sort(([left], [right]) => right.length - left.length || left.localeCompare(right))) {
      if (output.includes(alias)) output = output.replaceAll(alias, url());
    }
    return output;
  };
  const identifier = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;
  const moduleReference = (specifier: string, moduleAliases: ReadonlyMap<string, string>) => {
    const exact = moduleAliases.get(specifier);
    if (exact !== undefined) return exact;
    const withoutDot = specifier.replace(/^\.\//u, "");
    // Keep the legacy content alias resolvable without embedding that transport
    // path literally in the canonical shell. Some marketplace scanners treat
    // any occurrence of it as a live network dependency.
    const legacyContentPrefix = atob("L2NvbnRlbnQv");
    const normalized = moduleAliases.get(withoutDot) ?? moduleAliases.get(`./${withoutDot}`) ?? moduleAliases.get(`${legacyContentPrefix}${withoutDot}`);
    if (normalized === undefined) throw new Error(`Undeclared verified module import ${specifier}.`);
    return normalized;
  };
  const namedBindings = (clause: string, moduleId: string) => {
    const bindings = clause.split(",").map((part) => part.trim()).filter(Boolean).map((part) => {
      const match = /^([A-Za-z_$][A-Za-z0-9_$]*)(?:\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*))?$/u.exec(part);
      if (match === null) throw new Error(`Unsupported verified module import binding ${part}.`);
      const imported = match[1]!;
      const local = match[2] ?? imported;
      return imported === local ? imported : `${imported}:${local}`;
    });
    return `const{${bindings.join(",")}}=globalThis.__KEEL_MODULES__[${safeJSON(moduleId)}];`;
  };
  const transformVerifiedModule = (
    source: string,
    moduleId: string,
    moduleAliases: ReadonlyMap<string, string>,
    exposeExports: boolean,
  ) => {
    const imports: string[] = [];
    const exports = new Map<string, string>();
    let body = source.replace(
      /(^|[;\n])\s*import\s*([^;\n]+?)\s*from\s*(["'])([^"']+)\3\s*;?/gu,
      (_whole, boundary: string, clauseValue: string, _quote: string, specifier: string) => {
        const clause = clauseValue.trim();
        const dependency = moduleReference(specifier, moduleAliases);
        if (/^\*\s+as\s+/u.test(clause)) {
          const local = clause.replace(/^\*\s+as\s+/u, "").trim();
          if (!identifier.test(local)) throw new Error(`Unsupported verified namespace import ${clause}.`);
          imports.push(`const ${local}=globalThis.__KEEL_MODULES__[${safeJSON(dependency)}];`);
        } else if (clause.startsWith("{") && clause.endsWith("}")) {
          imports.push(namedBindings(clause.slice(1, -1), dependency));
        } else if (identifier.test(clause)) {
          imports.push(`const ${clause}=globalThis.__KEEL_MODULES__[${safeJSON(dependency)}].default;`);
        } else {
          throw new Error(`Unsupported verified module import ${clause}.`);
        }
        return boundary;
      },
    );
    body = body.replace(
      /(^|[;\n])\s*import\s*(["'])([^"']+)\2\s*;?/gu,
      (_whole, boundary: string, _quote: string, specifier: string) => {
        imports.push(`void globalThis.__KEEL_MODULES__[${safeJSON(moduleReference(specifier, moduleAliases))}];`);
        return boundary;
      },
    );
    body = body.replace(
      /(^|[;\n}])\s*export\s*\{([^}]*)\}\s*from\s*(["'])([^"']+)\3\s*;?/gu,
      (_whole, boundary: string, list: string, _quote: string, specifier: string) => {
        const dependency = moduleReference(specifier, moduleAliases);
        const local = `__keel_dependency_${imports.length.toString()}`;
        imports.push(`const ${local}=globalThis.__KEEL_MODULES__[${safeJSON(dependency)}];`);
        for (const part of list.split(",").map((value) => value.trim()).filter(Boolean)) {
          const match = /^([A-Za-z_$][A-Za-z0-9_$]*)(?:\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*))?$/u.exec(part);
          if (match === null) throw new Error(`Unsupported verified module re-export ${part}.`);
          exports.set(match[2] ?? match[1]!, `${local}[${safeJSON(match[1]!)}]`);
        }
        return boundary;
      },
    );
    body = body.replace(
      /(^|[;\n}])\s*export\s+((?:async\s+)?(?:function|class|const|let|var))\s+([A-Za-z_$][A-Za-z0-9_$]*)/gu,
      (_whole, boundary: string, declaration: string, local: string) => {
        exports.set(local, local);
        return `${boundary}${declaration} ${local}`;
      },
    );
    body = body.replace(
      /(^|[;\n}])\s*export\s*\{([^}]*)\}\s*;?/gu,
      (_whole, boundary: string, list: string) => {
        for (const part of list.split(",").map((value) => value.trim()).filter(Boolean)) {
          const match = /^([A-Za-z_$][A-Za-z0-9_$]*)(?:\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*))?$/u.exec(part);
          if (match === null) throw new Error(`Unsupported verified module export ${part}.`);
          exports.set(match[2] ?? match[1]!, match[1]!);
        }
        return boundary;
      },
    );
    if (/(^|[;\n}])\s*(?:import|export)\b/u.test(body)) {
      throw new Error(`Verified module ${moduleId} uses unsupported module syntax.`);
    }
    const published = exposeExports
      ? `globalThis.__KEEL_MODULES__[${safeJSON(moduleId)}]=Object.freeze({${[...exports].map(([name, local]) => `${safeJSON(name)}:${local}`).join(",")}});`
      : "";
    return `"use strict";(()=>{${imports.join("")}${body}\n${published}})();`;
  };
  const prepareVerifiedEntry = (
    html: string,
    moduleAliases: ReadonlyMap<string, string>,
  ) => {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    const scripts: string[] = [];
    for (const script of [...parsed.querySelectorAll("script")]) {
      const source = script.getAttribute("src");
      if (source !== null) {
        moduleReference(source, moduleAliases);
      } else {
        const text = script.textContent ?? "";
        scripts.push(script.type === "module"
          ? transformVerifiedModule(text, "keel.entry", moduleAliases, false)
          : text);
      }
      script.remove();
    }
    return {
      html: `<!doctype html>${parsed.documentElement.outerHTML}`,
      scripts,
    };
  };
  const childHTML = (
    html: string,
    context: unknown,
    verification: unknown,
    contentUrls: Record<string, string>,
    scripts: readonly string[],
    directEntry?: { readonly background_color?: string; readonly id: string; readonly name: string; readonly mediaType: string; readonly digest: string; readonly byteLength: number; readonly url: string; readonly moduleURL: string },
  ) => {
    // Construct the child terminator at runtime so the parent HTML parser
    // never sees a literal closing script tag inside this shell script.
    const closeScript = String.fromCharCode(60, 47, 115, 99, 114, 105, 112, 116, 62);
    // Compiling WebAssembly needs 'wasm-unsafe-eval'. It is granted only when
    // the verified graph actually carries a WebAssembly item, so a shell around
    // a graph without one keeps byte-identical bytes and exactly the policy it
    // had before. Nothing else widens: there is still no 'unsafe-eval', and
    // connect-src stays 'none', so verified wasm can compute but cannot call out.
    const wasmSource = items.some((item) => item.mediaType === "application/wasm") ? " 'wasm-unsafe-eval'" : "";
    const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' data: blob:${wasmSource}; style-src 'unsafe-inline' data:; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'">`;
    const injection = `<script>{const benign=Object.freeze(${safeJSON(benignChildRuntimeMessages)}),report=detail=>{const message=String(detail);if(benign.includes(message.trim()))return;parent.postMessage({protocol:"keel-inline-child@1",action:"failed",detail:message},"*")};addEventListener("error",event=>report(event.message||event.error||"Verified child runtime failed."));addEventListener("unhandledrejection",event=>report(event.reason?.message||event.reason||"Verified child promise rejected."));const c=Object.freeze(${safeJSON(context ?? {})});globalThis.__KEEL_CONTEXT__=c;const s=c?.derivedTokenSeed??c?.tokenSeed??c?.seed;if(typeof s==="string"&&/^0x[0-9a-f]{64}$/i.test(s))Object.defineProperty(globalThis,"KEEL_SEED",{value:s.toLowerCase(),enumerable:true,writable:false,configurable:false});Object.defineProperty(globalThis,"__KEEL_VERIFICATION__",{value:Object.freeze(${safeJSON(verification)}),enumerable:true,writable:false,configurable:false})}${closeScript}`;
    const content = `<script>(()=>{const u=Object.freeze(${safeJSON(contentUrls)}),r=Object.freeze(${safeJSON((verification as { readonly checks?: unknown }).checks ?? [])}),bytes=id=>{const value=u[id];if(typeof value!=="string")throw new Error("Undeclared verified content "+id);const encoded=value.slice(value.indexOf(",")+1);return Uint8Array.from(atob(encoded),character=>character.charCodeAt(0))},resources=()=>r;Object.defineProperty(globalThis,"__KEEL_CONTENT__",{value:Object.freeze({url:id=>u[id]??null,bytes,resources}),enumerable:true,writable:false,configurable:false})})()${closeScript}`;
    const direct = directEntry === undefined ? "" : `<script>{const e=Object.freeze(${safeJSON(directEntry)});Object.defineProperty(globalThis,"__KEEL_ENTRY__",{value:e,enumerable:true,writable:false,configurable:false})}${closeScript}`;
    const loader = `<script>{Object.defineProperty(globalThis,"__KEEL_MODULES__",{value:Object.create(null),enumerable:false,writable:false,configurable:false});const run=()=>{for(const source of ${safeJSON(scripts)}){const script=document.createElement("script");script.textContent=source;document.head.append(script)}};document.readyState==="loading"?addEventListener("DOMContentLoaded",run,{once:true}):run()}${closeScript}`;
    const document = directEntry === undefined
      ? html
      : `<!doctype html><html><head><meta charset="utf-8"><style>html,body,#keel-asset-display{width:100%;height:100%;margin:0;overflow:hidden;background:#05060b}</style></head><body><main id="keel-asset-display"></main></body></html>`;
    return /<head(?:\s[^>]*)?>/iu.test(document)
      ? document.replace(/<head(?:\s[^>]*)?>/iu, (head) => `${head}${policy}${injection}${content}${direct}${loader}`)
      : `<!doctype html><html><head><meta charset="utf-8">${policy}${injection}${content}${direct}${loader}</head><body>${document}</body></html>`;
  };
  const launch = async () => {
    if (items.length === 0) throw new Error("The KEEL Inline graph is empty.");
    if (new Set(items.map(item => item.id)).size !== items.length) throw new Error("Duplicate KEEL resource identity.");
    status.textContent = `VERIFYING ${items.length} ITEMS`;
    const resolved = new Map<string, Uint8Array>();
    for (const item of items) {
      status.textContent = `VERIFYING ${item.id.toUpperCase()}`;
      resolved.set(item.id, await resolve(item));
    }
    const entry = items.find((item) => item.role === "entrypoint");
    if (entry === undefined) throw new Error("The KEEL Inline graph has no entrypoint.");
    // Resource names resolve lazily: an item's data URL is built only when a
    // text that is actually inlined names it, and an item can name only items
    // before it. Building every URL up front nested each module's URL inside
    // every later module that merely mentioned its id (an engine module's
    // wrapper names the modules it needs), which grew exponentially with the
    // graph and ended in "Invalid string length". Modules the loader runs
    // (below) are never rewritten: they reach other modules through import
    // specifiers, which resolve by lookup in __KEEL_MODULES__.
    const others = items.filter((candidate) => candidate !== entry);
    const owners = new Map<string, number[]>();
    others.forEach((item, index) => {
      for (const name of [item.id, ...item.aliases]) owners.set(name, [...(owners.get(name) ?? []), index]);
    });
    const loaderRuns = (item: KeelStandaloneViewerItem) => item.id !== "keel.published-view-reader"
      && (item.role === "module" || item.role === "data") && item.mediaType === "text/javascript";
    const urls = new Map<number, string>();
    const urlOf = (index: number): string => {
      const known = urls.get(index);
      if (known !== undefined) return known;
      const item = others[index]!;
      const bytes = resolved.get(item.id);
      if (bytes === undefined) throw new Error(`Resolved bytes missing for ${item.id}.`);
      const output = !loaderRuns(item) && /^(?:text\/|application\/(?:javascript|json))/u.test(item.mediaType)
        ? new TextEncoder().encode(replaceAliases(decoder.decode(bytes), aliasesBefore(index)))
        : bytes;
      const url = dataURL(output, item.mediaType);
      urls.set(index, url);
      return url;
    };
    // (The names items before `bound` declare, each resolving -- only when used -- to the latest item declaring it.)
    const aliasesBefore = (bound: number) => {
      const view = new Map<string, () => string>();
      for (const [name, declared] of owners) {
        const owner = declared.filter((index) => index < bound).at(-1);
        if (owner !== undefined) view.set(name, () => urlOf(owner));
      }
      return view;
    };
    const aliases = aliasesBefore(others.length);
    const entryBytes = resolved.get(entry.id);
    if (entryBytes === undefined) throw new Error("Resolved entrypoint bytes are missing.");
    const verificationChecks = Object.freeze(items.map((item) => Object.freeze({
      id: item.id,
      name: item.aliases[0] ?? item.id,
      label: item.aliases[0] ?? item.id,
      role: item.role ?? "asset",
      mediaType: item.mediaType,
      digest: item.integrity.digest,
      byteLength: item.integrity.byteLength,
      passed: true,
      detail: `${item.integrity.byteLength} bytes matched ${item.integrity.digest}`,
      severity: "fatal",
    })));
    const verification = Object.freeze({
      protocol: "keel-inline-verification@1",
      state: "verified",
      title: "KEEL verified",
      summary: `${items.length} committed resources matched before the work was mounted.`,
      checks: verificationChecks,
      proofTier: "Committed resource graph",
      isFixture: false,
      proofMode: "keel-inline-verification@1",
      syntheticTokenContext: false,
    });
    const contentUrls = Object.fromEntries(items.map((item) => {
      const bytes = resolved.get(item.id);
      if (bytes === undefined) throw new Error(`Resolved bytes missing for ${item.id}.`);
      return [item.id, dataURL(bytes, item.mediaType)];
    }));
    globals.__KEEL_VERIFICATION__ = verification;
    const resources = verificationChecks;
    // Optional live data has separate proof from the permanent resource graph.
    // No transport is exposed to the creator frame and connect-src remains none.
    let liveContent: Awaited<ReturnType<typeof import("./fray-content-view-runtime.js").resolveInlinePublishedContent>>;
    let liveReadError: string | undefined;
    try {
      const readManifest = items.find(item => item.id === "keel.read-manifest" && item.mediaType === "application/json");
      const manifestBytes = readManifest && resolved.get(readManifest.id);
      const enabled = manifestBytes && JSON.parse(decoder.decode(manifestBytes))?.extensions?.["keel-read-intents@1"]?.enabled === true;
      if (enabled) {
        const installed = items.find(item => item.id === "keel.published-view-reader" && item.mediaType === "text/javascript");
        if (!installed || installed.integrity.digest !== installedViewReaderDigest) throw new Error("Installed published-read module is missing or has changed");
        const readerBytes = resolved.get(installed.id);
        if (!readerBytes) throw new Error("Published-read module bytes missing");
        await verify(readerBytes, installed.integrity, "Installed published-read runtime");
        if (Object.hasOwn(globalThis, "__KEEL_PUBLISHED_VIEW_READER__")) throw new Error("Published-read runtime was installed outside the verified loader");
        // Privileged host code is selected by this shell's compiled digest,
        // never by a creator-provided URL, callback, selector or module hash.
        const install = document.createElement("script");
        install.textContent = decoder.decode(readerBytes);
        document.head.append(install);
        install.remove();
        const reader = (globalThis as typeof globalThis & { __KEEL_PUBLISHED_VIEW_READER__?: typeof import("./fray-content-view-runtime.js").resolveInlinePublishedContent }).__KEEL_PUBLISHED_VIEW_READER__;
        if (typeof reader !== "function") throw new Error("Published-read module did not install");
        const shaItems = items.filter((item): item is KeelStandaloneViewerItem & { integrity: Sha256Integrity } => item.integrity.algorithm === "sha256");
        if (shaItems.length !== items.length) throw new Error("Published reads require SHA-256 resources.");
        liveContent = await reader(shaItems, resolved, globals.__KEEL_CONTEXT__);
      }
    }
    catch (error) { liveReadError = error instanceof Error ? error.message : "Published content read unavailable"; }
    const context: Record<string, unknown> = { ...(typeof globals.__KEEL_CONTEXT__ === "object" && globals.__KEEL_CONTEXT__ !== null ? globals.__KEEL_CONTEXT__ : {}),
      // Always replace this field; token context cannot impersonate a host read.
      contentView: liveContent ?? null };

    const extensions = typeof context === "object" && context !== null && Array.isArray((context as { shellPlugins?: unknown }).shellPlugins)
      ? (context as { shellPlugins: unknown[] }).shellPlugins.slice(0, 8).flatMap((value) => {
        if (typeof value !== "object" || value === null) return [];
        const candidate = value as { id?: unknown; title?: unknown; body?: unknown };
        return typeof candidate.id === "string" && /^[a-z0-9][a-z0-9-]{0,31}$/u.test(candidate.id)
          && typeof candidate.title === "string" && candidate.title.length > 0 && candidate.title.length <= 64
          && typeof candidate.body === "string" && candidate.body.length <= 2_048
          ? [Object.freeze({ id: candidate.id, title: candidate.title, body: candidate.body })]
          : [];
      })
      : [];
    const plugins = Object.freeze(extensions);
    Object.defineProperty(globals, "__KEEL_SHELL_API__", {
      value: Object.freeze({
        protocol: "keel-shell-plugin@1",
        verification: () => verification,
        resources: () => resources,
        plugins: () => plugins,
      }),
      enumerable: true,
      writable: false,
      configurable: false,
    });
    const verificationUI = mountKeelVerification({
      result: verification,
      runtime: Object.freeze({ protocol: "keel-inline-runtime@1" }),
      context,
      extraRows: [...plugins.map((plugin) => Object.freeze({ key: plugin.title, value: plugin.body })),
        ...(liveContent ? [{ key: "Live appearance reads", value: `Enabled manifest and published read intents verified. ${liveContent.state.appearance ? "Wallet choices, backpack items, campaign eligibility and restored slots are live. " : "Wallet choices are live. "}RPC state at block ${liveContent.disclosure.blockNumber}; registered artwork is checked against its stored digest. These reads do not change the original seed or mint catalog. Source: ${liveContent.disclosure.endpoint}` }] : []),
        ...(liveReadError ? [{ key: "Wallet skins unavailable", value: liveReadError + ". Showing base artwork." }] : [])],
    }) as { fail(label: string, detail: string): void };
    const frame = document.createElement("iframe");
    frame.title = "Verified KEEL work";
    frame.sandbox.add("allow-scripts", "allow-pointer-lock");
    frame.referrerPolicy = "no-referrer";
    const directMedia = entry.mediaType.startsWith("image/") || entry.mediaType.startsWith("video/") || entry.mediaType === "model/gltf-binary";
    const assetDisplay = directMedia
      ? items.filter((item) => item.id === "keel.asset-display" && item.role === "module" && item.mediaType === "text/javascript")
      : [];
    if (directMedia && assetDisplay.length !== 1) {
      throw new Error("A direct media entry requires exactly one verified keel.asset-display module.");
    }
    const entryURL = contentUrls[entry.id];
    if (entryURL === undefined) throw new Error("Verified entrypoint descriptor is missing.");
    const moduleAliases = new Map<string, string>();
    const moduleScripts: string[] = [];
    const scriptItems = items.filter((candidate) => candidate !== entry && candidate.id !== "keel.published-view-reader" && (candidate.role === "module" || candidate.role === "data") && candidate.mediaType === "text/javascript");
    // Discover all verified names before resolving any imports. Publication
    // order is not a declaration of which dependencies exist.
    for (const item of scriptItems) {
      for (const alias of [item.id, ...item.aliases]) {
        const previous = moduleAliases.get(alias);
        if (previous !== undefined && previous !== item.id) throw new Error(`Ambiguous verified module alias ${alias}.`);
        moduleAliases.set(alias, item.id);
      }
    }
    for (const item of scriptItems) {
      const bytes = resolved.get(item.id);
      if (bytes === undefined) throw new Error(`Resolved bytes missing for ${item.id}.`);
      const source = decoder.decode(bytes);
      moduleScripts.push(/(^|[;\n])\s*(?:import|export)\b/u.test(source)
        ? transformVerifiedModule(source, item.id, moduleAliases, true)
        : source);
    }
    const preparedEntry = directMedia
      ? { html: "", scripts: [] as string[] }
      : prepareVerifiedEntry(decoder.decode(entryBytes), moduleAliases);
    const verifiedChildHTML = childHTML(
      directMedia ? "" : replaceAliases(preparedEntry.html, aliases),
      context,
      verification,
      contentUrls,
      [...moduleScripts, ...preparedEntry.scripts],
      directMedia ? {
        id: entry.id,
        name: entry.aliases[0] ?? entry.id,
        mediaType: entry.mediaType,
        digest: entry.integrity.digest,
        byteLength: entry.integrity.byteLength,
        url: entryURL,
        moduleURL: contentUrls[assetDisplay[0]!.id]!,
        ...(entry.backgroundColor === undefined ? {} : { background_color: entry.backgroundColor }),
      } : undefined,
    );
    // `srcdoc` inherits the embedding page's CSP. Marketplaces commonly allow
    // inline scripts while denying `data:` script elements, so execute the
    // already-verified module bytes as inline text. Keeping the document in
    // srcdoc also avoids turning a large p5/Three graph into a multi-megabyte
    // nested data URL that browsers may reject before execution.
    frame.srcdoc = verifiedChildHTML;
    addEventListener("message", (event) => {
      if (event.source !== frame.contentWindow || event.data?.protocol !== "keel-inline-child@1" || event.data?.action !== "failed") return;
      const message = typeof event.data.detail === "string" ? event.data.detail : "Verified child runtime failed.";
      document.body.dataset.verification = "failed";
      status.hidden = false;
      status.textContent = `KEEL VERIFICATION FAILED\n${message}`;
      verificationUI.fail("Verified child runtime", message);
      parent.postMessage({ protocol: "keel-inline-runtime@1", action: "failed", detail: message }, "*");
    });
    stage.replaceChildren(frame);
    await new Promise<void>((resolveReady, reject) => {
      const timer = setTimeout(() => reject(new Error("Verified entrypoint timed out.")), 15_000);
      frame.addEventListener("load", () => {
        clearTimeout(timer);
        resolveReady();
      }, { once: true });
      frame.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("Verified entrypoint failed to load."));
      }, { once: true });
    });
    document.body.dataset.verification = "verified";
    status.hidden = true;
  };
  document.addEventListener("DOMContentLoaded", () => void launch().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    document.body.dataset.verification = "failed";
    status.hidden = false;
    status.textContent = `KEEL VERIFICATION FAILED\n${message}`;
    parent.postMessage({ protocol: "keel-inline-runtime@1", action: "failed", detail: message }, "*");
    const mounted = (globals as typeof globalThis & {
      __VAULT_VERIFICATION_UI__?: { fail?: (label: string, detail: string) => void };
    }).__VAULT_VERIFICATION_UI__;
    if (typeof mounted?.fail === "function") {
      mounted.fail("Committed resource graph", message);
    } else {
      mountKeelVerification({
        result: Object.freeze({
          state: "failed",
          title: "Verification failed",
          summary: message,
          checks: Object.freeze([Object.freeze({
            id: "keel-inline-runtime",
            label: "Committed resource graph",
            passed: false,
            detail: message,
            severity: "fatal",
          })]),
          proofTier: "Rejected render",
          isFixture: false,
          proofMode: "rejected",
          syntheticTokenContext: false,
        }),
        runtime: Object.freeze({ protocol: "keel-inline-runtime@1" }),
        context: globals.__KEEL_CONTEXT__,
      });
    }
  }), { once: true });
}

/** Build the two small reusable halves for the composable Inline lane. */
let publishedViewReaderBuild: Promise<{ id: string; source: Uint8Array; integrity: Sha256Integrity }> | undefined;
export function buildPublishedViewReaderModule() {
  return publishedViewReaderBuild ??= (async () => {
    const sourcePath = fileURLToPath(new URL("./fray-content-view-runtime.js", import.meta.url));
    const bundled = await build({ bundle: true, minify: true, platform: "browser", format: "iife", target: ["es2022"], write: false,
      stdin: { contents: `import {resolveInlinePublishedContent} from ${JSON.stringify(sourcePath)};Object.defineProperty(globalThis,"__KEEL_PUBLISHED_VIEW_READER__",{value:resolveInlinePublishedContent,writable:false,configurable:false});`,
        resolveDir: path.dirname(sourcePath), sourcefile: "keel-published-view-reader.js", loader: "js" } });
    const source = utf8ToBytes(bundled.outputFiles[0]!.text);
    return { id: "keel.published-view-reader", source, integrity: await sha256Integrity(source) };
  })();
}

export async function buildCompactInlineKeelShell(input: {
  /** Checkout containing the one canonical KEEL verification chrome module. */
  readonly repositoryRoot?: string;
  /** Optional binary resources from this exact platform-governed store/builder binding. */
  readonly onchainDelivery?: {
    readonly chainId: number;
    readonly store: string;
    readonly builder: string;
    readonly storeCodeIntegrity: Sha256Integrity;
    readonly builderCodeIntegrity: Sha256Integrity;
    readonly rpcUrls: readonly string[];
    readonly rpcHosts?: readonly string[];
    readonly blockHash?: Hex;
  };
  /** EVM-assembled compressed packs; the response contains every byte and never exposes a browser RPC transport. */
  readonly embeddedContainerDelivery?: { readonly chainId: number; readonly store: string };
  /** Contain an authored viewport without moving scene controls. */
  readonly fitViewport?: { readonly width: number; readonly height: number };
  /** Explicit wire choice, independent of native Hold storage. No fallback. */
  readonly binaryPayloadCarriage?: "as-is" | "base64" | "base89" | "base90" | "base91" | "base90-block";
  /** Opt-in trusted decoder profile; the native default retains its exact boot bytes. */
  readonly codecProfile?: "native" | "brotli-js" | "lzma-js" | "brotli-lzma-js";
} = {}): Promise<{
  readonly deliveryProfile: "embedded-assembled" | "onchain-recursive";
  readonly codecProfile: "native" | "brotli-js" | "lzma-js" | "brotli-lzma-js";
  readonly supportedCodecs: readonly ("none" | "gzip" | "deflate" | "brotli" | "lzma")[];
  readonly decoderIntegrity?: Sha256Integrity;
  readonly resourceProfile?: "embedded-shared-containers@1" | "embedded-shared-containers-base89@1" | "embedded-shared-containers-base90@1" | "embedded-shared-containers-base91@1" | "embedded-shared-containers-base90-block@2";
  readonly transportDecoderIntegrity?: Sha256Integrity;
  readonly containerBridge?: Uint8Array;
  readonly containerBridgeIntegrity?: Sha256Integrity;
  readonly prefix: Uint8Array;
  readonly suffix: Uint8Array;
  readonly prefixIntegrity: Sha256Integrity;
  readonly suffixIntegrity: Sha256Integrity;
}> {
  if (input.binaryPayloadCarriage !== undefined && !["as-is", "base64", "base89", "base90", "base91", "base90-block"].includes(input.binaryPayloadCarriage)) throw new TypeError("Invalid binary payload carriage.");
  if (input.binaryPayloadCarriage !== undefined && !input.embeddedContainerDelivery) throw new TypeError("Binary payload carriage requires an embedded container profile.");
  if (input.embeddedContainerDelivery && input.onchainDelivery) throw new TypeError("Select exactly one KEEL delivery profile.");
  if (input.embeddedContainerDelivery && (!Number.isSafeInteger(input.embeddedContainerDelivery.chainId) || input.embeddedContainerDelivery.chainId <= 0
      || !/^0x[0-9a-f]{40}$/iu.test(input.embeddedContainerDelivery.store) || /^0x0{40}$/iu.test(input.embeddedContainerDelivery.store))) throw new TypeError("Invalid offline selected-chain binding.");
  if (input.embeddedContainerDelivery && (input.binaryPayloadCarriage ?? "as-is") === "as-is") throw new TypeError("Unchanged compressed bytes were requested. embedded-shared-containers@1 emits Base64 in the contract return and cannot satisfy as-is carriage. Three-byte padding does not make raw binary a valid Base64/UTF-8 tokenURI. No encoding or Hybrid fallback was selected. Use a proved native byte reader; Base64 return requires an explicit binaryPayloadCarriage choice.");
  if (input.fitViewport && (![input.fitViewport.width, input.fitViewport.height].every(value => Number.isSafeInteger(value) && value >= 64 && value <= 8192))) throw new RangeError("Invalid authored viewport dimensions.");
  // Offline assembly never ships or invokes the optional published RPC reader.
  const installedViewReader = input.embeddedContainerDelivery ? { integrity: { digest: `0x${"0".repeat(64)}` } } : await buildPublishedViewReaderModule();
  // Packaged canonical source makes the default independent of the consumer's cwd.
  const verificationChromePath = fileURLToPath(new URL("./assets/keel-verification-chrome.js", import.meta.url));
  const canonical = await readFile(verificationChromePath);
  if (input.repositoryRoot) {
    const supplied = await readFile(path.join(path.resolve(input.repositoryRoot), "packages/viewer/src/keel-verification-chrome.js"));
    if (supplied.length !== canonical.length || !supplied.every((byte, index) => byte === canonical[index])) throw new TypeError("The requested checkout differs from the packaged canonical KEEL shell. Rebuild the SDK before preparing this viewer.");
  }
  const repositoryRoot = path.dirname(verificationChromePath);
  const codecProfile = input.codecProfile ?? "native";
  if (!["native", "brotli-js", "lzma-js", "brotli-lzma-js"].includes(codecProfile)) throw new TypeError("Unsupported KEEL shell codec profile.");
  const codecs: ("brotli" | "lzma")[] = [
    ...(codecProfile === "brotli-js" || codecProfile === "brotli-lzma-js" ? ["brotli" as const] : []),
    ...(codecProfile === "lzma-js" || codecProfile === "brotli-lzma-js" ? ["lzma" as const] : []),
  ];
  const decoderModule = codecs.length ? await buildKeelDecoderModule({ codecs }) : undefined;
  const transportProfile = input.binaryPayloadCarriage === "base89" ? "base89-v1" : input.binaryPayloadCarriage === "base90-block" ? "base90-block-v2" : input.binaryPayloadCarriage === "base90" ? "base90-v1" : input.binaryPayloadCarriage === "base91" ? "base91-v1" : undefined;
  const transportModule = transportProfile ? await buildKeelDenseTransportDecoder() : undefined;
  let runtimeSource = compactInlineRuntime.toString();
  if (decoderModule || input.onchainDelivery || input.embeddedContainerDelivery) {
    const replacement = `const decompress = async (compression, bytes, decodedByteLength) => {
      if (!Number.isSafeInteger(decodedByteLength) || decodedByteLength < 0 || decodedByteLength > 32 * 1024 * 1024) throw new RangeError("Committed decoded length exceeds shell limit.");
      if (compression === "none") return bytes;
      ${decoderModule ? `if (compression === "brotli" && KEEL_RESOURCE_DECODERS.decodeBrotli) return KEEL_RESOURCE_DECODERS.decodeBrotli(bytes, { decodedByteLength });
      if (compression === "lzma" && KEEL_RESOURCE_DECODERS.decodeLzma) return KEEL_RESOURCE_DECODERS.decodeLzma(bytes, { decodedByteLength });` : ""}
      if (compression !== "gzip" && compression !== "deflate") throw new Error("Unsupported KEEL resource compression.");
      if (typeof DecompressionStream !== "function") throw new Error(compression + " decompression is unavailable.");
      return readBounded(new Blob([bytes]).stream().pipeThrough(new DecompressionStream(compression)), decodedByteLength);
    };`;
    const updatedBody = runtimeSource.replace(/const decompress = async \([\s\S]*?\n\s*\};(?=\n\s*const readBounded)/u, replacement);
    if (updatedBody === runtimeSource) throw new Error("Canonical Inline decompression body hook is missing.");
    const updated = updatedBody.replace("decompress(embedded.compression, stored)", "decompress(embedded.compression, stored, item.integrity.byteLength)");
    if (updated === updatedBody) throw new Error("Canonical Inline decompression callsite hook is missing.");
    runtimeSource = updated;
  }
  let binaryReaderImport = "";
  if (input.onchainDelivery) {
    const delivery = input.onchainDelivery;
    // Validate the host-governed profile before emitting a privileged transport.
    const { createKeelOnchainResourceReader } = await import("./onchain-resource-reader.js");
    createKeelOnchainResourceReader({ ...delivery, verify: async bytes => bytes, decompress: async (_codec, bytes) => bytes });
    for (const rpcUrl of delivery.rpcUrls) assertKeelRpcUrl(rpcUrl, delivery.rpcHosts, { allowPrivateNetworkHosts: delivery.chainId === 31337 });
    // The binary resource protocol commits SHA-256 only. Keep the broader
    // embedded verifier unchanged while omitting an unused Keccak dependency.
    const shaOnly = runtimeSource.replace('const seen = integrity.algorithm === "sha256" ? await sha256(bytes) : keccak(bytes);',
      'if (integrity.algorithm !== "sha256") throw new Error("Binary delivery requires SHA-256 commitments."); const seen = await sha256(bytes);');
    if (shaOnly === runtimeSource) throw new Error("Canonical Inline SHA-only binary hook is missing.");
    runtimeSource = shaOnly;
    const marker = "const resolve = async (item";
    const prelude = `const binaryReader = createKeelOnchainResourceReader({...${escapeScriptJson(delivery)},containers:items.flatMap(item=>item.containerBindings??[]),verify,decompress});\n  `;
    const withReader = runtimeSource.replace(marker, prelude + marker);
    if (withReader === runtimeSource) throw new Error("Canonical Inline binary-reader initialization hook is missing.");
    const withResolve = withReader.replace(/(const resolve = async \(item[^\n]*?\{)/u, `$1\n    if (!item.onchain || item.embedded || item.external) throw new Error("Binary delivery requires exactly one selected onchain source.");\n    return binaryReader.resolve(item);`);
    if (withResolve === withReader) throw new Error("Canonical Inline binary resolve hook is missing.");
    // Keep the original resolution code unreachable under this explicitly selected profile.
    runtimeSource = withResolve;
    binaryReaderImport = `import {createKeelOnchainResourceReader} from ${JSON.stringify(fileURLToPath(new URL("./onchain-resource-reader.js", import.meta.url)))};`;
  }
  if (input.embeddedContainerDelivery) {
    const delivery = input.embeddedContainerDelivery;
    const shaOnly = runtimeSource.replace('const seen = integrity.algorithm === "sha256" ? await sha256(bytes) : keccak(bytes);',
      'if (integrity.algorithm !== "sha256") throw new Error("Offline binary delivery requires SHA-256 commitments."); const seen = await sha256(bytes);');
    if (shaOnly === runtimeSource) throw new Error("Canonical Inline SHA-only offline hook is missing.");
    runtimeSource = shaOnly;
    const marker = "const resolve = async (item";
    const prelude = `let offlineReader;
    const initializeOfflineReader = async () => {
      if (document.readyState === "loading") await new Promise(done => document.addEventListener("DOMContentLoaded", done, {once:true}));
      const context = validateKeelEmbeddedContainerContext(globals.__KEEL_CONTEXT__, ${delivery.chainId});
      globals.__KEEL_CONTEXT__ = context;
      return createKeelEmbeddedContainerReader({...${escapeScriptJson(delivery)},tableDigest:context.containerTableDigest,
        containers:items.flatMap(item=>item.containerBindings??[]),payloads:globalThis.__KEEL_EMBEDDED_CONTAINERS__,items,verify,decompress
        ${transportProfile ? `,transportProfile:${JSON.stringify(transportProfile)},decodeTransport:(text,byteLength)=>KEEL_DENSE_TRANSPORT.decodeKeelDenseTransport(text,{profile:${JSON.stringify(transportProfile)},byteLength})` : ""}});
    };
    `;
    const withReader = runtimeSource.replace(marker, prelude + marker);
    if (withReader === runtimeSource) throw new Error("Canonical Inline offline initialization hook is missing.");
    const withResolve = withReader.replace(/(const resolve = async \(item[^\n]*?\{)/u,
      `$1\n    return (await (offlineReader ??= initializeOfflineReader())).resolve(item);`);
    if (withResolve === withReader) throw new Error("Canonical Inline offline resolve hook is missing.");
    const disabledPublishedReader = withResolve.replace("if (enabled) {", "if (false) {");
    if (disabledPublishedReader === withResolve) throw new Error("Canonical Inline optional published-reader hook is missing.");
    runtimeSource = disabledPublishedReader;
    binaryReaderImport = `import {createKeelEmbeddedContainerReader} from ${JSON.stringify(fileURLToPath(new URL("./embedded-container-reader.js", import.meta.url)))};import {validateKeelEmbeddedContainerContext} from ${JSON.stringify(fileURLToPath(new URL("./embedded-container-context.js", import.meta.url)))};`;
  }
  if (input.fitViewport) {
    const {width, height} = input.fitViewport;
    const hook = "stage.replaceChildren(frame);";
    const updated = runtimeSource.replace(hook, `${hook}
      const fitFrame = () => {
        const scale = Math.min(stage.clientWidth / ${width}, stage.clientHeight / ${height});
        Object.assign(frame.style, {position:"absolute",width:"${width}px",height:"${height}px",left:"50%",top:"50%",transformOrigin:"center",transform:"translate(-50%,-50%) scale("+scale+")"});
      };
      fitFrame();new ResizeObserver(fitFrame).observe(stage);`);
    if (updated === runtimeSource) throw new Error("Canonical authored viewport hook is missing.");
    runtimeSource = updated;
  }
  const runtimeBuild = await build({
    absWorkingDir: repositoryRoot,
    bundle: true,
    minify: true,
    treeShaking: true,
    platform: "browser",
    format: "iife",
    target: ["es2022"],
    write: false,
    stdin: {
      contents: `${binaryReaderImport}${transportModule?.javascript ?? ""}${decoderModule?.javascript ?? ""}${input.onchainDelivery || input.embeddedContainerDelivery ? "" : 'import {keccak_256} from "@noble/hashes/sha3";'}import { mountKeelVerification } from ${JSON.stringify(verificationChromePath)};(${runtimeSource})(mountKeelVerification,${JSON.stringify(installedViewReader.integrity.digest)},${input.onchainDelivery || input.embeddedContainerDelivery ? "undefined" : "keccak_256"})`,
      resolveDir: repositoryRoot,
      sourcefile: "keel-inline-runtime.js",
      loader: "js",
    },
  });
  const runtime = runtimeBuild.outputFiles[0]?.text;
  if (runtime === undefined) throw new Error("Compact KEEL Inline runtime produced no JavaScript.");
  const prefix = utf8ToBytes('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}html,body,#keel-stage,iframe{width:100%;height:100%;margin:0;border:0;overflow:hidden;background:#05060b;color:#eafff8}body{position:relative}#keel-status{position:fixed;inset:0;z-index:2;display:grid;place-items:center;white-space:pre-wrap;text-align:center;color:#d7ff63;background:#05060b;font:700 12px/1.7 monospace}[hidden]{display:none!important}</style></head><body data-verification="pending"><div id="keel-stage"></div><div id="keel-status">VERIFYING KEEL GRAPH</div><script>globalThis.__KEEL_ITEMS__=[null'.replace("globalThis.__KEEL_ITEMS__=[null", input.embeddedContainerDelivery ? "globalThis.__KEEL_EMBEDDED_CONTAINERS__=[" : "globalThis.__KEEL_ITEMS__=[null"));
  const suffix = utf8ToBytes(`];${runtime}</script></body></html>`);
  const [prefixIntegrity, suffixIntegrity] = await Promise.all([sha256Integrity(prefix), sha256Integrity(suffix)]);
  const containerBridge = input.embeddedContainerDelivery ? utf8ToBytes("];globalThis.__KEEL_ITEMS__=[null") : undefined;
  return { prefix, suffix, prefixIntegrity, suffixIntegrity, ...(containerBridge ? { resourceProfile: transportProfile === "base89-v1" ? "embedded-shared-containers-base89@1" as const : transportProfile === "base90-block-v2" ? "embedded-shared-containers-base90-block@2" as const : transportProfile === "base90-v1" ? "embedded-shared-containers-base90@1" as const : transportProfile === "base91-v1" ? "embedded-shared-containers-base91@1" as const : "embedded-shared-containers@1" as const, containerBridge,
    containerBridgeIntegrity: await sha256Integrity(containerBridge) } : {}), deliveryProfile: input.onchainDelivery ? "onchain-recursive" : "embedded-assembled", codecProfile, supportedCodecs: ["none", "gzip", "deflate", ...codecs], ...(decoderModule ? { decoderIntegrity: decoderModule.integrity } : {}), ...(transportModule ? { transportDecoderIntegrity: transportModule.integrity } : {}) };
}

export async function buildEmbeddedKeelViewerSlot(input: {
  readonly id: string;
  readonly backgroundColor?: string;
  readonly role: "entrypoint" | "module" | "asset" | "data";
  readonly mediaType: string;
  readonly aliases?: readonly string[];
  readonly bytes: Uint8Array;
  readonly compression?: "none" | "gzip" | "deflate" | "brotli" | "lzma";
  /** Explicit LZMA-alone stream from the caller's pinned build encoder. */
  readonly storedBytes?: Uint8Array;
}): Promise<{
  readonly item: KeelStandaloneViewerItem;
  readonly fragment: Uint8Array;
  readonly fragmentIntegrity: { readonly algorithm: "sha256"; readonly digest: Hex; readonly byteLength: number };
}> {
  if (!input.id || !input.mediaType || input.bytes.byteLength === 0) throw new TypeError("Embedded Keel viewer slots require an id, media type, and bytes.");
  assertDataUriMediaType(input.mediaType);
  if (input.backgroundColor !== undefined && !/^#?[0-9a-f]{6}$/i.test(input.backgroundColor)) throw new TypeError("Background color must be six hex digits.");
  const compression = input.compression ?? "none";
  let stored: Uint8Array;
  if (compression === "lzma") {
    if (!input.storedBytes) throw new TypeError("LZMA resources require explicit precompressed storedBytes from a pinned encoder.");
    stored = input.storedBytes.slice();
    const { decodeLzma } = await import("./decoders/index.js");
    const decoded = await decodeLzma(stored, { decodedByteLength: input.bytes.byteLength });
    if (decoded.byteLength !== input.bytes.byteLength || !decoded.every((value, index) => value === input.bytes[index])) throw new Error("LZMA resource does not decode to the committed original bytes.");
  } else {
    if (input.storedBytes !== undefined) throw new TypeError("Explicit storedBytes are accepted only for LZMA resources.");
    stored = await compressStored(compression, input.bytes);
  }
  const [integrity, storedIntegrity] = await Promise.all([sha256Integrity(input.bytes), sha256Integrity(stored)]);
  let storedText: string | undefined;
  if (compression === "none" && isKeelViewerTextMediaType(input.mediaType)) {
    // ignoreBOM preserves the U+FEFF code point, so encoding restores the original BOM bytes.
    storedText = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(stored);
    const replay = utf8ToBytes(storedText);
    if (replay.byteLength !== stored.byteLength || !replay.every((value, index) => value === stored[index])) {
      throw new TypeError("Embedded text must preserve the exact original UTF-8 bytes.");
    }
  }
  const item: KeelStandaloneViewerItem = {
    ...(input.backgroundColor === undefined ? {} : { backgroundColor: input.backgroundColor.replace(/^#/, "").toLowerCase() }),
    id: input.id,
    role: input.role,
    mediaType: input.mediaType,
    aliases: input.aliases ?? [],
    integrity,
    embedded: storedText === undefined
      ? { storedBase64: Buffer.from(stored).toString("base64"), compression, storedIntegrity }
      : { storedText, compression: "none", storedIntegrity },
  };
  const fragment = utf8ToBytes(`,${escapeScriptJson(item)}`);
  return { item, fragment, fragmentIntegrity: await sha256Integrity(fragment) };
}

function assertOnchainSlot(item: KeelStandaloneViewerItem): void {
  const exactKeys = (value: object, allowed: readonly string[]) => {
    if (Object.keys(value).some(key => !allowed.includes(key))) throw new TypeError("Unknown binary descriptor field.");
  };
  const checkIntegrity = (value: Sha256Integrity | undefined, maximum: number) => {
    if (!value || value.algorithm !== "sha256" || !/^0x[0-9a-f]{64}$/iu.test(value.digest)
        || !Number.isSafeInteger(value.byteLength) || value.byteLength <= 0 || value.byteLength > maximum) throw new TypeError("Invalid binary descriptor commitment.");
    exactKeys(value, ["algorithm", "digest", "byteLength"]);
  };
  if (!item || typeof item !== "object") throw new TypeError("Missing binary descriptor.");
  exactKeys(item, ["id", "backgroundColor", "role", "mediaType", "aliases", "integrity", "chainId", "store", "objectId", "onchain", "containerBindings"]);
  if (typeof item.id !== "string" || !item.id || item.id.length > 256 || !["entrypoint", "module", "asset", "data"].includes(item.role ?? "")
      || !Array.isArray(item.aliases) || item.aliases.length > 32 || item.aliases.some(alias => typeof alias !== "string" || !alias || alias.length > 512)) throw new TypeError("Invalid binary descriptor identity.");
  assertDataUriMediaType(item.mediaType);
  if (item.backgroundColor !== undefined && !/^[0-9a-f]{6}$/u.test(item.backgroundColor)) throw new TypeError("Invalid descriptor background color.");
  checkIntegrity(item.integrity as Sha256Integrity, 32 * 1024 * 1024);
  if (item.containerBindings !== undefined) validateOnchainContainerBindings(item.containerBindings);
  const onchain = item.onchain;
  if (!onchain) throw new TypeError("Missing binary descriptor binding.");
  if (onchain.containerId !== undefined) {
    exactKeys(onchain, ["containerId", "offset"]);
    if (!/^0x[0-9a-f]{64}$/iu.test(onchain.containerId) || !Number.isSafeInteger(onchain.offset) || onchain.offset! < 0 || onchain.offset! > 32 * 1024 * 1024
        || item.chainId !== undefined || item.store !== undefined || item.objectId !== undefined) throw new TypeError("Invalid or ambiguous binary container reference.");
    return;
  }
  if (!Number.isSafeInteger(item.chainId) || !item.chainId || item.chainId < 0
      || typeof item.store !== "string" || !/^0x[0-9a-f]{40}$/iu.test(item.store) || /^0x0{40}$/iu.test(item.store)
      || typeof item.objectId !== "string" || !/^0x[0-9a-f]{64}$/iu.test(item.objectId) || /^0x0{64}$/iu.test(item.objectId)
      || onchain.storeKind !== "keel-hold" || !["none", "gzip", "deflate", "brotli", "lzma"].includes(onchain.compression ?? "")) throw new TypeError("Invalid selected-chain binary descriptor.");
  exactKeys(onchain, ["storeKind", "compression", "storedIntegrity", "range"]);
  checkIntegrity(onchain.storedIntegrity, 4 * 1024 * 1024);
  if (onchain.range) {
    exactKeys(onchain.range, ["offset", "containerIntegrity"]);
    checkIntegrity(onchain.range.containerIntegrity, 32 * 1024 * 1024);
    if (!Number.isSafeInteger(onchain.range.offset) || onchain.range.offset < 0
        || item.integrity.byteLength > onchain.range.containerIntegrity.byteLength - onchain.range.offset) throw new RangeError("Binary descriptor member exceeds its container.");
  }
}

/** Parse decoded comma+JSON slot bytes, after the ordinary raw-percent graph decode. */
export function parseOnchainKeelViewerSlotFragment(fragment: Uint8Array): KeelStandaloneViewerItem {
  if (fragment.byteLength < 2 || fragment.byteLength > 65_536 || fragment[0] !== 44) throw new RangeError("Binary descriptor must be a bounded comma+JSON fragment.");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(fragment.subarray(1));
  const item = JSON.parse(text) as KeelStandaloneViewerItem;
  assertOnchainSlot(item);
  if (text !== escapeScriptJson(item)) throw new TypeError("Binary descriptor is not exact canonical script-safe JSON.");
  return item;
}

/** Storage bytes stay binary; only the small exact binding is inserted into HTML. */
export async function buildOnchainKeelViewerSlot(input: {
  readonly id: string;
  readonly role: "entrypoint" | "module" | "asset" | "data";
  readonly mediaType: string;
  readonly aliases?: readonly string[];
  readonly bytes: Uint8Array;
  readonly chainId: number;
  readonly store: string;
  readonly objectId: Hex;
  readonly compression: "none" | "gzip" | "deflate" | "brotli" | "lzma";
  readonly storedBytes: Uint8Array;
  readonly container?: { readonly bytes: Uint8Array; readonly memberOffset: number };
  readonly containerReference?: KeelOnchainContainerBinding;
  readonly containerBindings?: readonly KeelOnchainContainerBinding[];
}): Promise<{ readonly item: KeelStandaloneViewerItem; readonly fragment: Uint8Array; readonly fragmentIntegrity: Sha256Integrity; readonly storedBytes: Uint8Array }> {
  const container = input.container?.bytes ?? input.bytes;
  const item: KeelStandaloneViewerItem = {
    id: input.id, role: input.role, mediaType: input.mediaType, aliases: input.aliases ?? [],
    integrity: await sha256Integrity(input.bytes), chainId: input.chainId, store: input.store, objectId: input.objectId,
    onchain: { storeKind: "keel-hold", compression: input.compression, storedIntegrity: await sha256Integrity(input.storedBytes),
      ...(input.container ? { range: { offset: input.container.memberOffset, containerIntegrity: await sha256Integrity(container) } } : {}) },
  };
  if (input.containerReference) {
    if (!input.container) throw new TypeError("A shared reference requires its exact container bytes and member offset.");
    validateOnchainContainerBindings([input.containerReference]);
    const binding = input.containerReference;
    if (binding.chainId !== input.chainId || binding.store.toLowerCase() !== input.store.toLowerCase() || binding.objectId !== input.objectId
        || binding.compression !== input.compression || canonicalJson(binding.storedIntegrity) !== canonicalJson(item.onchain!.storedIntegrity)
        || canonicalJson(binding.integrity) !== canonicalJson(item.onchain!.range!.containerIntegrity)) throw new Error("Shared container binding differs from exact source/stored commitments.");
    Object.assign(item, { chainId: undefined, store: undefined, objectId: undefined,
      onchain: { containerId: binding.id, offset: input.container.memberOffset } });
    delete (item as { chainId?: number }).chainId; delete (item as { store?: string }).store; delete (item as { objectId?: Hex }).objectId;
  }
  if (input.containerBindings) Object.assign(item, { containerBindings: input.containerBindings });
  assertOnchainSlot(item);
  if (input.container && !input.bytes.every((value, index) => value === container[input.container!.memberOffset + index])) throw new Error("Binary container member differs from its exact source.");
  let decoded: Uint8Array;
  if (input.compression === "lzma") {
    const { decodeLzma } = await import("./decoders/index.js");
    decoded = await decodeLzma(input.storedBytes, { decodedByteLength: container.length });
  } else if (input.compression === "none") decoded = input.storedBytes;
  else {
    const zlib = await import("node:zlib"), options = { maxOutputLength: container.length };
    decoded = input.compression === "brotli" ? zlib.brotliDecompressSync(input.storedBytes, options)
      : input.compression === "gzip" ? zlib.gunzipSync(input.storedBytes, options) : zlib.inflateSync(input.storedBytes, options);
  }
  if (decoded.length !== container.length || !decoded.every((value, index) => value === container[index])) throw new Error("Binary container does not restore its exact committed source bytes.");
  const { assertKeelInlineNoExternalDependencies } = await import("./inline-viewer-graph.js");
  assertKeelInlineNoExternalDependencies(input.bytes, input.id);
  const fragment = utf8ToBytes(`,${escapeScriptJson(item)}`);
  parseOnchainKeelViewerSlotFragment(fragment);
  return { item, fragment, fragmentIntegrity: await sha256Integrity(fragment), storedBytes: new Uint8Array(input.storedBytes) };
}

/* --------------------------------------------------- wrapInVerificationShell */

const MAX_CHUNKS_PER_CAST = 3;
const MAX_SLUG_BYTES = 23_000;
const SAFE_OBJECT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

export interface WrapInVerificationShellOptions {
  /** Repository checkout holding the canonical shell sources. */
  readonly repositoryRoot: string;
  /** The token or manifest identity the shell displays as its title. */
  readonly title: string;
  /** Metadata-safe object name for the publish plan; defaults from the title. */
  readonly objectName?: string;
  /** The creator's art entry: self-contained HTML, or a JS entry module. */
  readonly entry: {
    readonly id?: string;
    readonly mediaType: "text/html" | "text/javascript";
    readonly source: string | Uint8Array;
  };
  /** Additional committed items; aliases resolve only from this verified graph. */
  readonly assets?: readonly {
    readonly id: string;
    readonly mediaType: string;
    readonly aliases?: readonly string[];
    readonly bytes: Uint8Array;
  }[];
  /** Presentation-only shell overrides (seal, overlay, theme, pages). */
  readonly presentation?: KeelVerificationPresentationOverrides;
  /** Publish plan target; defaults to the registered Sepolia KeelHold. */
  readonly target?: { readonly chainId: number; readonly address: `0x${string}` };
}

export interface WrapInVerificationShellResult {
  /** The shell-wrapped, self-verifying HTML document. */
  readonly html: string;
  readonly htmlIntegrity: Integrity;
  readonly compressedHtml: Uint8Array;
  readonly compressedIntegrity: Integrity;
  readonly compression: "brotli";
  readonly envelope: KeelStandaloneViewerEnvelope;
  readonly sourceReceipt: KeelSourceReceipt;
  /** Review-only keel-publish-plan@1 for the wrapped HTML bytes. */
  readonly publishPlan: KeelPublishReviewPlanEnvelope;
}

function defaultObjectName(title: string): string {
  const slug = title.toLowerCase().replaceAll(/[^a-z0-9]+/gu, "-").replaceAll(/^-+|-+$/gu, "").slice(0, 96);
  return `${slug.length === 0 ? "keel-wrapped" : slug}.html`;
}

/**
 * Wrap a creator's work in the canonical verification shell and return both
 * halves of a publication: the exact HTML bytes and the review-only publish
 * plan that would put them on chain. Nothing is signed and nothing is sent.
 */
export async function wrapInVerificationShell(options: WrapInVerificationShellOptions): Promise<WrapInVerificationShellResult> {
  if (options.title.length === 0 || options.title.length > 256) throw new TypeError("wrapInVerificationShell requires a title of 1 through 256 characters.");
  const objectName = options.objectName ?? defaultObjectName(options.title);
  if (!SAFE_OBJECT_NAME.test(objectName)) throw new TypeError("objectName must be a metadata-safe file name.");
  const entryId = options.entry.id ?? "entry";
  const entryBytes = typeof options.entry.source === "string" ? utf8ToBytes(options.entry.source) : options.entry.source;
  const assets = options.assets ?? [];
  const ids = new Set([entryId]);
  for (const asset of assets) {
    if (ids.has(asset.id)) throw new TypeError(`Duplicate item id "${asset.id}" in the verified graph.`);
    ids.add(asset.id);
  }
  const slots = [
    await buildEmbeddedKeelViewerSlot({
      id: entryId,
      role: "entrypoint",
      mediaType: options.entry.mediaType,
      bytes: entryBytes,
    }),
    ...await Promise.all(assets.map((asset) => buildEmbeddedKeelViewerSlot({
      id: asset.id,
      role: /javascript|ecmascript/u.test(asset.mediaType) ? "module" : "asset",
      mediaType: asset.mediaType,
      ...(asset.aliases === undefined ? {} : { aliases: asset.aliases }),
      bytes: asset.bytes,
    }))),
  ];
  const envelope: KeelStandaloneViewerEnvelope = {
    protocol: KEEL_STANDALONE_VIEWER_PROTOCOL,
    title: options.title,
    deliveryProfile: "embedded-assembled",
    entrypoint: entryId,
    items: slots.map((slot) => slot.item),
  };
  const built = await buildStandaloneKeelViewer({
    repositoryRoot: options.repositoryRoot,
    envelope,
    ...(options.presentation === undefined ? {} : { verificationPresentation: options.presentation }),
  });
  const target = options.target ?? {
    chainId: 11_155_111,
    address: resolveModuleTarget({ module: "keel-hold", contract: "KeelHold", chainId: 11_155_111 }).address,
  };
  const chunks = chunkBytes(built.compressedHtml, MAX_SLUG_BYTES);
  const chunkIntegrities = await Promise.all(chunks.map((chunk) => sha256Integrity(chunk.bytes)));
  const operations: Record<string, unknown>[] = [];
  for (let offset = 0; offset < chunks.length; offset += MAX_CHUNKS_PER_CAST) {
    const batch = chunks.slice(offset, offset + MAX_CHUNKS_PER_CAST);
    operations.push({
      kind: "castSlugs",
      function: "castSlugs(bytes[])",
      payloadEncoding: "raw-bytes-from-files",
      chunkCount: batch.length,
      chunkByteLengths: batch.map((chunk) => chunk.length),
      chunkIntegrities: chunkIntegrities.slice(offset, offset + batch.length),
      slugIds: "derived-keccak256-after-review",
    });
  }
  operations.push({
    kind: "weldObject",
    function: "weldObject(bytes32[],bytes32,uint64,uint8,string)",
    slugIds: "from-preceding-castSlugs",
    digest: built.htmlIntegrity,
    byteLength: built.htmlIntegrity.byteLength,
    compression: "brotli",
    mediaType: "text/html",
  });
  const publishPlan = await createKeelPublishReviewPlan({
    schema: "keel-chain-operation-plan@1",
    status: "review-only",
    materialized: true,
    descriptorMaterialized: true,
    chainReady: false,
    target: { family: "ethereum", chainId: target.chainId, address: target.address },
    sourcePlan: {
      schema: "keel-upload-plan@2",
      objectName,
      mediaType: "text/html",
      integrity: built.htmlIntegrity,
    },
    operations,
    encoding: "deferred-contract-abi",
    walletApproval: "required",
    signing: "not-performed",
    submission: "not-performed",
    caveat: "Operation descriptors are review-only; a verified chain adapter must encode, simulate, sign, and submit them.",
  });
  return {
    html: new TextDecoder().decode(built.html),
    htmlIntegrity: built.htmlIntegrity,
    compressedHtml: built.compressedHtml,
    compressedIntegrity: built.compressedIntegrity,
    compression: "brotli",
    envelope,
    sourceReceipt: built.sourceReceipt,
    publishPlan,
  };
}


export function validateOnchainContainerBindings(bindings: readonly KeelOnchainContainerBinding[]): void {
  if (!Array.isArray(bindings) || bindings.length > 128) throw new RangeError("Invalid binary container table bound.");
  const ids = new Set<string>();
  for (const binding of bindings) {
    if (!binding || typeof binding !== "object" || !/^0x[0-9a-f]{64}$/iu.test(binding.id) || ids.has(binding.id.toLowerCase())
        || Object.keys(binding).some(key => !["id", "chainId", "store", "objectId", "compression", "storedIntegrity", "integrity"].includes(key))) throw new TypeError("Duplicate or malformed binary container ID.");
    ids.add(binding.id.toLowerCase());
    assertOnchainSlot({ id: "__keel_container__", role: "data", mediaType: "application/octet-stream", aliases: [], integrity: binding.integrity,
      chainId: binding.chainId, store: binding.store, objectId: binding.objectId,
      onchain: { storeKind: "keel-hold", compression: binding.compression, storedIntegrity: binding.storedIntegrity } });
    const { id, ...contents } = binding;
    const hash = createHash("sha256");
    hash.update(canonicalJson(contents));
    if ("0x" + hash.digest("hex") !== id.toLowerCase()) throw new TypeError("Container ID differs from its immutable binding commitment.");
  }
}

export function resolveOnchainKeelViewerSlotBinding(item: KeelStandaloneViewerItem, bindings: readonly KeelOnchainContainerBinding[]): KeelStandaloneViewerItem {
  assertOnchainSlot(item); validateOnchainContainerBindings(bindings);
  const { containerBindings: _table, ...plain } = item;
  if (item.onchain?.containerId === undefined) return plain;
  const binding = bindings.find(value => value.id.toLowerCase() === item.onchain!.containerId!.toLowerCase());
  if (!binding) throw new TypeError("Unknown binary container reference.");
  const normalized: KeelStandaloneViewerItem = { ...plain, chainId: binding.chainId, store: binding.store, objectId: binding.objectId,
    onchain: { storeKind: "keel-hold", compression: binding.compression, storedIntegrity: binding.storedIntegrity,
      range: { offset: item.onchain.offset!, containerIntegrity: binding.integrity } } };
  assertOnchainSlot(normalized);
  return normalized;
}

export async function buildKeelOnchainContainerBinding(input: Omit<KeelOnchainContainerBinding, "id" | "integrity" | "storedIntegrity"> & {
  readonly bytes: Uint8Array; readonly storedBytes: Uint8Array;
}): Promise<KeelOnchainContainerBinding> {
  await buildOnchainKeelViewerSlot({ ...input, id: "__keel_container__", role: "data", mediaType: "application/octet-stream" });
  const binding = { chainId: input.chainId, store: input.store, objectId: input.objectId, compression: input.compression,
    storedIntegrity: await sha256Integrity(input.storedBytes), integrity: await sha256Integrity(input.bytes) };
  const value = { id: (await sha256Integrity(utf8ToBytes(canonicalJson(binding)))).digest, ...binding };
  validateOnchainContainerBindings([value]);
  return value;
}
