// Dev server: static files, and PUT into out/ (pages save captured frames and clips there).
//   node tools/serve.mjs [port]
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = Number(process.argv[2] ?? 4200);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".png": "image/png", ".gif": "image/gif", ".css": "text/css", ".glsl": "text/plain", ".wav": "audio/wav" };

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "");
  if (req.method === "PUT") {
    if (!/^out\/[\w./-]+\.(png|gif|wav|json|webm)$/.test(path) || path.includes("..")) { res.writeHead(403).end(); return; }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), Buffer.concat(chunks));
    res.writeHead(204).end();
    return;
  }
  const file = join(root, path === "" ? "index.html" : path);
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file.endsWith("/") ? join(file, "index.html") : file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" }).end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(port, '127.0.0.1', () => console.log(`keel-pixel on http://127.0.0.1:${port}/projects/wallrun/`));
