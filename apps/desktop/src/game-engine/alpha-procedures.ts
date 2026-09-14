// The alpha-tester game procedures, spread into main's tRPC router: new games
// from templates, Builder assets into a game's pack, the practice chain
// (status, publish, the engine release), the engine on a chain for the engine
// picker, a Sepolia publication prepared up to the signature, getting the
// engine, and diagnostics. Engine work runs in the game-engine worker.
import { z } from 'zod';
import { gameModuleId, withGame } from './game-project.mjs';
import type { GameEngineService } from './game-engine-service.mjs';
import { GAME_TEMPLATES, createGameProject, gameFolderOf, syncBuilderAssets } from '../../../../packages/game-engine/scripts/new-game.mjs';
import { diagnosticsText, engineLockOf, fetchEngine, practiceChain, type LogRing } from './alpha-service.mjs';

type Paths = { sdkRoot: string; pkgDir: string; gamesDir: string; chainDir: string; sandboxDir: string };
type Store = { read(): { revision: number; state: { projects: any[] } }; save(state: unknown, revision: number): unknown };
type Deps = { engine: () => GameEngineService; store: () => Store; paths: () => Paths; logs: LogRing; versions: () => Record<string, string>; newProject: (title: string) => any; navigate: (projectId: string) => void; openLink: (url: string) => Promise<void> };

/** Sepolia, as the editor prepares a publication for it (KeelHold and the builder already deployed there). */
export const SEPOLIA_GAME_TARGET = Object.freeze({ chainId: 11155111, hold: '0x0a4f31d5ab08029e4c68f6f3227d9fa3a2d66267', builder: '0x70b5984c19baec22beefb1c2e0bd75a41e1452e0', rpc: 'https://ethereum-sepolia-rpc.publicnode.com' });

const failed = (logs: LogRing, what: string) => (error: unknown) => { logs.push('error', [`${what}: ${error instanceof Error ? error.message : String(error)}`]); throw error; };

// (main.ts owns the tRPC instance; these only need its procedure builder.)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function alphaProcedures(t: { procedure: any }, deps: Deps) {
  const project = (id: string) => {
    const found = deps.store().read().state.projects.find((item: any) => item.id === id);
    if (!found) throw new Error('That project is gone.');
    return found;
  };
  /** Write a game project's Builder exports into its pack (a project made from a template with a pack). */
  const sync = (item: any) => {
    const folder = item?.game?.id ? gameFolderOf({ gamesDir: deps.paths().gamesDir, gameId: item.game.id }) : null;
    if (!folder) return [];
    const ids = syncBuilderAssets({ dir: folder.dir, files: item.files });
    deps.engine().invalidate();
    return ids;
  };
  const practice = async () => {
    const chain = await practiceChain(deps.paths());
    if (!chain.running || !chain.KeelHold || !chain.KeelRawTokenURIBuilder || !chain.rpc) throw new Error(chain.reason);
    return { chain, deployment: { chainId: chain.chainId, KeelHold: chain.KeelHold, KeelRawTokenURIBuilder: chain.KeelRawTokenURIBuilder } };
  };
  return {
    gameTemplates: t.procedure.query(() => GAME_TEMPLATES.map(({ id, title, description, pack }) => ({ id, title, description, pack: !!pack }))),
    /** A new game: its folder from the template, and a Game project that plays it (or, with projectId, that project plays it). */
    gameNew: t.procedure.input(z.object({ template: z.enum(GAME_TEMPLATES.map((item) => item.id) as [string, ...string[]]), name: z.string().trim().min(1).max(80), projectId: z.string().uuid().optional(), revision: z.number().int() }).strict()).mutation(({ input }: { input: { template: string; name: string; projectId?: string; revision: number } }) => {
      const made = createGameProject({ sdkRoot: deps.paths().sdkRoot, gamesDir: deps.paths().gamesDir, template: input.template, name: input.name });
      deps.logs.push('log', [`new game ${made.gameId} from ${made.template} in ${made.dir}`]);
      deps.engine().invalidate();
      const current = deps.store().read();
      const projects = input.projectId
        ? current.state.projects.map((item: any) => item.id === input.projectId ? withGame(item, { id: made.gameId }) : item)
        : [...current.state.projects, withGame(deps.newProject(made.title), { id: made.gameId })];
      const saved = deps.store().save({ ...current.state, projects }, input.revision);
      const projectId = input.projectId ?? projects.at(-1).id;
      if (!input.projectId) deps.navigate(projectId);
      return { made, workspace: saved, projectId };
    }),
    /** Put a game project's Builder exports into its pack before a run or a publish. */
    gameSyncAssets: t.procedure.input(z.string().uuid()).mutation(({ input }: { input: string }) => ({ assets: sync(project(input)) })),
    /** The practice chain (pnpm game:sandbox), checked live. */
    gamePractice: t.procedure.query(() => practiceChain(deps.paths())),
    gamePublishPractice: t.procedure.input(z.object({ projectId: z.string().uuid(), gameId: gameModuleId, includeEngine: z.boolean().default(false) }).strict()).mutation(async ({ input }: { input: { projectId: string; gameId: string; includeEngine: boolean } }) => {
      const item = project(input.projectId);
      sync(item);
      const { chain, deployment } = await practice();
      const context = item.game?.seed ? { seed: item.game.seed } : {};
      const result = await deps.engine().publish({ gameId: input.gameId, rpc: chain.rpc, deployment, context, includeEngine: input.includeEngine }).catch(failed(deps.logs, `publish ${input.gameId}`));
      deps.logs.push('log', [`published ${input.gameId} to the practice chain: root ${result.root}`]);
      return result;
    }),
    gamePublishEngine: t.procedure.mutation(async () => {
      const { chain, deployment } = await practice();
      return deps.engine().publishEngine({ rpc: chain.rpc, deployment }).catch(failed(deps.logs, 'publish the engine release'));
    }),
    /** The engine picker's cheap part: which engine this editor has, the practice chain, and the pins. No engine work. */
    gameEngineInfo: t.procedure.query(async () => {
      const chain = await practiceChain(deps.paths());
      const lock = engineLockOf(deps.paths());
      const status = deps.engine().status();
      const sepoliaPin = ((lock as any).onchain ?? []).find((pin: any) => pin?.chainId === SEPOLIA_GAME_TARGET.chainId) ?? null;
      return {
        local: { available: status.available, root: status.root, source: (status as any).source ?? null, lock: { repository: lock.repository, tag: lock.tag, commit: lock.commit } },
        practice: { ...chain, check: null },
        sepolia: sepoliaPin ? { published: true, pin: sepoliaPin, note: `Release ${sepoliaPin.version} pinned at record ${sepoliaPin.objectId}. Check it to verify.` } : { published: false, note: 'The engine release is not published on Sepolia yet: the owner publishes it once, then pins it in packages/game-engine/engine.lock.json (docs/GAME_ENGINE_ALPHA.md).' },
      };
    }),
    /** The engine picker's check: this editor's engine against what the practice chain (and a pinned Sepolia release) hold. */
    gameEngineOnChain: t.procedure.query(async () => {
      const chain = await practiceChain(deps.paths());
      const lock = engineLockOf(deps.paths());
      const status = deps.engine().status();
      const local = { available: status.available, root: status.root, source: (status as any).source ?? null, lock: { repository: lock.repository, tag: lock.tag, commit: lock.commit } };
      // (Sepolia: the release pin the SDK's engine.lock.json names, once the owner has published it; checked read-only.)
      const sepoliaPin = ((lock as any).onchain ?? []).find((pin: any) => pin?.chainId === SEPOLIA_GAME_TARGET.chainId) ?? null;
      const sepolia = async () => !sepoliaPin || !status.available
        ? { published: false, note: 'The engine release is not published on Sepolia yet: the owner publishes it once, then pins it in packages/game-engine/engine.lock.json (docs/GAME_ENGINE_ALPHA.md).' }
        : { published: true, pin: sepoliaPin, note: `Release ${sepoliaPin.version} pinned at record ${sepoliaPin.objectId}.`, check: await deps.engine().engineOnChain({ rpc: SEPOLIA_GAME_TARGET.rpc, hold: sepoliaPin.hold, record: { release: { pin: sepoliaPin } } }).catch((error: Error) => ({ error: error.message })) };
      if (!chain.running || !status.available) return { local, practice: { ...chain, check: null }, sepolia: await sepolia() };
      let record = null;
      try { record = JSON.parse(await (await import('node:fs/promises')).readFile(`${chain.dir}/engine-release.json`, 'utf8')); } catch { /* no record yet */ }
      const check = await deps.engine().engineOnChain({ rpc: chain.rpc, hold: chain.KeelHold, record }).catch((error: Error) => ({ error: error.message }));
      return { local, practice: { ...chain, check }, sepolia: await sepolia() };
    }),
    /** A game's Sepolia publication, prepared up to the wallet's signature (read-only calls to Sepolia). */
    gamePlanSepolia: t.procedure.input(z.object({ projectId: z.string().uuid(), gameId: gameModuleId, rpcUrl: z.string().url().max(2048).optional() }).strict()).mutation(async ({ input }: { input: { projectId: string; gameId: string; rpcUrl?: string } }) => {
      sync(project(input.projectId));
      return deps.engine().planPublication({ gameId: input.gameId, rpc: input.rpcUrl ?? SEPOLIA_GAME_TARGET.rpc, hold: SEPOLIA_GAME_TARGET.hold, chainId: SEPOLIA_GAME_TARGET.chainId }).catch(failed(deps.logs, `Sepolia plan for ${input.gameId}`));
    }),
    /** Get the engine: clone the pinned release (pnpm game:engine). The editor picks it up after a restart. */
    gameGetEngine: t.procedure.mutation(async () => {
      const result = await fetchEngine(deps.paths());
      deps.logs.push(result.ok ? 'log' : 'error', [`get the engine: ${result.output.split('\n').slice(-3).join(' / ')}`]);
      return result;
    }),
    /** Open a link in the browser: the practice viewer on this computer, or the engine's source on GitHub. */
    gameOpenLink: t.procedure.input(z.string().url().max(2048)).mutation(async ({ input }: { input: string }) => {
      const url = new URL(input);
      const viewer = url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname) && url.pathname.startsWith('/game/');
      const source = url.protocol === 'https:' && url.hostname === 'github.com' && url.pathname.startsWith('/keel-web3/');
      if (!viewer && !source) throw new Error('Only the practice viewer on this computer and the engine\'s source on GitHub open from here; copy other links instead.');
      await deps.openLink(url.href);
      return { opened: true };
    }),
    /** Diagnostics as text: the tester copies it into their feedback. Nothing is sent. */
    gameDiagnostics: t.procedure.query(async () => {
      const status = deps.engine().status() as any;
      const lock = engineLockOf(deps.paths());
      let fingerprint = 'n/a';
      try { if (status.available) fingerprint = String(await (deps.engine() as any).current()).slice(0, 16); } catch { /* engine not readable */ }
      const chain = await practiceChain(deps.paths()).catch((error: Error) => ({ running: false, reason: error.message } as any));
      const report = {
        versions: deps.versions(),
        engine: { available: String(status.available), source: status.source ?? 'none', root: status.root ?? 'none', fingerprint, pinnedRelease: lock.commit ? `${lock.repository}@${lock.commit}${lock.tag ? ` (${lock.tag})` : ''}` : `not pinned (${lock.repository})`, reason: status.reason ?? '', projects: (deps.engine() as any).projects ?? [] },
        practice: { running: String(chain.running), rpc: chain.rpc ?? 'none', reason: chain.reason ?? '', KeelHold: chain.KeelHold ?? 'none', builder: chain.KeelRawTokenURIBuilder ?? 'none', engineRelease: chain.release ? `${chain.release.objects} objects (${chain.release.publishedAt})` : 'none', games: String(chain.games?.length ?? 0) },
        log: deps.logs.recent(80),
      };
      const home = process.env.HOME ?? '';
      const text = diagnosticsText(report);
      return { text: home ? text.replaceAll(home, '~') : text };
    }),
  };
}
