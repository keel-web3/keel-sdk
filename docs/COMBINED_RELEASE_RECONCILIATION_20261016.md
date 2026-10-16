# Combined source reconciliation

SDK PR47 carries the generic prepared composer and packed-table discovery alongside Contracts PR7. Regenerate the scoped harness/sleeve ABIs and module catalog from that exact canonical source, preserving all newer modules and recorded deployments.

The older experimental change that packs several simulation transactions into each block is superseded for this release. The maintained public, owned-node and saved-program transports qualify one exact transaction per simulated block, and the newer bounded discovery/capacity diagnostics rely on that format. Restoring the older grouping would change the saved program and fail those adapters. Keep the current preflight, fee/gas rules, typed failure diagnostics and full exact-program verification. The original proposal and its gas reference remain available in the preserved Git history; they are not fresh qualification for this release.

The composer/table EVM tests verify byte equality, invalid bounds, frozen rows, immutable source commitments and synthetic gas comparisons. Eight prior TokenMatrix storage fields retain their exact slots/offsets/types; new compact dictionary state starts after the legacy range mapping at slot 6. Local tests do not establish a deployed upgrade or selected-chain module registration.

## SDK7 standards, graph and unsigned request preparation

The older standards receipt/audit, graph-weld preparation, artifact deployment encoding, explicit gas limits and bounded file delivery are integrated with the current tool/plugin inventory. Current source recovery, owner authentication, prepared-COPY full-return evidence, and Compact/Raw plus viewer=none choices remain in force. Valid JSON Schema metadata in existing trailer tools is accepted; incompatible top-level combinators remain rejected.

Historical universal EIP-7825 total gas enforcement is reconciled with the current selected-block transaction policy. Offline packing keeps a conservative bound and never proves chain readiness. Network inspection identifies unregistered chain profiles without assuming Ethereum rules. Selected Amsterdam total gas may exceed the unchanged execution-gas limit. Prepared requests label caller-provided block data as local evidence, requiring separate exact simulation before wallet approval. No existing saved-program transport or qualification path is replaced.

The retained older REDLINE fork fixture does not match today's pinned canonical shell. The audit reports that mismatch instead of silently trusting a historical prefix. Current multi-module shell fixtures still verify resource identities and reject missing resources, altered digests and external locators. Explicit creator-owned HTML is audited without requiring unused canonical fragments or claiming canonical protection.
