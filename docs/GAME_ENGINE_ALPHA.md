# KEEL game engine: alpha

Alpha testers make a pixel-art game in the KEEL Editor, preview it, build it as
a KEEL document, publish it to a practice chain on their own computer, and
share it. Sepolia is prepared up to the wallet's signature. Publishing to
Sepolia is the owner's decision; the checklist is at the end.

This page covers four things:

- the readiness audit of the tester's path, before and after this pass;
- how the engine, the shared engine release and the practice chain fit together;
- the alpha tester guide;
- the Sepolia dry run and the owner's go-live checklist.

---

## Readiness

The path an alpha tester takes, step by step, audited on 2026-09-14.

| # | Step | Before | After | How |
|---|---|---|---|---|
| 1 | Install | ✗ `@keel/game-engine` links `../../../keel-engine/*`. Without that checkout, `pnpm install` leaves dangling links. | ✓ once the owner pins a release | `pnpm game:engine` clones the pinned public release (`engine.lock.json`: repository and exact commit) into `packages/game-engine/.engine/<commit>`, then links it. A checkout (`KEEL_GAME_ENGINE_ROOT`, or `../keel-engine`) still wins for engine developers. Proven with no checkout: the engine root pointed at a missing path, 0 files read from `~/dev/keel-engine`. |
| 2 | Open the editor | ~ Opens, but the Game engine page only says "set KEEL_GAME_ENGINE_ROOT". | ✓ | A **Get the engine** button runs the same fetch. **Copy diagnostics** is on the page and in every "engine not connected" notice. The desktop build needs no engine: it was built with `KEEL_GAME_ENGINE_ROOT=/nonexistent`. |
| 3 | New game from a template | ✗ The "A game" template could only pick an existing example's module. A tester had nowhere to put their own game code. | ✓ 4 of 5 templates | **New game** (on the Game engine page, and in an empty Game tab). Templates: Blank, Top-down world, Level / world, Dungeon crawl, Character builder sample. Each is copied into the editor's `games/` folder with its own ids (`mygames/<slug>`, `mygames/<slug>-pack`). Dungeon crawl copies `examples/worlds`, which is mid-change (see Known limits). |
| 4 | Edit: Builder | ~ Builder exports became project files (`packs/<id>.ts`) that no game ever loaded. | ✓ | On **Save & run** and on publish, those files go into the game's own pack (`pack/src/assets/`). The pack provides their contracts, so a Builder creature shows up in the Character sample (screenshot below). |
| 4b | Edit: Level, Sound | ✓ The tabs work: their Electron suites pass with the engine. | ✓ tabs · ~ into games | Both tabs pass (`electron-level.cjs`, `electron-sound.cjs`). What they make isn't placed into a template game automatically yet. |
| 5 | Preview | ~ Worked for small games. Bigger ones failed verification with "Invalid string length": the level demo (23 modules), and the RTS (27). | ✓ | Blocker 1 is fixed (below). Level demo, army and the RTS all verify and render. |
| 6 | Build the KEEL document | ✓ with a checkout | ✓ | Same build, now on the engine's verified modules: `keel-game document <id>`, or `buildGame`. |
| 7 | Verification shell | ✗ at around 20+ importing modules | ✓ | Blocker 1, with a regression test. |
| 8 | Publish to the practice chain | ✗ "Practice" was a fake JSON-RPC fixture that couldn't take transactions. | ✓ | `pnpm game:sandbox`: anvil, KeelHold and KeelRawTokenURIBuilder (byte-identical to Sepolia), the engine release published once. Then **Publish to practice chain** in the Game tab, or `pnpm game:publish`. |
| 9 | View it from the chain | ✗ | ✓ | The practice viewer (`http://127.0.0.1:8646`) reads the game back through the builder each time it opens and serves it in the verification shell. **Copy link** / **Open in browser** in the Game tab. Every publish checks the read-back byte for byte. |
| 10 | Sepolia | ✗ No game publish path. The release wizard sends nothing. No numbers. | ✓ dry run; live is the owner's call | The **Publish to Sepolia** panel plans against Sepolia's KeelHold with read-only calls. Each transaction then goes through the editor's own wallet review, which stops at the signature. `pnpm game:sepolia-dry-run` measures every transaction on a local fork of Sepolia. |

Legend: ✓ works for a tester · ~ partly · ✗ blocks the path.

### A game loaded from the practice chain

These screenshots are read back from the local chain and verified in the KEEL shell. They are in `apps/desktop/artifacts/`, which is git-ignored and rewritten by the tests:

- `alpha-chain-level-demo.png`: 23 modules, 645 KB, 5 transactions for the game itself.
- `alpha-e2e-character.png`: the Character builder sample with a Builder-made creature (#1 in the list).
- `alpha-electron-from-chain.png`: the same, published from the editor and opened from its share link.

---

## Blockers, and what fixed them

### 1. The verification shell failed on larger games ("Invalid string length")

**Cause.** The shell's runtime (`packages/sdk/src/verification-shell.ts`, `compactInlineRuntime`) built a `data:` URL for every resource up front. It text-replaced every earlier resource id inside each later resource with that resource's whole URL. Engine modules name the ids they need in their wrappers, so each URL nested every earlier one. The strings grew exponentially until the browser's maximum string length was hit.

**Fix.** Names now resolve lazily. A resource's `data:` URL is built only when a text that is actually inlined names it, such as the entry document or a stylesheet it links. A resource can still name only resources before it, exactly as before. Modules the loader runs are never rewritten: they reach each other through import specifiers, which resolve by lookup in `__KEEL_MODULES__`. For every document that worked before, the output is the same.

**Tests.**

- `tests/sdk-verification-shell-large-graph-browser.test.mjs` is a new browser test, registered in `scripts/test-suites.mjs`. It covers two cases:
  - a 32-module graph where every module names every earlier one and the last two import by specifier;
  - entry-document names nested through a stylesheet into an image.
- Both tests fail with the old runtime and pass with the fix.
- Real cases:
  - the level demo went from "Invalid string length" to verified;
  - the RTS (a scratch copy of keel-rts, 27 modules, 916 KB) went from failing to verified and running.

### 2. `@keel/eth/sepolia/browser`

It is not on the game path. It is a `defineModule` **target** string, used once in `tests/sdk-module-declaration.test.mjs`, and that test passes. Publishable browser targets must name their CAIP-2 chain (`@keel/eth/eip155:11155111/browser`). `defineModule` enforces this only when a browser-module descriptor is in `extends`, and the error message says so. No game build, publish or viewer code reads targets, so nothing needed changing.

### 3. The engine only worked from a local checkout

The owner's direction: the engine is open source at `github.com/keel-web3/keel-engine`, and its modules are published on chain. So the SDK no longer assumes a sibling checkout. `packages/game-engine/scripts/engine-source.mjs` finds the engine in this order:

1. `KEEL_GAME_ENGINE_ROOT`, a checkout you point at. If it holds no engine, that is reported and the search goes on.
2. `../keel-engine` beside the SDK, the developer layout.
3. The pinned release: `engine.lock.json`'s repository and commit, cloned by `pnpm game:engine` into `packages/game-engine/.engine/<commit>`.
   - Only a tag or a full commit is accepted; a branch is refused.
   - The clone's packages reach each other through its own `node_modules` links.
   - The clone reaches `@keel/sdk` and esbuild through the SDK's `node_modules`. No npm install runs in the clone.

`link-engine.mjs` (`pnpm game:setup`) and the editor use the same order. The editor adds the pinned release to its engine candidates, shows which source it is using, and offers **Get the engine** when there is none.

Moving to npm later means one more source in `engine-source.mjs`. Node won't strip types under `node_modules`, so npm packages would ship compiled JS.

**Proof.** A copy of `packages/game-engine`, with no checkout anywhere and `KEEL_GAME_ENGINE_ROOT=/nonexistent`, fetched a git repository of the engine by tag, built `examples/hello`, and verified it. A module-resolution trace counted **0** files read from `~/dev/keel-engine`. The alpha e2e (below) ran the whole path the same way.

**The owner's step:** pin a release after pushing it (`pnpm game:engine --repo https://github.com/keel-web3/keel-engine --tag <tag> --pin`).

### 4. Nobody had published a game on chain; the engine should be stored once

KEEL already deduplicates by content:

- chunks are addressed by keccak and never cast twice;
- objects are addressed by their descriptor, so welding an existing one is a no-op;
- a composite can point at objects that already exist.

That lets a game's root reference shared objects that are already stored. The builder copies the objects straight into the document when it is read (`KeelRawTokenURIBuilder.preEncodedTokenURI`).

What was missing was the plan that splits a game into shared and own parts, plus the publisher, the read-back and the records. These now live in `packages/game-engine/chain/`:

- **The engine release**, published once per chain:
  - the shell's two halves;
  - every engine module as the exact KEEL module slot games carry, including Tone and keel-audio;
  - every verified module's shipped bytes (`dist/<name>.min.js`) as its own object;
  - the release record: the engine's catalog (`keel-engine-module-catalog@1`) with each module's deployment on this chain.

  The record's object id and sha256 form the **EngineReleasePin** that editors resolve the engine by (`@keel-engine/keel/resolver`).
- **A game publish** stores only the game's own modules, its pack and its entry, then welds its root over the shared object ids. If the chain lacks a shared object the game needs, the publish stops and says which ones, by id@version. `--include-engine` stores them with the game instead.
- **A game records the pin** of the engine release its shared objects belong to.

Measured sizes and gas are in the Sepolia section. For example, `examples/level-demo` stores 36 KB on its own, against 713 KB without the shared engine.

---

## How it fits together

```
engine source ── checkout / KEEL_GAME_ENGINE_ROOT / pinned release (.engine/<commit>)
      │  verified module pipeline (@keel/builder: build → receipt → digest)
      ▼
engine release on a chain  (once per chain; pnpm game:sandbox does it on the practice chain)
  • shell prefix/suffix objects
  • one slot object per engine module (what game roots point at)
  • one bytes object per verified module (what the resolver reads)
  • the release record (catalog + deployments) ── EngineReleasePin {version, chainId, hold, objectId, digest}
      ▲
game publish  (Game tab → Publish to practice chain, or pnpm game:publish)
  • the game's own module, pack and entry objects
  • the root: a composite over [shell, engine slots…, game parts…, shell]
  • read back through KeelRawTokenURIBuilder, checked byte-for-byte
      │
practice viewer  http://127.0.0.1:8646/game/<chainId>/<root>?digest=…  (reads the chain on every open)
```

- **The contracts.** KeelHold stores bytes. KeelRawTokenURIBuilder reads a game back as token metadata whose `animation_url` is the document.
  - On the practice chain the sandbox deploys both from `packages/game-engine/chain/keel-contracts.json`.
  - That file is written by `chain/fetch-contracts.mjs`, which is read-only against Sepolia: it takes the creation code from each Sepolia deployment transaction and checks that the runtime code is identical to Sepolia's.
  - The Sepolia deployments are KeelHold `0x0a4f31d5ab08029e4c68f6f3227d9fa3a2d66267` and KeelRawTokenURIBuilder `0x70b5984c19baec22beefb1c2e0bd75a41e1452e0`.
- **The records** live in `packages/game-engine/.sandbox/` (git-ignored; `KEEL_GAME_SANDBOX_DIR` moves it):
  - `deployment.json`
  - `engine-release.json` (including the pin)
  - `games.json`
  - `sandbox.json`
  - `anvil-state.json`, the chain itself, so published games survive a restart.
- **The engine picker** (Game engine page → Engine version) resolves the practice chain's pinned release the way the engine's resolver does:
  - the record's sha256 against the pin;
  - each module's object against the catalog digest;
  - this editor's own verified build against the release.

  Each module shows *verified / not-deployed / mismatch* on chain and *match / mismatch / absent* locally, with a link to its readable source on GitHub at the release commit and its `keel module verify` command. The Sepolia row reads `engine.lock.json`'s `onchain` pins; it says "not published yet" until the owner adds one. `pnpm game:engine-check` is the command-line check.

---

## Alpha tester guide

### Install (about 5 minutes)

You need macOS or Linux, Node 22.18 or later, pnpm 10, git, and Foundry for the local chain (`curl -L https://foundry.paradigm.xyz | bash && foundryup`, then check `anvil --version`).

```sh
git clone https://github.com/keel-web3/keel-sdk.git && cd keel-sdk
pnpm install
pnpm game:engine        # gets the pinned KEEL game engine release (git)
pnpm build              # the SDK packages
pnpm desktop:build
```

### Your first game in 10 minutes

1. **Start your practice chain** in its own terminal and leave it running:
   ```sh
   pnpm game:sandbox
   ```
   It starts a local chain, deploys KEEL's storage contracts and publishes the engine once. The first start takes about a minute. It prints the RPC, the contract addresses and the viewer address. Ctrl+C stops it and keeps everything you published.
2. **Open the editor:** `pnpm desktop`. A green banner says it found your practice chain.
3. **New game:** in the sidebar, open **Game engine**, choose a template (start with **Character builder sample** or **Blank**), name your game and press **Create game**. The editor opens your new game's **Game** tab, with the game running in the preview.
4. **Make something in the Builder:** open the **Builder** tab, make a creature, a wearable or an object, and save it to the project.
5. **Save & run** in the Game tab. Whatever you made in the Builder goes into your game's own pack. The Character sample lists your creature with the others.
6. **Publish to practice chain**, at the bottom of the Game tab. You'll see what was stored for your game, what was reused from the chain (the shell and the engine) and whether the read-back matches.
7. **Share:** use **Copy link** or **Open in browser**. The link opens the game straight from your practice chain, in the KEEL verification shell. It works on your computer while `pnpm game:sandbox` runs.

The same from a terminal:

```sh
pnpm game:new character "My game" --dir ./games
pnpm game:publish mygames/my-game --project ./games
```

### Publishing, and what it costs

- A game publish stores only your game: its module, your pack and its entry, typically 4 to 40 KB. The KEEL shell and the engine modules are already on the chain, shared by every game.
- If the engine on your computer differs from the one on your practice chain, the publish names the modules that differ. Press **Publish this engine to the practice chain** on the Game engine page, or restart `pnpm game:sandbox`. **Publish with the engine modules it needs** stores them with your game instead.
- **Publish to Sepolia (prepare, then your wallet signs)** is in the Game tab. It plans your game against Sepolia, then walks each transaction through the editor's wallet review. Your wallet signs, or you stop there. During the alpha, leave Sepolia to the owner unless you're asked to try it.

### Known limits

- **The engine release isn't pinned or on Sepolia yet.** Until the owner pins a release, `pnpm game:engine` says so. Use a keel-engine checkout with `KEEL_GAME_ENGINE_ROOT`.
- **Dungeon crawl** copies `examples/worlds`, which is being changed right now (it imports `packs/dungeon-gear`, which isn't in the engine release yet). The other four templates build, verify and publish.
- **The share link works only on your computer.** A public viewer arrives with Sepolia. The `web3://` link points at the game's root object in KeelHold, for web3 clients and auditors.
- **Level and Sound tabs:** what they make isn't placed into a template game automatically yet.
- **Audio games** (keel/audio) publish Tone and keel-audio as shared page scripts.
- **The editor runs from the repository:** there is no signed installer. Windows is untested.
- **Documents over about 2 MB** (the public-read ceiling) won't read back through the builder. Today's largest example is 0.9 MB.

### Feedback

On the Game engine page, press **Copy diagnostics**. It copies the editor, Electron and Node versions, which engine you're on (checkout or release, its path and fingerprint), your practice chain's state and the last 80 log lines. Home paths and anything key-shaped are shortened. Nothing is sent anywhere. Paste it into your report along with what you did, what you expected and a screenshot. Send it to the owner's alpha channel; issues go to `github.com/keel-web3/keel-sdk/issues`.

---

## Sepolia dry run

`pnpm game:sepolia-dry-run --game <id>=<project> …` forks Sepolia into a local anvil. Only read-only calls go to Sepolia. It then runs the real publishes against Sepolia's KeelHold and builder from anvil's unlocked account:

1. each game without the shared engine;
2. the engine release, once;
3. each game with the engine release on chain.

Every game is read back and checked. Costs use Sepolia's gas price at the time. A Sepolia `eth_estimateGas` of the first transaction cross-checks the fork, within 1 % (below).

Measured 2026-09-14 17:13 UTC at Sepolia block 11704265, gas price 1.209 gwei. The engine was keel-engine's verified-module build at that time. The full report is `apps/desktop/artifacts/alpha-sepolia-dry-run.json`.

**The engine release, once per chain:**

- 35 slot objects: the shell's two halves, 31 engine modules, Tone and keel-audio.
- 31 verified-bytes objects.
- The release record.
- Totals: 1054.3 KB of slots, 137 transactions, **401,757,084 gas = 0.4859 ETH** at that price. At 5 gwei it is 2.01 ETH.

**Each game:**

| Game | Document | With the shared engine: stored | Gas | ETH | Without it: stored | Gas | ETH | Saved |
|---|---|---|---|---|---|---|---|---|
| `examples/hello` | 92.8 KB | 6.0 KB · 3 chunks · 7 tx | 2,156,036 | 0.0026 | 127.9 KB · 11 chunks · 12 tx | 29,920,305 | 0.0362 | 93 % |
| `examples/ui-demo` | 245.0 KB | 3.9 KB · 2 chunks · 5 tx | 1,522,725 | 0.0018 | 280.5 KB · 19 chunks · 17 tx | 64,818,049 | 0.0784 | 98 % |
| `examples/level-demo` | 644.3 KB | 36.4 KB · 3 chunks · 5 tx | 9,081,038 | 0.0110 | 684.0 KB · 45 chunks · 52 tx | 159,255,611 | 0.1926 | 94 % |
| `examples/army` | 431.7 KB | 30.2 KB · 3 chunks · 5 tx | 7,579,538 | 0.0092 | 469.3 KB · 32 chunks · 34 tx | 109,130,979 | 0.1320 | 93 % |
| `mygames/alpha-character` | 333.5 KB | 11.8 KB · 3 chunks · 7 tx | 3,620,048 | 0.0044 | 371.4 KB · 29 chunks · 36 tx | 87,253,819 | 0.1055 | 96 % |

"Without" means the game publishes the shell and every engine module it needs itself. That is the cost for the first game on a chain with no engine release. Once the release is on chain, every game after it pays only the "with" column: 88 to 98 % less. Games publish in 5 to 7 transactions of at most 3 chunks each. Every castSlugs transaction stays under the 16.7M-gas per-transaction cap (a full three-chunk cast is about 14.2M). The largest root read back is 645 KB, well under the builder's 2 MB public-read ceiling.

The cross-check: Sepolia's own `eth_estimateGas` for the first transaction was 563,470, and the fork's was 557,875.

---

## The owner's go-live checklist (Sepolia)

Nothing here has been sent. Each step is yours.

1. **Push the engine** to `github.com/keel-web3/keel-engine` and tag the release. Then pin it in the SDK:
   `pnpm game:engine --repo https://github.com/keel-web3/keel-engine --tag <tag> --pin`.
   This writes `packages/game-engine/engine.lock.json`. Commit it with the SDK.
2. **Fund one publishing address on Sepolia.** Budget:
   - about **0.5 ETH** for the engine release at 1.2 gwei (see the table; it scales with the gas price, so 5 gwei is about 2 ETH);
   - about **0.01 ETH** per game;
   - headroom for a price spike: 1 ETH covers the release and dozens of games.
3. **Contracts.** Nothing new to deploy. The release uses Sepolia's existing KeelHold `0x0a4f31d5ab08029e4c68f6f3227d9fa3a2d66267` and KeelRawTokenURIBuilder `0x70b5984c19baec22beefb1c2e0bd75a41e1452e0`. Casting is permissionless while KeelHold's seal fees are zero, which the fork confirmed. If fees are switched on first, the release must go through `castSlugsFor` intents (`prepareKeelWeld`).
4. **Publish in this order.** Rehearse with `pnpm game:sepolia-dry-run` first; its transaction list is exactly what will be signed.
   1. **The shell's two objects**, the prefix and suffix fragments. Every game's root begins and ends with them.
   2. **Every engine module slot object**, in the release's start order, beginning with `keel/runtime`.
   3. **Every verified module's bytes object**, the `dist/<name>.min.js` its receipt binds.
   4. **The release record**, the catalog with the Sepolia deployments filled in. Its object id and sha256 are the pin.

   `publishEngineRelease` in `chain/flows.mjs` produces all four with a viem wallet client. The owner signs with their own wallet (for example with `apps/desktop/scripts/publish-gator-runtime-sepolia.mjs`'s journaled pattern). No key is ever read by these scripts.
5. **Record the pin.** Add `{ "version", "chainId": 11155111, "hold", "objectId", "digest" }` to `engine.lock.json` → `onchain`. The editor's engine picker then verifies Sepolia the way it verifies the practice chain.
6. **Verify.**
   - `pnpm game:engine-check --rpc <sepolia rpc>` (read-only) should show every module verified.
   - Publish one example game from the editor's Sepolia panel. Check its root with the builder's read, and open it through a web3 gateway.
7. **Tell testers** to pull the SDK. `pnpm game:engine` now fetches the pinned release, and the Sepolia panel reports "only this game" per publish.

---

## Commands

| Command | What it does |
|---|---|
| `pnpm game:engine` | Clones the pinned engine release (or `--repo … --tag … [--pin]`), then links it. |
| `pnpm game:setup` | Links `@keel/game-engine` to the engine that is found (checkout first). |
| `pnpm game:new <template> "<name>" --dir <folder>` | Makes a game project from a template. |
| `pnpm game:sandbox [--port 8645] [--viewer-port 8646] [--reset] [--exit]` | Runs the practice chain: anvil, contracts, the engine release and the viewer. |
| `pnpm game:publish <game-id> --project <dir> [--include-engine] [--seed s] [--json]` | Publishes a game to the practice chain, reads it back and prints its links. |
| `pnpm game:engine-check` | Checks the practice chain's pinned engine release the way the editor's picker does. |
| `pnpm game:e2e [--template character]` | The whole tester path, headless: new game → Builder asset → build → shell → chain → read back → screenshot. |
| `pnpm game:sepolia-dry-run --game id=dir …` | Measures publishing on a local fork of Sepolia. Nothing is sent. |

## Tests

- `tests/sdk-verification-shell-large-graph-browser.test.mjs`: blocker 1, run with `pnpm test:browser`.
- `apps/desktop/tests/game-alpha.test.mjs` covers:
  - templates, and the Builder assets that go into a pack;
  - the order in which the engine is found;
  - practice chain status;
  - the publication plan's transaction order;
  - diagnostics.
- `apps/desktop/tests/electron-alpha.cjs` walks the tester's path in the editor: practice chain → new game → Builder creature → Save & run in the shell → Publish → share link opened from the chain → Copy diagnostics. Run it with `node apps/desktop/tests/run-electron.mjs electron-alpha.cjs`; it needs anvil and an engine.
- `packages/game-engine/chain/alpha-e2e.mjs` (`pnpm game:e2e`) is the same path without the editor.
