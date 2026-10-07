# Collector access through Studio

Start at https://studio.onkeel.io/llms.txt and `/api/access/schema`. The Studio website handles the creator workflow and wallet review. Desktop is entirely optional. Connect securely with `pnpm studio:connect --window --workspace <project>`; request `access:read` and `access:write`. Existing grants do not acquire these scopes automatically. Keys stay in the private connection store, outside the project and chat.

```ts
import { createConnectedStudioAccessClient } from '@keel/sdk/studio-connection-node';
const access = await createConnectedStudioAccessClient({ workspace: process.cwd() });
const { list } = await access.read(releaseId);
await access.update(releaseId, {
  expectedRevision: list?.revision ?? null,
  wallets: ['0x...'],
  // Preserve the remaining members and their status/allocation/reason.
  // Optional campaign: use the strict current /api/access/schema.
});
const diagnostic = await access.test(releaseId, wallet, ['0', '42']);
const providers = await access.providers(); // Redacted readiness only.
```

Studio uses toggles that reveal each requirement's inputs. Named `groups` combine rule IDs, wallet memberships and Discord roles with ALL or ANY. `groupLogic` combines enabled access audiences. Rules assigned to a group are evaluated there; ungrouped rules and shared account/social requirements apply to everyone. `purpose: "benefit"` offers a reward without closing ordinary checkout to other buyers; omitted purpose means access. Disabled audiences do not grant access. With saved access audiences but none enabled, access fails closed. An enabled group needs at least one requirement. `membership: true` enables a managed wallet audience, including an initially empty list that grants nobody access. Member updates can carry `audienceIds` for live group membership; unknown or duplicate IDs are rejected. Automatic mode treats this as the membership branch and still requires the group's other ALL conditions. Agent mode uses explicitly assigned group memberships as the creator-authorized result of the agent's evidence review. One-use NFT entitlements stay global, outside OR audience alternatives.

Automatic checks include ERC-721 holdings and exact IDs, ERC-1155 ID quantities, ERC-20 balances using token decimals, native balance, sent-transaction nonce, wallet activity before a date, successful native transfer volume, successful calls to a contract, and `isEligible(address)`. History checks authenticate canonical transactions/receipts. Incomplete history is unavailable, not a failed or successful proof. Tezos supports a collector-linked, gas-free signed wallet proof, pinned canonical blocks, FA2/FA1.2 balances, native balance, history and an `is_eligible` view. Transfers/history are bounded; incomplete indexer data never grants access. Tezos readers do not consume ERC-721 bitmap claims.

ERC-721 one-use claims use OneMint's onchain bitmap through `claimMint`: one owned unused NFT ID per work, up to 64, on the release chain. Transfer does not reset the bit. Ordinary ownership is reusable and checked again before a short-lived authorization.

Discord membership/roles use creator-app or platform-app OAuth consent with `identify guilds.members.read email`. Message reactions require a configured bot that can read the target channel/history; normal and burst reactions are checked. Creators configure Discord, a Resend sender, or an Etherscan key in **Verification provider setup** beside the access editor. Secrets stay encrypted server-side. SDK `configureProvider` is for secure caller-supplied configuration only; do not request secrets in chat or put them in MCP arguments. Blank fields preserve saved secrets; optimistic revisions prevent overwrites. Public Blockscout fallback covers supported EVM networks without a private key. X uses optional additional per-user read consent through the existing platform app; quotas and plan permissions can still make a check unavailable. Email verification accepts a short-lived single-use code or a verified Discord email. Provider connection and live permissions are prerequisites, not claims of tested customer consent.

For arbitrary conditions select agent-managed verification and update eligible members only after real authorized verification. `test` is read-only: it never admits a member, draws a raffle, signs, sends mail or submits transactions. Agents cannot access another collector's private OAuth identity through a creator grant. Diagnostics report that missing consent; the collector connects on the website. Removing a member saves revocation, including automatic campaigns. Re-adding requires explicit eligible status, so preserve revoked rows when reconciling imports.

## Your own signer

`access.requests(releaseId)` returns pending exact EIP-712 mint packets. A caller-owned signer reviews the packet and signs locally with `signKeelStudioAccessRequest`, then submits only its signature using `access.approve`. Review chain/controller/drop/collector/quantity/nonce/deadline. Never send a private key to Studio or write it into a project. EOA and ERC-1271 signatures are checked against the live reviewed signer. A grant cannot replace that signature or mint. Published campaign rules and signer are fixed; live membership is editable. Existing approvals expire within five minutes; immediate revocation requires pausing the mint onchain.

## Verifiable raffles

Collectors explicitly enter after fresh eligibility checks. `access.prepareRaffle` freezes closed entries and returns a zero-value self-transaction committing the sorted snapshot and a future signed drand quicknet round. Review and approve it through the selected wallet connector. Immediately call `recordRaffleTransaction` with the submitted hash before waiting. `confirmRaffle` checks its canonical receipt before the future pulse. Refresh resumes that exact hash, without another wallet approval. `drawRaffle` verifies the pinned BLS pulse and deterministically selects winners from the committed snapshot. Anchored draws cannot reroll; only unsigned preparations can be cancelled. `raffleStatus` exposes owner recovery state; published proof exposes the frozen snapshot after anchoring. Draw is an explicit mutation, never a test side effect. Automatic raffle publication currently requires EVM and at most 10,000 winners.

## Discounts and rewards

A group's optional `benefit` chooses percentage, buy-get within one purchase, or loyalty rewards after earlier mints. Select six for buy-five/get-one; cycles restart per purchase. Loyalty counts earlier mints in the same drop, subtracts this offer's own redeemed free works, and never resets when tokens transfer. Other free mints still count; this is a mint-count reward, not a paid-purchase history guarantee. Set total and wallet usage caps. One offer applies per purchase; discounts do not stack silently.

`access.benefits` reads controller compatibility; `prepareBenefit(releaseId, groupId, stageIndex)` returns an exact unsigned `setCoupon` call for creator-wallet review. It cannot replace an existing coupon or reset its usage. **The currently deployed older Sepolia controller lacks coupons.** Saved benefits remain inactive there until a compatible controller is selected and activated; access and normal minting still work. No discount is advertised as live merely because it is saved.

Collector `/api/releases/{id}/access/benefits/checkout` GET returns a read-only, wallet-bound quote and exact signing packet. POST rechecks audience proof, saved terms, live coupon revision/nonce/caps, current mint phase, supply and allocation, then prepares the exact coupon mint call. It requires the collector's website session and same-origin writes, not a creator grant. Platform mode signs after verification; external mode requires the configured EOA/ERC-1271 signer's signature and the quote deadline. Keys stay outside Studio. Use `oneMintCouponTypedData` for the exact native signing schema. The wallet simulates before submitting. ERC-20 approvals use the exact discounted total. Declining an offer uses standard checkout; selecting an unchecked offer never silently charges the standard price.

Local MCP `keel-studio-access` supports read/update/test/requests/approve/providers, raffle-status/prepare/record/confirm/draw/cancel, benefits and benefit-prepare. Remote MCP uses `keel_access_*` tools for the same owner-scoped operations. Read scope is enough for test and status; mutations require write scope. Contract activations remain creator-wallet transactions.

Provider references: [Discord OAuth2](https://docs.discord.com/developers/topics/oauth2), [Discord user membership](https://github.com/discord/discord-api-docs/blob/main/developers/resources/user.mdx), [Octez views](https://octez.tezos.com/docs/active/views.html), [drand quicknet verification](https://docs.drand.love/developer/).
