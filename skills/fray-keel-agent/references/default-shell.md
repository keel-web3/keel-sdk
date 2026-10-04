# Canonical KEEL verification shell

**Shared storage and shell policy:** Default payloadStorage is Compact: native bytes stored once, beneficial compatible lossless compression, no generated encoded sibling. Raw preserves supplied bytes and intentional creator formatting. Shell selection is independent. Default to the registered KEEL verification shell; explicit viewer=none preserves creator-owned HTML/direct artifacts without a canonical protection claim. Requirements below for canonical shell records, protected K, and canonical mounting apply to the verification-shell choice. Native-container composers require native storage inventory, decoded source and selected-chain reader proof; their transient return encoding is not another stored copy. Read `docs/KEEL_PAYLOAD_STORAGE.md` and `docs/KEEL_BINARY_RESOURCE_DELIVERY.md`. Persist both choices and reject unsupported readers instead of silently changing storage or presentation.

Read this before staging any collector-facing viewer.

**Existing work starts with `keel-inline-reuse-plan`, not preparation or upload.**
Read [KEEL_PREPARED_COPY_ASSEMBLY.md](../../../docs/KEEL_PREPARED_COPY_ASSEMBLY.md).
Preserve the exact prepared objects and the registered builder that accepts
them. An existing bound Base64 lane is supported COPY reuse, not a migration
target merely because new preparation defaults to raw-percent.

## Default verification-shell route

Omit `viewer` in `keel-studio-stage-project` when the creator supplied no shell
choice. Studio resolves the registered `keel-verification-shell` from the
selected chain's active Inline catalog. Supply creator resources and exact
module declarations without copying the canonical shell. Explicit viewer=none
uses the creator-owned HTML route described below instead.

This default is the collector-friendly K/Stratus experience: the protected K
opens Proof, Files, and Trail; the panel docks on the right without covering the
art on desktop and becomes a bottom sheet on mobile. It also owns the frozen
data-only `keel-shell-plugin@1` API. If those behaviors are missing, the agent is
not looking at the canonical default and must stop instead of authoring one.

For the verification-shell route, never:

- author, copy, shrink, fork, relabel, or upload a replacement canonical shell;
- label creator `index.html`, Vault Arcade, Ghost Flash, or another demo as
  the registered canonical shell;
- infer readiness from an old deployment journal, another builder address, or
  historic `protectorPrefix`, `protectorSuffix`, `protectedHarnessDataURI`, or
  `NoProtector` state;
- manufacture a local fallback when the shell or module catalog is incomplete.

For the verification-shell choice, Studio resolves the active
`keel-harness-builder`, derives the stable canonical Inline protection shell
ID through the SDK, then verifies the exact registered
prefix, suffix, metadata, existence flag, and `PreEncodedGraph` mode. A missing
or ambiguous record is a safe stop.

## Project content is not shell content

- A static image/video/self-contained GLB becomes direct creator media inside
  registered `keel.asset-display@1` and the registered shell.
- p5, Three.js, Doom, and Flash projects stage creator code/assets and bind
  registered runtime modules inside the same shell.
- Creator-authored HTML is valid artwork content in the shell's opaque child
  frame. Its filename can be `index.html`; its role is still project content.
- Explicit `viewer: "none"` means no KEEL-provided wrapper. One self-contained
  UTF-8 creator HTML entrypoint owns its presentation and is prepared with
  `buildKeelCreatorOwnedInlineDocument` for raw-percent Inline delivery and
  `presentationPolicy: "raw-artifact"`. This initial route rejects separate
  creator files, modules, assets, and declared runtimes rather than adding a
  canonical or network wrapper. Persist the choice and describe it as a
  creator-owned shell, without canonical K/Proof/Files/Trail protection.
  Compact/Raw is independent; Raw preserves deliberate creator formatting.
  The immutable artifact remains releasable, mintable, and contract-readable.

The registered verification shell owns the protected UI and proof state.
Its creator child cannot rewrite the shell's K control, proof result, or
outer panels. These protected-interface claims do not apply to viewer=none
creator-owned HTML; test that presentation without asserting canonical K.

When working in the SDK repository, use
`docs/KEEL_VERIFICATION_SHELL.md` as the canonical implementation and security
map. Cross-link it; do not copy its source or generated HTML into a project.

Registering a different reusable presentation shell is a separate explicit
action using reviewed immutable objects and `keel-shell-prepare`; it cannot
overwrite the default shell. Once registered and indexed, any creator may
explicitly select that compatible shell. It is never an automatic fallback for
ordinary project preparation.

## Prepared COPY and separately revised shells

`KeelHarnessBuilder.preEncodedTokenURI` copies the exact prepared graph between
small live metadata boundaries. Its `preparedTokenURI` route can resolve the
registered shell and copy top + prepared body + bottom. Build-time legal
whitespace aligns the ASCII slices; the large body is never Base64-encoded
again inside `tokenURI`. Keep the original padding, media, chain/store,
ordered IDs, digests and registration. Padding raw binary alone cannot make it
an accepted prepared body.

For SDK assembly-only work, use `inspectKeelInlineExistingObjectReuse` and
`existingObjectReuse: { mode: "assembly-only", chainId, store }`. For MCP work,
call `keel-inline-reuse-plan` first. Both inspect exact read-back bytes and must
return zero new source publication bytes; selected-chain receipt, builder,
shell and authority proof remain independent gates. Prepare only explicitly
new or changed source. A fixed consumer cannot switch its builder through a
shell revision.

## Existing compressed binary objects and Inline

Inline must include the work bytes in the EVM tokenURI response. `onchain-recursive` is Hybrid browser-RPC delivery and cannot satisfy that requirement. Do not change labels or publish a locator-only shell as an Inline fix.

The optional canonical `embedded-shared-containers@1` resource profile reuses raw compressed Hold objects through a registered EVM composer and a revision-selected ABI packtable. `buildCompactInlineKeelShell({codecProfile:"lzma-js",embeddedContainerDelivery:{chainId,store}})` returns canonical prefix/containerBridge/suffix. The composer emits each pack once; the offline shell checks table/stored/decoded/member SHA and context before mounting, without a browser transport. Preserve resource handles and exact unchanged descriptors; changed resources may use new standalone rows. Verify the selected-chain registered shell/composer/module/table bindings, full return bytes/gas and no-network browser behavior before claiming Inline readiness. A shell update cannot replace a permanently bound presentation module. This optional official source profile is not permission to create a project verifier or substitute unregistered bytes. It is not the prepared-copy default and cannot be selected automatically to repair incompatible existing fragments.
