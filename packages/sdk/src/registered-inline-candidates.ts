import type { KeelRegisteredNativeGzipProof } from "./registered-native-gzip.js";
import { createHash } from "node:crypto";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { parseKeelExternalPreviewUri, canonicalJson } from "@keel/protocol";
import { decodeKeelInlineGraphFragment } from "./inline-viewer-graph.js";
import { assertKeelFreshPayloadCarriage, decodeKeelInlineDataURI, inspectKeelInlinePayloadCarriage,
  inspectKeelPreparedDenseCopyDocument, readKeelInlineJSONArray } from "./inline-transport-audit.js";

export type KeelRegisteredInlineCodec = "none" | "gzip" | "brotli";
type Hash = `0x${string}`;
type Commitment = { readonly digest: Hash; readonly byteLength: number };
export type KeelRegisteredInlineSource = { readonly id: string; readonly mediaType: string; readonly bytes: Uint8Array };
export type KeelRegisteredInlinePart = {
  readonly objectId: Hash;
  readonly bytes: Uint8Array;
  readonly disposition: "new" | "reused";
  /** A combined boot/decoder cannot be reported as a fabricated separate cost. */
  readonly role: "payload" | "shell" | "boot" | "decoder" | "boot-and-decoder" | "module" | "image" | "table" | "program";
};
/** The selected-chain adapter supplies this only after authenticating the real
 * registry, runtime and read-back. This local selector does not establish that
 * authentication or manufacture object identities/receipts. */
export interface KeelRegisteredInlineRecipe {
  readonly profile: string;
  readonly chainId: number;
  readonly store: Hash;
  readonly registry: Hash;
  readonly reader: Hash;
  readonly readerRuntimeCodeHash: Hash;
  readonly registrationDigest: Hash;
  readonly revision: number;
  readonly codec: KeelRegisteredInlineCodec;
  readonly sourceReader: "canonical-items";
  readonly registeredParts: readonly ({ readonly objectId: Hash; readonly role: KeelRegisteredInlinePart["role"] } & Commitment)[];
  /** Distinct from reader registration. The normal selected-chain adapter
   * authenticates these source-object receipts/read-backs before supplying
   * them. This selector only verifies bytes and binds that evidence identity. */
  readonly reusedSourceObjects?: readonly ({ readonly objectId: Hash; readonly role: "payload" | "image" | "table" | "program";
    readonly sourceIds: readonly string[]; readonly transactionHash: Hash; readonly blockHash: Hash; readonly evidenceDigest: Hash } & Commitment)[];
  readonly sharedSources?: readonly ({ readonly id: string; readonly mediaType: string } & Commitment)[];
}
export type KeelRegisteredInlineMeasurementScope =
  | { readonly kind: "provisional-template"; readonly templateDigest: Hash }
  | { readonly kind: "final-project-release"; readonly projectId: string; readonly sourceRevision: number;
      readonly releaseId: string; readonly releaseRevision: number; readonly contextDigest: Hash };
export type KeelRegisteredInlineBuiltCandidate = {
  readonly registeredNativeGzip?: KeelRegisteredNativeGzipProof;
  readonly recipeDigest: Hash;
  readonly tokenURI: string;
  /** Only the normal compiler's candidate-specific manifest/artifact bindings
   * may vary. Creator name, description and other shared fields cannot shrink. */
  readonly derivedMetadataFields?: Readonly<Record<string, unknown>>;
  /** Exact ordered raw-percent COPY parts. Their decoded concatenation plus
   * the normal compiler's generated suffix must equal the actual HTML return. */
  readonly documentParts: readonly KeelRegisteredInlinePart[];
  /** Actual non-document native objects, such as the committed packtable or
   * prepared image. Count them as well; they cannot replace document coverage. */
  readonly auxiliaryObjects?: readonly KeelRegisteredInlinePart[];
  readonly generatedHtmlSuffix?: Uint8Array;
};
export type KeelRegisteredInlineCandidate =
  | { readonly id: string; readonly status: "unavailable"; readonly codec: KeelRegisteredInlineCodec; readonly reason: string }
  | { readonly id: string; readonly status: "registered-recipe"; readonly recipe: KeelRegisteredInlineRecipe;
      readonly build: (input: { readonly sources: readonly KeelRegisteredInlineSource[]; readonly signal?: AbortSignal }) => Promise<KeelRegisteredInlineBuiltCandidate> };

const enc = new TextEncoder(), dec = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const HASH = /^0x[0-9a-f]{64}$/u, ADDRESS = /^0x[0-9a-f]{40}$/iu;
const sha = (bytes: Uint8Array): Hash => `0x${createHash("sha256").update(bytes).digest("hex")}`;
const bytesEqual = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));
const integer = (value: number, max: number, label: string) => {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new RangeError(`Invalid ${label}.`);
  return value;
};
function hash(value: string): asserts value is Hash { if (!HASH.test(value)) throw new TypeError("Invalid candidate commitment."); }
function record(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
    || Object.values(Object.getOwnPropertyDescriptors(value)).some(d => d.get || d.set)) throw new TypeError("Expected plain candidate data.");
}
function jsonSnapshot<T>(value: T): T {
  const visit = (node: unknown, depth: number): void => {
    if (depth > 24) throw new RangeError("Candidate data nesting exceeds its bound.");
    if (node === null || typeof node === "boolean" || typeof node === "string") return;
    if (typeof node === "number" && Number.isFinite(node)) return;
    if (Array.isArray(node)) { if (node.length > 512) throw new RangeError("Candidate data array exceeds its bound."); for (const item of node) visit(item, depth + 1); return; }
    record(node);
    if (Object.keys(node).length > 128) throw new RangeError("Candidate data record exceeds its bound.");
    for (const item of Object.values(node)) visit(item, depth + 1);
  };
  visit(value, 0);
  const text = canonicalJson(value);
  if (enc.encode(text).length > 256 * 1024) throw new RangeError("Candidate metadata/recipe exceeds its local preparation bound.");
  return JSON.parse(text) as T;
}
function recipeSnapshot(input: KeelRegisteredInlineRecipe) {
  const recipe = jsonSnapshot(input);
  integer(recipe.chainId, Number.MAX_SAFE_INTEGER, "candidate chain"); integer(recipe.revision, Number.MAX_SAFE_INTEGER, "reader revision");
  for (const address of [recipe.store, recipe.registry, recipe.reader]) if (!ADDRESS.test(address) || /^0x0{40}$/iu.test(address)) throw new TypeError("Invalid reader address.");
  hash(recipe.readerRuntimeCodeHash); hash(recipe.registrationDigest);
  if (!recipe.profile || recipe.profile.length > 160 || !["none", "gzip", "brotli"].includes(recipe.codec)
    || recipe.sourceReader !== "canonical-items"
    || !recipe.registeredParts.length || recipe.registeredParts.length > 128) throw new TypeError("Unsupported registered reader recipe.");
  const ids = new Set<string>();
  for (const part of recipe.registeredParts) {
    hash(part.objectId); hash(part.digest); integer(part.byteLength, 32 * 1024 * 1024, "registered part size");
    if (ids.has(part.objectId)) throw new TypeError("Duplicate registered part identity."); ids.add(part.objectId);
  }
  for (const part of recipe.reusedSourceObjects ?? []) {
    hash(part.objectId); hash(part.digest); hash(part.transactionHash); hash(part.blockHash); hash(part.evidenceDigest);
    integer(part.byteLength, 32 * 1024 * 1024, "reused source object size");
    if (ids.has(part.objectId) || !["payload", "image", "table", "program"].includes(part.role) || !part.sourceIds.length
      || new Set(part.sourceIds).size !== part.sourceIds.length) throw new TypeError("Ambiguous reused source object attribution.");
    ids.add(part.objectId);
  }
  return recipe;
}
export function keelRegisteredInlineRecipeDigest(recipe: KeelRegisteredInlineRecipe): Hash {
  return sha(enc.encode(canonicalJson(recipeSnapshot(recipe))));
}

function canonicalSources(html: Uint8Array, maximum: number) {
  const values = readKeelInlineJSONArray(dec.decode(html), "globalThis.__KEEL_ITEMS__=");
  const resources = [];
  let total = 0;
  for (const value of values) {
    if (value === null) continue;
    record(value); record(value.integrity); record(value.embedded);
    if (typeof value.id !== "string" || typeof value.mediaType !== "string" || value.integrity.algorithm !== "sha256"
      || typeof value.integrity.digest !== "string") throw new TypeError("Invalid canonical source descriptor.");
    const length = integer(Number(value.integrity.byteLength), maximum, "decoded member length"); total += length;
    if (total > maximum) throw new RangeError("Decoded candidate sources exceed the intake bound.");
    const embedded = value.embedded;
    const choices = ["storedText", "storedBase64"].filter(key => Object.hasOwn(embedded, key));
    if (choices.length !== 1) throw new TypeError("Ambiguous canonical source representation.");
    const literal = embedded[choices[0]!];
    if (typeof literal !== "string") throw new TypeError("Invalid canonical source carriage.");
    let stored: Uint8Array;
    if (choices[0] === "storedText") {
      if (embedded.compression !== "none") throw new TypeError("Text source cannot claim compressed carriage.");
      stored = enc.encode(literal); if (dec.decode(stored) !== literal) throw new TypeError("Invalid source UTF-8.");
    } else {
      stored = Uint8Array.from(Buffer.from(literal, "base64"));
      if (Buffer.from(stored).toString("base64") !== literal) throw new TypeError("Noncanonical source Base64.");
    }
    if (embedded.storedIntegrity !== undefined) {
      record(embedded.storedIntegrity);
      if (embedded.storedIntegrity.algorithm !== "sha256" || embedded.storedIntegrity.byteLength !== stored.length
        || embedded.storedIntegrity.digest !== sha(stored)) throw new TypeError("Canonical stored source integrity mismatch.");
    }
    const codec = embedded.compression;
    const bytes = codec === "none" ? stored : codec === "gzip" ? Uint8Array.from(gunzipSync(stored, { maxOutputLength: length }))
      : codec === "brotli" ? Uint8Array.from(brotliDecompressSync(stored, { maxOutputLength: length }))
      : (() => { throw new TypeError("Candidate uses an unsupported codec."); })();
    if (bytes.length !== length || sha(bytes) !== value.integrity.digest) throw new TypeError("Canonical source integrity mismatch.");
    resources.push({ id: value.id, mediaType: value.mediaType, bytes, compression: codec, descriptor: canonicalJson(value) });
  }
  return resources;
}

/** Local, serial and cancellable total-output comparison. Authentication,
 * actual graph/read limits, the final normal compiler and the same complete
 * simulation remain required. No result from this function authorizes funding. */
export async function selectKeelRegisteredInlineCandidate(input: {
  readonly sources: readonly KeelRegisteredInlineSource[];
  readonly collectorImage: { readonly mediaType: string; readonly bytes: Uint8Array; readonly externalURI?: string };
  readonly metadataFields: Readonly<Record<string, unknown>>;
  readonly measurementScope: KeelRegisteredInlineMeasurementScope;
  readonly requestedCompression?: "auto" | KeelRegisteredInlineCodec;
  readonly candidates: readonly KeelRegisteredInlineCandidate[];
  readonly maximumDecodedSourceBytes?: number;
  readonly maximumBuiltBytes?: number;
  readonly maximumTotalReturnedBytes?: number;
  readonly maximumBuildMilliseconds?: number;
  readonly signal?: AbortSignal;
}) {
  input.signal?.throwIfAborted();
  const maximum = integer(input.maximumDecodedSourceBytes ?? 32 * 1024 * 1024, 32 * 1024 * 1024, "source intake bound");
  const maxBuilt = integer(input.maximumBuiltBytes ?? 32 * 1024 * 1024, 64 * 1024 * 1024, "built candidate bound");
  const maxReturned = integer(input.maximumTotalReturnedBytes ?? 64 * 1024 * 1024, 128 * 1024 * 1024, "retained candidate memory bound");
  const buildMilliseconds = integer(input.maximumBuildMilliseconds ?? 30_000, 120_000, "candidate build deadline");
  if (!Array.isArray(input.sources) || !input.sources.length || input.sources.length > 128 || !Array.isArray(input.candidates)
    || !input.candidates.length || input.candidates.length > 8) throw new RangeError("Candidate/source count exceeds the local preparation bound.");
  const sources = input.sources.map(source => {
    if (!source.id || !source.mediaType || !(source.bytes instanceof Uint8Array)) throw new TypeError("Invalid candidate source.");
    return Object.freeze({ id: source.id, mediaType: source.mediaType, bytes: Uint8Array.from(source.bytes) });
  });
  const sourceIds = new Set(sources.map(source => source.id));
  if (sourceIds.size !== sources.length || sources.some(source => !source.bytes.length) || sources.reduce((n, source) => n + source.bytes.length, 0) > maximum) throw new RangeError("Invalid or oversized source inventory.");
  const image = { mediaType: input.collectorImage.mediaType, bytes: Uint8Array.from(input.collectorImage.bytes),
    ...(input.collectorImage.externalURI === undefined ? {} : { externalURI: parseKeelExternalPreviewUri(input.collectorImage.externalURI) }) };
  if (!image.bytes.length || image.bytes.length > maximum) throw new RangeError("Collector image exceeds its preparation bound.");
  const metadataFields = jsonSnapshot(input.metadataFields), scope = jsonSnapshot(input.measurementScope);
  if (Object.hasOwn(metadataFields, "image") || Object.hasOwn(metadataFields, "animation_url")) throw new TypeError("Metadata slots are measured from the actual candidate output.");
  if (scope.kind === "provisional-template") hash(scope.templateDigest);
  else if (scope.kind === "final-project-release") {
    if (!scope.projectId || !scope.releaseId) throw new TypeError("Final candidate measurement requires the exact project and release.");
    integer(scope.sourceRevision, Number.MAX_SAFE_INTEGER, "source revision"); integer(scope.releaseRevision, Number.MAX_SAFE_INTEGER, "release revision"); hash(scope.contextDigest);
  } else throw new TypeError("Invalid candidate measurement scope.");
  const requested = input.requestedCompression ?? "auto";
  if (!["auto", "none", "gzip", "brotli"].includes(requested)) throw new TypeError("Unsupported explicit candidate codec.");
  const candidateIds = new Set<string>();
  const candidates: KeelRegisteredInlineCandidate[] = input.candidates.map((candidate: KeelRegisteredInlineCandidate) => {
    if (!candidate.id || candidate.id.length > 160 || candidateIds.has(candidate.id)) throw new TypeError("Invalid or duplicate candidate ID."); candidateIds.add(candidate.id);
    if (candidate.status === "unavailable") {
      if (!candidate.reason || candidate.reason.length > 2048 || !["none", "gzip", "brotli"].includes(candidate.codec)) throw new TypeError("Unavailable candidates need a bounded actionable reason.");
      return { ...candidate };
    }
    if (candidate.status !== "registered-recipe" || typeof candidate.build !== "function") throw new TypeError("Invalid candidate builder.");
    return { id: candidate.id, status: candidate.status, recipe: recipeSnapshot(candidate.recipe), build: candidate.build };
  });
  const sourceCommitments = sources.map(source => ({ id: source.id, mediaType: source.mediaType, digest: sha(source.bytes), byteLength: source.bytes.length }));
  const measurements = [], filtered = []; let retainedReturnedBytes = 0;
  for (const candidate of candidates) {
    input.signal?.throwIfAborted();
    const codec = candidate.status === "unavailable" ? candidate.codec : candidate.recipe.codec;
    if (requested !== "auto" && requested !== codec) { filtered.push({ id: candidate.id, codec, reason: "explicit-codec-preserved" }); continue; }
    if (candidate.status === "unavailable") { filtered.push({ id: candidate.id, codec, reason: candidate.reason }); continue; }
    const recipe = candidate.recipe, recipeDigest = keelRegisteredInlineRecipeDigest(recipe);
    if (recipe.reusedSourceObjects?.some(part => part.sourceIds.some(id => !sourceIds.has(id)))) throw new TypeError("Reused object attribution differs from the exact source snapshot.");
    // Builders receive isolated copies; even a mutating asynchronous builder
    // cannot alter the shared source snapshot or another candidate's input.
    const buildSources = sources.map(source => ({ ...source, bytes: Uint8Array.from(source.bytes) }));
    const deadline = new AbortController();
    const signal = input.signal === undefined ? deadline.signal : AbortSignal.any([input.signal, deadline.signal]);
    const timer = setTimeout(() => deadline.abort(new Error("Registered candidate build deadline exceeded.")), buildMilliseconds);
    let onAbort: (() => void) | undefined;
    let built: KeelRegisteredInlineBuiltCandidate;
    try {
      built = await new Promise<KeelRegisteredInlineBuiltCandidate>((resolve, reject) => {
        onAbort = () => reject(signal.reason); signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) { reject(signal.reason); return; }
        Promise.resolve().then(() => candidate.build({ sources: buildSources, signal })).then(resolve, reject);
      });
    } finally { clearTimeout(timer); if (onAbort) signal.removeEventListener("abort", onAbort); }
    input.signal?.throwIfAborted();
    if (buildSources.some((source, i) => !bytesEqual(source.bytes, sources[i]!.bytes))) throw new TypeError("Candidate builder mutated its source input.");
    if (built.recipeDigest !== recipeDigest || typeof built.tokenURI !== "string" || enc.encode(built.tokenURI).length > maxBuilt) throw new TypeError("Candidate output changed recipe or exceeded its measured byte bound.");
    if (Object.hasOwn(built, "sharedImageProgram") || Object.hasOwn(built, "tableDigest")) throw new TypeError("Retired candidate container adapters cannot be selected for current publication.");
    const tokenURI = built.tokenURI;
    retainedReturnedBytes += enc.encode(tokenURI).length;
    if (retainedReturnedBytes > maxReturned) throw new RangeError("Retained candidate returns exceed the local comparison memory bound.");
    const metadataBytes = decodeKeelInlineDataURI(tokenURI, "application/json", maxBuilt);
    const metadata: unknown = JSON.parse(dec.decode(metadataBytes)); record(metadata);
    const { image: imageURI, animation_url: animationURI, ...actualFields } = metadata;
    const derived = jsonSnapshot(built.derivedMetadataFields ?? {});
    if (Object.keys(derived).some(key => !["keel_manifest", "keel_manifest_digest", "keel_artifact", "keel_erc4804_metadata"].includes(key)
      || Object.hasOwn(metadataFields, key))) throw new TypeError("Candidate cannot change invariant metadata fields.");
    if (derived.keel_manifest_digest !== undefined) { if (typeof derived.keel_manifest_digest !== "string") throw new TypeError("Invalid derived manifest digest."); hash(derived.keel_manifest_digest); }
    if (canonicalJson(actualFields) !== canonicalJson({ ...metadataFields, ...derived })) throw new TypeError("Candidate changed the requested metadata/context fields.");
    const actualImage = image.externalURI === undefined ? decodeKeelInlineDataURI(imageURI, "image/", maxBuilt) : image.bytes;
    if (image.externalURI !== undefined ? imageURI !== image.externalURI : typeof imageURI !== "string" || imageURI.slice(5, imageURI.indexOf(",")).split(";", 1)[0] !== image.mediaType
      || !bytesEqual(actualImage, image.bytes)) throw new TypeError("Candidate changed the exact collector image or explicit external URI.");
    const html = decodeKeelInlineDataURI(animationURI, "text/html", maxBuilt);
    assertKeelFreshPayloadCarriage(html, { registeredNativeGzip: built.registeredNativeGzip });
    const carriage = inspectKeelInlinePayloadCarriage(html, { registeredNativeGzip: built.registeredNativeGzip });
    if (!Array.isArray(built.documentParts) || !built.documentParts.length || built.documentParts.length > 256) throw new RangeError("Invalid document part count.");
    const parts = built.documentParts.map((part: KeelRegisteredInlinePart) => ({ ...part, bytes: Uint8Array.from(part.bytes) }));
    if (built.auxiliaryObjects !== undefined && (!Array.isArray(built.auxiliaryObjects) || built.auxiliaryObjects.length > 128)) throw new RangeError("Invalid auxiliary object count.");
    const auxiliary = (built.auxiliaryObjects ?? []).map(part => ({ ...part, bytes: Uint8Array.from(part.bytes) }));
    const suffix = built.generatedHtmlSuffix === undefined ? new Uint8Array() : Uint8Array.from(built.generatedHtmlSuffix);
    const unique = new Map<string, typeof parts[number]>(); let physical = suffix.length;
    const decodedParts = [];
    for (const [index, part] of [...parts, ...auxiliary].entries()) {
      hash(part.objectId);
      if (!["new", "reused"].includes(part.disposition) || !["payload", "shell", "boot", "decoder", "boot-and-decoder", "module", "image", "table", "program"].includes(part.role)) throw new TypeError("Invalid stored part role/disposition.");
      physical += part.bytes.length;
      if (!part.bytes.length || physical > maxBuilt) throw new RangeError("Stored candidate parts exceed the measured byte bound.");
      const known = unique.get(part.objectId);
      if (known && (!bytesEqual(known.bytes, part.bytes) || known.disposition !== part.disposition || known.role !== part.role)) throw new TypeError("Conflicting same-object candidate parts.");
      unique.set(part.objectId, part);
      const registered = [...recipe.registeredParts, ...recipe.reusedSourceObjects ?? []].find(value => value.objectId === part.objectId);
      if (part.disposition === "reused" && (!registered || registered.digest !== sha(part.bytes) || registered.byteLength !== part.bytes.length || registered.role !== part.role)
        || registered && part.disposition !== "reused") throw new TypeError("Reused bytes differ from the authenticated reader recipe.");
      if (index < parts.length) decodedParts.push(decodeKeelInlineGraphFragment(part.bytes, "application/vnd.keel.token-uri-raw-percent-fragment"));
      else if (part.role !== "image" || !bytesEqual(part.bytes, image.bytes) && !bytesEqual(part.bytes, enc.encode(imageURI as string))) throw new TypeError("Unbound auxiliary candidate object.");
    }
    for (const registered of recipe.registeredParts) if (!unique.has(registered.objectId)) throw new TypeError("Candidate omitted a registered decoder/boot/module part.");
    for (const reused of recipe.reusedSourceObjects ?? []) if (!unique.has(reused.objectId)) throw new TypeError("Candidate omitted an authenticated reused source object.");
    if (!bytesEqual(Buffer.concat([...decodedParts, suffix]), html)) throw new TypeError("Stored document parts do not cover the actual returned HTML.");
    const registeredModuleDescriptors = parts.filter(part => part.disposition === "reused" && part.role === "module"
      && recipe.registeredParts.some(registered => registered.objectId === part.objectId && registered.role === "module")).map(part => {
        const text = dec.decode(decodeKeelInlineGraphFragment(part.bytes, "application/vnd.keel.token-uri-raw-percent-fragment"));
        if (!text.startsWith(",")) throw new TypeError("A registered module part must carry one exact resource descriptor.");
        const descriptor: unknown = JSON.parse(text.slice(1)); record(descriptor);
        return canonicalJson(descriptor);
      });
    if (inspectKeelPreparedDenseCopyDocument(dec.decode(html)) !== undefined) throw new TypeError("Current registered candidates require canonical resource items, not a compatibility container.");
    const nativeBrowserGzip = built.registeredNativeGzip !== undefined;
    const resources = canonicalSources(html, maximum);
    input.signal?.throwIfAborted();
    const seen = new Set<string>();
    for (const resource of resources) {
      if (seen.has(resource.id)) throw new TypeError("Duplicate candidate source membership."); seen.add(resource.id);
      const expected = sources.find(source => source.id === resource.id);
      if (expected) {
        if (resource.mediaType !== expected.mediaType || !bytesEqual(resource.bytes, expected.bytes)) throw new TypeError("Candidate changed an original source or its MIME.");
      } else {
        const shared = recipe.sharedSources?.find(source => source.id === resource.id);
        if (!shared || shared.mediaType !== resource.mediaType || shared.digest !== sha(resource.bytes) || shared.byteLength !== resource.bytes.length) throw new TypeError("Candidate introduced an unregistered source member.");
      }
      const resourceCodec = "compression" in resource ? resource.compression : undefined;
      if (expected) {
        if (resourceCodec !== undefined && resourceCodec !== "none" && resourceCodec !== recipe.codec) throw new TypeError("Candidate silently changed its selected codec.");
      } else if (resourceCodec !== "none") {
        // A creator's codec choice cannot re-encode an immutable shared module.
        // Only an exact registered reused module descriptor with the final
        // document's native-Gzip proof may retain its independent codec.
        if (resourceCodec !== "gzip" || registeredModuleDescriptors.filter(value => value === resource.descriptor).length !== 1
          || !built.registeredNativeGzip?.members.some(member => member.id === resource.id && member.mediaType === resource.mediaType
            && member.integrity.digest === sha(resource.bytes) && member.integrity.byteLength === resource.bytes.length)) {
          throw new TypeError("A compressed shared source lacks its exact registered module and native-Gzip proof.");
        }
      }
    }
    if (sources.some(source => !seen.has(source.id))) throw new TypeError("Candidate omitted an original source.");
    if (input.sources.length !== sources.length || input.sources.some((source, i) => source.id !== sources[i]!.id
      || source.mediaType !== sources[i]!.mediaType || !bytesEqual(source.bytes, sources[i]!.bytes))) throw new TypeError("Source changed while candidates were being measured.");
    const objects = [...unique.values()];
    const sum = (predicate: (part: typeof objects[number]) => boolean) => objects.filter(predicate).reduce((n, part) => n + part.bytes.length, 0);
    const completeTokenURIBytes = enc.encode(tokenURI).length;
    const measured = { id: candidate.id, codec, recipeDigest, measurementScope: scope,
      tokenURI, tokenURICommitment: { digest: sha(enc.encode(tokenURI)), byteLength: completeTokenURIBytes },
      derivedMetadataDigest: sha(enc.encode(canonicalJson(derived))),
      metadataBytes: metadataBytes.length, htmlBytes: html.length, imageBytes: actualImage.length,
      imageURIBytes: enc.encode(imageURI as string).length, imageDelivery: image.externalURI === undefined ? "inline" as const : "explicit-external" as const,
      externalPreviewReadAuthenticated: false as const, animationURIBytes: enc.encode(animationURI as string).length,
      sourceBytes: sources.reduce((n, source) => n + source.bytes.length, 0),
      compressedPayloadBytes: carriage.packedPayloadBytes, encodedPayloadBytes: carriage.payloadTextCarriageBytes,
      completeTokenURIBytes, newStoredBytes: sum(part => part.disposition === "new"), reusedStoredBytes: sum(part => part.disposition === "reused"),
      uniqueStoredBytes: sum(() => true), uniqueObjects: objects.length,
      decoderObjectBytes: sum(part => part.role === "decoder"), bootObjectBytes: sum(part => part.role === "boot"),
      combinedBootDecoderObjectBytes: sum(part => part.role === "boot-and-decoder"), generatedHtmlSuffixBytes: suffix.length,
      nativeBrowserGzip, javascriptCodecDecoderBytes: nativeBrowserGzip ? 0 : null,
      /** Zero standalone decoder objects is not proof of zero inlined decoder code. */
      decoderCostScope: "exact-distinct-stored-object-roles" as const,
      ...(built.registeredNativeGzip === undefined ? {} : { nativeBrowserGzip: true as const, javascriptGzipDecoderBytes: 0 as const }), sourceByteIdentity: "verified-exact" as const };
    measurements.push(Object.freeze(measured));
  }
  measurements.sort((a, b) => a.completeTokenURIBytes - b.completeTokenURIBytes || a.newStoredBytes - b.newStoredBytes || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const summary = measurements.map(({ tokenURI: _uri, ...value }) => value);
  return Object.freeze({ schema: "keel-registered-inline-candidates@1" as const, requestedCompression: requested, sourceCommitments,
    measurementScope: scope, candidates: Object.freeze(measurements), filtered: Object.freeze(filtered),
    selected: measurements[0], ranking: "complete-token-uri-then-new-stored-bytes-then-id" as const,
    selectionStatus: scope.kind === "final-project-release" ? "measured-final-inputs" as const : "provisional-do-not-adopt" as const,
    measurementDigest: sha(enc.encode(canonicalJson({ sourceCommitments, collectorImage: { ...(image.externalURI === undefined ? {} : { externalURI: image.externalURI }), mediaType: image.mediaType, digest: sha(image.bytes), byteLength: image.bytes.length }, metadataFields, scope, summary, filtered }))),
    publicationReady: false as const, walletApprovalAuthorized: false as const, requiresFullSimulation: true as const });
}
