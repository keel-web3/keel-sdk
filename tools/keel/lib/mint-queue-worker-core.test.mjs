import test from "node:test";
import assert from "node:assert/strict";

import {collectQueuePage, deliverTurnNotification, notificationDecision, resolveTurnBinding, safeUintNumber} from "./mint-queue-worker-core.mjs";

const notice = Object.freeze({
  key: "31337:0x0000000000000000000000000000000000000001:7",
  chainId: 31337,
  queue: "0x0000000000000000000000000000000000000001",
  account: "0x0000000000000000000000000000000000000002",
  ticketId: "7",
  deadline: 2_000,
  quantity: 5,
});

function readyState(overrides = {}) {
  return {
    allowance: 5n,
    ticketId: 7n,
    enabled: true,
    currentState: 2,
    currentDeadline: 2_000n,
    currentRemaining: 5n,
    ...overrides,
  };
}

test("normalizes ABI adapter number and bigint values with safe-range boundaries", () => {
  assert.equal(safeUintNumber(0n, "value"), 0);
  assert.equal(safeUintNumber(2n ** 32n - 1n, "value"), 4_294_967_295);
  assert.equal(safeUintNumber(2n ** 48n - 1n, "value"), 281_474_976_710_655);
  assert.throws(() => safeUintNumber(2n ** 53n, "value"), /safe integer range/);
  assert.throws(() => safeUintNumber(-1n, "value"), /safe integer range/);
});

test("accepts number or bigint allowance and remaining values", async () => {
  const sent = {};
  const calls = [];
  const result = await deliverTurnNotification({
    notice,
    now: 1_000,
    sent,
    readState: async () => readyState({allowance: 3n, currentRemaining: 3n}),
    send: async (request) => calls.push(request),
  });
  assert.deepEqual(result, {done: true, status: "sent", delivered: true});
  assert.equal(calls.length, 1);
  assert.equal(calls[0].key, notice.key);
  assert.equal(calls[0].payload.quantity, 3);
  assert.equal(sent[notice.key], true);
});

test("zero allowance suppresses delivery without contacting a provider", async () => {
  const sent = {};
  let calls = 0;
  const result = await deliverTurnNotification({
    notice,
    now: 1_000,
    sent,
    readState: async () => readyState({allowance: 0n, currentRemaining: 0n}),
    send: async () => { calls += 1; },
  });
  assert.deepEqual(result, {done: true, status: "stale", delivered: false});
  assert.equal(calls, 0);
  assert.equal(sent[notice.key], undefined);
});

test("provider failure leaves the outbox unsent so the next tick retries", async () => {
  const sent = {};
  let fail = true;
  let calls = 0;
  const input = {
    notice,
    now: 1_000,
    sent,
    readState: async () => readyState(),
    send: async ({key}) => {
      calls += 1;
      assert.equal(key, notice.key);
      if (fail) throw new Error("provider unavailable");
    },
  };
  await assert.rejects(() => deliverTurnNotification(input), /provider unavailable/);
  assert.equal(sent[notice.key], undefined);
  fail = false;
  assert.deepEqual(await deliverTurnNotification(input), {done: true, status: "sent", delivered: true});
  assert.equal(calls, 2);
  assert.equal(sent[notice.key], true);
});

test("a sent idempotency key is not delivered twice", async () => {
  const sent = {};
  let reads = 0;
  let calls = 0;
  const input = {
    notice,
    now: 1_000,
    sent,
    readState: async () => { reads += 1; return readyState(); },
    send: async () => { calls += 1; },
  };
  await deliverTurnNotification(input);
  assert.deepEqual(await deliverTurnNotification(input), {done: true, status: "sent", delivered: false});
  assert.equal(calls, 1);
  assert.equal(reads, 1);
});

test("expired and mismatched tickets are terminal without delivery", () => {
  assert.deepEqual(notificationDecision(notice, 2_000, readyState()), {done: true, status: "expired"});
  assert.deepEqual(notificationDecision(notice, 1_000, readyState({ticketId: 8n})), {done: true, status: "stale"});
  assert.deepEqual(notificationDecision(notice, 1_000, readyState({currentState: 1})), {done: true, status: "stale"});
});



test("pins the page end hash and commits a durable page after a stable scan", async () => {
  const journal = {
    cursor: null,
    hash: null,
    tasks: {},
    sent: {"already-sent": true},
  };
  const blockReads = [];
  const events = [{kind: "notice"}];
  const result = await collectQueuePage({
    journal,
    head: 10n,
    initialFrom: 1n,
    pageSize: 10n,
    getBlock: async (number) => {
      blockReads.push(number);
      return {hash: "0xaaa"};
    },
    getEvents: async (from, to) => {
      assert.equal(from, 1n);
      assert.equal(to, 10n);
      return events;
    },
    buildTask: async (event, page) => {
      assert.equal(event, events[0]);
      assert.equal(page.block.hash, "0xaaa");
      return ["notice-key", {kind: "notice", source: "canonical-page"}];
    },
  });
  assert.equal(result.advanced, true);
  assert.deepEqual(blockReads, [10n, 10n, 10n]);
  assert.equal(journal.cursor, "10");
  assert.equal(journal.hash, "0xaaa");
  assert.deepEqual(journal.tasks, {
    "notice-key": {kind: "notice", source: "canonical-page"},
  });
  assert.deepEqual(journal.sent, {"already-sent": true});
});

test("does not enqueue orphan events or advance the journal when the page changes during getLogs", async () => {
  const journal = {
    cursor: "5",
    hash: "0xprior",
    tasks: {"old-task": {kind: "notice"}},
    sent: {"already-sent": true},
  };
  const before = JSON.parse(JSON.stringify(journal));
  let builds = 0;
  let endReads = 0;
  await assert.rejects(() => collectQueuePage({
    journal,
    head: 10n,
    pageSize: 10n,
    getBlock: async (number) => {
      if (number === 5n) return {hash: "0xprior"};
      assert.equal(number, 10n);
      endReads += 1;
      return {hash: endReads === 1 ? "0xaaa" : "0xbbb"};
    },
    getEvents: async () => [{kind: "orphan"}],
    buildTask: async () => {
      builds += 1;
      return ["orphan-key", {kind: "notice"}];
    },
  }), /changed during scan/);
  assert.equal(builds, 0);
  assert.deepEqual(journal, before);
  assert.equal(journal.sent["already-sent"], true);
});

test("failed log reads do not advance the cursor or discard sent keys", async () => {
  const journal = {
    cursor: null,
    hash: null,
    tasks: {},
    sent: {"already-sent": true},
  };
  const before = JSON.parse(JSON.stringify(journal));
  await assert.rejects(() => collectQueuePage({
    journal,
    head: 10n,
    initialFrom: 1n,
    pageSize: 10n,
    getBlock: async () => ({hash: "0xaaa"}),
    getEvents: async () => {
      throw new Error("provider unavailable");
    },
    buildTask: async () => ["never", {kind: "notice"}],
  }), /provider unavailable/);
  assert.deepEqual(journal, before);
});

test("replays from a changed cursor after restart while preserving sent keys", async () => {
  const first = {
    cursor: null,
    hash: null,
    tasks: {},
    sent: {"already-sent": true},
  };
  await collectQueuePage({
    journal: first,
    head: 10n,
    initialFrom: 1n,
    pageSize: 10n,
    getBlock: async () => ({hash: "0xaaa"}),
    getEvents: async () => [],
    buildTask: async () => null,
  });
  const restarted = JSON.parse(JSON.stringify(first));
  restarted.tasks = {"orphan-from-old-canonical-page": {kind: "notice"}};
  const blockReads = [];
  const result = await collectQueuePage({
    journal: restarted,
    head: 10n,
    initialFrom: 1n,
    pageSize: 10n,
    getBlock: async (number) => {
      assert.equal(number, 10n);
      blockReads.push(number);
      return {hash: "0xreorged"};
    },
    getEvents: async () => [{kind: "replacement"}],
    buildTask: async () => ["replacement-task", {kind: "notice", source: "replayed"}],
  });
  assert.equal(result.reset, true);
  assert.deepEqual(blockReads, [10n, 10n, 10n, 10n]);
  assert.equal(restarted.cursor, "10");
  assert.equal(restarted.hash, "0xreorged");
  assert.deepEqual(restarted.tasks, {
    "replacement-task": {kind: "notice", source: "replayed"},
  });
  assert.deepEqual(restarted.sent, {"already-sent": true});
});

test("compact turns resolve only their preceding canonical registration",async()=>{
  const event={eventName:'TurnReady',address:notice.queue,blockNumber:50n,logIndex:3,args:{account:'0x0000000000000000000000000000000000000000',ticketId:7n,deadline:2000,quantity:0}};
  const joined={address:notice.queue,blockNumber:20n,logIndex:1,args:{account:notice.account,ticketId:7n,quantity:5,cohort:0n}};
  const resolve=getJoined=>resolveTurnBinding({event,chainId:31337,queue:notice.queue,getJoined});
  const binding=await resolve(async(id,to)=>{assert.equal(id,7n);assert.equal(to,50n);return [joined];});
  assert.equal(binding.ticket.account,notice.account);assert.equal(binding.ticket.remaining,5);
  await assert.rejects(resolve(async()=>[]),/canonical Joined/);
  await assert.rejects(resolve(async()=>[joined,joined]),/canonical Joined/);
  await assert.rejects(resolve(async()=>[{...joined,removed:true}]),/canonical Joined/);
  await assert.rejects(resolve(async()=>[{...joined,blockNumber:51n}]),/canonical Joined/);
  await assert.rejects(resolve(async()=>[{...joined,address:notice.account}]),/canonical Joined/);
  assert.equal(await resolveTurnBinding({event:{...event,args:{...event.args,account:notice.account}},chainId:31337,queue:notice.queue,getJoined:async()=>{throw Error('must not read');}}),undefined);
});

test("a reorg during registration binding cannot commit notification tasks",async()=>{
  let fork=false;
  const journal={cursor:null,hash:null,tasks:{},sent:{}};
  await assert.rejects(collectQueuePage({journal,head:1n,getBlock:async()=>({hash:fork?'new':'old'}),getEvents:async()=>[{}],buildTask:async()=>{fork=true;return ['turn',{kind:'notice'}];}}),/changed during task binding/);
  assert.equal(journal.cursor,null);assert.deepEqual(journal.tasks,{});
});
