/** Private local resolver. Only proofs/code/numbered headers leave this process,
 * through the existing fixed approved read recipient. Native execution itself
 * remains isolated and every recovery starts from the canonical witness. */
import assert from 'node:assert/strict';
import { keccak256, stringToHex } from 'viem';
import { normalizeAssemblyCapture, encodeCapturedHeader, verifyWitness, sha256, stable } from './captured-publication-fixture.mjs';
import { CAPTURED_STATE_RPC, CAPTURED_STATE_LIMITS as PAGE, CAPTURED_STATE_INVENTORY_LIMITS as INVENTORY,
  validateCapturedStateInventorySeed, normalizeWitnessSlot } from './captured-state-witness.mjs';
import { collectCapturedStateInventory, planCapturedStateInventory } from './captured-state-inventory.mjs';

export const NATIVE_WITNESS_RESOLUTION_LIMITS = Object.freeze({ maximumRounds: 64, maximumRequests: 1024,
  maximumDurationMs: 120_000, maximumResponseBytes: 64 * 1024 * 1024, maximumAncestors: 256,
  maximumAccounts: INVENTORY.maximumAccounts, maximumSlots: INVENTORY.maximumSlots,
  maximumSlotsPerAccount: INVENTORY.maximumSlotsPerAccount });
const failure = reason => Object.assign(new Error(reason), { reason });
const lower = value => String(value).toLowerCase();
const quantity = value => typeof value === 'string' && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value);
const address = value => typeof value === 'string' && /^0x[0-9a-f]{40}$/i.test(value);
const hash = value => typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value);

export function mergeCanonicalWitnessAccounts(header, previous, incoming) {
  assert.ok(Array.isArray(previous));
  if (previous.length) verifyWitness(header, { accounts: previous });
  verifyWitness(header, { accounts: incoming });
  const map = new Map(previous.map(a => [lower(a.address), structuredClone(a)]));
  for (const account of incoming) {
    const key = lower(account.address), old = map.get(key);
    if (!old) { map.set(key, structuredClone(account)); continue; }
    for (const field of ['code', 'codeHash', 'storageHash']) assert.equal(lower(old[field]), lower(account[field]), 'Canonical account changed');
    for (const field of ['balance', 'nonce']) assert.equal(BigInt(old[field]), BigInt(account[field]), 'Canonical account changed');
    const slots = new Map(old.storageProof.map(p => [normalizeWitnessSlot(p.key), p]));
    for (const proof of account.storageProof) {
      const slot = normalizeWitnessSlot(proof.key), existing = slots.get(slot);
      if (existing) assert.equal(BigInt(existing.value), BigInt(proof.value), 'Canonical slot changed');
      else slots.set(slot, structuredClone(proof));
    }
    old.storageProof = [...slots.values()];
  }
  const result = [...map.values()];
  assert.ok(result.length <= INVENTORY.maximumAccounts, 'Canonical account bound exceeded');
  assert.ok(result.every(a => a.storageProof.length <= INVENTORY.maximumSlotsPerAccount), 'Canonical per-account slot bound exceeded');
  assert.ok(result.reduce((sum, a) => sum + a.storageProof.length, 0) <= INVENTORY.maximumSlots, 'Canonical slot bound exceeded');
  verifyWitness(header, { accounts: result });
  return result;
}

/** Bind allocated SDK wire to original semantic calls. Gas/fees/nonces may be
 * allocated by the existing SDK; recipients, calldata, value and call order
 * cannot change, and the paid atomic outer call cannot be split. */
export function assertCapturedProgram(capture, program) {
  const prepared = capture.exactSimulationInput.preparationCalls;
  const complete = [...prepared, ...(capture.exactSimulationInput.requiredReaderCalls ?? []).map(x => x.call),
    ...(capture.exactSimulationInput.observationCalls ?? []), capture.exactSimulationInput.metadataCall];
  const blocks = program?.blockStateCalls;
  assert.ok(Array.isArray(blocks) && (blocks.length === prepared.length || blocks.length === complete.length), 'Complete captured transaction sequence required');
  const expected = blocks.length === prepared.length ? prepared : complete;
  blocks.forEach((block, index) => {
    assert.deepEqual(Object.keys(block), ['calls']); assert.equal(block.calls.length, 1, 'Original atomic/staged boundary changed');
    const call = block.calls[0], original = expected[index];
    for (const key of ['from', 'to', 'data']) assert.equal(lower(call[key]), lower(original[key]), `Captured ${key} changed`);
    assert.equal(BigInt(call.value), BigInt(original.value), 'Captured value changed');
    assert.ok(quantity(call.gas) && BigInt(call.gas) > 0n && BigInt(call.gas) <= BigInt(capture.header.gasLimit), 'Exact call gas exceeds canonical chain capacity');
  });
}

/** newNativeClient receives verified canonical input; use the maintained
 * hash-bound isolated process factory. Injected fetch/clock/client are for
 * qualification. No new endpoint or source-header substitution is supported. */
export function createCapturedNativeWitnessResolver(input, { newNativeClient, fetchImpl = globalThis.fetch,
  now = () => Date.now(), signal, checkpoint, budget } = {}) {
  const frozen = structuredClone(input), scope = validateCapturedStateInventorySeed(frozen);
  const capture = normalizeAssemblyCapture(frozen.capture), limits = { ...NATIVE_WITNESS_RESOLUTION_LIMITS };
  assert.equal(typeof newNativeClient, 'function');
  for (const key of Object.keys(limits)) if (budget?.[key] !== undefined) {
    assert.ok(Number.isSafeInteger(budget[key]) && budget[key] > 0 && budget[key] <= limits[key], 'Budgets may only tighten'); limits[key] = budget[key];
  }
  const started = now(); let last = started, closed = false, busy = false, accounts = [], ancestors = [], headers = [], activeProgram, requests = 0, responseBytes = 0;
  const clients = new Set(), seen = new Set(), abort = new AbortController();
  const report = { schema: 'keel-canonical-native-witness-resolution@1', binding: scope.binding,
    recipient: CAPTURED_STATE_RPC, limits, rounds: [], collections: [], headerReads: [], sessions: [],
    requestBudgetScope: 'Resolver proof/code/header reads across all rounds. SDK canonical checks have their own bounded session deadline and replay limit.',
    acceptance: false, projectAcceptance: false, fullWitnessComplete: false, transitiveStateComplete: false,
    originalPlanChanged: false, projectCalldataSent: false, signing: false, submission: false };
  const notify = () => { if (checkpoint) checkpoint(structuredClone(report)); };
  const check = suppliedSignal => {
    const time = now(); assert.ok(Number.isSafeInteger(time) && time >= last, 'Resolution clock moved backward'); last = time;
    if (closed || abort.signal.aborted || signal?.aborted || suppliedSignal?.aborted) throw failure('cancelled');
    if (time - started >= limits.maximumDurationMs) throw failure('total-timeout');
    const age = BigInt(Math.floor(time / 1000)) - BigInt(scope.header.timestamp);
    if (age > BigInt(PAGE.maximumPinAgeSeconds) || age < -BigInt(PAGE.maximumFutureSeconds)) throw failure('pin-not-recent');
  };
  const combined = supplied => AbortSignal.any([abort.signal, signal, supplied].filter(Boolean));
  const exclusive = async (supplied, operation) => {
    check(supplied); assert.equal(busy, false, 'Concurrent witness mutation refused'); busy = true;
    try { const value = await operation(); check(supplied); notify(); return value; }
    catch (error) { report.lastFailure = error.reason ?? 'witness-resolution-failed'; report.fullWitnessComplete = false; report.transitiveStateComplete = false; throw error; }
    finally { busy = false; report.requests = requests; report.responseBytes = responseBytes; report.elapsedMs = last - started; }
  };
  const reserve = count => { assert.ok(requests + count <= limits.maximumRequests, 'Resolution request budget exceeded'); };
  const collect = async (items, supplied) => {
    check(supplied);
    const union = new Map(accounts.map(a=>[lower(a.address),new Set(a.storageProof.map(p=>normalizeWitnessSlot(p.key)))]));
    for (const item of items) { const slots=union.get(lower(item.address))??new Set(); for(const slot of item.slots)slots.add(normalizeWitnessSlot(slot)); union.set(lower(item.address),slots); }
    assert.ok(union.size<=limits.maximumAccounts && [...union.values()].every(s=>s.size<=limits.maximumSlotsPerAccount)
      && [...union.values()].reduce((sum,s)=>sum+s.size,0)<=limits.maximumSlots,'Expanded inventory exceeds resolution bounds');
    const nextInput = { ...frozen, seed: { ...frozen.seed, accounts: items } };
    const plan = planCapturedStateInventory(nextInput); reserve(plan.requestCount);
    const remainingBytes = limits.maximumResponseBytes - responseBytes;
    assert.ok(remainingBytes > 0, 'Resolution response budget exceeded');
    const entry = { requestInventorySHA256: plan.inventorySHA256, report: null }; report.collections.push(entry);
    const value = await collectCapturedStateInventory(nextInput, { fetchImpl, now: () => { check(supplied); return last; }, signal: combined(supplied),
      budget: { maximumDurationMs: Math.min(limits.maximumDurationMs - (last - started), INVENTORY.maximumDurationMs), maximumTotalResponseBytes: Math.min(remainingBytes, INVENTORY.maximumTotalResponseBytes) },
      checkpoint: value => { entry.report = value; notify(); } });
    entry.report = value; requests += value.requestCount; responseBytes += value.responseBytes;
    assert.equal(value.inventoryComplete, true, 'Additional proof collection incomplete');
    accounts = mergeCanonicalWitnessAccounts(scope.header, accounts, value.merged.witness.accounts);
    assert.ok(accounts.length <= limits.maximumAccounts && accounts.reduce((s,a)=>s+a.storageProof.length,0) <= limits.maximumSlots);
    assert.ok(accounts.every(a=>a.storageProof.length<=limits.maximumSlotsPerAccount));
  };
  // Header-only reads use the same fixed recipient and a bounded streamed body.
  // Every returned header is locally RLP-hashed and linked to the base parent.
  const headerRead = async (number, supplied) => {
    check(supplied); reserve(1); requests++;
    const request = { jsonrpc: '2.0', id: requests, method: 'eth_getBlockByNumber', params: [number, false] };
    const rawRequest = JSON.stringify(request), entry = { request, rawRequest, requestSHA256: sha256(rawRequest), responseComplete: false };
    report.headerReads.push(entry); notify();
    const timeout = AbortSignal.timeout(Math.min(PAGE.perRequestTimeoutMs, limits.maximumDurationMs - (last - started)));
    const requestSignal = AbortSignal.any([combined(supplied), timeout]); let reader, total = 0; const chunks = [];
    const bounded = operation => new Promise((resolve,reject)=>{
      const onAbort=()=>reject(failure('header-read-aborted'));
      requestSignal.addEventListener('abort',onAbort,{once:true}); if(requestSignal.aborted)onAbort();
      operation.then(value=>{requestSignal.removeEventListener('abort',onAbort);resolve(value);},error=>{requestSignal.removeEventListener('abort',onAbort);reject(error);});
    });
    try {
      const response = await bounded(fetchImpl(CAPTURED_STATE_RPC, { method: 'POST', redirect: 'error', credentials: 'omit', headers: { 'content-type': 'application/json' }, body: rawRequest, signal: requestSignal }));
      entry.httpStatus = response.status;
      assert.ok(response.ok && !response.redirected && (!response.url || response.url === CAPTURED_STATE_RPC || response.url === CAPTURED_STATE_RPC + '/'), 'Header read refused');
      assert.ok(response.body?.getReader, 'Missing header stream'); reader = response.body.getReader();
      for (;;) {
        const result = await bounded(reader.read());
        check(supplied); if (result.done) break;
        assert.ok(result.value instanceof Uint8Array); const available = Math.min(128 * 1024 - total, limits.maximumResponseBytes - responseBytes);
        const size = Math.min(available, result.value.length); if (size > 0) { chunks.push(Buffer.from(result.value.subarray(0,size))); total += size; responseBytes += size; }
        assert.equal(size, result.value.length, 'Header response exceeded shared budget');
      }
      entry.responseComplete = true;
      const raw = Buffer.concat(chunks), envelope = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
      assert.equal(envelope.jsonrpc, '2.0'); assert.equal(envelope.id, request.id); assert.ok(Object.hasOwn(envelope,'result') && !Object.hasOwn(envelope,'error'));
      const header = envelope.result; assert.equal(header.number, number); const rlp = encodeCapturedHeader(header);
      return { header, rlp };
    } finally {
      void reader?.cancel().catch(()=>{}); const raw = Buffer.concat(chunks);
      Object.assign(entry, { responseBytes: raw.length, responseSHA256: sha256(raw), rawResponseBase64: raw.toString('base64') }); notify();
    }
  };
  const canonical = async supplied => { const value = await headerRead(scope.header.number, supplied); assert.equal(value.rlp, scope.headerRlp, 'Canonical pin changed'); };
  const witnessResolution = {
    prepare: context => exclusive(context.signal, async () => {
      assert.equal(lower(context.canonicalHash), lower(scope.header.hash)); assertCapturedProgram(capture, context.program);
      assert.equal(keccak256(stringToHex(JSON.stringify(context.program))), context.programDigest);
      activeProgram = context.programDigest; report.fullWitnessComplete = false; report.transitiveStateComplete = false;
      if (!accounts.length) await collect(scope.accounts, context.signal);
      else await canonical(context.signal);
    }),
    resolve: context => exclusive(context.signal, async () => {
      assert.equal(context.programDigest, activeProgram); assert.equal(lower(context.canonicalHash), lower(scope.header.hash));
      assert.ok(report.rounds.length < limits.maximumRounds, 'Resolution round budget exceeded');
      const dependency = structuredClone(context.dependency), key = stable(dependency);
      assert.ok(Number.isSafeInteger(dependency.stage) && dependency.stage >= 0, 'Invalid native stage');
      assert.ok(!seen.has(key), 'Repeated missing dependency made no progress'); seen.add(key);
      report.rounds.push({ programDigest: activeProgram, dependency, dependencySHA256: sha256(key) });
      if (dependency.kind === 'missing-witness') {
        const access = dependency.access; assert.ok(address(access?.address));
        assert.ok(['CreateAccount','CreateContract','SubBalance','AddBalance','GetBalance','GetNonce','SetNonce','GetCodeHash','GetCode','SetCode','GetCodeSize','GetState','SetState','GetTransientState','SetTransientState','SelfDestruct','HasSelfDestructed','Exist','Touch','IsNewContract','Empty','GetStateAndCommittedState'].includes(access.kind), 'Unknown native access kind');
        assert.ok(access.slot === undefined || hash(access.slot), 'Invalid native slot');
        const addr = lower(access.address), slot = access.slot === undefined ? undefined : normalizeWitnessSlot(access.slot);
        const existing = accounts.find(a=>lower(a.address)===addr);
        assert.ok(!existing || (slot !== undefined && !existing.storageProof.some(p=>normalizeWitnessSlot(p.key)===slot)), 'Missing dependency was already proved');
        const known = scope.accounts.find(a=>a.address===addr);
        await collect([{ address: addr, slots: slot === undefined ? [] : [slot], ...(known?.expectedCodeHash ? {expectedCodeHash:known.expectedCodeHash} : {}) }], context.signal);
      } else {
        assert.equal(dependency.kind,'missing-header');
        assert.ok((quantity(dependency.ancestorNumber) && dependency.ancestorHash === undefined) || (hash(dependency.ancestorHash) && dependency.ancestorNumber === undefined));
        const number = dependency.ancestorNumber === undefined ? undefined : BigInt(dependency.ancestorNumber);
        if (number !== undefined) assert.ok(number < BigInt(scope.header.number) && BigInt(scope.header.number)-number <= BigInt(limits.maximumAncestors),'Ancestor outside canonical lookback');
        assert.ok(!headers.some(h=>number === undefined ? lower(h.hash)===lower(dependency.ancestorHash) : BigInt(h.number)===number),'Ancestor was already supplied');
        await canonical(context.signal);
        for (;;) {
          assert.ok(ancestors.length < limits.maximumAncestors,'Ancestor budget exceeded');
          const child = headers.at(-1) ?? scope.header, next = BigInt(child.number)-1n;
          assert.ok(next>=0n,'Ancestor underflow');
          const value = await headerRead('0x'+next.toString(16),context.signal);
          assert.equal(lower(value.header.hash),lower(child.parentHash),'Ancestor hash chain changed');
          headers.push(value.header); ancestors.push(value.rlp);
          if (number === undefined ? lower(value.header.hash)===lower(dependency.ancestorHash) : next===number) break;
        }
        await canonical(context.signal);
      }
    }),
  };
  const close = async () => { if (closed) return; closed=true; abort.abort(); await Promise.all([...clients].map(c=>c.close())); };
  return { witnessResolution, evidence: report, close,
    async createClient() {
      check(); assert.ok(activeProgram && accounts.length,'Prepare canonical witness before process creation');
      const nativeInput = { chainId:11155111,headerRlp:scope.headerRlp,headerHash:scope.header.hash,ancestorHeaders:structuredClone(ancestors),accounts:structuredClone(accounts),stageGasCap:Number(BigInt(scope.header.gasLimit)),program:null };
      const client=await newNativeClient(nativeInput); if(closed || signal?.aborted){await client.close();throw failure('cancelled');}
      clients.add(client);let closing;
      return {request:(...args)=>client.request(...args),close:()=>closing??=(async()=>{try{await client.close();}finally{clients.delete(client);}})()};
    },
    onSession(value) {
      check(); assert.equal(value.canonicalHash,scope.header.hash);assert.equal(value.programDigest,activeProgram);
      assert.equal(value.fullWitnessComplete,true);assert.equal(value.headerHistoryComplete,true);assert.equal(value.stickyStateError,false);assert.equal(value.acceptance,false);
      report.sessions.push(structuredClone(value));report.fullWitnessComplete=true;report.transitiveStateComplete=true;notify();
    },
  };
}
