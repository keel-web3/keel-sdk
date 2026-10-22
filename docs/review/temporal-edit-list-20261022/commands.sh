#!/usr/bin/env bash
# Run in a NEW writable SDK checkout with its owned package builds/dependencies.
# Frozen evidence checkouts must remain unchanged during independent review.
set -euo pipefail
keel_test_node="${KEEL_TEST_NODE:-/Users/ravonus/.nvm/versions/node/v22.22.1/bin/node}"
keel_sdk_root="$(pwd)"
keel_site_root="${KEEL_TEST_SITE_ROOT:-$(dirname "$keel_sdk_root")/keel-site}"
keel_test_output="${KEEL_TEST_OUTPUT:-$(mktemp -d /private/tmp/keel-presentation-recheck.XXXXXX)}"
mkdir -p "$keel_test_output"
"$keel_test_node" node_modules/typescript/bin/tsc -p packages/builder/tsconfig.json > "$keel_test_output/builder-tsc.stdout" 2> "$keel_test_output/builder-tsc.stderr"
"$keel_test_node" --test --test-concurrency=1 tests/movie-edit-list.test.mjs tests/movie-presentation-semantics.test.mjs tests/actual-media-container.test.mjs tests/actual-media-pair.test.mjs tests/media-preparation.test.mjs tests/temporal-webp.test.mjs reviewer-temporal-pair-retained-bytes.mjs reviewer-shared-848.test.mjs reviewer-shared-848-mcp.test.mjs reviewer-editlist-byte-equality.test.mjs > "$keel_test_output/sdk.stdout" 2> "$keel_test_output/sdk.stderr"
# Reviewer edit-list cases also write ../evidence/edit-list-inputs in the NEW owned parent.
# The unchanged shared reviewer paths require ../evidence/inputs pointing at
# docs/review/temporal-display-metadata-20261022/reviewer-inputs. Actual MCP
# @keel/builder must resolve to this owned checkout, as in environment.json.
KEEL_TEMPORAL_EVIDENCE_DIR="$keel_test_output/browser" "$keel_test_node" --test --test-concurrency=1 tests/temporal-carrier-sequence.browser.test.mjs tests/native-presentation-guard.browser.test.mjs > "$keel_test_output/browser.stdout" 2> "$keel_test_output/browser.stderr"
cd "$keel_site_root/apps/studio"
"$keel_test_node" --conditions=react-server --import tsx --import ./tests/unit/support/css-modules.mjs --test --test-concurrency=1 tests/unit/owned-temporal-complete-context.test.ts tests/unit/registered-inline-release-cost-scope.test.ts tests/unit/registered-inline-final-review.test.ts tests/unit/registered-inline-final-sdk.test.ts tests/unit/registered-inline-readonly.test.ts > "$keel_test_output/site.stdout" 2> "$keel_test_output/site.stderr"
"$keel_test_node" node_modules/typescript/bin/tsc --noEmit --incremental false > "$keel_test_output/site-tsc.stdout" 2> "$keel_test_output/site-tsc.stderr"
