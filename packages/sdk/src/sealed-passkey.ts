/**
 * Passkey sealing for KEEL sealed content (`keel-sealed@1`).
 *
 * A passkey with the WebAuthn PRF extension returns 32 secret bytes for a
 * salt we choose. The same passkey and salt always give the same bytes and
 * nothing else can produce them, so they can open a sealed object's key slot
 * without any key being stored anywhere.
 *
 * Typical flow:
 *
 * ```ts
 * const passkey = await createSealingPasskey({ rp: { name: "KEEL" }, user: { name: "alice" } });
 * const { envelope } = await sealKeelContent(text, { slots: [passkey.slot] });
 * // later, anywhere the passkey syncs to:
 * const unlock = await unlockSealedWithPasskey(envelope);
 * const { text } = await openKeelContent(envelope, unlock);
 * ```
 *
 * Every function takes an optional environment so tests and hosts (Electron)
 * can supply their own `credentials` object. Sealing passkeys are not sign-in
 * credentials: nothing is sent to a server and no attestation is checked.
 */

import {
  KEEL_SEALED_PRF_SALT_BYTES,
  matchKeelSealedPasskeySlots,
  normalizeKeelSealedHeader,
  parseKeelSealedHeader,
  type KeelSealedHeader,
  type KeelSealedPasskeySlotInput,
  type KeelSealedPasskeyUnlock,
} from "@keel/protocol";

/** The parts of `navigator.credentials` these helpers use. */
export interface KeelPasskeyCredentials {
  create(options: CredentialCreationOptions): Promise<unknown>;
  get(options: CredentialRequestOptions): Promise<unknown>;
}

/** The parts of the `PublicKeyCredential` constructor these helpers use. */
export interface KeelPublicKeyCredentialStatic {
  getClientCapabilities?: () => Promise<Readonly<Record<string, boolean | undefined>>>;
}

export interface KeelPasskeyEnvironment {
  readonly credentials?: KeelPasskeyCredentials | undefined;
  readonly PublicKeyCredential?: KeelPublicKeyCredentialStatic | undefined;
}

export type KeelPasskeyErrorCode =
  /** No WebAuthn in this context (or not a secure context). */
  | "unsupported"
  /** The browser or authenticator cannot evaluate the PRF extension. */
  | "prf-unsupported"
  /** The user dismissed the prompt or it timed out. */
  | "cancelled"
  /** The caller's AbortSignal fired. */
  | "aborted"
  /** The relying-party id is not valid for this page's origin. */
  | "wrong-site"
  /** An excluded credential already exists on the authenticator. */
  | "already-registered"
  /** The sealed object has no passkey slot. */
  | "no-passkey-slot"
  /** The chosen passkey is not one that can open this sealed object. */
  | "unknown-passkey"
  | "failed";

export class KeelPasskeyError extends Error {
  readonly code: KeelPasskeyErrorCode;

  constructor(code: KeelPasskeyErrorCode, message: string, options?: { readonly cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "KeelPasskeyError";
    this.code = code;
  }
}

export interface KeelPasskeySealingSupport {
  readonly supported: boolean;
  /** "unknown" when the browser cannot say before a passkey is created. */
  readonly prf: "yes" | "no" | "unknown";
  readonly reason?: string;
}

export interface CreateSealingPasskeyOptions {
  readonly rp: { readonly name: string; readonly id?: string };
  /**
   * Shown in the user's password manager. `id` defaults to 16 random bytes:
   * never reuse the user handle of a sign-in passkey for the same site, or some
   * authenticators will replace that passkey with this one.
   */
  readonly user: { readonly name: string; readonly displayName?: string; readonly id?: Uint8Array };
  readonly authenticatorAttachment?: AuthenticatorAttachment;
  /** Credentials that must not be created again (for example this user's existing sealing passkeys). */
  readonly excludeCredentialIds?: readonly Uint8Array[];
  /** Store the raw credential id in the slot. Defaults to true unless the passkey is known to be discoverable. */
  readonly includeCredentialId?: boolean;
  /** 32 bytes; defaults to fresh random bytes. */
  readonly prfSalt?: Uint8Array;
  readonly timeout?: number;
  readonly signal?: AbortSignal;
}

export interface PrepareSealingPasskeySlotOptions {
  /** Ask for this passkey; omit to let the user pick any passkey for the site. */
  readonly credentialId?: Uint8Array | string;
  readonly rpId?: string;
  /** Defaults to true when `credentialId` is given (its discoverability is unknown), false otherwise. */
  readonly includeCredentialId?: boolean;
  /** 32 bytes; defaults to fresh random bytes. */
  readonly prfSalt?: Uint8Array;
  readonly timeout?: number;
  readonly signal?: AbortSignal;
}

export interface KeelSealingPasskey {
  readonly credentialId: Uint8Array;
  /** Base64url; not secret. Remember it locally to skip the passkey picker next time. */
  readonly credentialIdText: string;
  readonly rpId?: string;
  /** From the credProps extension, when the browser reports it. */
  readonly discoverable?: boolean;
  /** Pass to `sealKeelContent({ slots: [slot] })` or `addKeelSealedSlot`. Holds the PRF secret: use it, then drop it. */
  readonly slot: KeelSealedPasskeySlotInput;
}

export interface UnlockSealedWithPasskeyOptions {
  /** Defaults to the rpId recorded in the slots, else the page's own site. */
  readonly rpId?: string;
  /** Credential ids the app remembers (bytes or base64url), matched privately against the slots. */
  readonly knownCredentialIds?: readonly (Uint8Array | string)[];
  /**
   * "known" asks only for passkeys whose ids are stored or remembered (works
   * for security keys that are not discoverable). "discoverable" lets the user
   * pick any passkey for the site. "auto" (default) uses "known" when every
   * passkey slot has a known id, otherwise "discoverable".
   */
  readonly strategy?: "auto" | "known" | "discoverable";
  readonly timeout?: number;
  readonly signal?: AbortSignal;
}

// ------------------------------------------------------------------- helpers

function defaultEnvironment(): KeelPasskeyEnvironment {
  const scope = globalThis as unknown as {
    readonly navigator?: { readonly credentials?: KeelPasskeyCredentials };
    readonly PublicKeyCredential?: KeelPublicKeyCredentialStatic;
  };
  return { credentials: scope.navigator?.credentials, PublicKeyCredential: scope.PublicKeyCredential };
}

function requireCredentials(environment: KeelPasskeyEnvironment | undefined): KeelPasskeyCredentials {
  const resolved = environment ?? defaultEnvironment();
  const credentials = resolved.credentials;
  if (resolved.PublicKeyCredential === undefined || credentials === undefined || typeof credentials.create !== "function" || typeof credentials.get !== "function") {
    throw new KeelPasskeyError("unsupported", "Passkeys are not available here. Use a current browser on a secure (https) page.");
  }
  return credentials;
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const output = new Uint8Array(length);
  globalThis.crypto.getRandomValues(output);
  return output;
}

function buffer(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes);
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function fromBase64Url(value: string, what: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new TypeError(`${what} must be base64url text.`);
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (value.length % 4)) % 4);
  let binary: string;
  try {
    binary = globalThis.atob(padded);
  } catch {
    throw new TypeError(`${what} must be base64url text.`);
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function credentialIdBytes(value: Uint8Array | string, what: string): Uint8Array {
  if (typeof value === "string") return fromBase64Url(value, what);
  if (value instanceof Uint8Array && value.byteLength > 0) return value;
  throw new TypeError(`${what} must be bytes or base64url text.`);
}

function saltInput(value: Uint8Array | undefined): Uint8Array<ArrayBuffer> {
  if (value === undefined) return randomBytes(KEEL_SEALED_PRF_SALT_BYTES);
  if (!(value instanceof Uint8Array) || value.byteLength !== KEEL_SEALED_PRF_SALT_BYTES) throw new TypeError(`A PRF salt must be ${KEEL_SEALED_PRF_SALT_BYTES} bytes.`);
  return buffer(value);
}

function bytesOf(value: unknown): Uint8Array | undefined {
  if (value instanceof ArrayBuffer || Object.prototype.toString.call(value) === "[object ArrayBuffer]") return new Uint8Array((value as ArrayBuffer).slice(0));
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  return undefined;
}

interface ReadCredential {
  readonly rawId: Uint8Array;
  readonly prf: { readonly enabled?: unknown; readonly results?: { readonly first?: unknown } } | undefined;
  readonly discoverable: boolean | undefined;
}

function readCredential(value: unknown): ReadCredential {
  if (value === null || value === undefined) throw new KeelPasskeyError("cancelled", "No passkey was returned.");
  const credential = value as { readonly rawId?: unknown; readonly getClientExtensionResults?: unknown };
  const rawId = bytesOf(credential.rawId);
  if (rawId === undefined || rawId.byteLength === 0) throw new KeelPasskeyError("failed", "The authenticator returned a credential without an id.");
  const results = typeof credential.getClientExtensionResults === "function"
    ? ((credential.getClientExtensionResults as () => unknown).call(value) as { readonly prf?: unknown; readonly credProps?: { readonly rk?: unknown } } | undefined)
    : undefined;
  const prf = results?.prf !== null && typeof results?.prf === "object" ? (results.prf as ReadCredential["prf"]) : undefined;
  const rk = results?.credProps?.rk;
  return { rawId, prf, discoverable: typeof rk === "boolean" ? rk : undefined };
}

function prfFirst(prf: ReadCredential["prf"]): Uint8Array | undefined {
  const first = prf?.results?.first;
  if (first === undefined || first === null) return undefined;
  const bytes = bytesOf(first);
  if (bytes === undefined || bytes.byteLength !== 32) throw new KeelPasskeyError("failed", "The authenticator returned a PRF result of an unexpected size.");
  return bytes;
}

function webAuthnError(error: unknown): KeelPasskeyError {
  if (error instanceof KeelPasskeyError) return error;
  const name = error !== null && typeof error === "object" && "name" in error ? String(error.name) : "";
  switch (name) {
    case "NotAllowedError":
      return new KeelPasskeyError("cancelled", "The passkey prompt was cancelled or timed out.", { cause: error });
    case "AbortError":
      return new KeelPasskeyError("aborted", "The passkey request was aborted.", { cause: error });
    case "SecurityError":
      return new KeelPasskeyError("wrong-site", "This page is not allowed to use passkeys for that site (relying-party id mismatch).", { cause: error });
    case "InvalidStateError":
      return new KeelPasskeyError("already-registered", "This authenticator already holds one of the excluded passkeys.", { cause: error });
    case "NotSupportedError":
      return new KeelPasskeyError("unsupported", "This authenticator does not support the requested passkey options.", { cause: error });
    default:
      return new KeelPasskeyError("failed", `The passkey request failed${error instanceof Error && error.message ? `: ${error.message}` : "."}`, { cause: error });
  }
}

const PRF_MISSING = "The passkey answered but returned no PRF result, so it cannot seal or unlock content. Use a passkey provider that supports the WebAuthn PRF extension.";

interface Assertion {
  readonly allow: readonly Uint8Array[];
  readonly salt?: Uint8Array;
  readonly saltByCredential?: ReadonlyMap<string, Uint8Array>;
  readonly rpId?: string | undefined;
  readonly timeout?: number | undefined;
  readonly signal?: AbortSignal | undefined;
}

async function assertPrf(credentials: KeelPasskeyCredentials, request: Assertion): Promise<{ readonly credentialId: Uint8Array; readonly prfOutput: Uint8Array }> {
  const prf: AuthenticationExtensionsPRFInputs = request.saltByCredential === undefined
    ? { eval: { first: buffer(request.salt ?? new Uint8Array(0)) } }
    : { evalByCredential: Object.fromEntries([...request.saltByCredential].map(([id, salt]) => [id, { first: buffer(salt) }])) };
  const publicKey: PublicKeyCredentialRequestOptions = {
    challenge: randomBytes(32),
    allowCredentials: request.allow.map((id) => ({ type: "public-key", id: buffer(id) })),
    userVerification: "required",
    extensions: { prf },
    ...(request.rpId === undefined ? {} : { rpId: request.rpId }),
    ...(request.timeout === undefined ? {} : { timeout: request.timeout }),
  };
  let result: unknown;
  try {
    result = await credentials.get({ publicKey, ...(request.signal === undefined ? {} : { signal: request.signal }) });
  } catch (error) {
    throw webAuthnError(error);
  }
  const credential = readCredential(result);
  const prfOutput = prfFirst(credential.prf);
  if (prfOutput === undefined) throw new KeelPasskeyError("prf-unsupported", PRF_MISSING);
  return { credentialId: credential.rawId, prfOutput };
}

function slotInput(credentialId: Uint8Array, prfSalt: Uint8Array, prfOutput: Uint8Array, includeCredentialId: boolean, rpId: string | undefined): KeelSealedPasskeySlotInput {
  return { kind: "passkey-prf", credentialId, prfSalt, prfOutput, includeCredentialId, ...(rpId === undefined ? {} : { rpId }) };
}

// --------------------------------------------------------------------- public

/** Whether passkeys here can (probably) seal content, with the reason when they cannot. */
export async function getPasskeySealingSupport(environment?: KeelPasskeyEnvironment): Promise<KeelPasskeySealingSupport> {
  const resolved = environment ?? defaultEnvironment();
  const credentials = resolved.credentials;
  if (resolved.PublicKeyCredential === undefined || credentials === undefined || typeof credentials.create !== "function" || typeof credentials.get !== "function") {
    return { supported: false, prf: "no", reason: "Passkeys are not available here. Use a current browser on a secure (https) page." };
  }
  const capabilities = resolved.PublicKeyCredential.getClientCapabilities;
  if (typeof capabilities !== "function") return { supported: true, prf: "unknown" };
  let reported: boolean | undefined;
  try {
    reported = (await capabilities.call(resolved.PublicKeyCredential))?.["extension:prf"];
  } catch {
    return { supported: true, prf: "unknown" };
  }
  if (reported === true) return { supported: true, prf: "yes" };
  if (reported === false) return { supported: false, prf: "no", reason: "This browser's passkeys cannot derive keys (no WebAuthn PRF support)." };
  return { supported: true, prf: "unknown" };
}

/**
 * True when passkey sealing is available or might be (PRF support is only
 * certain once a passkey answers). False when WebAuthn is missing or the
 * browser reports no PRF support.
 */
export async function isPasskeySealingSupported(environment?: KeelPasskeyEnvironment): Promise<boolean> {
  return (await getPasskeySealingSupport(environment)).supported;
}

/**
 * Create a new passkey for sealing and evaluate its PRF for a fresh salt. Some
 * authenticators only confirm PRF support at creation; for them this asks for
 * the passkey once more to get the result.
 */
export async function createSealingPasskey(options: CreateSealingPasskeyOptions, environment?: KeelPasskeyEnvironment): Promise<KeelSealingPasskey> {
  const credentials = requireCredentials(environment);
  if (typeof options?.rp?.name !== "string" || options.rp.name.length === 0) throw new TypeError("A sealing passkey needs rp.name.");
  if (typeof options.user?.name !== "string" || options.user.name.length === 0) throw new TypeError("A sealing passkey needs user.name.");
  const userId = options.user.id === undefined ? randomBytes(16) : buffer(options.user.id);
  if (userId.byteLength < 1 || userId.byteLength > 64) throw new TypeError("user.id must be 1–64 bytes.");
  const prfSalt = saltInput(options.prfSalt);
  const rpId = options.rp.id;
  const publicKey: PublicKeyCredentialCreationOptions = {
    rp: { name: options.rp.name, ...(rpId === undefined ? {} : { id: rpId }) },
    user: { id: userId, name: options.user.name, displayName: options.user.displayName ?? options.user.name },
    challenge: randomBytes(32),
    pubKeyCredParams: [
      { type: "public-key", alg: -7 },
      { type: "public-key", alg: -8 },
      { type: "public-key", alg: -257 },
    ],
    authenticatorSelection: {
      residentKey: "preferred",
      requireResidentKey: false,
      userVerification: "required",
      ...(options.authenticatorAttachment === undefined ? {} : { authenticatorAttachment: options.authenticatorAttachment }),
    },
    attestation: "none",
    excludeCredentials: (options.excludeCredentialIds ?? []).map((id) => ({ type: "public-key", id: buffer(id) })),
    extensions: { prf: { eval: { first: prfSalt } }, credProps: true },
    ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
  };
  let created: unknown;
  try {
    created = await credentials.create({ publicKey, ...(options.signal === undefined ? {} : { signal: options.signal }) });
  } catch (error) {
    throw webAuthnError(error);
  }
  const credential = readCredential(created);
  let prfOutput = prfFirst(credential.prf);
  if (prfOutput === undefined) {
    if (credential.prf === undefined || credential.prf.enabled === false) {
      throw new KeelPasskeyError("prf-unsupported", "The passkey was created, but this browser or authenticator cannot derive keys from it (no WebAuthn PRF support). You can delete it from your password manager.");
    }
    prfOutput = (await assertPrf(credentials, { allow: [credential.rawId], salt: prfSalt, rpId, timeout: options.timeout, signal: options.signal })).prfOutput;
  }
  const includeCredentialId = options.includeCredentialId ?? credential.discoverable !== true;
  return {
    credentialId: credential.rawId,
    credentialIdText: toBase64Url(credential.rawId),
    ...(rpId === undefined ? {} : { rpId }),
    ...(credential.discoverable === undefined ? {} : { discoverable: credential.discoverable }),
    slot: slotInput(credential.rawId, prfSalt, prfOutput, includeCredentialId, rpId),
  };
}

/**
 * Use an existing passkey to make a slot for a new sealed object (or a backup
 * slot through `addKeelSealedSlot`). Each call uses a fresh salt, so slots in
 * different objects cannot be linked to the same passkey.
 */
export async function prepareSealingPasskeySlot(options: PrepareSealingPasskeySlotOptions = {}, environment?: KeelPasskeyEnvironment): Promise<KeelSealingPasskey> {
  const credentials = requireCredentials(environment);
  const requested = options.credentialId === undefined ? undefined : credentialIdBytes(options.credentialId, "credentialId");
  const prfSalt = saltInput(options.prfSalt);
  const { credentialId, prfOutput } = await assertPrf(credentials, {
    allow: requested === undefined ? [] : [requested],
    salt: prfSalt,
    rpId: options.rpId,
    timeout: options.timeout,
    signal: options.signal,
  });
  const includeCredentialId = options.includeCredentialId ?? requested !== undefined;
  return {
    credentialId,
    credentialIdText: toBase64Url(credentialId),
    ...(options.rpId === undefined ? {} : { rpId: options.rpId }),
    slot: slotInput(credentialId, prfSalt, prfOutput, includeCredentialId, options.rpId),
  };
}

/**
 * Ask the user's passkey for the secret that opens a sealed object. The
 * result goes straight to `openKeelContent(envelope, unlock)`.
 *
 * With the "discoverable" strategy and more than one passkey slot, the first
 * prompt identifies the passkey; if it belongs to a different slot than the
 * one evaluated, a second prompt (for that passkey only) gets its secret.
 */
export async function unlockSealedWithPasskey(
  source: Uint8Array | KeelSealedHeader,
  options: UnlockSealedWithPasskeyOptions = {},
  environment?: KeelPasskeyEnvironment,
): Promise<KeelSealedPasskeyUnlock & { readonly credentialId: Uint8Array; readonly slotIndex: number }> {
  const credentials = requireCredentials(environment);
  const header = source instanceof Uint8Array ? parseKeelSealedHeader(source) : normalizeKeelSealedHeader(source);
  let slots = header.slots.flatMap((slot, index) => (slot.kind === "passkey-prf" ? [{ slot, index }] : []));
  if (slots.length === 0) throw new KeelPasskeyError("no-passkey-slot", "This sealed object cannot be opened with a passkey.");
  const hinted = [...new Set(slots.flatMap(({ slot }) => (slot.rpId === undefined ? [] : [slot.rpId])))];
  const rpId = options.rpId ?? (hinted.length === 1 ? hinted[0] : undefined);
  if (rpId !== undefined) {
    const forSite = slots.filter(({ slot }) => slot.rpId === undefined || slot.rpId === rpId);
    if (forSite.length === 0) throw new KeelPasskeyError("no-passkey-slot", `None of this object's passkeys belong to ${rpId}.`);
    slots = forSite;
  }
  const saltOf = (index: number) => fromBase64Url(slots.find((entry) => entry.index === index)!.slot.salt, "Passkey salt");
  const request = { rpId, timeout: options.timeout, signal: options.signal };

  // Credential ids we can ask for directly: stored in a slot, or remembered by the app.
  const known = new Map<string, { readonly id: Uint8Array; readonly slotIndex: number }>();
  for (const { slot, index } of slots) if (slot.credentialId !== undefined) known.set(slot.credentialId, { id: fromBase64Url(slot.credentialId, "Credential id"), slotIndex: index });
  for (const remembered of options.knownCredentialIds ?? []) {
    const id = credentialIdBytes(remembered, "Known credential id");
    const text = toBase64Url(id);
    if (known.has(text)) continue;
    const match = (await matchKeelSealedPasskeySlots(header, id)).find((index) => slots.some((entry) => entry.index === index));
    if (match !== undefined) known.set(text, { id, slotIndex: match });
  }
  const coveredSlots = new Set([...known.values()].map((entry) => entry.slotIndex));
  const strategy = options.strategy ?? "auto";
  const useKnown = strategy === "known" || (strategy === "auto" && known.size > 0 && slots.every(({ index }) => coveredSlots.has(index)));

  if (useKnown) {
    if (known.size === 0) throw new KeelPasskeyError("unknown-passkey", "No passkey id is stored or remembered for this sealed object; let the user choose a passkey instead.");
    const entries = [...known];
    const { credentialId, prfOutput } = await assertPrf(credentials, {
      allow: entries.map(([, entry]) => entry.id),
      ...(entries.length === 1
        ? { salt: saltOf(entries[0]![1].slotIndex) }
        : { saltByCredential: new Map(entries.map(([text, entry]) => [text, saltOf(entry.slotIndex)])) }),
      ...request,
    });
    const chosen = known.get(toBase64Url(credentialId));
    if (chosen === undefined) throw new KeelPasskeyError("unknown-passkey", "The authenticator answered with a passkey that was not requested.");
    return { kind: "passkey-prf", prfOutput, credentialId, slotIndex: chosen.slotIndex };
  }

  const first = slots.find(({ index }) => !coveredSlots.has(index)) ?? slots[0]!;
  const picked = await assertPrf(credentials, { allow: [], salt: saltOf(first.index), ...request });
  const matches = (await matchKeelSealedPasskeySlots(header, picked.credentialId)).filter((index) => slots.some((entry) => entry.index === index));
  if (matches.length === 0) throw new KeelPasskeyError("unknown-passkey", "That passkey cannot open this sealed object. Choose the passkey it was sealed with.");
  if (matches.includes(first.index)) return { kind: "passkey-prf", prfOutput: picked.prfOutput, credentialId: picked.credentialId, slotIndex: first.index };
  const slotIndex = matches[0]!;
  const again = await assertPrf(credentials, { allow: [picked.credentialId], salt: saltOf(slotIndex), ...request });
  return { kind: "passkey-prf", prfOutput: again.prfOutput, credentialId: again.credentialId, slotIndex };
}
