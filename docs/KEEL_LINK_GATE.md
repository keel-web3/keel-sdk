# KEEL link gate and module finder

Bytes headed onchain through KEEL must not name the web. The link gate is the
one check every KEEL-driven push runs before it produces an upload plan, a
wallet request or a Studio stage. It refuses on any concrete locator and tells
the creator which registered KEEL modules to reuse instead of embedding a copy.

Source: `packages/sdk/src/link-gate.ts` (`@keel/sdk/link-gate`), MCP wiring in
`packages/mcp/src/link-gate-tools.ts`, tests in `tests/sdk-link-gate.test.mjs`.

## What fails a push

Any `http://`, `https://`, `ipfs://`, `ar://` (authority or 43-character
transaction id), `web3://` or `keel-onchain://` locator, and the `keel.invalid`
sentinel. The allowlist is the existing rule: only the SVG namespace
`http://www.w3.org/2000/svg` is admitted, because it is syntax, not a fetch.
`http://www.w3.org/1999/xlink` and every other namespace URL are refused.

The gate reads each resource byte for byte and then every layer it can open
inside it, recursively (depth 6, 64 MiB expanded, 4096 layers):

| Layer | How it is found |
| --- | --- |
| gzip | magic `1f 8b 08` at the start of a layer or anywhere inside a binary layer (concatenated slugs, calldata) |
| zlib / deflate | zlib header at the start of a layer |
| Brotli, raw deflate | tried on binary layers; kept when the output is readable |
| percent / URI81 | `%XX` escapes in text layers, offsets mapped back exactly |
| script escapes | `\/`, `\uXXXX`, `\xXX` in JavaScript or JSON strings |
| `data:` URIs | Base64 or percent payloads, nested to any depth |
| Base64 | runs of 32+ characters (`storedBase64` slots, inline blobs) that decode to text or a compressed stream |

A refusal names the resource, the byte offset in the resource as supplied (the
locator itself, or the start of the outermost encoded span that holds it), the
decoding path (`data-uri(text/javascript)-base64@107 > brotli@0`), the URL and a
short context snippet:

```text
KEEL link gate refused keel-inline-prepare: 1 external locator(s) in bytes headed onchain.
- vendor/tone.js @ byte 50: https://github.com/Tonejs/Tone.js/wiki/Accurate-Timing  …console.warn('see [https://github.com/Tonejs/Tone.js/wiki/Accurate-Timing]');
Reuse registered KEEL modules instead of embedding a copy:
- tone-native@15.1.22 0x3c958bd7…3d76 (packages/sdk/src/audio-module.ts (KEEL_TONE_15)): banner Tone.js 15.1.22; reference-on-selected-chain
Only http://www.w3.org/2000/svg is allowed. No wallet request or upload plan was produced.
```

There is no bypass option. These are not hits:

- **Registered module bytes.** A layer whose sha256 equals a pinned KEEL module
  (the creative runtime catalog, `KEEL_TONE_15`, `KEEL_AUDIO_RUNTIME`, the
  three.js model-viewer modules) is that module. p5 1.11.3 carries inert URLs in
  its own source; uploading or reusing the exact registered build is not a
  creator embedding a link. A chunk of such a module (a 23 KB slug in
  `castSlugs` calldata) passes when each locator's surrounding 32 bytes match
  the pinned module verbatim. A modified copy fails.
- **KEEL's own registered infrastructure.** The verification shell, the
  published-view reader and the managed-shell runtime carry collector links
  (onkeel.io, the block explorers, the gallery, IPFS/Arweave gateways). A
  locator whose surrounding 32 bytes reproduce that infrastructure verbatim,
  as built by this SDK, decoded through every layer, is reported as
  `registered-shell-context`. The same address in a creator's own markup, or
  the shell with a creator link spliced in, is still refused. These texts are
  built once per process, only after a scan was blocked, by
  `enforceKeelLinkGate` (every push route), the `keel-link-gate` tool and the
  CLI. The synchronous `assertKeelLinkGate` applies them only once they are
  loaded (`loadKeelLinkGateInfrastructure`).
- **An explicit external preview.** `publish-plan` passes the exact URI of a
  `keel-explicit-external-preview@1` commitment it already validates; only that
  string, only in that route. The same URI inside wallet-request calldata is
  refused.
- **KEEL's manifest pointer.** The `web3://` value of a tokenURI's
  `"keel_manifest"` field, immediately followed by its
  `"keel_manifest_digest"`, is metadata KEEL writes, not a fetch by the
  artwork. Every other `web3://` locator is refused.
- **Minified syntax** such as `ready ? ar : 1`.

Exemptions are listed in the report so nothing passes silently.

## Where it runs

| Route | Gate |
| --- | --- |
| `createKeelWalletRequest`, `encodeKeelWalletRequestQr` (SDK) and `wallet-request-prepare` | calldata, the joined `castSlugs` payload, Tezos parameters and their `bytes` |
| `wallet-request-prepare` deployments | init code |
| `createUploadPlan`, `createRecursiveUploadPlan` (builder) and `upload-plan` | source bytes, before any chunk file is written |
| `chain-plan` | decoded object bytes of a materialized plan |
| `createKeelPublishReviewPlan` and `publish-plan` | prepared graph and the expected/returned tokenURI |
| `prepareKeelCreatorInline` and `keel-creator-inline-prepare` | every resource and the poster, before carriers are planned |
| `keel-inline-prepare` | entry, modules and assets, after the existing Inline checks |
| `stageKeelStudioProject` with `storageStrategy: "onchain"` and `keel-studio-stage-project` | every staged file, before upload |
| `buildKeelStorageGraph` (studio-core Hold graph) | every prepared resource |
| `keel-graph-weld-prepare`, `keel-tezos-hold-resources-prepare` | every part / resource |

In the MCP every tool is classified: `KEEL_LINK_GATED_TOOLS` lists the push
routes and `KEEL_LINK_GATE_EXEMPT_TOOLS` gives every other tool the reason it
pushes nothing onchain. `tests/sdk-link-gate.test.mjs` fails when a tool is in
neither list, so a new route cannot ship unguarded. Gated tools also get a
result net: calldata, hex sources, tokenURIs and Tezos parameters in the
result (including a result delivered as a workspace file, which is removed on
refusal) are scanned before the result is returned. MCP refusals carry
`code: "external-link-found"`, `nextTool: "keel-link-gate"`, the hits and the
suggestions as structured content.

The SDK cannot intercept a program that builds wallet calls without it; a
custom publisher should call `enforceKeelLinkGate` itself.

## Module finder

The same scan reports registered KEEL modules a creator should reuse. Matches,
strongest first:

1. **sha256** of any layer equals a pinned or indexed module digest.
2. **License banner**: `Tone.js 15.1.22`, `p5.js v1.11.3`, three.js `REVISION`
   or its copyright banner, `keel-audio 1.0.0`.
3. **The URLs themselves**: jsDelivr, unpkg, esm.sh, Skypack and npm registry
   `package@version` paths, cdnjs `libs/<name>/<version>`, and GitHub
   repositories matched against each pinned module's `sourceRepository`
   (so the Tone.js wiki link maps to `tone-native`).

Each suggestion carries the exact module id, version, digest, byte length,
where it is pinned, `versionMatch` (`exact`, `different-version`, `unknown`) and
availability on the selected chain. Availability comes from deployment
reference manifests (`deployments/*.json` in the SDK checkout and the
workspace): `reference-on-selected-chain` lists the chain, container id and
offset of the same digest; `not-claimed` means only the local pinned bytes
exist. Every availability still `requires-selected-chain-readback`.
Suggestions are metadata: the gate never substitutes bytes
(`substitution: "never-automatic"`). Banner and URL matches point at a
library's runtime modules; three.js loader add-ons match only by sha256.

Indexed candidates come from `keel-library-search`: the `keel-link-gate` MCP
tool with `searchIndexes: true` queries the configured Studio module and
library indexes for each detected library and rescans with the results. SDK
callers pass the same entries as `index`.

## Using it

SDK:

```ts
import { enforceKeelLinkGate, scanKeelLinkGate } from "@keel/sdk/link-gate";

const report = scanKeelLinkGate({ route: "my-publisher", chainId: 11155111, resources: [{ id: "index.js", bytes }] });
await enforceKeelLinkGate({ route: "my-publisher", resources: [{ id: "index.js", bytes }] }); // throws KeelLinkGateRefusal
```

MCP: `keel-link-gate` with `files`, `text` or `hex`, optional `chainId`,
`searchIndexes` and `assert`. It is read-only.

CLI (exit 0 clear, 1 refused, 2 usage):

```sh
pnpm link-gate --chain-id 11155111 path/to/index.js path/to/vendor/tone.js
pnpm link-gate --json --hex 0x0d1ff9e2…
```

In a runtime without Node's zlib (a bundled browser build of
`@keel/sdk/wallet-request`), compressed layers cannot be opened; the report
lists them under `coverage.uninspected` instead of claiming a clean scan.
