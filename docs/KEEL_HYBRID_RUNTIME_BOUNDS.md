# Hybrid read runtime bounds

The managed loader embeds its complete reconstruction program and configuration
in the returned HTML. `buildKeelManagedShellLoader` returns that HTML string; it
does not upload a new reader, register a module, or create an HTTP bootstrap.
Callers must still authenticate the selected canonical document object and
measure the entire resulting metadata URI. More logical reads increase work;
they do not qualify a publication or authorize payment.

The browser reader dispatches a bounded physical window (default four), with a
linked waiting queue. The SDK governed reader has the same window bound without
changing the separate shared provider scheduler. A timed-out request keeps its
physical slot until fetch and its response body settle. An occupied abandoned
window fails resumably rather than dispatching more hidden work. The managed
loader permits two internal retries; the generic clients retain zero retries by
default. Retries use the same endpoint and exact pinned parameters. HTTP 429
honors Retry-After, with at most five seconds of internal waiting; a longer
browser cooldown is retained for a later resume. HTTP 401/403 and genuine
contract reverts are sticky terminal errors, including nested HTTP error bodies.

Chunk reconstruction uses iterative traversal, bounded leaf workers, and the
existing depth, node, stored-byte and decoded-byte limits. It preserves ordering,
shared DAG semantics, SHA-256 commitments and compression checks. It does not
create a promise for every leaf at once. Failure cancels sibling waits before
they can dispatch more reads. A caller's cancellation does not poison another
independent traversal.

Optional resume caching requires an exact block hash. Completed, verified object
copies are keyed by chain, store, object ID, block hash and full content metadata.
The bounded LRU includes key and payload storage, never retains failed promises,
and never serves mutable latest-state reads. Transport caching is separately
bounded and invalidated after an integrity failure. The managed loader exposes
read-only progress and resume of transient failures at the original pin; explicit
document cancellation/pagehide is terminal for that loader instance. No paid
operation is retried by these APIs.

Progress does not change the existing visual loading status. The optional
pagehide listener is installed in supported browsers; a DOM/VM without window
events can still exercise mounting and integrity checks. Each request retains
its own deadline/abort handling regardless of that optional lifecycle hook.

The managed bridge bytes change for newly prepared loaders. Existing embedded
loaders do not acquire new code when this SDK is installed. The registered
canonical document and URI81 inline fragment generators are separate artifacts;
their exact byte comparison is recorded in the accompanying evidence rather than
inferred from helper tests. A new loader's changed bytes require fresh plan,
metadata, simulation and review fingerprints.

Regression inputs are synthetic. The local Anvil large-return test explicitly
initializes a synthetic contract with `anvil_setCode` and proves an actual EVM
read, not a creation receipt, production capacity, or the original submission.
The deterministic compiler test exercises prepare/measure/acknowledge/simulate
and wallet-call equivalence with mock infrastructure. Real publication and
historical authenticated browser acceptance remain separate release gates.
