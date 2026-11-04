import { Buffer } from "node:buffer";

import {
  address as bitcoinAddress,
  crypto as bitcoinCrypto,
  networks,
  opcodes,
  Psbt,
  script,
  Transaction,
  type Network,
} from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import type {
  TrustedVaultSettlementPlan,
  VaultPsbtIndexedEvidence,
  VaultPsbtOutputPurpose,
  VaultPsbtReview,
} from "./psbt-review-schema.js";
import { vaultPsbtReviewSchema } from "./psbt-review-schema.js";

export * from "./psbt-review-schema.js";

export function createVaultPsbtReview(input: {
  readonly action: VaultPsbtReview["action"];
  readonly asset: Omit<VaultPsbtReview["asset"], "indexedReceipt">;
  readonly indexedEvidence: VaultPsbtIndexedEvidence;
  readonly network: VaultPsbtReview["network"];
  readonly psbtBase64: string;
  readonly role: VaultPsbtReview["role"];
  readonly trustedSettlementPlan: TrustedVaultSettlementPlan;
}): VaultPsbtReview {
  const network = bitcoinNetwork(input.network);
  const psbt = Psbt.fromBase64(input.psbtBase64, { network });
  const transaction = unsignedTransaction(psbt);
  const indexedInscription = input.indexedEvidence.inscription;
  if (indexedInscription.id !== input.asset.inscriptionId) {
    throw new Error("The indexed inscription receipt does not match the reviewed asset.");
  }
  if (
    !Number.isInteger(indexedInscription.verifiedAtBlockHeight)
    || indexedInscription.verifiedAtBlockHeight < 0
    || !Number.isInteger(indexedInscription.inscriptionHeight)
    || indexedInscription.inscriptionHeight < 0
    || !/^[0-9a-f]{64}:\d+:\d+$/.test(indexedInscription.satpoint)
  ) {
    throw new Error("The indexed inscription receipt is incomplete.");
  }
  if (transaction.ins.length !== psbt.data.inputs.length) {
    throw new Error("PSBT input metadata does not match its unsigned transaction.");
  }
  if (input.indexedEvidence.cardinalInputs.length !== transaction.ins.length) {
    throw new Error("Every PSBT input needs one current cardinal-only ord receipt.");
  }
  if (transaction.outs.length !== input.trustedSettlementPlan.outputs.length) {
    throw new Error("The PSBT outputs do not match the trusted settlement plan.");
  }

  const inputs = transaction.ins.map((transactionInput, index) => {
    const psbtInput = psbt.data.inputs[index];
    if (psbtInput === undefined) {
      throw new Error(`PSBT input ${index.toString()} has no metadata.`);
    }
    const witnessUtxo = psbtInput?.witnessUtxo;
    if (witnessUtxo === undefined) {
      throw new Error(`PSBT input ${index.toString()} has no witness UTXO value or script.`);
    }
    const sighashCode = psbtInput.sighashType ?? Transaction.SIGHASH_DEFAULT;
    if (sighashCode !== Transaction.SIGHASH_DEFAULT) {
      throw new Error("Auction vault PSBTs require SIGHASH_DEFAULT.");
    }
    const transactionId = Buffer.from(transactionInput.hash).reverse().toString("hex");
    const outpoint = `${transactionId}:${transactionInput.index.toString()}`;
    const cardinalReceipt = input.indexedEvidence.cardinalInputs.find(
      (candidate) => candidate.outpoint === outpoint,
    );
    if (
      cardinalReceipt === undefined
      || cardinalReceipt.inscriptionIds.length !== 0
      || parseEvidenceSats(cardinalReceipt.valueSats) !== witnessUtxo.value
      || !Number.isInteger(cardinalReceipt.verifiedAtBlockHeight)
      || cardinalReceipt.verifiedAtBlockHeight < 0
    ) {
      throw new Error(`PSBT input ${index.toString()} lacks a current cardinal-only ord receipt.`);
    }
    const previousOutputScript = Buffer.from(witnessUtxo.script);
    return {
      index,
      outpoint,
      valueSats: witnessUtxo.value.toString(),
      previousOutputScriptHex: previousOutputScript.toString("hex"),
      previousOutputAddress: outputAddress(previousOutputScript, network),
      sequence: transactionInput.sequence,
      rbfEnabled: transactionInput.sequence < 0xffff_fffe,
      sighash: {
        code: 0 as const,
        label: "SIGHASH_DEFAULT" as const,
        commitsTo: "all-inputs-and-outputs" as const,
      },
      inscription: {
        included: false,
        inscriptionId: null,
        satpoint: null,
        explanation: "Not applicable: this PSBT spends only a cardinal Taproot auction vault. Inscription movement is a separate ord transaction after vault confirmation.",
        cardinalOnlyVerified: true as const,
        verifiedAtBlockHeight: cardinalReceipt.verifiedAtBlockHeight,
      },
    };
  });

  const outputs = transaction.outs.map((transactionOutput, index) => {
    const outputScript = Buffer.from(transactionOutput.script);
    const plannedOutput = input.trustedSettlementPlan.outputs[index];
    if (plannedOutput === undefined) {
      throw new Error("The PSBT contains an output outside the trusted settlement plan.");
    }
    const plannedValue = parsePlannedSats(plannedOutput.valueSats);
    const plannedScript = Buffer.from(bitcoinAddress.toOutputScript(
      plannedOutput.destinationAddress,
      network,
    ));
    if (
      transactionOutput.value !== plannedValue
      || !outputScript.equals(plannedScript)
    ) {
      throw new Error(`PSBT output ${index.toString()} does not match the trusted settlement plan.`);
    }
    return {
      index,
      purpose: plannedOutput.purpose,
      valueSats: transactionOutput.value.toString(),
      scriptHex: outputScript.toString("hex"),
      scriptType: outputScriptType(outputScript),
      destinationAddress: outputAddress(outputScript, network),
    };
  });
  const inputTotal = sumBigInts(inputs.map((item) => BigInt(item.valueSats)));
  const outputTotal = sumBigInts(outputs.map((item) => BigInt(item.valueSats)));
  const networkFee = inputTotal - outputTotal;
  if (networkFee <= 0n) throw new Error("PSBT outputs must leave a positive network fee.");

  const amountFor = (purpose: VaultPsbtOutputPurpose): bigint => sumBigInts(
    outputs.filter((output) => output.purpose === purpose).map((output) => BigInt(output.valueSats)),
  );
  const sellerPayment = amountFor("seller-payment");
  const marketplaceFee = amountFor("marketplace-fee");
  const stampPayment = amountFor("stamp-purchase");
  const change = amountFor("owner-change");
  const other = amountFor("other");
  if (sellerPayment + marketplaceFee + stampPayment + change + other !== outputTotal) {
    throw new Error("PSBT semantic output totals do not equal the transaction output total.");
  }

  const estimatedVirtualBytes = estimatedFinalVirtualBytes(psbt, transaction);
  const review: VaultPsbtReview = {
    version: 1,
    network: input.network,
    action: input.action,
    role: input.role,
    asset: {
      ...input.asset,
      indexedReceipt: {
        address: indexedInscription.address,
        inscriptionHeight: indexedInscription.inscriptionHeight,
        satpoint: indexedInscription.satpoint,
        verifiedAtBlockHeight: indexedInscription.verifiedAtBlockHeight,
      },
    },
    inputs,
    outputs,
    amounts: {
      buyerPaymentSats: inputTotal.toString(),
      sellerPaymentSats: sellerPayment.toString(),
      marketplaceFeeSats: marketplaceFee.toString(),
      stampPaymentSats: stampPayment.toString(),
      changeSats: change.toString(),
      otherOutputSats: other.toString(),
      networkFeeSats: networkFee.toString(),
      inputTotalSats: inputTotal.toString(),
      outputTotalSats: outputTotal.toString(),
    },
    locktime: transaction.locktime,
    estimatedVirtualBytes,
    feeRate: {
      numeratorSats: networkFee.toString(),
      denominatorVirtualBytes: estimatedVirtualBytes,
      displaySatsPerVbyte: decimalRate(networkFee, estimatedVirtualBytes),
    },
    exactArithmetic: `${inputTotal.toString()} input sats = ${outputTotal.toString()} output sats + ${networkFee.toString()} network-fee sats`,
    walletReturn: {
      leavesForWallet: true,
      returnRequired: true,
      instruction: "Your wallet opens to add only your signature. Reject any changed input, output, amount, fee, locktime, sequence, or sighash, then return here for broadcast and confirmation.",
    },
  };
  return vaultPsbtReviewSchema.parse(review);
}

export function validateWalletSignedVaultPsbt(input: {
  readonly expectedPsbtBase64: string;
  readonly requiredSignerPublicKeyHex: string;
  readonly signedPsbtHex: string;
  readonly network?: VaultPsbtReview["network"];
}): string {
  const network = bitcoinNetwork(input.network ?? "regtest");
  const expected = Psbt.fromBase64(input.expectedPsbtBase64, { network });
  const returned = Psbt.fromHex(input.signedPsbtHex, { network });
  if (unsignedTransactionHex(expected) !== unsignedTransactionHex(returned)) {
    throw new Error("The wallet changed the reviewed transaction.");
  }
  if (expected.data.inputs.length !== returned.data.inputs.length) {
    throw new Error("The wallet changed the reviewed input count.");
  }
  if (expected.data.inputs.length !== 1) {
    throw new Error("Auction vault wallet review requires exactly one input.");
  }
  for (let index = 0; index < expected.data.inputs.length; index += 1) {
    assertInputMetadataUnchanged(expected, returned, index);
  }
  const expectedSigner = xOnlyHex(input.requiredSignerPublicKeyHex);
  const expectedInput = expected.data.inputs[0];
  const returnedInput = returned.data.inputs[0];
  if (expectedInput === undefined || returnedInput === undefined) {
    throw new Error("The wallet changed the reviewed PSBT inputs.");
  }
  const leafHash = assertVaultTaprootSpendProof(expectedInput);
  const returnedLeafHash = assertVaultTaprootSpendProof(returnedInput);
  if (!returnedLeafHash.equals(leafHash)) {
    throw new Error("The wallet changed the reviewed Taproot spend leaf.");
  }
  if (expectedInput.tapKeySig !== undefined || returnedInput.tapKeySig !== undefined) {
    throw new Error("Auction vault PSBTs do not permit a Taproot key-path signature.");
  }
  const requiredPublicKeys = vaultTaprootRequiredPublicKeys(expectedInput.tapLeafScript?.[0]?.script);
  const returnedSignatures = returnedInput.tapScriptSig ?? [];
  const signerSignature = returnedSignatures.find(
    (signature) => Buffer.from(signature.pubkey).toString("hex") === expectedSigner
      && Buffer.from(signature.leafHash).equals(leafHash),
  );
  const wrongLeafSignature = returnedSignatures.find(
    (signature) => Buffer.from(signature.pubkey).toString("hex") === expectedSigner
      && !Buffer.from(signature.leafHash).equals(leafHash),
  );
  if (wrongLeafSignature !== undefined) {
    throw new Error("The wallet signed a Taproot leaf other than the reviewed vault path.");
  }
  if (signerSignature === undefined) {
    throw new Error("The wallet did not add the required owner signature.");
  }
  if (signerSignature.signature.length !== 64) {
    throw new Error("The wallet returned a non-default Taproot sighash signature.");
  }
  if (!requiredPublicKeys.includes(expectedSigner)) {
    throw new Error("The required owner signer is not part of the reviewed vault leaf.");
  }
  const expectedSignerSet = new Set(
    (expectedInput.tapScriptSig ?? []).map(
      (signature) => Buffer.from(signature.pubkey).toString("hex"),
    ),
  );
  if (expectedSignerSet.has(expectedSigner)) {
    throw new Error("The required owner signature was already present before wallet review.");
  }
  const returnedSignerSet = new Set<string>();
  for (const signature of returnedSignatures) {
    const publicKey = Buffer.from(signature.pubkey).toString("hex");
    if (!requiredPublicKeys.includes(publicKey)) {
      throw new Error("The wallet added a signature from an unexpected key.");
    }
    if (!Buffer.from(signature.leafHash).equals(leafHash)) {
      throw new Error("The wallet signed a Taproot leaf other than the reviewed vault path.");
    }
    if (signature.signature.length !== 64) {
      throw new Error("The wallet returned a non-default Taproot sighash signature.");
    }
    if (returnedSignerSet.has(publicKey)) {
      throw new Error("The wallet returned duplicate Taproot signatures.");
    }
    returnedSignerSet.add(publicKey);
  }
  if (
    returnedSignatures.length !== requiredPublicKeys.length
    || requiredPublicKeys.some((publicKey) => !returnedSignerSet.has(publicKey))
  ) {
    throw new Error("The wallet did not return the exact required vault signer set.");
  }
  assertVaultTaprootInputSignaturesValid(returned, 0);
  return returned.toBase64();
}

function assertInputMetadataUnchanged(expected: Psbt, returned: Psbt, index: number): void {
  const expectedInput = expected.data.inputs[index];
  const returnedInput = returned.data.inputs[index];
  if (expectedInput === undefined || returnedInput === undefined) {
    throw new Error("The wallet changed the reviewed PSBT inputs.");
  }
  const expectedUtxo = expectedInput.witnessUtxo;
  const returnedUtxo = returnedInput.witnessUtxo;
  if (
    expectedUtxo === undefined
    || returnedUtxo === undefined
    || expectedUtxo.value !== returnedUtxo.value
    || !Buffer.from(expectedUtxo.script).equals(Buffer.from(returnedUtxo.script))
  ) {
    throw new Error("The wallet changed the reviewed input UTXO.");
  }
  if ((expectedInput.sighashType ?? 0) !== (returnedInput.sighashType ?? 0)) {
    throw new Error("The wallet changed the reviewed sighash mode.");
  }
  if (canonicalLeaves(expectedInput.tapLeafScript) !== canonicalLeaves(returnedInput.tapLeafScript)) {
    throw new Error("The wallet changed the reviewed Taproot spend path.");
  }
  for (const signature of expectedInput.tapScriptSig ?? []) {
    const retained = (returnedInput.tapScriptSig ?? []).some((candidate) =>
      Buffer.from(candidate.pubkey).equals(Buffer.from(signature.pubkey))
      && Buffer.from(candidate.leafHash).equals(Buffer.from(signature.leafHash))
      && Buffer.from(candidate.signature).equals(Buffer.from(signature.signature))
    );
    if (!retained) throw new Error("The wallet removed the coordinator signature.");
  }
}

function canonicalLeaves(leaves: Psbt["data"]["inputs"][number]["tapLeafScript"]): string {
  return JSON.stringify((leaves ?? []).map((leaf) => ({
    controlBlock: Buffer.from(leaf.controlBlock).toString("hex"),
    leafVersion: leaf.leafVersion,
    script: Buffer.from(leaf.script).toString("hex"),
  })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))));
}

export function assertVaultTaprootInputSignaturesValid(psbt: Psbt, inputIndex: number): void {
  const input = psbt.data.inputs[inputIndex];
  if (input === undefined) {
    throw new Error("The PSBT input for Taproot signature validation is missing.");
  }
  if (input.tapKeySig !== undefined) {
    throw new Error("Auction vault PSBTs do not permit a Taproot key-path signature.");
  }
  const leafHash = assertVaultTaprootSpendProof(input);
  const leafScript = input.tapLeafScript?.[0]?.script;
  const requiredPublicKeys = vaultTaprootRequiredPublicKeys(leafScript);
  const signatures = input.tapScriptSig ?? [];
  if (signatures.length !== requiredPublicKeys.length) {
    throw new Error("The PSBT does not contain exactly one signature for every supported vault signer.");
  }
  const digest = vaultTaprootScriptPathSighash(psbt, inputIndex, leafHash);
  const seenPublicKeys = new Set<string>();
  for (const signature of signatures) {
    const publicKey = Buffer.from(signature.pubkey);
    const signatureBytes = Buffer.from(signature.signature);
    const signatureLeafHash = Buffer.from(signature.leafHash);
    const publicKeyHex = publicKey.toString("hex");
    if (
      publicKey.length !== 32
      || signatureBytes.length !== 64
      || !signatureLeafHash.equals(leafHash)
      || !requiredPublicKeys.includes(publicKeyHex)
      || seenPublicKeys.has(publicKeyHex)
    ) {
      throw new Error("The PSBT contains an invalid Taproot Schnorr signature for the exact transaction sighash and expected leaf.");
    }
    let valid = false;
    try {
      valid = ecc.verifySchnorr(digest, publicKey, signatureBytes);
    } catch {
      valid = false;
    }
    if (!valid) {
      throw new Error("The PSBT contains an invalid Taproot Schnorr signature for the exact transaction sighash and expected leaf.");
    }
    seenPublicKeys.add(publicKeyHex);
  }
  if (requiredPublicKeys.some((publicKey) => !seenPublicKeys.has(publicKey))) {
    throw new Error("The PSBT does not contain exactly one signature for every supported vault signer.");
  }
}

export function vaultTaprootRequiredPublicKeys(leafScript: Uint8Array | undefined): readonly string[] {
  if (leafScript === undefined) {
    throw new Error("Auction vault PSBT Taproot leaf script is missing.");
  }
  const operations = script.decompile(Buffer.from(leafScript));
  if (operations === null) {
    throw new Error("Auction vault PSBT Taproot leaf script is unsupported or invalid.");
  }
  const isXOnlyPublicKey = (operation: number | Uint8Array | undefined): operation is Uint8Array =>
    typeof operation !== "number" && operation !== undefined && operation.length === 32;
  const cooperative =
    operations.length === 4
    && isXOnlyPublicKey(operations[0])
    && operations[1] === opcodes.OP_CHECKSIGVERIFY
    && isXOnlyPublicKey(operations[2])
    && operations[3] === opcodes.OP_CHECKSIG;
  const refund =
    operations.length === 5
    && typeof operations[0] !== "number"
    && operations[0] !== undefined
    && operations[1] === opcodes.OP_CHECKLOCKTIMEVERIFY
    && operations[2] === opcodes.OP_DROP
    && isXOnlyPublicKey(operations[3])
    && operations[4] === opcodes.OP_CHECKSIG;
  if (!cooperative && !refund) {
    throw new Error("Auction vault PSBT Taproot leaf script is unsupported or invalid.");
  }
  const publicKeys: Uint8Array[] = [];
  if (cooperative) {
    const firstPublicKey = operations[0];
    const secondPublicKey = operations[2];
    if (!isXOnlyPublicKey(firstPublicKey) || !isXOnlyPublicKey(secondPublicKey)) {
      throw new Error("Auction vault PSBT Taproot leaf script is unsupported or invalid.");
    }
    publicKeys.push(firstPublicKey, secondPublicKey);
  } else {
    const refundPublicKey = operations[3];
    if (!isXOnlyPublicKey(refundPublicKey)) {
      throw new Error("Auction vault PSBT Taproot leaf script is unsupported or invalid.");
    }
    publicKeys.push(refundPublicKey);
  }
  const publicKeyHexes = publicKeys.map((publicKey) => Buffer.from(publicKey).toString("hex"));
  if (new Set(publicKeyHexes).size !== publicKeyHexes.length) {
    throw new Error("Auction vault PSBT Taproot leaf contains duplicate signer keys.");
  }
  return publicKeyHexes;
}

export function assertVaultTaprootSpendProof(
  input: Psbt["data"]["inputs"][number],
): Buffer {
  const witnessUtxo = input.witnessUtxo;
  const leaves = input.tapLeafScript ?? [];
  if (witnessUtxo === undefined || leaves.length !== 1) {
    throw new Error("Auction vault PSBTs require one exact Taproot script path.");
  }
  const leaf = leaves[0];
  if (leaf === undefined) throw new Error("Auction vault PSBT Taproot leaf is missing.");
  const controlBlock = Buffer.from(leaf.controlBlock);
  if (controlBlock.length < 33 || (controlBlock.length - 33) % 32 !== 0) {
    throw new Error("Auction vault PSBT has an invalid Taproot control block.");
  }
  if ((controlBlock[0]! & 0xfe) !== leaf.leafVersion) {
    throw new Error("Auction vault Taproot control block uses the wrong leaf version.");
  }
  const leafHash = tapLeafHash(Buffer.from(leaf.script), leaf.leafVersion);
  let merkleRoot = leafHash;
  for (let offset = 33; offset < controlBlock.length; offset += 32) {
    const sibling = controlBlock.subarray(offset, offset + 32);
    merkleRoot = Buffer.from(bitcoinCrypto.taggedHash(
      "TapBranch",
      Buffer.compare(merkleRoot, sibling) < 0
        ? Buffer.concat([merkleRoot, sibling])
        : Buffer.concat([sibling, merkleRoot]),
    ));
  }
  const internalKey = controlBlock.subarray(1, 33);
  const tweak = bitcoinCrypto.taggedHash(
    "TapTweak",
    Buffer.concat([internalKey, merkleRoot]),
  );
  const outputKey = ecc.xOnlyPointAddTweak(internalKey, tweak);
  const expectedScript = outputKey === null
    ? undefined
    : Buffer.concat([Buffer.from([opcodes.OP_1, 0x20]), Buffer.from(outputKey.xOnlyPubkey)]);
  if (
    outputKey === null
    || outputKey.parity !== (controlBlock[0]! & 1)
    || expectedScript === undefined
    || !expectedScript.equals(Buffer.from(witnessUtxo.script))
  ) {
    throw new Error("Auction vault Taproot leaf and control block do not commit to the reviewed UTXO.");
  }
  return leafHash;
}

function tapLeafHash(leafScript: Buffer, leafVersion: number): Buffer {
  return Buffer.from(bitcoinCrypto.taggedHash(
    "TapLeaf",
    Buffer.concat([Buffer.from([leafVersion]), compactSize(leafScript.length), leafScript]),
  ));
}

function compactSize(value: number): Buffer {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid Taproot script length.");
  if (value < 0xfd) return Buffer.from([value]);
  if (value <= 0xffff) {
    const encoded = Buffer.allocUnsafe(3);
    encoded[0] = 0xfd;
    encoded.writeUInt16LE(value, 1);
    return encoded;
  }
  const encoded = Buffer.allocUnsafe(5);
  encoded[0] = 0xfe;
  encoded.writeUInt32LE(value, 1);
  return encoded;
}

function vaultTaprootScriptPathSighash(psbt: Psbt, inputIndex: number, leafHash: Uint8Array): Buffer {
  const input = psbt.data.inputs[inputIndex];
  if (input === undefined) {
    throw new Error("The PSBT input for Taproot sighash validation is missing.");
  }
  const sighashType = input.sighashType ?? Transaction.SIGHASH_DEFAULT;
  if (sighashType !== Transaction.SIGHASH_DEFAULT) {
    throw new Error("Auction vault PSBTs use an unsupported non-default Taproot sighash mode.");
  }
  const transaction = unsignedTransaction(psbt);
  const previousOutputScripts: Buffer[] = [];
  const values: bigint[] = [];
  for (const candidate of psbt.data.inputs) {
    if (candidate.witnessUtxo === undefined) {
      throw new Error("Auction vault PSBT lacks a witness UTXO required for Taproot sighash validation.");
    }
    previousOutputScripts.push(Buffer.from(candidate.witnessUtxo.script));
    values.push(candidate.witnessUtxo.value);
  }
  try {
    return Buffer.from(transaction.hashForWitnessV1(
      inputIndex,
      previousOutputScripts,
      values,
      sighashType,
      Buffer.from(leafHash),
    ));
  } catch {
    throw new Error("Auction vault PSBT Taproot sighash verification is unsupported or invalid.");
  }
}

function parsePlannedSats(value: bigint | string): bigint {
  const normalized = typeof value === "bigint" ? value : /^\d+$/.test(value) ? BigInt(value) : -1n;
  if (normalized <= 0n) throw new Error("Trusted settlement outputs require a positive satoshi value.");
  return normalized;
}

function parseEvidenceSats(value: bigint | string): bigint {
  return typeof value === "bigint" ? value : /^\d+$/.test(value) ? BigInt(value) : -1n;
}

function estimatedFinalVirtualBytes(psbt: Psbt, transaction: Transaction): number {
  const estimated = Transaction.fromBuffer(transaction.toBuffer());
  for (let index = 0; index < psbt.data.inputs.length; index += 1) {
    const leaf = psbt.data.inputs[index]?.tapLeafScript?.[0];
    if (leaf === undefined) throw new Error("Vault PSBT input has no Taproot script path.");
    const operations = script.decompile(leaf.script);
    if (operations === null) throw new Error("Vault PSBT Taproot script could not be decoded.");
    const signatureCount = operations.includes(opcodes.OP_CHECKSIGVERIFY) ? 2 : 1;
    estimated.setWitness(index, [
      ...Array.from({ length: signatureCount }, () => Buffer.alloc(64)),
      Buffer.from(leaf.script),
      Buffer.from(leaf.controlBlock),
    ]);
  }
  return estimated.virtualSize();
}

function unsignedTransaction(psbt: Psbt): Transaction {
  return Transaction.fromBuffer(Buffer.from(psbt.data.globalMap.unsignedTx.toBuffer()));
}

function unsignedTransactionHex(psbt: Psbt): string {
  return Buffer.from(psbt.data.globalMap.unsignedTx.toBuffer()).toString("hex");
}

function bitcoinNetwork(network: VaultPsbtReview["network"]): Network {
  return network === "regtest" ? networks.regtest : networks.testnet;
}

function outputAddress(outputScript: Buffer, network: Network): string | null {
  try {
    return bitcoinAddress.fromOutputScript(outputScript, network);
  } catch {
    return null;
  }
}

function outputScriptType(outputScript: Buffer): string {
  const hex = outputScript.toString("hex");
  if (hex.startsWith("5120") && outputScript.length === 34) return "p2tr";
  if (hex.startsWith("0014") && outputScript.length === 22) return "p2wpkh";
  if (hex.startsWith("0020") && outputScript.length === 34) return "p2wsh";
  if (hex.startsWith("76a914") && hex.endsWith("88ac")) return "p2pkh";
  if (hex.startsWith("a914") && hex.endsWith("87")) return "p2sh";
  if (hex.startsWith("6a")) return "nulldata";
  return "unknown";
}

function decimalRate(feeSats: bigint, virtualBytes: number): string {
  const scaled = feeSats * 1_000n / BigInt(virtualBytes);
  return `${(scaled / 1_000n).toString()}.${(scaled % 1_000n).toString().padStart(3, "0")}`;
}

function sumBigInts(values: readonly bigint[]): bigint {
  return values.reduce((total, value) => total + value, 0n);
}

function xOnlyHex(publicKeyHex: string): string {
  if (!/^(?:[0-9a-f]{64}|0[23][0-9a-f]{64})$/i.test(publicKeyHex)) {
    throw new Error("A compressed or x-only owner public key is required.");
  }
  return publicKeyHex.length === 66 ? publicKeyHex.slice(2).toLowerCase() : publicKeyHex.toLowerCase();
}
