---
name: keel-sdk-mcp
description: Build, modify, test, or use the KEEL SDK and MCP, including module discovery, asset planning, dependency graphs, storage estimates, and publication integration. Use for KEEL SDK/MCP requests even when the user does not name this skill. Complement the canonical publication skill for live publication.
---

# KEEL SDK and MCP

KEEL users are artists. The SDK, MCP and agent must perform technical planning automatically rather than asking users to understand modules, codecs, chunks or contract interfaces.

Any contract, collection, viewer, metadata, deployment, or release request
automatically starts with the target README/docs scan, `keel-engine-catalog`,
exact selected-chain inspection, selected-chain library/module search, and
edge-case resolution. The user does not need to know or request that sequence.

## Enforced standards gate

The MCP enforces this order for contract, NFT, collection, metadata and viewer
work: `keel-contract-workflow-preflight` (receipt) → `keel-engine-catalog` →
`keel-network-inspect` → `keel-library-search` → `keel-contract-controls` →
build → `keel-token-standard-audit` (digest) → request. Signing-request tools
(`wallet-request-prepare`, `publish-plan`, `keel-creator-collection-prepare`,
`wallet-link`, `keel-shell-prepare`, `module-review-prepare`, Tezos prepare
tools) refuse without `standards.preflightReceipt`, and token, collection and
metadata work also needs a passing `standards.auditDigest`. Refusals carry a
code and the exact next tool. Only KeelHold storage writes pass without
evidence.

When changing the SDK or MCP:

- Every new signing-request tool calls `enforceStandards` before it prepares
  anything, and its schema accepts `standards`.
- Every tool `inputSchema` is `type: "object"` with no top-level
  `oneOf`/`anyOf`/`allOf`. One invalid schema makes clients drop the whole tool
  list (the desktop app shows 0 tools). `mcpToolListIssues` and
  `tests/mcp-standards.test.mjs` check this.
- Graph roots come from `keel-graph-weld-prepare` (or `keel-inline-prepare`
  with `outputDirectory` + `hold`), deployments from `wallet-request-prepare`
  `deploy`; never hand-build them with the SDK outside the MCP.
- The audit must accept KEEL's own canonical multi-module graph (regression
  fixture `tests/fixtures/redline-car-1-fork-tokenuri.txt.gz`) and still fail
  real locators.
- Never return `result-too-large` for a valid result. Write it with
  `deliverResult` (workspace file + sha256).
- Mint systems and contract patterns agents need belong in
  `KEEL_ENGINE_CATALOG` with enforceable `checks`, so agents do not hand-roll
  them.

## Required default architecture

- Keep HTML entries, CSS stylesheets, JavaScript ES modules with explicit imports, and assets separate. Preserve stable logical identities and dependency edges through build, storage and updates.
- Produce a self-contained file only when the user explicitly requests one. Inline or onchain presentation does not itself request a single bundled source file.
- Search the selected-chain registry and index through KEEL MCP discovery before building reusable modules or publishing assets. Verify interface compatibility, licenses, digest, receipt and public-chain bytes before selecting a reusable object. Index metadata alone is not verification.
- For existing works, resolve the published dependency graph and reuse unchanged module/asset object IDs. Publish changed resources and necessary graph references only. Deduplicating arbitrary chunks does not satisfy modular architecture.
- For collector-facing Inline, default to the registered canonical shell and compact raw-percent carriage: self-contained `data:image/*` plus raw-percent HTML. Validate the original binary image locally, prepare its exact `data:image/<type>;base64,<payload>` carriage once, and publish one receipt-bound ASCII payload or complete URI. Do not publish raw image bytes plus a second encoded copy. The contract/viewer copies the prepared header, payload and JSON delimiter/footer without encoding media during `tokenURI`. Verify that the payload decodes to the original digest and matches public read-back. GIFs are direct `data:image/gif;base64,...` from the exact source and are never wrapped in SVG, regenerated, resized, gateway-backed, or replaced by a placeholder such as `AA==`. External resolvers, IPFS/HTTP locators, `web3://`, and complete-HTML Base64 require an explicit reviewed exception.

## Automatic asset handling

Inventory actual file types, bytes, digests, dependencies and usage. Preserve originals. Automatically compare supported lossless compression, verified decoder reuse, deployment/storage/read costs and selective loading. Keep independently reusable or editable assets addressable; group only for measured benefits without losing identities. Do not silently introduce lossy conversion.

Ask artists only about missing creative intent, rights, budget or visible quality tradeoffs. Report what changes, what is reused and measured cost in ordinary language. Unknown measurements are not zero-cost options.

## Implementation and verification

Read repository instructions and inspect current SDK/MCP interfaces before editing. Use SDK engine discovery and the configured registry/index tools; do not invent tool names or assume configured indexes are complete. Keep defaults consistent across SDK APIs, MCP schemas, startup instructions, planning prompts and engine resources. Guidance alone is not implementation: test the actual planning and publication paths.

Tests should exercise registry reuse, missing/unverified candidates, changed-module isolation, independent HTML/CSS/JS assets, decoder integrity, exact decompression, cost accounting and the explicit self-contained exception. Retain canonical-shell and selected-chain receipt/read-back requirements for publication. Do not claim that a build, a plan or a local test proves live publication or end-to-end acceptance.
