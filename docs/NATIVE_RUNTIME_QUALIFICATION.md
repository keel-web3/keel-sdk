# Native capacity qualification in the existing Linux runtime

The capacity pool change is opt-in and disabled in the current Site factory/image. This recipe cannot activate it. Native mechanism tests, exact runtime capability, actual candidate execution, and publication acceptance are separate gates. Do not infer any of them from another.

## Probe the runtime before building

`scripts/native/qualification/runtime-probe.mjs` accepts no project input or arguments. It emits only selected OS/process security facts and the result of `/usr/bin/unshare -Urn /usr/bin/true`. It changes no settings, reads no environment values and makes no network requests. A successful result establishes namespace capability only.

The already-authorized operator can run it inside the existing container under its actual runtime user, without copying files, credentials or changing container configuration:

```sh
docker --context colima exec --interactive --user postgres --workdir /tmp \
  "$KEEL_EXISTING_CONTAINER" node --input-type=module \
  < scripts/native/qualification/runtime-probe.mjs
```

Use the existing context on the operator's Mac. Root does not access the Mac. The operator's existing SSH Linux-server route can run the equivalent command with that server's existing local Docker context. Resolve the real existing container from the deployment receipt; do not guess a name or restart it. Record the actual image ID and only the relevant configuration fields (`Config.User`, `HostConfig.SecurityOpt`, `CapAdd`, `CapDrop`, `Privileged`, `ReadonlyRootfs`), not its environment or full inspect output.

For a Linux VM host control, the existing Colima VM supports `colima ssh`; run the same probe there under its ordinary user, with an available Node 22 binary. Do not start/reconfigure Colima or install privileges. A VM host success does not qualify a container, and a cloud failure does not establish a Mac/Colima failure. Docker documents namespace restrictions in its default seccomp policy: https://docs.docker.com/engine/security/seccomp/ . Colima's maintained access/context documentation: https://github.com/abiosoft/colima/blob/main/docs/FAQ.md .

Stop on missing `/usr/bin/unshare`, denied namespace creation, unreadable `/proc`, or failed process identity checks. Do not add privileges, change seccomp/AppArmor, alter user-namespace sysctls, use an isolation-off factory or substitute host execution for a failed container qualification. This recipe does not propose a new host helper service or RPC endpoint.

The current reviewed compiler/binary target is native Linux/amd64. Record `kernelMachine`, not only Node's compiled architecture: a Node x64 process under emulation is insufficient. A native `x86_64` kernel and actual `/proc/PID/exe` matching the reviewed binary must pass. An existing ARM64 VM requires a separately pinned target/toolchain build and qualification; do not replace binary hashes or relax process checks.

## Exact build inputs and offline compiler

Use a disposable Linux/amd64 build environment with Git, Python 3, patch, CA certificates, Node 22.23.1, pnpm 10.15.0 and ample scratch (8 GiB minimum recommended). Do not compile on macOS or the deployment host. The existing Colima Linux build environment can be assessed separately by the authorized operator; root does not restart or change it. The actual runtime tests run later under its intended Linux identity/default security configuration.

`scripts/native/canonical-state-engine/source-manifest.json` is authoritative. Its SHA-256 is `0f5396da074ae07f22cf987a6f5226a21871a8f4c2abad45f27e7080dd6194cf`.

| Input | Exact bytes | SHA-256 |
| --- | ---: | --- |
| Geth commit `a579077007b98217c3e253a66e4b452ca0c32b96` archive | 22,557,951 | `e9248c692a1725113ccbc5ad78dc93b6efa80201bafc4473e2133c7cf90a96d3` |
| Official Go 1.26.9 Linux/amd64 archive | 66,935,201 | `42d158b4d8f7b61ac0a830567c940a86098fb7aac52e467a5ebec03ef5cc2f8d` |
| `go/bin/go` compiler member | — | `e90c4e12df236ea0c2e7536fd68da8a47fc0b585c19588bf6c1a70cfc296a0f9` |

Exact public URLs are retained in that manifest. Both archive byte counts/hashes and the compiler member hash were verified locally during this recovery. No native executable was produced here. The Go module cache must already be populated and verified against that exact upstream `go.sum`; no alternate provider, project disclosure or credentials are introduced by this recipe. If those public build dependencies are absent from the approved builder, report that missing input instead of guessing a binary or borrowing another source version.

The maintained builder verifies archives, compiler and every overlay/patch/license, checks the cached Go modules, runs native tests and emits `keel-sparse` plus `build-receipt.json`. Its build is offline. Supply only ordinary public build environment variables; remove inherited GOOS/GOARCH/GOFLAGS/GOWORK and runtime secrets. The reviewed target is GOOS=linux/GOARCH=amd64, CGO disabled. Do not mount a production env file, data volume or creator packet into the builder.

```sh
python3 scripts/native/canonical-state-engine/build.py \
  --geth-archive "$KEEL_NATIVE_INPUTS/geth-source.tar.gz" \
  --go-archive "$KEEL_NATIVE_INPUTS/go1.26.9.linux-amd64.tar.gz" \
  --module-cache "$KEEL_NATIVE_MODULE_CACHE" \
  --build-cache "$KEEL_NATIVE_BUILD_CACHE" \
  --output "$KEEL_NEW_NATIVE_BUILD"

node scripts/build-local-staged-fixtures.mjs \
  --native-build "$KEEL_NEW_NATIVE_BUILD" \
  --module-cache "$KEEL_NATIVE_MODULE_CACHE" \
  --build-cache "$KEEL_NATIVE_BUILD_CACHE" \
  --output "$KEEL_NEW_SYNTHETIC_FIXTURES"

node scripts/native/qualification/qualify-runtime.mjs \
  --native-build "$KEEL_NEW_NATIVE_BUILD" \
  --fixtures "$KEEL_NEW_SYNTHETIC_FIXTURES" \
  --output "$KEEL_NEW_RUNTIME_QUALIFICATION"
```

All paths must be absolute and output directories new. Install SDK dependencies only from its frozen pnpm lockfile; the fixture generator requires pinned solc 0.8.36 and esbuild 0.28.2. No SDK dist replacement is required for this source qualification. Optional real public-proof tests are explicitly skipped unless their hash-bound input is supplied; a skip is not real-project acceptance.

The qualifier preserves failures, verifies the exact amd64 ELF and native build/source receipts, then executes the maintained real native process controls, 45-stage synthetic storage/strict/full-URI checks, over-50M aggregate control, atomic-call/revert/cancel/reorg controls, and authenticated missing-witness expansion/replay controls. It uses synthetic state and offline/mock reads only. Its receipt always leaves actual-candidate acceptance, production-runtime match and capacity activation false. A successful `unshare` probe alone cannot pass this qualifier.

Ship a reviewed native executable only with its full build/source/license receipt, synthetic fixture/test receipts and exact SHA-256. The current app image does not include or select this executable. Never treat this source recipe as a deployable native image.

## Exact candidate gate after mechanism and runtime qualification

The new capture-only Site code supports optional exact candidate ID/digest/version in addition to project/release revisions. HTTP uses `candidateId`, `candidateDigest`, `candidateVersion`; MCP `keel_publication_program_capture` uses `candidate: { candidateId, candidateDigest, version }`. The existing creator session or `drafts:read` grant is required. No grant is a wallet signer.

Assembly runs within a request-local PostgreSQL READ ONLY repeatable snapshot, without source row locks or direct pooled-SQL escape. A separate fresh read-only snapshot checks source and complete candidate row identity after assembly. It selects the saved candidate's own proposed digest/deadline, never renews/promotes a candidate, and rejects changed/closed identities. It preserves the old journal path when no candidate is selected.

The returned `nativeCapture` is the input to the SDK's existing `normalizeAssemblyCapture`. It includes the exact source-assembled, unallocated call bytes/fees/gas, full expected URI and typed bigints; before/after full headers with RLP/hash/stateRoot authentication; exact candidate/source identity; and explicit no-simulation/no-approval flags. This is a NEW source capture, never the missing historical observed wire. Count the complete preparation + reader + observation + metadata program from the captured fields; do not assume the synthetic 47-call count describes the real candidate.

The retained incident export redacts carrier bytes and cannot pass strict SDK candidate validation. It is useful historical metadata, not a complete capture or current database snapshot. Obtain an unredacted capture only through the existing owner-authorized route. Do not replace redactions with zeros, inferred bytes or length models. Keep its private data outside public PRs.

Finally, authenticate the complete same-pin account/storage/code/header access closure and run every SDK discovery, fresh strict replay and complete reader/metadata phase with unchanged gas/state-write bounds. Confirm exact full return, cancellation/cleanup, reorg and missing-proof negatives in the actual request-owned pool composition. A measured whole-request capacity fact cannot be inferred from a per-call gas clamp or a later remainder. No new RPC recipient, arbitrary state overrides, shorter program, approval, signing or broadcast follows from these tests.
