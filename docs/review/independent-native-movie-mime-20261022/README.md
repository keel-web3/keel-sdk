# Independent M4V source review

APPROVED_SCOPED_M4V_SOURCE for exact SDK `e946bde7140d4ce1eb04ecac735c7ed216d2bf46`, base `0dc7e6f342b228515b1eecf783c9fd3629802eef`. Reviewer authored no production changes. Five production leaves only; current registered renderer, frame profile and schema remain unchanged.

Fresh independent Node22.22.1 standard build passes. All1821 emitted files are byte-identical to the author final-source inventory (`own-build-output-manifest.json`), rather than reusing its compiled outputs. Focused tests:145 maintained plus15 independent controls,160PASS/0FAIL/0SKIP. Extra controls independently corrupt compatible-image/QuickTime brands, geometry, timing, sample offsets and fragmentation for both None/Gzip and test exact original asset bytes with a nonzero byte offset. Explicit MIME stays authoritative.

Actual installed Chrome151/headless-shell1234: unchanged registered-frame MP4 plus M4V bothPASS. Exact original SHA/data URL, verified seal in opaque sandbox,32x24/0.56s and red→blue seek samples; zero external requests/errors. InputMP4 a421a056…1786B; M4V eb417767…1775B. Raw local browser evidence is retained, with compact `browser-summary.json`. The exact fixtures validate actual playback; this is not an assertion that every ISO codec is browser-supported.

QuickTime is accurately identified and preserved, but direct playback is deliberately unsupported. Current tests prove actionable separate-MP4-derivative guidance, exact original preservation and rejection of forged None/Gzip entry descriptors. Author actual Chrome error4/MOV-negative records are retained and inspected; they are not independent successful MOV proof. No source MIME rewrite or typeless bypass was introduced.

The final clean build follows three retained reviewer setup failures: omitted sparse examples/skills and a missing own tsc-bin link. No source changes fixed them. Full commands and results are in `result.json`; public dependency links and all fresh output identities are retained.

This source approval does not close normal Postgres/API/MCP intake, fresh chain reads, actual Gatorrr/GIF publication, a packaged Linux release, deployed Studio or wallet handoff. No host/provider/native/wallet/signing action was performed by this reviewer.
