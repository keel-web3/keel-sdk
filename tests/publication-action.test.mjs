import assert from "node:assert/strict";
import test from "node:test";
import { advanceKeelPublicationAction, createKeelPublicationActionFlight } from "../packages/sdk/dist/publication-action.js";

const identity = { identity: "creator:retro:r2:release-r7:sepolia:original-output", actionId: "publish:retro:r7" };
const unsigned = { from: "0x1111111111111111111111111111111111111111", to: "0x2222222222222222222222222222222222222222", value: "0", data: "0x1234", gas: "27000", nonce: "9" };
function fixture(steps, options = {}) {
  let cursor = 0, approved = false;
  const effects = [], events = [];
  const adapter = {
    identity,
    inspect: async () => {
      events.push("read");
      if (approved) return { ...identity, status: "wallet-approval-required", value: unsigned };
      return { ...identity, status: "advance", step: steps[cursor], checkpoint: `${cursor}:canonical-progress` };
    },
    advance: async step => { effects.push(step); events.push(step); cursor++; if (cursor === steps.length) approved = true; if (options.lostResponse && approved) throw new Error("lost response after saved preparation"); },
    pending: async () => ({ saved: true, fundingRepeated: false }),
    validateApproval: value => { events.push("validate-real-unsigned"); assert.deepEqual(value, unsigned); },
    recoverable: error => /lost response/.test(error.message),
  };
  return { adapter, effects, events };
}
for (const [name, steps] of [
  ["fresh valid publication", ["prepare-transaction"]],
  ["resources-only references and expired unknown issuance", ["reconcile", "renew-review", "prepare-transaction"]],
  ["incomplete paid uploads", ["reconcile", "resume-storage", "prepare-transaction"]],
  ["recoverable journal drift", ["reconcile", "repair-journal", "resume-storage", "prepare-transaction"]],
  ["canonical full funding revert", ["reconcile", "repair-journal", "prepare-transaction"]],
  ["confirmed partial storage and next operation", ["reconcile", "resume-storage", "confirm-publication", "prepare-transaction"]],
]) test(`one action reaches the validated unsigned request after ${name}`, async () => {
  const f = fixture(steps), result = await advanceKeelPublicationAction(f.adapter);
  assert.equal(result.status, "wallet-approval-required"); assert.deepEqual(f.effects, steps);
  for (const step of steps) { const at = f.events.indexOf(step); assert.equal(f.events[at + 1], "read"); }
  assert.equal(f.events.at(-1), "validate-real-unsigned");
});
test("lost response after committed preparation reads the same operation and never prepares again", async () => {
  const f = fixture(["reconcile", "prepare-transaction"], { lostResponse: true });
  assert.equal((await advanceKeelPublicationAction(f.adapter)).status, "wallet-approval-required");
  assert.deepEqual(f.effects, ["reconcile", "prepare-transaction"]);
});
test("a pending replacement is reconciled rather than funding or preparing another request", async () => {
  const f = fixture(["reconcile"]);
  let reads = 0;
  f.adapter.inspect = async () => ++reads === 1 ? { ...identity, status: "advance", step: "reconcile", checkpoint: "nonce9:hashA,hashB" }
    : { ...identity, status: "pending", value: { hashes: ["hashA", "hashB"], nonce: 9, paidStorage: "retained" }, retryAfterMs: 1500 };
  assert.equal((await advanceKeelPublicationAction(f.adapter)).status, "pending");
  assert.deepEqual(f.effects, ["reconcile"]);
});
test("an uncertain unchanged checkpoint stays resumable and does not replay its effect", async () => {
  const f = fixture(["prepare-transaction"]);
  f.adapter.inspect = async () => ({ ...identity, status: "advance", step: "prepare-transaction", checkpoint: "original-operation" });
  f.adapter.advance = async step => { f.effects.push(step); throw new Error("lost response"); };
  assert.equal((await advanceKeelPublicationAction(f.adapter)).status, "pending");
  assert.equal(f.effects.length, 1);
});
test("a changed owner/project/output identity stops before another effect or wallet request", async () => {
  const f = fixture(["reconcile", "prepare-transaction"]);
  const original = f.adapter.inspect;
  f.adapter.inspect = async () => { const state = await original(); return f.effects.length ? { ...state, identity: "different-artwork" } : state; };
  await assert.rejects(advanceKeelPublicationAction(f.adapter), /identity changed/);
  assert.deepEqual(f.effects, ["reconcile"]);
});
for (const prerequisite of ["authentication", "owner-wallet", "selected-chain", "wallet-capability", "changed-output", "chain-capacity", "canonical-history", "configuration", "integrity"]) test(`a real ${prerequisite} prerequisite stays in the action and cannot fabricate a transaction`, async () => {
  const f = fixture([]);
  f.adapter.inspect = async () => ({ ...identity, status: "prerequisite-required", prerequisite, value: { message: prerequisite, inPlace: true } });
  const result = await advanceKeelPublicationAction(f.adapter);
  assert.equal(result.status, "prerequisite-required"); assert.deepEqual(f.effects, []); assert.ok(!f.events.includes("validate-real-unsigned"));
});
test("duplicate clicks and concurrent agent requests share one action until its durable result", async () => {
  const flight = createKeelPublicationActionFlight(); let effects = 0, release;
  const held = new Promise(resolve => { release = resolve; });
  const operation = async () => { effects++; await held; return unsigned; };
  const calls = Array.from({ length: 24 }, () => flight(identity.actionId, operation));
  await Promise.resolve(); assert.equal(effects, 1); release();
  assert.deepEqual(await Promise.all(calls), Array.from({ length: 24 }, () => unsigned));
  assert.deepEqual(await flight(identity.actionId, async () => ({ refreshed: true })), { refreshed: true });
});
