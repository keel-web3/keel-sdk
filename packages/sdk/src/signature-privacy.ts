import { getAddress, hashTypedData, type Address, type Hex } from "viem";

/** Source-profile guidance only; this does not attest a deployed contract. */
export function keelSignaturePrivacyReadiness(input: unknown = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw Error("Invalid signature preferences.");
  const value = input as Record<string, unknown>;
  const keys = ["forceAddressChange", "requirePersistentPrivacy"];
  if (Object.keys(value).some(k => !keys.includes(k)) || keys.some(k => value[k] !== undefined && typeof value[k] !== "boolean")) throw Error("Invalid signature preferences.");
  const forceAddressChange = value.forceAddressChange === true;
  const requirePersistentPrivacy = value.requirePersistentPrivacy === true;
  return {
    schema: "keel-signature-privacy@1" as const,
    evidence: "reviewed-source-profile-not-live-attestation" as const,
    profile: "evm-keel-typed-signature-calldata" as const,
    offchainCollection: true, executionDisclosure: "public-calldata" as const,
    persistentPrivacy: "unavailable" as const, hashBasedValidator: "unverified" as const,
    freshAddressEnforcement: "unavailable" as const,
    preferences: { forceAddressChange, requirePersistentPrivacy },
    ready: !forceAddressChange && !requirePersistentPrivacy,
    blockers: [ ...(forceAddressChange ? ["Fresh-address enforcement is unavailable; no signer address was changed."] : []), ...(requirePersistentPrivacy ? ["Execution exposes signatures in calldata; persistent signature privacy is unavailable."] : []) ],
    disclosure: "Collect approvals privately. Execution publishes signature packets. Signature verification may disclose packets to the selected RPC provider, including EOA checks. Keep confidential notes off-chain.",
  };
}
const fields = {
  RecoveryAction: [["groupId","bytes32"],["resource","address"],["scope","bytes32"],["actionHash","bytes32"],["nonce","uint256"],["revision","uint64"],["deadline","uint64"]],
  RecoveryKeyAcceptance: [["actionDigest","bytes32"],["signer","address"]],
  GovernanceAction: [["target","address"],["value","uint256"],["dataHash","bytes32"],["nonce","uint256"],["deadline","uint64"],["epoch","uint64"]],
} as const;
export type SignatureRequest = { role: string; members: readonly Address[]; threshold: bigint; digest: Hex; typedData: unknown };
export type PrivateApproval = { signer: Address; signature: Hex; digest: Hex };
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Invalid signing request.");
  return value as Record<string, unknown>;
};
const bytes32 = (v: unknown): Hex => {
  if (typeof v !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(v)) throw Error("Invalid signing digest.");
  return v.toLowerCase() as Hex;
};
function safeRequest(request: SignatureRequest) {
  const data = record(request.typedData), domain = record(data.domain), message = record(data.message);
  const primaryType = data.primaryType;
  if (typeof primaryType !== "string" || !Object.hasOwn(fields, primaryType)) throw Error("Unsupported signing schema.");
  const schema = fields[primaryType as keyof typeof fields].map(([name,type]) => ({name,type}));
  const expectedName = primaryType === "GovernanceAction" ? "Keel Manager" : "KEEL Recovery Groups";
  if (domain.name !== expectedName || domain.version !== "1" || typeof domain.chainId !== "number" || !Number.isSafeInteger(domain.chainId) || domain.chainId <= 0) throw Error("Invalid signing domain.");
  const types = record(data.types);
  if (JSON.stringify(types[primaryType]) !== JSON.stringify(schema)) throw Error("Unsupported signing schema.");
  const cleanMessage: Record<string, string> = {};
  for (const {name,type} of schema) {
    const v = message[name];
    if (type === "address") cleanMessage[name] = getAddress(String(v));
    else if (type === "bytes32") cleanMessage[name] = bytes32(v);
    else {
      if (!(typeof v === "bigint" || typeof v === "string" && /^(0|[1-9][0-9]*)$/.test(v))) throw Error("Invalid signing number.");
      const n = BigInt(v), bits = type === "uint64" ? 64n : 256n;
      if (n < 0n || n >= 1n << bits) throw Error("Invalid signing number.");
      cleanMessage[name] = n.toString();
    }
  }
  const typedData = { domain: { name: expectedName, version: "1", chainId: domain.chainId, verifyingContract: getAddress(String(domain.verifyingContract)) }, primaryType, types: { [primaryType]: schema }, message: cleanMessage };
  const digest = bytes32(request.digest);
  if (hashTypedData(typedData as never).toLowerCase() !== digest) throw Error("Signing digest mismatch.");
  const members = request.members.map(v => getAddress(v));
  if (!members.length || members.length > 256 || new Set(members).size !== members.length || members.some(v => BigInt(v) === 0n) || request.threshold < 1n || request.threshold > BigInt(members.length)) throw Error("Invalid signing roster.");
  if (!["current","incoming","recovery","acceptance","governance"].includes(request.role)) throw Error("Invalid signing role.");
  return { role: request.role, members, threshold: request.threshold.toString(), digest, typedData };
}
/** Deliberate allowlist: never serialize the plan, notes or approval packets. */
export function serializeUnsignedSigningRequests(requests: readonly SignatureRequest[]): string {
  if (!requests.length || requests.length > 256) throw Error("Invalid signing request count.");
  return JSON.stringify({ schema: "keel-unsigned-signing-requests@1", requests: requests.map(safeRequest) }, null, 2);
}
/** Strict shape/digest/roster validation; callers must additionally verify cryptography. */
export function parsePrivateApprovals(text: string, requests: readonly SignatureRequest[]): PrivateApproval[] {
  if (text.length > 2_000_000) throw Error("Approval import exceeds the size limit.");
  const cleanRequests = requests.map(safeRequest);
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw Error("Invalid approval JSON."); }
  if (!Array.isArray(value) || value.length === 0 || value.length > 256) throw Error("Import an approval array.");
  const seen = new Set<string>();
  return value.map(item => {
    const p = record(item);
    if (Object.keys(p).length !== 3 || Object.keys(p).some(k => !["signer","signature","digest"].includes(k))) throw Error("Invalid approval packet fields.");
    if (typeof p.signer !== "string") throw Error("Invalid approval signer.");
    const signer = getAddress(p.signer), digest = bytes32(p.digest);
    if (typeof p.signature !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(p.signature) || p.signature.length > 131074) throw Error("Invalid approval signature.");
    if (!cleanRequests.some(r => r.digest === digest && r.members.includes(signer))) throw Error("Approval does not match the current request.");
    const key = `${digest}:${signer}`;
    if (seen.has(key)) throw Error("Duplicate approval packet.");
    seen.add(key);
    return { signer, digest, signature: p.signature as Hex };
  });
}
/** Explicit private export only. Never use this in public sharing or MCP replies. */
export function serializePrivateApprovals(packets: readonly PrivateApproval[], requests: readonly SignatureRequest[], acknowledgeDisclosure: boolean): string {
  if (acknowledgeDisclosure !== true) throw Error("Confirm private approval export first.");
  const text = JSON.stringify(packets.map(({signer,signature,digest}) => ({signer,signature,digest})));
  return JSON.stringify(parsePrivateApprovals(text, requests), null, 2);
}
