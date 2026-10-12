/** Explicit whole-inventory paging. No project calldata is sent and no missing
 * native dependency is added automatically. Inventory coverage is not EVM
 * access closure, source freshness, or publication acceptance. */
import assert from 'node:assert/strict';
import { CAPTURED_STATE_RPC, CAPTURED_STATE_LIMITS as PAGE,
  CAPTURED_STATE_INVENTORY_LIMITS as LIMITS, collectCapturedStateWitness,
  validateCapturedStateSeed, validateCapturedStateInventorySeed,
  verifyCapturedAccountProof } from './captured-state-witness.mjs';
import { encodeCapturedHeader, sha256, stable } from './captured-publication-fixture.mjs';

const sumSlots = accounts => accounts.reduce((sum, item) => sum + item.slots.length, 0);
const fail = (reason, extra = {}) => Object.assign(new Error(reason), { reason, ...extra });
const falseClaims = ['fullWitnessComplete', 'transitiveStateComplete', 'acceptance', 'gateAccepted',
  'projectAcceptance', 'projectCalldataSent', 'originalPlanChanged'];
const noAcceptance = () => Object.fromEntries(falseClaims.map(key => [key, false]));
const recent = (header, now) => {
  assert.ok(Number.isSafeInteger(now), 'Invalid clock');
  const age = BigInt(Math.floor(now / 1000)) - BigInt(header.timestamp);
  assert.ok(age <= BigInt(PAGE.maximumPinAgeSeconds) && age >= -BigInt(PAGE.maximumFutureSeconds), 'Pin is not recent');
};

/** Deterministic partition of every requested account and slot, without
 * truncation, reordering or splitting one account's proof across pages. */
export function planCapturedStateInventory(input) {
  const scope = validateCapturedStateInventorySeed(input);
  const inventorySHA256 = sha256(stable({ schema: 'keel-captured-state-inventory@1',
    binding: scope.binding, accounts: scope.accounts, limits: LIMITS, pageLimits: PAGE }));
  const pages = []; let accounts = [], slotCount = 0, offset = 0;
  const flush = () => {
    if (!accounts.length) return;
    const index = pages.length;
    const page = { index, accountOffset: offset, accounts, slotCount,
      accountInventorySHA256: sha256(stable(accounts)) };
    page.pageSHA256 = sha256(stable({ inventorySHA256, ...page }));
    pages.push(page); offset += accounts.length; accounts = []; slotCount = 0;
  };
  for (const account of scope.accounts) {
    if (accounts.length === PAGE.maximumAccounts || slotCount + account.slots.length > PAGE.maximumSlots) flush();
    accounts.push(account); slotCount += account.slots.length;
  }
  flush();
  assert.ok(pages.length > 0 && pages.length <= LIMITS.maximumPages, 'Whole inventory page bound exceeded');
  const requests = 2 * scope.accounts.length + 3 * pages.length;
  assert.ok(requests <= LIMITS.maximumRequests, 'Whole inventory request bound exceeded');
  return { schema: 'keel-captured-state-inventory-plan@1', inventorySHA256,
    binding: scope.binding, headerRlp: scope.headerRlp, limits: LIMITS, pageLimits: PAGE,
    accountCount: scope.accounts.length, slotCount: sumSlots(scope.accounts), requestCount: requests, pages };
}

function pageInput(input, plan, page) {
  return { ...input, seed: { ...input.seed, accounts: structuredClone(page.accounts),
    inventoryPage: { inventorySHA256: plan.inventorySHA256, index: page.index,
      pageCount: plan.pages.length, pageSHA256: page.pageSHA256 } } };
}

function readResponse(entry, expected, id) {
  assert.equal(entry.responseComplete, true, 'Incomplete response');
  assert.ok(entry.httpStatus >= 200 && entry.httpStatus < 300, 'Unsuccessful HTTP response');
  assert.deepEqual(entry.request, { jsonrpc: '2.0', id, ...expected }, 'Unexpected RPC request');
  assert.equal(Buffer.byteLength(entry.rawRequest), entry.requestBytes, 'Request byte count changed');
  assert.equal(sha256(entry.rawRequest), entry.requestSHA256, 'Request digest changed');
  assert.deepEqual(JSON.parse(entry.rawRequest), entry.request, 'Raw request changed');
  const bytes = Buffer.from(entry.rawResponseBase64, 'base64');
  assert.equal(bytes.toString('base64'), entry.rawResponseBase64, 'Invalid raw response encoding');
  assert.equal(bytes.length, entry.capturedResponseBytes, 'Response byte count changed');
  assert.equal(entry.observedResponseBytes, bytes.length, 'Response was truncated');
  assert.ok(bytes.length <= PAGE.maximumResponseBytes, 'Response bound exceeded');
  assert.equal(sha256(bytes), entry.capturedResponseSHA256, 'Response digest changed');
  const response = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  assert.equal(response.jsonrpc, '2.0'); assert.equal(response.id, id);
  assert.ok(Object.hasOwn(response, 'result') && !Object.hasOwn(response, 'error'), 'RPC did not return a result');
  return response.result;
}

/** Revalidate every raw page, proof, code byte, pin and inventory binding.
 * Stored flags alone are never sufficient to declare inventory completeness. */
export function mergeCapturedStateWitnessPages(input, plan, records, { now = () => Date.now() } = {}) {
  const scope = validateCapturedStateInventorySeed(input);
  assert.deepEqual(plan, planCapturedStateInventory(input), 'Inventory plan changed');
  assert.ok(Array.isArray(records) && records.length === plan.pages.length, 'Missing or extra inventory pages');
  let lastClock = now();
  const clock = () => { const value = now(); assert.ok(Number.isSafeInteger(value) && value >= lastClock, 'Merge clock moved backward'); lastClock = value; return value; };
  recent(scope.header, lastClock);
  const accounts = []; let requestCount = 0, responseBytes = 0, startedAt, finishedAt;
  for (const [index, record] of records.entries()) {
    const page = plan.pages[index], report = record.report;
    assert.deepEqual(record.page, page, 'Duplicate, reordered or changed inventory page');
    assert.equal(report.schema, 'keel-captured-state-seed-witness@1');
    assert.equal(report.recipient, CAPTURED_STATE_RPC); assert.equal(report.chainId, 11155111);
    assert.deepEqual(report.binding, validateCapturedStateSeed(pageInput(input, plan, page)).binding, 'Page source or pin changed');
    assert.deepEqual(report.requestedAccounts, page.accounts, 'Requested inventory changed');
    assert.equal(report.headerRlp, scope.headerRlp);
    assert.equal(report.status, 'seed-verified-full-witness-incomplete');
    assert.equal(report.seedComplete, true); assert.equal(report.canonicalSnapshotRechecked, true);
    for (const key of falseClaims) assert.equal(report[key], false, `Invalid ${key} claim`);
    assert.equal(report.simulations, 0); assert.equal(report.signing, 'not-performed'); assert.equal(report.submission, 'not-performed');
    const start = Date.parse(report.startedAt), end = Date.parse(report.finishedAt);
    assert.ok(Number.isSafeInteger(start) && Number.isSafeInteger(end) && end >= start, 'Invalid page clock');
    if (index === 0) startedAt = start;
    else assert.ok(start >= finishedAt, 'Overlapping or reordered page clocks');
    finishedAt = end;
    assert.ok(end - startedAt < LIMITS.maximumDurationMs, 'Whole inventory deadline exceeded');
    assert.ok(end <= clock(), 'Future page result'); recent(scope.header, end);
    assert.ok(Array.isArray(report.requests) && report.requests.length === 2 * page.accounts.length + 3, 'Incomplete RPC sequence');
    const expected = [
      { method: 'eth_chainId', params: [] },
      { method: 'eth_getBlockByNumber', params: [scope.header.number, false] },
      ...page.accounts.flatMap(item => [
        { method: 'eth_getProof', params: [item.address, item.slots, scope.header.number] },
        { method: 'eth_getCode', params: [item.address, scope.header.number] },
      ]), { method: 'eth_getBlockByNumber', params: [scope.header.number, false] },
    ];
    const results = expected.map((request, i) => readResponse(report.requests[i], request, i + 1));
    assert.equal(results[0], '0xaa36a7');
    assert.equal(encodeCapturedHeader(results[1]), scope.headerRlp, 'Before header changed');
    assert.equal(encodeCapturedHeader(results.at(-1)), scope.headerRlp, 'Final header changed');
    assert.deepEqual(report.canonicalBefore, results[1]); assert.deepEqual(report.canonicalAfter, results.at(-1));
    const proved = page.accounts.map((account, i) => verifyCapturedAccountProof(scope.header, account, results[2 + 2 * i], results[3 + 2 * i]));
    assert.deepEqual(report.witness.accounts, proved, 'Saved witness differs from proved raw responses');
    assert.equal(report.provedAccounts, proved.length); assert.equal(report.provedSlots, page.slotCount);
    assert.equal(report.requestedSlots, page.slotCount);
    const pageBytes = report.requests.reduce((sum, entry) => sum + entry.capturedResponseBytes, 0);
    assert.equal(pageBytes, report.responseBytes); assert.ok(pageBytes <= PAGE.maximumTotalResponseBytes);
    accounts.push(...proved); requestCount += expected.length; responseBytes += pageBytes;
  }
  assert.equal(accounts.length, plan.accountCount); assert.equal(sumSlots(scope.accounts), plan.slotCount);
  assert.equal(new Set(accounts.map(account => account.address)).size, plan.accountCount, 'Duplicate merged account');
  assert.equal(accounts.reduce((sum, account) => sum + account.storageProof.length, 0), plan.slotCount);
  assert.equal(requestCount, plan.requestCount); assert.ok(responseBytes <= LIMITS.maximumTotalResponseBytes);
  const completedAt = clock();
  recent(scope.header, completedAt);
  assert.ok(completedAt - startedAt < LIMITS.maximumDurationMs, 'Whole inventory merge deadline exceeded');
  return { schema: 'keel-captured-state-inventory-witness@1', binding: scope.binding,
    inventorySHA256: plan.inventorySHA256, headerRlp: scope.headerRlp, recipient: CAPTURED_STATE_RPC,
    chainId: 11155111, inventoryComplete: true, seedComplete: true, canonicalSnapshotRechecked: true,
    provedAccounts: accounts.length, provedSlots: plan.slotCount, provedPages: records.length,
    requestCount, responseBytes, witness: { accounts }, ...noAcceptance(),
    nativeAccessClosure: 'not-executed', unresolvedSourceDependencies: structuredClone(input.seed.pendingDerivations ?? []),
    completenessScope: 'Every account and slot in this exact requested inventory; not transitive native execution closure.',
  };
}

/** One explicit bounded operation, without retry, automatic scope expansion,
 * new pin selection, network fallback or persistence of a publication proof. */
export async function collectCapturedStateInventory(input, { fetchImpl = globalThis.fetch,
  now = () => Date.now(), checkpoint, signal, budget } = {}) {
  const started = now(), frozen = structuredClone(input);
  const limits = { ...LIMITS };
  for (const key of ['maximumDurationMs', 'maximumTotalResponseBytes']) if (budget?.[key] !== undefined) {
    assert.ok(Number.isSafeInteger(budget[key]) && budget[key] > 0 && budget[key] <= limits[key], 'A budget may only tighten fixed inventory bounds');
    limits[key] = budget[key];
  }
  let last = started;
  const tick = () => { const value = now(); if (!Number.isSafeInteger(value) || value < last) throw fail('invalid-clock'); last = value; return value; };
  const report = { schema: 'keel-captured-state-inventory-collection@1', recipient: CAPTURED_STATE_RPC,
    limits, startedAt: new Date(started).toISOString(), status: 'capturing', pages: [],
    inventoryComplete: false, seedComplete: false, ...noAcceptance(), simulations: 0,
    signing: 'not-performed', submission: 'not-performed' };
  let phase = 'input-binding', responseBytes = 0, requestCount = 0;
  const notify = () => { if (checkpoint) { try { checkpoint(structuredClone(report)); } catch { throw fail('checkpoint-failed'); } } };
  try {
    const plan = planCapturedStateInventory(frozen); report.plan = plan;
    for (const page of plan.pages) {
      phase = 'page';
      if (signal?.aborted) throw fail('cancelled');
      const remaining = limits.maximumDurationMs - (tick() - started);
      if (remaining <= 0) throw fail('total-timeout');
      const byteBudget = limits.maximumTotalResponseBytes - responseBytes;
      if (byteBudget <= 0) throw fail('response-too-large');
      const record = { page, report: null }; report.pages.push(record);
      const pageReport = await collectCapturedStateWitness(pageInput(frozen, plan, page), {
        fetchImpl, now: tick, signal,
        budget: { maximumDurationMs: Math.min(remaining, PAGE.maximumDurationMs),
          maximumTotalResponseBytes: Math.min(byteBudget, PAGE.maximumTotalResponseBytes) },
        checkpoint: value => { record.report = value; notify(); },
      });
      record.report = pageReport;
      responseBytes += pageReport.responseBytes; requestCount += pageReport.requests.length;
      if (!pageReport.seedComplete || pageReport.status !== 'seed-verified-full-witness-incomplete')
        throw fail('page-incomplete', { pageIndex: page.index, pageError: pageReport.error });
      if (requestCount > LIMITS.maximumRequests) throw fail('request-limit');
      notify();
    }
    phase = 'merge';
    if (signal?.aborted) throw fail('cancelled');
    if (tick() - started >= limits.maximumDurationMs) throw fail('total-timeout');
    report.merged = mergeCapturedStateWitnessPages(frozen, plan, report.pages, { now: tick });
    if (signal?.aborted) throw fail('cancelled');
    if (tick() - started >= limits.maximumDurationMs) throw fail('total-timeout');
    report.inventoryComplete = true; report.seedComplete = true;
    report.status = 'inventory-verified-full-witness-incomplete';
  } catch (error) {
    report.status = 'blocked'; report.inventoryComplete = false; report.seedComplete = false;
    report.error = { phase, reason: error.reason ?? 'inventory-verification-failed',
      ...(Number.isInteger(error.pageIndex) ? { pageIndex: error.pageIndex, pageError: error.pageError } : {}) };
  }
  report.requestCount = report.pages.reduce((sum, page) => sum + (page.report?.requests.length ?? 0), 0);
  report.responseBytes = report.pages.reduce((sum, page) => sum + (page.report?.responseBytes ?? 0), 0);
  report.finishedAt = new Date(last).toISOString(); report.elapsedMs = last - started;
  try { notify(); } catch { report.status = 'blocked'; report.inventoryComplete = false; report.seedComplete = false; report.error = { phase: 'checkpoint', reason: 'checkpoint-failed' }; }
  if (!report.inventoryComplete) delete report.merged;
  return report;
}
