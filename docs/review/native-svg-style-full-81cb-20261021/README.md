# Exact81cb initial complete qualification

Source `81cb23c57a5f426324acd0961ae21476de9cd861` has independent **scoped source
approval**, receipt SHA256 aa976e8bb530bc6a4ee764415a2b3b7deb143d4cc77ad1e55542a50763415b79.
The checkout HEAD7ab is documentation-only above that exact source. No source,
assertion, reference, classification or skip was changed for these results.

* Fresh normal clean build: PASS.
* Entire maintained SDK suite: **2713 PASS, 0 FAIL, 0 cancelled, 85 skips**,
  125.588 seconds. The exact original b0 environment had87 skips; two existing
  local-Anvil read tests now execute because Anvil is on PATH. No new skips.
* Entire explicitly classified SDK browser gate: **55 PASS, 6 FAIL, 0 skips**,
  81.485 seconds. This gate is **FAIL**.
* All22 current SVG/audio/raster/complete-model browser cases within that full
  run PASS; their exact names are listed in `initial-results.json`.
* Fresh nonincremental SDK TypeScript: exit0.

Five browser failures are obsolete positive tests that ask already-retired
Dense/preEncoded/escaped builders to succeed. Running the exact same cases
against frozen originalb0 independently of this source reproduces **0 PASS /
5 FAIL**; raw retained. The source retirement guards were not restored and no
old assertions were changed. A precise test correction requires independent
review before it is applied.

The sixth failure is missing sibling contracts output in this isolated SDK.
Read-only provenance of the existing main contracts artifacts is recorded:
all six required artifacts' complete metadata source closures match actual
source-file keccak256; compiler0.8.36+8a079791 and SDK builder ABI match. The main
contracts checkout HEADace3fed7 is dirty; artifacts have not been blindly copied
or compiled. An isolated environment-only rerun must verify before/after hashes.
The initial failure remains preserved regardless of any later result.

Use intended NVM Node22.22.1, binary SHA256
245e0321af97d3c21dd4e7104457334dfe3c3ba7982d0db75363e354565f8cbb,
zlib1.3.1-e00f703, and installed Chromium headless shell1234. Pre-heavy uptime
was4.62 (clean build) and7.01 (browser), both below40. The exact existing app
and package dependency aliases are recorded in `pre.json`; no new installation.

Commands:

```
export PATH=/Users/ravonus/.nvm/versions/node/v22.22.1/bin:/opt/homebrew/bin:$PATH
node scripts/test.mjs
# After the clean build, run all BROWSER_TEST_FILES without another concurrent build:
KEEL_CHROME_HEADLESS_SHELL=<installed-binary> node --test --test-concurrency=1 <all BROWSER_TEST_FILES>
node node_modules/typescript/bin/tsc -p packages/sdk/tsconfig.json --incremental false
node --test --test-name-pattern='actual full legacy metadata return|changed dense compressed bytes|marketplace-safe prepared animation|compact escaped animation' tests/sdk-legacy-prepared-dense-browser.test.mjs tests/sdk-verification-shell-browser.test.mjs
# Last command run in frozen b0 for the original baseline.
```

The complete class list is the first line of `full-browser.stdout.log` and is
unchanged in `scripts/test-suites.mjs`. Exact source/runtime/review evidence,
complete raw outputs, artifact provenance and normal-build dist inventory are
committed here. These author checks do not establish actual Studio integration,
selected-chain registration, native-chain simulation, signing or deployment.
