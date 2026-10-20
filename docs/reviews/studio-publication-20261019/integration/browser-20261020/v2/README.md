# Replacement browser observer proposal, independent review pending

Baseline remains SDK e4985920. No production files or existing tests are edited.
Original rejected proposal SHA75902... and original failure receipts remain
unchanged. The reviewer proved that early readiness at50ms hid a real250ms
runtime exception; later500ms readiness captured it. Both original controls and
RED evidence are retained here, including byte-identical reviewer test.

Replacement `browser-fixtures.v2.proposed.patch` keeps the original4000ms
observation window from navigation. It records actual readiness and continues
collecting exceptions/CSP reports through the entire window. It never exits early
on passed/failed. The restrictive host CSP and exact font-only expected denial
filter are unchanged from the earlier proposed correction. There is no registered
reader, production runtime, reference artifact, byte-limit or timeout increase.

The CDP helper now bounds startup10s, each command1s, connection1s, owned-child
exit2s and profile removal2s. It rejects pending commands on disconnect/error,
ignores late replies to expired commands, propagates malformed responses, catches
synchronous socket send failure, and makes disposal/cleanup idempotent. The child
exit promise is installed immediately after spawn; it is never registered only
after kill. Startup errors clean up the same owned child/profile. A process error
cannot masquerade as a confirmed process exit. Snapshot errors are no longer
silently ignored except actual destroyed-context diagnostics.

Cleanup requests bounded `Browser.close` before removing the profile, so Chrome
can shut down its renderer/cache writers. Failed protocol/exit/profile cleanup
remains an error; forced cleanup is bounded and never changes the execution
result into a pass. No profile-removal retries were added.

Fresh exact-helper author results:18PASS/0FAIL =12new controls +2unchanged
reviewer adversarial controls +4actual CSP cases. Controls include late errors
with early/later readiness, CDP timeout/late-reply correlation, disconnect,
malformed messages, synchronous send failure, pending disposal, nonexistent
executable, immediate exit, refused connection, actual10s startup timeout with
PID-gone proof, and actual Chrome cleanup with pending command/profile removal.

A full13 draft rerun also exposed an independent old audio-helper cleanup race:
Chrome was killed before its cache writer finished, `rm` raised ENOTEMPTY, and
its unclosed loopback server kept the test worker alive. The two RED cases,
full raw log and exact owned Node PIDs stopped are retained. No browser matching
those two synthetic profile paths remained during process inspection.

Separate `audio-cleanup.v2.proposed.patch` reuses the same bounded helper's
send/on/close interface instead of the old duplicate launch/CDP/kill/rm code.
It changes no score/source bytes or audio/click/storage/worker assertions and no
test timeouts. Both actual audio cases pass author testing with this proposal. A final serial
combined13case replay (all four proposed browser files, including separate audio
cleanup) also passes13/0 against this exact frozen helper.
Apply it only after the main v2 patch and independent approval.

`browser-controls-classification-add-only.patch` adds the12new control cases as
one explicit browser test file; root owns classification integration. The earlier
identity-test classification and Link fixture gas proposal were independently
approved separately; neither their approval nor this author run approves v2.

Run exact unchanged reviewer cases and maintained proposed controls directly:

```sh
KEEL_CHROME_HEADLESS_SHELL=/Users/ravonus/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell \
/opt/homebrew/opt/node@22/bin/node --test \
docs/reviews/studio-publication-20261019/integration/browser-20261020/v2/late-runtime-error.test.mjs \
docs/reviews/studio-publication-20261019/integration/browser-20261020/v2/marketplace-csp-observer-controls.test.mjs
```

Node22.22.1 / macOS Chromium1234 synthetic temporary profiles only. Exact hashes
are in receipt.json. Independent approval, supported Linux full browser replay,
Link downstream integration and deployed/live acceptance remain outstanding.
