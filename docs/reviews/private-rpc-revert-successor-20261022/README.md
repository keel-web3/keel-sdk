# Contract revert precedence successor

Source-only successor, pending independent review. No release, activation,
credential access, host operation, provider request or transaction is claimed.
The old private fallback source remains independently BLOCKED; its prior results
and frozen directories/commits are unchanged.

Directory: `/private/tmp/keel-private-rpc-revert-successor-20261022-01/sdk`.
Branch: `codex/private-rpc-revert-20261022`.
Base/evidence parent: `4ce25c1a093c99b141711608cbb3ab38355dd4e4`, whose production
source is `6f4f5cd1ee9a8b8ce14aecc60e26f84f19180f94`.
Successor source/test commit: `6250fe0481cc4994f2bd039613bda8409b3876a4`.
Independent blocker receipt: `87e762c3e46379d8954f5517f8e7adc5e84ed1be` in
`/private/tmp/keel-independent-private-rpc-20261022-01/sdk`.

The production diff changes three lines in `packages/sdk/src/rpc.ts` only.
Explicit RPC401/403 codes retain denial priority. Genuine execution-reverted
responses then precede prose-derived auth/rate/body-limit interpretation, so a
contract's `unauthorized` or `authentication required` reason does not disable
the free provider or disclose the reverted request to another recipient.
Observed HTTP401/403 is already handled before RPC-body classification and
remains terminal even with slow, oversized or malformed bodies. Bounded
owner-private denial observations remain unchanged.

There is no change to state-reader source/runtime bytes, retry classes, canonical
pin, chain, request/call semantics, caps, privacy projections, primary/public RPC,
UI, or loader source79313/e52. A terminal proof reader remains latched; a new
reader may reuse the still-enabled free source after a genuine contract revert.

Exact independent tests are copied without changing bytes:

- Expanded24 SHA256:`466e3e11656993eb671b2437c3ee3092bbdcbef8583ebd7d329379543983ab09`.
- Original2 SHA256:`d70eb99b59bd3a16c41c1cafdbcbbd4d4711e170e8f70d077491ec387560bda8`.

Their original observations are retained as `independent-frozen-*.json`.
The successor runs use the identical scripts and retain separate raw logs and
new observations. The independent scripts import this checkout's actual shipped
`packages/sdk/dist/rpc.js`, not a test-only implementation.

Fresh pinned Node22.22.1 results:

| Evidence | Result |
| --- | --- |
| `before-revert-controls-final.log` |98 tests against frozen6f4 output:66PASS/32FAIL. |
| `exact-independent-24-after.log` |Exact independent expanded suite:24PASS/0FAIL. |
| `exact-independent-2-after.log` |Exact original independent suite:2PASS/0FAIL. |
| `after-revert-controls.log` |Five focused files:151PASS/0FAIL/0skip/0cancel. |

The151 include74 new controls,32 previous fallback safety controls,19 existing
RPC failure diagnostics and the unchanged26 independent controls. New cases
cover both `eth_call` and `eth_simulateV1`, authorization/rate/body-limit and
other revert wording, HTTP200/413/429/503 deterministic responses, actual
HTTP401/403 denial, slow/oversized/malformed denial bodies, explicit numeric RPC
denials, provider reusability and pinned-reader no-second-request behavior.
All fetches are injected local mocks; there are no public or paid requests.

Exact focused command:

```sh
/Users/ravonus/.nvm/versions/node/v22.22.1/bin/node --test tests/rpc-revert-message-precedence.test.mjs tests/proof-state-reader-fallback-safety.test.mjs tests/rpc-failure-diagnostics.test.mjs docs/reviews/private-rpc-revert-successor-20261022/independent-frozen-revert-authorization.test.mjs docs/reviews/private-rpc-revert-successor-20261022/independent-frozen-revert-message-precedence.test.mjs
```

Each exact independent suite also ran separately with the same Node binary and
its one unchanged script path. Baseline98 ran the new72-control file plus those
two independent scripts before the production correction; the final two numeric
denial controls were added afterwards to preserve the existing explicit-code guard.
The initial92-control baseline without six denial-body cases is also retained.

No full build, full suite or semantic typecheck was run under the lead's load
restriction. Only the changed RPC module was transpiled with TypeScript5.9.3 by
`transpile-rpc-only.mjs`. It requires byte-exact JavaScript parity when compiling
the frozen baseline before generating successor output. NodeNext's synthetic
single-file filename initially inferred CommonJS and failed that parity guard,
writing nothing. That failed setup check is retained in
`before-single-file-transpile.log`; the associated stale-output test RED remains
`after-attempt-before-successful-transpile.log`. The explicit ESM single-file
configuration now reproduces the frozen baseline exactly and records its limits
in `single-file-transpile.json`. This setup correction needs independent
admission; it is not a full-build substitute.

The intermediate prose-only correction log is retained. The final successor also
keeps explicit numeric denial codes ahead of prose. All old fallback REDS remain
in the inherited evidence directory. The previously recorded13 IPC socket-EPERM
failures and pending class-alias setup admission are not waived by this scoped
result; no IPC test or loader test was altered here.

Source SHA256:`7ab01252775a8caf401172cbf8ef2070fe14bcb817a79e6225c78407bce03d58`.
Dist SHA256:`1f769dcadc5b013a6563723432a31eb03b986f99a92533e1cb0d96591145d289`.
The manifest records exact source/runtime/test/evidence hashes.
