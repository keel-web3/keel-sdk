import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import * as M from "./model.mjs";
import { evaluate } from "./evaluate.mjs";
const dir = new URL("./", import.meta.url),
  clone = structuredClone;
const rules = (...ns) => ns.map((n) => "KOC1-R" + n);
const id = (n) =>
  M.hex(M.cat(M.sha(M.utf("KOC1 public fixture " + n)), M.u32(0)));
const hash = (n) => M.hex(M.sha(M.utf("KOC1 block fixture " + n)));
const wrap = (kind, cases) => ({
  version: "koc1@1",
  network: "testnet4",
  kind,
  cases,
});
function test(kind, name, ns, input) {
  return {
    id: name,
    rules: rules(...ns),
    input,
    expected: evaluate(kind, input),
  };
}
export function base() {
  const refs = {},
    ref = (n, bytes) => {
      const x = { id: id(n), sha256: M.hex(M.sha(M.utf(bytes))) };
      refs[x.id] = { height: 90, bytes: M.hex(M.utf(bytes)) };
      return x;
    };
  const messages = [
    '{"name":"BLAH #1","trait":"red"}',
    '{"name":"BLAH #2","trait":"blue"}',
    '{"name":"BLAH #3","trait":"gold"}',
  ];
  for (let i = 4; i <= 21; i++)
    messages.push(JSON.stringify({ name: "BLAH #" + i, trait: "fixture" }));
  const bundle = ref("bundle", messages.join("\n"));
  return {
    refs,
    recipe: {
      p: "koc1",
      op: "recipe",
      v: 1,
      name: "KOC1 vector collection",
      network: "testnet4",
      id: id("recipe"),
      height: 99,
      txIndex: 10,
      end: { mode: "first", max: 21, open: 100, close: 102 },
      finality: 2,
      challengeWindow: 3,
      price: 1000,
      payment: {
        mode: "escrow",
        treasuryKey: M.publicPoint(2),
        writerKeys: [3, 4, 5].map(M.publicPoint),
        collectAfter: 3,
        refundAfter: 18,
        earlyRefund: true,
      },
      controls: { notice: 2, pausable: true },
      metadata: {
        mode: "merkle",
        root: M.hex(M.merkle(messages.map((x, i) => M.metadataLeaf(i + 1, x)))),
        count: 21,
        bundles: [{ ...bundle, from: 1, to: 21 }],
        order: "direct",
      },
      art: { viewer: ref("viewer", "public synthetic viewer bytes") },
      writers: ["w1", "w2", "w3"].map((n) => ({ authority: id(n), label: n })),
      quorum: 2,
      writerRegistry: null,
      indexer: {
        ...ref("indexer", "public synthetic reference-indexer source"),
        reference: "keel-koc1-indexer@1",
      },
      bridges: null,
      checkpoint: null,
    },
  };
}
export function bindCommit(tx, nonce, siblings = []) {
  const witness = tx.inputs[0].witness,
    script = witness.at(-2),
    internal = M.publicPoint(6);
  let root = M.tapleaf(script);
  for (const sibling of siblings) root = M.tapbranch(root, sibling);
  const q = M.tapOutput(internal, root);
  const commit = {
    version: 2,
    inputs: [
      {
        txid: hash("funding-" + nonce),
        vout: 0,
        sequence: 0xfffffffd,
        witness: [],
      },
    ],
    outputs: [{ value: 3000, script: "5120" + q.key }],
    locktime: nonce,
  };
  const commitTx = M.hex(M.serializeTx(commit, false));
  tx.inputs[0].txid = M.parseTx(commitTx).txid;
  tx.inputs[0].vout = 0;
  witness[witness.length - 1] = M.hex(
    M.cat(Buffer.from([0xc0 | q.parity]), M.b(internal), ...siblings.map(M.b)),
  );
  return commitTx;
}
export function mint(n, height = 100, txIndex = n, options = {}) {
  const { recipe, refs } = base(),
    m = M.publicPoint(6),
    meta = { p: "koc1", op: "mint", r: M.b(recipe.id), m: M.b(m) },
    script = M.envelope(meta, recipe.art.viewer.id, options.envelope),
    inputs = [
      {
        txid: hash("commit-" + n),
        vout: 0,
        sequence: 0xfffffffd,
        witness: ["00".repeat(64), script, "c0" + M.NUMS],
      },
    ],
    outputs = [
      { value: 330, script: "5120" + m },
      { value: 1000, script: M.escrow(recipe.payment, m).scriptPubKey },
      { value: 0, script: M.marker(recipe.id) },
    ];
  let tx = { version: 2, inputs, outputs, locktime: n };
  if (options.mutate) options.mutate(tx, meta, recipe);
  const commitTx = bindCommit(tx, n);
  return {
    id: "mint-" + n,
    recipe,
    refs,
    rawTx: M.hex(M.serializeTx(tx)),
    height,
    txIndex,
    charms: [],
    commitTx,
    ...options.context,
  };
}
export async function build() {
  const suites = {};
  const messages = [
    '{"name":"BLAH #1","trait":"red"}',
    '{"name":"BLAH #2","trait":"blue"}',
    '{"name":"BLAH #3","trait":"gold"}',
  ];
  suites["metadata.json"] = wrap("metadata", [
    test("metadata", "research-1.12-metadata", [15, 51], {
      messages,
      positions: [1, 2, 3, 4, 21, 22],
    }),
  ]);
  suites["permutation.json"] = wrap("permutation", [
    test("permutation", "research-1.12-blind", [4, 16], {
      recipe: "00".repeat(36),
      blockhash: "11".repeat(32),
      max: 5,
    }),
    test("permutation", "blind-singleton", [16], {
      recipe: id("recipe"),
      blockhash: hash(104),
      max: 1,
    }),
    test("permutation", "blind-21", [16], {
      recipe: id("recipe"),
      blockhash: hash(104),
      max: 21,
    }),
  ]);
  suites["wire.json"] = wrap("wire", [
    test("wire", "research-1.12-outpoint-marker", [2], {
      displayTxid:
        "4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b",
      index: 7,
      recipe: "00".repeat(36),
    }),
    test("wire", "nonzero-inscription-index", [2], {
      displayTxid: "01".repeat(32),
      index: 0x01020304,
      recipe: id("recipe"),
    }),
  ]);
  suites["tags.json"] = wrap(
    "tags",
    [
      "recipe",
      "mint",
      "index",
      "challenge",
      "control",
      "writer",
      "koc1-pin",
      "koc1-number",
    ]
      .map((op) =>
        test("tags", "tagged-" + op, [1], {
          tag7: "koc1",
          metadata: { p: "koc1", op },
        }),
      )
      .concat([
        test("tags", "wrong-metaprotocol", [1], {
          tag7: "koc2",
          metadata: { p: "koc1", op: "mint" },
        }),
      ]),
  );
  const { recipe, refs } = base();
  suites["escrow.json"] = wrap(
    "escrow",
    [true, false].map((earlyRefund) =>
      test(
        "escrow",
        "escrow-" + (earlyRefund ? "three" : "two") + "-leaf",
        [11, 25, 26],
        {
          payment: { ...recipe.payment, earlyRefund },
          minter: M.publicPoint(6),
        },
      ),
    ),
  );
  const mc = [];
  function mintCase(name, ns, change) {
    const x = mint(mc.length + 1, 100, mc.length + 1);
    change?.(x);
    mc.push(test("mint", name, ns, x));
  }
  const alter = (x, fn) => {
    const tx = M.parseTx(x.rawTx);
    fn(tx);
    x.commitTx = bindCommit(tx, tx.locktime);
    x.rawTx = M.hex(M.serializeTx(tx));
  };
  mintCase("valid", [7, 8, 9, 10, 11, 12, 13, 14, 46]);
  mintCase("two-envelopes", [7], (x) =>
    alter(x, (t) => (t.inputs[0].witness[1] += t.inputs[0].witness[1])),
  );
  mintCase("envelope-on-vin-1", [7], (x) =>
    alter(x, (t) => {
      t.inputs.unshift({
        ...t.inputs[0],
        witness: [
          "00".repeat(64),
          "20" + M.publicPoint(6) + "ac",
          "c0" + M.NUMS,
        ],
      });
    }),
  );
  mintCase("pointer-tag", [8], (x) => {
    const y = mint(4, 100, 4, { envelope: { extra: [[2, M.b("00")]] } });
    x.rawTx = y.rawTx;
  });
  mintCase("unknown-even-tag", [8], (x) => {
    x.rawTx = mint(5, 100, 5, { envelope: { extra: [[12, M.b("01")]] } }).rawTx;
  });
  mintCase("wrong-delegate", [8], (x) =>
    alter(x, (t) => {
      t.inputs[0].witness[1] = M.envelope(
        { p: "koc1", op: "mint", r: M.b(recipe.id), m: M.b(M.publicPoint(6)) },
        id("wrong-viewer"),
      );
    }),
  );
  mintCase("marker-at-vout-3", [10], (x) =>
    alter(x, (t) => {
      t.outputs.splice(2, 0, { value: 330, script: t.outputs[0].script });
    }),
  );
  mintCase("two-markers", [10], (x) =>
    alter(x, (t) => {
      t.outputs.push({ ...t.outputs[2] });
    }),
  );
  mintCase("underpaid", [11], (x) =>
    alter(x, (t) => {
      t.outputs[1].value = 999;
    }),
  );
  mintCase("wrong-payment-keys", [11], (x) =>
    alter(x, (t) => {
      t.outputs[1].script = M.escrow(
        { ...recipe.payment, treasuryKey: M.publicPoint(7) },
        M.publicPoint(6),
      ).scriptPubKey;
    }),
  );
  mintCase("before-open", [12, 18], (x) => {
    x.height = 99;
  });
  mintCase("after-close", [12, 18, 28], (x) => {
    x.height = 103;
  });
  mintCase("over-cap-same-block", [14, 18], (x) => {
    x.earlierValid = 21;
  });
  mintCase("recipe-not-confirmed-before-open", [5, 12], (x) => {
    x.recipe.height = 100;
  });
  mintCase("cursed", [9], (x) => {
    x.charms = ["cursed"];
  });
  mintCase("unbound", [9], (x) => {
    x.charms = ["unbound"];
  });
  mintCase("noncanonical-push", [8], (x) => {
    x.rawTx = mint(17, 100, 17, { envelope: { nonminimal: true } }).rawTx;
  });
  mintCase("reinscription", [9], (x) => {
    x.charms = ["reinscription"];
  });
  mintCase("nonempty-body", [8], (x) => {
    x.rawTx = mint(19, 100, 19, { envelope: { body: "not empty" } }).rawTx;
  });
  mintCase("unconfirmed", [13, 17, 29], (x) => {
    x.height = null;
  });
  suites["mint.json"] = wrap("mint", mc);
  const more = [];
  function boundary(name, ns, change, options) {
    const x = mint(30 + more.length, 100, 0, options);
    change?.(x);
    more.push(test("mint", name, ns, x));
  }
  boundary("unknown-odd-tag-and-cbor-chunks", [1, 8], null, {
    envelope: { extra: [[13, M.utf("extension")]], chunks: true },
  });
  boundary("recipient-below-dust", [10], (x) =>
    alter(x, (t) => {
      t.outputs[0].value = 329;
    }),
  );
  boundary("payment-above-price", [11], (x) =>
    alter(x, (t) => {
      t.outputs[1].value = 1001;
    }),
  );
  boundary("at-close-inclusive", [12, 18], (x) => {
    x.height = 102;
  });
  boundary("wrong-recipe-metadata", [8], (x) =>
    alter(x, (t) => {
      t.inputs[0].witness[1] = M.envelope(
        {
          p: "koc1",
          op: "mint",
          r: M.b(id("other")),
          m: M.b(M.publicPoint(6)),
        },
        recipe.art.viewer.id,
      );
    }),
  );
  boundary("direct-payment", [11, 29], (x) => {
    x.recipe.payment = {
      mode: "direct",
      treasuryScript: "5120" + M.publicPoint(2),
    };
    alter(x, (t) => {
      t.outputs[1].script = x.recipe.payment.treasuryScript;
    });
  });
  boundary("claimed-number", [8, 14], (x) =>
    alter(x, (t) => {
      t.inputs[0].witness[1] = M.envelope(
        {
          p: "koc1",
          op: "mint",
          r: M.b(recipe.id),
          m: M.b(M.publicPoint(6)),
          n: 1,
        },
        recipe.art.viewer.id,
      );
    }),
  );
  boundary("missing-commit-prevout", [7, 46], (x) => {
    x.commitTx = null;
  });
  boundary("nonzero-ord-delegate-index", [2, 8], (x) => {
    const old = x.recipe.art.viewer.id,
      next = old.slice(0, 64) + "01020304";
    x.refs[next] = x.refs[old];
    delete x.refs[old];
    x.recipe.art.viewer.id = next;
    alter(x, (t) => {
      t.inputs[0].witness[1] = M.envelope(
        {
          p: "koc1",
          op: "mint",
          r: M.b(x.recipe.id),
          m: M.b(M.publicPoint(6)),
        },
        next,
      );
    });
  });
  suites["mint-boundaries.json"] = wrap("mint", more);
  const rc = [];
  function recipeCase(name, ns, change) {
    const x = base();
    change?.(x.recipe, x.refs);
    rc.push(test("recipe", name, ns, x));
  }
  recipeCase("valid-recipe", [3, 4, 5, 6]);
  recipeCase("wrong-network", [3], (r) => {
    r.network = "unsupported";
  });
  recipeCase("missing-version", [3], (r) => {
    delete r.v;
  });
  recipeCase("missing-source-reference", [5], (r, rs) => {
    delete rs[r.indexer.id];
  });
  recipeCase("late-bundle", [5], (r, rs) => {
    rs[r.metadata.bundles[0].id].height = 100;
  });
  recipeCase("hash-mismatch", [5], (r, rs) => {
    rs[r.art.viewer.id].bytes = "00";
  });
  recipeCase("supply-missing-max", [4], (r) => {
    delete r.end.max;
  });
  recipeCase("time-missing-close", [4], (r) => {
    r.end = { mode: "time", open: 100 };
  });
  recipeCase("open-cannot-cap", [4], (r) => {
    r.end.mode = "open";
    r.metadata.cycle = true;
  });
  recipeCase("open-cycle", [4, 15], (r) => {
    r.end = { mode: "open", open: 100 };
    r.metadata.cycle = true;
  });
  recipeCase("open-without-cycle", [4], (r) => {
    r.end = { mode: "open", open: 100 };
  });
  recipeCase("blind-infinite-end", [4, 16], (r) => {
    r.end = { mode: "open", open: 100 };
    r.metadata.cycle = true;
    r.metadata.order = "blind";
  });
  recipeCase("one-writer-quorum", [6], (r) => {
    r.quorum = 1;
  });
  recipeCase("duplicate-authorities", [6], (r) => {
    r.writers[1] = r.writers[0];
  });
  recipeCase("duplicate-escrow-writers", [6, 25], (r) => {
    r.payment.writerKeys[1] = r.payment.writerKeys[0];
  });
  recipeCase("collect-before-W", [26], (r) => {
    r.payment.collectAfter = 2;
  });
  recipeCase("refund-not-after-collect", [26], (r) => {
    r.payment.refundAfter = 3;
  });
  recipeCase("CSV-out-of-range", [26], (r) => {
    r.payment.refundAfter = 65536;
  });
  recipeCase("bundle-range-gap", [5], (r) => {
    r.metadata.bundles[0].from = 2;
  });
  recipeCase("same-block-earlier-reference", [5], (r, rs) => {
    rs[r.art.viewer.id].height = 99;
    rs[r.art.viewer.id].txIndex = 9;
  });
  recipeCase("same-block-later-reference", [5], (r, rs) => {
    rs[r.art.viewer.id].height = 99;
    rs[r.art.viewer.id].txIndex = 11;
  });
  recipeCase("recipe-at-open-invalid", [5, 12], (r) => {
    r.height = 100;
  });
  suites["recipes.json"] = wrap("recipe", rc);

  // Three real-height-shaped synthetic blocks, with interleaved invalid reveals.
  const candidates = Array.from({ length: 24 }, (_, i) =>
    mint(100 + i, 100 + Math.floor(i / 8), (i % 8) * 2 + 1),
  );
  candidates.push(
    { ...mint(200, 100, 2), charms: ["cursed"] },
    { ...mint(201, 101, 2), charms: ["reinscription"] },
    { ...mint(202, 102, 2), height: null },
  );
  const heights = [100, 101, 102].map((height) => ({
      height,
      hash: hash(height),
    })),
    stateBase = { recipe, refs, candidates, heights, controls: [] },
    states = [];
  const stateCase = (name, ns, edit) => {
    const x = clone(stateBase);
    edit?.(x);
    x.candidates = x.candidates.map(
      ({ recipe: _recipe, refs: _refs, ...reveal }) => reveal,
    );
    states.push(test("state", name, ns, x));
  };
  stateCase("first-of-supply-end", [12, 13, 14, 17, 18, 33], (x) => {
    x.recipe.end.close = 110;
  });
  stateCase("supply-end", [13, 14, 18, 33], (x) => {
    x.recipe.end = { mode: "supply", max: 10, open: 100 };
  });
  stateCase("time-end", [12, 13, 18, 33], (x) => {
    x.recipe.end = { mode: "time", open: 100, close: 101 };
    x.recipe.metadata.cycle = true;
  });
  stateCase("first-of-time-end", [18, 33], (x) => {
    x.recipe.end.close = 101;
  });
  stateCase("open-edition", [4, 13, 14, 18, 33], (x) => {
    x.recipe.end = { mode: "open", open: 100 };
    x.recipe.metadata.cycle = true;
  });
  stateCase("input-order-does-not-change-root", [13, 33], (x) => {
    x.candidates.reverse();
  });
  stateCase("invalid-does-not-change-root", [9, 13, 33], (x) => {
    x.candidates = x.candidates.filter((c) => !c.charms.length);
  });
  const control = (n, action, at, extra = {}) => ({
    id: "control-" + n,
    p: "koc1",
    op: "control",
    r: recipe.id,
    parent: recipe.id,
    height: 98,
    action,
    at,
    ...extra,
  });
  stateCase("close-notice-and-finality", [20, 21, 24], (x) => {
    x.controls = [
      control(1, "close", 101),
      control(2, "resume", 102),
      control(3, "close", 99),
    ];
  });
  stateCase("lower-cap-preserves-effective-block", [20, 22], (x) => {
    x.controls = [control(1, "lowerCap", 101, { cap: 5 })];
  });
  stateCase("lower-cap-before-count", [22], (x) => {
    x.controls = [control(1, "lowerCap", 100, { cap: 10 })];
  });
  stateCase("pause-resume-notice", [20, 23, 28], (x) => {
    x.controls = [control(1, "pause", 100), control(2, "resume", 101)];
  });
  stateCase("ignore-raises-and-malformed", [20, 24], (x) => {
    x.controls = [
      control(1, "lowerCap", 100, { cap: 30 }),
      control(2, "pause", 99),
      control(3, "setPrice", 100),
      control(4, "pause", 100, { parent: id("impostor") }),
      control(5, "close", 102, { price: 0 }),
    ];
  });
  stateCase("pausable-false", [23, 24], (x) => {
    x.recipe.controls.pausable = false;
    x.controls = [control(1, "pause", 100), control(2, "resume", 101)];
  });
  stateCase("same-height-control-child-order", [20, 23], (x) => {
    x.controls = [
      control(1, "pause", 100),
      control(2, "resume", 100),
      control(3, "pause", 100),
    ];
  });
  stateCase("controls-disabled", [20, 24], (x) => {
    delete x.recipe.controls;
    x.controls = [control(1, "close", 100)];
  });
  stateCase("reorg-before-F", [17, 33], (x) => {
    x.candidates
      .filter((c) => c.height === 100 && c.charms.length === 0)
      .slice(0, 2)
      .forEach((c, i) => {
        c.txIndex = i === 0 ? 3 : 1;
      });
    x.heights = x.heights.map((h) => ({
      ...h,
      hash: hash("reorg-" + h.height),
    }));
  });
  stateCase("before-open-does-not-enter-index", [12, 13, 33], (x) => {
    x.candidates.push(mint(9999, 99, 1));
  });
  stateCase("lowered-cap-never-raised-by-later-control", [20, 22, 24], (x) => {
    x.controls = [
      control(1, "lowerCap", 101, { cap: 5 }),
      control(2, "lowerCap", 102, { cap: 18 }),
    ];
  });
  suites["numbering-controls-roots.json"] = wrap("state", states);

  const canonical = M.indexState(recipe, refs, candidates, 102, hash(102)),
    validCandidates = candidates.filter(
      (c) => !M.formCheck(c).error && c.height !== null,
    ),
    entries = Object.fromEntries(
      validCandidates.map((c) => {
        const e = M.formCheck(c);
        return [e.txid, { ...e, id: c.id, valid: true }];
      }),
    ),
    ordered = Object.values(entries).sort(
      (a, b) => a.height - b.height || a.txIndex - b.txIndex,
    );
  // Build full synthetic txid trees including unmarked fillers, not just mints.
  const hostHashes = {},
    headers = {},
    txids = {};
  for (const height of [100, 101, 102]) {
    const rows = ordered.filter((x) => x.height === height),
      total = Math.max(...rows.map((x) => x.txIndex)) + 1,
      ids = Array.from({ length: total }, (_, i) =>
        hash("filler-" + height + "-" + i),
      );
    for (const e of rows) ids[e.txIndex] = e.txid;
    const header = Buffer.alloc(80);
    header.writeUInt32LE(4);
    M.merkle(ids, true).copy(header, 36);
    header.writeUInt32LE(1700000000 + height, 68);
    header.writeUInt32LE(0x207fffff, 72);
    headers[height] = M.hex(header);
    hostHashes[height] = M.hex(M.dsha(header));
    txids[height] = ids;
  }
  const proofFor = (e) =>
    M.evidence(e, txids[e.height].length, txids[e.height], headers[e.height]);
  const cache = {
    id: id("cache"),
    r: recipe.id,
    h: 102,
    hash: hash(102),
    entries: ordered,
  };
  const chall = [];
  function challengeCase(name, kind, edit) {
    const x = {
      recipe: clone(recipe),
      cache: clone(cache),
      entries: clone(entries),
      hostHashes: clone(hostHashes),
      canonicalRoot: canonical.indexRoot,
      challenge: {
        p: "koc1",
        op: "challenge",
        r: recipe.id,
        index: cache.id,
        kind,
        ...proofFor(ordered[3]),
      },
    };
    edit(x);
    chall.push(
      test(
        "challenge",
        name,
        kind === "omitted"
          ? [35, 38]
          : kind === "invalid"
            ? [36, 38]
            : [37, 38],
        x,
      ),
    );
  }
  challengeCase("omitted-valid-shifts-4-through-21", "omitted", (x) => {
    x.cache.entries = x.cache.entries.filter((e) => e.txid !== ordered[3].txid);
  });
  challengeCase("omitted-valid-over-cap-refund", "omitted", (x) => {
    x.recipe.end.max = 3;
    x.cache.entries = x.cache.entries.filter((e) => e.txid !== ordered[3].txid);
    x.canonicalRoot = M.rootFromEntries(recipe.id, x.cache.h, x.cache.hash, ordered, 3).indexRoot;
  });
  challengeCase("omitted-invalid-already-present", "omitted", () => {});
  challengeCase("omitted-invalid-branch", "omitted", (x) => {
    x.cache.entries = x.cache.entries.filter((e) => e.txid !== ordered[3].txid);
    x.challenge.branch[0] = "00".repeat(32);
  });
  challengeCase("omitted-invalid-header-binding", "omitted", (x) => {
    x.cache.entries = x.cache.entries.filter((e) => e.txid !== ordered[3].txid);
    x.hostHashes[100] = "00".repeat(32);
  });
  challengeCase("omitted-invalid-beyond-covered-height", "omitted", (x) => {
    x.cache.entries = x.cache.entries.filter((e) => e.txid !== ordered[3].txid);
    x.cache.h = 99;
  });
  challengeCase("invalid-valid-bad-entry", "invalid", (x) => {
    const bad = M.formCheck(mint(999, 101, 2));
    x.entries[bad.txid] = { ...bad, id: "bad-entry", valid: false };
    x.cache.entries.push(x.entries[bad.txid]);
    x.challenge.mint = bad.txid;
  });
  challengeCase("invalid-invalid-good-entry", "invalid", () => {});
  challengeCase("invalid-valid-false-coordinate", "invalid", (x) => {
    x.cache.entries = x.cache.entries.map((e) =>
      e.txid === ordered[3].txid ? { ...e, txIndex: 99 } : e,
    );
  });
  challengeCase("order-valid-reversed-pair", "order", (x) => {
    x.challenge = {
      ...x.challenge,
      ...proofFor(ordered[4]),
      other: proofFor(ordered[3]),
    };
    [x.cache.entries[3], x.cache.entries[4]] = [
      x.cache.entries[4],
      x.cache.entries[3],
    ];
  });
  challengeCase("order-invalid-sorted-pair", "order", (x) => {
    x.challenge.other = proofFor(ordered[4]);
  });
  challengeCase("order-invalid-second-proof", "order", (x) => {
    x.challenge = {
      ...x.challenge,
      ...proofFor(ordered[4]),
      other: proofFor(ordered[3]),
    };
    [x.cache.entries[3], x.cache.entries[4]] = [
      x.cache.entries[4],
      x.cache.entries[3],
    ];
    x.challenge.other.branch = [];
  });
  suites["challenges.json"] = wrap("challenge", chall);
  const cachesRoot = M.indexState(
    recipe,
    refs,
    validCandidates.filter((c) => c.id !== ordered[3].id),
    102,
    hash(102),
  ).indexRoot;
  suites["light-switch.json"] = wrap("light-switch", [
    test("light-switch", "corrected-root-match", [34, 43, 44], {
      challengeValid: true,
      patchedRoot: canonical.indexRoot,
      nextRoot: canonical.indexRoot,
      computedRoot: canonical.indexRoot,
      cacheRoot: cachesRoot,
    }),
    test("light-switch", "corrected-root-mismatch", [34, 44], {
      challengeValid: true,
      patchedRoot: canonical.indexRoot,
      nextRoot: hash("wrong"),
      computedRoot: canonical.indexRoot,
      cacheRoot: cachesRoot,
    }),
    test("light-switch", "invalid-challenge-no-switch", [44], {
      challengeValid: false,
      patchedRoot: canonical.indexRoot,
      nextRoot: canonical.indexRoot,
      computedRoot: canonical.indexRoot,
      cacheRoot: canonical.indexRoot,
    }),
  ]);

  const writerHashes = Object.fromEntries(
    [100, 101, 102, 105, 999].map((h) => [h, hash(h)]),
  );
  const update = (
    writer,
    n,
    h,
    prev = null,
    prevRoot = null,
    newEntries = [],
    history = [],
    projected = null,
    applied = [],
  ) => {
    const root = M.rootFromEntries(
      recipe.id,
      h,
      hash(h),
      projected ?? [...history, ...newEntries],
      21,
    );
    return {
      p: "koc1",
      op: "index",
      id: id(writer + "-update-" + n),
      parent: recipe.writers[writer].authority,
      r: recipe.id,
      h,
      hash: hash(h),
      root: root.indexRoot,
      count: root.count,
      over: root.over,
      prev,
      prevRoot,
      new: newEntries,
      applied,
    };
  };
  const first = update(0, 1, 100, null, null, ordered.slice(0, 3)),
    second = update(
      0,
      2,
      102,
      first.id,
      first.root,
      ordered.slice(3, 6),
      first.new,
    ),
    w1 = update(1, 1, 101, null, null, ordered.slice(0, 4)),
    w2 = update(2, 1, 100, null, null, ordered.slice(0, 2));
  const wb = {
    recipe: recipe.id,
    hostHashes: writerHashes,
    writers: [
      { authority: recipe.writers[0].authority, updates: [first, second] },
      { authority: recipe.writers[1].authority, updates: [w1] },
      { authority: recipe.writers[2].authority, updates: [w2] },
    ],
    pins: [],
    cap: 21,
    corrections: {},
    q: 2,
    W: 3,
    registry: [],
    self: [ordered[6]],
    challenges: [],
    ch: [],
    unresolved: false,
  };
  const wc = [];
  function writerCase(name, ns, edit) {
    const x = clone(wb);
    edit?.(x);
    wc.push(test("writers", name, ns, x));
  }
  writerCase("q2-k3-merge", [30, 34, 39, 40, 41, 43]);
  writerCase("equivocation-first-child-wins", [30, 31], (x) => {
    const evil = update(
      0,
      3,
      999,
      first.id,
      first.root,
      ordered.slice(3, 7),
      first.new,
    );
    x.writers[0].updates.push(evil);
  });
  writerCase("nonextending-and-bad-prev-root", [30, 34], (x) => {
    x.writers[0].updates.push(
      update(0, 3, 105, id("unseen"), hash("wrong"), []),
    );
    x.writers[1].updates.push(update(1, 2, 102, w1.id, hash("wrong"), []));
  });
  writerCase("ratchet-seen-valid", [32], (x) => {
    x.pins = [{ writerIndex: 0, updateId: first.id, root: first.root }];
  });
  writerCase("ratchet-pin-rejects-writer", [32, 40], (x) => {
    x.pins = [
      { writerIndex: 0, updateId: second.id, root: hash("poisoned-root") },
    ];
  });
  writerCase("one-racing-writer-no-quorum", [40], (x) => {
    x.writers[0].updates = [update(0, 1, 999, null, null, ordered)];
    x.writers[1].updates = [];
    x.writers[2].updates = [];
  });
  writerCase("one-dead-writer-still-settles", [40], (x) => {
    x.writers[2].updates = [];
  });
  writerCase("all-originals-dead-registry-cannot-vote", [40, 42], (x) => {
    x.writers.forEach((w) => {
      w.updates = [];
    });
    x.registry = [{ usable: true, h: 999, entries: ordered }];
  });
  writerCase("self-ch-union-rejects-fake", [39, 43], (x) => {
    x.ch = [ordered[7], ordered[7], { ...ordered[8], valid: false }];
    x.challenges = [ordered[8]];
  });
  writerCase("final-W-boundary", [17, 41], (x) => {
    x.writers[0].updates = [update(0, 1, 105, null, null, ordered)];
    x.writers[1].updates = [update(1, 1, 105, null, null, ordered)];
  });
  writerCase("unresolved-challenge-prevents-final", [41], (x) => {
    x.writers[0].updates = [update(0, 1, 105, null, null, ordered)];
    x.writers[1].updates = [update(1, 1, 105, null, null, ordered)];
    x.unresolved = true;
  });
  writerCase("wrong-host-hash", [34], (x) => {
    x.writers[0].updates[0].hash = hash("fork");
  });
  writerCase("malformed-first-does-not-poison-genesis", [31], (x) => {
    const bad = clone(first);
    bad.id = id("bad-first");
    bad.root = hash("bad-root");
    x.writers[0].updates.unshift(bad);
  });
  writerCase("height-regression-rejected", [30], (x) => {
    x.writers[0].updates.push(update(0, 3, 101, second.id, second.root, []));
  });
  writerCase("duplicate-new-entry-rejected", [30], (x) => {
    x.writers[0].updates.push(
      update(0, 3, 105, second.id, second.root, [ordered[0]]),
    );
  });
  writerCase(
    "applied-omission-preserves-announced-history",
    [30, 34, 38],
    (x) => {
      const missing = ordered[1],
        initial = [ordered[0], ordered[2]],
        start = update(0, 1, 100, null, null, initial),
        cid = id("applied-omission");
      x.corrections[cid] = {
        valid: true,
        challenge: { kind: "omitted", mint: missing.txid },
        entries,
      };
      const corrected = update(
        0,
        2,
        102,
        start.id,
        start.root,
        [],
        initial,
        ordered.slice(0, 3),
        [cid],
      );
      x.writers[0].updates = [start, corrected];
    },
  );
  writerCase("unverified-applied-challenge-rejected", [30, 34, 38], (x) => {
    x.writers[0].updates[1].applied = [id("unknown-challenge")];
  });
  suites["writers.json"] = wrap("writers", wc);
  const regChildren = Array.from({ length: 18 }, (_, i) => ({
    id: "registry-" + i,
    p: "koc1",
    op: "writer",
    authority: id("registry-" + i),
    height: 100 + i,
    authorized: true,
  }));
  regChildren.unshift({
    ...regChildren[0],
    id: "bad-registry",
    authorized: false,
  });
  regChildren.push({ ...regChildren[1], id: "duplicate-registry" });
  suites["registry.json"] = wrap("registry", [
    test("registry", "first-16-distinct", [42], {
      children: regChildren,
      originals: recipe.writers.map((w) => w.authority),
      burnHeight: null,
    }),
    test("registry", "burn-freezes-registry", [42], {
      children: regChildren,
      originals: recipe.writers.map((w) => w.authority),
      burnHeight: 105,
    }),
  ]);

  const pol = {
    height: 100,
    spendHeight: 103,
    payment: recipe.payment,
    version: 2,
    sequence: 3,
    signers: ["treasury", "w1", "w2"],
    member: true,
    settled: true,
    depth: 3,
    W: 3,
    unresolved: false,
  };
  const pc = [];
  function policy(name, ns, edit) {
    const x = { ...clone(pol), path: "L_t" };
    edit?.(x);
    pc.push(test("escrow-policy", name, ns, x));
  }
  for (const pair of [
    ["w1", "w2"],
    ["w1", "w3"],
    ["w2", "w3"],
  ])
    policy("collect-" + pair.join("-"), [25, 26, 27], (x) => {
      x.signers = ["treasury", ...pair];
    });
  policy("collect-too-early", [26], (x) => {
    x.spendHeight = 102;
  });
  policy("collect-one-writer", [25, 27], (x) => {
    x.signers = ["treasury", "w3"];
  });
  policy("CSV-disable-flag", [26], (x) => {
    x.sequence = 0x80000003;
  });
  policy("CSV-time-flag", [26], (x) => {
    x.sequence = 0x00400003;
  });
  policy("CSV-version-one", [26], (x) => {
    x.version = 1;
  });
  policy("unsettled-member-policy-refusal", [27], (x) => {
    x.settled = false;
  });
  policy("nonmember-collusion-is-accountable", [27, 28], (x) => {
    x.member = false;
  });
  policy("open-challenge-policy-refusal", [27], (x) => {
    x.unresolved = true;
  });
  policy("refund-before-unconditional-opens", [26, 28], (x) => {
    x.path = "L_m";
    x.sequence = 18;
    x.spendHeight = 117;
    x.signers = ["buyer"];
  });
  policy("unconditional-refund-member-keeps-token", [28], (x) => {
    x.path = "L_m";
    x.sequence = 18;
    x.spendHeight = 118;
    x.signers = ["buyer"];
    x.settled = false;
  });
  policy("early-refund-settled-loser", [27, 28], (x) => {
    x.path = "L_e";
    x.spendHeight = 100;
    x.member = false;
    x.signers = ["buyer", "w1", "w2"];
  });
  policy("early-refund-no-writers", [25, 28], (x) => {
    x.path = "L_e";
    x.signers = ["buyer"];
  });
  policy("collect-after-refund-path-opens", [26, 28], (x) => {
    x.spendHeight = 118;
  });
  policy("early-refund-disabled", [25, 28], (x) => {
    x.payment.earlyRefund = false;
    x.path = "L_e";
    x.signers = ["buyer", "w1", "w2"];
  });
  policy("collect-three-writers-is-not-two", [25, 27], (x) => {
    x.signers = ["treasury", "w1", "w2", "w3"];
  });
  policy("collect-without-treasury", [25], (x) => {
    x.signers = ["w1", "w2"];
  });
  policy("duplicate-writer-is-not-two", [25], (x) => {
    x.signers = ["treasury", "w1", "w1"];
  });
  suites["escrow-policy.json"] = wrap("escrow-policy", pc);
  const ml = messages.map((x, i) => M.metadataLeaf(i + 1, x)),
    sp = {
      height: 100,
      tip: 105,
      F: 2,
      W: 3,
      C: 105,
      recipeValid: true,
      inIndex: true,
      burned: false,
      artBytes: M.hex(M.utf("art")),
      artHash: M.hex(M.sha(M.utf("art"))),
      leaf: M.hex(ml[1]),
      path: M.proof(ml, 1),
      root: M.hex(M.merkle(ml)),
      count: 21,
      challenges: 2,
      pageEntries: 20,
      bridged: false,
      endHeight: 102,
      paymentMode: "escrow",
      self: mint(1600, 100, 1),
    };
  const sc = [];
  function shell(name, ns, edit) {
    const x = clone(sp);
    edit?.(x);
    sc.push(test("shell", name, ns, x));
  }
  shell("native-current-final", [17, 19, 41, 45, 48, 49, 51]);
  shell("burned-no-badge", [14, 45, 51], (x) => {
    x.burned = true;
  });
  shell("no-index-no-badge", [45], (x) => {
    x.inIndex = false;
  });
  shell("invalid-recipe-no-badge", [45, 46], (x) => {
    x.recipeValid = false;
  });
  shell("F-not-yet-reached", [17, 45, 47], (x) => {
    x.tip = 100;
  });
  shell("W-not-yet-covered", [41, 45], (x) => {
    x.C = 102;
  });
  shell("open-challenge-no-final", [41, 45], (x) => {
    x.unresolved = true;
  });
  shell("at-most-32-challenges", [49], (x) => {
    x.challenges = 33;
  });
  shell("paging-incomplete", [49], (x) => {
    x.pageEntries = 1001;
  });
  shell("large-collection-sampled", [48], (x) => {
    x.count = 1001;
  });
  shell("sampled-others-still-check-own-entry", [46, 48], (x) => {
    x.count = 1001;
    const tx = M.parseTx(x.self.rawTx);
    tx.inputs[0].witness[1] += "00";
    x.self.rawTx = M.hex(M.serializeTx(tx));
  });
  shell("wrong-metadata-proof", [15, 51], (x) => {
    x.path[0].hash = hash("wrong");
  });
  shell("wrong-art-hash", [51], (x) => {
    x.artBytes = "00";
  });
  shell("bridge-no-substitute", [51], (x) => {
    x.bridged = true;
    x.existingGroth16Verified = false;
  });
  shell("bridge-existing-proof-interface-only", [51], (x) => {
    x.bridged = true;
    x.existingGroth16Verified = true;
  });
  shell("stop-scan-only-when-quorum-settled", [19, 40], (x) => {
    x.C = 103;
  });
  shell("unbounded-scan-continues", [19], (x) => {
    x.endHeight = null;
  });
  shell("direct-explicit-opt-in", [29], (x) => {
    x.paymentMode = "direct";
  });
  shell("spent-known-only-from-spender", [51], (x) => {
    x.spenderResponse = { txid: hash("spender"), height: 104 };
  });
  suites["shell-policy.json"] = wrap("shell", sc);
  // R53: commitHeights[i] lists, per usable original writer claiming
  // candidate i, the confirmation height of its first listing.
  const seedBase = {
    commitHeights: [[106, 108], [108, 110, 112]],
    q: 2, tip: 115, hashes: {109: hash(109), 111: hash(111), 113: hash(113), 115: hash(115)},
  }, seedCases = [];
  const sampleSeed = (name, edit) => {
    const x = clone(seedBase); edit?.(x);
    seedCases.push(test("sample-seed", name, [48, 53], x));
  };
  sampleSeed("after-latest-candidate-commitment");
  sampleSeed("settling-at-commitment-height", x => { x.tip = 110; });
  sampleSeed("ready-at-first-successor", x => { x.tip = 111; });
  sampleSeed("missing-successor-hash", x => { delete x.hashes[111]; });
  sampleSeed("later-tip-keeps-same-seed", x => { x.tip = 120; x.hashes[120] = hash(120); });
  sampleSeed("late-third-writer-does-not-delay", x => { x.commitHeights[0].push(115); });
  sampleSeed("new-candidate-moves-seed", x => { x.commitHeights.push([112, 112]); });
  sampleSeed("uncorroborated-candidate-no-seed", x => { x.commitHeights.push([108]); });
  sampleSeed("missing-height-no-seed", x => { x.commitHeights[1][0] = null; });
  suites["sample-seed.json"] = wrap("sample-seed", seedCases);
  const block = JSON.parse(
      await readFile(new URL("testnet4-block.json", dir), "utf8"),
    ),
    raw = M.b(block.cases[0].input.raw),
    publicHeader = M.hex(raw.subarray(0, 80)),
    publicHash = M.hex(M.dsha(raw.subarray(0, 80)));
  const hs = [];
  hs.push(
    test("headers", "real-testnet4-header", [47, 50], {
      headers: [{ height: 1, hex: publicHeader }],
      hostHashes: { 1: publicHash },
    }),
  );
  const badHeader = Buffer.from(raw.subarray(0, 80));
  badHeader[76] ^= 1;
  hs.push(
    test("headers", "header-hash-mismatch", [47], {
      headers: [{ height: 1, hex: M.hex(badHeader) }],
      hostHashes: { 1: publicHash },
    }),
  );
  // Cheap synthetic headers use regtest's target solely as unit input, no node/prover.
  let prev = M.zero(32);
  const chain = [],
    hh = {};
  for (let height = 100; height < 103; height++) {
    const hdr = Buffer.alloc(80);
    hdr.writeUInt32LE(4);
    prev.copy(hdr, 4);
    hdr.writeUInt32LE(0x207fffff, 72);
    let nonce = 0;
    do {
      hdr.writeUInt32LE(nonce++, 76);
    } while (BigInt("0x" + M.hex(M.reverse(M.dsha(hdr)))) > 0x7fffffn << 232n);
    prev = M.dsha(hdr);
    hh[height] = M.hex(prev);
    chain.push({ height, hex: M.hex(hdr) });
  }
  hs.push(
    test("headers", "linked-headers-with-work", [47], {
      headers: chain,
      hostHashes: hh,
    }),
  );
  const broken = clone(chain);
  broken[1].hex = "00" + broken[1].hex.slice(2);
  hs.push(
    test("headers", "broken-link-or-work", [47], {
      headers: broken,
      hostHashes: hh,
    }),
  );
  suites["headers.json"] = wrap("headers", hs);
  const orderMints = [
      mint(1700, 100, 0),
      mint(1701, 100, 1),
      mint(1702, 100, 2),
    ],
    orderIds = orderMints.map((x) => M.parseTx(x.rawTx).txid),
    orderHeader = Buffer.alloc(80);
  M.merkle(orderIds, true).copy(orderHeader, 36);
  const orderHost = { 100: M.hex(M.dsha(orderHeader)) };
  const orderEntries = orderMints.map((x, i) => ({
    id: ["fee-spent", "ordinary-b", "ordinary-c"][i],
    txid: orderIds[i],
    height: 100,
    txIndex: i,
    ordNumber: [503, 500, 501][i],
    spentToFees: i === 0,
    proof: M.evidence(
      { txid: orderIds[i], height: 100, txIndex: i },
      3,
      orderIds,
      orderHeader,
    ),
  }));
  const orderBase = {
    entries: orderEntries,
    hostHashes: orderHost,
    source: "branch",
    blocks: {
      100: M.hex(
        M.cat(
          orderHeader,
          M.compact(3),
          ...orderMints.map((x) => M.b(x.rawTx)),
        ),
      ),
    },
  };
  const oc = [];
  function orderCase(name, edit) {
    const x = clone(orderBase);
    edit?.(x);
    oc.push(test("ordering", name, [13, 47], x));
  }
  orderCase("fee-spent-number-is-not-transaction-order");
  orderCase("raw-block-proves-transaction-order", (x) => {
    x.source = "block";
  });
  orderCase("inscription-number-alone-is-no-proof", (x) => {
    x.entries.forEach((e) => {
      delete e.proof;
    });
  });
  orderCase("false-transaction-position-rejected", (x) => {
    x.entries[0].txIndex = 2;
  });
  orderCase("wrong-block-hash-rejected", (x) => {
    x.source = "block";
    x.hostHashes[100] = hash("fork");
  });
  suites["transaction-order.json"] = wrap("ordering", oc);
  const ac = [];
  const authCase = (name, edit) => {
    const x = mint(1800, 100, 0);
    edit?.(x);
    ac.push(
      test("commit-auth", name, [7, 46], {
        rawTx: x.rawTx,
        commitTx: x.commitTx,
      }),
    );
  };
  authCase("valid-envelope-commitment");
  authCase("missing-commit-prevout", (x) => {
    x.commitTx = null;
  });
  authCase("forged-envelope-same-reveal-txid", (x) => {
    const t = M.parseTx(x.rawTx);
    t.inputs[0].witness[1] = M.envelope(
      { p: "koc1", op: "mint", r: M.b(recipe.id), m: M.b(M.publicPoint(7)) },
      recipe.art.viewer.id,
    );
    x.rawTx = M.hex(M.serializeTx(t));
  });
  authCase("wrong-control-parity", (x) => {
    const t = M.parseTx(x.rawTx),
      c = M.b(t.inputs[0].witness.at(-1));
    c[0] ^= 1;
    t.inputs[0].witness[t.inputs[0].witness.length - 1] = M.hex(c);
    x.rawTx = M.hex(M.serializeTx(t));
  });
  authCase("wrong-leaf-version", (x) => {
    const t = M.parseTx(x.rawTx),
      c = M.b(t.inputs[0].witness.at(-1));
    c[0] ^= 2;
    t.inputs[0].witness[t.inputs[0].witness.length - 1] = M.hex(c);
    x.rawTx = M.hex(M.serializeTx(t));
  });
  authCase("truncated-control-block", (x) => {
    const t = M.parseTx(x.rawTx);
    t.inputs[0].witness[t.inputs[0].witness.length - 1] = "c0";
    x.rawTx = M.hex(M.serializeTx(t));
  });
  authCase("changed-commit-output", (x) => {
    const t = M.parseTx(x.commitTx);
    t.outputs[0].script = "5120" + M.publicPoint(7);
    x.commitTx = M.hex(M.serializeTx(t, false));
  });
  authCase("wrong-prevout-index", (x) => {
    const t = M.parseTx(x.rawTx);
    t.inputs[0].vout = 1;
    x.rawTx = M.hex(M.serializeTx(t));
  });
  authCase("valid-two-leaf-control-path", (x) => {
    const t = M.parseTx(x.rawTx);
    x.commitTx = bindCommit(t, 1800, [M.tapleaf("51")]);
    x.rawTx = M.hex(M.serializeTx(t));
  });
  authCase("wrong-control-sibling", (x) => {
    const t = M.parseTx(x.rawTx);
    x.commitTx = bindCommit(t, 1800, [M.tapleaf("51")]);
    const c = M.b(t.inputs[0].witness.at(-1));
    c[33] ^= 1;
    t.inputs[0].witness[t.inputs[0].witness.length - 1] = M.hex(c);
    x.rawTx = M.hex(M.serializeTx(t));
  });
  authCase("valid-annex", (x) => {
    const t = M.parseTx(x.rawTx);
    t.inputs[0].witness.push("500102");
    x.rawTx = M.hex(M.serializeTx(t));
  });
  suites["commit-auth.json"] = wrap("commit-auth", ac);
  const pendingBase = {
    recipe,
    refs,
    minterKeys: [M.publicPoint(6)],
    coverageComplete: true,
    discovery: "escrow-payment-script",
    confirmed: 18,
    settling: 1,
    tip: 100,
    controls: [],
    candidates: [mint(1900, null, 0), mint(1901, null, 0)],
  };
  const pcases = [];
  function pendingCase(name, edit) {
    const x = clone(pendingBase);
    edit?.(x);
    pcases.push(test("pending", name, [11, 52], x));
  }
  pendingCase("escrow-scripts-fill-cap");
  pendingCase("marker-index-cannot-establish-pending", (x) => {
    x.discovery = "op-return-marker";
  });
  pendingCase("incomplete-script-coverage-is-unknown", (x) => {
    x.coverageComplete = false;
  });
  pendingCase("duplicate-txid-counted-once", (x) => {
    x.candidates.push(clone(x.candidates[0]));
  });
  pendingCase("confirmed-and-wrong-markers-not-pending", (x) => {
    x.candidates[0].height = 100;
    alter(x.candidates[1], (t) => {
      t.outputs[2].script = M.marker("00".repeat(36));
    });
  });
  pendingCase("known-other-minter-script", (x) => {
    x.minterKeys.push(M.publicPoint(7));
    const c = mint(1902, null, 0);
    alter(c, (t) => {
      t.inputs[0].witness[1] = M.envelope(
        { p: "koc1", op: "mint", r: M.b(recipe.id), m: M.b(M.publicPoint(7)) },
        recipe.art.viewer.id,
      );
      t.outputs[1].script = M.escrow(
        recipe.payment,
        M.publicPoint(7),
      ).scriptPubKey;
    });
    x.candidates.push(c);
  });
  pendingCase("pause-notice-excludes-next-block", (x) => {
    x.controls = [
      {
        id: "pending-pause",
        p: "koc1",
        op: "control",
        r: recipe.id,
        parent: recipe.id,
        height: 98,
        action: "pause",
        at: 101,
      },
    ];
  });
  pendingCase("post-close-refuses-send", (x) => {
    x.tip = 102;
  });
  pendingCase("unindexed-minter-script-is-incomplete", (x) => {
    x.minterKeys = [];
  });
  suites["pending-mints.json"] = wrap("pending", pcases);
  const wa = mint(777),
    wt = M.parseTx(wa.rawTx);
  wt.inputs[0].witness[1] = M.envelope(
    { p: "koc1", op: "mint", r: M.b(recipe.id), m: M.b(M.publicPoint(7)) },
    recipe.art.viewer.id,
  );
  suites["trust-boundaries.json"] = wrap("witness-boundary", [
    test("witness-boundary", "same-txid-different-envelope", [46], {
      a: wa.rawTx,
      b: M.hex(M.serializeTx(wt)),
      commitTx: wa.commitTx,
    }),
  ]);
  return suites;
}
export const serialize = (x) => JSON.stringify(x, null, 2) + "\n";
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const suites = await build();
  for (const [name, x] of Object.entries(suites))
    await writeFile(new URL(name, dir), serialize(x));
  console.log(
    "Generated " +
      Object.keys(suites).length +
      " suites; pinned source and public block unchanged.",
  );
}
