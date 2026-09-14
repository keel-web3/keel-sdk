// Agent tools for the KEEL builder: the assistant draws into the build the
// creator has open (voxel models and capsule-and-rig characters, one op list),
// and the creator watches it draw -- ops stream one at a time into the engine's
// session, every one in the undo history, a preview frame every few ops. A
// batch that would throw work away (a new or generated model, a character over
// voxels, erasing everything...) goes through the existing project-edit review
// card instead: the build's saved op list with the batch added, which the
// Builder draws when the creator applies it. Nothing here publishes or signs.
import { z } from 'zod';
import { isGameProject } from './game-project.mjs';
import { buildName, builderOps, destructiveOps, importBytes, packFileName, projectBuilds, withBuildFile, withPackFiles } from './builder-project.mjs';
import { projectSchema } from '../workspace.mjs';

const uuid = z.string().uuid();
const GENERATORS = ['critter', 'crate', 'banner', 'tree', 'lamp', 'windmill'];
const where = { projectId: uuid.optional().describe('The Game project (default: this chat\'s project)'), build: buildName.optional().describe('The build (default: the one open in the Builder, else the project\'s first, else "main")') };
const compact = (state) => state && {
  mode: state.mode, model: state.model, groups: state.groups, target: state.target, rig: state.rig && { plan: state.rig.plan, missing: state.rig.missing, sockets: state.rig.sockets, bones: state.rig.bones?.map((b) => b.vox ? `${b.name}@${b.vox.join(',')}` : b.name) },
  character: state.character && { kind: state.character.kind, species: state.character.species, seed: state.character.seed, contract: state.character.contract, pins: state.character.pins, proportions: state.character.proportions, parts: state.character.parts, wear: state.character.wear, sockets: state.character.sockets },
  animation: Object.keys(state.animation?.clips ?? {}), variation: state.variation, colours: state.colours, history: { total: state.history.total, undone: state.history.undone, recent: state.history.recent.slice(0, 12) },
};

export function registerGameBuilderTools({ register, project, canEdit, access, action, navigate, hooks, digest, workspace }) {
  const builder = hooks.gameBuilder;
  if (!builder) return;
  const ready = () => { access(); const status = builder.status(); if (!status.available) throw Error(status.reason); return builder; };

  /** The project and build an op list goes to, opened in the builder from its saved ops if nothing has it open yet. */
  async function target({ projectId, build }) {
    const p = project(projectId);
    if (!isGameProject(p)) throw Error('The builder works in Game projects. Create one from the Game template first.');
    const b = ready();
    const saved = projectBuilds(p);
    const name = build ?? b.openBuildOf(p.id) ?? saved[0]?.name ?? 'main';
    const file = saved.find((item) => item.name === name);
    if (file?.error) throw Error(`The saved build ${name} can't be read: ${file.error}`);
    if (!b.log(p.id, name)) await b.open(p.id, name, file?.ops ?? [], { pace: false });
    return { p, name, b };
  }

  /** Stream ops into the build (the creator watches), or propose them on a review card when they'd throw work away. */
  async function draw(input, ops, summary) {
    canEdit();
    const { p, name, b } = await target(input);
    const checked = await b.validate(ops);
    if (!checked.ok) throw Error(`The op list doesn't check out; nothing was applied. ${checked.errors.slice(0, 6).map((e) => e.message).join(' ')}`);
    const state = await b.state(p.id, name);
    const destructive = destructiveOps(ops, state);
    if (destructive.length) {
      const next = projectSchema.parse(withBuildFile(p, name, [...b.log(p.id, name), ...ops]));
      const card = action('project-edit', summary ?? `Builder · ${name}: ${ops.length} ${ops.length === 1 ? 'op' : 'ops'} that ${destructive.map((item) => item.why).join('; ')}`, { projectId: p.id, before: digest(p), previous: p, next });
      return { ...card, build: name, destructive, applied: 0, note: 'Nothing changed yet: this batch throws work away, so the creator reviews it first. When they apply the card the build is saved with these ops and the Builder draws them.' };
    }
    // (Show the Builder first, so the creator sees it draw.)
    const view = hooks.view?.();
    if (!(view?.page === 'Projects' && view.projectId === p.id && view.tab === 'Builder')) {
      if (navigate) navigate(`Watch ${name} in the Builder`, { page: 'Projects', projectId: p.id, tab: 'Builder' });
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
    const result = await b.apply(p.id, name, ops, { pace: true, label: 'assistant · ' });
    return {
      build: name, ok: result.ok, applied: result.applied, of: ops.length, errors: result.errors,
      results: result.results.slice(-120).map((item) => item.ok ? `${item.index}: ${item.op} — ${item.did}` : `${item.index}: ${item.op} FAILED — ${item.error}`),
      state: compact(result.state), saved: false,
      hint: result.ok ? 'Applied live and undoable op by op. The creator saves the build (and its pack file) in the Builder, or you can propose that with keel_game_build_save.' : 'Ops before the failing one stay applied (each undoable); fix the failing op and send the rest.',
    };
  }

  register('keel_game_build_state', 'Read a Game project\'s build in the KEEL builder (voxel models and capsule-and-rig characters): the model (unit, voxel count, bounds, roles, groups and what is worn where), the target (object, attribute or entity), the rig (plan, bones with voxel joints, sockets, missing sockets), a character\'s design (kind, species, pins, proportions, parts, what it wears, its sockets), animation clips, variation rules and recent history. Pass reference: true for the builder\'s full op table (every op, its fields and an example) before writing ops.', z.object({ ...where, reference: z.boolean().default(false) }).strict(), async (input) => {
    const { p, name, b } = await target(input);
    const state = await b.state(p.id, name);
    const saved = projectBuilds(p).find((item) => item.name === name);
    return { build: name, builds: projectBuilds(p).map((item) => item.name), savedOps: saved?.ops.length ?? 0, unsaved: !b.saved(p.id, name, saved?.ops ?? []), ...compact(state), attributesToWear: state.attributes.map((a) => `${a.id} (${a.slot})`), catalogue: state.catalogue, ...(input.reference ? { opReference: (await b.reference()).reference } : {}) };
  });

  register('keel_game_build_ops', 'Draw into the open build with the KEEL builder\'s op list (JSON ops, e.g. {"op":"box","from":[-2,0,-2],"to":[1,3,1],"role":"primary"}): voxel brushes (set box fill sphere line mirror erase recolour symmetry), groups (group merge attach detach), rig (rig joint assign socket), motion (animate), variation (vary), looks, characters (character pin proportion part wear), target, undo/redo. Validated first (errors name the op, field and fix); then applied one at a time while the creator watches it draw, each op undoable; returns per-op results and the build after. Batches that throw work away (new, generate or character over an existing build, erase everything, multi-step undo, ungroup, unpart) become a review card instead. Read keel_game_build_state with reference: true for every op\'s fields.', z.object({ ...where, ops: builderOps.describe('Builder ops, applied in order'), summary: z.string().max(500).optional().describe('What these ops draw, for the review card if one is needed') }).strict(), (input) => draw(input, input.ops, input.summary), 'edit');

  register('keel_game_generate', `Start a build from one of the builder's seeded generators (${GENERATORS.join(', ')}; critters take plan humanoid or quadruped): groups, animation, variation rules and a look come with it, and it draws live. Then refine it with keel_game_build_ops. Replacing a build that has work in it goes through a review card.`, z.object({ ...where, kind: z.enum(GENERATORS), seed: z.string().min(1).max(64), plan: z.enum(['humanoid', 'quadruped']).optional(), then: builderOps.optional().describe('Ops to run after it, in the same batch') }).strict(), (input) => {
    const ops = [{ op: 'generate', kind: input.kind, seed: input.seed, ...(input.plan ? { plan: input.plan } : {}) }, ...(input.then ?? [])];
    return draw(input, ops, `Builder: a generated ${input.kind} (seed ${input.seed})${input.then ? ` and ${input.then.length} more ops` : ''}`);
  }, 'edit');

  register('keel_game_import', 'Import a 3D file already in the workspace (glTF/GLB, OBJ, STL or MagicaVoxel .vox; by its Files object id) with the engine\'s import: voxelised at a resolution, colours clustered into roles, segmented into parts, a creature split into its rigged body and the things it wears (each proposed for a socket with a confidence). Returns the proposal; with open: true it also replays the import\'s op list into the build so it draws live (through a review card if the build already has work). Adjust afterwards with builder ops: attach (move to another socket), detach (make body), merge, recolour with group (a part\'s role).', z.object({ ...where, objectId: z.string().regex(/^[a-f0-9]{64}$/), voxels: z.number().int().min(12).max(128).default(48).describe('Voxels along the longest side'), as: z.enum(['auto', 'creature', 'object']).default('auto'), open: z.boolean().default(true) }).strict(), async (input) => {
    access();
    const file = await importBytes(workspace, input.objectId);
    const r = await ready().importFile({ bytes: file.bytes, name: file.name, voxels: input.voxels, as: input.as });
    const pr = r.proposal;
    const summary = {
      name: r.name, ms: r.ms, stats: r.stats, kind: pr.kind, creature: pr.creature && { plan: pr.creature.plan, source: pr.creature.source, confidence: pr.creature.confidence, why: pr.creature.why?.slice(0, 3), missing: pr.creature.missing },
      parts: pr.parts.map((part) => ({ id: part.id, kind: part.kind, cells: part.cells, ...(part.socket ? { socket: part.socket } : {}), confidence: part.confidence, why: part.why?.[0] })),
      worn: pr.attributes.map((a) => ({ part: a.part, slot: a.slot, confidence: a.confidence, reason: a.reason?.slice(-1)[0] })), roles: pr.roles?.map?.((role) => role.role ?? role),
    };
    if (!input.open) return { ...summary, opened: false, hint: 'Call again with open: true to draw it into the build.' };
    return { ...summary, opened: await draw(input, r.ops, `Import ${file.name} into the builder (${r.ops.length} ops)`) };
  }, 'edit');

  register('keel_game_build_save', 'Propose saving the open build to its Game project: the build\'s op list (builds/<name>.build.json) and, unless packFiles is false, the builder\'s pack-file export of what it targets (packs/<id>.ts, one TypeScript file per asset) plus a file per worn attribute. Creates a review card the creator applies.', z.object({ ...where, packFiles: z.boolean().default(true), summary: z.string().max(500).optional() }).strict(), async (input) => {
    canEdit();
    const { p, name, b } = await target(input);
    let next = withBuildFile(p, name, b.log(p.id, name));
    const files = [];
    if (input.packFiles) {
      const pack = await b.exportPack(p.id, name);
      files.push({ name: packFileName(pack.id), content: pack.code }, ...pack.attributes.map((a) => ({ name: packFileName(a.id), content: a.code })));
      next = withPackFiles(next, files);
    }
    next = projectSchema.parse(next);
    return { ...action('project-edit', input.summary ?? `Save the ${name} build${files.length ? ` and ${files.map((f) => f.name).join(', ')}` : ''}`, { projectId: p.id, before: digest(p), previous: p, next }), files: [`builds/${name}.build.json`, ...files.map((f) => f.name)] };
  }, 'edit');
}
