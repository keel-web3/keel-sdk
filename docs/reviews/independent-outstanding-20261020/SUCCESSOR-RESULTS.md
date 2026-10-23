# Independent successor validation

Test pair: Contracts `8e8e32df58b2a641a71ec7d449b4a407f1c002fb`, SDK `f1460ba4fc5eb675fc43a87354acc1bd42f06c29`. The earlier `86b`/`ef363` failures and incomplete process outcomes remain in the original evidence. No test, fixture, tolerance or reference was changed during the independent checks.

Environment: official Node 22.22.1, Foundry 1.7.1, solc 0.8.36+8a079791, Prague, viaIR, optimizer 50. Each heavy launch checked Mac load below40. The paused original process outcomes were not relabeled successes. Completed remote SmartPy92/92 and eight actual pinned Octez typechecks remain explicitly tied to86b, whose implementation sources are byte-identical8e8. The earlier full entrypoint Octez replay is INCOMPLETE; its one owned network-none orphan was authenticated by matching public compiled bytes and removed without reading credentials or touching other containers.

| Fresh check | Actual result | Raw evidence |
|---|---|---|
| `python3 script/module-scope-audit.py --check` | PASS381sources/47edges/0issues | `successor-pair-8e8-f146/contracts-structure.log` |
| Python unittest discovery | PASS20 | `successor-pair-8e8-f146/contracts-python.log` |
| Static/package/catalog/parity controls | PASS21/0skip | `successor-pair-8e8-f146/contracts-static-catalog.log` |
| SDK Tezos/capability focused tests with required sibling | PASS147/0skip | `successor-pair-8e8-f146/sdk-native-focused.log` |
| SDK build | PASS | `successor-pair-8e8-f146/sdk-build.log` |
| Sibling module catalog | FAIL15pass/1fail: native-media deployable lacks recorded ABI | `successor-pair-8e8-f146/contracts-sdk-ABI-missing-RED.log` |
| `forge test -j4 -vvv` | FAIL2641pass/5fail/1skip,299suites,797.91s | `successor-pair-8e8-f146/contracts-forge-RED.log` and finalJSON |

The full Forge run started at8e8; only the separately authorized generated ABI addition was committed while it ran, so terminal receipt HEAD is3ce. All Solidity, test, compiler and dependency inputs were byte-identical throughout. The only skip is `SharedPreparedSepoliaForkTest.testLogicalCreatorBindsRegisteredSourcesAndSharedUriMatchesExactCopy`, which explicitly skips outside chain11155111; no live fork was supplied. The five failures were holder-edit/freezing scenarios with no creator opt-in after the integrated permission default became false.

## Scoped ABI repair

After reporting the independent failure, the lead assigned this specialist only the generated ABI repair. Contracts `3ce5312daecb21b62bdebae681a9e16715fcbb97` records the genuine compiled `KeelNativeMediaPresentation` ABI; SDK `e4985920593539f468c16524e2f74d2adf2878c3` adds it to the generated module and ABI index. All64 prior ABI objects, module metadata and deployment records are unchanged (`native-media-abi-repair/scope.json`). This author is therefore not the independent approver of that repair.

Fresh build and unchanged sibling catalog16/16 pass. `pnpm test:catalog:local` passes all fixture/structure/Python/20Node checks. `pnpm size:check` passes. Gas policy passes1385entrypoints; all112 gas behaviors pass, but exact snapshot checking fails two lower measurements: maximum40244→40233 and zero33418→33403. Unchanged repeat reproduces both exact new values. The matrix/test/compiler files are unchanged1c→8e8; the reference originated before the maintained compact-table merge. The exact two-line proposal remains **UNAPPLIED**, pending independent approval; no tolerance was widened. Logs are in `native-media-abi-repair/`.

The native artifact profile authenticates67 metadata source hashes against86b/8e8. It is compiled-template evidence only: linked bytecode, constructor immutables, current chain state, gas and unsigned deployment readiness remain separate gates. New factory initcode is34121bytes rather than the earlier4015proposal's34119; that old proposal cannot be reused as a qualified new transaction.

## Independently approved holder fixture correction

The independently approved exact patch SHA5118452669677fc560f1542fc503a7516f6658fdd687d5d5653fdc85bb810631 became Contracts `e9f202a5030b75ad7032800f210b622193166d1b`. It adds creator-only `setTokenOwnerCanEdit(true)` to the five scenarios that intentionally exercise holder edits/freeze and adds a native default-false URI/image/freeze refusal test. It changes no prior assertions, production source, assets or permissions. All seven native artifact files remain byte-identical after recompiling the three test files.

Fresh affected5+newnegative: **6PASS/0FAIL/0SKIP**, durable exit0 (`native-holder-correction/`). The original full-suite RED is retained. A fresh final full Forge run is still required; this focused result is not a substitute.

## QA prerequisites delivered

The seven previously delivered production artifacts were independently verified by QA against all146 source commitments. The Linux ffmpeg-static5.3.0 prerequisite was independently checked by QA; its package-selected release tag isb6.1.1 but actual official executable banner is7.0.2-static. The initial diagnostic banner assumption RED is retained under `ffmpeg-linux/`; no version/reference was changed to manufacture a test pass.

The additional link browser closure contains every one of the six actual deployment artifacts called by `tests/link-assembly-browser.test.mjs`, including `LinkEnumProbe`, three fixture contracts and the genuine registry/builder. All19 metadata sources were independently authenticated against86b/8e8 and the QA clean tree before copying. Existing different files are never overwritten and QA SDK source/dependencies/dist were not changed. Browser success is not claimed by artifact delivery. See `link-browser-closure/`.

No production change, transaction, signature, paid RPC call or deployment occurred in this validation wave.
