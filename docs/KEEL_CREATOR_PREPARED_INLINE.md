# Modern creator prepared Inline

`prepareKeelCreatorInline` and MCP `keel-creator-inline-prepare` prepare fresh
modular files for the modern creator renderer. Compression, carriage, escaping
and the decoder shell are automatic. The SDK keeps separate HTML, JavaScript,
CSS and asset files; the viewer reconstructs their exact bytes before execution.

New files use Brotli when it saves bytes, otherwise none, followed by Base90-v1
and the escaping required by JSON, HTML, data URIs and the deployed COPY reader.
The shell's boot literals use gzip and Base64. Browser-native `DecompressionStream`
unpacks that gzip boot; the embedded decoder handles Base90 and Brotli. The full
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

Call `keel-creator-inline-prepare` with these arguments. It writes an unsigned
plan with exact source hashes, one stored prepared representation per payload,
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
   inside the committed Base90 payload. Do not also upload compressed binaries.
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

The unsigned plan does not sign or submit. Use the normal SDK/wallet publication
workflow; preparation never bypasses source, URI, browser or wallet gates.
Complete Inline defaults at or below 2,000,000 returned bytes when the selected
chain's call fits. An over-limit plan fails instead of silently selecting Hybrid.

The Sepolia instance reuses the owner-governed tester storage policy. Protocol
fees there are zero; transaction gas is still payable. This profile does not
change production governance or imply post-quantum wallet signatures. Optional
private payloads retain their declared encryption profile; public modules are
not encrypted merely because they are compressed or Base90 encoded.
