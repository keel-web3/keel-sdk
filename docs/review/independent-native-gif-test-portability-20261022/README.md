# Independent review — PASS, test portability and registration only

Exact candidate **d740a2acccff9ca61eba0c8d352f55c38c140282** is approved for these test/setup changes. Production remains **189ec0b0f0fd2d35e5b0c97cee23b85bcbd092ef** with no `packages/` delta. This independent reviewer did not author the candidate.

| Criterion | Result | Evidence |
| --- | --- | --- |
| Exact two retained GIF references | PASS | Each126B; finite SHA19a488cb5a0d34f20c3d0d266797b65c62ab197554f7e484377954ee5acb83a5; clamped SHA35fd32e1ac822834d6e945ce225c13a0c48731397a5578b86bd9aafae3546435. Matched the reviewer-owned frozen original files byte-for-byte. |
| Snapshot test relocation | PASS | Whole text equals the prior test after only its two URL substitutions; every assertion and input unchanged. |
| Reviewer regression mirror | PASS | Whole text equals original c71d19b0b8564712daecad4fff752ef6aacbc3956f6cffc4c0846b5e15afd5ff after only import and fixture-directory relocation. Original file remains byte-identical. |
| Normal test registration | PASS | Exact three deterministic additions; zero deletions or other category changes. Historical validator names the two old unclassified files; current validator returns an empty list. |
| Affected behavior | PASS | Fresh13/13, zero failures/skips, including exact mutable-source regression, finite/clamped native inspection, strict conversion refusal, captured live abort signal, actual MCP tools and oversized entry. |
| Classification and syntax | PASS | Fresh3/3 normal classification controls and three syntax checks. |
| New production, full SDK, Studio, DB or live release qualification | NOT IN SCOPE | These checks do not establish any additional production or deployment claim. |

Commands, cwd, exit status and raw TAP are in `raw/affected.json`, `raw/affected.stdout`, `raw/classification.json`, `raw/classification.stdout` and `raw/map-and-syntax-results.json`. Exact Node22.22.1 SHA245e0321af97d3c21dd4e7104457334dfe3c3ba7982d0db75363e354565f8cbb. The affected command is `node --test tests/media-frame-request-snapshot.test.mjs tests/native-media-frame-read.test.mjs tests/native-gif-source-identity.test.mjs`; classification uses `node --test tests/test-suite-classification.test.mjs`.

A new clean shared-object `codex/` checkout ran the tests with its own package aliases and copied, rehashed frozen reviewer-built189 runtime: **1716 outputs,24883645B**, manifest SHA32a300c47067d7aea9fc91bfa5e547fdaa71106efdf5c4877911c0043bd63c2a. This is explicit reuse of the prior independently built runtime, not a fresh build. No author compiled outputs were used. Public package aliases and all output identities are recorded in `raw/setup-audit.json`. Only local builtins, pinned Sharp and actual local MCP tool functions ran; no host/provider/wallet/service calls. Initial load7.27 and pretest7.48 were below the owner limit.

No assertions, expected rejection, tolerances, source recipes or reference bytes were weakened. Scope approval does not close the separate movie-native SAR/title inspector, normal frontdoor/DB recovery, composed candidate or live publication gates.
