import { decodeFunctionData, encodeDeployData, encodeFunctionData, getAddress, keccak256, parseAbi, toFunctionSelector, toFunctionSignature, type Abi, type AbiFunction, type AbiParameter, type Hex } from "viem";

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

/**
 * Contract deployment checked against its compiler artifact.
 *
 * The init code is the artifact's creation bytecode (Foundry `bytecode.object` or Hardhat `bytecode`) followed by
 * ABI-encoded constructor arguments coerced exactly like contract controls. A caller-supplied bytecode must equal
 * the artifact's byte for byte, and unlinked library placeholders are refused, so what the wallet deploys is what
 * was compiled and reviewed.
 */
export function prepareContractDeployment(input: {
  readonly artifact: unknown;
  readonly chainId: number;
  readonly args?: readonly unknown[];
  readonly bytecode?: string;
  readonly valueWei?: string;
}) {
  const raw = typeof input.artifact === "string" ? JSON.parse(input.artifact) as unknown : input.artifact;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new TypeError("Deployment needs a compiler artifact object with abi and bytecode.");
  const artifact = raw as Record<string, unknown>;
  const abi = parseContractAbi(artifact);
  const compiled = typeof artifact.bytecode === "string" ? artifact.bytecode
    : artifact.bytecode && typeof artifact.bytecode === "object" && typeof (artifact.bytecode as { object?: unknown }).object === "string" ? (artifact.bytecode as { object: string }).object
    : undefined;
  if (compiled === undefined) throw new TypeError("The artifact has no creation bytecode (bytecode or bytecode.object).");
  const normalized = (compiled.startsWith("0x") ? compiled : `0x${compiled}`).toLowerCase();
  if (normalized.includes("__")) throw new TypeError("The artifact bytecode has unlinked library placeholders; link libraries before deployment.");
  if (!/^0x(?:[0-9a-f]{2})+$/u.test(normalized)) throw new TypeError("The artifact creation bytecode is not hexadecimal.");
  if (input.bytecode !== undefined) {
    const supplied = (input.bytecode.startsWith("0x") ? input.bytecode : `0x${input.bytecode}`).toLowerCase();
    if (supplied !== normalized) throw new TypeError("The supplied bytecode does not match the compiler artifact.");
  }
  if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0) throw new TypeError("chainId must be a positive safe integer.");
  const constructor = abi.find((item): item is Extract<Abi[number], { type: "constructor" }> => item.type === "constructor");
  const inputs = constructor?.inputs ?? [];
  const args = input.args ?? [];
  if (!Array.isArray(args) || args.length !== inputs.length) throw new TypeError(`The constructor takes ${inputs.length} argument(s); provide every one in order.`);
  if (JSON.stringify(args).length > 512_000) throw new TypeError("Constructor arguments exceed 512 KB.");
  const coerced = inputs.map((parameter: AbiParameter, index: number) => coerce(parameter, args[index]));
  const valueWei = input.valueWei ?? "0";
  if (!/^(0|[1-9]\d{0,77})$/u.test(valueWei)) throw new TypeError("valueWei must be a uint256 integer string.");
  if (constructor?.stateMutability !== "payable" && valueWei !== "0") throw new TypeError("Only a payable constructor can receive native value.");
  const data = encodeDeployData({ abi, bytecode: normalized as Hex, args: coerced });
  return {
    schema: "keel-contract-deployment@1" as const,
    status: "review-only" as const,
    chainId: input.chainId,
    data,
    valueWei,
    bytecodeKeccak: keccak256(normalized as Hex),
    initCodeKeccak: keccak256(data),
    constructor: { inputs, args },
    authority: "unverified" as const,
    signing: "not-performed" as const,
    submission: "not-performed" as const,
    requires: ["preflight-receipt", "token-standard-audit-when-a-token", "simulation", "exact-wallet-review", "post-deploy-code-readback"],
  };
}

/**
 * A call checked through the same ABI controls: exact signature, every argument coerced (integers as decimal
 * strings, tuples as ordered arrays, addresses EIP-55 checked), value only for payable functions.
 */
export function prepareContractCall(input: { readonly abi: unknown; readonly chainId: number; readonly to: string; readonly signature: string; readonly args?: readonly unknown[]; readonly valueWei?: string }) {
  const contract = createTrackedContract({ chainId: input.chainId, address: input.to as `0x${string}`, name: "call target", kind: "custom", source: "manual", abi: input.abi });
  return prepareContractControl({ contract, signature: input.signature, args: input.args ?? [], ...(input.valueWei === undefined ? {} : { valueWei: input.valueWei }) });
}

/** KeelAuthority entry points that forward one Call {target, value, data}. */
export const KEEL_AUTHORITY_FORWARDING_ABI = parseAbi([
  "function execute((address target, uint256 value, bytes data) call_) payable returns (bytes)",
  "function executeSigned((address target, uint256 value, bytes data) call_, uint64 deadline, (address signer, bytes signature)[] signatures) payable returns (bytes)",
  "function callAsDelegate((address target, uint256 value, bytes data) call_) returns (bytes)",
]);

export interface KeelAuthorityForwardedCall {
  readonly functionName: "execute" | "executeSigned" | "callAsDelegate";
  readonly target: `0x${string}`;
  readonly value: string;
  readonly data: Hex;
}

/** Decode a KeelAuthority forwarding call, or undefined when `data` is not one. */
export function decodeKeelAuthorityCall(data: string): KeelAuthorityForwardedCall | undefined {
  if (!/^0x[0-9a-fA-F]{8}/u.test(data)) return undefined;
  try {
    const decoded = decodeFunctionData({ abi: KEEL_AUTHORITY_FORWARDING_ABI, data: data as Hex });
    const call = decoded.args[0] as { readonly target: string; readonly value: bigint; readonly data: Hex };
    return { functionName: decoded.functionName, target: call.target.toLowerCase() as `0x${string}`, value: call.value.toString(), data: call.data };
  } catch {
    return undefined;
  }
}

/** Wrap an inner call in KeelAuthority.execute or callAsDelegate. */
export function encodeKeelAuthorityCall(functionName: "execute" | "callAsDelegate", call: { readonly target: string; readonly value?: string; readonly data: string }): Hex {
  const value = BigInt(call.value ?? "0");
  if (functionName === "callAsDelegate" && value !== 0n) throw new TypeError("callAsDelegate forwards no native value.");
  return encodeFunctionData({ abi: KEEL_AUTHORITY_FORWARDING_ABI, functionName, args: [{ target: getAddress(call.target), value, data: call.data as Hex }] });
}

/**
 * Role administration: AccessControl (grantRole/revokeRole/renounceRole) and the ownable-roles style
 * (grantRoles/revokeRoles/renounceRoles). These change who may act, never what a token shows.
 */
export const KEEL_ROLE_ADMIN_SIGNATURES = Object.freeze([
  "grantRole(bytes32,address)", "revokeRole(bytes32,address)", "renounceRole(bytes32,address)",
  "grantRoles(address,uint256)", "revokeRoles(address,uint256)", "renounceRoles(uint256)",
] as const);
export const KEEL_ROLE_ADMIN_SELECTORS: ReadonlyMap<string, string> = new Map(KEEL_ROLE_ADMIN_SIGNATURES.map((signature) => [toFunctionSelector(signature), signature]));

/** The ABI write (or read) whose selector starts `data`, as the contract controls list it. */
export function contractControlForCalldata(abi: unknown, data: string) {
  const selector = data.slice(0, 10).toLowerCase();
  return contractControls(abi).find((control) => toFunctionSelector(control.signature) === selector);
}

/**
 * Coarse token shape from an ABI: an NFT exposes tokenURI(uint256) or uri(uint256); a fungible ERC-20 exposes
 * decimals() and transfer(address,uint256) without either. Fungible tokens have no tokenURI to audit.
 */
export function tokenKindFromAbi(abi: unknown): "nft" | "erc20" | "unknown" {
  const signatures = new Set(contractControls(abi).map((control) => control.signature));
  if (signatures.has("tokenURI(uint256)") || signatures.has("uri(uint256)")) return "nft";
  if (signatures.has("decimals()") && signatures.has("transfer(address,uint256)")) return "erc20";
  return "unknown";
}

/** Function names that set token metadata or presentation (tokenURI, base URI, renderer, contract URI, ...). */
export const KEEL_METADATA_FUNCTION = /(?:token_?uri|base_?uri|contract_?uri|renderer|metadata|image|presentation|harness|shell|reveal|artwork|animation|svg)/iu;
