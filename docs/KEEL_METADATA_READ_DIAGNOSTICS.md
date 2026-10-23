# Inspect a blocked complete metadata read

Use the existing release and stored transaction receipts. Stored game size and a valid artwork digest do not measure the complete NFT metadata return or its contract execution cost.

With the creator's existing `drafts:read` grant:

- Hosted MCP: `keel_release_diagnose` with `releaseId` and `includeReadCall: true`.
- Portable MCP: `keel-studio-draft` with `operation: "diagnose"`, `releaseId` and `includeReadCall: true`.
- SDK: `client.diagnose(releaseId, { includeReadCall: true })`.
- Owner Studio recovery: expand the saved diagnostics, then choose **Load exact metadata read**.

Ordinary diagnostics return bounded sanitized measurements. The explicit option additionally returns `metadataReadCall` when the complete metadata measurement fails. It includes the exact calldata, observed reader runtime hash, fixed block number/hash, byte commitments, encoded envelope lengths and actual estimate/call gas attempts. It never includes an RPC URL, authentication header, provider error body or wallet authority. This payload may contain private draft metadata; keep it with the creator and do not transmit it to another provider without permission.

Before a permitted replay, verify the chain, canonical block hash and code hash at that same block. Decode the recorded ABI selector and arguments. Compare the entire returned tokenURI against `expectedMetadataDigest` and `expectedMetadataBytes`; a valid graph or minimal envelope is insufficient. The observed runtime hash does not by itself prove which source compiled it, and an explorer's verification label is not required to inspect bytecode. Establish source correspondence separately using pinned source, compiler/settings and runtime comparison.

The requested RPC gas boundary is not a transaction gas budget. Keep the existing chain/provider/policy boundaries. The last attempted envelope and the complete attempt list explain whether failure came from estimation, a capped read, a revert, integrity mismatch or a metadata-size check. Do not blindly raise a cap, alter compression, replace a shell or switch delivery mode. A new route needs equivalent-byte verification and creator review. No replay signs, pays, repeats artwork storage, or grants an agent wallet permission.

Source availability is separate from hosted deployment or package release. Discover tool schemas first: older Studio/SDK builds may not support `includeReadCall`. Do not claim the incident is recovered from a source patch or a synthetic test.
