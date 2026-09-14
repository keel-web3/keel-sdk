
import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeMintQueueSnapshot,
  estimateMintQueue,
  enqueueMintTurn,
  mintQueuePosition,
  mintTurnNotice,
  projectMintQueue,
} from "../packages/sdk/dist/mint-queue.js";

const queue = "0x0000000000000000000000000000000000000001";
const account = "0x0000000000000000000000000000000000000002";
const priorityAccount = "0x0000000000000000000000000000000000000003";
const event = (name, id, more = {}) => ({
  chainId: 31337,
  queue,
  transactionHash: "0x" + id,
  logIndex: id,
  blockNumber: 1n,
  name,
  account,
  ticketId: BigInt(id),
  ...more,
});

test("canonical event replay tracks FIFO position and removes consumed/expired turns", () => {
  const joined = event("Joined", 1, { cohort: 0n, quantity: 5 });
  const next = event("Joined", 2, { cohort: 0n, quantity: 1, account: queue });
  const tickets = projectMintQueue(
    [joined, joined, next, event("TurnReady", 3, { ticketId: 1n, quantity: 5, deadline: 1600 }), event("TurnClosed", 4, { ticketId: 1n })],
    31337,
    queue,
  );
  assert.equal(tickets.size, 2);
  assert.equal(mintQueuePosition(tickets, queue, false).position, 1);
  assert.equal(mintQueuePosition(tickets, queue, true).position, null);
  assert.equal(tickets.get(1n)?.state, "closed");
});

test("notifications require opt-in, use stable dedup keys and ignore expired turns", async () => {
  const notices = [];
  let subscribed = false;
  const sink = { isSubscribed: async () => subscribed, enqueue: async (notice) => notices.push(notice) };
  const ready = event("TurnReady", 1, { quantity: 5, deadline: 1600 });
  assert.equal(await enqueueMintTurn(ready, 1000, sink), false);
  subscribed = true;
  assert.equal(await enqueueMintTurn(ready, 1000, sink), true);
  assert.equal(await enqueueMintTurn(ready, 1600, sink), false);
  assert.equal(notices[0].key, "31337:" + queue + ":1:" + account + ":1600");
  assert.equal(notices[0].account, account);
});

test("admin replacement closes legacy waiting tickets without a closure event", () => {
  const rows = projectMintQueue(
    [event("Joined", 1, { cohort: 0n, quantity: 5 }), event("TurnReady", 2, { quantity: 2, deadline: 2000 })],
    31337,
    queue,
  );
  assert.equal(rows.get(1n)?.state, "closed");
  assert.equal(rows.get(1n)?.remaining, 0);
  assert.equal(rows.get(2n)?.state, "ready");
  assert.equal(mintQueuePosition(rows, account, false).waiting, 0);
});

test("priority metadata survives emit-before-Joined order, duplicate logs, admission without account, and closure", () => {
  const priority = event("PriorityJoined", 10, {
    account: priorityAccount,
    ticketId: 7n,
    weight: 4n,
    finish: 99n,
    logIndex: 0,
  });
  const joined = event("Joined", 11, {
    account: priorityAccount,
    ticketId: 7n,
    cohort: 0n,
    quantity: 3,
    logIndex: 1,
  });
  const admitted = event("PriorityAdmitted", 12, {
    account: undefined,
    ticketId: 7n,
    logIndex: 2,
  });
  const closed = event("TurnClosed", 13, {
    account: undefined,
    ticketId: 7n,
    logIndex: 3,
  });
  const rows = projectMintQueue([closed, admitted, priority, priority, joined, admitted], 31337, queue);
  const ticket = rows.get(7n);
  assert.equal(ticket?.account, priorityAccount);
  assert.equal(ticket?.priority, true);
  assert.equal(ticket?.priorityWeight, 4n);
  assert.equal(ticket?.priorityFinish, 99n);
  assert.equal(ticket?.priorityAdmitted, true);
  assert.equal(ticket?.state, "closed");
  assert.equal(ticket?.remaining, 0);
});

test("rebuilding after a reorg drops orphaned priority metadata and admission", () => {
  const priority = event("PriorityJoined", 20, {
    account: priorityAccount,
    ticketId: 8n,
    weight: 2n,
    finish: 11n,
    logIndex: 0,
  });
  const joined = event("Joined", 21, {
    account: priorityAccount,
    ticketId: 8n,
    cohort: 0n,
    quantity: 1,
    logIndex: 1,
  });
  const admitted = event("PriorityAdmitted", 22, {
    account: undefined,
    ticketId: 8n,
    logIndex: 2,
  });
  const canonical = projectMintQueue([priority, joined, admitted], 31337, queue);
  const rebuilt = projectMintQueue([joined], 31337, queue);
  assert.equal(canonical.get(8n)?.priority, true);
  assert.equal(canonical.get(8n)?.priorityAdmitted, true);
  assert.equal(rebuilt.get(8n)?.priority, false);
  assert.equal(rebuilt.get(8n)?.priorityAdmitted, false);
  assert.equal(rebuilt.get(8n)?.priorityWeight, null);
  assert.equal(rebuilt.get(8n)?.state, "waiting");
});

test("priority configuration returns an honest range and unknown ETA instead of FIFO rank", () => {
  const priority = event("PriorityJoined", 30, {
    account: priorityAccount,
    ticketId: 9n,
    weight: 3n,
    finish: 21n,
    logIndex: 0,
  });
  const priorityJoined = event("Joined", 31, {
    account: priorityAccount,
    ticketId: 9n,
    cohort: 0n,
    quantity: 1,
    logIndex: 1,
  });
  const normalJoined = event("Joined", 32, { ticketId: 10n, cohort: 0n, quantity: 1, logIndex: 2 });
  const rows = projectMintQueue([priority, priorityJoined, normalJoined], 31337, queue);
  const timing = {
    chainTime: 1100,
    openedAt: 1000,
    cohortSeconds: 60,
    meanServiceSeconds: 30,
    activeSlots: 1,
    priorityBps: 2000,
  };
  const estimate = estimateMintQueue(rows, account, false, timing);
  assert.equal(estimate.position, null);
  assert.equal(estimate.positionStart, 1);
  assert.equal(estimate.positionEnd, 2);
  assert.equal(estimate.positionExact, false);
  assert.equal(estimate.etaSeconds, null);
  assert.equal(estimate.etaKnown, false);
  assert.equal(estimate.priority, false);
  assert.equal(estimate.priorityConfigured, true);
  assert.equal(estimate.priorityBps, 2000);
  assert.equal(estimate.estimateReason, "priority-range");
  const position = mintQueuePosition(rows, account, false);
  assert.equal(position.position, null);
  assert.equal(position.positionStart, 1);
  assert.equal(position.positionEnd, 2);
  assert.equal(position.positionExact, false);
});

test("zero priority share preserves FIFO compatibility; caller priority hint remains conservative", () => {
  const rows = projectMintQueue([event("Joined", 40, { cohort: 0n, quantity: 1 })], 31337, queue);
  const timing = { chainTime: 1100, openedAt: 1000, cohortSeconds: 60, meanServiceSeconds: 30, activeSlots: 1, priorityBps: 0 };
  const exact = estimateMintQueue(rows, account, false, timing);
  assert.equal(exact.position, 1);
  assert.equal(exact.positionExact, true);
  assert.equal(exact.estimateReason, "exact-fifo");
  const hinted = estimateMintQueue(rows, account, false, { ...timing, priority: true });
  assert.equal(hinted.position, null);
  assert.equal(hinted.positionStart, 1);
  assert.equal(hinted.positionEnd, 1);
  assert.equal(hinted.priority, true);
  assert.equal(hinted.estimateReason, "priority-range");
});


test("QueueReset closes prior generation, protects fresh same-account tickets, and fences stale metadata", () => {
  const oldPriority = event("PriorityJoined", 50, {
    account: priorityAccount,
    ticketId: 1n,
    weight: 4n,
    finish: 12n,
    logIndex: 0,
  });
  const oldJoined = event("Joined", 51, {
    account: priorityAccount,
    ticketId: 1n,
    cohort: 0n,
    quantity: 1,
    logIndex: 1,
  });
  const reset = event("QueueReset", 52, {
    account: undefined,
    ticketId: 0n,
    firstTicket: 2n,
    soldOut: false,
    logIndex: 2,
  });
  const stalePriority = event("PriorityJoined", 53, {
    account: priorityAccount,
    ticketId: 1n,
    weight: 99n,
    finish: 99n,
    logIndex: 3,
  });
  const freshJoined = event("Joined", 54, {
    account: priorityAccount,
    ticketId: 2n,
    cohort: 0n,
    quantity: 2,
    logIndex: 4,
  });
  const rows = projectMintQueue([freshJoined, stalePriority, reset, oldJoined, oldPriority, reset], 31337, queue);
  assert.equal(rows.get(1n)?.state, "closed");
  assert.equal(rows.get(1n)?.remaining, 0);
  assert.equal(rows.get(1n)?.priorityWeight, 4n);
  assert.equal(rows.get(2n)?.state, "waiting");
  assert.equal(rows.get(2n)?.priority, false);
  assert.equal(rows.get(2n)?.priorityWeight, null);
  assert.equal(rows.get(2n)?.priorityAdmitted, false);
});

test("QueueReset is reorg-safe: removing the reset restores the previous generation", () => {
  const joined = event("Joined", 60, {
    account: priorityAccount,
    ticketId: 11n,
    cohort: 0n,
    quantity: 1,
    logIndex: 0,
  });
  const reset = event("QueueReset", 61, {
    account: undefined,
    ticketId: 0n,
    firstTicket: 12n,
    soldOut: true,
    logIndex: 1,
  });
  const canonical = projectMintQueue([joined, reset], 31337, queue);
  const rebuilt = projectMintQueue([joined], 31337, queue);
  assert.equal(canonical.get(11n)?.state, "closed");
  assert.equal(canonical.get(11n)?.remaining, 0);
  assert.equal(rebuilt.get(11n)?.state, "waiting");
  assert.equal(rebuilt.get(11n)?.remaining, 1);
});

test("entry-window warmup keeps FIFO and lottery position and ETA unknown until the first period closes", () => {
  const rows = projectMintQueue(
    [event("Joined", 70, { cohort: 0n, quantity: 1 })],
    31337,
    queue,
  );
  const clock = {
    chainTime: 1149,
    openedAt: 1000,
    cohortSeconds: 150,
    meanServiceSeconds: 30,
    activeSlots: 1,
  };
  for (const lottery of [false, true]) {
    const estimate = estimateMintQueue(rows, account, lottery, clock);
    assert.equal(estimate.position, null);
    assert.equal(estimate.positionEnd, null);
    assert.equal(estimate.etaSeconds, null);
    assert.equal(estimate.etaEndSeconds, null);
    assert.equal(estimate.positionExact, false);
    assert.equal(estimate.estimateReason, "entry-window-open");
  }
  const afterWindow = estimateMintQueue(rows, account, false, { ...clock, chainTime: 1150 });
  assert.equal(afterWindow.position, 1);
  assert.equal(afterWindow.estimateReason, "exact-fifo");
});


test("shared-pool FIFO ETA ignores legacy cohort IDs", () => {
  const rows = projectMintQueue(
    [event("Joined", 80, { cohort: 101n, quantity: 1 })],
    31337,
    queue,
  );
  const estimate = estimateMintQueue(rows, account, false, {
    chainTime: 1150,
    openedAt: 1000,
    cohortSeconds: 150,
    cohortBase: 100,
    meanServiceSeconds: 30,
    activeSlots: 1,
  });
  assert.equal(estimate.position, 1);
  assert.equal(estimate.etaSeconds, 0);
  assert.equal(estimate.estimateReason, "exact-fifo");
});

test("100,000 events project without per-ticket chain writes", () => {
  const events = Array.from({ length: 100000 }, (_, i) => event("Joined", i + 1, { quantity: 1, cohort: 0n }));
  const start = performance.now();
  const tickets = projectMintQueue(events, 31337, queue);
  assert.equal(tickets.size, 100000);
  console.log(JSON.stringify({ benchmark: "queue-project-100000", milliseconds: performance.now() - start, events: events.length }));
});

test("personal timing respects one entry window, occupied slots, draw ranges and missing pace", () => {
  const rows = projectMintQueue(
    [
      event("Joined", 1, { quantity: 1, cohort: 0n, account: "early" }),
      event("TurnReady", 2, { ticketId: 1n, quantity: 1, deadline: 2000, account: "early" }),
      event("Joined", 3, { quantity: 1, cohort: 1n, account: "peer" }),
      event("Joined", 4, { quantity: 1, cohort: 1n }),
      event("Joined", 5, { quantity: 1, cohort: 2n, account: "late" }),
    ],
    31337,
    queue,
  );
  const clock = { chainTime: 1100, openedAt: 1000, cohortSeconds: 60, meanServiceSeconds: 30, activeSlots: 1 };
  const fifo = estimateMintQueue(rows, account, false, clock);
  assert.equal(fifo.position, 2);
  assert.equal(fifo.etaSeconds, 60);
  const lottery = estimateMintQueue(rows, account, true, clock);
  assert.equal(lottery.position, null);
  assert.equal(lottery.positionStart, 1);
  assert.equal(lottery.positionEnd, 3);
  assert.equal(lottery.positionExact, false);
  assert.equal(lottery.etaSeconds, null);
  assert.equal(lottery.etaEndSeconds, null);
  assert.equal(lottery.etaKnown, false);
  const late = estimateMintQueue(rows, "late", true, clock);
  assert.equal(late.position, null);
  assert.equal(late.positionStart, 1);
  assert.equal(late.positionEnd, 3);
  assert.equal(late.estimateReason, "draw-pending");
  assert.equal(late.etaKnown, false);
  assert.equal(estimateMintQueue(rows, account, false, { ...clock, meanServiceSeconds: 0 }).etaSeconds, null);
  assert.equal(estimateMintQueue(rows, "absent", false, clock).position, null);
  assert.equal(estimateMintQueue(rows, "early", false, clock).position, null);
});

test("anonymous ticket turns preserve Joined ownership and requested quantity",()=>{
 const ready=event("TurnReady",2,{account:"0x0000000000000000000000000000000000000000",ticketId:1n,quantity:0,deadline:1600});
 const rows=projectMintQueue([event("Joined",1,{quantity:2,cohort:1n}),ready],31337,queue);
 assert.equal(rows.get(1n).account,account);assert.equal(rows.get(1n).remaining,2);assert.equal(rows.get(1n).state,"ready");
 assert.equal(projectMintQueue([ready],31337,queue).size,0);
});
test("anonymous notifications require a matching canonical ticket binding and opt-in",async()=>{
 const ready=event("TurnReady",2,{account:"0x0000000000000000000000000000000000000000",ticketId:1n,quantity:0,deadline:1600});
 const rows=projectMintQueue([event("Joined",1,{quantity:2,cohort:1n}),ready],31337,queue);
 const binding={chainId:31337,queue,ticket:rows.get(1n)};const notices=[];
 const sink={isSubscribed:async(_chain,_queue,wallet)=>wallet===account,enqueue:async notice=>{notices.push(notice);}};
 assert.equal(await enqueueMintTurn(ready,1000,sink),false);
 assert.equal(await enqueueMintTurn(ready,1000,sink,{...binding,chainId:1}),false);
 assert.equal(await enqueueMintTurn(ready,1000,sink,{...binding,queue:account}),false);
 assert.equal(await enqueueMintTurn(ready,1000,sink,{...binding,ticket:{...binding.ticket,id:5n}}),false);
 assert.equal(await enqueueMintTurn(ready,1000,sink,{...binding,ticket:{...binding.ticket,state:"closed"}}),false);
 assert.equal(await enqueueMintTurn(ready,1000,sink,binding),true);
 assert.equal(notices[0].account,account);assert.equal(notices[0].quantity,2);
 assert.equal(await enqueueMintTurn(ready,1600,sink,binding),false);
});
test("nonzero event owners cannot bypass bindings and reorg replacements have distinct notice keys",()=>{
 const ready=event("TurnReady",1,{quantity:5,deadline:1600});
 const binding={chainId:31337,queue,ticket:{id:1n,account:priorityAccount,cohort:0n,remaining:5,deadline:1600,state:"ready"}};
 assert.equal(mintTurnNotice(ready,1000,binding),null);
 assert.equal(mintTurnNotice(ready,1000,{...binding,ticket:{...binding.ticket,account},chainId:1}),null);
 const original=mintTurnNotice(ready,1000);
 assert.notEqual(original.key,mintTurnNotice({...ready,account:priorityAccount},1000).key);
 assert.notEqual(original.key,mintTurnNotice({...ready,deadline:1700},1000).key);
});


test("packed engine snapshots decode fields and expose only verified seeds", () => {
  const word = 1n | (24n << 32n) | (24n << 64n) | (3n << 96n) | (2n << 104n) | (1700000000n << 112n) | (1n << 160n) | (1n << 168n) | (1n << 176n);
  const seed = "0x" + "11".repeat(32);
  const snapshot = decodeMintQueueSnapshot(7n, word, seed, "0x" + "22".repeat(32));
  assert.deepEqual(snapshot, {request:7n,firstTicket:1n,throughTicket:24n,size:24,drawn:3,admitted:2,confirmedAt:1700000000,requested:true,fulfilled:true,protected:true,seed,commitment:"0x"+"22".repeat(32),status:"verified"});
  assert.equal(decodeMintQueueSnapshot(7n, word & ~(1n << 168n), seed).status, "pending");
  assert.equal(decodeMintQueueSnapshot(7n, 0n, null, null).status, "unavailable");
});

test("verified shared-pool snapshots stay pending without replay proof", () => {
  const rows = projectMintQueue([event("Joined", 90, {ticketId:1n, account, cohort:7n, quantity:1}), event("Joined", 91, {ticketId:2n, account:priorityAccount, cohort:7n, quantity:1})], 31337, queue);
  const seed = "0x" + "33".repeat(32);
  const snapshot = decodeMintQueueSnapshot(7n, 1n | (2n << 64n) | (1n << 160n) | (1n << 168n), seed);
  const estimate = estimateMintQueue(rows, account, true, {chainTime:1200,openedAt:1000,cohortSeconds:150,entryWindowSeconds:150,meanServiceSeconds:30,activeSlots:1,drawSnapshot:snapshot,drawPosition:2,drawTotal:2});
  assert.equal(estimate.position, null);
  assert.equal(estimate.positionEnd, 2);
  assert.equal(estimate.etaSeconds, null);
  assert.equal(estimate.etaKnown, false);
  assert.equal(estimate.estimateReason, "draw-pending");
  const position = mintQueuePosition(rows, account, true, {drawSnapshot:snapshot,drawPosition:2,drawTotal:2});
  assert.equal(position.position, null);
  assert.equal(position.positionExact, false);
});

test("anonymous shared-pool admission marks draw removal while preserving wallet identity", () => {
  const rows = projectMintQueue([event("Joined", 92, {ticketId:3n, account, cohort:7n, quantity:2}), event("TurnReady", 93, {ticketId:3n, account:"0x0000000000000000000000000000000000000000", quantity:0, deadline:1800})], 31337, queue);
  assert.equal(rows.get(3n)?.drawRemoved, true);
  assert.equal(rows.get(3n)?.account, account);
  assert.equal(rows.get(3n)?.state, "ready");
});
