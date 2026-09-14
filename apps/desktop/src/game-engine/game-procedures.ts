// The editor's game-engine operations, spread into main's tRPC router. The
// renderer never imports engine code: it reads these JSON results over IPC.
import { z } from 'zod';
import { gameModuleId } from './game-project.mjs';
import type { GameEngineService } from './game-engine-service.mjs';

const assetId = z.string().max(80).regex(/^[a-z0-9][a-z0-9-]*$/);
export const gameAssetRef = z.object({ pack: gameModuleId, id: assetId }).strict();

// (main.ts owns the tRPC instance; these only need its procedure builder.)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function gameProcedures(t: { procedure: any }, engine: () => GameEngineService) {
  return {
    gameStatus: t.procedure.query(() => engine().status()),
    gameModules: t.procedure.query(() => engine().modules()),
    gameGraph: t.procedure.input(gameModuleId).query(({ input }: { input: string }) => engine().graph(input)),
    gameBuild: t.procedure.input(z.object({ gameId: gameModuleId }).strict()).mutation(({ input }: { input: { gameId: string } }) => engine().report(input.gameId)),
    gameFit: t.procedure.input(z.object({ attribute: gameAssetRef, entity: gameAssetRef }).strict()).query(({ input }: { input: { attribute: z.infer<typeof gameAssetRef>; entity: z.infer<typeof gameAssetRef> } }) => engine().fit(input.attribute, input.entity)),
  };
}
