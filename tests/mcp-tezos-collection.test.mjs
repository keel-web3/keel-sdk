import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import { createMcpServer } from "../packages/mcp/dist/index.js";
import { KEEL_TEZOS_COLLECTION_ROUTE_CONTRACTS, KEEL_TEZOS_COLLECTION_ROUTE_TOOLS, KEEL_TEZOS_MODULES } from "../packages/sdk/dist/index.js";

const initialize = { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "tezos-collection-test", version: "1" } };
const network = "NetXsqzbfFenSTS";
const creator = "tz1KqTpEZ7Yob7QbPE4Hy4Wo8fHG8LhKxZSx";
const collector = "tz1gjaF81ZRRvdzjobyfVNsAeSC6PScjfQwN";
// Octez mockup addresses (never live deployments).
const hold = "KT1BZxyjk9FSoFZi2bnDMut8qMECMRBLiVBX";
const index = "KT1UcmS1Kqq1EPryEuJ24j2WhzFpxSu2piJA";
const collection = "KT1BCTYMUJ1LoQhzpCDS6oevoHAHQ7sLu8Wb";
const oneMint = "KT1ScxDmr8x859ztMC5n8wxz51wna8BuH8us";
const registry = "KT1ELDQU3zXFZzuchGYFDbMip2M94i4BJY6C";
const DIRECTORIES = { hold: "collection_route_hold", index: "collection_route_index", collection: "collection_route_collection", presentation: "collection_route_presentation", creatorProfile: "collection_route_creator_profile", oneMint: "collection_route_one_mint" };

async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "keel-tezos-collection-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const [key, directory] of Object.entries(DIRECTORIES)) {
    const contract = KEEL_TEZOS_COLLECTION_ROUTE_CONTRACTS[key].contract;
    const entrypoints = KEEL_TEZOS_MODULES.flatMap((module) => module.entrypoints[contract] ?? []);
    const code = [{ prim: "parameter", args: [{ prim: "or", args: entrypoints.map((name) => ({ prim: "unit", annots: [`%${name}`] })) }] }, { prim: "storage", args: [{ prim: "unit" }] }, { prim: "code", args: [[]] }];
    await mkdir(path.join(dir, "targets", directory), { recursive: true });
    await writeFile(path.join(dir, "targets", directory, "step_001_cont_0_contract.json"), JSON.stringify(code));
  }
  await writeFile(path.join(dir, "cart.html"), "<!doctype html><title>cart</title><p>rain</p>");
  await writeFile(path.join(dir, "preview.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");
  const server = await createMcpServer({ workspaceRoot: dir });
  await server.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: initialize });
  let id = 2;
  const call = async (name, args) => (await server.handle({ jsonrpc: "2.0", id: id++, method: "tools/call", params: { name, arguments: args } })).result;
  return { dir, server, call };
}

test("MCP lists every Tezos collection-route tool with a schema", async (t) => {
  const { server } = await fixture(t);
  const listed = await server.handle({ jsonrpc: "2.0", id: 9, method: "tools/list" });
  const names = listed.result.tools.map((tool) => tool.name);
  for (const name of KEEL_TEZOS_COLLECTION_ROUTE_TOOLS) {
    assert.ok(names.includes(name), name);
    const tool = listed.result.tools.find((item) => item.name === name);
    assert.equal(tool.inputSchema.type, "object");
    assert.equal(tool.inputSchema.additionalProperties, false);
  }
});

test("MCP plans, originates, stores, binds, gates, mints and writes metadata review-only", async (t) => {
  const { call } = await fixture(t);
  const plan = await call("keel-tezos-collection-launch-plan", { network, creator, maxSupply: "333" });
  assert.equal(plan.isError, undefined, JSON.stringify(plan));
  assert.equal(plan.structuredContent.steps[0].tool, "keel-tezos-collection-originate-prepare");

  const originate = await call("keel-tezos-collection-originate-prepare", { network, creator, maxSupply: 333, artifactsDir: "targets", collectionMetadata: { name: "NOCTURNES Genesis" }, bindings: { index, creatorProfile: registry } });
  assert.equal(originate.isError, undefined, JSON.stringify(originate));
  const collectionEntry = originate.structuredContent.stages[1].operations.find((entry) => entry.artifact === "collection");
  assert.equal(collectionEntry.operation.kind, "origination");
  assert.deepEqual(originate.structuredContent.collection.metadataEditing, { creator: true, holders: false, holderFreeze: false });
  const holders = await call("keel-tezos-mint-gate-prepare", { network, creator, action: "set-holder-metadata-editing", collection, enabled: true });
  assert.equal(holders.isError, undefined, JSON.stringify(holders));
  assert.equal(holders.structuredContent.operation.parameters.entrypoint, "set_token_owner_can_edit");
  const royalty = await call("keel-tezos-mint-gate-prepare", { network, creator, action: "set-default-royalty", collection, royalty: { receiver: creator, bps: 500 } });
  assert.equal(royalty.structuredContent.operation.parameters.entrypoint, "set_default_royalty");
  const removed = await call("keel-tezos-mint-gate-prepare", { network, creator, action: "remove-default-royalty", collection });
  assert.deepEqual(removed.structuredContent.operation.parameters.value, { prim: "None" });
  assert.deepEqual(holders.structuredContent.operation.parameters.value, { prim: "True" });
  assert.equal(originate.structuredContent.signing, "not-performed");

  const resources = await call("keel-tezos-hold-resources-prepare", { network, creator, hold, directory: true, resources: [{ name: "cart.html", mediaType: "text/html", path: "cart.html" }, { name: "preview.svg", mediaType: "image/svg+xml", path: "preview.svg" }] });
  assert.equal(resources.isError, undefined, JSON.stringify(resources));
  const [html, svg] = resources.structuredContent.resources;
  assert.match(html.onchfsUri, /^onchfs:\/\/[0-9a-f]{64}$/u);

  const bind = await call("keel-tezos-presentation-bind-prepare", { network, creator, collection, index, manifestUri: html.onchfsUri, manifestDigest: html.decodedSha256, previewUri: svg.onchfsUri });
  assert.deepEqual(bind.structuredContent.operations.map((operation) => operation.parameters.entrypoint), ["register_collection", "publish_collection_revision", "activate_collection_revision", "set_default_presentation"]);

  const gate = await call("keel-tezos-mint-gate-prepare", { network, creator, collection, oneMint, supply: "333", maxPerTransaction: 3, maxPerWallet: 5, metadataDigest: "11".repeat(32), startPaused: true, stages: [{ kind: "merkle", startTime: 0, endTime: 100, priceMutez: "500000", allowlist: [{ account: collector, allowance: 2 }] }, { kind: "public", startTime: 100, endTime: 200, priceMutez: "1000000" }] });
  assert.equal(gate.isError, undefined, JSON.stringify(gate));
  const dropId = gate.structuredContent.drop.predictedDropId;
  const pause = await call("keel-tezos-mint-gate-prepare", { network, creator, oneMint, action: "pause", dropId });
  assert.equal(pause.structuredContent.operation.parameters.entrypoint, "set_drop_paused");

  const proof = gate.structuredContent.drop.allowlists[0].proofs[0].proof;
  const mint = await call("keel-tezos-mint-prepare", { network, sender: collector, oneMint, mints: [{ mode: "merkle", dropId, stageIndex: 0, quantity: 2, priceMutez: "500000", allowance: 2, proof }, { mode: "public", dropId, stageIndex: 1, quantity: 3, priceMutez: "1000000" }] });
  assert.equal(mint.structuredContent.paymentMutez, "4000000");

  const metadata = await call("keel-tezos-token-metadata-prepare", { network, creator, collection, tokens: [{ tokenId: 1, name: "Cart #1", htmlPath: "cart.html", previewSvgPath: "preview.svg" }, { tokenId: 2, name: "Cart #2", artifactUri: html.onchfsUri, displayUri: svg.onchfsUri, royalties: { decimals: 4, shares: [{ recipient: creator, share: 1000 }] } }] });
  assert.equal(metadata.isError, undefined, JSON.stringify(metadata));
  assert.match(metadata.structuredContent.tokens[0].tokenInfo.artifactUri, /^data:text\/html;charset=utf-8,/u);
  assert.deepEqual(JSON.parse(metadata.structuredContent.tokens[1].tokenInfo.royalties), { decimals: 4, shares: { [creator]: 1000 } });

  const pointer = await call("keel-tezos-token-metadata-prepare", { network, creator, collection, tokens: [{ tokenId: 1, name: "x", artifactUri: "keel-onchain://x", previewSvgPath: "preview.svg" }] });
  assert.equal(pointer.isError, true);
});

test("MCP Tezos tools refuse key material and wrong network identities", async (t) => {
  const { call } = await fixture(t);
  const secret = await call("keel-tezos-mint-prepare", { network, sender: collector, oneMint, privateKey: "edsk...", mints: [{ mode: "direct", quantity: 1 }] });
  assert.equal(secret.isError, true);
  assert.match(secret.content[0].text, /Private signer material/u);
  const nested = await call("keel-tezos-collection-launch-plan", { network, creator, maxSupply: 1, extra: { mnemonic: "x" } });
  assert.equal(nested.isError, true);
  const badNetwork = await call("keel-tezos-collection-launch-plan", { network: "mainnet", creator, maxSupply: 1 });
  assert.equal(badNetwork.isError, true);
});

test("MCP read-back verifies a collection against a loopback Tezos RPC", async (t) => {
  const { call } = await fixture(t);
  const metadata = await call("keel-tezos-token-metadata-prepare", { network, creator, collection, tokens: [{ tokenId: 1, name: "Cart #1", html: "<p>x</p>", previewSvg: "<svg/>" }] });
  const tokenMap = metadata.structuredContent.operations[0].parameters.value.args[1];
  const rpc = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => { raw += chunk; });
    request.on("end", () => {
      let body;
      if (request.url.endsWith("/chain_id")) body = network;
      else if (request.url.endsWith("/header")) body = { level: 42 };
      else if (request.url.endsWith("/script")) body = { code: [] };
      else body = { data: { total_supply: { int: "1" }, is_minter: { prim: "True" }, token_owner_can_edit: { prim: "False" }, royalty_info: { prim: "None" }, token_metadata: { prim: "Pair", args: [{ int: "1" }, tokenMap] } }[JSON.parse(raw).view] };
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(body));
    });
  });
  await new Promise((done) => rpc.listen(0, "127.0.0.1", done));
  t.after(() => rpc.close());
  const rpcUrl = `http://127.0.0.1:${rpc.address().port}`;
  const result = await call("keel-tezos-readback-check", { network, rpcUrl, collection, oneMint, expectedTokens: [{ tokenId: 1, tokenInfoSha256: metadata.structuredContent.tokens[0].tokenInfoSha256 }] });
  assert.equal(result.isError, undefined, JSON.stringify(result));
  assert.equal(result.structuredContent.publicationVerified, true, JSON.stringify(result.structuredContent.checks));
  const tampered = await call("keel-tezos-readback-check", { network, rpcUrl, collection, expectedTokens: [{ tokenId: 1, tokenInfoSha256: "00".repeat(32) }] });
  assert.equal(tampered.structuredContent.publicationVerified, false);
  // A collection that lets holders edit is not the creator-only collection the caller expects.
  const noRoyalty = await call("keel-tezos-readback-check", { network, rpcUrl, collection, expectNoRoyalty: true });
  assert.equal(noRoyalty.structuredContent.checks.find((check) => check.name === "default-royalty").ok, true);
  const holderEditable = await call("keel-tezos-readback-check", { network, rpcUrl, collection, expectedHolderMetadataEditing: true });
  assert.equal(holderEditable.structuredContent.publicationVerified, false);
  assert.equal(holderEditable.structuredContent.checks.find((check) => check.name === "metadata-editing-authority").ok, false);
});

test("MCP prepares harness tree calls on the piece that holds them", async (t) => {
  const { call } = await fixture(t);
  const tree = "KT1BNnzhtsMKUG7t72phZN8BG2W6TwPUQsYt";
  const digest = `0x${"11".repeat(32)}`;
  const forged = await call("keel-tezos-harness-tree-prepare", { network, sender: creator, harnessRegistry: registry, treeRegistry: tree,
    action: { kind: "forge", salt: "0x01", collection, editPolicy: 0, forkPolicy: 1, children: [{ key: 1, revision: 1 }, { key: 2, revision: 1 }], manifestDigest: digest, entropySetDigest: digest } });
  assert.equal(forged.isError, undefined, JSON.stringify(forged));
  assert.equal(forged.structuredContent.operation.destination, tree);
  assert.equal(forged.structuredContent.operation.parameters.entrypoint, "forge_harness_tree");
  assert.equal(forged.structuredContent.treeDigest, "0xaf3c157af65142cf4a2f8cde2e5c6d24530e78cf8ec7c2c94d556f5ff65b398d");
  assert.equal(forged.structuredContent.signing, "not-performed");
  const selections = await call("keel-tezos-harness-tree-prepare", { network, sender: creator, harnessRegistry: registry, treeRegistry: tree,
    action: { kind: "append-selections", harnessId: `0x${"ab".repeat(32)}`, expectedParent: 1, revisions: [2, 1], manifestDigest: digest, entropySetDigest: digest } });
  assert.equal(selections.structuredContent.operation.destination, registry);
  const refused = await call("keel-tezos-harness-tree-prepare", { network, sender: creator, harnessRegistry: registry, treeRegistry: tree, action: { kind: "set-limits", maxDepth: 1, maxObjects: 1 } });
  assert.equal(refused.isError, true);
});

test("MCP prepares automation keys, grants, the signing payload and the relayer call", async (t) => {
  const { call } = await fixture(t);
  const controller = "KT1BNnzhtsMKUG7t72phZN8BG2W6TwPUQsYt";
  const target = "KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton";
  const signer = "tz1KqTpEZ7Yob7QbPE4Hy4Wo8fHG8LhKxZSx";
  const managed = { target, payload: "0x05002a", amount: 2 };
  const key = await call("keel-tezos-automation-prepare", { network, controller, action: { kind: "key", publicKey: "edpkuBknW28nW72KG6RoHtYW7p12T6GKc7nAbwYX5m8Wd9sDVC9yav", validUntil: 87400, enabled: true } });
  assert.equal(key.isError, undefined, JSON.stringify(key));
  assert.equal(key.structuredContent.result.signer, signer);
  assert.equal(key.structuredContent.result.actions[0].operation.parameters.entrypoint, "configure_automation_key");
  const grant = await call("keel-tezos-automation-prepare", { network, controller, action: { kind: "grant", signer, call: { target, payload: "0x05002a" }, validAfter: 1000, validUntil: 4600, maxAmount: 3, enabled: true } });
  assert.equal(grant.structuredContent.result.operation.parameters.entrypoint, "configure_automation_capability");
  const payload = await call("keel-tezos-automation-prepare", { network, controller, action: { kind: "signing-payload", signer, call: managed, nonce: 0, deadline: 1200 } });
  assert.match(payload.structuredContent.result, /^0x05/u);
  const execute = await call("keel-tezos-automation-prepare", { network, controller, action: { kind: "execute", signer, call: managed, deadline: 1200, signature: "edsigtaLvXR5xFtiGkKFegQXhWnxxsBYPCk4DJvYU8hb5xSdxQjppPgdtE77E6CXQrm9obabM7ycWNNVAq1r65RzKo7yMSD4yAz" } });
  assert.equal(execute.structuredContent.result.operation.parameters.entrypoint, "execute_automation");
  assert.equal(execute.structuredContent.signing, "not-performed");
  const contractSigner = await call("keel-tezos-automation-prepare", { network, controller, action: { kind: "signing-payload", signer: target, call: managed, nonce: 0, deadline: 1200 } });
  assert.equal(contractSigner.isError, true);
});

test("MCP prepares token-bound account creation and owner execution, refusing delegate calls", async (t) => {
  const { call } = await fixture(t);
  const accountRegistry = "KT1BNnzhtsMKUG7t72phZN8BG2W6TwPUQsYt";
  const created = await call("keel-tezos-token-bound-account-prepare", { network, action: { kind: "create", registry: accountRegistry, tokenContract: collection, tokenId: 1, salt: "0x01" } });
  assert.equal(created.isError, undefined, JSON.stringify(created));
  assert.equal(created.structuredContent.operation.destination, accountRegistry);
  assert.equal(created.structuredContent.operation.parameters.entrypoint, "create_account");
  assert.equal(created.structuredContent.readBack.view, "account");
  assert.equal(created.structuredContent.signing, "not-performed");
  const account = "KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton";
  const executed = await call("keel-tezos-token-bound-account-prepare", { network, action: { kind: "execute", account, calls: [{ kind: "value", to: collector, amount: 5 }, { kind: "fa2", fa2: collection, tokenId: 2, to: collector }] } });
  assert.equal(executed.isError, undefined, JSON.stringify(executed));
  assert.equal(executed.structuredContent.operation.destination, account);
  assert.equal(executed.structuredContent.operation.parameters.entrypoint, "execute");
  assert.equal(executed.structuredContent.authorization, "host-owner");
  const delegated = await call("keel-tezos-token-bound-account-prepare", { network, action: { kind: "execute", account, operation: 1, calls: [{ kind: "value", to: collector, amount: 5 }] } });
  assert.equal(delegated.isError, true);
  assert.equal(delegated.structuredContent.code, "KEEL_CHAIN_CAPABILITY_UNSUPPORTED");
  assert.equal(delegated.structuredContent.capability, "stake.token-bound-account.delegate-call");
});

test("MCP prepares manager pause and cold recovery, refusing the EVM-only upgrade path", async (t) => {
  const { call } = await fixture(t);
  // The shared golden vector from keel-contracts test/fixtures/parity/manager-recovery.json (SmartPy and Octez agree).
  const golden = {"network": "NetXdQprcVkpaWU", "registry": "KT1Tezooo3zzSmartPyzzSTATiCzzzseJjWC", "manager": "KT1TezoooozzSmartPyzzSTATiCzzzwwBFA1", "creator": "tz1KqTpEZ7Yob7QbPE4Hy4Wo8fHG8LhKxZSx", "salt": "0x0000000000000000000000000000000000000000000000000000000000000001", "groupId": "0x2633ce75040906c626e62aaa22cd4f8f36e465d851fb6aaf44d303f9e5bc3998", "members": ["tz1KqTpEZ7Yob7QbPE4Hy4Wo8fHG8LhKxZSx"], "governors": ["tz1KqTpEZ7Yob7QbPE4Hy4Wo8fHG8LhKxZSx", "tz1VSUr8wwNhLAzempoch5d6hLRiTh8Cjcjb", "tz1aSkwEot3L2kmUvcoxzjMomb9mvBNuzFK6"], "bindingRevision": 1, "deadline": 100000, "actionPayload": "0x0507070a0000001d6b65656c2e74657a6f732e7265636f766572792e616374696f6e2e763107070a0000001601d1371b91c7491542e97deee96091e28a80b233590007070a000000047a06a77007070a000000202633ce75040906c626e62aaa22cd4f8f36e465d851fb6aaf44d303f9e5bc399807070a0000001601d1371b91fdbd07c8855659c84652230be0eaecd50007070a00000020cd155e9e01018fa80a056c2b4c6416622d952ab7f8cc515c7aeb00a6309595f107070a00000020eda274b83e9d75af519fbf67d63e328f09ffda3da2bf1bc3ae4f42e6bfeca8ed070700000707000000a09a0c", "digest": "0x4c9173be876dfaf2f6d54b1f6a6e206a84dd2a20fb6cc443b50e8d41eef4cb54", "acceptancePayload": "0x0507070a000000216b65656c2e74657a6f732e7265636f766572792e616363657074616e63652e763107070a0000001601d1371b91c7491542e97deee96091e28a80b233590007070a000000047a06a77007070a000000204c9173be876dfaf2f6d54b1f6a6e206a84dd2a20fb6cc443b50e8d41eef4cb540a000000150002298c03ed7d454a101eb7022bc95f7e5f41ac78"};
  const pause = await call("keel-tezos-recovery-prepare", { network, action: { kind: "pause", controller: "KT1BNnzhtsMKUG7t72phZN8BG2W6TwPUQsYt" } });
  assert.equal(pause.isError, undefined, JSON.stringify(pause));
  assert.equal(pause.structuredContent.operation.parameters.entrypoint, "pause_manager");
  assert.equal(pause.structuredContent.signing, "not-performed");
  const group = await call("keel-tezos-recovery-prepare", { network, action: { kind: "create-group", registry: golden.registry, creator: golden.creator,
    salt: golden.salt, members: golden.members, verifyKeys: false, deadline: golden.deadline } });
  assert.equal(group.isError, undefined, JSON.stringify(group));
  assert.equal(group.structuredContent.groupId, golden.groupId);
  assert.equal(group.structuredContent.operation.parameters.entrypoint, "create_group");
  const payload = await call("keel-tezos-recovery-prepare", { network: golden.network, action: { kind: "payload", payload: "action", registry: golden.registry,
    manager: golden.manager, groupId: golden.groupId, governors: golden.governors, bindingRevision: golden.bindingRevision, deadline: golden.deadline } });
  assert.equal(payload.structuredContent.payload, golden.actionPayload);
  assert.equal(payload.structuredContent.digest, golden.digest);
  const acceptance = await call("keel-tezos-recovery-prepare", { network: golden.network, action: { kind: "payload", payload: "acceptance", registry: golden.registry,
    digest: golden.digest, signer: golden.creator } });
  assert.equal(acceptance.structuredContent.payload, golden.acceptancePayload);
  const upgrade = await call("keel-tezos-recovery-prepare", { network, action: { kind: "upgrade" } });
  assert.equal(upgrade.isError, true);
  assert.equal(upgrade.structuredContent.code, "KEEL_CHAIN_CAPABILITY_UNSUPPORTED");
  assert.equal(upgrade.structuredContent.capability, "authority.recovery.upgrade");
  const contractKey = await call("keel-tezos-recovery-prepare", { network, action: { kind: "create-group", registry: golden.registry, creator: golden.creator,
    salt: golden.salt, members: [golden.registry], verifyKeys: false, deadline: 1 } });
  assert.equal(contractKey.isError, true);
});

test("MCP prepares a valued governance action whose executing approval alone attaches the value", async (t) => {
  const { call } = await fixture(t);
  const manager = "KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton";
  const sink = "KT1BNnzhtsMKUG7t72phZN8BG2W6TwPUQsYt";
  const calls = [21, 22].map((tag, index) => ({ destination: sink, entrypoint: "receive_value", parameterType: { prim: "nat" }, value: { int: String(tag) }, amount: index + 2 }));
  const first = await call("keel-tezos-governance-prepare", { network, manager, calls, deadline: 2000, governorCount: 4 });
  assert.equal(first.isError, undefined, JSON.stringify(first));
  assert.equal(first.structuredContent.value, "5");
  assert.equal(first.structuredContent.threshold, 3);
  assert.equal(first.structuredContent.proposal.parameters.entrypoint, "propose_with_value");
  assert.match(first.structuredContent.approvals, /next_proposal_id/u);
  assert.equal(first.structuredContent.errors.KEEL_INCORRECT_VALUE, "IncorrectValue");
  assert.equal(first.structuredContent.signing, "not-performed");
  const second = await call("keel-tezos-governance-prepare", { network, manager, calls, deadline: 2000, governorCount: 4, proposalId: 0 });
  assert.deepEqual(second.structuredContent.approvals.map((a) => [a.executes, a.operation.amount]), [[false, "0"], [true, "5"]]);
  const overflow = await call("keel-tezos-governance-prepare", { network, manager, deadline: 2000, governorCount: 4,
    calls: [{ ...calls[0], amount: "9223372036854775808" }] });
  assert.equal(overflow.isError, true);
});

test("MCP prepares seeded-collection calls and returns the typed refusal for EVM-only seed modes", async (t) => {
  const { call } = await fixture(t);
  const configure = await call("keel-tezos-seed-action-prepare", { network, sender: creator, collection, action: { kind: "configure", profile: { reveal: "immediate", mode: "derived" } } });
  assert.equal(configure.isError, undefined, JSON.stringify(configure));
  assert.equal(configure.structuredContent.operation.parameters.entrypoint, "configure_seed_profile");
  assert.equal(configure.structuredContent.signing, "not-performed");
  const mint = await call("keel-tezos-seed-action-prepare", { network, sender: creator, collection, action: { kind: "mint", recipient: collector, quantity: 2, data: "0x01" } });
  assert.equal(mint.structuredContent.operation.parameters.entrypoint, "strike_with_data");
  const vrf = await call("keel-tezos-seed-action-prepare", { network, sender: creator, collection, action: { kind: "request" } });
  assert.equal(vrf.isError, true);
  assert.equal(vrf.structuredContent.code, "KEEL_CHAIN_CAPABILITY_UNSUPPORTED");
  assert.equal(vrf.structuredContent.capability, "collection.seed-chainlink-vrf");
  const future = await call("keel-tezos-collection-originate-prepare", { network, creator, maxSupply: 10, artifactsDir: "targets", bindings: { index, creatorProfile: registry }, entropyProfile: { reveal: "future-block" } });
  assert.equal(future.structuredContent.code, "KEEL_CHAIN_CAPABILITY_UNSUPPORTED");
  assert.match(future.structuredContent.closest.behaviour, /provider/u);
  const seeded = await call("keel-tezos-collection-originate-prepare", { network, creator, maxSupply: 10, artifactsDir: "targets", bindings: { index, creatorProfile: registry }, entropyProfile: { reveal: "immediate" } });
  assert.equal(seeded.isError, undefined, JSON.stringify(seeded));
  assert.equal(seeded.structuredContent.stages.at(-1).id, "configure-seed-profile");
});
