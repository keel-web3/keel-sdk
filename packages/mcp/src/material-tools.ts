// Generative pixel-art materials (@keel-engine/materials, carried by the SDK as
// @keel/game-engine/materials). Converting an exact sheet -- a material atlas, a
// tileset, a painted texture -- into a seed-driven one follows a rulebook, not an
// agent's guess: keel-material-guide measures the sheet, runs the rules, and says
// which fired on what evidence and what to ask the author; keel-material-distill
// keeps the sheet as a layered exemplar (.kmx) by that plan and proves its seeds
// with the gauntlet. Both are local: they read a workspace PNG and write workspace
// files; nothing is uploaded, signed or sent.
//
// The engine ships TypeScript sources linked from a sibling repository, so it is
// loaded at call time through the SDK's own @keel/game-engine exports (as the arena
// tools do): a checkout without the engine gets a clear error here.
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';
import { decodeRasterPNG, pngChunk, pngHeader } from '@keel/sdk/raster-strips';
import type { ToolContext, ToolDefinition } from './types.js';

interface Raster { readonly width: number; readonly height: number; readonly rgba: Uint8Array | Uint8ClampedArray }
interface Rule { readonly id: string; readonly when: string; readonly then: string; readonly why: string }
interface FamilyScore { readonly name: string; readonly failures: readonly string[]; readonly pass: boolean; readonly [measure: string]: unknown }
interface GauntletScore { readonly families: readonly FamilyScore[]; readonly pass: boolean }
interface FamilyPlan { lightLayer: boolean; lightScale: number; albedoColours: number[]; recipe: Record<string, unknown>[]; compose: unknown[]; finish: { dither: string; amount: number; clean: boolean; colours: number[] } | undefined }
interface SheetPlan { readonly pixels: number; readonly sample: 'mean' | 'mode'; readonly families: readonly FamilyPlan[] }
interface BlockAnalysis { readonly index: number; readonly x: number; readonly y: number; readonly colour: string; readonly looksLike: readonly string[]; readonly evidence: Record<string, number>; readonly rules: readonly string[] }
interface SheetAnalysis {
  readonly kind: string; readonly width: number; readonly height: number; readonly blocks: { readonly x: number; readonly y: number }; readonly columns: number;
  readonly evidence: { readonly transparent: boolean; readonly knee: number | undefined; readonly cellTexels: number };
  readonly rule: string; readonly texelsPerArtPixel: number; readonly colours: number; readonly blockAnalyses: readonly BlockAnalysis[]; readonly plan: SheetPlan;
}
interface Exemplar { readonly pixels: number; readonly columns: number; readonly blocks: number; readonly families: readonly { readonly name: string; readonly layers: readonly { readonly name: string; readonly kind: string; readonly palette?: Uint8Array; readonly scale?: number }[]; readonly recipe: readonly unknown[]; readonly finish?: { readonly palette: Uint8Array; readonly dither: string; readonly amount: number } }[] }
interface MaterialsEngine {
  readonly SHEET_RULES: readonly Rule[];
  readonly BLOCK_RULES: readonly Rule[];
  analyzeMaterialSheet(image: Raster, options?: { blocks?: { x: number; y: number }; columns?: number }): SheetAnalysis;
  distillMaterial(image: Raster, options: { names: readonly string[]; blocks: { x: number; y: number }; columns: number; plan: SheetPlan }): { exemplar: Exemplar; fidelity: GauntletScore; finished: GauntletScore };
  encodeMaterialExemplar(exemplar: Exemplar): Uint8Array;
  paintMaterialAtlas(options: { exemplar: Exemplar; seed?: number; variance?: number }): { readonly art: Raster };
  scoreMaterial(reference: Raster, candidate: Raster, layout: { blocks: number; columns: number; pixels: number; families: readonly string[] }): GauntletScore;
}

const ENGINE_EXPORTS = ['SHEET_RULES', 'BLOCK_RULES', 'analyzeMaterialSheet', 'distillMaterial', 'encodeMaterialExemplar', 'paintMaterialAtlas', 'scoreMaterial'] as const;
let engine: Promise<MaterialsEngine> | undefined;
function loadEngine(): Promise<MaterialsEngine> {
  engine ??= (async () => {
    // The SDK checkout this server was built in: packages/mcp/dist -> packages/game-engine.
    const require = createRequire(new URL('../../game-engine/package.json', import.meta.url));
    const loaded = await import(pathToFileURL(require.resolve('@keel/game-engine/materials')).href) as Record<string, unknown>;
    const missing = ENGINE_EXPORTS.filter((name) => loaded[name] === undefined);
    if (missing.length) throw Error(`the linked engine lacks ${missing.join(', ')}`);
    return loaded as unknown as MaterialsEngine;
  })().catch((error: unknown) => {
    engine = undefined;
    throw Error(`The materials engine is unavailable (${error instanceof Error ? error.message : String(error)}). These tools need an SDK checkout whose @keel/game-engine links @keel-engine/materials (run \`pnpm game:setup\`), on Node 22.18 or newer.`);
  });
  return engine;
}

const IMAGE_MAX_BYTES = 32 * 1024 * 1024;
const IMAGE_MAX_SIDE = 4096;
const LOCAL_ONLY = { uploaded: false, signed: false, submitted: false } as const;
const SLUG = /^[a-z][a-z0-9-]{0,31}$/u;

// Writes a file, creating its folder inside the workspace.
async function writeFile(context: ToolContext, pathValue: string, bytes: Uint8Array): Promise<string> {
  await mkdir(await context.workspace.resolveOutputDirectory(dirname(pathValue)), { recursive: true });
  return await context.workspace.writeBytes(pathValue, bytes);
}
const DITHERS = ['none', 'bayer2', 'bayer4', 'bayer8'];

type Args = Record<string, unknown>;
function strictArgs(input: unknown, allowed: readonly string[], label: string): Args {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error(`Invalid ${label} request.`);
  const unknown = Object.keys(input).filter((key) => !allowed.includes(key));
  if (unknown.length) throw Error(`Unsupported ${label} field: ${unknown.join(', ')}.`);
  return input as Args;
}
function path(args: Args, key: string, required: boolean, extension?: string): string | undefined {
  const value = args[key];
  if (value === undefined) { if (required) throw Error(`Supply ${key}.`); return undefined; }
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) throw Error(`${key} must be a workspace path.`);
  if (extension && !value.toLowerCase().endsWith(extension)) throw Error(`${key} must end in ${extension}.`);
  return value;
}
function int(args: Args, key: string, min: number, max: number): number | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw Error(`${key} must be an integer from ${min} to ${max}.`);
  return value;
}
function grid(args: Args): { blocks?: { x: number; y: number }; columns?: number } {
  const blocks = args.blocks;
  if (blocks !== undefined) {
    const b = blocks as Args;
    if (!b || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).some((k) => k !== 'x' && k !== 'y')) throw Error('blocks is {x, y}.');
    int(b, 'x', 1, 16); int(b, 'y', 1, 16);
    if (b.x === undefined || b.y === undefined) throw Error('blocks is {x, y}.');
  }
  return { ...(blocks ? { blocks: blocks as { x: number; y: number } } : {}), ...(args.columns !== undefined ? { columns: int(args, 'columns', 1, 64)! } : {}) };
}

async function loadSheet(context: ToolContext, imagePath: string): Promise<{ sheet: Raster; digest: string; bytes: number }> {
  const { bytes } = await context.workspace.readFile(imagePath, IMAGE_MAX_BYTES);
  const image = await decodeRasterPNG(bytes);
  if (image.width > IMAGE_MAX_SIDE || image.height > IMAGE_MAX_SIDE) throw Error(`The sheet is ${image.width}x${image.height}; materials are read up to ${IMAGE_MAX_SIDE} texels a side.`);
  const rgba = new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength);
  return { sheet: { width: image.width, height: image.height, rgba }, digest: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
}

const rulesById = (e: MaterialsEngine): Map<string, Rule> => new Map([...e.SHEET_RULES, ...e.BLOCK_RULES].map((r) => [r.id, r]));
const ruleText = (r: Rule) => ({ id: r.id, when: r.when, then: r.then, why: r.why });
const round = (v: number): number => Math.round(v * 1000) / 1000;

// What each failed measure means, and the plan change that moves it.
const FIXES: Readonly<Record<string, { readonly low?: string; readonly high?: string; readonly any?: string }>> = {
  meanCell: { any: 'The average cell drifted: moves carry cells to rows whose light differs. Set band 0 on that family\'s cells or strips (the banded-light rule), lower variance, or keep its light layer moving with the cells.' },
  palette: { any: 'The colours shifted: give the albedo more colours (albedoColours from 32) or the finish more (colours [32]).' },
  edge: { low: 'Blurrier than the sheet: more art pixels a cell (pixels 32), more finish colours, or a stronger dither (amount 0.45).', high: 'Noisier than the sheet: a lighter dither (amount 0.25), clean on, or fewer moves (lower variance).' },
  fine: { low: 'Fine detail lost: more art pixels a cell or finish colours.', high: 'Speckled: a lighter dither, clean on, or a bayer8 screen.' },
  coarse: { low: 'Shapes across cells lost (plates, banks): strips with band 1, fewer quilts (share 0.2), or band 0 for cells.', high: 'Shapes too strong: fewer moves, or leave out quilt.' },
  spread: { low: 'Cells too uniform inside: keep the light layer, more albedo colours.', high: 'Cells too busy inside: fewer quilts, a lighter dither.' },
  cellStd: { low: 'Cells too alike: raise variance or the lean share, or add a paint step.', high: 'Cells too different from each other: lower variance, band 0, or a smaller lean share.' },
};
function fixesFor(failures: readonly { family: string; measure: string; value: number; low?: number | undefined }[]): { family: string; measure: string; value: number; fix: string }[] {
  return failures.map(({ family, measure, value, low }) => {
    const f = FIXES[measure] ?? {};
    return { family, measure, value: round(value), fix: f.any ?? ((low !== undefined && value < low) ? f.low : f.high) ?? 'Revisit this family\'s plan.' };
  });
}

const GAUNTLET_LOWS: Readonly<Record<string, number>> = { edge: 0.9, fine: 0.9, coarse: 0.9, spread: 0.8, cellStd: 0.65 };

function encodePNG(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  return Buffer.concat([pngHeader(width, height), pngChunk('IDAT', deflateSync(raw, { level: 9 })), pngChunk('IEND', new Uint8Array(0))]);
}
// Panels side by side, each read nearest at the same height.
function strip(panels: readonly Raster[], height: number): Uint8Array {
  const gap = 4, widths = panels.map((p) => Math.round((p.width * height) / p.height));
  const width = widths.reduce((a, w) => a + w, 0) + gap * (panels.length - 1), out = new Uint8Array(width * height * 4).fill(255);
  let x0 = 0;
  panels.forEach((p, i) => {
    for (let y = 0; y < height; y += 1) for (let x = 0; x < widths[i]!; x += 1) {
      const sx = Math.floor(((x + 0.5) * p.width) / widths[i]!), sy = Math.floor(((y + 0.5) * p.height) / height), o = (sy * p.width + sx) * 4;
      out.set(p.rgba.subarray(o, o + 4), (y * width + x0 + x) * 4);
    }
    x0 += widths[i]! + gap;
  });
  return encodePNG(width, height, out);
}

const WORKFLOW = [
  'keel-material-guide: measure the sheet; the rulebook decides the technique and reports why.',
  'Ask the author only what evidence cannot settle (the questions below): what each block depicts, what the sheet is for, and the visible size tradeoff.',
  'keel-material-distill with the author\'s names (and any overrides they chose): writes the .kmx, scores fidelity at variance 0 and the gauntlet over seeds, writes a preview.',
  'Show the author the preview. On a gauntlet failure apply the returned fix to that family\'s plan and distil again; never loosen the limits.',
  'Ship the .kmx, not the sheet: paintMaterialAtlas({ exemplar: decodeMaterialExemplar(bytes), seed }) from @keel/game-engine/materials builds the atlas at runtime, with the same cell layout.',
];

const guide: ToolDefinition = {
  descriptor: {
    name: 'keel-material-guide',
    description: 'START HERE to turn an exact sheet (a material atlas, tileset or painted texture PNG) into generative pixel art. Measures the sheet and runs the KEEL material rulebook (@keel/game-engine/materials): what kind of art it is (sprite sheet, scaled-up pixel art, painted), its block and cell grid, which rules fired on which evidence (light layers, plates, framed cells, banding, two hues) and the plan they make, plus guesses for what each block depicts and the questions to put to the author before distilling. Local and read-only; writes nothing.',
    inputSchema: { type: 'object', properties: {
      imagePath: { type: 'string', maxLength: 4096, description: 'Workspace PNG of the exact sheet (8-bit, up to 4096 texels a side).' },
      blocks: { type: 'object', properties: { x: { type: 'integer', minimum: 1, maximum: 16 }, y: { type: 'integer', minimum: 1, maximum: 16 } }, required: ['x', 'y'], additionalProperties: false, description: 'Family blocks across and down, when known; detected otherwise.' },
      columns: { type: 'integer', minimum: 1, maximum: 64, description: 'Cells per block side, when known; detected otherwise.' },
    }, required: ['imagePath'], additionalProperties: false },
  },
  async run(context, value) {
    const args = strictArgs(value, ['imagePath', 'blocks', 'columns'], 'material guide');
    const imagePath = path(args, 'imagePath', true, '.png')!;
    const e = await loadEngine();
    const { sheet, digest, bytes } = await loadSheet(context, imagePath);
    const a = e.analyzeMaterialSheet(sheet, grid(args));
    const rules = rulesById(e);
    const painted = a.rule === 'painted-source';
    const questions = [
      { id: 'names', ask: `What does each block depict? Name them in reading order (lowercase slugs).`, guesses: a.blockAnalyses.map((b) => ({ block: b.index, at: { x: b.x, y: b.y }, colour: b.colour, looksLike: b.looksLike })) },
      { id: 'purpose', ask: 'What is the sheet for: the same look with new cells every seed (variance 0.5, the default), exactly this sheet (variance 0), or new pieces in its style (a paint step in a family\'s recipe)?' },
      ...(painted ? [{ id: 'resolution', ask: `It is painted, so it will be finished as pixel art at ${a.plan.pixels} art pixels a cell. Chunkier and smaller (16), as planned (${a.plan.pixels}), or finer (32)?`, options: [16, a.plan.pixels, 32].filter((v, i, all) => all.indexOf(v) === i && v <= Math.floor(a.evidence.cellTexels)) }] : []),
      ...(a.blocks.x * a.blocks.y === 1 || a.columns === 1 ? [{ id: 'grid', ask: `The analysis read ${a.blocks.x}x${a.blocks.y} block(s) of ${a.columns}x${a.columns} cells. Is that the sheet's layout? If not, pass blocks and columns.` }] : []),
    ];
    return {
      schema: 'keel-material-guide@1',
      image: { path: imagePath, sha256: digest, bytes, width: a.width, height: a.height, colours: a.colours },
      kind: a.kind,
      grid: { blocks: a.blocks, columns: a.columns, cellTexels: round(a.evidence.cellTexels), texelsPerArtPixel: round(a.texelsPerArtPixel) },
      sheetRule: { ...ruleText(rules.get(a.rule)!), evidence: { transparent: a.evidence.transparent, knee: a.evidence.knee ?? null } },
      blocks: a.blockAnalyses.map((b) => ({
        index: b.index, at: { x: b.x, y: b.y }, colour: b.colour, looksLike: b.looksLike,
        evidence: Object.fromEntries(Object.entries(b.evidence).map(([k, v]) => [k, round(v)])),
        fired: b.rules.map((id) => ruleText(rules.get(id)!)),
        plan: a.plan.families[b.index],
      })),
      plan: { pixels: a.plan.pixels, sample: a.plan.sample },
      questions,
      workflow: WORKFLOW,
      next: { tool: 'keel-material-distill', arguments: { imagePath, names: a.blockAnalyses.map((b) => b.looksLike[0] ?? `block-${b.index}`), outputPath: imagePath.replace(/\.png$/iu, '.kmx'), previewPath: imagePath.replace(/\.png$/iu, '.preview.png') }, note: 'Replace names with the author\'s answer before calling.' },
      rulebook: { sheet: e.SHEET_RULES.map(ruleText), block: e.BLOCK_RULES.map(ruleText) },
      ...LOCAL_ONLY,
    };
  },
};

const FAMILY_OVERRIDE_KEYS = ['lightLayer', 'albedoColours', 'recipe', 'finish'];
function applyOverrides(plan: SheetPlan, names: readonly string[], args: Args): SheetPlan {
  const pixels = int(args, 'pixels', 4, 64);
  const overrides = args.overrides;
  if (overrides !== undefined && (!overrides || typeof overrides !== 'object' || Array.isArray(overrides))) throw Error('overrides is {familyName: {lightLayer?, albedoColours?, recipe?, finish?}}.');
  const byName = (overrides ?? {}) as Record<string, Args>;
  for (const name of Object.keys(byName)) if (!names.includes(name)) throw Error(`overrides names ${name}, which is not one of names.`);
  return {
    ...plan,
    ...(pixels !== undefined ? { pixels } : {}),
    families: plan.families.map((family, f) => {
      const o = byName[names[f]!];
      if (o === undefined) return family;
      strictArgs(o, FAMILY_OVERRIDE_KEYS, `${names[f]} override`);
      const next: FamilyPlan = { ...family, recipe: [...family.recipe], albedoColours: [...family.albedoColours] };
      if (o.lightLayer !== undefined) { if (typeof o.lightLayer !== 'boolean') throw Error('lightLayer is true or false.'); next.lightLayer = o.lightLayer; next.compose = o.lightLayer ? [{ layer: 'albedo', blend: 'base' }, { layer: 'light', blend: 'multiply' }] : [{ layer: 'albedo', blend: 'base' }]; }
      if (o.albedoColours !== undefined) { if (!Array.isArray(o.albedoColours) || o.albedoColours.length === 0 || o.albedoColours.some((c) => !Number.isInteger(c) || c < 2 || c > 256)) throw Error('albedoColours is a list of palette sizes, 2..256.'); next.albedoColours = o.albedoColours as number[]; }
      if (o.recipe !== undefined) { if (!Array.isArray(o.recipe) || o.recipe.length > 16 || o.recipe.some((s) => !s || typeof s !== 'object' || Array.isArray(s))) throw Error('recipe is a list of up to 16 steps ({layer: "strips"|"cells"|"quilt"|"lean"|"paint", ...}).'); next.recipe = o.recipe as Record<string, unknown>[]; }
      if (o.finish !== undefined) {
        if (o.finish === null) next.finish = undefined;
        else {
          const fin = strictArgs(o.finish, ['dither', 'amount', 'clean', 'colours'], `${names[f]} finish`);
          const base = next.finish ?? { dither: 'bayer4', amount: 0.35, clean: true, colours: [16, 24, 32] };
          if (fin.dither !== undefined && !DITHERS.includes(fin.dither as string)) throw Error(`dither is one of ${DITHERS.join(', ')}.`);
          if (fin.amount !== undefined && (typeof fin.amount !== 'number' || fin.amount < 0 || fin.amount > 1)) throw Error('amount is 0..1.');
          if (fin.clean !== undefined && typeof fin.clean !== 'boolean') throw Error('clean is true or false.');
          if (fin.colours !== undefined && (!Array.isArray(fin.colours) || fin.colours.length === 0 || fin.colours.some((c) => !Number.isInteger(c) || c < 2 || c > 256))) throw Error('colours is a list of palette sizes, 2..256.');
          next.finish = { ...base, ...(fin as Partial<typeof base>) };
        }
      }
      return next;
    }),
  };
}

const distill: ToolDefinition = {
  descriptor: {
    name: 'keel-material-distill',
    description: 'Distil an exact sheet into a KEEL material exemplar (.kmx, KMX2) by the rulebook\'s plan (run keel-material-guide first and ask the author what each block depicts). Writes the .kmx and an optional preview PNG (sheet | variance 0 | seeds), and reports the strict fidelity score at variance 0, the gauntlet for every family over N seeds, and for each failure the plan change that fixes it. Overrides (pixels, per-family lightLayer, albedoColours, recipe, finish) are the author\'s or the fix\'s; limits are never loosened. Local only: nothing is uploaded, signed or sent.',
    inputSchema: { type: 'object', properties: {
      imagePath: { type: 'string', maxLength: 4096, description: 'Workspace PNG of the exact sheet, as given to keel-material-guide.' },
      names: { type: 'array', minItems: 1, maxItems: 256, items: { type: 'string', maxLength: 32 }, description: 'One lowercase slug per block in reading order: what the author says each block depicts.' },
      outputPath: { type: 'string', maxLength: 4096, description: 'Workspace path for the exemplar, ending .kmx.' },
      previewPath: { type: 'string', maxLength: 4096, description: 'Optional workspace path for the preview PNG.' },
      blocks: { type: 'object', properties: { x: { type: 'integer', minimum: 1, maximum: 16 }, y: { type: 'integer', minimum: 1, maximum: 16 } }, required: ['x', 'y'], additionalProperties: false },
      columns: { type: 'integer', minimum: 1, maximum: 64 },
      pixels: { type: 'integer', minimum: 4, maximum: 64, description: 'Art pixels per cell, overriding the plan (the author\'s 16/24/32 choice).' },
      overrides: { type: 'object', description: 'Per family name: {lightLayer?, albedoColours?, recipe?, finish?: {dither?, amount?, clean?, colours?} | null}.' },
      variance: { type: 'number', minimum: 0, maximum: 1, description: 'How far seeds move from the sheet (default 0.5).' },
      seeds: { type: 'integer', minimum: 1, maximum: 16, description: 'Seeds to run the gauntlet over (default 6).' },
    }, required: ['imagePath', 'names', 'outputPath'], additionalProperties: false },
  },
  async run(context, value) {
    const args = strictArgs(value, ['imagePath', 'names', 'outputPath', 'previewPath', 'blocks', 'columns', 'pixels', 'overrides', 'variance', 'seeds'], 'material distill');
    const imagePath = path(args, 'imagePath', true, '.png')!, outputPath = path(args, 'outputPath', true, '.kmx')!, previewPath = path(args, 'previewPath', false, '.png');
    const names = args.names;
    if (!Array.isArray(names) || names.some((n) => typeof n !== 'string' || !SLUG.test(n)) || new Set(names).size !== names.length) throw Error('names are distinct lowercase slugs (a-z, 0-9, -), one per block.');
    const variance = args.variance ?? 0.5;
    if (typeof variance !== 'number' || variance < 0 || variance > 1) throw Error('variance is 0..1.');
    const seedCount = int(args, 'seeds', 1, 16) ?? 6;
    const e = await loadEngine();
    const { sheet, digest } = await loadSheet(context, imagePath);
    const a = e.analyzeMaterialSheet(sheet, grid(args));
    if (names.length !== a.blocks.x * a.blocks.y) throw Error(`The sheet has ${a.blocks.x}x${a.blocks.y} blocks: name all ${a.blocks.x * a.blocks.y}, in reading order (or pass blocks).`);
    const plan = applyOverrides(a.plan, names as string[], args);
    const d = e.distillMaterial(sheet, { names: names as string[], blocks: a.blocks, columns: a.columns, plan });
    const bytes = e.encodeMaterialExemplar(d.exemplar);
    const written = await writeFile(context, outputPath, bytes);
    const layout = { blocks: d.exemplar.blocks, columns: d.exemplar.columns, pixels: d.exemplar.pixels, families: names as string[] };
    const seeds = Array.from({ length: seedCount }, (_, i) => i + 1);
    const atlases = seeds.map((seed) => e.paintMaterialAtlas({ exemplar: d.exemplar, seed, variance }));
    const scores = atlases.map((atlas) => e.scoreMaterial(sheet, atlas.art, layout));
    const failures = scores.flatMap((s, i) => s.families.flatMap((f) => f.failures.map((measure) => ({ seed: seeds[i]!, family: f.name, measure, value: f[measure] as number, low: GAUNTLET_LOWS[measure] }))));
    const worst = new Map<string, (typeof failures)[number]>();
    for (const f of failures) { const k = `${f.family}:${f.measure}`; if (!worst.has(k)) worst.set(k, f); }
    const fidelityFailures = d.fidelity.families.flatMap((f) => f.failures.map((measure) => ({ family: f.name, measure, value: f[measure] as number })));
    let preview: string | undefined;
    if (previewPath) {
      const zero = e.paintMaterialAtlas({ exemplar: d.exemplar, variance: 0 });
      preview = await writeFile(context, previewPath, strip([sheet, zero.art, ...atlases.slice(0, 2).map((x) => x.art)], Math.min(512, Math.max(256, zero.art.height * 2))));
    }
    const pass = scores.every((s) => s.pass);
    return {
      schema: 'keel-material-distill@1',
      source: { path: imagePath, sha256: digest, width: sheet.width, height: sheet.height },
      exemplar: {
        path: written, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), format: 'KMX2',
        pixels: d.exemplar.pixels, columns: d.exemplar.columns, blocks: d.exemplar.blocks,
        families: d.exemplar.families.map((f) => ({ name: f.name, layers: f.layers.map((l) => (l.kind === 'palette' ? `${l.name}: ${l.palette!.length / 4} colours` : `${l.name}: a sample every ${l.scale} px`)), recipe: f.recipe, finish: f.finish ? `${f.finish.palette.length / 4} colours, ${f.finish.dither} at ${f.finish.amount}` : 'none' })),
      },
      fidelity: { pass: d.fidelity.pass, note: 'The exemplar at variance 0, unfinished, against the sheet with the strict limits: what distilling lost.', failures: fidelityFailures.map((f) => ({ ...f, value: round(f.value) })) },
      gauntlet: {
        pass, variance, seeds,
        families: (names as string[]).map((name, fi) => ({ name, pass: scores.every((s) => s.families[fi]!.pass), meanCell: scores.map((s) => round(s.families[fi]!.meanCell as number)), failures: [...new Set(scores.flatMap((s) => s.families[fi]!.failures))] })),
        fixes: fixesFor([...worst.values()]),
      },
      ...(preview ? { preview: { path: preview, panels: ['sheet', 'variance 0', 'seed 1', 'seed 2'] } } : {}),
      verdict: pass ? (d.fidelity.pass ? 'PASS: ship the .kmx in place of the sheet.' : 'PASS with fidelity notes: the seeds pass; distilling lost a little at variance 0 (see fidelity).') : 'FAIL: apply the fixes to those families\' plans (overrides) and distil again. Do not ship a failing exemplar or loosen the limits.',
      runtime: { import: '@keel/game-engine/materials', call: 'paintMaterialAtlas({ exemplar: decodeMaterialExemplar(bytes), seed, variance })', layout: 'Each family is a block of columns x columns cells, blocks across per row, as in the sheet; atlas.art is one texel per art pixel, atlas.rgba the full-size texture.' },
      ...LOCAL_ONLY,
    };
  },
};

export const MATERIAL_TOOL_DEFINITIONS: readonly ToolDefinition[] = [guide, distill];
