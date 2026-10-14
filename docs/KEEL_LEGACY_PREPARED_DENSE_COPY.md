# Legacy public-release compressed COPY adapter

`buildKeelLegacyPreparedDenseDocument` prepares independently identified source
resources for the existing KEEL721/public-drop release compiler. It creates no
collection, recipient, supply, sale, payout, controller, registration, or mint
call. Its `document` is a normal `KeelInlineLocalDocument`, consumed by
`buildKeelInlineTokenURIGraph` and `buildKeelPreparedOneOfOneTokenURI`. The latter
continues to emit the original six-field `keel-context@1`. The reader also accepts
other canonical uint256 token IDs in that context, without inventing modern
creator-factory, table, composer, or seed-registry provenance.

The distinct reader profile is `keel.legacy-prepared-dense-copy@1`, and its
distinct shell ID is `KEEL_LEGACY_PREPARED_DENSE_SHELL_ID`. Never replace the
existing canonical follow-latest shell head: its array framing belongs to older
published bodies. Existing registered native/Brotli/LZMA/embedded Dense profile
bytes remain unchanged. New profile availability requires the selected-chain
keeper-governed HarnessBuilder registration, exact fragment bytes, revision,
metadata, builder/store binding and public-chain authentication. The SDK returns
`selectedChainRegistrationVerified: false`; building the descriptor is not
registration. This change sends no transaction.

For fresh Compact source, the adapter keeps each resource ID, aliases, media,
role and whole-source SHA-256/length. It divides each resource into the ordinary
512 KiB decoded leaves and compares Brotli quality 11, gzip level 9, deflate level
9 and unchanged bytes, selecting a strictly smaller compressed byte stream.
Explicit codecs remain explicit. Unchanged equal-content leaves share one
content-derived pack; the identity binds codec, stored commitment and decoded
commitment. Dense Base90 and both URI escapes are prepared once. Contracts copy
those committed fragments; neither the full document nor game payload is
Base64-encoded by the contract. The compressed canonical shell boot uses Base64
literals, with its digest-bound Brotli decoder installed before resource
verification. An ordinary child artwork module cannot substitute for that
bootstrap decoder.

Optional `storedBytes` preserves an existing exact **local** compressed stream
with its explicit codec, after bounded decoded byte equality. It does not claim
reuse of paid native Hold object IDs. Streams above the reader's 32 MiB decoder
segment boundary require their original segmented descriptor; the API refuses
to silently repack them. The normal fresh 512 KiB leaf route has no aggregate
32 MiB source limit. Defaults match 256 source resources/128 MiB; the caller can
pass the configured upload limit through 1024 resources/512 MiB. Bounded internal
descriptor groups and physical COPY groups preserve logical order and keep the
physical graph below its existing 64-part boundary. Complete tokenURI bytes and
selected-chain read gas remain separate mandatory gates.

Pass exact registered UTF-8 `modules` in the existing canonical phase/weight
order. Their original fragments remain existing publication parts, rather than
newly compressed creator payloads. Compressed/Base64 module fragments require a
receipt-aware compatible existing-object reader and fail explicitly here. The
fresh Base64/hex guard is unchanged. Explicit Raw must use the existing exact
raw-text/carriage API; the adapter refuses to change Raw into Dense COPY.

`readKeelLegacyPreparedDenseSources` replays the actual recognized body and
returns exact source bytes without executing creator code. Static inspection
requires exact data-only wrapper framing and recognizes only the maintained
collection context tail. `assertKeelPreparedCollectorInlineMetadata` reconstructs
that literal boot before applying the ordinary collector checks to the actual
canonical inner document. The browser-safe collector-policy module remains
unchanged. Serialized audits retain the distinct profile discriminator.

The adapter does not establish a shared physical representation for a metadata
image and the same image referenced by artwork. A separate metadata image URI
plus a Dense artwork resource is not proof of one paid representation. Normal
Studio integration must preserve existing paid objects and block or resolve
that shared-image boundary before requesting a new storage payment. These SDK
tests prove exact decoded poster bytes, not paid-image deduplication.

The focused qualification and exact unsigned shell registration fragments are
under `recovery-evidence/legacy-prepared-dense-20261014`. They are local synthetic
proof, not deployed registration, owner-release acceptance, a public-chain mint,
or the complete ordinary SDK/Studio suite.
