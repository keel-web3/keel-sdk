import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const { buildStandaloneKeelViewer } = await import("../packages/sdk/dist/verification-shell.js");

function integrity(bytes) {
  return {
    algorithm: "sha256",
    digest: `0x${createHash("sha256").update(bytes).digest("hex")}`,
    byteLength: bytes.byteLength,
  };
}

const runtimeBytes = Buffer.from("<!doctype html><canvas></canvas>");
const wadBytes = Buffer.from("IWAD-hybrid-fixture");
const onchainRuntime = {
  id: "fray.modern-runtime",
  role: "entrypoint",
  mediaType: "text/html",
  aliases: [],
  integrity: integrity(runtimeBytes),
  chainId: 11155111,
  store: "0x0a4f31d5ab08029e4c68f6f3227d9fa3a2d66267",
  objectId: `0x${"12".repeat(32)}`,
};
const embeddedWad = {
  id: "fray.episode.e1",
  role: "data",
  mediaType: "application/x-doom-wad",
  aliases: [],
  integrity: integrity(wadBytes),
  embedded: {
    storedBase64: wadBytes.toString("base64"),
    compression: "none",
    storedIntegrity: integrity(wadBytes),
  },
};

function envelope(items = [onchainRuntime, embeddedWad]) {
  return {
    protocol: "keel-standalone-viewer@1",
    title: "FRAY hybrid fixture",
    deliveryProfile: "hybrid-mixed",
    rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com"],
    blockTag: "latest",
    entrypoint: "fray.modern-runtime",
    runtimeExpectations: { minimumCanvasCount: 1 },
    items,
  };
}

test("the canonical verifier accepts a mixed embedded WAD and RPC runtime graph", async () => {
  const viewer = await buildStandaloneKeelViewer({
    repositoryRoot: path.resolve(repositoryRoot),
    envelope: envelope(),
    brotliDecoder: "disabled",
  });
  const html = Buffer.from(viewer.html).toString("utf8");
  assert.match(html, /"deliveryProfile":"hybrid-mixed"/u);
  assert.match(html, /fray\.modern-runtime/u);
  assert.match(html, /fray\.episode\.e1/u);
  assert.match(html, /hybrid-mixed/u);
  assert.match(html, /ResizeObserver loop completed with undelivered notifications\./u);
});

test("hybrid delivery fails closed unless both source kinds are present", async () => {
  const embeddedRuntime = {
    ...onchainRuntime,
    chainId: undefined,
    store: undefined,
    objectId: undefined,
    embedded: {
      storedBase64: runtimeBytes.toString("base64"),
      compression: "none",
      storedIntegrity: integrity(runtimeBytes),
    },
  };
  await assert.rejects(
    buildStandaloneKeelViewer({ repositoryRoot, envelope: envelope([embeddedRuntime, embeddedWad]), brotliDecoder: "disabled" }),
    /at least one embedded item and at least one onchain item/u,
  );
});

test("hybrid delivery rejects an item committed to both embedded and onchain bytes", async () => {
  await assert.rejects(
    buildStandaloneKeelViewer({
      repositoryRoot,
      envelope: envelope([{ ...onchainRuntime, embedded: embeddedWad.embedded }, embeddedWad]),
      brotliDecoder: "disabled",
    }),
    /must use exactly one delivery source/u,
  );
});
