# Qualification history

Earlier outcomes are superseded by the qualified normal build and 180/180 final
regressions, not omitted as successful checks:

1. First local TypeScript invocation failed on the new readonly enum-array type
   and missing sparse package-local dependency aliases. The enum type was fixed;
   new untracked local links reused the existing installed package dependencies.
   No install or frozen-worktree alias change occurred.
2. Initial capacity/pool qualification passed 61/61.
3. The expanded first regression ran 169 tests: 168 passed, one failed. The actual
   RPC sanitizer discarded request-budget need/remaining evidence, blocking full
   approved fallback. The typed RPC boundary now preserves bounded numeric fields
   and scope without retaining arbitrary provider text. A real positive fixture
   regression checks unchanged whole-program fallback.
4. The next regression ran 179 tests: 178 passed, one failed. Its privacy assertion
   incorrectly rejected the supported transport enum `https`. The assertion now
   forbids a URL scheme plus delimiter and private text, while retaining permitted
   fixed enums; no endpoint exemption or evidence weakening was added.
5. Source review added the specific client-limit-code guard. Typed request capacity
   can recover `-38026`; arbitrary client errors and `-38011`/`-38013` still stop.
   Both positive and terminal actual RPC-boundary fixtures were added before final
   emit and qualification.
6. Final normal package build exited 0. Final seven-file regression exited 0 with
   180/180 passing and no skips/cancellations. Built local SDK ESM startup passed.

Capacity-profile facts and observed capacity-cache entries now expire within
five minutes. Later returned envelope remainders are never cached as permanent
per-transaction limits. Current Geth primary source describes request-wide used
gas budgeting and defines `-38026` as a general client-limit code; neither source
nor these fixtures reveals the unavailable fresh release's actual error code.
