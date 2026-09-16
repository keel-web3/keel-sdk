# KEEL publication modes and recovery

Read the MCP resource `keel://mcp/publication-modes` before quoting or planning
a large publication. A selected mode is part of the plan identity and must not
change during retry or recovery.

## Presentation is separate from storage

Use the SDK terms exactly:

- **Boot shell**: small, uncompressed HTML the contract can read directly.
- **Resource graph**: digest-bound scripts, modules, assets, and data. Child
  resources may be compressed.
- **Browser decoder**: committed browser/WASM code that verifies stored bytes,
  decompresses them, and verifies decoded bytes before execution.
- **Inline**: the complete `animation_url` is assembled onchain. It contains no
  `/content`, gateway, IPFS, or RPC fetch dependency. **This is the default for a
  collector-facing work.** Reach it with `keel-inline-prepare`, never by hand.

### Inline is the default, and `image` is part of it

An agent that skips Inline almost always does the same thing: it leaves
`previewImageURI` empty and puts a locator in the presentation. `KEEL721.tokenJSON`
then falls back to the manifest URI —

```solidity
imageURI = bytes(previewImageURI).length != 0 ? previewImageURI : manifestURI;
```

— so `image` becomes `eip155:.../object/0x...`, which no marketplace can fetch.
The token looks minted and is unreadable.

Rules, in order:

1. `image` is an inlined `data:` URI. Never `web3://`, `ipfs://`, `https://`, or a
   bare manifest locator. `buildKeelPreparedOneOfOneTokenURI` enforces this;
   `setDefaultPresentation` does not, so do not go around it.
   Keep the source image binary in one native KEEL object. At the final metadata
   boundary, assemble the `data:image/<type>;base64,` header, canonical Base64
   of the exact source bytes, and the JSON delimiter/footer; do not upload a
   Base64 text duplicate. For GIFs this is a direct GIF URI, never an SVG
   wrapper, generated substitute, or short placeholder such as `AA==`.
2. Keep the poster small. It is stored per token, and roughly 20,000 gas per
   32 bytes. Around 12 KB is a good ceiling; a 30 KB string is ~19M gas and an RPC
   will refuse the transaction as `gas limit too high`.
3. The work itself is the graph, not the poster. Big bytes belong in KeelHold as
   shared fragments, cast once per chain and named by every token that uses them.
4. A `text/javascript` graph module MUST be a classic script that publishes a
   global. The shell runs module JavaScript with `document.head.append(script)`,
   so an ES module fails on `export`.
5. WebAssembly in the graph needs the shell's wasm allowance, which is granted
   only when an `application/wasm` item is actually present.
- **Hybrid**: the shell and resources may all remain native KEEL storage, but
  the browser resolves exact objects through an RPC reader.
- **IPFS**: explicitly selected IPFS delivery. Never infer it from Hybrid.

Use `KEEL_PRESENTATION_CODEC_POLICY` for compression language. The boot shell
uses `none`. Gzip/Deflate require a capability-checked browser decoder path.
Brotli requires an exact declared KEEL decoder module, normally the reusable
thin WASM module published once per chain; never silently place another copy in
the creator payload. A missing declared decoder module stops before wallet
review.

### Existing graph revisions reuse everything unchanged

Resolve the live selected-chain graph first and call `keel-revision-plan`.
The automatic path accepts one declared changed resource and the exact next
graph/resource versions. All other object IDs, digests, roles, media types,
versions, and byte lengths must remain identical. Never use an existing work
revision as a reason to rerun `upload-plan` for its artwork, shell, encoder, or
other unchanged modules. `publish-plan` recomputes this gate and binds the
upload digest to the accepted resource before wallet review.

With `follow-latest`, publish and activate the next graph or module version and
perform no token presentation write. With `pinned`, update only the small
binding after publication. Report new stored bytes separately from onchain
reused bytes. An undeclared change, redundant byte copy, non-sequential
version, or automatic delta above 65,536 stored bytes is blocked. Studio must
derive this workflow from the existing target; the creator does not opt in.

For a small p5 work, prefer the Gzip p5 fragment with the browser
Gzip/Deflate shell profile. Use `buildKeelInlineShellFragments`,
`buildKeelInlineModuleFragment`, `buildKeelInlineLocalDocument`, and
`compareKeelInlineTokenURICarriages`. The comparison reports both explicit
prepared graphs: legacy inner-Base64 via
`buildKeelInlinePreEncodedTokenURIGraph`, and compact escaped HTML via
`buildKeelInlineEscapedTokenURIGraph`. Record the selected mode before wallet
review and publish only that ordered graph; never switch to the measured winner
during retry or recovery. Compact graphs require
`KeelPercentTokenURIBuilder`. The local document is a preview/build result, not
another object lane. Studio must bind its shell and middle fragments to exact
same-chain objects and report only the compressed creator entry as new payload
bytes.

Call `assessKeelInlinePresentation` before recommending Inline. The boot shell
must be uncompressed HTML, the complete reconstructed document must stay at or
below 2,000,000 bytes, the exact configured builder read must stay under the
30,000,000-gas public-RPC safety cap, and no runtime fetch may remain. Compress
heavy child modules; do not compress the root shell. Do not call a `/content`
or RPC-resolved shell Inline.

## Native carrier v1

`native-carrier-v1` is the implemented, contract-readable route. Compress the
immutable payload first, split it into at most 23,000-byte carrier chunks, and
put at most three chunks in one bounded executor transaction. One logical KEEL
object can therefore use many immutable carriers and many executor
transactions. Those transactions do not mean many wallet approvals: the normal
managed route asks the creator once, then the bounded executor resumes from its
durable cursor.

Report these separately: calldata intrinsic gas, native carrier-write gas,
object creation gas, logical registry-operation gas, executor escrow, actual
transaction fees, selected testnet gas price, and any mainnet reference price.
Escrow is locked execution funding, not a transaction fee or a mainnet quote.

## History inscription v1

`history-inscription-v1` is benchmark-only until a deployed contract, indexer,
viewer, recovery journal, and receipt read-back are all proven together. It
places immutable bytes in Ethereum transaction history or logs. Contracts
cannot later read those historical bytes. An indexer/viewer needs receipt or
archive access, so this is not native KEEL storage and must never inherit a
native one-read or contract-readable claim.

## External-chain inscription v1

`external-chain-inscription-v1` is design-only. It may put payload history on a
configured cheaper chain while committing identity on Ethereum. It requires an
explicit chain URI, indexer, finality policy, viewer resolver, and verification
proof. Do not infer those components or publish through this route merely
because it prices lower.

## Recovery boundary

Before requesting approval, identify an existing managed job from the durable
journal, saved receipts, and a bounded read-only chain scan. Match owner,
executor, plan digest, chunk count, operation count, and cursor. Persist failed
chunk indexes explicitly, reconcile a timed-out submission receipt before any
retry, never repeat confirmed chunks or operations, and never let stale UI
state overwrite a newer saved job ID. Missing or ambiguous recovery evidence
stops safely without a new approval or job. Clearing a draft/job is explicit
and preserves useful receipts.
