# Prepared dense COPY for collector Inline binary work

For new collector Inline binary content, prepare transport before uploading. Compress the source first, encode the resulting bytes as `base90-v1`, and store the prepared text once. The contract copies committed fragments; it does not encode or decompress the payload. The browser decodes the shell's Base64 literals and separate Base90 payloads, checks stored/decoded/member commitments, then mounts the selected shell.

`buildKeelPreparedDenseCopyShell({embeddedContainerDelivery:{chainId,store},codecProfile:"lzma-js"})` is exported from `@keel/sdk`. It defaults to Base90. The complete HTML and JSON data URIs stay raw-percent; only the canonical prefix and suffix are Base64 literals inside the bootstrap. By default, these two shell fragments are losslessly gzip-compressed before their Base64 carriage (`shellBootCompression: "gzip"`); the decoded canonical shell bytes and commitments remain identical. This saves shell storage without putting game payloads inside Base64. The browser needs `DecompressionStream("gzip")`; use explicit `shellBootCompression: "none"` for a reader that does not support it, and include that larger shell in the complete URI budget. Payloads remain outside those literals. The bootstrap waits for authoritative token context before reconstructing the exact canonical document.

Use `encodeKeelDenseTransport`, `serializeKeelDenseTransportJSON`, and `toKeelDenseTransportDataURL` for payload preparation. The dense URI serializer escapes controls, Unicode, percent, hash and question mark. Escape each URI layer separately; a literal question mark starts URL query parsing and can change later markup. Apply the JSON string boundary as well. Generic quoted-HTML escaping is a different context and can erase dense-carriage savings.

`inspectKeelPreparedDenseCopyDocument` statically parses the two shell literals and data arrays without executing artwork, including bounded gzip shell reconstruction. `inspectKeelInlinePayloadCarriage` and `keel-inline-token-audit` look through this wrapper, reconstruct all compressed payloads and check their SHA-256. Their measurements distinguish compressed source bytes, dense text, shell framing and the complete token URI.

Before publishing, use `keel-inline-reuse-plan` for compatible existing references and `keel-inline-publication-check` for exact expected/returned bytes. Authenticate the actual selected-chain COPY composer and shell separately. Run the full collection call within the public RPC gas boundary and verify the exact returned document in a browser with network access blocked. A file check is not a receipt or live marketplace proof.

## Existing native objects and publication cost

An existing `application/octet-stream` pack is not a prepared Base90 fragment. Moving such a work to COPY requires an explicit transport migration and new prepared fragments. Preserve source IDs, seed, ownership, unchanged resource descriptors and the original image. Report this new storage honestly; it is not zero-upload assembly-only reuse. Immutable previously published bytes remain on chain. For new work, avoid publishing an unused native/encoded sibling unless another declared consumer requires it.

Do not confuse read gas with upload gas. COPY can reduce tokenURI read gas substantially while publishing a megabyte of fresh carriers still pays code-deposit gas. Price the actual upload manifest independently, batch supported operations, and activate matching module/shell revisions together through a committed KEEL publication job.

## Creator control

Explicit Raw/as-is requirements remain authoritative. Raw storage disables automatic compression and preserves the supplied bytes; do not silently introduce a dense carriage into that route. Custom creator shells remain available through the existing APIs. Choosing a verification shell, creator shell, storage codec, and transport carriage are separate decisions. This helper builds the KEEL verification shell; it does not relabel a custom shell as canonical.

Runtime Base64/hex composers, a full-HTML Base64 layer and browser RPC loaders are not fallback choices for prepared dense COPY.

Regression coverage: `tests/sdk-prepared-dense-copy.test.mjs`, `tests/sdk-dense-transport.test.mjs`, `tests/inline-payload-carriage.test.mjs`, and `tests/copy-publication-enforcement.test.mjs`. Local SDK capability does not establish selected-chain availability; require the actual registered revision and read-back evidence.
