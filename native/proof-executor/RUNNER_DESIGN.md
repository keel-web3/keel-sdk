# Production runner proposal — review required before activation

This is a concrete deployment design, not a deployed service or a claim that an
affected publication works. The user authorized a tested live solution and an
optional configured paid RPC. Host capacity, the local IPC addition, immutable
execution binding, and the exact saved-plan acceptance run still need review.

## What is already measured

SDK `78188c2f90c5d4a7c393f07f2f97d2d53c3a064b` passed cloud run
[38051601085](https://github.com/keel-web3/keel-sdk/actions/runs/38051601085):
39 native differential checks and 29 protocol/state-reader tests. It exercised
non-genesis canonical ancestors and both unchanged sequential and synthetic
atomic plans through every SDK phase. The source pool and broker were not
composed in that run; the broker branch adds that missing integration test.
Across 18 completed executions, peak process RSS was 50,782,208 bytes, maximum
native wall time 1,143 ms, maximum read requests 21, and maximum witness size
9,502 bytes. These synthetic measurements do not establish either actual plan's
memory, elapsed time, read count, or a provider's capacity.

That native binary is 15,586,440 bytes with SHA-256
`db7308985cbb32eb6bbcbef95edf456786ca02519ac1f89cc6ad8edf5fd90307`.
It embeds unchanged Geth `a579077007b98217c3e253a66e4b452ca0c32b96` plus the
reviewable additive bridge. New broker builds have their own commit-specific
receipt and immutable image archive; never reuse this earlier digest as the
identity of a later artifact.

## Proposed process and artifact boundary

Use one small, dedicated local sidecar on the existing runtime host. Its image
contains only a static broker, the exact static executor and the build receipt;
all are root-owned in an image pinned by digest. Build and qualify both images
in cloud CI. The runtime host only loads verified image archives. There is no
node sync, RPC service port, Docker socket, source build, cloud account, signer,
provider credential, database mount, or artwork-directory mount in this sidecar.

The broker opens the fixed executable once without following symlinks, verifies
the build digest, and retains that read-only file descriptor. Each request must
execute that same open file through an inherited descriptor, rather than reopen
an independently supplied path. The image root filesystem is read-only, with no
mutable executable bind mount. Startup and connection receipts identify the
image/build/binary; the deployment verifier checks the actual running image and
container configuration. The SDK continues checking the exact input digest and
native result provenance. Client-supplied executable paths/arguments are refused.

Use one local Unix socket for the bidirectional bounded JSON-lines protocol.
The broker accepts only the configured Studio UID using kernel peer credentials.
The socket directory is mode 0700, the socket 0600, and the broker has the same
unprivileged numeric UID as the approved application socket client. Studio mounts
the socket directory read-only; only the broker mount is writable. The actual
deployed UID must be inspected before choosing it. The executor receives only
stdio and its executable descriptor, an empty credential environment plus fixed
Go resource settings, and no provider URL or secret. Network namespace: none.

One execution may be active globally; queue length is zero. An occupied runner
returns a bounded busy/retry result. Never cache or share a project's simulation
state. Each accepted request gets a new process. Disconnect, cancellation,
deadline, malformed framing or byte exhaustion kills the whole process group;
the slot is released only after process exit has been observed. The broker
reports the native exit status after output drains. A socket closure without
that final status cannot complete a proof. Parent death must kill its child.

A process-held, no-follow lock serializes startup in the private socket directory.
After an unclean exit, recovery removes only the same owned socket inode whose
connect attempt returns ECONNREFUSED. A live listener, ambiguous connection
failure, changed inode, symlink or regular file is refused without unlinking it.
The lock is released by the kernel on SIGKILL; no manual socket deletion is
needed. This closes the original broker restart blocker.

## Exact proposed resource changes

| Item | Proposed hard bound or behavior |
| --- | --- |
| Additional container memory | 768 MiB total for broker and one executor; memory-swap equals memory, so no container swap |
| CPU | At most 2 CPU cores, not a reservation |
| PIDs | 64 |
| Filesystem | Read-only image; 16 MiB noexec/nosuid temporary socket volume |
| Capabilities | All dropped; no-new-privileges; unprivileged UID |
| Networking | None; no published ports or DNS use by the runner |
| Concurrency / queue | 1 active / 0 queued |
| Per-execution deadline | 180 seconds maximum, including state waits |
| Native input / output | 32 MiB program / 32 MiB final result; 64 MiB cumulative output |
| State reads / witness | At most 10,000 reads / 64 MiB authenticated witness |
| State response bytes | At most 256 MiB cumulative; proposed reader limits each response to 2 MiB |
| Local gas request budget | At most 10B; every original envelope and selected-chain limit still enforced |
| Native stderr | Drain at most 64 KiB, never forward payloads or provider text into logs |

Do not place this workload inside the current web/PostgreSQL process budget.
The repository's example compose file says 768 MiB for that combined runtime;
its runtime-budget source separately records a prior measured 2,621,440,000-byte
deployment limit. Neither establishes the host's current capacity. The operator
must inspect the actual running memory/CPU limits, available host headroom and
UID without exposing environment values. The proposed sidecar adds at most
768 MiB to the existing container budgets, plus image disk space and the 16 MiB
socket volume. Its complete image size remains to be measured.

Mandatory deployment changes are a new isolated sidecar and a narrowly scoped
shared socket directory mounted into Studio. This is new local IPC access and
must be included in the reviewed rollout scope. No broader host control,
privileged container, capability grant, Docker socket, `/data` access, security
rule relaxation, public port, provider account, or new secret is required by this
design. If the existing host cannot support the bounds, stop for a concrete
resource decision; do not provision another host or enlarge limits silently.

## RPC selection and private-data boundary

The existing server configuration references are
`KEEL_PUBLICATION_SIMULATION_RPC_URL`,
`KEEL_PUBLICATION_SIMULATION_RPC_URLS`, and
`KEEL_PUBLICATION_SIMULATION_APPROVED_RPC_URLS`. Only source references were
inspected; no live paid credential values have been read or used.

The candidate `state-reader.mjs` uses the existing RPC pool's chain checks,
pacing, cooldowns, response bounds and access-denial handling. Public overload
may select an already configured, explicitly approved paid state source. A
configuration entry or credential alone does not make it eligible. All URLs
and credentials remain server-side. Diagnostics expose candidate indexes and
sanitized categories, not hosts, paths, query strings, keys or proof values.

Keep approval for public-state read patterns distinct from approval to transmit
an unpublished full program to an external simulator. The proposed integration
adds an explicit approved state-source list; it must not infer this list from
the public RPC index or silently grant project-data approval to paid URLs.
Native overload does not authorize remote execution. No automatic new provider,
credential acquisition, paid subscription, alternate access route, or repeated
request against a denied/throttled endpoint is allowed.

The native backend transmits no call data, artwork, source files, prepared URI,
saved-plan JSON, release identifiers or expected metadata to its state sources.
It still reveals addresses, storage-slot keys, the block hash and access timing:

| Required read class | Information disclosed |
| --- | --- |
| Chain and pinned header | Sepolia identity, block number/hash, canonical recheck |
| Owner/executor account proof | Address, nonce/balance/code-root lookup |
| Public contract/delegation code | Address and selected block hash |
| Storage proof | Contract address plus one exact 32-byte slot per request |
| Historical headers | Hash-linked public ancestors, at most 256 behind the anchor |

For Retro, the saved prefix/chunk continuation and existing job/manifest state
may cause store, executor, owner, composer, shell, factory and registry reads.
For Gatorrr, the paid job 10, underlying external calls, actual delegation and
collection/factory/reader state must be reflected. System-contract reads also
occur under the selected fork. Slot keys and predicted addresses can reveal
unpublished object or collection relationships even though their values come
from public state. The exact address/key set is data-dependent and has not been
determined without the authorized saved plans. Do not fabricate that inventory.

Before the exact-plan acceptance run, inventory its locally known owner,
executor, call targets, delegation, store, composer/factory/registries and any
predicted addresses. Review the dynamic read scope and eligible recipient list.
Keep a local request audit containing unique addresses/slots and counts; do not
export it to telemetry or public CI. Unexpected scope or missing witnesses
must stop safely. Preserve every original call, fee, nonce, gas envelope, paid
job reference, cursor and source representation. Successful simulation is not
a transaction, payment, deployed collection, or publication receipt.

## Required acceptance and rollback

1. Finish non-genesis ancestor differential tests and independently review the
   executor and broker. Test corrupted ancestors, lost reads and no false zero
   BLOCKHASH result. Qualify actual proof/code response formats and bounds on
   the approved source using only predetermined public accounts first.
2. Cloud-test the real broker/container boundary: immutable opened executable,
   tampered artifact rejection, no network, read-only filesystem, resource
   exhaustion, UID restriction, one-active/busy behavior, disconnect, cancellation,
   child cleanup, malformed/oversized input and output, and restart.
3. Verify public overload to eligible paid state fallback, paid denial/limits,
   cooldown across retries, secret redaction and no recipient expansion. Feed
   the same candidate transport through the UI and agent service factory.
4. After host/resource/IPC review, build the exact application and runner images
   in cloud, verify extracted receipts and archive reload, and load only those
   image digests on the runtime host. Keep the original application data volume.
5. Run both actual saved plans read-only through discovery, strict replay and
   all required readers/tokenURI checks. Verify retry/cancel/reload/stale revision
   behavior and pending/unknown transaction reconciliation. Check job 10 and all
   paid-storage evidence remain unchanged. No wallet submission is part of this.
6. Enable the reviewed backend only when those gates pass. A failure rolls back
   application/backend selection and stops the sidecar; it must not rewrite
   journals, create replacement storage jobs, delete assets or change plan terms.

The 2026-10-10 cloud PublicNode qualification attempt stopped on its first
`eth_chainId` request with a network `URLError` before an HTTP response. No
account, code or storage request was made. No retry, route change or fallback
provider was attempted. This does not establish PublicNode proof capability or
availability from the production host.

## Operator findings and remaining deployment gates — 12:36 UTC

The operator reports four host CPUs, 4.93 GiB available RAM, 54.97 GiB available
disk and no swap. Studio is capped at two CPUs and the proposed runner at two;
together they can consume the host ceiling. Keep concurrency one and verify
Studio responsiveness during the exact saved-plan check before activation.
The actual Next process runs as UID:GID 999:999. Use that identity for the broker
and socket directory; no new account is needed.

The dedicated 0700 directory and 0600 socket owned by 999:999 do not exist yet.
Their creation and the new read-only Studio mount are new persistent IPC access
and require exact approval before enablement. The broker's mount alone is
writable. The proposed shared tmpfs is 16 MiB, noexec/nosuid, and contains only
the socket and startup lock. Neither runtime receives additional host control.

No paid RPC is configured in the Studio environment or chain row. The first
paced PublicNode request from the operator route returned HTTP 403, before any
proof/code request. Both that route and the earlier blocked cloud route remain
stopped: no retry, alternate route or provider substitution. The public-only
format-probe script is retained as a reviewable qualification procedure, but
must not be run against the denied route. No source is presently qualified.

Minimum source capability: Sepolia eth_chainId, canonical eth_getBlockByNumber,
eth_getBlockByHash, and eth_getProof/eth_getCode accepting the exact EIP-1898
blockHash plus requireCanonical selector. Each proof requests at most one slot.
Responses must fit 2 MiB and 15 seconds; reads are paced at least 250 ms apart,
with preserved cooldown/access restrictions. Native execution has a 180-second
wall bound and a 10,000-read ceiling. Actual plan throughput remains unmeasured.
No eth_call, eth_simulateV1, submission endpoint or full node sync is required
from this provider. A new paid account, credential or address/slot recipient
needs separate explicit authorization; configuration alone does not supply it.

The user removed the previous rollback image and old backup paths. Eleven data
volumes were preserved. Reacquire and independently verify the existing rollback
CI artifact (available until October 17) or reconstruct it in cloud before any
rollout; do not claim a local rollback copy exists. Do no further VPS cleanup.
