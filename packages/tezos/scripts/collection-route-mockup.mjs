#!/usr/bin/env node
/**
 * Offline end-to-end run of the KEEL Tezos creator-collection route.
 *
 * Every operation is prepared by `@keel/sdk/tezos-collection` and applied in a
 * network-disabled Octez mockup (the pinned image from keel-contracts
 * script/tezos/octez.py) with the mockup's bootstrap test accounts only. No
 * real network, wallet, or key is involved. Contract code comes from
 * keel-contracts `script/tezos/compile-collection-route.sh`.
 *
 * Usage: node packages/tezos/scripts/collection-route-mockup.mjs [--out report.json]
 */
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";

import * as route from "../../sdk/dist/tezos-collection.js";

const IMAGE = "tezos/tezos@sha256:c7adc1605e0ac167743e5ccc107c88719d201994b8166dd794ea10fd0488bea2";
const PROTOCOL = "PsUshuai9Qap";
const CONTRACTS = process.env.KEEL_CONTRACTS_DIR ?? path.join(import.meta.dirname, "../../../../keel-contracts");
const TARGETS = path.resolve(process.env.KEEL_TEZOS_ROUTE_TARGETS ?? path.join(CONTRACTS, "out/tezos-collection-route/targets"));
const outIndex = process.argv.indexOf("--out");
const OUT = outIndex < 0 ? undefined : path.resolve(process.argv[outIndex + 1]);
if (!existsSync(TARGETS)) throw new Error(`Compile the route first: keel-contracts/script/tezos/compile-collection-route.sh (${TARGETS})`);

const name = `keel-route-${randomBytes(6).toString("hex")}`;
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
docker("image", "inspect", IMAGE);
docker("run", "--rm", "-d", "--name", name, "--network", "none", "-v", `${TARGETS}:/targets:ro`, "--entrypoint", "/bin/sh", IMAGE, "-c", "sleep 3600");
const client = (...args) => execFileSync("docker", ["exec", name, "octez-client", "--base-dir", "/tmp/mockup", "--mode", "mockup", "--protocol", PROTOCOL, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });

/** Micheline JSON -> Michelson concrete syntax for octez-client. */
function michelson(node, inSequence = false) {
  if (Array.isArray(node)) return `{ ${node.map((item) => michelson(item, true)).join(" ; ")} }`;
  if ("int" in node) return node.int;
  if ("bytes" in node) return `0x${node.bytes}`;
  if ("string" in node) return JSON.stringify(node.string);
  const args = (node.args ?? []).map((item) => michelson(item));
  const annots = node.annots ?? [];
  if (args.length === 0 && annots.length === 0) return node.prim;
  const application = [node.prim, ...annots, ...args].join(" ");
  return inSequence ? application : `(${application})`;
}

const receipts = [];
function measure(step, label, output) {
  const sum = (re) => [...output.matchAll(re)].reduce((total, match) => total + Number(match[1].replace(/,/gu, "")), 0);
  const record = {
    step, label,
    feeTez: sum(/Fee to the baker: ꜩ([\d.,]+)/gu),
    storageBurnTez: sum(/storage fees \.*\s*\+ꜩ([\d.,]+)/gu),
    consumedGas: sum(/Consumed gas: ([\d.,]+)/gu),
    paidStorageBytes: sum(/Paid storage size diff: ([\d,]+) bytes/gu),
  };
  record.totalTez = Number((record.feeTez + record.storageBurnTez).toFixed(6));
  receipts.push(record);
  return record;
}

function apply(step, label, operation, from = "bootstrap1") {
  if (operation.kind === "origination") throw new Error("use originate()");
  const amount = (BigInt(operation.amount) / 1n).toString();
  const tez = (Number(amount) / 1e6).toFixed(6);
  const output = client("transfer", tez, "from", from, "to", operation.destination, "--entrypoint", operation.parameters.entrypoint, "--arg", michelson(operation.parameters.value), "--burn-cap", "100");
  const record = measure(step, label, output);
  process.stdout.write(`  ${step.padEnd(18)} ${label.padEnd(44)} gas ${String(record.consumedGas).padStart(9)}  burn ꜩ${record.storageBurnTez.toFixed(6)}  fee ꜩ${record.feeTez.toFixed(6)}\n`);
  return output;
}

function originate(step, entry, alias) {
  if (entry.operation === null) throw new Error(`${entry.contract} is unresolved: ${entry.unresolvedBindings}`);
  const directory = `collection_route_${{ creatorProfile: "creator_profile", oneMint: "one_mint" }[entry.artifact] ?? entry.artifact}`;
  const compiled = JSON.parse(execFileSync("cat", [path.join(TARGETS, directory, "step_001_cont_0_contract.json")], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
  if (JSON.stringify(compiled) !== JSON.stringify(entry.operation.script.code)) throw new Error(`${alias} code differs from the prepared origination.`);
  const output = client("originate", "contract", alias, "transferring", "0", "from", "bootstrap1", "running", `/targets/${directory}/step_001_cont_0_contract.tz`, "--init", michelson(entry.operation.script.storage), "--burn-cap", "100", "--force");
  const address = output.match(/New contract (KT1[1-9A-HJ-NP-Za-km-z]{33}) originated/u)?.[1];
  if (address === undefined) throw new Error(`${alias} origination did not report an address.`);
  const record = measure(step, `originate ${entry.contract}`, output);
  process.stdout.write(`  ${step.padEnd(18)} ${`originate ${entry.contract}`.padEnd(44)} gas ${String(record.consumedGas).padStart(9)}  burn ꜩ${record.storageBurnTez.toFixed(6)}  fee ꜩ${record.feeTez.toFixed(6)}  ${address}\n`);
  return address;
}

const view = (contract, viewName, input) => client("run", "view", viewName, "on", "contract", contract, "with", "input", input).trim();

/** A fetch shim that answers the SDK read-back through the mockup's own RPC services. */
const mockupFetch = async (url, init = {}) => {
  const { pathname } = new URL(url);
  // Mockup-only: the mockup client refuses /blocks/head/header (its fake head carries another chain id), so the
  // shim answers the header read with the current level. Every other read is the mockup's own RPC service.
  if (pathname === "/chains/main/blocks/head/header") {
    const level = JSON.parse(client("rpc", "get", "/chains/main/blocks/head/helpers/current_level"));
    return new Response(JSON.stringify({ level: level.level }), { status: 200, headers: { "content-type": "application/json" } });
  }
  const body = init.method === "POST" ? client("rpc", "post", pathname, "with", init.body) : client("rpc", "get", pathname);
  return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
};

const loadCode = (directory) => JSON.parse(execFileSync("cat", [path.join(TARGETS, directory, "step_001_cont_0_contract.json")], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
const failures = [];
const expect = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failures.push({ label, actual, expected });
  process.stdout.write(`  check ${label}: ${ok ? "ok" : `FAIL (${actual} != ${expected})`}\n`);
};

try {
  client("create", "mockup");
  const network = JSON.parse(client("rpc", "get", "/chains/main/chain_id"));
  const creator = client("show", "address", "bootstrap1").match(/Hash: (tz1\w+)/u)[1];
  const collector = client("show", "address", "bootstrap2").match(/Hash: (tz1\w+)/u)[1];
  const listed = client("show", "address", "bootstrap3").match(/Hash: (tz1\w+)/u)[1];
  const listed2 = client("show", "address", "bootstrap4").match(/Hash: (tz1\w+)/u)[1];
  const constants = JSON.parse(client("rpc", "get", "/chains/main/blocks/head/context/constants"));
  process.stdout.write(`mockup ${network} protocol ${PROTOCOL} cost_per_byte ${constants.cost_per_byte} mutez\n`);
  const code = {
    hold: { code: loadCode("collection_route_hold") },
    index: { code: loadCode("collection_route_index") },
    presentation: { code: loadCode("collection_route_presentation") },
    creatorProfile: { code: loadCode("collection_route_creator_profile") },
    collection: { code: loadCode("collection_route_collection") },
    oneMint: { code: loadCode("collection_route_one_mint") },
  };
  const collectionMetadata = { name: "KEEL Route Mockup", description: "Offline mockup of the KEEL Tezos creator-collection route.", version: "1" };
  // A 5% default royalty, set at origination as ERC-2981 does in the EVM constructor.
  const royalty = { receiver: listed2, bps: 500 };

  // 1. Foundation originations. The creator-profile manager must be an originated KT1; the mockup uses the Hold.
  let plan = route.prepareKeelTezosCollectionOriginations({ network, creator, maxSupply: 100, collectionMetadata, royalty, code: { hold: code.hold, index: code.index, presentation: code.presentation } });
  const byKey = (stage, key) => plan.stages[stage].operations.find((entry) => entry.artifact === key);
  const hold = originate("originate", byKey(0, "hold"), "hold");
  const index = originate("originate", byKey(0, "index"), "index");
  const presentation = originate("originate", byKey(0, "presentation"), "presentation");
  plan = route.prepareKeelTezosCollectionOriginations({ network, creator, maxSupply: 100, collectionMetadata, royalty, code, bindings: { hold, index, presentation, manager: hold } });
  const creatorProfile = originate("originate", byKey(0, "creatorProfile"), "creator_profile");
  plan = route.prepareKeelTezosCollectionOriginations({ network, creator, maxSupply: 100, collectionMetadata, royalty, code, bindings: { hold, index, presentation, creatorProfile } });
  const collection = originate("originate", byKey(1, "collection"), "collection");
  const oneMint = originate("originate", byKey(1, "oneMint"), "one_mint");

  // 2. Creator resources in the Hold.
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>KEEL cart</title><style>html,body{margin:0;height:100%;background:#111;color:#fc3;font:16px monospace}</style></head><body><main id="m">KEEL Tezos route</main><script>document.getElementById("m").textContent+=" #"+(new URLSearchParams(location.search).get("t")||"1")</script></body></html>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="#111"/><rect x="4" y="4" width="8" height="8" fill="#fc3"/></svg>`;
  const big = Buffer.from(Array.from({ length: 40_000 }, (_, i) => String.fromCharCode(32 + (i * 7) % 90)).join(""));
  const resources = route.prepareKeelTezosHoldResources({ network, creator, hold, directory: true, resources: [
    { name: "index.html", mediaType: "text/html", bytes: new TextEncoder().encode(html) },
    { name: "preview.svg", mediaType: "image/svg+xml", bytes: new TextEncoder().encode(svg) },
    { name: "atlas.txt", mediaType: "text/plain", bytes: big },
  ] });
  for (const operation of resources.operations) apply("hold-resources", `${operation.parameters.entrypoint}`, operation);
  for (const resource of resources.resources) {
    const object = view(hold, "get_object", `0x${resource.objectId}`);
    expect(`hold object ${resource.name} welded to its file`, object.includes(`0x${resource.fileCid}`), true);
    const file = view(hold, "read_file", `0x${resource.fileCid}`);
    expect(`onchfs read_file ${resource.name} returns the stored bytes`, file.includes(`0x${Buffer.from(resource.name === "atlas.txt" ? big : resource.name === "index.html" ? html : svg).toString("hex")}`), true);
  }
  const inode = view(hold, "get_inode_at", `(Pair 0x${resources.directory.cid} {})`);
  expect("onchfs directory CID matches the SDK", inode.includes(`0x${resources.directory.cid}`), true);

  // 3. Presentation binding.
  const renderer = resources.resources[0];
  const binding = route.prepareKeelTezosPresentationBinding({
    network, creator, collection, index,
    manifestUri: renderer.onchfsUri, manifestDigest: renderer.decodedSha256, previewUri: resources.resources[1].onchfsUri,
    presentationPolicy: { registry: presentation, salt: "01", mediaType: "text/html", maxBytes: 65_536, valueDigest: renderer.decodedSha256, byteLength: renderer.decodedByteLength },
  });
  for (const operation of binding.operations) apply("bind-presentation", operation.parameters.entrypoint, operation);
  expect("default_presentation names the renderer digest", view(collection, "default_presentation", "Unit").includes(renderer.decodedSha256), true);
  expect("presentation policy current revision", view(presentation, "current_presentation", `0x${binding.binding.presentationPolicyId}`).includes(renderer.decodedSha256), true);

  // 4. Mint gate: a paused public drop and a merkle allowlist drop.
  const far = 4_102_444_800;
  const drop = route.prepareKeelTezosMintGate({
    network, creator, collection, oneMint, supply: 10, maxPerTransaction: 3, maxPerWallet: 5, metadataDigest: "11".repeat(32), startPaused: true,
    creatorProfile: { registry: creatorProfile, username: "keel-route-mockup", metadataUri: "tezos-storage:profile" },
    stages: [{ kind: "public", startTime: 0, endTime: far, priceMutez: 1_000_000 }],
  });
  for (const operation of drop.operations) apply("configure-mint-gate", operation.parameters.entrypoint, operation);
  const latestA = view(oneMint, "latest_drop_for_target", JSON.stringify(collection));
  expect("predicted public drop id equals latest_drop_for_target", latestA, `0x${drop.drop.predictedDropId}`);
  for (const operation of drop.followUp.operations) apply("configure-mint-gate", operation.parameters.entrypoint, operation);
  const allowlist = [{ account: collector, allowance: 2 }, { account: listed, allowance: 1 }, { account: listed2, allowance: 1 }];
  const merkleDrop = route.prepareKeelTezosMintGate({
    network, creator, collection, oneMint, supply: 10, maxPerTransaction: 2, maxPerWallet: 2, metadataDigest: "22".repeat(32), setMinter: false, creatorNonce: 1,
    stages: [{ kind: "merkle", startTime: 0, endTime: far, priceMutez: 500_000, allowlist }],
  });
  for (const operation of merkleDrop.operations) apply("configure-mint-gate", operation.parameters.entrypoint, operation);
  expect("predicted merkle drop id equals latest_drop_for_target", view(oneMint, "latest_drop_for_target", JSON.stringify(collection)), `0x${merkleDrop.drop.predictedDropId}`);
  for (const operation of merkleDrop.followUp.operations) apply("configure-mint-gate", operation.parameters.entrypoint, operation);
  expect("SDK merkle leaf equals the merkle_leaf view", view(oneMint, "merkle_leaf", `(Pair ${JSON.stringify(collector)} 2)`), `0x${route.keelTezosOneMintMerkleLeaf(collector, 2)}`);

  // A paused drop refuses mints.
  const pilot = route.prepareKeelTezosMint({ network, sender: collector, oneMint, mints: [{ mode: "public", dropId: drop.drop.predictedDropId, stageIndex: 0, quantity: 1, priceMutez: 1_000_000 }] });
  let refused = false;
  try { apply("mint", "public_mint while paused", pilot.operations[0], "bootstrap2"); } catch (error) { refused = String(error.stderr ?? error.stdout ?? error).includes("DROP_PAUSED"); }
  expect("paused drop refuses public_mint", refused, true);
  apply("mint-gate-action", "unpause", route.prepareKeelTezosMintGateAction({ network, creator, oneMint, action: "unpause", dropId: drop.drop.predictedDropId }).operation);

  // 5. Mint: pilot, batch, allowlist.
  apply("mint", "public_mint pilot (token 1)", pilot.operations[0], "bootstrap2");
  const batch = route.prepareKeelTezosMint({ network, sender: collector, oneMint, mints: [{ mode: "public", dropId: drop.drop.predictedDropId, stageIndex: 0, quantity: 2, priceMutez: 1_000_000 }] });
  apply("mint", "public_mint batch x2 (tokens 2-3)", batch.operations[0], "bootstrap2");
  const proof = merkleDrop.drop.allowlists[0].proofs.find((leaf) => leaf.account === collector).proof;
  const allow = route.prepareKeelTezosMint({ network, sender: collector, oneMint, mints: [{ mode: "merkle", dropId: merkleDrop.drop.predictedDropId, stageIndex: 0, quantity: 1, priceMutez: 500_000, allowance: 2, proof }] });
  apply("mint", "merkle_mint allowlist (token 4)", allow.operations[0], "bootstrap2");
  expect("total_supply after mints", view(collection, "total_supply", "Unit"), "4");

  // 6. Token metadata: inline for tokens 1-2, onchfs Hold carrier for token 3.
  const metadata = route.prepareKeelTezosTokenMetadata({ network, creator, collection, tokens: [
    { tokenId: 1, name: "KEEL Route #1", description: "Pilot token", html, previewSvg: svg, attributes: [{ name: "edition", value: 1 }], creators: [creator] },
    { tokenId: 2, name: "KEEL Route #2", html, previewSvg: svg },
    { tokenId: 3, name: "KEEL Route #3", artifactUri: renderer.onchfsUri, displayUri: resources.resources[1].onchfsUri },
  ] });
  for (const operation of metadata.operations) apply("token-metadata", `set_token_metadata ${operation.parameters.value.args[0].int}`, operation);

  // 6b. Metadata authority: the creator rewrites; a holder cannot until the creator opts in.
  const refusedBy = (fn, reason) => { try { fn(); return false; } catch (error) { return String(error.stderr ?? error.stdout ?? error).includes(reason); } };
  expect("holder editing defaults to creator-only", view(collection, "token_owner_can_edit", "Unit"), "False");
  const holderEdit = route.prepareKeelTezosTokenMetadata({ network, creator: collector, collection, tokens: [{ tokenId: 1, name: "Holder rename", html, previewSvg: svg }] });
  expect("holder set_token_metadata refused by default", refusedBy(() => apply("metadata-authority", "holder set_token_metadata (refused)", holderEdit.operations[0], "bootstrap2"), "UNAUTHORIZED_PRESENTATION_EDITOR"), true);
  const rewrite = route.prepareKeelTezosTokenMetadata({ network, creator, collection, tokens: [{ tokenId: 2, name: "KEEL Route #2 (rewritten)", html, previewSvg: svg }] });
  apply("metadata-authority", "creator rewrite token 2", rewrite.operations[0]);
  apply("metadata-authority", "creator enables holder editing", route.prepareKeelTezosMintGateAction({ network, creator, action: "set-holder-metadata-editing", collection, enabled: true }).operation);
  const holderFreeze = route.prepareKeelTezosTokenMetadata({ network, creator: collector, collection, freeze: true, tokens: [{ tokenId: 4, name: "Holder edit #4", html, previewSvg: svg }] });
  for (const operation of holderFreeze.operations) apply("metadata-authority", `holder ${operation.parameters.entrypoint} token 4`, operation, "bootstrap2");
  apply("metadata-authority", "creator disables holder editing", route.prepareKeelTezosMintGateAction({ network, creator, action: "set-holder-metadata-editing", collection, enabled: false }).operation);
  const frozenRewrite = route.prepareKeelTezosTokenMetadata({ network, creator, collection, tokens: [{ tokenId: 4, name: "Creator after freeze", html, previewSvg: svg }] });
  expect("creator rewrite of a holder-frozen token refused", refusedBy(() => apply("metadata-authority", "creator rewrite frozen token (refused)", frozenRewrite.operations[0]), "TOKEN_PRESENTATION_FROZEN"), true);
  metadata.tokens[1] = rewrite.tokens[0];
  // TZIP-16 collection metadata: creator-maintained until welded.
  const rename = route.prepareKeelTezosMintGateAction({ network, creator, action: "set-collection-metadata", collection, collectionMetadata: { name: "KEEL Route Mockup (renamed)" } });
  expect("holder set_contract_metadata refused", refusedBy(() => apply("metadata-authority", "holder set_contract_metadata (refused)", rename.operation, "bootstrap2"), "ADMIN_ONLY"), true);
  apply("metadata-authority", "creator set_contract_metadata", rename.operation);
  apply("metadata-authority", "creator freeze_contract_metadata", route.prepareKeelTezosMintGateAction({ network, creator, action: "freeze-collection-metadata", collection }).operation);
  expect("contract metadata frozen", view(collection, "contract_metadata_frozen", "Unit"), "True");
  expect("set_contract_metadata refused after the weld", refusedBy(() => apply("metadata-authority", "creator set_contract_metadata (refused)", rename.operation), "CONTRACT_METADATA_FROZEN"), true);

  // 6c. Default royalty: what the KEEL market discovers through royalty_info. Creator-only.
  const royaltyOf = (price) => view(collection, "royalty_info", `(Pair 1 ${price})`);
  expect("origination royalty_info pays 5% of 2 tez", /^\(?Some \(Pair "(\w+)" 100000\)\)?$/u.exec(royaltyOf(2_000_000))?.[1], listed2);
  const holderRoyalty = route.prepareKeelTezosMintGateAction({ network, creator: collector, action: "set-default-royalty", collection, royalty: { receiver: collector, bps: 1000 } });
  expect("holder set_default_royalty refused", refusedBy(() => apply("royalty", "holder set_default_royalty (refused)", holderRoyalty.operation, "bootstrap2"), "ADMIN_ONLY"), true);
  apply("royalty", "creator remove-default-royalty", route.prepareKeelTezosMintGateAction({ network, creator, action: "remove-default-royalty", collection }).operation);
  expect("removed royalty reports None", royaltyOf(2_000_000), "None");
  const finalRoyalty = { receiver: listed, bps: 750 };
  apply("royalty", "creator set-default-royalty 7.5%", route.prepareKeelTezosMintGateAction({ network, creator, action: "set-default-royalty", collection, royalty: finalRoyalty }).operation);
  expect("royalty_info rounds down like ERC-2981", /^\(?Some \(Pair "(\w+)" 1\)\)?$/u.exec(royaltyOf(19))?.[1], listed);

  // 7. Read-back through the SDK checker, served by the mockup RPC.
  const check = await route.checkKeelTezosCollectionPublication({
    network, rpcUrl: "http://localhost:8732", collection, oneMint, hold, index, fetchImpl: mockupFetch, expectedRoyalty: finalRoyalty,
    expectedManifestDigest: renderer.decodedSha256, expectedObjects: resources.resources.map((resource) => resource.objectId),
    expectedTokens: [...metadata.tokens, holderFreeze.tokens[0]].map((token) => ({ tokenId: token.tokenId, tokenInfo: token.tokenInfo, tokenInfoSha256: token.tokenInfoSha256 })),
  });
  for (const item of check.checks) process.stdout.write(`  readback ${item.name}: ${item.ok ? "ok" : `FAIL ${JSON.stringify(item.detail)}`}\n`);
  expect("SDK read-back publicationVerified", check.publicationVerified, true);

  apply("mint-gate-action", "pause", route.prepareKeelTezosMintGateAction({ network, creator, oneMint, action: "pause", dropId: drop.drop.predictedDropId }).operation);
  apply("mint-gate-action", "withdraw proceeds", route.prepareKeelTezosMintGateAction({ network, creator, oneMint, action: "withdraw" }).operation);

  const totals = {};
  for (const record of receipts) {
    const total = totals[record.step] ??= { operations: 0, feeTez: 0, storageBurnTez: 0, totalTez: 0, consumedGas: 0, paidStorageBytes: 0 };
    total.operations += 1;
    for (const key of ["feeTez", "storageBurnTez", "totalTez", "consumedGas", "paidStorageBytes"]) total[key] = Number((total[key] + record[key]).toFixed(6));
  }
  const grand = Object.values(totals).reduce((sum, item) => Number((sum + item.totalTez).toFixed(6)), 0);
  const report = { schema: "keel-tezos-collection-route-mockup@1", environment: "offline-octez-mockup", image: IMAGE, protocol: PROTOCOL, network, costPerByteMutez: constants.cost_per_byte, addresses: { hold, index, presentation, creatorProfile, collection, oneMint }, totals, grandTotalTez: grand, receipts, readback: check, failures, liveChainProof: false };
  process.stdout.write(`\nper-step totals (ꜩ = fee + storage burn):\n${Object.entries(totals).map(([step, item]) => `  ${step.padEnd(20)} ops ${String(item.operations).padStart(3)}  ꜩ${item.totalTez.toFixed(6)}  (burn ꜩ${item.storageBurnTez.toFixed(6)}, fee ꜩ${item.feeTez.toFixed(6)}, ${item.paidStorageBytes} bytes, gas ${item.consumedGas})`).join("\n")}\n  grand total ꜩ${grand.toFixed(6)}\n`);
  process.stdout.write(`report sha256 ${createHash("sha256").update(JSON.stringify(report)).digest("hex")}\n`);
  if (OUT !== undefined) writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
  if (failures.length > 0) { process.stdout.write(`FAILED: ${JSON.stringify(failures)}\n`); process.exitCode = 1; }
} finally {
  try { docker("rm", "-f", name); } catch { /* container already gone */ }
}
