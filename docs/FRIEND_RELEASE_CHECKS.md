# Friend release checks

Checked locally on macOS, 2026-09-16. Follow [the quickstart](FRIEND_QUICKSTART.md)
to reproduce the setup. This is a source preview, not a signed desktop release.

- Full friend setup with Node 22.22.1: passed, including locked dependency
  installation, SDK/MCP build, pinned engine linking, editor build and MCP
  discovery (53 tools). The checkout was isolated from maintainer sibling repos.
- Setup/reuse plus the eight SDK/MCP test files named in the friend CI workflow:
  68 passed with Node 22.22.1.
- Desktop local tests: 145 passed, 18 skipped.
- Native Electron Builder and level-editor acceptance: passed with the pinned
  engine, including generated objects, rig editing, sprite baking and level edits.
- Native Electron Alpha acceptance: passed. Created a game and generator recipe,
  rendered in the canonical shell, published to a disposable local Anvil chain,
  read back the bytes and verified the resulting game in the practice viewer.
- Original JavaScript pixel engine: 180 passed, 1 skipped; four additional
  reference-dependent test files were omitted because the external NOCTURNES
  reference was absent. These omissions are printed by the test runner.
  Linux x64 exposed final-bit differences in four physics hashes; the tests
  retain the macOS arm64 pins and also check platform-specific hashes plus a
  common per-step trace rounded to one millionth of a unit.
- Modular TypeScript engine at
  `feadfc995fa16046f6b08e157803e47f6a87a93e`: typecheck passed; engine tests had
  778 passes and 71 skips. All 33 modules built reproducibly. Module vectors
  passed after refreshing the intentional worldgen and particle shader changes;
  the particle vector was rerun separately after that fixture update.
- Sepolia infrastructure check: passed at block 11718647, including chain ID,
  both runtime hashes, deployment receipts and the builder's storage binding.
  This was read-only; no Sepolia publication or wallet signing was performed.

The broad `pnpm test` entrypoint remains blocked by its existing unclassified
test list. The explicit friend checks are not a full SDK gauntlet pass.
Linux/Windows native desktop behavior, a third-party agent's actual conversion
of arbitrary code, public-chain publication of that code and wallet interaction
remain separate acceptance work. A generator needs an editor recipe/schema or
adapter before arbitrary parameters can be edited graphically.
