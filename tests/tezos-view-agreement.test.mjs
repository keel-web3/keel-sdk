import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

import {
  KEEL_TEZOS_OBJECT_VIEW,
} from "../packages/protocol/dist/index.js";
import { siblingRepositories } from "./sibling-repository.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const keelContractsSibling = siblingRepositories("keel-contracts");
const CONTRACTS_ROOT = resolve(ROOT, "../keel-contracts");
const TEZOS_STORE_SOURCE = resolve(
  CONTRACTS_ROOT,
  "src/modules/keel-hold/tezos/keel_hold_onchfs.py",
);

test("protocol agrees with the authoritative Tezos byte-returning view", {
  skip: keelContractsSibling.skip,
}, () => {
  const storeSource = readFileSync(TEZOS_STORE_SOURCE, "utf8");

  assert.match(storeSource, /def get_object\(self, object_id\):/u);
  assert.match(storeSource, /def haul_object\(self, object_id\):/u);
  assert.equal(KEEL_TEZOS_OBJECT_VIEW, "haul_object");
});

test("browser bundle calls haul_object and decodes its returned bytes", async () => {
  const result = await build({
    stdin: {
      contents: [
        'export { createKeelRpcClient, KEEL_TEZOS_OBJECT_VIEW } from "./packages/protocol/dist/index.js";',
      ].join("\n"),
      resolveDir: ROOT,
      sourcefile: "tezos-view-browser-entry.mjs",
    },
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["es2022"],
    write: false,
    logLevel: "silent",
  });
  const bundledSource = result.outputFiles[0].text;
  assert.doesNotMatch(bundledSource, /from ["']node:/u);
  assert.doesNotMatch(bundledSource, /read_keel_object/u);

  const dataUrl = `data:text/javascript;base64,${Buffer.from(bundledSource).toString("base64")}`;
  const browserProtocol = await import(dataUrl);
  assert.equal(browserProtocol.KEEL_TEZOS_OBJECT_VIEW, "haul_object");

  const artwork = new Uint8Array([0x4b, 0x45, 0x45, 0x4c]);
  let requestBody;
  const client = browserProtocol.createKeelRpcClient({
    family: "tezos",
    network: "NetXdQprcVkpaWU",
    endpoints: ["https://rpc.tzkt.io/mainnet"],
    fetchImpl: async (_url, init) => {
      requestBody = JSON.parse(init.body);
      return new Response(
        JSON.stringify({ data: { bytes: Buffer.from(artwork).toString("hex") } }),
        { status: 200 },
      );
    },
  });

  assert.deepEqual(
    await client.haulObject(
      "KT1TestStoreAddressAAAAAAAAAAAAAAAA",
      `0x${"11".repeat(32)}`,
    ),
    artwork,
  );
  assert.equal(requestBody.view, "haul_object");
});
