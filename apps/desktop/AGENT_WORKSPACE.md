# KEEL agent workspace

The editor's **Chats** page and assistant dock share one persisted conversation
system. This document describes product behavior, not instructions for coding agents.

## Everyday use

1. Open **Chats** and choose **New chat**. A chat started beside a project uses
   that project; an unbound chat can create new artwork across the workspace.
2. Ask normally: “Make a purple animated garden,” “Check this project's metadata,”
   “Find its modules,” or “Show me the release guide.”
3. New artwork is saved as a local draft. Suggested edits show the saved and
   proposed work before **Apply to project**. A changed project invalidates an old review.
4. Use **•••** to name or pin the conversation, select Codex/Claude/API and model,
   change context settings, archive, or restore. Stop a running reply before
   changing its connection. Up to two chats can work concurrently. Code-generating
   replies have one shared ten-minute deadline; **Stop reply** remains immediate.
5. **Memory** stores editable workspace or project preferences. Relevant enabled
   memories are included automatically. Pin a note to always include it in that
   scope, pause it to stop retrieval, or forget it. Agent-written notes appear as
   review cards first. Imported project memories retain the imported project scope.

## Context and tools

`agent-context.mjs` combines bounded saved source, the current editor view, SDK
choices and planner output, relevant resource/contract inventories and memory.
Context is selected by project scope and request words. **Inspect context** shows
the reference text, reasons, and excerpt boundaries. Credentials and RPC secrets
are excluded. Tool reads can retrieve additional source and older messages within
the same scope. Project content and recalled notes are reference data, not authority.
New and newly migrated chats default to saved work enabled. Existing settings are
preserved. With saved work off, only this chat's history search and the SDK reference
catalog are exposed, and the composer offers **Use saved work**. Each provider gets
the current access setting and only the tools that can actually run in that chat.

`agent-tools.mjs` supplies a single validated registry for Codex dynamic tools,
Claude's private MCP endpoint and LangChain tools. It includes project creation,
source/metadata/intent edit reviews, asset attachment, ABI tracking, contract reads,
project checks, preview, module search, network inspection, memory suggestions,
navigation and wallet-review preparation. The SDK catalog exposes exact schemas;
local SDK calls work in a per-reply folder with copied source files. Studio uploads
and publication continue through the existing Release guide.

`agent-store.mjs` journals chats, replies and exact action payloads in SQLite.
Legacy turns migrate once. Running replies become interrupted after restart;
uncertain actions remain marked for inspection and are never automatically replayed.
The full transcript is retained; only a bounded recent history is sent to the model.
LangChain's agent loop uses this supplied history instead of sharing a global
in-memory checkpointer between chats.

## Wallet reviews

The agent can open an installed wallet and prepare a contract call for a connected
account. The review shows network, account, recipient, amount, calldata, simulation,
fees and expiry. **Review & approve in wallet** is a user-only editor action; its
handler is not registered as an agent tool. EVM and Tezos retain their existing
one-use review, network/account validation and receipt-matching logic. A rejected
or unknown wallet outcome never triggers a retry. No test in this agent pass signed
or sent a transaction, or used the creator's wallet profiles.

## Validation

- Desktop unit suite: chat migration, pagination, archive/restore, context scope,
  memory filters, partial replies, cancellation, stale edit rejection, wallet
  approval separation and one-use action handling.
- Real LangChain model/tool loop with a deterministic keyless model.
- Private Claude MCP endpoint tested using a real MCP client, with missing-token
  and foreign-origin rejection.
- Hidden Electron acceptance: chat UI, creating a draft, canonical preview,
  reviewing edits, saving memory, navigation, archive/restore, cancellation,
  unsent drafts, separate chat history and responsive layout.
- Live Codex acceptance: created one disposable HTML artwork through a KEEL tool,
  then read the saved project back through another tool. Evidence is in
  `artifacts/agent-codex-live.json`.
- Live Claude acceptance reached an expired OAuth session. Run `claude auth login`
  before retrying. Its authenticated model/tool round trip is not yet certified.
- Direct OpenAI/Anthropic accounts were not used; model/tool and transport behavior
  was tested with fixtures. Keys and an accessible model ID are needed for live API use.

## References

- [LangChain JavaScript agents](https://docs.langchain.com/oss/javascript/langchain/agents)
- [LangChain context engineering](https://docs.langchain.com/oss/javascript/langchain/context-engineering)
- [Codex app-server protocol](https://developers.openai.com/codex/app-server)
- [Claude Code CLI](https://code.claude.com/docs/en/cli-reference)

## Shared creative libraries

For a Three.js draft, use `keel_create_project` with `runtime: "three"` and
`import * as THREE from "three"`. The project saves the exact r180 main/core
identities, versions, hashes and lengths. It does not copy a library into its
source files. The installed library supplies hash-checked preview bytes, ordered
with core before main. p5.js uses `runtime: "p5"`. An existing project can link
these through `keel_edit_project.runtime`, with the normal edit review.

Resources offers the same library choices. Viewing shows new artwork fragments,
shared libraries, and the complete viewer read separately. Artist-authored JS
still counts as new storage. The complete Inline read includes the libraries even
when publication reuses them; selected-chain receipt/read-back is required before
claiming those module bindings exist. Missing library setup and final contract or
metadata overhead are separate from the measured new artwork fragments.

Tezos has its own extension installer using the same pinned download, permissions
review, persistent profile, and open-wallet flow as EVM. Temple is available in
both groups. Other installed extensions can be selected for Tezos pairing without
a wallet-name allowlist. Beacon remains the default alternative for web, desktop,
and phone wallets; a successful extension install alone does not prove signing.
