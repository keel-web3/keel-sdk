import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { createIntegrity } from "@keel/protocol";
import type { ModuleObservation } from "./module-observation.js";

/** Prepare an uploaded classic script without claiming source verification.
 * Observed global names are tied to the exact uploaded bytes. Arguments and
 * return types come from static source inference, not invented runtime types. */
export async function prepareUnverifiedClassicModule(input: {
  readonly name: string;
  readonly source: string;
  readonly observation: ModuleObservation;
  readonly outputDirectory: string;
}) {
  if (!/^[a-z][a-z0-9-]{0,63}$/u.test(input.name)) throw new Error("Invalid module name.");
  if (new TextEncoder().encode(input.source).length > 8_000_000) throw new Error("Module exceeds discovery byte budget.");
  const integrity = await createIntegrity(new TextEncoder().encode(input.source));
  if (input.observation.digest !== integrity.digest || input.observation.schema !== "keel-module-observation@1") throw new Error("Sandbox observations do not match uploaded bytes.");
  const fileName = "/keel-upload.js";
  const options: ts.CompilerOptions = { allowJs: true, checkJs: false, target: ts.ScriptTarget.ES2022, noEmit: true, types: [], skipLibCheck: true };
  const host = ts.createCompilerHost(options);
  const readSource = host.getSourceFile.bind(host);
  host.getSourceFile = (name, version, error, create) => name === fileName ? ts.createSourceFile(name, input.source, version, true, ts.ScriptKind.JS) : readSource(name, version, error, create);
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
  for (const [name, observed] of Object.entries(input.observation.globals)) {
    if (!/^[A-Za-z_$][\w$]*$/u.test(name) || ["__proto__", "constructor", "prototype"].includes(name)) throw new Error("Invalid observed global name.");
    const node = values.get(name);
    let type = node ? checker.typeToString(checker.getTypeAtLocation(node), node, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseStructuralFallback) : "unknown";
    // Runtime arity cannot establish argument/return types. Unknown stays visible.
    type = type.replace(/\bany\b/gu, "unknown");
    if (!node && observed.kind === "function") type = "(...args: unknown[]) => unknown";
    const resolvedType = validType(name, type);
    if (!resolvedType) type = observed.kind === "function" ? "(...args: unknown[]) => unknown" : "unknown";
    if (!validType(name, type)) throw new Error("Observed global cannot be represented as an exported identifier.");
    declarations.push(`export declare const ${name}: ${type};`);
    runtime.push(`export const ${name} = globalThis[${JSON.stringify(name)}];`);
    confidence[name] = node && resolvedType ? "source-inferred" : "sandbox-observed-unknown-types";
  }
  const names = Object.keys(input.observation.globals);
  if (!names.length) throw new Error("Sandbox discovered no own global API. Supply declarations or an ESM entry.");
  const bootstrap = `const names=${JSON.stringify(names)};for(const name of names){if(Object.hasOwn(globalThis,name))throw new Error('Global already occupied: '+name)}const script=document.createElement('script');script.textContent=${JSON.stringify(input.source)};document.head.append(script);for(const name of names){if(!Object.hasOwn(globalThis,name))throw new Error('Observed global was not initialized: '+name)}\n`;
  const requested = path.resolve(input.outputDirectory);
  const root = path.join(await realpath(path.dirname(requested)), path.basename(requested));
  await mkdir(root); // New directory only: never overwrite an existing package.
  await writeFile(path.join(root, "index.js"), bootstrap + runtime.join("\n"));
  await writeFile(path.join(root, "index.d.ts"), declarations.join("\n") + "\n");
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: `@keel-modules/${input.name}`, version: "0.0.0", type: "module", main: "./index.js", types: "./index.d.ts", exports: { ".": { types: "./index.d.ts", import: "./index.js" } } }, null, 2));
  const record = { schema: "keel-inferred-module@1", source: integrity, verification: "unverified", confidence, observation: input.observation };
  await writeFile(path.join(root, "keel-inferred-module.json"), JSON.stringify(record, null, 2));
  return { directory: root, names, confidence, verification: "unverified" as const };
}
