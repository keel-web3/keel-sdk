import { randomBytes } from "node:crypto";
import { address as bitcoinAddress } from "bitcoinjs-lib";
import { assertAddressNetwork, bitcoinNetwork } from "./network.js";
import { verifyBip322Message } from "./messages.js";
import type { BtcNet } from "./types.js";

type Context = { domain: string; uri: string; network: BtcNet };
type Identity = { ordinals: string; payment: string };
export type LoginChallenge = Context & Identity & { nonce: string; issuedAt: number; expiresAt: number; message: string };

/** In-memory single-process store. Hosts using multiple instances need a shared atomic store.
 * On success the host must issue its own httpOnly session cookie. */
export class Bip322LoginManager {
  private readonly challenges = new Map<string, LoginChallenge>();
  private readonly context: Context;
  constructor(context: Context, private readonly maxEntries = 1000, private readonly lifetimeMs = 300_000, private readonly now: () => number = Date.now) {
    const uri = new URL(context.uri);
    if (uri.host !== context.domain || !["https:", "http:"].includes(uri.protocol) || uri.username || uri.password || uri.hash) throw new Error("Invalid server context");
    bitcoinNetwork(context.network);
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || !Number.isSafeInteger(lifetimeMs) || lifetimeMs < 1 || lifetimeMs > 300_000) throw new Error("Invalid challenge limits");
    this.context = { ...context };
  }
  issue(identity: Identity): LoginChallenge {
    assertAddressNetwork(identity.ordinals, this.context.network); assertAddressNetwork(identity.payment, this.context.network);
    const ordinalScript = bitcoinAddress.toOutputScript(identity.ordinals, bitcoinNetwork(this.context.network));
    if (ordinalScript.length !== 34 || ordinalScript[0] !== 0x51 || ordinalScript[1] !== 0x20) throw new Error("Ordinals login requires a Taproot address");
    const now = this.now();
    for (const [key, value] of this.challenges) if (value.expiresAt <= now) this.challenges.delete(key);
    if (this.challenges.size >= this.maxEntries) throw new Error("Challenge store full");
    const nonce = randomBytes(32).toString("hex");
    const fields = { ...this.context, ordinals: identity.ordinals, payment: identity.payment, nonce, issuedAt: now, expiresAt: now + this.lifetimeMs };
    const message = `KEEL Bitcoin login\nDomain: ${fields.domain}\nURI: ${fields.uri}\nNetwork: ${fields.network}\nOrdinals: ${fields.ordinals}\nPayment: ${fields.payment}\nNonce: ${nonce}\nIssued At: ${fields.issuedAt}\nExpires At: ${fields.expiresAt}`;
    const challenge = { ...fields, message }; this.challenges.set(nonce, challenge); return { ...challenge };
  }
  verify(challenge: LoginChallenge, proofs: { ordinals?: string; payment?: string }): Identity {
    const saved = this.challenges.get(challenge.nonce);
    if (!saved) throw new Error("Unknown or consumed challenge");
    this.challenges.delete(challenge.nonce);
    if (Object.keys(saved).some(key => saved[key as keyof LoginChallenge] !== challenge[key as keyof LoginChallenge]) || saved.domain !== this.context.domain || saved.uri !== this.context.uri || saved.network !== this.context.network || this.now() < saved.issuedAt || this.now() >= saved.expiresAt) throw new Error("Invalid or expired challenge");
    if (!proofs.ordinals || !verifyBip322Message(saved.ordinals, saved.message, proofs.ordinals)) throw new Error("Invalid ordinals proof");
    if (saved.payment !== saved.ordinals && (!proofs.payment || !verifyBip322Message(saved.payment, saved.message, proofs.payment))) throw new Error("Invalid payment proof");
    return { ordinals: saved.ordinals, payment: saved.payment };
  }
}
