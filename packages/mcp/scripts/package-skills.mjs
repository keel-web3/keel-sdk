import { cp, mkdir, readFile } from 'node:fs/promises';
const source = new URL('../../../skills/keel-sdk-mcp/', import.meta.url);
const destination = new URL('../dist/skills/keel-sdk-mcp/', import.meta.url);
// Distribute the same instructions used locally, not a second maintained copy.
const skill = await readFile(new URL('SKILL.md', source), 'utf8');
if (!skill.includes('name: keel-sdk-mcp')) throw new Error('KEEL SDK/MCP skill missing');
await mkdir(destination, {recursive:true});
await cp(source, destination, {recursive:true});
await cp(new URL("../../../skills/fray-keel-agent/", import.meta.url), new URL("../dist/skills/fray-keel-agent/", import.meta.url), { recursive: true });

// Bundle the exact documents referenced by the distributed skill.
const documents = [
  'KEEL_PREPARED_COPY_ASSEMBLY.md',
  'KEEL_INLINE_PAYLOAD_BOUNDARIES.md',
  'KEEL_PAYLOAD_STORAGE.md',
  'KEEL_BINARY_RESOURCE_DELIVERY.md',
  'KEEL_DENSE_TRANSPORT.md',
  'KEEL_PRESENTATION.md',
  'KEEL_OBJECT_STORAGE_FOR_CHEAP_READS.md',
];
const documentOutput = new URL('../dist/docs/', import.meta.url);
await mkdir(documentOutput, {recursive:true});
for (const document of documents) {
  await cp(new URL(`../../../docs/${document}`, import.meta.url), new URL(document, documentOutput));
}
