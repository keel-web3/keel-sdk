import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildKeelAudioInlineModuleFragments,
  buildKeelInlineLocalDocument,
  buildKeelInlineShellFragments,
  loadKeelAudioModuleBytes,
} from "../packages/sdk/dist/index.js";

async function headlessChrome() {
  if (process.env.KEEL_CHROME_HEADLESS_SHELL) return process.env.KEEL_CHROME_HEADLESS_SHELL;
  const cache = join(homedir(), "Library/Caches/ms-playwright");
  const entries = await readdir(cache, { withFileTypes: true });
  const candidate = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("chromium_headless_shell-"))
    .sort((left, right) => right.name.localeCompare(left.name))
    .map((entry) => join(cache, entry.name, "chrome-headless-shell-mac-arm64", "chrome-headless-shell"))[0];
  if (candidate === undefined || !(await stat(candidate)).isFile()) {
    throw new Error("A Chrome headless shell is required for the KEEL audio browser harness. Set KEEL_CHROME_HEADLESS_SHELL.");
  }
  return candidate;
}

// The artwork: Tone + keel-audio arrive as shared classic modules; this is the only creator code.
const SCORE = `
KEEL_AUDIO.configure({ id: "browser-proof" });
let started = 0;
let repeats = 0;
KEEL_AUDIO.onStart(({ Tone }) => {
  started++;
  const synth = new Tone.PolySynth(Tone.FMSynth).toDestination();
  Tone.getTransport().scheduleRepeat((time) => (repeats++, synth.triggerAttackRelease(["D3", "F3", "A3"], 0.2, time)), 0.25);
  Tone.getTransport().start();
});
const mounted = KEEL_AUDIO.mountButton(document.body, { corner: "none" });
Object.assign(mounted.element.style, { position: "fixed", left: "0", top: "0", width: "100vw", height: "100vh", borderRadius: "0" });
const storage = (() => { try { localStorage.getItem("x"); return "available"; } catch (error) { return error.name; } })();
globalThis.__keelAudioProbe = () => ({
  tone: typeof Tone === "object" ? Tone.version : null,
  state: KEEL_AUDIO.state,
  contextState: KEEL_AUDIO.ctx.state,
  sharedContext: Tone.getContext().rawContext === KEEL_AUDIO.ctx,
  clockSource: Tone.getContext().clockSource,
  label: mounted.element.getAttribute("aria-label"),
  started,
  repeats,
  storage,
});
`;

async function artworkServer() {
  const [shell, bytes] = await Promise.all([
    buildKeelInlineShellFragments({ repositoryRoot: process.cwd() }),
    loadKeelAudioModuleBytes({ repositoryRoot: process.cwd() }),
  ]);
  const local = await buildKeelInlineLocalDocument({
    shell,
    modules: await buildKeelAudioInlineModuleFragments(bytes),
    entry: { id: "score.js", mediaType: "text/javascript", source: new TextEncoder().encode(SCORE) },
  });
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(local.rootBytes);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

/** Minimal flat-session CDP client over Node's built-in WebSocket. */
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

/** Opens `url`, instruments every frame (in or out of process), and exposes the art probe and a real mouse click. */
async function openArtwork(browser, url) {
  const contexts = new Map();
  const problems = [];
  browser.on((message) => {
    const { method, params, sessionId } = message;
    if (method === "Runtime.executionContextCreated") contexts.set(`${sessionId}:${params.context.id}`, { sessionId, contextId: params.context.id });
    if (method === "Runtime.executionContextDestroyed") contexts.delete(`${sessionId}:${params.executionContextId}`);
    if (method === "Runtime.exceptionThrown") problems.push(params.exceptionDetails.exception?.description ?? params.exceptionDetails.text);
    if (method === "Log.entryAdded" && /Content Security Policy|Refused to/iu.test(params.entry.text)) problems.push(params.entry.text);
    if (method === "Target.attachedToTarget") {
      const child = params.sessionId;
      // Sandboxed art frames may run out of process; instrument them too.
      void Promise.all([
        browser.send("Runtime.enable", {}, child),
        browser.send("Log.enable", {}, child),
        browser.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, child),
      ]).then(() => browser.send("Runtime.runIfWaitingForDebugger", {}, child)).catch(() => {});
    }
  });
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
  await Promise.all([
    browser.send("Runtime.enable", {}, sessionId),
    browser.send("Log.enable", {}, sessionId),
    browser.send("Page.enable", {}, sessionId),
    browser.send("Emulation.setDeviceMetricsOverride", { width: 800, height: 600, deviceScaleFactor: 1, mobile: false }, sessionId),
    browser.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sessionId),
  ]);
  await browser.send("Page.navigate", { url }, sessionId);
  const probe = async (expression = "JSON.stringify(__keelAudioProbe())") => {
    for (const context of [...contexts.values()]) {
      try {
        const result = await browser.send("Runtime.evaluate", {
          expression: `typeof __keelAudioProbe === 'function' ? (${expression}) : null`,
          contextId: context.contextId,
          returnByValue: true,
        }, context.sessionId);
        if (typeof result.result?.value === "string") return JSON.parse(result.result.value);
      } catch { /* a context that went away */ }
    }
    return null;
  };
  const frame = async () => {
    const result = await browser.send("Runtime.evaluate", {
      expression: "(() => { const f = document.querySelector('iframe'); const r = f.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2, sandbox: f.getAttribute('sandbox'), allow: f.getAttribute('allow') }); })()",
      returnByValue: true,
    }, sessionId);
    return JSON.parse(result.result.value);
  };
  const click = async (point) => {
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
      await browser.send("Input.dispatchMouseEvent", { type, x: point.x, y: point.y, button: "left", clickCount: type === "mouseMoved" ? 0 : 1 }, sessionId);
    }
  };
  return { probe, frame, click, problems };
}

async function assertGestureOnlyStart(page) {
  const before = await poll(page.probe, (value) => value !== null, "art frame with keel-audio");
  assert.equal(before.tone, "15.1.22");
  assert.equal(before.state, "off");
  assert.equal(before.contextState, "suspended", "no audio before a gesture");
  assert.equal(before.sharedContext, true, "keel-audio adopted Tone's context");
  assert.equal(before.label, "Turn sound on");
  assert.equal(before.started, 0);
  assert.equal(before.storage, "SecurityError", "the opaque-origin frame throws on storage and keel-audio survives it");

  // A script-dispatched click is untrusted: it must not start audio.
  await page.probe("(document.querySelector('[data-keel-audio-button]').click(), 'clicked')");
  await new Promise((resolve) => setTimeout(resolve, 300));
  const synthetic = await page.probe();
  assert.equal(synthetic.state, "off");
  assert.equal(synthetic.contextState, "suspended");

  const point = await page.frame();
  await page.click(point);
  const after = await poll(page.probe, (value) => value?.state === "playing" && value.contextState === "running", "sound after a real click");
  assert.equal(after.started, 1);
  assert.equal(after.label, "Turn sound off");
  const ticking = await poll(page.probe, (value) => value?.repeats >= 2, "Tone transport ticking inside the art frame CSP");
  assert.equal(ticking.started, 1);
  return { point, after: ticking };
}

test("Tone + keel-audio load inside the compact Inline shell CSP and a real click in the art frame starts sound", { timeout: 60_000 }, async () => {
  const [binary, artwork] = await Promise.all([headlessChrome(), artworkServer()]);
  const browser = await launch(binary);
  try {
    const page = await openArtwork(browser, artwork.url);
    const { point, after } = await assertGestureOnlyStart(page);
    assert.equal(point.sandbox, "allow-scripts allow-pointer-lock");
    assert.equal(point.allow, null, "the compact shell delegates no autoplay");
    assert.equal(after.clockSource, "worker", "the compact shell CSP lets Tone's blob-worker clock run");
    assert.deepEqual(page.problems, []);
  } finally {
    await browser.close();
    await artwork.close();
  }
});

// The reference viewer (packages/viewer/src/sandbox.ts) sends `worker-src 'none'`.
// Chrome still constructs a blocked Worker and only fires `error`, so Tone's
// Transport would never tick; keel-audio's probe must move Tone to its timer clock.
const VIEWER_CSP = "default-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none'; child-src 'none'; manifest-src 'none'; connect-src blob:; worker-src 'none'; script-src 'unsafe-inline' data: blob:; style-src 'unsafe-inline' data: blob:; img-src data: blob:; media-src data: blob:; font-src data: blob:";

test("under the reference viewer's worker-src 'none' CSP, keel-audio falls Tone back to its timer clock and the score still ticks", { timeout: 60_000 }, async () => {
  const [binary, bytes] = await Promise.all([headlessChrome(), loadKeelAudioModuleBytes({ repositoryRoot: process.cwd() })]);
  const decoder = new TextDecoder();
  const art = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>${decoder.decode(bytes.tone)}</script><script>${decoder.decode(bytes.audio)}</script><script>${SCORE}</script></body></html>`;
  const server = createServer((request, response) => {
    response.setHeader("content-type", "text/html; charset=utf-8");
    if (request.url === "/art") {
      response.setHeader("Content-Security-Policy", VIEWER_CSP);
      response.end(art);
    } else {
      response.end('<!doctype html><html><body style="margin:0"><iframe sandbox="allow-scripts" src="/art" style="border:0;width:800px;height:600px"></iframe></body></html>');
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const browser = await launch(binary);
  try {
    const page = await openArtwork(browser, `http://127.0.0.1:${server.address().port}/`);
    const { after } = await assertGestureOnlyStart(page);
    assert.equal(after.clockSource, "timeout");
    // The only CSP reports are the blocked blob workers (Tone's own and keel-audio's probe).
    assert.ok(page.problems.every((problem) => /worker/iu.test(problem)), page.problems.join("\n"));
  } finally {
    await browser.close();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
