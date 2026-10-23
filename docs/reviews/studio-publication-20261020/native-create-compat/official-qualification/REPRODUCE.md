# Native CREATE qualification build

Source commit: `c4e852b769dbfc7de9c9ba2a3f7da94e547b763a`. This record covers a qualification image, not production activation or live GIF acceptance. The executor and broker are fresh Linux/amd64 cross-builds from a Darwin/arm64 Go1.25.8 host. Old d97/FE944 evidence remains separate.

From the source worktree, with a fresh pinned Geth checkout in `$KEEL_NATIVE_BUILD_DIR/geth`:

```sh
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 GOTOOLCHAIN=go1.25.8 GOPROXY=off KEEL_GO_BINARY=/opt/homebrew/bin/go KEEL_NATIVE_BUILD_DIR=/absolute/build/path node scripts/build-proof-executor.mjs
DOCKER_CONTEXT=colima DOCKER_DEFAULT_PLATFORM=linux/amd64 KEEL_NATIVE_BUILD_DIR=/absolute/build/path node scripts/build-proof-runner-image.mjs
pnpm install --offline --frozen-lockfile
node scripts/build.mjs
node --test tests/proof-state-reader.test.mjs tests/proof-state-reader-cache.test.mjs tests/proof-executor-transport.test.mjs tests/proof-runner-client.test.mjs tests/proof-runtime-package.test.mjs
```

`test-overlay.json` maps only the two additional shim test files; the actual shim in the fresh Geth tree is the official builder copy. From the pinned Geth root, use host Go1.25.8 with `KEEL_PUBLIC_PROOF_FIXTURE` pointing to this SDK's `tests/fixtures/sepolia-public-proof-20261010.json` and `KEEL_NATIVE_PUBLIC3_PAYLOAD` to `native/proof-executor/fixtures/current49d-public-three-create.json`:

```sh
go test -p 2 -overlay /absolute/build/path/test-overlay.json ./internal/ethapi ./internal/keelfork ./cmd/keel-proof-executor -run '^Test(KeelSparse|Null|Public|Captured|Untrusted|Storage|ActualBeacon|BeaconClosure)' -count=1 -json
```

The first two packages pass 85 test events on this host. The unchanged cmd package cannot compile as Darwin tests because `main.go:163` uses Linux rusage field types; that RED is retained, and its actual Linux run remains required. No portability change or assertion weakening was made. The official Linux executable build passes. The initial missing-dist JS setup failure is retained separately; after the documented frozen install and official build, all 58 controls pass.

Archive provenance checks bind every OCI descriptor SHA/size, selected Linux/amd64 config, uncompressed layer diff IDs, exact executor/broker/receipt bytes, file modes, scratch entrypoint and UID. Docker's inspected identity is the outer OCI index; `image-oci-provenance.json` records the distinct amd64 manifest/config digests. This checks artifact content without starting a container.

No new public-state read, original consumed public simulation replay, private program execution, signature, spend or host mutation occurred. Independent actual Linux qualification and a separately reviewed current-state three-CREATE request remain required.
