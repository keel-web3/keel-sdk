# Storage review compatibility: exact emitted client and MCP

SDK source checkpoint: `311d61526284248938e335d7ed879089408933be`.
Site adapter source: `56e835862b9bdf5b824e6adf06382f098a7f386a`.
SDK source fix: `09914c94e9110ac90bbecbfc295e42a3fb348d75`; source-only merge preserves canonical SDK master `fb90011f1ce0ef4dc0883378ffbed39522b1cbfe`, including its unrelated grouped-CREATE native changes. Existing built native runtime assets remain the inherited b524 bytes; this checkpoint does not rebuild, deploy, or qualify those Go changes.

The previous emitted client rejected a valid `keel-release-storage-review@1` before navigation, so the actual packaged MCP tool and Site embedded review app failed too. The byte-unchanged independent oracle is retained with baseline **2 PASS / 3 FAIL**, then **5 PASS / 0 FAIL** against this checkpoint.

`prepareReview` now accepts a strict unsigned storage navigation variant. It checks release/revision, project/revision/manifest, wallet, same-project artifact path, preflight shape, unsigned status, allowed fields, and optional saved state. It derives the exact configured Studio URL and adds `canSign:false`. Existing collection GET/read/resume validation remains unchanged. The embedded app uses its existing controls and text rendering; storage open/refresh uses prepare-review, never a fabricated collection operation or collection resume/cancel action.

## Validation on the frozen source

Official Node **22.22.1**. `311-commands.json` records the SDK/MCP TypeScript build and emitted-test commands. Both TypeScript builds exit 0. No test assertions, timeouts, reference assets, or runtime limits changed.

- Emitted SDK client, actual packaged `createMcpServer` dispatch, CLI, and existing guidance tests: **45 PASS / 0 FAIL**.
- Byte-identical independent regression SHA `a3e60ac9c4bf39e491a68beab05aa579be723f3add2718a1b21a3d44e9637561`: **5 PASS / 0 FAIL**.
- Complete generated Site app script under actual host-message protocol in VM: **3 PASS / 0 FAIL**. This is not a live-browser or authenticated-owner test.
- Emitted MCP self-test: status `ok`, all 8 checks pass, 117 discovered tools with the existing installed optional plugins.

Site app command:

```sh
/Users/ravonus/.nvm/versions/node/v22.22.1/bin/node --import /Users/ravonus/dev/wt/studio-outstanding-sdk-20261020/keel-site/apps/studio/node_modules/tsx/dist/loader.mjs --test /Users/ravonus/dev/wt/studio-storage-review-compat-20261020/keel-site/apps/studio/tests/unit/mcp-storage-review-app.test.ts
```

MCP self-test command:

```sh
/Users/ravonus/.nvm/versions/node/v22.22.1/bin/node packages/mcp/dist/cli.js --self-test --workspace /Users/ravonus/dev/wt/studio-storage-review-compat-20261020/keel-sdk
```

## Artifact identity and handoff

Packages are at `/private/tmp/keel-storage-review-compat-20261020/packages`; each tar's complete dist membership was verified against the owned generated files. `pnpm pack` resolved workspace dependencies without registry publication. `package-manifest.json` records exact sizes, SHA-256 hashes, version strings, dependencies, and source URL.

`emitted-dist-equivalence.json` compares all 1,745 generated files with inherited a9cd/b524: **1,739 unchanged**, **6 intended changes**, **0 added/deleted**. Only SDK `studio-agent-drafts` JS/types/maps and MCP `tools` description JS/map changed. All canonical shell, decoder, simulation, proof-runtime, and storage assets are unchanged. The complete inherited hash inventory is retained.

SDK `0.3.2` and MCP `0.4.2` alone do not identify these bytes. Discovery/package integration must use the immutable source checkpoint URL and exact package SHA-256. Actual canonical default branch is `master`; no stale `keel-onchain-data` branch has been advanced. No registry publish, signing, submission, production mutation, or activation occurred in this wave. Independent review, clean QA, Site package repinning/Next build, and actual owner workflow verification remain release gates.
