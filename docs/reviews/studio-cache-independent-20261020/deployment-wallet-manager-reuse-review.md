# Shared deployment tooling and reuse review

Reuse the three exact receipt-backed contracts. Their deployment payer gains no
owner or governance role, so changing the payer does not justify buying another
copy. Existing QA commit `075d533c` records all three canonical receipts and
runtime readbacks; this review made no new chain request.

The established KEEL deployment convention uses `KEEL_DEPLOYER_KEY_FILE`, with
the source default `.secrets/vault-sepolia-deployer.json`. Existing deployment
checkpoints record public deployer
`0x404A6bd65EF48AE85Da7b0E9358715a34A401b05`. FRAY's Keychain-backed publisher is
a separate wallet. No credential was opened, unlocked, or instantiated here.
Full stack scripts are evidence of existing tooling, not instructions to rerun
those stacks.

`KeelFactory.sol:33,107` has no owner/pause/configuration setter and creates its
own canonical collection deployer. The formatter is a stateless linked library.
`KeelNativeMediaPresentation.sol:84` asks the bound collection to authorize each
edit; `KeelRouted721.sol:50,65` retains the collection's roles and freeze checks.
None gives its deployment sender shared control.

Manager control is explicit: `configureModule` is a self-call with exact deployed
codehash and freeze guards; `executeGovernance` verifies the current governor
quorum, nonce, epoch, deadline and exact call. Any account can relay. Managed
consumers follow `resolveModule` and compatibility checks. An unrelated directory
entry cannot replace a direct immutable factory or library. No new registration
requirement was found for this direct presentation hook.

The existing custom-contract browser page remains a separate feature. The
Contracts UI links to it and SDK MCP advertises unsigned deployment preparation;
hosted Studio MCP does not explicitly advertise that handoff. Implementation and
tests are deferred under the user's pause. A later discovery regression can use
existing objects and synthetic wallet boundaries without another deployment.

The adjacent JSON binds 18 source files, public deployment checkpoint fields,
and four existing QA receipt/readback records by exact hash. It grants no signing,
configuration change, publication, or activation authority. Normal GIF proof and
the deployed Gator/GIF unsigned-wallet gates remain outstanding.
