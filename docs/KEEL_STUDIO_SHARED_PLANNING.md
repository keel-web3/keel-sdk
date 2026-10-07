# Shared Studio planning

The shared resolver in `@keel/sdk/studio-project-planner` describes questions and
dependencies as data. Browser and agent render the same resolution. A plan is
preparation data, never permission to sign, fund, publish, deploy, or expand a grant.

## Current release slice

Create or reuse an ordinary private release draft. `keel-studio-draft` with
`operation: plan` reads its matrix, current revision, answers and one next question.
Use `plan-edit` with `planningCommand` to answer, navigate Back, select guided/direct
mode, or confirm the exact configuration. The hosted tools are
`keel_release_plan_read` and `keel_release_plan_edit`. Existing `drafts:read` and
`drafts:write` grants apply. An agent cannot acquire wallet authority from this API.

Every edit includes a stable command UUID and the expected release revision.
Retry an uncertain request with the identical command. Never reuse its UUID for a
different edit. On conflict, read again and reconcile with the creator rather than
overwriting their values. Use the server-issued planning URL to let the creator
edit one focused step. Autosave and direct Studio edits use the same stored draft;
there is no separate agent copy. Changing metadata, resources, network capability
identity or relevant prior answers invalidates review. Back retains branch answers
but inactive values are excluded from the resolved configuration.

Default precedence is explicit project answers, project defaults, media defaults,
then global defaults. Each draft pins its preference snapshot. Invalid defaults
reopen the question; recommendations alone never answer a required question.
Explicit account-default persistence and optional save-default prompts use
`@keel/sdk/studio-project-defaults`. Studio's Saved defaults fold can save the current
answer globally or for its original media type, remove a default, and opt into
asking to save future answers. Only defaultable fields and available choices are
accepted. The preference profile has its own revision and stable command ID;
conflicts require a fresh explicit choice, and uncertain saves retry the same command.
New guided drafts copy the profile once. Existing drafts keep their original
answers and pinned snapshot. Changing media or available capabilities revalidates
those defaults; invalid combinations reopen their question. Inferred style remains
a suggestion, never an explicit preference, authority grant or reason to skip consent.

The hosted tools are `keel_project_defaults_read` and `keel_project_defaults_edit`;
portable `keel-studio-draft` uses `defaults` / `defaults-edit` with `defaultsCommand`.
These require separate `preferences:read` / `preferences:write` permissions selected
by the creator in Agent setup. Existing draft grants are not broadened. The browser
uses `/api/account/project-defaults`, agents `/api/agent/project-defaults`; both
resolve ownership from their existing authentication and call one service. Schema
migration `0047_creator_project_defaults` must be applied with the site rollout.
No migration or new grant is created by source tests.

Planning can begin before storage publication. The existing release publisher
still checks actual storage evidence and complete metadata before its wallet
review. The initial-storage gate is implemented separately in the
[initial-storage preflight](KEEL_STUDIO_INITIAL_STORAGE_PREFLIGHT.md) adapter and
must pass at the real funding boundary. It requires a compatible simulation provider
including pre-refund gas evidence; unsupported providers fail before new funding.
A planning confirmation, size estimate, sandbox or compressed graph length is not
reader proof. Source implementation and local tests are not a live rollout claim.

The current release adapter supports the publisher's fixed-price route, including
zero price, and its public/invite access entry points. An auction is not substituted
for a fixed-price transaction. IPFS requires supported verified pin/CID evidence.
Access providers, audience groups, raffles and benefit activation retain their
existing dedicated APIs. A draft benefit is not a live discount: legacy controllers
may lack coupon support, actual provider credentials and collector consent are
required, and an anchored raffle cannot be rerolled or silently cancelled.

## Intent-to-build composition

The generic decision matrix accepts registered routes and each route's own typed
parameters. It is an extensible contract, not an exhaustive list of creative
intentions. Organize decisions as storage, presentation, and token/collection
behavior. Reuse supported primitives and immutable onchain objects before proposing
new code or new storage. Shell choice is independent of compression. Never replace
an existing KEEL verification shell just because a metadata read failed.

Example: “Make the background update from a contract.” A future capability adapter
must first resolve the chain, contract address, read function and arguments, output
schema, mapping to a safe display value, updater authority, and refresh semantics.
Ask whether an event, bounded polling or explicit refresh should update the preview;
specify timeout/offline/stale-value display and a fallback color. An available
registry binding can provide those questions. An unknown interface becomes a
custom-build work item with proposed requirements and validation tasks, not an
invented working capability. Preview untrusted generated code in the existing
isolated sandbox. Show exact source changes and unsigned transaction parameters
for owner review; never claim that a code preview proves deployed authority.

Acceptance: the same request yields identical missing questions in UI and MCP;
answering chain/address invalidates dependent ABI bindings and preflight; changing
read cadence preserves storage object IDs; invalid CSS/color output cannot inject
HTML or scripts; denied RPC leaves the documented fallback; a newer agent edit
cannot overwrite an unsaved creator edit; refresh resumes the same revision; any
actual updater or deployment transaction has a separate exact owner-signable
review. This custom binding adapter is planned, not implemented by the release
adapter in this slice.

## Verification boundary

Focused tests cover resolver branching/defaults, persistence, optimistic conflicts,
same-command retry, auth scopes, direct-mode parity, review invalidation and safe
handler errors. The editor bundles with repository CSS. Browser interaction and
accessibility execution, full repository checks, real PostgreSQL behavior and live
chain simulation remain required before release. The in-editor Agent panel now reuses the existing connection setup and creator
bridge queue. Conversations persist by release, with the latest twenty requests
shown and the latest six included as bounded context. Only a strict reply schema
can create proposed form values. Plain replies render as text; executable code and
wallet instructions are never injected. The creator can edit those inputs and apply
them through the same revision-checked draft writer. Older or conflicting proposals
must be updated before application. Migration 0048 adds queue context and retry
identity; the Rust bridge wire format and credentials are unchanged.

Connected MCP agents use hosted `keel_release_conversation_read/suggest`, or portable
`keel-studio-draft` operations `conversation` / `conversation-suggest` with a
`conversationCommand` containing commandId, expectedRevision, message and optional
answers. These operations require separate opt-in conversations:read/write scopes;
existing project grants do not acquire access to private conversation history.
Suggestions are saved as completed messages without invoking another model and
without changing the plan. Applying the form remains an explicit owner action;
ordinary scoped plan-edit remains available for creator-authorized direct edits.

The current chat provider is the creator's existing bridge. Direct API-provider
configuration, hosted paid assistance, vector memory, agent wallets and code-preview
composition are not activated by this slice. No new credential, grant, subscription
or wallet transaction is created by these source tests.

## From plan to owner review

The shared plan returns focused section links carrying the release, field and saved revision. A link shows the latest canonical values; it never restores values from its URL. Explicit edits use the same revision-checked writer in guided, direct and agent workflows.

After the plan is complete and confirmed, hosted `keel_release_review_prepare` or portable `keel-studio-draft` with `operation: prepare-review`, `releaseId` and `expectedRevision` saves the exact unsigned owner-review operation. It requires `drafts:write`. The SDK exposes `prepareReview(releaseId, expectedRevision)`. The server selects the creator account wallet; callers cannot supply another wallet or arbitrary calldata. The returned review URL pins the operation and revision.

The private review page explains each supported call, network, signing wallet, creator payment, separate collector prices, and exact calldata in an advanced fold. Opening it does not request a wallet approval. The owner explicitly continues through the existing Studio wallet flow. Changed plans and stale operations invalidate the handoff; submitted operations resume their saved receipt instead of repeating storage or release calls.

This release publisher currently compiles its existing fixed-price controller routes and strict presentation repairs. An auction, advanced overlapping lane, unsupported reader or unverified IPFS route remains blocked. A profile or agent suggestion is not evidence that a contract capability is implemented.
