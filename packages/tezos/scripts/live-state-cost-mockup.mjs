#!/usr/bin/env node
/**
 * Offline cost comparison: token state shown by rewriting token_metadata vs read live by the token's HTML.
 *
 * Same harness as collection-route-mockup.mjs: KEEL's pinned Octez mockup image, `--network none`, the
 * mockup's bootstrap test accounts only, every KEEL call prepared by the SDK. No real network, wallet or key.
 *
 *   A  live read      the triggering action writes its record (cart_superseded, an image record); the token's
 *                     static HTML reads it at view time (@keel/sdk/tezos-live-state). No metadata write.
 *   B  creator rewrite small per-token token_metadata (shared onchfs artifact + state attributes), rewritten
 *                     by the creator in a batch, or by the triggering contract in the same operation through an
 *                     internal FA2 set_token_metadata (the contract is an FA2 administrator).
 *   0  inline rewrite the conventional case: the whole inline-HTML token_info is rewritten on each change.
 *
 * Also checks the live-state module end to end against the mockup's own RPC (big_map by script_expr through
 * /normalized, run_script_view): snapshot at publish, an onchain change, then the fragment's live read.
 *
 * Usage: DOCKER_HOST=unix://$HOME/.colima/default/docker.sock \
 *          node packages/tezos/scripts/live-state-cost-mockup.mjs [--out report.json] [--genesis <nocturnes-genesis>]
 */
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import * as route from "../../sdk/dist/tezos-collection.js";
import * as live from "../../sdk/dist/tezos-live-state.js";

const IMAGE = "tezos/tezos@sha256:c7adc1605e0ac167743e5ccc107c88719d201994b8166dd794ea10fd0488bea2";
const PROTOCOL = "PsUshuai9Qap";
const HERE = import.meta.dirname;
const TARGETS = path.resolve(process.env.KEEL_TEZOS_ROUTE_TARGETS ?? path.join(HERE, "../../../../keel-contracts/out/tezos-collection-route/targets"));
const arg = (flag) => { const index = process.argv.indexOf(flag); return index < 0 ? undefined : process.argv[index + 1]; };
const OUT = arg("--out") === undefined ? undefined : path.resolve(arg("--out"));
const GENESIS = path.resolve(arg("--genesis") ?? path.join(HERE, "../../../../nocturnes-genesis"));
if (!existsSync(TARGETS)) throw new Error(`Compile the route first: keel-contracts/script/tezos/compile-collection-route.sh (${TARGETS})`);
const genesisRun = (() => {
  const dir = path.join(GENESIS, "contracts/out/tezos");
  if (!existsSync(dir)) return undefined;
  const runs = readdirSync(dir).filter((name) => name.startsWith("run.")).map((name) => path.join(dir, name)).filter((run) => existsSync(path.join(run, "NOCTURNES_Tezos_images/step_012_cont_3_contract.tz")));
  return runs.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
})();

const name = `keel-live-${randomBytes(6).toString("hex")}`;
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
docker("image", "inspect", IMAGE);
docker("run", "--rm", "-d", "--name", name, "--network", "none", "-v", `${TARGETS}:/targets:ro`, "-v", `${HERE}:/s:ro`,
  ...(genesisRun ? ["-v", `${path.join(genesisRun, "NOCTURNES_Tezos_images")}:/genesis:ro`] : []),
  "--entrypoint", "/bin/sh", IMAGE, "-c", "sleep 3600");
const client = (...args) => {
  try {
    return execFileSync("docker", ["exec", name, "octez-client", "--base-dir", "/tmp/mockup", "--mode", "mockup", "--protocol", PROTOCOL, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) { const wrapped = new Error(`octez-client ${args.slice(0, 4).join(" ")} failed:\n${String((error.stdout ?? "") + (error.stderr ?? "")).slice(-1200)}`); wrapped.output = String((error.stdout ?? "") + (error.stderr ?? "")); throw wrapped; }
};

function michelson(node, inSequence = false) {
  if (Array.isArray(node)) return `{ ${node.map((item) => michelson(item, true)).join(" ; ")} }`;
  if ("int" in node) return node.int;
  if ("bytes" in node) return `0x${node.bytes}`;
  if ("string" in node) return JSON.stringify(node.string);
  const args = (node.args ?? []).map((item) => michelson(item));
  if (args.length === 0) return node.prim;
  const application = [node.prim, ...args].join(" ");
  return inSequence ? application : `(${application})`;
}

const receipts = [];
function measure(label, output, extra = {}) {
  const sum = (re) => [...output.matchAll(re)].reduce((total, match) => total + Number(match[1].replace(/,/gu, "")), 0);
  const record = {
    label,
    feeTez: Number(sum(/Fee to the baker: ꜩ([\d.,]+)/gu).toFixed(6)),
    storageBurnTez: Number(sum(/storage fees \.*\s*\+ꜩ([\d.,]+)/gu).toFixed(6)),
    consumedGas: Number(sum(/Consumed gas: ([\d.,]+)/gu).toFixed(3)),
    paidStorageBytes: sum(/Paid storage size diff: ([\d,]+) bytes/gu),
    ...extra,
  };
  record.totalTez = Number((record.feeTez + record.storageBurnTez).toFixed(6));
  receipts.push(record);
  process.stdout.write(`  ${label.padEnd(64)} gas ${String(record.consumedGas).padStart(10)}  bytes ${String(record.paidStorageBytes).padStart(6)}  burn ꜩ${record.storageBurnTez.toFixed(6)}  fee ꜩ${record.feeTez.toFixed(6)}  total ꜩ${record.totalTez.toFixed(6)}\n`);
  return record;
}

const transferArgs = (operation, from) => ["transfer", "0", "from", from, "to", operation.destination, "--entrypoint", operation.parameters.entrypoint, "--arg", michelson(operation.parameters.value), "--burn-cap", "100"];
const apply = (label, operation, from = "bootstrap1", extra) => measure(label, client(...transferArgs(operation, from)), extra);
const call = (destination, entrypoint, value) => ({ kind: "transaction", destination, amount: "0", parameters: { entrypoint, value } });
const batchJson = (operations) => JSON.stringify(operations.map((operation) => ({ destination: operation.destination, amount: "0", entrypoint: operation.parameters.entrypoint, arg: michelson(operation.parameters.value) })));
const applyBatch = (label, operations, from = "bootstrap1", extra = {}) => measure(label, client("multiple", "transfers", "from", from, "using", batchJson(operations), "--burn-cap", "500"), { transactions: operations.length, ...extra });
const fits = (args) => { try { client(...args, "--dry-run"); return true; } catch (error) { return { error: (error.output ?? String(error)).match(/(Oversized operation|[Gg]as limit[^\n]*|exceeded[^\n]*|too large[^\n]*)/u)?.[0] ?? "refused" }; } };
async function largest(low, high, works) {
  // largest n in [low, high] with works(n) === true; reports the first refusal seen above it
  let reason;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const result = works(mid);
    if (result === true) low = mid; else { high = mid - 1; reason = result.error; }
  }
  return { max: low, limitedBy: reason };
}

const failures = [];
const expect = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures.push({ label, actual, expected });
  process.stdout.write(`  check ${label}: ${ok ? "ok" : `FAIL (${JSON.stringify(actual)} != ${JSON.stringify(expected)})`}\n`);
};

/** The SDK read path served by the mockup's own RPC services (no network). */
const mockupFetch = async (url, init = {}) => {
  const { pathname } = new URL(url);
  const respond = (body, status = 200) => new Response(body === undefined ? null : typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (/\/blocks\/[^/]+\/header$/u.test(pathname)) {
    // Mockup-only: its fake head header carries another chain id; answer with the current level and head hash.
    const level = JSON.parse(client("rpc", "get", "/chains/main/blocks/head/helpers/current_level"));
    let hash;
    try { hash = JSON.parse(client("rpc", "get", "/chains/main/blocks/head/hash")); } catch { hash = undefined; }
    return respond({ level: level.level, ...(hash ? { hash } : {}) });
  }
  const rewritten = pathname.replace(/\/blocks\/B[1-9A-HJ-NP-Za-km-z]{50}\//u, "/blocks/head/");
  try {
    const body = init.method === "POST" ? client("rpc", "post", rewritten, "with", init.body) : client("rpc", "get", rewritten);
    return respond(body);
  } catch (error) {
    if (/not found|404|No service found|Did not find/iu.test(error.output ?? "")) return respond(undefined, 404);
    throw error;
  }
};

const ascii = (length, seed) => Array.from({ length }, (_, index) => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[(index * 7 + seed) % 62]).join("");
const inlineHtml = (generation, images) => `<!doctype html><html><head><meta charset="utf-8"><title>Cart</title><style>body{margin:0;background:#111;color:#fc3}</style></head><body><main data-generation="${generation}" data-images="${images}">${ascii(5_600, 3)}</main><script>document.title="Cart g"+document.querySelector("main").dataset.generation</script></body></html>`;
const previewSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="#111"/><text x="1" y="9">${ascii(820, 5)}</text></svg>`;
const attributes = (generation, images) => [{ name: "Generation", value: String(generation) }, { name: "Images", value: String(images) }];

try {
  client("create", "mockup");
  const network = JSON.parse(client("rpc", "get", "/chains/main/chain_id"));
  const creator = client("show", "address", "bootstrap1").match(/Hash: (tz1\w+)/u)[1];
  const collector = client("show", "address", "bootstrap2").match(/Hash: (tz1\w+)/u)[1];
  const constants = JSON.parse(client("rpc", "get", "/chains/main/blocks/head/context/constants"));
  const limits = { costPerByteMutez: Number(constants.cost_per_byte), hardGasLimitPerOperation: Number(constants.hard_gas_limit_per_operation), hardGasLimitPerBlock: Number(constants.hard_gas_limit_per_block), maxOperationDataLength: Number(constants.max_operation_data_length ?? 32_768) };
  process.stdout.write(`mockup ${network} protocol ${PROTOCOL} ${JSON.stringify(limits)}\n`);
  const loadCode = (directory) => ({ code: JSON.parse(readFileSync(path.join(TARGETS, directory, "step_001_cont_0_contract.json"), "utf8")) });
  const originate = (label, alias, file, init) => {
    const output = client("originate", "contract", alias, "transferring", "0", "from", "bootstrap1", "running", file, "--init", init, "--burn-cap", "100", "--force");
    measure(label, output);
    return output.match(/New contract (KT1[1-9A-HJ-NP-Za-km-z]{33}) originated/u)[1];
  };

  // ---- Setup: Hold, Index, FA2 (KEEL route code), 600 tokens, the cart stub as an FA2 administrator.
  process.stdout.write("\nsetup\n");
  let plan = route.prepareKeelTezosCollectionOriginations({ network, creator, maxSupply: 1000, code: { hold: loadCode("collection_route_hold"), index: loadCode("collection_route_index") } });
  const entry = (stage, key) => plan.stages[stage].operations.find((item) => item.artifact === key);
  const hold = originate("originate KeelHoldOnchFS", "hold", "/targets/collection_route_hold/step_001_cont_0_contract.tz", michelson(entry(0, "hold").operation.script.storage));
  const index = originate("originate KeelIndex", "index", "/targets/collection_route_index/step_001_cont_0_contract.tz", michelson(entry(0, "index").operation.script.storage));
  const fa2 = originate("originate KeelCollectionFA2", "fa2", "/targets/collection_route_collection/step_001_cont_0_contract.tz", michelson(route.buildKeelTezosCollectionFA2Storage({ administrator: creator, keelIndex: index, maxSupply: 1000 })));
  void plan;
  apply("set_minter", call(fa2, "set_minter", { prim: "Pair", args: [{ string: creator }, { prim: "True" }] }));
  for (let batch = 0; batch < 6; batch += 1) apply(`strike 100 (tokens ${batch * 100 + 1}-${batch * 100 + 100})`, call(fa2, "strike", { prim: "Pair", args: [{ string: collector }, { int: "100" }] }));
  const stub = originate("originate cart stub", "cart", "/s/live-state-cart-stub.tz", `(Pair "${fa2}" (Pair 0 (Pair {} {})))`);
  apply("add_administrator (cart stub)", call(fa2, "add_administrator", { string: stub }));

  // Shared artifact for B (one-time): the cart viewer and preview in the Hold, addressed per token.
  const shared = route.prepareKeelTezosHoldResources({ network, creator, hold, directory: true, resources: [
    { name: "index.html", mediaType: "text/html", bytes: new TextEncoder().encode(inlineHtml("?", "?")) },
    { name: "preview.svg", mediaType: "image/svg+xml", bytes: new TextEncoder().encode(previewSvg) },
  ] });
  const sharedStart = receipts.length;
  for (const operation of shared.operations) apply(`hold ${operation.parameters.entrypoint}`, operation);
  const sharedTotal = receipts.slice(sharedStart).reduce((sum, item) => sum + item.totalTez, 0);
  const smallToken = (tokenId, generation, images) => ({
    tokenId, name: `NOCTURNES Genesis #${tokenId}`,
    artifactUri: `onchfs://${shared.directory.cid}/index.html?t=${tokenId}`, displayUri: `onchfs://${shared.directory.cid}/preview.svg`,
    attributes: attributes(generation, images),
  });
  const inlineToken = (tokenId, generation, images) => ({ tokenId, name: `NOCTURNES Genesis #${tokenId}`, html: inlineHtml(generation, images), previewSvg, attributes: attributes(generation, images) });
  const metadataOps = (tokens) => route.prepareKeelTezosTokenMetadata({ network, creator, collection: fa2, tokens });

  // ---- 0: conventional inline-HTML token metadata.
  process.stdout.write("\n0  inline-HTML token_info rewrite (state inside the HTML)\n");
  const inlineFirst = metadataOps([inlineToken(1, 1, 0)]);
  const inlineBytes = inlineFirst.tokens[0].estimatedOperationBytes;
  const inlineWrite = apply(`first write, token 1 (~${inlineBytes} B operation)`, inlineFirst.operations[0], "bootstrap1", { operationBytes: inlineBytes });
  for (const tokenId of [2, 3]) apply(`first write, token ${tokenId}`, metadataOps([inlineToken(tokenId, 1, 0)]).operations[0]);
  const inlineSame = [1, 2, 3].map((tokenId) => apply(`rewrite token ${tokenId}, generation 1 -> 2 (same size)`, metadataOps([inlineToken(tokenId, 2, 0)]).operations[0]));
  const inlineGrow = apply("rewrite token 1, generation 2 -> 10 (+2 bytes: digit in HTML and attributes)", metadataOps([inlineToken(1, 10, 0)]).operations[0]);
  const inlinePerGroup = await largest(1, 4, (n) => fits(["multiple", "transfers", "from", "bootstrap1", "using", batchJson(metadataOps(Array.from({ length: n }, (_, i) => inlineToken(i + 1, 3, 0))).operations), "--burn-cap", "500"]));
  process.stdout.write(`  inline rewrites per operation group: ${inlinePerGroup.max} (${inlinePerGroup.limitedBy ?? "no refusal"})\n`);

  // ---- B: small per-token metadata, creator batch.
  process.stdout.write("\nB  small token_info (shared onchfs artifact + state attributes)\n");
  const smallFirst = metadataOps([smallToken(10, 1, 0)]);
  const smallBytes = smallFirst.tokens[0].estimatedOperationBytes;
  const smallWrite = apply(`first write, token 10 (~${smallBytes} B operation)`, smallFirst.operations[0], "bootstrap1", { operationBytes: smallBytes });
  const smallIds = Array.from({ length: 600 }, (_, i) => i + 1).filter((id) => id > 3);
  const writeStart = receipts.length;
  for (let offset = 0; offset < smallIds.length; offset += 30) {
    const slice = smallIds.slice(offset, offset + 30).filter((id) => id !== 10);
    applyBatch(`first write batch, ${slice.length} tokens`, metadataOps(slice.map((id) => smallToken(id, 1, 0))).operations);
  }
  const firstWriteBatches = receipts.slice(writeStart);
  const smallSame = apply("rewrite token 10, generation 1 -> 2 (same size)", metadataOps([smallToken(10, 2, 0)]).operations[0]);
  const smallGrow = apply("rewrite token 10, generation 2 -> 10 (+1 byte)", metadataOps([smallToken(10, 10, 0)]).operations[0]);
  const smallShrink = apply("rewrite token 10, generation 10 -> 3 (-1 byte)", metadataOps([smallToken(10, 3, 0)]).operations[0]);
  const smallRegrow = apply("rewrite token 10, generation 3 -> 11 (back to the paid size)", metadataOps([smallToken(10, 11, 0)]).operations[0]);
  const groupMax = await largest(1, 120, (n) => fits(["multiple", "transfers", "from", "bootstrap1", "using", batchJson(metadataOps(smallIds.slice(0, n).map((id) => smallToken(id, 1, 1))).operations), "--burn-cap", "500"]));
  process.stdout.write(`  creator batch: max ${groupMax.max} set_token_metadata per operation group (${groupMax.limitedBy ?? "no refusal"})\n`);
  const hundred = smallIds.slice(0, 100);
  const creator100 = [];
  for (let offset = 0; offset < hundred.length; offset += groupMax.max) {
    const slice = hundred.slice(offset, offset + groupMax.max);
    creator100.push(applyBatch(`creator batch rewrite, ${slice.length} tokens (images 0 -> 1)`, metadataOps(slice.map((id) => smallToken(id, 1, 1))).operations));
  }
  const creatorMax = applyBatch(`creator batch rewrite, max ${groupMax.max} tokens in one group`, metadataOps(smallIds.slice(0, groupMax.max).map((id) => smallToken(id, 1, 2))).operations);

  // ---- A vs B in the triggering call (cart stub).
  process.stdout.write("\nA vs B in the triggering call (cart stub)\n");
  const hash = (text) => createHash("sha256").update(text).digest("hex");
  const nat = (value) => ({ int: String(value) });
  const supersede = (entrypoint, tokenId, cart) => call(stub, entrypoint, { prim: "Pair", args: [nat(tokenId), { bytes: hash(cart) }] });
  apply("supersede token 20 (first record, warm-up)", supersede("supersede", 20, "cart-20-g1"));
  const aOnly = apply("A: supersede token 20 (record + cart_superseded event)", supersede("supersede", 20, "cart-20-g2"));
  apply("B warm-up: supersede_and_rewrite token 21 (stub attribute format)", supersede("supersede_and_rewrite", 21, "cart-21-g1"));
  apply("B warm-up: supersede token 21", supersede("supersede", 21, "cart-21-g2"));
  const bSame = apply("B: supersede_and_rewrite token 21 (record + event + rewrite, same op)", supersede("supersede_and_rewrite", 21, "cart-21-g3"));
  const meta21 = route.decodeKeelTezosTokenMetadataView(JSON.parse(client("rpc", "post", "/chains/main/blocks/head/helpers/scripts/run_script_view", "with", JSON.stringify({ contract: fa2, view: "token_metadata", input: nat(21), chain_id: network, unparsing_mode: "Readable" }))).data);
  expect("the triggering call rewrote token 21's attributes", JSON.parse(meta21.tokenInfo.attributes), attributes(3, 0));
  expect("and left its artifactUri alone", meta21.tokenInfo.artifactUri, smallToken(21, 0, 0).artifactUri);
  const internalMax = await largest(1, 590, (n) => fits(["transfer", "0", "from", "bootstrap1", "to", stub, "--entrypoint", "add_image_and_rewrite", "--arg", `{ ${smallIds.slice(0, n).join(" ; ")} }`, "--burn-cap", "500"]));
  process.stdout.write(`  contract-internal batch: max ${internalMax.max} rewrites in one operation (${internalMax.limitedBy ?? "no refusal"})\n`);
  const internal100 = measure("B: add_image_and_rewrite, 100 tokens in one operation", client("transfer", "0", "from", "bootstrap1", "to", stub, "--entrypoint", "add_image_and_rewrite", "--arg", `{ ${hundred.join(" ; ")} }`, "--burn-cap", "500"), { transactions: 1, internalRewrites: 100 });
  const internal1 = measure("B: add_image_and_rewrite, 1 token", client("transfer", "0", "from", "bootstrap1", "to", stub, "--entrypoint", "add_image_and_rewrite", "--arg", `{ ${hundred[0]} }`, "--burn-cap", "500"), { transactions: 1, internalRewrites: 1 });
  const internalAtMax = measure(`B: add_image_and_rewrite, max ${internalMax.max} tokens in one operation`, client("transfer", "0", "from", "bootstrap1", "to", stub, "--entrypoint", "add_image_and_rewrite", "--arg", `{ ${smallIds.slice(0, internalMax.max).join(" ; ")} }`, "--burn-cap", "500"), { transactions: 1, internalRewrites: internalMax.max });

  // ---- A's only write for a global change: the real Genesis image record, when its compiled contracts exist.
  let genesisImage;
  if (genesisRun) {
    process.stdout.write("\nA: Genesis image record (compiled nocturnes_images.py, companion for its admin view)\n");
    const storage = (file) => readFileSync(path.join(genesisRun, "NOCTURNES_Tezos_images", file), "utf8").trim();
    const companion = originate("originate Genesis companion", "companion", "/genesis/step_010_cont_1_contract.tz",
      storage("step_010_cont_1_storage.tz").replace("tz1UyQDepgtUBnWjyzzonqeDwaiWoQzRKSP5", creator).replace("KT1TezoooozzSmartPyzzSTATiCzzzwwBFA1", fa2).replace(/"1970-01-01T00:16:40Z"/u, '"1970-01-01T00:00:00Z"'));
    const images = originate("originate Genesis images", "images", "/genesis/step_012_cont_3_contract.tz", storage("step_012_cont_3_storage.tz").replace("KT1Tezooo1zzSmartPyzzSTATiCzzzyfC8eF", companion));
    const codec = `0x4e4b523100${"5a".repeat(1_095)}`;
    genesisImage = measure("A: add_global_image (1.1 KB NKR1 codec)", client("transfer", "0", "from", "bootstrap1", "to", images, "--entrypoint", "add_global_image", "--arg", codec, "--burn-cap", "10"));
  }

  // ---- The live-state module against the mockup RPC: snapshot, change, live read.
  process.stdout.write("\nlive-state module against the mockup RPC\n");
  const reads = [
    { name: "generation", kind: "big_map", contract: stub, bigMap: "generation_count", key: { type: "nat", value: 20 }, value: "nat", absent: 0 },
    { name: "cart", kind: "big_map", contract: stub, bigMap: "generations", key: { type: { pair: ["nat", "nat"] }, value: [20, 2] }, value: "bytes" },
    { name: "generationView", kind: "view", contract: stub, view: "generation_of", input: { type: "nat", value: 20 }, returns: "nat" },
    { name: "images", kind: "view", contract: stub, view: "image_count", returns: "nat" },
    { name: "never", kind: "big_map", contract: stub, bigMap: "generation_count", key: { type: "nat", value: 999 }, value: "nat", absent: 0 },
  ];
  const prepared = await live.prepareKeelTezosLiveState({ network, rpcUrl: "http://localhost:8732", reads, rpcUrls: ["http://localhost:8732"], allowLoopbackEndpoints: true, autoRefresh: false, fetchImpl: mockupFetch });
  for (const check of prepared.typeChecks) process.stdout.write(`  type ${check.name}: ${check.detail}\n`);
  expect("snapshot generation (big_map by script_expr)", prepared.snapshot.values.generation, 2);
  expect("snapshot cart hash (pair key)", prepared.snapshot.values.cart, hash("cart-20-g2"));
  expect("snapshot generation via run_script_view", prepared.snapshot.values.generationView, 2);
  expect("absent key reads as declared", prepared.snapshot.values.never, 0);
  let refused = "";
  try { await live.readKeelTezosLiveState({ network, rpcUrl: "http://localhost:8732", reads: [{ ...reads[1], key: { type: { record: [["generation", "nat"], ["token_id", "int"]] }, value: { generation: 2, token_id: 20 } } }], fetchImpl: mockupFetch }); } catch (error) { refused = error.message; }
  expect("a key type that is not the contract's is refused", /declared key type/u.test(refused), true);
  apply("A: supersede token 20 again (generation 3), after the snapshot", supersede("supersede", 20, "cart-20-g3"));
  const offline = live.runKeelTezosLiveStateFragment(prepared.fragment);
  expect("blocked network: the token shows the snapshot", offline.values.generation, 2);
  const online = live.runKeelTezosLiveStateFragment(prepared.fragment, { fetch: mockupFetch });
  const state = await online.refresh();
  expect("live read: status", state.status, "live");
  expect("live read: generation after the change", online.values.generation, 3);
  expect("live read: view after the change", online.values.generationView, 3);
  expect("live read: images after add_image_and_rewrite x3", online.values.images, 3);

  // ---- Summary.
  const r = (value) => Number(value.toFixed(6));
  const sumTez = (items) => r(items.reduce((total, item) => total + item.totalTez, 0));
  const inlineSameTez = inlineSame[0].totalTez;
  const groups = Math.ceil(100 / Math.max(1, inlinePerGroup.max));
  const report = {
    schema: "keel-tezos-live-state-cost-mockup@1", environment: "offline-octez-mockup", image: IMAGE, protocol: PROTOCOL, network, limits, liveChainProof: false,
    addresses: { hold, index, fa2, stub },
    sizes: { inlineTokenOperationBytes: inlineBytes, smallTokenOperationBytes: smallBytes, sharedHoldResources: shared.resources.map((item) => ({ name: item.name, bytes: item.byteLength ?? item.decodedByteLength })) },
    costs: {
      inlineFirstWrite: inlineWrite,
      inlineSameSizeRewrite: inlineSame,
      inlineGrowRewrite: inlineGrow,
      inlinePerOperationGroup: inlinePerGroup,
      inline100Tokens: { measuredPerToken: inlineSameTez, operationGroups: groups, totalTez: r(inlineSameTez * 100), note: "100 x the measured same-size rewrite; identical size means identical fee" },
      smallFirstWrite: smallWrite,
      smallFirstWriteBatches: { operations: firstWriteBatches.length, tokens: smallIds.length, totalTez: sumTez(firstWriteBatches) },
      smallSameSizeRewrite: smallSame, smallGrow, smallShrink, smallRegrow,
      creatorBatch: { maxPerGroup: groupMax, hundredTokens: { groups: creator100.length, totalTez: sumTez(creator100), receipts: creator100 }, maxGroup: creatorMax },
      triggeringCall: { aOnly, bSameOperation: bSame, extraTez: r(bSame.totalTez - aOnly.totalTez), extraGas: r(bSame.consumedGas - aOnly.consumedGas) },
      contractInternalBatch: { max: internalMax, one: internal1, hundred: internal100, atMax: internalAtMax },
      sharedArtifactOnce: { totalTez: r(sharedTotal) },
      genesisImageRecord: genesisImage ?? null,
    },
    liveState: { fragmentBytes: prepared.fragment.byteLength, fragmentSha256: prepared.fragment.digest, snapshot: prepared.snapshot, live: state.values, typeChecks: prepared.typeChecks },
    receipts, failures,
  };
  process.stdout.write(`\nsummary\n${JSON.stringify(report.costs.triggeringCall)}\nfragment ${prepared.fragment.byteLength} B\nreport sha256 ${createHash("sha256").update(JSON.stringify(report)).digest("hex")}\n`);
  if (OUT !== undefined) writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
  if (failures.length > 0) { process.stdout.write(`FAILED: ${JSON.stringify(failures)}\n`); process.exitCode = 1; }
} finally {
  try { docker("rm", "-f", name); } catch { /* already gone */ }
}
