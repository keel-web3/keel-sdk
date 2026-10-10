# Synthetic native Geth fixture

This fixture exercises the SDK against unmodified Geth v1.17.8, commit
`a579077007b98217c3e253a66e4b452ca0c32b96`. It is **not a Sepolia state
snapshot or evidence for an affected creator's publication**. No private
project, wallet key, signature, or signed transaction is used.

`genesis.json` starts from that version's `geth --sepolia dumpgenesis` fork
configuration. It retains the fork activation times, uses the Amsterdam
profile after its activation, sets a synthetic 200,000,000 block gas limit,
and changes terminal total difficulty/merge block to zero for a local
post-merge genesis. Chain ID 11155111 selects the real SDK Sepolia rules;
network ID 31337 and Docker `--network none` prevent public connectivity.
This fixture's block hash is intentionally different from canonical Sepolia.

Only a synthetic EOA (`0x11...11`) has a balance. `StateSequence.sol` is
compiled with the repository-pinned solc 0.8.36, optimizer 200, Osaka bytecode
target, then installed at `0x22...22` in this synthetic genesis. All seven
protocol system contracts come from the pinned Geth
[`SystemContractAllocs`](https://github.com/ethereum/go-ethereum/blob/v1.17.8/core/genesis.go)
and [`protocol_params.go`](https://github.com/ethereum/go-ethereum/blob/v1.17.8/params/protocol_params.go),
with their original addresses, runtime bytecode and nonce 1. They allow
native block processing; system-contract processing is not stubbed out.

The test uses `eth_simulateV1` and read methods only, without per-request
state, balance, code, or block overrides. Docker's local loopback client
disables proxying inside its network-disabled container; it never contacts
an outside RPC. Geth's ordinary fork rules and headers remain enabled.

From the SDK root after `pnpm setup:friend --skip-desktop`:

```sh
docker pull ethereum/client-go@sha256:abf3605177f8bdcfce436985a8054cca4ae59256323a4ffb72c56c04f3d1fadd
KEEL_NATIVE_GETH_EVIDENCE=/tmp/keel-native-geth-evidence.json pnpm verify:publication-native
```

Requires Linux, Docker and Node 22. The runner requires the pinned image to
exist locally, creates only its own temporary directory/container, and
removes both afterward. Geth runs as the caller's UID to keep cleanup
permissions correct. The evidence file is retained only when explicitly
requested. The 500M RPC budget is sufficient for this synthetic fixture;
it is not a recommended or verified production budget for Retro.

To reproduce the stock fork-validator boundary, also pull the official Foundry
v1.8.5 image
`ghcr.io/foundry-rs/foundry@sha256:32c8ea9ef052a440cb1620175987a3f49eff8b068a0c6a3d09ebf7f5f9a0e043`
and set `KEEL_NATIVE_FORK_COMPARISON=1`. Anvil runs in the same network-disabled
namespace, forks only the local synthetic Geth block, generates zero accounts,
does not mine, and enables transaction gas-limit checks. No gas-limit override
is supplied. The pinned fork block hash and its 200M gas limit remain intact,
but stock Anvil returns only 50M for the requested 200M simulation envelope.
The SDK rejects the full program. This is a reproduced incompatibility, not
a passing alternative validator or proof about any private project.
