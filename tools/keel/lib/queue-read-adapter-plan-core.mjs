import { encodeFunctionData, getAddress, parseAbi, zeroAddress } from "viem";

export const queueReadAdapterPlanAbi = parseAbi(["function setReadAdapter(address source)", "function setSupplySource(address source)"]);

export const QUEUE_READ_ADAPTER_LIMITS = Object.freeze({
  reads: 16,
  gates: 8,
  bounds: 4,
});

const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const BYTECODE_DATA = /^0x(?:[0-9a-f]{2})+$/iu;
const SCOPE = /^0x[0-9a-f]{64}$/iu;

function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function uint256(value, label, { allowZero = true } = {}) {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") {
    throw new TypeError(`${label} must be a uint256`);
  }
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new TypeError(`${label} must be a uint256`);
  }
  let result;
  try {
    result = BigInt(value);
  } catch {
    throw new TypeError(`${label} must be a uint256`);
  }
  if (result < 0n || result > MAX_UINT256 || (!allowZero && result === 0n)) {
    throw new RangeError(`${label} must be a uint256`);
  }
  return result;
}

function jsonUint256(value) {
  return value <= MAX_SAFE_INTEGER_BIGINT ? Number(value) : value.toString();
}

function address(value, label, { allowZero = false } = {}) {
  if (typeof value !== "string") throw new TypeError(`${label} must be an address`);
  let result;
  try {
    result = getAddress(value);
  } catch {
    throw new TypeError(`${label} must be an address`);
  }
  if (!allowZero && result === zeroAddress) throw new RangeError(`${label} must be nonzero`);
  return result;
}

function scope(value) {
  if (typeof value !== "string" || !SCOPE.test(value)) {
    throw new TypeError("scope must be a 32-byte hex value");
  }
  return value.toLowerCase();
}

function dynamicData(spec, label) {
  const target = address(spec.target, `${label}.target`);
  let data;
  if (spec.getter !== undefined) {
    if (typeof spec.getter !== "string" || spec.getter.trim() === "" || spec.getter.includes(";")) {
      throw new TypeError(`${label}.getter must be one function signature`);
    }
    if (spec.data !== undefined) throw new TypeError(`${label} cannot contain getter and data`);
    const args = spec.args === undefined ? [] : spec.args;
    if (!Array.isArray(args)) throw new TypeError(`${label}.args must be an array`);
    let abi;
    try {
      abi = parseAbi([`function ${spec.getter}`]);
      if (abi.length !== 1 || abi[0].type !== "function") throw new Error("not one function");
      data = encodeFunctionData({ abi, functionName: abi[0].name, args });
    } catch (error) {
      throw new TypeError(`${label}.getter and args are not encodable`, { cause: error });
    }
  } else if (spec.data !== undefined) {
    if (spec.args !== undefined) throw new TypeError(`${label}.data cannot contain args`);
    if (typeof spec.data !== "string" || !BYTECODE_DATA.test(spec.data)) {
      throw new TypeError(`${label}.data must be even-length hex calldata`);
    }
    data = spec.data.toLowerCase();
  } else {
    throw new TypeError(`${label} requires getter, data, or value`);
  }
  const byteLength = (data.length - 2) / 2;
  if (byteLength < 4 || byteLength > 260) throw new RangeError(`${label} calldata must be 4..260 bytes`);
  return { target, data, fixedValue: 0n };
}

function compileRead(spec, label) {
  object(spec, label);
  if (spec.value !== undefined) {
    if (spec.target !== undefined || spec.getter !== undefined || spec.data !== undefined || spec.args !== undefined) {
      throw new TypeError(`${label}.value cannot be combined with a dynamic read`);
    }
    if (typeof spec.value !== "string") throw new TypeError(`${label}.value must be a string`);
    return { target: zeroAddress, data: "0x", fixedValue: uint256(spec.value, `${label}.value`) };
  }
  return dynamicData(spec, label);
}

function readKey(read) {
  return `${read.target.toLowerCase()}:${read.data.toLowerCase()}:${read.fixedValue.toString()}`;
}

function registry() {
  const reads = [];
  const indexes = new Map();
  return {
    add(spec, label) {
      const read = compileRead(spec, label);
      const key = readKey(read);
      const existing = indexes.get(key);
      if (existing !== undefined) return existing;
      const index = reads.length;
      reads.push(read);
      indexes.set(key, index);
      if (reads.length > QUEUE_READ_ADAPTER_LIMITS.reads) {
        throw new RangeError(`read count exceeds ${QUEUE_READ_ADAPTER_LIMITS.reads}`);
      }
      return index;
    },
    reads,
  };
}

function readArray(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value;
}

/**
 * Prepare an unsigned KeelQueueReadAdapter configuration and optional queue
 * binding call. This function never performs RPC, deployment, signing, or
 * submission; a wallet or contract tool must review and execute the returned
 * calldata separately.
 */
export function planQueueReadAdapter(input) {
  object(input, "input");
  const chainIdBigInt = uint256(input.chainId, "chainId", { allowZero: false });
  const chainId = jsonUint256(chainIdBigInt);
  const queue = address(input.queue, "queue");
  const requestedScope = scope(input.scope);
  const registrationMode = input.registrationMode ?? "live-reads";
  if (registrationMode !== "live-reads" && registrationMode !== "lifecycle-hooks") {
    throw new TypeError("registrationMode must be live-reads or lifecycle-hooks");
  }
  const gatesInput = readArray(input.gates, "gates");
  if (registrationMode === "lifecycle-hooks" && gatesInput.length !== 0) {
    throw new TypeError("Lifecycle hooks must push pause/closure state; omit gates or select live-reads to check them on every join");
  }
  const limitsInput = readArray(input.limits, "limits");
  if (gatesInput.length > QUEUE_READ_ADAPTER_LIMITS.gates) {
    throw new RangeError(`gate count exceeds ${QUEUE_READ_ADAPTER_LIMITS.gates}`);
  }
  if (limitsInput.length > QUEUE_READ_ADAPTER_LIMITS.bounds) {
    throw new RangeError(`bound count exceeds ${QUEUE_READ_ADAPTER_LIMITS.bounds}`);
  }

  const reads = registry();
  const gates = gatesInput.map((entry, index) => {
    object(entry, `gates[${index}]`);
    if (typeof entry.allowedValue !== "boolean") throw new TypeError(`gates[${index}].allowedValue must be boolean`);
    return {
      readIndex: reads.add(entry.read, `gates[${index}].read`),
      allowedValue: entry.allowedValue,
    };
  });

  const zeroRead = () => reads.add({ value: "0" }, "missing bound read");
  const bounds = limitsInput.map((entry, index) => {
    object(entry, `limits[${index}]`);
    if (entry.limit === undefined) throw new TypeError(`limits[${index}].limit is required`);
    return {
      limitIndex: reads.add(entry.limit, `limits[${index}].limit`),
      usedIndex: entry.used === undefined ? zeroRead() : reads.add(entry.used, `limits[${index}].used`),
      restoredIndex:
        entry.restored === undefined ? zeroRead() : reads.add(entry.restored, `limits[${index}].restored`),
    };
  });

  const adapterAddress =
    input.adapterAddress === undefined ? null : address(input.adapterAddress, "adapterAddress");
  const sourceBinding =
    adapterAddress === null
      ? null
      : {
          to: queue,
          value: "0",
          data: encodeFunctionData({
            abi: queueReadAdapterPlanAbi,
            functionName: registrationMode === "lifecycle-hooks" ? "setSupplySource" : "setReadAdapter",
            args: [adapterAddress],
          }),
        };
  const constructorArgs = [requestedScope, reads.reads, gates, bounds];
  return {
    schema: "keel-queue-read-adapter-plan/v1",
    chainId,
    queue,
    scope: requestedScope,
    adapterAddress,
    registrationMode,
    constructorArgs,
    reads: reads.reads,
    gates,
    bounds,
    setReadAdapter: registrationMode === "live-reads" ? sourceBinding : null,
    setSupplySource: registrationMode === "lifecycle-hooks" ? sourceBinding : null,
    calls: sourceBinding === null ? [] : [sourceBinding],
    requiredControllerHooks: registrationMode === "lifecycle-hooks" ? [
      "consume(account, quantity) before every mint, including reward mints",
      "afterMint() after delivery in the same transaction; automatic exhaustion clears the queue",
      "setRegistrationPaused(paused) with every collection pause or closure change",
      "sync() with every capacity change; restored capacity starts open with demand still armed",
      "retire() after afterMint() when a manual-mode collection is exhausted or permanently closed",
    ] : [],
    signed: false,
    submitted: false,
    usage:
      "Review constructorArgs for KeelQueueReadAdapter deployment, then read back scope, reads, gates and bounds before any queue binding. The optional binding call only binds an already verified adapter. Lifecycle-hooks mode requires controller integration before activation; it does not install callbacks into an existing contract.",
  };
}
