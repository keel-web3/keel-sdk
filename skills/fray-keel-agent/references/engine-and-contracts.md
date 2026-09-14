# Shared editor, SDK, and MCP decisions

Use `keel-engine-catalog` or `keel://mcp/engine` as the current capability map.
Use `keel-project-decisions` for a partial creator intent. Retain its exact
chosen values between calls and ask only its `nextQuestions`, at most three at
a time. Its schema is distinct from the smaller `keel-studio-project-intake`
schema; never forward a full engine intent into Studio intake.

## Defaults and missing choices

- Local exploration requires no chain, wallet, collection or sale choice.
- Use the registered canonical viewer and automatic compact Inline carriage.
- Discover and lock exact selected-chain modules before planning another upload.
- Suggest a dedicated ERC-721A for unique works and a dedicated ERC-1155 for
  editions; these are suggestions until selected. Existing collection choices
  must never be replaced by a new deployment.
- Do not invent a chain, storage mode, price, payout, royalty, signature policy,
  role grant, or irreversible setting. Show measured tradeoffs when needed.
- Limited editions require an explicit positive `release.supply` in ordinary
  intake. Zero is not a substitute for an unknown limited-edition supply.
- `planned` and `ready` intake results remain review-only. Re-read live
  capabilities, code, authority and recovery state at the execution boundary.

## Assets, presentation and live networks

Import original files regardless of type or size; use streaming local storage
instead of routing binary media through the text editor. The canonical shell
is the default for local previews and published viewers. A creator may explicitly
choose direct display in the desktop Shell area; do not silently change that choice.

For a new asset's automatic presentation, measure deterministic Gzip bytes.
At or below 1,750,000 bytes choose Inline; above that choose HTML with native
onchain resource reconstruction through RPC. Preserve explicit Inline/Hybrid
choices. This threshold does not prove that the completed tokenURI fits public
reader size/gas limits. Show packing, metadata and runtime overhead separately,
and present compatibility warnings without rejecting the original import.

Use `keel-network-inspect` with the creator's exact RPC and family to read current
head, fees, gas limits and KEEL setup gaps. It supports custom EVM networks and
Tezos; do not impose EVM gas-price arithmetic on Tezos. Re-check identity when
refreshing a remembered network. An unknown deployment means setup is needed,
not that the network itself is unsupported. A historical address or observed
bytecode is not verified shell, ABI or authority evidence.

Estimate exact prepared calls against the selected network. Keep publication
transaction cost separate from tokenURI/read execution gas; reads do not charge
the user's wallet. Include all transaction and chain-specific fee components
before giving a total upload cost. A changing gas quote is not a signed fee guarantee.

Keep direct file retrieval visible: `getObject` returns the descriptor;
`haulObject` returns a complete **uncompressed** object within the RPC execution
limit. For compressed objects, `readSlug` returns stored parts in order; join,
decompress the declared codec and verify original length/SHA-256. This path
requires no HTML viewer. A separate uncompressed object enables single-call
retrieval when feasible, with its extra storage/publication cost reviewed.

## Contract and collection workspace

Contract identity is `(chainId, address)`. A creator may have many factories,
collections, proxies, implementations and unrelated custom contracts. Never
collapse these into one account contract. Logical collections also carry their
factory collection ID; multiple shared ERC-1155 collections can use the same
token address and must retain their separate shared collection IDs.

The desktop can track manual contracts, SDK deployment records, imported
`keel.creator-operation@1` read-back records and bounded selected-factory
directory reads. A deployment record is not proof that it belongs to the user.
Imported receipts and remembered wallet addresses do not establish current
ownership, administration, mint rights or approval.

For factory discovery, check the selected RPC chain, pin a read block, read
creator count/IDs/collection records and preserve the related factory and
renderer. Inspect proxy implementation/admin/beacon slots and supported minimal
clone code separately. Custom proxies remain explicit rather than guessed.
Only describe observed facts as verified; imported ABI and live bytecode may
still be unrelated.

For an ABI upload, `keel-contract-controls` accepts bounded `abiJson` containing
an ABI array or compiler artifact. It lists exact overloaded signatures and
typed inputs. The SDK's `prepareContractControl` prepares unsigned calldata;
integer inputs use decimal strings and tuple/array inputs use ordered arrays.
Controls for a proxy use the proxy address as the target. An implementation
change invalidates a remembered ABI binding and requires review. ABI import
does not authorize writes, upgrades, token approvals, transfers or freezes.

## Keep four permission domains separate

1. Collection ownership/admin and proxy upgrade authority.
2. Mint eligibility: public, Merkle, token balance/ownership, custom gates and
   optional creator/platform signatures. Gate `all` and `any` are distinct.
3. Library reuse/license: closed, open, paid, address allowlist, token gate or
   submission-only. Restricting mint access does not hide public onchain bytes.
4. Agent scope: local edits, scoped draft/staging access and separate exact
   wallet authorization. Remembered preferences grant no new authority.

MintGate campaigns have independent allocations. OneMint phases share drop
supply and wallet counters; their supported phases are Allowlist, Public,
TokenPayment, Claim and Premint. Never map narrow campaign-creator rights to
OneMint's full-trust sales delegation. Fray auctions use their own SDK policy
and intake; unsupported historical OneMint enum entries stay unavailable.

## Missing modules

Display ambiguous candidates with identity, version, selected chain, source,
license/access, dependencies and evidence. Let the creator resolve ambiguity.
When no usable same-chain record exists, show the module workflow returned by
the catalog: source/declaration → local build/test → reproducible index →
publication plan → wallet review → receipt and registry/object read-back →
exact lock. Never upload a replacement canonical shell or silently embed a
missing executable library in each artwork.

## Desktop connections and memory

The local editor shares React, Tailwind, tRPC, Zod, TanStack Query, fonts and
design tokens with Studio. Its renderer has no Node or signing access. Project
previews have no desktop bridge. Public wallet records, creator memory and
OS-encrypted provider keys have separate storage paths and purposes.

Local Codex and Claude processes are adapters to their installed clients;
their model service may still be remote. Direct API connections use explicitly
selected provider/model credentials. Describe transport tests separately from
a live authenticated request. Never report an untested connection as working.
