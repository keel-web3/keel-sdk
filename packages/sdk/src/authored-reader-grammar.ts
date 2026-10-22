/** Node-only qualification for the unchanged registered static module reader.
 * Compact preserves literal values and legal notice text while keeping module
 * words out of non-code spans; Raw is inspected without changing one byte. */
import ts from "typescript";

const identifier = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;
function incompatible(id: string, detail: string): never {
  throw new TypeError(`Module ${id} uses unsupported current-reader syntax (${detail}). Preserve its original source and use compatible Compact authoring or explicit supported static imports/exports before preparing a paid plan.`);
}
function moduleStatement(statement: ts.Statement) {
  return ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement) || ts.isExportAssignment(statement)
    || ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
}
function moduleSpecifier(node: ts.Node): boolean {
  return (ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent)) && node.parent.moduleSpecifier === node;
}
function tagged(node: ts.Node): boolean {
  return ts.isTaggedTemplateExpression(node.parent)
    || ts.isTemplateExpression(node.parent) && ts.isTaggedTemplateExpression(node.parent.parent)
    || ts.isTemplateSpan(node.parent) && ts.isTemplateExpression(node.parent.parent) && ts.isTaggedTemplateExpression(node.parent.parent.parent);
}
function escaped(value: string) {
  // These are JavaScript source escapes, not changes to the literal's value.
  return JSON.stringify(value).slice(1, -1).replace(/\u2028/gu, "\\u2028").replace(/\u2029/gu, "\\u2029")
    .replace(/\b(?:import|export)\b/gu, word => `\\u${word.charCodeAt(0).toString(16).padStart(4, "0")}${word.slice(1)}`);
}

export function normalizeAuthoredReaderText(source: string, id: string): string {
  // Hashbang is an ignored source-leading directive in normal module parsing,
  // but cannot appear inside the registered IIFE. Compact omits that directive;
  // Raw is checked below without modifying its original bytes.
  if (source.startsWith("#!")) source = source.replace(/^#![^\r\n]*/u, "");
  const parsed = ts.createSourceFile(id, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  const replacements = new Map<number, { end: number; text: string }>(), literals: { start: number; end: number }[] = [];
  const comments = new Map<number, ts.CommentRange>();
  const visit = (node: ts.Node) => {
    const start = node.getStart(parsed), end = node.end;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isRegularExpressionLiteral(node)) {
      literals.push({ start, end });
      if (!moduleSpecifier(node) && !tagged(node) && !ts.isRegularExpressionLiteral(node)) {
        let value = escaped(node.text);
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) value = `"${value}"`;
        else {
          value = value.replace(/`/gu, "\\`").replace(/\$\{/gu, "\\${");
          value = ts.isTemplateHead(node) ? `\`${value}\${` : ts.isTemplateMiddle(node) ? `}${value}\${` : `}${value}\``;
        }
        replacements.set(start, { end, text: value });
      }
    }
    for (const range of [...(ts.getLeadingCommentRanges(source, node.pos) ?? []), ...(ts.getTrailingCommentRanges(source, node.end) ?? [])]) comments.set(range.pos, range);
    node.forEachChild(visit);
  };
  visit(parsed);
  for (const range of comments.values()) {
    if (literals.some(literal => range.pos < literal.end && range.end > literal.start)) continue;
    const prefix = source.slice(range.pos, range.pos + 2), block = range.kind === ts.SyntaxKind.MultiLineCommentTrivia;
    const body = source.slice(range.pos + 2, block ? range.end - 2 : range.end);
    // Standard decorative comment prefixes keep complete notice words and
    // line breaks while preventing a regex reader from treating them as code.
    const text = prefix + body.replace(/[;\n}]/gu, boundary => `${boundary}* `) + (block ? "*/" : "");
    replacements.set(range.pos, { end: range.end, text });
  }
  for (const [start, replacement] of [...replacements].sort(([left], [right]) => right - left)) source = source.slice(0, start) + replacement.text + source.slice(replacement.end);
  // The retained registered frame's outer detector accepts start/semicolon/
  // newline, while its internal export transform also accepts a closing brace.
  // Put every actual module declaration at an explicit line boundary; otherwise
  // a minified `function f(){}export{f}` is never sent through that transform.
  const canonical = ts.createSourceFile(id, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  for (const statement of [...canonical.statements].filter(moduleStatement).reverse()) {
    const start = statement.getStart(canonical);
    if (start > 0 && source[start - 1] !== "\n") source = source.slice(0, start) + "\n" + source.slice(start);
  }
  assertAuthoredReaderGrammar(source, id);
  return source;
}

export function assertAuthoredReaderGrammar(source: string, id: string): void {
  if (source.startsWith("#!")) incompatible(id, "Raw hashbang cannot execute inside the registered module wrapper; Compact removes it");
  const parsed = ts.createSourceFile(id, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  const declarations = parsed.statements.filter(moduleStatement);
  if (declarations.length && !/(^|[;\n])\s*(?:import|export)\b/u.test(source)) incompatible(id, "Raw module declaration misses the registered frame's execution boundary; Compact inserts a compatible separator");
  const starts = new Set(declarations.map(statement => statement.getStart(parsed)));
  const observed = new Set<number>();
  for (const match of source.matchAll(/(^|[;\n}])\s*(import|export)\b/gu)) {
    const offset = match.index! + match[0].length - match[2]!.length;
    if (!starts.has(offset)) incompatible(id, "module-looking text inside a literal, comment, regex or tagged template");
    observed.add(offset);
  }
  for (const statement of declarations) {
    if (!observed.has(statement.getStart(parsed))) incompatible(id, "module declaration is not recognizable by the registered reader");
    const text = statement.getText(parsed);
    if (ts.isImportDeclaration(statement)) {
      const match = /^import\s*(?:([^;\n]+?)\s*from\s*)?(["'])([^"']+)\2\s*;?$/u.exec(text);
      if (!match || !ts.isStringLiteral(statement.moduleSpecifier) || match[3] !== statement.moduleSpecifier.text) incompatible(id, "noncanonical or escaped static import; Compact links exact graph paths");
      const clause = match[1]?.trim();
      if (clause && !identifier.test(clause) && !/^\*\s+as\s+[A-Za-z_$][A-Za-z0-9_$]*$/u.test(clause)
        && !(clause.startsWith("{") && clause.endsWith("}") && namedList(clause.slice(1, -1)))) incompatible(id, "noncanonical import bindings");
    } else if (ts.isExportDeclaration(statement)) {
      const match = /^export\s*\{([^}]*)\}\s*(?:from\s*(["'])([^"']+)\2\s*)?;?$/u.exec(text);
      if (!match || !namedList(match[1]!) || (statement.moduleSpecifier ? !ts.isStringLiteral(statement.moduleSpecifier) || match[3] !== statement.moduleSpecifier.text : match[3] !== undefined)) incompatible(id, "noncanonical named export or escaped source reference");
    } else if (ts.isVariableStatement(statement)) {
      const name = statement.declarationList.declarations[0]?.name;
      if (statement.declarationList.declarations.length !== 1 || !name || !ts.isIdentifier(name) || !identifier.test(name.getText(parsed))
        || /^export\s+(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/u.exec(text)?.[1] !== name.getText(parsed)) incompatible(id, "Raw direct exports require one exact identifier per declaration; Compact preserves a multiple-const export");
    } else if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
      if (!statement.name || !identifier.test(statement.name.getText(parsed)) || /^export\s+(?:(?:async\s+)?function|class)\s+([A-Za-z_$][A-Za-z0-9_$]*)/u.exec(text)?.[1] !== statement.name.getText(parsed)) incompatible(id, "noncanonical direct export name");
    } else incompatible(id, "unsupported module boundary");
  }
}
function namedList(source: string): boolean {
  return source.split(",").map(value => value.trim()).filter(Boolean).every(value => /^([A-Za-z_$][A-Za-z0-9_$]*)(?:\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*))?$/u.test(value));
}
