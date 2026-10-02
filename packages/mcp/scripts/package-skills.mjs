import { cp, mkdir, readFile } from 'node:fs/promises';
const source = new URL('../../../skills/keel-sdk-mcp/', import.meta.url);
const destination = new URL('../dist/skills/keel-sdk-mcp/', import.meta.url);
// Distribute the same instructions used locally, not a second maintained copy.
const skill = await readFile(new URL('SKILL.md', source), 'utf8');
if (!skill.includes('name: keel-sdk-mcp')) throw new Error('KEEL SDK/MCP skill missing');
await mkdir(destination, {recursive:true});
await cp(source, destination, {recursive:true});

// The contract-workflow preflight reads KEEL's own standards docs from the package, so a target repository that
// does not vendor docs/KEEL_*.md still gets them read and digested (not reported "unavailable").
const docsSource = new URL('../../../docs/', import.meta.url);
const docsDestination = new URL('../dist/docs/', import.meta.url);
await mkdir(docsDestination, {recursive:true});
for (const name of ['ARCHITECTURE.md', 'KEEL_CONTRACTS.md', 'KEEL_MODULES.md', 'KEEL_PRESENTATION.md', 'KEEL_VERIFICATION_SHELL.md', 'INLINE_RECORD.md', 'CONTENT_SYSTEM_STATUS.md', 'PROOF_MARKET_PACKING.md']) {
  try { await cp(new URL(name, docsSource), new URL(name, docsDestination)); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; }
}
