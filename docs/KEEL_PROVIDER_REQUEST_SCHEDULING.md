# Shared provider request admission

`createKeelPublicSimulationPool` admits configured candidate qualification,
complete project simulations and transaction estimates through one process-local
scheduler for each exact configured provider, selected chain and fetch
implementation. It never introduces a provider or changes project-data approval.
The default is one physical operation at a time, 250ms pacing, 64 queued
operations, three attempts for ordinary public reads, and a five-second maximum
individual retry wait in the publication pool. The standalone scheduler supports
explicit bounded policies; conflicting policies for a shared provider are rejected.

HTTP/RPC rate limits retain Retry-After as a minimum cooldown. Transient
502/503/504, observed timeout and connection-reset failures use bounded exponential
equal jitter. Three consecutive transient failures open a 30-second circuit.
Longer provider cooldowns are retained without extending a check's deadline or
sleeping beyond the configured maximum retry wait. Authentication 401/403 and
unsupported methods are not retried. Provider denial and exact-method unsupported
facts expire after 60 seconds; at most 64 method facts and 128 configured provider
identities exist per shared transport scope. Only structural availability facts
are shared. Raw errors, requests, responses, selected state and proofs are not.

Private simulations use admission only for their individual RPC. The publication
pool owns the bounded whole-operation recovery: new public qualification,
canonical snapshot checks and the complete unchanged ordered program. No prefix
or dependent-call suffix is reused. Public-only capability reports stop at their
first observed restriction. Estimate retries recheck the numbered block hash.
Neither calldata, gas envelopes, block bounds, state-write policy nor return
verification is adapted by this scheduler.

The complete pool deadline includes time in its local queue. Exact duplicate
in-progress requests share a promise only inside the same publication pool at
the same captured block. Settled results are removed. Distinct pending programs
are bounded to 16 requests and 64MiB; the duplicate-key cache is bounded to 16MiB.
Separate HTTP checks require an owner- and revision-bound server single-flight
layer. This SDK change alone does not join separate publication-pool instances.

Queued cancellation removes its waiter immediately. Active cancellation discards
late success. If a transport ignores abort, its physical slot stays occupied until
it actually settles, preventing cancellation from increasing physical concurrency.
No native runtime or isolation fallback is enabled.

## Existing primary readers

An injected `readTransport` does not reveal its configured endpoint. The pool
leaves that reader unchanged. A server that owns the configuration can explicitly
wrap the same transport:

```ts
const governed = createKeelScheduledReadTransport(existingReader, {
  chainId,
  rpcUrl: configuredReaderUrl,
  signal: operationSignal,
  observe: privateObserver,
});
```

The wrapper does not create a network client or reroute requests. It admits only
ordinary read methods, with a 512KiB request bound and a deadline of at most 120
seconds. It adds no physical retries. A server-owned underlying client should use
zero automatic retries to make one scheduler attempt correspond to one physical
read. Use the same pacing and fetch scope as the simulation pool. Do not discover
or extract a wallet endpoint to obtain a key; wallet providers need their own
explicit read-only admission and chain/revision lifecycle.

## Private observations

The pool's optional `observe` callback receives queued/start/completion/failure,
retry countdown, cancellation and capability-cache events. `rpc-response` and
`rpc-error` additionally retain the exact request and provider JSON response,
including original error code, message and data, before public normalization.
HTTP error bodies are bounded by the configured response limit and explicitly
mark truncation. Invalid UTF-8/JSON includes bounded original bytes in memory.
No endpoint or headers are provided. Opaque provider IDs identify only this
process's scheduler instances.

Observers receive detached snapshots and cannot change proof inputs or responses.
Synchronous throws and asynchronous observer rejection do not change the RPC
result. Raw arbitrary provider text can echo credentials: the owner-private
persistence layer must redact credential and URL echoes before saving it. Invalid
raw body bytes should be persisted as an original byte count/hash plus filtered
text when exact storage would retain credentials. Public UI must use only safe
stage/countdown fields, never `request`, `rawResponse` or `error`. Public error
diagnostics keep their existing fixed-field whitelist.

Admission and unit tests do not prove provider capacity, transaction readiness or
production compatibility. The exact saved candidate still needs complete private
capture and unchanged dependent-program replay through the supported deployment.
