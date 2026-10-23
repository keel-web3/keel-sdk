// keel-qa-receipt-activation-20261020/keel-site/docs/tools/gif-fresh-forward-capture/diagnostic-signer-context.test.ts
import test from "node:test";
import assert from "node:assert/strict";

// keel-qa-gif-reviewed14-20261020/candidate-400/apps/studio/src/server/security/credential-policy.ts
import { AsyncLocalStorage } from "node:async_hooks";
import { getAddress } from "viem";
var policy = new AsyncLocalStorage();
function withReadOnlyCredentials(operation) {
  return policy.run(Object.freeze({ ...policy.getStore(), readOnly: true }), operation);
}
function withDiagnosticPublicationSigner(input, operation) {
  const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;
  if (!uuid.test(input.creatorId) || !uuid.test(input.releaseId) || !Number.isSafeInteger(input.releaseRevision) || input.releaseRevision < 1 || !/^[0-9a-f]{64}$/u.test(input.evidenceSha256)) throw new Error("Invalid diagnostic public signer evidence.");
  if (policy.getStore()?.diagnosticSigner) throw new Error("Diagnostic public signer scope cannot be replaced.");
  const diagnosticSigner = Object.freeze({ ...input, address: getAddress(input.address) });
  return policy.run(Object.freeze({ readOnly: true, diagnosticSigner }), operation);
}
function credentialWritesAllowed() {
  return policy.getStore() === void 0;
}
function assertCredentialWritesAllowed() {
  if (!credentialWritesAllowed()) throw new Error("Credential creation or mutation is unavailable during read-only publication diagnostics.");
}
function assertCredentialSigningAllowed() {
  if (policy.getStore()) throw new Error("Signing accounts are unavailable during read-only publication diagnostics.");
}
function assertStageSignerKeyReadAllowed() {
  if (policy.getStore()?.diagnosticSigner) throw new Error("A scoped public diagnostic identity cannot read or derive a local stage signer credential.");
}
function publicationStageSignerAddress(scope, diagnosticOnly, readExisting) {
  const signer = policy.getStore()?.diagnosticSigner;
  if (signer === void 0) return readExisting();
  if (!diagnosticOnly || signer.creatorId !== scope.creatorId || signer.releaseId !== scope.releaseId || signer.releaseRevision !== scope.releaseRevision) throw new Error("Diagnostic public signer does not authorize this publication scope or wallet preparation.");
  return signer.address;
}

// keel-qa-receipt-activation-20261020/keel-site/docs/tools/gif-fresh-forward-capture/public-signer-receipt.mjs
import { open, constants } from "node:fs/promises";

// keel-qa-receipt-activation-20261020/keel-site/docs/tools/gif-fresh-forward-capture/identity.mjs
import { createHash } from "node:crypto";
var sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

// keel-qa-receipt-activation-20261020/keel-site/docs/tools/gif-fresh-forward-capture/public-signer-receipt.mjs
var PUBLIC_SIGNER_RECEIPT = Object.freeze({ path: "/tmp/keel-native-startup-lead-20261019/production-public-stage-signer-v4.json", bytes: 484, sha256: "7507d902728f7d62783c32dcd54429ac4b0719be1607b88860cfb7374c305f59" });
var PUBLIC_SIGNER_ADDRESS_SHA256 = "f451bbc9bb40e2a7f94ae974ba768fc903961f49eeb1488c6af0ef3eb8e914fe";
var DIAGNOSTIC_SIGNER_SCOPE = Object.freeze({ creatorId: "ac001c30-ad5e-465a-b784-854be440f0be", releaseId: "0c6c734d-20c0-4d3a-959a-fb7ac8143af2", releaseRevision: 14 });
var exactKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
var refused = () => {
  throw Error("Exact existing production public-only signer receipt required");
};
function validatePublicSignerReceipt(value) {
  const p = value?.publicIdentity;
  if (!exactKeys(value, ["container", "image", "publicIdentity"]) || value.container !== "b6ff8c7a6f5c2282e29883de917f2d376a8e92efffecc45d115338e0516a5201" || value.image !== "sha256:a53c65ac2aee00217f206f07f4ddecbf9d55b5a43f60bf87858d9756259ba730" || !exactKeys(p, ["schema", "address", "origin", "node", "uid", "credentialCreated", "credentialExported", "signing", "submission", "rpcRequests"]) || p.schema !== "keel-existing-stage-signer-public@1" || p.origin !== "existing-private-credential-file" || p.node !== "v22.23.1" || p.uid !== 999 || p.credentialCreated !== false || p.credentialExported !== false || p.signing !== false || p.submission !== false || p.rpcRequests !== 0 || typeof p.address !== "string" || !/^0x[\da-f]{40}$/iu.test(p.address) || sha(p.address.toLowerCase()) !== PUBLIC_SIGNER_ADDRESS_SHA256) refused();
  return Object.freeze({ address: p.address, evidenceSha256: PUBLIC_SIGNER_RECEIPT.sha256, addressSha256: PUBLIC_SIGNER_ADDRESS_SHA256, ...DIAGNOSTIC_SIGNER_SCOPE });
}
function parsePublicSignerReceipt(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== PUBLIC_SIGNER_RECEIPT.bytes || sha(bytes) !== PUBLIC_SIGNER_RECEIPT.sha256) refused();
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    refused();
  }
  return validatePublicSignerReceipt(value);
}
async function loadPublicSignerReceipt(record) {
  if (!exactKeys(record, ["path", "bytes", "sha256"]) || Object.keys(PUBLIC_SIGNER_RECEIPT).some((key) => record[key] !== PUBLIC_SIGNER_RECEIPT[key])) refused();
  const handle = await open(PUBLIC_SIGNER_RECEIPT.path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size !== PUBLIC_SIGNER_RECEIPT.bytes) refused();
    const bytes = Buffer.alloc(PUBLIC_SIGNER_RECEIPT.bytes + 1), { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    const raw = bytes.subarray(0, bytesRead), identity = parsePublicSignerReceipt(raw);
    return { bytes: raw, identity };
  } finally {
    await handle.close();
  }
}

// keel-qa-receipt-activation-20261020/keel-site/docs/tools/gif-fresh-forward-capture/diagnostic-signer-context.ts
function withGifDiagnosticSigner(receiptBytes, operation) {
  const identity = parsePublicSignerReceipt(receiptBytes);
  return withDiagnosticPublicationSigner({
    ...DIAGNOSTIC_SIGNER_SCOPE,
    address: identity.address,
    evidenceSha256: PUBLIC_SIGNER_RECEIPT.sha256
  }, operation);
}

// keel-qa-receipt-activation-20261020/keel-site/docs/tools/gif-fresh-forward-capture/diagnostic-signer-context.test.ts
test("real production async context exposes only exact public identity and rejects keys/signing/writes/scope drift", async () => {
  const receipt = await loadPublicSignerReceipt(PUBLIC_SIGNER_RECEIPT);
  let keyFallbacks = 0;
  assert.equal(credentialWritesAllowed(), true);
  await withGifDiagnosticSigner(receipt.bytes, async () => {
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(credentialWritesAllowed(), false);
    for (const denied of [assertCredentialWritesAllowed, assertCredentialSigningAllowed, assertStageSignerKeyReadAllowed]) assert.throws(denied);
    const read = () => {
      keyFallbacks++;
      throw Error("must not read any local credential");
    };
    assert.equal(publicationStageSignerAddress(DIAGNOSTIC_SIGNER_SCOPE, true, read), receipt.identity.address);
    for (const changed of [{ ...DIAGNOSTIC_SIGNER_SCOPE, creatorId: "00000000-0000-0000-0000-000000000001" }, { ...DIAGNOSTIC_SIGNER_SCOPE, releaseId: "00000000-0000-0000-0000-000000000002" }, { ...DIAGNOSTIC_SIGNER_SCOPE, releaseRevision: 4 }]) assert.throws(() => publicationStageSignerAddress(changed, true, read));
    assert.throws(() => publicationStageSignerAddress(DIAGNOSTIC_SIGNER_SCOPE, false, read));
    withReadOnlyCredentials(() => assert.equal(publicationStageSignerAddress(DIAGNOSTIC_SIGNER_SCOPE, true, read), receipt.identity.address));
    assert.throws(() => withDiagnosticPublicationSigner({ ...DIAGNOSTIC_SIGNER_SCOPE, address: receipt.identity.address, evidenceSha256: PUBLIC_SIGNER_RECEIPT.sha256 }, () => {
    }));
  });
  assert.equal(keyFallbacks, 0);
  assert.equal(credentialWritesAllowed(), true);
});
test("invalid receipt cannot enter diagnostic context or invoke its operation", () => {
  let invoked = false;
  assert.throws(() => withGifDiagnosticSigner(new Uint8Array(484), () => {
    invoked = true;
  }));
  assert.equal(invoked, false);
  assert.equal(credentialWritesAllowed(), true);
});
