// A project's game settings: which KEEL game-engine module it plays, and the
// token context its preview runs with. Shared by main, renderer and tests, so
// nothing here touches Node or the engine itself.
import { z } from 'zod';

/** Engine module ids are namespaced and lower-case: "games/hello", "packs/animals". */
export const GAME_MODULE_ID = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)+$/;
export const gameModuleId = z.string().max(160).regex(GAME_MODULE_ID, 'Use an engine module id such as games/hello.');
export const gameSettingsSchema = z.object({
  id: gameModuleId,
  /** Any text: a bytes32 hex is used as is, an integer is padded to bytes32, anything else is hashed. */
  seed: z.string().trim().max(128).optional(),
  /** Pixel scale handed to the game in its context. */
  pixels: z.number().int().min(1).max(64).optional(),
}).strict();

/** A game project: made from the Game template, or one that already names a game module. */
export const isGameProject = (project) => project?.creation?.template === 'game' || !!project?.game;

/** Plain field changes for project.game: an empty game id removes the setting. */
export function withGame(project, patch) {
  const next = { ...(project.game ?? {}), ...patch };
  for (const key of Object.keys(next)) if (next[key] === undefined || next[key] === '') delete next[key];
  if (!next.id) { const { game: _removed, ...rest } = project; return rest; }
  return { ...project, game: gameSettingsSchema.parse(next) };
}

/** The editor pages and tabs the game engine adds. */
export const GAME_PAGE = 'GameEngine';
export const GAME_TAB = 'Game';
