# Wallet capabilities

Supported means mocked provider or package-helper coverage. Every live extension and hardware flow is **untested**. Network cells describe package connection/transport boundaries and require an explicit live network callback; address prefixes cannot distinguish testnet3, testnet4 and signet. Xverse's connection helper rejects testnet3/testnet4 as ambiguous. Magic Eden's legacy callback is mocked; live availability is unverified.

| Flow | xverse | leather | unisat | okx | magic-eden |
|---|---|---|---|---|---|
| Connect | supported | supported | untested | untested | supported |
| Separate roles | supported | supported | unsupported | unsupported | supported |
| Shared roles | unsupported | unsupported | supported | supported | unsupported |
| Dual-role BIP-322 | supported | unsupported | supported | supported | unsupported |
| Key-path PSBT | supported | supported | supported | supported | supported |
| Custom sighash | unsupported | unsupported | supported | supported | unsupported |
| Vault leaf | unsupported | unsupported | supported | supported | unsupported |
| Generic script | unsupported | unsupported | unsupported | unsupported | unsupported |
| Events | supported | untested | supported | untested | untested |
| Mainnet | supported | supported | supported | supported | supported |
| Testnet3 | unsupported | supported | supported | supported | unsupported |
| Testnet4 | unsupported | unsupported | unsupported | unsupported | unsupported |
| Signet | supported | supported | unsupported | untested | unsupported |
| Regtest | supported | unsupported | unsupported | unsupported | unsupported |

Custom sighash means modes beyond ALL/DEFAULT. Vault leaves are the supported cooperative/refund templates; generic script paths fail closed. UniSat/OKX connection requires host callbacks that normalize a single Taproot address into explicit shared roles. Their native provider discovery is outside this package. OKX Signet is documented but not accepted as a tested complete connection here. Leather/ME BIP-322 remains unsupported.

The current live KEEL recursion reader has no output-classification index. A 404, lag, missing field or unknown asset status makes an output unspendable. Mocked reader evidence does not prove live classification readiness.

| Audit defect | Negative coverage |
|---|---|
| 1. Provider/network selection | `test/network.test.ts`: exact provider, ambiguous/mismatched chain |
| 2. Legacy Xverse connection | `test/xverse.test.ts`: missing roles and ambiguous network |
| 3. Purpose inference | `test/accounts.test.ts`: bare strings, unknown/duplicate/missing roles |
| 4. Key and prevout metadata | `test/keys.test.ts`: wrong key, txid/vout and caller mutation |
| 5. Signing scope/sighash/tweak | `test/signing.test.ts`: invalid leaf/key/control block, scope and modes |
| 6. Session lifecycle | `test/session.test.ts`: all events, hydration and in-flight invalidation |
| 7. Protocol label | `test/messages.test.ts`: Phantom and compact legacy proofs on SegWit/Taproot |
| 8. Errors/missing wallets | `test/providers.test.ts`: preserved rejection, bad roles and unknown Leather type |
| 9. Signed return integrity | `test/signed-review.test.ts`: bytes, signatures, metadata and unsupported retained input |

`test/login.test.ts` covers real dual-role nonce proofs. `test/utxos.test.ts` covers inscriptions at 546, 10k and 1 BTC, runes, rare/unknown/stale outputs, duplicate outpoints and immutable receipts. Guarded integration coverage lives in `test/wallet.test.ts`.
