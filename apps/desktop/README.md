# KEEL Editor

A local Electron creator workspace using React 19, Tailwind 4, TanStack Query,
Zod 4 and a typed tRPC service over a restricted preload bridge. It reuses the
Studio's Stratus fonts and dark palette. This is a working desktop preview,
ready for local hands-on testing; it is not a signed installer or a production wallet client.

## Try the prepared test

Open **Open KEEL Test.command**, or run `pnpm desktop:test-drive` from the
repository root. It opens a separate persistent practice workspace with an
interactive sample, a local module catalog and simulated contract controls.
The practice service cannot submit transactions. Follow [TESTING.md](TESTING.md).

## Run

From the repository root, with Node 22 and pnpm 10:

```sh
pnpm install
pnpm desktop:build
pnpm desktop
```

If dependency installation intentionally skipped lifecycle scripts, install the
Electron binary explicitly with `node apps/desktop/node_modules/electron/install.js`.
After SDK dependencies have been built, `pnpm --filter @keel/desktop dev` rebuilds
the desktop and opens it. It does not run a development web server.

```sh
pnpm desktop:test
pnpm desktop:test:electron
```

The second command launches four hidden native Electron checks with local Studio/RPC fixtures. It creates a temporary
workspace and a keyless fixture extension, verifies the editor and restart,
and writes screenshots plus `artifacts/smoke-report.json`. It never connects a
real wallet, sends a model request, or contacts a chain.

## Available workflows

- **My work:** start from Image/GIF, Edition, Collection or Interactive Art.
  The three-screen guide keeps Artwork, Collection and Review in a horizontal
  navigation bar, with an adjacent preview and a visible Continue button.
  Templates include the canonical shell, automatic viewer delivery, public
  collecting without extra signatures, and an editable collection type. Networks
  remain an explicit choice. Existing projects keep their choices.
  Image imports provide a cover and initial title; collection imports accept
  several files and retain their individual byte identities. Editions offer
  quantity presets, a slider and exact entry. The Three.js starter references
  the installed shared library instead of bundling it into the artwork.
  Saved collections are matched to the exact network, including distinct shared
  collection identities. Wallet discovery reads recorded factories using the saved
  network connection. Existing ABI controls and authority evidence are preserved.
  Advanced preservation, contract, eligibility and ordered phase controls remain
  under More options. Each step saves; template drafts reopen at their saved step.
  Review checks original files and can open an assistant chat with a prepared
  prompt and this project attached; it does not send a model request automatically.
  This is local release preparation, not collection deployment or batch minting.
  Per-artwork publication metadata, permissions, prices and wallet review still
  belong to release preparation. Tezos collection deployment needs its supported
  adapter; choosing Tezos never switches the project to an EVM network.
  Code editing remains optional, with Fit, Desktop, Phone and Focus previews.
  Closing with unsaved changes defaults to keeping the editor open.
- **Files:** preserve imported original bytes in a content-addressed local
  store with streaming imports and measured Gzip size. Preserve and export any
  original file; unsupported media remains available for a custom renderer.
- **Viewing:** canonical verification by default, explicit direct-display bypass,
  1.75 MB compressed Inline routing, RPC reconstruction guidance, current
  network fees/limits and exact prepared-call estimates. Custom EVM and Tezos
  RPC profiles are encrypted locally; missing KEEL deployments show setup work.
- **Library:** browse SDK module/deployment records and runtime requirements,
  with commands for local module build/test/index and guidance for publication.
  Connect a Studio to search its library through the same MCP implementation and
  save project references. Receipt-backed binding remains a separate publication step.
- **Metadata:** edit artwork name, artist, description, cover, animation/website
  URIs, background, typed traits and custom JSON. Import/export a metadata document.
  Project cards use its image first, then an imported artwork image, then an explicit
  empty state. Original image proportions are preserved.
- **Manage:** edit release plans, export originals, manage resource references,
  link one contract to several projects and open its ABI controls. Save a published
  token target and run file SHA-256 checks plus pinned EVM metadata reads. Readiness
  ratings retain unknown evidence; changed drafts invalidate prior comparisons.
  Keep ten check reports per project, including comparison with the saved draft.
- **Audience & discovery:** record discovery preferences, query the connected
  Studio index and distinguish candidates from matching file fingerprints.
  Collection eligibility is separate from file visibility. Viewer counts remain
  unconnected; no analytics collection was introduced.
- **Contracts:** remember contracts by chain and address, select recorded default
  infrastructure, import a creator-operation record, or discover a creator's
  collections through a selected factory and RPC. Shared ERC-1155 logical
  collections retain separate identities even when they share one token contract.
  Upload ABI arrays or compiler artifacts for exact overloaded read/write forms.
  Inspect code, EIP-1967/beacon/minimal-clone relationships and mismatches at a
  pinned block. Read methods use explicit RPC; write methods produce unsigned
  calldata reviews with optional pinned-block simulation from an explicit public address.
- **Wallets:** install MetaMask, Rabby, or Temple from pinned official releases,
  connect accounts inside KEEL, check signatures, and approve reviewed contract
  actions. Tezos uses Beacon for installed Temple and web, desktop, or phone
  wallets including Kukai, Umami, and AirGap. Public address records remain optional.
- **Memory:** explicitly remember creative preferences and decisions. These
  notes are user editable and included in assistant context only when selected.
- **Setup:** scoped Codex app-server or Claude Code connections,
  and direct OpenAI Responses/Anthropic Messages adapters. API credentials are
  encrypted by Electron safeStorage separately from project records. Requests
  need the user's installed/signed-in CLI or API key and explicit model ID.
  The installed Codex CLI passed a real minimal round-trip. Claude Code is
  installed here but needs sign-in. Direct API accounts remain untested.

## Wallets inside KEEL

Wallets offers pinned official MetaMask 13.47.0, Rabby 0.94.7, and Temple 2.0.31
packages. The downloader verifies the release SHA-256 before extracting a
private copy. Review the permissions and package fingerprint, then install and
create or restore accounts in the wallet's own window. Advanced users can
import an unpacked extension. Packages never update themselves or delete vaults.

Each installation has a persistent isolated session. KEEL's small browser API
adapter supports extension windows, tabs, service-worker messages and approval
popups. An EIP-6963/EIP-1193 connection page connects the wallet to the editor
without giving artwork or agents a provider. Account selection, chain switching,
custom network addition, balances, permission revocation and a non-authorizing
signature check are available. Contract writes bind the reviewed account, chain,
proxy/code identity, target, arguments, value and expiry. They simulate before
approval and persist submission state. Receipt checks compare the actual
transaction with the review; uncertain outcomes never trigger automatic retries.

**Tezos:** use the Tezos wallet section to choose an installed wallet or Beacon
pairing. Temple can run inside KEEL; Kukai opens in an isolated wallet window;
Umami and supported mobile wallets use Beacon app links or QR pairing. Select
Tezos Mainnet or a saved Tezos RPC profile. KEEL verifies chain identity and the
public key/address relationship. Tezos has its own balance and signature checks,
transfer/contract-call review, fee and storage-burn estimates, and operation
receipt history. Signing always happens in the selected wallet. ABI forms are
for EVM contracts; advanced Tezos calls use entrypoints and Micheline.

The native keyless acceptance suite checks connection, wrong-chain rejection,
wallet rejection, relative approval windows, isolation, Beacon's chooser and
closing a pending pairing window. Actual MetaMask setup, unlock, connection, signature verification, custom
network addition/switching, and a 1-wei transfer with exact receipt read-back have
also passed on macOS using a disposable local chain (31337). Other wallet versions,
Tezos approvals through each external app, hardware wallets, account recovery,
automatic updates, and Windows/Linux certification require further acceptance.
Electron implements a subset of Chrome APIs; arbitrary extensions and Chrome Web
Store packages are not universally compatible.

## Data and boundaries

Workspace state lives in `workspace.sqlite` under Electron's application user
data directory, with WAL and revision checks. Media bytes are stored separately
from JSON drafts as digest-addressed files (older SQLite blobs remain readable). Wallet extension files and isolated persistent
profiles also live under application user data. API keys are encrypted locally;
project source, notes and public addresses are ordinary local data. Keep private
keys and seed phrases inside your wallet. There is no automatic cloud sync. Connections offers a reviewed portable
workspace export/import; it includes original object bytes and adds project
copies while preserving existing contracts. API keys, wallet profiles and
assistant conversations and encrypted RPC profiles are excluded from that export.
Portable JSON backups support 64 MB total object bytes; larger originals can
be exported individually with streaming copies. File import itself has no
format or size cutoff. Browser previews may need a streaming renderer for
very large expanded graphs, and source editing is bounded separately. Conversations are
saved locally by chat; interrupted turns remain visible and
are never replayed automatically.

The environment variable `KEEL_DESKTOP_DATA_DIR` can select an absolute alternate
data directory for development/testing; never point a test at a real wallet profile.
The native smoke test allocates its own temporary directory automatically.

The editor has no Node APIs, external network requests, or arbitrary IPC methods.
Main-process operations validate both the requesting frame and typed inputs.
Artwork runs in a separate sandboxed origin for each project, with no preload
or external network access. Local ES modules, local fetches and attached
objects are supported; other projects remain blocked. The canonical SDK shell
verifies the local graph before mounting the work. Direct display is an explicit
choice in Shell. Local byte verification is not selected-chain publication proof.
Publication must continue through the registered shell, selected-chain modules,
exact wallet review, receipts and read-back gates.

The **Chats** workspace provides named, searchable conversations, pinning, archiving,
restoring, saved unsent drafts, streaming replies, cancellation and per-chat history.
Existing advisory conversations migrate without deleting their original records.
A chat belongs to one project or the workspace; switching views or closing the dock
does not interrupt it. API credentials and wallet profiles never enter tool context.

Codex uses its local app-server with scoped dynamic tools. Inherited shell, app,
MCP and plugin tools remain disabled; only KEEL's validated tool handlers execute.
Claude Code uses its local sign-in with an authenticated, short-lived loopback MCP
endpoint and an exact KEEL tool allowlist. Direct OpenAI and Anthropic connections
use LangChain's `createAgent`, shared typed tools and streamed replies. SQLite stores
history and actions; LangChain does not use a shared in-memory conversation store.
No adapter changes the user's saved CLI configuration.

Automatic context uses the selected project, editor view, request words, relevant
source excerpts, contract/module identities and enabled memories. **Inspect context**
shows the actual reference text. Each reply retains its context manifest. Recent
completed messages are included for continuity; a bounded chat-search tool retrieves
older work. Memory can be scoped to a project, pinned, paused, edited or forgotten.
Saved work is enabled by default, including when older assistant conversations are
first imported. The older per-message snapshot checkbox is not a workspace denial.
Existing chat choices remain unchanged on restart. Turning off saved work removes
workspace tools from the agent's tool list; **Use saved work** above the message box
restores them for the next reply. Disabling edits similarly removes draft/edit tools.

The assistant can create new local artwork, read source, suggest metadata/source/
intent changes, attach assets, track ABI contracts, inspect networks and contracts,
search modules, run project checks and invoke discovered local SDK/MCP tools in a
private folder. Existing project edits and memory changes require a visible review;
project fingerprints prevent overwriting newer work. SDK staging/publication tools
route to the existing Release guide and its canonical-shell/read-back requirements.

Wallet tools can open an installed wallet and prepare EVM or Tezos reviews. They
cannot invoke the send/approve routes. Only the creator's **Review & approve in
wallet** button can pass the existing one-use review to the wallet. Actual accounts,
networks, destinations, values, calldata and fees remain visible; existing wallet
expiry, simulation, code-identity and receipt checks still apply. No wallet provider
is injected into agent-generated artwork.

See [AGENT_WORKSPACE.md](AGENT_WORKSPACE.md) for the agent architecture, supported actions and test evidence.

See [the readiness audit](../../docs/KEEL_ENGINE_READINESS.md) for remaining work.

## Runtime performance

Preview assembly runs in one background worker with bounded, reusable verified
graphs. Workspace reads reuse an immutable snapshot until its revision changes.
Local queries load on demand, and late contract/gas results are discarded after
the form changes. The desktop optimization pass passed 29 tests plus native
save, preview, isolation and restart checks. See [measured results and implementation
notes](PERFORMANCE.md), or run `pnpm --filter @keel/desktop benchmark` after building.

## Artist workflow verification

The current desktop build passes 46 checks plus the native Electron and restart
flow. Native evidence covers metadata-image precedence, typed trait and custom-field
round trips, optional code, 390 px phone / 1280 px desktop previews, focus exit,
combined access rules, reordered drop phases, block-pinned token metadata,
stale-evidence clearing, and both 1512 px and 1000 px window layouts. See
[TESTING.md](TESTING.md) and `artifacts/smoke-report.json`.

These are local and simulated-chain checks. The desktop does not submit metadata
updates, publish drops, prove contract ownership, or measure real viewer counts.
EVM metadata reads do not by themselves establish complete onchain preservation;
Tezos metadata retrieval and full nested-dependency verification still need adapters.
Remote images use bounded HTTPS reads through an isolated image protocol. IPFS /
Arweave covers use public preview gateways. Large media remains in the original
file store; draft metadata has a separate 2 MB editing budget.

## External SDK and MCP workspace access

The desktop starts a private local workspace service when it opens. This service
uses the same `WorkspaceStore` and SDK project validation as the editor; it does
not depend on an assistant conversation or model provider. Find the connection
file in **Setup → Use your assistant from another app**.

Set `KEEL_EDITOR_CONNECTION` to that `workspace-connection.json` file in the
external KEEL MCP process environment. The stable file resolves the current socket
after an editor restart. `KEEL_EDITOR_SOCKET` is an optional explicit socket override.
The tools are `keel-editor-project-list`, `keel-editor-project-read`,
`keel-editor-project-update`, and `keel-editor-project-open`. Opening supplies a
`projectId` and requests its Preview page in the editor without starting a chat.
The editor saves any pending edit before navigating. An update supplies `projectId`, the latest `revision`,
and a `patch`; stale revisions are rejected. The connection permits local draft
edits, not signing transactions or manufacturing publication receipts.

SDK callers use the same service:

```js
import { connectKeelEditor } from '@keel/sdk/editor-client';
const editor = await connectKeelEditor(connectionFile);
const { projects } = await editor.listProjects();
const { project, revision } = await editor.readProject(projects[0].id);
await editor.updateProject(project.id, revision, { title: 'My revised artwork' });
await editor.openProject(project.id);
```

`importObject(bytes, name, mediaType, revision)` stores original binary objects;
attach the returned object ID in the subsequent project update. The editor watches
workspace revisions even with its chat closed. Unsaved project edits are retained
and cannot silently overwrite an external update. This transport has a 64 MB
per-message memory budget; import individual assets, not an archive or collection
as one request. It imposes no onchain storage limit.
