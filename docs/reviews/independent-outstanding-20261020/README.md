Independent validation checkpoint, not release approval
=====================================================

The validator did not author the lead's SDK/contract integration or fixes. Both local test checkouts began clean, at Contracts86b1534b27ac7dce9ac7aaaf30318dab1808696c and SDKef363b6dbd34a95b5665b6d8bed4c687c9168fbe. Each received a fresh frozen pnpm install --offline --ignore-scripts. SDK dist was independently rebuilt with official Node22.22.1, then frozen; the adjacent manifest records its actual1754 files and digestaa9ae7…. No implementation, assertion, fixture or gas-baseline change was authored here.

Completed findings
------------------

* SDK fresh build PASS. Native/Tezos/capability focused tests146PASS/0FAIL/1initial skip. A real independent8-target SmartPy compilation then enabled the exact skipped storage case: explicit conformance rerun2PASS/0FAIL/0SKIP. This proves the SDK builders equal actual compiled initial storage; it is not public origination proof.
* All8 route scripts passed the pinned arm64 Octez25 network-disabled mockup typechecker. Actual source/output hashes are in octez-eight-route-typechecks.json. No image was pulled. The full native/Octez suite is not covered by that8-script result.
* Frozen codec fixture byte checks PASS; Python structure/mockup controls20PASS.
* Mandatory structure gate FAILS with6 issues: keel-die manifest omits3 native-media source declarations; generated source indexes in artifacts/die/stake are stale. Sibling SDK catalog15PASS/1FAIL additionally locates the corresponding ownership and creator-identity test-dependency omissions in SDK tools/keel/module-map.mjs. The contract manifest itself already lists that test dependency; the static SDK map was stale.
* Package-boundary test FAILS because13 incoming parity JSON fixtures are not in its pinned package classification. No classification/test edit was made. The manager-ABI static case was launched before the cold Forge compile produced out/KeelManager.sol/KeelManager.json; this is an invocation-order setup failure, not an ABI drift finding. It must be rerun after compilation.

The lead has prepared metadata/static-map successors (Contracts8e8, SDKf146); those are NOT independently tested by this checkpoint and no old result is relabeled. Root will resume this validator after the background jobs exit for exact successor/affected reruns. Full local, gas, size, full native protocol, final SDK/Site and live acceptance remain open.

Exact reproduction and retained jobs
-----------------------------------

Local pair: /Users/ravonus/dev/wt/independent-outstanding-20261020/{keel-contracts,keel-sdk}. Prefix PATH with /Users/ravonus/.nvm/versions/node/v22.22.1/bin:/Users/ravonus/.foundry/bin:/opt/homebrew/bin. Set KEEL_CONTRACTS_DIR and KEEL_CONTRACTS_ROOT to the exact own contracts checkout, KEEL_REQUIRE_SIBLINGS=1 for integration.

SDK build: node scripts/build.mjs. Focused: node --test --test-concurrency=2 tests/*tezos*.test.mjs tests/sdk-chain-capability-map.test.mjs tests/capability-policy.test.mjs. Compile actual storage from contracts with TEZOS_PYTHON=/Users/ravonus/dev/keel-contracts/script/tezos/.venv/bin/python ./script/tezos/compile-collection-route.sh; rerun SDK node --test tests/tezos-collection-conformance.test.mjs.

Contracts source checks: pnpm run fixtures:check; python3 script/module-scope-audit.py --check; python3 -m unittest discover -s test-js -p 'test_*.py'; node --test test-js/package-boundary.test.mjs test-js/manager-wire-abi.test.mjs test-js/module-scope.test.mjs test-js/metadata-events.test.mjs test-js/tezos-catalog.test.mjs test-js/tezos-sdk-catalog.test.mjs test-js/parity-fixtures.test.mjs test-js/benchmark-gate.test.mjs test-js/tezos-artifact-gate.test.mjs; node --test test-js/module-catalog.test.mjs. Static commands do not replace the full test:local aggregate.

Octez8 route check: DOCKER_HOST=unix:///Users/ravonus/.colima/default/docker.sock <SmartPyPython> script/tezos/validate-artifacts.py out/tezos-collection-route/targets --octez. Default Docker socket was absent; existing colima context/image independently inspected and used. Actual ABI/storage/source identity stays separate from existing deployment identities and new source initcode/runtime/gas qualification.

Retained local fullForge session5396: forge test -j2 -vvv; /tmp/keel-independent-contracts-forge-86b-20261020.log. Initial load12.34; after unrelated host load rose137 only owned Forge/SmartPy trees were SIGSTOPed; no other worker/system process touched. Forge resumed at verified load5.53 and is running. Do not restart it or mutate either own source until reaped. Native Mac partial was terminated only in its owned tree, exit143, and remains INCOMPLETE; its raw log is retained.

Fresh full native run is session80333 on Windows WSL Fray-Prover. Route: ssh windows 'wsl.exe -d Fray-Prover -- ...'. Persistent tools /root/keel-validation-tools-20261020; Nodebin node-v22.22.1-linux-x64/bin; Forge forge-v1.7.1; Python smartpy-0.24.1/bin/python; COREPACK_HOME=<prefix>/corepack with corepack pnpm@10.15.0. Official Node SHASUMS, GitHub Foundry asset digest, PyPI wheel digest and Solidity digest were verified. An initial /tmp tool install vanished across WSL lifecycle and was not treated as durable; the /root replacement was checked in separate invocations. Public source was transferred with git archive + exact commit object; Git's full tree hashca4598ec… and commit86b were verified before any scenario. No original/private publication input was transferred. Remote source /root/keel-independent-outstanding-20261020/keel-contracts; log ../smartpy-86b.log, eventual receipt ../smartpy-86b-result.json. Exact runner: TEZOS_PYTHON=<tools>/smartpy-0.24.1/bin/python ./script/tezos/test-tezos.sh.

Local entrypoint capability protocol replay session60954: DOCKER_HOST=<existingcolimasocket> TEZOS_PYTHON=<SmartPyPython> KEEL_SDK_DIR=<ownfrozenSDK> <SmartPyPython> script/parity/tezos-entrypoint-capabilities-proof.py. It uses only disposable network-disabled mockup keys/operations and public contract fixtures. Its log /tmp/keel-independent-contracts-entrypoint-octez-86b-20261020.log is still RUNNING, not accepted as PASS.

Snapshot logs named RUNNING are time-bound copies, not final results. The JSON binds their hashes and pending states. No production service/data/config changed, public-chain transaction or owner signature occurred. No deployment/readiness approval is issued.
