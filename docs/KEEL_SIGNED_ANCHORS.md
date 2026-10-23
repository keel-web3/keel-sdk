# Signed anchor preparation

The signed launch route lets an operator attest that a foreign source contains the
exact decoded bytes committed by an EVM anchor request. The onchain adapter checks
the operator's signature, policy, expiry and request generation. A signature does
not independently prove the foreign source or its finality.

```ts
import { prepareSignedAnchorAttestation, encodeSignedAnchorSubmission } from "@keel/sdk";

const prepared = await prepareSignedAnchorAttestation({
  publicClient,
  expectedChainId,
  adapter,
  expectedSigner,
  expectedPolicyDigest,
  anchorId,
  deadline,
  observeSource: async ({ anchor, task, policyDigest, blockNumber }) => {
    // Your service authenticates all source coordinates and finality under this policy.
    // Return reconstructed decoded bytes and the report retained for independent audit.
    return inspectFinalizedSource({ anchor, task, policyDigest, blockNumber });
  },
});

// Use the operator's configured signer only after its source checks succeed.
const signature = await operatorSigner.signTypedData(prepared.typedData);
const calldata = encodeSignedAnchorSubmission(prepared.attestation, signature);
```

`inspectFinalizedSource` is application-supplied; the SDK does not supply a generic
foreign-chain trust policy. `operatorSigner` is your service integration, not an
account created by this helper. Preparation itself neither signs nor broadcasts.

Preparation reads the request and adapter at one mined destination block. It
requires the expected signer/policy, active attested verifier, one pending decoded
SHA-256 task, exact observed digest and byte length, and nonempty evidence. It
recomputes the request binding and compares the EIP-712 digest to the contract's
view. The result contains the evidence bytes, their committed digest and the read
block so the operator can retain its complete decision record. The contract checks
current policy and request status again when a relayer submits.

`buildSignedAnchorTypedData` constructs a bounded offline approval;
`signedAnchorRequestDigest` exposes the request encoding; neither function checks
a source chain. The EIP-712 domain is `KEEL Signed Anchor`, version `1`, destination
chain ID and adapter address. The typed approval binds anchor ID, generation nonce,
request digest, evidence digest and deadline. The exported ABI's tuple layout is
separate from the typed-data field ordering.

The native Tezos catalog also exposes `KeelAnchorReceiptRegistry` and
`KeelSignedAnchorVerifier`. Its signing wire format is explicit Tezos PACK from the
adapter's `signing_payload` view; these EVM helpers must not be used for it. Native
receipts retain separate methods for the same claim, allowing a later proof adapter
to add evidence without rewriting a signed approval. No proof circuit is supplied
by this SDK addition.

See the paired contract [integration guide](https://github.com/Ravonus/keel-contracts/blob/codex/tezos-behavior-parity-20261015/docs/architecture/ANCHOR_VERIFICATION.md)
and [verification report](https://github.com/Ravonus/keel-contracts/blob/codex/tezos-behavior-parity-20261015/docs/reviews/tezos-behavior-parity-20261015/SIGNED_ANCHORS.md).
