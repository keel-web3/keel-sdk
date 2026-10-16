# Version-pinned optional shell migration qualification

The observed owned-upload HTTP 400 is an application presentation-literal gate,
not evidence of an incompatible deployed contract. The Site compatibility
correction removes that visual-default gate while retaining authenticated
registered bytes and actual reader capability checks. This five-object package
is therefore an optional presentation migration, not an established required
repair. Do not upload it solely because the old gate rejected revision 2.

The candidate is regenerated in a clean checkout of deployed SDK
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
qualify the exact legacy limits and fee profile below, authenticate existing objects/slugs, quote and fully
simulate only missing storage operations, then simulate this exact registration
from the keeper. The old 540577-gas estimate used old commitments and is not a
repair quote. After registration, verify canonical receipts and full bytes,
apply only the verified shell catalogue fields, and run real tokenURI readback,
direct data-URI browser acceptance and the same saved owned project. No live
contract execution, registration, wallet signing or publication is certified
by this offline qualification.

## Exact legacy Hold runtime

`scripts/verify-legacy-hold-profile.mjs` independently recompiles historical
contracts commit `6d64c56ad7222e5f02b6590b6d91669235568da7` with its original
solc 0.8.36, Prague, viaIR, optimizer 200 and metadata-disabled settings. It
reproduces exactly 6,922 runtime bytes and keccak256
`0x077e7511ef8deb6d2c1d56041ee230a1f6ffac4b861bf264c37346835653e0e5`, matching
the authorized operator read and public deployment report for the Hold above.
This is an offline reproduction against supplied chain evidence, not a fresh
cloud chain observation.

```sh
node scripts/verify-legacy-hold-profile.mjs /path/to/keel-contracts /tmp/legacy-hold-audit
```

The exact runtime has fixed limits of 23,000 bytes per slug, three slugs per
batch, 128 direct children and depth 16. Storage writes are nonpayable; this
legacy Hold has no protocol storage fee, seal intent, manager, fee exemption
or pause API. Network gas and any separate managed-service fee are not zero
by implication. Modern manager or seal-fee getter reverts must not be treated
as a runtime profile for an arbitrary contract. Require the exact code hash,
fresh canonical evidence and the reproduced ABI before using this profile.

The operator's 770,124,356 sum of individual cast estimates excludes welds and
registration, so it is not a complete quote. Full sequential simulation under
the exact Amsterdam capacity policy remains unqualified. The two tested RPCs
reported `eth_simulateV1` unavailable; this does not establish availability of
the separately approved PublicNode endpoint. No lower gas envelope, new
provider, invented modern policy or wallet approval is supplied by this audit.
