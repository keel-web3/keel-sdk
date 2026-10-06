# REDLINE carriage reference

The Sepolia REDLINE token 1 at `0xAe73eC8A4867C3886E8987371f0D57943f0f6BDB` was reread on 2026-10-05. Its 999,307-byte tokenURI matches SHA-256 `0x97d439dc242aaf12f5dc71db54bbd3f4a3f5c36cacd2a070a3a58483b3f89394`. The [reference manifest](../deployments/redline-sepolia-reference.json) pins the read block, authenticated deployment records and byte measurements. The collection uses a prepared carrier composer, not `KeelCreatorFactory`.

Its three compressed containers use PPMd. Base90 text is prepared before upload; the contract copies committed fragments. Only shell fragments use Base64, after gzip compression. There is no whole-document Base64 layer. Keep that existing codec/revision unchanged when reusing it.

`data:text/plain,Hello%20world` is valid. Arbitrary compressed bytes also survive `data:application/octet-stream,<percent-escaped-bytes>` exactly when read with `arrayBuffer()` before decompression. Do not use `text()` or `decodeURIComponent()` on compressed binary. Percent escaping is itself an encoding; it replaces many individual bytes with three-character `%XX` sequences. That has a different cost from dense carriage.

| REDLINE payload | Compressed bytes | Direct percent text | Base90 text | Base90 after strict nested preparation |
| --- | ---: | ---: | ---: | ---: |
| Creator dictionary | 642,835 | 1,597,495 | 792,542 | 1,105,950 |
| Shared dictionary | 114,700 | 285,132 | 141,417 | 197,821 |
| Build facts | 144 | 378 | 178 | 238 |

These are measured payload costs, not complete tokenURI totals or a new-storage quote. The direct percent column uses only unreserved ASCII literally; its percent signs require another escape when embedded in an outer data URI. Base90 also needs script-safe JSON and URI escaping at each parser boundary. Compare the complete prepared return including descriptors, decoder, shell and envelope before selecting a route.

The existing minted REDLINE URI round-trips through the byte reader but leaves punctuation literal that the newer strict URI compatibility check rejects. Its historical browser result does not override that result. Fresh preparation must use `serializeKeelDenseTransportJSON` and `toKeelDenseTransportDataURL` at both URI layers, then pass the complete publication check. Applying stricter carriage to the existing token requires an explicit revision and new-storage quote; this SDK update does not alter its on-chain objects.

New prepared dense shells default to Base90 and the compact Brotli decoder. Compression is independent: compare supported codecs and keep uncompressed bytes when smaller; preserve explicit LZMA, PPMd, URI81 and custom-shell choices. The bootstrap uses gzip/Base64 so it can reconstruct the Brotli decoder before any Brotli payload is decoded.
