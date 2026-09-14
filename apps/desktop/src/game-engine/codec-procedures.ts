// The codec inspector's editor operations, spread into main's tRPC router next
// to the builder's. The renderer never imports engine code: it sends pasted
// text, a Files object id or a saved project's record, and reads JSON back
// (the explained document, re-encoded bytes, a Solidity decoder's source).
import { z } from 'zod';
import type { GameCodecService } from './codec-service.mjs';

const objectId = z.string().regex(/^[a-f0-9]{64}$/);
const schemaKey = z.string().trim().min(1).max(200);
const header = z.enum(['id', 'self', 'none']);
const view = { schema: schemaKey.optional(), maxNodes: z.number().int().min(16).max(20000).optional(), maxHexBytes: z.number().int().min(0).max(65536).optional() };
/** Exactly one of pasted text, a Files object, or a saved project's file and record. */
export const codecExplainInput = z.object({
  text: z.string().min(1).max(48_000_000).optional(), objectId: objectId.optional(),
  projectId: z.string().uuid().optional(), file: z.string().min(1).max(300).optional(), record: z.string().max(200).optional(),
  ...view,
}).strict().refine((v) => [v.text !== undefined, v.objectId !== undefined, v.file !== undefined].filter(Boolean).length === 1, 'Inspect one thing at a time: pasted text, a Files object, or a project file.')
  .refine((v) => v.file === undefined || !!v.projectId, 'A project file needs its project.');
type ExplainInput = z.infer<typeof codecExplainInput>;
// (A duck-typed store: WorkspaceStore's read, verifyObject and object.)
type Store = { read(): { state: { objects: { id: string; name: string; byteLength: number }[]; projects: unknown[] } }; verifyObject(id: string): Promise<unknown>; object(id: string): Uint8Array };

// (main.ts owns the tRPC instance; these only need its procedure builder.)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function codecProcedures(t: { procedure: any }, codec: () => GameCodecService, store: () => Store) {
  return {
    gameCodecSchemas: t.procedure.query(() => codec().schemas()),
    gameCodecExplain: t.procedure.input(codecExplainInput).query(({ input }: { input: ExplainInput }) => codec().explain(input, { store: store() })),
    gameCodecReencode: t.procedure.input(z.object({ schema: schemaKey, json: z.string().max(4_000_000), header: header.default('id'), maxNodes: view.maxNodes, maxHexBytes: view.maxHexBytes }).strict()).mutation(({ input }: { input: { schema: string; json: string; header: 'id' | 'self' | 'none'; maxNodes?: number; maxHexBytes?: number } }) => codec().reencode(input)),
    gameCodecSolidity: t.procedure.input(z.object({ schema: schemaKey, name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/).optional() }).strict()).query(({ input }: { input: { schema: string; name?: string } }) => codec().solidity(input.schema, input.name)),
    gameCodecSample: t.procedure.input(z.object({ kind: z.enum(['sfx', 'recipe', 'song', 'voxels', 'ops', 'level', 'tile']) }).strict()).query(({ input }: { input: { kind: string } }) => codec().sample(input.kind)),
  };
}
