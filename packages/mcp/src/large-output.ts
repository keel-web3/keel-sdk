import { createHash } from "node:crypto";
import path from "node:path";
import type { Workspace } from "./types.js";

/**
 * Inline MCP detail budget. toolResult repeats the value as text and structuredContent, and the stdio frame is capped
 * at 1 MiB, so anything larger than this is delivered as a workspace file instead.
 */
export const MCP_INLINE_RESULT_BYTES = 256 * 1024;

export interface WorkspaceFileDelivery {
  readonly mode: "workspace-file";
  readonly path: string;
  readonly absolutePath: string;
  readonly byteLength: number;
  readonly sha256: `0x${string}`;
  readonly reason: string;
}

export function sha256Hex(bytes: Uint8Array | string): `0x${string}` {
  const hash = createHash("sha256");
  hash.update(bytes);
  return `0x${String(hash.digest("hex"))}`;
}

/**
 * Return `result` inline when it fits; otherwise write the COMPLETE result to `outPath` inside the workspace and
 * return `summary` plus the file path and its SHA-256. A large result is never a reason to leave the MCP: the caller
 * reads or forwards the file, and the digest proves it is the exact bytes this tool produced.
 */
export async function deliverResult<T>(
  workspace: Workspace,
  result: T,
  options: { readonly outPath: string; readonly force?: boolean; readonly summary: (result: T) => Record<string, unknown> },
): Promise<T | Record<string, unknown>> {
  const text = `${JSON.stringify(result, null, 2)}\n`;
  const inlineBytes = new TextEncoder().encode(JSON.stringify(result)).byteLength;
  if (options.force !== true && inlineBytes <= MCP_INLINE_RESULT_BYTES) return result;
  const absolutePath = await workspace.writeText(options.outPath, text);
  const bytes = new TextEncoder().encode(text);
  const delivery: WorkspaceFileDelivery = {
    mode: "workspace-file",
    path: path.relative(workspace.root, absolutePath),
    absolutePath,
    byteLength: bytes.byteLength,
    sha256: sha256Hex(bytes),
    reason: options.force === true
      ? "The caller requested file delivery."
      : `The complete result is ${inlineBytes} bytes, above the ${MCP_INLINE_RESULT_BYTES}-byte inline MCP budget. It was written in full; verify sha256 before use.`,
  };
  return { ...options.summary(result), delivery };
}
