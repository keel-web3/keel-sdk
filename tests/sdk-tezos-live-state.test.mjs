import test from "node:test";
import assert from "node:assert/strict";

import {
  KEEL_TEZOS_LIVE_STATE_PROTOCOL,
  assertKeelTezosLiveSnapshot,
  buildKeelTezosLiveStateFragment,
  decodeKeelTezosLiveValue,
  keelTezosLiveMichelineType,
  keelTezosLiveMichelineValue,
  keelTezosScriptExpr,
  orderKeelModules,
  packKeelTezosLiveKey,
  prepareKeelTezosLiveState,
  readKeelTezosLiveState,
  resolveKeelTezosLiveReads,
  runKeelTezosLiveStateFragment,
} from "../packages/sdk/dist/index.js";

const network = "NetXynUjJNZm7wi";
// Octez mockup addresses (never live deployments).
const cart = "KT1BCTYMUJ1LoQhzpCDS6oevoHAHQ7sLu8Wb";
const rpc = "https://rpc.example.test";
const tzkt = "https://api.example.test";
const HASH = "BLockGenesisGenesisGenesisGenesisGenesisd1f7bcGMoXy";

/* Vectors from `octez-client hash data <value> of type <type>` in KEEL's pinned Octez 25 mockup (PsUshuai9Qap). */
const VECTORS = [
  ["nat", 0, "050000", "exprtZBwZUeYYYfUs9B9Rg2ywHezVHnCCnmF9WsDQVrs582dSK63dC"],
  ["nat", 300, "0500ac04", "expru9wJGAad1VdYguSKPKaLLUeLeRyXy5H3tEb2VKRWwuavS3JD89"],
  ["int", -5, "050045", "expru5vTov1tf9hr7toTmEtLGSEhxgRLSASAxZBuKj8Nt1wpDrVWZs"],
  ["mutez", 1_000_000, "050080897a", "exprujt4hi1p1VvCnTsjo4H6iGSftNWsKzD12TndTS66vNM5vVsxmV"],
  ["string", "abc", "050100000003616263", "exprtyY2HCDSTUoRSCW3ZhFeJEYH2MwD6oHxqsXpL8hPSXEoMXB2m2"],
  ["bytes", "0x00ff", "050a0000000200ff", "expru4JXyv6hSZT5A6T6qXAgU76Xx86dhUiYfV33vTGKPCFipcDVWP"],
  [{ pair: ["nat", "nat"] }, [1, 2], "05070700010002", "expruuVqLi9YeXfHPkysBn1aj3TZpQM9PT1vXY6F9ZwVWzEAVw9VEQ"],
  [{ record: [["a", "nat"], ["b", "nat"], ["c", "bytes"]] }, { a: 7, b: 3, c: "ab" }, "0507070007070700030a00000001ab", "expruwT3jDxZZmF5Q7ZELw1iT74ngaccxvyrFRj1JofZEcyz5UGvsa"],
  [{ pair: ["nat", "nat", "nat", "nat"] }, [1, 2, 3, 4], "050707000107070002070700030004", "expruUmBBgkX5B6xAgesjS3CXC2dM6KRSj9xnTfwnas5hD9UAabpkm"],
  ["address", "tz1KqTpEZ7Yob7QbPE4Hy4Wo8fHG8LhKxZSx", "050a00000016000002298c03ed7d454a101eb7022bc95f7e5f41ac78", "expruH3qgknRBJVLVkwdzf6wfBxd7Y1uqNxr7zuMFxTC12e5PacLfv"],
  ["address", cart, "050a00000016011cb02e23a9d3f442922910a2fc349dc3e4b4fb8900", "exprtmYEHr7ZQWkje9hS6pHzZZJixbweN67f8R9KJ7PNdz8HSpGt8o"],
  ["bool", true, "05030a", "exprvMjTcyX8e8HskSUV3ipMhPzMLKTn92vsWZkiJTTYj7U9J8sAyP"],
  [{ option: "nat" }, 7, "0505090007", "expru1pGCpxKQ9ae9ghf75zRi13ZzWGuWjR65wr2S87bMJkPsvZuCC"],
  [{ option: "nat" }, null, "050306", "exprtn5DaoF31YMuSLAJFjARQmKwsdUUnHMCKBqZ6zoH1SiAyqHkFh"],
  ["unit", null, "05030b", "expruaDPoTWXcTR6fiQPy4KZSW72U6Swc1rVmMiP1KdwmCceeEpVjd"],
  ["timestamp", "2026-10-17T00:00:00Z", "050080ea95ad0d", "expruaM9Ju1StRcJXbzo2v3tMHoUYtAuqHc1CniAYGBHEDAy4GdXy9"],
];

test("PACK and script_expr equal Octez for every supported key type", () => {
  for (const [type, value, packed, expr] of VECTORS) {
    assert.equal(Buffer.from(packKeelTezosLiveKey(type, value)).toString("hex"), packed, JSON.stringify(type));
    assert.equal(keelTezosScriptExpr(type, value), expr, JSON.stringify(type));
  }
  assert.throws(() => packKeelTezosLiveKey({ list: "nat" }, [1]), /not comparable/u);
  assert.throws(() => packKeelTezosLiveKey("string", "é"), /Michelson string/u);
  assert.throws(() => packKeelTezosLiveKey("nat", -1), />= 0/u);
  assert.throws(() => packKeelTezosLiveKey("nat", 1.5), /integer/u);
  assert.throws(() => packKeelTezosLiveKey("address", "tz1KqTpEZ7Yob7QbPE4Hy4Wo8fHG8LhKxZSy"), /checksum/u);
});

test("the decoder validates types and normalizes Readable Micheline", () => {
  assert.equal(decodeKeelTezosLiveValue("nat", { int: "12" }), 12);
  assert.equal(decodeKeelTezosLiveValue("nat", { int: "123456789012345678901234567890" }), "123456789012345678901234567890");
  assert.throws(() => decodeKeelTezosLiveValue("nat", { int: "-1" }), /not nat/u);
  assert.throws(() => decodeKeelTezosLiveValue("nat", { string: "1" }), /not nat/u);
  assert.equal(decodeKeelTezosLiveValue("int", { int: "-4" }), -4);
  assert.equal(decodeKeelTezosLiveValue("timestamp", { int: "1792195200" }), "2026-10-17T00:00:00Z");
  assert.equal(decodeKeelTezosLiveValue("timestamp", { string: "2026-10-17T00:00:00.000Z" }), "2026-10-17T00:00:00Z");
  assert.equal(decodeKeelTezosLiveValue("text", { bytes: "4e4f43" }), "NOC");
  assert.throws(() => decodeKeelTezosLiveValue("text", { bytes: "ff" }), /./u);
  assert.equal(decodeKeelTezosLiveValue("bytes", { bytes: "ABcd" }), "abcd");
  assert.equal(decodeKeelTezosLiveValue("address", { string: cart }), cart);
  assert.throws(() => decodeKeelTezosLiveValue("address", { bytes: "011cb02e23a9d3f442922910a2fc349dc3e4b4fb8900" }), /not address/u);
  const record = { record: [["generation", "nat"], ["cart", "bytes"], ["at", "timestamp"]] };
  const expected = { generation: 2, cart: "ab", at: "2026-10-17T00:00:00Z" };
  for (const shape of [
    { prim: "Pair", args: [{ int: "2" }, { prim: "Pair", args: [{ bytes: "ab" }, { int: "1792195200" }] }] },
    { prim: "Pair", args: [{ int: "2" }, { bytes: "ab" }, { string: "2026-10-17T00:00:00Z" }] },
    [{ int: "2" }, { bytes: "ab" }, { int: "1792195200" }],
  ]) assert.deepEqual(decodeKeelTezosLiveValue(record, shape), expected);
  assert.throws(() => decodeKeelTezosLiveValue(record, { prim: "Pair", args: [{ int: "2" }] }), /pair/u);
  assert.deepEqual(decodeKeelTezosLiveValue({ list: "nat" }, [{ int: "1" }, { int: "2" }]), [1, 2]);
  assert.throws(() => decodeKeelTezosLiveValue({ list: "nat" }, [{ int: "1" }, { int: "2" }], 1), /bounded list/u);
  assert.deepEqual(decodeKeelTezosLiveValue({ map: ["string", "text"] }, [{ prim: "Elt", args: [{ string: "name" }, { bytes: "4e" }] }]), [["name", "N"]]);
  assert.equal(decodeKeelTezosLiveValue({ option: "nat" }, { prim: "None" }), null);
  assert.equal(decodeKeelTezosLiveValue({ option: "nat" }, { prim: "Some", args: [{ int: "3" }] }), 3);
  assert.throws(() => decodeKeelTezosLiveValue("float", { int: "1" }), /not a supported/u);
  assert.deepEqual(keelTezosLiveMichelineType(record), { prim: "pair", args: [{ prim: "nat" }, { prim: "pair", args: [{ prim: "bytes" }, { prim: "timestamp" }] }] });
  assert.deepEqual(keelTezosLiveMichelineValue({ pair: ["nat", "address"] }, [1, cart]), { prim: "Pair", args: [{ int: "1" }, { string: cart }] });
});

/* A selected-chain RPC + TzKT stand-in. `script` is the contract's code/storage as an Octez RPC returns it. */
function chain({ level = 100, chainId = network, bigmaps = {}, views = {}, tzktLevel = level, failRpc = false, failTzkt = false } = {}) {
  const storageType = { prim: "pair", args: [
    { prim: "address", annots: ["%fa2"] },
    { prim: "nat", annots: ["%image_count"] },
    { prim: "big_map", args: [{ prim: "nat" }, { prim: "nat" }], annots: ["%generation_count"] },
    { prim: "big_map", args: [{ prim: "pair", args: [{ prim: "nat" }, { prim: "nat" }] }, { prim: "bytes" }], annots: ["%generations"] },
  ] };
  const code = [
    { prim: "parameter", args: [{ prim: "unit" }] }, { prim: "storage", args: [storageType] }, { prim: "code", args: [[]] },
    { prim: "view", args: [{ string: "generation_of" }, { prim: "nat" }, { prim: "nat" }, []] },
    { prim: "view", args: [{ string: "image_count" }, { prim: "unit" }, { prim: "nat" }, []] },
  ];
  const storage = { prim: "Pair", args: [{ string: cart }, { int: "1" }, { int: "41" }, { int: "42" }] };
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push(url);
    const { origin, pathname, searchParams } = new URL(url);
    const reply = (body, status = 200) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (origin === rpc) {
      if (failRpc) throw new TypeError("Failed to fetch");
      if (pathname === "/chains/main/chain_id") return reply(chainId);
      if (/\/blocks\/[^/]+\/header$/u.test(pathname)) return reply({ level, hash: HASH });
      if (pathname.endsWith(`/context/contracts/${cart}/script`)) return reply({ code, storage });
      const big = /\/context\/big_maps\/(\d+)\/(expr\w+)\/normalized$/u.exec(pathname);
      if (big) {
        assert.equal(init.method, "POST");
        assert.deepEqual(JSON.parse(init.body), { unparsing_mode: "Readable" });
        const value = bigmaps[big[1]]?.[big[2]];
        return value === undefined ? reply(undefined, 404) : reply(value);
      }
      if (pathname.endsWith("/helpers/scripts/run_script_view")) {
        const body = JSON.parse(init.body);
        assert.equal(body.chain_id, network);
        return reply({ data: views[body.view](body.input) });
      }
    }
    if (origin === tzkt) {
      if (failTzkt) throw new TypeError("Failed to fetch");
      if (pathname === "/v1/head") return reply({ chainId, level: tzktLevel });
      const key = /^\/v1\/bigmaps\/(\d+)\/keys\/(expr\w+)$/u.exec(pathname);
      if (key) {
        assert.equal(searchParams.get("micheline"), "2");
        const value = bigmaps[key[1]]?.[key[2]];
        return value === undefined ? reply(undefined, 204) : reply({ active: true, value });
      }
    }
    return reply({ error: "unexpected" }, 500);
  };
  return { fetchImpl, calls };
}

const READS = [
  { name: "generation", kind: "big_map", contract: cart, bigMap: "generation_count", key: { type: "nat", value: 7 }, value: "nat", absent: 0 },
  { name: "cartHash", kind: "big_map", contract: cart, bigMap: "generations", key: { type: { pair: ["nat", "nat"] }, value: [7, 2] }, value: "bytes" },
  { name: "images", kind: "view", contract: cart, view: "image_count", returns: "nat" },
];
const expr7 = keelTezosScriptExpr("nat", 7);
const expr72 = keelTezosScriptExpr({ pair: ["nat", "nat"] }, [7, 2]);

test("reads resolve big_map ids from storage annotations, check types against the contract, and hash keys", async () => {
  const { fetchImpl } = chain({ bigmaps: { 41: { [expr7]: { int: "2" } }, 42: { [expr72]: { bytes: "c0ffee" } } }, views: { image_count: () => ({ int: "5" }) } });
  const layer = await readKeelTezosLiveState({ network, rpcUrl: rpc, reads: READS, fetchImpl });
  assert.deepEqual(layer.snapshot, { level: 100, blockHash: HASH, values: { generation: 2, cartHash: "c0ffee", images: 5 } });
  assert.deepEqual(layer.reads.map((read) => read.kind === "big_map" ? [read.bigMapId, read.scriptExpr] : read.view), [["41", expr7], ["42", expr72], "image_count"]);
  assert.ok(layer.typeChecks.every((check) => check.checked));

  const absent = await readKeelTezosLiveState({ network, rpcUrl: rpc, reads: [READS[0]], fetchImpl: chain().fetchImpl });
  assert.equal(absent.snapshot.values.generation, 0);

  await assert.rejects(readKeelTezosLiveState({ network, rpcUrl: rpc, reads: [{ ...READS[1], key: { type: { pair: ["nat", "int"] }, value: [7, 2] } }], fetchImpl }), /declared key type/u);
  await assert.rejects(readKeelTezosLiveState({ network, rpcUrl: rpc, reads: [{ ...READS[0], value: "int" }], fetchImpl }), /declared value type/u);
  await assert.rejects(readKeelTezosLiveState({ network, rpcUrl: rpc, reads: [{ ...READS[2], returns: "bytes" }], fetchImpl }), /return type/u);
  await assert.rejects(readKeelTezosLiveState({ network, rpcUrl: rpc, reads: [{ ...READS[0], bigMap: "ledger" }], fetchImpl }), /no big_map %ledger/u);
  await assert.rejects(readKeelTezosLiveState({ network, rpcUrl: rpc, reads: [{ ...READS[0], bigMapId: 9 }], fetchImpl }), /is not %generation_count/u);
  await assert.rejects(readKeelTezosLiveState({ network: "NetXdQprcVkpaWU", rpcUrl: rpc, reads: READS, fetchImpl }), /not NetXdQprcVkpaWU/u);
  await assert.rejects(readKeelTezosLiveState({ network, rpcUrl: "http://rpc.example.test", reads: READS, fetchImpl }), /HTTPS/u);
  await assert.rejects(readKeelTezosLiveState({ network, rpcUrl: rpc, reads: READS, fetchImpl, signer: { secretKey: "edsk" } }), /Private signer material/u);
  assert.throws(() => resolveKeelTezosLiveReads([READS[0], READS[0]]), /Duplicate/u);
  assert.throws(() => resolveKeelTezosLiveReads([{ ...READS[0], bigMap: undefined }]), /bigMap/u);
});

const offlineReads = () => resolveKeelTezosLiveReads([{ ...READS[0], bigMapId: 41 }, { ...READS[1], bigMapId: 42 }, READS[2]]);
const SNAPSHOT = { level: 100, values: { generation: 2, cartHash: "c0ffee", images: 5 } };
const fragmentOf = (extra = {}) => buildKeelTezosLiveStateFragment({ network, reads: offlineReads(), snapshot: SNAPSHOT, rpcUrls: [rpc], tzktUrls: [tzkt], autoRefresh: false, ...extra });

test("the fragment publishes the frozen snapshot synchronously, as JSON, before any runtime module", () => {
  const fragment = fragmentOf();
  assert.equal(fragment.phase, "data");
  assert.equal(orderKeelModules([{ moduleId: "art", phase: "render" }, fragment, { moduleId: "rt", phase: "runtime" }])[0].moduleId, "keel/tezos-live-state");
  assert.doesNotMatch(fragment.source, /atob|base64/iu);
  assert.match(fragment.source, /"generation":2/u);
  const api = runKeelTezosLiveStateFragment(fragment);
  assert.equal(api.protocol, KEEL_TEZOS_LIVE_STATE_PROTOCOL);
  assert.deepEqual(api.values, SNAPSHOT.values);
  assert.equal(api.state.status, "snapshot");
  assert.ok(Object.isFrozen(api.values));
  assert.throws(() => { "use strict"; api.values.generation = 9; }, TypeError);
  const hostile = buildKeelTezosLiveStateFragment({ network, reads: resolveKeelTezosLiveReads([{ ...READS[2], name: "label", returns: "string" }]), snapshot: { level: 1, values: { label: "</script><script>alert(1)</script>" } }, rpcUrls: [rpc] });
  assert.doesNotMatch(hostile.source, /<\/script>/iu);
  assert.equal(runKeelTezosLiveStateFragment(hostile).values.label, "</script><script>alert(1)</script>");
});

test("a live read replaces values only from the same chain, at or after the snapshot, with valid types", async () => {
  const live = { bigmaps: { 41: { [expr7]: { int: "3" } }, 42: { [expr72]: { bytes: "c0ffee" } } }, views: { image_count: () => ({ int: "6" }) } };
  const ok = runKeelTezosLiveStateFragment(fragmentOf(), { fetch: chain({ ...live, level: 120 }).fetchImpl });
  const seen = [];
  ok.subscribe((state) => seen.push(state.status));
  const state = await ok.refresh();
  assert.equal(state.status, "live");
  assert.equal(state.source, "rpc");
  assert.equal(state.level, 120);
  assert.deepEqual(ok.values, { generation: 3, cartHash: "c0ffee", images: 6 });
  assert.deepEqual(ok.snapshot.values, SNAPSHOT.values);
  assert.deepEqual(seen, ["live"]);

  for (const [label, options] of [["wrong chain", { ...live, chainId: "NetXdQprcVkpaWU", failTzkt: true }], ["behind the snapshot", { ...live, level: 99, failTzkt: true }]]) {
    const api = runKeelTezosLiveStateFragment(fragmentOf(), { fetch: chain(options).fetchImpl });
    const result = await api.refresh();
    assert.equal(result.status, "offline", label);
    assert.deepEqual(api.values, SNAPSHOT.values, label);
  }
  const wrongType = runKeelTezosLiveStateFragment(fragmentOf(), { fetch: chain({ ...live, views: { image_count: () => ({ string: "6" }) }, failTzkt: true }).fetchImpl });
  assert.equal((await wrongType.refresh()).status, "offline");
  assert.deepEqual(wrongType.values, SNAPSHOT.values, "a mistyped answer is never half-applied");
});

test("TzKT serves big_map reads when every RPC fails; views keep their last value; a blocked sandbox keeps the snapshot", async () => {
  const live = { bigmaps: { 41: { [expr7]: { int: "4" } } }, failRpc: true, tzktLevel: 130 };
  const api = runKeelTezosLiveStateFragment(fragmentOf(), { fetch: chain(live).fetchImpl });
  const state = await api.refresh();
  assert.equal(state.source, "tzkt");
  assert.deepEqual(state.reads, { generation: "live", cartHash: "live", images: "kept" });
  assert.deepEqual(api.values, { generation: 4, cartHash: null, images: 5 });

  const blocked = runKeelTezosLiveStateFragment(fragmentOf(), { fetch: async () => { throw new TypeError("Refused to connect: Content Security Policy"); } });
  const result = await blocked.refresh();
  assert.equal(result.status, "offline");
  assert.equal(result.errors.length, 2);
  assert.deepEqual(blocked.values, SNAPSHOT.values);
  const noFetch = runKeelTezosLiveStateFragment(fragmentOf({ autoRefresh: true }));
  assert.equal((await noFetch.refresh()).status, "offline");
});

test("snapshots, endpoints and options are validated before anything is emitted", async () => {
  const reads = offlineReads();
  assert.throws(() => assertKeelTezosLiveSnapshot(reads, { level: 1, values: { generation: "2", cartHash: "c0ffee", images: 5 } }), /canonical/u);
  assert.throws(() => assertKeelTezosLiveSnapshot(reads, { level: 1, values: { generation: 2, images: 5 } }), /cartHash is missing/u);
  assert.throws(() => assertKeelTezosLiveSnapshot(reads, { level: 1, values: { ...SNAPSHOT.values, extra: 1 } }), /not a declared read/u);
  assert.throws(() => fragmentOf({ rpcUrls: ["http://rpc.example.test"] }), /HTTPS/u);
  assert.throws(() => fragmentOf({ rpcUrls: ["https://rpc.example.test/?apikey=1"] }), /query/u);
  assert.throws(() => fragmentOf({ rpcUrls: ["https://user:pw@rpc.example.test"] }), /credentials/u);
  assert.throws(() => fragmentOf({ refreshIntervalMs: 1_000 }), /30000/u);
  assert.throws(() => fragmentOf({ globalName: "not a name" }), /global name/u);
  assert.throws(() => resolveKeelTezosLiveReads([READS[0]]), /offline/u);

  const offline = await prepareKeelTezosLiveState({ network, reads: [{ ...READS[0], bigMapId: 41 }, { ...READS[1], bigMapId: 42 }, READS[2]], snapshot: SNAPSHOT, rpcUrls: ["https://rpc.tzkt.io/mainnet", "https://mainnet.smartpy.io"], tzktUrls: ["https://api.tzkt.io"] });
  assert.equal(offline.fragment.globalName, "KEEL_TEZOS_LIVE");
  assert.ok(offline.scriptTag.startsWith("<script>(()=>{"));
  assert.ok(offline.typeChecks.every((check) => check.checked === false));
  await assert.rejects(prepareKeelTezosLiveState({ network, reads: READS, rpcUrls: [rpc] }), /exactly one of rpcUrl/u);
  const { fetchImpl } = chain({ bigmaps: { 41: { [expr7]: { int: "2" } } }, views: { image_count: () => ({ int: "5" }) } });
  const online = await prepareKeelTezosLiveState({ network, reads: READS, rpcUrl: rpc, rpcUrls: [rpc], fetchImpl });
  assert.deepEqual(online.snapshot.values, { generation: 2, cartHash: null, images: 5 });
});
