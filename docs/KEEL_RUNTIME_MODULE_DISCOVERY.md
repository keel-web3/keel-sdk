# Runtime module discovery and reuse

JavaScript, WASM, and other reusable runtime modules are stored content. The browser reconstructs and runs their bytes. For example, an onchain MP4 encoder is JavaScript loaded from KEEL that encodes media in the browser. It does not require a new encoder implementation or EVM video encoding.

Agents must discover existing modules before proposing replacement code. An empty or unavailable index does not establish that a module does not exist.

## Current SDK/API integration

`searchKeelRuntimeModules({ query, studioUrl? })` searches both the release catalog (`/api/modules`) and the verification catalog (`/api/verified-modules`). It follows cursors and searches nested metadata, including module IDs, output hashes and deployment object IDs. Queries are case-insensitive. The default endpoint comes from the SDK endpoint resolver. This runtime index is separate from the infrastructure contract/ABI exports in `modules.ts`.

The result exposes matches with their source, per-source completeness and errors. A failed feed, malformed response, repeated cursor or exhausted page budget is incomplete coverage. Even complete catalog coverage is not a scan of every object on every chain. MCP `keel-index-search` uses this SDK lookup alongside the library index and no longer instructs agents to upload new bytes after an empty result.

Verification status and deployment status are different. Preserve unverified candidates in results. Never promote a match to verified, or assume a verified source is deployed on the selected chain. Bind the exact version, chain, Hold address, object ID, reconstructed digest, byte length, dependencies and license before reuse.

## Testing unverified modules

`createKeelRuntimeModuleSandbox({ bytes, sha256, maxBytes? })` checks the exact bytes and creates a local test document through the existing `@keel/viewer` sandbox. Mount it with the returned sandbox tokens and policy intact. The helper does not execute code in the SDK process. Its default capability ceiling is empty: the document has an opaque origin, no network hosts, no wallets, no storage privilege, no popups and no workers. Local blob reads remain available to the existing verified content gateway. Integrity matching is not a trust endorsement.

This helper currently tests self-contained ES modules. Undeclared imports remain blocked. It is a module test harness, not a replacement for the registered collector verification shell.

For direct onchain object reads, the SDK's `readKeelManagedObject` reconstructs the declared object tree through the selected-chain reader ports and checks its committed digest. Arbitrary digest-to-object lookup still requires an indexed deployment binding; a digest alone does not identify a chain or storage address. Automatic cross-chain hash discovery and MCP sandbox orchestration are not implemented by these helpers yet. Report that gap explicitly instead of inventing bindings or telling the creator to rebuild a module.

## Artwork and export defaults

Use automatic Inline presentation up to 1,750,000 compressed bytes; use Hybrid above that threshold. Preserve an explicit creator selection. Measure the actual prepared bytes, including dependencies, rather than guessing from file extension.

For interactive art with an MP4 download, retain the live interaction and use the existing encoder's documented API during loading. Only offer a completed export after every source frame and encoder dependency is verified. Missing-frame substitution cannot be exported as an exact original. A saved MP4 preserves a recorded loop, not interactive controls. Never claim seamlessness or pixel identity without checking the encoded output.
