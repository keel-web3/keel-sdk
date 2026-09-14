// The Level tab's operations, spread into main's tRPC router next to the game
// engine's, the builder's and the sound's. The renderer never imports engine
// code: it sends recipes and level ops, and reads JSON (states, snapshots the
// preview draws, thumbnails as PNG data URLs, sizes) over IPC. A tileset atlas
// is read from the workspace's own objects (Files) here in main.
import { z } from 'zod';
import { LEVEL_PRESETS, MAX_PLAYERS, TILESET_LAYOUTS, levelName, levelOpsInput, recipeSchema } from './level-project.mjs';
import type { GameLevelService } from './level-service.mjs';

const projectId = z.string().uuid();
const objectId = z.string().regex(/^[a-f0-9]{64}$/);
const players = z.number().int().min(0).max(MAX_PLAYERS);
const presets = Object.keys(LEVEL_PRESETS) as [string, ...string[]];
export const tilesetRules = z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/), layout: z.enum(TILESET_LAYOUTS as [string, ...string[]]), tile: z.number().int().min(2).max(256).refine((n: number) => n % 2 === 0, 'An even tile size.'), materials: z.array(z.object({ type: z.string().max(40), at: z.tuple([z.number().int().min(0).max(4095), z.number().int().min(0).max(4095)]), over: z.string().max(40).optional(), variants: z.number().int().min(1).max(15).optional() }).strict()).min(1).max(16) }).strict();
/** Largest atlas the editor reads (bytes). */
export const MAX_ATLAS_BYTES = 16 * 1024 * 1024;
type Store = { read(): { state: { objects: { id: string; name: string; type: string; byteLength: number }[] } }; object(id: string): Uint8Array | Buffer; verifyObject(id: string): Promise<unknown> };

// (main.ts owns the tRPC instance; these only need its procedure builder.)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function levelProcedures(t: { procedure: any }, level: () => GameLevelService, store: () => Store) {
  return {
    gameLevelCatalogue: t.procedure.query(() => level().catalogue()),
    gameLevelOpen: t.procedure.input(z.object({ projectId, name: levelName, content: z.string().max(8_000_000).default(''), preset: z.enum(presets).optional(), recipe: recipeSchema.optional(), players: players.optional() }).strict()).mutation(({ input }: { input: { projectId: string; name: string; content: string; preset?: string; recipe?: Record<string, unknown>; players?: number } }) => level().open(input.projectId, input.name, { content: input.content, preset: input.preset, recipe: input.recipe, players: input.players, editor: true })),
    gameLevelApply: t.procedure.input(z.object({ projectId, ops: levelOpsInput, stream: z.boolean().default(false) }).strict()).mutation(({ input }: { input: { projectId: string; ops: { op: string }[]; stream: boolean } }) => level().apply(input.projectId, input.ops, { stream: input.stream })),
    gameLevelDoc: t.procedure.input(z.object({ projectId, after: z.number().int().min(0) }).strict()).query(({ input }: { input: { projectId: string; after: number } }) => level().wait(input.projectId, input.after)),
    gameLevelState: t.procedure.input(z.object({ projectId, thumb: z.boolean().default(false) }).strict()).query(({ input }: { input: { projectId: string; thumb: boolean } }) => level().state(input.projectId, { thumb: input.thumb })),
    gameLevelEncode: t.procedure.input(z.object({ projectId }).strict()).mutation(({ input }: { input: { projectId: string } }) => level().encode(input.projectId)),
    gameLevelSaved: t.procedure.input(z.object({ projectId, name: levelName, content: z.string().max(8_000_000) }).strict()).mutation(({ input }: { input: { projectId: string; name: string; content: string } }) => level().saved(input.projectId, input.name, input.content)),
    gameLevelClose: t.procedure.input(z.object({ projectId }).strict()).mutation(({ input }: { input: { projectId: string } }) => level().closeDoc(input.projectId)),
    gameLevelVariations: t.procedure.input(z.object({ recipe: recipeSchema, players: players.default(0), count: z.number().int().min(1).max(8).default(6) }).strict()).query(({ input }: { input: { recipe: Record<string, unknown>; players: number; count: number } }) => level().variations(input.recipe, input.players, input.count)),
    /** An atlas from Files cut by its rules: colours, materials, the rules as codec bytes, a demo patch; `use` sets it on the open level. */
    gameLevelTileset: t.procedure.input(z.object({ projectId: projectId.optional(), objectId, rules: tilesetRules, use: z.boolean().default(false) }).strict()).mutation(async ({ input }: { input: { projectId?: string; objectId: string; rules: { id: string }; use: boolean } }) => {
      const object = store().read().state.objects.find((item) => item.id === input.objectId);
      if (!object) throw Error('Import the atlas PNG into Files first.');
      if (object.byteLength > MAX_ATLAS_BYTES) throw Error(`${object.name} is ${Math.round(object.byteLength / 1048576)} MB; a tileset atlas is at most ${MAX_ATLAS_BYTES / 1048576} MB.`);
      await store().verifyObject(input.objectId);
      const result = await level().tileset(new Uint8Array(store().object(input.objectId)), input.rules);
      if (input.use && input.projectId) await level().setTileset(input.projectId, { objectId: input.objectId, rules: result.rulesBytes });
      return { objectId: input.objectId, name: object.name, ...result };
    }),
    gameLevelNoTileset: t.procedure.input(z.object({ projectId }).strict()).mutation(({ input }: { input: { projectId: string } }) => level().setTileset(input.projectId, null)),
  };
}
