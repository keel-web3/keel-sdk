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
2. The user connects their wallet and signs in on the website, then approves an
   agent connection at `/studio#agents`. Store the scoped key in
   `KEEL_STUDIO_AGENT_TOKEN` for local MCP/SDK use, or the remote MCP's bearer
   header. Never put it in tool arguments, prompts, or review URLs.
3. Remote MCP is Streamable HTTP at `/api/mcp`. Initialize, list tools, then
   call `keel_whoami`. This is independent of Desktop and local stdio MCP.
   The connection's current schemas and granted scopes are authoritative.

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
import { createKeelStudioAgentDraftClient } from "@keel/sdk/studio-agent-drafts";

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
