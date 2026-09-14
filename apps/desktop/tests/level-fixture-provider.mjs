// Native UI acceptance only (electron-level.cjs): a keyless "assistant" that
// drives the Level tab's agent tools the way a model would. Never part of the
// production build.
export async function runAgentProvider({ chat, messages, tools, onText }) {
  const prompt = messages.at(-1).content;
  const invoke = async (name, input) => JSON.parse(await tools.find((t) => t.name === name).invoke(input));
  if (prompt.includes('Set up the camp')) {
    const state = await invoke('keel_game_level_state', { projectId: chat.projectId });
    const [w, d] = state.level.size;
    const T = state.level.recipe.tileSize ?? 2;
    const cx = Math.round(w * 0.62), cz = Math.round(d * 0.7);
    const at = (i, j) => [(i + 0.5) * T, 2, (j + 0.5) * T];
    const ops = [
      { op: 'biome', biome: 'savanna', path: [[cx - 10, cz], [cx + 10, cz]], radius: 5, stroke: 'camp' },
      { op: 'brush', mode: 'flatten', at: [cx, cz], radius: 4, stroke: 'camp' },
      { op: 'spawn', player: 0, at: [cx - 6, cz] }, { op: 'spawn', player: 1, at: [cx + 6, cz] },
      { op: 'resource', kind: 'mass', at: [cx - 8, cz + 2] }, { op: 'resource', kind: 'mass', at: [cx + 8, cz + 2] }, { op: 'resource', kind: 'crystal', at: [cx, cz - 5] },
      { op: 'place', id: 'watchtower', pack: 'packs/buildings', object: 'tower', pos: at(cx, cz + 4), tier: 'foreground', layer: 'buildings' },
      { op: 'place', id: 'camp-hut', pack: 'packs/buildings', object: 'cottage', pos: at(cx - 3, cz - 3), yaw: 0.6, tier: 'foreground', layer: 'buildings' },
      { op: 'place', pack: 'packs/foliage', object: 'palm', pos: at(cx + 4, cz - 3) },
      { op: 'marker', id: 'relic', kind: 'relic', pos: at(cx, cz) },
    ];
    const r = await invoke('keel_game_level_ops', { projectId: chat.projectId, ops });
    if (!r.ok) throw Error(r.errors.map((e) => e.message).join(' '));
    onText(`Set up the camp: ${r.applied} ops, ${r.level.spawns.length} spawns, ${r.level.counts.resources} resources, the watchtower placed; fairness ${r.level.fairness ? (r.level.fairness.pass ? 'passes' : `not yet (${r.level.fairness.worst.metric})`) : 'n/a'}.`);
  } else if (prompt.includes('Remove the watchtower')) {
    const card = await invoke('keel_game_level_ops', { projectId: chat.projectId, ops: [{ op: 'remove', id: 'watchtower' }] });
    onText(card.status === 'awaiting-creator' ? `That removes something the level has, so it's on a review card: ${card.destructive.map((d) => d.why).join('; ')}.` : 'Removed.');
  } else onText('I build levels with the level tools.');
  return { text: '' };
}
