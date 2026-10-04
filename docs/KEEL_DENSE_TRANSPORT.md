# Dense binary carriage

Compressed Hold objects remain native bytes, stored once. Dense transport is a separate, explicitly selected return encoding. It is not compression, unchanged binary, or an extra stored encoded object.

`encodeKeelDenseTransport(bytes, "base90-v1")` encodes the text. `decodeKeelDenseTransport(text, {profile: "base90-v1", byteLength})` reconstructs the exact committed bytes, with a 4 MiB allocation bound, invalid-character rejection and exact output-length/tail checks. Stored SHA-256 is still mandatory before decompressing. The optional `buildKeelDenseTransportDecoder()` emits a self-contained browser decoder, without an encoder, Buffer, RPC, WASM or compression modules.

`buildCompactInlineKeelShell({embeddedContainerDelivery, binaryPayloadCarriage: "base90"})` selects `embedded-shared-containers-base90@1`, accepts `storedDense` payload fields and includes the decoder. `"base91"` selects the separate `embedded-shared-containers-base91@1` profile. The existing Base64 profile remains an explicit independent choice. Omission/as-is still fails closed for text-only binary composers. Mixing a dense field with a Base64 shell, mixing fields, or omitting the matching decoder is rejected.

This SDK capability does not register or deploy a matching EVM composer. Require its exact selected-chain runtime, shell registration, receipt/read-back, complete collection return and browser proof before publication. MCP guidance exposes this distinction. Do not invent a matching profile for an existing Base64 composer or claim local tests updated a live token.

## Wire formats

`base91-v1` uses Joachim Henke's standard basE91 alphabet and little-endian bit queue: 13 bits per pair, or 14 when the low 13-bit value is at most 88. Alphabet:

```
ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$%&()*+,./:;<=>?@[]^_`{|}~"
```

`base90-v1` is a KEEL variant, not standard basE91. It uses printable ASCII 33..126 excluding double quote, backslash, percent and hash. Alphabet:

```
!$&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[]^_`abcdefghijklmnopqrstuvwxyz{|}~
```

Take 12 low bits; if that value is at most 4003, take 13 instead. Emit alphabet[value % 90] and alphabet[floor(value / 90)]. Decode the pair as lowDigit + highDigit * 90; consume 12 bits when (value & 4095) > 4003, otherwise 13. Emit low bytes as the queue fills. Finish with one low digit and, when more than 7 bits remain or the value is at least 90, a second digit. There is no padding character or ignored whitespace.

## Wrapper costs matter

Use `serializeKeelDenseTransportJSON` for JSON directly in a script text node. Use `toKeelDenseTransportDataURL("html", html)` and `toKeelDenseTransportDataURL("metadata", JSON.stringify(metadata))` for the two direct data-URI layers. These explicit helpers are for this measured text boundary, not arbitrary quoted-HTML embedding or an override of generic publisher policy. They preserve Unicode with percent escaping and close script/comment sentinels. Existing general percent serialization and publication guards stay unchanged.

The Base90 alphabet excludes JSON string escapes and URL percent/fragment delimiters. It still includes HTML script delimiters: JSON inside a script must escape actual closing-script/open-script/comment sentinel sequences. Do not substitute a serializer that silently changes the codec alphabet. The generic SDK percent wrapper intended for quoted HTML escapes additional punctuation and can make dense transport larger than Base64. Compare the exact final URI including every JSON/data-URI layer, decoder, image and shell; benchmark bytes and contract call gas separately. A dedicated data-URI text serializer needs its own verified parser boundary and publication profile; local fetch/JSON success is not universal marketplace acceptance.

## Provenance

The pair-code algorithm is derived from Joachim Henke's basE91 encoding/decoding routines, Copyright (c) 2000-2006, under BSD-3-Clause. The source and emitted decoder retain the full notice. Primary reference: https://github.com/mscdex/base91.js/blob/master/deps/base91/base91.c . The Base90 alphabet, generalized threshold, strict decoder bounds and profile integration are KEEL additions.
