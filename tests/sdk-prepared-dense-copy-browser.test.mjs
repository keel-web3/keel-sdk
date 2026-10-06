import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readdir, stat, mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { prepareKeelDensePayload, buildKeelPreparedDenseCopyShell, buildKeelOnchainContainerBinding,
  serializeKeelDenseTransportJSON, toKeelDenseTransportDataURL } from '../packages/sdk/dist/index.js';

const sha = bytes => '0x' + createHash('sha256').update(bytes).digest('hex');
const hash = byte => '0x' + byte.repeat(32), address = byte => '0x' + byte.repeat(20);
async function chromePath() {
  if (process.env.KEEL_CHROME_HEADLESS_SHELL) return process.env.KEEL_CHROME_HEADLESS_SHELL;
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  const names = (await readdir(cache)).filter(name => name.startsWith('chromium_headless_shell-')).sort().reverse();
  const path = join(cache, names[0], 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell');
  assert.ok((await stat(path)).isFile()); return path;
}

async function launch(binary) {
  const profile = await mkdtemp(join(tmpdir(), "keel-audio-chrome-"));
  const child = spawn(binary, [
    "--headless",
    "--mute-audio",
    "--autoplay-policy=document-user-activation-required",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Chrome did not expose DevTools: ${stderr}`)), 15_000);
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      const match = /DevTools listening on (ws:\/\/\S+)/u.exec(stderr);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    child.on("error", reject);
  });
  const socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let nextId = 0;
  const pending = new Map();
  const listeners = [];
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id !== undefined) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(`${entry.method}: ${message.error.message}`));
      else entry.resolve(message.result);
    } else for (const listener of listeners) listener(message);
  };
  const send = (method, params = {}, sessionId = undefined) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject, method });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId === undefined ? {} : { sessionId }) }));
  });
  return {
    send,
    on: (listener) => listeners.push(listener),
    close: async () => {
      socket.close();
      child.kill("SIGKILL");
      await once(child, "exit").catch(() => {});
      await rm(profile, { recursive: true, force: true });
    },
  };
}

async function poll(read, accept, label, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await read();
    if (accept(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${label} timed out; last value ${JSON.stringify(last)}`);
}


// Synthetic bindings exercise browser bytes only; this is not chain authentication.
test('default Brotli/Base90 COPY survives both escaped data URI layers in Chrome and blocks a changed payload', { timeout: 60000 }, async () => {
  const source = Buffer.from('<!doctype html><p>Hello🔥%#</p><script>top.postMessage({tag:"keel-brotli-byte-proof",value:"Hello🔥%#"},"*")</script>' + '<!--compressed-->' .repeat(100));
  const payload = prepareKeelDensePayload(source);
  assert.equal(payload.compression, 'brotli');
  const store = address('11'), objectId = hash('22');
  const binding = await buildKeelOnchainContainerBinding({ chainId: 11155111, store, objectId, compression: payload.compression, bytes: source, storedBytes: payload.compressedBytes });
  const pack = { containerId: binding.id, objectId, storedIntegrity: payload.storedIntegrity, storedDense: payload.storedDense };
  const table = Buffer.alloc(192); table.writeBigUInt64BE(32n, 24); table.writeBigUInt64BE(1n, 56); table.writeBigUInt64BE(BigInt(payload.compressedBytes.length), 88);
  Buffer.from(payload.storedIntegrity.digest.slice(2), 'hex').copy(table, 96); Buffer.from(objectId.slice(2), 'hex').copy(table, 128); Buffer.from(binding.id.slice(2), 'hex').copy(table, 160);
  const context = { protocol: 'keel-context@1', chainId: '11155111', collection: address('66'), tokenId: '1', derivedTokenSeed: hash('77'), seedRegistry: address('88'), seedSetId: hash('99'), seedSourceCollection: address('66'), seedSourceTokenId: '1', composerManager: address('aa'), composerModuleId: hash('bb'), composerAddress: address('cc'), composerRevision: '1', composerCodeHash: hash('dd'), containerTableHandle: hash('ee'), containerTableRevision: '1', containerTableObjectId: hash('ff'), containerTableDigest: sha(table), presentationDigest: hash('20'), presentationDigestType: 'keccak256:keel.evm-prepared-fragment-presentation@1' };
  const shell = await buildKeelPreparedDenseCopyShell({ embeddedContainerDelivery: { chainId: 11155111, store }, context });
  const item = { id: 'fixture.html', aliases: ['fixture.html'], role: 'entrypoint', mediaType: 'text/html', integrity: payload.decodedIntegrity, onchain: { containerId: binding.id, offset: 0 }, containerBindings: [binding] };
  const html = altered => Buffer.from(shell.prefix).toString() + serializeKeelDenseTransportJSON(altered ? { ...pack, storedDense: (pack.storedDense[0] === 'A' ? 'B' : 'A') + pack.storedDense.slice(1) } : pack) + Buffer.from(shell.containerBridge).toString() + ',' + serializeKeelDenseTransportJSON(item) + Buffer.from(shell.suffix).toString();
  const uris = await Promise.all([false, true].map(async altered => {
    const animation = toKeelDenseTransportDataURL('html', html(altered));
    const metadataURI = toKeelDenseTransportDataURL('metadata', JSON.stringify({ animation_url: animation }));
    const metadata = await (await fetch(metadataURI)).json();
    assert.equal(await (await fetch(metadata.animation_url)).text(), html(altered));
    return metadata.animation_url;
  }));
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request.url); const uri = uris[request.url === '/changed' ? 1 : 0];
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end('<p id="proof">pending</p><script>addEventListener("message",e=>{if(e.data?.tag==="keel-brotli-byte-proof")document.getElementById("proof").textContent=e.data.value})</script><iframe src="' + uri.replaceAll('&', '&amp;').replaceAll('"', '&quot;') + '"></iframe>');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const browser = await launch(await chromePath());
    try {
      const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
      await browser.send('Page.enable', {}, sessionId);
      await browser.send('Runtime.enable', {}, sessionId);
      const problems = [], contexts = new Map();
      browser.on(message => { if (message.method === 'Runtime.executionContextCreated') contexts.set(message.sessionId + ':' + message.params.context.id, {sessionId:message.sessionId, contextId:message.params.context.id}); if (message.method === 'Target.attachedToTarget') browser.send('Runtime.enable', {}, message.params.sessionId).catch(()=>{}); });
      await browser.send('Target.setAutoAttach', {autoAttach:true,waitForDebuggerOnStart:false,flatten:true}, sessionId);
      browser.on(message => { if (message.method === 'Runtime.exceptionThrown') problems.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text); });
      const origin = 'http://127.0.0.1:' + server.address().port;
      const read = async () => (await browser.send('Runtime.evaluate', { expression: 'document.getElementById("proof")?.textContent', returnByValue: true }, sessionId)).result.value;
      await browser.send('Page.navigate', { url: origin + '/valid' }, sessionId);
      try { await poll(read, value => value === 'Hello🔥%#', 'Brotli/Base90 artwork', 10000); } catch(error) { const snapshots=[]; for(const context of contexts.values()){try{const result=await browser.send('Runtime.evaluate',{contextId:context.contextId,expression:'JSON.stringify({url:location.protocol,status:document.getElementById("keel-status")?.textContent,body:document.body?.textContent.slice(0,300),crypto:!!crypto.subtle,context:!!globalThis.__KEEL_CONTEXT__,frames:document.querySelectorAll("iframe").length})',returnByValue:true},context.sessionId);snapshots.push(result.result.value);}catch{}} throw new Error(error.message+'; '+JSON.stringify({problems,snapshots})); }
      await browser.send('Page.navigate', { url: origin + '/changed' }, sessionId);
      await new Promise(resolve => setTimeout(resolve, 2500));
      assert.equal(await read(), 'pending');
    } finally { await browser.close(); }
    assert.ok(requests.every(path => ['/valid', '/changed', '/favicon.ico'].includes(path)), 'No resource RPC or follow-up asset fetch');
  } finally { await new Promise(resolve => server.close(resolve)); }
});
