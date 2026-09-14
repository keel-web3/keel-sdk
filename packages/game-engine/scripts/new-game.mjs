// Game projects from templates (the command line: scripts/new-game-cli.mjs, pnpm game:new).
//
// A new game project a creator owns: a folder with the game module (and, for
// blank and character, the creator's own pack, which the editor's Builder
// fills), ids of its own (mygames/<slug>, mygames/<slug>-pack), and the
// @keel/game-engine link that lets it reach the engine the way the SDK's
// examples do. Templates are the SDK's own examples, copied and renamed, so a
// new project starts from a game that is known to build and verify.
//
// Plain Node (fs only) and path-explicit: the KEEL editor bundles this file,
// so nothing here reads import.meta.
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/** The templates, in the order the editor shows them. */
export const GAME_TEMPLATES = Object.freeze([
  { id: "blank", title: "Blank", description: "A pixel canvas, a walker on the arrow keys and your own pack. The smallest start.", source: { kind: "template", dir: "blank" }, pack: true },
  { id: "top-down", title: "Top-down world", description: "A seeded plaza of objects, wandering animals and a character you drive (the garden example).", source: { kind: "example", dir: "garden", id: "examples/garden" } },
  { id: "level", title: "Level / world", description: "Generated terrain, rivers, roads, buildings and 2,000 people; zoom from overview to first person (the level demo).", source: { kind: "example", dir: "level-demo", id: "examples/level-demo" } },
  { id: "dungeon", title: "Dungeon crawl", description: "An isometric action-RPG crawl: doors, torches, fog of war and mobs (the worlds example, dungeon mode).", source: { kind: "example", dir: "worlds", id: "examples/worlds", patches: [['(param("mode") as Mode) ?? "overworld"', '(param("mode") as Mode) ?? "dungeon"']], ensureNeeds: ["packs/cloth@^1"] } },
  { id: "character", title: "Character builder sample", description: "Characters and wearables composed by contract, with your own pack for what you make in the Builder (the zoo example).", source: { kind: "example", dir: "zoo", id: "examples/zoo" }, pack: true },
]);

/** A folder-safe, id-safe name: lower-case letters, digits and dashes. */
export const slugOf = (name) => String(name).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "game";

const TEXT = /\.(ts|tsx|js|mjs|json|md|html|css|txt)$/i;
const SKIP = new Set(["node_modules", "out", "test", "tools", ".DS_Store"]);

function copyTree(from, to, replace) {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    if (SKIP.has(name) || name.endsWith(".tmp.ts")) continue;
    const src = join(from, name), dst = join(to, name);
    if (statSync(src).isDirectory()) { copyTree(src, dst, replace); continue; }
    if (TEXT.test(name)) writeFileSync(dst, replace(readFileSync(src, "utf8")));
    else cpSync(src, dst);
  }
}

/** Make <gamesDir>/node_modules reach the engine as the SDK's examples do (@keel/game-engine, and @keel-engine/* for Builder files). */
export function linkGamesFolder({ sdkRoot, gamesDir }) {
  const pkg = join(sdkRoot, "packages", "game-engine");
  const links = [[pkg, join(gamesDir, "node_modules", "@keel", "game-engine")], [join(pkg, "node_modules", "@keel-engine"), join(gamesDir, "node_modules", "@keel-engine")]];
  for (const [target, at] of links) {
    mkdirSync(dirname(at), { recursive: true });
    let present = false;
    try { present = !!lstatSync(at); } catch { /* not there */ }
    if (present) rmSync(at, { recursive: true, force: true });
    symlinkSync(target, at, "dir");
  }
}

/**
 * Create a game project from a template. Returns what the editor records:
 * { slug, dir, gameId, packId?, template }.
 */
export function createGameProject({ sdkRoot, gamesDir, template, name }) {
  const t = GAME_TEMPLATES.find((item) => item.id === template);
  if (!t) throw new Error(`No game template ${template}. Choose one of: ${GAME_TEMPLATES.map((item) => item.id).join(", ")}.`);
  const title = String(name ?? "").trim().slice(0, 80) || t.title;
  mkdirSync(gamesDir, { recursive: true });
  let slug = slugOf(title);
  for (let n = 2; existsSync(join(gamesDir, slug)); n += 1) slug = `${slugOf(title)}-${n}`;
  const dir = join(gamesDir, slug);
  const gameId = `mygames/${slug}`;
  const packId = t.pack ? `mygames/${slug}-pack` : undefined;
  const values = { __GAME_ID__: gameId, __PACK_ID__: packId ?? "", __GAME_PACKAGE__: `@mygames/${slug}`, __PACK_PACKAGE__: `@mygames/${slug}-pack`, __TITLE__: title.replace(/["\\`$]/g, "") };
  const fill = (text) => Object.entries(values).reduce((out, [key, value]) => out.replaceAll(key, value), text);
  const templates = join(sdkRoot, "packages", "game-engine", "templates");
  try {
    if (t.source.kind === "template") copyTree(join(templates, t.source.dir), join(dir, "game"), fill);
    else {
      const from = join(sdkRoot, "examples", "game-engine", t.source.dir);
      if (!existsSync(join(from, "src", "module.ts"))) throw new Error(`The ${t.title} template comes from examples/game-engine/${t.source.dir}, which isn't in this SDK.`);
      const own = (text) => {
        let out = text.replaceAll(`"${t.source.id}"`, `"${gameId}"`).replaceAll(`'${t.source.id}'`, `'${gameId}'`).replaceAll(`"@examples/${basename(from)}"`, `"@mygames/${slug}"`);
        for (const [find, put] of t.source.patches ?? []) out = out.replaceAll(find, put);
        return out;
      };
      copyTree(from, join(dir, "game"), own);
      // (The creator's pack joins an example that finds packs by contract: named in needs, it always loads.
      // ensureNeeds: modules the example's code imports that its manifest may not list yet.)
      const needs = [...(packId ? [`${packId}@^0.1`] : []), ...(t.source.ensureNeeds ?? [])];
      const manifest = join(dir, "game", "src", "module.ts");
      const text = readFileSync(manifest, "utf8");
      const missing = needs.filter((need) => !text.includes(`"${need.slice(0, need.lastIndexOf("@") + 1)}`));
      // (The game is the creator's now: their title, and the needs above.)
      let next = text.replace(/title:\s*"[^"]*"/, `title: ${JSON.stringify(title)}`);
      if (missing.length) next = next.replace(/needs:\s*\[/, `needs: [\n    ${missing.map((need) => JSON.stringify(need)).join(", ")},`);
      writeFileSync(manifest, next);
    }
    if (packId) copyTree(join(templates, "pack"), join(dir, "pack"), fill);
    writeFileSync(join(dir, "keel-game.json"), `${JSON.stringify({ schema: "keel-game-project@1", title, template: t.id, gameId, ...(packId ? { packId } : {}), from: t.source.kind === "example" ? `examples/game-engine/${t.source.dir}` : `templates/${t.source.dir}`, createdAt: new Date().toISOString() }, null, 2)}\n`);
    linkGamesFolder({ sdkRoot, gamesDir });
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  return { slug, dir, gameId, ...(packId ? { packId } : {}), template: t.id, title };
}

/** A game project's folder and record, from its game id (mygames/<slug>). */
export function gameFolderOf({ gamesDir, gameId }) {
  const m = /^mygames\/([a-z0-9][a-z0-9-]*)$/.exec(gameId ?? "");
  if (!m) return null;
  const dir = join(gamesDir, m[1]);
  const file = join(dir, "keel-game.json");
  return existsSync(file) ? { dir, record: JSON.parse(readFileSync(file, "utf8")) } : null;
}

const ASSET = /^packs\/([a-z0-9][a-z0-9-]*)\.ts$/;
/**
 * Put a project's Builder exports (project files packs/<id>.ts) into its
 * pack (pack/src/assets/<id>.ts) and rewrite the list the pack reads. Files
 * the project no longer has are removed. Returns the asset ids.
 */
export function syncBuilderAssets({ dir, files }) {
  const assets = join(dir, "pack", "src", "assets");
  if (!existsSync(assets)) return [];
  const wanted = new Map();
  for (const file of files ?? []) {
    const m = ASSET.exec(file.name ?? "");
    if (m && typeof file.content === "string") wanted.set(m[1], file.content);
  }
  for (const name of readdirSync(assets)) if (name !== "index.ts" && name.endsWith(".ts") && !wanted.has(name.slice(0, -3))) rmSync(join(assets, name));
  const ids = [...wanted.keys()].sort();
  for (const id of ids) {
    const path = join(assets, `${id}.ts`);
    const content = wanted.get(id);
    if (!existsSync(path) || readFileSync(path, "utf8") !== content) writeFileSync(path, content);
  }
  const usesBuilder = ids.some((id) => /@keel(-engine|\/game-engine)\/builder/.test(wanted.get(id)));
  const index = [
    "// Written by the KEEL editor from this project's Builder exports (packs/*.ts in",
    "// the project). Edit the assets themselves in the Builder; this list is rewritten.",
    ...ids.map((id, i) => `import a${i} from "./${id}.ts";`),
    `export const assets: readonly unknown[] = [${ids.map((_, i) => `a${i}`).join(", ")}];`,
    `export const usesBuilder = ${usesBuilder};`,
    "",
  ].join("\n");
  const indexPath = join(assets, "index.ts");
  if (!existsSync(indexPath) || readFileSync(indexPath, "utf8") !== index) writeFileSync(indexPath, index);
  return ids;
}
