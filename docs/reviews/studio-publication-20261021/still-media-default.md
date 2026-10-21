# Still-artwork shortcut and animated-media verification

This candidate is based on canonical SDK `1681772fb1e7c624b441ad9d54aa5c574a3a6b79`.
Its production source equals deployed SDK311. It does not include superseded
always-verifier commit74d36f5 or its callback redesign/test correction. That
branch and evidence remain preserved separately.

The latest creator instruction permits the decimal 500,000-byte shortcut only
for known still raster artwork that would otherwise duplicate the same asset
in the image and verifier. Non-executable and still are different properties:
GIF, APNG, animated WebP, audio, video and unknown motion keep verification.
Scripts always keep the automatic verifier. A distinct preview/thumbnail also
keeps the shell; it is not the same-source duplication exception.

The shared policy has additive `sourceMotion: still | animated | unknown` input.
Unknown or missing motion is conservative. Known still raster with no separate
preview (or exact matching SHA256/size/MIME) keeps the existing >500,000 through
2,000,000 raw-byte recommendation. Existing complete-return, selected-chain
reader, execution/state/read limits and original byte checks remain intact.
Explicit canonical-inline/canonical-hybrid and existing advanced choices are
preserved. Motion is included in the policy and acknowledgement identity.

`classifyKeelAssetMotion` is a browser-safe bounded container probe, not an image
decoder or authority to fund. It uses the existing authoring PNG/WebP rules:
complete PNG chunk framing/CRC and animation chunks; complete WebP RIFF framing
with VP8X animation bit/ANIM/ANMF. GIF always keeps verification, including
single-frame GIF. JPEG signature/end markers identify a still container.
Other formats remain unknown without additional actual inspection. The probe
does not decode, resize, re-encode, execute or mutate source. Its 32MiB/65,536
chunk scan budget returns unknown, not an upload rejection. The publication
compiler must still validate the actual media and registered renderer.

SDK staging computes motion from its existing snapshotted source bytes, alongside
execution inspection. Builder intent accepts optional motion; MIME and byte
length alone cannot assert still. A thumbnail prevents the duplication shortcut.
No new UI, codec, contract, RPC, signing field, deployment or paid operation was
introduced.

## Owner checks

Node22.22.1; worktree `/private/tmp/keel-still-media-default-20261021-01`.
Evidence `/private/tmp/keel-still-media-default-evidence-20261021-01` includes
exact source/build inventories, dependency overlay, baseline and raw logs.
Only protocol/SDK/builder owned TypeScript outputs are compiled; immutable
SDK311 dependencies/unchanged outputs are reused read-only.

```sh
node /private/tmp/keel-qa-fundingd640-20261021/keel-sdk/node_modules/typescript/bin/tsc -p packages/protocol/tsconfig.json
node /private/tmp/keel-qa-fundingd640-20261021/keel-sdk/node_modules/typescript/bin/tsc -p packages/sdk/tsconfig.json
node /private/tmp/keel-qa-fundingd640-20261021/keel-sdk/node_modules/typescript/bin/tsc -p packages/builder/tsconfig.json
node --test tests/smart-still-media-default.test.mjs
node --test tests/sdk-presentation.test.mjs tests/keel-presentation.test.mjs tests/sdk-studio-upload.test.mjs
```

13 new cases PASS and 19 unchanged adjacent cases PASS. Fixtures are new unit
inputs: valid 1px PNG with exact-sized ancillary chunk, its APNG marker variant,
container-only WebP motion fixtures, and a valid one-frame GIF enlarged with a
comment extension. They are not the incident artwork or live integration proof.
Actual SDK staging is invoked with an injected mock HTTP transport and every
uploaded byte compared with the input. Initial PNG fixture insertion placed
ancillary data before IHDR; that new uncommitted setup was corrected before
owner checks. No existing reference asset or assertion was weakened.

Exact immutable SDK311 baseline of the final new file: 0 PASS / 13 FAIL,
including missing additive API and actual APNG/GIF staging misclassification.
The unchanged existing affected suites remain 43 PASS / 8 FAIL: their previous
GIF/non-raster/missing-motion shortcuts are incompatible with the latest rule.
`HELD-latest-still-motion-expectations.patch` is separately proposed and not
applied pending independent approval. Old held patch01f6 and classifiercf398
are superseded and must not be applied.

## Site integration still required

These current SDK311 paired Site callers need actual source motion before they
can use the still shortcut; no Site source was edited here:

- `lib/studio-creator-asset-inspection.ts`: inspect each original file's existing
  actual bytes alongside execution; return motion in the source inspection.
- `server/services/release-asset-presentation.ts`: both shared policy calls pass
  the inspected source motion, and retain exact source/revision/default bindings.
- `lib/media-slot-policy.ts`: MIME/size-only `originalImageDefault` remains
  conservative unless passed motion computed from actual retained bytes.
- `components/studio/planning/asset-presentation-choices.tsx`: pass motion from
  the shared actual-byte inspection, without treating a UI value as authority.

Fee/storage authority must independently use retained server-side source bytes
and exact full-output/normal simulation gates. A producer's `sourceMotion`
claim, local probe, numeric estimate or SDK staging metadata is not receipt,
registration, readback, availability, funding or wallet authority. No live
acceptance gate is claimed by this source/test checkpoint.

## Staging authority correction after independent review

Independent review found a real error in d222's staging expectation: a known
still file over500KB could select `viewer=none` without any selected-chain
capability, omitting the default publication intent and persisting artifact-only
intent too early. The pure planner's provisional recommendation is not
authority for that persistence decision. Automatic SDK staging now retains the
canonical viewer and full default publication intent until Studio performs
selected-chain and complete-output qualification. Explicit viewer, saved
profile/slots and explicit candidate choices retain their existing precedence.

The unchanged emitted d222 staging regression is retained: 2 PASS / 1 FAIL;
its successor source makes those three independent-intent owner cases PASS.
The default PNG threshold test's old `none` expectation is held separately for
independent approval; its proposed correction adds publication-intent checks
and preserves every uploaded-byte assertion. It is not silently relabeled
successful. Independent receipt b439e5d948ef674ce130ab0c2f3f4c1475ace44acbc72f6d425a6f3f707c9e06
approved the exact earlier eight legacy expectation corrections e705c863 and
the first new-test classifier entry25bbe60c; only those were applied at this
checkpoint. Their full affected rerun plus new authority cases is54 PASS.
