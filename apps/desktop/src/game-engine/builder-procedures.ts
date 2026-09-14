// The builder's editor operations, spread into main's tRPC router next to the
// game engine's. The renderer never imports engine code: it sends op lists and
// reads JSON (states, preview frames, pack files, import proposals) over IPC.
import { z } from 'zod';
import { buildName, builderOp, builderOps, importBytes } from './builder-project.mjs';
import type { GameBuilderService } from './builder-service.mjs';

const build = z.object({ projectId: z.string().uuid(), name: buildName }).strict();
const savedOps = z.array(builderOp).max(20000);
const objectId = z.string().regex(/^[a-f0-9]{64}$/);
type Store = Parameters<typeof importBytes>[0];
export const importOptions = { voxels: z.number().int().min(12).max(128).default(48), as: z.enum(['auto', 'creature', 'object']).default('auto') };
// (main.ts owns the tRPC instance; these only need its procedure builder.)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function builderProcedures(t: { procedure: any }, builder: () => GameBuilderService, store: () => Store) {
  type Build = z.infer<typeof build>;
  return {
    gameBuilderOpen: t.procedure.input(build.extend({ ops: savedOps, reset: z.boolean().default(false), pace: z.boolean().default(true) }).strict()).mutation(({ input }: { input: Build & { ops: z.infer<typeof savedOps>; reset: boolean; pace: boolean } }) => builder().open(input.projectId, input.name, input.ops, { reset: input.reset, pace: input.pace, editor: true })),
    gameBuilderApply: t.procedure.input(build.extend({ ops: builderOps, pace: z.boolean().default(true) }).strict()).mutation(({ input }: { input: Build & { ops: z.infer<typeof builderOps>; pace: boolean } }) => builder().apply(input.projectId, input.name, input.ops, { pace: input.pace })),
    gameBuilderState: t.procedure.input(build.extend({ log: z.boolean().default(false) }).strict()).query(({ input }: { input: Build & { log: boolean } }) => builder().state(input.projectId, input.name, { log: input.log })),
    gameBuilderFrame: t.procedure.input(build.extend({ after: z.number().int().min(0) }).strict()).query(({ input }: { input: Build & { after: number } }) => builder().frame(input.projectId, input.name, input.after)),
    gameBuilderVariants: t.procedure.input(build.extend({ count: z.number().int().min(1).max(12).default(6) }).strict()).query(({ input }: { input: Build & { count: number } }) => builder().variants(input.projectId, input.name, input.count)),
    gameBuilderPoses: t.procedure.input(build.extend({ clip: z.string().max(40).optional() }).strict()).query(({ input }: { input: Build & { clip?: string } }) => builder().poses(input.projectId, input.name, input.clip)),
    gameBuilderExport: t.procedure.input(build.extend({ look: z.enum(['pixel', 'voxel']).default('pixel') }).strict()).mutation(({ input }: { input: Build & { look: 'pixel' | 'voxel' } }) => builder().exportPack(input.projectId, input.name, { look: input.look })),
    gameBuilderVariantOps: t.procedure.input(build.extend({ index: z.number().int().min(0).max(11), count: z.number().int().min(1).max(12).default(6) }).strict()).query(({ input }: { input: Build & { index: number; count: number } }) => builder().variantOps(input.projectId, input.name, input.index, input.count)),
    gameBuilderClose: t.procedure.input(build).mutation(({ input }: { input: Build }) => builder().closeBuild(input.projectId, input.name)),
    gameImport: t.procedure.input(z.object({ objectId, ...importOptions }).strict()).mutation(async ({ input }: { input: { objectId: string; voxels: number; as: string } }) => {
      const file = await importBytes(store(), input.objectId);
      return { objectId: input.objectId, ...await builder().importFile({ bytes: file.bytes, name: file.name, voxels: input.voxels, as: input.as }) };
    }),
    gameImportSample: t.procedure.input(z.object({ name: z.string().regex(/^[a-z-]{1,40}$/), ...importOptions }).strict()).mutation(async ({ input }: { input: { name: string; voxels: number; as: string } }) => {
      const sample = await builder().sample(input.name);
      return { sample: sample.name, ...await builder().importFile({ bytes: sample.bytes, name: sample.name, voxels: input.voxels, as: input.as }) };
    }),
  };
}
