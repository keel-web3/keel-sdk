# Wallet capabilities

The typed matrix in `packages/bitcoin-wallets/src/capabilities.ts` records API-level evidence. Supported means a mock or package helper covers the flow, not that an extension or hardware wallet accepted it. Every live cell is untested. Pending T07 signing is not integrated or verified here. A network cell describes the connection helper, not a live wallet. Testnet address prefixes do not distinguish testnet3, testnet4 and signet. Xverse rejects testnet3 and testnet4 as ambiguous. Magic Eden uses a mocked legacy callback; its live availability is unverified.

Only supported vault leaf templates may use script path; generic script paths are unsupported. Leather and Magic Eden do not support BIP-322 here. The live KEEL reader does not classify outputs; a 404 fails closed.

Negative test pointers for the nine audit defects:

1. Network selection: `test/network.test.ts`.
2. Xverse network ambiguity: `test/xverse.test.ts`.
3. Roles: `test/accounts.test.ts`, rejects missing and duplicate roles.
4. Keys and prevouts: `test/keys.test.ts`, rejects mismatches.
5. Signing: pending T07 `test/signing.test.ts`; integration and coverage remain under review.
6. Session changes: `test/session.test.ts`, refuses an in-flight signature after invalidation.
7. Login: `test/login.test.ts`, rejects forged proof and replay.
8. Provider errors: `test/providers.test.ts`, preserves rejection and rejects invalid roles.
9. Returned PSBT: `test/signed-review.test.ts`, rejects changed output and sequence.
