# Optional commitments and prereveal

`@keel/sdk/pre-reveal` is an optional authoring/verification module. It does not
change Inline delivery, the selected shell or the protected file-proof result.
Its checks are separate information in the Token tab. A commitment establishes
which plan was published; it does not promise that a creator will deliver it.

Choose what to commit:

| Mode | Committed content | Reveal check |
| --- | --- | --- |
| `assets` | Exact art SHA-256, token ID, optional traits | Supplied art bytes and assignment |
| `attributes` | Actual token-to-trait assignments | The assigned values, independent of storage layout |
| `seeded` | Generator, parameters, randomness-rule hashes; known seed only if already assigned | Recipe match; actual mint seed and generator replay are separate checks |
| `encrypted` | Final art hash and optional traits | Published ciphertext/key hashes, authenticated decryption, then final art/assignment match |

Raster/baked output uses `assets` or `encrypted`. A seeded raster recipe can also
bind a raster profile hash. A burn-rule hash binds the intended rule only: it
does **not** prove a burn transaction. A burn-event verifier must supply that
additional evidence; the panel says when it has not been checked.

## Prepare a hidden allocation

```ts
import { prepareKeelPreReveal, buildKeelPreRevealCommitCall }
  from '@keel/sdk/pre-reveal';

const prepared = await prepareKeelPreReveal({
  chainId, collection, mode: 'attributes',
  tokens: [{ tokenId: '1', attributes: generatedToken.metadata.attributes }]
});
// Public: only protocol, chain, collection, mode, count and one root.
const publicManifest = prepared.manifest;
// Private until reveal: salts and membership proofs. Preserve these exactly.
savePrivately(prepared.privateProofs);
const call = buildKeelPreRevealCommitCall(publicManifest, registeredRegistry);
// call is unsigned. Publish through the existing reviewed KEEL wallet route.
```

Each leaf is salted, domain-separated and bound to chain, collection, token ID
and mode. A short trait list cannot be guessed from a publicly exposed unsalted
hash. IDs are sorted numerically, duplicate assignments are rejected and trait
order is canonical. Do not regenerate a commitment to replace a lost salt.

The MCP tool `keel-prereveal-prepare` accepts a local allocation JSON file and
**separate** public/private output directories. It returns paths and the root,
never salts, hidden trait values or encryption keys. Private proof files use
owner-only permissions. Output names include the root so another preparation
cannot silently overwrite the original proof file. Exclude the private
directory and source allocation from publication; permissions do not make a
file safe to publish.

The allocation JSON is an authoring input, not an onchain JSON requirement.
Use `compileKeelCollectorMetadata` for compact dictionary/assignment pages
after reveal. The commitment is over decoded trait values, so using the compact
matrix does not require storing another full JSON copy. The root itself is one
bytes32 publication for the allocation.

## Pin the original publication

Use the registered selected-chain `KeelCreatorCommitmentRegistry`, authenticate
its immutable runtime hash and record the returned revision. Its append-only
`publish`/`commitmentAt` interfaces can anchor this root. The registry's
**built-in `verify` uses the different OZ metadata/asset-digest leaf scheme**;
do not call it with this protocol's salted SHA-256 proofs or mistake this root
for a Studio metadata root. Pin protocol, root and publication revision.

`readKeelPreRevealAnchor` uses KEEL's governed RPC transport, verifies the
selected chain and runtime code, and pins code and root reads to one block hash.
Serialized/application-supplied anchor objects cannot upgrade the check to a
publication claim. The block is displayed as RPC-read evidence. The original
revision remains the reference even when a creator publishes a later root.
Compare publication chronology with mint/reveal chronology when claiming a
commitment predates those events; a matching root alone does not establish it.

`verifyKeelPreReveal` works offline for membership and byte/trait checks.
`refreshKeelShellPreRevealInfo` adds an inert Token-tab panel. A denied optional
RPC read leaves local checks available and publication explicitly unchecked.
Neither helper can rewrite the shell's protected verification result.

## Random-on-mint collections

Commit actual generator code, parameters and the frozen randomness profile.
Do not precommit an invented future mint seed. Use the existing
`readKeelSeedStatus` or code-pinned `readLayeredTokenContext` adapter for the
actual mint state, then replay the committed generator with that seed. The
prereveal panel distinguishes recipe checks, known-seed comparisons and checks
still requiring seed evidence/replay. A recipe match is not an image match.

## Native encrypted assets and creator placeholders

`sealKeelPreRevealArtifact` reuses the existing KEEL sealed envelope: compress
the plaintext once, then AES-GCM encrypt it. Store its native ciphertext through
the usual Compact/Raw pipeline; do not publish a second bulk Base64 or hex copy.
Small envelope fields, hashes and wallet calldata retain their required formats.
The secret key stays local until intentional key publication. The SDK returns
the private key directly to the creator; MCP arguments/results never carry it.
Layered projects can use `sealLayeredBundle` and the existing reviewed
`prepareLayeredKeyRelease`/`readLayeredTokenContext` path instead.

`createKeelPreRevealArtifactController` leaves the creator's own prereveal
placeholder mounted. `refresh()` obtains a public key via the supplied reader,
checks committed ciphertext and key hashes, authenticates decryption, verifies
opened bytes against the original token commitment and only then calls `mount`.
An absent key reports `waiting`; denied reads or wrong data report `unavailable`.
Retries share one in-flight operation and a successful reveal mounts once.
No key means no plaintext execution. Applications may supply their own art,
loader or reveal animation without replacing the canonical verification shell.

These are SDK/MCP source capabilities. A collection, runtime module and shell
revision are not live until selected-chain publication and read-back complete.
