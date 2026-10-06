import { assertKeelPreparedCopyRead } from "@keel/sdk";
import type { ToolContext, ToolDefinition } from "./types.js";

export const COPY_READ_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    graphPath: { type: "string", minLength: 1, maxLength: 2048 },
    expectedTokenURIPath: { type: "string", minLength: 1, maxLength: 2048 },
    returnedTokenURIPath: { type: "string", minLength: 1, maxLength: 2048 },
    callGasLimit: { type: "string", pattern: "^[1-9][0-9]*$", maxLength: 78 },
    blockGasLimit: { type: "string", pattern: "^[1-9][0-9]*$", maxLength: 78 },
  }, required: ["graphPath", "expectedTokenURIPath", "returnedTokenURIPath", "callGasLimit", "blockGasLimit"],
} as const;

export async function checkCopyReadFiles(context: ToolContext, value: unknown, source: {
  readonly chainId: number; readonly store: string; readonly mediaType: string;
  readonly integrity: { readonly algorithm: "sha256"; readonly digest: `0x${string}`; readonly byteLength: number };
}) {
  return assertKeelPreparedCopyRead({ ...source, graphIntegrity: source.integrity,
    ...await loadCopyReadFiles(context, value) });
}

export async function loadCopyReadFiles(context: ToolContext, value: unknown) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Prepared-fragment publication requires preparedCopy read evidence. Call keel-inline-publication-check before publish-plan.");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !Object.hasOwn(COPY_READ_SCHEMA.properties, key))) throw new TypeError("Unsupported prepared COPY read evidence.");
  for (const key of COPY_READ_SCHEMA.required) if (typeof input[key] !== "string" || !input[key]) throw new TypeError(`Missing prepared COPY evidence ${key}.`);
  if (!/^[1-9][0-9]{0,77}$/u.test(input.callGasLimit as string) || !/^[1-9][0-9]{0,77}$/u.test(input.blockGasLimit as string)) throw new TypeError("Invalid prepared COPY read gas boundary.");
  const [graph, expected, returned] = await Promise.all([
    context.workspace.readFile(input.graphPath as string, 2_000_000),
    context.workspace.readFile(input.expectedTokenURIPath as string, 2_000_000),
    context.workspace.readFile(input.returnedTokenURIPath as string, 2_000_000),
  ]);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  return { graphBytes: graph.bytes,
    expectedTokenURI: decoder.decode(expected.bytes), returnedTokenURI: decoder.decode(returned.bytes),
    callGasLimit: BigInt(input.callGasLimit as string), blockGasLimit: BigInt(input.blockGasLimit as string) };
}

export const COPY_READ_TOOL_DEFINITIONS: readonly ToolDefinition[] = [{
  descriptor: {
    name: "keel-inline-publication-check",
    description: "Mandatory byte/route check for prepared-fragment publish-plan: compare the complete collection tokenURI with canonical prepared COPY, including image, envelope and exact graph commitment. Reject unescaped URI characters at both metadata and animation layers, extra wrappers, changed bytes, custom transport, external dependencies and oversized reads. Browser playback does not establish URI compatibility. Existing aligned Base64/percent fragments retain their original builder. Local files/caller-supplied gas are review evidence; this does not authenticate a chain read or sign/submit.",
    inputSchema: { type: "object", additionalProperties: false, properties: {
      ...COPY_READ_SCHEMA.properties,
      chainId: { type: "integer", minimum: 1 }, store: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
      mediaType: { type: "string", maxLength: 128 },
      digest: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" }, byteLength: { type: "integer", minimum: 1, maximum: 2_000_000 },
    }, required: [...COPY_READ_SCHEMA.required, "chainId", "store", "mediaType", "digest", "byteLength"] },
  },
  async run(context, value) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("COPY read arguments must be an object.");
    const { chainId, store, mediaType, digest, byteLength, ...files } = value as Record<string, unknown>;
    if (typeof digest !== "string" || !/^0x[0-9a-f]{64}$/iu.test(digest) || typeof byteLength !== "number" || !Number.isSafeInteger(byteLength) || byteLength < 1) throw new TypeError("Invalid COPY graph commitment.");
    if (typeof chainId !== "number" || typeof store !== "string" || typeof mediaType !== "string") throw new TypeError("Invalid COPY chain/store/media binding.");
    const preparedCopy = await checkCopyReadFiles(context, files, { chainId, store, mediaType,
      integrity: { algorithm: "sha256", digest: digest as `0x${string}`, byteLength } });
    return { status: "review-only", chainReady: false, preparedCopy, signing: "not-performed", submission: "not-performed" };
  },
}];
