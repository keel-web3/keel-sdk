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
