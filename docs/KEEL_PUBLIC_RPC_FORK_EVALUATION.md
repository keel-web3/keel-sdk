# Public-backed local execution: October 10, 2026

A synced owned node is **not** a prerequisite for local execution. A local EVM
can fetch the pinned public account/code/storage state lazily, keep the private
program local, and carry intermediate state through the complete program. The
new `pnpm verify:public-rpc-fork` investigation demonstrates this architecture
with the pinned official Anvil 1.8.5 and Geth 1.17.8 images. It does not enable a
production backend or prove either affected creator's publication.

## Operator evidence and repaired transport behavior

The public-only operator capture is Library
`libfile_bf7ede842b2081919bc7c130c019a4d6`, 10:29–10:34 UTC. The reduced fixture
`tests/fixtures/public-rpc-fork/operator-20261010.json` preserves these facts:
EthPandaOps returned `-32601`; PublicNode's 548-byte 200M probe returned a 50M
envelope; Tenderly's first simulation returned HTTP 429 / RPC `-32005` without
Retry-After; 1RPC's first chain-ID read returned HTTP 403. Testing stopped on
those restrictions. A whitespace-padded approximately 4 MB request returned
503, which does not establish a precise body limit. No project bytes were sent.

RPC pool errors now carry only fixed diagnostic fields: failure category,
observed HTTP status, and a bounded correlated numeric RPC code. Cooldown and
disabled-provider retries retain them. HTTP error bodies are limited to 16 KiB
and never copied into diagnostics. Concurrent requests stop at the first access
restriction. Known rate/access failures can select another already-approved
candidate; explicit invalid parameters and transaction validation codes remain
terminal. No new recipient or route is introduced.

The public qualification precondition now uses Amsterdam's 12,000-gas empty
self-call cost and sequential upfront balance, rather than the old 21,000 floor
and sum of all full envelopes. Strict public execution and every project gas
envelope are still checked unchanged.

## Exact gas semantics

There are three independent quantities: the selected block's total/state gas
limit, the 16,777,216 Amsterdam execution-gas ceiling, and the RPC request's
shared resource budget. Geth deducts `result.UsedGas` after each call and clamps
the next envelope to what remains. Thus the operator's two 50M requests returned
50M and 49,988,000 after a 12,000-gas self-call. Preserving every envelope requires
`budget >= max_i(sum(previous gasUsed) + requestedGas[i])`, not the sum of all
envelopes. The envelope sum is only a conservative sufficient upper bound.
A 6.8–8B Retro discovery sum is neither measured gas consumption nor a proven
minimum required RPC budget. Its 425,679,780 quote is not measurement either.

The blanket 200M discovery ceiling is a planning choice, not a consensus rule.
The differential fixture demonstrates a two-call program that completes all
three SDK phases when separately planned with 16M envelopes; the 200M discovery
version fails against stock Anvil's 50M budget. These are different gas-bound
inputs. The fixture also demonstrates a contract whose return and storage change
when its execution allowance is lowered. A safe future discovery design must
make the candidate gas bounds explicit, bind the resulting final signed calls
and fingerprint, and strictly replay the entire program plus exact readers and
metadata. It cannot label success at a lower bound proof of an unchanged old
envelope. Atomic wallet calls cannot be split.

This planning improvement alone cannot fix Gatorrr's observed 141,779,261
pre-refund execution / 170,135,114 validated envelope. The local synthetic test
also contains a legal 170M state-heavy transaction using over 143M total gas,
which succeeds on Geth and fails under Anvil's 50M RPC budget. Regular execution
and state gas must remain separate; lowering selected-chain limits is not a fix.

## What the local fork experiment proves

The test starts a synthetic Geth genesis, a read-only upstream proxy, and Anvil
in one network namespace with no external network. No mainnet/testnet state,
private project, wallet, signature, transaction submission, or chain sync is
involved. Anvil runs with zero dev accounts, no mining, pinned block zero,
Amsterdam rules, transaction-limit checks enabled, no storage cache on disk,
no nested-node/BAL probing, and zero network retries.

The proxy permits state acquisition only and records every request. It rejects
upstream `eth_call`, simulation, wallet and submission methods. All private
synthetic calldata stays local. Account/storage reads use the pinned block hash;
the original owner balance/nonce and header are preserved. The native test checks:

- Matching Geth/Anvil results and gas across a two-call stateful program in both
  validation modes.
- Existing EIP-7702 delegated-account execution, without creating authorizations.
- Refund-aware gas: `maxUsedGas` remains higher than refunded `gasUsed` and matches
  Geth.
- A five-call original program consuming over 55M: Geth succeeds; stock Anvil
  clamps the fifth envelope and fails.
- The oversized single state-heavy transaction and the blanket discovery case.
- Strict nonce, fee and balance rejection; unchanged canonical/local pinned
  storage after all ephemeral executions.
- No forwarding of execution requests or calldata to the upstream state source.

The investigation runs in CI and uploads its exact image digests, source commit,
call/header/gas results, and upstream method/parameter log. All evidence is
synthetic and separate from creator publication proof.

## Remaining local-engine work

Stock Anvil 1.8.5 is not a ready production fallback. Its implementation fixes
`SIMULATE_GAS_CAP` at 50M. Its sparse fork simulations also report zero state
roots, unlike Geth's computed roots. Existing SDK output-shape checks can accept
the smaller program; that is not sufficient qualification of a newly introduced
engine. This change does not conceal that limitation by inserting invented
headers or enabling Anvil in the production transport.

A viable next implementation is a bounded local fork executor with a configurable
**local** execution budget and authenticated sparse state updates. Account and
storage proofs (`eth_getProof`) can anchor lazy reads to the selected state root;
code must match the account code hash. Updating that sparse trie supplies real
ephemeral roots for linked headers. This is an engineering path, not implemented
proof. It needs differential coverage for Amsterdam gas and system calls,
EIP-7702, fees/nonces/balance, refunds, CREATE/SELFDESTRUCT, block context and
BLOCKHASH, plus cancellation, read quotas, reorgs and provider restrictions.
It can use the already approved public read recipient without syncing a node or
sending project calldata to another provider.

Another faithful engine may carry the same ephemeral state across internal
execution steps, retaining balances, nonce, code, storage and block context. The
SDK need not insist on one *remote* RPC request if the local engine provides that
continuity. Independent remote calls from the original block, simulated-block
hashes as continuation handles, or incomplete state-diff overrides do not do so.

No actual Retro/Gatorrr complete private plan was executed in this investigation;
no canonical publication receipt or deployed collection has been established.
Paid storage job 10 and all unpublished assets remain untouched.

Primary implementation references:
[Geth simulation budget](https://github.com/ethereum/go-ethereum/blob/v1.17.8/internal/ethapi/simulate.go),
[Anvil simulation and sparse-root behavior](https://github.com/foundry-rs/foundry/blob/v1.8.5/crates/anvil/src/eth/backend/mem/mod.rs),
[Anvil fork reads](https://github.com/foundry-rs/foundry/blob/v1.8.5/crates/anvil/src/eth/backend/fork.rs).
