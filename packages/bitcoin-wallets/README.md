# Bitcoin wallets

The adapter in pending T16 is a draft and is not yet exported or approved for signing. The following is a mocked mainnet integration sketch for the planned API; it does not connect to a live wallet.

```ts
const adapter = createBitcoinWalletAdapter({
  id: "xverse",
  connect: async network => toValidatedSession(await connectXverse(selectedProvider, network)),
  readLiveSession: network => readSelectedProviderSession(selectedProvider, network),
  getNetwork: () => readSelectedProviderNetwork(selectedProvider),
  signingProvider: selectedSigningProvider,
  reader: keelReader,
  subscribe: selectedProviderSubscriptions,
  onInvalidate: () => clearLoginUtxosAndPendingPsbts(),
});
await adapter.connect("mainnet"); // mocked provider only
```

The host supplies the mock functions and converts the low-level connection into a validated session with explicit roles. Bind all callbacks and transports to the same selected provider. Use the reviewed low-level connection helpers and a KEEL reader with complete classification evidence. Reconcile live identity before signing and on focus; invalidate login, UTXOs and pending PSBTs on account, network or disconnect events. The current live reader cannot classify outputs, and 404 fails closed.

Before local finalization and broadcast, call `recheckBeforeBroadcast` on the returned PSBT and recheck the transaction and inputs. The package never signs server-side, finalizes or broadcasts. The server login manager is single-process only. The host issues an httpOnly cookie and must use shared atomic challenge storage when scaled.

See [capability evidence](../../docs/ordinals-wallets/CAPABILITIES.md).
