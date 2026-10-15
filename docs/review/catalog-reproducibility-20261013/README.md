# Catalog reproducibility repair

SDK master `1f1d2ca65a0165113dcaf4766a14a9eef57ffb77` generates URI81 runtime descriptors by default, while maintained keel-modules `a3a5318736a44887c333b3f4f1b95c7c27b4ff83` explicitly retains Base64 for approved Studio consumers. Its existing reproduction tests request `--runtime-encoding base64`, but the SDK ignored that option and CI omitted it. Regeneration changed all 14 runtime descriptors; every other catalog field was identical.

The repair adds explicit `uri81`/`base64` selection to the builder API and CLI, rejects invalid or missing values, and makes module CI request the approved legacy format. The exact `git diff --exit-code` check remains. No catalog rewrite, fixture replacement, URI81 default change, Brotli change, deployment or contract change is involved.

## Verification

- SDK build passes under official Node 22.22.1 and pinned pnpm 10.15.0.
- All 14 modules reproduce; all 81 vectors pass on readable and minified bytes.
- Two approved-format reindexes produce the original catalog byte for byte. The default URI81 catalog is also byte-identical to unchanged master.
- The new regression fails on unchanged master and passes with the repair. It checks exact decoded bytes, unchanged source/receipt/deployment fields, default and explicit URI81 equality, Base64 API/CLI consistency, invalid selection rejection, and refusal of tampered outputs.
- Eleven runtime and origin-registration checks pass. Actual registered-origin verification exits successfully with **zero registrations**; it makes no claim about unregistered foreign repositories.
- All six public-workspace reproduction checks pass across the local run and network resume. The initial two archive checks skipped on DNS EAI_AGAIN; the same unchanged checks pass using Node's supported `--use-env-proxy` setting with certificate validation enabled.
- All 94 module-repository files and all 24 tracked SDK fixture files remain exact. Hash comparison of 7,556 existing SDK files identifies only the four intended workflow/source/test changes.

## Full-suite result and bounds

Unchanged master: **1,659 passed, 1 failed, 70 optional sibling skips / 1,730 tests**. Repair: **1,660 passed, 1 failed, the same 70 skips / 1,731 tests**. Every prior test name remains; the only added case is the passing regression. The normalized failure is identical except for duration, test number and checkout path: `motion preview preserves two distinct frames in a real AVIF sequence`, with 16 decoded bytes versus 32 expected in `tests/thumbnail-sequence.test.mjs`.

The earlier integration report separately records three macOS animated-AVIF/media failures and a private fun-art policy-conformance failure. Their implementation and existing assertions are unchanged. This Linux/public-checkout result does not certify those private/platform checks or claim they are fixed. The full suite is **not green**.

[Machine-readable summary and timestamped receipts](summary.json), [full-suite inventory/failure comparison](full-suite-comparison.json), and compressed original logs preserve these results. The full repair suite uses the repository's unchanged default test list, classification validation and concurrency 2 after the successful complete SDK build.
