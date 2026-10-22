# Private proof fallback safety source proposal

Source review only. No credential was accessed, no provider was contacted, and
no host/activation/signing/submission operation occurred. Independent source
review and release acceptance remain open.

Base SDK: `848a640afab90502e43bd750a7d930d9d0591244`.
Final production/test source: `6f4f5cd1ee9a8b8ce14aecc60e26f84f19180f94`.
Branch: `codex/private-rpc-fallback-20261022`.
Directory: `/private/tmp/keel-private-rpc-fallback-20261022-01/sdk`.
The only production changes are `native/proof-executor/state-reader.mjs` and
`packages/sdk/src/rpc.ts`; the new test is
`tests/proof-state-reader-fallback-safety.test.mjs`.

Existing private ordered proof-source lists remain the configuration interface.
No new env API, UI, endpoint selector, primary RPC, capability map or public URL
is introduced. Each new pinned reader starts at the first configured approved
source, respecting retained source cooldowns. A successful alternate may remain
selected for that reader after the preceding source demonstrated retryable
capacity/availability. No proof request is rerouted into remote execution.

Proof fallback is now limited to explicit rate-limit, timeout, unsupported-method
codes(-32601/4200), HTTP413 and bounded-response-limit observations. Denial,
wrong chain, reorg, null pinned state, malformed/stale/missing envelopes, unknown
RPC/transport errors and generic HTTP failures stop and latch the reader.
Genuine reverts and invalid requests remain terminal. HTTP401/403 outranks its
body's RPC wording and body-read timeout. Bounded owner-private denial capture
is preserved; the proof reader still emits only numeric/bounded classifications.
Exact Sepolia chain, EIP1898 canonical block pin, methods, one-slot bound,
15s per-read timeout,2MiB response cap and native operation semantics are kept.

Retained raw results:

| File | Result and meaning |
| --- | --- |
| `before-safety-controls.log` | Original29 new mock controls:14PASS/15FAIL before source correction. |
| `before-final-safety-controls.log` | Full32 new controls against untouched SDK848:14PASS/18FAIL. Some failures are a repeated-read terminal-latch assertion; original code3/invalid-parameter requests already refused initially. |
| `after-focused-controls.log` | First six-file run:95PASS/1FAIL from mixed task-local/shared SDK class identity. |
| `after-focused-local-links-controls.log` | Same six-file suite after local dependency correction:96PASS/0FAIL. |
| `after-runtime-controls.log` | Broader Node25 run:102PASS/2FAIL. One real regression suppressed existing owner-private denial capture; source6f4 corrects it. The other process aborted in Node25's native async-ID assertion. |
| `final-focused-controls.log` | Node25 after capture correction, nine files:199PASS/0FAIL. This is not pinned-runtime acceptance. |
| `final-node22-controls.log` | Pinned Node22 expanded scope:199PASS/13FAIL. Every failure is runner-client Unix socket `listen EPERM` in this sandbox; none is treated as a pass. |
| `final-node22-focused-controls.log` | Pinned Node22, nine scoped files, with runner-client IPC qualification separate. See exact raw count/exit result. |

The baseline-final runner copies the committed32-control test and changes only
its import to the untouched SDK848 checkout's reader. It is retained with the
raw baseline command's absolute environment dependency; it never calls fetch
outside its injected mocks.

Separate independent admission is requested for the dependency setup correction:
initial shallow dependency links resolved MCP imports through the shared SDK,
while test errors came from this isolated SDK, breaking class identity. Task-local
`@keel/*` dependency links now consistently resolve within this checkout. No
production file was changed for that correction; the95P1F RED is retained.
The Site evidence separately requests admission of its canonical-temp-path
fixture correction. Neither correction closes a live or release gate.

Environment: macOS, default Node25.8.2 retained only for earlier results; final
build/tests use `/Users/ravonus/.nvm/versions/node/v22.22.1/bin/node`, TypeScript5.9.3.
Existing dependencies and unchanged package build outputs were copied from the
exact base, without installation; SDK output was freshly compiled and the three
proof-runtime adapters freshly packaged. The package parity test checks exact
source-to-shipped-reader equality.

Fresh pinned build, exit0 (uptime1-minute load12.83 before work):

```sh
/Users/ravonus/.nvm/versions/node/v22.22.1/bin/node ./node_modules/typescript/bin/tsc -p packages/sdk/tsconfig.json
/Users/ravonus/.nvm/versions/node/v22.22.1/bin/node packages/sdk/scripts/package-proof-runtime.mjs
```

Final scoped command:

```sh
/Users/ravonus/.nvm/versions/node/v22.22.1/bin/node --test tests/proof-state-reader-fallback-safety.test.mjs tests/proof-state-reader.test.mjs tests/proof-state-reader-cache.test.mjs tests/rpc-failure-diagnostics.test.mjs tests/sdk-rpc.test.mjs tests/rpc-publication-simulation.test.mjs tests/sdk-public-simulation-pool.test.mjs tests/proof-runtime-package.test.mjs tests/proof-executor-transport.test.mjs
```

Expanded command adds `tests/proof-runner-client.test.mjs`; its13 socket controls
remain environment-limited and retained. The scoped command is not a full suite,
runtime IPC qualification, deployed proof or release approval. All test provider
responses use dummy credentials and injected fetch implementations.

Initial baseline command (exit1) was `node --test
tests/proof-state-reader-fallback-safety.test.mjs`; full32 baseline command
(exit1) was `node --test
docs/reviews/private-rpc-fallback-20261022/baseline-final-controls.mjs`.
The six-file commands use the first six paths of the final command. The first
broader runtime command uses public-simulation-pool, runtime-package,
executor-transport and runner-client tests. Every raw failure remains retained.

The manifest hashes production/test source, packaged runtime and retained logs.
