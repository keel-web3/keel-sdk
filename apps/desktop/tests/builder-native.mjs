// Builds the editor's main with the keyless builder fixture as its assistant
// provider, next to a copy of the built assets (artifacts/builder-native), for
// electron-builder.cjs. Run it with Node (or Electron as Node) after the build.
import { build } from 'esbuild';
import { copyFile, cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(root, 'artifacts', 'builder-native');
await mkdir(out, { recursive: true });
await build({ entryPoints: [path.join(root, 'src/main.ts')], outfile: path.join(out, 'main.cjs'), bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent', external: ['electron', 'node:sqlite', '@keel/mcp', '@keel/sdk/inline-viewer-graph', 'langchain', '@langchain/*', '@modelcontextprotocol/sdk/*'], plugins: [{ name: 'keyless-builder-fixture', setup(b) { b.onResolve({ filter: /^\.\/agent-providers\.mjs$/ }, () => ({ path: path.join(root, 'tests/builder-fixture-provider.mjs') })); } }] });
for (const asset of ['index.html', 'renderer.js', 'styles.css', 'preload.cjs', 'preview-worker.cjs', 'layer-image-worker.mjs', 'raster-prepare-worker.mjs', 'game-engine-worker.mjs', 'game-builder-worker.mjs', 'builder-preview.mjs', 'game-sound-worker.mjs', 'sound-preview.mjs', 'game-codec-worker.mjs', 'canonical-shell.json', 'StratusText-Regular.woff2', 'StratusTitle-Regular.woff2']) await copyFile(path.join(root, 'dist', asset), path.join(out, asset));
await cp(path.join(root, 'dist', 'runtime-modules'), path.join(out, 'runtime-modules'), { recursive: true });
console.log(path.join(out, 'main.cjs'));
