import path from "node:path";
import ts from "typescript";

export interface IncludedKeelModule {
  readonly name: string;
  readonly specifier: string;
  readonly aliases?: Readonly<Record<string, string>>;
}
const browserNames = new Set(["stop", "close", "open", "name", "location", "history", "screen", "status", "frames", "parent", "top", "self", "window", "document", "event", "fetch", "alert", "confirm", "prompt", "print", "focus", "blur", "scroll", "find"]);
const identifier = /^[A-Za-z_$][\w$]*$/u;

/** One inclusion list feeds editor globals and emitted runtime bindings. */
export function createKeelModuleInclusions(root: string, modules: readonly IncludedKeelModule[], virtualFiles: Readonly<Record<string, string>> = {}) {
  const probe = path.join(root, ".keel-module-inclusion.ts");
  const source = modules.map((module, index) => `import * as module${index} from ${JSON.stringify(module.specifier)};`).join("\n");
  const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, noEmit: true, skipLibCheck: true, types: [] };
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const readFile = host.readFile.bind(host);
  const directoryExists = host.directoryExists?.bind(host);
  host.fileExists = file => file in virtualFiles || fileExists(file);
  host.readFile = file => virtualFiles[file] ?? readFile(file);
  host.directoryExists = directory => Object.keys(virtualFiles).some(file => file.startsWith(directory + path.sep)) || directoryExists?.(directory) === true;
  host.getSourceFile = (file, version, onError, create) => file === probe ? ts.createSourceFile(file, source, version, true) : virtualFiles[file] !== undefined ? ts.createSourceFile(file, virtualFiles[file]!, version, true) : original(file, version, onError, create);
  const program = ts.createProgram([probe], options, host);
  const checker = program.getTypeChecker();
  const file = program.getSourceFile(probe)!;
  const runtime = [source];
  const declarations: string[] = [];
  const names = new Map<string, ts.Symbol>();
  let index = 0;
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const module = modules[index]!;
    if (!identifier.test(module.name)) throw new Error("Included module name must be a JavaScript identifier.");
    const symbol = checker.getSymbolAtLocation(statement.moduleSpecifier);
    if (!symbol) throw new Error(`Module ${module.specifier} is not installed with declarations.`);
    for (const item of checker.getExportsOfModule(symbol)) {
      const resolved = item.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(item) : item;
      if (!(resolved.flags & ts.SymbolFlags.Value)) continue;
      const exported = item.name;
      const shortName = exported === "default" ? module.name : exported.replace(/^KEEL_/, "");
      const alias = module.aliases?.[exported] ?? (browserNames.has(shortName) ? `${module.name}_${shortName}` : shortName);
      const globalName = exported.startsWith("KEEL_") ? exported : `KEEL_${module.name}_${exported === "default" ? module.name : exported}`;
      for (const name of new Set([alias, globalName])) {
        if (!identifier.test(name)) throw new Error(`Invalid module binding: ${name}`);
        if (names.has(name)) {
          if (names.get(name) === resolved) continue;
          throw new Error(`Ambiguous module binding: ${name}`);
        }
        names.set(name, resolved);
        runtime.push(`const ${name} = module${index}[${JSON.stringify(exported)}];`);
        runtime.push(`export { ${name} };`);
        declarations.push(`  const ${name}: typeof import(${JSON.stringify(module.specifier)})[${JSON.stringify(exported)}];`);
      }
      runtime.push(`if(Object.hasOwn(globalThis,${JSON.stringify(globalName)})&&globalThis[${JSON.stringify(globalName)}]!==module${index}[${JSON.stringify(exported)}])throw new Error(${JSON.stringify(`Global already occupied: ${globalName}`)});`);
      runtime.push(`if(!Object.hasOwn(globalThis,${JSON.stringify(globalName)}))Object.defineProperty(globalThis,${JSON.stringify(globalName)},{value:module${index}[${JSON.stringify(exported)}],enumerable:true});`);
    }
    index += 1;
  }
  return { runtime: runtime.join("\n"), declarations: `export {};\ndeclare global {\n${declarations.join("\n")}\n}\n`, names: [...names.keys()] };
}
