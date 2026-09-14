// pnpm game:new <template> "<name>" [--dir <games folder>]      (templates: blank, top-down, level, dungeon, character)
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GAME_TEMPLATES, createGameProject } from "./new-game.mjs";

const argv = process.argv.slice(2);
const option = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const [template, ...rest] = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--dir");
const sdkRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
if (!template) {
  console.log(`usage: pnpm game:new <template> "<name>" [--dir <games folder>]\n\n${GAME_TEMPLATES.map((t) => `  ${t.id.padEnd(10)} ${t.title}: ${t.description}`).join("\n")}`);
  process.exit(0);
}
const gamesDir = resolve(option("--dir") ?? join(process.cwd(), "games"));
const made = createGameProject({ sdkRoot, gamesDir, template, name: rest.join(" ") });
console.log(`Made ${made.title} (${made.template}) in ${made.dir}\n  game: ${made.gameId}${made.packId ? `\n  pack: ${made.packId}` : ""}\n\nBuild it:    node ${relative(process.cwd(), join(sdkRoot, "packages/game-engine/src/cli.ts"))} document ${made.gameId} --project ${relative(process.cwd(), gamesDir) || "."}\nPublish it:  pnpm game:publish ${made.gameId} --project ${gamesDir}`);
