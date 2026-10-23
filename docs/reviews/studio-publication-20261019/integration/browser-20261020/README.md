# Browser failure diagnosis and UNAPPLIED fixture proposals

> **Independent review rejected the original75902 proposal.** Its helper stopped
> observing on readiness and missed a250ms runtime error. Original proposal and
> author logs remain unchanged as rejected evidence. See `v2/README.md` and
> `browser-fixtures.v2.proposed.patch` for the separate replacement under review.

Source baseline: SDK `e4985920593539f468c16524e2f74d2adf2878c3`.
This checkpoint changes **no production source, generated shell, registered profile,
immutable reader asset, artifact reference, runtime limit, or credential**.
The four existing browser test files remain byte-identical to baseline. Their
proposed corrections are **unapplied** in `browser-fixtures.proposed.patch` and
require independent review. Author-only draft execution is not QA approval.

The QA Linux baseline was SDK f1460ba4 / Site6b8b3475, 10files/25cases,
14PASS/11FAIL. The four browser files and two relevant SDK production files have
zero Git diff from f1460ba4 to e4985920. Exact QA evidence is retained by QA at
`docs/reviews/studio-publication-20261019/qa/final-f146-6b8/remote/` in its Site
checkout, including the original 1,885,832-byte log SHA
`3ba9aeaeaeb4f562795f07177c9f5142b51e7f9e4ac3079f4cdfb51d03270159`.

| Original failure | Cause established | Proposed correction / current result |
|---|---|---|
| Tone compact-shell sandbox equality | Current shell and maintained protection test require `allow-downloads`; expected string omitted it. No same-origin or autoplay delegation exists. | Update exact string; retain click-only start, ticking, storage denial, no runtime errors. Draft PASS. |
| LinkEnumProbe missing | QA lacked real compiled fixture. Six genuine Solc0.8.36/viaIR50/Prague artifacts copied from source49d. | Original enum/ABI subtest now PASS. NEW setup blocker below, browser assertions not reached. |
| Protected shell flat HTTP regex | Literal namespace/JS strings occur in serialized HTML; regex is not a request observer. | Keep opaque sandbox/anti-tamper/UI assertions; replace HTTP-substring claim with existing deny-proxy/CDP/netlog observer asserting zero requests, opaque1frame, zero errors. Draft PASS. |
| Prepared Base64 and percent legacy cases (2) | Graph explicitly acknowledged historical carriage but final builder defaults to fresh collector-inline, correctly rejecting both. | Assert that default rejection, then select explicit `raw-artifact` policy for historical browser decoding. All original URI/context/browser checks retained. No fresh-lane bypass. Both draft PASS. |
| Changed-artwork substitution | Current uncompressed UTF8 slot is escaped `storedText`, so old storedBase64 literal never matched. | Change exactly one storedText payload, preserve same length/all original SHA commitments; changed art gets no frame, restoration succeeds at sameURL. Draft PASS. |
| Large32module and nested alias cases (2) | Verification owner is HTML `data-vault-verification`, and title is `Files verified`. Old body marker/title obsolete. | Match actual owner/title; preserve32module execution/import/alias checks and frame checks. Both draft PASS. |
| srcdoc CSP proof message absent | Virtual time DOM dump can finish before async gzip/iframe completion. RealCDP at unchanged4000ms receives actual art message and both opaque frames. Host also deliberately denies embedded fonts via default-src none. | Same4000ms real readiness deadline; preserve exact restrictive hostCSP. Ignore ONLY exact blocked data:font/woff2/default-src reports, retain raw events, fail all other CSP/runtime errors. Add opaque-origin proof and actual1x1 image decode for asset case. Draft4CSP cases PASS. |
| p5 and Three CSP cases (2) | Fixture module IDs differ from actual creative-catalog IDs, so exact pinned-library exemption correctly does not apply. | Use exact resource IDs and assert full pinnedSHA/length; apply catalog's prescribed Three local-import transform. Preserve actual Vector3/p5 execution and restrictiveCSP; no locator-policy change. Both draft PASS. |

## New Link setup blocker

`link-genuine-original.log` is the unchanged test against actual source49d
compiler artifacts. The same fixture `put(suffix)` exhausts its hardcoded
100,000,000gas. `link-genuine-gas-estimate.log` repeats that exact failure and
records local eth_estimateGas: prefix15108B=10,810,508; suffix143728B=102,133,263.
Fixture `LinkAssemblyStore` stores complete bytes through SSTORE; this is not
normal Hold publication economics. No allowance was raised, no artifact was
fabricated, no production limit changed. Expected old Link title/sandbox
assertions are only static observations until the setup prerequisite is resolved.

## Reproduction

Official local Node22.22.1; actual macOS headless Chromium1234, SHA in receipt.
Every browser uses a fresh synthetic temporary profile, no user/auth profile.
`csp-cdp-baseline.json` and `diagnose-csp.mjs` retain unchanged-production actual
contexts, denied-font events and received message. Original Mac RED plus first
draft tamper RED are retained, as are all later author runs.

```sh
/opt/homebrew/opt/node@22/bin/node --test tests/sdk-browser-fixture-identity.test.mjs
KEEL_CHROME_HEADLESS_SHELL=/Users/ravonus/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell \
/opt/homebrew/opt/node@22/bin/node --test --test-concurrency=1 \
/tmp/keel-browser-integration-20261020/proposal/tests/keel-audio-browser.test.mjs \
/tmp/keel-browser-integration-20261020/proposal/tests/sdk-verification-shell-browser.test.mjs \
/tmp/keel-browser-integration-20261020/proposal/tests/sdk-verification-shell-large-graph-browser.test.mjs \
/tmp/keel-browser-integration-20261020/proposal/tests/sdk-verification-shell-marketplace-csp.test.mjs
```

New maintained identity regressions:4PASS. They use exact actual pinned p5/Three
bytes, reject modified/remote-appended or wrong-ID resources, and retain ordinary
creator remote-executable rejection and legitimate SVG syntax. Root owns the
one-line explicit deterministic test classification patch, supplied separately.

UNAPPLIED fourfile+helper browser draft:13PASS/0FAIL (author macOS only).
Linux replay, independent exact correction approval, Link setup resolution,
full successor tests, deployed browser and live acceptance remain outstanding.
