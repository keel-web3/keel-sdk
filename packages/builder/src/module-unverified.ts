import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { createIntegrity } from "@keel/protocol";
import type { ModuleObservation } from "./module-observation.js";

/** Prepare an uploaded classic script without claiming source verification.
 * Observed global names are tied to the exact uploaded bytes. Arguments and
 * return types come from static source inference, not invented runtime types. */
export async function inferUnverifiedModule(input: {
  readonly name: string;
  readonly source: string;
  readonly observation: ModuleObservation;
  readonly format?: "classic" | "esm";
}) {
  if (!/^[a-z][a-z0-9-]{0,63}$/u.test(input.name)) throw new Error("Invalid module name.");
  if (new TextEncoder().encode(input.source).length > 8_000_000) throw new Error("Module exceeds discovery byte budget.");
  const integrity = await createIntegrity(new TextEncoder().encode(input.source));
  if (input.observation.digest !== integrity.digest || input.observation.schema !== "keel-module-observation@1") throw new Error("Sandbox observations do not match uploaded bytes.");
  const fileName = "/keel-upload.js";
  const options: ts.CompilerOptions = { allowJs: true, checkJs: false, target: ts.ScriptTarget.ES2022, noEmit: true, types: [], skipLibCheck: true };
  const host = ts.createCompilerHost(options);
  const readSource = host.getSourceFile.bind(host);
  const libraryDirectory = path.dirname(ts.getDefaultLibFilePath(options));
  host.getSourceFile = (name, version, error, create) => name === fileName ? ts.createSourceFile(name, input.source, version, true, ts.ScriptKind.JS) : path.dirname(name) === libraryDirectory ? readSource(name, version, error, create) : undefined;
  const program = ts.createProgram([fileName], options, host);
  if (program.getSyntacticDiagnostics().length) throw new Error("Uploaded script has syntax errors.");
  const checker = program.getTypeChecker();
  const file = program.getSourceFile(fileName)!;
  const values = new Map<string, ts.Node>();
  for (const statement of file.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) values.set(statement.name.text, statement.name);
    if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name)) values.set(declaration.name.text, declaration.name);
    }
    if (ts.isExpressionStatement(statement) && ts.isBinaryExpression(statement.expression) && statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const { left, right } = statement.expression;
      if (ts.isPropertyAccessExpression(left) && ts.isIdentifier(left.expression) && ["globalThis", "window", "self"].includes(left.expression.text)) values.set(left.name.text, right);
    }
  }
  if (input.format === "esm") {
    const symbol = checker.getSymbolAtLocation(file);
    if (!symbol) throw new Error("Uploaded source is not an ESM module.");
    for (const item of checker.getExportsOfModule(symbol)) {
      const resolved = item.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(item) : item;
      const node = resolved.valueDeclaration ?? resolved.declarations?.[0];
      if (node) values.set(item.name, node);
    }
  }
  const validType = (name: string, type: string) => {
    const probe = "/keel-inferred.d.ts";
    const declaration = `export declare const ${name}: ${type};`;
    const typeHost = ts.createCompilerHost(options);
    const original = typeHost.getSourceFile.bind(typeHost);
    typeHost.getSourceFile = (name, version, error, create) => name === probe ? ts.createSourceFile(name, declaration, version, true) : original(name, version, error, create);
    const check = ts.createProgram([probe], {...options, skipLibCheck: false}, typeHost);
    return ts.getPreEmitDiagnostics(check).length === 0;
  };
  const runtime: string[] = [];
  const declarations: string[] = [];
  const confidence: Record<string, string> = {};
  const observedValues = input.format === "esm" ? input.observation.exports : input.observation.globals;
  for (const [name, observed] of Object.entries(observedValues)) {
    if (!/^[A-Za-z_$][\w$]*$/u.test(name) || ["__proto__", "constructor", "prototype"].includes(name)) throw new Error("Invalid observed global name.");
    const node = values.get(name);
    let type = node ? checker.typeToString(checker.getTypeAtLocation(node), node, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseStructuralFallback) : "unknown";
    // Runtime arity cannot establish argument/return types. Unknown stays visible.
    type = type.replace(/\bany\b/gu, "unknown");
    if (!node && observed.kind === "function") type = "(...args: unknown[]) => unknown";
    const declarationName = name === "default" && input.format === "esm" ? "defaultExport" : name;
    const resolvedType = validType(declarationName, type);
    if (!resolvedType) type = observed.kind === "function" ? "(...args: unknown[]) => unknown" : "unknown";
    if (!validType(declarationName, type)) throw new Error("Observed global cannot be represented as an exported identifier.");
    declarations.push(name === "default" && input.format === "esm" ? `declare const defaultExport: ${type}; export default defaultExport;` : `export declare const ${name}: ${type};`);
    runtime.push(`export const ${name} = globalThis[${JSON.stringify(name)}];`);
    confidence[name] = node && resolvedType ? "source-inferred" : "sandbox-observed-unknown-types";
  }
  const names = Object.keys(observedValues);
  if (!names.length) throw new Error("Sandbox discovered no own global API. Supply declarations or an ESM entry.");
  const bootstrap = `const names=${JSON.stringify(names)};for(const name of names){if(Object.hasOwn(globalThis,name))throw new Error('Global already occupied: '+name)}const script=document.createElement('script');script.textContent=${JSON.stringify(input.source)};document.head.append(script);for(const name of names){if(!Object.hasOwn(globalThis,name))throw new Error('Observed global was not initialized: '+name)}\n`;
  const record = { schema: "keel-inferred-module@1", source: integrity, verification: "unverified", confidence, observation: input.observation };
  const files: Readonly<Record<string, string>> = {
    "index.js": input.format === "esm" ? input.source : bootstrap + runtime.join("\n"),
    "index.d.ts": declarations.join("\n") + "\n",
    "package.json": JSON.stringify({ name: `@keel-modules/${input.name}`, version: "0.0.0", type: "module", main: "./index.js", types: "./index.d.ts", exports: { ".": { types: "./index.d.ts", import: "./index.js" } } }, null, 2),
    "keel-inferred-module.json": JSON.stringify(record, null, 2),
  };
  return { files, names, confidence, verification: "unverified" as const };
}

export async function inferUnverifiedClassicModule(input: Omit<Parameters<typeof inferUnverifiedModule>[0], "format">) { return inferUnverifiedModule({...input, format: "classic"}); }

export async function prepareUnverifiedClassicModule(input: Parameters<typeof inferUnverifiedClassicModule>[0] & { readonly outputDirectory: string }) {
  const result = await inferUnverifiedClassicModule(input);
  const requested = path.resolve(input.outputDirectory);
  const root = path.join(await realpath(path.dirname(requested)), path.basename(requested));
  await mkdir(root); // New directory only: never overwrite an existing package.
  for (const [name, contents] of Object.entries(result.files)) await writeFile(path.join(root, name), contents);
  return { directory: root, names: result.names, confidence: result.confidence, verification: result.verification };
}
