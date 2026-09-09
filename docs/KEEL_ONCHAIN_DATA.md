# On-chain data as script variables

An artwork that reads a chain has one hard problem, and it is not the read. It
is arrival: the values have to exist before the first draw call looks for them.
When they do not, nothing throws. The work renders with `undefined` and looks
merely wrong, which is the most expensive kind of failure to find.

This page describes the supported path that removes the problem. Declare the
reads, perform them, and emit an init fragment that publishes the answers as a
frozen global ahead of every other module. Creator code then reads
`KEEL.data.health` and takes arrival for granted, because it is guaranteed
rather than hoped for.

## The shape

```
declare reads  ->  eth_call each one  ->  freeze into a KDP1 pack
               ->  emit a classic init script in the data phase
               ->  KEEL.data.<name> in the artwork
```

Three surfaces expose exactly that, over one implementation:

| Surface | Entry point |
| --- | --- |
| SDK | `packages/sdk/src/onchain-data.ts` — `readOnchainData`, `buildOnchainDataFragment`, `assertOnchainDataRoundTrip` |
| MCP | `keel-onchain-data-prepare` in `packages/mcp/src/tools.ts` |
| Sandbox | `readSandboxDataLayers` and `report.dataLayers` in `packages/sandbox-sdk/src` |
| Skill | `skills/keel-onchain-data/SKILL.md` |

## Declaring a read

```ts
const layer = await readOnchainData({
  rpcUrl: "http://127.0.0.1:8545",
  reads: [
    { name: "health", address: BODY, signature: "bornBodyOf(uint256)", args: ["1"], returns: ["uint16", "uint16"], pick: 0 },
    { name: "armor",  address: BODY, signature: "bornBodyOf(uint256)", args: ["1"], returns: ["uint16", "uint16"], pick: 1 },
    { name: "supply", address: DIE,  signature: "totalSupply()", returns: ["uint256"] },
  ],
});
```

`name` becomes a variable, so it must be a JavaScript identifier and must be
unique across the layer. `pick` takes one member out of a multi-value return
instead of the whole tuple. `blockTag` defaults to `latest`; pin it for a
reproducible build.

Arguments are decimal or `0x`-prefixed text. They are not JSON numbers, because
a `uint256` does not survive one and an argument that silently loses its low bits
selects a different token.

### Static return types only

`bool`, `address`, `bytes32`, and `uint`/`int` at any declared width. A dynamic
return — `string`, `bytes`, an array — is refused.

This is deliberate. A dynamic return is reached through an offset table, and a
decoder that guesses at one does not fail loudly; it hands the artwork a number
that looks plausible and is wrong. Refusing is the only outcome a creator can act
on.

A value beyond `Number.MAX_SAFE_INTEGER` is published as decimal text rather than
as a number that has quietly lost its low bits. Artwork code reading a wide type
must expect a string.

## The fragment

```ts
const fragment = buildOnchainDataFragment(layer);
// -> { moduleId: "keel/onchain-data", phase: "data", weight: -32768, source, digest, byteLength }
assertOnchainDataRoundTrip(layer, fragment);
```

`source` is a classic script. It decodes an embedded KDP1 pack and installs the
result with `Object.defineProperty`, non-writable and non-configurable, under the
chosen global name and under the stable alias `__KEEL_ONCHAIN_DATA__`.

Four properties of that script are load-bearing.

**It is CBOR without gzip.** `encodeKeelDataPack` can gzip, and storage-side packs
do. This one must not. Init has to be synchronous, and the only gzip a browser
offers is the async `DecompressionStream` — so a gzipped payload would publish
its globals one microtask late, and every consumer would read `undefined`. That
is precisely the failure the module exists to prevent, so the trade is made here
rather than left to a caller to get wrong.

**It runs in the data phase.** `orderKeelModules` sorts data before runtime and
runtime before render; `weight: -32768` puts this fragment first among its peers.
That is what makes "the values are there before anything looks" a property rather
than a hope. `buildKeelInlineModuleFragment` refuses a `data` module that is not
a classic script, because the canonical shell appends module JavaScript with
`document.head.append(script)` and an ES module would die on `export`.

**The global is frozen.** A later module cannot shadow or replace the data layer.

**It carries the block it was built from.** `chainId` and `blockNumber` travel
with the values, so a claim about what a work shows can name the state it was
read at.

### Reading a fragment back

`verifyOnchainDataFragment` runs the fragment the way a document would and
returns what it published. `assertOnchainDataRoundTrip` compares that against the
chain read. Both ship beside the builder rather than living in a test, because
"init works" has to be something a creator can run against their own build.

`inspectOnchainDataFragment` answers the same question **without executing the
script**: it decodes the embedded pack and returns the global name, chain, block,
and values, or `undefined` for source that is not a KEEL data fragment. Hosts use
that one. A sandbox or an inspector must never execute project bytes in its own
process to find out what they contain.

## Wiring it into an Inline graph

`keel-onchain-data-prepare` returns `inlineModuleDeclaration` alongside the
source. Write the source to a workspace file and declare it under
`keel-inline-prepare`'s `modules` with that file's path:

```json
{
  "moduleId": "keel/onchain-data",
  "version": "1.0.0",
  "path": "build/keel-onchain-data.js",
  "mediaType": "text/javascript",
  "execution": "classic",
  "phase": "data",
  "weight": -32768
}
```

`buildKeelInlineLocalDocument` emits a `<script src="…">` for every `data`
module ahead of the entry — into the head for an HTML entry, and before the
entry's module script for a JavaScript one. The artwork reads `KEEL.data.<name>`
with no await and no readiness check.

## Choosing the chain

`resolveKeelOnchainRpcUrl` resolves, in order: an explicit URL, then
`KEEL_ONCHAIN_RPC_URL`, then the endpoint configuration's public RPC
(`KEEL_PUBLIC_RPC_URL`, then the canonical KEEL test default).

It is separate from `resolveKeelEndpoints` for one reason. That resolver answers
"where do collectors read this work", so it accepts only credential-free HTTPS
origins. Building a data layer is the opposite situation: the ordinary case is a
local anvil on plain HTTP, which is exactly the URL a public resolver is right to
reject. So loopback HTTP is allowed here and nowhere else, and a URL carrying
credentials in its userinfo is refused rather than redacted after the fact.

```bash
anvil --port 8545 --chain-id 31337
export KEEL_ONCHAIN_RPC_URL=http://127.0.0.1:8545
```

## What the sandbox reports

A data layer fails silently by nature, so the sandbox names it. Give
`inspectSandboxManifest` the decoded resource bytes — `prepareSandboxProject` and
`prepareBrowserSandboxProject` do it for you — and the report carries:

- `dataLayers[]`: the resource ID, the `data` phase and its weight, the position
  the fragment sorts to among the project's scripts, the global name, the chain
  and block, and every variable it publishes;
- `summary.dataVariables`: how many variables the project's data layers publish;
- a `data.onchain-layer` diagnostic per layer, and a `data.onchain-layer-unreadable`
  error for a fragment that cannot be decoded — a fragment the host cannot read is
  one the document will publish blind, which is a build failure, not a warning.

In a browser sandbox the fragment is also labelled `role: "data"` in the project
stack, exactly as the Inline graph builder labels it. Left as a plain module it
reads like renderer code, and the one thing a creator needs to see about it is
that it is not.

## Proof boundary

The MCP tool performs `eth_call` plus chain identity and head. It never signs,
submits, writes state, or touches a wallet. It executes the fragment it built
before returning it, so the values in the response are read back rather than
assumed.

That is Level 1 evidence in the sense of
[Testing and readiness](TESTING.md): it proves the decode and the ordering. It
does not prove the contract is the right contract, that the chain is the selected
chain, or that anything was published. Those remain separate gates.

## Tests

`tests/sdk-onchain-data.test.mjs` covers the SDK against a real local anvil, plus
the shapes anvil cannot easily produce. `tests/onchain-data-surfaces.test.mjs`
covers the MCP tool against the same disposable chain and the sandbox's reading
of a prepared project.
