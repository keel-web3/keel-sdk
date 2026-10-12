import path from "node:path";
import { createKeelStudioAgentDraftClient } from "@keel/sdk/studio-agent-drafts";
import { loadStudioAgentToken } from "@keel/sdk/studio-connection-node";
import { resolveKeelEndpoints } from "@keel/sdk";
import type { ToolContext, ToolDefinition } from "./types.js";
const MAX_BYTES = 32 * 1024 * 1024;
function fields(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new TypeError("Unsupported private Studio arguments.");
  return value as Record<string, unknown>;
}
async function client(context: ToolContext, args: Record<string, unknown>) {
  if (args.studioUrl !== undefined && typeof args.studioUrl !== "string") throw new TypeError("studioUrl must be a Studio HTTPS origin.");
  const studioUrl = resolveKeelEndpoints({ ...(args.studioUrl === undefined ? {} : { studioUrl: args.studioUrl as string }) }, process.env).studioUrl;
  const grantToken = await loadStudioAgentToken({ workspace: context.workspace.root, studioUrl });
  context.signal?.throwIfAborted();
  return createKeelStudioAgentDraftClient({ studioUrl, grantToken });
}
export const STUDIO_PRIVATE_TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    descriptor: { name: "keel-studio-project", description: "Create or import a project through the authenticated Studio parser. Retain original files and a stable idempotencyKey. An approved creator grant is required before local bytes are read. No source replacement, payment, signing or publishing.", inputSchema: { type: "object", properties: {
      studioUrl: { type: "string" }, action: { type: "string", enum: ["create", "import"] }, fields: { type: "object", description: "For create: string form fields, including a stable idempotencyKey." },
      files: { type: "array", maxItems: 256, items: { type: "object", properties: { path: { type: "string" }, mediaType: { type: "string" } }, required: ["path"], additionalProperties: false } },
      source: { type: "object", description: "For import: the same import JSON accepted by Studio." },
    }, required: ["action"], additionalProperties: false } },
    async run(context, value) {
      const args = fields(value, ["studioUrl", "action", "fields", "files", "source"]), api = await client(context, args);
      if (args.action === "import") {
        if (args.fields !== undefined || args.files !== undefined || !args.source || typeof args.source !== "object" || Array.isArray(args.source)) throw new TypeError("Import needs only the original source object.");
        return api.importProject(args.source as Record<string, unknown>, context.signal);
      }
      if (args.action !== "create" || args.source !== undefined || !args.fields || typeof args.fields !== "object" || Array.isArray(args.fields)) throw new TypeError("Create needs the original Studio form fields.");
      const form = new FormData();
      for (const [key, value] of Object.entries(args.fields)) { if (key === "files" || typeof value !== "string") throw new TypeError("Form fields must be strings; files use workspace paths."); form.set(key, value); }
      if (args.files !== undefined && (!Array.isArray(args.files) || args.files.length > 256)) throw new RangeError("Select at most 256 original files.");
      let total = 0;
      for (const input of (args.files ?? []) as unknown[]) {
        const file = fields(input, ["path", "mediaType"]);
        if (typeof file.path !== "string" || (file.mediaType !== undefined && typeof file.mediaType !== "string")) throw new TypeError("Use a workspace path and optional media type.");
        context.signal?.throwIfAborted(); const source = await context.workspace.readFile(file.path, MAX_BYTES); total += source.bytes.byteLength;
        if (total > MAX_BYTES) throw new RangeError("The private project adapter accepts at most 32 MiB per request.");
        form.append("files", new File([new Uint8Array(source.bytes)], path.basename(source.path), { type: (file.mediaType as string | undefined) ?? "application/octet-stream" }));
      }
      context.signal?.throwIfAborted(); return api.createProject(form, context.signal);
    },
  },
  {
    descriptor: { name: "keel-studio-media", description: "Use Studio's authenticated media service: capabilities or exact frame/export from original workspace bytes with an explicit recipe. No source replacement, payment or publishing. Expired authentication is returned without automatic resubmission.", inputSchema: { type: "object", properties: {
      studioUrl: { type: "string" }, action: { type: "string", enum: ["capabilities", "frame", "export"] }, inputPath: { type: "string" }, recipe: { type: "object" }, mediaType: { type: "string" }, projectId: { type: "string" }, timeMs: { type: "number", minimum: 0, maximum: 3600000 },
    }, required: ["action"], additionalProperties: false } },
    async run(context, value) {
      const args = fields(value, ["studioUrl", "action", "inputPath", "recipe", "mediaType", "projectId", "timeMs"]), api = await client(context, args);
      if (args.action === "capabilities") {
        if (Object.keys(args).some(key => !["action", "studioUrl"].includes(key))) throw new TypeError("Capabilities does not take source bytes or a recipe.");
        return api.mediaCapabilities(context.signal);
      }
      if (!["frame", "export"].includes(String(args.action)) || typeof args.inputPath !== "string" || args.recipe === undefined) throw new TypeError("Choose frame/export with original inputPath and explicit recipe.");
      for (const key of ["mediaType", "projectId"]) if (args[key] !== undefined && typeof args[key] !== "string") throw new TypeError(`${key} must be text.`);
      if (args.timeMs !== undefined && (typeof args.timeMs !== "number" || !Number.isFinite(args.timeMs) || args.timeMs < 0 || args.timeMs > 3600000)) throw new TypeError("timeMs must be between 0 and 3600000.");
      const source = await context.workspace.readFile(args.inputPath, MAX_BYTES); context.signal?.throwIfAborted();
      return api.media(args.action as "frame" | "export", { bytesBase64: Buffer.from(source.bytes).toString("base64"), fileName: path.basename(source.path), recipe: args.recipe,
        ...(args.mediaType === undefined ? {} : { mediaType: args.mediaType as string }), ...(args.projectId === undefined ? {} : { projectId: args.projectId as string }), ...(args.timeMs === undefined ? {} : { timeMs: args.timeMs as number }) }, context.signal);
    },
  },
];
