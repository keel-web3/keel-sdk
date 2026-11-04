import { Buffer } from "buffer";

// BIP-322's browser-compatible dependency still reads the standard Buffer global.
const runtime = globalThis as unknown as { Buffer?: typeof Buffer };
runtime.Buffer ??= Buffer;

export * from "./index.js";
