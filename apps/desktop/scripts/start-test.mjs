import { spawn } from 'node:child_process';
import { mkdir, access, readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import electron from 'electron';
import { WorkspaceStore, newProject } from '../src/workspace.mjs';
import { createTrackedContract } from '@keel/sdk/contract-controls';
import { startPracticeServices, PRACTICE_ABI, PRACTICE_ACCOUNT, PRACTICE_CONTRACT, PRACTICE_CHAIN } from './practice-services.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = path.join(root, 'artifacts', 'manual-test-workspace');
await access(path.join(root, 'dist', 'main.cjs')).catch(() => { throw new Error('Build the editor first with pnpm desktop:build.'); });
await mkdir(directory, { recursive: true, mode: 0o700 });
const sessionPath = path.join(directory, 'practice-session.json');
let running;
try {
  const value = JSON.parse(await readFile(sessionPath, 'utf8'));
  if (Number.isSafeInteger(value.pid) && value.pid > 0 && typeof value.url === 'string' && /^http:\/\/127\.0\.0\.1:\d+$/.test(value.url)) { process.kill(value.pid, 0); running = value; }
} catch { /* An absent or stale supervisor can be replaced. */ }
if (running) {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(electron, ['.'], { cwd: root, env: { ...process.env, KEEL_DESKTOP_DATA_DIR: directory, KEEL_DESKTOP_PRACTICE_RPC: running.url }, stdio: 'inherit', shell: false });
    child.on('error', reject); child.on('exit', (code) => resolve(code ?? 1));
  });
  process.exit(code);
}
await rm(sessionPath, { force: true });
const services = await startPracticeServices();
try { await writeFile(sessionPath, JSON.stringify({ pid: process.pid, url: services.url }), { flag: 'wx', mode: 0o600 }); }
catch (error) { await services.close(); throw error; }
const store = new WorkspaceStore(path.join(directory, 'workspace.sqlite'));
const current = store.read();
if (current.revision === 0 && current.state.projects.length === 0) {
  const project = newProject('Signal Garden · practice');
  project.notes = 'Local practice project. Move the pointer across the preview. Edit the title or colors, save, then try workspace export/import in Connections. No wallet is needed.';
  project.files[0].content = '<!doctype html>\n<html><head><meta charset="utf-8"><style>body{margin:0;background:#090b13;color:#e9eaff;font:14px system-ui;overflow:hidden}canvas{position:absolute;inset:0;width:100%;height:100%}main{position:absolute;left:28px;bottom:24px;pointer-events:none}h1{font:36px Georgia;margin:0 0 8px}p{color:#9aa8d5;margin:0}</style></head><body><canvas></canvas><main><h1>Signal Garden</h1><p>Move the pointer. Make it yours.</p></main><script type="module" src="./garden.js"></script></body></html>';
  project.files.push({ id: crypto.randomUUID(), name: 'garden.js', type: 'text/javascript', content: 'const canvas = document.querySelector("canvas");\nconst ctx = canvas.getContext("2d");\nlet pointer = { x: 0.5, y: 0.5 };\naddEventListener("pointermove", event => { pointer = { x: event.clientX / innerWidth, y: event.clientY / innerHeight }; });\nfunction draw(time) {\n  canvas.width = innerWidth * devicePixelRatio; canvas.height = innerHeight * devicePixelRatio;\n  ctx.scale(devicePixelRatio, devicePixelRatio);\n  ctx.fillStyle = "#090b13"; ctx.fillRect(0, 0, innerWidth, innerHeight);\n  for (let i = 0; i < 72; i++) {\n    const angle = i * 2.39996 + time * 0.00012;\n    const radius = Math.sqrt(i) * Math.min(innerWidth, innerHeight) * 0.034;\n    const x = innerWidth * 0.5 + Math.cos(angle) * radius + (pointer.x - 0.5) * 42;\n    const y = innerHeight * 0.45 + Math.sin(angle) * radius + (pointer.y - 0.5) * 42;\n    ctx.fillStyle = `hsla(${220 + i * 0.8}, 85%, 75%, ${0.35 + (i % 5) * 0.12})`;\n    ctx.beginPath(); ctx.arc(x, y, 2 + Math.sin(time * 0.002 + i) * 1.5, 0, Math.PI * 2); ctx.fill();\n  }\n  requestAnimationFrame(draw);\n}\nrequestAnimationFrame(draw);' });
  store.save({ ...current.state, projects: [project], contracts: [createTrackedContract({ name: 'Practice / Demo controls', chainId: PRACTICE_CHAIN, address: PRACTICE_CONTRACT, kind: 'custom', source: 'manual', abi: PRACTICE_ABI, projectId: project.id, notes: 'KEEL practice fixture. This is simulated data for the separate test workspace, not a deployed contract. Use the practice RPC shown at the top of the editor.' })] }, current.revision);
}
store.db.exec('CREATE TABLE IF NOT EXISTS editor_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
const savedStudio = store.db.prepare("SELECT value FROM editor_settings WHERE key='studio-url'").get()?.value;
const lastFixture = store.db.prepare("SELECT value FROM editor_settings WHERE key='practice-studio'").get()?.value;
if (!savedStudio || savedStudio === lastFixture) store.db.prepare("INSERT INTO editor_settings VALUES ('studio-url', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(services.url);
store.db.prepare("INSERT INTO editor_settings VALUES ('practice-studio', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(services.url);
store.close();
console.log('Opening KEEL’s saved practice workspace, including any wallets installed in that workspace.');
const child = spawn(electron, ['.'], { cwd: root, env: { ...process.env, KEEL_DESKTOP_DATA_DIR: directory, KEEL_DESKTOP_PRACTICE_RPC: services.url }, stdio: 'inherit', shell: false });
const cleanup = async () => { await services.close(); await rm(sessionPath, { force: true }); };
child.on('error', async (error) => { console.error(error.message); await cleanup(); process.exitCode = 1; });
child.on('exit', async (code) => { await cleanup(); process.exitCode = code ?? 1; });
