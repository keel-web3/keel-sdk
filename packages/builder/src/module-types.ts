import { readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { canonicalJson, createIntegrity, verifyIntegrity, utf8ToBytes, type KeelBuildRecipe } from "@keel/protocol";

/** Declarations are derived from the same input graph as the runtime recipe.
 * They describe an API; neither declarations nor a matching digest confer review status. */
export async function createKeelModuleTypes(root: string, recipe: KeelBuildRecipe) {
  root = path.resolve(root);
  for (const input of recipe.inputs) {
    const target = path.resolve(root, input.path);
    if (!target.startsWith(root + path.sep)) throw new Error("Module type input escapes verified root.");
    if (!await verifyIntegrity(new Uint8Array(await readFile(target)), input.integrity)) {
      throw new Error(`Module type input differs from runtime recipe: ${input.path}`);
    }
  }
  const files: Record<string, string> = Object.create(null) as Record<string, string>;
  const outDir = path.join(root, ".keel-types");
  const program = ts.createProgram({
    rootNames: recipe.inputs.map((input) => path.join(root, input.path)),
    options: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      declaration: true, emitDeclarationOnly: true, declarationMap: false,
      allowJs: true, checkJs: false, strict: true, skipLibCheck: true,
      rootDir: root, outDir, types: [],
    },
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  const sources = [];
  for (const source of program.getSourceFiles()) {
    if (program.isSourceFileDefaultLibrary(source)) continue;
    const relative = path.relative(root, source.fileName).split(path.sep).join("/");
    if (relative.startsWith("../") || path.isAbsolute(relative)) throw new Error("Module types depend on a source outside the verified root.");
    sources.push({ path: relative, integrity: await createIntegrity(utf8ToBytes(source.text)) });
  }
  const result = program.emit(undefined, (file, content) => {
    const relative = path.relative(outDir, file).split(path.sep).join("/");
    if (relative.startsWith("../") || path.isAbsolute(relative)) throw new Error("Module declaration escaped its output directory.");
    files[relative] = content;
  }, undefined, true);
  const errors = [...diagnostics, ...result.diagnostics].filter((item) => item.category === ts.DiagnosticCategory.Error);
  if (result.emitSkipped || errors.length) throw new Error(`Module type generation failed: ${errors.map((item) => ts.flattenDiagnosticMessageText(item.messageText, "\n")).join("\n")}`);
  const ordered = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  return {
    schema: "keel-module-types@1" as const,
    compiler: { name: "typescript", version: ts.version },
    recipeDigest: (await createIntegrity(utf8ToBytes(canonicalJson(recipe)))).digest,
    output: recipe.output.integrity,
    sources: sources.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
    files: ordered,
    integrity: await createIntegrity(utf8ToBytes(canonicalJson(ordered))),
  };
}
