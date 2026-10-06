# Proofs and sealed content

KEEL can keep two kinds of private things on-chain.

**Proofs.** Publish a 32-byte fingerprint of a text or file now, reveal what
it was later, and anyone can check that it matches. Use this to prove you had
an idea, a file, a prediction or a bid at a certain time without showing it.

**Sealed content.** Lock text or a file with your passkey (or a passphrase, or
a recovery key you keep offline) and store the locked bytes on-chain like any
other KEEL object. Everyone can see that something sealed exists and how big
it is. Only someone holding one of its keys can read it. The key never goes
on-chain and never leaves your device.

Things to know before you seal:

- **Keep a backup way in.** A sealed object can have up to 8 keys ("slots").
  Add a recovery key or a second passkey. If every key is lost, the content is
  gone for good. Nobody, including KEEL, can open it.
- **On-chain is forever.** You can publish a new version with different keys,
  but the old bytes stay on-chain with their old keys. If a key leaks, treat
  everything it opened as public.
- **Passphrases can be guessed offline, forever.** Use a long one (four or
  more random words). Passkeys and recovery keys cannot be guessed.
- **A passkey belongs to one website.** A passkey made on `onkeel.io` opens
  sealed objects on `onkeel.io`. It works on any device your passkey syncs to.

## Use it

```ts
import {
  createKeelCommitment, verifyKeelCommitment,
  createKeelMerkleCommitment, verifyKeelMerkleProof,
  sealKeelContent, openKeelContent, addKeelSealedSlot,
  createKeelRecoveryKey, describeKeelSealed,
} from "@keel/protocol";
import { createSealingPasskey, unlockSealedWithPasskey, isPasskeySealingSupported } from "@keel/sdk/sealed-passkey";

// Proof: publish commitment.digest (a bytes32); keep the salt and the text.
const commitment = await createKeelCommitment("I predict 42");
await verifyKeelCommitment(commitment, "I predict 42"); // true

// Many items under one root, revealed one at a time.
const tree = await createKeelMerkleCommitment(["bid A", "bid B", "bid C"]);
await verifyKeelMerkleProof(tree.root, "bid B", tree.proofFor(1)); // true

// Seal with a passkey plus an offline recovery key.
if (await isPasskeySealingSupported()) {
  const passkey = await createSealingPasskey({ rp: { name: "KEEL", id: "onkeel.io" }, user: { name: "alice" } });
  const recovery = createKeelRecoveryKey(); // show recovery.text once; the user saves it
  const { envelope } = await sealKeelContent("meet at the north gate", {
    slots: [passkey.slot, { kind: "raw-key", key: recovery.key }],
  });
  // ...store `envelope` as a KEEL object (media type application/vnd.keel.sealed)...

  describeKeelSealed(envelope); // type, size, which kinds of key can open it: no secrets needed
  const unlock = await unlockSealedWithPasskey(envelope);
  const { text } = await openKeelContent(envelope, unlock);

  // Add a passphrase later without re-encrypting the content.
  const next = await addKeelSealedSlot(envelope, unlock, { kind: "passphrase", passphrase: "four random words here" });
}
```

`unlockSealedWithPasskey` asks the user to pick a passkey for the site. Pass
`knownCredentialIds` (from `passkey.credentialIdText`, which is not secret) to
skip the picker. `prepareSealingPasskeySlot` makes a slot from an existing
passkey for the next sealed object; every slot uses a fresh salt.

Errors: malformed input throws `TypeError`, size limits throw `RangeError`,
and opening throws `KeelSealedError` with `code` `"no-slot"`,
`"wrong-secret"` or `"tampered"`. Passkey helpers throw `KeelPasskeyError`
(`"unsupported"`, `"prf-unsupported"`, `"cancelled"`, `"aborted"`,
`"wrong-site"`, `"unknown-passkey"`, `"no-passkey-slot"`, ...).

## Format reference

### `keel-commitment@1`

```json
{ "protocol": "keel-commitment@1", "algorithm": "sha-256", "digest": "0x…32 bytes", "salt": "0x…32 bytes" }
```

- Salted (the default): `SHA-256("keel-commitment@1" ‖ 0x00 ‖ len(salt) ‖ salt ‖ content)`,
  salt 16–64 bytes (32 random by default).
- Unsalted (`salt: "none"`, for public files): plain `SHA-256(content)`, the
  same digest `sha256sum` and KEEL integrity records produce. Only use it when
  the content cannot be guessed.

### `keel-merkle@1`

- Leaf: `SHA-256(0x00 ‖ itemCommitment.digest)`; each item is salted on its own.
- Node: `SHA-256(0x01 ‖ left ‖ right)`; an odd last node moves up unchanged.
- Root: `SHA-256("keel-merkle@1" ‖ 0x02 ‖ uint32be(count) ‖ top)`, so the root
  also fixes the number of items (1 to 1,048,576).
- Proof (`keel-merkle-proof@1`): `{ index, count, item: <commitment with salt>, siblings: [hex…] }`.
  The verifier walks from `index` using `count` to know where a level has no sibling.

### Reveal files: `keel-proof-reveal@1` and `keel-merkle-reveal@1`

The private half of a proof, written by `createKeelProofReveal` /
`createKeelMerkleReveal` and checked by `verifyKeelReveal`. Studio and the
desktop editor read and write the same JSON, so either can check the other's.

- `keel-proof-reveal@1`: `{ protocol, createdAt, commitment, content }`.
  `content` is `{ kind: "text", text }` (text up to 1 MiB travels inside the
  file) or `{ kind: "file", name, mediaType, byteLength, sha256 }` (the file's
  bytes are kept separately and checked against `sha256` before the
  commitment).
- `keel-merkle-reveal@1`: `{ protocol, createdAt, root, count, items }`, each
  item `{ name, mediaType, byteLength, sha256, proof }`. A checked file is
  matched to its item by SHA-256, then its proof is walked to `root`.

Publish only `commitment.digest` or `root`. A reveal file holds salts, so
sharing it reveals what was proved. `verifyKeelReveal(reveal, { file,
published })` returns `{ valid, matchesPublished?, item?, reason? }`, where
`reason` is plain language suitable for showing to people.

### `keel-sealed@1` envelope

| offset | bytes | field |
|---|---|---|
| 0 | 4 | magic `KSLD` (`4b 53 4c 44`) |
| 4 | 1 | frame version `1` |
| 5 | 4 | header length `H`, big-endian, 2–65,536 |
| 9 | H | header, RFC 8785 canonical JSON (UTF-8) |
| 9+H | `payloadBytes` | AES-256-GCM ciphertext of the (compressed) content, with its 16-byte tag |

Header (binary values are unpadded base64url):

```json
{
  "protocol": "keel-sealed@1",
  "content": {
    "cipher": "aes-256-gcm",
    "compression": "none | deflate-raw | gzip",
    "iv": "12 bytes",
    "keyCommitment": "32 bytes",
    "mediaType": "text/plain;charset=utf-8",
    "byteLength": 30,
    "payloadBytes": 46,
    "commitment": "32 bytes (optional)"
  },
  "slots": [
    { "kind": "passkey-prf", "credentialHash": "16 bytes", "salt": "32 bytes",
      "info": "keel-sealed/passkey-prf@1", "iv": "12 bytes", "wrappedKey": "48 bytes",
      "rpId": "onkeel.io (optional hint)", "credentialId": "(optional)" },
    { "kind": "passphrase", "kdf": { "name": "pbkdf2-sha256", "iterations": 600000, "salt": "16 bytes" },
      "iv": "12 bytes", "wrappedKey": "48 bytes" },
    { "kind": "raw-key", "salt": "16 bytes", "iv": "12 bytes", "wrappedKey": "48 bytes" }
  ]
}
```

Key schedule. `CK` is a random 256-bit content key; every slot wraps the same `CK`.

| value | derivation |
|---|---|
| content cipher key | `HKDF-SHA-256(CK, salt "", info "keel-sealed/content-key@1")` |
| `keyCommitment` (public) | `HKDF-SHA-256(CK, salt "", info "keel-sealed/key-commitment@1")` |
| plaintext salt (secret) | `HKDF-SHA-256(CK, salt "", info "keel-sealed/plaintext-salt@1")` |
| `commitment` | `keel-commitment@1` digest of the plaintext with the plaintext salt |
| content AAD | `"keel-sealed/content@1" ‖ 0x00 ‖ canonicalJson(header.content)` |
| slot AAD | `"keel-sealed/slot@1" ‖ 0x00 ‖ canonicalJson({ keyCommitment, slot: <slot without wrappedKey> })` |
| passkey KEK | `HKDF-SHA-256(PRF output, salt slot.salt, info slot.info)`; the PRF is evaluated with `slot.salt` |
| passphrase KEK | `PBKDF2-HMAC-SHA-256(NFC(passphrase), kdf.salt, kdf.iterations)` |
| raw-key KEK | `HKDF-SHA-256(recovery key, salt slot.salt, info "keel-sealed/raw-key@1")` |
| `wrappedKey` | `AES-256-GCM(KEK, slot.iv, CK, slot AAD)` |
| `credentialHash` | first 16 bytes of `SHA-256("keel-sealed/credential@1" ‖ 0x00 ‖ slot.salt ‖ credentialId)` |

Opening: unwrap a slot, check `HKDF(CK)` equals `keyCommitment` (this makes
AES-GCM key-committing, so one envelope cannot decrypt to different content
for different keys), decrypt the payload with the content AAD (any change to
the content section fails here), inflate with a hard stop at `byteLength`,
then check `commitment`. Slots bind only to `keyCommitment`, which is why a
slot can be added or removed without touching the payload.

Validation. Every field is checked on parse: exact byte lengths, unknown keys
and kinds rejected, header must be canonical, `payloadBytes` must equal the
bytes present (truncation and trailing bytes fail before any crypto),
`payloadBytes = byteLength + 16` when uncompressed. Limits: 16 MiB plaintext,
64 KiB header, 1–8 slots, PBKDF2 600,000–5,000,000 iterations (the cap bounds
the work a hostile envelope can demand), sealing passphrases of at least 8
characters.

Size. Overhead is fixed: about 570 bytes for one passkey slot, 720 with a
recovery key, 930 with passkey + passphrase + recovery key, plus 16 bytes of
tag. `estimateKeelSealedSize` returns the exact figure for a given shape.

## Threat model

**On-chain, public forever:** the header (media type, exact plaintext size,
compression, number and kinds of slots, PBKDF2 iterations, rpId hints, stored
credential ids) and the ciphertext. **Off-chain, never stored:** the content
key, PRF outputs, passphrases, recovery keys, and the plaintext salt. Passkey
slots store a salted hash of the credential id, so two sealed objects cannot
be linked to the same passkey unless the writer chose to store the raw id
(needed for security keys that are not discoverable).

**Losing a passkey** loses that slot only. Another slot (a second passkey, the
recovery key, a passphrase) still opens the object. With no working slot left
the content cannot be recovered: there is no escrow and no reset.

**Quantum resistance of the content cipher.** The content path and key wrapping
use AES-256-GCM, random 256-bit content keys and symmetric key derivation.
There is no RSA or elliptic-curve key establishment in this envelope. Generic
quantum AES key search has roughly 128-bit query complexity; this is not a
guarantee about future cryptanalysis or every hash property. NIST suggests
AES-256-GCM with random IVs in its [post-quantum guidance](https://csrc.nist.gov/Projects/Post-Quantum-Cryptography/faqs).
Confidentiality is limited by the weakest unlock slot, including password
entropy and authenticator behavior. Two further edges to know:
the passkey's own signature (ECDSA/EdDSA) is never used for sealing, but the
channel that carries a PRF result from a USB/NFC security key or a phone
(CTAP2 PIN/UV protocol, hybrid transport) and passkey sync between devices use
elliptic-curve key agreement today; someone who records that traffic and later
has a quantum computer could recover that one slot's secret. Local platform
passkeys and locally held recovery keys avoid that particular transport exposure;
weak passphrases remain susceptible to guessing.

`describeKeelSealed` now reports native-binary encoding, actual compression,
AES-256-GCM, 256-bit keys, 128-bit authentication tags, symmetric key wrapping
and the key-derivation algorithms. `unlockSecretStrength: "not-attested"` prevents
that metadata from claiming to have measured password or PRF entropy. This
description does not change existing envelope bytes. Ethereum signatures are a
separate security boundary. Future public-key recipient encryption must use a
reviewed post-quantum key-establishment profile; this symmetric layer does not
claim to implement ML-KEM.

**Limits.**

- Size and type are public. Seal as `application/octet-stream` (and pad the
  content yourself) if either is sensitive. Compression also reveals roughly
  how compressible the content is; use `compression: "none"` for content that
  mixes secrets with attacker-chosen text.
- PBKDF2 is not memory-hard, so GPU guessing is cheaper than against argon2id.
  argon2id is the planned upgrade: `kdf.name` is the extension point and
  readers reject it until they ship it.
- No revocation or forward secrecy: removing a slot only changes new bytes.
- JavaScript cannot reliably erase memory; the content key is zeroed after use
  as a best effort.
- A sealer controls every byte they publish. Opening still verifies the key
  commitment, the AES-GCM tag, the declared length (no decompression bombs)
  and the plaintext commitment, so a hostile envelope can only fail to open.

## Extension points

- **Recipient slots.** A `recipient` slot (hybrid ML-KEM-768 + X25519,
  wrapping `CK` under HKDF of both shared secrets) is reserved for
  `keel-sealed@2`; v1 readers reject it by name. The content AAD and slot AAD
  labels do not include the envelope version, so existing v1 content can gain
  recipient slots by re-framing, without re-encrypting.
- **Key derivation.** `kdf.name: "argon2id"` for passphrase slots.
- **Frame version** byte and `protocol` string for anything else.

## Tests

`tests/protocol-sealed.test.mjs` covers round trips for every slot and
compression, wrong secrets, header/IV/ciphertext/slot tampering, truncation,
oversize lengths, unknown fields and versions, slot add/remove, commitments,
Merkle proofs, and an independent writer that follows this document's key
schedule (also used to play a hostile sealer). There is no test-only
iteration bypass: the 600,000 minimum is always enforced and costs about
50 ms per derivation in Node. `tests/sdk-sealed-passkey.test.mjs` drives the
passkey helpers with a fake `navigator.credentials`.
