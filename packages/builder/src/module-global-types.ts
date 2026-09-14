import path from "node:path";
import ts from "typescript";

/** Editor declarations for exported globals use typeof imports of the creator
 * source, so edits retain normal live TypeScript inference. */
export function createKeelGlobalDeclarations(root: string, files: readonly string[]): string {
  const program = ts.createProgram([...files], { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, noEmit: true, skipLibCheck: true });
  const checker = program.getTypeChecker();
  const entries = new Map<string, string>();
  for (const file of program.getSourceFiles()) {
    const relative = path.relative(root, file.fileName).split(path.sep).join("/");
    if (relative.startsWith("../") || relative.includes("node_modules/") || file.isDeclarationFile) continue;
    const helpers = new Set<ts.Symbol>();
    for (const statement of file.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== "@keel/sdk/module") continue;
      const bindings = statement.importClause?.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings)) continue;
      for (const binding of bindings.elements) {
        if ((binding.propertyName ?? binding.name).text === "declareGlobals" && !binding.isTypeOnly) {
          const symbol = checker.getSymbolAtLocation(binding.name);
          if (symbol) helpers.add(symbol);
        }
      }
    }
    for (const statement of file.statements) {
      if (!ts.isVariableStatement(statement) || !statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
      for (const declaration of statement.declarationList.declarations) {
        const call = declaration.initializer;
        if (!ts.isIdentifier(declaration.name) || !call || !ts.isCallExpression(call) || !ts.isIdentifier(call.expression)) continue;
        const symbol = checker.getSymbolAtLocation(call.expression);
        if (!symbol || !helpers.has(symbol)) continue;
        const custom = call.arguments[1];
        if (custom && !ts.isStringLiteral(custom)) throw new Error("Shared global names must be string literals for automatic IDE typing.");
        const name = custom?.text ?? relative;
        if (entries.has(name)) throw new Error(`Duplicate shared global namespace: ${name}`);
        const specifier = `../${relative.replace(/\.[cm]?[jt]sx?$/u, "")}`;
        entries.set(name, `typeof import(${JSON.stringify(specifier)})[${JSON.stringify(declaration.name.text)}]`);
      }
    }
  }
  return 'import "@keel/sdk/module";\n\ndeclare module "@keel/sdk/module" {\n  interface GlobalModules {\n' +
    [...entries].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, type]) => `    ${JSON.stringify(name)}: ${type};`).join("\n") + '\n  }\n}\n';
}
