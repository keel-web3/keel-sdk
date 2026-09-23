import { cp, mkdir, readFile } from 'node:fs/promises';
const source = new URL('../../../skills/keel-sdk-mcp/', import.meta.url);
const destination = new URL('../dist/skills/keel-sdk-mcp/', import.meta.url);
// Distribute the same instructions used locally, not a second maintained copy.
const skill = await readFile(new URL('SKILL.md', source), 'utf8');
if (!skill.includes('name: keel-sdk-mcp')) throw new Error('KEEL SDK/MCP skill missing');
await mkdir(destination, {recursive:true});
await cp(source, destination, {recursive:true});
