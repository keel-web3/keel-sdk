# Inline payload boundaries: the default publication path

Shared default and creator control: read [KEEL_PAYLOAD_STORAGE.md](KEEL_PAYLOAD_STORAGE.md). Native stored bytes and transient return encoding are separate; the prepared-COPY guard applies to prepared-COPY storage, not every native-composer response.

New UTF-8 HTML, CSS and JavaScript use `storedText`, `compression: "none"` and the compact raw-percent COPY builder. Decode and re-encode the text to verify exact source bytes before preparing it. The canonical verifier supports this representation. Preserve independently revisionable resource IDs and dependency edges. Never introduce a new `storedBase64` or `storedHex` body to make preparation succeed.

The no-generated-duplicate rule applies to **child payloads** as well as outer metadata/HTML. Canonical prepared-COPY gates inspect their decoded resource arrays and reject newly generated Base64/hex body copies. Native-resource composer returns and explicit Raw creator-authored encoded HTML are separate boundaries: inspect actual storage, preserve the supplied source, and do not generate a second encoded sibling. Viewer=none uses buildKeelCreatorOwnedInlineDocument for supported self-contained UTF-8 HTML and raw-artifact policy without canonical protection. These checks do not intercept arbitrary wallet programs or arbitrary JavaScript encodings.

## What the header and padding actually do

| Boundary | Tested behavior |
| --- | --- |
| `data:text/html;charset=utf-8,...` | Reads text directly after URI percent decoding. There is no Base64 decode. |
| `data:text/html;base64,...` | Decodes the entire payload as Base64. MIME type labels the result; it does not bypass decoding of the middle. |
| Aligned prepared Base64 prefix/body/suffix | COPY concatenates already encoded, correctly aligned slices. It avoids runtime encoding and duplicate preparation of existing objects. |
| Newlines in Base64 | A forgiving decoder ignores whitespace. It does not preserve arbitrary plain text or binary between encoded slices. |
| FRAY native stored-object/ABI reader | Strips verified ABI framing and returns exact compressed bytes to its decoder through RPC. This is a bytes reader, not a self-contained Inline data URI. |

The SDK's `createComposableBase64Fragment` and `concatenateComposableBase64Fragments` implement alignment of **already encoded** fragments. Do not describe them as an arbitrary unencoded binary passthrough.

Use the shared percent-carriage helpers rather than concatenating unescaped strings. URI-sensitive characters, percent signs and JSON/script delimiters need context-specific escaping. JSON escaping does not authorize byte changes: BOMs, Unicode, backslashes and literal `</script>` text must round-trip exactly. The browser must render the tested bytes. Require the registered verification interface when viewer=keel-verification-shell or canonical protection is claimed; explicit viewer=none preserves the creator-owned HTML without inserting or claiming canonical UI.

## Existing objects and binary assets

Existing prepared fragments retain their exact bytes, object IDs, ordered bindings, chain/store and matching reader. Use `keel-inline-reuse-plan` and SDK `existingObjectReuse: { mode: "assembly-only", chainId, store }`; this route produces no new upload plan or encoded body. Existing read-only audits can inspect encoded historical payloads without endorsing a new encoded copy.

If an existing raw compressed object is incompatible with the self-contained Inline reader, stop with the exact incompatible boundary and measured sizes. Do not transcode it to Base64/hex, switch to a remote loader, invent an encoder/composer, or mint a replacement. A compatible reader recipe needs byte-identity and actual browser evidence before use. The SDK does not promise that every binary object has an encoding-free Inline representation.

Direct collector images are a separate media boundary: preserve the exact original PNG/GIF/JPEG/SVG/WebP bytes and use the tested direct image carriage. Never upload both a raw image and a second encoded copy for the same presentation. Do not wrap, regenerate or downsample images to conceal size. This permitted media boundary must not be used to smuggle compressed scripts or containers; the image container is checked.

## Test the user's actual token

Call `keel-inline-token-audit` with `rpcUrl`, `chainId`, `collection` and string `tokenId`. It performs bounded read-only calls, pins `tokenURI` to a block, verifies chain identity and rechecks the block hash. It reports:

- complete returned tokenURI bytes, decoded metadata/HTML/image bytes;
- Base64 document layers;
- raw packed child bytes, child text-carriage bytes and added bytes from Base64/hex;
- whether the canonical child-payload representation satisfies the fresh-body policy.

`freshPayloadPolicySatisfied` is a representation check only. It is not registry, receipt, authority, external-dependency, browser, device or publication proof. The tool never signs or submits. Use `keel-inline-publication-check` with the exact graph and complete expected/returned URI before creating a fresh prepared-viewer `publish-plan`. Its digest binds the checked source and full return; caller-supplied local read evidence remains distinct from authenticated public read-back.

Report source size, newly stored versus reused bytes, complete returned bytes and browser proof separately. Compressed pack size is not tokenURI size; 900 KB is not a universal promise.

## References

- [Prepared COPY architecture and prototype map](KEEL_PREPARED_COPY_ASSEMBLY.md)
- [Data URL processing](https://fetch.spec.whatwg.org/#data-urls)
- [Forgiving Base64 decoding](https://infra.spec.whatwg.org/#forgiving-base64-decode)

Regression checks cover exact UTF-8/BOM/script round-trips, blocked new encoded body copies, unchanged existing-object COPY, actual full-return accounting, bounded block-pinned RPC reads and browser mounting of the canonical shell.
