// Add optional feature facades without deleting or rewriting existing engine
// entries. Safe to use in an SDK checkout with local work in other facades.
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { findEngine } from './engine-source.mjs';

const found = findEngine();
if (!found.root) throw Error('KEEL engine source checkout is unavailable');
const engineDir = resolve(import.meta.dirname, '../src/engine');
let added = 0;
const packages = [];
for (const group of ['packages', 'packs', 'ai', 'systems']) {
  let names;
  try { names = await readdir(resolve(found.root, group)); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  for (const part of names.sort()) {
    let pkg;
    try { pkg = JSON.parse(await readFile(resolve(found.root, group, part, 'package.json'), 'utf8')); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (pkg.name?.startsWith('@keel-engine/')) packages.push({ group, part, pkg });
  }
}
for (const { group, part, pkg } of packages) {
  const features = Object.keys(pkg.exports).filter(key => key !== '.' && key !== './module');
  for (const feature of features) {
    const names = feature.endsWith('/*')
      ? (await readdir(resolve(found.root, group, part, 'src', feature.slice(2, -2)))).filter(n => n.endsWith('.ts') && n !== 'index.ts').sort().map(n => feature.slice(2, -1) + n.slice(0, -3))
      : [feature.slice(2)];
    for (const name of names) {
      const file = resolve(engineDir, part, name + '.ts');
      const source = `// Optional KEEL feature facade (link-engine-features.mjs).\nexport * from "${pkg.name}/${name}";\n`;
      let existing;
      try { existing = await readFile(file, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (existing !== undefined) {
        if (existing !== source) throw Error(`Existing feature facade differs: ${part}/${name}; preserve it and reconcile explicitly`);
        continue;
      }
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, source); added++;
    }
  }
}
console.log(`Added ${added} optional engine feature facades.`);
