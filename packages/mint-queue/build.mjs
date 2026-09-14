import { mkdir, copyFile } from 'node:fs/promises';
// Keep the SDK implementation authoritative. This small distribution lets
// queue consumers avoid installing rendering and publication dependencies.
await mkdir(new URL('./dist/', import.meta.url), { recursive: true });
for (const [source, destination] of [['mint-queue.js', 'index.js'], ['mint-queue.d.ts', 'index.d.ts']]) {
  await copyFile(new URL(`../sdk/dist/${source}`, import.meta.url), new URL(`./dist/${destination}`, import.meta.url));
}
