# KOC1 v1 — `koc1@1`

Frozen normative transcription and byte conventions, 2026-11-08. Source:
`ordinals-orchestra/sprints/RESEARCH/keel-ordinals-service-spec.md`, round 3,
§§1.3–1.6, 1.9, 1.11–1.12, under the owner-approved KOC1 plan K0.
`vectors/source.json` pins the source SHA-256. The research appendix is historical;
the sprint requires a Python second implementation in K1, not a Rust dependency.

This is a specification and synthetic conformance suite, not a deployed service,
Bitcoin script execution test, independent implementation, or trust-review approval.
The escalations below remain open; freezing these bytes does not resolve them.
Only testnet4 is supported here (private regtest is allowed for tests). No ord
client, public-network node, signing, broadcast, GPU job, or wallet is needed.

Every normative requirement has one stable identifier below. Vectors cite those
identifiers in `rules`; the checker rejects missing or unknown citations. Source
section references identify the rule being transcribed. Decisions specify missing
wire details without granting any additional actor authority.

## Wire data and recipes

- **KOC1-R1** (§1.3): Every KOC1 inscription MUST set ord tag 7 to UTF-8 `koc1`, and tag 5 to CBOR metadata with `p:"koc1"` and its operation. Operations are `recipe`, `mint`, `index`, `challenge`, and the control/registry/pin operations explicitly described below. Tag 7 is odd. Mint canonical form is more restrictive (R7–R8).
- **KOC1-R2** (§§1.2–1.3): Recipes and mints MUST have a zero-value marker script `6a284b4f4331 || recipe36`; recipes use 36 zero bytes. An inscription ID/outpoint36 is internal-order txid32 followed by u32 big-endian index, not a textual inscription ID. Ord delegate/parent tags use ord inscription-ID encoding (D30), not route36. All KOC1 committed heights, ranks and transaction indexes use u32 big-endian; hashes in commitments use internal byte order.
- **KOC1-R3** (§1.4): A recipe MUST be immutable, identify `p`, `op`, `v:1`, `network:"testnet4"`, end, F (`finality`), W (`challengeWindow`), integer-satoshi price, payment, metadata, art, original writers, quorum, pinned indexer, and explicit nullable registry/bridges/checkpoint fields. It is identified by its inscription ID, not its name. Recipes themselves use R1–R2.
- **KOC1-R4** (§§1.4–1.5): A recipe MUST use one of supply/time/first/open; supply/first require positive max, time/first require close, and open editions have no max or over-cap. A close, if present, is at least open. Blind metadata requires a finite end. Unbounded editions use a generator or explicit cycling of a nonempty committed metadata tree.
- **KOC1-R5** (§1.4, S5): A recipe MUST reference existing bundles, viewer and indexer source with exact SHA-256 hashes at or before its height, and earlier in transaction order when in the same block. The recipe is invalid if a reference is missing, late or mismatched; minting requires its confirmation strictly before open. Metadata bundles cover the committed leaf range without gaps or overlaps.
- **KOC1-R6** (§§1.4, 1.6, 1.9.4): A recipe MUST fix its distinct original writer authorities and quorum, with `2 ≤ q ≤ k`. Escrow fixes exactly three distinct valid x-only writer keys and a valid treasury key; the keys belong to the named writer operators. Registry additions never alter this quorum or these escrow keys.

## KOC1-MINT and numbering

- **KOC1-R7** (§1.5): A mint MUST reveal exactly one ord 0.29.1 envelope, on vin[0], spending its holder-funded P2TR commit via the envelope leaf. Commit key-path cancellation remains available. There is one mint per transaction.
- **KOC1-R8** (§1.5): The mint envelope MUST use canonical push-only fields, tag 7 `koc1`, tag 11 equal to the recipe viewer ID, and tag 5 `{p:"koc1",op:"mint",r:recipe36,m:minter32,ch?,seen?}`. It has no pointer tag 2, no other even tag, no duplicate non-chunked fields, and an empty body. The content claims no token number.
- **KOC1-R9** (§1.5): A mint MUST be ignored if its inscription charms contain `cursed`, `unbound`, or `reinscription`; funding from an inscribed sat is excluded by the latter check.
- **KOC1-R10** (§1.5): A mint MUST put recipient value ≥330 sat at vout[0], payment at vout[1], and its sole KOC1 marker at vout[2]; change starts at vout[3]. The member sat comes from the canonical first-input/zero-pointer reveal.
- **KOC1-R11** (§§1.5–1.6): Payment MUST be at least price, to the exact escrow P2TR script derived from m and recipe keys, or to the recipe treasury script in explicit direct mode. An otherwise similar script or key set does not pay this recipe.
- **KOC1-R12** (§1.5): A mint MUST be confirmed while the valid, previously confirmed recipe is open at its height. Before-open, paused, post-close and later-than-sell-out-block reveals are non-members; their otherwise valid-form payments remain eligible for refunds.
- **KOC1-R13** (§1.5): Indexers MUST ignore invalid inscriptions and unconfirmed reveals for numbering, sort by `(height,txIndex)`, and assign rank `N = 1 + earlier valid mints`. Fee, arrival order, host-specific absolute inscription number, and any claimed rank do not affect consensus. Relative blessed inscription numbers may order entries within the same block only.
- **KOC1-R14** (§1.5): A valid mint MUST be a member exactly when `N ≤ cap(h)` (or for an open edition). Remaining valid mints in the sell-out block are over-cap. Metadata is determined by recipe and N; burns and payment refunds do not renumber members.
- **KOC1-R15** (§1.12): Metadata implementations MUST compute `leaf(N,m)=SHA256(00 || "KOC1" || u32be(N) || SHA256(exact UTF-8 m))`, and `node(l,r)=SHA256(01 || l || r)`. Odd nodes are promoted unchanged. Proofs carry the side of each sibling; no padding sibling is invented. Direct/cycling metadata uses N or `((N−1) mod count)+1` respectively.
- **KOC1-R16** (§§1.5, 1.12): Blind metadata MUST use seed `SHA256("KOC1/perm" || recipe36 || blockhash(endHeight+F))`, then the Fisher–Yates procedure in D5. Token N uses one-based leaf `perm[N−1]`. Before that hash exists, the mapping is pending.
- **KOC1-R17** (§1.5): Chain finality MUST require F confirmations; number displays still obey quorum and W (R40–R41). Reorgs before finality recompute positions. No absolute immutability against a deeper Bitcoin reorg is claimed.
- **KOC1-R18** (§1.5.1): Supply mode MUST stay open from open through the block containing mint #cap; time mode uses inclusive `[open,close]`; first mode ends at the earlier of those ends; open mode uses `[open,close]` if close exists, otherwise indefinitely. Controls may shorten or pause these windows.
- **KOC1-R19** (§1.5.1): Writers MUST stop window scans only once `endHeight+F` is settled at quorum; then headers and burn status suffice. Unbounded open editions continue scanning while writers run.

## Creator controls and escrow

- **KOC1-R20** (§1.5.3): Controls MUST be authenticated recipe children with `{p:"koc1",op:"control",r,action,cap?,at}`, processed in child order, and `at ≥ confirmHeight+notice`. Malformed or unauthorized controls are ignored. Missing controls mean no creator controls (D8).
- **KOC1-R21** (§1.5.3): An accepted close MUST end minting at its inclusive `at` height permanently. Later controls are ignored and no control extends an existing close.
- **KOC1-R22** (§1.5.3): An effective lowerCap MUST only lower the cap without evicting existing members: at `at`, use `min(oldCap,max(requestedCap,validCountAtAt))`. A requested cap not below the previous cap is ignored. Open editions have no lowerCap operation.
- **KOC1-R23** (§1.5.3): Pause/resume MUST require `pausable:true`, notice, and no accepted prior close. Mints in `[pause.at,resume.at)` are invalid for numbering and refundable; repeated pauses or resumes are idempotent.
- **KOC1-R24** (§1.5.3): Implementations MUST ignore supply raises, close extensions, changes to price/rules/keys/metadata, malformed controls and all controls after an accepted close. Pending controls are exposed with their effective heights.
- **KOC1-R25** (§1.6): Escrow P MUST use BIP341 NUMS internal key and BIP342 leaves: `L_t = <collectAfter> CSV DROP <treasury> CHECKSIGVERIFY <w1> CHECKSIG <w2> CHECKSIGADD <w3> CHECKSIGADD 2 NUMEQUAL`; `L_m = <refundAfter> CSV DROP <m> CHECKSIG`; optional `L_e = <m> CHECKSIGVERIFY` followed by the same 2-of-3 writer suffix. D6 fixes tree shape and encoding; addresses use testnet4 `tb` Bech32m.
- **KOC1-R26** (§1.6): Escrow timelocks MUST count blocks relative to P's creation in the reveal, with `collectAfter ≥ W` and `refundAfter > collectAfter`; use block-based BIP68/112 delays (1–65535), transaction version ≥2, and no disable/time flag. Refund opens at h+refundAfter; collection opens at h+collectAfter.
- **KOC1-R27** (§1.6): Writers MUST co-sign collection only for quorum-covered members at depth ≥W with no unresolved valid challenge; early refund requires the buyer and two writers attesting settled non-membership. Script consensus enforces signatures and CSV, not membership. Two writers plus treasury can collude; the canonical index and L_t spend are the public misconduct evidence.
- **KOC1-R28** (§1.6): The buyer refund MUST remain available without writers after refundAfter if P is unspent. Optional L_e allows earlier refund for over-cap, paused or post-close losers. Failure to collect a member is the treasury's loss; refund never cancels membership. L_t remains script-spendable after refundAfter; the two paths race for the same output.
- **KOC1-R29** (§1.6): Direct payment MUST require explicit non-refundable opt-in. Stuck/unconfirmed commits reserve no supply; their owner may cancel by commit key path, RBF or CPFP. Writer-operator rotation transfers the authority and the fixed escrow key; it does not replace recipe keys.

## Writer chains, commitments and challenges

- **KOC1-R30** (§1.9.0): Readers MUST take updates only from children of each accepted authority in child order. The first accepted update has prev=null. Later updates name the previous accepted ID, restate its root and extend its entries; non-extending updates are ignored. The full list concatenates each update's `new`.
- **KOC1-R31** (§1.9.0): Two updates sharing prev MUST be treated as equivocation: first in child order wins, later ones are ignored, and both IDs are published as evidence. A malformed first child cannot block a later valid update.
- **KOC1-R32** (§1.9.0): A writer chain MUST pass through every `(writerIndex,updateId,root)` in the token's seen metadata and authenticated `koc1-pin` children, or that writer is ignored for that token, including quorum. Browser storage is not ratchet evidence.
- **KOC1-R33** (§1.9.1): Index commitments MUST use `memberLeaf(N)=SHA256("KOC1/m" || u32be(N) || revealTxid32 || u32be(height) || u32be(txIndex) || m32 || paymentOutpoint36)` and the R15 node/promotion rules. `indexRoot=SHA256("KOC1/i" || recipe36 || u32be(h) || blockhash(h) || u32be(memberCount) || membersRoot || overRoot)`. D4 fixes empty roots and refund leaves. Deterministic indexers read only chain data, no clock or mutable network state.
- **KOC1-R34** (§§1.9.2, 1.11): Index updates MUST bind recipe, covered h, matching blockhash(h), root, count, over, prev, ordered new entries and applied challenge IDs. A host-chain hash mismatch rejects the update. `fork`/`next` do not grant shell pointer authority; a correction is linked to its locally computed patched root.
- **KOC1-R35** (§1.9.3): An omitted challenge MUST identify a KOC1-MINT-valid missing entry at height ≤U.h, prove its txIndex with a Bitcoin txid branch to the bound header, and match the host block hash at that height. A present, late, invalid or unbound entry is not an omitted challenge.
- **KOC1-R36** (§1.9.3): An invalid challenge MUST identify an entry actually in U that fails KOC1-MINT or whose claimed `(height,txIndex)` is disproved. A valid entry at its proven location cannot be deleted.
- **KOC1-R37** (§1.9.3): An order challenge MUST prove two entries in U are out of `(height,txIndex)` order using their bound-header branches. Correctly ordered or unproven pairs are ignored.
- **KOC1-R38** (§1.9.3): A valid challenge MUST insert, delete or sort deterministically, then recompute ranks, caps and indexRoot. Later ranks shift by insertions minus deletions before them; this may move the final member over cap or pull an over-cap mint in. Invalid and repeated challenges are no-ops.
- **KOC1-R39** (§1.9.4): Shells MUST merge the verified union of accepted writers, valid challenges, self and reachable ch mints; deduplicate by reveal txid and sort by `(height,txIndex)`. Self validity does not depend on a writer including it. Fake entries are rejected; completeness still requires an honest reachable source or audit.
- **KOC1-R40** (§1.9.4): Covered height C MUST be the q-th highest h of usable original writers; fewer than q yields no settled height. Registry writers cannot vote. Entries at height ≤C are settled, above C provisional. One racing original writer cannot settle alone.
- **KOC1-R41** (§1.9.4): A shell MUST label a member final only when `member.height+W ≤ C` and no valid challenge against a settled block remains unresolved. A number pin is a rechecked cache, never an independent authority.
- **KOC1-R42** (§1.9.4): Registry processing MUST accept only authenticated well-formed additions, first 16 distinct authorities in child order. Additions supply entries and challenges only, never remove originals, and never change quorum. Burning the registry freezes additions. Below q live originals, writer-based settling stops.
- **KOC1-R43** (§§1.9.2–1.9.4): Shells MUST discover through named original/registry authorities, own children, ch, fragment and audit; they cannot search or follow an arbitrary corrected chain as an authority. Honest writers publish every valid challenge learned. Holders may carry challenges and number pins as children. A fragment supplies checkable evidence, not quorum votes.
- **KOC1-R44** (§1.9.5): A light marketplace MUST verify challenge evidence and compute the patched root locally before following next; only an exactly matching corrected root permits switching. A full indexer computes the canonical root itself and treats caches as cross-checks. Completeness in light mode still depends on challenge discovery.
- **KOC1-R45** (§1.9.5): A marketplace MUST show verified only for a valid recipe, current-index member, depth ≥F, and not burned; final additionally requires W and no unresolved valid challenge. Content/delegate appearance alone grants no badge.

## Shell conformance (S1–S14)

- **KOC1-R46** (§1.11, S1–S5): The shell MUST derive self from location, re-hash stripped raw reveal bytes to txid, recompute canonical fields/marker/payment, check height and charms, and authenticate the recipe references. S2 does not authenticate witness bytes: see E1. A fixture passing these checks is not a complete chain inclusion proof.
- **KOC1-R47** (§1.11, S6–S8): The shell MUST check depth and own ordering. Optional S7 hashes the 80-byte header to blockhash(h), checks target bits/PoW and linked successor headers; S8 uses a txid branch or relative same-block inscription numbers. Missing evidence leaves the associated claim pending. Host best-chain choice remains trusted.
- **KOC1-R48** (§1.11, S9): Position checking MUST recheck preceding entries under S2–S4, all for ≤1000 members; above 1000 the research permits sampling plus invalid challenges, which is a sampled claim and cannot be called exhaustive verification. This exception does not change full-indexer validity.
- **KOC1-R49** (§1.11, S10): The shell MUST verify challenge evidence on each reachable channel, process at most 32 challenges per load, and page updates. Resource exhaustion is pending/incomplete, never proof of completeness or invalidity.
- **KOC1-R50** (§1.11, S11): Testnet4 audit MUST be enabled by default; it scans window blocks, binds each header to host blockhash(h), and recomputes the Bitcoin txid Merkle root from all stripped transactions. Bitcoin duplicates an odd node, unlike R15, and rejects mutated duplicate-pair trees. S11 remains optional in the research's general shell profile; no other-network profile is provided here.
- **KOC1-R51** (§1.11, S12–S14): The shell MUST read owner/output/burn charms, check metadata paths and exact art/bundle hashes, and require the existing KMP1 Groth16/light-client path for bridged members. Native current means member and not burned. Escrow spent status is a separate indexer/spender read, not inferred from ord inscription recursion. These vectors do not implement or approve a new bridge.

## Decisions

Each item records a research ambiguity and one convention. Fixture-only choices are
explicit; they do not become extra trust evidence or hidden protocol defaults.

| ID | Ambiguity | Decision |
| --- | --- | --- |
| D1 | Text IDs versus 36-byte IDs; hash endianness unspecified outside the outpoint example. | Text `<display txid>i<index>` maps to reversed txid bytes + u32be(index). Header/txid/blockhash commitments use internal bytes. Hash digest outputs are printed directly as hex. |
| D2 | Metadata CBOR serialization, duplicate tags, odd tags and canonical pushes. | Encode definite-length CBOR with shortest integers, byte-string IDs/keys, and UTF-8 keys ordered by encoded length then bytes. Decode semantically valid definite CBOR; map key duplicates are invalid. Tag 5 chunks concatenate in order, each ≤520 bytes. Other tags cannot repeat. Unknown odd fields are allowed; even fields are forbidden for mints. Tag numbers use minimally pushed little-endian bytes; empty OP_0 starts the body. OP_1..16 are not field pushes. |
| D3 | Recipe shape ranges, omitted defaults, optional ops omitted from §1.3's list. | No implicit F/W/price/end defaults. Integers are exact unsigned u32, price is nonnegative safe-integer sats; F,W ≥1. Treat §1.5.3/1.9's control/writer/pin records as explicit additional ops. Unknown recipe fields cannot mutate known semantics. Optional controls absent means disabled. |
| D4 | Empty Merkle tree and overRoot leaves are undefined; stateRoot is historical. | Empty root = 32 zero bytes; singleton root = leaf. Refund leaves use the same `KOC1/m` tuple with N equal to their one-based rank among sorted refund candidates (over-cap, paused and late otherwise valid-form mints), under the separately committed overRoot. This includes no malformed/unpaid or before-open reveal; before-open payments still have their unconditional script refund. count is member count, over is refund-candidate count. Round-2 stateRoot is not a round-3 wire commitment. |
| D5 | Fisher–Yates direction, random stream, integer width and modulo are absent. | Start [1..max]; for i=max−1 down to 1, j=uint256be(SHA256(seed || u32be(i))) mod (i+1), swap i,j. No rejection sampling. This exactly reproduces §1.12; it is a frozen completion, not evidence of the original unrecorded generator. |
| D6 | NUMS value, tree shape, leaf version, script numbers, writer sorting and address HRP. | Use BIP341 H=`50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0`, leaf version c0, minimal signed-magnitude script numbers, recipe writer-key order, tree `branch(L_t,branch(L_m,L_e))` or `branch(L_t,L_m)` without early refund. BIP341 sorts child hashes at every branch. Addresses use Bech32m tb, witness v1. |
| D7 | No exact relation between finality confirmations, W and h..h+F. | F confirmations at tip means tip−h+1 ≥F. Shell final uses the stricter explicit h+W ≤C formula. Optional linked-header fixture checks through h+F; no work-based finality default is invented. |
| D8 | Close boundary and lowerCap at the same height are underspecified. | Close is inclusive, matching the time-end table; pause starts inclusive and resume exclusive. Controls authenticate child linkage independently of metadata. Apply accepted controls in child order even before at; close seals later controls immediately. LowerCap snapshots all valid mints in its effective block (including later tx indexes), clamps to old cap, and preserves members. |
| D9 | Lowering below existing count, supply already sold out, raises on open editions. | Use R22's no-eviction clamp. Supply sell-out is irreversible after its block; controls never reopen it. Open editions reject lowerCap instead of inventing a cap. |
| D10 | Control effective heights may not increase in child order. | Evaluate active controls at each block in child order; same-height actions follow that order. A future close still prevents accepting subsequent controls, per the explicit 'any control after a close' rule. |
| D11 | prev root is required by prose but missing from index CBOR example; h regression, duplicates. | Add `prevRoot` (null at genesis). h is nondecreasing. Root/count/hash/new data are locally checked. Repeating a txid across new entries or an update that is not an append is invalid. Omitted entries may still exist in a structurally valid cache and are challengeable. |
| D12 | An append-only writer cannot insert an omission before earlier entries. | Keep immutable announced `new` history; derive a corrected working set by replaying the validated `applied` challenges before recomputing the update root. Never erase previous history. Duplicated applied IDs are no-ops. See E2. |
| D13 | Order challenge example contains only one mint/branch. | `mint,height,txIndex,branch,header` describe the first entry; an additional `other` object carries those same fields for the second entry. Both prove inclusion; no inferred second proof. |
| D14 | Branch representation, byte order and odd Bitcoin tree levels. | Bitcoin proof branches are internal 32-byte hashes; txIndex bits select left/right at each level. Header merkle_root is bytes 36..68. Bitcoin uses SHA256d pairs and odd duplication, with total tx count required to bound the index and branch depth. |
| D15 | Invalid challenges mix bad form and false coordinates. | Require actual membership in the disputed cache and independently checked form/location. A missing API response is unknown, not proof of invalidity. Paused/late paid reveals are refund entries, not member entries. |
| D16 | Deduplication, writer credibility, registry burn cutoff and missing votes. | Identity is reveal txid (one mint per tx). Deduplicate registry authorities, skip originals, and apply additions existing by the burn height; later children are rejected. Bad individual entries are discarded; no unspecified permanent reputation penalty is added. Missing/ratchet-rejected writers cast no vote; q stays fixed. |
| D17 | No numeric entry/page cap, sampling algorithm or challenge overflow behavior. | Fixtures use pages of at most 1000 new entries and a 32-challenge load budget; reaching either cap yields incomplete/pending and resumes paging. Above 1000, vector policy tests label sampled verification only; no specific sampling algorithm is frozen. |
| D18 | ch/seen/pin schemas and size limits, number pin authority. | ch is a list of inscription IDs; seen/pin commitments are triples naming an original writer index, update ID and root. Malformed values are rejected. Number pins are rechecked against merged state; no browser-memory fallback. Limits other than R49 remain transport policy, with incomplete status on truncation. |
| D19 | Self insertion versus provisional membership and over-cap validity. | Self passes form/window checks, then joins the union before ranking; self validity alone does not prove a member rank. Sell-out-block over-cap entries remain valid mints but non-members; paused/late entries are refund candidates only. |
| D20 | Explicit direct opt-in and key ownership proofs are not wire fields. | Record opt-in in preparation; compare actual payment script onchain. Recipe author attests operator association; these fixtures check key validity/distinctness, not offchain identity. No new signature or key registration protocol. |
| D21 | Bridge/generator/checkpoint formats are external; finite metadata versus max. | Preserve the referenced existing protocols without new wire formats. Merkle finite supply needs count ≥max (or explicit cycle); bundles are exact byte inputs. Generator/bridge/checkpoint execution is out of this native vector suite; policy vectors enforce delegation and no substitute proof. |
| D22 | Writer collection after refundAfter and collection 'between' delays. | CSV has a lower bound only. The script allows L_t forever after collectAfter until spent; refundAfter opens L_m, rather than disabling L_t. Treasury policy aims to collect earlier, without claiming an unenforceable upper lock. |
| D23 | 'One honest writer', sampled entry checks and 'no-trust' light mode overstate guarantees. | Preserve reachable-source/challenge assumptions explicitly; sampled checks are not exhaustive, and a patched light root is not a completeness proof. No quorum is invented for completeness. |
| D24 | Marker value and non-minimal OP_RETURN forms. | Freeze the exact script bytes in §1.3; zero sat marker value is the canonical construction. Non-minimal PUSHDATA markers do not match it. |
| D25 | Prior K0 list names Rust and full-block/state vectors; plan names Python and 20 mints. | The approved plan wins: JS now, independent Python in K1, exactly 20 named primary mint cases plus boundary/mutation cases. Retain reorg, same-block-number and real testnet4 block fixtures from the research as additional checks. |
| D26 | Header/body/witness and transaction validity provenance of synthetic vectors. | Synthetic reveals contain placeholder signatures and authenticated-input assumptions; they exercise protocol classification, not consensus admission. A separately pinned public testnet4 block exercises actual txid Merkle/header bytes. No synthetic block is called live evidence. |

| D27 | Reference existence at recipe height versus S5 saying before recipe. | Earlier heights are allowed; at the same height, require the reference transaction index strictly before the recipe. Missing order evidence cannot establish same-block availability. |
| D28 | Before-open payments and overRoot/refund eligibility. | Before-open reveals are ignored by the index and overRoot, which names over-cap, paused and late valid-form mints. L_m still refunds any unspent P after its CSV delay. No new early-refund entitlement is inferred. |

| D29 | The owner introduction says no post-recipe server signature, while escrow explicitly requires writers. | Preserve the explicit script policy: mint validity and unconditional buyer refund require no writer signature; treasury collection and optional early refund do. Never advertise signature-free treasury collection or change membership to enforce it. |

| D30 | Ord tag 11 index encoding differs from route36 IDs. | Encode tag 11 per ord 0.29.1: internal txid32 plus little-endian index with high zero bytes removed (zero index = no suffix); decode ord-accepted fixed four-byte suffixes too. Normalize to route36 only for comparison/CBOR commitments. |
| D31 | Repeated metadata tag 5 versus duplicate fields and the never-curses claim. | Preserve ord metadata chunk concatenation while rejecting other duplicate fields. Authentic source charms still decide R9. ord can mark duplicate metadata vindicated after jubilee; do not infer charm history from push form alone. Generated ordinary mints use a single chunk. |

## Escalations (trust rules unchanged)

- **E1 — witness authenticity (S2/S3, §§1.5, 1.11):** SHA256d(stripped) binds txid, not witness/envelope bytes. A hostile host can substitute the envelope without changing S2 in isolation. The research's S7/S8 txid proof also does not bind witness. The suite includes a same-txid/different-witness counterexample. Do not claim that S2 alone proves genuine inscription bytes. Authenticating the commit prevout and its Taproot script-path commitment can bind the envelope script; alternatively BIP141 witness-commitment evidence binds the witness. The research does not specify either check. The fixture `commitVerified` is an explicit externally authenticated-context assumption, not a substitute proof. The trust reviewer must select the required evidence before claiming adversarial-host witness authenticity.
- **E2 — append versus corrections (§§1.9.0–1.9.3):** D12 exposes the tension between concatenated append-only new lists and inserting/deleting earlier entries. This freeze preserves the history and projects validated corrections. The trust reviewer must approve that wire completion before K1 merge; it does not grant a writer permission to rewrite history.
- **E3 — sampling (§1.11 S9 versus §1.9.4):** S9 explicitly allows sampling above 1000 while the merge text says each entry verifies. Both are preserved as separate assurance levels. A sampled display cannot support the unqualified research claim that fake members are impossible.
- **E4 — lowerCap circularity (§1.5.3):** 'count at at' and 'only lower' conflict if counting all over-cap or later-block invalid mints. D8–D9 count valid mints in the inclusive effective block and clamp to oldCap. This needs the scheduled trust review; no member is evicted and no cap is raised.

## Reproduction and evidence

From this package: `npm install --workspaces=false --package-lock=false --ignore-scripts`
(only pinned `@noble/curves` and its hash dependency), then from the repository root:

```sh
node packages/ordinals-collections/spec/vectors/generate.mjs
node packages/ordinals-collections/spec/vectors/check.mjs
```

The checker never rewrites fixtures. It validates their JSON schema, exact file
set, byte-for-byte regeneration, all rule citations, independent §1.12 constants,
negative evidence mutations, and public-block header/Merkle binding. K1 must add
the independent Python implementation; sharing this JS generator is not that gate.

Bitcoin encoding references: [BIP341](https://github.com/bitcoin/bips/blob/master/bip-0341.mediawiki),
[BIP342](https://github.com/bitcoin/bips/blob/master/bip-0342.mediawiki),
[BIP350](https://github.com/bitcoin/bips/blob/master/bip-0350.mediawiki),
[BIP68](https://github.com/bitcoin/bips/blob/master/bip-0068.mediawiki).

Ord encoding references: [inscription ID value/from_value](https://github.com/ordinals/ord/blob/0.29.1/src/inscriptions/inscription_id.rs#L18), [metadata chunking](https://github.com/ordinals/ord/blob/0.29.1/src/inscriptions/tag.rs#L24), [jubilee and charms](https://github.com/ordinals/ord/blob/0.29.1/src/index/updater/inscription_updater.rs#L140). Source was read only; no ord client was run.
