# KEEL decode-only sources

These decode-only cores derive from official Google Brotli v1.2.0 and LZMA-JS2.3.2 sources pinned in provenance.ts. Full MIT notices remain in each derived source and minified build. No downloaded code executes at build preparation time except the locally vendored and tested implementation.

Local changes: cooperative task interfaces, eager Brotli output with16KiB copy fences, exact preallocated byte output, output/dictionary/work/probability bounds, strict LZMA input exhaustion, Uint8Array LZMA ring/output, no LZMA UTF-8 conversion or global worker hooks, and corrected reversed compound-dictionary bounds check in upstream Brotli. Raw shared dictionary inputs intentionally fail closed in the public adapter because actual native dictionary-stream parity is unresolved; the graph never enables that capability.

These are browser decoders, not native Game Boy decoders. Callers verify stored and decoded commitments around decoding. Default decode cap is32MiB output and4MiB dictionary, independently bounded. An explicit maximum64MiB dictionary is possible only through caller options. Supported LZMA-alone probability model has lc+lp<=4; pinned native build uses lc3/lp0/pb2 and4MiB dictionary.
