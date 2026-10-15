/** Read migration declarations without mistaking comments or SQL strings for
 * table definitions. PostgreSQL folds unquoted identifiers to lower case. */
export function collectMigrationTableNames(sql) {
  const tokens = [];
  for (let i = 0; i < sql.length;) {
    if (/\s/u.test(sql[i])) { i++; continue; }
    if (sql.startsWith('--', i)) { const end = sql.indexOf('\n', i + 2); i = end < 0 ? sql.length : end + 1; continue; }
    if (sql.startsWith('/*', i)) {
      let depth = 1; i += 2;
      while (i < sql.length && depth) { if (sql.startsWith('/*', i)) { depth++; i += 2; } else if (sql.startsWith('*/', i)) { depth--; i += 2; } else i++; }
      continue;
    }
    const dollar = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/u.exec(sql.slice(i));
    if (dollar) { const end = sql.indexOf(dollar[0], i + dollar[0].length); i = end < 0 ? sql.length : end + dollar[0].length; continue; }
    if (sql[i] === "'") {
      i++;
      while (i < sql.length) { if (sql[i++] === "'") { if (sql[i] === "'") i++; else break; } }
      continue;
    }
    if (sql[i] === '"') {
      let value = ''; i++;
      while (i < sql.length) { const character = sql[i++]; if (character === '"') { if (sql[i] === '"') { value += '"'; i++; } else break; } else value += character; }
      tokens.push({ kind: 'identifier', value }); continue;
    }
    const word = /^[A-Za-z_][A-Za-z0-9_$]*/u.exec(sql.slice(i));
    if (word) { tokens.push({ kind: 'word', value: word[0].toLowerCase() }); i += word[0].length; continue; }
    tokens.push({ kind: 'punctuation', value: sql[i++] });
  }
  const names = new Set();
  const keyword = (i, word) => tokens[i]?.kind === 'word' && tokens[i].value === word;
  const identifier = i => ['word', 'identifier'].includes(tokens[i]?.kind);
  for (let i = 0; i < tokens.length; i++) {
    if (!keyword(i, 'create')) continue;
    let next = i + 1;
    if (['temp', 'temporary', 'unlogged'].some(word => keyword(next, word))) next++;
    if (!keyword(next++, 'table')) continue;
    if (keyword(next, 'if')) { if (!keyword(next + 1, 'not') || !keyword(next + 2, 'exists')) continue; next += 3; }
    if (!identifier(next)) continue;
    let name = tokens[next++].value;
    if (tokens[next]?.value === '.') { if (!identifier(next + 1)) continue; name = tokens[next + 1].value; next += 2; }
    if (tokens[next]?.value === '(') names.add(name);
  }
  return names;
}

/** Recognize the maintained thin route and its actual auth-before-input handler.
 * This static structure gate supplements the runtime authorization tests. */
export function hasAuthenticatedProjectDelegate(ts, routeSource, handlerSource, handlerSpecifier) {
  const parse = source => ts.createSourceFile('policy.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const route = parse(routeSource), handler = parse(handlerSource);
  if (route.parseDiagnostics.length || handler.parseDiagnostics.length) return false;
  const imported = (file, module, name) => {
    for (const node of file.statements) if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)
      && node.moduleSpecifier.text === module && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
      const entry = node.importClause.namedBindings.elements.find(value => (value.propertyName?.text ?? value.name.text) === name);
      if (entry) return entry.name.text;
    }
  };
  const auth = imported(route, '~/server/security/account-session', 'requireCreatorSession');
  const delegated = imported(route, handlerSpecifier, 'handleProjectRequest');
  const origin = imported(handler, '~/server/security/write-access', 'assertSameOriginRequest');
  if (!auth || !delegated || !origin) return false;
  const exported = node => node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
  const post = route.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'POST' && exported(node));
  const request = post?.parameters[0]?.name;
  const returned = post?.body?.statements;
  if (!request || !ts.isIdentifier(request) || returned?.length !== 1 || !ts.isReturnStatement(returned[0])) return false;
  const call = returned[0].expression;
  if (!call || !ts.isCallExpression(call) || !ts.isIdentifier(call.expression) || call.expression.text !== delegated || call.arguments.length !== 2
    || !ts.isIdentifier(call.arguments[0]) || call.arguments[0].text !== request.text
    || !ts.isIdentifier(call.arguments[1]) || call.arguments[1].text !== auth) return false;
  const implementation = handler.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'handleProjectRequest' && exported(node));
  const input = implementation?.parameters[0]?.name, authorize = implementation?.parameters[1]?.name;
  const first = implementation?.body?.statements[0];
  if (!input || !authorize || !ts.isIdentifier(input) || !ts.isIdentifier(authorize) || !first || !ts.isTryStatement(first)) return false;
  const [originStatement, authStatement] = first.tryBlock.statements;
  const originCall = originStatement && ts.isExpressionStatement(originStatement) ? originStatement.expression : undefined;
  if (!originCall || !ts.isCallExpression(originCall) || !ts.isIdentifier(originCall.expression) || originCall.expression.text !== origin || originCall.arguments.length !== 1) return false;
  const headers = originCall.arguments[0];
  if (!ts.isPropertyAccessExpression(headers) || !ts.isIdentifier(headers.expression) || headers.expression.text !== input.text || headers.name.text !== 'headers') return false;
  if (!authStatement || !ts.isVariableStatement(authStatement) || authStatement.declarationList.declarations.length !== 1) return false;
  const awaited = authStatement.declarationList.declarations[0].initializer;
  if (!awaited || !ts.isAwaitExpression(awaited) || !ts.isCallExpression(awaited.expression)) return false;
  const authorization = awaited.expression;
  return ts.isIdentifier(authorization.expression) && authorization.expression.text === authorize.text && authorization.arguments.length === 1
    && ts.isIdentifier(authorization.arguments[0]) && authorization.arguments[0].text === input.text;
}
