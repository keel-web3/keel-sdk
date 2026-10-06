---
name: fray-keel-agent
description: Plan and prepare KEEL 1/1s, collections, reusable browser-art modules, sales, claims, and Fray auctions through the KEEL MCP. Use for p5, Three.js, Doom WASM, Flash AS3, OneMint, storage, or Studio handoffs. Default to the registered verification shell; preserve explicit creator-owned self-contained HTML with viewer=none without canonical protection claims. Payload storage is independent. Wallet and chain actions require creator authorization.
---

# Fray KEEL Agent

**Shared storage and shell policy:** Default payloadStorage is Compact: native bytes stored once, beneficial compatible lossless compression, no generated encoded sibling. Raw preserves supplied bytes and intentional creator formatting. Shell selection is independent. Default to the registered KEEL verification shell; explicit viewer=none preserves creator-owned HTML/direct artifacts without a canonical protection claim. Requirements below for canonical shell records, protected K, and canonical mounting apply to the verification-shell choice. Native-container composers require native storage inventory, decoded source and selected-chain reader proof; their transient return encoding is not another stored copy. Read `docs/KEEL_PAYLOAD_STORAGE.md` and `docs/KEEL_BINARY_RESOURCE_DELIVERY.md`. Persist both choices and reject unsupported readers instead of silently changing storage or presentation.

**Payload storage default:** Compact stores native bytes once and compares supported lossless compression; keep none when compression does not save bytes. Raw preserves exact supplied bytes and intentional creator-authored encodings without automatic compression. Do not generate a stored Base64/hex sibling for either choice. Prepared-COPY UTF-8 text uses storedText/none with exact byte verification; native compressed binary needs a verified compatible reader/composer. Existing prepared objects use exact assembly-only reuse. MIME type labels content; ;base64 selects decoding. Padding/newlines align already encoded slices and do not preserve arbitrary unencoded middle bytes. Read docs/KEEL_PAYLOAD_STORAGE.md and docs/KEEL_INLINE_PAYLOAD_BOUNDARIES.md. Audit actual stored objects separately from returned bytes; registry and browser proof remain separate.


**EXISTING OBJECTS: PREPARED COPY FIRST.** Call `keel-inline-reuse-plan` before
`keel-inline-prepare`, an upload plan, or a new encoder. Preserve exact object
IDs/order, media, chain/store, digests and the bound registered builder. A
published padded Base64 lane is supported reuse, not a reason to transcode or
republish the work. Read
[KEEL_PREPARED_COPY_ASSEMBLY.md](../../docs/KEEL_PREPARED_COPY_ASSEMBLY.md).

Use the KEEL MCP for live capabilities, bounded reads, exact schemas, and
review-only request envelopes. This skill supplies intent discovery, routing,
proof boundaries, and stopping rules. It does not duplicate contract economics
or module records.

The defaults below are mandatory even when a request is phrased casually as
“make a contract,” “make it onchain,” or “publish the NFT.” Never infer a new
contract, custom shell, IPFS image, complete-document Base64 route, or flattened
upload from that wording. Read the target README/docs, run the contract
preflight, inspect the selected chain, search the module catalog, and resolve
existing graph objects before editing or wallet review. Complete-document
Base64 prohibitions for new preparation do not authorize replacing an existing
prepared Base64 copy binding.

## Contract work is always a KEEL workflow

When the request mentions a contract, collection, viewer, token metadata,
deployment, or release—even when it comes from an already detailed project
context—do this automatically before editing or deploying:

1. Read the target repository's `README.md` and the relevant `docs/` files for
   architecture, contracts, modules, presentation, and the named edge case.
2. Read `keel://mcp/engine` or call `keel-engine-catalog`.
3. Inspect the exact selected chain with `keel-network-inspect`.
4. Search the selected-chain module/library catalog with `keel-library-search`.
5. Resolve existing collections, proxies, graph revisions, shell/builder
   bindings, and reusable object receipts before planning a new contract.
6. For existing objects, call `keel-inline-reuse-plan` first with the exact
   receipt/read-back bytes. Require zero new stored bytes and no upload plan
   for assembly-only work; stop on incompatibility rather than rebuilding.

The agent owns this technical work. Do not make the user explain modules,
shells, carriage, decoder reuse, or contract edge cases. Stop before wallet
review when any document, module, authority, or chain binding is missing or
ambiguous. A contract script or old deployment journal is not a substitute for
this workflow.

## Always begin with a plan

For discovery across the SDK, MCP, or desktop editor, first read
`keel://mcp/engine` or call `keel-engine-catalog`. Use `keel-project-decisions`
to preserve known answers and return at most three `nextQuestions` at a time.
Only ask those questions; do not restart a completed intake. The planner's
`planned` status is a direction, never publication readiness or permission.
See [engine-and-contracts.md](references/engine-and-contracts.md) for defaults,
contract/proxy tracking, independent access domains, and ABI controls.

For every new creation, conversion, release, collection, sale, claim, or Fray
auction, enter an explicit planning phase before staging or writing anything.
Use the host's plan mode when available, then request the MCP prompt
`keel-project-plan`. Pass every choice the creator already supplied.

Translate plan choices to the exact MCP schema; never pass planning aliases
verbatim. For an ordinary project, call `keel-studio-project-intake` and ask
only for decisions it still reports missing:

- map fixed sale or claim to `outcome: "release"` plus the exact nested
  `release.saleMechanism`;
- map 1/1, limited edition, or open edition to `release.type`;
- resolve chain text to numeric `chainId` before an ordinary release;
- keep runtime in the plan and later staging/module route, not intake arguments.

For a Fray auction, do not call `keel-studio-project-intake`; call
`fray-auction-intake` with the exact family/network and preset instead.

For every plan, resolve:

- 1/1 or collection;
- storage-only, release, fixed sale, claim, or Fray auction;
- static media, p5, Three.js, Doom WASM, Flash AS3, or another runtime;
- chain/testnet, storage mode, module reuse, and evidence required;
- the point where creator or wallet approval will be required.

Return a concrete plan with project graph, storage/presentation, contracts and
sale path, verification gates, approval boundary, and open questions. Stop at
the plan until the creator asks to continue. Read
[project-routes.md](references/project-routes.md) for route-specific decisions.

## Verification shell default and explicit creator-owned HTML

Omit `viewer` when no shell choice was supplied. Studio selects the registered
`keel-verification-shell` graph. Do not copy, fork, shrink, relabel, or upload
another canonical shell. Missing, stale, or ambiguous canonical shell records
stop the verification-shell route; they are not evidence about a custom shell.

Honor explicit `viewer: "none"` as creator-owned self-contained UTF-8 HTML.
The initial direct HTML route accepts one entrypoint without separate creator
files, modules, assets, or declared runtimes, and publishes raw-percent Inline
HTML using `presentationPolicy: "raw-artifact"`. Unsupported dependencies
fail; do not insert a canonical wrapper, flatten the project, or choose a
network loader. Creator code owns its presentation without canonical K or
Proof/Files/Trail protection claims. Registered creator shells remain an
explicit compatible SDK route. The artifact is still releasable, mintable,
and contract-readable. Persist viewer choice independently of Compact/Raw;
Raw preserves exact supplied bytes and intentional creator markup.

Read [default-shell.md](references/default-shell.md) before staging any viewer.
The canonical implementation map and security contract live in the repository's
`docs/KEEL_VERIFICATION_SHELL.md`; cross-link that document instead of copying
its implementation details into project files.

## Execute the approved plan

1. Inspect the exact local inputs without changing them. Use `analyze`, `cost`,
   and `media-optimize` only as review-only measurements.
2. Search `keel-library-search` before uploading p5, Three.js, Ruffle, decoders,
   seeded-random, or another reusable module. A catalog row is metadata; require
   the exact selected-chain object and registry receipts/read-back before binding
   it as published.
3. Build and test creator-owned bytes locally. Keep source, built output, module
   catalog, browser/runtime, and live-chain evidence separate.
4. Stage only creator resources with `keel-studio-stage-project`, or use
   `fray-stage-project` after `fray-auction-intake` for a Fray auction. Show only
   the server-issued Studio handoff URL.
5. Prepare collection or wallet requests only after the staged project digest,
   selected chain, contract lane, and current creator nonce are exact. MCP output
   remains review-only.

## Apply the Inline saver automatically

Inline means the EVM tokenURI response contains the complete work; browser-RPC `onchain-recursive` delivery is Hybrid and cannot be relabeled as Inline. When already-published native compressed objects can be reused, the explicit optional canonical `embedded-shared-containers@1` profile may use a registered EVM composer instead of storing another encoded payload copy. Follow `references/default-shell.md`, preserve exact resource/seed identities, and require selected-chain registration plus complete contract-return and offline browser proof. Do not infer that a fixed minted consumer can switch composer merely by changing its shell. This optional profile is not a prepared-copy fallback and does not authorize building a new encoder before inspecting existing objects.

For existing prepared objects, call `keel-inline-reuse-plan` first.
`KeelHarnessBuilder.preEncodedTokenURI` and its registered-body
`preparedTokenURI` route copy prealigned ASCII between the top/bottom shell;
no large body is encoded at read time. Preserve its exact padding and media.
Padding arbitrary raw binary is not compatible, and a shell revision cannot
replace a fixed reader. Use `inspectKeelInlineExistingObjectReuse` with
`existingObjectReuse: { mode: "assembly-only", chainId, store }` for SDK work;
its local byte checks do not authenticate chain evidence or grant authority.

For fresh modular game files using the index-selected modern creator factory/renderer,
call `keel-creator-inline-prepare` (SDK: `prepareKeelCreatorInline`). It defaults
to the `creator-inline-20261005` store and automatically prepares Brotli when
smaller, escaped Base90 COPY carriers, container commitments and the registered
gzip/Base64 shell references. Authenticate those exact shell references; keep
the fee-aware upload, complete URI/MCP, gas, offline browser and mint read-back
gates. Read `docs/KEEL_CREATOR_PREPARED_INLINE.md` and the Sepolia tester handoff.

For other explicitly new or changed source, call `keel-inline-prepare` without a
carriage override. New compact preparation uses the raw-percent builder:
resource packing happens once and the complete HTML/metadata receive no new
Base64 wrapper. Existing bound carriage is retained automatically; the creator
must not be asked to approve redundant uploads or to choose this reuse rule.
Never ask the creator to opt in to these savings.

The image rule is automatic and must be explained in plain language when it
matters: validate the original binary image locally, prepare the exact direct
`data:image/<type>;base64,<payload>` carriage once, and publish one
receipt-bound ASCII payload or complete URI. Do not publish raw image bytes plus
a second encoded copy. The contract/viewer only copies the prepared header,
payload and JSON delimiter/footer; it never Base64-encodes or decodes media
during `tokenURI`. For GIFs use a direct `data:image/gif;base64,...` URI from
the exact high-quality source GIF; never wrap it in SVG, resize/re-encode it
silently, use IPFS/HTTP, or accept a short placeholder such as `AA==`. The
prepared payload must decode to the source digest and match public-RPC
read-back. New compact outer metadata/HTML use raw-percent; existing prepared
objects retain their bound carriage and are copied exactly.

Before staging or publishing, decode each raw-percent layer and unpack every
embedded gzip or deflate resource. Reject concrete HTTP(S), IPFS, Arweave,
web3, and keel-onchain locators in decoded creator bytes; an onchain content
URL sentinel is not exempt. Allow only the SVG namespace literal
http://www.w3.org/2000/svg.

For modular projects, declare libraries and executable runtimes under `modules`;
declare artwork, animation, palettes, timing, and project data under `assets`.
Do not generate Base64/hex copies of native payloads inside entry HTML or
label creator media as a reusable once-per-chain module. Explicit Raw preserves
intentional creator-supplied encoded HTML; audit its exact supplied and returned
bytes rather than silently rewriting it. The initial viewer=none direct HTML
route does not accept separate module/asset declarations. Existing-object inspection preserves `percent`,
`follow-latest` or `pinned` when that is the exact published copy lane. Selecting
a different lane or preparing new bytes in an explicitly reviewed alternative
is a separate operation; never transcode the existing work automatically.

Before staging, report the original creator source bytes, creator graph bytes,
complete prepared tokenURI bytes, packing-layer count, and percentage overhead.
Fail before publication when the complete prepared tokenURI exceeds the Inline
public-read ceiling. One RFC 4648 Base64 layer adds approximately 33 percent
before small envelope costs.

## Revise one module without republishing the work

When a target token, shell, module, or resource graph already exists, derive
that fact from Studio or selected-chain state. Do not ask the creator whether
this is a “new object” or a “graph revision.” Call `keel-revision-plan` with
the live graph, the candidate next version, and exactly one changed logical
resource before `upload-plan` or `publish-plan`.

The gate must reuse every undeclared resource by exact object ID, digest,
version, role, media type, and byte length. Never upload the artwork, encoder,
shell, or another module again to make a viewer/CSS fix. The upload digest must
match the single accepted delta. For a follow-latest binding, publish and
activate the new graph/module version and do not rewrite token presentation.
For a pinned binding, update only the small binding after the version exists.
An unrelated change, redundant identical object, non-sequential version, or
automatic delta above 65,536 stored bytes stops before wallet review.

Show new stored bytes and reused onchain bytes separately. Never describe
reused bytes as upload cost. This is automatic platform behavior, not a saving
the creator must request.

For large objects, mode selection, gas accounting, retry, or recovery, read
[publication-modes.md](references/publication-modes.md). Never silently change
storage or presentation mode during a retry.

## Fray auction choices

Offer exactly four choices and accept only `1`, `2`, `3`, or `4`: Quick test,
Standard, Collector, or Fray Auction showcase. Preset numbers are conversation
shorthand only. Show the complete digest-bound terms returned by
`fray-auction-intake`; do not recreate those economics in the skill.

## Proof and authority

Read [proof-and-approval.md](references/proof-and-approval.md) before any Studio,
wallet, recovery, or live-chain step. In particular:

- local/unit success does not prove browser behavior or a public deployment;
- browser success does not prove the bytes were published onchain;
- a transaction receipt does not prove tokenURI, module, or viewer read-back;
- a planned module ID is not a receipt-backed module binding;
- MCP never signs, submits, claims faucet funds, handles a private key, or
  reports a mint, auction, sale, or upload as complete without the relevant
  receipt and read-back evidence.

For the portable MCP connection and local self-test, read
[mcp-config.md](references/mcp-config.md).

## Layered candidate pools and curated sets

For layered collections, use the desktop `keel_layer_curation` tool to read the pool/set, generate a bounded batch, propose assignments/reordering or inspect rarity. Use candidate IDs to inspect original choices. Edits produce exact project review cards. The portable MCP `keel-layered-curation` tool offers pure local planning from bounded JSON and never changes the workspace by itself.

Saved candidates retain their original generator version, seed, draw token ID and trait/variant pins. Do not regenerate a curated piece from its new set position. Rarity targets guide selection; they do not alter saved pieces. Curated, seeded and mixed modes need a verified collection allocation adapter before publication. Keep private set plans and unrevealed traits out of public metadata. The layer importer preserves originals and verifies eligible PNG-to-lossless-WebP conversion; visible artwork is canvas-composed PNG for saving. Do not call arbitrary imported WebP lossless without proof, or claim legacy-generator parity from filenames alone.


## Artist-first modular projects (default)

Treat creators as artists, not developers. The agent and SDK own the technical decisions.
Default to separate HTML entries, CSS stylesheets, JavaScript ES modules with explicit
imports, and individually addressable assets. Preserve logical identities and dependency
edges through publication. Never flatten the application into one creator bundle unless
the user explicitly requests a self-contained file; “Inline” or “onchain” alone is not that request.

Before creating reusable code or uploading assets, search the selected-chain KEEL registry
and index through the MCP library/module tools. Check compatibility, licenses, exact digests,
receipts and public-chain bytes before reusing a candidate. A search miss is not proof that
no module exists; inspect the configured index and module bindings before rebuilding.

Inventory supplied assets automatically and preserve originals. For Compact, compare
supported lossless compression, decoder reuse, publication and read costs. For explicit
Raw, preserve supplied bytes without automatic compression. Choose resource boundaries
and storage within the persisted shell and payloadStorage choices; keep reusable or independently editable resources separate. Group
assets only for a measured benefit while preserving their identities. Do not ask artists to
choose codecs, chunks, module boundaries or ABIs. Ask only for missing creative intent,
rights, budget or visible quality tradeoffs. Never silently apply lossy conversion.

For revisions, compare the dependency graph to the published graph, reuse unchanged module
and asset objects, and publish only changed resources plus necessary references. Chunk
reuse is a storage optimization, not a substitute for modular application design. Explain
results in plain language and distinguish measured costs from estimates. Preserve
the approved shell and Compact/Raw choices. Integrity, authority, receipts and
public read-back apply to both shell choices; canonical shell records and
protected K evidence apply only to the verification-shell route or claim.

## Use the tested COPY publisher

Read the prototype/test map in
[KEEL_PREPARED_COPY_ASSEMBLY.md](../../docs/KEEL_PREPARED_COPY_ASSEMBLY.md). Fresh MCP preparation accepts
compact raw-percent COPY only; an existing aligned Base64/percent binding
uses exact reuse. Selecting a carriage or setting `KEEL_LEGACY_CARRIAGE`
does not authorize a new encoding. Do not substitute an unregistered transport
or custom wallet script. A registered native-resource composer is a separate
verified boundary; see `KEEL_PAYLOAD_STORAGE.md`. Creator-owned HTML uses the
existing raw-percent COPY builder rather than a new encoder.

Before prepared-viewer `publish-plan`, run `keel-inline-publication-check` on
the complete expected URI for the persisted shell choice and actual collection return, then supply
the same file evidence as `preparedCopy`. SDK and MCP recheck the source
commitment, chain/store, full-return equality and size; the plan digest binds
the check. Caller-supplied files/gas are local evidence, so receipt/public-RPC
authentication, registered runtime and browser proof remain separate. Report
the full returned size separately from compressed/stored bytes; 900 KB is not
a universal promise. Direct wallet programs must call the same check; the
SDK/MCP cannot intercept arbitrary programs.

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
