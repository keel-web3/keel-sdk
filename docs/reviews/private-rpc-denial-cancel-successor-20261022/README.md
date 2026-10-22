# Observed denial cancellation successor

Source proposal pending independent review. No full build, semantic typecheck,
artifact qualification, release, activation, provider request, credential access,
or host operation is claimed. All source/evidence ancestors and frozen checkouts
remain unchanged.

Directory:`/private/tmp/keel-private-rpc-denial-cancel-successor-20261022-01/sdk`.
Branch:`codex/private-rpc-denial-cancel-20261022`.
Base/evidence parent:`66794beb9ef540b06321f71b4d547617528796d5`;
base production source:`6250fe0481cc4994f2bd039613bda8409b3876a4`.
New production/test source:`73d8d49eea5a4fe8653f3137fcb05c0bc81c8ec2`.
Independent BLOCKED receipt:`7fd127a7dd5240103b5a3426fe8b5ed792d36610` in
`/private/tmp/keel-independent-private-rpc-successor-20261022-01/sdk`.

Only `packages/sdk/src/rpc.ts` changes in production. As soon as a response's
HTTP401/403 status is observed, the shared source is disabled with the existing
safe denial reason/diagnostic. Body capture and caller cancellation cannot undo
that restriction. Existing cancellation checks still return the exact original
caller error object. Bounded owner-private raw capture still runs as before;
no response text is added to public diagnostics.

An additional timing control found that another request already sharing the
first pending chain check could inherit the first caller's cancellation and
overwrite the observed denial reason. The request catch now retains that latched
denial. It does not change retry classes, transport/call limits, chain/block pins,
request bytes, genuine revert precedence or normal cancellation behavior. Reader
source/runtime and Site loader793/e52 are unchanged.

The exact independent additive reproduction is copied unchanged to
`tests/reviewer-denial-cancellation.test.mjs`, SHA256
`c5f5474f2f611f0d27205ea9df42021a4256c0140be6529b60144f9b16460416`.
It originally failed0PASS/2FAIL. The raw independent failure and its review are
retained as `independent-frozen-reviewer-denial-cancellation.log` and
`independent-frozen-README.md`.

Fresh pinned Node22.22.1 results:

| Raw evidence | Result |
| --- | --- |
| `before-denial-cancellation-controls.log` |Base6250, exact independent2 plus initial17 author cases:5PASS/14FAIL. |
| `after-immediate-header-latch-controls.log` |Header latch alone,19PASS/0FAIL; not the final timing coverage. |
| `before-shared-identity-restriction-controls.log` |Added two pre-header queued-identity controls:19PASS/2FAIL. |
| `exact-independent-2-after.log` |Final source, unchanged independent2:2PASS/0FAIL. |
| `final-combined-denial-cancellation-controls.log` |Final source,14 files:320PASS/0FAIL/0skip/0cancel. |

The320 comprise all299 previously reviewed affected controls plus the exact new
independent2 and19 authored controls. These challenge HTTP401/403 during chain,
code and proof reads; body-pending cancellation; queued reads before and after
header arrival; fresh requests and a new shared proof-reader session; cancellation
inside private capture; absent observers; body-read failures; and non-denial
cancellation before dispatch, before headers and during an HTTP200 body. Denied
sources receive no later dispatch or alternate request. Normal cancellation
preserves the original error and a reusable free provider.

Exact final command from the checkout above:

```sh
/Users/ravonus/.nvm/versions/node/v22.22.1/bin/node --test tests/proof-state-reader-fallback-safety.test.mjs tests/proof-state-reader.test.mjs tests/proof-state-reader-cache.test.mjs tests/rpc-failure-diagnostics.test.mjs tests/sdk-rpc.test.mjs tests/rpc-publication-simulation.test.mjs tests/sdk-public-simulation-pool.test.mjs tests/proof-runtime-package.test.mjs tests/proof-executor-transport.test.mjs tests/rpc-revert-message-precedence.test.mjs docs/reviews/private-rpc-revert-successor-20261022/independent-frozen-revert-authorization.test.mjs docs/reviews/private-rpc-revert-successor-20261022/independent-frozen-revert-message-precedence.test.mjs tests/reviewer-denial-cancellation.test.mjs tests/rpc-observed-denial-cancellation.test.mjs
```

The baseline/intermediate commands use only the final two paths. The exact
independent2 also ran separately with its unchanged single test path. All provider
responses and addresses are synthetic injected mocks. The two unchanged revert
scripts emit observations beside their inherited source; their generated final
observations were copied here as `combined-after-*.json`, then inherited evidence
files were restored byte-for-byte. No frozen predecessor evidence is rewritten.

Existing dependencies/output were copied and task-local aliases kept consistent,
without installation. The changed RPC module alone was transpiled using the
previously admitted explicit ESM setup, with exact frozen6250 JavaScript baseline
parity required before writing output. `transpile-rpc-only.mjs` and
`single-file-transpile.json` record that limited scope. No new setup correction
or heavy build was introduced. Current1-minute load was9.55 before work; no full
suite or semantic typecheck was attempted.

Prior independent review admitted the ESM, task-local class identity and canonical
temporary-path loader corrections. Those admissions do not imply this new source
has been independently approved. All earlier REDS remain in inherited evidence.

IPC qualification remains **BLOCKED** on13 Unix-socket `listen EPERM` failures.
The prior automatic approval review rejected the scoped socket escalation because
it would bypass an access denial the user prohibited. Both the raw failures and
rejection are copied unchanged as `independent-frozen-fresh-ipc-sandbox.log` and
`independent-frozen-ipc-automatic-approval-rejection.json`. No IPC retry,
escalation or workaround was attempted here. The320 mock passes do not waive
that blocker.

RPC source SHA256:`a0c02bc98bceed4eb8b177235df990e2f930ac93eabbbd8d374dbf9637348482`.
RPC dist SHA256:`36b7370dfb6cdd3b41faa4ff4f2b85d4c42de6d11e9f7063fb1ae672b58df22e`.
The manifest binds exact source/runtime/test/evidence hashes.
