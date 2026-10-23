import { decodeFunctionResult, encodeAbiParameters, encodeFunctionData, getAddress, hexToBytes, keccak256, padHex, parseAbi, stringToBytes, toHex, type Hex } from "viem";

export interface KeelPreparedEnvelopeReadAdapter {
  getChainId(options?: { readonly signal?: AbortSignal }): Promise<number>;
  getBlock(number: bigint, options?: { readonly signal?: AbortSignal }): Promise<{ readonly number: bigint; readonly hash: string }>;
  call(input: { readonly to: string; readonly data: string; readonly blockNumber: bigint; readonly signal?: AbortSignal }): Promise<string>;
  getCode(input: { readonly address: string; readonly blockNumber: bigint; readonly signal?: AbortSignal }): Promise<string>;
}
export interface KeelPreparedEnvelopeInput {
  readonly chainId: number;
  readonly factory: string;
  readonly block: { readonly number: bigint; readonly hash: string };
  readonly encodedPrefix: Uint8Array | string;
  readonly encodedSuffix: Uint8Array | string;
  readonly read: KeelPreparedEnvelopeReadAdapter;
  readonly signal?: AbortSignal;
}
export interface KeelPreparedEnvelopeQualification {
  readonly chainId: number;
  readonly factory: string;
  readonly block: { readonly number: bigint; readonly hash: string };
  readonly collectionDeployer: string;
  readonly collectionCreationCodeHash: string;
  readonly carriers: readonly string[];
  readonly capability: { readonly prefixMaxBytes: number | null; readonly suffixMaxBytes: number | null };
  readonly prefixBytes: number;
  readonly suffixBytes: number;
  readonly requiresFullSimulation: true;
}
export type KeelRouted721FactoryInput = Omit<KeelPreparedEnvelopeInput, "encodedPrefix" | "encodedSuffix">;
export type KeelRouted721FactoryQualification = Omit<KeelPreparedEnvelopeQualification, "prefixBytes" | "suffixBytes" | "capability"> & {
  readonly scope: "routed721-factory";
  readonly moduleHooks: true;
};
export type KeelPreparedEnvelopeFailureCode = "KEEL_PREPARED_ENVELOPE_LIMIT" | "KEEL_PREPARED_ENVELOPE_UNQUALIFIED";
export class KeelPreparedEnvelopeCapabilityError extends Error {
  readonly phase = "prepared-presentation";
  constructor(
    readonly code: KeelPreparedEnvelopeFailureCode,
    message: string,
    readonly details: Readonly<{ chainId: number; factory: string; prefixBytes: number; suffixBytes: number;
      blockNumber: string; blockHash: string; collectionCreationCodeHash?: string; limitBytes?: number; reason: string }>,
  ) { super(message); this.name = "KeelPreparedEnvelopeCapabilityError"; }
}

const factoryABI = parseAbi(["function collectionDeployer() view returns (address)"]);
const deployerABI = parseAbi(["function creationCodeHash() view returns (bytes32)"]);
// These exact legacy runtimes embed the selected-chain cached EIP712 domain.
const legacyFactories = new Map([
  ["0x94e68d15c76da5116dc8df155e7498518f822668f375624d66af18479c25d432", 3937],
  ["0x7b8a96cdbfd228ba5aa5f3582d355c85a54cf8ac74e3a67f49d0087e547918ac", 3949],
  ["0x61c7e4a3fa32dffba5488467c1260afc88cd98b7eba6ddc509b205711c64e6a9", 3937],
]);
const legacyCreations = new Set([
  "0x0182d140506795efa1e8e009f9eae5b04fe3bc5a179387fa366c6118be563f0f",
  "0x499e1bc0bf37e3736316cc883eb36b1a32cda5b53937b8d1cda6a658c10c4149",
  "0x87856f27887343a0d086f441c9d28b691f28ca0c733e91a0ce15ab32ce42ab46",
]);
const legacyDeployers: Readonly<Record<string, readonly [number, number]>> = {
  "0xee29fee5f3e88d897ea5caed165ee465bd8112b31a1124a899494e1bef12bac6": [1093, 1130],
  "0x0ad0ffcfd89af5655e1e7bca58caca649fd990d798751d7fc2a5c5b8c4b29425": [1109, 1146],
  "0x08f11e6ba895a0e8a16d4a36ee413c6e3340826c81896091fa13f6f03746619c": [1093, 1130],
};
// Exact Contracts4015 and Contracts49d compiler fingerprints
// (Solc0.8.36, IR,50runs,Prague,noCBOR); no source-only capability inference.
// Mask only compiler-declared constructor immutables or linked-library addresses;
// verify the actual immutable carrier bytes and library code separately below.
const factoryImmutableStarts = [3665, 3848, 3611, 3744, 3782, 758, 799];
const deployerImmutableStarts = [1093, 1130, 941, 981, 84];
const collectionProfiles = [
  { length: 26362, libraryStarts: [20381, 20889, 21233, 21680], maskedHash: "0x679192f3111d5bfc3de391ea22f86b90b952af2a8601c48eed57386d926ed44b" },
  // Contracts49d: exact compiled Routed721 default holder edits remain disabled.
  // Genuine unlinked artifact, metadata/source SHA and link ranges are retained in
  // tests/fixtures/prepared-envelope-capability-49d.json; this is not a deployment claim.
  { length: 26364, libraryStarts: [20383, 20891, 21235, 21682], maskedHash: "0x7f636ad8e43975569ee1c2c2a00aea3bb441b89bb57f0e6b998a8bdbd2e68bf1" },
] as const;
const factoryTemplateHash = "0xb01f2470dabda7abb69504a82b7e0b5a8ce2d39b9f513d5910b423a27de73f15";
const deployerTemplateHash = "0x4b5bc008b1c3d73cf34bee82a23e8d0ce40ff486c516ed04718fcb03f2932e7b";
const metadataLibraryRuntimeHash = "0xd7d042765a972c73fac3a803a10874591793e54ccac7f6405b9fe851bf07e928";

function asBytes(value: Uint8Array | string): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (!/^0x(?:[0-9a-f]{2})*$/iu.test(value)) throw new TypeError("Prepared envelope bytes must be an even-length hex string or Uint8Array.");
  return hexToBytes(value as Hex);
}
function domainSeparator(chainId: number, factory: Hex): string {
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }], [
    keccak256(stringToBytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")),
    keccak256(stringToBytes("Keel Factory")), keccak256(stringToBytes("1")), BigInt(chainId), factory,
  ]));
}
function maskedHash(code: Uint8Array, starts: readonly number[], length: number): string {
  const masked = Uint8Array.from(code);
  for (const start of starts) {
    if (start + length > code.length) return "";
    masked.fill(0, start, start + length);
  }
  return keccak256(masked);
}
function addressWord(code: Uint8Array, offset: number): string {
  if (code.slice(offset, offset + 12).some((byte) => byte !== 0)) throw new Error("Invalid address word.");
  return getAddress(toHex(code.slice(offset + 12, offset + 32)));
}
function word(code: Uint8Array, offset: number): string { return toHex(code.slice(offset, offset + 32)); }
function shortString(value: string): string {
  const encoded = asBytes(toHex(stringToBytes(value)));
  const packed = new Uint8Array(32); packed.set(encoded); packed[31] = encoded.length;
  return toHex(packed);
}

/** Qualifies the actual deployed collection constructor, not the current source ABI.
 * No payload is transmitted. This is capability preflight, never execution proof.
 */
async function qualifyFactory(
  input: KeelRouted721FactoryInput,
  envelope?: Pick<KeelPreparedEnvelopeInput, "encodedPrefix" | "encodedSuffix">,
  requireMaintained = false,
): Promise<KeelPreparedEnvelopeQualification> {
  const factory = getAddress(input.factory);
  const chainId = input.chainId;
  const block = { ...input.block };
  const signal = input.signal;
  const adapter = input.read;
  const checkAbort = (): void => { if (signal?.aborted) throw new DOMException("Prepared presentation cancelled.", "AbortError"); };
  checkAbort();
  const options = signal === undefined ? {} : { signal: signal };
  const read = async <T>(fn: () => Promise<T>): Promise<T> => { checkAbort(); const value = await fn(); checkAbort(); return value; };
  const prefixBytes = envelope === undefined ? 0 : asBytes(envelope.encodedPrefix).length;
  const suffixBytes = envelope === undefined ? 0 : asBytes(envelope.encodedSuffix).length;
  let creationHash: string | undefined;
  const fail = (reason: string): never => {
    throw new KeelPreparedEnvelopeCapabilityError("KEEL_PREPARED_ENVELOPE_UNQUALIFIED",
      `Prepared presentation on chain ${chainId} cannot qualify factory ${factory}: ${reason}. ` +
      `Envelope prefix ${prefixBytes} bytes, suffix ${suffixBytes} bytes. Keep the saved project and select a receipt-verified compatible factory before preparation.`,
      { chainId: chainId, factory, prefixBytes, suffixBytes, blockNumber: String(block.number),
        blockHash: block.hash, ...(creationHash ? { collectionCreationCodeHash: creationHash } : {}), reason });
  };
  if (!Number.isSafeInteger(chainId) || chainId <= 0) fail("invalid chain identity");
  if (block.number < 0n || !/^0x[0-9a-f]{64}$/iu.test(block.hash)) fail("invalid pinned block");
  if (envelope !== undefined && (prefixBytes === 0 || suffixBytes === 0)) fail("empty prepared envelope fragment");
  let qualification: KeelPreparedEnvelopeQualification | undefined;
  try {
    if (await read(() => adapter.getChainId(options)) !== chainId) fail("provider chain mismatch");
    const pin = async (): Promise<void> => {
      const header = await read(() => adapter.getBlock(block.number, options));
      if (header.number !== block.number || header.hash.toLowerCase() !== block.hash.toLowerCase()) fail("pinned block changed");
    };
    await pin();
    const factoryCode = asBytes(await read(() => adapter.getCode({ address: factory, blockNumber: block.number, ...options })));
    const legacyDomainOffset = legacyFactories.get(keccak256(factoryCode));
    const legacyFactory = legacyDomainOffset !== undefined;
    const maintainedFactory = factoryCode.length === 4563 && maskedHash(factoryCode, factoryImmutableStarts, 32) === factoryTemplateHash;
    if (!legacyFactory && !maintainedFactory) fail("unknown factory runtime");
    if (requireMaintained && !maintainedFactory) fail("maintained Routed721 factory required for presentation module hooks");
    if (legacyDomainOffset !== undefined && BigInt(word(factoryCode, legacyDomainOffset)) !== BigInt(chainId)) {
      fail("legacy factory cached chain/domain mismatch");
    }
    if (maintainedFactory) {
      const expectedImmutables: Readonly<Record<number, string>> = {
        3665: domainSeparator(chainId, factory),
        3848: padHex(toHex(chainId), { size: 32 }), 3611: padHex(factory.toLowerCase() as Hex, { size: 32 }),
        3744: keccak256(stringToBytes("Keel Factory")), 3782: keccak256(stringToBytes("1")),
        758: shortString("Keel Factory"), 799: shortString("1"),
      };
      for (const [offset, expected] of Object.entries(expectedImmutables)) {
        if (word(factoryCode, Number(offset)).toLowerCase() !== expected.toLowerCase()) fail("factory constructor immutable mismatch");
      }
    }
    const deployer = getAddress(decodeFunctionResult({ abi: factoryABI, functionName: "collectionDeployer", data: await read(() => adapter.call({
      to: factory, data: encodeFunctionData({ abi: factoryABI, functionName: "collectionDeployer" }), blockNumber: block.number, ...options,
    })) as Hex }));
    const deployerCode = asBytes(await read(() => adapter.getCode({ address: deployer, blockNumber: block.number, ...options })));
    const legacyOffsets = legacyDeployers[keccak256(deployerCode)];
    const maintainedDeployer = deployerCode.length === 1203 && maskedHash(deployerCode, deployerImmutableStarts, 32) === deployerTemplateHash;
    if (legacyFactory ? legacyOffsets === undefined : !maintainedDeployer) fail("unknown collection deployer runtime");
    const offsets: readonly [number, number] = legacyFactory ? legacyOffsets! : [1093, 1130];
    creationHash = decodeFunctionResult({ abi: deployerABI, functionName: "creationCodeHash", data: await read(() => adapter.call({
      to: deployer, data: encodeFunctionData({ abi: deployerABI, functionName: "creationCodeHash" }), blockNumber: block.number, ...options,
    })) as Hex }).toLowerCase();
    const carriers = offsets.map((offset) => addressWord(deployerCode, offset));
    const first = asBytes(await read(() => adapter.getCode({ address: carriers[0]!, blockNumber: block.number, ...options })));
    const second = asBytes(await read(() => adapter.getCode({ address: carriers[1]!, blockNumber: block.number, ...options })));
    const creation = new Uint8Array(first.length + second.length);
    creation.set(first); creation.set(second, first.length);
    if (keccak256(creation) !== creationHash) fail("immutable creation carriers do not match deployer commitment");
    if (maintainedFactory && (BigInt(word(deployerCode, 941)) !== BigInt(first.length)
      || BigInt(word(deployerCode, 981)) !== BigInt(second.length) || word(deployerCode, 84) !== creationHash)) {
      fail("deployer constructor length or digest mismatch");
    }
    let limit: number | null;
    if (legacyFactory) {
      if (!legacyCreations.has(creationHash)) fail("unknown legacy collection creation code");
      limit = 32768;
    } else {
      const profile = collectionProfiles.find(profile => creation.length === profile.length && maskedHash(creation, profile.libraryStarts, 20) === profile.maskedHash);
      if (profile === undefined) return fail("unknown maintained collection creation code");
      const libraryAddresses = profile.libraryStarts.map((start) => getAddress(toHex(creation.slice(start, start + 20))));
      if (libraryAddresses.some((address) => address !== libraryAddresses[0])) fail("inconsistent metadata library links");
      const library = asBytes(await read(() => adapter.getCode({ address: libraryAddresses[0]!, blockNumber: block.number, ...options })));
      if (library.length !== 4683 || keccak256(library) !== metadataLibraryRuntimeHash) fail("unknown metadata library runtime");
      // The qualified collection source has no historical envelope length guard.
      // Gas/execution/body bounds still require the unchanged complete simulation.
      limit = null;
    }
    await pin();
    qualification = { chainId: chainId, factory, block: { ...block }, collectionDeployer: deployer,
      collectionCreationCodeHash: creationHash, carriers, capability: { prefixMaxBytes: limit, suffixMaxBytes: limit },
      prefixBytes, suffixBytes, requiresFullSimulation: true };
  } catch (error) {
    checkAbort();
    if (error instanceof KeelPreparedEnvelopeCapabilityError) throw error;
    // Do not forward provider URLs, auth headers, raw response bodies or adapter errors.
    fail("capability read failed");
  }
  const qualified = qualification ?? fail("capability qualification incomplete");
  const limit = qualified.capability.prefixMaxBytes;
  if (limit !== null && (prefixBytes > limit || suffixBytes > limit)) {
    throw new KeelPreparedEnvelopeCapabilityError("KEEL_PREPARED_ENVELOPE_LIMIT",
      `Prepared presentation on chain ${chainId} is blocked by factory ${factory}: ` +
      `prefix ${prefixBytes} bytes and suffix ${suffixBytes} bytes exceed its ${limit}-byte fragment limit. ` +
      `Keep the saved project and original assets; a receipt-verified compatible factory is required.`,
      { chainId: chainId, factory, prefixBytes, suffixBytes, blockNumber: String(block.number),
        blockHash: block.hash, collectionCreationCodeHash: creationHash!, limitBytes: limit, reason: "deployed envelope fragment limit" });
  }
  return qualified;
}

/** Qualifies an actual prepared envelope, preserving the historical fragment
 * boundary as well as complete deployed factory/deployer/carrier identity. */
export async function qualifyKeelPreparedEnvelope(input: KeelPreparedEnvelopeInput): Promise<KeelPreparedEnvelopeQualification> {
  return qualifyFactory(input, input);
}

/** Authenticate the actual maintained factory and its immutable constructor
 * carriers before preparing native module hooks. A matching ABI/getter/catalog
 * hash alone is insufficient. No envelope is supplied, measured or approved;
 * the exact native publication still requires complete simulation. */
export async function qualifyKeelRouted721Factory(input: KeelRouted721FactoryInput): Promise<KeelRouted721FactoryQualification> {
  const { prefixBytes: _prefixBytes, suffixBytes: _suffixBytes, capability: _capability, ...factory } = await qualifyFactory(input, undefined, true);
  return { ...factory, scope: "routed721-factory", moduleHooks: true };
}
