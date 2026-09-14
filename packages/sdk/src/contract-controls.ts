import { encodeFunctionData, getAddress, toFunctionSignature, type Abi, type AbiFunction, type AbiParameter } from "viem";

export interface KeelTrackedContract {
  schema: "keel-tracked-contract@1";
  id: string;
  chainId: number;
  address: `0x${string}`;
  name: string;
  kind: "default" | "collection" | "standalone" | "custom" | "proxy" | "implementation";
  source: "sdk-deployment" | "creator-operation" | "factory-readback" | "manual";
  abi: Abi;
  proxy?: { kind: "eip1967" | "beacon" | "minimal" | "custom"; implementation?: `0x${string}`; admin?: `0x${string}`; beacon?: `0x${string}` };
  projectId?: string;
  notes?: string;
  authority: "unverified";
}

export function parseContractAbi(value: unknown): Abi {
  if (typeof value === "string" && value.length > 512_000) throw new TypeError("ABI input exceeds 512 KB.");
  const raw = typeof value === "string" ? JSON.parse(value) : value;
  const abi = raw && !Array.isArray(raw) && typeof raw === "object" && "abi" in raw ? raw.abi : raw;
  if (!Array.isArray(abi) || abi.length > 512 || JSON.stringify(abi).length > 512_000) throw new TypeError("Upload an ABI array or artifact with an abi array (maximum 512 entries / 512 KB).");
  const parameter = (p: unknown, depth: number): void => {
    if (depth > 8 || !p || typeof p !== "object") throw new TypeError("Invalid ABI parameter nesting.");
    const item = p as Record<string, unknown>;
    if (typeof item.type !== "string" || item.type.length > 128 || !/^(?:address|bool|string|bytes(?:[1-9]|[12]\d|3[0-2])?|u?int(?:\d{1,3})?|tuple)(?:\[(?:[1-9]\d{0,4})?\])*$/u.test(item.type)) throw new TypeError("Unsupported ABI parameter type.");
    const integer = /^u?int(\d+)/u.exec(item.type);
    if (integer && (Number(integer[1]) < 8 || Number(integer[1]) > 256 || Number(integer[1]) % 8 !== 0)) throw new TypeError("ABI integer widths must be multiples of 8 from 8 through 256.");
    if (item.name !== undefined && (typeof item.name !== "string" || item.name.length > 128)) throw new TypeError("Invalid ABI parameter name.");
    if (item.type.startsWith("tuple")) {
      if (!Array.isArray(item.components) || item.components.length > 64) throw new TypeError("Tuple components are required.");
      item.components.forEach((p) => parameter(p, depth + 1));
    }
  };
  const signatures = new Set<string>();
  for (const item of abi) {
    if (!item || typeof item !== "object" || !["function", "constructor", "event", "error", "fallback", "receive"].includes(item.type)) throw new TypeError("Invalid ABI entry.");
    if (["function", "event", "error"].includes(item.type) && (typeof item.name !== "string" || !/^[A-Za-z_$][\w$]{0,127}$/u.test(item.name))) throw new TypeError("Invalid ABI entry name.");
    if (item.type === "function" && !["view", "pure", "payable", "nonpayable"].includes(item.stateMutability)) throw new TypeError("Function stateMutability must be explicit.");
    for (const field of ["inputs", "outputs"]) {
      if (item[field] !== undefined && (!Array.isArray(item[field]) || item[field].length > 64)) throw new TypeError("Invalid ABI parameter list.");
      item[field]?.forEach((p: unknown) => parameter(p, 0));
    }
    if (item.type === "function") {
      if (!Array.isArray(item.inputs) || !Array.isArray(item.outputs)) throw new TypeError("Function inputs and outputs are required.");
      const signature = toFunctionSignature(item);
      if (signatures.has(signature)) throw new TypeError("Duplicate ABI function signature.");
      signatures.add(signature);
    }
  }
  return JSON.parse(JSON.stringify(abi)) as Abi;
}

export function contractIdentity(chainId: number, address: string): string {
  if (!Number.isSafeInteger(chainId) || chainId < 1) throw new TypeError("A positive chainId is required.");
  return `${chainId}:${getAddress(address).toLowerCase()}`;
}

export function createTrackedContract(input: Omit<KeelTrackedContract, "schema" | "id" | "authority" | "abi"> & { abi: unknown }): KeelTrackedContract {
  const id = contractIdentity(input.chainId, input.address);
  if (!input.name.trim() || input.name.length > 160) throw new TypeError("Contract name must be 1–160 characters.");
  if (!["default", "collection", "standalone", "custom", "proxy", "implementation"].includes(input.kind)) throw new TypeError("Unknown contract kind.");
  if (!["sdk-deployment", "creator-operation", "factory-readback", "manual"].includes(input.source)) throw new TypeError("Unknown contract source.");
  if (input.notes && input.notes.length > 4000) throw new TypeError("Contract notes exceed 4000 characters.");
  if (input.proxy && (input.kind !== "proxy" || !["eip1967", "beacon", "minimal", "custom"].includes(input.proxy.kind))) throw new TypeError("Invalid proxy relationship.");
  const proxy = input.proxy ? { kind: input.proxy.kind, ...Object.fromEntries(["implementation", "admin", "beacon"].filter((key) => input.proxy![key as "implementation"] !== undefined).map((key) => [key, getAddress(input.proxy![key as "implementation"]!)])) } : undefined;
  return { schema: "keel-tracked-contract@1", id, chainId: input.chainId, address: getAddress(input.address), name: input.name.trim(), kind: input.kind, source: input.source, abi: parseContractAbi(input.abi), ...(proxy ? { proxy } : {}), ...(input.projectId ? { projectId: input.projectId } : {}), ...(input.notes ? { notes: input.notes } : {}), authority: "unverified" };
}

export function contractControls(abi: unknown) {
  return parseContractAbi(abi).filter((item): item is AbiFunction => item.type === "function").map((item) => ({
    signature: toFunctionSignature(item), name: item.name,
    mode: item.stateMutability === "view" || item.stateMutability === "pure" ? "read" as const : "write" as const,
    payable: item.stateMutability === "payable", inputs: item.inputs, outputs: item.outputs,
  }));
}

function coerce(parameter: AbiParameter, value: unknown): unknown {
  const array = /^(.*)\[(\d*)\]$/u.exec(parameter.type);
  if (array) {
    if (!Array.isArray(value) || value.length > 1024 || (array[2] && value.length !== Number(array[2]))) throw new TypeError(`${parameter.name || parameter.type} needs an array of the declared length.`);
    return value.map((v) => coerce({ ...parameter, type: array[1]! } as AbiParameter, v));
  }
  if (parameter.type === "tuple") {
    const parts = (parameter as AbiParameter & { components: readonly AbiParameter[] }).components;
    if (!Array.isArray(value) || value.length !== parts.length) throw new TypeError("Enter tuples as ordered JSON arrays.");
    return parts.map((part, index) => coerce(part, value[index]));
  }
  if (/^u?int/u.test(parameter.type)) {
    if (typeof value !== "string" || value.length > 79 || !/^-?(0|[1-9]\d*)$/u.test(value)) throw new TypeError("Integer arguments must be bounded decimal strings to preserve precision.");
    return BigInt(value);
  }
  if (parameter.type === "bool") {
    if (value === true || value === "true") return true;
    if (value === false || value === "false") return false;
    throw new TypeError("Boolean arguments must be true or false.");
  }
  if (typeof value !== "string") throw new TypeError("Scalar arguments must be strings.");
  if (parameter.type === "address") return getAddress(value);
  return value;
}

export function prepareContractControl(input: { contract: KeelTrackedContract; signature: string; args: readonly unknown[]; valueWei?: string }) {
  if (JSON.stringify(input.args).length > 512_000) throw new TypeError("Contract arguments exceed 512 KB.");
  const contract = createTrackedContract(input.contract);
  const fn = contract.abi.find((item): item is AbiFunction => item.type === "function" && toFunctionSignature(item) === input.signature);
  if (!fn || !Array.isArray(input.args) || input.args.length !== fn.inputs.length) throw new TypeError("Select an exact ABI signature and provide every argument.");
  const args = fn.inputs.map((parameter, index) => coerce(parameter, input.args[index]));
  const valueWei = input.valueWei ?? "0";
  if (!/^(0|[1-9]\d{0,77})$/u.test(valueWei) || BigInt(valueWei) >= 2n ** 256n) throw new TypeError("valueWei must be a uint256 integer string.");
  if (fn.stateMutability !== "payable" && valueWei !== "0") throw new TypeError("Only payable functions can receive native value.");
  return {
    schema: "keel-contract-control@1" as const, status: "review-only" as const,
    chainId: contract.chainId, to: contract.address,
    // Always target the proxy address. Its implementation supplies the ABI, never the call target.
    data: encodeFunctionData({ abi: [fn], functionName: fn.name, args }), valueWei,
    signature: input.signature,
    mode: fn.stateMutability === "view" || fn.stateMutability === "pure" ? "read" as const : "write" as const,
    authority: "unverified" as const, signing: "not-performed", submission: "not-performed",
    requires: ["selected-chain-code", "current-proxy-implementation", "current-account-authority", "simulation", "exact-wallet-review"],
  };
}
