import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMcpServer } from "../packages/mcp/dist/index.js";
import { siblingTest } from "./sibling-repository.mjs";

// The arena tools load @keel-engine/arena through @keel/game-engine, which links the sibling engine checkout.
const testWithEngine = siblingTest(test, "keel-engine");
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ENGINE = new URL("../packages/game-engine/src/engine/", import.meta.url);
const CLI = path.join(ROOT, "packages/game-engine/chain/arena.mjs");

const hex32 = (n) => `0x${n.toString(16).padStart(64, "0")}`;
const entrant = (i) => ({ tokenId: String(1000 + i), seed: hex32(0xabc0n + BigInt(i)), stake: String(100 + i * 7), config: hex32(BigInt(i) << 8n) });
const match = (n) => ({ formatId: 9, matchId: "42", seed: hex32(0x5eedn), params: "0x0003000a", trackPath: "track.bin", entrants: Array.from({ length: n }, (_, i) => entrant(i)) });

// A throwaway format the CLI and the test can run: half of every stake spent, first three entrants placed.
const FORMAT_SOURCE = `import { defineMatchFormat } from ${JSON.stringify(new URL("arena.ts", ENGINE).href)};
export const HALF = defineMatchFormat({
  id: "test/half@1", formatId: 9, inlineMax: 8,
  encodeParams: (p) => p, decodeParams: (b) => b,
  run: ({ entrants }) => ({ placings: [0, 1, 2].map((entrant) => ({ entrant, score: entrant })), spent: entrants.map((e) => e.stake / 2n) }),
});
`;

async function workspace(n) {
  const root = await mkdtemp(path.join("/tmp", "keel-arena-mcp-"));
  await writeFile(path.join(root, "match.json"), JSON.stringify(match(n)));
  await writeFile(path.join(root, "track.bin"), new Uint8Array([1, 2, 3, 4, 5]));
  await writeFile(path.join(root, "format.mjs"), FORMAT_SOURCE);
  const server = await createMcpServer({ workspaceRoot: root });
  await server.handle({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "arena-test", version: "1" } } });
  let id = 1;
  const call = async (name, args) => (await server.handle({ jsonrpc: "2.0", id: id++, method: "tools/call", params: { name, arguments: args } })).result;
  const cli = (...args) => execFileSync(process.execPath, [CLI, ...args], { cwd: root, encoding: "utf8" });
  return { root, server, call, cli };
}

testWithEngine("keel-arena-match-prepare matches the game:arena CLI byte for byte", async () => {
  const { root, call, cli } = await workspace(3);
  try {
    const expected = JSON.parse(cli("prepare", "match.json", "--out", "prover.json"));
    const prover = JSON.parse(await readFile(path.join(root, "prover.json"), "utf8"));
    const result = await call("keel-arena-match-prepare", { matchPath: "match.json" });
    assert.ok(!result.isError, JSON.stringify(result));
    const actual = result.structuredContent;
    for (const key of ["matchInput", "inputDigest", "paramsDigest", "trackDigest", "entrantsDigest", "n"]) assert.equal(actual[key], expected[key], key);
    assert.deepEqual(actual.witness, prover);
    assert.equal(actual.signed, false);
    assert.equal(actual.formatExecuted, false);
    assert.match(actual.matchInput, /^0x48534d4901/u); // "HSMI" v1

    const written = (await call("keel-arena-match-prepare", { matchPath: "match.json", witnessPath: "prover-mcp.json" })).structuredContent;
    assert.equal(written.witness, undefined);
    assert.deepEqual(JSON.parse(await readFile(path.join(root, "prover-mcp.json"), "utf8")), prover);

    // Public values produced by running the format bind to this match, and to no other.
    const run = JSON.parse(cli("prepare", "match.json", "--format", "format.mjs"));
    const bound = (await call("keel-arena-match-prepare", { matchPath: "match.json", publicValues: run.publicValues, program: "test/half@1" })).structuredContent;
    assert.equal(bound.publicValues.inputDigestMatches, true);
    assert.equal(bound.publicValues.settlement.mode, "inline");
    assert.deepEqual(bound.publicValues.placings, run.placings);
    assert.match((await call("keel-arena-match-prepare", { matchPath: "match.json", publicValues: run.publicValues, program: "test/other@1" })).content[0].text, /another program/u);
    await writeFile(path.join(root, "other.json"), JSON.stringify({ ...match(3), matchId: "43" }));
    assert.match((await call("keel-arena-match-prepare", { matchPath: "other.json", publicValues: run.publicValues })).content[0].text, /different match input/u);
    const spent = match(3).entrants.map((e) => String(BigInt(e.stake) / 2n));
    assert.match((await call("keel-arena-claim-prepare", { matchPath: "match.json", index: 0, spent, publicValues: run.publicValues })).content[0].text, /settle inline/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

testWithEngine("keel-arena-claim-prepare reproduces the settled root and the CLI claim", async () => {
  const n = 21; // past the test format's inlineMax, so the result settles by Merkle root
  const { root, call, cli } = await workspace(n);
  try {
    const { verifySettlement } = await import(new URL("arena.ts", ENGINE).href);
    const { fromHex } = await import(new URL("proof.ts", ENGINE).href);
    const run = JSON.parse(cli("prepare", "match.json", "--format", "format.mjs"));
    assert.equal(run.settlement, "merkle");
    const spent = match(n).entrants.map((e) => String(BigInt(e.stake) / 2n));
    await writeFile(path.join(root, "spent.json"), JSON.stringify({ spent }));

    for (const index of [0, 13, n - 1]) {
      const expected = JSON.parse(cli("claim", "match.json", "--format", "format.mjs", "--index", String(index)));
      const result = await call("keel-arena-claim-prepare", { matchPath: "match.json", index, spentPath: "spent.json", publicValues: run.publicValues, program: "test/half@1" });
      assert.ok(!result.isError, JSON.stringify(result));
      const claim = result.structuredContent;
      assert.equal(claim.root, expected.root);
      assert.deepEqual(claim.proof, expected.proof);
      assert.equal(claim.spent, expected.spent);
      assert.equal(claim.tokenId, expected.tokenId);
      assert.equal(claim.settlement.rootMatches, true);
      assert.ok(verifySettlement(fromHex(claim.root), n, index, fromHex(claim.leaf), claim.proof.map(fromHex)));
      assert.deepEqual(claim.claimCall.args, ["42", String(index), expected.tokenId, expected.spent, expected.proof]);
    }
    const inline = (await call("keel-arena-claim-prepare", { matchPath: "match.json", index: 2, spent })).structuredContent;
    assert.equal(inline.settlement.mode, "unchecked");

    const error = async (args) => { const r = await call("keel-arena-claim-prepare", { matchPath: "match.json", index: 1, ...args }); assert.equal(r.isError, true); return r.content[0].text; };
    assert.match(await error({ spent: spent.map((s, i) => (i === 4 ? String(BigInt(s) - 1n) : s)), publicValues: run.publicValues }), /settled Merkle root/u);
    assert.match(await error({ spent: spent.map((s, i) => (i === 0 ? "999999" : s)) }), /exceeds entrant 0's stake/u);
    assert.match(await error({ spent: spent.slice(1) }), /one entry per entrant/u);
    assert.match(await error({ spent, spentPath: "spent.json" }), /exactly one of spent or spentPath/u);
    assert.match(await error({ spentPath: "/etc/passwd" }), /workspace|file/u);
    assert.match(await error({ spent, index: n }), /index must name/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

testWithEngine("keel://mcp/arena documents the format route and never offers a module-executing audit", async () => {
  const { root, server, call } = await workspace(2);
  try {
    const read = await server.handle({ jsonrpc: "2.0", id: 1, method: "resources/read", params: { uri: "keel://mcp/arena" } });
    const doc = JSON.parse(read.result.contents[0].text);
    assert.deepEqual(doc.addFormat.map((s) => s.step), ["typescript", "rust", "register"]);
    assert.match(doc.cli.audit, /pnpm game:arena audit/u);
    assert.match(doc.boundary[0], /never imports a workspace format module/u);
    const listed = await server.handle({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const arena = listed.result.tools.filter((t) => t.name.startsWith("keel-arena-"));
    assert.deepEqual(arena.map((t) => t.name), ["keel-arena-match-prepare", "keel-arena-claim-prepare"]);
    for (const t of arena) assert.equal(Object.keys(t.inputSchema.properties).some((k) => /format|module/iu.test(k)), false);
    assert.match((await call("keel-arena-match-prepare", { matchPath: "match.json", format: "format.mjs" })).content[0].text, /Unsupported/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});
