> Fresh SDK preparation now uses URI81. The creator-inline-20261005 deployment below is historical Base90 evidence. It must not be claimed as URI81 registration: fresh plans must authenticate a matching registered profile, and a mismatch stops before writes. Existing bindings stay unchanged.

# Modern creator prepared Inline

`prepareKeelCreatorInline` and MCP `keel-creator-inline-prepare` prepare fresh
modular files for the modern creator renderer. Compression, carriage, escaping
and the decoder shell are automatic. The SDK keeps separate HTML, JavaScript,
CSS and asset files; the viewer reconstructs their exact bytes before execution.

Fresh preparation retains original source bytes and inventory order while emitting
JavaScript module descriptors in dependency-first playback order for the existing
registered loader. Its supported static imports, side-effect imports and named
re-exports resolve against declared IDs and aliases. Unsupported cyclic or
undeclared imports fail before storage planning; they do not select another shell.

New files use Brotli when it saves bytes, otherwise none, followed by URI81 (uri81-block-v1)
and the escaping required by JSON, HTML, data URIs and the deployed COPY reader.
The shell's boot literals use gzip and Base64. Browser-native `DecompressionStream`
unpacks that gzip boot; the embedded decoder handles URI81 and Brotli. The full
HTML and metadata receive no whole-document Base64 wrapper. Module metadata
reports the actual encoding, compression and encryption, including `none`.
Existing packages keep their committed codec and object IDs; use
`keel-inline-reuse-plan` for assembly-only reuse.

## Prepare files

MCP defaults to Ethereum Sepolia and the `creator-inline-20261005` store:

```json
{
  "resources": [
    {"id":"index.html","path":"game/index.html","role":"entrypoint","mediaType":"text/html"},
    {"id":"game.js","path":"game/game.js","role":"module","mediaType":"text/javascript"}
  ],
  "posterPath":"game/poster.png",
  "posterMediaType":"image/png",
  "description":"My 1-of-1 game",
  "out":"publication/creator-plan.json"
}
```

Call `keel-creator-inline-prepare` with these arguments. It first reads the
selected instance's registered shell and reader profile from the chain:

- Preparation uses the registry's latest shell revision unless
  `shellRevision` pins one. On Sepolia, `creator-inline-20261005` revision 1
  is the original Base90 shell, which existing tokens keep. Revision 2 (tx
  0x855c3258bdbaa8dd4e4882cf43def4bf3a594b6854a0ed58cf8a09aee391749b) is URI81
  with the legacy-strict reader grammar, and it is the default for fresh work.
- A legacy-carriage (Base90) revision stops the tool with
  `KEEL_REGISTERED_CARRIAGE_MISMATCH`, and nothing is written. Report it; do
  not fall back to a web3://, IPFS or Hybrid pointer for a work under
  2,000,000 bytes. The fix is to append a URI81 shell revision: upload the
  suffix and reader profile, validate the suffix, then have the manager's
  governor append the revision through `executeGovernance`.
- Without a history-capable RPC (`rpc.setup-required`), the plan is written
  with `shellAuthentication: "unavailable"`, and its first gate is to
  authenticate (`pnpm rpc:configure`) and prepare again before any upload.

Otherwise it writes an unsigned plan with exact source hashes, one stored prepared representation per payload,
upload operations, container-table commitments, image carriage and immutable
renderer binding arguments. Standard collector poster images use their native
`data:image/...;base64,...` form, prepared once. The shell prefix and suffix are
registration references to authenticate and reuse, separate from new objects.
Store addresses are canonical checksum strings because their spelling is bound
into shell bytes and descriptor IDs.

The equivalent SDK entry point is:

```js
const plan = await prepareKeelCreatorInline({
  chainId: 11155111,
  store: manifest.creatorPreparedInline.store,
  resources: [
    {id: "index.html", role: "entrypoint", mediaType: "text/html", bytes: htmlBytes},
    {id: "game.js", role: "module", mediaType: "text/javascript", bytes: jsBytes},
  ],
  poster: {bytes: pngBytes, mediaType: "image/png"},
  description: "My 1-of-1 game",
});
```

## Publish through the creator's wallet

1. Resolve the exact deployment instance and authenticate receipt/runtime hashes,
   `factory.metadataRenderer()`, renderer COPY builder/registry, registered shell
   revision and its prefix/suffix digests. Use the manifest in the tester handoff.
2. Publish only `plan.objects`, reusing identical IDs when their exact public
   bytes exist. Use the existing fee-aware `prepareKeelWeld` wallet calls for
   initWeld, carrier casts, weld, seal and harness registration. The plan's
   bytes are prepared UTF-8/ASCII and use Hold compression `none`; Brotli is
   inside the committed URI81 payload. Do not also upload compressed binaries.
3. Complete public source read-back and the raw fragment validation cache.
   Use `validateImage` for the poster's complete data URI. Larger fragments may
   require multiple bounded validation transactions before their digest is cached.
4. Create a collection with `buildKeelCreatorERC721ACall` and `maxSupply: 1n`.
   Read its `CreatorCollectionRegistered` receipt. The collection owner can bind
   its own presentation using `buildKeelCreatorPreparedCopyBindingCall`; platform
   wallet authority is unnecessary. Bind token ID `1n` before minting.
5. Read the renderer's complete proposed tokenURI, compare the complete expected
   URI with `keel-inline-publication-check`, measure its actual byte length and
   selected-chain gas, and verify the exact viewer offline. `completeTokenURIBytes`
   stays null in a preparation plan until this full-return measurement exists.
6. Register the collection's mint route from its owner's wallet, explicitly
   enable creator-admin minting, then use `buildKeelCreatorAdminMintCall` to mint
   quantity one. Verify the receipt, `ownerOf(1)` and the minted public tokenURI.

### Prove programs longer than 256 calls

`eth_simulateV1` accepts 256 blocks per request. The pre-funding proof keeps
one call per block up to 256 calls; a longer publication shares blocks between
consecutive calls, in their order, so the whole program and its final
tokenURI are still proven in one request. Each block's requested envelopes
stay inside the actual block gas limit. On Amsterdam the proven envelope is
the whole `maximumTransactionGas`, so set it near the measured need (a slug
upload is about 36M total gas), not near the block limit: 190M envelopes in a
200M block leave one call per block, and that plan stops before any payment.

### Send in windows, not one receipt at a time

A modular work is hundreds of calls; the grove was 313. Their only ordering is
their order, and consecutive nonces already enforce it. So send them in windows:

1. Call `planKeelSendWindow` (`@keel/sdk/send-window`) or MCP
   `keel-send-window-plan` with the ordered calls and the first unmined index.
2. It simulates the next calls in order with `eth_simulateV1`, one block each,
   and returns every call's nonce and gas. Gas is the simulated use × 1.3, and
   on Sepolia Amsterdam it includes state gas.
3. Broadcast the whole window in nonce order without waiting.
4. Read every receipt, and stop on the first that is not successful.
5. Plan again from `nextIndex`.

Don't estimate each call alone: a live estimate can't see the calls ahead of it
that aren't mined yet. Don't use a fixed 16,777,216 gas limit either: on
Amsterdam that covers execution only, so a slug upload of about 36M total gas
reverts. On Sepolia, a 0.002 gwei tip is enough for inclusion.

The unsigned plan does not sign or submit. Use the normal SDK/wallet publication
workflow; preparation never bypasses source, URI, browser or wallet gates.
`preparedBytesBeforeLiveEnvelope` is a proven fragment lower bound. Its 65,536-byte
envelope reserve is reported as `provisionalTokenURIBudget`, not used to reject a
potentially fitting work. The compiler and complete-return check still reject
an actual complete URI above 2,000,000 bytes or an incompatible selected-chain
read. A source-only plan retains `completeTokenURIBytes: null`.
Complete Inline defaults at or below 2,000,000 returned bytes when the selected
chain's call fits. An over-limit plan fails instead of silently selecting Hybrid.

The Sepolia instance reuses the owner-governed tester storage policy. Protocol
fees there are zero; transaction gas is still payable. This profile does not
change production governance or imply post-quantum wallet signatures. Optional
private payloads retain their declared encryption profile; public modules are
not encrypted merely because they are compressed or URI81 encoded.
