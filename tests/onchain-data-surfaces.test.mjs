import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";

import { createMcpServer, toolByName } from "../packages/mcp/dist/index.js";
import { readSandboxDataLayers } from "../packages/sandbox-sdk/dist/index.js";
import { prepareBrowserSandboxProject } from "../packages/sandbox-sdk/dist/browser.js";
import { buildOnchainDataFragment, resolveKeelOnchainRpcUrl } from "../packages/sdk/dist/index.js";

/* The same disposable chain the SDK test uses. The point of these two surfaces
   is that a creator can point either of them at their own anvil, so a stubbed
   RPC would prove the wiring and skip the promise. */
async function withAnvil(run) {
  const port = 8900 + Math.floor(Math.random() * 300);
  const anvil = spawn("anvil", ["--port", String(port), "--silent", "--chain-id", "31337", "--prune-history"], { stdio: ["ignore", "pipe", "pipe"] });
  const rpcUrl = `http://127.0.0.1:${port}`;
  try {
    const deadline = Date.now() + 20_000;
    for (;;) {
      if (Date.now() > deadline) throw new Error("anvil did not come up");
      try {
        const probe = await fetch(rpcUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
        });
        if (probe.ok) break;
      } catch { /* not listening yet */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return await run(rpcUrl);
  } finally {
    anvil.kill("SIGKILL");
    await once(anvil, "exit").catch(() => {});
  }
}

/** One address, fixed words. See tests/sdk-onchain-data.test.mjs for why. */
function returns(...words) {
  let code = "";
  for (const [index, word] of words.entries()) {
    code += `7f${word.toString(16).padStart(64, "0")}`;
    code += `60${(index * 32).toString(16).padStart(2, "0")}`;
    code += "52";
  }
  code += `60${(words.length * 32).toString(16).padStart(2, "0")}6000f3`;
  return `0x${code}`;
}

async function setCode(rpcUrl, address, code) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "anvil_setCode", params: [address, code] }),
  });
  const body = await response.json();
  if (body.error) throw new Error(body.error.message);
}

const HEALTH_AT = "0x00000000000000000000000000000000000da7a0";

test("the MCP tool declares reads, performs them, and hands back a verified init fragment", async () => {
  await withAnvil(async (rpcUrl) => {
    await setCode(rpcUrl, HEALTH_AT, returns(125n, 25n));
    const server = await createMcpServer({ workspaceRoot: "." });
    await server.handle({
      jsonrpc: "2.0",
      id: 0,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1" } },
    });
    const response = await server.handle({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "keel-onchain-data-prepare",
        arguments: {
          rpcUrl,
          reads: [
            { name: "health", address: HEALTH_AT, signature: "bornBody()", returns: ["uint16", "uint16"], pick: 0 },
            { name: "armor", address: HEALTH_AT, signature: "bornBody()", returns: ["uint16", "uint16"], pick: 1 },
          ],
        },
      },
    });
    const result = response.result.structuredContent;
    assert.equal(result.schema, "keel.onchain-data@1");
    assert.equal(result.chainId, 31337);
    assert.deepEqual(result.values, { health: 125, armor: 25 });
    assert.deepEqual(result.variables, ["health", "armor"]);
    assert.equal(result.rpcUrlSource, "explicit");

    /* The whole reason the tool exists: what comes back is droppable into an
       inline graph and already known to publish what the chain said. */
    assert.equal(result.initVerified, true);
    assert.equal(result.fragment.phase, "data");
    assert.equal(result.fragment.weight, -32_768);
    assert.deepEqual(result.inlineModuleDeclaration, {
      moduleId: "keel/onchain-data",
      version: "1.0.0",
      mediaType: "text/javascript",
      execution: "classic",
      phase: "data",
      weight: -32_768,
    });
    assert.equal(result.signing, "not-performed");
    assert.equal(result.submission, "not-performed");
    return result;
  });
});

test("the tool refuses arguments that a JSON number would quietly round", async () => {
  const definition = toolByName("keel-onchain-data-prepare");
  assert.ok(definition, "the tool is registered");
  await assert.rejects(
    definition.run({ workspace: { root: "." } }, {
      rpcUrl: "http://127.0.0.1:1",
      reads: [{ name: "owner", address: HEALTH_AT, signature: "ownerOf(uint256)", args: [12345678901234567890], returns: ["address"] }],
    }),
    /decimal or 0x-hex text/u,
  );
  await assert.rejects(
    definition.run({ workspace: { root: "." } }, {
      rpcUrl: "http://example.test",
      reads: [{ name: "who", address: HEALTH_AT, signature: "who()", returns: ["address"] }],
    }),
    /loopback/u,
    "plain HTTP is a local anvil affordance, not a public transport",
  );
});

test("an omitted RPC resolves configuration rather than demanding a URL", () => {
  assert.deepEqual(
    resolveKeelOnchainRpcUrl(undefined, { KEEL_ONCHAIN_RPC_URL: "http://127.0.0.1:8545" }),
    { url: "http://127.0.0.1:8545/", source: "environment" },
  );
  assert.equal(resolveKeelOnchainRpcUrl(undefined, {}).source, "canonical-default");
});

test("the sandbox reports the data layer, its phase, and the variables it publishes", async () => {
  const fragment = buildOnchainDataFragment({ chainId: 31337, blockNumber: 7, values: { health: 125, immortal: true } });
  const prepared = await prepareBrowserSandboxProject({
    id: "sandbox-data-layer",
    name: "Sandbox data layer",
    files: [
      { path: "index.html", bytes: new TextEncoder().encode('<!doctype html><html><head><script src="keel-onchain-data.js"></script></head><body><canvas></canvas></body></html>') },
      { path: "keel-onchain-data.js", bytes: new TextEncoder().encode(fragment.source) },
      { path: "sketch.js", bytes: new TextEncoder().encode("globalThis.draw = () => KEEL.data.health;\n") },
    ],
  });

  assert.equal(prepared.report.dataLayers.length, 1);
  const [layer] = prepared.report.dataLayers;
  assert.equal(layer.resourceId, "keel-onchain-data.js");
  assert.equal(layer.phase, "data");
  assert.equal(layer.order, 0, "the data fragment sorts ahead of the artwork's own script");
  assert.equal(layer.globalName, "KEEL");
  assert.equal(layer.chainId, 31337);
  assert.deepEqual(layer.variables, ["health", "immortal"]);
  assert.deepEqual(layer.values, { health: 125, immortal: true });
  assert.equal(prepared.report.summary.dataVariables, 2);
  assert.ok(prepared.report.diagnostics.some((entry) => entry.code === "data.onchain-layer" && entry.level === "pass"));

  const component = prepared.manifest.stack.components.find((entry) => entry.id === "keel-onchain-data.js");
  assert.equal(component.role, "data", "a data fragment is not renderer code and must not be labelled as such");
});

test("a project with no data fragment gains no data findings", async () => {
  const prepared = await prepareBrowserSandboxProject({
    id: "sandbox-plain",
    name: "Sandbox plain",
    files: [{ path: "index.html", bytes: new TextEncoder().encode("<!doctype html><html><body>art</body></html>") }],
  });
  assert.deepEqual(prepared.report.dataLayers, []);
  assert.equal(prepared.report.summary.dataVariables, 0);
  assert.ok(!prepared.report.diagnostics.some((entry) => entry.code.startsWith("data.onchain-layer")));
});

test("a corrupted fragment is an error, because the document would publish it blind", () => {
  const fragment = buildOnchainDataFragment({ chainId: 1, blockNumber: 1, values: { health: 1 } });
  const broken = fragment.source.replace(/const P="[A-Za-z0-9_-]*"/u, 'const P="AAAAAAAA"');
  const reading = readSandboxDataLayers(
    [{ id: "keel-onchain-data.js", mediaType: "text/javascript" }],
    new Map([["keel-onchain-data.js", new TextEncoder().encode(broken)]]),
  );
  assert.deepEqual(reading.layers, []);
  assert.equal(reading.faults.length, 1);
  assert.match(reading.faults[0].message, /data-pack header/u);
});
