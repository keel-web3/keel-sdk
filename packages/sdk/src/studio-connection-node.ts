/** Node-only Studio connection. Secrets stay in a private user-profile file, never MCP results or project files. */
import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, lstat, open, realpath, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { KEEL_STUDIO_URL } from "./endpoints.js";
import { createKeelStudioAgentDraftClient } from "./studio-agent-drafts.js";

export const STUDIO_CONNECTION_SCOPES = ["drafts:read", "drafts:create", "drafts:write", "contracts:read", "bridge:serve"] as const;
export type StudioConnectionScope = typeof STUDIO_CONNECTION_SCOPES[number];
export interface StudioConnectionOptions {
  readonly workspace?: string;
  readonly studioUrl?: string;
  /** For embedding/tests. Use a private user-profile directory, never a project directory. */
  readonly credentialDirectory?: string;
  readonly fetchImplementation?: typeof fetch;
}
export interface StudioConnectionView {
  readonly status: "disconnected" | "pending" | "connected" | "expired" | "denied" | "collected";
  readonly studioUrl: string;
  readonly code?: string;
  readonly approveUrl?: string;
  readonly expiresAt?: string;
  readonly scopes?: readonly StudioConnectionScope[];
  readonly label?: string;
}
type Saved = StudioConnectionView & { readonly token?: string; readonly pollToken?: string; readonly interval?: number };
const TOKEN = /^keel_agent_[A-Za-z0-9_-]{20,180}$/u;
const POLL = /^keel_pair_[A-Za-z0-9_-]{43}$/u;
const locks = new Map<string, Promise<unknown>>();

export function studioConnectionOrigin(value = process.env.KEEL_STUDIO_URL ?? KEEL_STUDIO_URL): string {
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "") ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))) throw new TypeError("Use a Studio HTTPS origin (HTTP is allowed only on loopback).");
  return url.origin;
}
async function location(options: StudioConnectionOptions): Promise<{ path: string; origin: string }> {
  const origin = studioConnectionOrigin(options.studioUrl);
  const workspace = await realpath(options.workspace ?? ".");
  const root = options.credentialDirectory ?? process.env.KEEL_STUDIO_CREDENTIAL_DIR ?? join(homedir(), ".keel", "studio-connections");
  const key = createHash("sha256").update(`${workspace}\n${origin}`).digest("hex");
  return { path: join(root, `${key}.json`), origin };
}
async function privatePath(path: string, directory = false): Promise<void> {
  const info = await lstat(path);
  if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile())) throw new Error("Studio credential path is unsafe.");
  if (process.platform !== "win32" && ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.())) throw new Error("Studio credentials must be owned by you and private (directory 700, file 600).");
}
async function windowsPrivate(path: string): Promise<void> {
  if (process.platform !== "win32") return;
  const name = process.env.USERNAME;
  if (!name || /[\r\n]/u.test(name)) throw new Error("Cannot identify the Windows credential owner.");
  const owner = process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${name}` : name;
  await promisify(execFile)("icacls", [path, "/inheritance:r", "/grant:r", `${owner}:(F)`], { windowsHide: true }).catch(() => { throw new Error("Could not restrict the Studio credential ACL."); });
}
async function readSaved(path: string, origin: string): Promise<Saved> {
  try {
    await privatePath(dirname(path), true);
    await privatePath(path);
    const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      if ((await file.stat()).size > 16384) throw new Error("Studio credential record is invalid.");
      const saved = JSON.parse(await file.readFile("utf8")) as Saved;
      if (saved.studioUrl !== origin || !["pending", "connected", "denied", "expired", "collected"].includes(saved.status)) throw new Error("Studio credential record is invalid.");
      if ((saved.status === "connected" && !TOKEN.test(saved.token ?? "")) || (saved.status === "pending" && (!POLL.test(saved.pollToken ?? "") || !/^[A-Z2-9]{4}-[A-Z2-9]{4}$/u.test(saved.code ?? "")))) throw new Error("Studio credential record is invalid.");
      if (saved.expiresAt && (!Number.isFinite(Date.parse(saved.expiresAt)) || Date.parse(saved.expiresAt) <= Date.now())) return { status: "expired", studioUrl: origin };
      return saved;
    } finally { await file.close(); }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "disconnected", studioUrl: origin };
    throw error;
  }
}
async function save(path: string, value: Saved): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await privatePath(dirname(path), true);
  await windowsPrivate(dirname(path));
  const temp = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  const file = await open(temp, "wx", 0o600);
  try {
    await windowsPrivate(temp);
    await file.writeFile(JSON.stringify(value));
    await file.sync();
  } finally { await file.close(); }
  try { await rename(temp, path); } finally { await unlink(temp).catch(() => undefined); }
}
function view(saved: Saved): StudioConnectionView {
  return { status: saved.status, studioUrl: saved.studioUrl,
    ...(saved.code ? { code: saved.code, approveUrl: `${saved.studioUrl}/studio/connect?code=${saved.code}` } : {}),
    ...(saved.expiresAt ? { expiresAt: saved.expiresAt } : {}), ...(saved.scopes ? { scopes: saved.scopes } : {}), ...(saved.label ? { label: saved.label } : {}) };
}
async function exclusive<T>(path: string, run: () => Promise<T>): Promise<T> {
  const earlier = locks.get(path) ?? Promise.resolve();
  const job = earlier.catch(() => undefined).then(async () => {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await privatePath(dirname(path), true);
    await windowsPrivate(dirname(path));
    // One process may collect the one-time key. A second MCP/CLI must never overwrite it with "collected".
    const lockPath = `${path}.lock`;
    let lock;
    try { lock = await open(lockPath, "wx", 0o600); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const info = await lstat(lockPath);
      if (info.isSymbolicLink() || Date.now() - info.mtimeMs < 60000) throw new Error("Studio connection is busy in another process. Retry shortly.");
      await unlink(lockPath);
      lock = await open(lockPath, "wx", 0o600);
    }
    try { return await run(); } finally { await lock.close(); await unlink(lockPath).catch(() => undefined); }
  });
  locks.set(path, job);
  try { return await job; } finally { if (locks.get(path) === job) locks.delete(path); }
}
async function request(options: StudioConnectionOptions, origin: string, path: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await (options.fetchImplementation ?? fetch)(`${origin}${path}`, { method: "POST", redirect: "error", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Studio connection response is empty.");
  let size = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > 65536) { await reader.cancel(); throw new Error("Studio connection response is too large."); }
    chunks.push(next.value);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  let data: Record<string, unknown>;
  try { data = JSON.parse(text) as Record<string, unknown>; } catch { throw new Error("Studio connection response is invalid."); }
  if (!response.ok && !["denied", "expired", "collected"].includes(String(data.status))) throw new Error(`Studio connection failed (${response.status}). Try connecting again.`);
  return data;
}
function scopesOf(raw: unknown): StudioConnectionScope[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 5 || raw.some(s => !STUDIO_CONNECTION_SCOPES.includes(s))) throw new TypeError("Choose valid Studio connection permissions.");
  return [...new Set(raw)] as StudioConnectionScope[];
}
export async function getStudioConnection(options: StudioConnectionOptions = {}): Promise<StudioConnectionView> {
  const { path, origin } = await location(options);
  return view(await readSaved(path, origin));
}
export async function startStudioConnection(options: StudioConnectionOptions & { readonly client?: string; readonly label?: string; readonly scopes?: readonly StudioConnectionScope[]; readonly reconnect?: boolean } = {}): Promise<StudioConnectionView> {
  const { path, origin } = await location(options);
  return exclusive(path, async () => {
    const previous = await readSaved(path, origin);
    if (!options.reconnect && ["pending", "connected"].includes(previous.status)) return view(previous);
    const scopes = scopesOf(options.scopes ?? ["drafts:read", "drafts:create", "contracts:read"]);
    const label = options.label ?? "KEEL agent";
    if (label.trim().length < 2 || label.length > 80 || /[\u0000-\u001f]/u.test(label)) throw new TypeError("Use a connection label of 2–80 characters.");
    const result = await request(options, origin, "/api/agent/pair", { client: options.client ?? "keel-mcp", label, scopes });
    if (!POLL.test(String(result.pollToken)) || !/^[A-Z2-9]{4}-[A-Z2-9]{4}$/u.test(String(result.code)) || !Number.isFinite(Date.parse(String(result.expiresAt)))) throw new Error("Studio pairing response is invalid.");
    const saved: Saved = { status: "pending", studioUrl: origin, code: String(result.code), pollToken: String(result.pollToken), expiresAt: String(result.expiresAt), interval: Math.max(2, Number(result.interval) || 2), scopes, label };
    await save(path, saved);
    return view(saved);
  });
}
export async function completeStudioConnection(options: StudioConnectionOptions = {}): Promise<StudioConnectionView> {
  const { path, origin } = await location(options);
  return exclusive(path, async () => {
    const previous = await readSaved(path, origin);
    if (previous.status !== "pending") return view(previous);
    const result = await request(options, origin, "/api/agent/pair/poll", { pollToken: previous.pollToken });
    if (result.status === "pending") return view(previous);
    if (["denied", "expired", "collected"].includes(String(result.status))) {
      const saved: Saved = { status: result.status as "denied" | "expired" | "collected", studioUrl: origin };
      await save(path, saved); return view(saved);
    }
    const grant = result.grant as Record<string, unknown> | undefined;
    if (result.status !== "approved" || !TOKEN.test(String(result.token)) || !grant || !Number.isFinite(Date.parse(String(grant.expiresAt)))) throw new Error("Studio approval response is invalid.");
    const scopes = scopesOf(grant.scopes);
    if (scopes.some(scope => !previous.scopes?.includes(scope))) throw new Error("Studio approval broadened the requested permissions.");
    const saved: Saved = { status: "connected", studioUrl: origin, token: String(result.token), scopes, label: previous.label ?? "KEEL agent", expiresAt: String(grant.expiresAt) };
    await save(path, saved);
    return view(saved);
  });
}
/** Private SDK/MCP use only. Never serialize this result into an agent response. Environment overrides remain compatible. */
export async function loadStudioAgentToken(options: StudioConnectionOptions = {}): Promise<string> {
  const { path, origin } = await location(options);
  const envToken = process.env.KEEL_STUDIO_AGENT_TOKEN ?? process.env.FRAY_STUDIO_AGENT_TOKEN;
  if (envToken && origin === studioConnectionOrigin()) {
    if (!TOKEN.test(envToken)) throw new Error("Configured Studio agent key is invalid.");
    return envToken;
  }
  const saved = await readSaved(path, origin);
  if (saved.status !== "connected" || !saved.token) throw new Error("Connect this workspace to Studio first: call keel-studio-connect with operation=start, open approveUrl for the user, then operation=complete. Or run keel-mcp --connect --workspace . No key needs to be pasted into chat or environment files.");
  return saved.token;
}
/** Terminal fallback: caller reads this from a hidden prompt; never pass the key as a command-line argument. */
export async function importStudioAgentToken(token: string, options: StudioConnectionOptions = {}): Promise<StudioConnectionView> {
  if (!TOKEN.test(token)) throw new TypeError("That is not a Studio agent key.");
  const { path, origin } = await location(options);
  return exclusive(path, async () => { await save(path, { status: "connected", studioUrl: origin, token, label: "Imported Studio key" }); return { status: "connected", studioUrl: origin, label: "Imported Studio key" }; });
}
export async function createConnectedStudioDraftClient(options: StudioConnectionOptions = {}) {
  return createKeelStudioAgentDraftClient({ studioUrl: studioConnectionOrigin(options.studioUrl), grantToken: await loadStudioAgentToken(options), ...(options.fetchImplementation ? { fetchImplementation: options.fetchImplementation } : {}) });
}
