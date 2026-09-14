const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

export function safeUintNumber(value, label) {
  if (typeof value === "bigint") {
    if (value < 0n || value > MAX_SAFE_BIGINT) throw new RangeError(`${label} is outside the safe integer range`);
    return Number(value);
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

/**
 * Scan one log page against a pinned end block. The journal is committed only
 * after the same end hash is observed before and after getLogs, so a replaced
 * page cannot enqueue tasks or advance the cursor. Reconciliation also stages
 * cursor reorg resets, preserving sent keys when a page fails.
 */
export async function collectQueuePage({
  journal,
  head,
  initialFrom = 0n,
  pageSize = 2_000n,
  getBlock,
  getEvents,
  buildTask,
}) {
  const headNumber = BigInt(head);
  const firstBlock = BigInt(initialFrom);
  const size = BigInt(pageSize);
  if (size < 1n) throw new RangeError("page size must be positive");

  const working = {
    cursor: journal.cursor,
    hash: journal.hash,
    tasks: {...(journal.tasks ?? {})},
  };
  let reset = false;
  if (working.cursor !== null && BigInt(working.cursor) > headNumber) {
    working.cursor = null;
    working.hash = null;
    working.tasks = {};
    reset = true;
  }
  if (working.cursor !== null) {
    const prior = await getBlock(BigInt(working.cursor));
    if (prior?.hash !== working.hash) {
      working.cursor = null;
      working.hash = null;
      working.tasks = {};
      reset = true;
    }
  }

  const from = working.cursor === null ? firstBlock : BigInt(working.cursor) + 1n;
  if (from > headNumber) {
    journal.cursor = working.cursor;
    journal.hash = working.hash;
    journal.tasks = working.tasks;
    return {advanced: false, reset, from, to: null, events: []};
  }

  const to = from + size - 1n < headNumber ? from + size - 1n : headNumber;
  const before = await getBlock(to);
  if (typeof before?.hash !== "string" || before.hash.length === 0) {
    throw new Error("Queue page end block has no hash");
  }
  const events = await getEvents(from, to);
  const after = await getBlock(to);
  if (typeof after?.hash !== "string" || after.hash !== before.hash) {
    throw new Error("Queue log page changed during scan");
  }

  const additions = [];
  for (const event of events) {
    const task = await buildTask(event, {from, to, block: after});
    if (task === null || task === undefined) continue;
    if (!Array.isArray(task) || task.length !== 2) throw new TypeError("Queue task builder returned an invalid task");
    additions.push(task);
  }
  if ((await getBlock(to))?.hash !== after.hash) throw new Error("Queue log page changed during task binding");
  for (const [key, value] of additions) working.tasks[key] = value;

  journal.cursor = to.toString();
  journal.hash = after.hash;
  journal.tasks = working.tasks;
  return {advanced: true, reset, from, to, events};
}

/** Resolve compact turn identity from canonical, indexed registration logs.
 * This lookup supports notifications only; delivery rechecks contract allowance.
 */
export async function resolveTurnBinding({event,chainId,queue,getJoined}) {
  if(event.eventName!=="TurnReady"||!/^0x0{40}$/iu.test(event.args.account??""))return undefined;
  const matches=(await getJoined(event.args.ticketId,event.blockNumber)).filter(log=>
    !log.removed&&log.address.toLowerCase()===queue.toLowerCase()&&log.args.ticketId===event.args.ticketId
    &&(log.blockNumber<event.blockNumber||(log.blockNumber===event.blockNumber&&log.logIndex<event.logIndex)));
  if(matches.length!==1)throw new Error("Queue turn requires one canonical Joined record");
  const registration=matches[0].args;
  if(!/^0x[0-9a-f]{40}$/iu.test(registration.account)||/^0x0{40}$/iu.test(registration.account))throw new Error("Invalid queue registration owner");
  const remaining=safeUintNumber(registration.quantity,"Joined quantity");
  if(remaining===0)throw new Error("Empty queue registration");
  return {chainId,queue,ticket:{account:registration.account,id:event.args.ticketId,cohort:registration.cohort,
    remaining,deadline:safeUintNumber(event.args.deadline,"TurnReady deadline"),state:"ready"}};
}

/**
 * Decide whether a TurnReady outbox row is still deliverable. Chain reads are
 * deliberately supplied by the caller so this function can be tested without
 * a provider or a real notification endpoint.
 */
export function notificationDecision(notice, now, state) {
  const chainTime = safeUintNumber(now, "chain time");
  const deadline = safeUintNumber(notice.deadline, "notice deadline");
  const quantity = safeUintNumber(notice.quantity, "notice quantity");
  if (deadline <= chainTime) return {done: true, status: "expired"};

  const allowance = safeUintNumber(state.allowance, "allowance");
  if (state.enabled !== true || allowance === 0 || String(state.ticketId) !== notice.ticketId) {
    return {done: true, status: "stale"};
  }

  const currentState = safeUintNumber(state.currentState, "ticket state");
  const currentDeadline = safeUintNumber(state.currentDeadline, "ticket deadline");
  const currentRemaining = safeUintNumber(state.currentRemaining, "ticket remaining");
  if (currentState !== 2 || currentDeadline !== deadline || currentRemaining === 0) {
    return {done: true, status: "stale"};
  }

  return {done: false, status: "ready", quantity: Math.min(quantity, allowance)};
}

/**
 * Process one durable outbox row. A failed send leaves `sent` untouched so the
 * caller can retain the task and retry. A successful send records the stable
 * idempotency key before returning; repeated calls with the same journal skip
 * the provider entirely.
 */
export async function deliverTurnNotification({notice, now, readState, send, sent}) {
  if (sent[notice.key] === true) return {done: true, status: "sent", delivered: false};
  const decision = notificationDecision(notice, now, await readState());
  if (decision.done) return {...decision, delivered: false};

  await send({
    key: notice.key,
    payload: {...notice, quantity: decision.quantity},
  });
  sent[notice.key] = true;
  return {done: true, status: "sent", delivered: true};
}
