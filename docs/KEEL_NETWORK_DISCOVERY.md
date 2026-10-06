# Deployment index and chain configuration

KEEL's deployment index tells SDK/MCP agents which chains have recorded KEEL
contracts. A wallet network list, faucet guide or available source code does
not establish a deployment. The current index advertises Ethereum Sepolia
(11155111) and selects its modern creator instance by configuration.

The standard workflow is:

```sh
pnpm setup --workspace /absolute/path/to/artwork --skip-engine --skip-desktop
pnpm network:discover --workspace /absolute/path/to/artwork
pnpm network:check --workspace /absolute/path/to/artwork
```

In MCP, start with `keel-network-discover`, then `keel-network-check`.
`keel-creator-inline-prepare` resolves the same index-selected chain, instance
and store. These tools never sign or submit. Discovery returns metadata;
verification authenticates deployment receipts, runtime hashes and the
factory/renderer and COPY/storage bindings. A new artwork still requires its
registered shell/reader, exact bytes, complete tokenURI, gas check, offline
browser, creator approval and mint receipt/read-back.

Public discovery starts at `https://studio.onkeel.io/.well-known/keel.json`.
Its `networks.index` points to
`https://studio.onkeel.io/deployments/networks.json`, schema
`keel-network-index@1`. The SDK's normal default uses that endpoint. Node/MCP
fetches it with bounded reads, a 30-second timeout for service wake-up and a
60-second cache; explicit
discovery refreshes it. An unavailable/invalid index returns
`network.index-unavailable`; it does not silently select another chain or an
old catalog. The browser-safe bundled snapshot remains available explicitly
for offline planning and synchronous low-level configuration resolution.

## Workspace selection

Optional `.keel/config.json` belongs to the artwork workspace used by the MCP:

```json
{
  "schema": "keel-workspace-config@1",
  "chainId": 11155111,
  "instance": "creator-inline-20261005",
  "indexUrl": "https://studio.onkeel.io/deployments/networks.json"
}
```

All three settings are optional. Explicit SDK/tool selection takes precedence,
then `KEEL_CHAIN_ID`, `KEEL_DEPLOYMENT_INSTANCE`, `KEEL_NETWORK_INDEX_URL`, then
workspace settings, then the fetched index's default chain/active instance.
A selected chain or instance absent from the index stops preparation. An
indexed legacy instance can be discovered but cannot satisfy a modern creator
route if its required contracts are missing or ambiguous.

RPC URLs default to the selected indexed network's pool. Private
`.keel/rpc.json` and `KEEL_RPC_URL(S)` override that pool; URLs from a private
file for another chain are never reused. Explicit RPC inspection remains
available for an unindexed chain/local Anvil without claiming KEEL is deployed
there. See [KEEL_RPC_SETUP.md](KEEL_RPC_SETUP.md) for provider configuration.
Legacy Sepolia commands and environment names remain compatibility inputs;
agents should use the general discovery/configuration workflow.

## Maintaining the public index

`packages/sdk/src/networks.config.json` contains network policy: public RPCs,
default chain and active instance. Contract addresses and commitments come
from the generated deployment registry, `KEEL_DEPLOYMENTS`. `buildKeelNetworkIndex`
groups those actual records by chain. Configured wallet chains without records
are omitted. A new recorded EVM chain appears automatically; configure its
public pool and active instance to make that route selectable. Source-only
Tezos modules are not advertised as originated contracts.

After updating deployment records/configuration and building the SDK:

```sh
pnpm network:index --output /path/to/keel-site/apps/studio/public/deployments/networks.json
```

Publish that snapshot with the site's discovery metadata and pin the supported
SDK revision. Do not hand-maintain a separate agent/friend contract map.

SDK exports: `@keel/sdk/network-index` for browser-safe parsing, fetching,
resolution and snapshots; `@keel/sdk/network-node` for workspace/environment
discovery; `@keel/sdk/network-verification` for read-only creator infrastructure
verification; `@keel/sdk/rpc-node` for configured RPC pools. Existing synchronous
low-level SDK defaults use the bundled snapshot; pass a fetched index to
`resolveKeelRpcConfiguration`/`keelRpcReaderTransport` when using them directly.
