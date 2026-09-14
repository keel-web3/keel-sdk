// Native UI acceptance only (electron-builder.cjs): a keyless "assistant" that
// drives the builder's agent tools the way a model would. Never part of the
// production build.
const HUT = [
  { op: 'unit', metres: 0.12 }, { op: 'symmetry', mode: 'x' },
  ...Array.from({ length: 7 }, (_, y) => ({ op: 'box', from: [0, y, -4], to: [5, y, 4], role: y % 3 === 2 ? 'trim' : 'primary', hollow: true })),
  ...Array.from({ length: 4 }, (_, k) => ({ op: 'box', from: [0, 7 + k, -5 + k], to: [6 - k, 7 + k, 5 - k], role: 'secondary' })),
  { op: 'symmetry', mode: 'none' },
  { op: 'box', from: [-1, 0, 4], to: [0, 3, 4], role: 'dark' }, { op: 'group', name: 'door', from: [-1, 0, 4], to: [0, 3, 4] },
  { op: 'animate', group: 'door', motion: 'hinge' },
  ...Array.from({ length: 12 }, (_, i) => ({ op: 'set', at: [-7 + i, 0, 7], role: i % 2 ? 'accent' : 'trim' })),
  { op: 'sphere', center: [4, 12, 0], radius: 1.5, role: 'glow' },
  { op: 'look', role: 'primary', colour: [0.7, 0.06, 70] }, { op: 'look', role: 'secondary', colour: [0.48, 0.12, 30] },
  { op: 'target', as: 'object', id: 'hut' },
];

export async function runAgentProvider({ chat, messages, tools, onText }) {
  const prompt = messages.at(-1).content;
  const invoke = async (name, input) => JSON.parse(await tools.find((t) => t.name === name).invoke(input));
  if (prompt.includes('Build a hut')) {
    const state = await invoke('keel_game_build_state', { projectId: chat.projectId, reference: true });
    if (!state.opReference.includes('`box`')) throw Error('The op reference is missing.');
    const done = await invoke('keel_game_build_ops', { projectId: chat.projectId, ops: HUT, summary: 'A hut with a swinging door' });
    onText(`Built the hut: ${done.applied} ops, ${done.state.model.count} voxels.`);
  } else if (prompt.includes('Generate a critter')) {
    const card = await invoke('keel_game_generate', { projectId: chat.projectId, kind: 'critter', seed: '9', plan: 'quadruped', then: [{ op: 'rig', as: 'quadruped' }] });
    onText(card.status === 'awaiting-creator' ? `That replaces the hut, so it's on a review card: ${card.destructive.map((d) => d.why).join('; ')}.` : 'Generated.');
  } else if (prompt.startsWith('Import ')) {
    const objectId = /[a-f0-9]{64}/.exec(prompt)[0];
    const r = await invoke('keel_game_import', { projectId: chat.projectId, objectId, voxels: 32 });
    onText(`Imported ${r.name}: ${r.kind}, ${r.parts.length} parts${r.worn.length ? `, wearing ${r.worn.map((w) => `${w.part} on ${w.slot}`).join(', ')}` : ''}. ${r.opened.status === 'awaiting-creator' ? 'Opening it is on a review card.' : 'It drew into the build.'}`);
  } else onText('I build with the builder tools.');
  return { text: '' };
}
