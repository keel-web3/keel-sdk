import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { completeStudioConnection, getStudioConnection, importStudioAgentToken, startStudioConnection, studioConnectionOrigin, type StudioConnectionView } from "@keel/sdk/studio-connection-node";

export function browserCommand(url: string, platform = process.platform): readonly [string, readonly string[]] {
  return platform === "darwin" ? ["open", [url]] : platform === "win32" ? ["rundll32.exe", ["url.dll,FileProtocolHandler", url]] : ["xdg-open", [url]];
}
function openBrowser(url: string): void {
  const [command, args] = browserCommand(url);
  const child = spawn(command, args, { stdio: "ignore", detached: true, windowsHide: true });
  child.once("error", () => process.stderr.write("Open the printed connection link in your browser.\n"));
  child.unref();
}
async function hiddenKey(): Promise<string> {
  if (!process.stdin.isTTY) throw new Error("Use --import-key in an interactive terminal. Never put the key in command arguments or chat.");
  process.stderr.write("Paste Studio agent key (hidden), then press Enter: ");
  const previous = process.stdin.isRaw;
  process.stdin.setRawMode(true); process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    function done(error?: Error): void {
      process.stdin.off("data", data); process.stdin.setRawMode(previous); process.stdin.pause(); process.stderr.write("\n");
      if (error) reject(error); else resolve(value.trim());
    }
    function data(chunk: Buffer): void {
      for (const c of chunk.toString("utf8")) {
        if (c === "\u0003") { done(new Error("Key import cancelled.")); return; }
        if (c === "\r" || c === "\n") { done(); return; }
        if (c === "\u007f" || c === "\b") value = value.slice(0, -1);
        else if (/^[A-Za-z0-9_-]$/u.test(c) && value.length < 192) value += c;
      }
    }
    process.stdin.on("data", data);
  });
}
/** This loopback window contains public approval metadata only. The key goes server-to-SDK, never through the browser. */
export async function connectionWindow(initial: StudioConnectionView) {
  const nonce = randomBytes(24).toString("hex");
  function publicStatus(view: StudioConnectionView): StudioConnectionView {
    const studioUrl = studioConnectionOrigin(view.studioUrl);
    const code = view.code && /^[A-Z2-9]{4}-[A-Z2-9]{4}$/u.test(view.code) ? view.code : undefined;
    return { status: view.status, studioUrl, ...(code ? { code, approveUrl: `${studioUrl}/studio/connect?code=${code}` } : {}) };
  }
  let status = publicStatus(initial);
  const path = `/connect/${nonce}`;
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Connect your agent to KEEL Studio</title><style>body{font:17px system-ui;background:#0d0e12;color:#f2f3f8;max-width:32rem;margin:3rem auto;padding:1.5rem}button,a{font:inherit;color:#fff;background:#494bdf;border:0;border-radius:.4rem;padding:.8rem;display:inline-block}code{font-size:2rem}p{line-height:1.6}</style><h1>Connect to KEEL Studio</h1><p id="status"></p><p><code id="code"></code></p><a id="approve" target="_blank" rel="noopener noreferrer">Approve in Studio</a><p>Check the code and choose what your agent may do. Your wallet stays with you. No Desktop app is needed.</p><script nonce="${nonce}">async function update(){const r=await fetch(location.pathname+'/status',{cache:'no-store'});const s=await r.json();document.querySelector('#status').textContent=s.status==='connected'?'Connected. You can close this window.':s.status==='pending'?'Waiting for your approval.':s.status;document.querySelector('#code').textContent=s.code||'';const a=document.querySelector('#approve');a.hidden=s.status!=='pending';if(s.approveUrl)a.href=s.approveUrl;if(s.status==='pending')setTimeout(update,2000)}document.querySelector('#approve').onclick=e=>{e.preventDefault();window.open(e.currentTarget.href,'_blank','popup,width=560,height=780,noopener,noreferrer')};update()</script></html>`;
  const server = createServer((req, res) => {
    const host = `127.0.0.1:${(server.address() as { port: number }).port}`;
    if (req.method !== "GET" || req.headers.host !== host || (req.headers.origin && req.headers.origin !== `http://${host}`) || ![path, `${path}/status`].includes(req.url ?? "")) { res.writeHead(404).end(); return; }
    res.setHeader("cache-control", "no-store"); res.setHeader("x-content-type-options", "nosniff"); res.setHeader("referrer-policy", "no-referrer");
    res.setHeader("content-security-policy", `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'`);
    res.setHeader("content-type", req.url === path ? "text/html; charset=utf-8" : "application/json");
    res.end(req.url === path ? html : JSON.stringify(status));
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}${path}`, update: (view: StudioConnectionView) => { status = publicStatus(view); }, close: () => new Promise<void>(resolve => server.close(() => resolve())) };
}
export async function runConnectionCli(options: { workspace: string; studioUrl?: string; action: "connect" | "connection-status" | "import-key"; noOpen?: boolean; window?: boolean; reconnect?: boolean; label?: string; scopes?: readonly import("@keel/sdk/studio-connection-node").StudioConnectionScope[] }): Promise<void> {
  const config = { workspace: options.workspace, ...(options.studioUrl ? { studioUrl: options.studioUrl } : {}) };
  if (options.action === "connection-status") { process.stdout.write(`${JSON.stringify(await getStudioConnection(config))}\n`); return; }
  if (options.action === "import-key") { process.stdout.write(`${JSON.stringify(await importStudioAgentToken(await hiddenKey(), config))}\n`); return; }
  let view = await startStudioConnection({ ...config, ...(options.reconnect ? { reconnect: true } : {}), ...(options.label ? { label: options.label } : {}), ...(options.scopes ? { scopes: options.scopes } : {}) });
  if (view.status === "connected") { process.stdout.write("This workspace is connected to Studio. Use --reconnect to request different permissions.\n"); return; }
  process.stdout.write(`Approve code ${view.code} in Studio:\n${view.approveUrl}\n`);
  const window = options.window ? await connectionWindow(view) : undefined;
  const url = window?.url ?? view.approveUrl!;
  if (window) process.stdout.write(`Connection window: ${url}\n`);
  if (!options.noOpen) openBrowser(url);
  try {
    while (view.status === "pending") {
      await new Promise(resolve => setTimeout(resolve, 2200));
      view = await completeStudioConnection(config); window?.update(view);
    }
    if (view.status !== "connected") throw new Error(`Studio connection ${view.status}. Run --connect again.`);
    process.stdout.write("Connected. The key is saved privately; KEEL MCP and the Node SDK use it automatically for this workspace.\n");
    if (window) await new Promise(resolve => setTimeout(resolve, 2500));
  } finally { await window?.close(); }
}
