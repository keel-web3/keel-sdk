import { payments, Psbt } from "bitcoinjs-lib";
import { describe, expect, it } from "vitest";

import {
  createVaultPsbtReview,
  validateWalletSignedVaultPsbt,
} from "../src/psbt-review.js";
import {
  createCooperativeVaultPsbt,
  createRefundVaultPsbt,
  createTaprootAuctionVault,
  ECPair,
  REGTEST_NETWORK,
  signVaultPsbt,
} from "../src/taproot-auction-vault.js";
import { corruptOwnerTaprootSignature } from "./vault-test-helpers.js";

const INSCRIPTION_ID = `${"ab".repeat(32)}i0`;
const indexedEvidence = {
  inscription: {
    address: "bcrt1qindexedowner",
    id: INSCRIPTION_ID,
    inscriptionHeight: 450,
    satpoint: `${"22".repeat(32)}:1:0`,
    verifiedAtBlockHeight: 499,
  },
  cardinalInputs: [{
    inscriptionIds: [],
    outpoint: `${"11".repeat(32)}:0`,
    valueSats: 60_000n,
    verifiedAtBlockHeight: 499,
  }],
} as const;

function winnerReviewBase(psbtBase64: string, movement: string) {
  return {
    action: "winner-settlement" as const,
    asset: {
      inscriptionId: INSCRIPTION_ID,
      label: "Original inscription",
      movement,
    },
    indexedEvidence,
    network: "regtest" as const,
    psbtBase64,
    role: "bidder" as const,
  };
}

describe("decoded vault PSBT review", () => {
  const owner = ECPair.makeRandom({ network: REGTEST_NETWORK });
  const coordinator = ECPair.makeRandom({ network: REGTEST_NETWORK });
  const ownerAddress = payments.p2wpkh({
    network: REGTEST_NETWORK,
    pubkey: owner.publicKey,
  }).address!;
  const sellerAddress = payments.p2wpkh({
    network: REGTEST_NETWORK,
    pubkey: coordinator.publicKey,
  }).address!;
  const vault = createTaprootAuctionVault({
    coordinatorPublicKey: coordinator.publicKey,
    ownerPublicKey: owner.publicKey,
    refundAfterHeight: 500,
  });
  const funding = {
    outputIndex: 0,
    transactionId: "11".repeat(32),
    valueSats: 60_000n,
  };

  it("decodes exact inputs, outputs, semantic amounts, fee rate, locktime, RBF and sighash", () => {
    const unsigned = createCooperativeVaultPsbt({
      vault,
      funding,
      outputs: [
        { address: ownerAddress, valueSats: 49_000n },
        { address: sellerAddress, valueSats: 10_000n },
      ],
    });
    const review = createVaultPsbtReview({
      action: "cooperative-cancel",
      asset: {
        inscriptionId: INSCRIPTION_ID,
        label: "Original inscription",
        movement: "No inscription moves in this cancelled lane.",
      },
      indexedEvidence,
      network: "regtest",
      psbtBase64: unsigned,
      role: "bidder",
      trustedSettlementPlan: {
        outputs: [
          { destinationAddress: ownerAddress, purpose: "owner-change", valueSats: 49_000n },
          { destinationAddress: sellerAddress, purpose: "stamp-purchase", valueSats: 10_000n },
        ],
      },
    });

    expect(review.inputs[0]).toMatchObject({
      outpoint: `${"11".repeat(32)}:0`,
      valueSats: "60000",
      sequence: 0xffff_ffff,
      rbfEnabled: false,
      sighash: { code: 0, label: "SIGHASH_DEFAULT" },
      inscription: { included: false, satpoint: null },
    });
    expect(review.outputs.map((output) => ({
      address: output.destinationAddress,
      purpose: output.purpose,
      type: output.scriptType,
      value: output.valueSats,
    }))).toEqual([
      { address: ownerAddress, purpose: "owner-change", type: "p2wpkh", value: "49000" },
      { address: sellerAddress, purpose: "stamp-purchase", type: "p2wpkh", value: "10000" },
    ]);
    expect(review.amounts).toEqual({
      buyerPaymentSats: "60000",
      sellerPaymentSats: "0",
      marketplaceFeeSats: "0",
      stampPaymentSats: "10000",
      changeSats: "49000",
      otherOutputSats: "0",
      networkFeeSats: "1000",
      inputTotalSats: "60000",
      outputTotalSats: "59000",
    });
    expect(review.locktime).toBe(0);
    expect(review.estimatedVirtualBytes).toBe(180);
    expect(review.feeRate).toEqual({
      numeratorSats: "1000",
      denominatorVirtualBytes: 180,
      displaySatsPerVbyte: "5.555",
    });
    expect(review.exactArithmetic).toBe("60000 input sats = 59000 output sats + 1000 network-fee sats");
  });

  it("shows an owner-only timeout review with non-final non-RBF sequence", () => {
    const refund = createRefundVaultPsbt({
      vault,
      funding,
      destination: { address: ownerAddress, valueSats: 59_000n },
    });
    const review = createVaultPsbtReview({
      action: "timeout-refund",
      asset: {
        inscriptionId: INSCRIPTION_ID,
        label: "Cancelled auction lane",
        movement: "The inscription remains separate from this refund.",
      },
      indexedEvidence,
      network: "regtest",
      psbtBase64: refund,
      role: "patron",
      trustedSettlementPlan: {
        outputs: [{ destinationAddress: ownerAddress, purpose: "owner-change", valueSats: 59_000n }],
      },
    });

    expect(review.locktime).toBe(500);
    expect(review.inputs[0]).toMatchObject({ sequence: 0xffff_fffe, rbfEnabled: false });
    expect(review.estimatedVirtualBytes).toBe(126);
  });

  it("rejects a transaction whose script or value differs from the trusted settlement plan", () => {
    const unsigned = createCooperativeVaultPsbt({
      vault,
      funding,
      destination: { address: sellerAddress, valueSats: 59_000n },
    });
    const base = winnerReviewBase(
      unsigned,
      "The cardinal vault confirms before the separate inscription transfer.",
    );

    expect(() => createVaultPsbtReview({
      ...base,
      trustedSettlementPlan: {
        outputs: [{ destinationAddress: ownerAddress, purpose: "seller-payment", valueSats: 59_000n }],
      },
    })).toThrow("does not match the trusted settlement plan");
    expect(() => createVaultPsbtReview({
      ...base,
      trustedSettlementPlan: {
        outputs: [{ destinationAddress: sellerAddress, purpose: "seller-payment", valueSats: 58_999n }],
      },
    })).toThrow("does not match the trusted settlement plan");
  });

  it("rejects stale asset identity and an input whose ord receipt contains an inscription", () => {
    const unsigned = createCooperativeVaultPsbt({
      vault,
      funding,
      destination: { address: sellerAddress, valueSats: 59_000n },
    });
    const base = {
      ...winnerReviewBase(
        unsigned,
        "The indexed original stays outside this cardinal vault spend.",
      ),
      trustedSettlementPlan: {
        outputs: [{ destinationAddress: sellerAddress, purpose: "seller-payment" as const, valueSats: 59_000n }],
      },
    };
    expect(() => createVaultPsbtReview({
      ...base,
      indexedEvidence: {
        ...indexedEvidence,
        inscription: { ...indexedEvidence.inscription, id: `${"cd".repeat(32)}i0` },
      },
    })).toThrow("does not match the reviewed asset");
    expect(() => createVaultPsbtReview({
      ...base,
      indexedEvidence: {
        ...indexedEvidence,
        cardinalInputs: [{
          ...indexedEvidence.cardinalInputs[0],
          inscriptionIds: [INSCRIPTION_ID],
        }],
      },
    })).toThrow("lacks a current cardinal-only ord receipt");
  });

  it("accepts only the expected owner signature without reviewed-field mutation", () => {
    const unsigned = createCooperativeVaultPsbt({
      vault,
      funding,
      destination: { address: sellerAddress, valueSats: 59_000n },
    });
    const coordinatorSigned = signVaultPsbt({ psbtBase64: unsigned, signer: coordinator });
    const ownerSigned = signVaultPsbt({ psbtBase64: coordinatorSigned, signer: owner });
    const normalized = validateWalletSignedVaultPsbt({
      expectedPsbtBase64: coordinatorSigned,
      requiredSignerPublicKeyHex: Buffer.from(owner.publicKey).toString("hex"),
      signedPsbtHex: Psbt.fromBase64(ownerSigned).toHex(),
    });

    expect(Psbt.fromBase64(normalized).data.inputs[0]?.tapScriptSig).toHaveLength(2);
  });

  it("rejects fabricated 64-byte and wrong-leaf owner signatures", () => {
    const unsigned = createCooperativeVaultPsbt({
      vault,
      funding,
      destination: { address: sellerAddress, valueSats: 59_000n },
    });
    const coordinatorSigned = signVaultPsbt({ psbtBase64: unsigned, signer: coordinator });
    const ownerSigned = Psbt.fromBase64(signVaultPsbt({ psbtBase64: coordinatorSigned, signer: owner }));
    const ownerXOnly = Buffer.from(owner.publicKey).subarray(1).toString("hex");
    const fabricated = corruptOwnerTaprootSignature(
      ownerSigned.toBase64(),
      ownerXOnly,
      "signature",
    );
    expect(() => validateWalletSignedVaultPsbt({
      expectedPsbtBase64: coordinatorSigned,
      requiredSignerPublicKeyHex: Buffer.from(owner.publicKey).toString("hex"),
      signedPsbtHex: fabricated.toHex(),
    })).toThrow("invalid Taproot Schnorr signature");

    const wrongLeaf = corruptOwnerTaprootSignature(
      ownerSigned.toBase64(),
      ownerXOnly,
      "leaf-hash",
    );
    expect(() => validateWalletSignedVaultPsbt({
      expectedPsbtBase64: coordinatorSigned,
      requiredSignerPublicKeyHex: Buffer.from(owner.publicKey).toString("hex"),
      signedPsbtHex: wrongLeaf.toHex(),
    })).toThrow("other than the reviewed vault path");
  });

  it("rejects wallet changes to outputs, input metadata, spend path, sighash, or signer", () => {
    const unsigned = createCooperativeVaultPsbt({
      vault,
      funding,
      destination: { address: sellerAddress, valueSats: 59_000n },
    });
    const coordinatorSigned = signVaultPsbt({ psbtBase64: unsigned, signer: coordinator });
    const changedOutput = Psbt.fromBase64(coordinatorSigned);
    const changedTransaction = Psbt.fromBase64(createCooperativeVaultPsbt({
      vault,
      funding,
      destination: { address: sellerAddress, valueSats: 58_000n },
    }));
    const changedOutputHex = changedTransaction.toHex();
    expect(() => validateWalletSignedVaultPsbt({
      expectedPsbtBase64: coordinatorSigned,
      requiredSignerPublicKeyHex: Buffer.from(owner.publicKey).toString("hex"),
      signedPsbtHex: changedOutputHex,
    })).toThrow("changed the reviewed transaction");

    const changedUtxo = Psbt.fromBase64(coordinatorSigned);
    const existing = changedUtxo.data.inputs[0]?.witnessUtxo;
    if (existing === undefined) throw new Error("fixture witness UTXO missing");
    changedUtxo.data.inputs[0]!.witnessUtxo = { ...existing, value: 61_000n };
    expect(() => validateWalletSignedVaultPsbt({
      expectedPsbtBase64: coordinatorSigned,
      requiredSignerPublicKeyHex: Buffer.from(owner.publicKey).toString("hex"),
      signedPsbtHex: changedUtxo.toHex(),
    })).toThrow("changed the reviewed input UTXO");

    changedOutput.data.inputs[0]!.sighashType = TransactionSighashAll;
    expect(() => validateWalletSignedVaultPsbt({
      expectedPsbtBase64: coordinatorSigned,
      requiredSignerPublicKeyHex: Buffer.from(owner.publicKey).toString("hex"),
      signedPsbtHex: changedOutput.toHex(),
    })).toThrow("changed the reviewed sighash mode");

    expect(() => validateWalletSignedVaultPsbt({
      expectedPsbtBase64: coordinatorSigned,
      requiredSignerPublicKeyHex: Buffer.from(owner.publicKey).toString("hex"),
      signedPsbtHex: Psbt.fromBase64(coordinatorSigned).toHex(),
    })).toThrow("required owner signature");
  });
});

const TransactionSighashAll = 1;
