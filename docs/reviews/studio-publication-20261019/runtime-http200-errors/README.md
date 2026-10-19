# HTTP 200 RPC errors: correction pending independent review

Production source freeze: `f159f32cf73b8ca144972d4cb11f109a522fcbe8`, atop
`eddda7a0bca53f7435ca9e48c532471f09084a90`. Independent baseline evidence is
Site `7ea6593a5e447ae30c590996d0420b103fc3da7f` (`independent-e0-red.json`).
No original private publication program or public RPC endpoint was invoked.

All non-null JSON-RPC error envelopes now receive the same fail-closed treatment
regardless of HTTP status. `-32000` / `VM Exception while processing transaction:
revert CustomError()` stops after one execution request. Unknown opaque errors
also stop; a failed semantic recognizer no longer authorizes fallback. Explicit
bounded, flat, correlated `-32005`/`429` capacity errors may retry the same exact
operation under existing bounds. Revert/access-denial recognition takes priority;
data/cause objects, contradictory messages, unknown fields and oversized
messages cannot use that exception. Physical transport timeouts retain existing
deadline and physical-slot rules.

The separate `f159f32` change preserves only pre-execution unsupported-selector
compatibility: a flat correlated `-32602` with no data/cause/unknown keys, applied
to an actual `eth_call`/`eth_getCode` canonical hash selector with
`requireCanonical: true`. The selector and execution fields remain unchanged
across recipients. Chain-ID, unpinned, mixed-selector and augmented-error cases
fail closed. Protocol selector qualification snapshots serialized JSON fields,
so inherited or mutated caller properties cannot qualify a different wire call.

`source-build.log` is the fresh successful full build. `boundary-tests.log`
contains 51 PASS, zero failures/skips, including all prior boundary cases and
new custom/opaque HTTP200 errors, denial priority, contradictory capacity errors,
bounded capacity retry, scoped EIP-1898 behavior and negative cases.
`legacy-tests.log` preserves 19 PASS and ONE FAIL: an older generic fallback
fixture uses unclassified `-32000` with opaque provider text. The legitimate
EIP-1898 tests pass unchanged.

`proposed-fixture-correction.patch` is UNAPPLIED and requires independent
approval: it changes only that fallback fixture's error code from `-32000` to
the recognized capacity code `-32005`. All messages, redaction assertions,
endpoint/count assertions, and other fixtures remain byte-identical. New
explicit unknown/custom-error negatives ensure the removed unsafe expectation
is independently covered. Do not report the ordinary full gate green until
this correction is reviewed and the exact corrected tree is tested.

The ordinary full suite was launched against the frozen production source and
unchanged legacy fixture. Root receives its session ID and log path separately;
the result is pending in this checkpoint and expected to retain the documented
fixture failure. Tests use official NVM Node 22.22.1 / zlib 1.3.1-e00f703 and the
same qualified dependencies and sibling paths as the prior evidence.

```sh
export PATH=/Users/ravonus/.nvm/versions/node/v22.22.1/bin:/Users/ravonus/.foundry/bin:/opt/homebrew/bin:$PATH
pnpm build
node --test tests/governed-rpc-boundaries.test.mjs tests/hybrid-runtime-boundaries.test.mjs
node --test tests/managed-shell-rpc-chain.test.mjs
pnpm test
```

Fresh `prior-acceptance.json` retains the earlier large-error/cache counterexample
corrections. `artifacts.json` records exact new bridge/metadata hashes while
ordinary/URI81 fragments and the immutable published-reader asset stay identical.
`anvil.json` is an explicitly synthetic local EVM 2M+ read, not a deployment,
browser, original-project or production-capacity claim. New Hybrid bridge bytes
require new plan measurement/fingerprints; old published assets are unchanged.
