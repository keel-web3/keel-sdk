import { describe, it, expect } from "vitest";
import { classifyPaymentUtxos, recheckPaymentInputs, httpKeelOutputReader, type OutputEvidence } from "../src/utxos.js";
import type { BtcSession } from "../src/types.js";

const addr = "1BoatSLRHtKNngkdXEeobR76b53LETtpyT";
const account = { address: addr, addressType: "p2pkh" as const, purpose: "payment" as const, publicKey: "" };
const session: BtcSession = { walletId: "test", network: "mainnet", payment: account, ordinals: { ...account, purpose: "ordinals" }, sharedAddress: true };
const base: OutputEvidence = { txid: "a".repeat(64), vout: 0, value: 546, script: "76a9147680adec8eabcabac676be9e83854ade0bd22cdb88ac", address: addr, network: "mainnet", confirmed: true, spent: false, indexed: true, indexHeight: 100, chainHeight: 100, inscriptions: [], runes: [], satRarities: ["common"] };
const classify = (e: OutputEvidence) => classifyPaymentUtxos(session, [base], { readOutput: async () => e });
describe("payment output safety", () => {
  it("accepts complete matching evidence and rechecks", async () => {
    const reader = { readOutput: async () => base };
    const result = await classifyPaymentUtxos(session, [base], reader);
    expect(result.spendable).toHaveLength(1);
    expect(await recheckPaymentInputs(session, result.spendable, reader)).toHaveLength(1);
    await expect(recheckPaymentInputs(session, result.spendable, { readOutput: async () => ({ ...base, inscriptions: ["new"] }) })).rejects.toThrow();
    await expect(recheckPaymentInputs(session, result.spendable, { readOutput: async () => ({ ...base, indexHeight: 101, chainHeight: 101 }) })).rejects.toThrow();
  });
  it.each([546, 10000, 100000000])("excludes inscriptions at %i sats", async value => {
    const output = { ...base, value };
    expect((await classifyPaymentUtxos(session, [output], { readOutput: async () => ({ ...output, inscriptions: ["inscription"] }) })).excluded).toHaveLength(1);
  });
  it.each([
    { runes: ["rune"] }, { satRarities: ["uncommon"] }, { satRarities: [] }, { indexed: false }, { indexHeight: 99 }, { spent: true }, { confirmed: false },
    { network: "signet" }, { address: "wrong" }, { script: "00" }, { value: 1 }, { txid: "b".repeat(64) }, { vout: 1 }, { inscriptions: undefined }
  ])("excludes unsafe or disagreeing evidence %j", async patch => {
    expect((await classify({ ...base, ...patch } as OutputEvidence)).excluded).toHaveLength(1);
  });
  it("excludes reader timeout", async () => {
    expect((await classifyPaymentUtxos(session, [base], { readOutput: async () => { throw new Error("timeout"); } })).excluded).toHaveLength(1);
  });
  it("cannot treat current reader 404 as cardinal", async () => {
    const reader = httpKeelOutputReader("http://localhost/r/utxo", async () => new Response("not found", { status: 404 }));
    expect((await classifyPaymentUtxos(session, [base], reader)).excluded).toHaveLength(1);
  });
  it("excludes duplicate outpoints including conflicting values before reading", async () => {
    let calls = 0;
    const reader = { readOutput: async (output: typeof base) => { calls++; return output; } };
    const result = await classifyPaymentUtxos(session, [base, { ...base, value: 10000 }], reader);
    expect(result.spendable).toHaveLength(0);
    expect(result.excluded.map(item => item.reason)).toEqual(["Duplicate payment outpoint", "Duplicate payment outpoint"]);
    expect(calls).toBe(0);
    const single = await classifyPaymentUtxos(session, [base], { readOutput: async () => base });
    await expect(recheckPaymentInputs(session, [single.spendable[0]!, single.spendable[0]!], reader)).rejects.toThrow();
  });
  it("snapshots candidate inputs before awaiting and freezes the approved receipt", async () => {
    const candidate = { ...base };
    const result = await classifyPaymentUtxos(session, [candidate], { readOutput: async output => {
      candidate.txid = "b".repeat(64);
      candidate.value = 10000;
      return { ...base, ...output };
    } });
    const receipt = result.spendable[0]!;
    expect(receipt.output.txid).toBe(base.txid);
    expect(receipt.output.value).toBe(base.value);
    expect(() => { receipt.output.txid = "c".repeat(64); }).toThrow();
    expect(() => { receipt.classificationHeight = 101; }).toThrow();
    expect(await recheckPaymentInputs(session, result.spendable, { readOutput: async () => base })).toHaveLength(1);
  });
});
