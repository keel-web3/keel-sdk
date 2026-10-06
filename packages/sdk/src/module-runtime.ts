/** Node-side catalog preparation and byte verification. Browser shells use the
 * same versioned Base90 and bounded Brotli decoder, without runtime encoders. */
import { brotliDecompressSync } from "node:zlib";
import { createIntegrity } from "@keel/protocol";
import { decodeKeelDenseTransport } from "./dense-transport.js";
import { prepareKeelDensePayload } from "./prepared-dense-copy.js";

interface KeelModuleByteIntegrity { readonly algorithm: "sha256"; readonly digest: string; readonly byteLength: number; }
export interface KeelDenseModuleRuntime {
  readonly schema: "keel-module-runtime@2";
  readonly encoding: "base90";
  readonly transportProfile: "base90-v1";
  readonly compression: "brotli" | "none";
  readonly encryption: "none";
  readonly data: string;
  readonly format: string;
  readonly entry: string;
  readonly decodedIntegrity: KeelModuleByteIntegrity;
  readonly storedIntegrity: KeelModuleByteIntegrity;
}
export interface KeelLegacyModuleRuntime {
  readonly encoding: "base64";
  readonly data: string;
  readonly format: string;
  readonly entry: string;
}
export type KeelModuleRuntime = KeelDenseModuleRuntime | KeelLegacyModuleRuntime;
const LIMIT = 4 * 1024 * 1024;

export async function prepareKeelModuleRuntime(bytes: Uint8Array, options: { readonly format: string; readonly entry: string; readonly compression?: "auto" | "brotli" | "none" }): Promise<KeelDenseModuleRuntime> {
  if (bytes.length > LIMIT) throw new RangeError("Module runtime exceeds its byte bound.");
  const payload = prepareKeelDensePayload(bytes, options.compression === undefined ? {} : { compression: options.compression });
  const runtime: KeelDenseModuleRuntime = {
    schema: "keel-module-runtime@2", encoding: "base90", transportProfile: "base90-v1",
    compression: payload.compression, encryption: "none", data: payload.storedDense,
    format: options.format, entry: options.entry,
    decodedIntegrity: payload.decodedIntegrity, storedIntegrity: payload.storedIntegrity,
  };
  await decodeKeelModuleRuntime(runtime, payload.decodedIntegrity.digest);
  return runtime;
}

/** Authenticate compressed bytes before decompression and the exact source
 * digest afterwards. Legacy catalog records remain explicit and readable. */
export async function decodeKeelModuleRuntime(runtime: KeelModuleRuntime, expectedDigest: string): Promise<Uint8Array> {
  if (typeof expectedDigest !== "string" || !/^0x[0-9a-f]{64}$/u.test(expectedDigest) || typeof runtime.data !== "string" || runtime.data.length > 12_000_000) throw new TypeError("Invalid module runtime commitment.");
  let bytes: Uint8Array;
  if (runtime.encoding === "base64") {
    const decoded = Buffer.from(runtime.data, "base64");
    if (decoded.length > LIMIT || decoded.toString("base64") !== runtime.data) throw new TypeError("Invalid legacy module Base64.");
    bytes = new Uint8Array(decoded);
  } else {
    if (runtime.schema !== "keel-module-runtime@2" || runtime.encoding !== "base90" || runtime.transportProfile !== "base90-v1" || runtime.encryption !== "none" || !["none", "brotli"].includes(runtime.compression)) throw new TypeError("Unsupported module runtime transport.");
    for (const integrity of [runtime.storedIntegrity, runtime.decodedIntegrity]) {
      if (integrity.algorithm !== "sha256" || !/^0x[0-9a-f]{64}$/u.test(integrity.digest) || !Number.isSafeInteger(integrity.byteLength) || integrity.byteLength < 0 || integrity.byteLength > LIMIT) throw new TypeError("Invalid module runtime byte commitment.");
    }
    const stored = decodeKeelDenseTransport(runtime.data, { profile: runtime.transportProfile, byteLength: runtime.storedIntegrity.byteLength });
    if ((await createIntegrity(stored)).digest !== runtime.storedIntegrity.digest) throw new TypeError("Module stored digest differs.");
    bytes = runtime.compression === "brotli"
      ? new Uint8Array(brotliDecompressSync(stored, { maxOutputLength: Math.max(1, runtime.decodedIntegrity.byteLength) })) : stored;
    if (bytes.length !== runtime.decodedIntegrity.byteLength || runtime.decodedIntegrity.digest !== expectedDigest) throw new TypeError("Module decoded commitment differs.");
  }
  if ((await createIntegrity(bytes)).digest !== expectedDigest) throw new TypeError("Module runtime output digest differs.");
  return bytes;
}
