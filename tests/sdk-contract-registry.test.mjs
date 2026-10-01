import test from "node:test";
import assert from "node:assert/strict";
import {
  EIP1967_BEACON_SLOT,
  EIP1967_IMPLEMENTATION_SLOT,
  KEEL_CONTRACT_REGISTRY_PROTOCOL,
  describeKeelContract,
  discoverKeelCreatorFactoryCollections,
  entriesFromFactoryRecords,
  groupKeelContracts,
  inspectKeelContract,
  keelContractKey,
  keelSharedCollectionTokenRange,
  mergeKeelContractEntries,
  normalizeKeelCollectionLabels,
  normalizeKeelContractOrganization,
  normalizeKeelContractSigner,
  normalizeKeelContractTags,
} from "../packages/sdk/dist/contract-registry.js";

const A = "0x1111111111111111111111111111111111111111";
const IMPL = "0x2222222222222222222222222222222222222222";
const BEACON = "0x3333333333333333333333333333333333333333";
const OWNER = "0x4444444444444444444444444444444444444444";
const pad = (address) => `0x${"0".repeat(24)}${address.slice(2)}`;

function reader({ code = "0x6080", slots = {}, interfaces = [], reads = {} } = {}) {
  return {
    async getBlockNumber() { return 100n; },
    async getCode() { return code; },
    async getStorageAt({ slot }) { return slots[slot] ?? `0x${"0".repeat(64)}`; },
    async readContract({ functionName, args, address }) {
      if (functionName === "supportsInterface") {
        if (!interfaces.length) throw new Error("revert");
        return interfaces.includes(args[0]);
      }
      const key = `${address.toLowerCase()}:${functionName}`;
      if (key in reads) return reads[key];
      if (functionName in reads) return reads[functionName];
      throw new Error("revert");
    },
  };
}

test("inspection recognizes clones, EIP-1967 and beacon proxies, standards and owners", async () => {
  const clone = await inspectKeelContract(reader({ code: `0x363d3d373d3d3d363d73${IMPL.slice(2)}5af43d82803e903d91602b57fd5bf3`, interfaces: ["0x01ffc9a7", "0x80ac58cd", "0x5b5e139f"], reads: { name: "Night Garden", symbol: "NG", owner: OWNER } }), { chainId: 1, address: A });
  assert.equal(clone.proxy.kind, "minimal-clone");
  assert.equal(clone.proxy.implementation, IMPL);
  assert.equal(clone.standard, "erc721");
  assert.equal(clone.interfaces.erc721Metadata, true);
  assert.equal(clone.name, "Night Garden");
  assert.equal(clone.owner, OWNER);

  const uups = await inspectKeelContract(reader({ slots: { [EIP1967_IMPLEMENTATION_SLOT]: pad(IMPL) }, interfaces: ["0x01ffc9a7", "0xd9b67a26"] }), { chainId: 1, address: A });
  assert.deepEqual(uups.proxy, { kind: "eip1967", implementation: IMPL });
  assert.equal(uups.standard, "erc1155");

  const beacon = await inspectKeelContract(reader({ slots: { [EIP1967_BEACON_SLOT]: pad(BEACON) }, reads: { [`${BEACON.toLowerCase()}:implementation`]: IMPL } }), { chainId: 1, address: A });
  assert.deepEqual(beacon.proxy, { kind: "beacon", beacon: BEACON, implementation: IMPL });
  assert.equal(beacon.standard, "unknown");
  assert.equal(beacon.interfaces.erc165, false);

  const missing = await inspectKeelContract(reader({ code: "0x" }), { chainId: 1, address: A });
  assert.equal(missing.hasCode, false);
});

test("organization is validated and tags become clean filters", () => {
  assert.deepEqual(normalizeKeelContractTags(["Spring Drop", "spring drop", "1/1"].slice(0, 2)), ["spring-drop"]);
  assert.throws(() => normalizeKeelContractTags(["no/slash"]));
  assert.deepEqual(normalizeKeelContractOrganization({ label: "  Main   collection ", category: "Editions", tags: ["Glow"], pinned: true }), { label: "Main collection", category: "Editions", tags: ["glow"], pinned: true });
  assert.throws(() => normalizeKeelContractOrganization({ address: A }));
  assert.throws(() => normalizeKeelContractOrganization({ label: "x".repeat(121) }));
});

test("shared ERC-1155 collections get exact token ranges", () => {
  assert.deepEqual(keelSharedCollectionTokenRange(3n), { from: (3n << 128n).toString(), to: ((4n << 128n) - 1n).toString() });
  assert.throws(() => keelSharedCollectionTokenRange(1n << 128n));
});

const FACTORY = "0x5555555555555555555555555555555555555555";
const CREATOR = "0x6666666666666666666666666666666666666666";
const SHARED = "0x7777777777777777777777777777777777777777";
const CLONE = "0x8888888888888888888888888888888888888888";

test("factory discovery sorts swap-and-pop ids, labels templates and folds shared collections", async () => {
  const records = { 5n: { creator: CREATOR, tokenContract: CLONE, sharedCollectionId: 0n, standard: 0, deployment: 0, open: true, name: "Seeds" }, 2n: { creator: CREATOR, tokenContract: SHARED, sharedCollectionId: 9n, standard: 1, deployment: 1, open: true, name: "Postcards" }, 7n: { creator: CREATOR, tokenContract: SHARED, sharedCollectionId: 11n, standard: 1, deployment: 1, open: false, name: "Letters" } };
  const read = {
    async getBlockNumber() { return 42n; },
    async readContract({ functionName, args }) {
      if (functionName === "creatorCollectionIds") return [5n, 2n, 7n];
      if (functionName === "collection") return records[args[0]];
      if (functionName === "erc721ImplementationKind") return 2;
      throw new Error(functionName);
    },
  };
  const found = await discoverKeelCreatorFactoryCollections(read, { factory: FACTORY, creator: CREATOR, abi: [] });
  assert.deepEqual(found.records.map((record) => record.collectionId), ["2", "5", "7"]);
  assert.equal(found.records[1].implementation, "seeded-erc721a");
  const entries = entriesFromFactoryRecords(11155111, found.records);
  assert.equal(entries.length, 2);
  const shared = entries.find((entry) => entry.family === "shared-collection");
  assert.deepEqual(shared.collections.map((item) => item.key).sort(), ["shared:11", "shared:9"]);
  const own = entries.find((entry) => entry.family === "creator-collection");
  assert.equal(own.abiId, "keel-creator-seeded-721a");
  assert.match(describeKeelContract(own), /Your collection · ERC-721 · lightweight copy/u);
});

test("merging keeps the creator's names and the most specific facts", () => {
  const base = { protocol: KEEL_CONTRACT_REGISTRY_PROTOCOL, key: keelContractKey(1, A), chainId: 1, address: A, deployment: "standalone", sources: [], collections: [], signers: [] };
  const merged = mergeKeelContractEntries([
    { ...base, family: "custom", standard: "unknown", proxy: { kind: "none" }, name: "", label: "My sale", tags: ["live"], sources: ["manual"] },
    { ...base, family: "creator-collection", standard: "erc721", proxy: { kind: "minimal-clone", implementation: IMPL }, name: "Seeds", sources: ["indexer"], collections: [{ key: "die", kind: "die-collection", name: "Seeds", source: "indexer" }] },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].family, "creator-collection");
  assert.equal(merged[0].standard, "erc721");
  assert.equal(merged[0].label, "My sale");
  assert.deepEqual(merged[0].sources, ["manual", "indexer"]);
  const groups = groupKeelContracts([...merged, { ...base, key: keelContractKey(1, IMPL), address: IMPL, family: "custom", standard: "unknown", proxy: { kind: "none" }, name: "Old", archived: true }]);
  assert.deepEqual(groups.map((group) => group.id), ["collections", "archived"]);
});

test("conflicting proxy slots are reported, not silently resolved", async () => {
  const both = await inspectKeelContract(reader({ slots: { [EIP1967_IMPLEMENTATION_SLOT]: pad(IMPL), [EIP1967_BEACON_SLOT]: pad(BEACON) }, reads: { [`${BEACON.toLowerCase()}:implementation`]: IMPL } }), { chainId: 1, address: A });
  assert.equal(both.proxy.kind, "beacon");
  assert.equal(both.proxy.conflict, true);
});

test("strict discovery refuses inconsistent factories and caps parallel reads", async () => {
  let active = 0; let peak = 0;
  const base = {
    async getBlockNumber() { return 9n; },
    async getCode() { return "0x6080"; },
    async readContract({ functionName, args }) {
      if (functionName === "creatorCollectionIds") return [1n, 2n, 3n, 4n, 5n];
      if (functionName === "creatorCollectionCount") return 5n;
      if (functionName === "collection") { active += 1; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 5)); active -= 1; return { creator: CREATOR, tokenContract: SHARED, sharedCollectionId: args[0], standard: 1, deployment: 1, open: true, name: `C${args[0]}` }; }
      throw new Error(functionName);
    },
  };
  const found = await discoverKeelCreatorFactoryCollections(base, { factory: FACTORY, creator: CREATOR, abi: [], strict: true, concurrency: 2 });
  assert.equal(found.records.length, 5);
  assert.ok(peak <= 2);
  await assert.rejects(discoverKeelCreatorFactoryCollections({ ...base, async getCode() { return "0x"; } }, { factory: FACTORY, creator: CREATOR, abi: [], strict: true }), /no code/u);
  await assert.rejects(discoverKeelCreatorFactoryCollections({ ...base, async readContract(call) { return call.functionName === "creatorCollectionCount" ? 4n : base.readContract(call); } }, { factory: FACTORY, creator: CREATOR, abi: [], strict: true }), /disagree/u);
  await assert.rejects(discoverKeelCreatorFactoryCollections(base, { factory: FACTORY, creator: CREATOR, abi: [], strict: true, limit: 3 }), /at most 3/u);
});

test("facts from the chain beat guesses, and collection tags are combined", () => {
  const base = { protocol: KEEL_CONTRACT_REGISTRY_PROTOCOL, key: keelContractKey(1, SHARED), chainId: 1, address: SHARED, deployment: "shared", proxy: { kind: "none" }, name: "x", signers: [] };
  const [merged] = mergeKeelContractEntries([
    { ...base, family: "creator-collection", standard: "erc721", sources: ["release"], collections: [{ key: "shared:1", kind: "shared-collection", name: "A", source: "release", label: "Mine", tags: ["keep"] }] },
    { ...base, family: "shared-collection", standard: "erc1155", sources: ["factory"], collections: [{ key: "shared:1", kind: "shared-collection", name: "A", source: "factory", tags: ["2 items"] }] },
  ]);
  assert.equal(merged.family, "shared-collection");
  assert.equal(merged.collections[0].label, "Mine");
  assert.deepEqual(merged.collections[0].tags, ["keep", "2 items"]);
});

test("signer and collection-label validators keep records honest and secret-free", () => {
  assert.deepEqual(normalizeKeelContractSigner({ id: "s1", role: "agent", flow: "bridge", label: "Studio Mac", status: "pending", bridge: { server: "keel", queue: "/api/bridge/jobs" } }), { id: "s1", role: "agent", flow: "bridge", label: "Studio Mac", bridge: { server: "keel", queue: "/api/bridge/jobs" }, status: "pending" });
  assert.throws(() => normalizeKeelContractSigner({ id: "s1", role: "agent", flow: "bridge", label: "x", status: "pending", bridge: { server: "keel", queue: "/api/bridge/jobs?token=abc" } }), /credentials/u);
  assert.throws(() => normalizeKeelContractSigner({ id: "s1", role: "owner", flow: "wallet", label: `0x${"ab".repeat(32)}`, status: "active" }), /key or token/u);
  assert.throws(() => normalizeKeelContractSigner({ id: "s1", role: "wizard", flow: "wallet", label: "x", status: "active" }), /role/u);
  assert.throws(() => normalizeKeelContractSigner({ id: "s1", role: "owner", flow: "wallet", label: "x", status: "active", bridge: { server: "a", queue: "/b" } }), /Only bridge/u);
  assert.deepEqual(normalizeKeelCollectionLabels({ "shared:3": { label: " Postcards ", tags: ["Summer"] }, "drop:0xabc": {} }), { "shared:3": { label: "Postcards", tags: ["summer"] }, "drop:0xabc": {} });
  assert.throws(() => normalizeKeelCollectionLabels({ "../x": {} }));
});
