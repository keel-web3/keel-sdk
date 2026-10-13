import path from "node:path";
import type { ToolDefinition } from "./types.js";

const MAX_BYTES = 32 * 1024 * 1024;
let active = 0;
const inputProperties = {
  inputPath: { type: "string" as const, maxLength: 4096, description: "Original source file inside the MCP workspace; URLs and external paths are not accepted." },
  mediaType: { type: "string" as const, maxLength: 255, description: "Optional original export MIME label; support is probed from bytes, never inferred from this value." },
  recipe: { type: "object" as const, description: "Explicit keel-media-edit@1 reversible recipe: schema, mode original/lossless/lossy, format original/webp/avif/mp4/mov/webm, quality 1–100, noSound boolean; optional still-image crop, width, height, rotate and up to eight ordered duplicate-original layers (left, top, width, height, opacity, rotate). Layer coordinates use the edited output canvas; animated layers and implicit clipping are rejected. Unsupported operations fail without changing source." },
  timeMs: { type: "number" as const, minimum: 0, maximum: 3_600_000 },
};
export const MEDIA_EDIT_TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    descriptor: { name: "keel-media-capabilities", description: "Discover the actual local decoder/encoder capabilities for the same reversible media pipeline used by Studio. Keeping original bytes does not require a decoder. No uploads, storage changes, shell choices or publication.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    async run(_context, input) {
      if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length) throw new TypeError("Media capabilities takes no arguments.");
      const capabilities = await (await import("@keel/builder/media-preparation")).getMediaPreparationCapabilities();
      return { ...capabilities, limits: { ...capabilities.limits, maxInputBytes: MAX_BYTES, maxOutputBytes: MAX_BYTES, maxOperationMs: 180_000 }, sourcePreserved: true, externalUploads: false, persisted: false };
    },
  },
  ...(["candidate", "compare"] as const).map((action): ToolDefinition => ({
    descriptor: { name: `keel-media-${action}`, description: action === "compare"
      ? "Return synchronized original/candidate PNG frames at one source timestamp using the exact Studio media pipeline. Full frames/timing and explicit audio/lossy choices are verified; unsupported routes retain original. Source is never changed. No files are written or uploaded; no signing or funding."
      : "Prepare a reversible media candidate with exact byte measurements, source/output integrity and explicit recipe. Returns output as base64 without writing or replacing source. Original mode preserves any bytes unchanged; lossy conversion and No sound must be explicit. Candidate readiness is separate from browser/shell compatibility and complete-tokenURI funding checks.",
      inputSchema: { type: "object", properties: inputProperties, required: ["inputPath", "recipe"], additionalProperties: false } },
    async run(context, input) {
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Media preparation needs an inputPath and explicit recipe.");
      const args = input as Record<string, unknown>;
      if (Object.keys(args).some(key => !Object.hasOwn(inputProperties, key)) || typeof args.inputPath !== "string" || (args.mediaType !== undefined && (typeof args.mediaType !== "string" || args.mediaType.length > 255))) throw new TypeError("Invalid media preparation request.");
      const timeMs = args.timeMs ?? 0;
      if (typeof timeMs !== "number" || !Number.isFinite(timeMs) || timeMs < 0 || timeMs > 3_600_000) throw new RangeError("Comparison time must be 0–3,600,000 ms.");
      if (active >= 2) throw new Error("Media preparation is busy. Wait for an existing job to finish.");
      active++;
      try {
        const source = await context.workspace.readFile(args.inputPath, MAX_BYTES);
        const pipeline = await import("@keel/builder/media-preparation");
        const request = { bytes: source.bytes, recipe: args.recipe, signal: AbortSignal.timeout(180_000), ...(typeof args.mediaType === "string" ? { mediaType: args.mediaType } : {}) };
        if (action === "compare") {
          const result = await pipeline.compareMediaFrames({ ...request, timeMs });
          if (result.originalFrame.byteLength + result.processedFrame.byteLength > MAX_BYTES) throw new RangeError("Comparison frames exceed the 32 MiB response budget. Original unchanged.");
          return { ...result, originalFrame: Buffer.from(result.originalFrame).toString("base64"), processedFrame: Buffer.from(result.processedFrame).toString("base64"), inputPath: args.inputPath, persisted: false };
        }
        const result = await pipeline.prepareMediaCandidate(request);
        if (result.bytes.byteLength > MAX_BYTES) throw new RangeError("Candidate exceeds the 32 MiB response budget. Original unchanged.");
        const { bytes, ...evidence } = result;
        const sourcePath = path.relative(context.workspace.root, source.path).split(path.sep).join("/");
        const mediaEdits = { schema: "keel-studio-media-edits@1", edits: [{ sourcePath, sourceSha256: result.sourceIntegrity.digest, recipe: result.recipe }] };
        return { ...evidence, mediaEdits, handoffInstructions: "Save mediaEdits as media-edit.json and stage it with the unchanged source. The original remains active unless the creator explicitly applies the returned candidate: then also stage its bytes at a separate candidatePath and add that path to this edit. Never replace or omit the source. Control metadata is not collector payload.", bytesBase64: Buffer.from(bytes).toString("base64"), inputPath: args.inputPath, persisted: false, publication: "not-performed" };
      } finally { active--; }
    },
  })),
];
