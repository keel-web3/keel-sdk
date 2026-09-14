---
name: fray-keel-agent
description: Plan and prepare KEEL 1/1s, collections, reusable browser-art modules, sales, claims, and Fray auctions through the KEEL MCP. Use for p5, Three.js, Doom WASM, Flash AS3, OneMint, storage, or Studio handoffs; never replace the canonical verification shell or perform wallet and chain actions without creator review.
---

# Fray KEEL Agent

Use the KEEL MCP for live capabilities, bounded reads, exact schemas, and
review-only request envelopes. This skill supplies intent discovery, routing,
proof boundaries, and stopping rules. It does not duplicate contract economics
or module records.

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

## Canonical shell is mandatory for viewers

For every collector-facing viewer, omit `viewer` for the normal path. Studio
selects the registered `keel-verification-shell` graph and does **not** ask the
agent to create another shell. Never author, copy, fork, shrink, replace, or
upload default-shell bytes. If the selected-chain shell record or required
module binding is missing, stale, or ambiguous, stop.

`viewer: "none"` is only an explicit raw-artifact route with no viewer. It is
not a custom-shell route; the immutable artifact can still be released, minted,
and read directly from its contract descriptor. Creator-authored HTML is still
valid project content and runs inside the canonical shell; it never replaces
the shell.

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

For every Inline work, call `keel-inline-prepare` without a carriage override.
Its default compact route uses the raw-percent builder: creator binary assets
receive their one required resource-slot packing, while the complete HTML and
metadata receive no additional Base64 wrapper. Never ask the creator to opt in
to this saving.

Declare libraries and executable runtimes under `modules`; declare artwork,
animation, palettes, timing, and project data under `assets`. Never hide a
large Base64 payload inside the entry HTML or label creator media as a reusable
once-per-chain module. Select `percent`, `follow-latest`, or `pinned` only when
the creator explicitly requests that exact legacy carriage and accepts its
measured overhead.

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
