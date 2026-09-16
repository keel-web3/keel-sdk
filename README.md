# KEEL SDK

KEEL is a toolkit for storing browser-native artwork as immutable object graphs,
assembling collector-facing token views, verifying every byte before execution,
and preparing mint, sale, collection, and Fray auction actions without giving an
agent control of a wallet.

This repository contains the TypeScript protocol, SDK, builder, viewer, Studio
core, MCP server, examples, and local verification tooling. The EVM contracts
and their Forge tests live in the sibling
[`keel-contracts`](https://github.com/keel-web3/keel-contracts) repository.

## Default storage and read path

These rules are automatic for every contract, collection, viewer, metadata,
and release request. A creator does not need to know the terms “module,”
“canonical shell,” “raw-percent,” or “media carriage” to receive the correct
route; the agent reads the project README/docs and performs the selected-chain
module and graph scan first. If that evidence is missing, publication stops.

`buildKeelInlineTokenURIGraph(root)` is the shared default used by the SDK,
MCP preparation, desktop preview measurements, and Studio publication plans.
It prepares `application/vnd.keel.token-uri-raw-percent-fragment` objects for
`KeelRawTokenURIBuilder`. Creator resources keep their single gzip/Base64
transport slot for the shell decoder. Neither the complete HTML nor the complete
metadata JSON receives a Base64 wrapper. Unsafe bytes are escaped once per URI
boundary at preparation time; contract reads copy the prepared objects and only
format the small live metadata/context envelope.

For collector images, preserve original binary bytes locally and prepare the
exact `data:image/<type>;base64,` carriage once before publication. Store one
receipt-bound payload or URI, without a second copy of the raw image. Contract
reads copy that prepared text without encoding the media again. GIFs are direct GIF data URIs, never SVG
wrappers or placeholders. The SDK validates the media container and exact
source carriage, while publication verifies the digest and public-chain bytes.

The SDK also audits the bytes a checker actually sees: it decodes raw-percent
layers, unpacks embedded gzip/deflate resources, and rejects concrete HTTP(S),
IPFS, Arweave, web3, and `keel-onchain` locators. A URL sentinel used only by
an injected onchain content reader is still rejected; use a path or identifier
and let the injected reader resolve it. The SVG namespace literal is the sole
allowed protocol URL.

The canonical shell source is packaged with the SDK, so consumers do not need a
KEEL checkout as their working directory. Publication reuses the selected chain's
verified shell and module objects. Only creator fragments and their composite
references are added for a work. Missing compact infrastructure blocks publication;
it never silently selects an older encoding. Explicit legacy carriage selections
remain available for existing publications.

Measure the complete returned tokenURI, including its image preview and metadata,
before publication. Report one-time shared infrastructure, creator writes, and
read gas separately. Graph size or compressed asset size alone is not a read-gas
measurement. Studio requires receipt-backed compact catalog records and verifies
collection compatibility before preparing its existing wallet review flow.

## Try the SDK, agent and visual editor

Start with [the friend quickstart](docs/FRIEND_QUICKSTART.md). One command builds
the SDK/MCP/editor, fetches the pinned public engine, and connects an artwork
folder to the agent skills. Local Anvil testing and read-only Sepolia checks
are separate commands; no developer checkout or private credentials are required.

```sh
git clone --branch codex/friend-test-setup https://github.com/keel-web3/keel-sdk.git
cd keel-sdk
pnpm setup:friend
```

## Start here

Requirements: Node.js 22 or newer and pnpm 10.15. Foundry is additionally
required for EVM contract tests.

```bash
pnpm install
pnpm build
pnpm test
```

The broad local gate is:

```bash
pnpm verify
```

This aggregate gate expects the canonical sibling `keel-contracts` and
`keel-site` checkouts. Use `pnpm build` and `pnpm test` for the SDK checkout's
portable local gate.

`pnpm test:conformance` deliberately requires the sibling contracts and related
fixtures. See [Testing and readiness](docs/TESTING.md) for focused SDK,
OneMint, Fray auction, sale, storage, token, module, p5, Three.js, Doom, and
Flash checks.

## Plan a work before staging it

Every new KEEL work starts with intent, then an explicit plan:

1. Is it a 1/1 or a collection?
2. Is the outcome storage-only, a release, fixed sale, claim, or Fray auction?
3. Is the runtime static media, p5, Three.js, Doom WASM, Flash AS3, or something
   else?
4. Which chain, storage mode, reusable modules, contracts, and proof layers are
   required?
5. Where does creator or wallet approval begin?

The MCP prompt `keel-project-plan` performs this discovery and returns a
review-only plan. The repo-local `$fray-keel-agent` skill makes that planning
phase the default agent workflow for 1/1s, collections, OneMint drops, sales,
claims, and Fray auctions.

### Contract work is always a KEEL workflow

An agent must not start from an ABI, an old deployment script, or a guessed
contract address. Before making or changing a contract, collection, viewer,
metadata binding, deployment, or release, it reads this README and the target
repository's relevant `docs/` files, then runs the MCP
`keel-contract-workflow-preflight` and follows its required sequence:
`keel-engine-catalog`, exact selected-chain `keel-network-inspect`,
selected-chain `keel-library-search`, and only then contract controls or wallet
review. The module scan is mandatory even when the request appears to be a new
contract; existing modules, proxies, graph revisions, canonical shell/builder
bindings, and edge-case recovery paths must be resolved before redeploying.

This is a default, not a user option. Missing README/docs or ambiguous
selected-chain module evidence stops the workflow before signing. The MCP and
the `$fray-keel-agent` skill enforce the same order so a normal creator does
not need to know the protocol vocabulary.

## The default verification shell is mandatory

Every collector-facing viewer uses KEEL's registered canonical verification
shell. A project supplies creator files and exact module declarations; it never
authors, copies, forks, shrinks, relabels, or uploads another default shell.
Omitting `viewer` in the Studio handoff selects the registered selected-chain
shell graph. If that graph is unavailable or ambiguous, preparation fails
closed.

`viewer: "none"` is the explicit raw-artifact route with no viewer—not a custom
shell route. The immutable artifact remains independently releasable, mintable,
and contract-readable. Creator-authored HTML remains artwork content inside the
canonical shell.

Read [The KEEL verification shell](docs/KEEL_VERIFICATION_SHELL.md) for the
single implementation map, registry checks, protected K control, opaque child
boundary, and exact Ethereum/Tezos reconstruction paths.

## Repository map

| Area | Purpose |
| --- | --- |
| `packages/protocol` | Canonical bytes, manifests, integrity, packing, and shared schemas |
| `packages/sdk` | Typed builders, ABIs, viewer graphs, collection plans, wallet-neutral envelopes |
| `packages/builder` | Media analysis, deterministic module builds, receipts, indexes, and upload plans |
| `packages/viewer` | Verified resource resolution, canonical shell chrome, and sandbox runtime |
| `packages/studio-core` | Project preparation and wrapper orchestration shared with Studio |
| `packages/mcp` | Stdio MCP tools, prompts, and resources for review-only agent workflows |
| `examples` | Static, p5, Three.js, Doom, module, and marketplace fixtures |
| `skills/fray-keel-agent` | Installable agent workflow with progressive references |
| `skills/keel-sdk-mcp` | SDK/MCP workflow defaults for automatic module, image-carriage, and publication planning |
| `.agents/skills/fray-keel-agent` | Repo-scoped discovery link to the canonical skill above |

The contract module map is maintained in `tools/keel/module-map.mjs`; contract
sources, module manifests, ABI snapshots, deployment records, and Forge tests
remain in the sibling contracts repository.

Examples and unit fixtures are synthetic. Creator collection names, media, and
release artifacts are project inputs, never SDK modules or catalog entries.

## MCP setup

Build and self-test the local server:

```bash
pnpm build
node packages/mcp/dist/cli.js --self-test --workspace /path/to/artwork
```

Add the built stdio server to Codex, then confirm that Codex sees it:

```bash
codex mcp add keel -- node /absolute/path/to/keel-sdk/packages/mcp/dist/cli.js \
  --workspace /absolute/path/to/artwork
codex mcp list
```

For repository-scoped configuration instead of a user-level CLI entry, add the
equivalent server table to `.codex/config.toml`:

```toml
[mcp_servers.keel]
command = "node"
args = ["/absolute/path/to/keel-sdk/packages/mcp/dist/cli.js", "--workspace", "/absolute/path/to/artwork"]
```

Other MCP clients can point at the same built CLI:

```json
{
  "mcpServers": {
    "keel-mcp": {
      "command": "node",
      "args": [
        "/absolute/path/to/keel-sdk/packages/mcp/dist/cli.js",
        "--workspace",
        "/absolute/path/to/artwork"
      ]
    }
  }
}
```

The server advertises focused tools plus four prompts and five static resources:

- `keel-project-plan` for intent discovery and a plan-first handoff;
- `keel-asset-review`, `keel-draft-repair`, and `fray-auction-review`;
- `keel://mcp/workflow`, `keel://mcp/limits`,
  `keel://mcp/project-routes`, `keel://mcp/publication-modes`, and `keel://mcp/engine`.

The MCP does not sign, submit, claim faucet funds, fetch undeclared carrier
bytes, or treat a plan as approval. Optional Studio operations are bounded to
explicitly configured metadata and staging endpoints. See
[`@keel/mcp`](packages/mcp/README.md) for the complete tool and transport
contract.

## Skill setup

Codex discovers the Fray workflow automatically when opened anywhere in this
repository through `.agents/skills/fray-keel-agent`, which points to the one
canonical source at `skills/fray-keel-agent`. The SDK/MCP workflow is also
available as `skills/keel-sdk-mcp`. `pnpm setup:friend` installs both skills in
the chosen artwork folder for project-scoped discovery. Codex supports symlinked
skill folders; if a new skill does not appear, restart Codex.

For a separate installation, use the skill installer with this repository path:

```text
$skill-installer Install https://github.com/keel-web3/keel-sdk/tree/master/skills/fray-keel-agent
```

Then start with a request such as:

```text
$fray-keel-agent Plan a deterministic p5 collection on Sepolia with a claim.
```

Installing the skill does not install, start, authenticate, or connect the MCP.
Configure and self-test the server separately.

## Creator and runtime routes

| Work | Creator-owned bytes | Reused system pieces | Starting example |
| --- | --- | --- | --- |
| Image/video/GLB | Direct media | default shell + `keel.asset-display@1` | `examples/image-wrapper` |
| p5 | Script and assets | same-chain p5 + `keel.seeded-random` | `examples/agent-p5-project` |
| Three.js | Scene, model, assets | exact same-chain Three.js module graph | `examples/starters/three-model` |
| Doom WASM | WASM-derived project descriptors | WASM sandbox/runtime + recursive native storage | `examples/demos/doom-wasm` |
| Flash AS3 | Compiled SWF + project declaration | receipt-backed Ruffle/decoder/seed modules | sibling `flash-keel` repository |

A module's planned object ID, catalog name, or local digest is not publication
proof. Bind reusable modules only after object bytes, digest/length, registry
records, and selected-chain deployment receipts have been read back.

## Build, test, and index JavaScript modules

The module pipeline keeps readable source, deterministic shipped bytes, test
vectors, catalog indexing, and chain deployment as separate facts:

```bash
pnpm exec keel module build --all --root ./keel-modules
pnpm exec keel module test --all --root ./keel-modules
pnpm exec keel module index --root ./keel-modules \
  --repository https://github.com/you/keel-modules
```

These forms resolve the checkout-local CLI after `pnpm install`. If the KEEL
CLI is installed separately, the equivalent commands begin with `keel`.

`verified` means the readable source reproduces the exact output. `deployed`
means a chain deployment record exists. Neither implies the other. Read
[The KEEL module pipeline](docs/KEEL_MODULE_PIPELINE.md) and
[Module assurance](docs/KEEL_MODULE_ASSURANCE.md) before publishing or indexing
third-party modules.

## Proof is layered

Local tests prove local behavior. Forge tests prove contract behavior in their
test environment. A deterministic catalog proves indexed source/output
relationships. Browser evidence proves the actual runtime at the tested URL.
A transaction receipt proves one transaction succeeded. Contract read-back
proves the stored state or bytes at a block.

Do not collapse these into one "verified" label. A live publication claim needs
receipts and read-back; a viewer claim also needs browser/runtime evidence.

## Local KEEL Editor

The Electron desktop preview in [`apps/desktop`](apps/desktop/README.md) uses
React, Tailwind, the Studio design, and shared SDK decisions. It includes local
projects, object imports, module guidance, a multi-contract/collection registry,
ABI-generated controls, public wallet identities, explicit memory, advisory
local/API assistant adapters, and experimental isolated wallet-extension
installation. Contract writes remain unsigned reviews.

Run `pnpm desktop:build` then `pnpm desktop`. Read the
[engine readiness audit](docs/KEEL_ENGINE_READINESS.md) for verified behavior
and outstanding wallet, provider, publication and release gates.

## Runtime module discovery

See [runtime module discovery and reuse](docs/KEEL_RUNTIME_MODULE_DISCOVERY.md) for the shared SDK/API/MCP lookup, unverified module sandbox, coverage limits, and browser MP4 encoding workflow. Empty catalog results never authorize rebuilding an existing module.
