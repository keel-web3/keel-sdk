# Independent runtime findings: implementer correction

Source: `e0e6033a93099e312c5c2c6d0f6f22adc7097f40`, based on the retained
`606479d` runtime/evidence branch. Independent review evidence is Site
`ece35e3d5d642174cfbfcc509fdfe42d554e40f9`. This receipt records implementer
correction tests; it does not confer independent approval or close live gates.

The reviewer reproduced three failed invariants: both transports ignored an
80,086-byte HTTP 503 JSON-RPC revert body after their 64 KiB sample limit, then
dispatched to another provider returning success; the viewer also cached two
different state overrides as the same pinned execution. No reviewer source or
assertion was edited.

The fix requires complete classification of a non-success HTTP body within the
unchanged 65,536-byte diagnostic cap and deadline. Oversized/incomplete bodies,
invalid UTF-8, malformed JSON-like or JSON-media bodies, and unknown structured
RPC failures stop without retry/fallback. The terminal cause is explicitly
unclassified when full parsing is impossible, rather than claiming a decoded
revert. Complete bounded plain-text HTTP failures without execution/denial
markers retain transport fallback. Recognized correlated rate-limit envelopes
retain bounded same-endpoint retry. Request body/response limits, physical
leases, timeout durations, and existing assertions remain unchanged.

The viewer now snapshots the entire JSON parameter list before asynchronous
qualification or queueing. Both in-flight deduplication and completed-cache keys
include all normalized execution arguments, including state and block override
parameters. Distinct operations dispatch separately; identical pinned operations
still share transport responses at the same qualified pin. Caller mutation cannot alter either
the key or physical operation after invocation.

| Evidence | Exact input / expected result | Result |
| --- | --- | --- |
| `baseline-606-red.log` | First nine added acceptance cases against unchanged `606479d`: both transports' large/malformed/incomplete HTTP bodies and viewer argument/snapshot identity | 18 existing PASS, 9 new FAIL; retained unchanged |
| `acceptance.json` | Reviewer's same 80,086-byte revert in both clients; same pin/tx with distinct overrides | Each error: one execution, zero alternate recipients, terminal fail-closed. Overrides: distinct `0x6001`/`0x6002`, two physical calls; input snapshot verified |
| `original-bug-auditor.log` | Unchanged independent script asserts the *old faulty observation* | Expected exit 1 at its first `returned === 0x6000` assertion because no success is returned; not misrepresented as a complete acceptance run |
| `focused.log` | Exact `e0e6033`; new cases plus unchanged loader, fallback, identity, compiler, policy, preflight, journal and integrity assertions | 230 PASS, zero failures/skips |
| `full.log` | Exact `e0e6033`, official Node 22.22.1/zlib 1.3.1-e00f703, qualified own ffmpeg and recorded sibling repositories | 2,460 PASS, zero failures, six explicit optional skips (2,466 total) |
| `anvil.json` / `.log` | Exact `e0e6033` real local EVM valid 2,050,429-byte URI and identical read fields under standard/explicit policy | PASS; 4,101,030-byte HTTP response; disclosed synthetic `anvil_setCode`, zero signing/broadcasts |
| `artifacts.json` | Frozen `3d382e9` versus `e0e6033`, same synthetic loader configuration | Ordinary/URI81 fragments and published reader unchanged; newly embedded Hybrid bridge/loader fingerprints change |

The tests cover 65,535-, 65,536- and 65,537-byte error-body boundaries; 80,086-byte
valid revert JSON; stalled error streams with four physical slots; malformed
JSON media; unknown custom RPC errors; invalid UTF-8; recognized rate limiting;
concurrent distinct overrides; fourth-argument block overrides; completed cache
reuse; and mutation immediately after invocation. No new test files or manifest
classification changes were needed. No existing assertion or fixture changed.

Reproduce with the same dependencies as the previous receipt:

```sh
export PATH=/Users/ravonus/.nvm/versions/node/v22.22.1/bin:/Users/ravonus/.foundry/bin:/opt/homebrew/bin:$PATH
pnpm test
node --test tests/governed-rpc-boundaries.test.mjs tests/hybrid-runtime-boundaries.test.mjs tests/managed-shell-rpc-chain.test.mjs tests/keel-rpc-policy.test.mjs
node docs/reviews/studio-publication-20261019/runtime-corrections/acceptance-audit.mjs "$PWD" /tmp/NEW-UNUSED-acceptance.json
KEEL_NONSTANDARD_RECEIPT=/tmp/NEW-UNUSED-anvil.json node --test tests/nonstandard-read-anvil.test.mjs
```

These are in-memory transport adversaries and an explicitly synthetic local EVM
read, not original-publication execution or browser/deployment proof. Installing
this SDK does not mutate any already published loader or reader. Newly prepared
Hybrid metadata must measure and bind the new bridge bytes. Independent review,
integrated QA, original corrected-plan capacity, Studio, deployment and historical
authenticated browser gates remain separate and pending.
