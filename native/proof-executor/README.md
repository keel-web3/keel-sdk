# Proof-backed local executor candidate

This is source/CI work. It is not registered in Studio's production transport,
and it does not authorize a runtime service, Docker socket, new recipient,
private-plan transmission, wallet call, or transaction.

SDK commit `3282b7633441471f832b18d9f07ecb6eefda03b9` passed
[isolated differential CI](https://github.com/keel-web3/keel-sdk/actions/runs/38049992731).
The complete five-call program retained every original 200M envelope in both
validation modes and matched native Geth's entire JSON result, including roots,
hashes, receipts, calls and transactions. A 170M state-heavy call using over
140M matched too. The unchanged plan completed SDK discovery, strict replay,
reader assertions and exact tokenURI verification. These are synthetic results,
not proof for Retro or Gatorrr. This run also passed the synthetic atomic ABI
through every SDK phase. Across 17 completed executions, the observed process
RSS peak was 61,329,408 bytes, longest native wall time 67,354 ms, maximum read
count 1,336, and maximum authenticated witness size 556,102 bytes. These measure
the synthetic fixtures, not production saved plans or the provider rate limit.

## Architecture and trust boundary

- Reuse the unchanged pinned Geth v1.17.8 simulation engine at
  `a579077007b98217c3e253a66e4b452ca0c32b96`. An additive internal bridge supplies
  only ephemeral state, the canonical header, Ethereum consensus/fork rules,
  authenticated historical headers, and an explicit local request budget.
- A request-scoped `state.Reader` obtains EIP-1186 account/storage proofs against
  the selected header's state root. Only successfully verified trie nodes enter
  the in-memory sparse database. Code must match its proven account code hash.
  The empty-trie root proves absence; a missing proof does not.
- Geth updates those real tries, computes genuine post-execution roots and block
  hashes, runs system calls, and carries code/storage/balances/nonces through the
  whole program. There is no root substitution or state/balance/code override.
- The native executable has stdio only: no HTTP listener, RPC URL, datadir,
  credentials, peer network, signer or transaction-submission method. The Node
  adapter validates every outbound read. It allows only pinned proof/code reads
  and hash-linked ancestors, never upstream execution or calldata.
- Binary SHA-256, pinned Geth source identity, exact input digest, base block/root,
  verified-proof counts and resource counters accompany each completed execution.
  Startup and final canonical-hash/freshness checks fail closed. Diagnostics are
  sanitized, and cancellation terminates the isolated runner.

The native process can use a larger **local** request budget without changing
selected-chain transaction rules. Every original transaction gas envelope must
be retained; resource exhaustion produces no proof. Nonce, fees, balances, pre-
refund gas, ordered calls, SDK assertions and complete metadata still apply.

## Isolation and limits in CI

The source node is a synthetic genesis in a `--network none` container with no
peers. Every candidate execution gets a separate disposable container: no
network, read-only filesystem, no capabilities, no-new-privileges, 768 MiB memory,
2 CPUs, 64 PIDs, a read-only binary mount, and no production mounts. The runner
must kill the actual native process/container on cancellation, not only a launcher.

The protocol additionally limits program size to 32 MiB, 256 one-call blocks,
wall time to at most 180 seconds, requests to 10,000, authenticated witness bytes
to 64 MiB, cumulative state responses to 256 MiB and local gas budget to 10B.
The conformance fixture uses a 500M local budget and preserves 200M original
transaction envelopes. No selected-chain limit is raised.

These CI bounds do not imply approval to install Docker access or provision
another service in Studio. Runtime integration needs an explicit bounded runner
inside the approved deployment model, concurrency limits and measured resource
usage. The adapter intentionally requires that runner from its caller.

## Reproduce and remaining qualification

Run `node scripts/build-proof-executor.mjs` with Go 1.25.8, then build the SDK and
run `node scripts/verify-proof-executor.mjs` with the pinned images already
pulled. `.github/workflows/proof-executor.yml` performs those steps in cloud CI
and retains the binary receipt and differential evidence. It also generates four
empty canonical synthetic blocks offline to test non-genesis historical ancestors;
that generator has no transactions, peers, signer or public RPC.

The first passing suite also rejects corrupt account/storage proofs and code,
bad nonce/fee/balance, state-read outages, insufficient local budgets, state
overrides and signing calls; it confirms unchanged canonical state and no
upstream execution. In-flight cancellation, reorgs, block context, refunds, creation/deletion, a
40-call body above 3.85 MB and resource exhaustion passed. The protocol guard
suite independently rejects modified provenance and escaped upstream requests.

`state-reader.mjs` adds server-side public/paid proof-read selection over the
existing RPC pacing, cooldown and restriction logic. Only explicitly approved
state-read recipients are eligible; configuration or credentials alone do not
authorize project address/key disclosure. Tests cover public overload, paid
403/429, redaction, cancellation and retries, wrong chains, bounded responses,
and refusal of execution/submission or unpinned reads. It is not wired into
Studio yet, and live paid credentials have not been inspected or used.

Sparse MPT deletion can require sibling trie nodes beyond a queried key's proof.
If available proofs do not cover an update, Geth's state error rejects the entire
result; the implementation does not insert zero roots, fabricate nodes, or assume
unproven values. Any future witness completion must remain authenticated, pinned
and bounded. A valid program can therefore still fail closed on an incomplete
witness; neither broad compatibility nor actual saved-plan success is claimed.

No live proof-read capability, rate capacity or access pattern for an affected
project has been tested. Account addresses and storage keys are information, even
when calldata stays local. Any real state acquisition must remain within the
explicitly approved source/scope and stop on access/rate restrictions.
