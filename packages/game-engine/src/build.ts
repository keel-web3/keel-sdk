// @keel/game-engine/build (Node): a project's modules, built with the engine the SDK carries.
import { ENGINE_ROOT, buildGameDocument, readWorkspace } from "@keel-engine/keel";
import type { GameDocument, WorkspaceModule } from "@keel-engine/keel";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** Where the engine this SDK carries lives. */
export const engineRoot: string = ENGINE_ROOT;

/** Every module a project can build with: the engine's own, and the project's. */
export function projectModules(project: string): Promise<WorkspaceModule[]> {
  return readWorkspace(ENGINE_ROOT, { projects: [resolve(project)] });
}

/** Build a game in a project as a KEEL local document; writes it under `out` when given. */
export async function buildGame({ project, game, out, minify = true }: { project: string; game: string; out?: string; minify?: boolean }): Promise<GameDocument> {
  const doc = await buildGameDocument(game, await projectModules(project), { minify });
  if (out) {
    const dir = join(resolve(out), "documents", game);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.html"), doc.html);
    writeFileSync(join(dir, "report.json"), `${JSON.stringify({ game, order: doc.resolution.order, modules: doc.modules, document: doc.html.byteLength }, null, 2)}\n`);
  }
  return doc;
}
