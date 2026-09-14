# Mint release integration

The router records logical releases independently of physical token IDs. See
[the contract specification](../../keel-contracts/docs/MINT_RELEASES.md) for the
storage bounds, lifetime supply policy and supported engines.

```ts
import {
  prepareKeelRelease,
  prepareOneMintReleaseCampaign,
  readKeelReleaseSnapshot,
  keelReleaseName,
  keelMintReleaseAbi,
} from "@keel/sdk";

const preparation = prepareKeelRelease({
  chainId: 31337n,
  router,
  factory,
  routeId,
  name: "Reactor Studies",
  limit: 100n, // Fixed is the default.
});
```

These are review-only calls. Confirm the creation receipt and read the actual
release ID before binding campaigns. `prepareOneMintReleaseCampaign` returns
`bindReleaseAllocation` followed by OneMint creation. Supply the selected chain,
controller, creator, current creator nonce, route/release IDs and normalized drop.
Recheck nonce and authority before signing; an interrupted batch does not prove
a drop exists. No builder signs, publishes or silently chooses another chain.

`keelMintReleaseAbi` exposes direct forward/reverse and exact-name resolution.
Use `releaseByNumber(creator, number)` to obtain the router-wide ID; never confuse
that ID with the creator-scoped number. Then resolve `(releaseId, localId)` to the
physical address/ID. `keelReleaseName` hashes exact UTF-8 case and whitespace.
ERC1155 edition copies share local ID 1 and one physical item ID.

`readKeelReleaseSnapshot(client, {router, releaseId, expectedChainId,
expectedRouterCodeHash})` pins reads to one block, validates the target mint
manager, checks for changed block/chain, and returns JSON-safe policy/disclosure
rows. Unknown authority stays unknown. This read is not a code-audit attestation.

A committed `keel.runtime` extension enables the shared shell disclosure with:

```ts
{
  mintRouter: router,
  injection: { protocol: "keel-injection@1", fields: ["collection.release"] },
}
```

The adapter uses the verified token anchor (or collection manifest's effective
drive token), requires a pinned block number/hash/timestamp, and reads
`releaseSnapshot` for that exact physical token. Preserve any other required
injection fields when adding this one. The canonical shell renders shared
protocol rows; Studio uses the same ABI and registered-contract read allowlist.
Arbitrary RPC endpoints do not gain access through this option.

Automatic default collection selection and the full creator form still need
wiring. This change supports preparation and read/display paths; it does not
publish updated shell bytes or imply that existing live contracts implement it.


## Fixed supply and indexing

Fixed supply remains the creation default. The router pre-sizes a frozen
ERC721 release's active range so consecutive mint transactions skip index
writes. Adjustable/open releases must be explicitly locked to use that path.
The router handles the optimization automatically; clients need no new flag.

Physical IDs still follow the token engine's global mint order. Interleaving
releases clips the prior unused tail and costs additional writes. Do not display
an entire range as already minted or derive token IDs from a guessed permanent
offset. Resolve actual issued identities through the shared contract APIs;
unminted forward/reverse lookups and snapshots revert. ERC1155 editions still
share one artwork/item ID. These changes do not implement the remaining default
collection picker or deploy anything live.

The test-only range-count diagnostic was removed from the generated
router ABI; no application flow used it. Directory and policy getters remain.
See the [gas tradeoffs and verification](../../keel-contracts/benchmarks/evm-mint-review/frozen-ranges/README.md).
