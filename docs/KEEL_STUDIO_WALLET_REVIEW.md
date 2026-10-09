# Use the Studio website for wallet review

**The default is https://studio.onkeel.io. KEEL Desktop is entirely optional.**
The website already handles project intake, previews, preparation, release
drafts, contract controls, wallet review and publication. An agent helping a
creator does not need to install or build Desktop, configure another wallet,
or build a separate mint/signing page for these workflows.

A "signing route" is a real Studio project/release/contract review page backed
by the creator's workspace. The agent prepares a draft and returns its link;
the user opens the website, reviews the network, operation and cost, and
approves with their existing connected wallet. EVM requests use the selected
wagmi connector. Studio sign-in is a separate gas-free authentication message,
not transaction approval. An agent key does not grant wallet-signing authority.

## Connect to the user's account

1. Discover `/.well-known/keel.json` and `/llms.txt` on the Studio origin.
2. Use local MCP `keel-studio-connect` with `operation: "start"`. Open the returned
   `approveUrl` for the user and show its code. The user signs in using their
   existing wallet and approves the requested permissions in Studio.
3. Call `keel-studio-connect` with `operation: "complete"` after approval. The
   SDK privately saves the scoped key outside the project, bound to this
   workspace and Studio origin. Draft and staging tools use it automatically.
   Neither MCP results nor approval links contain the key. Status is available
   with `operation: "status"`. Existing environment overrides remain compatible.

From an SDK checkout, the equivalent one-command connection is:

```sh
pnpm studio:connect --window --workspace /path/to/your/project
```

The Node CLI opens a small browser helper on macOS, Windows or Linux. It shows
only the code and approval status; the approved key travels directly from Studio
into the SDK's private user-profile file. `--no-open` prints the links for an
agent or headless terminal to open. `--reconnect --scopes drafts:read,drafts:create,drafts:write,contracts:read`
requests editing permission as well. The creator can narrow permissions before
approving and revoke access at `/studio#agents`.

For an existing manual key, use `keel-mcp --import-key --workspace <project>`
in an interactive terminal. Paste into the hidden prompt, never command-line
arguments, chat, shell profiles or a project `.env`. `--connection-status`
prints metadata only. Credentials are owner-only (0700/0600 on POSIX; restricted
user ACL on Windows), scoped to the real workspace path and Studio HTTPS origin.
They expire with the grant; deleting local credentials does not revoke the
server grant. Revoke it in Studio. A changed workspace path needs its own pairing.

Configure local MCP with that same workspace. It can run without a Desktop app:

```sh
codex mcp add keel -- node /path/to/keel-sdk/packages/mcp/dist/cli.js --workspace /path/to/your/project
# or
claude mcp add keel -- node /path/to/keel-sdk/packages/mcp/dist/cli.js --workspace /path/to/your/project
```

Remote MCP remains Streamable HTTP at `/api/mcp` with a scoped bearer grant.
An app implementing its own connection can POST `/api/agent/pair` with
`client`, `label`, `scopes`, keep `pollToken` secret, open `approveUrl`, then POST
`{pollToken}` to `/api/agent/pair/poll` every 2 seconds. Approval delivers the key
once. Do not approve on the user's behalf. Initialized remote MCP tools and
granted scopes remain authoritative. The SDK wrapper is the preferred local
agent route because it manages credentials without pasted secrets.

## Create the website review route

| Work | Local SDK/MCP | Hosted Studio MCP | User opens |
| --- | --- | --- | --- |
| Files/new project | `stageKeelStudioProject` / `keel-studio-stage-project` | Use the documented staging API with the approved key | The returned `handoffUrl` |
| Release or mint draft | `createKeelStudioAgentDraftClient` / `keel-studio-draft` | `keel_workspace`, then `keel_create_draft` | The returned `reviewUrl`, `/release/{persisted-slug}` |
| Existing contract controls | Discover the selected-chain contract and control surface | `keel_contracts`, `keel_inspect_contract`, `keel_trading_rules` | The returned contract `reviewUrl` |
| Artwork function mappings | Prepare `keel-collector-actions@1` | `keel_artwork_controls_read`, `keel_artwork_controls_prepare` | The returned controls review page; attach the mapping to the project in Studio |

Stage only creator resources and return the exact server-issued `handoffUrl`.
Preparation in Studio attaches the project to the signed-in creator. For an
existing project, list the workspace and use its actual `artifactId`. Create
a release draft through the creator's `drafts:create` grant. SDK draft
create/read/update/list results include `reviewUrl`, using the configured
Studio origin and the server's persisted release slug. Reopen/edit a saved
draft using its ID and current revision instead of creating a replacement
just to obtain another link.

```ts
import { createConnectedStudioDraftClient } from "@keel/sdk/studio-connection-node";

const client = createKeelStudioAgentDraftClient({
  grantToken: process.env.KEEL_STUDIO_AGENT_TOKEN!,
  // studioUrl defaults to https://studio.onkeel.io; explicit origins still work.
});
const release = await client.create(reviewedReleaseDraft);
console.log(release.reviewUrl); // Give this website link to the creator.
```

`reviewedReleaseDraft` uses the exact `KeelStudioAgentReleaseDraft` schema,
project ID, selected network and creator intent. Creating it saves a private
draft; it does not sign, prepare a chain job, mint or broadcast. Studio performs
its normal verification/preparation before showing the actual wallet operation.
A route is not proof of selected-chain readiness or successful publication;
check its receipts and public read-back before reporting success.

## What an unsigned envelope means

`wallet-request-prepare`, `wallet-link` and `ethereum-encode` are low-level
unsigned envelope/typed-data/calldata tools. Their output is not a hosted
Studio job or approval, and their QR scheme does not require Desktop. Prefer
the supported account-scoped Studio workflow above. No generic URL importer
for arbitrary transaction JSON is advertised: do not invent a
`?transaction=...` signing URL or promise an unsupported operation. Inspect
Studio's actual contract controls and current capabilities first. Explain a
specific unsupported operation only after that inspection, rather than
assuming a new browser application is required.

Desktop remains an optional local authoring client. Its build status, wallet
setup or availability must not be used to describe the website as unavailable.

## Recover an already-stored project

Start with the existing project and release IDs. Run local `keel-studio-draft`
with `operation: "diagnose"`, or hosted `keel_release_diagnose`. These use the
creator's `drafts:read` scope, rerun Studio's actual release checks, and return
structured recovery actions. They never upload, prepare a durable chain operation,
sign, or submit. Inspect the granted scope/tool list before claiming an action is
unavailable. A missing scope is different from an RPC outage or an implementation
limitation; neither implies that a KEEL administrator must control the owner's work.

- `retry-read`: rerun the same diagnostic after a transient RPC problem.
- `resume-saved-receipts`: reopen the same release to reconcile its saved operation.
  Do not create a replacement release, reupload files, or resubmit confirmed calls.
- `review-hybrid`: an established Inline capability boundary can be reviewed using
  the already-stored artwork. Hybrid has a network/gateway dependency. An IPFS
  option requires an actual configured pinning route, verified CID, and durable pin
  receipt; do not claim that changing a label creates one.
- Integrity errors and contract reverts are not permission to claim verified
  Inline or switch delivery to conceal the failure.

Read `completeTokenUriBytes` separately from `graphByteLength` or stored resource
bytes. A failed read does not prove the artwork is oversized. Successful diagnostics
include the exact read boundary/block and configuration fingerprint; edits require a
fresh check and the wallet path revalidates again. The project-specific recovery
page is `/studio/projects/{projectId}/recovery`; it uses the same typed operations
and saved identities as the agent API, with no injected wallet code.

For a genuinely new compatible shell/reader binding, discover and reuse supported
registered shells first. `keel-shell-search` and `keel-shell-prepare` remain distinct
from payload compression. A creator-selected custom shell must satisfy its actual
capabilities and must not claim canonical verification protection. Use supported
Studio transaction review primitives to show exact network, destination, calldata,
value, and costs for the owner's approval. A low-level unsigned envelope is not a
hosted signing job. If the necessary handoff is unavailable, identify that precise
boundary instead of inventing a transaction URL or demanding centralized control.

## Recover a failed paid release

Keep the existing release, artifact, storage objects, metadata, owner and supply.
Do not reupload, create a replacement release, switch delivery or retry unchanged calldata.
A successful standalone tokenURI read is not proof that the complete wallet transaction fits.
`InvalidPresentation()` can hide an envelope validator exhausting execution gas;
removing a duplicate preview URI alone does not repair an over-budget reader.

Run `keel-studio-draft` with `operation: "diagnose"` first (`drafts:read`).
For one fully reverted atomic receipt, use `operation: "recover"`, the saved
`releaseId`, `operationId` and `transactionHashes: [failedHash]` (`drafts:write`).
The SDK client method is `client.recover(releaseId, operationId, [failedHash])`;
the hosted MCP equivalent is `keel_release_recover`. Studio verifies the exact
creator, selected chain, ordered calls and canonical receipt, retains the old
operation, and unlocks another review without uploading, signing or submitting.
Pending, unknown, mismatched or partially successful batches stay preserved.
Then diagnose that same release. Prepare a new Studio website review only when
the actual complete atomic wallet program passes selected-fork transaction
validation and the final tokenURI matches the expected bytes. Keep regular
execution gas, state gas and public read budgets separate. A platform reader
deployment needs its own approval and deployed runtime proof; an agent cannot
fix missing infrastructure by requesting another creator signature.

Hosted Studio handles the entire workflow. Desktop is optional. Return the
server-issued website review link for the existing connected wallet; do not
build a new signing page or ask for keys in chat. Receipts and public read-back,
not a prepared link, establish publication success.

Sepolia simulation must use a consistent compatible provider. The public HTTP pool can return contradictory results for the same pinned request. Hosted Studio uses a persistent connection qualified by public API and fork/envelope behavior, before any project calldata is sent, and never retries a reverted program to obtain success. SDK integrations can use `createKeelSepoliaSimulationTransport()` and close it when finished. The full atomic transaction is validated against the selected fork; collector metadata has its separate public-read budget.

An exact recovered full-revert receipt preserves the previous plan confirmation at the same draft revision when only platform infrastructure changed. Hosted Studio compares all terms, access phases and committed resources. Do not edit or restart an unchanged plan because a reader was updated; prepare a fresh exact wallet review, which still requires full-batch gas and collector metadata validation. Changed creator terms or resources require plan confirmation again.

Sepolia publication preflight qualifies the simulator with bounded public empty calls, observed public account state and strict nonce controls on the exact retained socket before sending project calldata. For a known program, the public empty-call probe requests its required envelope within the observed selected-chain limit; ordinary reads use a modest control. Its actual execution is small, and small plans do not require full block capacity. The exact project simulation must still separately pass its requested gas and selected-fork limits. It checks the actual gas envelope on every simulation response. Silent RPC gas clamping is a provider limit, not a contract compatibility failure. A confirmed gas-envelope clamp permits at most three connection selections at the same approved endpoint. Each replacement must pass public qualification. An exact numbered project snapshot must match before repeating the unchanged, read-only ephemeral program. No gas reduction, state override, transaction write or new provider is permitted. Missing or enlarged envelopes, wrong-chain/fork/snapshot evidence, and genuine execution failures do not trigger this recovery. Exhaustion stays blocked; the next saved-plan read can try again. Never retry a genuine EVM revert to manufacture success. Use receipt recovery and a fresh complete Studio wallet review; Desktop is optional.
