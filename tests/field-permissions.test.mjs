import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

import { decodeAbiParameters, decodeFunctionData, keccak256 } from "viem";

import {
  KEEL_FIELD_REGISTRY_EVM_ABI,
  KeelFieldSchemaError,
  KeelFieldValueError,
  buildKeelFieldMerkleTree,
  buildKeelFieldSchema,
  checkKeelFieldSchemaCompatible,
  checkKeelFieldValues,
  decodeKeelFieldSchema,
  decodeKeelFieldValue,
  encodeKeelFieldEdit,
  keelFieldEvmMerkleLeaf,
  keelFieldForm,
  keelFieldMask,
  keelFieldTezosGrantPayload,
  keelFieldTezosMerkleLeaf,
  prepareKeelFieldEdit,
  prepareKeelFieldFreeze,
  prepareKeelFieldGrant,
  prepareKeelFieldRevoke,
  prepareKeelFieldSchema,
  renderKeelFields,
  splitKeelFieldEdit,
} from "../packages/sdk/dist/index.js";

// Copy of keel-contracts test/fixtures/parity/field-permissions.json (field-permissions-vectors.test.mjs keeps it current).
const VECTORS = JSON.parse(readFileSync(new URL("./fixtures/field-permissions-v1.json", import.meta.url), "utf8"));
const GAMER = decodeKeelFieldSchema(VECTORS.schemas.gamer);
const EVM = VECTORS.gates.evm;
const TEZ = VECTORS.gates.tezos;
const sha256 = (hex) => `0x${createHash("sha256").update(Buffer.from(hex.slice(2), "hex")).digest("hex")}`;

test("KF v1 schemas: the SDK encoder produces the reference bytes and refuses with the onchain reasons", () => {
  assert.equal(buildKeelFieldSchema(VECTORS.definitions.gamer).hex, VECTORS.schemas.gamer);
  assert.equal(buildKeelFieldSchema(VECTORS.definitions.wide).hex, VECTORS.schemas.wide);
  for (const c of VECTORS.schemaCases) {
    if (c.valid) {
      const schema = decodeKeelFieldSchema(c.hex);
      assert.equal(schema.tokenWords, c.tokenWords, c.name);
      assert.equal(schema.collectionWords, c.collectionWords, c.name);
      continue;
    }
    assert.throws(() => decodeKeelFieldSchema(c.hex), (error) => error instanceof KeelFieldSchemaError
      && error.reason === c.reason && error.code === VECTORS.schemaReasons.indexOf(c.reason) + 1, c.name);
  }
  assert.deepEqual(GAMER.fields.map((f) => f.name), VECTORS.definitions.gamer.fields.map((f) => f.name));
  assert.equal(GAMER.fields[5].min, -50n);
  assert.deepEqual(GAMER.fields[1].selectable, ["calm", "sleepy"]);
  assert.deepEqual(GAMER.ui, VECTORS.definitions.gamer.ui);
});

test("values: JSON converts to the reference wire bytes and every refusal names the onchain reason and field", () => {
  for (const c of VECTORS.valueCases) {
    if (c.valid) {
      checkKeelFieldValues(GAMER, BigInt(c.mask), c.values);
      const edit = encodeKeelFieldEdit(GAMER, c.json);
      assert.equal(edit.mask, BigInt(c.mask), c.name);
      assert.equal(edit.values, c.values, c.name);
      continue;
    }
    const matches = (error) => error instanceof KeelFieldValueError && error.reason === c.reason && error.field === c.field;
    assert.throws(() => checkKeelFieldValues(GAMER, BigInt(c.mask), c.values), matches, `${c.name} (wire)`);
    if (c.json) assert.throws(() => encodeKeelFieldEdit(GAMER, c.json), matches, `${c.name} (json)`);
  }
  assert.equal(decodeKeelFieldValue(GAMER.fields[5], "0xffffffffffffffd3"), "-45");
  assert.throws(() => encodeKeelFieldEdit(GAMER, { nope: 1 }), /UNKNOWN_FIELD/u);
  assert.throws(() => encodeKeelFieldEdit(GAMER, {}), /EMPTY/u);
});

test("render: fields, EVM attributes and Tezos TZIP-21 attributes equal the registry readers", () => {
  for (const c of VECTORS.renderCases) {
    const current = {};
    for (const e of c.edits) Object.assign(current, splitKeelFieldEdit(GAMER, BigInt(e.mask), e.values));
    const out = renderKeelFields(GAMER, current);
    assert.equal(out.fields, c.fields, c.name);
    assert.equal(out.attributes, c.attributes, c.name);
    assert.equal(out.tezosAttributes, c.tezosAttributes, c.name);
  }
  const unlisted = buildKeelFieldSchema({ fields: [{ name: "glow", kind: "bool" }] });
  assert.deepEqual(renderKeelFields(unlisted), { fields: '"fields":{"glow":false}', attributes: "", tezosAttributes: "" });
});

test("schema updates are append-only and frozen field records cannot change", () => {
  const base = VECTORS.definitions.gamer;
  const appended = buildKeelFieldSchema({ ...base, fields: [...base.fields, { name: "extra", kind: "bool" }] });
  checkKeelFieldSchemaCompatible(GAMER, appended);
  const relabelled = buildKeelFieldSchema({ ...base, fields: base.fields.map((f) => (f.name === "level" ? { ...f, default: 2 } : f)) });
  assert.throws(() => checkKeelFieldSchemaCompatible(GAMER, relabelled), /INCOMPATIBLE/u);
  const widened = buildKeelFieldSchema({ ...base, fields: base.fields.map((f) => (f.name === "nickname" ? { ...f, maxLength: 30 } : f)) });
  checkKeelFieldSchemaCompatible(GAMER, widened);
  assert.throws(() => checkKeelFieldSchemaCompatible(GAMER, widened, keelFieldMask(GAMER, ["nickname"])), /INCOMPATIBLE/u);
  assert.throws(() => checkKeelFieldSchemaCompatible(appended, GAMER), /INCOMPATIBLE/u);
});

test("gate hashes equal the Python reference and both registries", () => {
  for (const c of EVM.merkleLeaves) {
    const tokenId = BigInt(c.leafToken) === (1n << 256n) - 1n ? null : c.leafToken;
    assert.equal(keelFieldEvmMerkleLeaf({ chainId: EVM.chainId, registry: EVM.registry, collection: EVM.collection, ruleId: c.ruleId, account: EVM.account, tokenId, fieldMask: BigInt(c.leafMask) }), c.leaf);
  }
  for (const c of EVM.grants) {
    const prepared = prepareKeelFieldGrant({
      family: "evm", registry: EVM.registry, collection: EVM.collection, schema: GAMER, grant: "signature", chainId: EVM.chainId,
      ruleId: c.ruleId, tokenId: c.tokenId, editor: EVM.account, nonce: c.nonce, deadline: c.deadline,
      fields: GAMER.fields.filter((f) => (BigInt(c.fieldMask) >> BigInt(f.index)) & 1n).map((f) => f.name),
      ...(c.values ? { values: valuesFor(c.fieldMask, c.values) } : {}),
    });
    assert.equal(prepared.digest, c.digest);
    assert.equal(prepared.typedData.message.valueDigest, c.valueDigest);
    assert.equal(prepared.calls.length, 0);
  }
  for (const c of TEZ.merkleLeaves) {
    assert.equal(keelFieldTezosMerkleLeaf({ network: TEZ.network, registry: TEZ.registry, collection: TEZ.collection, ruleId: c.ruleId, account: TEZ.account, tokenId: c.tokenId, fieldMask: BigInt(c.fieldMask) }), c.leaf);
  }
  for (const c of TEZ.grants) {
    assert.equal(keelFieldTezosGrantPayload({ network: TEZ.network, registry: TEZ.registry, collection: TEZ.collection, ruleId: c.ruleId, tokenId: c.tokenId, editor: TEZ.account, fieldMask: BigInt(c.fieldMask), values: c.values, nonce: c.nonce, deadline: c.deadline }), c.payload);
    if (c.values) assert.equal(sha256(c.values), c.valueDigest);
  }
});

function valuesFor(mask, wire) {
  const split = splitKeelFieldEdit(GAMER, BigInt(mask), wire);
  return Object.fromEntries(Object.entries(split).map(([index, value]) => [GAMER.fields[index].name, decodeKeelFieldValue(GAMER.fields[index], value)]));
}

test("merkle allowlists: every proof climbs to the root with each chain's hash", () => {
  const entries = [
    { account: EVM.account, tokenId: 7, fields: ["background", "mood"] },
    { account: "0x0000000000000000000000000000000000000b0b", fields: ["glow"] },
    { account: "0x0000000000000000000000000000000000000c0c", tokenId: 2, fields: ["level"] },
  ];
  const evm = buildKeelFieldMerkleTree({ family: "evm", schema: GAMER, registry: EVM.registry, collection: EVM.collection, ruleId: 3, chainId: EVM.chainId, entries });
  for (const leaf of evm.leaves) {
    let node = leaf.leaf;
    for (const sibling of leaf.proof) node = keccak256(`0x${[node, sibling].sort().map((h) => h.slice(2)).join("")}`);
    assert.equal(node, evm.root);
  }
  const tez = buildKeelFieldMerkleTree({ family: "tezos", schema: GAMER, registry: TEZ.registry, collection: TEZ.collection, ruleId: 3, network: TEZ.network, entries: [{ account: TEZ.account, tokenId: 7, fields: ["background", "mood", "nickname"] }, { account: TEZ.account, fields: ["background"] }] });
  assert.deepEqual(tez.leaves.map((l) => l.leaf), TEZ.merkleLeaves.map((l) => l.leaf).slice(0, 1).concat(keelFieldTezosMerkleLeaf({ network: TEZ.network, registry: TEZ.registry, collection: TEZ.collection, ruleId: 3, account: TEZ.account, tokenId: null, fieldMask: 1n })));
  const [a, b] = tez.leaves.map((l) => l.leaf).sort();
  assert.equal(tez.root, sha256(`0x${a.slice(2)}${b.slice(2)}`));
});

test("EVM prepares decode to the registry ABI and never sign or submit", () => {
  const base = { family: "evm", registry: EVM.registry, collection: EVM.collection };
  const schema = prepareKeelFieldSchema({
    ...base, schema: VECTORS.definitions.gamer, claim: true, validators: [],
    rules: [
      { ruleId: 0, fields: GAMER.fields.map((f) => f.name), atoms: [{ kind: "creator" }] },
      { ruleId: 1, fields: ["background", "mood"], atoms: [{ kind: "token-owner" }, { kind: "signed", issuer: EVM.account }] },
    ],
    notify: true,
  });
  assert.equal(schema.status, "review-only");
  assert.equal(schema.signing, "not-performed");
  const names = schema.calls.map((c) => decodeFunctionData({ abi: KEEL_FIELD_REGISTRY_EVM_ABI, data: c.data }).functionName);
  assert.deepEqual(names, ["claimSpace", "setSchema", "setValidators", "setRule", "setRule", "setNotify"]);
  const rule = decodeFunctionData({ abi: KEEL_FIELD_REGISTRY_EVM_ABI, data: schema.calls[4].data });
  assert.deepEqual(rule.args.slice(1, 4), [1, 3n, [5, 4]]);
  assert.equal(rule.args[4][1], `0x${EVM.account.slice(2).padStart(64, "0")}`);
  assert.throws(() => prepareKeelFieldSchema({ ...base, schema: VECTORS.definitions.gamer, metadataPatch: true }), /Tezos-only/u);

  const edit = prepareKeelFieldEdit({
    ...base, schema: GAMER, tokenId: 7, ruleId: 1, values: { background: "#ff0000", mood: "sleepy" },
    witnesses: { 1: { kind: "signed", grantFields: ["background", "mood"], nonce: 9, deadline: 2_000_000_000, bindValues: true, signature: "0x1234" } },
  });
  const decoded = decodeFunctionData({ abi: KEEL_FIELD_REGISTRY_EVM_ABI, data: edit.calls[0].data });
  assert.equal(decoded.functionName, "edit");
  assert.equal(decoded.args[3], 3n);
  assert.equal(decoded.args[4], VECTORS.valueCases[0].values);
  assert.equal(decoded.args[5][0], "0x");
  const [grantMask, nonce, , bind] = decodeAbiParameters([{ type: "uint64" }, { type: "uint256" }, { type: "uint64" }, { type: "bool" }, { type: "bytes" }], decoded.args[5][1]);
  assert.deepEqual([grantMask, nonce, bind], [3n, 9n, true]);
  assert.throws(() => prepareKeelFieldEdit({ ...base, schema: GAMER, tokenId: 7, ruleId: 1, values: { mood: "angry" } }), /OPTION/u);
  assert.throws(() => prepareKeelFieldEdit({ ...base, schema: GAMER, tokenId: 7, ruleId: 16, values: { glow: true } }), /out of range/u);

  const merkle = prepareKeelFieldGrant({ ...base, schema: GAMER, grant: "merkle", ruleId: 3, chainId: EVM.chainId, fields: ["glow"], entries: [{ account: EVM.account, fields: ["glow"] }] });
  assert.equal(merkle.root, merkle.proofs[0].leaf);
  const revoke = prepareKeelFieldRevoke({ ...base, revoke: "nonces", issuer: EVM.account, nonces: [42] });
  assert.equal(decodeFunctionData({ abi: KEEL_FIELD_REGISTRY_EVM_ABI, data: revoke.calls[0].data }).functionName, "cancelGrantNonces");
  const freeze = prepareKeelFieldFreeze({ ...base, schema: GAMER, freeze: "token", tokenId: 7, fields: ["background"] });
  assert.deepEqual(decodeFunctionData({ abi: KEEL_FIELD_REGISTRY_EVM_ABI, data: freeze.calls[0].data }).args.slice(1), [7n, 1n]);
  assert.equal(freeze.irreversible, true);
});

test("Tezos prepares emit the registry's Micheline layout", () => {
  const base = { family: "tezos", registry: TEZ.registry, collection: TEZ.collection };
  const schema = prepareKeelFieldSchema({
    ...base, schema: GAMER, claim: true, metadataPatch: true,
    rules: [{ ruleId: 2, fields: ["mood"], atoms: [{ kind: "account", account: TEZ.account }, { kind: "pointer-owner" }], tokenId: 4 }],
  });
  assert.deepEqual(schema.operations.map((o) => o.parameters.entrypoint), ["claim_space", "set_schema", "set_rule", "set_metadata_patch"]);
  assert.deepEqual(schema.operations[1].parameters.value, { prim: "Pair", args: [{ string: TEZ.collection }, { bytes: VECTORS.schemas.gamer.slice(2) }] });
  const rule = schema.operations[2].parameters.value;
  // (collection, (rule_id, (field_mask, (atoms, token_filter))))
  const atoms = rule.args[1].args[1].args[1].args[0];
  assert.deepEqual(atoms[0], { prim: "Right", args: [{ prim: "Left", args: [{ string: TEZ.account }] }] });
  let pointer = atoms[1];
  for (let i = 0; i < 6; i += 1) { assert.equal(pointer.prim, "Right"); pointer = pointer.args[0]; }
  assert.deepEqual(pointer, { prim: "Unit" });
  assert.deepEqual(rule.args[1].args[1].args[1].args[1], { prim: "Some", args: [{ int: "4" }] });
  assert.throws(() => prepareKeelFieldSchema({ ...base, schema: GAMER, notify: true }), /EVM-only/u);

  const edit = prepareKeelFieldEdit({
    ...base, schema: GAMER, tokenId: 7, ruleId: 3, values: { glow: true },
    witnesses: { 0: { kind: "merkle", leafToken: null, leafFields: ["glow"], proof: [TEZ.merkleLeaves[0].leaf] } },
  });
  const op = edit.operations[0];
  assert.equal(op.parameters.entrypoint, "edit");
  assert.equal(op.amount, "0");
  const witnesses = op.parameters.value.args[1].args[1].args[1].args[1].args[1];
  assert.equal(witnesses[0].prim, "Elt");
  assert.equal(witnesses[0].args[1].prim, "Left");
  assert.deepEqual(witnesses[0].args[1].args[0].args[0], { prim: "None" });

  const grant = prepareKeelFieldGrant({ ...base, schema: GAMER, grant: "signature", network: TEZ.network, ruleId: 6, tokenId: 7, editor: TEZ.account, fields: ["glow"], nonce: 42, deadline: 2_000_000_000 });
  assert.equal(grant.payload, TEZ.grants[0].payload);
  const pointer2 = prepareKeelFieldGrant({ ...base, schema: GAMER, grant: "pointer", tokenId: 1, target: TEZ.collection, targetTokenId: 9 });
  assert.equal(pointer2.ownership, "FA2 get_balance view");
  assert.throws(() => prepareKeelFieldRevoke({ ...base, revoke: "nonces", issuer: TEZ.collection, nonces: [1] }), /key hash/u);
  assert.equal(prepareKeelFieldFreeze({ ...base, freeze: "pause" }).operations[0].parameters.entrypoint, "set_paused");
  assert.throws(() => prepareKeelFieldEdit({ ...base, family: "solana", schema: GAMER, tokenId: 1, ruleId: 0, values: { glow: true } }), /family/u);
});

test("the form descriptor follows the schema, the granted mask and freezes", () => {
  const form = keelFieldForm(GAMER, { editableMask: keelFieldMask(GAMER, ["background", "mood", "level"]), frozenMask: keelFieldMask(GAMER, ["level"]) });
  assert.equal(form.fields.length, 9);
  const [background, mood, level, nickname] = form.fields;
  assert.deepEqual([background.widget, background.label, background.editable, background.default], ["color", "Background", true, "#101820"]);
  assert.deepEqual(mood.options.map((o) => o.selectable), [true, false, true]);
  assert.deepEqual([level.frozen, level.editable, level.min, level.max], [true, false, "1", "99"]);
  assert.deepEqual([nickname.editable, nickname.maxLength, nickname.charset], [false, 24, ["lower", "upper", "digit", "space"]]);
  assert.equal(form.fields.find((f) => f.name === "offset").step, "5");
});
