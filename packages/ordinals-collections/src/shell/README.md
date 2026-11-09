# KOC1 browser shell core (S1–S9)

Bundle `@keel/ordinals-collections/shell` for the browser. It imports the existing
K1 parser, Taproot commit authentication, controls, classification, commitment,
writer-chain, merge and challenge primitives. The shell graph has no Node
builtins or Buffer global. The package's other entry points remain Node-facing.

```js
import { verifyShell } from '@keel/ordinals-collections/shell';
const verdict = await verifyShell();
// location.pathname supplies self; fetch defaults to the same origin's /r/.
```

`status` is `member`, `not member`, `settling`, or `invalid`, accompanied by
`reasons`, per-stage `checks`, rank, quorum-covered `C`, `final`, and resource
`stats`. `member` requires F confirmations and `height + W <= C`. A valid self
without quorum remains `settling`; self is inserted even when writers omit it.
Malformed evidence fails authentication; missing evidence or exhausted budgets
stays settling. These are S1–S9 results, not full viewer/badge verdicts.

S2/S3 bind both reveal and commit stripped txids, exact tapscript, Taproot control
block, output key and parity. S4 takes confirmation height and charms from
`/r/inscription`. Recipe references are recovered from their authenticated reveal
bodies, so no `/content/` or external request is required. Authenticated recursion
children establish creator/holder linkage; metadata cannot assert its own parent,
ID or confirmation height. Controls are passed to K1 with the actual receipt
height, overriding any metadata claim.

S7 defaults on: `/r/blockinfo` fields reconstruct each header through `h + F`,
checking host hash, target/PoW (testnet4 powLimit) and linkage. Host best-chain
selection and consensus admission remain host assumptions; this does not perform
retarget validation. `checkWork:false` explicitly disables this optional work
check; S8 still verifies the complete raw block's transaction tree and header
binding. S8 uses K1 `parseBlock`, never inscription numbers. Blocks and recursion
responses are cached only within a load.

`walk(authority, {client, maxPages, maxChildren})` reads
`/r/children/<authority>/inscriptions/<page>` in child order. Each record is
recovered from `/r/tx` and `/r/inscription` and commit-authenticated. This measures
the browser-side walk over the endpoint, not the server's internal spender walk.
Writer roots and extension are checked by K1 `writerChain`; `seen` triples and
authenticated `koc1-pin` children (`seen` or `pins` triple lists) are all required.
R31 keeps the first valid child for a prev and ignores later siblings. D16 leaves
bad entries out without adding a permanent reputation rule. Missing or
ratchet-rejected originals cast no vote; the recipe's q stays fixed.

S9 enables sampling only above 1,000 candidate members through self: the fully
checked own entry plus preceding rows with matching claims from at least the
recipe's q accepted writer chains, excluding known invalid/unknown rows. Rows
after self cannot enable sampling. Through that threshold it checks the entire
union; above it, a 64-entry sample (configurable `sampleSize`, minimum 2) plus
independently validated invalid challenges reached from original authorities or
self. Sample positions are drawn without replacement using domain-separated
SHA-256 of block H* (R53): the first block after every sample candidate was
committed. A candidate is an exact row (txid, coordinates, m, P) claimed before
self by at least q writers, read from their claims, not the first-writer union,
so a new variant from one writer cannot drop it. It is committed at the
q-th earliest confirmation height of the accepted update in which each claiming
writer first listed it. Heights come from `/r/inscription/` records; writer
metadata and covered height C cannot choose the seed, and the candidate list is
fixed before the hash exists. Fetch that hash through `/r/blockhash/<height>`
only. Until the block exists the verdict stays settling. Updates that add no
candidate do not move H*, so per-block publication stays live. `sampleSeed`
reports `{height,hash}` (null hash while pending), or null for an exhaustive
load. The same accepted chains/hash and ordered candidates yield the same
sample for every viewer; a later tip cannot change it. Reorgs recompute the
evidence; miners can still influence the seed block. Minority rows are always checked exhaustively,
including claimed positions after self. An invalid sampled row or a sampled row
that contradicts authentic coordinates/m/P triggers exhaustive checking of the
entire union for that load. The own entry always receives the full checks.
Results explicitly say `exhaustive` or `sampled`; sampled results do not establish
completeness.

Unprovable rows are unknown and excluded, never treated as invalid-challenge
evidence. They set `incomplete: true` and prevent finality only when corroborated
by q distinct writers. Compact `new` triples are enriched from mint bytes for the
existing root primitive; full entry objects are also accepted. An unavailable
compact lookup leaves m/P absent, so its update cannot gain a verified root or
vote; matching unknown triples from q authenticated writers also keep the result
incomplete. An accepted earlier chain prefix remains usable. Each update is
limited to 1,000 new entries.

K4 seams: `deferred.stages` lists S10–S14 and `deferred.challenges` gives discovered
challenge IDs. This core does not follow arbitrary `next`/`fork` pointers. Registry
additions, complete challenge discovery/replay (including ch/fragment), window
audit, owner/burn, art/metadata and bridges belong to K4. Discovered challenges keep
finality pending until that resolution layer is present. S9 can already exclude
an independently proven invalid entry outside the sample. There is no shared
browser-storage ratchet, signing, wallet or external endpoint.

Default transport limits: 16,000,000 response-body bytes per request, 100,000
requests per load, 64 children pages and 64,000 children per authority. Requests
reject redirects and time out after 30 seconds. Exhaustion is incomplete evidence.
`limits` can override these transport budgets; lowering q is not an option.

Tests and measurements:

```sh
pnpm --filter @keel/ordinals-collections test
node packages/ordinals-collections/test/shell-walk-benchmark.mjs
# Optional, using local Chrome and the existing trailer Playwright dependency:
node packages/ordinals-collections/test/shell-browser-smoke.mjs
```

The mock is localhost-only; synthetic signatures are placeholders and no test
claims live admission. The pinned real testnet4 header is an offline fixture.
