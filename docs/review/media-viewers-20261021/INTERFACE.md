# PUB-301/302/303 — bounded discovery and interface proposal

Source base: SDK `7730e3150b7ec6da69913a779273fdb981d7fff3`. Isolated branch `codex/media-viewers-20261021`, checkout `/private/tmp/keel-media-viewers-20261021-01/keel-sdk`. Sprint1 snapshots remain read-only. This is source discovery and a proposed interface, not publication or registration evidence.

The source-discovery hash inventory is `/private/tmp/keel-media-viewers-20261021-01/evidence/source-discovery-hashes.json`, SHA256 `08bcc368c55bcc412423f448315df77942aed052fe20fb3cc1db4b1d70cc1945`. It binds the actual SDK adapter, graph, shell, vendor runtime and current KEEL engine player source.

## Existing implementation and reuse

- `asset-display.ts` revision1.2.0 (7810 decoded bytes) mounts GIF/PNG/JPEG through native images, but WebP/AVIF through one canvas draw. It has no audio/SVG declaration and renders only the first GLB primitive with a flat shader.
- Exact Three r180 main/core modules already exist:338908+381124 decoded bytes, MIT, with pinned upstream hashes in `three-module.ts`. Their declaration is not proof of selected-chain registration.
- KEEL engine `c81d50447df21af1b5fcd066e46122ae252020c3`, `packages/import/src/styled-asset-player.ts`, delegates the full scene, textures/materials, skinning, morphs and source clips to Three r180/GLTFLoader. This maintained host adapter is tooling-only and includes styled-art processing; it cannot be labelled a registered collector runtime or copied wholesale into GIF publication.
- The pinned official r180 GLTFLoader supports complete glTF2 scenes. It depends on Three and BufferGeometryUtils. OBJ and MTL require their own optional loaders. Preserve upstream MIT notices and independently pin source and reproducible compiled hashes.
- Selected Sepolia RPC read reached block11965192. Studio library/module searches for Three, glTF and asset-display each returned401. Those access routes were stopped. Empty results do not establish absence. An authorized catalog receipt/inventory is required before choosing registration or preparing any module transaction.

## Ownership and first correction

Exclusive proposed implementation files: `packages/sdk/src/asset-display.ts`; new `packages/sdk/src/media-viewer-adapters.ts`, `packages/sdk/src/model-viewer-module.ts` and scoped loader descriptor/source files; focused tests and this evidence directory. Package exports and root integration need lead coordination. Do not edit Studio, protocol, registry records, immutable references or frozen SDK snapshots.

The first PUB-302 correction retains the verified native image element for animated or inconclusive WebP/AVIF, while preserving the existing PNG-export canvas for containers that prove a still. It does not re-encode the retained original or add a decoder/Three dependency. The later proposed audio adapter uses native controls with gesture-driven playback; proposed SVG admission requires inspected non-executable, self-contained image semantics. Executable/dependency SVG must preserve intended execution through a verified content path or fail explicitly. MIME, observed motion and resource roles are distinct from artwork category. No500KB policy changes belong in this adapter patch.

## Proposed existing-protocol module ABI

The existing frozen `__KEEL_ENTRY__` descriptor and verified `__KEEL_CONTENT__.bytes/url/resources` remain the source boundary. Exact registered modules are selected by inspected type/features and immutable version/digest. A small native-media adapter has no3D dependencies. A separately selected3D adapter reuses the exact Three main/core plus only the required loader/decoder modules. The full graph, including all returned occurrences, is measured before policy selection.

The model adapter consumes the already verified module exports in `__KEEL_MODULES__` and the original entry/dependency byte map. Three/GLTFLoader owns scene traversal, transforms, materials, textures, skinning, morph targets and source animation. No replacement geometry renderer or implicit static conversion is proposed. URI resolution is restricted to exact declared verified resources. A pinned in-memory file/image loader adapter must avoid network fetches, including blob/data fetches blocked by the current `connect-src 'none'` policy. Native image decoding and verified in-memory buffers can preserve that policy. Unknown required extensions or absent decoders fail before publication; they are not silently ignored.

Two current shared interfaces require lead approval/ownership before implementation: `inline-viewer-graph.ts` presently permits exactly one asset-display module and no additional assets for direct media; `verification-shell.ts` direct-media classification excludes audio and general glTF/OBJ. General3D needs typed admitted dependency graphs, while audio needs the existing direct-media classification extended. No generic guard removal or arbitrary-module admission is proposed.

The lead subsequently approved exclusive changes in this isolated branch to those graph/shell files, package exports and root index for the typed exact-closure interface. They remain unchanged in the first native-raster checkpoint. The lead also approved two additive suite registrations: the adapter test in the deterministic cohort and actual Chromium test in the browser cohort. Existing suites remain classified and intact. Work on3D is held for the next team wave after this checkpoint freezes.

## Verification scope

Capture the current animated WebP/AVIF flattening in real Chromium before the correction; replay exact source bytes after it. Check multiple distinct frames, timing, alpha and looping, alongside still-image and audio/SVG negatives. For3D use genuine complete multi-mesh/transformed/textured/animated GLB data and declared-resource glTF/OBJ fixtures; test skins/morphs and missing dependencies/extensions. Normal graph/shell execution and actual browser pixels over time are required, with independent QA later. Parsing headers or a mock renderer is insufficient. New module registration requires a concrete independently reviewed unsigned packet and owner action; no signing/publication is authorized here.
