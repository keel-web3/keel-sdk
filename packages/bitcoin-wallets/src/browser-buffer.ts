import { Buffer } from "buffer";

// BIP-322 initializes its tag at module evaluation, before any API call.
const runtime = globalThis as unknown as { Buffer?: typeof Buffer };
runtime.Buffer ??= Buffer;
