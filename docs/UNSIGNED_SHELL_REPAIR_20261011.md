# Version-pinned shell repair qualification

The repair is regenerated in a clean checkout of deployed SDK
`c5a51cc45ca03fd48a8f49255aa096d751b8b571`, built with Node 22.23.1 and pnpm
10.15.0. The generator now requires the expected checkout commit and records
its own SHA-256; it no longer hardcodes the routing branch's SDK provenance.

All five object files, object IDs, slug plans and the unsigned registration
calldata are byte-identical to the earlier d4c5b2a candidate. The six-file SDK
diff changes routing/draft work, documentation and tests, not shell sources.
Maximum proposed infrastructure bytes remain 488,274, before verified reuse.
This is not a missing-storage quote or authority to upload all five objects.

Run after building the exact checkout (copy the two qualification scripts into
that checkout without changing its SDK sources):

```sh
node scripts/prepare-shell-repair-candidate.mjs /tmp/shell-candidate c5a51cc45ca03fd48a8f49255aa096d751b8b571
CHROMIUM_PATH=/usr/bin/chromium node scripts/qualify-shell-repair-candidate.mjs /tmp/shell-candidate /path/to/keel-site
node --test tests/sdk-inline-viewer-graph.test.mjs tests/sdk-shell-registry.test.mjs tests/sdk-verification-shell-protection.test.mjs tests/copy-publication-enforcement.test.mjs
```

The 40 SDK tests pass. The candidate-specific qualifier verifies every file
digest and public ABI decoding, exact stored shell fragments in complete
COPY-assembled tokenURIs, and both URI encoding layers. The synthetic legacy
fixture is 286,533 bytes; compact is 208,757 bytes. The legacy test explicitly
acknowledges compatibility testing; fresh creator Inline remains compact.

Chromium renders each exact decoded animation document through a local
fixture server. The operator's 118-byte PNG retains SHA-256
`99ed562adddedc76e68a95987317fde599d637060940b13dabaac07313320f83`
and renders at 32 by 16. The protected shell survives a child mutation attempt,
keeps an opaque child frame and makes no external requests. Corrupting the
source digest prevents the artwork frame from mounting in both lanes.
Direct top-level data-URI navigation is blocked by this environment's Chromium
administrator policy and is explicitly unverified. No policy is changed.

The maintained Site ABI exposes the exact five-argument
`setShell(bytes32,bytes32,bytes32,uint8,bytes32)` selector `0xfba20715`, the
candidate Hold `castSlugs`/`weldObject` inputs, and both builders'
`preparedTokenURI` selector `0x2107bb4d`. These ABI files are unchanged from
qualified PR38. ABI compatibility and local byte concatenation do not prove
execution against today's deployed runtime.

For the observed Sepolia deployment, storage preparation targets Hold
`0x0a4f31d5ab08029e4c68f6f3227d9fa3a2d66267`. Registration targets builder
`0x63a172ae55a6c7413a2f80be9de9cd9cb106973d` and must be approved by its actual
keeper, observed as `0x404A6bd65EF48AE85Da7b0E9358715a34A401b05`. Use the exact
candidate JSON calldata and commitments. No caller-supplied creator assertion
can replace keeper authority. Compact catalogue fragments retain the existing
compact builder and modules; registration uses payload mode 2 with the legacy
registered prefix/suffix and new metadata object.

Before approval, the operator must refresh chain/block/runtime/keeper evidence,
read limits and fees, authenticate existing objects/slugs, quote and fully
simulate only missing storage operations, then simulate this exact registration
from the keeper. The old 540577-gas estimate used old commitments and is not a
repair quote. After registration, verify canonical receipts and full bytes,
apply only the verified shell catalogue fields, and run real tokenURI readback,
direct data-URI browser acceptance and the same saved owned project. No live
contract execution, registration, wallet signing or publication is certified
by this offline qualification.
