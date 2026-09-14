// The practice viewer: a small read-only HTTP gateway that reads a published
// game back from the chain through KeelRawTokenURIBuilder -- the exact
// document the chain assembles, in the KEEL verification shell -- and serves
// it to any browser. It holds no keys and sends no transactions.
//
//   GET /                              the games published on this chain (the sandbox's record)
//   GET /game/<chainId>/<root>?digest= the game, read from the chain now
import { createServer } from "node:http";
import { readGame } from "./publication.mjs";
import { clientsFor, readRecord } from "./local-chain.mjs";

const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>body{font:14px/1.5 system-ui,sans-serif;background:#0b0d12;color:#e8ecf2;margin:2rem}a{color:#9ef}code{color:#bdf}td,th{padding:.2rem .8rem;text-align:left}</style></head><body>${body}</body></html>`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export async function startViewer({ port, rpc, builder, chainId, host = "127.0.0.1" }) {
  const { publicClient } = await clientsFor(rpc, { account: "0x0000000000000000000000000000000000000001" });
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${host}`);
      const game = /^\/game\/(\d+)\/(0x[0-9a-fA-F]{64})$/.exec(url.pathname);
      if (game) {
        if (Number(game[1]) !== chainId) throw new Error(`This viewer reads chain ${chainId}, not ${game[1]}.`);
        const digest = url.searchParams.get("digest");
        if (!/^0x[0-9a-fA-F]{64}$/.test(digest ?? "")) throw new Error("A game link needs its root digest (?digest=0x...).");
        const seed = url.searchParams.get("seed");
        const { html } = await readGame({ publicClient, builder, rootId: game[2], digest, context: seed ? { seed } : {} });
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        response.end(html);
        return;
      }
      if (url.pathname === "/") {
        const games = readRecord("games")?.games ?? [];
        const rows = games.map((g) => `<tr><td>${esc(g.gameId)}</td><td><a href="/game/${g.chainId}/${g.root}?digest=${g.digest}">open from chain</a></td><td><code>${esc(g.root.slice(0, 18))}…</code></td><td>${esc(g.publishedAt)}</td></tr>`).join("");
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(page("KEEL practice viewer", `<h1>KEEL practice viewer</h1><p>Chain ${chainId} at <code>${esc(rpc)}</code>, builder <code>${esc(builder)}</code>. Every game below is read from the chain when you open it.</p><table><tr><th>game</th><th></th><th>root</th><th>published</th></tr>${rows || "<tr><td colspan=4>Nothing published yet: <code>pnpm game:publish &lt;game-id&gt; --project &lt;dir&gt;</code></td></tr>"}</table>`));
        return;
      }
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("Not found");
    } catch (error) {
      response.writeHead(500, { "content-type": "text/html; charset=utf-8" });
      response.end(page("KEEL viewer error", `<h1>Couldn't read that game from the chain</h1><pre>${esc(error?.shortMessage ?? error?.message ?? error)}</pre>`));
    }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, host, resolve); });
  return { url: `http://${host}:${server.address().port}`, close: () => new Promise((done) => server.close(() => done())) };
}
