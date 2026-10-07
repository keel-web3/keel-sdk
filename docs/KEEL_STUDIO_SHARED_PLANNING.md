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
Reusable account-default persistence and optional save-default prompts are not yet
connected in the current release adapter. Inferred style is a suggestion, not an
explicit preference, authority grant, or reason to skip consent.

Planning can begin before storage publication. The existing release publisher
still checks actual storage evidence and complete metadata before its wallet
review. The complete initial-storage simulation gate is separate unfinished work:
do not call a planning confirmation, size estimate, browser sandbox or compressed
graph length a verified reader preflight. No first-storage safety claim follows
from this planning API alone.

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
chain simulation remain required before release. The current agent panel exposes
the shared-plan workflow; provider setup and persistent chat are not active yet.
