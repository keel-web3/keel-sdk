# Combined source reconciliation

SDK PR47 carries the generic prepared composer and packed-table discovery alongside Contracts PR7. Regenerate the scoped harness/sleeve ABIs and module catalog from that exact canonical source, preserving all newer modules and recorded deployments.

The older experimental change that packs several simulation transactions into each block is superseded for this release. The maintained public, owned-node and saved-program transports qualify one exact transaction per simulated block, and the newer bounded discovery/capacity diagnostics rely on that format. Restoring the older grouping would change the saved program and fail those adapters. Keep the current preflight, fee/gas rules, typed failure diagnostics and full exact-program verification. The original proposal and its gas reference remain available in the preserved Git history; they are not fresh qualification for this release.

The composer/table EVM tests verify byte equality, invalid bounds, frozen rows, immutable source commitments and synthetic gas comparisons. Eight prior TokenMatrix storage fields retain their exact slots/offsets/types; new compact dictionary state starts after the legacy range mapping at slot 6. Local tests do not establish a deployed upgrade or selected-chain module registration.
