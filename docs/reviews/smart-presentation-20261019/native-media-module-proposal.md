# Optional native-media hook proposal; no contract edit or deployment

## Observed boundary

Contracts4015b92315ac425f7b2526c797f872a6da2cde64 `KeelRouted721` already calls module `tokenURI(address,uint256) returns(bool,string)`, `imageURI(address,uint256,string) returns(string)` and `freeze(uint256)`. Its host callback `authorizePresentation(uint256,address,bool)` enforces bound module, caller role/owner, pause and collection/token freeze. Module selection is permanent before first mint. Solidity's stored Keel721Presentation type does not require implementation inheritance at runtime.

The existing Keel721Presentation only admits uncompressed image/* Hold records for its image pointer. No custom URI route falls through to base metadata, which always includes animation_url (including manifest fallback). Its literal URI route could omit animation, but copying a full image literal recreates the failed storage cost. Existing legacy deployed factory profiles have no routed module hook; this proposal cannot retrofit them.

## Smallest proposed optional extension

Implement a separate generic `KeelNativeMediaPresentation` matching the existing hook ABI, without editing Keel721Presentation, KeelRouted721, factory, deployer or formatting library. This avoids inheritance/virtual refactors entirely. Factory/library/carrier source and bytes therefore need no change, but this statement must still be checked by artifact hash comparison in implementation. No replacement Hold/storage/registry protocol or encoded paid sibling is proposed.

Proposed additive ABI (names pending scoped source approval):

```solidity
struct NativeMediaSource { address store; bytes32 objectId; }
enum NativeMediaRoute { NativeFallback, ImageOnly, MediaWithPoster }
function setNativeMediaSource(address collection, uint256 tokenId,
    NativeMediaRoute route, NativeMediaSource calldata media) external;
function nativeMediaSource(address collection, uint256 tokenId) external view
    returns (NativeMediaRoute route, address store, bytes32 objectId, bool configured);
// Preserve existing image-source/URI-template setters/getters and hooks exactly:
function setImageSource(address collection,uint256 tokenId,address store,bytes32 objectId) external;
function setTokenURIRoute(address collection,uint256 tokenId,string calldata prefix,string calldata postfix,bool appendTokenId) external;
function imageURI(address collection,uint256 tokenId,string calldata fallbackURI) external view returns(string memory);
function tokenURI(address collection,uint256 tokenId) external view returns(bool,string memory);
function freeze(uint256 tokenId) external;
function frozen(address collection,uint256 tokenId) external view returns(bool);
```

ImageOnly selects an actual image native object and emits image with animation_url absent. MediaWithPoster selects non-script native media for animation_url plus a distinct separately committed image source for image. Initial supported records are compression=None only; compressed records must remain blocked unless a real registered decoder route is separately qualified. Script/unknown active-container execution remains the verifier route and is never admitted as static by a MIME-only guess. SDK classifies exact bytes; contract validates supported record MIME and commitments, without claiming a complete executable-content security scanner.

All edits call the selected host's authorization callback before read/write and recheck freeze afterward. Store only references/route flags; admission verifies record existence, code, compression, MIME and byteLength/digest; read verifies hauled length and SHA256. Reuse the current image-source behavior for poster/native canonical fallback. Explicit route/template/fallback precedence must be mutually unambiguous; a new selection cannot silently leave a different template active. Freeze snapshots every inherited pointer/route, including an intentionally empty selection, using the existing host namespace and atomic rollback semantics.

For an existing token, name comes from host.name() plus physical tokenId, description from collectionDescription(), authoritative manifest/digest from presentation(tokenId), context from harnessContext(tokenId). `presentation` calls module.imageURI, never module.tokenURI, so this graph can avoid recursion. Do not call it for default token0: the host checks ownerOf(0); the default-availability probe must return only configured=true/empty URI at token0. Actual tokenURI still checks existence in host. Preserve keel-manifest@2 fields/commitments and exact public context; omit animation only when explicitly selected. Dynamic collection subclasses may add private metadata attributes unavailable to this module: initially qualify only exact maintained generic Routed721 creation/runtime profile; never claim generic subclass parity. Outer URI must use maintained raw-percent grammar/helper; whole JSON/HTML Base64 is not a new lane. Native bytes may be encoded in return memory as the existing image module already does, never copied into paid metadata storage.

## Owned next-wave implementation and checks

New isolated Contracts branch from4015: only new module/interface/test files; no base/factory/library edit. SDK adapter/capability/catalog schema coordinated separately before edits. Test unchanged base module suite; exact image-only animation omission; nonimage poster identity and refusal of missing/duplicate poster; static/script/unknown handling; corrupted length/digest/compression; wrong module/collection/token/chain; authorization/owner/paused/default freeze/token freeze; callback-induced freeze/reentrancy; inherited-default snapshots; explicit clear/route precedence; unknown/mismatched runtime/profile rejection. Compare unchanged source/artifact hashes and evaluate EIP170, actual read/output/execution/state budgets. Independent review and clean QA remain required.

## Original incident and qualification ownership

The original 130296B GIF and separate191878B preview remain unchanged and separately committed. Their normal small-asset default can use the existing canonical native-image module route; new direct capability is not a prerequisite for that default. It still needs a complete corrected normal-SDK program and capacity proof, not only three standalone CREATE estimates. The selected deployed legacy factory and absent catalog module cannot be called capable.

Proposed division approved with RPC specialist: this specialist generates the actual SDK candidate/program identity in a separate evidence worktree; RPC specialist owns strict Geth/native witness execution/capacity. Use genuine proposed factory/library/module artifacts in explicit local counterfactual state, preserve original commitments, derive normal SDK calls rather than hand-editing the old program. Any synthetic adapters/receipt projections must be labeled local, never production receipt proof. No original full-program rerun before lead's candidate/source approval. Only after full exact normal program/return/gas and independent validation may a complete unsigned onchain request be considered.
