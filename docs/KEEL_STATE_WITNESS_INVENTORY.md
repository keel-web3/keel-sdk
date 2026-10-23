# Bounded state witness inventories

`scripts/lib/captured-state-inventory.mjs` provides one shared collection and
verification boundary for a complete, explicitly supplied seed inventory.
It does not activate a new Studio transport, renew a saved plan, discover
dependencies automatically, or authorize publication.

The original single-page collector still accepts at most 64 accounts, 1,024
slots, 256 slots per account and 131 requests. The separate whole inventory is
limited to 256 accounts, 4,096 slots, eight pages, 536 requests, 120 seconds and
64 MiB of response bytes. A page still has its original 32 MiB total and 4 MiB
per-response bounds. All applicable bounds must pass; none is raised during
recovery. An individual account exceeding 256 slots needs an explicitly
reviewed future mechanism and is refused here.

The planner normalizes addresses/slots, rejects duplicates, and partitions the
ordered inventory without truncation or reordering. Its digest binds the full
capture object and optional file bytes, source fingerprint, complete program,
canonical header RLP, full account/slot inventory and fixed limits. Each page
binds its index, offset, count and inventory digest. Each page seed includes
that whole-inventory identity, so proofs from another source, page or pin cannot
be silently substituted.

Each page checks the chain and canonical numbered header before account
proof/code reads and rechecks that same header afterward. There is no latest
selection, retry, redirect, new recipient or automatic scope expansion. The
recipient remains the specifically approved PublicNode Sepolia URL. Project
calldata stays local. A cancellation aborts an in-flight read, prevents later
pages and cannot turn partial evidence into complete coverage. The total
deadline and response budget are shared rather than restarted for each page.

```sh
node scripts/capture-state-inventory.mjs \
  --capture /absolute/unchanged-source-capture.json \
  --seed /absolute/exact-derived-seed.json \
  --output /absolute/new-private-inventory-report.json
```

The CLI uses bounded regular-file reads, rejects symlinks and existing output
files, and writes mode 0600. Invalid source binding or an oversized inventory
fails before a network request. Partial response evidence is retained on a
blocked operation. No output is a wallet approval or a saved-plan update.

`mergeCapturedStateWitnessPages` independently reconstructs the expected plan
and checks every request's method, parameters, ID and byte digest. It checks
complete raw RPC response bytes/digests, exact returned slot sets, account and
storage Merkle proofs, runtime code hashes and both full canonical headers.
Missing, extra, duplicate, reordered, stale or mutated pages fail. A saved
`seedComplete:true` flag is not sufficient. The merged witness must contain
exactly all requested accounts and slots.

`inventoryComplete:true` means only that the requested inventory was collected
and authenticated at that pin. `fullWitnessComplete`, `transitiveStateComplete`,
`gateAccepted`, `projectAcceptance` and `acceptance` remain false. Unresolved
source dependencies remain attached to the result. Native execution must still
reject every additional account, slot, runtime or accessed ancestor missing
from the canonical witness. Its full sequential access closure, complete URI,
fresh source and existing SDK validation remain separate requirements.

The public-only cloud control in `approved-sepolia-capability.yml` has a
separate fixed five-read path. It accepts no creator input and tests only a
public factory account/raw slot. Its success establishes that runner's recent
proof capability, not complete project state or permission to publish private
creator inputs in repository files or job logs.
