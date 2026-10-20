# Exact browser URI transport correction, independent review pending

SDK base64e5fa37667ac424ae87019c7609581dfc2ea364. Scope is5test/helper files
only. No production code, immutable reader/profile, artwork/source, test assertion,
URI, decoder, gas/read cap or test timeout changes. The root release candidate is
not modified; `transport.proposed.patch` must receive independent approval first.
Root owns the separate one-line browser test classification addition.

QA baseline actual Linux47tests:38PASS/9FAIL/0SKIP. All9 failures were `spawn
E2BIG` before browser startup: Linux limits each process argument to128KiB even
when total ARG_MAX is larger. Original raw20378B log SHA
6b5601e72900a265a42e4c5c824dfbd99be895f19e583c58eff790204a1d040f is preserved.

The same browser starts on `about:blank` using the already reviewed bounded CDP
launcher/cleanup. `Page.navigate` receives the **exact unchanged original string**
via WebSocket, so no per-argument ceiling applies. No temporary file or HTTP
replacement changes the data URL's opaque origin, CORS, source or network behavior.
Actual top-frame navigated URL must equal the original data URI byte-for-byte.
Compact SHA/UTF8-size receipts are recorded separately from content.

The launcher has three closed fixture modes. The existing default's args are
unchanged. DOM dumps retain their original headless policy; Link adds only its
original two loopback TLS/private-network flags. CORS remains enabled and its
negative case still passes. Both existing virtual budgets remain2500/5000ms.
The helper waits for the navigated document load, then uses actual CDP virtual
clock advancement and captures DOM on budget expiry. It retains the original
20s Link wall bound; the CSP observer's4000ms window is untouched.

Two early author ordering mistakes are retained as RED: applying a virtual budget
on the blank document expired before HTML existed; pausing virtual time before
navigation blocked document-load progress. Neither changed a production limit or
asset. The final ordering is exercised by exact unchanged large URI controls,
opaque-origin assertions and before/after virtual-budget timers.

New actual Linux controls use Unicode source and a data URI above131072UTF8bytes.
They first reproduce argvE2BIG with that exact URI, then navigate it successfully
through CDP and assert original/observed SHA+length equality, unchanged text,
opaque origin, and exact original2500/5000ms budget with a later timer unrun.

Owner affected Linux run:18PASS/0FAIL/0SKIP in15.45s, official Node22.22.1,
qualified Chromium1234. Existing actual compiled Link enum/deploymentABI, original
and same-length tamper/restoration, Keccak mismatch, gzip/deflate and overrun,
redirect/CORS/oversize failures, locator-text escaping, native image, unsupported
codec/type, IPNS and bare immutable locator cases all pass. Existing Studio
shell/context/escapedURI/tamper tests also pass. Exact27Link+51SDK assert calls
have identical source AST strings and hashes before/after.

Source/dependencies are isolated under `/root/keel-browser-cdp-20261020/keel-sdk`.
QA's frozen64e source/dist and6genuine compiled Link artifacts were read-only
prerequisites; their exact identities/hashes are in environment.json. All browser
work ran on WSL because the shared Mac load exceeded40. No production access,
private program, user wallet, chain payment or signing occurred; Link uses documented
disposable Anvil accounts only.

```sh
PATH=/root/keel-validation-tools-20261020/node-v22.22.1-linux-x64/bin:/root/keel-validation-tools-20261020/forge-v1.7.1:/usr/bin:/bin \
KEEL_CHROME_HEADLESS_SHELL=/root/keel-browser-cdp-20261020/chromium-fixture-launcher.sh \
KEEL_CONTRACTS_ROOT=/root/keel-qa-release-final-20261020/keel-contracts \
KEEL_BROWSER_NAVIGATION_EVIDENCE=/root/keel-browser-cdp-20261020/navigation-affected.jsonl \
node --test --test-concurrency=1 tests/sdk-browser-cdp-navigation.test.mjs \
tests/sdk-verification-shell-browser.test.mjs tests/link-assembly-browser.test.mjs
```

This is author evidence, not independent approval, a full successor suite result,
a deployed build, historical authenticated HTTP proof or real wallet-boundary proof.
