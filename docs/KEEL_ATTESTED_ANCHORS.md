# KEEL cross-chain anchors

A contributor opens an attachment request for an exact local object revision and foreign location using `driveAnchor`. Anyone can submit the evidence to the registered proof adapter. The adapter checks it onchain and reports the validated task result to `KeelAttestedAnchorRegistry`.

The **last successful task immediately records the attachment**. The registry computes the anchor root, indexes the object revision/network, and credits the contributor in that transaction. No external service needs to announce attachment or call a finalization job. `setAnchor` is an idempotent compatibility call: it cannot make incomplete evidence pass or duplicate contributor credit.

CRE, Chainlink Functions, the local Functions router, workflow packages, oracle JavaScript sources, and report decoder have been removed from the cross-chain module and SDK. The optional CRE URL/pixel report adapters are also removed. No live service migration is required.

## Available components

| Component | Responsibility |
| --- | --- |
| `KeelAttestedAnchorRegistry` | Request/task lifecycle, versioned verifier registrations, attachment receipts, and contributor accounting |
| `KeelPortableAnchorRegistry` | Portable roots bound to immutable artifact revisions |
| `KeelL2StateVerifier` / `KeelL2AnchorVerifier` | Settlement-root and storage-proof primitives |
| `KeelZkAnchorVerifier` | Checkpoint/digest/work policy and permissionless proof submission |
| `KeelSp1GatewayProofBackend` | Verification against a configured SP1 program |
| `KeelZkVerifyProofBackend` | Optional aggregation inclusion checks, with aggregation-root trust requirements |
| `KeelIpfsCidVerifier` | Recompute a CID from stored bytes; this does not prove ongoing IPFS availability |
| `KeelAnchorReplicationBridge` | Apply a finalized anchor to a matching replication campaign |

## Lifecycle and evidence

1. Anyone opens a request with its source network, registry, object key, revision, verifier ID, and task locators. Existing object policy still governs allowed attachment families.
2. Whole-content mode uses the revision's decoded SHA-256 digest. Chunk mode binds the complete ordered list of content-addressed chunks to the stored index digest.
3. Anyone submits proof material to the pinned adapter. A raw caller cannot directly submit an authoritative task result: only that adapter can do so.
4. The final successful task records the attachment automatically. Partial evidence stays pending. A definitive rejected task rejects the request; invalid proof verification reverts.
5. Existing lease/nonce rules allow abandoned, rejected, or cancelled requests to reopen without accepting results from a superseded request.

## Security boundary

A permissionless submission interface does not by itself prove foreign-chain authenticity. Each adapter still needs authenticated consensus/finality, exact location/revision/digest-mode binding, and a validated relationship between commitments and actual bytes. Broad anchored queries reflect acceptance under the registered adapter; they do not establish that every registered trust class is equally strong.

Some existing tests use mock consensus roots or proof backends. They verify lifecycle and policy behavior, not production cross-chain security. The Bitcoin core includes cryptographic fixture tests, but that is distinct from generating and verifying a complete ZK proof on a deployed destination chain.

See the contracts repository's `docs/CROSS_CHAIN_PROOF_GOVERNANCE_PLAN.md` for remaining chain-client, immutable-profile, dependency-pinning, and optional future community-governance work. Changing proof producers requires no governance; changing accepted verification rules is a separate versioned governance decision.
