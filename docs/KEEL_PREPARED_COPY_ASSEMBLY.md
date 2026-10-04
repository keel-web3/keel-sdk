# Prepared COPY is the default for existing KEEL objects

For new binary collector Inline work, use [prepared dense COPY](KEEL_PREPARED_DENSE_COPY.md): Base90 preparation occurs before upload and tokenURI only copies. Explicit transport migration of existing native objects is a separately quoted source of new storage; it is not zero-upload assembly-only reuse.

Shared default and creator control: read [KEEL_PAYLOAD_STORAGE.md](KEEL_PAYLOAD_STORAGE.md). Native stored bytes and transient return encoding are separate; the prepared-COPY guard applies to prepared-COPY storage, not every native-composer response.

**Start with `keel-inline-reuse-plan` before preparing or uploading bytes for an
existing work. Reuse the exact compatible objects and their bound builder.
A previously published Base64 carriage is a supported copy route, not a reason
to transcode or republish the work.**

For this operation, the target is an ordered assembly plan with
`newStoredBytes: 0`, unchanged object IDs and digests, and no upload plan.
Fresh preparation is for explicitly new or changed source only. A mismatch is
an incompatibility to resolve with the registered reader; it is not permission
to encode, repack, duplicate, or replace the existing bytes.

## What the existing contract does

`KeelHarnessBuilder.preEncodedTokenURI` copies an already prepared Base64 graph
between the small token-specific metadata prefix and suffix.
`KeelHarnessBuilder.preparedTokenURI` also supports a separately registered
shell: when the body uses
`application/vnd.keel.token-uri-base64-body-fragment`, it resolves the selected
shell prefix and suffix and calls `KeelPreEncodedTokenURI.assembleWrapped`.
The body and shell fragments are copied directly from KEEL carriers. Only the
small live metadata envelope is encoded; the large body is never encoded again
inside `tokenURI`.

The SDK prepares compatible slices once. Legal HTML whitespace aligns the
source fragments to nine-byte boundaries so both HTML and metadata Base64
layers join without interior `=` padding. Existing slices retain their exact
padding, media type and digest. Padding arbitrary raw binary alone does not
produce a prepared slice: an `application/octet-stream` compressed object is
not interchangeable with either prepared-fragment media type.

The raw-percent builder follows the same copy rule for
`application/vnd.keel.token-uri-raw-percent-fragment`; the percent builder has
its own prepared media type. Preserve the existing lane and its registered
builder. Do not silently mix those representations or select another carriage
because its name sounds newer or smaller.

## Agent and MCP sequence

1. Resolve the existing collection, graph, shell and builder on the selected
   chain. Keep stable handles, exact ordered object IDs, media types, lengths,
   digests, compression and store binding.
2. Read back those objects and call `keel-inline-reuse-plan` first. Supply the
   exact builder/store/chain, ordered parts, receipt references, and files of
   actual read-back bytes. Supply `readback: { blockNumber, blockHash,
   orderedObjectIds }`, where the vector comes from the selected-chain binding
   at that block. `parts` must match its count and order exactly. The tool
   validates local bytes and returns a review-only copy plan; caller-supplied
   block, receipt and order evidence still needs authentication.
3. Require zero new stored bytes and an empty object-write/upload plan for
   assembly-only work. If a source change is requested, prepare that declared
   delta and preserve every other reference. Do not rebuild all fragments.
4. Verify the registered shell and reader, current authorized revision route,
   and complete returned bytes. Test the actual public `tokenURI` within the
   2,000,000-byte limit and selected-chain public RPC gas boundary, then verify the decoded work in a
   browser without network fetches. A shell revision cannot replace a
   permanently bound renderer.

Neither the plan nor SDK inspection authenticates a receipt, grants authority,
registers a builder, publishes an object, changes a head, or signs a transaction.
Those remain the selected-chain publication and read-back gates.

## SDK usage

Use the inspected read-back parts rather than recreating them from local
source. Each part contains its role, exact stored `bytes`, SHA-256 `integrity`,
and `carrier` with chain, store, object ID, media type, compression and stored
length.

```ts
import {
  inspectKeelInlineExistingObjectReuse,
  buildKeelInlineTokenURIGraph,
} from "@keel/sdk/inline-viewer-graph";

const existingObjectReuse = {
  mode: "assembly-only" as const,
  chainId,
  store,
};
const inspected = await inspectKeelInlineExistingObjectReuse({
  existingObjectReuse,
  existingParts: receiptReadBackParts, // exact ordered published slices
});
const graph = await buildKeelInlineTokenURIGraph(inspected.root, {
  existingObjectReuse,
  existingParts: inspected.existingParts,
});
```

Inspection preserves the detected carriage and reports
`newSourcePublicationBytes: 0`, `storageTransform: "none"`, and
`selectedChainBindingVerified: false`. Verify the chain binding independently;
do not convert that last value to true merely because local bytes hash correctly.

For explicitly new source, the fresh preparation default may choose compact
raw-percent carriage. That choice must not migrate an existing bound Base64
work or duplicate an already published source. An explicit carriage migration
is a separate review, not an assembly-only repair.

See [KEEL_PRESENTATION.md](KEEL_PRESENTATION.md) for delivery and revision gates
and [KEEL_OBJECT_STORAGE_FOR_CHEAP_READS.md](KEEL_OBJECT_STORAGE_FOR_CHEAP_READS.md)
for the write-once/copy-on-read storage boundary.

## Executable publication gate and prototype map

Use the tested implementations, not a new composer or encoding:

| Route | Canonical implementation | Prototype/regression tests |
| --- | --- | --- |
| Aligned existing Base64 COPY | `keel-harness/libraries/KeelPreEncodedTokenURI.sol`, `KeelHarnessBuilder` | `keel-contracts/test/KeelPreEncodedBench.t.sol`, `test/modules/keel-harness/KeelPreEncodedTokenURI.t.sol` |
| Compact raw-percent COPY | `keel-harness/KeelRawTokenURIBuilder.sol` | `keel-contracts/test/modules/keel-harness/KeelRawTokenURIBuilder.t.sol`, `keel-sdk/tests/sdk-inline-viewer-graph.test.mjs` |
| Exact existing-object reuse | `inspectKeelInlineExistingObjectReuse` | `tests/sdk-inline-existing-object-reuse.test.mjs`, `tests/mcp-prepared-copy.test.mjs` |
| Complete-return rejection | `assertKeelPreparedCopyRead`, `keel-inline-publication-check` | `tests/copy-publication-enforcement.test.mjs` |

Fresh `keel-inline-prepare` accepts compact/raw-percent only. Preserving an
existing aligned Base64 or percent object is supported COPY reuse, with no
carriage migration. The shared SDK planner no longer supplies a fresh-encoding
acknowledgement automatically. `KEEL_LEGACY_CARRIAGE=allow` cannot bypass the
gate; explicit reviewed low-level preparation remains separate from defaults.

For `publish-plan` whose source media is a prepared token-URI fragment, supply
`preparedCopy` with workspace-relative `graphPath`, `expectedTokenURIPath`,
`returnedTokenURIPath`, and decimal `callGasLimit`/`blockGasLimit`. The tool
rechecks exact source SHA/length, chain/store, matching COPY media/builder,
complete URI equality, image/animation containment and full returned size.
Missing evidence or additional wrapping/transport is rejected. Run
`keel-inline-publication-check` first to inspect the same check separately.

The SDK equivalent is `assertKeelPreparedCopyRead`. Supplied read files and a
gas cap are local review evidence; they do not authenticate a chain call or
prove gas used. Verify the actual public collection call, registered runtime,
receipt-backed objects and revision authority independently. Publication does
not become chain-ready because this check passed. Measure the actual complete
return; 900 KB is not a platform constraint or a promised size.

Do not bypass the planner/check with a custom deployment script, runtime
Base64/hex composer, direct wallet call or an environment switch. Padding raw
binary never converts it into an aligned prepared ASCII fragment. An SDK/MCP
gate cannot intercept unrelated direct wallet programs; those must explicitly
use the canonical check before binding or minting.
