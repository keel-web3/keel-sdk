# Configurable KEEL seed profiles

No field is mandatory. The default is a full seed word; creators can choose a
compact seed, IDs, trait indices, direct addresses, booleans, or several words.

```ts
import { defineKeelMintSeedProfile, packKeelMintSeedProfileWords } from "@keel/sdk/mint-seeded";

const profile = defineKeelMintSeedProfile({
  fields: [
    { name: "seed", format: "bytes32" },
    { name: "creator", format: "address" },
    { name: "equipment", bits: 64 },
    { name: "edition", bits: 32 },
  ],
  seed: { kind: "field", name: "seed" },
});
const words = packKeelMintSeedProfileWords(profile, {
  seed: fullSeedHex,
  creator: creatorAddress,
  equipment: 7n,
  edition: 2n,
});
// Word 0: seed. Word 1: 160-bit address + 64-bit equipment + 32-bit edition.
```

Remove `creator` when it is not needed. The SDK assigns non-overlapping ranges,
or accept explicit `wordIndex` and `offset` together. Values never silently
truncate. `profile.layout.byName.equipment.index` identifies the right word and
range. `prepareKeelMintSeedUpdates` groups named edits for one storage update per
touched word; `packKeelMintSeedProfileWords` prepares full words for initialization.
Unspecified bits in a full-word initialization are zero, so do not use that path
to update a subset of existing fields.

Seed choices are `{kind:"field",name}`, `{kind:"word",wordIndex}`,
`{kind:"words",start,count}`, or `{kind:"host"}` for custom reveal/VRF logic.
The default uses the entire first word. For the words/host modes the host's seed
getter performs the selected derivation. The profile does not generate randomness.

`profileId` commits to the ordered encoded field names, indices, formats, seed
descriptor and derivation mode/range. Reordering fields changes the profile ID.
Freeze or version profiles before records use them. Permission and lifecycle
decisions remain in the host contract; no field is implicitly public to write.

## Automatic data-module integration

The contract advertises `IKeelMintSeededData` through ERC165. It returns the
profile assigned to the selected record, its words, and optionally a computed
seed. There is no ERC721A dependency. The SDK ABI and interface ID are exported
from `@keel/sdk/mint-seeded-data`.

```ts
const layer = await readOnchainData({
  rpcUrl,
  reads: [],
  record: { address: sourceContract, recordId: "123" },
});
const fragment = buildOnchainDataFragment(layer);
```

The existing data-phase fragment exposes `KEEL.data.token.seed`,
`KEEL.data.token.profileId`, and `KEEL.data.token.fields.<name>` before render
scripts run. Addresses remain addresses. Integers larger than JavaScript's safe
range become exact decimal strings; use `BigInt(value)` for arithmetic. Whole
words are retained as 32-byte hex strings under `KEEL.data.token.words`.
The nested object is frozen against later script edits.

The MCP `keel-onchain-data-prepare` tool accepts the same `record` object with
`reads: []`; no per-field read declarations are needed. `latest` resolves to one
block number used by discovery and all values; an explicit hex block is supported.
The import cannot infer an arbitrary contract or token ID, so the surrounding
record context must supply those. Data is a snapshot prepared for that context,
not a hidden network request inserted into a frozen artwork.

## New profile planning and batched reads

Use `planKeelMintSeedProfile(input)` when creating a new profile. It returns the
selected `profile`, original `sequentialProfile`, and `sequentialWords`,
`packedWords`, `savedWords` counts. Explicit positions stay pinned and field order
is retained. The deterministic best-fit heuristic only selects layouts occupying
fewer words; ties retain the original identity. `defineKeelMintSeedProfile` keeps
its current behavior. Never run a new layout over existing record storage.

For example, two 160-bit address fields followed by two 96-bit values can use two
words rather than three. Use `packKeelMintSeedProfileWords(plan.profile, values)`
to prepare values for the selected layout. Addresses stay full 160-bit values.

`readOnchainData` groups word calls into HTTP batches of 64 by default. Set
`record.batchSize` to 1..256; 1 forces serial reads. MCP's
`keel-onchain-data-prepare` accepts the same record option. Response IDs are checked
and restored to request order, with every call pinned to the same block number.
An explicit unsupported-envelope response falls back to serial operation. Invalid
IDs, missing words, per-call errors and HTTP failures fail preparation.

The direct `readKeelMintSeededData(record, call, callMany?)` helper accepts an
optional ordered batch callback. Without it, direct calls stay serial. Batching
reduces HTTP round trips, not onchain gas: a local 130-word test used 7 HTTP requests
instead of 134 with identical data. Existing contract interfaces stay unchanged.

The contract repository's `docs/EVM_MINT_SEEDED_PASS_3.md` records the measured
packing savings and production KEEL721 mint-to-tokenURI composition tests.
