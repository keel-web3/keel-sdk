import { spawn } from 'node:child_process';
import electron from 'electron';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { mkdir, copyFile, cp } from 'node:fs/promises';
import { findEngine } from '../../../packages/game-engine/scripts/engine-source.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
// Exercise the same pinned release a fresh checkout uses, not only siblings.
const engine = findEngine();
if (engine.root && !process.env.KEEL_GAME_ENGINE_ROOT) process.env.KEEL_GAME_ENGINE_ROOT = engine.root;
const suite = ['electron-smoke.cjs', 'electron-restore.cjs', 'electron-wallet-bridge.cjs', 'electron-agents.cjs', 'electron-shared-runtime.cjs', 'electron-creation.cjs', 'electron-layers.cjs', 'electron-game.cjs', 'electron-builder.cjs', 'electron-sound.cjs', 'electron-level.cjs'];
const selected = process.argv.slice(2);
if (selected.some(file => ![...suite,'electron-gators.cjs','electron-gator-inline.cjs','electron-raster.cjs','electron-svg.cjs','electron-codec.cjs','electron-alpha.cjs'].includes(file))) throw Error('Choose an existing Electron test filename.');
await mkdir(root + 'artifacts', { recursive: true });
await build({ stdin: { contents: "export {WalletRuntime} from './src/wallet-runtime'; export {WalletBrowser} from './src/wallet-browser'; export {invokeWalletPage} from './src/wallet-bridge';", resolveDir: root, loader: 'ts' }, outfile: root + 'artifacts/wallet-test-runtime.cjs', bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
for (const asset of ['wallet-browser-preload.cjs','wallet-beacon.js']) await copyFile(root + 'dist/' + asset,root + 'artifacts/' + asset);
await mkdir(root+'artifacts/agent-native',{recursive:true});
await cp(root+'dist/runtime-modules',root+'artifacts/agent-native/runtime-modules',{recursive:true});
await build({entryPoints:[root+'src/main.ts'],outfile:root+'artifacts/agent-native/main.cjs',bundle:true,platform:'node',format:'cjs',external:['electron','node:sqlite','@keel/mcp','@keel/sdk/inline-viewer-graph','langchain','@langchain/*','@modelcontextprotocol/sdk/*'],plugins:[{name:'keyless-agent-fixture',setup(build){build.onResolve({filter:/^\.\/agent-providers\.mjs$/},()=>({path:root+'tests/agent-fixture-provider.mjs'}));}}]});
for(const asset of ['index.html','renderer.js','styles.css','preload.cjs','preview-worker.cjs','layer-image-worker.mjs','raster-prepare-worker.mjs','canonical-shell.json','StratusText-Regular.woff2','StratusTitle-Regular.woff2','wallet-browser-preload.cjs','wallet-beacon.js'])await copyFile(root+'dist/'+asset,root+'artifacts/agent-native/'+asset);

for (const file of selected.length ? selected : suite) {
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(electron, [fileURLToPath(new URL(file, import.meta.url))], { stdio: 'inherit', shell: false });
    child.on('error', reject); child.on('exit', (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) process.exit(exitCode);
}
