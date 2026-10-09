import { KeelPublicationSimulationError, type KeelPreflightTransport } from "./publication-preflight.js";
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
  const select = async () => {
    let rpc: KeelSimulationSocket | undefined;
    let stage = "connection";
    const unsupported = (message: string): never => { throw new KeelPublicationSimulationError("unsupported-simulation", message, { stage }); };
    try {
      rpc = await connect();
      stage = "chain";
      if (quantity(await call(rpc, { method: "eth_chainId", params: [] })) !== 11155111n) throw new KeelPublicationSimulationError("wrong-chain", "The configured simulator did not return Sepolia.", { stage });
      stage = "snapshot";
      const block = object(await call(rpc, { method: "eth_getBlockByNumber", params: ["latest", false] }));
      const timestamp = quantity(block?.timestamp), limit = quantity(block?.gasLimit), number = quantity(block?.number), baseFee = quantity(block?.baseFeePerGas);
      if (timestamp === undefined || limit === undefined || limit <= 0n || number === undefined || baseFee === undefined
        || typeof block?.hash !== "string" || !/^0x[0-9a-f]{64}$/iu.test(block.hash)) unsupported("The simulator did not return a verifiable selected-chain snapshot.");
      const policy = resolveKeelTransactionGasPolicy({ chainId: 11155111, blockTimestamp: timestamp!, blockGasLimit: limit! });
      // This modest control proves API behavior, not full-network capacity.
      // Each actual project envelope is checked again, including silent clamping.
      const probeGas = policy.maximumTotalGas < 100_000n ? policy.maximumTotalGas : 100_000n;
      const gas = `0x${probeGas.toString(16)}`;
      // Only public constants; no creator address, project bytes or wallet access.
      // Read actual pinned public state; qualification and project calls are override-free.
      const sender = "0x0000000000000000000000000000000000000000";
      stage = "public-account";
      const nonce = quantity(await call(rpc, { method: "eth_getTransactionCount", params: [sender, block!.number] }));
      const balance = quantity(await call(rpc, { method: "eth_getBalance", params: [sender, block!.number] }));
      const code = await call(rpc, { method: "eth_getCode", params: [sender, block!.number] });
      if (nonce === undefined || nonce >= 18_446_744_073_709_551_614n || balance === undefined || code !== "0x") unsupported("The fixed public qualification account did not return a usable pinned nonce, balance and empty code.");
      const gasPrice = `0x${(baseFee! * 2n + 1n).toString(16)}`;
      if (balance! < (probeGas + 21_000n) * BigInt(gasPrice)) unsupported("The fixed public qualification account lacks the observed balance for an override-free strict capacity check.");
      const empty = { from: sender, to: sender, value: "0x0", data: "0x", gas, nonce: `0x${nonce!.toString(16)}`, gasPrice };
      const nextNonce = `0x${(nonce! + 1n).toString(16)}`;
      const blockStateCalls = [{ calls: [empty] }, { calls: [{ ...empty, gas: "0x5208", nonce: nextNonce }] }];
      const probe = (validation: boolean, blocks = blockStateCalls) => ({ method: "eth_simulateV1", params: [{ blockStateCalls: blocks, validation, traceTransfers: false, returnFullTransactions: true }, block!.number] });
      for (const validation of [false, true]) {
        stage = validation ? "strict-capacity" : "read-capacity";
        const request = probe(validation), evidence = await call(rpc, request);
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
      try { await call(rpc, probe(true, [{ calls: [{ ...empty, gas: "0x5208", nonce: nextNonce }] }])); }
      catch (error) { if (object(error)?.code === -38011) rejectedNonce = true; else throw error; }
      if (!rejectedNonce) unsupported("The simulator did not enforce strict transaction nonce validation.");
      stage = "snapshot-recheck";
      const current = object(await call(rpc, { method: "eth_getBlockByNumber", params: [block!.number, false] }));
      if (current?.hash !== block!.hash || current?.number !== block!.number || current?.timestamp !== block!.timestamp || current?.gasLimit !== block!.gasLimit)
        throw new KeelPublicationSimulationError("chain-reorganized", "The selected simulator snapshot changed during qualification. Recheck from a current block.", { stage });
      if (closed) throw new KeelPublicationSimulationError("rpc-unavailable", "The pinned simulator transport was closed.");
      qualifiedProbeGas = probeGas;
      return rpc;
    } catch (error) {
      rpc?.close();
      if (error instanceof KeelPublicationSimulationError) throw error;
      if (object(error)?.code === -32601) unsupported("The configured RPC does not support the required publication-simulation method.");
      // Do not surface endpoint URLs, provider internals or arbitrary error text.
      throw new KeelPublicationSimulationError("rpc-unavailable", "The configured simulator could not complete public capability qualification. No project calldata was sent.", { stage });
    }
  };
  return {
    get qualifiedProbeGas() { return closed ? undefined : qualifiedProbeGas; },
    async request(request) {
      if (closed) throw new KeelPublicationSimulationError("rpc-unavailable", "The pinned simulator transport was closed.");
      // Cache failure too: repeated calls must not silently reconnect or replay.
      selected ??= select();
      const rpc = await selected;
      if (rpc.socket.readyState !== 1) throw new KeelPublicationSimulationError("rpc-unavailable", "The pinned simulator connection closed. Recheck the saved plan before a wallet review.");
      const exact = request.method === "eth_simulateV1" ? { ...request, params: [{ ...object(request.params[0]), returnFullTransactions: true }, ...request.params.slice(1)] } : request;
      const result = await call(rpc, exact);
      if (request.method === "eth_simulateV1") assertKeelSimulationEnvelopes(exact, result);
      return result;
    },
    async close() { if (closed) return; closed = true; if (selected) await selected.then(rpc => rpc.close(), () => undefined); },
  };
}
