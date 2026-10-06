# Ethereum Sepolia tester handoff

Updated 2026-10-05. Chain ID **11155111**. The complete recorded infrastructure
inventory is in [`deployments/ethereum-sepolia.json`](../deployments/ethereum-sepolia.json).
Its pinned verification block and per-contract results distinguish a recorded
address from an authenticated receipt and runtime.

The checkout at `7e562740e93152e59f827937acb52de46922f30c` already contains
the modern creator APIs and ABIs, but the Sepolia registry has **no deployment
record for `KeelCreatorFactory` or `KeelArtifactTokenRenderer`**. A new 1/1 using
`buildKeelCreatorERC721ACall` requires that exact modern factory and its bound
renderer. Do not pass the older `KeelFactory` address to those calls. No supported
modern minting UI or publication-ready modern pair is established by this handoff.
Supply the deployment manifest/transaction hashes if that pair was deployed
outside the committed records; verify both receipts, code identities and
`factory.metadataRenderer()` before selecting it.

The current `KeelArtifactTokenRenderer` source returns a Base64 animation document
and Base64 metadata. Deploying that pair alone would not implement the prepared
Base90/Brotli COPY route. That route also needs its matching registered composer,
reader and shell, authenticated full-return bytes and offline browser proof.
Do not describe the older renderer path as prepared COPY.

## Verified storage and COPY infrastructure

| Contract | Address | Use |
| --- | --- | --- |
| KeelHold | `0x0a4f31d5ab08029e4c68f6f3227d9fa3a2d66267` | Immutable object storage |
| KeelRawTokenURIBuilder | `0x70b5984c19baec22beefb1c2e0bd75a41e1452e0` | Existing raw-percent COPY reader bound to that Hold |

`pnpm setup:sepolia` verifies both exact runtime hashes and deployment receipts
and their storage binding. Use `KEEL_SEPOLIA_RPC_URL` to select an archival
Sepolia endpoint; the default KEEL public RPC returned the historical receipts
on 2026-10-05. PublicNode returned null for the older Hold receipt at this check,
so runtime presence there alone did not pass receipt verification.

These immutable addresses predate the newer transport source changes. Updating the
SDK or contract source does not update deployed code. Fresh Base90/Brotli and optional profiles
require their matching registered reader and shell revisions plus a complete
selected-chain return test. Preserve existing compatible object carriages and
do not silently re-encode or substitute a transport to fit an older reader.

## Install and verify

Check out the exact published refresh commit supplied with this handoff, then:

```sh
pnpm setup:friend
pnpm setup:sepolia
pnpm sepolia:verify
```

For an existing checkout, preserve local edits before switching revisions.
`pnpm sepolia:manifest` prints the recorded addresses without network access.
`pnpm sepolia:verify --output=sepolia-readback.json` writes a fresh read-only
snapshot. These commands never sign, upload, deploy or mint.

## Modules and the 1/1 publication boundary

New module packages record their actual Base90/Brotli transport and encryption
status. See [module runtime transport](KEEL_MODULE_RUNTIME_TRANSPORT.md). Update
the Studio catalog consumer before promoting that new catalog format. The public
master catalog's 14 modules remain readable by the currently deployed consumer.

Infrastructure modules/ABIs and executable artwork modules are separate indexes.
The SDK infrastructure registry is generated from `keel-contracts`; runtime
discovery searches both `/api/modules` and `/api/verified-modules` at the
configured Studio. Catalog membership and source verification do not prove
Sepolia publication. Inspect exact network, store, object ID, digest, license
and receipt/read-back before binding a runtime.

Before publishing a game, resolve its registered shell and reader, reuse exact
unchanged modules, prepare only new creator resources, and measure the complete
tokenURI. At or below 2,000,000 complete prepared bytes, default to full Inline
when the selected-chain call fits. Run `keel-inline-publication-check`, verify
the exact public return and offline browser behavior, then obtain the creator's
wallet approval. Mint completion requires a successful receipt and the minted
token's exact public tokenURI read-back. Local Anvil publication remains available
through `pnpm game:sandbox` and `pnpm sandbox:test` while the modern Sepolia pair
is unresolved.

## Validation and release status

The refresh branch passes the SDK build, 30 focused package/transport/manifest
tests, the prepared Brotli/Base90 opaque data-URI browser test, all 74 module
vectors and catalog reproduction. Studio's full type check and 27 focused module
tests pass. The contract COPY/TokenMatrix tests pass (26 cases); source ownership
and module boundaries now pass, including the previously omitted name-source
interface and KeelAuthority.

The broader SDK suite ran 1,380 tests: 1,359 passed, 13 failed and 8 skipped.
Failures include legacy shell size/digest expectations, changed shell UI mocks,
MCP preparation fixtures, an audio compression pin and a sibling mint ABI
baseline. In particular, the older MCP binary asset preparation route is not
release-verified. Contract catalog checks also found unclassified newer callable
surfaces and unclassified package fixtures. These branches are review candidates;
they are not a publication-ready release or evidence of a completed Sepolia mint.

## Recent REDLINE reference

The live REDLINE mint at `0xAe73eC8A4867C3886E8987371f0D57943f0f6BDB`, token 1, uses a separately registered prepared-carrier route with Base90, PPMd containers and gzip/Base64 shell boot. Its complete public return was reread on 2026-10-05 and matches the mint artifact byte for byte. See [the reference manifest](../deployments/redline-sepolia-reference.json) and [transport comparison](REDLINE_TRANSPORT_REFERENCE.md). It is an existing game viewer, not a supported general minting UI or evidence of the modern creator pair. Its owner-governed test infrastructure is recorded under `redline-reference-20261004`; select instances explicitly and preserve their authority boundaries. Fresh work defaults to Base90 carriage with the compact Brotli decoder available. Existing PPMd revisions retain their codec and commitments.
