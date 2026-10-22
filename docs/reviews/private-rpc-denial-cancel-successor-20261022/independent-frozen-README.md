# Independent RPC successor review: BLOCKED

Reviewed SDK production source `6250fe0481cc4994f2bd039613bda8409b3876a4`,
evidence HEAD `66794beb9ef540b06321f71b4d547617528796d5`, and unchanged reader
source from `519ba4a` / `6f4f5cd1ee9a8b8ce14aecc60e26f84f19180f94`.
Site loader source `79313ea92d8fd33ab8260b47d82eb7eb472d8d3f`, evidence
`e52c66f5f6a7ad73def37ee706966d49fc647666`, remains in scope.

Independent checkout:
`/private/tmp/keel-independent-private-rpc-successor-20261022-01/sdk`.
Pinned runtime: `/Users/ravonus/.nvm/versions/node/v22.22.1/bin/node`.
No production fix was authored. No provider, credential, host, wallet,
transaction, deployment, container or signal operation occurred.

## P1 PRIVATE-DENIAL-CANCEL-1

`packages/sdk/src/rpc.ts:365` checks caller cancellation before turning an
observed HTTP401/403 into a denial. The outer catch at line406 also checks
cancellation before the shared provider restriction at lines408–409. Thus
cancellation while reading a known denial preserves the caller's abort error
but leaves the provider enabled. A later un-aborted pinned request dispatches
to that provider and succeeds in the injected reproduction.

Both HTTP401 and HTTP403 fail the unchanged additive reproduction:
`denial-cancellation.test.mjs`, SHA256
`c5f5474f2f611f0d27205ea9df42021a4256c0140be6529b60144f9b16460416`.
Fresh result: **0 PASS, 2 FAIL**, raw `reviewer-denial-cancellation.log`.
The failure is “Missing expected rejection” on the later request; the original
request's exact caller cancellation identity already passes. This is an
inherited combined-safety issue, not a regression attributed to the three-line
revert correction.

Reproduce from this checkout (copying the retained test changes no production
source):

```sh
cp docs/reviews/independent-private-rpc-successor-20261022/denial-cancellation.test.mjs tests/reviewer-denial-cancellation.test.mjs
/Users/ravonus/.nvm/versions/node/v22.22.1/bin/node --test tests/reviewer-denial-cancellation.test.mjs
```

Required correction: retain the known provider restriction before releasing
its queue despite caller cancellation, while preserving the caller's abort
identity and bounded private observation. Challenge HTTP401/403, queued and
fresh subsequent reads, cancellation timing and actual reader/session reuse.
Do not solve this by allowing denial fallback, swallowing cancellation or
changing the exact block, request or transaction.

## Fresh local results and scope

- **151 PASS**, exact five-file author cohort, including our original
  unchanged 24+2 tests. Old PRIVATE-REVERT-AUTH-1 is resolved: genuine reverts
  on HTTP200/413/429/503 remain typed and provider-reusable; actual HTTP401/403
  remains denial in the existing non-cancelled cases. Numeric RPC401/403
  retains precedence.
- **299 PASS, 0 FAIL, 0 SKIP**, combined twelve-file affected cohort, raw
  `fresh-combined-focused-complete-setup.log`.
- **10 PASS**, unchanged dummy-only Site loader controls against exact793/e52,
  raw `fresh-site-loader-10.log`. No new loader blocker identified. The fixed
  private root, root ownership/modes, no-follow descriptor/inode checks,
  bounded two-line whitelist, approved free prefix plus final private source,
  unchanged primary/public configuration and recovery snapshot remain present.
- **13 IPC cases BLOCKED**: sandbox Unix-socket listen EPERM. Automatic approval
  review rejected a narrowly scoped task-owned-socket escalation because of
  the user's no-bypass-denial instruction. No workaround or repeated request.
  Raw sandbox failures and the approval rejection are retained. No IPC success
  is claimed.
- Additional denial/cancellation **0 PASS / 2 FAIL** is a release source blocker.

The combined command uses these unchanged files:
`proof-state-reader-fallback-safety`, `proof-state-reader`,
`proof-state-reader-cache`, `rpc-failure-diagnostics`, `sdk-rpc`,
`rpc-publication-simulation`, `sdk-public-simulation-pool`,
`proof-runtime-package`, `proof-executor-transport`,
`rpc-revert-message-precedence` under `tests/` with `.test.mjs`, plus the two
unchanged `independent-frozen-revert-*.test.mjs` under
`docs/reviews/private-rpc-revert-successor-20261022/`.
Run them with the pinned Node binary and `--test`.

Reader inspection and maintained tests retain selected Sepolia chain,
EIP1898 canonical hash, header qualification, immutable cloned request fields,
one-slot limit, 15-second/2MiB bounds, per-reader terminal latch and free-first
new-session ordering with retained cooldowns. Only explicit approved retry
classes select another already-approved recipient. No state execution,
proof/root verification or native program semantics changed.

## Independently admitted setup corrections only

1. **Single-file ESM transpile: admitted.** Explicit ESM is appropriate to the
   actual package. The frozen baseline JavaScript byte-parity guard passes
   before generating the successor RPC module; the manifest's exact new
   source, JS and map hashes independently match. The NodeNext synthetic-file
   CommonJS mismatch and subsequent stale-output RED remain retained. This
   is neither a semantic typecheck nor a full build/artifact qualification.
2. **Task-local SDK class identity: admitted.** Changing only the local
   `@keel/sdk` resolution to the separately loaded frozen SDK reproduces
   **16 PASS / 1 FAIL** in the unchanged17-case SDK RPC file (same MCP mapper
   diagnostic failure as author95/1). Restoring the own-checkout alias yields
   **17 PASS**, before and after; assertions, reference inputs and source are
   unchanged. Three raw logs are retained.
3. Initial reviewer combined run **200 PASS / 2 setup failures** is retained.
   Sparse checkout omitted a tracked script and package-local dependency links
   omitted `@noble/hashes`. Materializing those exact existing dependencies
   and the tracked script fixes setup; the fresh full affected cohort is299.
   No production or test assertion changed.
4. Prior canonical temporary-path loader fixture correction remains admitted
   by independent review `87e762c3e46379d8954f5517f8e7adc5e84ed1be`; fresh10
   controls pass here. No additional loader fixture correction was made.

All copied compiled outputs are inventoried, including their exact author
source location. No full SDK build, full suite, semantic typecheck, final
artifact, native execution, private provider integration, live publication,
historical artwork rendering or release activation is approved by this review.
The supplied source remains **BLOCKED** on PRIVATE-DENIAL-CANCEL-1 and IPC
qualification remains explicitly external to these local mock passes.
