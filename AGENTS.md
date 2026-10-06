# Hosted Studio is the default

Use https://studio.onkeel.io and the creator's existing Studio account for
preparation, previews, release drafts, contract review and wallet approval.
KEEL Desktop is entirely optional. Do not require it, another wallet setup,
or a separate signing page for the supported website workflow. Return the
server-issued project handoff or release `reviewUrl`; never sign through an
agent grant. Read `docs/KEEL_STUDIO_WALLET_REVIEW.md`.

**Full Inline delivery default:** At or below 2,000,000 bytes for the complete prepared tokenURI, default to embedded-assembled Inline: one public tokenURI call returns all shell, modules and assets; no follow-up browser RPC. Count the complete metadata/carriage/envelope, not only compressed files. Before that measurement, compressed size is a provisional estimate. Preserve explicit creator choices. Internal descriptor/carrier calls are not additional browser requests and still require the selected-chain gas check. Never silently switch to Hybrid to work around resource count.

# KEEL publication agent instructions

**New collector Inline binary default:** Use `buildKeelPreparedDenseCopyShell` from `@keel/sdk`: prepare escaped Base90 payload text and compressed shell Base64 literals at build time, upload one chosen representation for new work, and make `tokenURI` copy committed fragments. Never add a runtime payload encoder or a whole-document Base64 layer. Read `docs/KEEL_PREPARED_DENSE_COPY.md`. Keep explicit Raw/as-is and custom-shell choices intact. Existing native packs need an explicitly authorized transport migration and a separate new-storage quote; do not describe it as zero-upload reuse. Before publication, run the complete URI/MCP check, authenticate the registered composer/shell, and verify offline browser behavior.

**No encoded-return substitution:** An explicit native/as-is payload requirement for no Base64, no hex, unchanged files or no expanding encoding covers the contract return and HTML as well as storage. Do not claim compliance because Hold bytes are raw while the composer encodes them on read. The SDK refuses the Base64 embedded-container profile without an explicit creator-authorized `binaryPayloadCarriage: "base64"` selection; never add that selection to bypass an as-is request. Test actual source bytes, padding, ABI string decoding and browser data-URL behavior. If exact bytes do not survive, report the unsupported boundary and stop before signing. Do not silently choose Hybrid or a custom viewer. No prototype, size claim or padding recipe is considered working until the exact full-return and browser byte checks pass.

**Payload storage default:** Default payloadStorage is compact across SDK, MCP, editor and Studio. Store native bytes once; compare supported lossless codecs and keep none when compression does not save bytes. Raw is an explicit persisted choice that keeps supplied bytes unchanged and disables automatic compression; it is separate from viewer=none, Inline/Hybrid delivery and prepared URI carriage. Reuse unchanged onchain object IDs and publish changed resources only. For native compressed binary, use the registered reader/composer profile in docs/KEEL_BINARY_RESOURCE_DELIVERY.md, not a second stored Base64/hex copy. Contract return encoding and storage are different boundaries: read-time Base64 or hex output does not prove another paid stored copy. Fresh prepared-COPY UTF-8 text uses storedText/none with exact byte verification; its guard does not validate native binary composers. Read docs/KEEL_PAYLOAD_STORAGE.md and audit source, new/reused stored bytes, complete tokenURI bytes and call gas separately. Raw does not bypass byte integrity or selected-chain receipt/read-back checks. Canonical-shell evidence is required when the verification shell is selected or canonical protection is claimed; it is not required for explicit creator-owned HTML.

**Shell choice:** Shell choice is independent of payload storage. Default to the registered KEEL verification shell. If a creator explicitly selects viewer=none, preserve their creator-owned HTML shell and direct-artifact presentation through handoff, preview, preparation and publication; do not insert or label it as canonical protection. The same native-byte/no-duplicate storage policy applies to both. Existing explicit creator shell registration/selection APIs remain available for reusable custom shells.


For every onchain art, contract/viewer, collection, revision or mint request,
apply the SDK/MCP publication workflow for the persisted shell choice. Read
`docs/KEEL_PREPARED_COPY_ASSEMBLY.md` and its prototype/test map first.

- Existing objects: `keel-inline-reuse-plan`, exact ordered receipt/read-back
  commitments and the matching registered COPY builder. Zero new source bytes
  for assembly-only work. Do not migrate an existing aligned Base64 lane.
- New/changed source: use canonical SDK preparation; MCP
  `keel-inline-prepare` uses compact raw-percent COPY. Keep creator HTML, CSS,
  JavaScript and assets modular. The large body is prepared once and copied;
  encoding the small live envelope is a different operation.
- Before prepared-viewer `publish-plan`, run
  `keel-inline-publication-check` on the complete expected and returned URI.
  Supply its file evidence to `publish-plan`, which rechecks source SHA/length,
  chain/store and the full return. Keep actual receipt/public read-back,
  runtime registration and browser behavior as separate proof gates.
- Do not invent an unregistered transport, bypass environment
  variable or custom wallet script. A verified native-resource composer
  is a separate route; follow `docs/KEEL_PAYLOAD_STORAGE.md`. Creator permission to publish is not
  permission to substitute a different representation. Incompatible data
  needs a concrete correction plan, not a disguised prepared-copy object.
- Do not promise 900 KB or quote compressed pack size as tokenURI size. Report
  source, new/reused stored bytes and full returned bytes separately.

The SDK/MCP cannot intercept unrelated direct-wallet programs. A custom
publisher must verify the complete expected/returned URI and selected-chain
bytes before binding or minting. Require canonical shell records only when
canonical protection is selected or claimed; do not claim universal
enforcement from instructions alone.


### Optional information and prereveal modules

Keep Inline delivery unchanged when adding optional RPC information. Reuse the
governed KEEL RPC reader for marketplace/commitment enrichment; denial, offline
nodes or stale listing data must not delay artwork or change protected file
verification. Show only fresh token-specific listings; retain OnKEEL gallery.
For hidden-art/trait/seed-rule commitments use the optional `@keel/sdk/pre-reveal`
module and `keel-prereveal-prepare`, with separate private proof output. Read
`docs/KEEL_PREREVEAL.md`: pin the original registry revision and runtime, do not
mix its salted SHA-256 proof with OZ metadata leaves, do not publish salts/keys
early, and do not claim a recipe or burn-rule hash proves final pixels or a burn.
Reuse native sealed/layered envelopes and compact attribute pages. Enable this
feature only when the creator chooses a prereveal; it adds no required network
dependency or authority to the canonical file proof.
