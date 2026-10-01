# Seeded generative redesign

Builder → **Generative redesign** asks an existing Codex or Claude connection to
author a new, engine-native asset using one explicitly selected model as a
reference. It is a separate authoring path from literal conversion.

## Creator flow

1. Choose a self-contained GLB/glTF, OBJ, STL, VOX or `.keelasset` from Files.
2. Choose **Original** design intent to retain recognizable source identity, or
   **Theme** and a description to reinterpret it. Add optional guidance.
3. Independently select the visual style: **Original**, **Pixel**, **Dither** or
   **Voxel**, with the same `pixelSize`, `toneLevels` and named engine `screen`
   contract as the styled-asset importer. Original design intent is a faithful
   reinterpretation, not a promise of byte-exact source recovery.
4. Choose Codex or Claude, an optional installed-provider model ID, and a seed.
   **Generate** is the point that sends the request through that connection.
5. Review the validated preview. Change the seed to explore the same program
   locally, without making another provider request. A fresh Generate request
   can author a different program even if the seed is the same.
6. **Accept** saves a new generative recipe, a replayable build and a trusted
   loader in the project. Existing files and the source model are retained.
   **Keep source** / **Cancel** discard the candidate instead. Failed saves can
   retry accepting the exact last validated candidate.

## Actual provider integration

This feature reuses `src/providers.mjs`, rather than introducing a new bridge:

- Codex uses the installed CLI's **Rust app-server** JSON-RPC connection,
  ephemeral read-only threads and the editor's existing tool-isolation checks
- Claude uses the installed **Claude Code CLI** print/stream-JSON adapter with
  native tools disabled, empty strict MCP configuration and plan permissions
- Claude is not represented as a provider of the Codex Rust app-server
- An existing signed-in CLI is required. This feature does not create
  credentials, sign the user in, add API accounts, or expose the editor's
  general project-editing tools to a generation request

Each authoring turn runs in a new empty temporary directory. Its prompt contains
only the bounded text/numeric geometry, palette, parts and rig descriptor of the
selected source; the requested design/theme/style settings; and the actual
engine's program reference. It does not send the original model bytes, another
file, project contents, chat history, environment values or credentials. The
model does not receive a rendered image; describe details it cannot infer in
the optional guidance. Source metadata is explicitly untrusted data.

The existing provider's account usage and terms still apply when the creator
clicks Generate. Automated tests use fixtures and do not consume inference.

## Runtime and safety boundary

The provider returns only a `keel-generative-program@1` JSON program. A single
enclosing JSON code fence is tolerated; arbitrary prose or scripts are not.
`@keel-engine/builder/generative` validates its strict fields, scalar seeded
expressions, native operation allowlist and geometric work budgets before
resolving or executing it. Execution uses the engine's deterministic PRNG and a
fresh builder session. The current editor build is never used as scratch space.

The native recipe is the primary artifact. Preview geometry is constructed by
trusted engine code and shown by the existing sandboxed styled-asset player.
The preview has no editor bridge or network access. Generated JavaScript is
never evaluated. The saved small loader is a fixed host template importing the
trusted runtime; it is not code authored by the language model.

Only a server-retained, successfully validated candidate can be accepted.
Cancellation propagates to the provider, and late source-analysis, provider or
preview results cannot revive a cancelled request. Duplicate and overlapping
authoring turns are rejected. Retained candidates are bounded and expire after
30 minutes. Provider timeout, invalid JSON, unsupported operations and preview
errors leave the source and current project unchanged.

Deterministic replay means the **same accepted program, seed and engine runtime
version** yield the same native build. It does not mean provider authoring is
deterministic, source animation is reconstructed, or browser/GPU pixels are
identical across devices.

## Development and verification

Requires an engine checkout containing the tooling-only builder generative
subpath plus styled-asset runtime. Select it with `KEEL_GAME_ENGINE_ROOT` as for
the rest of the desktop editor. Older engine checkouts fail with an explicit
update message rather than falling back to unvalidated code.

Run the desktop typecheck/build and tests. The source-only provider and lifecycle
tests are fully offline. Engine-backed tests require the matching checkout;
the standard no-sibling setup CI cannot establish that external feature gate.
No live Codex or Claude model request is needed for the offline tests.

For the real-source feature gate, set `KEEL_GAME_ENGINE_ROOT` to the matching
engine checkout and `KEEL_REDESIGN_FIXTURES` to a directory containing the
canonical `Fox.glb` and `LittlestTokyo.glb`, then run:

```sh
node --test --test-concurrency=1 \
  apps/desktop/tests/generative-redesign-worker.test.mjs \
  apps/desktop/tests/generative-redesign-service.test.mjs \
  apps/desktop/tests/generative-redesign-project.test.mjs \
  apps/desktop/tests/providers.test.mjs
```

Source preflight tests cover bounded PNG inflation, accessor/primitive/skin
allocation, scene graphs, OBJ/STL parsing and VOX placement budgets. Browser
interaction acceptance is an explicit separate gate:
`KEEL_TEST_REDESIGN_UI=1 node --test apps/desktop/tests/generative-redesign-panel.test.mjs`.
It requires a runnable local Chromium (`CHROMIUM_BIN` may override its path).
The trusted-player tests use real Three objects with a renderer spy and do not
establish GPU pixel fidelity or replace this interaction gate.

This change is a desktop/editor integration. It does not publish an on-chain
module, merge a pull request, deploy the converter Site, or enable a new service.
