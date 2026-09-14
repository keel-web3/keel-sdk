import {
  encodeFunctionData,
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
  stringToHex,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
} from "viem";

const RAW_HEX = /^0x[0-9a-fA-F]+$/;
const HASH_HEX = /^0x[0-9a-fA-F]{64}$/;
const MAX_REORGANIZATIONS = 3;
const TRANSACTION_FIELDS = [
  "value",
  "gas",
  "nonce",
  "gasPrice",
  "maxFeePerGas",
  "maxPriorityFeePerGas",
  "maxFeePerBlobGas",
  "blobs",
  "blobVersionedHashes",
  "sidecars",
  "accessList",
  "type",
  "authorizationList",
];

function canonicalValue(value, path = "value") {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return {__bigint: value.toString()};
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(path + " must be finite");
    return value;
  }
  if (Array.isArray(value)) return value.map((item, index) => canonicalValue(item, path + "[" + index + "]"));
  if (typeof value === "object") {
    const result = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) throw new TypeError(path + "." + key + " is undefined");
      result[key] = canonicalValue(value[key], path + "." + key);
    }
    return result;
  }
  throw new TypeError(path + " has an unsupported type");
}

function normalizeChainId(chainId) {
  if (typeof chainId === "bigint") {
    if (chainId <= 0n || chainId > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("chainId must be a positive safe integer");
    return Number(chainId);
  }
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new RangeError("chainId must be a positive safe integer");
  return chainId;
}

function normalizeAddress(address, label) {
  if (typeof address !== "string" || address.length === 0) throw new TypeError(label + " must be an address");
  return address.toLowerCase();
}

function normalizeData(data, label) {
  if (typeof data !== "string" || !RAW_HEX.test(data) || data.length % 2 !== 0) {
    throw new TypeError(label + " must be even-length hex data");
  }
  return data.toLowerCase();
}

export function transactionIntentDescriptor({chainId, account, address, functionName, args, operationId}) {
  const normalizedChainId = normalizeChainId(chainId);
  const descriptor = {
    chainId: normalizedChainId,
    from: normalizeAddress(account, "account"),
    to: normalizeAddress(address, "address"),
    functionName: String(functionName),
    args: canonicalValue(args, "args"),
  };
  if (operationId !== undefined && operationId !== null) descriptor.operationId = String(operationId);
  return JSON.stringify(descriptor);
}

export function transactionIntentKey(input) {
  return keccak256(stringToHex(transactionIntentDescriptor(input)));
}

function hashRawTransaction(raw) {
  if (typeof raw !== "string" || !RAW_HEX.test(raw) || raw.length % 2 !== 0) {
    throw new TypeError("account.signTransaction returned invalid raw transaction bytes");
  }
  return keccak256(raw);
}

function isNotFound(error) {
  return error instanceof TransactionReceiptNotFoundError ||
    error instanceof TransactionNotFoundError ||
    error?.name === "TransactionReceiptNotFoundError" ||
    error?.name === "TransactionNotFoundError";
}

function isAlreadyKnown(error) {
  const message = [
    error?.shortMessage,
    error?.message,
    error?.cause?.shortMessage,
    error?.cause?.message,
  ].filter(Boolean).join(" ").toLowerCase();
  return message.includes("already known") || message.includes("transaction already imported");
}

function sameHash(left, right) {
  return typeof left === "string" && typeof right === "string" && left.toLowerCase() === right.toLowerCase();
}

function requireJournal(journal) {
  if (!journal || typeof journal !== "object" || Array.isArray(journal)) throw new TypeError("journal must be an object");
  if (!journal.transactions || typeof journal.transactions !== "object" || Array.isArray(journal.transactions)) journal.transactions = {};
  return journal.transactions;
}

async function validateRecord(record, intent, expectedData) {
  if (!record || typeof record !== "object") throw new Error("Durable transaction record is invalid");
  if (record.intent !== intent.descriptor || record.intentKey !== intent.key) {
    throw new Error("Conflicting durable transaction intent for " + intent.key);
  }
  if (
    record.chainId !== intent.chainId ||
    String(record.from).toLowerCase() !== intent.from ||
    String(record.to).toLowerCase() !== intent.to ||
    String(record.functionName) !== intent.functionName ||
    (record.operationId ?? null) !== intent.operationId
  ) {
    throw new Error("Conflicting durable transaction chain, account, or function for " + intent.key);
  }
  if (typeof record.raw !== "string" || !RAW_HEX.test(record.raw) || record.raw.length % 2 !== 0) {
    throw new Error("Durable transaction raw bytes are invalid for " + intent.key);
  }
  const expectedHash = hashRawTransaction(record.raw);
  if (!sameHash(record.hash, expectedHash) || !HASH_HEX.test(record.hash)) {
    throw new Error("Durable transaction hash does not match raw bytes for " + intent.key);
  }
  if (record.nonce === undefined || !/^[0-9]+$/.test(String(record.nonce))) {
    throw new Error("Durable transaction nonce is missing for " + intent.key);
  }
  if (typeof record.data !== "string" || normalizeData(record.data, "Durable transaction data") !== normalizeData(expectedData, "Expected transaction data")) {
    throw new Error("Durable transaction calldata conflicts with intent for " + intent.key);
  }
  if (record.value === undefined || !/^[0-9]+$/.test(String(record.value))) {
    throw new Error("Durable transaction value is missing for " + intent.key);
  }
  if (!["prepared", "broadcast", "confirmed", "failed"].includes(record.status)) {
    throw new Error("Durable transaction status is invalid for " + intent.key);
  }

  let parsed;
  let sender;
  try {
    parsed = parseTransaction(record.raw);
    sender = await recoverTransactionAddress({serializedTransaction: record.raw});
  } catch (error) {
    throw new Error("Durable transaction signature is invalid for " + intent.key, {cause: error});
  }
  if (normalizeAddress(sender, "recovered sender") !== intent.from) {
    throw new Error("Durable transaction sender conflicts with intent for " + intent.key);
  }
  if (parsed.chainId === undefined || BigInt(parsed.chainId) !== BigInt(intent.chainId)) {
    throw new Error("Durable transaction chain ID conflicts with intent for " + intent.key);
  }
  if (normalizeAddress(parsed.to, "transaction recipient") !== intent.to) {
    throw new Error("Durable transaction recipient conflicts with intent for " + intent.key);
  }
  if (normalizeData(parsed.data ?? "0x", "transaction calldata") !== normalizeData(record.data, "durable calldata")) {
    throw new Error("Durable transaction calldata does not match signed bytes for " + intent.key);
  }
  if (BigInt(parsed.value ?? 0n) !== BigInt(record.value)) {
    throw new Error("Durable transaction value does not match signed bytes for " + intent.key);
  }
  if (String(parsed.nonce) !== String(record.nonce)) {
    throw new Error("Durable transaction nonce does not match signed bytes for " + intent.key);
  }
  return record;
}

function assertNonceConflict(transactions, key, record) {
  for (const [otherKey, other] of Object.entries(transactions)) {
    if (otherKey === key || !other || typeof other !== "object") continue;
    if (
      other.chainId === record.chainId &&
      String(other.from).toLowerCase() === String(record.from).toLowerCase() &&
      String(other.nonce) === String(record.nonce) &&
      !sameHash(other.hash, record.hash)
    ) {
      throw new Error("Conflicting durable transaction nonce " + record.nonce + " for " + record.from);
    }
  }
}

async function readReceipt(client, hash) {
  if (typeof client.getTransactionReceipt !== "function") throw new TypeError("client.getTransactionReceipt is required");
  try {
    return await client.getTransactionReceipt({hash});
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

function receiptMeta(receipt, hash) {
  if (!receipt || !sameHash(receipt.transactionHash, hash)) {
    throw new Error("Transaction receipt hash does not match durable transaction " + hash);
  }
  if (receipt.status !== "success" && receipt.status !== "reverted") {
    throw new Error("Transaction receipt has an unknown status for " + hash);
  }
  return {
    blockNumber: receipt.blockNumber === undefined ? null : String(receipt.blockNumber),
    blockHash: receipt.blockHash ?? null,
    status: receipt.status,
    transactionHash: receipt.transactionHash,
  };
}

async function canonicalReceipt(client, receipt, hash) {
  const meta = receiptMeta(receipt, hash);
  if (meta.blockNumber === null || typeof meta.blockHash !== "string") {
    throw new Error("Transaction receipt lacks canonical block data for " + hash);
  }
  if (typeof client.getBlock !== "function") throw new TypeError("client.getBlock is required");
  const block = await client.getBlock({blockNumber: BigInt(meta.blockNumber)});
  if (typeof block?.hash !== "string" || !sameHash(block.hash, meta.blockHash)) {
    return {meta, receipt, canonical: false};
  }
  return {meta, receipt, canonical: true};
}

async function broadcastSameRaw({wallet, record, save}) {
  if (!wallet || typeof wallet.sendRawTransaction !== "function") throw new TypeError("wallet.sendRawTransaction is required");
  try {
    const sentHash = await wallet.sendRawTransaction({serializedTransaction: record.raw});
    if (!sameHash(sentHash, record.hash)) {
      throw new Error("RPC returned a different hash for the durable transaction");
    }
  } catch (error) {
    if (!isAlreadyKnown(error)) throw error;
  }
  record.status = "broadcast";
  await save();
}

async function settle({client, wallet, record, save, confirmations, maxReorganizations}) {
  let reorganizations = 0;
  for (;;) {
    let receipt;
    try {
      receipt = await client.waitForTransactionReceipt({hash: record.hash, confirmations});
    } catch (error) {
      if (!isNotFound(error)) throw error;
      record.status = "broadcast";
      await save();
      await broadcastSameRaw({wallet, record, save});
      if (++reorganizations > maxReorganizations) throw new Error("Transaction did not reach a canonical receipt after repeated reorgs");
      continue;
    }

    const checked = await canonicalReceipt(client, receipt, record.hash);
    if (!checked.canonical) {
      record.status = "broadcast";
      await save();
      await broadcastSameRaw({wallet, record, save});
      if (++reorganizations > maxReorganizations) throw new Error("Transaction receipt was repeatedly reorganized");
      continue;
    }
    if (checked.meta.status === "reverted") {
      record.status = "failed";
      record.failure = "Transaction receipt reverted";
      await save();
      throw new Error("Durable transaction reverted: " + record.hash);
    }

    record.status = "confirmed";
    record.receipt = checked.meta;
    await save();
    return checked.receipt;
  }
}

function transactionOverrides(request) {
  const overrides = {};
  for (const field of TRANSACTION_FIELDS) {
    if (request?.[field] !== undefined) overrides[field] = request[field];
  }
  return overrides;
}

export async function runWorkerTransaction({
  client,
  wallet,
  account,
  chainId,
  address,
  abi,
  functionName,
  args = [],
  confirmations = 1,
  maxReorganizations = MAX_REORGANIZATIONS,
  operationId,
  journal,
  save,
}) {
  const normalizedChainId = normalizeChainId(chainId);
  if (!account || typeof account.address !== "string" || typeof account.signTransaction !== "function") {
    throw new TypeError("account.address and account.signTransaction are required");
  }
  if (typeof save !== "function") throw new TypeError("save is required");
  if (!Number.isSafeInteger(confirmations) || confirmations < 0) throw new RangeError("confirmations must be a non-negative safe integer");
  if (!Number.isSafeInteger(maxReorganizations) || maxReorganizations < 0) throw new RangeError("maxReorganizations must be a non-negative safe integer");

  const descriptor = transactionIntentDescriptor({
    chainId: normalizedChainId,
    account: account.address,
    address,
    functionName,
    args,
    operationId,
  });
  const key = keccak256(stringToHex(descriptor));
  const intent = {
    descriptor,
    key,
    chainId: normalizedChainId,
    from: account.address.toLowerCase(),
    to: address.toLowerCase(),
    functionName: String(functionName),
    operationId: operationId === undefined || operationId === null ? null : String(operationId),
  };
  const data = normalizeData(encodeFunctionData({abi, functionName, args}), "encoded transaction data");
  const transactions = requireJournal(journal);
  let record = transactions[key];

  if (record) {
    await validateRecord(record, intent, data);
    if (record.status === "failed") {
      throw new Error("Durable transaction is permanently failed: " + (record.failure ?? key));
    }
  } else {
    const simulation = await client.simulateContract({address, abi, functionName, args, account});
    const preparerOwner = typeof wallet?.prepareTransactionRequest === "function" ? wallet : client;
    const prepared = preparerOwner?.prepareTransactionRequest;
    if (typeof prepared !== "function") throw new TypeError("wallet.prepareTransactionRequest or client.prepareTransactionRequest is required");
    const request = await prepared.call(preparerOwner, {
      ...transactionOverrides(simulation.request),
      account,
      chainId: normalizedChainId,
      to: address,
      data,
      value: simulation.request?.value ?? 0n,
    });
    if (request.nonce === undefined) throw new Error("Prepared transaction has no nonce");
    const raw = await account.signTransaction(request);
    record = {
      version: 1,
      intent: descriptor,
      intentKey: key,
      chainId: normalizedChainId,
      from: account.address.toLowerCase(),
      to: address.toLowerCase(),
      functionName: String(functionName),
      operationId: intent.operationId,
      data,
      value: String(request.value ?? 0n),
      nonce: String(request.nonce),
      raw,
      hash: hashRawTransaction(raw),
      status: "prepared",
    };
    await validateRecord(record, intent, data);
    assertNonceConflict(transactions, key, record);
    transactions[key] = record;
    await save();
  }

  const receipt = await readReceipt(client, record.hash);
  if (!receipt) await broadcastSameRaw({wallet, record, save});
  return settle({client, wallet, record, save, confirmations, maxReorganizations});
}
