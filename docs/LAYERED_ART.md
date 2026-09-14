# Layered artwork: local authoring and reveal modules

Start **My work → Layered PFPs**. Add an attribute (Background, Face, Hair), then item images. Each item has a relative rarity weight and optional weighted image variants. Zero removes an item from the random draw; a combination rule can still add it explicitly. PNG and transparency are the default; JPEG requires a background. WebP is also supported, and the encoder checks the actual MIME result.

Select an item to inspect it. This pins it only in the local preview. Shuffle or unpin to sample normal selection. An image can have several drawing pieces at different slots: e.g. the back of a hairstyle at slot 1 and its fringe at slot 5. Draw polygon boundaries, move/size/rotate pieces, or drag a four-corner triangle mesh. Item conditions refer to earlier attributes, while piece conditions can refer to any selected attribute. The SDK accepts larger explicit triangle meshes through the same validated model.

**Test 100 combinations** first verifies and decodes every unique original image, then checks a deterministic sample and makes a 12-image contact sheet. It reports duplicate combinations rather than claiming unique tokens. Conditional rarity is not the same as an unconditional weight percentage. Sampling is not an exhaustive proof of every possible combination.

**Choose collection** resumes the existing Artwork → Collection → Review guide, including a one-of-one, editions, a series, or a saved collection on the selected network. Layer authoring itself does not require a wallet or network.

## Exceptions and inclusions

Open **Layers → Combination rules**. Name a rule, choose **All** or **Any**, then choose items that must be present or absent. Add one or more actions:

- **Move to layer:** change the slot of the whole item or one bounded/meshed drawing piece.
- **Add an extra item:** include an explicit image variant alongside the attribute's drawn item.
- **Replace this attribute’s item:** swap the drawn item for an explicit variant.
- **Hide:** omit a whole item or one piece.

For example, when **Helmet** and **Long hair** are both drawn, move **Back hair** to layer 3, add **Visor**, and hide **Hat**. Rules show whether they applied in the current preview; piece labels show overridden slots and hidden pieces. Rules can be paused without deleting them.

Conditions always inspect the original trait draw. Added or replaced items do not trigger another rule. There is no cascading or implicit list-order priority. Contradictory matching actions stop rendering and report the conflicting rule names; identical effects deduplicate. Explicitly included variants must exist and remain enabled, and included items must satisfy their item compatibility conditions against the original draw. Piece visibility conditions also use that original draw. One attribute can have multiple effective items after an inclusion, or none after removal. Equal slots keep attribute/item/piece order.

`resolveLayeredArt(manifest, baseSelections)` returns original and effective selections, the final draw list, and applied rule explanations. `selectLayeredArt` returns the original draw; the renderer resolves exceptions before composing. Sampling counts visible effective items, including forced items, and reports repeated draw compositions. It does not compare encoded pixels or prove uniqueness. Empty or omitted exceptions preserve existing manifest commitments. Nonempty rules are part of the committed/encrypted manifest.

The desktop retains exact v1 renderer bytes for existing projects. Projects with exceptions link the separate v2 runtime; new projects use v2. Export verifies that copied runtime bytes match the plan’s renderer identity. No existing published module is overwritten.

Agent edits use `keel_edit_layer_part` with `kind: "exception"` and a stable rule ID; `keel_read_layers` accepts `exceptionId`. Selection tools return effective selections and applied rules. These edits retain the existing creator review flow.

## Shared interfaces

- `@keel/sdk/layered-art`: strict manifest parsing, checks, SHA-256 manifest identity, deterministic weighted selection, draw lists and sampling.
- `@keel/sdk/layered-renderer`: the same Canvas2D compositor and encoder used by Electron and creator HTML. It verifies image bytes before decoding, supports polygon clips and triangle meshes, and rejects unsupported output formats.
- `@keel/sdk/layered-reveal`: AES-256-GCM sealing/opening of the whole trait manifest and original layer bytes, plus reveal setup plans. Secret keys must never go to a model, MCP output, logs, or a public project file.
- `@keel/sdk/layered-chain`: EVM token-seed parity, finalized token-context reads and guarded key-release preparation against a separately reviewed immutable deployment code hash.
- MCP: `keel-layered-check`, `keel-layered-select`, `keel-layered-sample`, `keel-layered-reveal-plan`. Input is bounded `manifestJson`, with optional seed/tokenId/count. Desktop agents can propose `keel_edit_project` with `layeredJson`, then navigate to the Layers tab. Large projects use `keel_read_layers` to drill into attributes/items/pieces, `keel_edit_layer_part` for bounded reviewable edits and `keel_check_layered_project` for checks without copying the whole manifest. Creator review applies the exact proposed edit.

The browser bundle uses the canonical shell’s supported classic script format and exposes `KEEL_LAYERS`; SDK imports remain ESM. The SDK build produces a separately reusable `dist/layered-runtime.js` and its measured hash/size metadata. Desktop uses the pinned module through the canonical verification shell. Creator HTML does not contain a separate copy of the library. Local preview HTML is generated in memory and is not persisted as publication source.

## Publication preparation and permission

Choose reuse permission per item: renderer-specific or public, with license terms and tags. These are permission declarations. Unencrypted publicly readable images can be copied regardless of declarations.

**Prepare publication folder** saves original content-addressed images (or one authenticated encrypted bundle), creator HTML, a local copy of the reusable runtime for setup, and `publication-plan.json`. It makes no network upload, deployment, mint or signature. Resolve an existing exact renderer digest on the selected network before uploading a new module. Preserve the publication plan’s `asset-<digest>` resource identities so the renderer can read verified bytes through the canonical content API. Use the canonical KEEL publication wrapper, selected delivery mode, live gas preparation, wallet review, receipts and read-back.

Encrypted preparation hides both pixels and trait names. It stores the recovery key under OS-protected storage separately from the project. **Back up private reveal key** exports those secrets to a separate local file. Keep this backup private; workspace exports do not contain recovery keys. Do not publish the unencrypted authoring workspace or its original source images before reveal.

Publication HTML deliberately waits for token context. The local preview seed is not a collection's token assignment. An integration host can call `readLayeredTokenContext` with the independently reviewed reveal identity, then call the creator frame's `keelReveal(context)` for encrypted art or `keelRender(context)` for plaintext art. The HTML entry points alone do not validate chain state; arbitrary caller input is not onchain proof. Metadata/collection adapters must supply the correct token context and canonical verification boundary. No general collection adapter is silently installed by this feature.

## Reveal source and proof boundary

`packages/layered-art/contracts/KeelLayerReveal.sol` implements immutable one-shot modes:

- Creator: commit the SHA-256 digest of a raw 32-byte seed, then reveal it. Creator can know, choose and withhold it.
- Future block: a fixed draw two blocks after requesting; anyone may settle within the blockhash window. Expiry stalls permanently. It has no Pixel Marine-style expiry reroll.
- Chainlink VRF v2.5: immutable coordinator, exact request ID, explicit fulfillment (zero is valid), storage-only callback, no cancellation, retry or fallback entropy. Verify the network's coordinator, key hash, confirmation minimum, maximum callback gas, funding and consumer registration before deployment.

The module requires an actual collection implementation of `IKeelLayerAllocation`. That implementation must freeze inventory and complete token allocation and enforce token existence. Its assertion cannot be trusted solely because it implements the interface. Audit implementation, proxy/upgrade authority and assignment semantics before approving it. Existing KEEL collections are not claimed to implement this interface. The new reveal contract is EVM-specific; Tezos needs its own contract adapter.

Encryption secrecy and fairness are separate. Public VRF output is never an AES key. A creator can leak or withhold the private key. Early key calldata reveals secrets even when a transaction reverts, so the SDK checks a finalized seed, time, allocation, code identity and exact commitments **before** constructing key-release calldata.

## Validation

`pnpm --dir packages/sdk build`

`pnpm --dir packages/mcp build`

`pnpm --dir apps/desktop build`

`pnpm --dir apps/desktop test`

`node packages/layered-art/build.mjs` builds the ABI/bytecode artifact locally.

`node packages/layered-art/tests/contracts.mjs`

`pnpm --dir apps/desktop exec node tests/run-electron.mjs electron-layers.cjs`

Contract tests compile locally using the installed Solidity compiler and deploy to a disposable Anvil chain with a mock coordinator. They do not establish real Chainlink fulfillment, deployed collection compatibility, publication receipts, or live wallet success.

## Lossless layer storage and PNG presentation

The desktop prepares eligible 8-bit PNG layer imports as lossless WebP using `@keel/sdk/layered-image`. The authoring codec runs in a bounded worker, uses libwebp lossless + exact alpha, then decodes and compares every RGBA byte, including RGB under fully transparent pixels. Both original PNG and verified WebP are retained locally; the layer references the WebP object for reuse/publication. Conversion failures preserve and use the original, with a reason. Animated, 16-bit, custom-profile and over-budget PNGs are preserved rather than called lossless conversions. Existing WebP files are accepted as originals; their historical encoding is not certified lossless.

Composition still uses the shared canvas renderer. The editor and generated creator HTML show a PNG image from the completed canvas. Native right-click Save produces PNG, including when the editing overlay intercepts the click. Explicit PNG/WebP/JPEG export choices remain available in the editor. The visible PNG is a composed rendering; it does not promise to retain invisible source RGB after canvas compositing. Exact byte comparison covers source PNG-to-WebP conversion.

## Candidate pool and ordered set

`@keel/sdk/layered-curation` provides `newLayerCuration`, `parseLayerCuration`, `addLayerCandidate`, `resolveLayerCandidate`, `assignLayerCandidate`, `removeLayerCandidateFromSet`, `layerCurationStats` and `layerCurationPlan`. A candidate commits its manifest version, original draw seed/token number and optional item/variant choices. Saved version snapshots preserve old candidates when weights, exceptions or images change. Historical referenced images remain attached to the project. Current bounds are 5,000 candidates, 25 generator versions and 8 MB of workbench JSON per project.

The desktop **Pool & set** shortcut opens generation, manual trait choices, preview capture, drag/drop assignment and ordering, return-to-pool, rarity counts and target counts. Images load lazily through one thumbnail queue. Weights affect new draws; target counts guide curation and do not rewrite existing candidates. Duplicate checks compare resolved compositions, not pixels. An ordered slot is distinct from the original draw token number; private plan export preserves both.

Curated, mint-seeded and mixed approaches are authoring plans. `keel-layered-curation` exposes the same pure operations through MCP. Desktop agents use the scoped `keel_layer_curation` tool to read, generate, assign, remove and count; changes produce reviewable project edits. Reads are paginated and can drill into a candidate ID. General `keel_edit_project.layerCurationJson` supports other workbench changes. These tools do not assign live tokens or publish.

**Export private set plan** saves the workbench, original draw inputs, ordered allocations and remaining integration requirements. It is private authoring data, potentially containing unrevealed traits. Publishing a nonempty curated set through the single-manifest exporter is blocked rather than silently omitting the allocation. A collection adapter preserving frozen candidate inputs, selected-chain module bindings and receipt/read-back evidence is still required. No live mint-time allocation is claimed.

The Token Gators legacy source remains a separate acceptance gate: Drive filenames and a downloaded barrel `index.ts` do not establish its math, layer ordering or exceptions. Original generator source and layer images must be imported and compared before claiming Gator parity.

### Direct image delivery

Direct image settings are independent of the HTML renderer and canonical shell.
The desktop stores `project.directImage` with PNG as the still-image default; SVG
and WebP are explicit alternatives. Animation setup offers GIF or WebP. GIF may
require palette reduction and cannot promise arbitrary RGBA losslessness.

PNG import now optimizes a copy as PNG, retaining the original. The optimizer
keeps the exact filtered image stream, 16-bit precision, alpha, colour-profile
and orientation chunks; it can discard editing text metadata from the copy.
APNG remains byte-identical. No format conversion is automatic.

`@keel/sdk/layered-svg` produces a script-free SVG with raster layers, placement,
boundary clips and mesh transforms. Embedding happens when constructing the
finished display response. SVG image rasterization can differ from Canvas at
antialiased/resampled edges; the PNG export remains the Canvas result. Saving an
SVG does not turn it into PNG. The desktop retains its separate PNG save action.

`@keel/sdk/direct-image` provides format validation, content-addressed raw chunk
preparation, digest-checked reconstruction and the complete authoring recipe.
The desktop's **Prepare direct image files** writes deduplicated binary chunks
and an index containing references. It never writes base64 image objects into
upload chunks. The recipe includes weights, variants, conditions, exceptions,
placements, masks, meshes and imported assembly rules. Saved curation plans and
their manifest versions are included when present. Encrypted projects are kept
out of this plaintext preparation path.

This is local preparation, not a deployed direct-image contract. The collection
adapter must store and execute the appropriate selection and rendering logic;
a JSON recipe or its digest alone is insufficient. PNG needs compositing and
encoding. GIF/WebP animation needs an encoder plus explicit frames, timing,
blend and disposal. Format-aware encoded segments can be reused only when their
container structure and decoding dependencies allow it. Arbitrary PNG IDAT
chunks are not interchangeable transparent layers. The 24,000-byte local chunk
budget must be verified or repacked by the selected-chain storage adapter.

The MCP `keel-layered-direct-image-plan` exposes the same recipe and compatibility
requirements without uploading, signing, or changing the HTML route.
