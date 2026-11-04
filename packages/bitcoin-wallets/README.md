# Bitcoin wallets

`@keel/bitcoin-wallets` connects typed wallet sessions, verifies both login roles, and signs reviewed PSBTs through the selected provider. It accepts no private keys. It never finalizes or broadcasts. Browser bundlers select the browser entry, which supplies Buffer for the BIP-322 dependency; verification uses browser-compatible curve primitives.

Use `createBitcoinWalletAdapter` with callbacks bound to one selected provider: `connect(network)`, `readLiveSession(network)` and `getNetwork()`. Network reads must come from that provider. A testnet address prefix or a requested network is not evidence of the current chain. Supply event subscriptions, a focus target, an invalidation callback and a KEEL output reader. The adapter rechecks both addresses and network before and after signatures and clears pending work on changes.

For Xverse, use `connectXverse` and `reconcileXverse`, then normalize their accounts with `createSession` and `validateAccount`:

```ts
import {
  connectXverse, reconcileXverse, createSession, validateAccount,
  createBitcoinWalletAdapter, unwrapWalletResponse,
  type BtcNet, type XverseConnection,
} from "@keel/bitcoin-wallets";

const toSession = (connection: XverseConnection) => createSession(
  "xverse", connection.network,
  connection.accounts.map(account => validateAccount({
    ...account,
    addressType: account.addressType === "p2sh" ? "p2sh-p2wpkh" : account.addressType,
  }, connection.network)),
);

// selectedWallet, keelReader, subscriptions and clearSession belong to the host.
const adapter = createBitcoinWalletAdapter({
  id: "xverse",
  connect: async (net: BtcNet) => toSession(await connectXverse(selectedWallet, net)),
  readLiveSession: async (net: BtcNet) => toSession(await reconcileXverse(selectedWallet, net)),
  getNetwork: async () => {
    const result = unwrapWalletResponse(await selectedWallet.request("wallet_getNetwork", null));
    const name = (result as { bitcoin?: { name?: string } }).bitcoin?.name;
    return name === "Mainnet" ? "mainnet" : name === "Signet" ? "signet"
      : name === "Regtest" ? "regtest" : "unknown";
  },
  signingProvider: selectedWallet,
  reader: keelReader,
  subscribe: subscriptions,
  onInvalidate: clearSession,
});
await adapter.connect("mainnet"); // use a mocked provider for local tests
```

Leather and Magic Eden have explicit connection helpers. UniSat and OKX hosts normalize their single Taproot address with `sharedAddressSession`; OKX provider selection uses `selectOkxProvider` for the requested network. No helper chooses whichever provider happens to exist. Bind all host callbacks and signing/message transports to that same provider.

Show the exact transaction review before calling `adapter.signPsbt(reviewedRequest)`. The adapter derives payment prevouts from those bytes, requires current asset-free reader evidence, checks per-input signing scope, and verifies every wallet return. It also classifies shared-address inputs that match the payment script. Before local finalization and broadcast, call `adapter.recheckBeforeBroadcast(signedPsbtBase64)` on the exact returned bytes. This rechecks identity, signatures and classification. Direct RPC broadcasts outside this API remain the host's responsibility. Dispose the adapter when its host unmounts.

A requested payment-role vault input whose script differs from the payment address is unsupported: the current reader schema binds outputs to that address, so the adapter rejects the input before invoking the provider. Supported ordinals-role vault signing keeps its explicit role.

The current live recursion reader has no classification index. A 404, unknown, stale or incomplete result is unspendable. Do not describe mocked reader tests as live payment readiness. The API does not provide an asset-transfer policy that bypasses this payment guard.

`Bip322LoginManager` issues a server challenge binding domain, URI, network and both addresses. Sign both roles with `signMessageBip322`; a shared address needs one proof. The manager verifies strict signatures and consumes the nonce once. It is single-process only; scaled hosts need shared atomic challenge storage and issue their own httpOnly session cookie. Never persist signatures in browser storage.

See the [wallet-by-flow matrix](../../docs/ordinals-wallets/CAPABILITIES.md) and [source provenance](PROVENANCE.md). Mocked provider support is separate from live extension, service and hardware acceptance, which remains untested.
