# Native Hybrid RPC planning and preview

Source-only integration, 2026-10-08. No deployment, provider benchmark, registration,
storage migration, database migration or transaction is part of this change.

## Existing loader and exact bytes

`buildKeelManagedShellLoader` still mounts the committed shell through the existing
`createKeelChain` and `createKeelHoldObjectReader`. Chain, store address, object ID
and root digest are unchanged. This does not create an encoded payload sibling or
replace existing paid Hold objects. RPC carries bytes from the chain. IPFS and
hosted content are separate delivery dependencies.

The loader checks every endpoint against the selected chain, obtains one block
number/hash, checks that header on each failover endpoint, and performs `eth_call`
and `eth_getCode` using EIP-1898 `{blockHash, requireCanonical:true}`. Nodes that
cannot serve this pinned form fail over without a downgrade to `latest`. Chain
checks are shared across concurrent reads, requests have deadlines, redirects and
malformed envelopes fail closed, and errors disclose origins rather than API-key
paths. The native reader retains recursive/leaf integrity checks and bounded
parallel carrier reads; the final root digest is checked before mounting.

This is exact content verification, not a consensus proof of an RPC provider.
It does not assert an unprovided store runtime code hash. Authentication of the
selected builder/store/shell registration remains a separate publication gate.

## Capability manifest and authority

`@keel/sdk/rpc-read-manifest` provides a bounded data schema. A manifest selects
one chain and one to eight endpoints under the existing host-list rules. Each
endpoint may carry measured or declared latency, aggregate throughput, response,
eth_call gas and concurrency limits, with observation/expiration times. Measured
records require the verified chain ID and sample count. Missing evidence is
unknown; expired or future-dated evidence is ignored by the model. Successful
test sizes must not be entered as upper limits unless evidence actually establishes
that cap. Transaction/fork gas policy is not an eth_call provider capability.

`verifyKeelRpcReadManifest` authenticates supplied bytes against an independently
trusted SHA-256 commitment, exact manifest revision and chain, and a trusted
host-list snapshot/digest. The caller obtains those expectations through its
authorized authority path. Manifest content is parsed data, never code or
instructions. This module performs no network fetching or provider probes.

Current contracts govern **host lists**, not endpoint capability documents or a
manifest-hash registry. `policySource: host-snapshot` alone is not cryptographic
evidence that governance approved the capability claims. A governed updateable
manifest commitment/pointer needs a compatible authority integration before live
automatic updates can be claimed. Unauthenticated remote content must not replace
explicit selections. A sealed token carries its exact snapshot; no silent dynamic
replacement or new contract is introduced here.

## Shared defaults and preview model

`rpcMaxConcurrentReads` uses the existing layered build-defaults profile:
system (4), account, exact media type, explicit project, explicit build. Supported
values are 1–64. The existing authenticated SDK/MCP defaults API and Studio editor
expose the same field. Studio sandbox reads account defaults on entry/focus and
discards previous-account or aborted responses; failed reads are labeled system
fallbacks. This reads preferences only, never saves or changes delivery. The
portable loader accepts a freshly resolved `buildDefaults` snapshot, and preserves
an explicit `maxConcurrentReads` override. Fresh provider concurrency limits clamp
the whole failover pool conservatively, using the same helper as the estimate.

The Studio sandbox shows an offline, hypothetical native-Hybrid read range using
the configured endpoint or selected chain's governed bundled defaults. Explicit
empty, disallowed or unsupported selections remain unavailable rather than being
replaced. The simulation selector never changes publication settings. Account
preference requests are separate from RPC; the simulation makes no RPC requests.

The model includes serial object traversal, 128-entry pointer pages, native
23,000-byte carriers, bounded parallel leaf reads and hex JSON wire expansion.
It does not multiply bandwidth by the number of fallback endpoints. Unknown
speed records use a disclosed broad scenario of 250–1,500 ms per request wave
and 125 KB–2 MB/s aggregate throughput. These are assumptions, not measurements.
Fresh measured inputs still produce an estimate. Timestamp rows age locally to
stale while mounted. Reported response limits are compared with modeled carrier
and ABI pointer-page responses; unknown limits are not claimed compatible.

Local source sizes are provisional until preparation supplies the native stored
inventory. The estimate excludes tokenURI acquisition, unavailable shell/module
bytes, deeper graph structure, descriptor fallback, retries, rate-limit waits,
decompression, hashing and rendering. It is not a complete artwork-load time or
evidence that the local opaque-origin preview exercised an RPC provider.

## Activation blockers

Studio's existing release route still constructs a hosted `/preview/` iframe.
That route has not been relabeled as native onchain Hybrid or silently replaced.
The collection's `hybridHarnessBaseUri` limit is 2,048 characters; the managed
runtime cannot fit there. Live native-Hybrid activation requires an authenticated,
compatible object-backed shell/loader binding through the existing builder and
registry, then exact full tokenURI, registered identity, selected-chain readback
and collector-browser verification. Live catalog and provider behavior require
separate verification. Existing paid payloads and historical bindings must
remain pinned throughout any separately authorized rollout.

## Checks

Deterministic transport tests cover wrong-chain and wrong-header failover,
deduplicated concurrent checks, strict EIP-1898 reads, incompatible providers,
deadlines, malformed/error envelopes and key redaction. Bundled-runtime VM tests
mount a verified native fixture and refuse corrupted bytes. Manifest tests cover
authority/hash/revision, stale evidence, native byte accounting, pointer-page caps,
real loader concurrency and explicit default precedence. Mounted Studio tests
cover local selection, account switches, expiry, cleanup and no RPC requests.
These are source/unit/mounted checks, not a live collector-browser proof.
