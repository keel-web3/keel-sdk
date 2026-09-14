"use strict";
// The KEEL entry of an engine module: what `keel module build` compiles into
// its on-chain bytes. (The same file in every package: @keel-engine/keel writes
// it, and link.json beside it, and its tests check both are current.)
//
// The page's KEEL_ENGINE (keel/runtime, always the first module) gets this
// module's manifest now and its factory for later, in dependency order. The
// factory evaluates the package: its own code is bundled in, and every other
// module it imports is linked -- each such import is answered by this module's
// context, ctx.use(id), while the package evaluates. Nothing else is shared.
import link from "./link.json" with { type: "json" };

interface Context {
  use(id: string): unknown;
}
interface Api {
  readonly setup?: (ctx: Context) => unknown;
}
interface Engine {
  define(manifest: unknown, factory: (ctx: Context) => Promise<Api>): void;
}
type Lookup = (specifier: string) => unknown;

// The bundler's require: the literal call below becomes the package's own lazy
// init, so the package runs inside the factory rather than when the script loads.
// (Outside any try block: a bundler takes a require inside one as optional.)
declare const require: (path: string) => Api;
const evaluate = (): Api => require("../src/index.ts");

const page = globalThis as { KEEL_ENGINE?: Engine; require?: Lookup };
const engine = page.KEEL_ENGINE;
if (engine === undefined) throw new Error("KEEL_ENGINE isn't on the page: keel/runtime loads first.");
const imports: Readonly<Record<string, string>> = link.imports;
const manifests: Readonly<Record<string, unknown>> = link.manifests;

engine.define(link.manifest, async (ctx) => {
  // Linked imports resolve through the bundler's require; for the synchronous
  // moment the package evaluates, that is this module's context.
  const lookup: Lookup = (specifier) => {
    const manifest = manifests[specifier];
    if (manifest !== undefined) return { manifest };
    const id = imports[specifier];
    if (id === undefined) throw new Error(link.manifest.id + " can't load " + specifier);
    return ctx.use(id);
  };
  const had = Object.hasOwn(page, "require");
  const before = page.require;
  page.require = lookup;
  let api: Api;
  try {
    api = evaluate();
  } finally {
    if (had && before !== undefined) page.require = before;
    else delete page.require;
  }
  if (typeof api.setup === "function") await api.setup(ctx);
  return api;
});
