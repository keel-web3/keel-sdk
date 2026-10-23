# Shared build defaults

Studio, the SDK agent client, and hosted MCP use the existing private creator
project-defaults record. Edits keep expectedRevision and stable commandId CAS
semantics. No additional preference store or database migration is introduced.

Use `client.effectiveBuildDefaults()` to make a fresh authenticated request.
`keel_project_defaults_read` exposes the same authoritative profile; `keel_whoami`
includes effective build values only with preferences:read. Never put these
records into public artwork metadata or discovery documents.

Effective order: system, account, exact media type, explicit project, explicit
build. Raw forces compression none. Supported preferences include lossless
compression mode, Brotli quality 0–11, prepared transport profile, complete read
gas/output ceilings, and willingness to review Hybrid. Registered reader limits
are hard ceilings; unsupported encodings fail. Full-read integrity/gas checks
cannot be disabled. Generic multistage compression is not offered because this
builder does not support it. Hybrid willingness is not authorization for external
uploads, a delivery change, or spending. No billing prices are inferred.

Consumers must pass verified actor identity to readEffectiveStudioBuildDefaults,
apply the returned policy to preparation, retain its revision privately, and call
assertKeelBuildDefaultsCurrent against a fresh resolution before funding. Changed
inherited values require rebuilding and review. Existing explicit choices remain
overrides; existing funded jobs retain their receipt-based resume path.

Integration: browser preparation/import and estimate routes pass a verified session
actor separately from artifact input. Anonymous estimates never read private
preferences. Preparation checks actor ownership, uses compression/quality and
storage choices, and saves the policy and explicit layers in private upload-job
options. Funding re-reads the owner policy before and after simulation, binds the
revision into its fingerprint, and enforces lower complete-read ceilings. Older
builds without snapshots require rebuilding if build defaults have been saved.
Existing funded jobs retain their unchanged receipt-based resume path. Unsupported
Studio transport selections fail before build; the prepared renderer still needs
its independently verified registered contract route. This change deploys nothing.

Monetary spending budgets and multistage codecs are not inferred or implemented by
this preference surface; gas/output ceilings do not represent a price quote or
permission to fund. Existing publication quotes and owner wallet review still apply.


## Collection-type filters

The optional `collectionFilters` array in `keel-studio-default-profile@1` stores
up to 32 `{ filter, values }` records in the same account preference JSON row.
Old profiles without the array remain valid; no database migration is needed.
A filter requires at least one existing configuration axis:

- `tokenStandard`: `none`, `erc721`, `erc1155`
- `tokenStructure`: `none`, `one-of-one`, `edition`, `collection`
- `saleMethod`: `none`, `fixed-price`, `auction`, `sealed-bid`
- Optional `mediaType`: one exact MIME type, never a wildcard

Use scope `{ kind: "collection", filter: { tokenStructure: "edition", mediaType: "image/png" } }`
with the usual stable command UUID and expected account revision. The hosted
MCP defaults tools and portable `defaults-edit` operation use this same scope.
Preferences grants remain separate from draft grants. Filters cannot carry an
address, lifecycle, signer, or authority, and cannot change the release/token/sale
type being matched. An unsupported token or sale route remains unsupported.

Build inheritance is system → account → exact media → matching collection
filters → explicit project → explicit build. More populated filters are more
specific; equally specific overlapping filters must agree on shared values.
Conflicting overlaps are rejected. Registered reader limits remain hard ceilings.
Missing context does not match a filter. Context comes from a selected profile
or explicit release intent; custom content alone does not imply a collection type.

`resolveKeelBuildDefaults(profile, { mediaType, collection, project, build })`
returns effective values and source provenance. `collection` contains known
`tokenStandard`, `tokenStructure`, and/or `saleMethod` axes. Only build fields
consumed by the current compiler are editable. Image/animation slot-delivery
defaults are deferred until their actual compiler consumer is available.
Existing private unknown fields survive parsing and unrelated edits. If a saved
non-onchain slot-delivery intent remains effective after explicit overrides,
preparation stops with an unsupported-consumer error; it never silently selects
another carrier or duplicates artwork. Profiles are not migrated or rewritten.

New guided plans copy matching values once. Named profile selections retain a
private copy of collection filters so later account edits cannot rewrite them.
Before new funding, the stored build snapshot is compared with a fresh effective
policy. Changes require preparation and review, without replaying paid storage.
The collection-filter extension adds no new implicit delivery fields to legacy
build snapshots.
