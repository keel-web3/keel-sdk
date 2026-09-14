import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const allowed = new Map([['/', 'preview.html'], ['/preview.html', 'preview.html'], ['/sandbox.html', 'sandbox.html'], ['/discovery.html', 'discovery.html'], ['/discovery-frame.html', 'discovery-frame.html']]);
const server = createServer(async (request, response) => {
  const file = allowed.get(new URL(request.url, 'http://localhost').pathname);
  if (!file) { response.writeHead(404); response.end(); return; }
  try { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(await readFile(new URL(`${process.argv[2] ?? "dist"}/${file}`, import.meta.url))); }
  catch { response.writeHead(503); response.end('Run npm run build first.'); }
});
server.listen(0, '127.0.0.1', () => console.log(`http://127.0.0.1:${server.address().port}/`));
