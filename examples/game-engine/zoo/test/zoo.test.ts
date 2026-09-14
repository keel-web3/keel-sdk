// ZOO: the engine's packs and AI compose. As a model -- packs and AI handed
// in the way setup(ctx) collects them -- it stocks the pen, dresses everyone in
// what fits, steps deterministically and keeps every animal in the pen; as a
// KEEL document, its modules resolve by contract, bundle, and start on a page
// with the zoo's setup finding every provider.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as animals from "@keel/game-engine/animals";
import { manifest as animalsManifest } from "@keel/game-engine/animals/module";
import * as humans from "@keel/game-engine/humans";
import { manifest as humansManifest } from "@keel/game-engine/humans/module";
import * as cloth from "@keel/game-engine/cloth";
import { manifest as clothManifest } from "@keel/game-engine/cloth/module";
import * as wander from "@keel/game-engine/wander";
import { manifest as wanderManifest } from "@keel/game-engine/wander/module";
import * as herd from "@keel/game-engine/herd";
import { manifest as herdManifest } from "@keel/game-engine/herd/module";
import { ENGINE_ROOT, buildGameDocument, bundleModule, linkRecord, readWorkspace } from "@keel/game-engine/keel";
import { fits } from "@keel/game-engine/runtime";
import { createZoo, PEN } from "../src/index.ts";
import type { AnimalAi, Sources } from "../src/index.ts";

const SOURCES: Sources = {
  bodies: [{ manifest: animalsManifest, api: animals }, { manifest: humansManifest, api: humans }],
  wearables: [{ manifest: animalsManifest, api: animals }, { manifest: clothManifest, api: cloth }],
  ais: [{ manifest: herdManifest, api: herd as unknown as AnimalAi }, { manifest: wanderManifest, api: wander as unknown as AnimalAi }],
};

test("the pen: herds under ai/herd with one leader each, the rest under ai/wander; everyone dressed in what fits", () => {
  const zoo = createZoo(SOURCES);
  assert.equal(zoo.animals.length, 22);
  assert.equal(zoo.people.length, 8);
  for (const a of zoo.animals) assert.equal(a.ai, a.entity === "deer" || a.entity === "dog" ? "ai/herd" : "ai/wander", a.agent.id);
  assert.equal(zoo.animals.filter((a) => a.leader).length, 2);
  const byId = new Map([...animals.pack.attributes.map((d) => [d.id, { def: d, pack: animalsManifest }] as const), ...cloth.pack.attributes.map((d) => [d.id, { def: d, pack: clothManifest }] as const)]);
  const dressed = [...zoo.people.map((p) => ({ worn: p.worn, def: humans.pack.entities.find((e) => e.id === p.entity)!, pack: humansManifest })), ...zoo.animals.map((a) => ({ worn: a.worn, def: animals.pack.entities.find((e) => e.id === a.entity)!, pack: animalsManifest }))];
  let n = 0;
  for (const d of dressed) {
    const slots = d.worn.map((w) => w.slot);
    assert.equal(new Set(slots).size, slots.length, "one thing per slot");
    for (const w of d.worn) { assert.ok(fits(byId.get(w.attribute)!, { def: d.def, pack: d.pack }).ok, `${w.attribute} on ${d.def.id}`); n += 1; }
    // (Boots come in pairs.)
    assert.equal(slots.includes("foot.L"), slots.includes("foot.R"));
  }
  assert.ok(n > 20, `${n} things worn`);
  assert.ok(zoo.people.every((p) => p.worn.every((w) => w.from === "packs/cloth")), "people wear cloth (the collar and saddlebags are the animals' own)");
});

test("it steps deterministically, everyone stays in the pen, and the wolf sends them running", () => {
  const a = createZoo(SOURCES);
  const b = createZoo(SOURCES);
  let fled = 0;
  for (let k = 0; k < 30 * 60; k += 1) {
    a.step();
    b.step();
    for (const x of a.animals) {
      const [px, , pz] = x.agent.pos;
      assert.ok(px >= PEN[0] && px <= PEN[2] && pz >= PEN[1] && pz <= PEN[3], `${x.agent.id} in the pen`);
      if (x.agent.mode === "flee") fled += 1;
    }
  }
  assert.deepEqual(a.animals.map((x) => x.agent), b.animals.map((x) => x.agent));
  assert.ok(fled > 100, `${fled} animal-steps fleeing`);
  assert.notDeepEqual(createZoo(SOURCES, "0x201").animals.map((x) => x.agent.pos), a.animals.map((x) => x.agent.pos));
});

const zooDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const engineRoot = ENGINE_ROOT; // (the engine the SDK carries: the zoo is a project outside it)

test("as a KEEL document: every module it needs by contract, bundled, started, and the zoo's setup finds them all", async () => {
  const workspace = await readWorkspace(engineRoot, { projects: [zooDir] });
  const doc = await buildGameDocument("examples/zoo", workspace);
  const ids = doc.modules.map((m) => m.id);
  for (const id of ["keel/runtime", "keel/core", "keel/entity", "packs/animals", "packs/humans", "packs/cloth", "ai/wander", "ai/herd", "examples/zoo"]) assert.ok(ids.includes(id), id);
  assert.equal(ids.at(-1), "examples/zoo", "the game last");
  assert.ok(ids.indexOf("packs/animals") < ids.indexOf("ai/herd"), "a body before the AI bound to it");
  // On a page: start everything, then ask the zoo what its setup collected.
  const page: Record<string, unknown> = { console, TextEncoder, TextDecoder, atob, btoa };
  page["globalThis"] = page;
  vm.createContext(page);
  for (const b of doc.bundles) vm.runInContext(b.code, page);
  const engine = page["KEEL_ENGINE"] as { start(): Promise<unknown>; get(id: string): Record<string, unknown> };
  await engine.start();
  const got = (engine.get("examples/zoo")["collected"] as () => Sources)();
  assert.deepEqual([...got.bodies.map((b) => b.manifest.id)].sort(), ["packs/animals", "packs/humans"]);
  assert.deepEqual([...got.wearables.map((w) => w.manifest.id)].sort(), ["packs/animals", "packs/cloth"]);
  assert.deepEqual([...got.ais.map((x) => x.api.id)].sort(), ["ai/herd", "ai/wander"]);
  // And the zoo, from what the page brought, is the same zoo.
  const onPage = (engine.get("examples/zoo")["createZoo"] as typeof createZoo)(got);
  assert.equal(onPage.animals.length, 22);
  // Its own bundle reaches only what it needs.
  const me = workspace.find((w) => w.manifest.id === "examples/zoo")!;
  const map = (await linkRecord(me, workspace)).imports;
  assert.deepEqual(Object.values(map).sort(), ["keel/core", "keel/entity", "keel/runtime"]);
});
