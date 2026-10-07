import { createKeelStudioAgentDraftClient, studioAgentRequest, studioAgentResponse, type KeelStudioAgentDraftClientOptions } from "./studio-agent-drafts.js";
import type { Account, Address, Hex } from "viem";
export type KeelStudioAccessMember = { readonly audienceIds?: readonly string[]; readonly wallet: Address; readonly allocation: number | null; readonly status: "eligible" | "ineligible" | "revoked"; readonly reason: string };
export type KeelStudioAccessUpdate = { readonly wallets: readonly Address[]; readonly expectedRevision: number | null; readonly campaign?: Readonly<Record<string, unknown>>; readonly members?: readonly KeelStudioAccessMember[] };
export interface KeelStudioAccessSigningPacket {
  readonly domain: { readonly name: "Keel OneMint"; readonly version: "2"; readonly chainId: number; readonly verifyingContract: Address };
  readonly types: { readonly OneMintAuthorization: readonly { readonly name: string; readonly type: string }[] };
  readonly primaryType: "OneMintAuthorization";
  readonly message: { readonly dropId: Hex; readonly stageIndex: number; readonly account: Address; readonly quantity: number; readonly nonce: string; readonly deadline: string; readonly contextHash: Hex };
  readonly claimIds: readonly string[];
}
export type KeelStudioAccessSigningRequest = { readonly id: string; readonly signer: Address; readonly packet: KeelStudioAccessSigningPacket; readonly deadline: string };
export type KeelStudioAccessProviderUpdate = { readonly expectedRevision: number; readonly provider: "discord" | "email" | "history"; readonly remove?: boolean; readonly values?: Readonly<Record<string, string>> };
export type KeelStudioAccessProviderStatus = { readonly revision: number; readonly discord: { readonly configured: boolean; readonly clientId: string | null; readonly botConfigured: boolean; readonly callback: string }; readonly email: { readonly configured: boolean; readonly from: string | null }; readonly history: { readonly configured: boolean; readonly publicFallback: boolean; readonly attribution: string }; readonly secretsReturned: false };
export type KeelStudioRaffleAction = { readonly action: "prepare" | "cancel" | "draw" } | { readonly action: "record" | "confirm"; readonly transactionHash: Hex };
export type KeelStudioRafflePreparation = { readonly snapshot: Readonly<Record<string, unknown>>; readonly commitment: Hex; readonly pulseAt: string; readonly anchorTransaction: Hex | null; readonly walletCall: { readonly chainId: number; readonly to: Address; readonly value: "0"; readonly data: Hex }; readonly explanation: string };
/** Uses the same scoped private connection as drafts. No provider token or signing key is sent. */
export function createKeelStudioAccessClient(options: KeelStudioAgentDraftClientOptions) {
  createKeelStudioAgentDraftClient(options); // Reuse the established URL/token validation.
  const path = (id: string) => { if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu.test(id)) throw new TypeError("Use a Studio release UUID."); return `/api/agent/access/${id}`; };
  const request = async <T>(id: string, method: string, body?: unknown, query = "") => studioAgentResponse<T>(await studioAgentRequest(options, path(id) + query, { method, cache: "no-store", ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) }), [options.grantToken]);
  const providerRequest = async <T>(method: string, body?: unknown) => studioAgentResponse<T>(await studioAgentRequest(options, "/api/agent/access/providers", { method, cache: "no-store", ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) }), [options.grantToken, ...Object.values((body as KeelStudioAccessProviderUpdate | undefined)?.values ?? {})]);
  const raffle = <T>(id: string, input?: KeelStudioRaffleAction) => request<T>(id, input ? "POST" : "GET", input, "/raffle");
  return Object.freeze({
    benefits: (id: string) => request<Readonly<Record<string, unknown>>>(id, "GET", undefined, "/benefits"),
    /** Returns an unsigned creator-wallet activation; never sends a transaction. */
    prepareBenefit: (id: string, groupId: string, stageIndex: number) => request<Readonly<Record<string, unknown>>>(id, "POST", { action: "prepare", groupId, stageIndex }, "/benefits"),
    providers: () => providerRequest<KeelStudioAccessProviderStatus>("GET"),
    /** Prefer Studio's secure form. Caller-supplied credentials stay server-side and are redacted from errors. */
    configureProvider: (input: KeelStudioAccessProviderUpdate) => providerRequest<KeelStudioAccessProviderStatus>("PUT", input),
    raffleStatus: (id: string) => raffle<Readonly<Record<string, unknown>>>(id),
    prepareRaffle: (id: string) => raffle<KeelStudioRafflePreparation>(id, { action: "prepare" }),
    recordRaffleTransaction: (id: string, transactionHash: Hex) => raffle(id, { action: "record", transactionHash }),
    confirmRaffle: (id: string, transactionHash: Hex) => raffle(id, { action: "confirm", transactionHash }),
    drawRaffle: (id: string) => raffle(id, { action: "draw" }),
    cancelUnsignedRaffle: (id: string) => raffle(id, { action: "cancel" }),
    read: (id: string) => request<{ list: { id: string; revision: number; campaign: Record<string, unknown>; members: readonly { walletAddress: Address; audienceIds?: readonly string[]; allocation: number | null; status: string }[] } | null }>(id, "GET"),
    update: (id: string, input: KeelStudioAccessUpdate) => request(id, "PUT", input),
    test: (id: string, wallet: Address, claimIds: readonly string[] = []) => request(id, "POST", { action: "test", wallet, claimIds }),
    requests: (id: string) => request<{ requests: readonly KeelStudioAccessSigningRequest[] }>(id, "GET", undefined, "?view=requests"),
    approve: (id: string, requestId: string, signature: Hex) => request(id, "POST", { action: "approve", requestId, signature }),
  });
}
/** Optional caller-owned signer. The caller decides when to sign; keys stay in their wallet/service. */
export async function signKeelStudioAccessRequest(request: KeelStudioAccessSigningRequest, signer: { readonly address: Address; readonly signTypedData: NonNullable<Account["signTypedData"]> }): Promise<Hex> {
  const packet = request.packet;
  if (signer.address.toLowerCase() !== request.signer.toLowerCase()) throw new Error("This signer is not the configured access signer.");
  if (packet.domain.name !== "Keel OneMint" || packet.domain.version !== "2" || packet.primaryType !== "OneMintAuthorization" || !Number.isSafeInteger(packet.domain.chainId) || packet.domain.chainId < 1) throw new Error("Unsupported access signing domain.");
  const expected = [["dropId", "bytes32"], ["stageIndex", "uint16"], ["account", "address"], ["quantity", "uint32"], ["nonce", "uint256"], ["deadline", "uint64"], ["contextHash", "bytes32"]];
  if (JSON.stringify(packet.types.OneMintAuthorization.map(field => [field.name, field.type])) !== JSON.stringify(expected) || Object.keys(packet.types).length !== 1) throw new Error("Unsupported access authorization fields.");
  if (!Number.isSafeInteger(packet.message.quantity) || packet.message.quantity < 1 || packet.message.quantity > 1000 || !Number.isSafeInteger(packet.message.stageIndex) || packet.message.stageIndex < 0 || packet.message.stageIndex >= 16) throw new Error("Invalid access quantity or stage.");
  if (BigInt(packet.message.deadline) * 1_000n <= BigInt(Date.now())) throw new Error("This access request expired.");
  return signer.signTypedData({ domain: packet.domain, types: packet.types, primaryType: packet.primaryType, message: { ...packet.message, nonce: BigInt(packet.message.nonce), deadline: BigInt(packet.message.deadline) } });
}
