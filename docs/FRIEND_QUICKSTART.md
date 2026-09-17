# Try KEEL with your own code

This is a source-based test release: SDK, local MCP, agent skills, visual editor,
and a pinned public game engine. You do not need the maintainer's sibling repos,
Studio credentials, Docker, or a private key to build and practice locally.
The desktop is a development preview, not a signed installer.

## Install once

Install Git, **Node 22.18+** and **pnpm 10.15.0**. For chain practice, also
install [Foundry](https://getfoundry.sh/) so `anvil --version` works.
macOS is the currently exercised desktop platform. Linux needs Electron's GUI
libraries and a display. Native Windows desktop/Anvil setup is not certified.

```sh
git clone https://github.com/keel-web3/keel-sdk.git
cd keel-sdk
pnpm setup:friend
```

Setup installs locked dependencies, builds the SDK/MCP, fetches the exact engine
commit in `packages/game-engine/engine.lock.json`, links it, builds the editor,
and checks MCP discovery. It creates an empty `.keel-workspace` artwork folder
with project-scoped MCP settings and copies of the available KEEL skills for
Codex and Claude Code. It does not start a server, send a model request, or
submit a transaction. Keep this SDK checkout in place: the connection uses its
absolute path and your Node executable.

For existing artwork, use `pnpm setup:friend --workspace /absolute/path/to/art`.
Existing agent settings and skill copies are preserved; setup prints anything
that needs merging. The generated `.keel/codex.toml` and `.keel/mcp.json` always
contain the new connection. Other MCP clients can use that JSON. For a headless
agent, add `--skip-desktop`. `--skip-engine` supports SDK/MCP-only use.
After a successful build, `--connect-only --workspace /path/to/another/work`
connects another folder without reinstalling. Review generated machine-specific
settings before committing an artwork repository.

Open the artwork folder in your agent, trust the project if prompted, and reload
its skills/MCP connections. The MCP is scoped to that folder. The copied skills
do not automatically upgrade; compare them with `skills/` when updating KEEL.
See the official [Codex MCP documentation](https://developers.openai.com/codex/mcp/)
and [skills documentation](https://developers.openai.com/codex/skills/).

## Update to the latest test release

From the SDK folder:

```sh
git pull
pnpm setup:friend
```

Setup fetches and links the engine commit the SDK now pins, and rebuilds the SDK,
MCP and editor. Your artwork folders and agent settings are kept. Restart the
editor and reload your agent's MCP connection afterwards.

## Pixel engine: part of the SDK

`packages/pixel-engine` contains the original JavaScript KEEL Pixel generator
source, docs, tests and WALLRUN example. `packages/game-engine` exposes the
current modular engine used by the editor; setup fetches and pins those parts
automatically. They are parts of one SDK workflow.

The engine is written in TypeScript, and we recommend it for new games, but your
game doesn't have to be. Game and pack projects can be plain JavaScript
(`src/module.js`, `src/index.js`) or a mix of JS and TS. They build, link and
verify the same way. Porting an existing JavaScript game means wiring it to the
engine's modules, not converting it to TypeScript.

Run `pnpm pixel:test` for the portable JavaScript engine tests, or
`pnpm pixel:serve` and open the printed WALLRUN URL. Historical NOCTURNES
comparison tests skip unless `NOCTURNES` points at that external reference
checkout; the reference is not needed to use the engine. Its floating-point
physics has platform-specific last-bit results. Golden tests check a common
per-step trace rounded to one millionth of a unit plus platform-specific exact
hashes; do not use those raw floats as cross-machine consensus proofs.

## Convert generator code, then edit it visually

Give the agent this request with your original source attached or in the folder:

> Use the Fray KEEL agent skill and KEEL MCP to inspect this code and plan its
> conversion into a deterministic KEEL project. Preserve the original source.
> Keep generators, parameters, seeds, HTML, CSS and imported modules separate;
> don't replace procedural code with pre-rendered asset exports. Map supported
> controls into the editor's Builder or level recipe tools. Show which code
> still needs a custom control adapter. First build and test on local Anvil;
> prepare Sepolia only after local rendering and exact byte read-back pass.
> Plain JavaScript is supported: port JS code onto the engine as JavaScript and
> don't treat converting it to TypeScript as a requirement or a porting cost.

Then start the editor from the SDK folder:

```sh
pnpm desktop
```

Use **Game engine** to inspect the available modules and create a game project.
Inside a game project, the Builder and level tools edit supported generator
recipes and seeds. Save and run to rebuild its preview. Keep the recipe/code
as the source of truth. Importing an arbitrary script does not automatically
create sliders or a node editor: an agent must expose its parameters through a
supported recipe/schema or implement an adapter. Ordinary HTML/p5/Three.js art
can use the Interactive Art workflow and code preview without becoming a game.

The editor's own assistant connections need your installed, signed-in agent CLI
or your own model API credentials. The external MCP connection above is usable
independently. No hosted Studio is needed for local work; Studio staging and
hosted publication require a separately configured authorized Studio service.

To let the external agent open and update projects in the running editor, copy
the connection-file path from **Setup → Use your assistant from another app**,
then run:

```sh
pnpm setup:friend --connect-only --workspace /path/to/art --editor-connection /path/to/workspace-connection.json
```

Reload the MCP connection. Setup updates its own generated settings; customized
settings are preserved and need a manual merge from `.keel/`. The editor tools
use revision checks and do not authorize wallet transactions.

## Practice against actual contracts on local Anvil

```sh
pnpm game:sandbox
```

This starts a loopback-only chain at `http://127.0.0.1:8645`, chain ID `31337`,
deploys the shipped KEEL contract bytecode, and publishes shared engine modules.
The editor detects the practice chain. Use its practice publication controls,
then open the local viewer printed by the command. Stop with Ctrl+C to save
state. State is under `packages/game-engine/.sandbox`; don't use `--reset`
unless you intend to discard it. Use another port and `KEEL_GAME_SANDBOX_DIR`
for an independent sandbox. Never use Anvil's public test accounts on Sepolia.

An automated round-trip creates a blank project, deploys into a disposable node,
publishes and compares exact read-back bytes:

```sh
pnpm sandbox:test
```

The test uses a free local port and removes only its own temporary state. If a
headless browser is installed, set `KEEL_CHROME_HEADLESS_SHELL` to its executable
for rendering checks too. Without it, the report explicitly skips browser proof.
Contract fixtures contain the Sepolia deployment transaction IDs and runtime
hashes; local deployment uses their creation code with local constructor bindings.
The practice node allows larger code/gas limits for testing, so local success
alone does not establish public-chain size or gas eligibility.

## Check Sepolia without signing

```sh
pnpm setup:sepolia
```

This reads chain ID `11155111`, pins a block, checks both contract runtime hashes
and deployment receipts, and verifies the builder points to the recorded storage
contract. It uses a public RPC by default; set `KEEL_SEPOLIA_RPC_URL` for another
provider. Keep credentials in your environment, not Git. An RPC outage fails the
check; it never changes networks or reports readiness on failure.

The checked contract addresses come from
`packages/game-engine/chain/contracts.mjs`. This check proves infrastructure
identity only. The agent must still inspect the selected network, search and
verify shared module/shell records, and validate your project's exact bytes.
In the editor, use the Sepolia preparation action for an unsigned review.
Actual publication needs your wallet on Sepolia, faucet-provided test ETH,
explicit approval, successful receipts and exact public read-back. Setup never
requests a seed phrase or private key. There is no automatic public deployment.

For a Sepolia fork rehearsal, `pnpm game:sepolia-dry-run --game <id>=<project-dir>`
uses the same engine and publication implementation against a local fork. It
needs a working Sepolia RPC and Anvil; it sends nothing to Sepolia. Keep fork
gas results separate from public transaction receipts.

## Report a reproducible result

Run `pnpm setup:test`, `pnpm mcp:self-test`, `pnpm desktop:test`, and
`pnpm sandbox:test` for their separate scopes. `pnpm test` is the wider SDK
suite; `pnpm verify` additionally expects maintainer sibling repositories.
Include SDK commit (`git rev-parse HEAD`), engine lock commit, OS/Node versions,
failing command, and redacted error. State whether the failure is conversion,
editor preview, local publication, or Sepolia read-back. Never attach wallet
secrets, authenticated RPC URLs, or the editor's private application profile.

## Current broad-suite limitation

The aggregate `pnpm test` currently stops at an existing list of unclassified
SDK tests. The friend release uses the explicit CI checks in
`.github/workflows/friend-setup.yml`; do not describe that as a full SDK gauntlet
pass. Source installs and generator workflows are beta test surfaces.
