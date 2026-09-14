# Planning community and achievement rewards

`tools/keel/reward-campaign-plan.mjs` produces an unsigned campaign plan against an existing `KeelRewardClaims` deployment. It never signs, issues credits, or delivers rewards. Define and review the benefit receivers first: the reward ID names an existing benefit, whose receiver determines whether redemption gives a mint, discount, weapon, ERC-1155 item, or spray.

```sh
node tools/keel/reward-campaign-plan.mjs --rpc "$REVIEW_RPC" --input campaign.json --output campaign-plan.json
```

Example input (replace the claims and collection addresses with the selected deployment):

```json
{
  "chainId": 31337,
  "claims": "0x0000000000000000000000000000000000000001",
  "gate": "token",
  "source": "0x0000000000000000000000000000000000000002",
  "probeTokenId": "123",
  "start": 1800000000,
  "end": 1800604800,
  "walletClaims": 1,
  "supply": 1000,
  "pool": [{"benefit": 1}]
}
```

Choose one gate:

| Gate | Eligibility | Required extra input |
| --- | --- | --- |
| `public` | Any wallet, within the campaign limits | None |
| `wallets` | Addresses added by the owner | `wallets`, `paused: true` |
| `merkle` | Fixed recipient root | `wallets` |
| `token` | Current owner of an ERC-721 token; each token ID can claim once even after a transfer | `source`; use an existing `probeTokenId` to check the ownership interface |
| `achievement` | Registry reports that the wallet completed the achievement | `source`, `achievement`; optional `probeAccount` checks a specific player at the reviewed block |

For random rewards set `random: true` and supply up to 64 distinct benefit IDs. Omitted or zero weights become 100; explicit positive weights override that default. `noDuplicates: true` removes previously selected benefits for that wallet. The planner rejects a claim limit larger than the unique pool. Random campaigns require an entropy source and a working fulfillment operator; creating a campaign does not prove that integration works.

The planner accepts at most 4,096 recipients, rejects duplicates and the zero address, checks that the claim window has not ended, and simulates `createAt`. That call binds the reviewed campaign ID: if another campaign was created in the meantime, the stale call reverts instead of shifting the Merkle proof domain. Merkle leaves include the chain, claims contract, campaign ID, and recipient. Keep proof artifacts private if the recipient list should not be public; the chain only needs the root and each claimant's proof.

Wallet lists intentionally remain owner-expandable. Their addresses are not committed by `createAt`. Keep the campaign paused while submitting the generated `walletCalls`, confirm each receipt, and read back every `walletList(campaignId, account)` entry before unpausing. Review the exact calldata for every batch. The output labels this mutable policy explicitly. Use Merkle when the complete recipient set must be fixed at creation.

The output records the reviewed block hash, owner, code hashes, entropy address, eligibility probes, benefit receiver addresses, and receiver authority where a `rewardClaims()` getter exists. A known wrong authority rejects the plan. An unknown getter is reported as unknown; it is not silently accepted as verified. Even a matching getter does not prove that a receiver will accept the actual benefit and context. Validate creation, eligibility, claim, redemption, and random fulfillment against the intended receivers on a disposable local chain before signing a release plan.

No wallet keys, recipient contacts, or notification delivery are part of this command.

Without `probeAccount`, an achievement probe checks interface callability using the zero address and reports player eligibility as unverified. With it, the result identifies the player and their unlocked flag at the reviewed block. Neither result proves that campaign limits, a claim, or redemption will succeed.
