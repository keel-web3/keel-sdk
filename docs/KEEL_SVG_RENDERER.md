# Create a contract SVG renderer

`keel.svg-native@1` is KEEL's direct SVG renderer protocol. A contract generates the image from its own committed state when `svg(tokenId)` is read. It stores neither the complete SVG nor one image per token. Use the generic creation tool to design ordinary collection artwork. FRAY's accepted-proof collectible is a separate adapter using the same renderer protocol.

This is a **native EVM code-and-state renderer**, not a claim that the SVG was uploaded to KeelHold. It requires no image server, renderer API or uploaded copy. Existing KEEL HTML presentations still use the registered [canonical verification shell](KEEL_VERIFICATION_SHELL.md); this SVG lane does not replace or embed that shell. If an HTML viewer is added, stage creator content through the normal canonical-shell route.

## Create a renderer

In the KEEL editor, open any project and choose **SVG renderer**. Start with orbits, blocks, or a blank canvas, choose your palette and dimensions, and move between token previews. **Edit SVG & contract values** accepts passive SVG shapes with deterministic placeholders. **Save & preview** retains the editable recipe in the project. **Export Solidity renderer** saves a reusable contract, not a FRAY glyph or NFT minting system.

The SDK and MCP expose the same authoring path:

```ts
import { createSVGRendererRecipe, previewSVGRenderer, prepareSVGRenderer } from '@keel/sdk/svg-renderer-authoring';
const recipe = createSVGRendererRecipe('orbit');
recipe.name = 'MyCollectionArt';
recipe.colors.primary = '#ffcc00';
const preview = previewSVGRenderer(recipe, '42');
const prepared = prepareSVGRenderer(recipe);
// Save prepared.solidity, compile and test it in your contract project.
// compiled:false and publicationReady:false until those separate steps happen.
```

Supported placeholders are `{{background}}`, `{{primary}}`, `{{accent}}`, `{{tokenId}}`, `{{seedColor}}`, `{{seedX}}`, and `{{seedY}}`. The exported contract derives the per-token seed as `keccak256(abi.encode(COLLECTION_SEED, tokenId))`; color uses its low 24 bits, X uses bits shifted right 24 modulo canvas width, and Y uses bits shifted right 56 modulo canvas height. The local preview uses precisely the same integer calculations. Canvas dimensions set the viewBox; existing shapes keep their coordinates. No random generator runs in the render loop.

The constructor receives your deployed ERC-721 or ERC-721A collection. `ownerOf(tokenId)` rejects nonexistent tokens. `imageURI(tokenId)` supplies a raw-percent SVG image for your NFT metadata; your collection's metadata implementation must call or otherwise integrate this renderer. Export alone does not wire or deploy your NFT. Imports require `@keel/` mapped to `keel-contracts/src/modules/` and `@openzeppelin/contracts/` to OpenZeppelin Contracts. Compile with Solidity 0.8.36 and test your exact optimizer configuration before deployment.

The v1 builder permits 8 KB of ASCII passive inner SVG markup and 128 placeholders. It validates the recipe before export or persistence. Arbitrary contract reads/custom algorithms can be added in Solidity after export; they are not falsely emulated by the basic recipe preview. Store `context.source` and `context.seed` for ordinary generative art and leave `context.schema` zero: the hidden `proof` field is then `null`.

## Contract integration

In `keel-contracts`, inherit `@keel/keel-harness/KeelSVGRenderer.sol` and implement `_svgDocument(uint256)`. The public ABI is:

```solidity
function svg(uint256 tokenId) external view returns (string memory);
function svgProvenance(uint256 tokenId) external view returns (string memory);
```

`_svgDocument` returns `(bytes artwork, uint32 width, uint32 height, SVGProof proof)`. The artwork is inner SVG markup, without an outer SVG element. Reject nonexistent tokens, derive every proof field from accepted contract state, and keep the drawing bounded. Do not expose a method that lets a caller supply a different statement or seed for an existing token.

The immutable creation chain ID, contract address, runtime code hash, token ID, and read method are added by the shared renderer. No owner can edit its metadata. FRAY keeps the accepted job and statement in two words and winner/work/kind in one packed word. The SVG therefore adds no per-token metadata write to acceptance.

Use `KeelUriEscape.escapePrefixed` for compact raw-percent SVG/JSON data URIs. Do not Base64-wrap the complete metadata or a complete HTML document. FRAY's `FrayProofGlyphNFT.tokenURI` carries `svg(tokenId)` as `image`; it does not pretend a saved image snapshot is a live renderer binding.

## Hidden, organized provenance

The generated document has exactly one standard non-rendered `<metadata>` element, followed by the artwork:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" shape-rendering="crispEdges">
<metadata id="keel-verification"><![CDATA[{
  "schema": "keel.svg-native@1",
  "renderer": { "chainId": "…", "address": "0x…", "tokenId": "1", "codeHash": "0x…", "method": "svg(uint256)" },
  "artwork": { "hash": "sha256", "digest": "0x…", "bytes": "…" },
  "generation": { "source": "0x…", "seed": "0x…" },
  "proof": { "schema": "0x…", "source": "0x…", "job": "0x…", "statement": "0x…", "beneficiary": "0x…", "kind": 1, "work": "…", "seed": "0x…" },
  "verification": { "method": "same-block-contract-readback", "storage": "evm-code-and-state" }
}]]></metadata>
<g id="keel-artwork">…</g>
</svg>
```

The ellipses above are documentation placeholders, not valid hashes. The contract emits complete values. IDs, chain IDs and work are decimal strings to avoid JavaScript precision loss. `kind` is a uint8; work is uint88. The digest covers the UTF-8 bytes inside `keel-artwork`, excluding the group wrapper. It does not hash the metadata into itself. SVG metadata is invisible but **public, not secret**. Its placement follows [W3C SVG metadata guidance](https://www.w3.org/TR/SVG11/metadata.html).

FRAY's proof schema is `keccak256("fray.accepted-proof@1")`: kind 0=start, 1=region, 2=close. A start stores zero combat work. The statement is the verifier-bound public-input digest, not the complete Groth16 seal. Resolve the source/job receipt and accepted transaction to inspect the full submitted seal; retaining a second copy in NFT storage would charge every winner unnecessarily. NFT transfers preserve the original beneficiary and proof credit.

## Verification boundary

**The hidden record is not self-authenticating.** Anyone can copy it or fabricate a well-formed SVG. Local inspection checks shape, fields and artwork digest only; it returns `unverified`.

For readback, supply a trusted network, contract and token ID independently of the SVG. `readKeelSVG` pins all reads to one finalized block, checks deployed runtime code against the embedded hash (and an optional reviewed hash), validates token/network/address, and checks that the block hash stayed unchanged. `verifyKeelSVG` additionally compares the complete supplied SVG to `svg(tokenId)` byte for byte. Altering only the statement while keeping a correct art digest is rejected.

This relies on the selected RPC and deployment. It does not independently authenticate Ethereum consensus, audit the application's verifier, establish that a copied contract is official, or establish fairness of a game seed. Pin a reviewed code hash and trusted deployment in applications. This version is for native immutable contracts, not an upgradeable proxy whose implementation could change independently of its proxy bytecode.

## SDK

```ts
import { createPublicClient, http } from 'viem';
import { readKeelSVG, verifyKeelSVG, inspectKeelSVG } from '@keel/sdk/svg-renderer';

const client = createPublicClient({ transport: http(rpcUrl) });
const target = { chainId: 11155111, address: trustedCollection, tokenId: '1', codeHash: reviewedRuntimeHash };
const generated = await readKeelSVG(client, target);
// generated.source: SVG; imageURI: raw-percent image; provenance: typed record;
// verification: contract-readback; blockNumber/blockHash/codeHash: read evidence.
await verifyKeelSVG(client, target, downloadedSVG);
const localOnly = inspectKeelSVG(downloadedSVG); // verification === 'unverified'
```

Also exported: `KEEL_SVG_ABI`, `KEEL_SVG_SCHEMA`, `prepareKeelSVGRead`, `keelSVGDataURI`, `decodeKeelSVG`, target/client/provenance types. No method signs or submits a transaction.

The v1 SDK preview accepts passive `g`, `path`, `rect`, `circle`, `ellipse`, `line`, `polyline` and `polygon` geometry. It rejects scripts, handlers, images, external references, styles, entities, comments, duplicate attributes and foreign objects. Renderer authors must enforce this passive subset themselves; the abstract contract wraps trusted implementation output and is not an onchain XML sanitizer. The art budget is 131,072 bytes. Display imported content in an image context, never via `innerHTML`.

## MCP

- `keel-svg-create { preset: "orbit", tokenId: "42" }`: returns an editable recipe, deterministic preview and Solidity source. Alternatively pass `recipeJson` with your own recipe. It does not compile, deploy, sign or mint.
- `keel-svg-inspect { svg }`: reads a raw SVG or raw-percent image URI, validates geometry/digest, and returns the organized provenance with `verification: unverified`.
- `keel-svg-call-plan { chainId, address, tokenId }`: returns the unsigned `eth_call` data for `svg(uint256)`. It performs no RPC, signing or publication. Feed the result to the trusted selected-chain client, or use the SDK verification methods.

These tools are in normal tool discovery and the project MCP self-test. The `keel://mcp/svg-renderer` resource and engine catalog describe the protocol and verification boundary. They deliberately never fetch a URL supplied by embedded SVG metadata.

## Editor integration

Creation lives in the **SVG renderer** tab. It uses the same project save/revision system, native file export dialog and reviewed agent edits as the rest of the editor. Agents can prepare a recipe through `keel-svg-create` and update the project's `svgRenderer` through the editor project tools. The in-editor `keel_edit_project` tool accepts `svgRendererJson`. Existing collection/proof inspection remains available through the generic SDK and MCP read tools.

A preview is local art, with no onchain verification claim. Normal art does not acquire a fabricated proof record. The exported renderer adds provenance when its contract is actually read. Existing metadata, files and canonical HTML shell selection remain unchanged.

## Validation

`node --test tests/svg-renderer.test.mjs tests/svg-authoring.test.mjs` covers passive content, forged statements, wrong contract/token/network/code hash, changed block snapshots, missing RPC/code, field bounds and the MCP tools. The FRAY isolated Anvil acceptance harness uses a real retained Groth16 proof before checking actual SVG readback and mutations. `apps/desktop/tests/electron-svg.cjs` exercises creation, token navigation, palette editing, native Solidity export, project persistence, passive-content rejection and desktop/compact layout in a temporary hidden editor profile.

`tests/prepare-svg-authoring-fixtures.mjs <isolated-foundry-root>` exports all three preset contracts and generates compilation tests. After compiling in the FRAY isolated harness, `tests/svg-authoring-local.mjs <root>` deploys them to disposable Anvil port 18564 and compares nine SDK previews (three presets, token IDs 1/2/255) byte for byte with actual Solidity artwork and seed output. It checks raw-percent image parity, `proof:null` and missing-token rejection. These integration scripts only use Anvil's public test key. The high token ID also exercises ERC721A's lazy owner lookup; its view gas is separate from image-generation work.

New local source/build/test evidence is not a Sepolia deployment or published KEEL module registration. No public release is claimed by these tools.
