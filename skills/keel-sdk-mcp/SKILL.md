---
name: keel-sdk-mcp
description: Build, modify, test, or use the KEEL SDK and MCP for module discovery, asset planning, storage, viewer preparation, and publication. Use for KEEL SDK/MCP requests even when not named. Keep the registered verification shell as the default, preserve explicit creator-owned HTML with viewer=none, and apply canonical-shell evidence only to canonical protection claims. Payload storage is an independent choice.
---

# KEEL SDK and MCP

**Account connection default:** Use `keel-studio-connect` (`start` → open its public `approveUrl` for the user → `complete`) before private draft/staging work. The SDK privately saves the approved scoped grant for this workspace and Studio origin. Do not ask for a key in chat or an environment file. The cross-platform terminal/browser helper is `pnpm studio:connect --window --workspace <project>`; manual import uses the hidden `--import-key` prompt. Desktop is entirely optional. Only the user approves account access and wallet actions. Read `docs/KEEL_STUDIO_WALLET_REVIEW.md`.

**Website first:** Default to https://studio.onkeel.io for the full creator
workflow and wallet review through the user's existing Studio account.
KEEL Desktop is entirely optional. Never require installing/building Desktop,
setting up another wallet, or a separate signing page for a supported Studio
workflow. Return the staged project's `handoffUrl` or draft's `reviewUrl`;
the user opens it in the website and approves with their connected wallet.
Read `docs/KEEL_STUDIO_WALLET_REVIEW.md`; agent keys never authorize signing.

**Payload storage default:** Default payloadStorage is compact across SDK, MCP, editor and Studio. Store native bytes once; compare supported lossless codecs and keep none when compression does not save bytes. Raw is an explicit persisted choice that keeps supplied bytes unchanged and disables automatic compression; it is separate from viewer=none, Inline/Hybrid delivery and prepared URI carriage. Reuse unchanged onchain object IDs and publish changed resources only. For native compressed binary, use the registered reader/composer profile in docs/KEEL_BINARY_RESOURCE_DELIVERY.md, not a second stored Base64/hex copy. Contract return encoding and storage are different boundaries: read-time Base64 or hex output does not prove another paid stored copy. Fresh prepared-COPY UTF-8 text uses storedText/none with exact byte verification; its guard does not validate native binary composers. Read docs/KEEL_PAYLOAD_STORAGE.md and audit source, new/reused stored bytes, complete tokenURI bytes and call gas separately. Raw does not bypass byte integrity or selected-chain receipt/read-back checks. Canonical-shell evidence is required when the verification shell is selected or canonical protection is claimed; it is not required for explicit creator-owned HTML.

**Shell choice:** Shell choice is independent of payload storage. Default to the registered KEEL verification shell. If a creator explicitly selects viewer=none, preserve their creator-owned HTML shell and direct-artifact presentation through handoff, preview, preparation and publication; do not insert or label it as canonical protection. The same native-byte/no-duplicate storage policy applies to both. Existing explicit creator shell registration/selection APIs remain available for reusable custom shells.


**EXISTING OBJECTS: PREPARED COPY FIRST.** Call `keel-inline-reuse-plan` before
fresh preparation, an upload plan, or a new encoder. Preserve exact stored
bytes, ordered object IDs, media, chain/store, digests and the bound registered
builder. A published padded Base64 lane is supported reuse; do not transcode
or republish it because fresh preparation defaults to raw-percent. See
[Prepared COPY assembly](../../docs/KEEL_PREPARED_COPY_ASSEMBLY.md) and the
`existingObjectAssembly` policy in `keel://mcp/publication-modes`.

KEEL users are artists. The SDK, MCP and agent must perform technical planning automatically rather than asking users to understand modules, codecs, chunks or contract interfaces.

Any contract, collection, viewer, metadata, deployment, or release request
automatically starts with the target README/docs scan, `keel-engine-catalog`,
exact selected-chain inspection, selected-chain library/module search, and
edge-case resolution. The user does not need to know or request that sequence.

## Existing objects require assembly-only inspection

Use `inspectKeelInlineExistingObjectReuse` with
`existingObjectReuse: { mode: "assembly-only", chainId, store }` for SDK work.
The exact ordered receipt/read-back parts must produce zero new source bytes;
local inspection does not authenticate receipts, registration or authority.
`KeelHarnessBuilder.preEncodedTokenURI` and its registered-body
`preparedTokenURI` path copy prealigned ASCII between top/bottom boundaries
without encoding the large body during `tokenURI`. Padding raw binary alone
is incompatible. Resolve the matching reader or stop; prepare only explicitly
new or changed source. A shell revision cannot replace a fixed builder.

## Required default architecture

- Keep HTML entries, CSS stylesheets, JavaScript ES modules with explicit imports, and assets separate. Preserve stable logical identities and dependency edges through build, storage and updates.
- Produce a self-contained file only when the user explicitly requests one. Inline or onchain presentation does not itself request a single bundled source file.
- Search the selected-chain registry and index through KEEL MCP discovery before building reusable modules or publishing assets. Verify interface compatibility, licenses, digest, receipt and public-chain bytes before selecting a reusable object. Index metadata alone is not verification.
- For existing works, resolve the published dependency graph and reuse unchanged module/asset object IDs. Publish changed resources and necessary graph references only. Deduplicating arbitrary chunks does not satisfy modular architecture.
- For new collector-facing Inline source, default to the registered canonical shell and compact raw-percent carriage: self-contained `data:image/*` plus raw-percent HTML. Preserve original media locally, validate its exact bytes, and prepare one direct image payload/URI at build time. Publish one receipt-bound carriage; the contract only copies its header/payload/footer and never encodes or decodes image bytes during `tokenURI`. Keep existing image objects unchanged rather than uploading an encoded duplicate. GIFs remain direct GIF data URIs, never SVG wrappers, silent regeneration/resizing, gateway-backed bytes or placeholders such as `AA==`. External resolvers, IPFS/HTTP locators, `web3://`, and a new alternative carriage require explicit review; preserving an existing compatible prepared Base64 binding is ordinary reuse.

For explicit `viewer: "none"`, use `buildKeelCreatorOwnedInlineDocument`
with one self-contained UTF-8 HTML entrypoint and bind its raw-percent graph
through `buildKeelPreparedOneOfOneTokenURI` with `presentationPolicy: "raw-artifact"`.
Do not insert the canonical shell, add a whole-document Base64 wrapper, or
publish the source again as an encoded sibling. This initial direct HTML
route rejects separate creator files, module/asset declarations, and
runtime-dependent projects; do not silently flatten them or switch to a
network loader. Existing explicit registered creator-shell APIs remain
available for compatible reusable custom shells. Compact/Raw storage is
independent; Raw preserves the exact supplied HTML and intentional encoding.
Neither choice grants canonical protection to a creator-owned shell.

## Automatic asset handling

Inventory actual file types, bytes, digests, dependencies and usage. Preserve originals. With Compact, compare supported lossless compression, verified decoder reuse, deployment/storage/read costs and selective loading. With explicit Raw, preserve supplied bytes and disable automatic compression. Keep independently reusable or editable assets addressable; group only for measured benefits without losing identities. Do not silently introduce lossy conversion.

Ask artists only about missing creative intent, rights, budget or visible quality tradeoffs. Report what changes, what is reused and measured cost in ordinary language. Unknown measurements are not zero-cost options.

## Implementation and verification

Read repository instructions and inspect current SDK/MCP interfaces before editing. Use SDK engine discovery and the configured registry/index tools; do not invent tool names or assume configured indexes are complete. Keep defaults consistent across SDK APIs, MCP schemas, startup instructions, planning prompts and engine resources. Guidance alone is not implementation: test the actual planning and publication paths.

Tests should exercise registry reuse, missing/unverified candidates, changed-module isolation, independent HTML/CSS/JS assets, decoder integrity, exact decompression, cost accounting, explicit self-contained HTML with viewer=none, and independent Compact/Raw persistence. Require canonical shell registration and protected K evidence for the verification-shell route or a canonical protection claim. Require selected-chain receipt/read-back and byte integrity for both shell choices. A build, plan, or local test does not prove live publication or end-to-end acceptance.

## Use the tested COPY publisher

Read the prototype/test map in
[KEEL_PREPARED_COPY_ASSEMBLY.md](../../docs/KEEL_PREPARED_COPY_ASSEMBLY.md). Fresh MCP preparation accepts
compact raw-percent COPY only; an existing aligned Base64/percent binding
uses exact reuse. Selecting a carriage or setting `KEEL_LEGACY_CARRIAGE`
does not authorize a new encoding. Do not substitute an unregistered transport or custom wallet script. A registered native-resource composer is a separate verified boundary; see `KEEL_PAYLOAD_STORAGE.md`.

Before prepared-viewer `publish-plan`, run `keel-inline-publication-check` on
the complete expected URI for the persisted shell choice and actual collection return, then supply
the same file evidence as `preparedCopy`. SDK and MCP recheck the source
commitment, chain/store, full-return equality and size; the plan digest binds
the check. Caller-supplied files/gas are local evidence, so receipt/public-RPC
authentication, registered runtime and browser proof remain separate. Report
the full returned size separately from compressed/stored bytes; 900 KB is not
a universal promise. Direct wallet programs must call the same check; the
SDK/MCP cannot intercept arbitrary programs.

**Dense Inline boundary:** Read docs/KEEL_PREPARED_DENSE_COPY.md before preparing fresh binary COPY content. Fresh bulk payloads default to Base90 text (base90-v1), with the compact Brotli decoder available by default; only the compressed shell boot uses Base64 literals. Apply strict URI escaping at both data URI layers and script-safe JSON serialization. Default preparation is buildKeelPreparedDenseCopyShell with omitted binaryPayloadCarriage and codecProfile; preserve explicit URI81, LZMA and PPMd choices. Do not apply whole-document Base64, blanket punctuation escaping or an unused encoded sibling upload. Optional PPMd and column descriptors require matching registered revisions; local fixture IDs are not chain receipts. Price the complete returned tokenURI and verify exact offline replay.

## Canonical shell integrations

Use the shared protected shell and `docs/KEEL_SHELL_APPLICATION_API.md`. The artwork client `__KEEL_SHELL__` supports data-only App panels and read-only verification/catalog calls. Keep protected proof state distinct from creator claims. The default retains auto-hide and one OnKEEL header with Proof, Token, Files, System and App pages. Token metadata, attributes, checked manifests, modules, plugins and external sources must show their actual provenance; do not invent missing declarations or execute manifest plugins.


### Optional information and prereveal modules

Keep Inline delivery unchanged when adding optional RPC information. Reuse the
governed KEEL RPC reader for marketplace/commitment enrichment; denial, offline
nodes or stale listing data must not delay artwork or change protected file
verification. Show only fresh token-specific listings; retain OnKEEL gallery.
For hidden-art/trait/seed-rule commitments use the optional `@keel/sdk/pre-reveal`
module and `keel-prereveal-prepare`, with separate private proof output. Read
`docs/KEEL_PREREVEAL.md`: pin the original registry revision and runtime, do not
mix its salted SHA-256 proof with OZ metadata leaves, do not publish salts/keys
early, and do not claim a recipe or burn-rule hash proves final pixels or a burn.
Reuse native sealed/layered envelopes and compact attribute pages. Enable this
feature only when the creator chooses a prereveal; it adds no required network
dependency or authority to the canonical file proof.

### RPC failures and provider setup

Start chain-dependent work with `keel-network-discover`, then `keel-network-check`.
The configured public index establishes recorded deployments, selected chain and
active creator instance; wallet/faucet lists and source modules do not. Respect
`.keel/config.json` and `KEEL_CHAIN_ID`/`KEEL_DEPLOYMENT_INSTANCE`/`KEEL_NETWORK_INDEX_URL`.
Read-only tools default to the selected indexed network public RPC pool, with per-provider pacing, rate-limit cooldowns and bounded failover.
Use `keel-rpc-check`; a successful chain-ID read alone does not prove historical
receipt access. If a tool returns `rpc.setup-required`, explain its reason and
retry-after, ask which provider the user prefers, and help set up an endpoint for the selected chain
with Alchemy, Infura or QuickNode. From the SDK checkout, run
`pnpm rpc:configure --workspace /path/to/artwork` to save private local settings,
then `pnpm rpc:check --workspace /path/to/artwork` and the exact failed check.
Read `docs/KEEL_RPC_SETUP.md`. Never request wallet keys, seed phrases or RPC API
keys in chat; keep keyed URLs out of Git, logs and artwork. Do not bypass missing
receipts or change chains. No browser minting page is implied by this workflow.

Read [KEEL_NETWORK_DISCOVERY.md](../../docs/KEEL_NETWORK_DISCOVERY.md) for normal network discovery, configuration and selected-chain verification.
