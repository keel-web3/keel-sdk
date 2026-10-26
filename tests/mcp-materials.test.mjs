import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { createMcpServer } from "../packages/mcp/dist/index.js";
import { pngChunk, pngHeader } from "../packages/sdk/dist/raster-strips.js";
import { siblingTest } from "./sibling-repository.mjs";

// The material tools load @keel-engine/materials through @keel/game-engine, which links the sibling engine checkout.
const testWithEngine = siblingTest(test, "keel-engine");
const ENGINE = new URL("../packages/game-engine/src/engine/materials.ts", import.meta.url);

function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  return Buffer.concat([pngHeader(width, height), pngChunk("IDAT", deflateSync(raw)), pngChunk("IEND", new Uint8Array(0))]);
}

async function workspace() {
  const { paintMaterialAtlas, resampleArea, resampleNearest } = await import(ENGINE.href);
  // A painted sheet: procedural pixel art, smoothed and resized off its grid.
  const art = paintMaterialAtlas({ size: 384, pixels: 16, seed: 7 }).art;
  const sheet = resampleArea(resampleNearest(art, 768, 768), 400, 400);
  const root = await mkdtemp(path.join("/tmp", "keel-materials-mcp-"));
  await writeFile(path.join(root, "sheet.png"), png(sheet.width, sheet.height, sheet.rgba));
  const server = await createMcpServer({ workspaceRoot: root });
  await server.handle({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "materials-test", version: "1" } } });
  let id = 1;
  const call = async (name, args) => (await server.handle({ jsonrpc: "2.0", id: id++, method: "tools/call", params: { name, arguments: args } })).result;
  return { root, call };
}

testWithEngine("keel-material-guide reads the sheet, says which rules fired and why, and what to ask", async () => {
  const { root, call } = await workspace();
  try {
    const result = await call("keel-material-guide", { imagePath: "sheet.png" });
    assert.ok(!result.isError, JSON.stringify(result));
    const g = result.structuredContent;
    assert.equal(g.schema, "keel-material-guide@1");
    assert.equal(g.kind, "material-atlas");
    assert.deepEqual(g.grid.blocks, { x: 2, y: 2 });
    assert.equal(g.grid.columns, 6);
    assert.equal(g.sheetRule.id, "painted-source");
    assert.ok(g.sheetRule.why.length > 20);
    assert.equal(g.blocks.length, 4);
    for (const block of g.blocks) {
      assert.ok(block.fired.some((r) => r.id === "separable-light"), JSON.stringify(block.fired));
      for (const rule of block.fired) for (const k of ["when", "then", "why"]) assert.ok(rule[k].length > 3);
    }
    assert.ok(g.blocks[0].looksLike.includes("bark"));
    assert.deepEqual(g.questions.map((q) => q.id), ["names", "purpose", "resolution"]);
    assert.equal(g.next.tool, "keel-material-distill");
    assert.ok(g.rulebook.block.length >= 6);
    assert.equal(g.uploaded, false);
    assert.equal(g.signed, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

testWithEngine("keel-material-distill writes the exemplar and preview and runs the gauntlet", async () => {
  const { root, call } = await workspace();
  try {
    const result = await call("keel-material-distill", { imagePath: "sheet.png", names: ["bark", "foliage", "autumn", "snow"], outputPath: "out/sheet.kmx", previewPath: "out/preview.png", seeds: 3 });
    assert.ok(!result.isError, JSON.stringify(result));
    const d = result.structuredContent;
    assert.equal(d.schema, "keel-material-distill@1");
    const kmx = await readFile(path.join(root, "out/sheet.kmx"));
    assert.equal(kmx.subarray(0, 4).toString("latin1"), "KMX2");
    assert.equal(d.exemplar.bytes, kmx.length);
    assert.equal(d.gauntlet.pass, true, JSON.stringify(d.gauntlet));
    assert.deepEqual(d.gauntlet.seeds, [1, 2, 3]);
    assert.match(d.verdict, /^PASS/u);
    assert.deepEqual(d.exemplar.families.map((f) => f.name), ["bark", "foliage", "autumn", "snow"]);
    const preview = await readFile(path.join(root, "out/preview.png"));
    assert.equal(preview.subarray(1, 4).toString("latin1"), "PNG");
    assert.equal(d.submitted, false);

    // An override is the author's or a fix's; a bad one is refused, as is a wrong count of names.
    const chunky = (await call("keel-material-distill", { imagePath: "sheet.png", names: ["bark", "foliage", "autumn", "snow"], outputPath: "out/chunky.kmx", pixels: 12, seeds: 1, overrides: { snow: { finish: { amount: 0.2 } } } })).structuredContent;
    assert.equal(chunky.exemplar.pixels, 12);
    assert.match(chunky.exemplar.families[3].finish, /at 0\.2$/u);
    assert.ok((await call("keel-material-distill", { imagePath: "sheet.png", names: ["bark"], outputPath: "x.kmx" })).isError);
    assert.ok((await call("keel-material-distill", { imagePath: "sheet.png", names: ["bark", "foliage", "autumn", "snow"], outputPath: "x.kmx", overrides: { moss: {} } })).isError);
    assert.ok((await call("keel-material-distill", { imagePath: "sheet.png", names: ["bark", "foliage", "autumn", "snow"], outputPath: "x.kmx", overrides: { bark: { finish: { dither: "noise" } } } })).isError);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
