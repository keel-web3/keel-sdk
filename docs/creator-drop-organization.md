# Creator drop organization integration

Canonical specification: [Creator collections, drops and token identity](../../keel-contracts/docs/CREATOR_DROP_ORGANIZATION.md).
This is planned integration; it does not add a callable directory contract.

Extend `packages/sdk/src/creator-collections.ts` and the existing
`creator-collection-wallet.ts` review/recovery flow with one shared model for:

- Explicit default, new separate, or existing collection destination.
- Selected chain and actual token standard; compatible collection reuse.
- Immutable logical drop identity, creator-scoped drop number and local token id.
- Physical contract/item identity and exact bidirectional directory lookups.
- Exact aliases, distinct from human display titles and fuzzy search.

OneMint campaign ids, factory collection ids and array positions must never be
presented as interchangeable drop numbers. Do not calculate sequential ERC721
ids by a fixed offset when drops can mint concurrently. ERC1155 quantity is not
an individual copy id. Build adapter calls only after the directory ABI exists;
missing readback must not masquerade as an absent default or successful creation.

Keep all existing caller-selected deployment, chain, custom contract and FRAY
choices explicit. Mirror contract bounds and packing exactly, regenerate ABIs,
and add collection/directory/recovery tests alongside the existing creator and
OneMint SDK suites. The site must import this model rather than fork it.

## Supply and capability disclosure

Implement the supply-policy section of the canonical contracts specification
in docs/CREATOR_DROP_ORGANIZATION.md. Distinguish permanent logical-release
ceilings from mutable sale allocations and global collection capacity. Prepare
fixed, adjustable or open issuance explicitly before the first mint; never
infer immutability from a finite number or a failed RPC read.

One shared read model must expose lifetime issuance, outstanding reservations,
current/permanent ceilings, increase authority, lock status, burn/remint policy,
and any implementation-upgrade power that could change those promises. Bind the
read to chain, collection, logical drop and block. The site and verification
shell consume this model; they do not independently guess capability labels.
Metadata, renderer, hook, transfer and staking mutability belong in the same
capability report. These are planned APIs, not existing verified features.
