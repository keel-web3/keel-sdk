/** Source capabilities are not deployed-contract proofs or permission grants. */
export const KEEL_EXECUTION_AUTHORITY_VERSION = "keel-execution-authority@1" as const;
export const KEEL_AUTHORITY_CONTRACT_SOURCE = "ace3fed7aff1765c7d2ee9bba4d0232246f86ffb" as const;
export type KeelExecutionMode = "owner-review" | "delegated-agent" | "agent-owned";
export type KeelExecutionRoute = "studio-release" | "creator-factory-direct" | "publication-job" | "authority-delegate" | "manager-automation";
export type KeelIdentityEvidence = { readonly address: string | null; readonly basis: "creator-account" | "requested-wallet" | "not-established"; readonly explanation: string };

const source = (path: string) => `https://github.com/Ravonus/keel-contracts/blob/${KEEL_AUTHORITY_CONTRACT_SOURCE}/${path}`;
export const KEEL_EXECUTION_ROUTES = Object.freeze({
  "studio-release": {
    title: "Studio release review",
    rule: "The saved creator account reviews the exact collection and sale calls in its own wallet. A Studio agent grant prepares drafts; it does not sign or grant contract permissions.",
    delegated: "unsupported" as const,
    reason: "This release publisher has no verified delegated-agent transaction route. Use the creator wallet review; changing an executor label cannot grant authority.",
    source: source("src/modules/keel-die/KeelFactory.sol"),
  },
  "creator-factory-direct": {
    title: "Direct creator collection",
    rule: "Ordinary creator-factory creation binds the new collection to the calling creator. An agent calling directly would create an agent-owned collection.",
    delegated: "unsupported" as const,
    reason: "The ordinary creator-factory call derives its creator from msg.sender. Sending that call from another wallet does not preserve the original creator's ownership.",
    source: source("src/modules/keel-die/KeelCreatorFactory.sol"),
  },
  "publication-job": {
    title: "Previously approved publication job",
    rule: "The owner commits the exact targets, ordered operation digests, executor, deadline and escrow. Only that executor may continue the bounded job; the configured registry forge-for path retains its approving creator.",
    delegated: "configuration-required" as const,
    reason: "Read and verify the existing job's owner, executor, commitments, cursor, expiry and runtime before offering resume. This capability description does not create or fund a job.",
    source: source("src/modules/keel-publication/KeelPublicationJob.sol"),
  },
  "authority-delegate": {
    title: "Exact-selector project authority",
    rule: "KeelAuthority can permit one account to call an exact target and selector with zero value. Protected ownership, upgrade and role-grant selectors cannot be delegated through this lane.",
    delegated: "configuration-required" as const,
    reason: "A deployed authority must actually control the target, and its exact delegate entry must be verified. Zero native value is not an ERC-20 or NFT spending limit; target-specific restrictions are still required. This Studio publisher does not currently prepare that lane.",
    source: source("src/modules/keel-kernel/KeelAuthority.sol"),
  },
  "manager-automation": {
    title: "Bounded manager automation",
    rule: "KeelManager automation checks an active key, exact target/selector policy, validity window, value limits, key generation, signature and nonce. The relayer and automation signer are separate identities.",
    delegated: "configuration-required" as const,
    reason: "Verify the deployed manager and its current key, policy and grant before preparing a typed request. Native-value limits do not bound ERC-20 or NFT transfers. No key setup, spending allowance or automation grant is performed here.",
    source: source("src/modules/keel-artifacts/KeelManager.sol"),
  },
});

const address = (value: string | undefined) => {
  if (value === undefined) return null;
  if (!/^0x[0-9a-f]{40}$/iu.test(value) || /^0x0{40}$/iu.test(value)) throw new TypeError("Use a nonzero verified account address.");
  return value.toLowerCase();
};
export interface KeelExecutionAuthorityInput {
  readonly route: KeelExecutionRoute;
  readonly creatorAccount?: string;
  readonly requestedSigner?: string;
  readonly releaseId: string;
  readonly revision: number;
  readonly operationId?: string;
}

/** A read-only explanation of the current owner-signing route, never an authorization token. */
export function describeKeelExecutionAuthority(input: KeelExecutionAuthorityInput) {
  const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;
  if (!Object.hasOwn(KEEL_EXECUTION_ROUTES, input.route) || !uuid.test(input.releaseId) || !Number.isSafeInteger(input.revision) || input.revision < 1 || input.operationId !== undefined && !uuid.test(input.operationId)) throw new TypeError("Use the saved route, release and revision identity.");
  const creator = address(input.creatorAccount), signer = address(input.requestedSigner);
  if (creator !== null && signer !== null && creator !== signer) throw new TypeError("This owner-review route cannot substitute a different signing account.");
  const route = KEEL_EXECUTION_ROUTES[input.route];
  const implemented = input.route === "studio-release" || input.route === "creator-factory-direct";
  const unknown = (explanation: string): KeelIdentityEvidence => ({ address: null, basis: "not-established", explanation });
  return {
    schema: KEEL_EXECUTION_AUTHORITY_VERSION, sourceRevision: KEEL_AUTHORITY_CONTRACT_SOURCE,
    route: input.route, releaseId: input.releaseId, revision: input.revision,
    ...(input.operationId === undefined ? {} : { operationId: input.operationId }),
    mode: "owner-review" as const,
    routeStatus: implemented ? "review-implemented" as const : "source-primitive-only" as const,
    title: route.title, explanation: route.rule,
    options: [
      { mode: "owner-review" as const, label: "Your wallet approves", status: implemented ? "available" as const : "configuration-required" as const, explanation: implemented ? "Use Studio yourself or let an agent prepare the same saved plan. You review and sign each new wallet action." : "This source primitive still needs a verified route adapter before this review helper can prepare it." },
      { mode: "delegated-agent" as const, label: "Agent acts with a grant", status: route.delegated, explanation: route.reason },
      { mode: "agent-owned" as const, label: "Agent acts for itself", status: "separate-account-required" as const, explanation: "An explicitly configured agent wallet can use its own creator account. That is a different account and attribution context; this owner-scoped connection cannot silently switch to it." },
    ],
    identities: {
      creatorAccount: { address: creator, basis: creator === null ? "not-established" : "creator-account", explanation: "The authenticated Studio creator account; this is not automatically the artwork's author or current NFT owner." } as KeelIdentityEvidence,
      requestedSigner: { address: signer, basis: signer === null ? "not-established" : "requested-wallet", explanation: "The account requested by the exact saved wallet review. A sender address alone does not prove contract authority." } as KeelIdentityEvidence,
      contractAuthority: unknown("Authority is established by the exact target's current rules and the prepared call, not by an agent grant or transaction payment."),
      artworkCreator: unknown("Read the artwork's creator record and verified attribution separately; never substitute the transaction sender or registry address."),
      currentOwner: unknown("Read current contract or token ownership separately from creator attribution."),
      recipient: unknown("A recipient must be established by the exact mint or transfer call. Do not infer one from this account."),
      feePayer: unknown("The wallet may use a separate sponsor or relayer. The transaction sender is not proof of who ultimately pays fees."),
    },
    sourceUrl: route.source, deployedAuthorityVerified: false as const,
    signing: "not-performed" as const, submission: "not-performed" as const, grantChanges: "not-performed" as const,
  };
}
export type KeelExecutionAuthorityView = ReturnType<typeof describeKeelExecutionAuthority>;
