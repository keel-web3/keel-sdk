# Prepared dense COPY for collector Inline binary work

For new collector Inline binary content, prepare transport before uploading. Compress the source first, encode the resulting bytes as `base90-v1`, and store the prepared text once. The contract copies committed fragments; it does not encode or decompress the payload. The browser decodes the shell's Base64 literals and separate Base90 payloads, checks stored/decoded/member commitments, then mounts the selected shell.

`buildKeelPreparedDenseCopyShell({embeddedContainerDelivery:{chainId,store},codecProfile:"brotli-js"})` is exported from `@keel/sdk`. It defaults to Base90 carriage and the compact Brotli decoder (`codecProfile: "brotli-js"`). Percent escape the prepared text at each URI boundary and use script-safe JSON serialization; Base90 does not bypass those parsers. Compression remains a separate preparation step: compare supported lossless codecs and keep none if compression does not save bytes. Explicit URI81, Base91, LZMA and PPMd profiles remain supported. The complete HTML and JSON data URIs stay raw-percent; only the canonical prefix and suffix are Base64 literals inside the bootstrap. By default, these two shell fragments are losslessly gzip-compressed before their Base64 carriage (`shellBootCompression: "gzip"`); the decoded canonical shell bytes and commitments remain identical. This saves shell storage without putting game payloads inside Base64. The browser needs `DecompressionStream("gzip")`; use explicit `shellBootCompression: "none"` for a reader that does not support it, and include that larger shell in the complete URI budget. Payloads remain outside those literals. The bootstrap waits for authoritative token context before reconstructing the exact canonical document.

Use `encodeKeelDenseTransport`, `serializeKeelDenseTransportJSON`, and `toKeelDenseTransportDataURL` for payload preparation. The dense URI serializer follows RFC 2397/2396: escape controls, spaces, Unicode, percent, hash, quotes, angle brackets and excluded braces, brackets, pipe, backslash, caret and backtick at each URI boundary. Base90 text still requires this escaping. It leaves `?` directly in the payload. The audit accepts URL normalization only when the MIME type and decoded UTF-8 body remain exact. Base90 excludes quote, backslash, percent and hash, but still includes other excluded URI punctuation. Preserve the separate JSON and HTML contexts; do not replace URI escaping with HTML entities. The JSON serializer still protects the actual script terminator boundary. These are separate contexts, not a reason to escape every punctuation character.

`inspectKeelPreparedDenseCopyDocument` statically parses the two shell literals and data arrays without executing artwork, including bounded gzip shell reconstruction. `inspectKeelInlinePayloadCarriage` and `keel-inline-token-audit` look through this wrapper, reconstruct all compressed payloads and check their SHA-256. Their measurements distinguish compressed source bytes, dense text, shell framing and the complete token URI.

Before publishing, use `keel-inline-reuse-plan` for compatible existing references and `keel-inline-publication-check` for exact expected/returned bytes. Authenticate the actual selected-chain COPY composer and shell separately. The SDK/MCP publication gate rejects unescaped characters in both the outer metadata URI and animation URI. A successful browser render or 5/5 onchain score alone does not satisfy this compatibility check. Run the full collection call within the public RPC gas boundary and verify the exact returned document in a browser with network access blocked. A file check is not a receipt or live marketplace proof.

## Existing native objects and publication cost

An existing `application/octet-stream` pack is not a prepared Base90 fragment. Moving such a work to COPY requires an explicit transport migration and new prepared fragments. Preserve source IDs, seed, ownership, unchanged resource descriptors and the original image. Report this new storage honestly; it is not zero-upload assembly-only reuse. Immutable previously published bytes remain on chain. For new work, avoid publishing an unused native/encoded sibling unless another declared consumer requires it.

Do not confuse read gas with upload gas. COPY can reduce tokenURI read gas substantially while publishing a megabyte of fresh carriers still pays code-deposit gas. Price the actual upload manifest independently, batch supported operations, and activate matching module/shell revisions together through a committed KEEL publication job.

## Creator control

Explicit Raw/as-is requirements remain authoritative. Raw storage disables automatic compression and preserves the supplied bytes; do not silently introduce a dense carriage into that route. Custom creator shells remain available through the existing APIs. Choosing a verification shell, creator shell, storage codec, and transport carriage are separate decisions. This helper builds the KEEL verification shell; it does not relabel a custom shell as canonical.

Runtime Base64/hex composers, a full-HTML Base64 layer and browser RPC loaders are not fallback choices for prepared dense COPY.

Regression coverage: `tests/sdk-prepared-dense-copy.test.mjs`, `tests/sdk-dense-transport.test.mjs`, `tests/inline-payload-carriage.test.mjs`, and `tests/copy-publication-enforcement.test.mjs`. Local SDK capability does not establish selected-chain availability; require the actual registered revision and read-back evidence.


## Optional compact build profiles

`codecProfile: "ppmd-js"` selects the bounded, cooperative decode-only PPMd module. It is optional; existing codec profiles retain their defaults and exclude this decoder from their emitted shell. The engine's native `keel-ppmd-pack` tool emits exact compressed bytes, verifies replay, and commits stored and decoded SHA-256 independently. See `packages/sdk/src/decoders/PPMD.md` and the engine's `packages/codec/native/ppmd/README.md` for the pinned source, licenses and build commands.

`itemDescriptorCarriage: "columns-v1"` with `packKeelInlineDescriptors(items)` interns bindings and repeated types while preserving every resource ID, alias, offset, byte length and integrity commitment. The compressed shell boot expands this carriage before ordinary reader validation. The default remains `json`; do not send column data to an older registered shell. This profile and the PPMd decoder require their own exact registered revision before public publication.

`gzipCompressor` is an optional build-time hook for tools such as Zopfli. The builder bounds and decompresses its output and rejects any change to the canonical input bytes. It changes boot carriage, not canonical document semantics. `shellBootCompression: "none"` remains explicit.

Measure the **complete returned tokenURI** after the metadata and HTML URI boundaries, shell, payloads and descriptors. Compressed source size alone is not the collector delivery size. An inclusive 2,000,000-byte Inline default is a delivery policy, not permission to skip selected-chain call limits or marketplace evidence.

The browser PPMd profile can use a 64 MiB model and a bounded 104 MiB transient arena; jobs serialize and release their arena after success, failure or cancellation. It is not a Game Boy cartridge codec. Native handheld targets should select their smaller primitive, tile, delta and bit-packed systems rather than inherit a browser memory budget.


## Shared PPMd boot for tight complete-return budgets

`buildKeelPreparedPpmdCopyShell` is the SDK entry point for a shared PPMd/URI81
boot. It bundles the canonical verification runtime and compressed descriptors
behind one preloaded decoder. Supply bounded `ppmdCompressor` and optional
`gzipCompressor` callbacks; the SDK decodes their results and verifies exact
bytes before accepting them. This profile preserves independent logical
resource IDs and hashes inside a physical snapshot. It is an explicit
`ppmd-js` choice with a 64 MiB decoder workspace, not a Game Boy runtime codec.

URI81's 81-character alphabet is safe in the nested raw-percent data-URI and
JSON carriage. Its literal set is
`ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'();/?:@&=+$,`.
The Solidity raw builder and `KeelUriEscape` must use the same mask
`0x47fffffe87ffffffafffffd200000000`. Older immutable deployments omit
`?`, `'`, and `&`; do not silently expand the large payload to fit an older
validator. Select a matching reader and policy binding, preserving existing
sealed source bytes where compatible. Unsafe URI characters still require
canonical upper-hex percent escaping at their actual boundary.

The shared boot uses a small gzip/Base64 decoder module once and PPMd/URI81
for its suffix and resources. It does not Base64-wrap the whole HTML or JSON.
`inspectKeelPreparedDenseCopyDocument`, `assertKeelPreparedCopyRead`, and
`keel-inline-publication-check` verify this boot's literal reconstruction,
suffix digest, exact full return, and original resource integrity. A local
review still requires selected-chain receipts, complete RPC read-back, and
browser proof before publication is called complete.

`prepareKeelDensePayload(sourceBytes)` prepares a fresh carrier: beneficial Brotli compression, Base90 encoding, script-safe JSON and both percent layers. Upload only `preparedBytes`; `compressedBytes` is local descriptor/verification material, not a second upload. The helper returns separate decoded, compressed and prepared commitments and byte lengths. Explicit `compression: "none"` disables compression; `"brotli"` preserves an explicit codec choice even if larger. This helper does not register a composer, authenticate chain bytes or migrate existing native objects.
