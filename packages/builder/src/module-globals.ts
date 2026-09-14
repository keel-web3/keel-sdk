import ts from "typescript";

/** Compile only the imported SDK helper, including aliases. Symbol identity
 * keeps a shadowing local function from receiving compiler arguments. */
export function injectKeelModuleGlobals(source: string, sourcePath: string): string {
  const file = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true,
    /\.[jt]sx$/u.test(sourcePath) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const host = ts.createCompilerHost({ noLib: true, noResolve: true });
  host.getSourceFile = (name) => name === sourcePath ? file : undefined;
  const program = ts.createProgram([sourcePath], { noLib: true, noResolve: true }, host);
  const checker = program.getTypeChecker();
  const symbols = new Set<ts.Symbol>();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "@keel/sdk/module" || statement.importClause?.isTypeOnly) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const binding of bindings.elements) {
      if (binding.isTypeOnly || (binding.propertyName ?? binding.name).text !== "declareGlobals") continue;
      const symbol = checker.getSymbolAtLocation(binding.name);
      if (symbol) symbols.add(symbol);
    }
  }
  if (symbols.size === 0) return source;
  const result = ts.transform(file, [(context) => {
    const visit: ts.Visitor = (node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const symbol = checker.getSymbolAtLocation(node.expression);
        if (symbol && symbols.has(symbol)) {
          if (node.arguments.length < 1 || node.arguments.length > 2 || node.arguments.some(ts.isSpreadElement)) {
            throw new TypeError("declareGlobals expects values and an optional name; its source path is compiler-owned.");
          }
          return context.factory.updateCallExpression(node, node.expression, node.typeArguments, [
            ...node.arguments.map((argument) => ts.visitNode(argument, visit) as ts.Expression),
            ...(node.arguments.length === 1 ? [context.factory.createIdentifier("undefined")] : []),
            context.factory.createStringLiteral(sourcePath),
          ]);
        }
      }
      return ts.visitEachChild(node, visit, context);
    };
    return (input) => ts.visitNode(input, visit) as ts.SourceFile;
  }]);
  try { return ts.createPrinter().printFile(result.transformed[0]!); }
  finally { result.dispose(); }
}
