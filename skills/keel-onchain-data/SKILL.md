---
name: keel-onchain-data
description: Wire on-chain values into a KEEL artwork as script variables. Use whenever a work reads a contract - health, supply, a seed, an owner, a trait - so the values arrive as KEEL.data.<name> before the first frame instead of a fetch that resolves too late. Covers declaring reads, reading them from a local anvil or any JSON-RPC, emitting the init fragment, and testing the whole loop before publication.
---

# KEEL on-chain data

A work that reads a chain has to answer one question before it draws anything:
are the values here yet. Hand-rolled, the answer is usually no, and the failure
is silent — the artwork renders with `undefined` and simply looks wrong. This
skill is the supported path that removes the question.

The route is one module on three surfaces: `@keel/sdk`'s `onchain-data`, the MCP
tool `keel-onchain-data-prepare`, and the sandbox, which reports what a prepared
project will publish. Use it for anything that goes on-chain → script. Do not
write a `fetch` into an artwork to read a contract.

## When to reach for it

Reach for it when the work needs a chain value **at render time**: a token's
stored traits, a supply or price, a seed, a block number, a balance, an owner, a
flag that changes what is drawn. Reach for it in the sketch as well as the final
graph, so local development and the published document read the same names.

Do not reach for it for anything the work must read *while it runs* — a live
auction clock, a value that changes during a session, a wallet the viewer
connects. A data layer is a snapshot taken when the work is built. Say so
plainly when a creator asks for live values; do not present a snapshot as one.

## The three-step shape

Every use is the same three steps, in this order.

**1. Declare the reads.** One entry per variable the artwork will use:

```json
{
  "reads": [
    { "name": "health", "address": "0x…", "signature": "bornBodyOf(uint256)", "args": ["1"], "returns": ["uint16", "uint16"], "pick": 0 },
    { "name": "armor",  "address": "0x…", "signature": "bornBodyOf(uint256)", "args": ["1"], "returns": ["uint16", "uint16"], "pick": 1 },
    { "name": "supply", "address": "0x…", "signature": "totalSupply()", "returns": ["uint256"] }
  ]
}
```

`name` is the variable the artwork reads, so it must be a JavaScript identifier.
`args` are decimal or `0x` text, never JSON numbers — a `uint256` does not
survive one. `returns` are static types only.

**2. Read them.** Call `keel-onchain-data-prepare` with those reads. Omit
`rpcUrl` to resolve `KEEL_ONCHAIN_RPC_URL`, then the configured public RPC; pass
it explicitly to point at a local anvil. Each read is one `eth_call`. The tool
signs nothing, submits nothing, and writes no state.

Pin `blockTag` to a hex block number when the build must be reproducible. Left
at `latest`, two builds of the same work can carry different numbers.

**3. Emit the fragment.** The tool returns `fragment.source` — a classic script
that publishes a frozen global — plus `inlineModuleDeclaration`, which is the
exact declaration to hand `keel-inline-prepare`. Write the source to a workspace
file, then declare it under `modules` with that file's `path` and the returned
`moduleId`, `execution`, `phase`, and `weight` unchanged.

The artwork then reads `KEEL.data.health`. Nothing else is required of it: no
await, no readiness check, no fallback for a value that has not arrived.

## The anvil loop

Develop against a disposable local chain. The whole path works there, which is
the point of it.

```bash
# In a separate terminal.
anvil --port 8545 --chain-id 31337

# Then point the tool at it, either explicitly or through configuration.
export KEEL_ONCHAIN_RPC_URL=http://127.0.0.1:8545
```

Plain HTTP is accepted only on a loopback host. That allowance exists for anvil
and for nothing else; a public RPC must be HTTPS, and a URL carrying credentials
is refused rather than redacted.

Deploy or seed the contracts the work reads, run the tool, then inspect the
prepared project in the sandbox. The sandbox reports each data layer it finds:
which resource carries it, that it sorted into the `data` phase, which chain and
block it was read at, and every variable it publishes. A project that should
have a data layer and shows none is the failure this whole path exists to make
visible — stop and fix it there, not after publication.

Before claiming the loop works, re-read the evidence boundary: a local anvil read
is local evidence. It does not prove the same call against a public chain, and it
never proves publication. Re-run the reads against the selected chain, and pin
the block, before preparing anything a collector will see.

## Traps

These are properties of the module, not preferences. Preserve them.

- **The pack is CBOR without gzip on purpose.** Init must be synchronous, and the
  browser's only gzip is the async `DecompressionStream`. A gzipped payload
  publishes its globals a microtask late and every consumer reads `undefined`.
  Storage-side packs may still be gzipped; this one may not.
- **Static return types only.** `bool`, `address`, `bytes32`, and `uint`/`int` of
  any declared width. A dynamic return — `string`, `bytes`, an array — needs an
  offset table, and guessing it hands the artwork a plausible wrong number. When
  a creator needs a dynamic value, change the contract read or store the value
  another way; do not decode it by hand.
- **The published global is frozen and non-configurable.** A later module cannot
  shadow or replace it. Do not write artwork code that expects to patch it.
- **`phase: "data"` with `weight: -32768` is the guarantee.** Data precedes
  runtime, which precedes render. Changing either field, or declaring the
  fragment as an ES module instead of a classic script, turns "the values are
  there before anything looks" back into a hope.
- **A number that cannot round-trip comes back as a string.** A `uint256` beyond
  `Number.MAX_SAFE_INTEGER` is published as decimal text rather than a number
  that quietly lost its low bits. Artwork code must expect that for wide types.
- **The snapshot carries its block.** Report the chain ID and block number
  alongside any claim about what the work will show. "It reads the chain" without
  a block is not a description of anything.

## Proof boundary

`keel-onchain-data-prepare` executes the fragment it built before returning it,
so the values in the response are read back from the fragment rather than
assumed. That is evidence that init publishes what the chain said. It is not
evidence that the contract is the right contract, that the chain is the selected
chain, or that the prepared graph was published. Keep those gates separate, as
[Testing and readiness](../../docs/TESTING.md) requires.

The full reference — the pack format, the ordering rule, the SDK entry points,
and the sandbox report fields — is
[On-chain data as script variables](../../docs/KEEL_ONCHAIN_DATA.md).
