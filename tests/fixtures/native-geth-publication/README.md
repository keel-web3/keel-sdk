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

The script pins the synthetic genesis timestamp and its JavaScript test
clock epoch to `2026-10-11T12:00:00Z`, after Amsterdam activation. The clock
advances with elapsed monotonic time so real cooldown waits still expire. This allows the
production pool's head-freshness checks to run unchanged instead of accepting
a stale fixture head. Only the synthetic owner (`0x11...11`) and the zero
address used by the pool's public qualification probes have a balance, set
in this synthetic genesis. No account is funded on any live chain.
`StateSequence.sol` is
compiled with the repository-pinned solc 0.8.36, optimizer 200, Osaka bytecode
target, then installed at `0x22...22` in this synthetic genesis. All seven
protocol system contracts come from the pinned Geth
[`SystemContractAllocs`](https://github.com/ethereum/go-ethereum/blob/v1.17.8/core/genesis.go)
and [`protocol_params.go`](https://github.com/ethereum/go-ethereum/blob/v1.17.8/params/protocol_params.go),
with their original addresses, runtime bytecode and nonce 1. They allow
native block processing; system-contract processing is not stubbed out.

The existing direct-transport regressions remain. Additional checks run the
same compiled fixture through the deployed SDK
`createKeelPublicSepoliaSimulationPool()` path. Its injected fetch adapter
accepts two synthetic `.invalid` endpoint labels and routes both exclusively
to the same network-disabled Geth. Every successful JSON-RPC result comes
unchanged from Geth; fault hooks may inject only an HTTP failure or a delay.
The tests cover:

- A valid 69,316-byte zero-padded fixture call whose calldata minimum exceeds
  an equal share of the observed budget; the complete strict/read replay passes.
- An impossible aggregate calldata minimum, refused after real numeric public
  capacity evidence and before any project call is disclosed.
- Full public capability qualification, strict stateful execution, standalone
  reader assertion and byte-for-byte complete metadata verification.
- A synthetic HTTP 503 followed by fresh qualification and a whole-program
  replay on the second approved label, with identical calldata and envelopes.
- The same known HTTP 503 when only one recipient is approved; automatic
  recovery must be bounded and replay the complete unchanged program.
- Successful public qualification without permission to disclose project calls.
- A real fixture-contract revert that never contacts a second backend.
- A real complete metadata result that rejects different expected bytes.
- Cancellation discarding a late native result while an independent check and
  a fresh check after reload still pass; canonical state and nonces stay unchanged.

These are native synthetic workflow regressions. The two labels are not live
providers, and their injected fetchers do not test process-global production
HTTP health-cache sharing. They are not an actual Retro, paid-owner or new-owner
program replay, nor proof that any affected creator can publish.

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

When Docker's existing data filesystem has no space, the cloud runner may use
the separately reviewed native runtime bundle with
`KEEL_NATIVE_GETH_RUNTIME_DIR=/absolute/path/to/runtime`. This mode verifies the
pinned image identity, exact extracted Geth binary SHA256, and exact hashes of
the reviewed `run-isolated-geth.py` and `ipc-request.py` helpers. It starts each
Geth process in a fresh user/network namespace, requires a distinct namespace,
only loopback and zero external routes, and exchanges read-only JSON-RPC over
filesystem IPC. HTTP/WS are disabled; Geth's built-in engine/P2P listeners remain
inside the isolated namespace and are not used. It does not alter or prune the
existing Docker installation. The evidence records the execution engine,
isolation receipts and executed module hashes. The default remains Docker.
