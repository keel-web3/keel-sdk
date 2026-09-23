import assert from "node:assert/strict";
import test from "node:test";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";

import {
  assertOnchainDataRoundTrip,
  buildOnchainDataFragment,
  keccak256,
  readOnchainData,
  verifyOnchainDataFragment,
} from "../packages/sdk/dist/index.js";

const utf8 = (value) => new TextEncoder().encode(value);

/* Why a real chain and not only a stub: the whole promise of this module is
   "point it at your anvil and the values land in your document as variables".
   A stubbed RPC proves the decoder and proves nothing about that promise. The
   stub tests below cover the shapes anvil cannot easily produce. */
async function withAnvil(run) {
  const port = 8600 + Math.floor(Math.random() * 300);
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

/* Why one address per read and not one dispatching contract: a hand-assembled
   selector dispatcher is a second thing that can be wrong, and when it is, the
   test fails for a reason that has nothing to do with the module. Each address
   returns fixed words, which is exactly what `eth_call` has to survive. */
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

test("keccak256 matches the published vectors, so the selectors are real", () => {
  assert.equal(keccak256(utf8("")), "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
  assert.equal(keccak256(utf8("abc")), "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45");
  assert.equal(keccak256(utf8("transfer(address,uint256)")).slice(0, 8), "a9059cbb");
});

const anvilAvailable = spawnSync("anvil", ["--version"], { stdio: "ignore" }).status === 0;

test("reads a local anvil chain and the values arrive as document variables", {
  skip: anvilAvailable ? false : "Anvil is not installed",
}, async () => {
  await withAnvil(async (rpcUrl) => {
    const bodyAt = "0x00000000000000000000000000000000000c0de0";
    const weaponAt = "0x00000000000000000000000000000000000c0de1";
    const immortalAt = "0x00000000000000000000000000000000000c0de2";
    const rpc = async (method, params) => {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      const body = await response.json();
      if (body.error) throw new Error(`${method}: ${body.error.message}`);
      return body.result;
    };
    await rpc("anvil_setCode", [bodyAt, returns(125n, 25n)]);
    await rpc("anvil_setCode", [weaponAt, returns(3n)]);
    await rpc("anvil_setCode", [immortalAt, returns(1n)]);

    const layer = await readOnchainData({
      rpcUrl,
      reads: [
        { name: "health", address: bodyAt, signature: "bornBody()", returns: ["uint16", "uint16"], pick: 0 },
        { name: "armor", address: bodyAt, signature: "bornBody()", returns: ["uint16", "uint16"], pick: 1 },
        { name: "weapon", address: weaponAt, signature: "weapon()", returns: ["uint8"] },
        { name: "immortal", address: immortalAt, signature: "immortal()", returns: ["bool"] },
      ],
    });

    assert.equal(layer.chainId, 31337, "it read the chain it was pointed at");
    assert.deepEqual(layer.values, { health: 125, armor: 25, weapon: 3, immortal: true });

    /* THE POINT OF THE MODULE: the values a chain held are variables a script
       can reach, and init is what puts them there. */
    const fragment = buildOnchainDataFragment(layer);
    assert.equal(fragment.phase, "data", "the fragment sorts above every runtime and render module");
    const published = verifyOnchainDataFragment(fragment);
    assert.equal(published.data.health, 125);
    assert.equal(published.data.armor, 25);
    assert.equal(published.data.weapon, 3);
    assert.equal(published.data.immortal, true);
    assert.equal(published.chainId, 31337);
    assertOnchainDataRoundTrip(layer, fragment);
  });
});

test("init publishes a FROZEN global that a later module cannot replace", () => {
  const layer = { chainId: 1, blockNumber: 42, values: { health: 125 } };
  const fragment = buildOnchainDataFragment(layer, { globalName: "ART" });
  const scope = Object.create(null);
  new Function("globalThis", `"use strict";${fragment.source}`)(scope);
  assert.equal(scope.ART.data.health, 125);
  assert.throws(() => { scope.ART = { data: {} }; }, /Cannot assign|read only/iu,
    "a later module must not be able to shadow the data layer");
});

test("a dynamic return type is refused rather than mis-decoded", async () => {
  const fetchImpl = async (_url, init) => {
    const { method } = JSON.parse(init.body);
    const result = method === "eth_chainId" ? "0x1" : method === "eth_blockNumber" ? "0x1" : `0x${"0".repeat(64)}`;
    return { ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, result }) };
  };
  await assert.rejects(
    readOnchainData({
      rpcUrl: "http://unused",
      fetchImpl,
      reads: [{ name: "who", address: "0x00", signature: "who()", returns: ["string"] }],
    }),
    /static return types only/u,
    "a string return would need an offset table, and guessing it would hand back a plausible wrong value",
  );
});

test("a value too large for a JavaScript number survives as a string", async () => {
  const big = (2n ** 200n).toString(16).padStart(64, "0");
  const fetchImpl = async (_url, init) => {
    const { method } = JSON.parse(init.body);
    const result = method === "eth_chainId" ? "0x1" : method === "eth_blockNumber" ? "0x1" : `0x${big}`;
    return { ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, result }) };
  };
  const layer = await readOnchainData({
    rpcUrl: "http://unused",
    fetchImpl,
    reads: [{ name: "supply", address: "0x00", signature: "supply()", returns: ["uint256"] }],
  });
  assert.equal(layer.values.supply, (2n ** 200n).toString(),
    "a number that cannot round trip must not pretend to be one");
  assertOnchainDataRoundTrip(layer, buildOnchainDataFragment(layer));
});

test("a name that is not an identifier is refused, because it has to become a variable", async () => {
  const fetchImpl = async (_url, init) => {
    const { method } = JSON.parse(init.body);
    const result = method === "eth_chainId" ? "0x1" : "0x1";
    return { ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, result }) };
  };
  await assert.rejects(
    readOnchainData({ rpcUrl: "http://unused", fetchImpl, reads: [{ name: "my-var", address: "0x00", signature: "a()", returns: ["uint8"] }] }),
    /not a usable variable name/u,
  );
});
