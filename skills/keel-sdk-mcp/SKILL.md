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
