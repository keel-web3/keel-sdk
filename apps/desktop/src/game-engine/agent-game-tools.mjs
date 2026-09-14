// Agent tools for the KEEL pixel-art game engine. They read the local engine
// checkout (modules, pack contents, fits, graphs, sizes) and propose one kind
// of change: which game a project plays, as a project-edit review card the
// creator applies. Nothing here publishes or signs.
import { z } from 'zod';
import { gameModuleId, isGameProject, withGame } from './game-project.mjs';
import { projectSchema } from '../workspace.mjs';

const KINDS = ['runtime', 'pack', 'system', 'ai', 'game', 'map'];
const assetRef = z.object({ pack: gameModuleId.describe('The pack module id, e.g. packs/hello'), id: z.string().max(80).regex(/^[a-z0-9][a-z0-9-]*$/).describe('The entity or attribute id inside that pack') }).strict();
const uuid = z.string().uuid();
const includes = (value, term) => JSON.stringify(value).toLowerCase().includes(term);

export function registerGameEngineTools({ register, project, canEdit, access, action, hooks, digest }) {
  const engine = hooks.game;
  if (!engine) return;
  const ready = () => { access(); const status = engine.status(); if (!status.available) throw Error(status.reason); return engine; };

  register('keel_game_modules', 'List the KEEL pixel-art game engine\'s modules (engine parts, packs, systems, AI, games, maps) with what each needs and provides, and every pack\'s contents: entities with their body contract and sample sockets, attributes with their slot and the bodies and packs they target. Filter by kind, text, tag, attribute slot or body contract. Reads the local engine checkout only.', z.object({
    kind: z.enum(KINDS).optional(), query: z.string().max(160).default(''), tag: z.string().max(60).optional(), slot: z.string().max(60).optional(), body: z.string().max(120).optional().describe('A body contract prefix such as body/quadruped'),
  }).strict(), async ({ kind, query, tag, slot, body }) => {
    const { root, modules } = await ready().modules();
    const term = query.trim().toLowerCase(); const assetFilter = !!(tag || slot || body);
    const keepEntity = (e) => (!tag || e.tags.includes(tag)) && (!body || e.body.startsWith(body)) && !slot;
    const keepAttribute = (a) => (!tag || a.tags.includes(tag)) && (!slot || a.slot === slot) && (!body || a.targets.some((t) => t.body.startsWith(body)));
    const out = [];
    for (const item of modules) {
      if (kind && item.kind !== kind) continue;
      const pack = item.pack ? { entities: item.pack.entities.filter(keepEntity).filter((e) => !term || includes(e, term) || includes(item.id, term)), attributes: item.pack.attributes.filter(keepAttribute).filter((a) => !term || includes(a, term) || includes(item.id, term)) } : undefined;
      const assetHit = pack && (pack.entities.length || pack.attributes.length);
      if (assetFilter && !assetHit) continue;
      if (term && !assetHit && !includes({ ...item, pack: undefined }, term)) continue;
      const { dir: _dir, packageName: _packageName, contents: _contents, ...summary } = item;
      out.push({ ...summary, ...(pack ? { pack } : {}) });
    }
    return { engineRoot: root, count: out.length, modules: out, hint: 'Check a specific pairing with keel_game_check_fit; see what a game loads with keel_game_graph.' };
  });

  register('keel_game_find_asset', 'Find entities or attributes in the engine\'s packs from a plain description, e.g. "a hat that fits a dog": words before fits/for/on describe the asset, words after name the wearer, and attributes are kept only where fits() allows them on a matching entity. Or pass fitsEntity for an exact wearer.', z.object({
    query: z.string().min(1).max(200), kind: z.enum(['any', 'entity', 'attribute']).default('any'), slot: z.string().max(60).optional(), body: z.string().max(120).optional(), tag: z.string().max(60).optional(), fitsEntity: assetRef.optional(), limit: z.number().int().min(1).max(50).default(20),
  }).strict(), (input) => ready().find(input));

  register('keel_game_check_fit', 'Check whether an attribute from one pack may go on an entity from another (the engine\'s fits() rule: matching body contract, and the same pack, a pack the target names, or packs that declare each other compatible). Returns the verdict and its reason.', z.object({ attribute: assetRef, entity: assetRef }).strict(), ({ attribute, entity }) => ready().fit(attribute, entity));

  register('keel_game_graph', 'Resolve the modules a game needs, all the way down (by id and by contract), in the order KEEL starts them, with phase and weight, each need and what satisfied it, and any problems (missing, version, contract, cycle).', z.object({ gameId: gameModuleId }).strict(), ({ gameId }) => ready().graph(gameId));

  register('keel_game_build', 'Build a game as the local KEEL document (the exact bytes the sandbox and the chain run) and report its size: each module raw and as stored (gzip), the whole document, the new upload versus shared engine modules, and the complete viewer read. Local only; nothing is published.', z.object({ gameId: gameModuleId }).strict(), async ({ gameId }) => {
    const report = await ready().report(gameId);
    return { gameId: report.gameId, documentBytes: report.byteLength, order: report.order, modules: report.modules, uploads: report.uploads, completeViewerRead: report.saver.graphByteLength, problems: report.problems, published: false };
  });

  register('keel_game_select', 'Propose which engine game a Game project plays, with an optional seed (any text; integers and bytes32 hex are used as the token seed) and pixel size. Creates a review card the creator applies; the project preview then runs that game. Only for Game projects.', z.object({
    projectId: uuid.optional(), gameId: gameModuleId, seed: z.string().trim().max(128).optional(), pixels: z.number().int().min(1).max(64).optional(), summary: z.string().max(500).optional(),
  }).strict(), async (input) => {
    canEdit(); const p = project(input.projectId);
    if (!isGameProject(p)) throw Error('This project is not a Game project. Create one from the Game template first.');
    const game = ready();
    const found = (await game.modules()).modules.find((item) => item.id === input.gameId);
    if (!found) throw Error(`No module ${input.gameId} in the engine. List games with keel_game_modules kind "game".`);
    if (found.kind !== 'game') throw Error(`${input.gameId} is a ${found.kind} module; choose a game module.`);
    const graph = await game.graph(input.gameId);
    if (!graph.ok) throw Error(`${input.gameId}'s modules don't fit together: ${graph.problems.map((item) => `${item.module}: ${item.detail}`).join('; ')}`);
    const next = projectSchema.parse(withGame(p, { id: input.gameId, ...(input.seed !== undefined ? { seed: input.seed } : {}), ...(input.pixels !== undefined ? { pixels: input.pixels } : {}) }));
    return action('project-edit', input.summary ?? `Play ${found.title ?? input.gameId}${input.seed ? ` with seed ${input.seed}` : ''}`, { projectId: p.id, before: digest(p), previous: p, next });
  }, 'edit');
}
