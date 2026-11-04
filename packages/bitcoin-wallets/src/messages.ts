import { Verifier } from "bip322-js";
import { assertAddressNetwork, assertWalletNetwork } from "./network.js";
import type { BtcNet } from "./types.js";

export function verifyBip322Message(address: string, message: string, signature: string): boolean {
  try {
    const bytes = Buffer.from(signature, "base64");
    if (!signature || bytes.toString("base64") !== signature) return false;
    // Compact BIP-137 signatures remain valid only for legacy P2PKH addresses.
    if (bytes.length === 65 && bytes[0]! >= 27 && bytes[0]! <= 42 && !/^[1mn]/.test(address)) return false;
    return Verifier.verifySignature(address, message, signature, true);
  } catch { return false; }
}

type Transport =
  | { wallet: "xverse"; request: (method: "signMessage", params: { address: string; message: string; protocol: "BIP322" }) => Promise<unknown> }
  | { wallet: "unisat" | "okx"; signMessage: (message: string, protocol: "bip322-simple") => Promise<unknown> };

/** The transport must be bound to the selected account and network by the host. */
export async function signBip322Message(input: { transport: Transport; network: BtcNet; walletNetwork: unknown; address: string; message: string }): Promise<string> {
  assertWalletNetwork(input.network, input.walletNetwork);
  assertAddressNetwork(input.address, input.network);
  const t = input.transport;
  let signature: unknown;
  if (t.wallet === "xverse") {
    const response = await t.request("signMessage", { address: input.address, message: input.message, protocol: "BIP322" });
    if (typeof response !== "object" || response === null || !("status" in response) || response.status !== "success" || !("result" in response) || typeof response.result !== "object" || response.result === null) throw new Error("Invalid Xverse response");
    const result = response.result as { address?: unknown; signature?: unknown };
    if (result.address !== undefined && result.address !== input.address) throw new Error("Wrong signing address");
    signature = result.signature;
  } else if (t.wallet === "unisat" || t.wallet === "okx") {
    signature = await t.signMessage(input.message, "bip322-simple");
  } else { throw new Error("Unsupported wallet message protocol"); }
  if (typeof signature !== "string" || !verifyBip322Message(input.address, input.message, signature)) throw new Error("Invalid BIP-322 signature");
  return signature;
}
