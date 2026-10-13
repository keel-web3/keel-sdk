/** The existing manager selects replacement modules; permanent artwork stays in Hold. */
import { decodeFunctionResult, encodeFunctionData, getAddress, hashTypedData, keccak256, parseAbi, recoverAddress, zeroAddress, zeroHash, type Abi, type Address, type Hex } from "viem";
import { keelManagerAbi } from "./abi.js";
import type { KeelRpcPool } from "./rpc.js";

const ABI = parseAbi(keelManagerAbi);
const BINDINGS = parseAbi([
  "function manager() view returns (address)",
  "function presentationModule() view returns (address)",
  "function composerManager() view returns (address)",
  "function composerModuleId() view returns (bytes32)",
]);
const CONTRACT_SIGNATURE = parseAbi(["function isValidSignature(bytes32 digest,bytes signature) view returns (bytes4)"]);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
function address(value: string): Address { const result = getAddress(value); if (result === zeroAddress) throw new TypeError("Use a nonzero contract address."); return result; }
function digest(value: string): Hex { if (!/^0x[0-9a-f]{64}$/iu.test(value) || same(value, zeroHash)) throw new TypeError("Use a nonzero bytes32 commitment."); return value as Hex; }
type Module = { active: Address; revision: bigint; frozen: boolean; codeHash: Hex };
export interface KeelManagerModuleInspectionInput {
  readonly chainId: number;
  readonly manager?: Address;
  readonly store?: Address;
  readonly collection?: Address;
  readonly consumer?: Address;
  readonly moduleIds?: readonly Hex[];
}
const read = async (pool: KeelRpcPool, at: Hex, block: Hex, name: string, args: readonly unknown[] = [], abi: Abi = ABI): Promise<any> => {
  const raw = await pool.request({ method: "eth_call", params: [{ to: at, data: encodeFunctionData({ abi, functionName: name, args }) }, block] });
  if (typeof raw !== "string" || !/^0x[0-9a-f]*$/iu.test(raw)) throw new TypeError(`Invalid ${name} read.`);
  return decodeFunctionResult({ abi, functionName: name, data: raw as Hex });
};
const codeHash = async (pool: KeelRpcPool, at: Address, block: Hex) => {
  const code = await pool.request({ method: "eth_getCode", params: [at, block] });
  if (typeof code !== "string" || !/^0x(?:[0-9a-f]{2})+$/iu.test(code)) throw new TypeError("Manager/module has no runtime code.");
  return keccak256(code as Hex);
};

/** Pins manager records, active runtime hashes and optional collection bindings to one chain block. No writes. */
export async function inspectKeelManagerModules(pool: KeelRpcPool, input: KeelManagerModuleInspectionInput) {
  if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0 || (!input.manager && !input.store && !input.collection && !input.consumer)) throw new TypeError("Choose an exact chain and manager, store or managed consumer.");
  const chain = await pool.request({ method: "eth_chainId" });
  if (typeof chain !== "string" || Number(BigInt(chain)) !== input.chainId) throw new TypeError("Selected-chain manager identity mismatch.");
  const head = await pool.request({ method: "eth_getBlockByNumber", params: ["latest", false], requireResult: true }) as { number: Hex; hash: Hex; timestamp: Hex };
  if (!head || !/^0x[0-9a-f]+$/iu.test(head.number) || !/^0x[0-9a-f]{64}$/iu.test(head.hash) || !/^0x[0-9a-f]+$/iu.test(head.timestamp)) throw new TypeError("Invalid manager snapshot block.");
  const block = head.number;
  let manager = input.manager && address(input.manager), consumer = input.consumer && address(input.consumer);
  const ids = [...(input.moduleIds ?? [])].map(digest);
  if (ids.length > 64 || new Set(ids.map(id => id.toLowerCase())).size !== ids.length) throw new TypeError("Use at most 64 unique module IDs.");
  if (input.collection) {
    const bound = address(await read(pool, address(input.collection), block, "presentationModule", [], BINDINGS));
    if (consumer && !same(consumer, bound)) throw new TypeError("Collection/presentation module mismatch.");
    consumer = bound;
  }
  if (consumer) {
    const bound = address(await read(pool, consumer, block, "composerManager", [], BINDINGS));
    if (manager && !same(manager, bound)) throw new TypeError("Consumer/manager binding mismatch.");
    manager = bound;
    const id = digest(await read(pool, consumer, block, "composerModuleId", [], BINDINGS));
    if (!ids.some(current => same(current, id))) ids.unshift(id);
  }
  if (input.store) {
    const bound = address(await read(pool, address(input.store), block, "manager", [], BINDINGS));
    if (manager && !same(manager, bound)) throw new TypeError("Hold/manager binding mismatch.");
    manager = bound;
  }
  if (!manager) throw new TypeError("Managed publication has no manager binding.");
  if (ids.length > 64) throw new TypeError("Managed consumer exceeds the module inspection bound.");
  const runtimeCodeHash = await codeHash(pool, manager, block);
  const [governors, state, paused] = await Promise.all([
    read(pool, manager, block, "governors"), read(pool, manager, block, "governanceState"), read(pool, manager, block, "paused"),
  ]) as [Address[], { threshold: bigint; nonce: bigint; epoch: bigint; changeNonce: bigint }, boolean];
  if (!governors.length || state.threshold < 1n || state.threshold > BigInt(governors.length)) throw new TypeError("Invalid manager quorum.");
  const modules = [];
  for (const moduleId of ids) {
    const record = await read(pool, manager, block, "module", [moduleId]) as Module;
    if (same(record.active, zeroAddress)) {
      if (record.revision !== 0n || record.frozen || !same(record.codeHash, zeroHash)) throw new TypeError("Invalid absent module record.");
      modules.push({ moduleId, ...record, status: "unregistered" as const });
      continue;
    }
    const resolved = await read(pool, manager, block, "resolveModule", [moduleId]) as Address;
    const observedCodeHash = await codeHash(pool, address(record.active), block);
    if (!same(resolved, record.active) || record.revision === 0n || !same(observedCodeHash, record.codeHash)) throw new TypeError("Active manager module runtime/binding mismatch.");
    modules.push({ moduleId, ...record, observedCodeHash, status: record.frozen ? "frozen" as const : "replaceable" as const });
  }
  const canonical = await pool.request({ method: "eth_getBlockByNumber", params: [block, false], requireResult: true }) as { hash?: string };
  if (!canonical?.hash || !same(canonical.hash, head.hash)) throw new TypeError("Manager snapshot was reorganized.");
  return { schema: "keel-manager-modules@1" as const, chainId: input.chainId, manager, runtimeCodeHash,
    blockNumber: BigInt(block).toString(), blockHash: head.hash, blockTimestamp: BigInt(head.timestamp),
    ...(input.store ? { store: input.store } : {}), ...(input.collection ? { collection: input.collection } : {}), ...(consumer ? { consumer } : {}),
    governors, state, paused, modules, writes: 0, signing: "not-performed" as const, submission: "not-performed" as const,
    moduleEnumeration: "requested records and actual consumer binding only; an empty result does not establish that no modules exist",
    next: ids.length ? "Verify consumer compatibility before preparing governed replacement." : "Find managedRoute collection/module IDs through keel-library-search, then inspect their actual consuming route.",
    scope: "manager directory and optional consumer binding; unrelated immutable contracts do not follow its pointers" };
}

const TYPES = { GovernanceAction: [{ name: "target", type: "address" }, { name: "value", type: "uint256" }, { name: "dataHash", type: "bytes32" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint64" }, { name: "epoch", type: "uint64" }] } as const;
/** Exact unsigned manager self-call. Caller supplies the reviewed prior revision and replacement runtime hash. */
export async function prepareKeelManagerModuleReplacement(pool: KeelRpcPool, input: KeelManagerModuleInspectionInput & {
  readonly moduleId: Hex; readonly replacement: Address; readonly replacementCodeHash: Hex;
  readonly expectedCurrent: Address; readonly expectedRevision: bigint; readonly deadline?: bigint;
}) {
  const moduleId = digest(input.moduleId), replacement = address(input.replacement), expectedHash = digest(input.replacementCodeHash);
  const snapshot = await inspectKeelManagerModules(pool, { ...input, moduleIds: [moduleId] });
  const current = snapshot.modules.find(record => same(record.moduleId, moduleId))!;
  if (!same(current.active, getAddress(input.expectedCurrent)) || current.revision !== input.expectedRevision) throw new TypeError("Manager module changed; refresh the reviewed revision.");
  if (current.frozen) throw new TypeError("This manager module is permanently frozen.");
  const block = `0x${BigInt(snapshot.blockNumber).toString(16)}` as Hex;
  if (!same(await codeHash(pool, replacement, block), expectedHash)) throw new TypeError("Replacement runtime differs from the reviewed code hash.");
  const deadline = input.deadline ?? snapshot.blockTimestamp + 3600n;
  if (deadline <= snapshot.blockTimestamp || deadline >= 1n << 64n) throw new TypeError("Use a future uint64 governance deadline.");
  const call = { target: snapshot.manager, value: 0n, data: encodeFunctionData({ abi: ABI, functionName: "configureModule", args: [moduleId, replacement, expectedHash] }) };
  const typedData = { domain: { name: "Keel Manager", version: "1", chainId: snapshot.chainId, verifyingContract: snapshot.manager }, types: TYPES, primaryType: "GovernanceAction", message: { target: call.target, value: call.value, dataHash: keccak256(call.data), nonce: snapshot.state.nonce, deadline, epoch: snapshot.state.epoch } } as const;
  const signingDigest = hashTypedData(typedData);
  const actual = await read(pool, snapshot.manager, block, "governanceActionDigest", [call, deadline]);
  if (!same(actual, signingDigest)) throw new TypeError("Deployed manager signing schema mismatch.");
  return { schema: "keel-manager-module-replacement@1" as const, snapshot, moduleId, replacement, replacementCodeHash: expectedHash,
    current, deadline, call, request: { typedData, digest: signingDigest, members: snapshot.governors, threshold: snapshot.state.threshold },
    requiredGates: ["consumer compatibility and storage layout", "existing artwork/resource byte parity and expected tokenURI context", "replacement read gas", "fresh manager nonce and revision", "governance receipt and module readback"],
    signing: "not-performed" as const, submission: "not-performed" as const, writes: 0 };
}
export type KeelManagerModuleReplacementPlan = Awaited<ReturnType<typeof prepareKeelManagerModuleReplacement>>;

/** Verifies the governor packets and fresh module/nonce before returning normal executeGovernance calldata. */
export async function buildKeelManagerModuleReplacementCall(pool: KeelRpcPool, plan: KeelManagerModuleReplacementPlan, packets: readonly { signer: Address; signature: Hex }[]) {
  const fresh = await inspectKeelManagerModules(pool, { chainId: plan.snapshot.chainId, manager: plan.snapshot.manager, moduleIds: [plan.moduleId] });
  const current = fresh.modules[0]!;
  if (fresh.blockTimestamp >= plan.deadline || fresh.state.nonce !== plan.snapshot.state.nonce || fresh.state.epoch !== plan.snapshot.state.epoch
    || fresh.state.threshold !== plan.snapshot.state.threshold || !same(current.active, plan.current.active) || current.revision !== plan.current.revision
    || current.frozen || !same(current.codeHash, plan.current.codeHash) || fresh.governors.join().toLowerCase() !== plan.snapshot.governors.join().toLowerCase()) throw new TypeError("Manager replacement plan expired or changed; prepare it again.");
  const block = `0x${BigInt(fresh.blockNumber).toString(16)}` as Hex;
  if (!same(await codeHash(pool, plan.replacement, block), plan.replacementCodeHash)) throw new TypeError("Replacement runtime changed.");
  const expectedCall = { target: fresh.manager, value: 0n, data: encodeFunctionData({ abi: ABI, functionName: "configureModule", args: [plan.moduleId, plan.replacement, plan.replacementCodeHash] }) };
  const actualDigest = await read(pool, fresh.manager, block, "governanceActionDigest", [expectedCall, plan.deadline]);
  if (!same(plan.call.target, expectedCall.target) || plan.call.value !== 0n || !same(plan.call.data, expectedCall.data)
    || !same(hashTypedData(plan.request.typedData), plan.request.digest) || !same(actualDigest, plan.request.digest)) throw new TypeError("Manager replacement call or signing request was modified.");
  const signatures = [...packets].map(packet => ({ signer: getAddress(packet.signer), signature: packet.signature })).sort((a, b) => BigInt(a.signer) < BigInt(b.signer) ? -1 : 1);
  if (BigInt(signatures.length) < fresh.state.threshold || signatures.length > fresh.governors.length) throw new TypeError("The exact manager quorum is required.");
  for (let i = 0; i < signatures.length; i++) {
    const packet = signatures[i]!;
    if (i && same(packet.signer, signatures[i - 1]!.signer) || !fresh.governors.some(member => same(member, packet.signer))) throw new TypeError("Invalid or duplicate governor signature.");
    const signerCode = await pool.request({ method: "eth_getCode", params: [packet.signer, block] });
    if (typeof signerCode !== "string" || !/^0x(?:[0-9a-f]{2})*$/iu.test(signerCode)) throw new TypeError("Invalid governor runtime read.");
    const valid = signerCode === "0x"
      ? same(await recoverAddress({ hash: plan.request.digest, signature: packet.signature }), packet.signer)
      : same(await read(pool, packet.signer, block, "isValidSignature", [plan.request.digest, packet.signature], CONTRACT_SIGNATURE), "0x1626ba7e");
    if (!valid) throw new TypeError("Invalid governor signature.");
  }
  return { target: plan.snapshot.manager, value: 0n, data: encodeFunctionData({ abi: ABI, functionName: "executeGovernance", args: [plan.call, plan.deadline, signatures] }) };
}
