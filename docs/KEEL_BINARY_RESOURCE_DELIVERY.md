# Canonical binary resource delivery

Shared default and creator control: read [KEEL_PAYLOAD_STORAGE.md](KEEL_PAYLOAD_STORAGE.md). Native stored bytes and transient return encoding are separate; the prepared-COPY guard applies to prepared-COPY storage, not every native-composer response.

KEEL can store compressed resource bytes directly in Hold objects and present a small protected document containing their commitments. This optional `onchain-recursive` delivery profile avoids carrying each binary stream as Base64 in the returned HTML. It requires governed RPC access and is distinct from the self-contained `embedded-assembled` profile. Both profiles use the canonical SDK verification shell; creator code cannot install its own transport or replacement verifier.

## Minimal escaping and marketplace compatibility

Escape only characters that break the actual chosen parser. A single-byte HTML
file can carry compressed binary with minimal JavaScript/HTML escaping and a
byte decoder. That local file result does not establish a standard NFT return.
Compression produces arbitrary bytes; it does not make those bytes UTF-8.

Ordinary marketplace delivery parses the ABI string, metadata JSON, and
animation data URI before any shell decoder runs. A standard HTML prefix,
three-byte alignment, or HTML charset declaration cannot repair bytes changed
at those earlier boundaries. Require fatal UTF-8 validation of the exact return,
standard JSON/data-URI round trips, exact reconstructed byte lengths and hashes,
selected-chain read-back, and browser execution of the complete game shell.
Do not report a native HTML fixture as a marketplace-compatible tokenURI.

The retained REDLINE probe reconstructed 20 streams / 880,716 compressed bytes
from a 905,608-byte single-byte HTML file in the actual browser. Its escapes and
padding added 21,218 bytes. The ordinary ABI UTF-8 string path did not preserve
that file. A separate standard UTF-8 metadata/data-URI probe reconstructed the
same 20 streams without Base64 or a whole-payload hex conversion, but returned
1,814,231 bytes after required escaping. That probe excludes the original image
and complete game shell and is not live marketplace acceptance. These are
specific probe measurements, not universal size limits or publication approval.

Audit stored bytes, decoder/shell bytes, complete returned metadata bytes, and
read gas separately. If unchanged/no-expansion delivery and standard marketplace
compatibility cannot both be met, report the conflict before signing. Never
silently select Base64, hex, a custom checker, or a network loader.

## EVM-assembled Inline shared containers

The optional `embedded-shared-containers@1` resource profile reuses compressed binary Hold objects and includes each stored stream once in the complete `tokenURI` response. The EVM composer reads and verifies the selected table and raw objects, then emits the local payload table. Browser startup has no RPC reader or network fallback. This is `embedded-assembled` delivery; `onchain-recursive` remains Hybrid and must never be selected or relabeled by an Inline preflight.

Native payload return defaults to **as-is**. The current embedded composer emits Base64 and is therefore incompatible with that default. `buildCompactInlineKeelShell({codecProfile:"lzma-js", embeddedContainerDelivery:{chainId,store}})` rejects before building or publishing anything. It never silently selects encoding or Hybrid.

Only when the creator explicitly selects an encoded return, use `buildCompactInlineKeelShell({codecProfile:"lzma-js", embeddedContainerDelivery:{chainId,store}, binaryPayloadCarriage:"base64"})`. It returns canonical prefix, containerBridge, suffix and their SHA-256 commitments, with resourceProfile `embedded-shared-containers@1`. The bridge is exactly `];globalThis.__KEEL_ITEMS__=[null`. Existing independently revisionable descriptors retain their IDs, aliases, source commitments and byte ranges. Default shell preparation without this binary profile is unchanged. This explicit choice does not meet a no-Base64/no-hex/as-is requirement.

The EVM emits `{containerId,objectId,storedBase64,storedIntegrity}` for shared rows and `{objectId,storedBase64,storedIntegrity}` for standalone rows. The reader reconstructs the exact ordered ABI table `(uint64 byteLength,bytes32 digest,bytes32 objectId,bytes32 containerId)[]` and checks its SHA-256 against the revision-selected table artifact in the typed context. It checks every supplied stored payload before mounting, then full decoded-container and member SHA/length/range before execution. Bounded unused rows permit table-first superset revisions without decoding unused data; an unused declared binding may omit payload, but a referenced binding may not. Returned members are separate copies and repeated or concurrent decode failures are cached.

The exact 20-field context fixes collection/token/derived seed and seed source, composer Manager/module/code revision and table artifact identity. The EVM validates the typed presentation commitment; the browser validates the context schema/domain and independently replays the table/resource SHA commitments. It does not reconstruct the larger presentation ABI digest from the smaller JSON context. The shell waits for the appended context before mounting. The 2,000,000-byte complete-return ceiling and 30,000,000-gas limit for the full public tokenURI read remain unchanged, alongside selected-chain registered canonical shell and exact public contract read-back gates. A fixed already-minted presentation route cannot acquire this composer merely by relabeling its shell.

The complete storage and return inventory must include compressed raw objects, reusable shell objects, revision table/descriptors, image/context and protocol/carrier overhead. Returned Base64 bytes generated by the contract are not a second stored copy. Source preparation or local tests alone are not selected-chain publication or browser acceptance.

## Prepare the canonical profile

`buildCompactInlineKeelShell({ codecProfile: "lzma-js", onchainDelivery })` accepts the selected chain, Hold, RawBuilder, exact deployed Hold/builder SHA-256 code commitments and a governed RPC allowlist. An optional block hash fixes the read snapshot; otherwise the reader pins a canonical block at startup. Local HTTP is accepted only for explicit loopback hosts on chain 31337. The default call without `onchainDelivery` retains the embedded shell bytes and codecs.

Use `buildKeelOnchainContainerBinding` for an immutable compressed container, then `buildOnchainKeelViewerSlot` for each independently versioned resource. The builder verifies the supplied stored stream, decoded container and exact member range before producing a descriptor. Its fragment is a comma followed by canonical script-safe JSON; the normal raw-percent graph preparation applies the established two percent layers.

`parseOnchainKeelViewerSlotFragment` validates that decoded descriptor fragment. `validateOnchainContainerBindings` verifies canonical table identities. `resolveOnchainKeelViewerSlotBinding` resolves a table reference to its full object/range binding for host review. These APIs are exported from `@keel/sdk/verification-shell` and the aggregate SDK entrypoint.

## Storage and presentation are separate

Binary containers are sealed Hold objects with `ObjectCompression.None`: their payload is the exact compressed binary stream, with `application/octet-stream` media. Compression is a viewer descriptor field; Solidity never decompresses these bytes. The existing raw fragment policy applies only to the small immutable percent-prepared descriptors and canonical shell parts, never to binary containers.

An optional `containerBindings` table on an existing descriptor holds immutable content-derived container IDs. Member descriptors refer to a container ID and offset while retaining their own decoded source SHA-256 and length. This avoids another graph slot and repeated container commitments. The table is frozen before resolution. A later independent edit may publish a new standalone container binding in the changed resource descriptor; unchanged descriptors and their physical object bindings remain exact.

A full storage inventory includes binary payloads, shell/descriptor percent fragments, preserved image/context, object records, carrier STOP bytes and deployed protocol contracts. Returned HTML size is a separate figure. Runtime content URLs inside the verified child do not duplicate Base64 payloads in onchain storage.

## Read and revision safety

The canonical outer shell checks endpoint chain identity and one common canonical block on every fallback endpoint. It verifies deployed Hold/builder code and their binding, permanent `harnessRegistered(objectId,builder)`, sealing, strict bounded ABI records/pointers, immutable carrier bytes, full stored and decoded SHA-256 commitments, and member ranges/hashes before mounting creator content. It uses bounded request, response, object, decoded-byte and deadline budgets. Concurrent readers share one immutable-container decode; each returned member is a separate byte copy.

Publication-only `requireRegistration` is not used during reads, so pausing publication does not invalidate existing registered content. Canonical shell registration and completed raw fragment validation on the selected chain remain publication gates. The profile does not authorize a creator to register a canonical shell or select arbitrary locators.

Automatic revision preparation must parse the actual descriptor bytes and include a new referenced binary upload in the same 65,536-byte budget. A decoded resource that did not change keeps its exact descriptor/codec/object binding. Delivery/codec migration, container-table changes and larger uploads require explicit ordinary publication review. A caller-provided “already published” flag is insufficient; exact live binding evidence is required.

## Current local proof

The final REDLINE local Anvil v2 preparer reconstructed all 125 unchanged source resources from 20 real sealed/permanently registered LZMA containers, retaining their stable logical handles, exports, dependencies and order. It measured 880,716 binary payload bytes plus 223,230 shell/descriptor percent bytes: 1,103,946 bytes of content storage before image/context/object/carrier/protocol overhead. The canonical returned HTML was 155,442 bytes. These are local-chain read-back measurements, not a selected-public-chain deployment or browser acceptance claim.

Tests: `node --test tests/sdk-onchain-resource-reader.test.mjs tests/sdk-onchain-shell-profile.test.mjs` after the SDK build. Browser execution and selected-chain registration/read-back must be proved separately.
