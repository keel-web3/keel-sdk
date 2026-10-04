import { cp, mkdir } from 'node:fs/promises';
const output = new URL('../dist/docs/', import.meta.url);
await mkdir(output, { recursive: true });
for (const name of ['KEEL_PAYLOAD_STORAGE.md', 'KEEL_BINARY_RESOURCE_DELIVERY.md', 'KEEL_INLINE_PAYLOAD_BOUNDARIES.md']) {
  await cp(new URL(`../../../docs/${name}`, import.meta.url), new URL(name, output));
}
