// Builds the editor's main with the keyless sound fixture as its assistant
// provider, next to a copy of everything the desktop build made (dist/, so new
// workers and pages come along), for electron-sound.cjs. Run it with Node (or
// Electron as Node) after the build.
import { build } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(root, 'artifacts', 'sound-native');
await mkdir(out, { recursive: true });
await cp(path.join(root, 'dist'), out, { recursive: true, filter: (from) => !/main\.cjs(\.map)?$/.test(from) });
await build({ entryPoints: [path.join(root, 'src/main.ts')], outfile: path.join(out, 'main.cjs'), bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent', external: ['electron', 'node:sqlite', '@keel/mcp', '@keel/sdk/inline-viewer-graph', 'langchain', '@langchain/*', '@modelcontextprotocol/sdk/*'], plugins: [{ name: 'keyless-sound-fixture', setup(b) { b.onResolve({ filter: /^\.\/agent-providers\.mjs$/ }, () => ({ path: path.join(root, 'tests/sound-fixture-provider.mjs') })); } }] });
console.log(path.join(out, 'main.cjs'));
