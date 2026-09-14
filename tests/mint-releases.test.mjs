import test from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData, parseAbi } from "viem";
import {
  decodeKeelReleasePolicy,
  describeKeelReleasePolicy,
  encodeKeelReleasePolicy,
  KEEL_MAX_RELEASE_SUPPLY,
  keelReleaseName,
  keelMintReleaseAbi,
  prepareKeelRelease,
  prepareOneMintReleaseCampaign,
  readKeelReleaseSnapshot,
  buildOneMintDrop,
  OneMintStageKind,
  oneMintControllerAbi,
} from "../packages/sdk/dist/index.js";
const address = "0x1111111111111111111111111111111111111111";
const creator = "0x2222222222222222222222222222222222222222";
const digest = "0x" + "ab".repeat(32);

test("release word round trips boundaries, modes and accounting without Number truncation", () => {
  for (const mode of ["fixed", "adjustable", "open"])
    for (const limit of [1n, 10n, KEEL_MAX_RELEASE_SUPPLY]) {
      const cap = mode === "open" ? KEEL_MAX_RELEASE_SUPPLY : limit;
      const word = encodeKeelReleasePolicy({ mode, limit: cap });
      const p = decodeKeelReleasePolicy(word | cap);
      assert.equal(p.issued, cap);
      assert.equal(p.reserved, 0n);
      assert.equal(p.mode, mode);
      assert.equal(p.limit, cap);
    }
  assert.throws(() => decodeKeelReleasePolicy(1n << 254n));
  assert.throws(() =>
    decodeKeelReleasePolicy(encodeKeelReleasePolicy({ limit: 1n }) | 2n),
  );
  assert.throws(() =>
    encodeKeelReleasePolicy({ mode: "fixed", limit: 1n, ceiling: 2n }),
  );
  assert.throws(() =>
    encodeKeelReleasePolicy({ limit: Number.MAX_SAFE_INTEGER + 1 }),
  );
  assert.throws(() => decodeKeelReleasePolicy("01"));
});
test("names are exact UTF-8 identities, not fuzzy titles", () => {
  assert.notEqual(keelReleaseName("Drop"), keelReleaseName("drop"));
  assert.notEqual(keelReleaseName("Drop"), keelReleaseName("Drop "));
  assert.throws(() => keelReleaseName(""));
  assert.throws(() => keelReleaseName("\ud800"));
  assert.throws(() => keelReleaseName("🚀".repeat(65)));
});
test("fixed is the creation default and mutable/open disclose their powers", () => {
  const call = prepareKeelRelease({
    chainId: 31337n,
    router: address,
    factory: creator,
    routeId: 1n,
    name: "Series",
    limit: 10n,
  });
  assert.equal(call.chainId, 31337n);
  assert.equal(call.policy.locked, true);
  const decoded = decodeFunctionData({
    abi: keelMintReleaseAbi,
    data: call.data,
  });
  assert.equal(decoded.functionName, "createRelease");
  assert.equal(decoded.args[5], 0);
  assert.equal(decoded.args[3], 10n);
  assert.equal(decoded.args[4], 10n);
  assert.match(
    JSON.stringify(
      describeKeelReleasePolicy(
        encodeKeelReleasePolicy({
          mode: "adjustable",
          limit: 10n,
          ceiling: 20n,
        }),
      ),
    ),
    /Yes, by the collection authority/,
  );
});
test("OneMint preparation binds the exact predicted allocation before creating the campaign", () => {
  const drop = buildOneMintDrop({
    target: address,
    payout: creator,
    supply: 10,
    maxPerTransaction: 2,
    maxPerWallet: 5,
    metadataDigest: digest,
    stages: [
      {
        kind: OneMintStageKind.Public,
        startTime: 0,
        endTime: 100,
        metadataDigest: digest,
      },
    ],
  });
  const input = {
    chainId: 31337n,
    router: creator,
    controller: address,
    creator,
    creatorNonce: 0n,
    releaseId: 1n,
    routeId: 1n,
    drop,
  };
  const batch = prepareOneMintReleaseCampaign(input);
  assert.equal(batch.status, "review-only");
  assert.equal(batch.calls.length, 2);
  const binding = decodeFunctionData({
    abi: keelMintReleaseAbi,
    data: batch.calls[0].data,
  });
  assert.equal(binding.functionName, "bindReleaseAllocation");
  assert.equal(binding.args[3], batch.allocationId);
  const creation = decodeFunctionData({
    abi: parseAbi(oneMintControllerAbi),
    data: batch.calls[1].data,
  });
  assert.equal(creation.functionName, "createDrop");
  assert.equal(creation.args[0], address);
  assert.notEqual(
    batch.allocationId,
    prepareOneMintReleaseCampaign({ ...input, creatorNonce: 1n }).allocationId,
  );
  assert.notEqual(
    batch.allocationId,
    prepareOneMintReleaseCampaign({ ...input, chainId: 1n }).allocationId,
  );
});
test("snapshot reads pin every state call and reject reorgs or a different manager", async () => {
  const calls = [];
  const block = { number: 3n, hash: digest };
  const client = {
    getChainId: async () => 31337,
    getBlock: async () => block,
    getCode: async (q) => {
      calls.push(q);
      return "0x6000";
    },
    readContract: async (q) => {
      calls.push(q);
      return {
        releasePolicy: encodeKeelReleasePolicy({ limit: 10n }),
        releaseRoute: 1n,
        route: { target: address, standard: 0, tokenId: 0n },
        mintManager: creator,
        owner: address,
        maxSupply: 100n,
      }[q.functionName];
    },
  };
  const snapshot = await readKeelReleaseSnapshot(client, {
    router: creator,
    releaseId: 1n,
  });
  assert.equal(snapshot.source, "pinned-rpc");
  assert.equal(snapshot.targetMaximum, "100");
  assert.ok(calls.every((q) => q.blockNumber === 3n));
  await assert.rejects(
    () =>
      readKeelReleaseSnapshot(client, {
        router: creator,
        releaseId: 1n,
        expectedChainId: 1,
      }),
    /selected chain/,
  );
  let blockReads = 0;
  await assert.rejects(
    () =>
      readKeelReleaseSnapshot(
        {
          ...client,
          getBlock: async () =>
            ++blockReads === 1
              ? block
              : { ...block, hash: "0x" + "cd".repeat(32) },
        },
        { router: creator, releaseId: 1n },
      ),
    /snapshot changed/,
  );
  await assert.rejects(
    () => readKeelReleaseSnapshot(client, { router: address, releaseId: 1n }),
    /mint manager/,
  );
});

test('release client signatures match the checked router ABI and relay only exposes the snapshot', async () => {
  const {moduleAbi,keelDirectReadPolicy}=await import('../packages/sdk/dist/index.js');
  const checked=await moduleAbi('keel-mint-access','KeelMintRouteRegistry');
  for(const entry of keelMintReleaseAbi){
    const actual=checked.find(x=>x.type===entry.type&&x.name===entry.name);
    assert.ok(actual,entry.name);
    const wire=parameters=>parameters.map(p=>({type:p.type,...(p.components?{components:wire(p.components)}:{})}));
    assert.deepEqual(wire(actual.inputs),wire(entry.inputs),entry.name);
    assert.deepEqual(wire(actual.outputs),wire(entry.outputs),entry.name);
  }
  assert.deepEqual([...keelDirectReadPolicy['keel-mint-route-registry']],['releaseSnapshot']);
});
