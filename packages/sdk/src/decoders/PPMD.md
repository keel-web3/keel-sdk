# Optional PPMd JavaScript decoder

The `ppmd-js` shell profile adds the decode-only PPMd7H path generated from engine `packages/codec/native/ppmd`. Existing native/Brotli/LZMA shell profiles exclude it. `vendor/ppmd-runtime.ts` carries the generated code; `vendor/ppmd.ts` validates K7 v1, implements cooperative output steps, and disposes each task's arena. `decoders/index.ts` serializes PPMd jobs to avoid multiplying model memory and lets the queue continue after cancellation or failure.

Upstream: https://github.com/hasenbanck/ppmd-rust/, version 1.4.1, CC0-1.0 OR MIT-0. Both license texts are in this directory. Cargo.lock pins the crate checksum. The derived JavaScript SHA-256 is recorded in provenance.ts; selected shell registration commits the emitted decoder bytes as well.

K7 header bytes are 75, 55, model order, and log2 workspace size. The range stream has no end marker; the enclosing reader must supply and enforce the committed decoded length. Bounds are input ≤4 MiB, output ≤32 MiB, order 2–16, model 1–64 MiB, and a 104 MiB transient arena. Output steps stop at 65,536 bytes and use the existing work/yield/abort controls. The shell's 64 MiB profile is for browsers; it is not appropriate for Game Boy memory.

To reproduce, follow the engine native README using Rust 1.94 and wasm2js 132, then run `node scripts/build-ppmd-runtime.mjs cooperative.mjs`. This wrapper requires Terser 5.44.0, performs three passes, updates the derived hash and supports `--check` to compare without writing. No Python/PyPPMd package is shipped. A local decoder test or fixture is not public-chain or marketplace proof; register the exact codec/shell revision, bind real receipts and read back the actual collection call before publication.
