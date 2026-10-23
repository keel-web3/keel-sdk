#!/usr/bin/env node
/**
 * Stage (f) Tezos benchmark for KEEL field permissions, on a network-disabled
 * Octez mockup (the pinned image from keel-contracts script/tezos/octez.py).
 *
 * Every field operation is prepared by `@keel/sdk/field-permissions` and applied
 * with the mockup's bootstrap test accounts only (no real network, wallet or
 * key). Contract code and initial storage come from the keel-contracts SmartPy
 * scenario `field_octez_targets` (test_keel_field_registry.py). The run also
 * checks the shared PACK vectors with `octez-client hash data`.
 *
 * Usage: KEEL_FIELD_TEZOS_TARGETS=<smartpy output>/field_octez_targets \
 *        node packages/tezos/scripts/field-permissions-mockup.mjs [--out report.json]
 */
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import * as fields from "../../sdk/dist/field-permissions.js";

const IMAGE = "tezos/tezos@sha256:c7adc1605e0ac167743e5ccc107c88719d201994b8166dd794ea10fd0488bea2";
const PROTOCOL = "PsUshuai9Qap";
const CONTRACTS = process.env.KEEL_CONTRACTS_DIR ?? path.join(import.meta.dirname, "../../../../keel-contracts");
const TARGETS = path.resolve(process.env.KEEL_FIELD_TEZOS_TARGETS ?? "");
const outIndex = process.argv.indexOf("--out");
const OUT = outIndex < 0 ? undefined : path.resolve(process.argv[outIndex + 1]);
const VECTORS = JSON.parse(readFileSync(path.join(CONTRACTS, "test/fixtures/parity/field-permissions.json"), "utf8"));
const READER_PLACEHOLDER = "KT1FzjiMRCrhrvu57X2L4B9kHzoNTc4q3Ap5";
const APPROVALS_PLACEHOLDER = "KT1G63bJFwupj5HYjVDwBJW6nwo4NtKq4cry";

const files = readdirSync(TARGETS);
const target = (cont, kind) => {
  const name = files.find((file) => file.endsWith(`_cont_${cont}_${kind}.tz`));
  if (name === undefined) throw new Error(`No compiled ${kind} for contract ${cont} in ${TARGETS}`);
  return name;
};

const name = `keel-fields-${randomBytes(6).toString("hex")}`;
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
  if (args.length === 0) return node.prim;
  const application = [node.prim, ...args].join(" ");
  return inSequence ? application : `(${application})`;
}

const receipts = [];
function measure(label, output) {
  const sum = (re) => [...output.matchAll(re)].reduce((total, match) => total + Number(match[1].replace(/,/gu, "")), 0);
  const record = {
    label,
    consumedGas: sum(/Consumed gas: ([\d.,]+)/gu),
    paidStorageBytes: sum(/Paid storage size diff: ([\d,]+) bytes/gu),
    storageBurnTez: sum(/storage fees \.*\s*\+ꜩ([\d.,]+)/gu),
    feeTez: sum(/Fee to the baker: ꜩ([\d.,]+)/gu),
  };
  receipts.push(record);
  process.stdout.write(`  ${label.padEnd(58)} gas ${String(record.consumedGas).padStart(9)}  +${String(record.paidStorageBytes).padStart(5)} B  fee ꜩ${record.feeTez.toFixed(6)}\n`);
  return record;
}

function call(label, destination, entrypoint, value, from = "bootstrap1") {
  return measure(label, client("transfer", "0", "from", from, "to", destination, "--entrypoint", entrypoint, "--arg", typeof value === "string" ? value : michelson(value), "--burn-cap", "100"));
}

function apply(label, prepared, from = "bootstrap1") {
  if (prepared.status !== "review-only" || prepared.signing !== "not-performed") throw new Error("SDK envelope changed.");
  return prepared.operations.map((op, i) => call(prepared.operations.length > 1 ? `${label} #${i}` : label, op.destination, op.parameters.entrypoint, op.parameters.value, from));
}

function originate(label, cont, replacements = {}) {
  let storage = docker("exec", name, "cat", `/targets/${target(cont, "storage")}`).trim();
  for (const [from, to] of Object.entries(replacements)) storage = storage.split(from).join(to);
  const output = client("originate", "contract", label, "transferring", "0", "from", "bootstrap1", "running", `/targets/${target(cont, "contract")}`, "--init", storage, "--burn-cap", "100", "--force");
  const address = output.match(/New contract (KT1[1-9A-HJ-NP-Za-km-z]{33}) originated/u)?.[1];
  if (address === undefined) throw new Error(`${label} origination did not report an address.`);
  const bytes = Number(output.match(/Storage size: ([\d,]+) bytes/u)?.[1].replace(/,/gu, "") ?? 0);
  measure(`originate ${label} (storage ${bytes} B)`, output);
  return address;
}

const report = { schema: "keel.field-permissions.octez-bench@1", image: IMAGE, protocol: PROTOCOL };
try {
  client("create", "mockup");
  const account = (alias) => {
    const shown = client("show", "address", alias);
    return { address: shown.match(/Hash: (tz[1-4]\w+)/u)[1], key: shown.match(/Public Key: (\w+)/u)[1] };
  };
  const [creator, holder, issuer] = ["bootstrap1", "bootstrap2", "bootstrap3"].map(account);
  const network = JSON.parse(client("rpc", "get", "/chains/main/chain_id"));

  // PACK vectors: Octez must produce the exact bytes the registries and the SDK use.
  const gates = VECTORS.gates.tezos;
  const packed = (value, type) => client("hash", "data", value, "of", "type", type).match(/Raw packed data: (0x[0-9a-f]+)/u)[1];
  report.packVectors = [];
  for (const c of gates.merkleLeaves) {
    const value = `Pair "${gates.network}" "${gates.registry}" "${gates.collection}" ${c.ruleId} "${gates.account}" ${c.tokenId === null ? "None" : `(Some ${c.tokenId})`} ${c.fieldMask}`;
    const bytes = packed(value, "pair chain_id address address nat address (option nat) nat");
    report.packVectors.push({ kind: "merkle-leaf", ok: bytes === c.packed });
  }
  for (const c of gates.grants) {
    const value = `Pair 0x${Buffer.from("keel.field.grant.v1").toString("hex")} "${gates.network}" "${gates.registry}" "${gates.collection}" ${c.ruleId} ${c.tokenId} "${gates.account}" ${c.fieldMask} ${c.valueDigest} ${c.nonce} ${c.deadline}`;
    const bytes = packed(value, "pair bytes chain_id address address nat nat address nat bytes nat timestamp");
    report.packVectors.push({ kind: "grant-payload", ok: bytes === c.payload });
  }
  process.stdout.write(`PACK vectors: ${report.packVectors.filter((v) => v.ok).length}/${report.packVectors.length} match Octez\n`);

  process.stdout.write("Originations\n");
  const approvals = originate("approvals", 0);
  const reader = originate("reader", 1);
  const registry = originate("registry", 2, { [READER_PLACEHOLDER]: reader, [APPROVALS_PLACEHOLDER]: approvals });
  const nft = originate("collection", 3);
  const pointed = originate("pointed", 3);
  const accepting = originate("accepting-validator", 4);
  const looping = originate("looping-validator", 5);
  report.contracts = { approvals, reader, registry, nft, pointed, accepting, looping };

  process.stdout.write("Collections\n");
  for (const collection of [nft, pointed]) {
    call("set_minter", collection, "set_minter", `Pair "${creator.address}" True`);
    call("strike 2 tokens to holder", collection, "strike", `Pair "${holder.address}" 2`);
  }

  const GAMER = fields.decodeKeelFieldSchema(VECTORS.schemas.gamer);
  const base = { family: "tezos", registry, collection: nft };
  const merkleLeaf = fields.keelFieldTezosMerkleLeaf({ network, registry, collection: nft, ruleId: 3, account: holder.address, tokenId: 1, fieldMask: 16n });
  const proof = [];
  let node = merkleLeaf;
  for (let i = 0; i < 10; i += 1) {
    const sibling = `0x${createHash("sha256").update(`sibling ${i}`).digest("hex")}`;
    proof.push(sibling);
    const [lo, hi] = node < sibling ? [node, sibling] : [sibling, node];
    node = `0x${createHash("sha256").update(Buffer.from(lo.slice(2) + hi.slice(2), "hex")).digest("hex")}`;
  }

  process.stdout.write("Field space\n");
  const all = GAMER.fields.filter((f) => !f.retired).map((f) => f.name);
  apply("schema + rules", fields.prepareKeelFieldSchema({
    ...base, schema: GAMER, claim: true,
    rules: [
      { ruleId: 0, fields: all, atoms: [{ kind: "creator" }] },
      { ruleId: 1, fields: ["glow"], atoms: [{ kind: "account", account: holder.address }] },
      { ruleId: 2, fields: ["glow"], atoms: [{ kind: "account-set" }] },
      { ruleId: 3, fields: ["glow"], atoms: [{ kind: "merkle", root: node }] },
      { ruleId: 4, fields: ["glow"], atoms: [{ kind: "signed", issuer: issuer.key }] },
      { ruleId: 5, fields: ["glow"], atoms: [{ kind: "token-owner" }] },
      { ruleId: 6, fields: ["glow"], atoms: [{ kind: "pointer-owner" }] },
      { ruleId: 7, fields: ["glow"], atoms: [{ kind: "token-owner" }, { kind: "signed", issuer: issuer.key }] },
    ],
  }));
  apply("set_accounts", fields.prepareKeelFieldGrant({ ...base, schema: GAMER, grant: "accounts", ruleId: 2, accounts: [holder.address] }));
  apply("set_pointer", fields.prepareKeelFieldGrant({ ...base, schema: GAMER, grant: "pointer", tokenId: 1, target: pointed, targetTokenId: 1 }));

  process.stdout.write("Edits (1 bool field unless noted)\n");
  let glow = false;
  const toggle = () => { glow = !glow; return { glow }; };
  const edit = (label, from, ruleId, values, extra = {}, tokenId = 1) =>
    apply(label, fields.prepareKeelFieldEdit({ ...base, schema: GAMER, tokenId, ruleId, values, ...extra }), from)[0];
  const signed = (nonce, ruleId) => {
    const grant = fields.prepareKeelFieldGrant({ ...base, schema: GAMER, grant: "signature", network, ruleId, tokenId: 1, editor: holder.address, fields: ["glow"], nonce, deadline: 4_000_000_000 });
    const signature = client("sign", "bytes", grant.payload, "for", "bootstrap3").match(/Signature: (\w+)/u)[1];
    return { ...grant.witness, signature };
  };
  report.edits = {
    creatorFirstWrite: edit("creator, first write (empty token)", "bootstrap1", 0, { glow: true }, {}, 2),
    creator: edit("creator", "bootstrap1", 0, toggle()),
    account: edit("account", "bootstrap2", 1, toggle()),
    accountSet: edit("account set", "bootstrap2", 2, toggle()),
    tokenOwner: edit("token owner (FA2 get_balance)", "bootstrap2", 5, toggle()),
    pointerOwner: edit("pointer owner (FA2 get_balance on another collection)", "bootstrap2", 6, toggle()),
    merkle: edit("merkle depth 10", "bootstrap2", 3, toggle(), { witnesses: { 0: { kind: "merkle", leafToken: 1, leafFields: ["glow"], proof } } }),
    signed: edit("signed (check_signature)", "bootstrap2", 4, toggle(), { witnesses: { 0: signed(1, 4) } }),
    composed: edit("token owner AND signed", "bootstrap2", 7, toggle(), { witnesses: { 1: signed(2, 7) } }),
    string: edit("string 3 bytes (blob), creator", "bootstrap1", 0, { nickname: "Ace" }),
    collectionScope: edit("string 3 bytes (collection scope), creator", "bootstrap1", 0, { banner: "Ace" }),
    nineFields: edit("9 fields, creator", "bootstrap1", 0, VECTORS.valueCases[1].json),
  };

  process.stdout.write("Listed fields patched into token_info attributes\n");
  call("set_field_writer", nft, "set_field_writer", `Pair "${registry}" True`);
  const patch = fields.prepareKeelFieldSchema({ ...base, schema: GAMER, metadataPatch: true });
  apply("set_metadata_patch", { ...patch, operations: patch.operations.filter((op) => op.parameters.entrypoint === "set_metadata_patch") });
  report.edits.listedWithPatch = edit("listed color + enum with attributes patch", "bootstrap1", 0, { background: "#00ff00", mood: "sleepy" });
  report.edits.listedWithPatchSameSize = edit("listed color + enum, same-size patch", "bootstrap1", 0, { background: "#0000ff", mood: "calm" });
  report.edits.unlistedWithPatchOn = edit("unlisted bool with patch on", "bootstrap1", 0, toggle());

  process.stdout.write("Custom validators\n");
  const VALIDATED = fields.buildKeelFieldSchema({ fields: [
    { name: "level", kind: "uint", min: 0, max: 99, validator: 1 },
    { name: "xp", kind: "uint", min: 0, max: 1000, validator: 2 },
  ] });
  const vbase = { family: "tezos", registry, collection: pointed };
  apply("validated schema", fields.prepareKeelFieldSchema({ ...vbase, schema: VALIDATED, claim: true, validators: [accepting, looping], rules: [{ ruleId: 0, fields: ["level", "xp"], atoms: [{ kind: "creator" }] }] }));
  report.edits.acceptingValidator = apply("edit with accepting validator", fields.prepareKeelFieldEdit({ ...vbase, schema: VALIDATED, tokenId: 1, ruleId: 0, values: { level: 5 } }))[0];
  try {
    apply("edit with looping validator", fields.prepareKeelFieldEdit({ ...vbase, schema: VALIDATED, tokenId: 1, ruleId: 0, values: { xp: 5 } }));
    report.loopingValidator = { refused: false };
  } catch (error) {
    const text = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    report.loopingValidator = { refused: true, gasExhausted: /gas/iu.test(text) && /(exhausted|exceeded|limit)/iu.test(text), excerpt: text.split("\n").filter((line) => /gas|rror/iu.test(line)).slice(0, 4) };
    process.stdout.write(`  looping validator refused: ${JSON.stringify(report.loopingValidator.excerpt)}\n`);
  }
  report.receipts = receipts;
} finally {
  try { docker("rm", "-f", name); } catch { /* already gone */ }
}
if (OUT) writeFileSync(OUT, `${JSON.stringify(report, null, 1)}\n`);
