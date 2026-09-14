# ZOO (`examples/zoo`, `@examples/zoo`)

An example proving the engine's packs and AI compose in one KEEL document.
It needs contracts, not packs: `contract:body/quadruped@^1`,
`contract:body/humanoid@^1`, `contract:ai/animal@^1`,
`contract:attributes/wearable@^1` (plus `keel/runtime`, `keel/core`,
`keel/entity`). `setup(ctx)` collects every provider; `createZoo(sources)`
stocks a pen -- herding kinds (tag `herd`) under the social AI with one
leader per herd, the rest under the solo one, each brain's params from its
body's sockets -- lines up the two-legged characters, and dresses everyone in
wearables `fits()` allows (one per slot, choices drawn, boots matched);
`main(host)` draws a top-down placeholder (dots, facing lines, rings for
sitting, red for fleeing, a halo on leaders, the wolf a red cross; click to
move the wolf) and lists who's wearing what. No bake, no renderer.

```
node packages/keel/src/cli.ts document examples/zoo --project examples/zoo --out out
open http://localhost:4300/out/documents/examples/zoo/index.html
```

It imports the engine only by package name and nothing imports it, so it can
move to `keel-sdk/examples/game-engine/` as is.

Tests: `node --test examples/zoo/test/*.test.ts` -- the pen (22 animals, 8
people, the right AI per kind, two leaders, everything worn fits, one per
slot, boots in pairs), deterministic steps, pen holds, the wolf makes them
run; the KEEL document (every module by contract, the game last, bodies before
the AI bound to them) started in a VM with the zoo's setup finding every
provider; its bundle reaches only keel/runtime, keel/core, keel/entity.
