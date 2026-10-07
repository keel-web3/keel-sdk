# Collector access through Studio

Use https://studio.onkeel.io and its `/llms.txt` for the current release. KEEL Desktop is optional. The website manages lists, conditions, diagnostics and creator-owned signers. Request `access:read` and `access:write` explicitly through the secure Studio connection. Existing draft grants do not acquire new permissions automatically.

```ts
import { createConnectedStudioAccessClient } from '@keel/sdk/studio-connection-node';
const access = await createConnectedStudioAccessClient({ workspace: process.cwd() });
const { list } = await access.read(releaseId);
await access.update(releaseId, {
  expectedRevision: list?.revision ?? null,
  wallets: ['0x...'],
  // Optional campaign and explicit per-member allocation/status/reason.
});
const diagnostic = await access.test(releaseId, wallet, ['0', '42']);
```

Read `/api/access/schema` for the strict campaign/update shape. Preserve unrelated wallets, allocations and revoked statuses. On conflict, reread and reconcile rather than overwriting. The Studio test reports actual reads and unavailable providers; do not invent evidence. For arbitrary Twitter, Discord, indexer or custom conditions select agent-managed verification and update approved wallets only after your own authorized verification. The resulting list is enforced; agent narration is not provider proof.

Automatic conditions include ERC-721 holdings/exact IDs, ERC-1155 ID quantities, ERC-20 balances using token decimals, native balance, sent-transaction nonce and `isEligible(address)` contracts. ERC-721 one-use claims use OneMint's onchain bitmap via `claimMint`: one NFT ID per work, up to 64, on the release chain. Transfer does not reset a bit. Ordinary ownership conditions are reusable and checked when the short-lived approval is requested. ERC-1155 balance checks are distinct from unique ERC-721 ID consumption.

Use `access.requests(releaseId)` for pending EIP-712 packets. A caller-owned signer may sign them locally with `signKeelStudioAccessRequest` and submit only the resulting signature using `access.approve`. Verify collector, quantity, chain, drop and deadline before signing. Never send a signing key to Studio, write it into a project, or ask the user to paste it into chat. External EOA/ERC-1271 signatures are checked against the live reviewed signer. The access grant cannot bypass that signature and cannot mint.

Local MCP `keel-studio-access` operations: `read`, `update`, `test`, `requests`, `approve`. Remote Studio MCP uses `keel_access_read/update/test/requests/approve`. Keys use the existing secure paired connection. Read scope is enough for test; write scope is required for updates/approval submission. Live wallet membership can change; published campaign rules and signer cannot. Previously issued approvals have a short expiry; only pausing the mint immediately stops them.

X uses the platform OAuth 2.0 app and a fresh user consent for `like.read`, `follows.read`, baseline read scopes and refresh. A second X app is not needed for those permissions. API plan/quota may still restrict endpoints. The collector links their own X account; agents do not receive provider tokens. Discord roles/reactions require the appropriate server/bot access or an agent-managed verification source.
