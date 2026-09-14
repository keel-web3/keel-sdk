# Shared token metadata matrix

`KeelTokenMatrix` assembles metadata from reusable KEEL storage objects. A token
stores a compact selection row, not a complete JSON document. The returned JSON
can contain both an inline SVG `image` and canonical verified HTML `animation_url`.

The shared SDK entrypoint is `@keel/sdk/token-matrix`. MCP exposes the same compiler
as `keel-token-matrix-prepare`; it works without opening an editor agent chat.
Contract controls are available through `moduleAbi('keel-sleeve', 'KeelTokenMatrix')`.

## Storage and selection

- The value table deduplicates identical bytes across traits, metadata, media
  fragments, and different layer layouts.
- Templates contain 16-bit instructions: a shared value ID, a row selection slot,
  or the current token ID. Names and URLs can use exact validated token ID patterns.
- Each row contains a template ID, choice count, and 16-bit value IDs. Rows are
  addressed by the explicit token ID, including zero; missing rows fail closed.
- Row blocks are bounded raw KEEL slugs. Larger collections use more blocks.
  This is a packing choice, not a collection storage limit.
- Shared values and templates are append-only. The owner can replace row-block
  bindings until explicitly freezing them. Reads verify selected object digests.

Original generator rules resolve layer order before matrix compilation. Store the
resulting choices, including exception-driven layouts, rather than rerolling traits
when someone requests metadata. Published trait labels remain separate from older
asset filenames. A source metadata hash proves the input record; it does not prove
a visual pixel match to an older published image.

## Preparing and reading

Prepare canonical media parts with `keel-inline-prepare` using
`metadataTransport: "web3-json"`. Supply original metadata and an explicit token ID.
Optional `tokenIdFieldsJson` declares exact name or URL patterns; a mismatch fails.

Pass a workspace manifest to `keel-token-matrix-prepare`:

```json
{"tokenCount":4000,"tokens":[{"tokenId":0,"parts":[{"role":"trait","path":"prepared/skin-lava.bin"}]}]}
```

The minimal example demonstrates the manifest shape, not a complete metadata
document. Real inputs use all prepared parts in order. The compiler returns shared
value paths and digests, templates, and packed row blocks. It never publishes.

Publish shared values through the SDK's managed KEEL object planner, bind their
table IDs, bind templates, then publish and bind row blocks. Validate canonical
shell/module bindings on the selected chain before exposing collector content.
After receipt and read-back verification, an existing collection with URI controls
can target `web3://<matrix-address>:<chain-id>/tokenJSON/<token-id>?mime.type=json`.
The raw response is one JSON object; do not add `returns=(string)`, which changes
response encoding. Its `image` contains the complete `data:image/svg+xml,...`
and its `animation_url` contains the complete `data:text/html,...`. Neither field
points to another web3 route. The collection itself need not implement a
KEEL-specific metadata setter.

## Token Gators evidence

The standard `keel-inline-prepare` / `buildKeelWeb3TokenJSONGraph` path now
extracts matching prepared layer slots from both the SVG and HTML descriptors.
The matrix deduplicates these exact slot bytes. AVIF/WebP layers already use an
image codec; using `compression: "none"` for their HTML resource slots allows
both views to share one prepared payload. Runtime modules retain their separately
measured compression. Nothing is Base64-encoded or JSON-serialized at read time.
The complete HTML and metadata receive no additional Base64 wrapper.

The full-route local fixture is in `3750-shared-prepared`. It uses the approved
3750 × 3750 media, with fourteen shared prepared layer objects and one raw JSON
response containing SVG and canonical HTML. The exact current read gas, stored
bytes, output digest and original metadata equality are recorded in
`apps/desktop/artifacts/gator-inline-sepolia/3750-shared-prepared/matrix-acceptance.json`.
The `3750-shared-binary` directory is a rejected diagnostic and must not be
published. Its read-time encoder has been removed from the contract and SDK.
Only token zero's full media is covered by this contract fixture; it does not
prove all 4,000 media combinations or a live Sepolia read.

For an explicitly selected separate image request, pass `web3Image: {chainId,
resolver}` to `buildKeelWeb3TokenJSONGraph`, or `web3ImageResolver` plus `chainId`
to MCP `keel-inline-prepare` with `metadataTransport: "web3-json"`. The source
SVG is still required. The metadata keeps canonical HTML inline and contains a
web3 image URI; it is no longer a completely self-contained metadata response.
The returned `imageResponse.parts` form a second matrix response of raw SVG
bytes. Both matrices use the same KeelHold asset objects. The existing matrix
reader's method is named `tokenJSON`, but it copies prepared bytes without JSON
serialization; `?mime.type=svg` selects the SVG response MIME type. Do not add
`returns=string`, which would introduce a JSON response wrapper.

This option never activates automatically, never changes image quality, and
does not make the image payload disappear. The inline HTML and metadata retain
their byte ceilings. The separate SVG reports its size without treating the
Inline ceiling as an image format limit; RPC gas, response limits and web3
reader compatibility require separate verification. A
resolver address supplied to preparation is not evidence of deployment.
`measure-gator-web3-image.mjs` checks original artwork bytes, canonical HTML,
shared layer slots and SDK/MCP reconstruction for a representative sample. Its
report distinguishes response sizes from onchain or marketplace acceptance.
Run `node apps/desktop/scripts/test-gator-web3-image.mjs` for the isolated local
contract check. It deploys the original collection and two standard matrices,
uses actual MCP preparation, follows the collection URI and its SVG link with
the web3 protocol client, checks MIME types and exact bytes, measures each read,
and verifies the HTML reused the already stored SVG layer objects. It never
loads real signer credentials or writes to Sepolia. Public marketplace support
still requires a funded, registered and read-back-verified test deployment.

The `keel-layered-runtime-v4` 4.0.1 module fixes SHA-256 use inside data-URI
frames where WebCrypto is unavailable. It keeps the same content hashes and
seeded choices using the SDK's portable hash. Testing a normal HTTP viewer did
not catch this; the current preview loads `image` and `animation_url` directly
from the exact prepared JSON. The SVG bytes remain unchanged. Run
`node apps/desktop/scripts/preview-gator-token-json.mjs` for that local preview.
`gator-inline-metadata.mjs` rejects external media pointers, JPEG replacements,
missing `animation_url`, wrapped JSON, and changed original metadata. The matrix
contract acceptance test applies those checks to the actual web3 response.

The existing Sepolia collection `0xab2e21bffafdae462e9392375a413d36ea7c247c`
still points at the historical JPEG experiment as of the September 9 preflight.
It is not the SVG/HTML release preview. Current candidate and local proof files
are in `apps/desktop/artifacts/gator-inline-sepolia/3750-inline-json-v2`.

The complete collection audit round-tripped all 4,000 metadata records and their
corrected generator layer selections through shared tables: 143 trait values,
816 layer paths, and 13 templates. Rows use 216,000 bytes; shared values use
371,422 bytes and templates 1,468 bytes, totaling 588,890 bytes. These figures
exclude artwork payloads and contract/storage overhead. All 4,000 raw metadata
file hashes match the IPFS directory selected by fresh contract reads at finalized
ApeChain block 48,728,666. The directory hash was independently recomputed with
Kubo. Recovery used 2,733 downloaded files plus 1,267 byte-for-byte matches from the
generator backup; no unmatched candidate was accepted. Layer order was checked
against the corrected generator; this does not assert visual pixel equality to
older published images. Nothing from this matrix is deployed yet.
