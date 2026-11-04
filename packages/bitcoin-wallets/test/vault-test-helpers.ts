import { Psbt } from "bitcoinjs-lib";

export function corruptOwnerTaprootSignature(
  psbtBase64: string,
  ownerXOnly: string,
  corruption: "signature" | "leaf-hash",
): Psbt {
  const psbt = Psbt.fromBase64(psbtBase64);
  const ownerSignature = psbt.data.inputs[0]?.tapScriptSig?.find(
    (signature) => Buffer.from(signature.pubkey).toString("hex") === ownerXOnly,
  );
  if (ownerSignature === undefined) throw new Error("fixture owner signature missing");
  if (corruption === "signature") ownerSignature.signature = Buffer.alloc(64, 0x42);
  else ownerSignature.leafHash = Buffer.alloc(32, 0x24);
  return psbt;
}
