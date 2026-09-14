// Agent tool for the codec inspector: read any codec document -- pasted text
// (KC1:, hex, base64), a Files object, or a record in a Game project's files
// (music and sfx in sound/sound.json, KC1: voxels in pack files, a build's op
// list packed as stored) -- field by field: its schema, sizes, what's big, the
// tree with each field's bits, the JSON view, and a Solidity decoder when the
// layout is fixed. Read-only: nothing is written, deployed or signed.
import { z } from 'zod';
import { codecSourcesOf } from './codec-project.mjs';

const uuid = z.string().uuid();
const RESULT_BUDGET = 80_000;
// (safeContext cuts every string at 16,000 characters: long texts are cut here first, and say so.)
const cut = (text, n) => (text.length > n ? { text: text.slice(0, n), truncated: true, characters: text.length } : { text, truncated: false, characters: text.length });

function treeLines(node, out, depth = 0) {
  const value = node.value !== undefined ? ` = ${node.value}` : '';
  out.push(`${'  '.repeat(depth)}${node.label || '(root)'} : ${node.type}${value} [${node.bits}b @${node.bit}]${node.note ? ` (${node.note})` : ''}`);
  for (const child of node.children ?? []) treeLines(child, out, depth + 1);
  return out;
}

export function registerGameCodecTools({ register, project, access, hooks, workspace }) {
  const codec = hooks.gameCodec;
  if (!codec) return;
  const ready = () => { access(); const status = codec.status(); if (!status.available) throw Error(status.reason); return codec; };

  register('keel_game_codec_explain', 'Inspect a KEEL bit-codec document (the packed form engine objects, looks, levels, music, sfx, voxels and builder op lists are stored in) field by field: its schema (name@version, id, where it resolved from), sizes (bytes, gzip, JSON, JSON+gzip), what costs the most bits, the value tree with each field\'s type, value and bits, the editable JSON view, and optionally a Solidity decoder (fixed-layout schemas only; otherwise the refusal names the field). Give one of: text (KC1: voxel text, 0x hex, or base64), objectId (a Files object), or file (+ record) in a project -- sound/sound.json records are music:<id> and sfx, pack files hold kc1:<n>, builds/<name>.build.json is ops (packed as stored). Call with only projectId, or list: true, to list a project\'s codec records. A bare body (no 0xB1/0xB2 header) needs schema. Read-only.', z.object({
    text: z.string().min(1).max(48_000_000).optional().describe('KC1: text, 0x hex or base64 of a codec document'),
    objectId: z.string().regex(/^[a-f0-9]{64}$/).optional().describe('A Files object id'),
    projectId: uuid.optional().describe('The project (default: this chat\'s project)'),
    file: z.string().min(1).max(300).optional().describe('A project file name, e.g. sound/sound.json or builds/main.build.json'),
    record: z.string().max(200).optional().describe('The record in that file: music:<id>, sfx, kc1:<n>, ops or document'),
    schema: z.string().max(200).optional().describe('Schema for a bare body: an id, short id or name@version'),
    maxNodes: z.number().int().min(16).max(2000).default(400),
    solidity: z.boolean().default(false),
    list: z.boolean().default(false),
  }).strict(), async (input) => {
    const c = ready();
    const sources = [input.text, input.objectId, input.file].filter((item) => item !== undefined).length;
    if (input.list || !sources) {
      const p = project(input.projectId);
      const records = codecSourcesOf(p);
      return { projectId: p.id, records, hint: records.length ? 'Inspect one with file and record.' : 'This project holds no codec records yet (sound/sound.json, KC1: voxels in pack files, or builds/*.build.json).' };
    }
    if (sources > 1) throw Error('Inspect one thing at a time: text, objectId, or file.');
    const context = input.file ? { project: project(input.projectId) } : { store: workspace };
    const x = await c.explain({ ...(input.text !== undefined ? { text: input.text } : {}), ...(input.objectId ? { objectId: input.objectId } : {}), ...(input.file ? { file: input.file, record: input.record, projectId: input.projectId } : {}), ...(input.schema ? { schema: input.schema } : {}), maxNodes: input.maxNodes, maxHexBytes: 0 }, context);
    const out = {
      source: x.source, schema: x.schema, header: x.header, bytes: x.bytes, sizes: x.sizes, ...(x.check ? { warning: x.check } : {}),
      costs: x.costs.slice(0, 16).map((item) => ({ path: item.path, bits: item.bits, count: item.count })),
      tree: treeLines(x.tree, []), treeNodes: x.nodes,
      json: x.json !== null ? cut(x.json, 12_000) : { text: '', truncated: true, note: x.jsonTooLarge ? 'The JSON view is over 500 KB: too large to show or edit here.' : 'No JSON view.' },
      solidity: x.solidity,
    };
    if (input.solidity) {
      const sol = await c.solidity(x.schema.id);
      out.solidity = sol.ok ? { available: true, code: cut(sol.code, 15_000) } : { available: false, reason: sol.reason };
    }
    // (The tool result stays well under the 90 KB limit: the tree gives way first, then the JSON view.)
    while (JSON.stringify(out).length > RESULT_BUDGET && out.tree.length > 8) { const keep = Math.floor(out.tree.length / 2); out.tree = [...out.tree.slice(0, keep), `… ${out.tree.length - keep} more lines (ask with a smaller maxNodes, or read the JSON view)`]; }
    if (JSON.stringify(out).length > RESULT_BUDGET && out.json.text) out.json = { ...cut(out.json.text, 4_000), truncated: true };
    return out;
  });
}
