# Payload storage: shared defaults and explicit control

`payloadStorage: "compact"` is the shared SDK, MCP, desktop editor and Studio default. The constants and strict resolver live in `@keel/protocol`; `@keel/sdk/presentation` re-exports them. Omitted settings resolve to Compact. Invalid settings fail rather than selecting another format.

| Setting | New supplied payloads | Existing published resources |
| --- | --- | --- |
| Compact (default) | Native bytes, lossless compression when beneficial and supported by the selected reader. Keep `none` when smaller. | Reuse exact receipt-bound object IDs, bytes and readers. |
| Raw | Supplied bytes unchanged, no automatic compression. This includes caller-supplied binary/precompressed data. Explicit incompatible compression overrides fail. | Reuse exact receipt-bound object IDs, bytes and readers. |

Studio and the editor expose **Payload storage** in their existing technical/viewing controls. The choice passes through drafts, agent handoff, estimates, resource preparation and upload plans. Editor previews and game builds include it in cache identity. It is independent of `viewer=none`/the Creator-owned shell control, `delivery` (Inline/Hybrid), and URI `carriage`. Raw preserves manual creator control; it does not change the chosen shell or turn off byte-integrity checks and wallet review.

## Shell ownership

Shell choice is independent of payload storage. Default to the registered KEEL verification shell. If a creator explicitly selects viewer=none, preserve their creator-owned HTML shell and direct-artifact presentation through handoff, preview, preparation and publication; do not insert or label it as canonical protection. The same native-byte/no-duplicate storage policy applies to both. Existing explicit creator shell registration/selection APIs remain available for reusable custom shells. The explicit creator-owned Inline path currently accepts self-contained UTF-8 HTML. Supplied dependency graphs need a compatible custom reader/composer; unsupported inputs fail rather than selecting a network loader or canonical wrapper. Raw retains deliberate creator formatting. Compact and Raw do not turn a custom shell into a verified KEEL interface.

## The native binary boundary

**Storage and return requirements both apply.** Native compressed payload return defaults to as-is. The existing embedded composer returns Base64 and the SDK refuses to select it implicitly; it requires an explicit creator-authorized `binaryPayloadCarriage: "base64"`. A request for no Base64, no hex, unchanged files or no expanding encoding covers the contract return and HTML as well as Hold storage. Do not use transient encoding to bypass that request. Unsupported as-is Inline bytes must stop before signing rather than fall back to encoding, Hybrid, or a different viewer. Three-byte padding is a testable framing hypothesis, not evidence of a compatible native return.

Keep compressed binary objects as native bytes in Hold. `ObjectCompression.None` on a container can mean the object is already an exact gzip/LZMA stream; the verified descriptor declares its browser codec. Do not automatically re-compress precompressed streams or publish an encoded sibling for the same presentation.

The registered native-resource reader verifies stored SHA/length, decoded SHA/length, ranges and dependencies before running creator code. The embedded composer reads those same raw objects and assembles a self-contained response. It may emit Base64 or hex **in return memory**. That expansion affects response size and read gas; it does not create another stored copy. The `composeTokenURI` prototype and its table tests demonstrate this route; registration, selected-chain receipts and full browser/read proof remain required. See [binary resource delivery](KEEL_BINARY_RESOURCE_DELIVERY.md).

The whole-document `data:...;base64` decoder still decodes its entire input. Padding aligns already encoded three-byte/six-bit groups; it cannot preserve arbitrary unencoded bytes. A JavaScript shell can read and decode a binary container through the appropriate native-resource profile. That is a distinct mechanism from a standard Base64 decoder ignoring an unencoded middle.

## Prepared COPY and native-resource composition

These are separate supported boundaries. Fresh prepared-COPY text resources use exact `storedText`/`none` and compact raw-percent carriage; unchanged prepared objects are copied with their existing reader. Its fresh-body check rejects new encoded payload storage. A native-container composer instead needs verification of actual Hold records/table plus exact decoded source and full returned URI. Do not feed an emitted native-container response to the prepared-COPY check and call its text carriage a storage violation. The read-only token audit labels storage as **not inspected** until actual storage inventory is supplied.

Generic local embedded slots are presentation fixtures; their bytes alone do not select a publishable native-container profile. If a selected catalogue cannot carry a binary input, surface the exact compatibility boundary instead of silently converting it to stored Base64, adding a duplicate upload or switching Inline to a network loader. Do not claim a local preview or a disabled upload is a completed publication.

## Calls and persistence

```js
await prepareStudioArtifact({ ...project, payloadStorage: "compact" }); // omission is identical
await createRecursiveUploadPlan(bytes, { ...options, payloadStorage: "raw" });
await stageKeelStudioProject({ ...handoff, payloadStorage: "raw" });
```

MCP `upload-plan`, `cost`, `keel-inline-prepare` and `keel-studio-stage-project` expose the same enum/default. `keel studio-stage --config project.json` accepts `payloadStorage` in JSON or YAML. Existing projects without a setting receive Compact on parsing; explicit Raw survives round-trip and cache refresh.

Report source bytes, newly stored bytes, reused stored bytes, protocol/descriptor overhead, returned HTML, complete `tokenURI` bytes and gas separately. The audit of returned HTML cannot prove how many bytes were paid for in Hold. No fixed 900 KB or other response-size promise follows from raw compressed object size.
