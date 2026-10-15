# Indexed network RPC and private provider setup

Network selection and public RPC pools come from the [deployment index and workspace configuration](KEEL_NETWORK_DISCOVERY.md). The current index selects Ethereum Sepolia (chain **11155111**) with these public endpoints:

1. `https://ethereum-sepolia-rpc.publicnode.com`
2. `https://sepolia.gateway.tenderly.co`
3. `https://public.1rpc.io/sepolia`

The SDK/MCP verification tools and Sepolia CLI checks use this public pool.
`rpc.keel-test.149-28-255-65.sslip.io` is no longer a client default. Its public
availability is not required to use this release. No wallet or keys are needed
for RPC, receipt, code, tokenURI or gas-estimate checks. This does not establish
a browser minting page; the supported creator path remains the local SDK/MCP.

The pool checks each provider's chain before reading, serializes its requests,
starts requests at least 250 ms apart, and uses individual JSON-RPC POSTs.
HTTP/JSON rate limits trigger cooldowns with bounded exponential backoff;
`Retry-After` is honored. Timeouts, access failures and missing history try the
next configured provider. Wrong-chain providers are disabled. It does not
retry deterministic contract reverts, send transactions or rotate chains.
Each request makes at most one attempt per eligible provider. If all providers
are cooling down, it reports the wait and setup guidance instead of retrying
in a loop. A required receipt returning `null` is never successful verification.
Free provider quotas and history availability can change.

## Check access

After building the SDK:

```sh
pnpm rpc:check
pnpm network:discover
pnpm network:check
```

`rpc:check` checks chain/head. To exercise the older deployment receipt as well:

```sh
pnpm rpc:check --receipt 0x98228e828e8b5167e7ef49311a2a8d36543907c33b051f8b4699f4e664598a2c
```

The local MCP equivalents are `keel-network-discover`, `keel-network-check`,
`keel-rpc-check` (optional `receiptHash`),
`keel-network-inspect`, and `keel-inline-token-audit`. Ethereum tools may omit
`rpcUrl` to select configuration/public defaults. Tezos and other chains need
their own selected RPC. Explicit loopback HTTP remains available for local Anvil.

## Configure a private provider

If a tool returns **`rpc.setup-required`**, the agent should explain its reason
and cooldown, ask which provider the creator prefers, and help complete these
steps. Do not bypass missing receipt/code evidence or ask for wallet keys.

- [Alchemy](https://www.alchemy.com/docs/reference/ethereum-api-quickstart):
  create an app, select the index/config-selected chain, and copy its HTTPS RPC URL (commonly
  `https://eth-sepolia.g.alchemy.com/v2/<API_KEY>`).
- [Infura](https://docs.infura.io/get-started/infura/): create a dashboard API
  key, enable the selected chain and copy its HTTPS endpoint.
- [QuickNode](https://www.quicknode.com/docs/ethereum): create an endpoint for the selected
  network and copy the dashboard's HTTPS URL.

Enable the read methods your verification needs and allow this machine in any
provider IP restrictions. Historical receipts and state must be available;
a successful chain-ID read alone does not establish that. Consult the provider's
current quota/settings if rate limits persist. Alchemy documents its
[throughput limits](https://www.alchemy.com/docs/reference/throughput).
[Tenderly documents Sepolia RPC reads](https://tenderly.co/blog/how-to-run-safe-simulations-on-tenderly/).
1RPC publishes its [current network URLs](https://docs.1rpc.io/using-the-web3-api/networks).

From the SDK checkout, target the **same artwork workspace as the MCP**:

```sh
pnpm rpc:configure --workspace /absolute/path/to/artwork
pnpm rpc:check --workspace /absolute/path/to/artwork
```

The prompt hides the URL while typing and writes private `.keel/rpc.json` with
mode `0600`, adding that exact path to the workspace's `.gitignore`. Never put a
keyed URL in chat, an issue, Git, public discovery metadata or artwork. The
endpoint tools redact URL paths/query strings in diagnostics and MCP output.
No provider URL is embedded in the prepared artwork by these settings.

You can instead set `KEEL_RPC_URL` privately in the local environment.
`KEEL_RPC_URLS` accepts comma-separated URLs; `KEEL_CHAIN_ID` selects the chain.
`KEEL_SEPOLIA_RPC_URL(S)` and `KEEL_PUBLIC_RPC_URL(S)` remain compatibility
inputs. Sepolia-specific inputs do not apply to another selected chain.
`pnpm rpc:configure --from-env --workspace /path/to/artwork` saves locally set
provider URLs without putting them in command arguments. Environment overrides
must also be supplied to/reloaded by the MCP process if you use that route.

Resolution order: explicit SDK/tool URL(s), environment, workspace JSON, public
indexed network defaults. A selected provider list replaces the defaults; it does not
silently disclose requests to additional providers. Optional local settings:

```json
{
  "schema": "keel-rpc-config@1",
  "chainId": 11155111,
  "rpcUrls": ["https://your-sepolia-provider.example/private-api-path"],
  "timeoutMs": 8000,
  "minIntervalMs": 250,
  "maxResponseBytes": 16777216
}
```

Rerun the exact failed receipt/read-back check after configuration. The MCP
retains pacing/cooldowns across calls and reloads changed local settings.

## SDK use

Browser-safe `createKeelRpcPool` and `resolveKeelRpcConfiguration` are exported
from `@keel/sdk/rpc`. Node tools can use `createKeelNodeRpc` from
`@keel/sdk/rpc-node` to load the workspace file/environment. SDK network,
onchain-data and inline-token readers use the public pool when no RPC/transport
is supplied. Low-level synchronous browser configuration uses the bundled
snapshot; pass a fetched index to resolve against live configuration. Explicit
URLs or injected transports remain available.

For a viem **read client**, use `custom({ request: input => pool.request(input) },
{ retryCount: 0 })` so the client's retries do not defeat pool cooldowns. Set
`requireResult: true` for known confirmed deployment/mint receipts. The pool
refuses wallet/signing/submission methods; keep an explicitly authorized wallet
client separate. Public RPC is transport evidence, not contract identity or
browser verification: continue the selected-chain publication gates.

Publication uses `createKeelPublicSepoliaSimulationPool` from
`@keel/sdk/public-simulation-pool`. Supply the registry/index candidates, exact
selected block, existing read transport, and explicit `approvedProjectRpcUrls`.
It uses `pool.pin(index)` to retain the shared pool's pacing, cooldown and chain
state without unqualified per-call swaps. Simulator validation codes, including
nonce-too-high `-38011`, stay intact. Public qualification may reject a candidate
for unsupported methods or capacity; deterministic project reverts and validation
failures do not search other backends for a passing result. Complete sequences
remain in one request. See [the capacity and proof boundary](KEEL_SIMULATION_EXECUTION_CAPACITY.md).
