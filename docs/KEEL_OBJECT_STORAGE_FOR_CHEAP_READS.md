# Storing objects so reads are cheap

**Existing objects: run `keel-inline-reuse-plan` first and preserve the bound
prepared COPY route. Do not encode, repack, transcode, or upload the same body
again.** Read [KEEL_PREPARED_COPY_ASSEMBLY.md](KEEL_PREPARED_COPY_ASSEMBLY.md)
before choosing a builder or preparing publication bytes.

A token's metadata is read far more often than it is written. Every marketplace,
wallet, indexer and explorer that ever looks at it pays to produce it again, and
none of them pay to store it. So the arithmetic belongs at write time, once, and
a read should cost only what it takes to move bytes that already exist.

This is the convention the contracts read by. **Nobody writing a collection
should have to apply it by hand** — the SDK lays bytes down this way, and the
numbers below are what that buys.

Every figure here is measured, not modelled. See
`packages/contracts/test/KeelPreEncodedBench.t.sol`,
`KeelDirectCopyBench.t.sol` and `KeelBackpackTokenUriGas.t.sol`. Each
benchmark asserts the two paths produce the **same output** before comparing
their cost, because a cheaper read that returns something different is not a
cheaper read.

## The rules

### 1. Prepare new image carriage once; copy existing image carriage exactly

Preserve original binary artwork locally for provenance. For a new prepared
viewer, validate those bytes, prepare the exact direct
`data:image/<type>;base64,<payload>` boundary once at build time, and publish one
receipt-bound ASCII payload or URI. The contract copies the prepared header,
payload and delimiter/footer; it never Base64-encodes or decodes image bytes
inside `tokenURI`. Do not publish raw artwork plus another encoded copy for the
same presentation. A placeholder such as `AA==` is not an image.

For an existing viewer, preserve its exact published image object and source
digest. A representation mismatch requires review of its registered reader;
it does not authorize a duplicate image upload or runtime encoder. For GIFs,
keep the original dimensions, codec and pixels and use the direct GIF carriage,
never an SVG wrapper. New compact metadata/HTML does not require a second
whole-document wrapper; existing prepared carriage retains its current builder.

### 2. Encode once, never twice

Encoding a complete JSON document around an already prepared image adds
another expansion and repeats work on every read. For new compact preparation,
serve the prepared raw-percent document instead:

```
data:application/json;charset=utf-8,{"name":…}
```

| | gas | chars |
| --- | --- | --- |
| encoding the document a second time | 15,842,907 | 304,885 |
| serving it as it stands | **1,373,256** | 228,678 |

These fixture measurements compare runtime encoding with direct prepared
copy. They do not justify changing an existing bound Base64 lane: aligned
prepared Base64 slices are already copied without encoding the large body.

Do not escape the complete large document on each read either. Prepare its
parser-safe carriage once, and escape only the small live metadata boundaries
with the matching builder. Preserve the artwork and token naming; parser
safety must not depend on silently removing characters from creator content.

### 3. Where pieces must be joined, join pre-encoded ones

`base64(A + B) == base64(A) + base64(B)` whenever `len(A) % 3 == 0`. JSON ignores
spaces, so a static prefix can be padded to that boundary for nothing. Encode
each piece once at write time and a read only joins them:

| | gas |
| --- | --- |
| encoding the whole document at read | 15,893,247 |
| concatenating pre-encoded pieces | **2,406,646** |

Same string out of both — the benchmark asserts it. The canonical contract
path is `KeelHarnessBuilder.preEncodedTokenURI`; its `preparedTokenURI` body
route also copies the independently registered top/bottom shell around a
prepared body. The SDK aligns new HTML slices at nine-byte boundaries for both
Base64 layers. Existing slices keep their exact bytes. Appending padding to a
raw compressed binary object does not make it compatible with this route.

### 4. Copy once, not three times

`haulObject` copies the bytes out of their carriers, `string.concat` copies them
again into a joined buffer, and returning copies them a third time. Nothing is
computed in any of it; the same bytes are restated.

Measure the final length first, allocate exactly one buffer, and `extcodecopy`
each carrier straight into its place:

| | gas |
| --- | --- |
| `haulObject` then `string.concat` | 1,587,265 |
| measure, allocate once, copy into place | **786,575** |

`KeelHarnessBuilder._assembleWithContext` already works this way, and its
comment records why: a bounds-checked `MSTORE8` per byte is tens of gas, and on a
35KB viewer that loop alone once needed 48.3M of a node's 50M `eth_call` cap.

### 5. Bound what a read can be made to cost

An unbounded presentation can make `tokenURI` unreadable for every client.
Measure the complete returned URI through its actual collection and builder,
not just the compressed payload or a local helper. The Inline recommendation
gate requires at most 2,000,000 returned bytes and a successful read under
30,000,000 gas; smaller contract-field limits remain separate constraints.

The ceiling protects readers. Keep the actual supplied collector image and
full artwork commitments; reducing read cost does not authorize substituting
a poster, lowering image quality or removing content.

## What this adds up to

Reading the original 631px benchmark fixture, over the course of applying the
rules above:

| | read gas |
| --- | --- |
| artwork encoded three times over | 67.3M |
| encoded once | 20.3M |
| stored pre-encoded, concatenated | 8.6M |
| copied once instead of three times | **~2M** |

The trade throughout is the same one, and it is deliberate: **pay more to store,
pay far less to read.** Storage is bought once by the person who chose to
preserve something. Reads are paid by everyone who ever looks at it.
