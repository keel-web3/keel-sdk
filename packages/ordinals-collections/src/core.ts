// KOC1 core adapted from the frozen K0 executable specification.
// @ts-nocheck
import { createHash } from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1";

export const b = (x) => (Buffer.isBuffer(x) ? x : Buffer.from(x, "hex"));
export const hex = (x) => b(x).toString("hex");
export const cat = (...xs) => Buffer.concat(xs.map(b));
export const sha = (...xs) =>
  createHash("sha256")
    .update(cat(...xs))
    .digest();
export const dsha = (...xs) => sha(sha(...xs));
export const utf = (s) => Buffer.from(s, "utf8");
export const zero = (n) => Buffer.alloc(n);
export const u32 = (n) => {
  const r = Buffer.alloc(4);
  r.writeUInt32BE(n);
  return r;
};
export const le32 = (n) => {
  const r = Buffer.alloc(4);
  r.writeUInt32LE(n);
  return r;
};
const le64 = (n) => {
  const r = Buffer.alloc(8);
  r.writeBigUInt64LE(BigInt(n));
  return r;
};
export const reverse = (x) => Buffer.from(b(x)).reverse();
export const outpoint = (displayTxid, n) => cat(reverse(displayTxid), u32(n));
// Ord fields are not KOC1 route outpoints: their index is little-endian and trimmed.
export function ordIdValue(routeId) {
  const id = b(routeId);
  if (id.length !== 36) throw Error("route ID length");
  let index = le32(id.readUInt32BE(32));
  while (index.length && index.at(-1) === 0) index = index.subarray(0, -1);
  return cat(id.subarray(0, 32), index);
}
export function ordIdFromValue(value) {
  const v = b(value);
  if (
    v.length < 32 ||
    v.length > 36 ||
    (v.length > 32 && v.length < 36 && v.at(-1) === 0)
  )
    throw Error("ord ID encoding");
  const index = Buffer.alloc(4);
  v.subarray(32).copy(index);
  return cat(v.subarray(0, 32), u32(index.readUInt32LE()));
}
export const marker = (id) => hex(cat(b("6a284b4f4331"), b(id)));
export const tagged = (tag, ...xs) => {
  const h = sha(utf(tag));
  return sha(h, h, ...xs);
};
export const publicPoint = (n) =>
  hex(
    secp256k1.ProjectivePoint.BASE.multiply(BigInt(n))
      .toRawBytes(true)
      .subarray(1),
  );
export const NUMS =
  "50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0";
export const compact = (n) =>
  n < 253
    ? Buffer.from([n])
    : n <= 65535
      ? cat(b("fd"), Buffer.from([n & 255, n >>> 8]))
      : cat(b("fe"), le32(n));
export function merkle(leaves, bitcoin = false) {
  if (!leaves.length) return zero(32);
  let level = leaves.map(b);
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      if (!level[i + 1])
        next.push(bitcoin ? dsha(level[i], level[i]) : level[i]);
      else {
        if (bitcoin && level[i].equals(level[i + 1]))
          throw Error("mutated Bitcoin tree");
        next.push(
          bitcoin
            ? dsha(level[i], level[i + 1])
            : sha(b("01"), level[i], level[i + 1]),
        );
      }
    }
    level = next;
  }
  return level[0];
}
export function proof(leaves, index, bitcoin = false) {
  let level = leaves.map(b),
    i = index,
    path = [];
  while (level.length > 1) {
    const j = i ^ 1;
    if (j < level.length)
      path.push({ side: j < i ? "left" : "right", hash: hex(level[j]) });
    else if (bitcoin) path.push({ side: "right", hash: hex(level[i]) });
    const next = [];
    for (let k = 0; k < level.length; k += 2)
      next.push(
        level[k + 1]
          ? bitcoin
            ? dsha(level[k], level[k + 1])
            : sha(b("01"), level[k], level[k + 1])
          : bitcoin
            ? dsha(level[k], level[k])
            : level[k],
      );
    level = next;
    i >>= 1;
  }
  return path;
}
export function verifyProof(leaf, path, root, bitcoin = false) {
  let h = b(leaf);
  for (const s of path) {
    if (!["left", "right"].includes(s.side) || b(s.hash).length !== 32)
      return false;
    const pair = s.side === "left" ? [b(s.hash), h] : [h, b(s.hash)];
    h = bitcoin ? dsha(...pair) : sha(b("01"), ...pair);
  }
  return h.equals(b(root));
}
export const metadataLeaf = (n, m) =>
  sha(b("00"), utf("KOC1"), u32(n), sha(utf(m)));
export function permutation(recipe, hash, max) {
  const seed = sha(utf("KOC1/perm"), b(recipe), b(hash)),
    p = Array.from({ length: max }, (_, i) => i + 1);
  for (let i = max - 1; i > 0; i--) {
    const j = Number(BigInt("0x" + hex(sha(seed, u32(i)))) % BigInt(i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  return { seed: hex(seed), perm: p };
}

export function push(data, nonminimal = false) {
  const x = b(data);
  if (nonminimal) return cat(b("4c"), Buffer.from([x.length]), x);
  return x.length === 0
    ? b("00")
    : x.length <= 75
      ? cat(Buffer.from([x.length]), x)
      : x.length <= 255
        ? cat(b("4c"), Buffer.from([x.length]), x)
        : cat(b("4d"), Buffer.from([x.length & 255, x.length >>> 8]), x);
}
const scriptnum = (n) => {
  if (n === 0) return b("00");
  if (n <= 16) return Buffer.from([0x50 + n]);
  const a = [];
  while (n) {
    a.push(n & 255);
    n >>>= 8;
  }
  if (a.at(-1) & 128) a.push(0);
  return push(Buffer.from(a));
};
export const tapleaf = (script) =>
  tagged("TapLeaf", b("c0"), compact(b(script).length), b(script));
export const tapbranch = (a, c) =>
  tagged("TapBranch", ...[b(a), b(c)].sort(Buffer.compare));
export function tapOutput(internal, root) {
  const t = BigInt("0x" + hex(tagged("TapTweak", b(internal), b(root))));
  if (t >= secp256k1.CURVE.n) throw Error("invalid tweak");
  const q = secp256k1.ProjectivePoint.fromHex("02" + internal).add(
    t === 0n
      ? secp256k1.ProjectivePoint.ZERO
      : secp256k1.ProjectivePoint.BASE.multiply(t),
  );
  if (q.equals(secp256k1.ProjectivePoint.ZERO)) throw Error("infinite key");
  const bytes = q.toRawBytes(true);
  return { key: hex(bytes.subarray(1)), parity: bytes[0] & 1 };
}
function bech32m(program) {
  const chars = "qpzry9x8gf2tvdw0s3jn54khce6mua7l",
    hrp = "tb",
    words = [1];
  let acc = 0,
    bits = 0;
  for (const v of b(program)) {
    acc = (acc << 8) | v;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      words.push((acc >>> bits) & 31);
    }
  }
  if (bits) words.push((acc << (5 - bits)) & 31);
  let c = 1;
  const values = [3, 3, 0, 20, 2, ...words, 0, 0, 0, 0, 0, 0],
    g = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  for (const v of values) {
    const top = c >>> 25;
    c = ((c & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) c ^= g[i];
  }
  c = (c ^ 0x2bc830a3) >>> 0;
  return (
    hrp +
    "1" +
    [
      ...words,
      ...Array.from({ length: 6 }, (_, i) => (c >>> (5 * (5 - i))) & 31),
    ]
      .map((v) => chars[v])
      .join("")
  );
}
export function escrow(p, m) {
  const writers = cat(
    push(p.writerKeys[0]),
    b("ac"),
    push(p.writerKeys[1]),
    b("ba"),
    push(p.writerKeys[2]),
    b("ba529c"),
  );
  const scripts = {
    L_t: hex(
      cat(
        scriptnum(p.collectAfter),
        b("b275"),
        push(p.treasuryKey),
        b("ad"),
        writers,
      ),
    ),
    L_m: hex(cat(scriptnum(p.refundAfter), b("b275"), push(m), b("ac"))),
  };
  if (p.earlyRefund) scripts.L_e = hex(cat(push(m), b("ad"), writers));
  const leaves = Object.fromEntries(
    Object.entries(scripts).map(([k, s]) => [k, hex(tapleaf(s))]),
  );
  const inner = p.earlyRefund
      ? tapbranch(leaves.L_m, leaves.L_e)
      : b(leaves.L_m),
    root = tapbranch(leaves.L_t, inner),
    q = tapOutput(NUMS, root);
  const paths = {
    L_t: [hex(inner)],
    L_m: p.earlyRefund ? [leaves.L_e, leaves.L_t] : [leaves.L_t],
  };
  if (p.earlyRefund) paths.L_e = [leaves.L_m, leaves.L_t];
  return {
    scripts,
    leaves,
    root: hex(root),
    outputKey: q.key,
    scriptPubKey: "5120" + q.key,
    address: bech32m(q.key),
    controlBlocks: Object.fromEntries(
      Object.entries(paths).map(([k, v]) => [
        k,
        hex(cat(Buffer.from([0xc0 | q.parity]), b(NUMS), ...v.map(b))),
      ]),
    ),
  };
}

// Deterministic CBOR for fixture authoring; decoder also accepts non-map-order inputs.
export function cbor(x) {
  const head = (major, n) => {
    if (n < 24) return Buffer.from([(major << 5) | n]);
    if (n <= 255) return Buffer.from([(major << 5) | 24, n]);
    if (n <= 65535)
      return cat(Buffer.from([(major << 5) | 25, n >>> 8, n & 255]));
    return cat(Buffer.from([(major << 5) | 26]), u32(n));
  };
  if (x === null) return b("f6");
  if (typeof x === "boolean") return b(x ? "f5" : "f4");
  if (typeof x === "number") {
    if (!Number.isSafeInteger(x) || x < 0 || x > 0xffffffff)
      throw Error("CBOR integer");
    return head(0, x);
  }
  if (Buffer.isBuffer(x)) return cat(head(2, x.length), x);
  if (typeof x === "string") return cat(head(3, Buffer.byteLength(x)), utf(x));
  if (Array.isArray(x)) return cat(head(4, x.length), ...x.map(cbor));
  const pairs = Object.entries(x)
    .map(([k, v]) => [cbor(k), cbor(v)])
    .sort((a, c) => a[0].length - c[0].length || Buffer.compare(a[0], c[0]));
  return cat(head(5, pairs.length), ...pairs.flat());
}
export function decodeCbor(bytes) {
  let p = 0;
  const src = b(bytes),
    take = (n) => {
      if (p + n > src.length) throw Error("CBOR truncated");
      const s = src.subarray(p, p + n);
      p += n;
      return s;
    };
  function read() {
    const t = take(1)[0],
      major = t >>> 5,
      ai = t & 31;
    if (major === 7) {
      if (t === 0xf4) return false;
      if (t === 0xf5) return true;
      if (t === 0xf6) return null;
      throw Error("CBOR simple");
    }
    if (ai >= 27) throw Error("CBOR indefinite/large");
    const n =
      ai < 24
        ? ai
        : ai === 24
          ? take(1)[0]
          : ai === 25
            ? take(2).readUInt16BE()
            : take(4).readUInt32BE();
    if (major === 0) return n;
    if (major === 2) return Buffer.from(take(n));
    if (major === 3)
      return new TextDecoder("utf-8", { fatal: true }).decode(take(n));
    if (major === 4) return Array.from({ length: n }, read);
    if (major === 5) {
      const o = {};
      for (let i = 0; i < n; i++) {
        const k = read();
        if (
          typeof k !== "string" ||
          Object.hasOwn(o, k) ||
          ["__proto__", "constructor", "prototype"].includes(k)
        )
          throw Error("CBOR key");
        o[k] = read();
      }
      return o;
    }
    throw Error("CBOR type");
  }
  const result = read();
  if (p !== src.length) throw Error("CBOR trailing");
  return result;
}
export function envelope(
  m,
  viewer,
  { extra = [], body = "", nonminimal = false, chunks = false } = {},
) {
  const encoded = cbor(m),
    fields = [
      [7, utf("koc1")],
      [11, ordIdValue(viewer)],
      ...(!chunks
        ? [[5, encoded]]
        : [
            [5, encoded.subarray(0, 16)],
            [5, encoded.subarray(16)],
          ]),
      ...extra,
    ];
  return hex(
    cat(
      push(m.m),
      b("ac0063"),
      push(utf("ord")),
      ...fields.flatMap(([tag, value]) => [
        push(Buffer.from([tag]), nonminimal),
        push(value),
      ]),
      b("00"),
      body ? push(utf(body)) : zero(0),
      b("68"),
    ),
  );
}
function tokens(bytes) {
  const s = b(bytes),
    out = [];
  let p = 0;
  while (p < s.length) {
    const op = s[p++];
    if (op === 0) {
      out.push({ op, data: zero(0), minimal: true });
      continue;
    }
    let n = op;
    if (op === 0x4c) {
      if (p === s.length) throw Error("push truncated");
      n = s[p++];
    } else if (op === 0x4d) {
      if (p + 2 > s.length) throw Error("push truncated");
      n = s.readUInt16LE(p);
      p += 2;
    } else if (op === 0x4e) {
      if (p + 4 > s.length) throw Error("push truncated");
      n = s.readUInt32LE(p);
      p += 4;
    } else if (op > 75) {
      out.push({ op });
      continue;
    }
    if (p + n > s.length) throw Error("push truncated");
    const data = s.subarray(p, p + n);
    p += n;
    out.push({
      op,
      data,
      minimal: op <= 75 || (op === 76 && n >= 76) || (op === 77 && n > 255),
    });
  }
  return out;
}
// ord 0.29.1 consumes only completed push-only envelopes. A malformed
// instruction invalidates the entire tapscript, including earlier envelopes.
export function parseOrdEnvelopes(script) {
  const ts = tokens(script), result = [];
  let i = 0, stutter = false;
  while (i < ts.length) {
    const first = ts[i++];
    if (!first.data || first.data.length !== 0) continue;
    if (ts[i]?.op !== 0x63) { stutter = !!ts[i]?.data && ts[i].data.length === 0; continue; }
    i++;
    if (!ts[i]?.data?.equals(utf("ord"))) { stutter = !!ts[i]?.data && ts[i].data.length === 0; continue; }
    i++;
    const payload = [];
    let pushnum = false, complete = false;
    while (i < ts.length) {
      const t = ts[i++];
      if (t.op === 0x68) { complete = true; break; }
      if (t.data) payload.push(t.data);
      else if (t.op === 0x4f || (t.op >= 0x51 && t.op <= 0x60)) {
        pushnum = true; payload.push(Buffer.from([t.op === 0x4f ? 0x81 : t.op - 0x50]));
      } else break;
    }
    if (complete) result.push({ offset: result.length, payload, pushnum, stutter });
    else stutter = false;
  }
  return result;
}
function parseEnvelope(script) {
  const ts = tokens(script),
    start = ts.findIndex(
      (t, i) =>
        t.op === 0 &&
        ts[i + 1]?.op === 0x63 &&
        ts[i + 2]?.data?.equals(utf("ord")),
    );
  if (start !== 2 || ts[0].data?.length !== 32 || ts[1].op !== 0xac)
    throw Error("canonical prefix");
  let i = start + 3,
    fields = new Map();
  for (; i < ts.length && ts[i].op !== 0; i += 2) {
    const t = ts[i],
      v = ts[i + 1];
    if (
      !t?.data ||
      !v?.data ||
      !t.minimal ||
      !v.minimal ||
      t.data.length === 0 ||
      (t.data.length > 1 && t.data.at(-1) === 0) ||
      v.data.length > 520
    )
      throw Error("canonical push");
    const tag = hex(t.data);
    if (t.data[0] % 2 === 0) throw Error("even tag");
    if (fields.has(tag) && tag !== "05") throw Error("duplicate tag");
    fields.set(tag, cat(fields.get(tag) || zero(0), v.data));
  }
  if (ts[i]?.op !== 0 || ts[i + 1]?.op !== 0x68 || i + 2 !== ts.length)
    throw Error("nonempty body");
  const m = decodeCbor(fields.get("05") || zero(0));
  return {
    m,
    tag7: fields.get("07")?.toString("utf8"),
    viewer: hex(ordIdFromValue(fields.get("0b") || zero(0))),
    revealKey: hex(ts[0].data),
  };
}

export function serializeTx(tx, witness = true) {
  const ins = tx.inputs.map((v) =>
    cat(
      b(v.txid),
      le32(v.vout),
      compact(b(v.scriptSig || "").length),
      b(v.scriptSig || ""),
      le32(v.sequence ?? 0xfffffffd),
    ),
  );
  const outs = tx.outputs.map((v) =>
    cat(le64(v.value), compact(b(v.script).length), b(v.script)),
  );
  const wit = tx.inputs.map((v) =>
    cat(
      compact(v.witness?.length || 0),
      ...(v.witness || []).map((w) => cat(compact(b(w).length), b(w))),
    ),
  );
  return cat(
    le32(tx.version ?? 2),
    witness ? b("0001") : zero(0),
    compact(ins.length),
    ...ins,
    compact(outs.length),
    ...outs,
    witness ? cat(...wit) : zero(0),
    le32(tx.locktime ?? 0),
  );
}
export function parseTx(bytes, start = 0) {
  const src = b(bytes);
  let p = start;
  const take = (n) => {
    if (p + n > src.length) throw Error("tx truncated");
    const r = src.subarray(p, p + n);
    p += n;
    return r;
  };
  const readVar = () => {
    const n = take(1)[0];
    if (n < 253) return n;
    if (n === 253) {
      const v = take(2).readUInt16LE();
      if (v < 253) throw Error("nonminimal varint");
      return v;
    }
    if (n === 254) {
      const v = take(4).readUInt32LE();
      if (v <= 65535) throw Error("nonminimal varint");
      return v;
    }
    throw Error("oversize varint");
  };
  const version = take(4).readUInt32LE();
  let witness = false;
  if (src[p] === 0 && src[p + 1] === 1) {
    p += 2;
    witness = true;
  }
  const ni = readVar();
  if (!ni || ni > 100000) throw Error("input count");
  const inputs = [];
  for (let i = 0; i < ni; i++) {
    const txid = hex(take(32)),
      vout = take(4).readUInt32LE(),
      scriptSig = hex(take(readVar())),
      sequence = take(4).readUInt32LE();
    inputs.push({ txid, vout, scriptSig, sequence, witness: [] });
  }
  const no = readVar();
  if (no > 100000) throw Error("output count");
  const outputs = [];
  for (let i = 0; i < no; i++) {
    const value = Number(take(8).readBigUInt64LE());
    if (!Number.isSafeInteger(value)) throw Error("sats overflow");
    outputs.push({ value, script: hex(take(readVar())) });
  }
  if (witness)
    for (const v of inputs) {
      const nw = readVar();
      for (let i = 0; i < nw; i++) v.witness.push(hex(take(readVar())));
    }
  const locktime = take(4).readUInt32LE(),
    tx = { version, inputs, outputs, locktime };
  return {
    ...tx,
    end: p,
    strippedHex: hex(serializeTx(tx, false)),
    txid: hex(dsha(serializeTx(tx, false))),
  };
}
export function parseBlock(raw) {
  const src = b(raw);
  if (src.length < 81) throw Error("block truncated");
  const header = src.subarray(0, 80);
  let p = 80,
    n = src[p++];
  if (n === 253) {
    n = src.readUInt16LE(p);
    p += 2;
  } else if (n >= 254) throw Error("block count cap");
  const txids = [];
  for (let i = 0; i < n; i++) {
    const tx = parseTx(src, p);
    p = tx.end;
    txids.push(tx.txid);
  }
  if (p !== src.length) throw Error("block trailing");
  const root = merkle(txids, true);
  return {
    hash: hex(reverse(dsha(header))),
    internalHash: hex(dsha(header)),
    merkleRoot: hex(root),
    headerMerkleRoot: hex(header.subarray(36, 68)),
    txids,
    valid: root.equals(header.subarray(36, 68)),
  };
}

const uint = (n) => Number.isInteger(n) && n >= 0 && n <= 0xffffffff;
const key = (k) => {
  try {
    return b(k).length === 32 && !!secp256k1.ProjectivePoint.fromHex("02" + k);
  } catch {
    return false;
  }
};
export function recipeCheck(r, refs) {
  const errors = [];
  if (
    r.p !== "koc1" ||
    r.op !== "recipe" ||
    r.v !== 1 ||
    r.network !== "testnet4" ||
    !uint(r.height) ||
    b(r.id).length !== 36
  )
    errors.push("identity");
  if (
    !uint(r.finality) ||
    r.finality < 1 ||
    !uint(r.challengeWindow) ||
    r.challengeWindow < 1 ||
    !Number.isSafeInteger(r.price) ||
    r.price < 0
  )
    errors.push("numbers");
  const e = r.end;
  if (
    !e ||
    !["supply", "time", "first", "open"].includes(e.mode) ||
    !uint(e.open) ||
    (e.close !== undefined && (!uint(e.close) || e.close < e.open)) ||
    (["supply", "first"].includes(e.mode) && (!uint(e.max) || e.max < 1)) ||
    (["time", "first"].includes(e.mode) && e.close === undefined) ||
    (e.mode === "open" && e.max !== undefined)
  )
    errors.push("end");
  if (uint(r.height) && uint(e?.open) && r.height >= e.open)
    errors.push("recipe-height");
  const m = r.metadata;
  if (
    !m ||
    !["merkle", "generator"].includes(m.mode) ||
    (m.mode === "merkle" &&
      (!uint(m.count) ||
        m.count < 1 ||
        b(m.root).length !== 32 ||
        (e.max > m.count && !m.cycle))) ||
    (m.order === "blind" && e.mode === "open" && e.close === undefined) ||
    ((e.mode === "open" || (e.mode === "time" && uint(e.close))) && e.max === undefined && m.mode === "merkle" && !m.cycle)
  )
    errors.push("metadata");
  if (
    !Array.isArray(r.writers) ||
    new Set(r.writers.map((w) => w.authority)).size !== r.writers.length ||
    !uint(r.quorum) ||
    r.quorum < 2 ||
    r.quorum > r.writers.length
  )
    errors.push("writers");
  if (
    ["writerRegistry", "bridges", "checkpoint"].some(
      (k) => !Object.hasOwn(r, k),
    ) ||
    !r.indexer?.reference
  )
    errors.push("fields");
  if (r.payment?.mode === "escrow") {
    const p = r.payment;
    if (
      !key(p.treasuryKey) ||
      p.writerKeys?.length !== 3 ||
      new Set([p.treasuryKey, ...p.writerKeys].map(k => typeof k === "string" ? k.toLowerCase() : k)).size !== 4 ||
      !p.writerKeys.every(key) ||
      !uint(p.collectAfter) ||
      p.collectAfter < r.challengeWindow ||
      p.collectAfter < 1 ||
      p.collectAfter > 65535 ||
      !uint(p.refundAfter) ||
      p.refundAfter <= p.collectAfter ||
      p.refundAfter > 65535
    )
      errors.push("escrow");
  } else if (
    r.payment?.mode !== "direct" ||
    !/^([0-9a-f]{2})+$/.test(r.payment.treasuryScript)
  )
    errors.push("payment");
  if (
    r.controls &&
    (!uint(r.controls.notice) || typeof r.controls.pausable !== "boolean")
  )
    errors.push("controls");
  const required = [...(m?.bundles || []), r.art?.viewer, r.indexer].filter(
    Boolean,
  );
  for (const ref of required) {
    const got = refs[ref.id];
    if (
      !got ||
      !uint(got.height) ||
      got.height > r.height ||
      (got.height === r.height &&
        (!uint(got.txIndex) || !uint(r.txIndex) || got.txIndex >= r.txIndex)) ||
      hex(sha(b(got.bytes))) !== ref.sha256
    )
      errors.push("reference");
  }
  if (!r.art?.viewer || !r.indexer?.id) errors.push("reference");
  if (m?.mode === "merkle") {
    let n = 1;
    for (const bundle of m.bundles || []) {
      if (bundle.from !== n || bundle.to < bundle.from)
        errors.push("bundle-range");
      n = bundle.to + 1;
    }
    if (n !== m.count + 1) errors.push("bundle-range");
  }
  return [...new Set(errors)];
}
// E1: reveal prevout authenticates the stripped commit bytes; its output commits
// to the exact tapscript. This does not authenticate signatures or the annex.
export function authenticateCommit(rawReveal, rawCommit) {
  try {
    if (typeof rawCommit !== "string") return false;
    const reveal = parseTx(rawReveal),
      commit = parseTx(rawCommit),
      input = reveal.inputs[0];
    if (
      reveal.end !== b(rawReveal).length ||
      commit.end !== b(rawCommit).length ||
      !input ||
      input.txid !== commit.txid
    )
      return false;
    const output = commit.outputs[input.vout];
    if (!output || !/^5120[0-9a-f]{64}$/.test(output.script)) return false;
    const witness = [...input.witness];
    if (witness.length >= 2 && witness.at(-1).startsWith("50")) witness.pop();
    if (witness.length < 2) return false;
    const script = b(witness.at(-2)),
      control = b(witness.at(-1));
    if (
      control.length < 33 ||
      control.length > 33 + 128 * 32 ||
      (control.length - 33) % 32 !== 0 ||
      (control[0] & 0xfe) !== 0xc0
    )
      return false;
    let root = tapleaf(script);
    for (let i = 33; i < control.length; i += 32)
      root = tapbranch(root, control.subarray(i, i + 32));
    const q = tapOutput(hex(control.subarray(1, 33)), root);
    return output.script === "5120" + q.key && (control[0] & 1) === q.parity;
  } catch {
    return false;
  }
}
export function formCheck(input) {
  const { recipe: r } = input;
  let tx;
  try {
    tx = parseTx(input.rawTx);
    if (tx.end !== b(input.rawTx).length) return { error: "tx-trailing" };
  } catch {
    return { error: "tx-bytes" };
  }
  const scripts = tx.inputs.map((v) => {
    const w = [...v.witness];
    if (w.at(-1)?.startsWith("50")) w.pop();
    return w.length >= 2 ? w.at(-2) : "";
  });
  let found = 0, vin = -1;
  scripts.forEach((script, j) => {
    try {
      const parsed = parseOrdEnvelopes(script);
      if (parsed.length) { found += parsed.length; vin = j; }
    } catch { /* ord ignores an unparsable tapscript */ }
  });
  if (found !== 1) return { error: "envelope-count" };
  if (vin !== 0) return { error: "envelope-input" };
  let e;
  try {
    e = parseEnvelope(scripts[0]);
  } catch {
    return { error: "canonical-envelope" };
  }
  if (
    e.tag7 !== "koc1" ||
    e.viewer !== r.art.viewer.id ||
    e.m.p !== "koc1" ||
    e.m.op !== "mint" ||
    !Buffer.isBuffer(e.m.r) ||
    hex(e.m.r) !== r.id ||
    !Buffer.isBuffer(e.m.m) ||
    !key(hex(e.m.m)) ||
    Object.hasOwn(e.m, "n")
  )
    return { error: "tags" };
  if (
    e.m.ch !== undefined &&
    (!Array.isArray(e.m.ch) ||
      !e.m.ch.every((x) => Buffer.isBuffer(x) && x.length === 36))
  )
    return { error: "ch" };
  if (
    e.m.seen !== undefined &&
    (!Array.isArray(e.m.seen) ||
      !e.m.seen.every(
        (x) =>
          Array.isArray(x) &&
          x.length === 3 &&
          uint(x[0]) &&
          x[0] < r.writers.length &&
          Buffer.isBuffer(x[1]) &&
          x[1].length === 36 &&
          Buffer.isBuffer(x[2]) &&
          x[2].length === 32,
      ))
  )
    return { error: "seen" };
  if (
    (input.charms || []).some((c) =>
      ["cursed", "unbound", "reinscription"].includes(c),
    )
  )
    return { error: "charms" };
  if (!authenticateCommit(input.rawTx, input.commitTx))
    return { error: "commit-authentication" };
  if (!tx.outputs[0] || tx.outputs[0].value < 330)
    return { error: "recipient" };
  const marks = tx.outputs.filter((o) => o.script.startsWith("6a284b4f4331"));
  if (
    marks.length !== 1 ||
    tx.outputs[2]?.script !== marker(r.id) ||
    tx.outputs[2].value !== 0
  )
    return { error: "marker" };
  const expected =
    r.payment.mode === "escrow"
      ? escrow(r.payment, hex(e.m.m)).scriptPubKey
      : r.payment.treasuryScript;
  if (tx.outputs[1]?.script !== expected || tx.outputs[1]?.value < r.price)
    return { error: "payment" };
  return {
    txid: tx.txid,
    m: hex(e.m.m),
    height: input.height,
    txIndex: input.txIndex,
    paymentOutpoint: hex(cat(b(tx.txid), u32(1))),
  };
}
export function acceptControls(r, controls) {
  let sealed = false;
  const accepted = [],
    ignored = [];
  for (const c of controls) {
    const valid =
      c.p === "koc1" &&
      c.op === "control" &&
      c.r === r.id &&
      c.parent === r.id &&
      uint(c.at) &&
      uint(c.height) &&
      r.controls &&
      c.at >= c.height + r.controls.notice &&
      !sealed;
    if (
      !valid ||
      !["close", "lowerCap", "pause", "resume"].includes(c.action) ||
      Object.keys(c).some(
        (k) =>
          ![
            "id",
            "p",
            "op",
            "r",
            "parent",
            "height",
            "action",
            "at",
            "cap",
          ].includes(k),
      ) ||
      (c.action === "lowerCap" &&
        (!uint(c.cap) ||
          c.cap < 1 ||
          r.end.max === undefined ||
          c.cap >= r.end.max)) ||
      (["pause", "resume"].includes(c.action) && !r.controls.pausable)
    ) {
      ignored.push(c.id);
      continue;
    }
    accepted.push(c);
    if (c.action === "close") sealed = true;
  }
  return { accepted, ignored };
}
export function indexState(r, refs, candidates, h, hash, controls = []) {
  const recipeErrors = recipeCheck(r, refs),
    cs = acceptControls(r, controls),
    valid = [],
    refund = [],
    rejected = [],
    pending = [];
  let sold = null,
    cap = r.end.max ?? null,
    endHeight = r.end.close ?? null;
  for (const x of candidates) if (x.height === null || !uint(x.txIndex)) pending.push(x.id);
  const rows = candidates
    .filter((x) => x.height !== null && uint(x.txIndex))
    .map((x) => ({ input: x, entry: formCheck({ ...x, recipe: r, refs }) }))
    .sort(
      (a, c) =>
        (a.input.height ?? Infinity) - (c.input.height ?? Infinity) ||
        a.input.txIndex - c.input.txIndex,
    );
  const heights = [
    ...new Set([
      ...rows
        .filter((x) => uint(x.input.height) && x.input.height <= h)
        .map((x) => x.input.height),
      ...cs.accepted.filter((c) => c.at <= h).map((c) => c.at),
    ]),
  ].sort((a, c) => a - c);
  const seen = new Set();
  for (const height of heights) {
    let paused = false,
      close = r.end.close ?? null;
    for (const c of cs.accepted) {
      if (c.action === "close") close = Math.min(close ?? Infinity, c.at);
      if (c.at <= height) {
        if (c.action === "pause") paused = true;
        if (c.action === "resume") paused = false;
      }
    }
    if (close !== null) endHeight = Math.min(endHeight ?? Infinity, close);
    const active =
      height >= r.end.open &&
      (close === null || height <= close) &&
      !paused &&
      (sold === null || height <= sold);
    const block = [];
    for (const { input: x, entry } of rows.filter(
      (x) => x.input.height === height,
    )) {
      if (entry.error || recipeErrors.length || r.height >= r.end.open) {
        rejected.push({ id: x.id, reason: entry.error || "recipe" });
        continue;
      }
      if (!uint(x.txIndex)) {
        rejected.push({ id: x.id, reason: "tx-index" });
        continue;
      }
      if (seen.has(entry.txid)) continue;
      seen.add(entry.txid);
      if (active) block.push({ ...entry, id: x.id });
      else if (height < r.end.open)
        rejected.push({ id: x.id, reason: "before-open" });
      else
        refund.push({ ...entry, id: x.id, reason: paused ? "paused" : "late" });
    }
    const countAt = valid.length + block.length;
    for (const c of cs.accepted.filter(
      (c) => c.action === "lowerCap" && c.at === height,
    )) {
      if (c.cap < cap) cap = Math.min(cap, Math.max(c.cap, countAt));
    }
    valid.push(...block);
    if (cap !== null && valid.length >= cap && sold === null) {
      sold = height;
      endHeight = Math.min(endHeight ?? Infinity, height);
    }
  }
  const members = valid.filter((_, i) => cap === null || i < cap),
    over = valid
      .filter((_, i) => cap !== null && i >= cap)
      .map((x) => ({ ...x, reason: "over-cap" }));
  refund.push(...over);
  refund.sort((a, c) => a.height - c.height || a.txIndex - c.txIndex);
  const leaf = (x, n) =>
    sha(
      utf("KOC1/m"),
      u32(n),
      b(x.txid),
      u32(x.height),
      u32(x.txIndex),
      b(x.m),
      b(x.paymentOutpoint),
    );
  const membersRoot = merkle(members.map((x, i) => leaf(x, i + 1))),
    overRoot = merkle(refund.map((x, i) => leaf(x, i + 1))),
    root = sha(
      utf("KOC1/i"),
      b(r.id),
      u32(h),
      b(hash),
      u32(members.length),
      membersRoot,
      overRoot,
    );
  return {
    h,
    hash,
    count: members.length,
    over: refund.length,
    members: members.map((x, i) => ({ ...x, n: i + 1 })),
    refund,
    rejected,
    pending,
    cap,
    endHeight,
    sold,
    controls: cs,
    membersRoot: hex(membersRoot),
    overRoot: hex(overRoot),
    indexRoot: hex(root),
  };
}
export const confirmations = (height, tip) =>
  height === null ? 0 : Math.max(0, tip - height + 1);
export function signerPolicy({
  kind,
  member,
  settled,
  depth,
  W,
  unresolved,
  unspent = true,
}) {
  return (
    unspent &&
    settled &&
    !unresolved &&
    (kind === "collect" ? member && depth >= W : !member)
  );
}
export function escrowPolicy({
  path,
  height,
  spendHeight,
  payment,
  version = 2,
  sequence,
  signers,
  member,
  settled,
  depth,
  W,
  unresolved,
}) {
  const delay =
    path === "L_t"
      ? payment.collectAfter
      : path === "L_m"
        ? payment.refundAfter
        : 0;
  const writerCount = new Set(
    signers.filter((x) => ["w1", "w2", "w3"].includes(x)),
  ).size;
  const signatures =
    path === "L_t"
      ? signers.includes("treasury") && writerCount === 2
      : path === "L_m"
        ? signers.includes("buyer")
        : payment.earlyRefund && signers.includes("buyer") && writerCount === 2;
  const csv =
    delay === 0 ||
    (version >= 2 &&
      sequence !== undefined &&
      !(sequence & 0x80400000) &&
      (sequence & 65535) >= delay &&
      spendHeight >= height + delay);
  const consensus = !!(signatures && csv);
  return {
    consensus,
    writerPolicy:
      path === "L_m"
        ? true
        : signerPolicy({
            kind: path === "L_t" ? "collect" : "refund",
            member,
            settled,
            depth,
            W,
            unresolved,
          }),
  };
}

