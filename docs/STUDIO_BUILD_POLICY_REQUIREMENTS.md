# Studio build policy: requested next work

This records requested product behavior. It is a roadmap, not a declaration that each capability is implemented, deployed or priced. The active priority remains the Gatorrr metadata-read incident and the release-plan scrolling/review fix.

## One canonical plan

The website, SDK, portable MCP and hosted MCP must read and edit the same revisioned configuration. Named creator profiles copy a snapshot before project creation. Explicit project decisions win over copied profile, media defaults and account defaults. Lifecycle is derived from real progress, never selected as a profile. Content type, token standard, edition/collection structure and sale mechanism are separate dimensions.

Default to short guided questions with one decision or a small related group and a useful preview. Support selective question skipping and a direct mode when the saved configuration is complete. Missing required capability evidence, conflicts, preflight or wallet consent cannot be skipped. Edits, refresh, Back/Forward and agent links must preserve pending work and never silently overwrite a newer revision. Technical encoding and provider controls belong in each section's Advanced disclosure.

## Storage and budget preferences

- Prefer onchain storage by default. Support an explicit total budget in USD, ETH or another supported payment token.
- Optimize only within the creator's stated fidelity/quality constraints. Show what changes and its measured cost. Do not silently alter the artwork or its collector delivery mode.
- If a permitted optimized onchain plan exceeds the budget, offer an explicit Hybrid placement plan when supported. Per-resource pins such as “keep the main script onchain” are hard constraints.
- Other resources may use the creator's configured IPFS storage or a future KEEL-managed IPFS option. Managed retention duration, annual pricing and billing are unapproved and unimplemented until established separately.
- A deterministic resolver should produce placement, transform/dependency closure, measured sizes, quality decisions and provenance. Bind the quote to exact resources, configuration, chain, payment asset and operation grouping. Record quote time/expiry and valuation source; stale exchange rates or changed fees invalidate approval preparation.
- A budget is a planning limit, not authority to spend. Never create/fund an agent wallet, grant permissions, upload to an external provider, activate billing or sign automatically.

## Compression and runtime dependencies

Brotli is the requested default compression preference where the selected reader supports it. Expose Off, On and supported multistage configurations. Preserve explicit existing choices and already-stored representations. Compression, transport encoding, shell selection and storage placement are separate decisions.

Resolve exact module dependencies, order and decoder bytes automatically from supported declarations. Validate cycles, conflicts and missing dependencies; commit immutable resource/decoder digests. A Brotli choice must include a compatible decoder/boot path. Do not claim arbitrary transform combinations work. Existing sealed-content contracts keep keys private and bind their supported compression/encryption order; an encryption module alone is not access control.

Reuse existing protocol graph, Harness slot/revision and build/media-recipe commitments. Reused resources form a DAG: storage children, composition order, runtime dependencies, revision ancestry and current ownership are distinct relationships. Do not replace those mechanisms with a parallel database ownership tree.

## Artwork and optional thumbnails

Actual image/SVG artwork remains artwork. A game, script or animation's optional metadata thumbnail is separate from its executable content and `animation_url`.

Reuse the maintained snapshot/capture pipeline and `preview-webp-512-v1` derivative (512-pixel bounds, aspect-preserving `inside`, no enlargement), rather than building another renderer. Expose snapshot capability through a typed module/MCP operation when implemented. For generative or scripted work, bind seed, render revision, capture time, settings and source/output digests to the receipt. Crop only by explicit choice.

A compact thumbnail is useful only when its complete metadata return passes byte, gas and reader checks. Dimensions alone do not prove compatibility. Offer explicit thumbnail placement choices: embedded/onchain, a supported server link with a digest, own IPFS, or managed IPFS when configured. Do not force the entire artwork into Hybrid because a thumbnail is expensive. A link's digest verifies bytes; it does not make a URL immutable or available. Validate server URL fetches against SSRF and disclose retention/availability limits. Inspect official provider APIs before advertising integrations; credential setup and uploads retain their explicit approval boundaries.

WebP storage with a PNG export experience may reuse an existing shell export capability only after verifying that capability and exact output behavior. It is not a promise of lossless reconstruction of an original PNG from a lossy derivative.

## Required acceptance evidence

Test explicit-answer precedence, profile changes, agent/UI revision conflicts and idempotent retry. Test pinned-resource placement, dependency closure/cycles, codec round trips and decoder integrity, quality constraints, quote expiry/currency rounding and operation gas envelopes. Verify the exact complete tokenURI before any new storage funding, including thumbnail, shell, decoder, descriptors and context.

Test actual rendered desktop/mobile/zoom/wheel/keyboard behavior. Show one clear next action and a concise outcome/cost summary; keep technical details collapsed without clipping content. Validate owner signing and submitted-receipt recovery without duplicate storage or transactions.

For the current incident, synthetic builder gas measurements are evidence of a hotspot, not proof of Gatorrr's root cause. Preserve exact runtime, block, calldata and returned-byte commitments. The dynamic collection reader differs from the committed prepared envelope, including `keel_artifact` and mutable presentation semantics; never swap those routes solely because synthetic builder output matched.
