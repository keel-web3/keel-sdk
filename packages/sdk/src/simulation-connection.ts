import { KeelPublicationSimulationError, keelSimulationTransportFailure, type KeelPreflightTransport } from "./publication-preflight.js";
import { assertKeelAmsterdamSimulationHeader, resolveKeelTransactionGasPolicy } from "./transaction-gas-policy.js";

export interface KeelSimulationSocket {
  readonly socket: { readonly readyState: number };
  requestAsync(input: { readonly body: { readonly method: string; readonly params: readonly unknown[] }; readonly timeout: number }): Promise<{ readonly result?: unknown; readonly error?: unknown }>;
  close(): void;
}
const object = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const quantity = (value: unknown): bigint | undefined => typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]*)$/iu.test(value) ? BigInt(value) : undefined;
const call = async (rpc: KeelSimulationSocket, body: { readonly method: string; readonly params: readonly unknown[] }) => {
  const response = await rpc.requestAsync({ body, timeout: 90_000 });
  if (response.error) throw response.error;
  return response.result;
};

/** Reject silent RPC gas clamping before interpreting an apparent EVM revert. */
export function assertKeelSimulationEnvelopes(request: { readonly params: readonly unknown[] }, result: unknown): void {
  const blocks = object(request.params[0])?.blockStateCalls;
  if (!Array.isArray(blocks) || !Array.isArray(result) || blocks.length !== result.length) throw new KeelPublicationSimulationError("unsupported-simulation", "The simulator did not return complete transaction envelopes.");
  for (const [index, block] of blocks.entries()) {
    const calls = object(block)?.calls, transactions = object(result[index])?.transactions;
    if (!Array.isArray(calls) || !Array.isArray(transactions) || calls.length !== transactions.length) throw new KeelPublicationSimulationError("unsupported-simulation", "The simulator did not return complete transaction envelopes.");
    for (const [i, planned] of calls.entries()) {
      const requested = quantity(object(planned)?.gas), actual = quantity(object(transactions[i])?.gas);
      if (requested === undefined || actual === undefined) throw new KeelPublicationSimulationError("unsupported-simulation", "The simulator omitted the exact transaction gas envelope.");
      if (actual < requested) throw new KeelPublicationSimulationError("provider-limit", "The simulator silently reduced the requested transaction gas. Your saved plan is unchanged; use a compatible provider before wallet approval.", { requestedGasLimit: requested.toString(), providerGasCap: actual.toString() });
      if (actual !== requested) throw new KeelPublicationSimulationError("unsupported-simulation", "The simulator changed the requested transaction gas envelope.");
    }
  }
}

/** Qualify behavior on the socket retained for project calldata, never client branding.
 * These fixed public probes are not a publication proof. Exact project calls still
 * undergo their own override-free fork, nonce, fee, gas and complete-return checks. */
export function createPinnedKeelSepoliaSimulationTransport(connect: () => Promise<KeelSimulationSocket>): KeelPreflightTransport & { readonly qualifiedProbeGas: bigint | undefined; close(): Promise<void> } {
  let selected: Promise<KeelSimulationSocket> | undefined;
  let closed = false;
  let qualifiedProbeGas: bigint | undefined;
  const active = new Map<KeelSimulationSocket, number>();
  const retired = new Set<KeelSimulationSocket>();
  const closedSockets = new WeakSet<KeelSimulationSocket>();
  const drainResolvers = new Map<KeelSimulationSocket, () => void>();
  let replacementReady: Promise<void> | undefined;
  const closeSocket = (rpc: KeelSimulationSocket) => { if (!closedSockets.has(rpc)) { closedSockets.add(rpc); rpc.close(); } retired.delete(rpc); drainResolvers.get(rpc)?.(); drainResolvers.delete(rpc); };
  const gasClamp = (error: unknown): error is KeelPublicationSimulationError => error instanceof KeelPublicationSimulationError
    && error.kind === "provider-limit" && typeof error.diagnostic?.requestedGasLimit === "string" && typeof error.diagnostic?.providerGasCap === "string";
  const select = async (requiredGas?: bigint) => {
    let rpc: KeelSimulationSocket | undefined;
    let stage = "connection";
    let method: string | undefined;
    const qualifiedCall = (body: { readonly method: string; readonly params: readonly unknown[] }) => { method = body.method; return call(rpc!, body); };
    const unsupported = (message: string): never => { throw new KeelPublicationSimulationError("unsupported-simulation", message, { stage }); };
    try {
      rpc = await connect();
      stage = "chain";
      if (quantity(await qualifiedCall({ method: "eth_chainId", params: [] })) !== 11155111n) throw new KeelPublicationSimulationError("wrong-chain", "The configured simulator did not return Sepolia.", { stage });
      stage = "snapshot";
      const block = object(await qualifiedCall({ method: "eth_getBlockByNumber", params: ["latest", false] }));
      const timestamp = quantity(block?.timestamp), limit = quantity(block?.gasLimit), number = quantity(block?.number), baseFee = quantity(block?.baseFeePerGas);
      if (timestamp === undefined || limit === undefined || limit <= 0n || number === undefined || baseFee === undefined
        || typeof block?.hash !== "string" || !/^0x[0-9a-f]{64}$/iu.test(block.hash)) unsupported("The simulator did not return a verifiable selected-chain snapshot.");
      const policy = resolveKeelTransactionGasPolicy({ chainId: 11155111, blockTimestamp: timestamp!, blockGasLimit: limit! });
      // When the program is known, qualify its required envelope (bounded by
      // the selected chain), not only a 100k control. Small plans should not
      // require a provider's full block capacity. Every actual response is
      // still checked, including a socket first selected by an ordinary read.
      const requiredProbeGas = requiredGas ?? 100_000n;
      const probeGas = requiredProbeGas < policy.maximumTotalGas ? requiredProbeGas : policy.maximumTotalGas;
      const gas = `0x${probeGas.toString(16)}`;
      // Only public constants; no creator address, project bytes or wallet access.
      // Read actual pinned public state; qualification and project calls are override-free.
      const sender = "0x0000000000000000000000000000000000000000";
      stage = "public-account";
      const nonce = quantity(await qualifiedCall({ method: "eth_getTransactionCount", params: [sender, block!.number] }));
      const balance = quantity(await qualifiedCall({ method: "eth_getBalance", params: [sender, block!.number] }));
      const code = await qualifiedCall({ method: "eth_getCode", params: [sender, block!.number] });
      if (nonce === undefined || nonce >= 18_446_744_073_709_551_614n || balance === undefined || code !== "0x") unsupported("The fixed public qualification account did not return a usable pinned nonce, balance and empty code.");
      const gasPrice = `0x${(baseFee! * 2n + 1n).toString(16)}`;
      if (balance! < (probeGas + 21_000n) * BigInt(gasPrice)) unsupported("The fixed public qualification account lacks the observed balance for an override-free strict capacity check.");
      const empty = { from: sender, to: sender, value: "0x0", data: "0x", gas, nonce: `0x${nonce!.toString(16)}`, gasPrice };
      const nextNonce = `0x${(nonce! + 1n).toString(16)}`;
      const blockStateCalls = [{ calls: [empty] }, { calls: [{ ...empty, gas: "0x5208", nonce: nextNonce }] }];
      const probe = (validation: boolean, blocks = blockStateCalls) => ({ method: "eth_simulateV1", params: [{ blockStateCalls: blocks, validation, traceTransfers: false, returnFullTransactions: true }, block!.number] });
      for (const validation of [false, true]) {
        stage = validation ? "strict-capacity" : "read-capacity";
        const request = probe(validation), evidence = await qualifiedCall(request);
        assertKeelSimulationEnvelopes(request, evidence);
        let parent = block!;
        for (const [index, item] of (evidence as unknown[]).entries()) {
          const header = object(item)!;
          const parentSlot = quantity(parent.slotNumber);
          try { assertKeelAmsterdamSimulationHeader(policy, header, { hash: String(parent.hash), number: quantity(parent.number) ?? -1n,
            timestamp: quantity(parent.timestamp) ?? -1n, ...(parentSlot === undefined ? {} : { slotNumber: parentSlot }) }); }
          catch { unsupported("The simulator did not return fork-correct qualification headers linked to the selected snapshot."); }
          const results = header.calls, transactions = header.transactions;
          const result = Array.isArray(results) && results.length === 1 ? object(results[0]) : undefined;
          const transaction = Array.isArray(transactions) ? object(transactions[0]) : undefined;
          const used = quantity(result?.gasUsed), maximum = quantity(result?.maxUsedGas);
          if (result?.status !== "0x1" || result.error !== undefined || result.returnData !== "0x" || used === undefined || used <= 0n
            || maximum === undefined || maximum < used || maximum > BigInt(blockStateCalls[index]!.calls[0]!.gas)) unsupported("The simulator did not report successful public-call execution and bounded pre-refund gas.");
          if (quantity(transaction?.nonce) !== nonce! + BigInt(index) || quantity(transaction?.gasPrice) !== BigInt(gasPrice)) unsupported("The simulator did not preserve the public qualification nonce and fee envelope.");
          parent = header;
        }
      }
      // A successful validation:true call alone cannot show that validation was
      // actually enabled. Demand the specified nonce-too-high rejection as well.
      stage = "strict-nonce";
      let rejectedNonce = false;
      try { await qualifiedCall(probe(true, [{ calls: [{ ...empty, gas: "0x5208", nonce: nextNonce }] }])); }
      catch (error) { if (object(error)?.code === -38011) rejectedNonce = true; else throw error; }
      if (!rejectedNonce) unsupported("The simulator did not enforce strict transaction nonce validation.");
      stage = "snapshot-recheck";
      const current = object(await qualifiedCall({ method: "eth_getBlockByNumber", params: [block!.number, false] }));
      if (current?.hash !== block!.hash || current?.number !== block!.number || current?.timestamp !== block!.timestamp || current?.gasLimit !== block!.gasLimit)
        throw new KeelPublicationSimulationError("chain-reorganized", "The selected simulator snapshot changed during qualification. Recheck from a current block.", { stage });
      if (closed) throw new KeelPublicationSimulationError("rpc-unavailable", "The pinned simulator transport was closed.");
      qualifiedProbeGas = probeGas;
      return rpc;
    } catch (error) {
      const classified = keelSimulationTransportFailure(error, { ...(method === undefined ? {} : { method }), phase: "public-qualification", ...(rpc === undefined ? {} : { socketReadyState: rpc.socket.readyState }) });
      if (rpc) closeSocket(rpc);
      throw new KeelPublicationSimulationError(classified.kind, classified.kind === "rpc-unavailable"
        ? "The configured simulator could not complete public capability qualification. No project calldata was sent." : classified.message,
        { ...classified.diagnostic, stage });
    }
  };
  return {
    get qualifiedProbeGas() { return closed ? undefined : qualifiedProbeGas; },
    async request(request) {
      if (closed) throw new KeelPublicationSimulationError("rpc-unavailable", "The pinned simulator transport was closed.");
      const exact = request.method === "eth_simulateV1" ? structuredClone({ ...request, params: [{ ...object(request.params[0]), returnFullTransactions: true }, ...request.params.slice(1)] }) : request;
      // Only a confirmed gas-clamp response can reselect this approved endpoint.
      // Never lower gas, change calldata or replay a write. The full ephemeral
      // program is self-contained; its exact numbered snapshot must also match.
      const tag = request.method === "eth_simulateV1" ? exact.params[1] : undefined;
      let requiredGas: bigint | undefined;
      const blocks = request.method === "eth_simulateV1" ? object(exact.params[0])?.blockStateCalls : undefined;
      if (Array.isArray(blocks)) for (const block of blocks) {
        const calls = object(block)?.calls;
        if (Array.isArray(calls)) for (const item of calls) {
          const gas = quantity(object(item)?.gas);
          if (gas !== undefined && gas > 0n && (requiredGas === undefined || gas > requiredGas)) requiredGas = gas;
        }
      }
      let snapshotHash: string | undefined;
      for (let attempt = 1; attempt <= 3; attempt++) {
        if (closed) throw new KeelPublicationSimulationError("rpc-unavailable", "The pinned simulator transport was closed.");
        // viem caches sockets by endpoint until close(). Do not ask the factory
        // for a replacement while a retired socket still has active readers.
        const candidate = selected ??= replacementReady ? replacementReady.then(() => {
          if (closed) throw new KeelPublicationSimulationError("rpc-unavailable", "The pinned simulator transport was closed.");
          return select(requiredGas);
        }) : select(requiredGas);
        let rpc: KeelSimulationSocket | undefined;
        let acquired = false;
        let method = exact.method;
        try {
          rpc = await candidate;
          if (closed || rpc.socket.readyState !== 1) throw new KeelPublicationSimulationError("rpc-unavailable", "The pinned simulator connection closed. Recheck the saved plan before a wallet review.");
          active.set(rpc, (active.get(rpc) ?? 0) + 1); acquired = true;
          if (request.method === "eth_simulateV1" && quantity(tag) !== undefined) {
            method = "eth_getBlockByNumber";
            const snapshot = object(await call(rpc, { method: "eth_getBlockByNumber", params: [tag, false] }));
            if (!snapshot || snapshot.number !== tag || typeof snapshot.hash !== "string" || !/^0x[0-9a-f]{64}$/iu.test(snapshot.hash)
              || snapshotHash !== undefined && snapshot.hash.toLowerCase() !== snapshotHash)
              throw new KeelPublicationSimulationError("chain-reorganized", "The replacement simulator could not verify the exact selected block. Recheck the saved plan.");
            snapshotHash = snapshot.hash.toLowerCase();
          }
          method = exact.method;
          const result = await call(rpc, exact);
          if (request.method === "eth_simulateV1") assertKeelSimulationEnvelopes(exact, result);
          if (closed) throw new KeelPublicationSimulationError("rpc-unavailable", "The pinned simulator transport was closed.");
          return result;
        } catch (error) {
          const classifiedError = error instanceof KeelPublicationSimulationError ? error : keelSimulationTransportFailure(error, { method, phase: "project-request", ...(rpc === undefined ? {} : { socketReadyState: rpc.socket.readyState }) });
          const unavailable = classifiedError.kind === "rpc-unavailable";
          if (!gasClamp(classifiedError) && !unavailable) throw classifiedError;
          if (rpc) retired.add(rpc);
          if (selected === candidate) {
            selected = undefined; qualifiedProbeGas = undefined;
            if (rpc) { const retiring = rpc; replacementReady = new Promise(resolve => { drainResolvers.set(retiring, resolve); }); }
          }
          // A failed qualification promise or disconnected retained socket must
          // not poison every subsequent saved-plan check. Do not replay this
          // request on an uncertain failure: a fresh check requalifies first.
          if (rpc && !acquired) closeSocket(rpc);
          if (unavailable) throw classifiedError;
          // A symbolic block tag could select different state on replay. Keep
          // that request blocked, even though a later fresh read may requalify.
          if (attempt === 3 || rpc && quantity(tag) === undefined) throw new KeelPublicationSimulationError("provider-limit",
            "Compatible simulation capacity is temporarily unavailable after bounded checks. Retry the saved plan; no wallet request was sent and its gas limits were not reduced.",
            { ...classifiedError.diagnostic, connectionAttempts: attempt });
        } finally {
          if (rpc && acquired) {
            const count = active.get(rpc)! - 1;
            if (count) active.set(rpc, count); else { active.delete(rpc); if (retired.has(rpc)) closeSocket(rpc); }
          }
        }
      }
      throw new KeelPublicationSimulationError("rpc-unavailable", "The simulator could not verify the saved plan.");
    },
    async close() { if (closed) return; closed = true; for (const rpc of retired) closeSocket(rpc); if (selected) await selected.then(closeSocket, () => undefined); },
  };
}
