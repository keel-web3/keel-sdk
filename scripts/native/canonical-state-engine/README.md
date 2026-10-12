# Canonical sparse-state native engine

This is the reproducible source for an offline native Geth diagnostic engine.
It retains state between the original `eth_simulateV1` blocks while enforcing an
explicit gas budget for each stage. It does not split an atomic transaction,
change project calldata, sign, submit, acquire proofs, or activate production.

The storage workflow already uses separate onchain transactions. A simulator's
shared request gas budget is a separate constraint from a chain block limit.
This adapter retains the complete simulated dependency chain without conflating
those limits. Each independent SDK discovery, strict check, or read replay must
start a new session from the same authenticated base.

## Proof and execution boundary

`KeelSparseInput` requires `chainId: 11155111`, an exact canonical `headerRlp`
and `headerHash`, descending hash-linked `ancestorHeaders`, authenticated account
and storage proofs with code, an immutable complete `program`, and a positive
`stageGasCap` no greater than the captured header's block gas limit. The CLI loads
only the witness/base input from `--input`; the protocol binds the complete
program once at `begin`. State/header overrides, signing authorizations, missing
explicit gas, and gas clipping are rejected.

Proof nodes are keyed by their Keccak hashes in a sparse native trie at the
original state root. Code is authenticated against the account leaf. Absence is
accepted only when established by the trie; an unavailable node is an error.
Native persistent getters and writes detect sticky `StateDB.Error()` immediately,
and the final stage root checks it again. Unknown descendant accounts/storage,
CREATE targets, code, and required ancestor headers terminate the attempted
stage. Its entire state copy is discarded, including fee/nonce/system changes.
The protocol closes that failed session; acquiring more proofs requires a new
session replayed from the original pin.

The engine uses upstream `simulator.processBlock`, including native fork rules,
pre/post system execution, execution/state gas accounting and generated future
headers. The canonical base is not remapped to genesis. `NUMBER` and `BLOCKHASH`
use the original header and authenticated ancestry. Only actually required
ancestors need supplying; an unavailable required ancestor is fatal. No default
system code or queue state is inserted. Standard system accounts in unit tests
belong to clearly synthetic proof fixtures, never a captured real snapshot.

A real contract revert or out-of-gas remains the native failed-call result;
contract state reverts while transaction nonce/fees follow Geth semantics.
It is not converted into a transport retry. SDK acceptance still checks every
call and the full expected metadata output. Engine closure flags certify all
accesses of the complete executed program, not all chain state, consensus
validity, live-provider acceptance, or publication.

## Reproduce in cloud

The upstream commit/archive SHA, official Go archive SHA/compiler SHA, source
files and licenses are pinned in `source-manifest.json`. There is no vendored
Geth tree or binary in this repository. Obtain those exact public archives and
a Go module cache verified against the pinned upstream `go.sum` using an approved
cloud build environment. The build itself is offline (`GOPROXY=off`), compares all
input hashes, applies only the included patch/overlay, verifies cached modules,
runs native tests, then writes the binary and a receipt to a new private directory.

```sh
python3 scripts/native/canonical-state-engine/build.py \
  --geth-archive /absolute/geth-source.tar.gz \
  --go-archive /absolute/go1.26.9.linux-amd64.tar.gz \
  --module-cache /absolute/verified-go-module-cache \
  --build-cache /absolute/cloud-build-cache \
  --output /absolute/new-private-build-directory
```

Optional `--public-proof-fixture /absolute/fresh-public-proof-v1.json` runs the
separately hash-bound real factory proof import regression. Without that file,
this one actual-evidence test is explicitly skipped. It is never described as a
complete project test. The synthetic export utility is outside the default test
selection. No build runs on Mac or the deployment host.

## Coverage and remaining input

Native tests cover sequential storage, canonical number/hash context, changed
header/proof/code/account data, absent versus unknown storage, descendant missing
storage, CREATE with proved absence/prefunding/collision or missing target proof,
real revert/out-of-gas semantics, stage rollback, exact response retry, stale
checkpoint/program, cancellation, complete-result gating, and upstream simulation
behavior. The actual fresh factory proof imports correctly; an unknown trie path
fails. Original Retro/owned/paid captures still require their complete same-pin
public state witness before the full plans can qualify. A single factory proof,
a synthetic fixture, or a successful mechanism test does not establish that.

The explicit synthetic export utility also accepts
`KEEL_SYNTHETIC_DELEGATE_RUNTIME=/absolute/test-runtime.hex`. It recomputes the
entire synthetic trie/proofs after adding a 23-byte EIP-7702 designation from
synthetic owner `0x1111…1111` to synthetic delegate `0x3333…3333`, plus that exact
bounded delegate runtime. This is test-fixture construction, never a captured
owner attestation or a substitution in actual project state. The native engine
binary does not change when this test-only utility changes.
