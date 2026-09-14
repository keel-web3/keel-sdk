
/** Chain-derived queue projection and consent-aware notification handoff.
 * The projection is a display aid; contract allowance remains mint authority.
 * Rebuild from canonical logs on reorg rather than retaining orphaned events.
 *
 * A queue may also expose a priority lane. Priority metadata is deliberately
 * kept separate from the ordinary Joined event; either event ordering is
 * accepted. Compact queues identify ordinary turns by ticket ID, so their
 * TurnReady account and quantity may be zero. Joined supplies that identity.
 */

export type MintQueueEventName =
  | "Joined"
  | "TurnReady"
  | "TurnClosed"
  | "Consumed"
  | "PriorityJoined"
  | "PriorityAdmitted"
  | "QueueReset";

export type MintQueueInteger = bigint | number | string;

export type MintQueueDrawStatus = "unavailable" | "pending" | "verified";

export interface MintQueueDrawSnapshot {
  readonly request: bigint;
  readonly firstTicket: bigint;
  readonly throughTicket: bigint;
  readonly size: number;
  readonly drawn: number;
  readonly admitted: number;
  readonly confirmedAt: number;
  readonly requested: boolean;
  readonly fulfilled: boolean;
  readonly protected: boolean;
  readonly seed: string | null;
  readonly commitment: string | null;
  readonly status: MintQueueDrawStatus;
}

const ZERO_BYTES32 = /^0x0{64}$/iu;

export function decodeMintQueueSnapshot(
  request: bigint,
  word: bigint,
  seed?: string | null,
  commitment?: string | null,
): MintQueueDrawSnapshot {
  const packed = word >= 0n ? word : 0n;
  const field = (offset: number, bits: number): number =>
    Number((packed >> BigInt(offset)) & ((1n << BigInt(bits)) - 1n));
  const normalizedSeed = typeof seed === "string" && !ZERO_BYTES32.test(seed) ? seed : null;
  const normalizedCommitment = typeof commitment === "string" && !ZERO_BYTES32.test(commitment) ? commitment : null;
  const requested = ((packed >> 160n) & 1n) === 1n;
  const fulfilled = ((packed >> 168n) & 1n) === 1n;
  const status: MintQueueDrawStatus =
    packed === 0n && normalizedSeed === null
      ? "unavailable"
      : requested && fulfilled && normalizedSeed !== null
        ? "verified"
        : "pending";
  return {
    request,
    firstTicket: BigInt(field(0, 32)),
    throughTicket: BigInt(field(32, 32)),
    size: field(64, 32),
    drawn: field(96, 8),
    admitted: field(104, 8),
    confirmedAt: field(112, 48),
    requested,
    fulfilled,
    protected: ((packed >> 176n) & 1n) === 1n,
    seed: normalizedSeed,
    commitment: normalizedCommitment,
    status,
  };
}

export interface MintQueueEvent {
  readonly chainId: number;
  readonly queue: string;
  readonly transactionHash: string;
  readonly logIndex: number;
  readonly blockNumber: bigint;
  readonly name: MintQueueEventName;
  /** Compact ordinary TurnReady/TurnClosed may carry the zero address. */
  readonly account?: string;
  readonly ticketId: bigint;
  readonly quantity?: number;
  readonly deadline?: number;
  readonly cohort?: bigint;
  readonly weight?: MintQueueInteger;
  readonly finish?: MintQueueInteger;
  /** QueueReset identifies the first ticket in the new demand generation. */
  readonly firstTicket?: bigint;
  readonly soldOut?: boolean;
}

export interface MintQueueTicket {
  account: string;
  id: bigint;
  cohort: bigint | null;
  remaining: number;
  deadline: number;
  state: "waiting" | "ready" | "closed";
  /** True when PriorityJoined or PriorityAdmitted was observed for this ticket. */
  priority?: boolean;
  priorityWeight?: bigint | null;
  priorityFinish?: bigint | null;
  priorityAdmitted?: boolean;
  /** True when an anonymous zero-quantity TurnReady removed this ticket from the draw pool. */
  drawRemoved?: boolean;
  /** Aliases retain the event vocabulary for consumers that prefer weight/finish. */
  weight?: bigint | null;
  finish?: bigint | null;
}

type PriorityMetadata = {
  weight: bigint | null;
  finish: bigint | null;
};

type PriorityFields = {
  priority: boolean;
  priorityWeight: bigint | null;
  priorityFinish: bigint | null;
  priorityAdmitted: boolean;
  weight: bigint | null;
  finish: bigint | null;
};

function accountKey(account: string | undefined): string | null {
  return typeof account === "string" && account.length > 0 && !/^0x0{40}$/iu.test(account) ? account.toLowerCase() : null;
}

function integerValue(value: MintQueueInteger | undefined): bigint | null {
  if (value === undefined) return null;
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0)) return null;
  try {
    const result = typeof value === "bigint" ? value : BigInt(value);
    return result >= 0n ? result : null;
  } catch {
    return null;
  }
}

function priorityFields(
  ticketId: bigint,
  metadata: ReadonlyMap<bigint, PriorityMetadata>,
  admitted: ReadonlySet<bigint>,
  current?: MintQueueTicket,
): PriorityFields {
  const next = metadata.get(ticketId);
  const priorityAdmitted = admitted.has(ticketId) || current?.priorityAdmitted === true;
  const hasMetadata = next !== undefined || current?.priority === true;
  return {
    priority: hasMetadata || priorityAdmitted,
    priorityWeight: next?.weight ?? current?.priorityWeight ?? current?.weight ?? null,
    priorityFinish: next?.finish ?? current?.priorityFinish ?? current?.finish ?? null,
    priorityAdmitted,
    weight: next?.weight ?? current?.weight ?? current?.priorityWeight ?? null,
    finish: next?.finish ?? current?.finish ?? current?.priorityFinish ?? null,
  };
}

export function projectMintQueue(
  events: readonly MintQueueEvent[],
  chainId: number,
  queue: string,
): Map<bigint, MintQueueTicket> {
  const tickets = new Map<bigint, MintQueueTicket>();
  const seen = new Set<string>();
  const latest = new Map<string, bigint>();
  const priorityMetadata = new Map<bigint, PriorityMetadata>();
  const priorityAdmissions = new Set<bigint>();
  const closedTickets = new Set<bigint>();
  let generationFirstTicket: bigint | null = null;

  const ordered = [...events].sort((a, b) =>
    a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1,
  );
  for (const event of ordered) {
    if (event.chainId !== chainId || event.queue.toLowerCase() !== queue.toLowerCase()) continue;
    const key = event.transactionHash + ":" + event.logIndex;
    if (seen.has(key)) continue;
    seen.add(key);

    if (event.name === "QueueReset") {
      const firstTicket = event.firstTicket;
      if (firstTicket !== undefined && (generationFirstTicket === null || firstTicket > generationFirstTicket)) {
        generationFirstTicket = firstTicket;
        for (const [ticketId, ticket] of tickets) {
          if (ticketId >= firstTicket) continue;
          ticket.state = "closed";
          ticket.remaining = 0;
          closedTickets.add(ticketId);
        }
        for (const ticketId of priorityMetadata.keys()) {
          if (ticketId < firstTicket) priorityMetadata.delete(ticketId);
        }
        for (const ticketId of priorityAdmissions) {
          if (ticketId < firstTicket) priorityAdmissions.delete(ticketId);
        }
      }
      continue;
    }
    // A reset starts a new demand generation. Ignore any late/orphaned log
    // for an older ticket so stale priority metadata cannot resurrect it.
    if (generationFirstTicket !== null && event.ticketId < generationFirstTicket) continue;

    if (event.name === "PriorityJoined") {
      priorityMetadata.set(event.ticketId, {
        weight: integerValue(event.weight),
        finish: integerValue(event.finish),
      });
      const ticket = tickets.get(event.ticketId);
      if (ticket) Object.assign(ticket, priorityFields(event.ticketId, priorityMetadata, priorityAdmissions, ticket));
      continue;
    }
    if (event.name === "PriorityAdmitted") {
      priorityAdmissions.add(event.ticketId);
      const ticket = tickets.get(event.ticketId);
      if (ticket) Object.assign(ticket, priorityFields(event.ticketId, priorityMetadata, priorityAdmissions, ticket));
      continue;
    }

    // An account has only one current ticket, including legacy admin grants
    // which did not emit a closure for the replaced waiting ticket.
    if (event.name === "Joined" || event.name === "TurnReady") {
      const account = accountKey(event.account);
      const current = tickets.get(event.ticketId);
      if (!account && !current) continue;
      const resolvedAccount = account ?? current?.account;
      if (!resolvedAccount) continue;
      const previous = latest.get(resolvedAccount);
      if (previous !== undefined && previous !== event.ticketId) {
        const old = tickets.get(previous);
        if (old) {
          old.state = "closed";
          old.remaining = 0;
        }
      }
      latest.set(resolvedAccount, event.ticketId);

      const fields = priorityFields(event.ticketId, priorityMetadata, priorityAdmissions, current);
      if (event.name === "Joined") {
        const closed = closedTickets.has(event.ticketId);
        tickets.set(event.ticketId, {
          account: resolvedAccount,
          id: event.ticketId,
          cohort: event.cohort ?? current?.cohort ?? null,
          remaining: closed ? 0 : event.quantity ?? 0,
          deadline: current?.deadline ?? 0,
          state: closed ? "closed" : "waiting",
          drawRemoved: current?.drawRemoved ?? false,
          ...fields,
        });
      } else {
        const closed = closedTickets.has(event.ticketId);
        tickets.set(event.ticketId, {
          account: resolvedAccount,
          id: event.ticketId,
          cohort: current?.cohort ?? null,
          remaining: closed ? 0 : !account && current ? current.remaining : event.quantity ?? 0,
          deadline: closed ? 0 : event.deadline ?? 0,
          state: closed ? "closed" : "ready",
          drawRemoved: current?.drawRemoved === true || (!account && (event.quantity ?? 0) === 0),
          ...fields,
        });
      }
      continue;
    }

    if (event.name === "TurnClosed") {
      closedTickets.add(event.ticketId);
      const ticket = tickets.get(event.ticketId);
      if (ticket) {
        ticket.state = "closed";
        ticket.remaining = 0;
      }
      continue;
    }

    const ticket = tickets.get(event.ticketId);
    if (ticket && event.name === "Consumed") {
      ticket.remaining = Math.max(0, ticket.remaining - (event.quantity ?? 0));
    }
  }
  return tickets;
}

export interface MintQueuePosition {
  waiting: number;
  position: number | null;
  ticket: bigint | null;
  /** A range is exposed when the rank is not exact. */
  positionStart: number | null;
  positionEnd: number | null;
  positionExact: boolean;
  priority: boolean;
  priorityConfigured?: boolean;
  priorityBps?: number | null;
}

export interface MintQueuePositionOptions {
  readonly priorityBps?: number;
  readonly priority?: boolean;
  /** A verified shared-pool draw may provide an exact current position. */
  readonly drawSnapshot?: MintQueueDrawSnapshot | null;
  readonly drawPosition?: number | null;
  readonly drawTotal?: number | null;
}

export function mintQueuePosition(
  tickets: ReadonlyMap<bigint, MintQueueTicket>,
  account: string,
  lottery: boolean,
  options: MintQueuePositionOptions | number | boolean = {},
): MintQueuePosition {
  const waiting = [...tickets.values()]
    .filter((ticket) => ticket.state === "waiting")
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const own = waiting.find((ticket) => ticket.account === account.toLowerCase());
  const index = own ? waiting.indexOf(own) : -1;
  const hintedBps = typeof options === "number" || typeof options === "boolean" ? undefined : options.priorityBps;
  const hintedPriority = typeof options === "boolean" ? options : typeof options === "number" ? false : options.priority === true;
  const validHintedBps = hintedBps === undefined || (Number.isInteger(hintedBps) && hintedBps >= 0 && hintedBps <= 10_000);
  const priorityConfigured = hintedBps !== undefined && (!validHintedBps || hintedBps > 0);
  const priorityActive = priorityConfigured || hintedPriority || [...tickets.values()].some((ticket) => ticket.state !== "closed" && ticket.priority === true);
  const exact = index >= 0 && !lottery && !priorityActive;
  const exactPosition = exact ? index + 1 : null;
  const exactTotal = exact ? index + 1 : null;
  return {
    waiting: waiting.length,
    position: exactPosition,
    ticket: index < 0 ? null : own?.id ?? null,
    positionStart: index < 0 ? null : exact ? exactPosition : 1,
    positionEnd: index < 0 ? null : exact ? exactTotal : waiting.length,
    positionExact: exact,
    priority: own?.priority === true || hintedPriority,
    priorityConfigured,
    priorityBps: hintedBps ?? null,
  };
}

export interface MintTurnNotice {
  key: string;
  chainId: number;
  queue: string;
  account: string;
  ticketId: string;
  deadline: number;
  quantity: number;
}

export interface MintTurnBinding {
  chainId: number;
  queue: string;
  ticket: MintQueueTicket;
}

/** Optional display binding must come from this queue's canonical projection or wallet read. */
export function mintTurnNotice(event: MintQueueEvent, chainTime: number, binding?: MintTurnBinding): MintTurnNotice | null {
  let account = accountKey(event.account);
  let quantity = event.quantity;
  if (binding) {
    const boundAccount = accountKey(binding.ticket.account);
    if (binding.chainId !== event.chainId || binding.queue.toLowerCase() !== event.queue.toLowerCase()
        || binding.ticket.id !== event.ticketId || binding.ticket.state !== "ready" || binding.ticket.deadline !== event.deadline
        || !boundAccount || (account !== null && account !== boundAccount)) return null;
    account = boundAccount;
    quantity = binding.ticket.remaining;
  }
  if (event.name !== "TurnReady" || !account || !event.deadline || event.deadline <= chainTime || !quantity) return null;
  return {
    key: event.chainId + ":" + event.queue.toLowerCase() + ":" + event.ticketId + ":" + account + ":" + event.deadline,
    chainId: event.chainId,
    queue: event.queue.toLowerCase(),
    account,
    ticketId: event.ticketId.toString(),
    deadline: event.deadline,
    quantity,
  };
}

/** Persist the key in an outbox; deliver only to verified opt-in contacts.
 * Providers should use the key as their idempotency key. Neither phone numbers
 * nor email addresses belong in chain events, public queues, or token metadata.
 */
export interface MintTurnNotificationSink {
  enqueue(notice: MintTurnNotice): Promise<void>;
  isSubscribed(chainId: number, queue: string, account: string): Promise<boolean>;
}

export async function enqueueMintTurn(
  event: MintQueueEvent,
  chainTime: number,
  sink: MintTurnNotificationSink,
  binding?: MintTurnBinding,
): Promise<boolean> {
  const notice = mintTurnNotice(event, chainTime, binding);
  if (!notice) return false;
  if (!(await sink.isSubscribed(notice.chainId, notice.queue, notice.account))) return false;
  await sink.enqueue(notice);
  return true;
}

export interface MintQueueTiming {
  readonly chainTime: number;
  readonly openedAt: number;
  readonly cohortSeconds: number;
  readonly meanServiceSeconds: number;
  readonly activeSlots: number;
  /** Legacy field retained for source compatibility; shared-pool timing ignores it. */
  readonly cohortBase?: number;
  /** One initial join window. Later draws are demand/advance driven, not timed cohorts. */
  readonly entryWindowSeconds?: number;
  /** Basis points reserved for the priority lane. Omit when unavailable. */
  readonly priorityBps?: number;
  /** Optional caller hint for a priority ticket when metadata is not indexed yet. */
  readonly priority?: boolean;
  /** Verified or pending shared-pool draw read from the lottery engine. */
  readonly drawSnapshot?: MintQueueDrawSnapshot | null;
  readonly drawPosition?: number | null;
  readonly drawTotal?: number | null;
  readonly protectedTurnsRemaining?: number | null;
}

export type MintQueueEstimateReason = "exact-fifo" | "lottery-range" | "priority-range" | "draw-pending" | "draw-snapshot" | "entry-window-open" | "unknown";

export interface MintQueueEstimateOptions {
  readonly priority?: boolean;
}

export interface MintQueueEstimate {
  ticket: string | null;
  position: number | null;
  positionEnd: number | null;
  etaSeconds: number | null;
  etaEndSeconds: number | null;
  cohort: string | null;
  waiting: number;
  /** Lower bound for position when position is not exact. */
  positionStart: number | null;
  positionExact: boolean;
  etaKnown: boolean;
  priority: boolean;
  priorityConfigured: boolean;
  priorityBps: number | null;
  estimateReason: MintQueueEstimateReason;
}

/** Estimates never authorize a mint. Shared-pool draws can admit any eligible ticket,
 * so the displayed range covers currently waiting tickets and ETA is unknown.
 * The service mean is the interval between mint transactions, not per-slot pace.
 *
 * If a priority lane is configured or any priority metadata is present, the
 * projection cannot prove a FIFO rank from these logs alone. It therefore
 * returns a conservative range and unknown ETA instead of presenting a false
 * exact place in line. The chain's allowance remains the source of truth.
 */
export function estimateMintQueue(
  tickets: ReadonlyMap<bigint, MintQueueTicket>,
  account: string,
  lottery: boolean,
  timing: MintQueueTiming,
  options?: MintQueueEstimateOptions | boolean,
): MintQueueEstimate {
  const own = [...tickets.values()]
    .filter((ticket) => ticket.account === account.toLowerCase() && ticket.state !== "closed")
    .sort((a, b) => (a.id > b.id ? -1 : 1))[0];
  const waiting = [...tickets.values()].filter((ticket) => ticket.state === "waiting");
  const priorityBps = timing.priorityBps ?? null;
  const validPriorityBps =
    timing.priorityBps === undefined ||
    (Number.isInteger(timing.priorityBps) && timing.priorityBps >= 0 && timing.priorityBps <= 10_000);
  const priorityConfigured = timing.priorityBps !== undefined && (!validPriorityBps || timing.priorityBps > 0);
  const priorityPresent = [...tickets.values()].some(
    (ticket) => ticket.state !== "closed" && (ticket.priority === true || ticket.priorityAdmitted === true),
  );
  const priorityHint = typeof options === "boolean" ? options : options?.priority;
  const priority = priorityHint ?? (timing.priority === true || own?.priority === true);
  const priorityActive = priorityConfigured || priorityPresent || priority;
  const unavailable: MintQueueEstimate = {
    ticket: own?.id.toString() ?? null,
    position: null,
    positionEnd: null,
    etaSeconds: null,
    etaEndSeconds: null,
    cohort: own?.cohort?.toString() ?? null,
    waiting: waiting.length,
    positionStart: null,
    positionExact: false,
    etaKnown: false,
    priority,
    priorityConfigured,
    priorityBps,
    estimateReason: "unknown",
  };
  if (!own || own.state !== "waiting") return unavailable;

  // The single initial entry window is still accepting entrants. Any displayed
  // rank would move while that window is open, whether the queue uses FIFO or a draw.
  const entryWindowSeconds = timing.entryWindowSeconds ?? timing.cohortSeconds;
  if (entryWindowSeconds > 0 && timing.chainTime < timing.openedAt + entryWindowSeconds) {
    return { ...unavailable, estimateReason: "entry-window-open" };
  }

  // A nonzero priorityBps is a feature configuration, even if no priority
  // holder is in the current snapshot. Future eligible holders can overtake
  // this account, so retaining the FIFO number would be misleading.
  if (priorityActive || lottery) {
    return {
      ...unavailable,
      positionStart: waiting.length > 0 ? 1 : null,
      positionEnd: waiting.length > 0 ? waiting.length : null,
      estimateReason: priorityActive ? "priority-range" : lottery ? "draw-pending" : "unknown",
    };
  }

  const ahead = waiting.filter((ticket) => ticket.id < own.id).length;
  const active = [...tickets.values()].filter(
    (ticket) => ticket.state === "ready" && ticket.remaining > 0 && ticket.deadline > timing.chainTime,
  ).length;
  const free = Math.max(0, timing.activeSlots - active);
  const eta = (before: number): number | null =>
    timing.meanServiceSeconds > 0
      ? Math.ceil(Math.max(0, before - free + 1) * timing.meanServiceSeconds)
      : null;
  const etaSeconds = eta(ahead);
  const etaEndSeconds = etaSeconds;
  return {
    ...unavailable,
    position: ahead + 1,
    positionEnd: ahead + 1,
    etaSeconds,
    etaEndSeconds,
    positionStart: ahead + 1,
    positionExact: true,
    etaKnown: etaSeconds !== null && etaEndSeconds !== null,
    estimateReason: "exact-fifo",
  };
}
