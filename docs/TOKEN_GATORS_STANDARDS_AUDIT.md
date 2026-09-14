Token Gators Sepolia standards audit — 2026-09-09

The deployed token follows the documented raw-JSON web3 metadata route. Exact public-chain reads pass. This is not proof that every marketplace can render the embedded codecs or automatically refresh changes.

Tested collection: `0xab2e21bffafdae462e9392375a413d36ea7c247c`, Sepolia `11155111`, token `0`. Only one token is currently minted.

**Transport and content**

| Boundary | Actual result | Assessment |
| --- | --- | --- |
| Collection `tokenURI(0)` | `web3://0x491b0da450f990bd5026ca9f0b5c244f16a5e718:11155111/tokenJSON/0?mime.type=json` | Resolves to one raw JSON object; no outer data-URI or JSON-array wrapper. |
| Metadata | 982,419 bytes; `application/json`; 5,541,128 read gas | Independent web3protocol client and public RPC match the prepared bytes. Original non-media fields are exact. |
| `image` | `web3://0x82ba8aa2d9f6e7003d062fe733d57441dbebbc19:11155111/tokenJSON/0?mime.type=svg` | Returns actual SVG, 864,070 bytes, `image/svg+xml`, 3,423,698 read gas. |
| SVG | 3750 × 3750, 14 embedded layers: 13 AVIF and 1 WebP | Well-formed SVG; no script or foreignObject. Its image resources are self-contained. |
| `animation_url` | Inline `data:text/html;charset=utf-8,...`; 964,465 decoded HTML bytes | Canonical KEEL shell and shared runtime compose the same layers to a PNG in the browser. |

OpenSea explicitly supports ERC-4804 metadata URIs and recommends a method returning raw JSON as a Solidity string. This matches our deployed metadata reader. Its documentation establishes metadata transport support; it does not independently prove this exact nested web3 SVG endpoint and codec combination in OpenSea's ingestion pipeline. [OpenSea metadata storage](https://docs.opensea.io/docs/metadata-storage)

ERC-6860 clarifies the auto-mode rules: an absent `resolveMode()` uses auto mode, numeric path arguments become uint256, and omitting `returns` unwraps the ABI dynamic bytes. Adding `returns=(string)` would introduce a JSON array and would be wrong for this endpoint. Our string return uses the compatible dynamic ABI layout. ERC-6860 is currently Draft. [ERC-6860](https://eips.ethereum.org/EIPS/eip-6860)

The current `mime.type=json` and `mime.type=svg` parameters follow ERC-7087, including its explicit SVG example. This extension is also Draft. [ERC-7087](https://eips.ethereum.org/EIPS/eip-7087)

**Compatibility boundaries**

- OpenSea documents SVG images, which it caches as PNG, and HTML animation pages with scripts. The current artwork requires no browser extension. Our local browser proof verifies that HTML produces a PNG; the SVG endpoint itself still returns SVG. [OpenSea media and traits](https://docs.opensea.io/docs/media-and-traits)
- SVG conformance requires PNG, JPEG and SVG decoders, but does not require AVIF or WebP. Therefore a valid layered SVG can render correctly in Chromium and fail in a different image rasterizer. This is a compatibility risk, not a demonstrated failure in OpenSea. Do not silently replace these layers or flatten the work. [SVG image specification](https://www.w3.org/TR/SVG2/embedded.html#ImageElement)
- NFT Inspector and the existing Electron browser checks display the artwork. This audit's direct OpenSea test-page fetch was unavailable; OpenSea end-to-end ingestion remains unverified.
- `supportsInterface(0x80ac58cd)` and `supportsInterface(0x5b5e139f)` return true. `supportsInterface(0x49064906)` returns false. The original collection has a custom `SetBaseURI` event, but no standard metadata-update event. ERC-4906 is optional for ERC-721, so this does not invalidate the NFT. Reader-row changes need an explicit refresh workflow for legacy collections; an event on the reader is not an event from the NFT collection. [ERC-4906](https://eips.ethereum.org/EIPS/eip-4906), [OpenSea updates and refresh API](https://docs.opensea.io/docs/updating-metadata)
- The original `mml` field still points to Google-hosted content. The JSON and current SVG/HTML artwork are onchain, but this additional legacy resource is not made onchain by preserving its URL.
- The registered Sepolia shell still uses the older always-visible K. Reader explorer-source verification is outstanding, and the registered runtime is submitted-unvetted. These must not be described as audited or fully released.

**Size-check correction completed locally**

The SDK's web3 builder incorrectly applied the inline tokenURI budget to an intermediate outer percent encoding that web3 JSON never returns. It now allows the bounded intermediate expansion and checks the actual returned JSON against the same 2,000,000-byte compatibility budget. Inline tokenURI limits remain unchanged. No live transaction or artwork change was made for this fix.

| Selection | Result after correction |
| --- | --- |
| Token 0 | 982,419-byte JSON; byte-for-byte identical to the live response. |
| Token 1 | Now accepted: 1,986,136-byte JSON and 1,868,850-byte SVG, using unchanged layers. |
| Token 26 | Still correctly rejected: 2,747,480-byte JSON. |

The prior count of 741 rejected selections is stale after this correction; the complete set has not been recalculated in this audit. No claim is made that all 4000 now fit.

The 2 MB compatibility budget and 60 million read-gas budget are KEEL/project constraints, not universal limits imposed by ERC-721 or these web3 specifications. JSON response bytes, decoded HTML bytes, ABI return bytes and JSON-RPC hexadecimal transport sizes are different measurements.

Validation: SDK build passed; 23 focused SDK/MCP, graph and matrix tests passed, including a regression that failed before the fix and a genuinely oversized-output rejection. Current public read-back succeeded at 2026-09-09T20:07:48Z; interface checks at block 11670193.

Evidence: `apps/desktop/artifacts/gator-inline-sepolia/live-token-0/public-readback/proof.json`, `standards-interfaces.json`, `standards-size-regression.json`, and `browser-acceptance.json`. Browser evidence and public-chain read-back are separate gates; the browser artifact's `publicChainVerified: false` describes that test's scope, while the public read-back artifact supplies the chain proof.
