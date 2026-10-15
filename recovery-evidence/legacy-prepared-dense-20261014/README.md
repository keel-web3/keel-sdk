# Frozen local legacy compressed-reader qualification

Base SDK commit: `3fb92a6d235bd77e9ba022a9543d1c1917c25abf`.
The implementation/source and actual emitted JS/declaration hashes are in
`qualification.json`. Dependency symlinks and emitted build files are local
workspace support and are not part of the source commit.

Completed checks, using Node 22.23.1:

- Normal SDK TypeScript JS/declaration emit: exit 0 (`sdk-tsc.log`).
- New focused actual legacy-envelope suite: 7/7, zero skipped (`sdk-focused.tap`).
  It covers exact source/poster bytes, Raw, explicit codecs, nonbeneficial
  compression, persisted audit parsing, 40/41 and 128/129 resource boundaries,
  default/configured 256/1024 capacity, source size above 32 MiB, original
  compressed bytes, mixed 512 KiB leaves, existing module bytes/order and
  adversarial outer-code/context/namespace cases.
- Actual Chromium full-return suite: 4/4, zero skipped
  (`chromium-full-return.tap`). Both gzip and uncompressed shell boots consume
  the actual metadata-derived animation and appended six-field legacy context,
  run the original data/runtime modules, and expose the exact poster bytes. A
  changed Dense stream mounts no child and emits no artwork signal.
- Existing tests: 52 actual cases passed in the initial seven-file command;
  two files could not start because relative protocol/MCP dist files were
  absent in this isolated checkout. The unchanged protocol/MCP support was
  restored locally, with MCP's normal `@keel/sdk` alias pointing at this
  candidate. The two affected files then passed all 26 cases. Raw initial
  failure output is retained; this is 78 passing existing cases across the
  completed runs, not a claim that the initial command passed or that the
  complete SDK suite ran.
- Existing native, Brotli, LZMA, embedded Base90 and prepared Dense gzip/none
  shell prefix/suffix bytes are identical to the qualified reference. Exact
  hashes are in `existing-profile-byte-identity.json`. The packaged protected
  canonical asset and managed runtime also remain byte-identical.

Every browser proxy record remains visible. Chrome attempted denied service
CONNECTs to `www.google.com`, also reproduced on the scriptless control. The
positive artwork checks independently report zero external CDP/page-attributed
netlog requests and zero runtime errors. No hostname exception was introduced.
The initial incorrect assertion that all proxy records would be empty remains
in `chromium-initial-proxy-assertion-failure.tap`.

`registration/descriptor.json` and its four text files contain the exact
unsigned reusable shell fragments, including disclosed mode-2 alignment and
prepared-fragment hashes. The distinct shell ID is
`0xc26655fca9b6eb800e2009d6707abeb7f8b8dfb0d52c5a5c5a89563c169df904`.
No registration call, wallet approval, broadcast or deployment was performed.
The old canonical follow-latest shell ID/head must remain unchanged. Public
use still requires exact selected-chain governance registration, receipts,
builder/store binding, full contract readback, read-gas qualification and normal
Studio integration.

The adapter does not authorize migration of paid native objects to new Dense
carriers. Existing compressed/Base64 module reuse is explicitly unsupported
without its compatible authenticated reader. A metadata poster also referenced
by artwork has no proven shared physical representation in this adapter; a
normal publication must resolve or block that case before payment. Exact local
poster replay is not evidence of one paid representation. Existing original
streams above 32 MiB need their original segmented descriptor, rather than a
silent repack. Fresh ordinary input keeps the normal 512 KiB leaf pipeline and
host source limits, with complete Inline return/read bounds assessed separately.

These are local synthetic SDK/browser checks. They do not identify or validate
the owner's currently deployed release or prove ordinary Studio compiler/live
acceptance. That work is tracked by the parent task separately.
