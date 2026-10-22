# Native display budget guard — author source candidate

Frozen source `fefd8fc91c7e286143a8857edfbb5cdddafbcb56`, parent test-only closureb3f60c2980a613559da577063a741b3639245adc; runtime parent9f5bf42309efae5ee933850c9afab618cf29121b. ONE production leaf changes: media-preparation.ts, SIX added lines. No cap increase, quality/tolerance/decoder/fidelity changes, Site edit, provider access, production activation or wallet action.

The existing movie preflight used coded raster dimensions. Native SAR previews can expand the displayed raster, so a source within the coded pixel budget could start over-budget scaled decoding and only be rejected afterward. The guard now compares the complete qualified sample count and displayed dimensions, with exact BigInt arithmetic, against the same1800-frame and2,000,000,000 decoded-pixel caps BEFORE scaled full-frame decoding. Existing input/coded checks and post-decode correspondence checks remain.

## Exact safe reproduction and fixture correction status

The first independent fixture8838B/SHAad64e44832758bb5abef4db4a4025cb3a5cc44b814072b57d5d32d9b0c963b9b actually has SAR100:1 (setsar's default max), displayed3200×1024×300=983,040,000 pixels, BELOW2B. Its test diagnostic incorrectly claimed8192×1024. The unchanged0P1F raw report, exact original input and scale3200 receipt are retained; the reviewer confirmed and retracted that exact over-budget claim. It is not a valid expected budget rejection.

The proposed SETUP_ONLY correction adds `:max=1000` to the same setsar argument, changing no expected assertion or interception hook. Exact patch SHA905944cf3edb8f9e118c68fc338fe54305d8aa51a233bd1ff1fe9fdd5c2f839f. Corrected test SHAc18051c068e2a8b3276f6c9014f5a50f1ba18c4b74bb35ec436620d6022bb40e. Corrected8838B input SHA6b2509573d9cd6ba31ae2cfba98e32632132f0b0d80f34917eb2912d59d94aa6 actually has SAR256:1 and displays8192×1024×300=2,516,582,400 pixels. Full CODED32×1024 decode shows all300 RGBA frame hashes and timestamps identical between original/corrected setup, without scaling (setup-coded-equality.json and raw hashes).

Independent TEST_SETUP_ONLY admission of that correction is PENDING at freeze. Original and corrected references/REDS remain separate; the corrected result below is provisional author evidence only.

Against unchanged9f5 built outputs, corrected setup0P1F safely intercepted the attempted scale8192 full-framehash (author-corrected-fixture-before.stdout/corrected-before-launches.json). Against this rebuilt successor, it1P0F and the launch receipt contains ONLY the real zero-duration probe, heavy=false (author-corrected-fixture-after.stdout/corrected-after-launches.json). No oversized raster was rendered before or after the fix.

## Fresh affected checks

- SDK/MCP113 PASS /0 FAIL (full-sdk.stdout), same exact prior affected command in prior-affected-commands.json; historical reviewer input closure copied byte-identically from the frozen9f5 evidence.
- Actual installed Chromium8 PASS /0 FAIL (browser.stdout/browser-results), existing canonical carrier/native checks; no external requests or captured console failures.
- Builder compile and noEmit exit0 (builder-build.stdout, builder-tsc.stdout). Own output rebuilt from this successor. No fresh Site build/test claim in this guard-only wave.

Copy the retained corrected reviewer script to the SDK root and run Node22 --test --test-concurrency=1 reviewer-native-display-budget-corrected.test.mjs for the direct safe negative; it generates only a tiny coded fixture, forwards actual probes and refuses any scaled full-frame launch. Test setup admission and independent source review remain OPEN. Frozen prior9f5/b3 trees are unchanged. No other work starts after this freeze.
