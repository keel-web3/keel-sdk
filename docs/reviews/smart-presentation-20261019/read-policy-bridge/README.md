# Exact nonstandard policy bridge

Source base a8e17ce5a7d4902178d4188bc1a7dd713f81e09e; required protocol dependency 554e56fa688437f0bd7e865db83052c4366ecf9c (independent RPC specialist). Source edits do not cherry-pick that dependency or change its identity namespace.

`@keel/sdk/presentation` reexports the two-stage unsigned preparation budget and exact measured-read policy. The existing synchronous `assertKeelMediaSlotReadFit` retains every default assertion. Additive async `assertKeelNonstandardMediaSlotReadFit` requires the real smart matrix, exact legacy slot correspondence, matching source/project/revision/defaults/chain, actual complete URI, exact actual measurement digest, and supplied exact policy. `identity.planDigest` is SHA256 of the smart matrix planKey. It is not the legacy slot key, journal fingerprint or simulation fingerprint. Mutation is snapshotted before await. Actual provider qualification and full unchanged-program simulation remain mandatory.

MCP source staging already carries the persisted compatibility preference. It precedes the final URI, so it must not accept a fabricated exact policy at that phase. `continue-publication` delegates to the same authenticated Studio review service; its actual final journal integration is owned by the Site integrator/lead.

Implementer verification: macOS arm64, Node v22.22.1, SDK and builder TSC exit0; `node --test tests/media-slot-plan.test.mjs` 10PASS/0FAIL. The new regression checks exact larger URI success, unchanged standard guard rejection, wrong content, missing actual read, contradictory slot source, stale source/chain/plan/measurement/revision, and mutation snapshot. SDK public reexports are exercised. No fixture/reference asset was changed.

For this dependency-order check only, ignored local protocol/dist used the previously compiled a8 protocol plus the unchanged 554 nonstandard-read-policy compiled file and its index export. No frozen checkout/source or other agent's artifact was modified. A clean integrated source build of both commits and independent QA are still required. Log: node22-focused.log. No signature, transaction, production write or live-capability claim.
