import { Buffer } from "buffer";
import { address, networks } from "bitcoinjs-lib";
import type { BtcNet, BtcSession } from "./types.js";

export interface PaymentUtxo { txid: string; vout: number; value: number; script: string; address: string; network: BtcNet }
export interface OutputEvidence extends PaymentUtxo {
  confirmed: boolean; spent: boolean; indexed: boolean; indexHeight: number; chainHeight: number;
  inscriptions: unknown[]; runes: unknown[]; satRarities: string[];
}
export interface KeelOutputReader { readOutput(output: PaymentUtxo): Promise<OutputEvidence> }
export interface ClassificationReceipt { output: PaymentUtxo; classificationHeight: number }
export interface ClassificationResult { spendable: ClassificationReceipt[]; excluded: { output: PaymentUtxo; reason: string }[] }

/** The current recursion reader has no output classification index; its 404 cannot prove absence. */
export function httpKeelOutputReader(endpoint: string, fetcher: typeof fetch = fetch): KeelOutputReader {
  if (!endpoint || !/^https?:\/\//.test(endpoint)) throw new Error("An explicit HTTP reader endpoint is required");
  return { async readOutput(output) {
    const response = await fetcher(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(output), signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Reader HTTP ${response.status}`);
    return await response.json() as OutputEvidence;
  } };
}

function validOutput(session: BtcSession, output: PaymentUtxo): boolean {
  try {
    if (!["mainnet", "testnet3", "testnet4", "signet", "regtest"].includes(session.network) || output.network !== session.network || output.address !== session.payment.address || (!session.sharedAddress && output.address === session.ordinals.address) || session.sharedAddress !== (session.payment.address === session.ordinals.address)) return false;
    const net = session.network === "mainnet" ? networks.bitcoin : session.network === "regtest" ? networks.regtest : networks.testnet;
    return /^[0-9a-f]{64}$/.test(output.txid) && Number.isSafeInteger(output.vout) && output.vout >= 0 && output.vout <= 0xffffffff && Number.isSafeInteger(output.value) && output.value > 0 && /^[0-9a-f]+$/.test(output.script) && Buffer.from(address.toOutputScript(output.address, net)).toString("hex") === output.script;
  } catch { return false; }
}
function same(a: PaymentUtxo, b: PaymentUtxo): boolean {
  return !!b && a.txid === b.txid && a.vout === b.vout && a.value === b.value && a.script === b.script && a.address === b.address && a.network === b.network;
}
export async function classifyPaymentUtxos(session: BtcSession, candidates: PaymentUtxo[], reader: KeelOutputReader): Promise<ClassificationResult> {
  const result: ClassificationResult = { spendable: [], excluded: [] };
  const outputs = candidates.map(output => Object.freeze({ ...output }));
  const counts = new Map<string, number>();
  for (const output of outputs) {
    const key = `${output.txid}:${output.vout}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const output of outputs) {
    let reason = "";
    let evidence: OutputEvidence | undefined;
    if (counts.get(`${output.txid}:${output.vout}`) !== 1) reason = "Duplicate payment outpoint";
    else if (!validOutput(session, output)) reason = "Invalid payment output";
    else try {
      evidence = await reader.readOutput({ ...output });
      if (!same(output, evidence)) reason = "Source disagreement";
      else if (evidence.confirmed !== true || evidence.spent !== false || evidence.indexed !== true) reason = "Unconfirmed, spent or unindexed";
      else if (!Number.isSafeInteger(evidence.indexHeight) || !Number.isSafeInteger(evidence.chainHeight) || evidence.indexHeight < 0 || evidence.indexHeight !== evidence.chainHeight) reason = "Missing or lagging index height";
      else if (!Array.isArray(evidence.inscriptions) || !Array.isArray(evidence.runes) || !Array.isArray(evidence.satRarities) || evidence.satRarities.length === 0 || evidence.satRarities.some(r => r !== "common")) reason = "Unknown or protected assets";
      else if (evidence.inscriptions.length || evidence.runes.length) reason = "Protected assets";
    } catch { reason = "Reader unavailable"; }
    if (reason) result.excluded.push({ output, reason });
    else result.spendable.push(Object.freeze({ output, classificationHeight: evidence!.indexHeight }));
  }
  return result;
}
/** Call immediately before signing and again before broadcasting; no approval is cached. */
export async function recheckPaymentInputs(session: BtcSession, receipts: ClassificationReceipt[], reader: KeelOutputReader): Promise<ClassificationReceipt[]> {
  const result = await classifyPaymentUtxos(session, receipts.map(r => r.output), reader);
  if (result.excluded.length || result.spendable.some((r, i) => !receipts[i] || !Number.isSafeInteger(receipts[i]!.classificationHeight) || r.classificationHeight !== receipts[i]!.classificationHeight)) throw new Error("Payment input classification changed or is stale");
  return result.spendable;
}
