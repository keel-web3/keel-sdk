import type { Compression } from "./types.js";

/** Shared storage choice. It never changes shell verification or delivery. */
export const KEEL_PAYLOAD_STORAGE_MODES = ["compact", "raw"] as const;
export type KeelPayloadStorageMode = typeof KEEL_PAYLOAD_STORAGE_MODES[number];
export const KEEL_DEFAULT_PAYLOAD_STORAGE: KeelPayloadStorageMode = "compact";
export const KEEL_SHELL_CHOICES = ["keel-verification-shell", "none"] as const;
export type KeelShellChoice = typeof KEEL_SHELL_CHOICES[number];
export const KEEL_DEFAULT_SHELL: KeelShellChoice = "keel-verification-shell";
/** none keeps the creator's own HTML shell; it does not mean Raw storage. */
export function resolveKeelShell(value: unknown = KEEL_DEFAULT_SHELL): KeelShellChoice {
  if (value !== "keel-verification-shell" && value !== "none") throw new TypeError("viewer must be keel-verification-shell or none (creator-owned shell).");
  return value;
}
export const KEEL_PAYLOAD_STORAGE_POLICY = Object.freeze({
  schema: "keel-payload-storage-policy@1" as const,
  defaultMode: KEEL_DEFAULT_PAYLOAD_STORAGE,
  storedRepresentation: "native-bytes" as const,
  compact: "Choose lossless compression only when smaller; store the resulting bytes once.",
  raw: "Keep supplied bytes unchanged, with no automatic compression. Creator code and MIME remain under creator control.",
  encodingBoundary: "Shell/URI formatting is separate from stored objects. Encoding returned bytes does not imply a second stored copy.",
});

export function resolveKeelPayloadStorage(value: unknown = KEEL_DEFAULT_PAYLOAD_STORAGE): KeelPayloadStorageMode {
  if (value !== "compact" && value !== "raw") throw new TypeError("payloadStorage must be compact or raw.");
  return value;
}

export function keelPayloadCompressionPolicy(value?: KeelPayloadStorageMode): "auto" | "none" {
  return resolveKeelPayloadStorage(value) === "raw" ? "none" : "auto";
}

/** An explicit Raw choice cannot be undone by a stale compression argument. */
export function resolveKeelPayloadCompression(value?: KeelPayloadStorageMode, compression?: Compression | "auto"): Compression | "auto" {
  const mode = resolveKeelPayloadStorage(value);
  if (mode === "raw" && compression !== undefined && compression !== "none" && compression !== "auto") {
    throw new TypeError("Raw payload storage preserves supplied bytes; remove the compression override or select Compact.");
  }
  return mode === "raw" ? "none" : compression ?? "auto";
}
