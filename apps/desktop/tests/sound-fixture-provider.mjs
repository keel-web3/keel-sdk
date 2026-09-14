// Native UI acceptance only (electron-sound.cjs): a keyless "assistant" that
// drives the Sound tab's agent tools the way a model would. Never part of the
// production build.
export async function runAgentProvider({ chat, messages, tools, onText }) {
  const prompt = messages.at(-1).content;
  const invoke = async (name, input) => JSON.parse(await tools.find((t) => t.name === name).invoke(input));
  if (prompt.includes('Score the race')) {
    const state = await invoke('keel_game_sound_state', { projectId: chat.projectId });
    if (!state.catalogue.bands.length) throw Error('The composer catalogue is missing.');
    const added = await invoke('keel_game_music', { projectId: chat.projectId, action: 'add', id: 'race', title: 'Race theme', energy: 0.9, darkness: 0.3, tempo: 96, kit: 'boombap', assign: [{ kind: 'race', name: 'final-lap' }] });
    const heard = await invoke('keel_game_music', { projectId: chat.projectId, action: 'audition', id: 'race', intensity: 0.85 });
    const fx = await invoke('keel_game_sfx', { projectId: chat.projectId, events: [{ event: 'boostStart', sound: 'railStart' }], audition: 'railStart' });
    onText(`Scored the race: ${added.summary.key} ${added.summary.mode} at ${added.summary.bpm} bpm, ${added.sizes.bytes} bytes (${added.sizes.json} as JSON). Audition ${heard.report.reported ? (heard.report.playing ? 'playing' : 'not playing') : 'unreported'} (${heard.report.context}); boostStart plays ${fx.sfx.events.boostStart}.`);
  } else if (prompt.includes('Replace the race')) {
    const card = await invoke('keel_game_music', { projectId: chat.projectId, action: 'add', id: 'race', energy: 0.1, darkness: 0.9 });
    onText(card.status === 'awaiting-creator' ? `That replaces the race music, so it's on a review card: ${card.destructive.map((d) => d.why).join('; ')}.` : 'Replaced.');
  } else onText('I score games with the sound tools.');
  return { text: '' };
}
