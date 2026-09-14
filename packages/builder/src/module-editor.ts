import { lstat, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { createKeelModuleInclusions, type IncludedKeelModule } from "./module-inclusion.js";
import { createKeelGlobalDeclarations } from "./module-global-types.js";

/** Refresh the exact inclusion set for the ordinary TypeScript/VS Code service. */
export async function syncKeelModuleEditor(root: string, modules: readonly IncludedKeelModule[], entries: readonly string[]) {
  root = path.resolve(root);
  const directory = path.join(root, ".keel");
  try { const info = await lstat(directory); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(".keel must be an ordinary directory."); }
  catch (error) { if ((error as {code?: string}).code !== "ENOENT") throw error; await mkdir(directory); }
  const included = createKeelModuleInclusions(root, modules);
  const generated = {
    "module-inclusions.d.ts": included.declarations,
    "globals.d.ts": createKeelGlobalDeclarations(root, entries.map(entry => path.resolve(root, entry))),
  };
  for (const [name, contents] of Object.entries(generated)) {
    const file = path.join(directory, name);
    try { const info = await lstat(file); if (!info.isFile() || info.isSymbolicLink()) throw new Error("Generated declarations must be ordinary files."); }
    catch (error) { if ((error as {code?: string}).code !== "ENOENT") throw error; }
    await writeFile(file, contents);
  }
  return { ...included, files: Object.keys(generated).map(name => path.join(directory, name)) };
}

/** Type-check against the freshly generated set, never stale editor globals. */
export function checkKeelModuleEditor(root: string, entries: readonly string[], declarations: readonly string[]) {
  const configPath = ts.findConfigFile(root, ts.sys.fileExists);
  const config = configPath ? ts.readConfigFile(configPath, ts.sys.readFile) : undefined;
  if (config?.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
  const configured = config ? ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath!)).options : {};
  const program = ts.createProgram([...entries.map(entry => path.resolve(root, entry)), ...declarations], {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true, skipLibCheck: true, types: [], ...configured, noEmit: true,
  });
  const errors = ts.getPreEmitDiagnostics(program).filter(item => item.category === ts.DiagnosticCategory.Error);
  if (errors.length) throw new Error(ts.formatDiagnostics(errors, {getCurrentDirectory: () => root, getCanonicalFileName: name => name, getNewLine: () => "\n"}));
}

/** Keep editor globals current as files or the inclusion list change. */
export async function watchKeelModuleEditor(root: string, entries: readonly string[], includes = "keel.includes.json", onError: (error: unknown) => void = console.error) {
  if (!ts.sys.watchDirectory) throw new Error("This host does not support directory watching.");
  root = path.resolve(root);
  const refresh = async () => {
    const source = ts.sys.readFile(path.join(root, includes));
    if (source === undefined) throw new Error(`Missing ${includes}`);
    return syncKeelModuleEditor(root, JSON.parse(source), entries);
  };
  await refresh();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let queue = Promise.resolve();
  const watcher = ts.sys.watchDirectory(root, file => {
    const relative = path.relative(root, file).split(path.sep).join("/");
    if (relative.split("/").some(part => ["node_modules", ".keel", "dist", ".git"].includes(part))) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => { queue = queue.then(async () => { await refresh(); }).catch(onError); }, 200);
  }, true);
  return { close() { if (timer !== undefined) clearTimeout(timer); watcher.close(); } };
}
