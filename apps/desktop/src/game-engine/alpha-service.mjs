// The editor's alpha-tester paths for games, main-process side: where a
// creator's game projects live, the pinned engine release (the fallback when
// there is no engine checkout), the practice chain the sandbox runs, getting
// the engine, and a diagnostics report a tester can paste into feedback.
// Nothing here loads engine code (that stays in the game-engine worker) and
// nothing here sends anything anywhere: diagnostics are copied by the tester.
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

/** Paths the alpha features use: the SDK checkout the editor runs from, and the editor's data folder. */
export function alphaPaths({ sdkRoot, userData }) {
  const pkgDir = path.join(sdkRoot, 'packages', 'game-engine');
  return {
    sdkRoot, pkgDir,
    gamesDir: path.join(userData, 'games'),
    chainDir: path.join(pkgDir, 'chain'),
    sandboxDir: path.resolve(process.env.KEEL_GAME_SANDBOX_DIR ?? path.join(pkgDir, '.sandbox')),
  };
}

/** The pinned engine release (packages/game-engine/engine.lock.json) and where `pnpm game:engine` clones it. */
export function engineLockOf(paths) {
  try {
    const lock = JSON.parse(readFileSync(path.join(paths.pkgDir, 'engine.lock.json'), 'utf8'));
    return { ...lock, onchain: Array.isArray(lock.onchain) ? lock.onchain : [], dir: lock.commit ? path.join(paths.pkgDir, '.engine', lock.commit) : null };
  } catch { return { repository: 'https://github.com/keel-web3/keel-engine', tag: null, commit: null, onchain: [], dir: null }; }
}

const readJSON = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };

async function rpc(url, method, params = []) {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(3000) });
  const body = await response.json();
  if (body.error) throw new Error(body.error.message);
  return body.result;
}

/**
 * The practice chain `pnpm game:sandbox` runs, from its records, checked live:
 * is the node up, and does it still hold the recorded KeelHold?
 */
export async function practiceChain(paths) {
  const dir = paths.sandboxDir;
  const deployment = readJSON(path.join(dir, 'deployment.json'));
  const sandbox = readJSON(path.join(dir, 'sandbox.json'));
  const release = readJSON(path.join(dir, 'engine-release.json'));
  const games = readJSON(path.join(dir, 'games.json'))?.games ?? [];
  const url = sandbox?.rpc ?? deployment?.rpc ?? null;
  let running = false; let reason = '';
  if (!deployment || !url) reason = 'No practice chain has been set up on this computer yet. Start one in a terminal: pnpm game:sandbox';
  else {
    try {
      const chainId = Number.parseInt(await rpc(url, 'eth_chainId'), 16);
      const code = await rpc(url, 'eth_getCode', [deployment.KeelHold, 'latest']);
      running = chainId === deployment.chainId && typeof code === 'string' && code.length > 2;
      if (!running) reason = `The node at ${url} doesn't hold the recorded KEEL contracts. Restart it: pnpm game:sandbox (or --reset to start over).`;
    } catch { reason = `The practice chain isn't running. Start it in a terminal: pnpm game:sandbox`; }
  }
  return {
    running, reason, dir, rpc: url, chainId: deployment?.chainId ?? 31337,
    KeelHold: deployment?.KeelHold ?? null, KeelRawTokenURIBuilder: deployment?.KeelRawTokenURIBuilder ?? null, account: deployment?.account ?? null,
    viewer: sandbox?.viewer ?? null,
    release: release ? { objects: release.objects.length, publishedAt: release.publishedAt, engineRoot: release.engine?.root ?? null, failed: release.failed ?? [] } : null,
    games,
  };
}

/** A ring of recent log lines (main process and game-engine errors), for diagnostics only. */
export class LogRing {
  constructor(size = 200) { this.size = size; this.lines = []; }
  push(level, parts) {
    const text = parts.map((part) => typeof part === 'string' ? part : part instanceof Error ? `${part.message}` : (() => { try { return JSON.stringify(part); } catch { return String(part); } })()).join(' ');
    // (Diagnostics are pasted into feedback: keep home paths and anything key-shaped out.)
    const clean = text.replace(/0x[0-9a-fA-F]{64}(?![0-9a-fA-F])/g, (hex) => `${hex.slice(0, 10)}…`).replace(/(sk-[A-Za-z0-9_-]{8})[A-Za-z0-9_-]+/g, '$1…').slice(0, 2000);
    this.lines.push(`${new Date().toISOString()} ${level} ${clean}`);
    if (this.lines.length > this.size) this.lines.splice(0, this.lines.length - this.size);
  }
  capture(target = console) {
    for (const level of ['log', 'warn', 'error']) {
      const original = target[level].bind(target);
      target[level] = (...parts) => { try { this.push(level, parts); } catch { /* never break logging */ } original(...parts); };
    }
    return this;
  }
  recent(count = 80) { return this.lines.slice(-count); }
}

/** Run `pnpm game:engine` (scripts/fetch-engine.mjs) with the editor's own Node, and return its output. */
export function fetchEngine(paths, { timeoutMs = 10 * 60_000 } = {}) {
  return new Promise((resolve) => {
    const script = path.join(paths.pkgDir, 'scripts', 'fetch-engine.mjs');
    if (!existsSync(script)) { resolve({ ok: false, output: `The SDK's engine fetcher is missing (${script}).` }); return; }
    const child = spawn(process.execPath, [script], { cwd: paths.sdkRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const add = (chunk) => { output = (output + chunk).slice(-20_000); };
    child.stdout.on('data', add); child.stderr.on('data', add);
    const timer = setTimeout(() => { child.kill(); add('\nTimed out.'); }, timeoutMs);
    child.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, output: output.trim() }); });
    child.on('error', (error) => { clearTimeout(timer); resolve({ ok: false, output: String(error.message) }); });
  });
}

/** Everything a tester's feedback needs to reproduce a problem, as one text block. Nothing is sent. */
export function diagnosticsText(report) {
  const lines = [
    '# KEEL editor diagnostics',
    `generated: ${new Date().toISOString()}`,
    '',
    '## versions',
    ...Object.entries(report.versions).map(([key, value]) => `${key}: ${value}`),
    '',
    '## game engine',
    ...Object.entries(report.engine).map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`),
    '',
    '## practice chain',
    ...Object.entries(report.practice).map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`),
    '',
    '## recent log',
    ...(report.log.length ? report.log : ['(empty)']),
  ];
  return lines.join('\n');
}
