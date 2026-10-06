# Ethereum Sepolia tester handoff

Updated 2026-10-05. Chain ID **11155111**. Use the refresh revision supplied with
[SDK PR 13](https://github.com/keel-web3/keel-sdk/pull/13), replacing checkout
`7e562740e93152e59f827937acb52de46922f30c`. The new revision adds the deployed
modern creator factory/renderer, automatic modular Brotli/Base90 preparation
and their matching ABIs. The supported agent path is the SDK and MCP workflow
below. A modern minting UI is not established by this handoff.

## Current creator deployment

Select instance **`creator-inline-20261005`** explicitly. The complete receipt
and runtime inventory is in [ethereum-sepolia.json](../deployments/ethereum-sepolia.json).

| Contract | Address |
| --- | --- |
| KeelCreatorFactory | `0x5828eBA761ab5eA72A349284da5658AD0ECD8416` |
| KeelArtifactTokenRenderer | `0x315368393AfAd4b1EDcbFC6E82152aCeB3b9263d` |
| KeelMintRouteRegistry | `0xB3CD12cEf903B889Bc6C500726411d4c04f62bC1` |
| KeelHold | `0xD820e337692A6Eb7a4878e42ce88CBCFF49B55CF` |
| KeelRawTokenURIBuilder | `0x1AB38f8c568FD373AEf05618C0ab387b30707AaE` |
| KeelRawFragmentValidationRegistry | `0xbBD281E72167D33261EBe9aa78F34907EFC2861D` |
| KeelRawInlineShellRegistry | `0x7879cB175ef93c22A1E99bceD6868d3e7bC5A3D6` |

`factory.metadataRenderer()` binds the renderer above. The renderer's configured
prepared COPY reader and shell registry authenticate raw-percent fragments and
container-table commitments. The collection's owner can bind its presentation.
The factory's four implementations and seed-block archive are also recorded.
The older `KeelFactory` and legacy Base64 renderer route are separate APIs.

The reusable verification shell uses **gzip/Base64 boot** with its embedded
**Base90/Brotli decoder**. Fresh packages default to Brotli when smaller, then
Base90 and parser/COPY-reader escaping. Prepared payloads are copied during
tokenURI, with no runtime payload encoder or whole-document Base64 wrapper.
Public modules declare `encryption: none`; optional private envelopes keep their
actual encryption profile. Existing REDLINE PPMd packages retain their codec.

This is governed Sepolia tester infrastructure. Its storage manager uses the
existing one-owner test policy; production governance is unchanged. Protocol
fees for this instance are zero, while Ethereum transaction gas remains payable.

The verified smoke 1/1 is token 1 at
`0x14966C71bB7fc552c993cF13d97B0F249F6d5819`, minted in transaction
`0x4998538877c6e87e970f7e7df519d9e2131d416214bc798c48134624892feae0`.
Its complete tokenURI is **193,146 bytes** and the measured call uses
**2,815,501 gas**. Exact mint/read-back, complete URI/MCP and Chrome gameplay
proofs are included in [the creator manifest](../deployments/creator-inline-20261005/manifest.json).
Chrome recorded zero external HTTP/RPC requests. `pnpm sepolia:smoke-check`
rechecks the successful receipt, owner and exact public bytes without signing.
The separate [creator-wallet fork proof](../deployments/creator-inline-20261005/creator-wallet-fork-proof.json)
uses automatic SDK preparation and a fresh wallet rather than platform authority;
its chain-31337 evidence is distinct from the live Sepolia smoke mint.

## Install and prepare a new 1-of-1

Preserve local edits, fetch `codex/sepolia-index-refresh`, and check out the exact
refresh commit supplied in the release message. Then run:

```sh
pnpm setup:friend
pnpm setup:sepolia
```

`setup:sepolia` verifies the modern instance's exact deployment receipts, runtime
hashes, factory/renderer and reader/store bindings. It is read-only. The default
RPC pool is PublicNode, Tenderly and `https://public.1rpc.io/sepolia`, with chain checks,
paced requests and rate-limit/history failover. Use `pnpm rpc:check` to test it.
Private provider URLs can be configured with `pnpm rpc:configure --workspace
/path/to/artwork`, or local `KEEL_SEPOLIA_RPC_URL(S)` environment settings; see
[RPC setup and automatic agent guidance](KEEL_RPC_SETUP.md). `pnpm sepolia:manifest` prints the full
inventory offline; `pnpm sepolia:verify --output=sepolia-readback.json` refreshes
its public-chain evidence without signing. The recorded [public-pool verification](../deployments/creator-inline-20261005/public-rpc-verification.json)
reauthenticates all 15 contracts and the exact smoke tokenURI with zero writes. Unrelated historical records can
remain unverified without substituting them for the authenticated creator instance.

Start MCP with `pnpm mcp`, then call **`keel-creator-inline-prepare`** for the
game's modular files and poster. It defaults to the correct Sepolia store and
handles compression, Base90, escaping, shell references and renderer commitments.
The SDK equivalent is **`prepareKeelCreatorInline`**. See the complete arguments
and wallet steps in [modern creator prepared Inline](KEEL_CREATOR_PREPARED_INLINE.md).

The creator's own wallet publishes new objects with the existing fee-aware
`prepareKeelWeld` calls, creates its 1/1 with `buildKeelCreatorERC721ACall`, binds
token 1 using `buildKeelCreatorPreparedCopyBindingCall`, and registers/opts in
its mint route before `buildKeelCreatorAdminMintCall`. It does not need the
deployment wallet. Reuse the exact registered shell and unchanged module IDs.

Each new game still needs complete URI/MCP, selected-chain source/read-back,
actual gas and offline-browser checks before minting. At or below 2,000,000
complete prepared bytes, full Inline is the default when the call fits. The
successful mint receipt, token owner and exact public tokenURI establish
completion. Compressed payload size alone is insufficient.

## Indexes and validation boundaries

The generated SDK registry includes all newly deployed creator contracts and
the reused dependencies under the explicit creator instance. Executable modules
report their actual encoding, compression and encryption; see
[module runtime transport](KEEL_MODULE_RUNTIME_TRANSPORT.md). Catalog presence
does not establish a module's Sepolia identity: verify its exact store, object,
source hash, license and public bytes before reuse.

The updated dense catalog and compatible Studio consumer are on their refresh
branches. The public master catalog keeps its 14 legacy-compatible packages
until that consumer is deployed and verified. Promoting the dense format ahead
of the reader would make the current reader drop those modules.

Focused creator-renderer, immutable binding, container-table, SDK/MCP preparation
and browser checks cover this route. Earlier broad SDK results were 1,359 passed,
13 failed and 8 skipped out of 1,380, including older preparation fixtures,
shell expectations, audio and sibling ABI baselines. Contract catalog checks
also reported unclassified newer surfaces. These release gaps are separate from
the selected-chain creator-route proof; a clean full-suite release is not claimed.

The earlier REDLINE mint at `0xAe73eC8A4867C3886E8987371f0D57943f0f6BDB`, token
1, remains recorded in [the reference manifest](../deployments/redline-sepolia-reference.json)
with its existing Base90/PPMd and gzip/Base64 shell boot. Preserve that immutable
revision rather than migrating its stored format as part of a fresh game mint.
