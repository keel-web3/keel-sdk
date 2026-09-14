# Mint access operators

The shared queue and reward contracts enforce permission, ticket state, claim limits and randomness binding onchain. These optional workers move pending work forward. They do not decide who wins a random draw.

Both commands are read-only unless `--execute` is present. Add `--once` for one bounded scan/tick. A scan covers at most 2,000 blocks and a tick handles at most 32 tasks. Check `indexedThrough` before interpreting a read-only pending count as complete history.

| Worker | Required environment | Additional configuration |
| --- | --- | --- |
| `node tools/keel/mint-queue-worker.mjs` | `KEEL_QUEUE_RPC`, `KEEL_QUEUE_CHAIN_ID`, `KEEL_QUEUE_ADDRESS` | `KEEL_QUEUE_FROM_BLOCK`, `KEEL_QUEUE_CONFIRMATIONS` (default 2), `KEEL_QUEUE_STATE_DIR` |
| `node tools/keel/reward-entropy-worker.mjs` | `KEEL_REWARD_RPC`, `KEEL_REWARD_CHAIN_ID`, `KEEL_REWARD_ADDRESS` | `KEEL_REWARD_FROM_BLOCK`, `KEEL_REWARD_CONFIRMATIONS` (default 2), `KEEL_REWARD_STATE_DIR` |

Execution additionally needs `KEEL_QUEUE_WORKER_KEY` or `KEEL_REWARD_WORKER_KEY` in the process environment. Use a dedicated funded operator account for each concurrently running worker; do not share an account with another worker or an external transaction sender. The journal lock prevents two processes from using the same journal, but does not coordinate unrelated journals or wallets. Keep keys out of command arguments, logs and repository files.

The reward worker reads the claims contract's immutable entropy source. `DrawRequested` starts an authorized relay request with `reward=true`. The relay uses either the shared seed provider or its committed pair of future blocks. Provider funding uses the worker wallet's own credits or creator-funded access. Delivery retries retain the same request and seed; funded requests remain deliverable after consumer access is revoked. A failed receiver can recover without a reroll. The queue worker follows the corresponding cohort request and advances eligible turns. See the contracts repository's `docs/REWARD_RANDOMNESS.md` for provider access and archive recovery.

Each worker scans confirmed history, checks the scan-end block hash before and after reading events, and resets pending tasks when its prior cursor is reorganized. Notification idempotency keys survive replay. A transient log-scan failure cannot advance the cursor or enqueue a partial page.

Transactions are simulated and ABI-encoded before signing. The shared transaction helper validates the signed sender, chain, recipient, calldata, value and nonce, saves the exact signed bytes and hash before broadcasting, and resumes that same transaction after interruption. It checks receipt block hashes after the configured confirmation depth. An ambiguous request is not replaced by a newly signed transaction. Canonically reverted transactions stop for operator review. Retain the journal; it contains signed transaction bytes and is written with owner-only permissions. Do not publish it as a diagnostic artifact.

An execute process takes an exclusive `worker.lock`. A hard crash may leave that file behind. Confirm that its process is no longer running and that the intended journal is correct before removing a stale lock. Do not delete a journal to make a failed task run again. Inspect the recorded transaction hash and receipt first. Confirmation depth reduces reorg exposure; it is not a guarantee against deeper reorganizations.

## Optional turn notifications

The queue worker can POST a signed turn notice to `KEEL_QUEUE_NOTIFY_WEBHOOK` using `KEEL_QUEUE_NOTIFY_SECRET`. HTTPS is required except for loopback test endpoints. The payload identifies the chain, queue, wallet, ticket, current allowance and deadline. Email addresses and phone numbers never enter queue events or worker journals.

The receiving application must verify the HMAC, atomically deduplicate `idempotency-key`, resolve a verified wallet-bound opt-in, and suppress expired or disabled subscriptions before sending. A crash after provider delivery and before journal persistence can cause a retry; exactly-once delivery requires the receiver's atomic deduplication. The FRAY verified-contact preferences and provider bridge are still unfinished. A configured webhook alone does not prove contact ownership, consent or successful delivery.

## Current proof boundary

Mocked worker tests cover outbox retry/idempotency, reorg scanning, transaction interruption, provider funding, future-block readiness and delivery retries. Contract tests cover request binding, permissions and failed receiver rollback. These checks do not establish a funded production VRF subscription, a live coordinator callback or notification delivery.
