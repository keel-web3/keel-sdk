import test from "node:test";
import assert from "node:assert/strict";
import {keccak256, TransactionReceiptNotFoundError} from "viem";
import {privateKeyToAccount} from "viem/accounts";

import {
  runWorkerTransaction,
  transactionIntentKey,
} from "./worker-transaction.mjs";

const chainId = 31_337;
const address = "0x0000000000000000000000000000000000000001";
const privateKey = "0x59c6995e998f97a5a0044976f0945389dc9e86dae88a34c6e6a8b2e66c6f6af0";
const abi = [{
  type: "function",
  name: "advance",
  stateMutability: "nonpayable",
  inputs: [
    {name: "id", type: "uint64"},
    {name: "random", type: "bool"},
  ],
  outputs: [],
}];
const args = [7n, false];

function makeHarness({
  journal = {transactions: {}},
  send,
  receipts = [],
  existingReceipt = null,
  saveFailureAt = 0,
  canonicalHashes = ["0xblock"],
  nonce = 7,
} = {}) {
  const baseAccount = privateKeyToAccount(privateKey);
  let signCalls = 0;
  let simulateCalls = 0;
  let prepareCalls = 0;
  let saveCalls = 0;
  const sentRaw = [];
  const waitCalls = [];
  const snapshots = [];
  let receiptIndex = 0;
  let canonicalIndex = 0;
  let nextNonce = nonce;
  const account = {
    address: baseAccount.address,
    signTransaction: async (request) => {
      signCalls += 1;
      return baseAccount.signTransaction(request);
    },
  };
  const client = {
    simulateContract: async () => {
      simulateCalls += 1;
      return {request: {to: address, data: "0x", value: 0n}};
    },
    prepareTransactionRequest: async (request) => {
      prepareCalls += 1;
      return {
        ...request,
        account,
        chainId,
        nonce: nextNonce,
        type: "eip1559",
        gas: 21_000n,
        maxFeePerGas: 2n,
        maxPriorityFeePerGas: 1n,
      };
    },
    getTransactionReceipt: async ({hash}) => {
      if (existingReceipt) return {...existingReceipt, transactionHash: existingReceipt.transactionHash ?? hash};
      throw new TransactionReceiptNotFoundError({hash});
    },
    waitForTransactionReceipt: async ({hash, confirmations}) => {
      waitCalls.push({hash, confirmations});
      const item = receipts[receiptIndex++];
      if (item instanceof Error) throw item;
      if (!item) throw new Error("test did not provide a receipt");
      return {...item, transactionHash: item.transactionHash ?? hash};
    },
    getBlock: async () => {
      const hash = canonicalHashes[Math.min(canonicalIndex++, canonicalHashes.length - 1)];
      return {hash};
    },
  };
  const wallet = {
    sendRawTransaction: async ({serializedTransaction}) => {
      sentRaw.push(serializedTransaction);
      if (send) return send(serializedTransaction);
      return keccak256(serializedTransaction);
    },
  };
  const save = async () => {
    saveCalls += 1;
    if (saveFailureAt === saveCalls) throw new Error("simulated crash during journal save");
    snapshots.push(JSON.parse(JSON.stringify(journal)));
  };
  return {
    account,
    client,
    wallet,
    journal,
    save,
    sentRaw,
    snapshots,
    waitCalls,
    setNonce(value) {
      nextNonce = value;
    },
    get counts() {
      return {signCalls, simulateCalls, prepareCalls, saveCalls};
    },
  };
}

function successReceipt(blockHash = "0xblock") {
  return {status: "success", blockNumber: 1n, blockHash};
}

test("persists prepared raw bytes before a crash before broadcast and resumes the same bytes", async () => {
  const first = makeHarness({
    send: () => { throw new Error("process crashed before broadcast"); },
  });
  await assert.rejects(() => runWorkerTransaction({
    ...first,
    chainId,
    address,
    abi,
    functionName: "advance",
    args,
    operationId: "advance:1:0xaaa",
    confirmations: 2,
  }), /crashed before broadcast/);
  assert.equal(first.counts.saveCalls, 1);
  assert.equal(first.sentRaw.length, 1);
  const persisted = first.snapshots.at(-1);
  const firstRecord = Object.values(persisted.transactions)[0];
  assert.equal(firstRecord.status, "prepared");
  assert.equal(firstRecord.hash, keccak256(firstRecord.raw));

  const restart = makeHarness({
    journal: JSON.parse(JSON.stringify(persisted)),
    receipts: [successReceipt()],
  });
  const receipt = await runWorkerTransaction({
    ...restart,
    chainId,
    address,
    abi,
    functionName: "advance",
    args,
    operationId: "advance:1:0xaaa",
    confirmations: 2,
  });
  assert.equal(receipt.status, "success");
  assert.deepEqual(restart.sentRaw, [firstRecord.raw]);
  assert.deepEqual(restart.waitCalls, [{hash: firstRecord.hash, confirmations: 2}]);
  assert.equal(restart.counts.simulateCalls, 0);
  assert.equal(restart.counts.prepareCalls, 0);
  assert.equal(restart.counts.signCalls, 0);
});

test("restart after broadcast-before-save observes the receipt without rebroadcasting", async () => {
  const first = makeHarness({saveFailureAt: 2});
  await assert.rejects(() => runWorkerTransaction({
    ...first,
    chainId,
    address,
    abi,
    functionName: "advance",
    args,
  }), /journal save/);
  const persisted = first.snapshots.at(-1);
  const firstRecord = Object.values(persisted.transactions)[0];
  assert.equal(firstRecord.status, "prepared");
  assert.equal(first.sentRaw.length, 1);

  const restart = makeHarness({
    journal: JSON.parse(JSON.stringify(persisted)),
    existingReceipt: {...successReceipt(), transactionHash: firstRecord.hash},
    receipts: [successReceipt()],
  });
  await runWorkerTransaction({
    ...restart,
    chainId,
    address,
    abi,
    functionName: "advance",
    args,
  });
  assert.equal(restart.sentRaw.length, 0);
  assert.equal(restart.counts.simulateCalls, 0);
  assert.equal(restart.counts.signCalls, 0);
});

test("reorged receipt is retried with the same raw bytes and nonce", async () => {
  const harness = makeHarness({
    receipts: [successReceipt("0xold"), successReceipt("0xnew")],
    canonicalHashes: ["0xnew", "0xnew"],
  });
  const receipt = await runWorkerTransaction({
    ...harness,
    chainId,
    address,
    abi,
    functionName: "advance",
    args,
    confirmations: 2,
    maxReorganizations: 1,
  });
  assert.equal(receipt.status, "success");
  assert.equal(harness.sentRaw.length, 2);
  assert.equal(harness.sentRaw[0], harness.sentRaw[1]);
  assert.equal(harness.counts.simulateCalls, 1);
  assert.equal(harness.counts.prepareCalls, 1);
  assert.equal(harness.counts.signCalls, 1);
  assert.deepEqual(harness.waitCalls, [
    {hash: keccak256(harness.sentRaw[0]), confirmations: 2},
    {hash: keccak256(harness.sentRaw[0]), confirmations: 2},
  ]);
  const record = Object.values(harness.journal.transactions)[0];
  assert.equal(record.status, "confirmed");
  assert.equal(record.nonce, "7");
});

test("a reverted receipt becomes terminal and cannot trigger a fresh transaction", async () => {
  const harness = makeHarness({receipts: [{...successReceipt(), status: "reverted"}]});
  await assert.rejects(() => runWorkerTransaction({
    ...harness,
    chainId,
    address,
    abi,
    functionName: "advance",
    args,
  }), /reverted/);
  const record = Object.values(harness.journal.transactions)[0];
  assert.equal(record.status, "failed");
  const sends = harness.sentRaw.length;
  await assert.rejects(() => runWorkerTransaction({
    ...harness,
    chainId,
    address,
    abi,
    functionName: "advance",
    args,
  }), /permanently failed/);
  assert.equal(harness.sentRaw.length, sends);
});

test("conflicting journal intent is refused before simulation or broadcast", async () => {
  const key = transactionIntentKey({
    chainId,
    account: privateKeyToAccount(privateKey).address,
    address,
    functionName: "advance",
    args,
  });
  const harness = makeHarness({
    journal: {
      transactions: {
        [key]: {
          intent: "different-intent",
          intentKey: key,
        },
      },
    },
  });
  await assert.rejects(() => runWorkerTransaction({
    ...harness,
    chainId,
    address,
    abi,
    functionName: "advance",
    args,
  }), /Conflicting durable transaction intent/);
  assert.equal(harness.counts.simulateCalls, 0);
  assert.equal(harness.sentRaw.length, 0);
});


test("an operation scope allows sequential repeat actions while each unresolved scope resumes", async () => {
  const harness = makeHarness({receipts: [successReceipt(), successReceipt()]});
  await runWorkerTransaction({
    ...harness,
    chainId,
    address,
    abi,
    functionName: "advance",
    args,
    operationId: "advance:1:0xaaa",
  });
  harness.setNonce(8);
  await runWorkerTransaction({
    ...harness,
    chainId,
    address,
    abi,
    functionName: "advance",
    args,
    operationId: "advance:2:0xbbb",
  });
  assert.equal(harness.sentRaw.length, 2);
  assert.notEqual(harness.sentRaw[0], harness.sentRaw[1]);
  assert.equal(harness.counts.simulateCalls, 2);
  assert.equal(harness.counts.signCalls, 2);
  assert.equal(Object.keys(harness.journal.transactions).length, 2);
  assert.deepEqual(Object.values(harness.journal.transactions).map((record) => record.status), ["confirmed", "confirmed"]);
});
