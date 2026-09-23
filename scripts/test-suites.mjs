import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const TEST_ROOT = resolve(import.meta.dirname, "../tests");

/** Requires a real installed headless browser and therefore stays out of the default unit gate. */
export const BROWSER_TEST_FILES = Object.freeze([
  "tests/sdk-verification-shell-browser.test.mjs",
  "tests/sdk-verification-shell-large-graph-browser.test.mjs",
  "tests/link-assembly-browser.test.mjs",
  "tests/sdk-verification-shell-marketplace-csp.test.mjs",
  "tests/three-r180-browser.test.mjs",
  "tests/keel-audio-browser.test.mjs",
]);

/** Reads neighboring repositories; each file uses siblingTest so ordinary clones skip honestly. */
export const SIBLING_CONFORMANCE_TEST_FILES = Object.freeze([
  "tests/index-registry-wire.test.mjs",
  "tests/fray-policy-source-conformance.test.mjs",
  "tests/keel-rpc-policy.test.mjs",
  "tests/sdk-keel721-compiled-abi.test.mjs",
  "tests/tezos-view-agreement.test.mjs",
  "tests/mcp-arena.test.mjs",
  "tests/creator-1155-events.test.mjs",
  "tests/creator-factory-events.test.mjs",
  "tests/creator-seeded-profile.test.mjs",
  "tests/deferred-collections.test.mjs",
  "tests/fee-settlement-events.test.mjs",
  "tests/mint-route-events.test.mjs",
  "tests/mint-seed-lifecycle.test.mjs",
  "tests/sdk-recovery.test.mjs",
  "tests/seed-registry-wire.test.mjs",
  "tests/shared-1155-events.test.mjs",
  "tests/studio-structure-check.test.mjs",
]);

/** No node:test file is allowed to perform live-chain or public-network work in the ordinary gate. */
export const LIVE_TEST_FILES = Object.freeze([]);

export const TEST_FILES_ON_DISK = Object.freeze(readdirSync(TEST_ROOT)
  .filter((name) => name.endsWith(".test.mjs"))
  .map((name) => `tests/${name}`)
  .sort());

/**
 * Local files, in-memory mocks, loopback servers, and deterministic
 * subprocesses only. This list is deliberately explicit: a newly added test
 * remains unclassified, and therefore fails the gate, until a reviewer chooses
 * its execution boundary.
 */
export const DETERMINISTIC_TEST_FILES = Object.freeze([
  "tests/mint-access-entropy.test.mjs",
  "tests/mint-reward-seed-profile.test.mjs",
  "tests/queue-access-plan.test.mjs",
  "tests/sdk-mint-queue.test.mjs",
  "tests/queue-bindings.test.mjs",
  "tests/mint-queue-worker.test.mjs",
  "tests/artifact-registry-abi.test.mjs",
  "tests/link-presentation.test.mjs",
  "tests/manager-wire.test.mjs",
  "tests/manager-state.test.mjs",
  "tests/sdk-engine.test.mjs",
  "tests/sdk-network-inspection.test.mjs",
  "tests/sdk-contract-controls.test.mjs",
  "tests/adversarial-boundary.test.mjs",
  "tests/builder-cost-analysis.test.mjs",
  "tests/builder-module-linked.test.mjs",
  "tests/builder-module-pipeline.test.mjs",
  "tests/builder-module-resolver.test.mjs",
  "tests/builder-module-workspace.test.mjs",
  "tests/builder-pipeline.test.mjs",
  "tests/builder.test.mjs",
  "tests/capability-policy.test.mjs",
  "tests/collection-verification.test.mjs",
  "tests/creator-collection-wallet.test.mjs",
  "tests/creator-collections-sdk.test.mjs",
  "tests/ethereum-adapter-executor.test.mjs",
  "tests/ethereum-adapter-preflight.test.mjs",
  "tests/ethereum-adapter-viem.test.mjs",
  "tests/ethereum-adapter.test.mjs",
  "tests/host-bridge-transport.test.mjs",
  "tests/host-bridge.test.mjs",
  "tests/keel-bench.test.mjs",
  "tests/keel-hybrid-viewer.test.mjs",
  "tests/keel-browser-alias-resolution.test.mjs",
  "tests/keel-browser-sha256.test.mjs",
  "tests/keel-build-recipe.test.mjs",
  "tests/keel-content-cache.test.mjs",
  "tests/keel-corpus.test.mjs",
  "tests/keel-creator-collection-cli.test.mjs",
  "tests/keel-frozen-dataset-limits.test.mjs",
  "tests/keel-frozen-dataset.test.mjs",
  "tests/keel-historical-evidence.test.mjs",
  "tests/keel-media-optimize-cli.test.mjs",
  "tests/keel-manifest-generation.test.mjs",
  "tests/keel-module-assurance.test.mjs",
  "tests/keel-module-registration.test.mjs",
  "tests/keel-presentation.test.mjs",
  "tests/keel-studio-agent-drafts-cli.test.mjs",
  "tests/keel-studio-stage-cli.test.mjs",
  "tests/keel-verification-shell.test.mjs",
  "tests/keel-viewer-bridge.test.mjs",
  "tests/keel-wallet-theft-simulator.test.mjs",
  "tests/library-publication-plan.test.mjs",
  "tests/mcp-fray-auction-intent.test.mjs",
  "tests/mcp-media-optimization.test.mjs",
  "tests/mcp-studio-draft.test.mjs",
  "tests/mcp.test.mjs",
  "tests/media-optimization.test.mjs",
  "tests/native-publication.test.mjs",
  "tests/onchain-data-surfaces.test.mjs",
  "tests/one-mint-drop-read-compatibility.test.mjs",
  "tests/one-mint-sdk.test.mjs",
  "tests/portable-root.test.mjs",
  "tests/presentation-bridge.test.mjs",
  "tests/protocol.test.mjs",
  "tests/readers.test.mjs",
  "tests/sandbox-browser.test.mjs",
  "tests/sandbox-sdk.test.mjs",
  "tests/sdk-asset-background.test.mjs",
  "tests/sdk-asset-tag-abi.test.mjs",
  "tests/sdk-audio-module.test.mjs",
  "tests/sdk-browser-abi.test.mjs",
  "tests/sdk-contract-check-boundary.test.mjs",
  "tests/sdk-creative-runtime-catalog.test.mjs",
  "tests/sdk-data-layer.test.mjs",
  "tests/sdk-endpoints.test.mjs",
  "tests/sdk-fray-auction-intent.test.mjs",
  "tests/sdk-history-publication.test.mjs",
  "tests/sdk-inline-viewer-graph.test.mjs",
  "tests/sdk-keel-audio-runtime.test.mjs",
  "tests/sdk-keel721-abi-parity.test.mjs",
  "tests/sdk-managed-publication.test.mjs",
  "tests/sdk-module-browser.test.mjs",
  "tests/sdk-module-catalog.test.mjs",
  "tests/sdk-module-declaration.test.mjs",
  "tests/sdk-module-external.test.mjs",
  "tests/sdk-module-generator.test.mjs",
  "tests/sdk-module-publication.test.mjs",
  "tests/sdk-module-review.test.mjs",
  "tests/sdk-onchain-data.test.mjs",
  "tests/sdk-presentation.test.mjs",
  "tests/sdk-publish-plan.test.mjs",
  "tests/sdk-revision-publication.test.mjs",
  "tests/sdk-shell-registry.test.mjs",
  "tests/sdk-tezos-shell.test.mjs",
  "tests/sdk-standard-chain-stack.test.mjs",
  "tests/sdk-studio-agent-drafts.test.mjs",
  "tests/sdk-studio-capabilities.test.mjs",
  "tests/sdk-studio-project-handoff.test.mjs",
  "tests/sdk-studio-project-intake.test.mjs",
  "tests/sdk-studio-publication.test.mjs",
  "tests/sdk-tezos-publication.test.mjs",
  "tests/sdk-three-container-harness.test.mjs",
  "tests/sdk-three-module.test.mjs",
  "tests/sdk-three-scene-publication.test.mjs",
  "tests/sdk-token-matrix.test.mjs",
  "tests/sdk-verification-shell-protection.test.mjs",
  "tests/sdk-verification-wrap.test.mjs",
  "tests/sdk-wallet-intent.test.mjs",
  "tests/sdk-wallet-link.test.mjs",
  "tests/sdk-wallet-request.test.mjs",
  "tests/sdk-web3-token-json.test.mjs",
  "tests/sdk.test.mjs",
  "tests/source-verification.test.mjs",
  "tests/studio-core.test.mjs",
  "tests/test-suite-classification.test.mjs",
  "tests/three-r180-sepolia-evidence.test.mjs",
  "tests/viewer-wake.test.mjs",
  "tests/viewer.test.mjs",
  "tests/admin-pauses.test.mjs",
  "tests/auction-sales.test.mjs",
  "tests/bitcoin-attachment.test.mjs",
  "tests/bitcoin-immutable-profile.test.mjs",
  "tests/bitcoin-proof.test.mjs",
  "tests/deferred-auctions.test.mjs",
  "tests/equipment-read-policy.test.mjs",
  "tests/ethereum-tezos-proof.test.mjs",
  "tests/fray-local-rpc-policy.test.mjs",
  "tests/game-entry-publication.test.mjs",
  "tests/harness-registry-wire.test.mjs",
  "tests/harness-tree.test.mjs",
  "tests/hold-errors.test.mjs",
  "tests/hold-events.test.mjs",
  "tests/hold-publication.test.mjs",
  "tests/keel-sleeve-chains.test.mjs",
  "tests/keel721-presentation.test.mjs",
  "tests/link-enums.test.mjs",
  "tests/link-registry-wire.test.mjs",
  "tests/metadata-notifications.test.mjs",
  "tests/metadata-relay.test.mjs",
  "tests/mint-pricing.test.mjs",
  "tests/mint-releases.test.mjs",
  "tests/mint-seeded-batches.test.mjs",
  "tests/module-editor.test.mjs",
  "tests/module-global-injection.test.mjs",
  "tests/module-project.test.mjs",
  "tests/module-template.test.mjs",
  "tests/module-types.test.mjs",
  "tests/native-1155-batch.test.mjs",
  "tests/one-mint-batch.test.mjs",
  "tests/one-mint-coupons.test.mjs",
  "tests/one-mint-nft-coupons.test.mjs",
  "tests/reward-campaign-plan.test.mjs",
  "tests/reward-capabilities.test.mjs",
  "tests/runtime-module-index.test.mjs",
  "tests/sdk-asset-storage-planner.test.mjs",
  "tests/sdk-mint-seeded-planning.test.mjs",
  "tests/sdk-mint-seeded.test.mjs",
  "tests/sdk-publication-module.test.mjs",
  "tests/sdk-stake-schemas.test.mjs",
  "tests/sdk-token-matrix-layout.test.mjs",
  "tests/stamps.test.mjs",
  "tests/svg-authoring.test.mjs",
  "tests/svg-renderer.test.mjs",
  "tests/thumbnail-sequence.test.mjs",
  "tests/treasury.test.mjs",
]);

export const DEFAULT_TEST_FILES = Object.freeze([
  ...DETERMINISTIC_TEST_FILES,
  ...SIBLING_CONFORMANCE_TEST_FILES,
].sort());

export function validateTestSuiteClassification(testFiles = TEST_FILES_ON_DISK) {
  const issues = [];
  const discovered = [...testFiles].sort();
  const discoveredSet = new Set(discovered);
  const classified = [
    ...DETERMINISTIC_TEST_FILES,
    ...SIBLING_CONFORMANCE_TEST_FILES,
    ...BROWSER_TEST_FILES,
    ...LIVE_TEST_FILES,
  ];
  const duplicates = classified.filter((file, index) => classified.indexOf(file) !== index);
  if (duplicates.length > 0) issues.push(`multiply classified tests: ${[...new Set(duplicates)].join(", ")}`);
  const missing = discovered.filter((file) => !classified.includes(file));
  const stale = classified.filter((file) => !discovered.includes(file));
  if (missing.length > 0) issues.push(`unclassified tests: ${missing.join(", ")}`);
  if (stale.length > 0) issues.push(`classified tests not on disk: ${stale.join(", ")}`);

  const browserOnlyPattern = /--headless|ms-playwright|chromium_headless|chrome-headless/u;
  for (const file of DETERMINISTIC_TEST_FILES) {
    if (!discoveredSet.has(file)) continue;
    if (browserOnlyPattern.test(readFileSync(resolve(import.meta.dirname, "..", file), "utf8"))) {
      issues.push(`browser-dependent test classified as deterministic: ${file}`);
    }
  }
  return Object.freeze(issues);
}
