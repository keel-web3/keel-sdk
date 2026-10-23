KEEL synthetic local metadata gas probe, 2026-10-07

No real artwork, private calldata, RPC endpoint or chain transaction is used. The harness executes EVM messages in EthereumJS memory with no server/socket or network after package installation.

Source: Ravonus/keel-contracts ace3fed7aff1765c7d2ee9bba4d0232246f86ffb.
Pinned RawTokenURIBuilder and seven direct/transitive Keel dependencies are in sources.json and more-sources.json, with original Git blob hashes. Compiler settings are exactly the pinned foundry.toml: solc 0.8.36, optimizer 50, viaIR, Prague, no bytecode hash/CBOR. OpenZeppelin 5.6.1 matches pinned package.json. compiled.json caches this exact synthetic build. The builder's immutable Hold address is patched to the in-memory stub only.

PORTABLE RUN
npm install --ignore-scripts --no-audit --no-fund
node run.mjs
Output: rerun-results.json, plus JSON lines to stdout. Compiling from scratch is supported by deleting compiled.json, then rerunning. Dependencies are declared exactly in package.json. An optional KEEL_SDK_PATH points to an existing SDK checkout to reuse solc/viem/OZ installations; EthereumJS must still resolve near run.mjs.

PRIMARY RESULTS
Read final-results.json. It combines the final warm-account/precompile runs and excludes superseded noncanonical encoding probes. results.json contains the base64 cases plus one less realistic escaped-base64 stress test; escaped-results.json is the valid decoded-SVG stress test. The latter is used in final-results.json. Every successful route call asserts the exact returned URI, and both routes give identical ABI return hashes for identical fixtures.

SYNTHETIC SCOPE
Graph: 628198 ASCII 'a' bytes, stored as 27 code slugs of at most 24000 bytes with a STOP prefix. SyntheticHold returns matching object record, SHA256 and pointers. It is not the production Hold/Index/composite graph and intentionally avoids their storage/index overhead. This size is inspired by the reported game source size, not proof that the production prepared graph has that size.
Preview base64 cases: 0, 18506, 50000 and 100000 zero bytes encoded under a WebP URI label (not real decodable WebP files). Escaping stress case: a valid 18506-byte SVG dominated by spaces, percent encoded. Complete metadata is synthetic. No production metadata or keys are included.

Gas totals = measured execution gas + intrinsic 21000 + 4 per zero calldata byte + 16 per nonzero byte. The Prague calldata floor is lower than these totals. Caller, target and Prague precompile addresses start warm; Hold and slug addresses start cold for each call. Local high-budget measurements use 200M to establish requirement; explicit 60M probes subtract intrinsic gas from execution budget and remain capped. Nothing changes KEEL's production 60M policy or its extra collection margin.

NOT PROVEN
These are builder calls, not collection.tokenURI end-to-end calls. We do not establish actual Gatorrr deployed runtime correspondence, production graph shape, envelope sizes, token context, call gas, or incident root cause. Do not automatically substitute collection preparation lanes. The synthetic Hold changes absolute gas; exact private calldata replay also needs exact local state/runtime/objects before it is an incident reproduction.

COLLECTION-LEVEL CAUTION (additional pinned source inspection)
collection-semantics.json contains KEEL721, KEEL721Deployer, KeelRouted721 and Keel721MetadataFormatting from the same pinned commit. The factory deployer selects KeelRouted721. Base dynamic preEncoded envelope resolves current presentation/image/context and appends its footer; the concrete routed subclass does not add keel_artifact through _tokenJSONAttributes. The SDK prepared envelope can include keel_artifact. Stored prepared prefix/suffix also differ in mutability from an envelope rebuilt using an active Index. Therefore matching builder calls is NOT evidence that changing the collection setter from setPreparedOnchainHarness to setPreEncodedOnchainHarness preserves the final tokenURI or creator intent.
