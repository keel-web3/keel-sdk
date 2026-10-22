/** Node-side authoring. Source modules are parsed, never split or rewritten. */
import path from "node:path";
import { qualifyAuthoredPublishedModules, assertAuthoredPublishedRecords } from "./authored-published-modules.js";
import type { KeelAuthoredPublishedModuleInput, KeelAuthoredPublishedModule } from "./authored-project-graph.js";
import { build, transform } from "esbuild";
import ts from "typescript";
import { inspectKeelNativeSVG } from "./native-media-inspection.js";
import { canonicalJson, createIntegrity, resolveKeelPayloadStorage, type KeelPayloadStorageMode, type Integrity } from "@keel/protocol";
import type { KeelStudioStagedProjectFile } from "./studio-upload.js";

export { KEEL_AUTHORED_PROJECT_PROTOCOL } from "./authored-project-graph.js";
export type { KeelAuthoredModule, KeelAuthoredProjectInput, KeelAuthoredProjectNode, KeelAuthoredProjectEdge, KeelAuthoredProjectGraph } from "./authored-project-graph.js";
import { KEEL_AUTHORED_PROJECT_PROTOCOL, assertKeelAuthoredProjectCommitments, type KeelAuthoredModule, type KeelAuthoredProjectInput, type KeelAuthoredProjectNode, type KeelAuthoredProjectEdge, type KeelAuthoredProjectGraph } from "./authored-project-graph.js";
const encoder = new TextEncoder();
const idPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
function text(value: unknown, label: string, limit: number): string {
  if (typeof value !== "string" || !value.trim() || encoder.encode(value).byteLength > limit || value.includes("\0") || new TextDecoder().decode(encoder.encode(value)) !== value) throw new TypeError(`${label} is invalid or exceeds its UTF-8 byte budget.`);
  return value;
}
function exact(value: unknown, allowed: readonly string[], label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new TypeError(`${label} has unsupported fields.`);
}
function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
function localImport(importer: string, specifier: string): string {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) throw new TypeError(`Unresolved authored dependency ${JSON.stringify(specifier)}. Resolve exact selected-chain shared modules before staging.`);
  if (/[\\?#\u0000-\u001f\u007f]/u.test(specifier)) throw new TypeError("Authored imports require exact local module paths.");
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(importer), specifier));
  if (resolved.startsWith("../") || resolved === ".." || resolved.startsWith("/")) throw new TypeError("Authored dependency escapes its project.");
  return resolved;
}
/** Parses the complete graph with esbuild, retaining original module bytes. */
async function moduleEdges(files: readonly KeelStudioStagedProjectFile[], published: readonly KeelAuthoredPublishedModule[], publishedSources: readonly KeelAuthoredPublishedModuleInput[]): Promise<KeelAuthoredProjectEdge[]> {
  const sources = new Map(files.map(file => [file.path, file]));
  const sharedAliases = new Map(published.flatMap(module => module.aliases.map(alias => [alias, `published:${module.binding.moduleId}`] as const)));
  for (const module of publishedSources) sources.set(`published:${module.binding.moduleId}`, { path: `published:${module.binding.moduleId}`, bytes: module.source, mediaType: "text/javascript", role: "module", format: "es-module" });
  const edges = new Map<string, KeelAuthoredProjectEdge>();
  const result = await build({
    entryPoints: ["main.js"], bundle: true, write: false, metafile: true, treeShaking: true, format: "iife", platform: "browser", target: "es2022", logLevel: "silent",
    logOverride: { "unsupported-dynamic-import": "error", "unsupported-require-call": "error", "direct-eval": "error" },
    plugins: [{ name: "keel-authored-source-graph", setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => {
        const resolved = args.kind === "entry-point" ? args.path : sharedAliases.get(args.path) ?? localImport(args.importer, args.path);
        const file = sources.get(resolved);
        if (!file || file.format !== "es-module") return { errors: [{ text: `Unresolved authored JavaScript module: ${resolved}.` }] };
        if (args.kind === "require-call" || args.kind === "require-resolve" || args.kind === "dynamic-import") return { errors: [{ text: "The current authored reader requires static ES module imports, not dynamic or CommonJS loading." }] };
        if (args.kind !== "entry-point") {
          const edge = { consumer: args.importer, dependency: resolved, specifier: args.path };
          edges.set(canonicalJson(edge), edge);
        }
        return { path: resolved, namespace: "keel-authored" };
      });
      builder.onLoad({ filter: /.*/, namespace: "keel-authored" }, args => ({ contents: sources.get(args.path)!.bytes as Uint8Array, loader: "js" }));
    } }],
  });
  if (result.warnings.length) throw new TypeError(`Authored JavaScript needs review: ${result.warnings[0]!.text}`);
  const contributing = new Set(Object.values(result.metafile!.outputs).flatMap(output => Object.entries(output.inputs).filter(([, input]) => input.bytesInOutput > 0).map(([key]) => key.replace(/^keel-authored:/u, ""))));
  for (const file of files) if (file.path.startsWith("modules/") && !contributing.has(file.path)) throw new TypeError(`Nonfunctional authored module: ${file.path}. Unused or erased placeholders do not create a functional graph.`);
  const reached = new Set(["main.js", ...[...edges.values()].flatMap(edge => [edge.consumer, edge.dependency])]);
  for (const file of files) if (file.format === "es-module" && !reached.has(file.path)) throw new TypeError(`Disconnected authored module: ${file.path}. Splitting unused files does not create a functional graph.`);
  // Metafile import arrays retain each source's import declaration order.
  // Sorting dependencies by ID would reorder observable initialization effects.
  const ordered: KeelAuthoredProjectEdge[] = [];
  for (const [key, metadata] of Object.entries(result.metafile!.inputs).sort(([left], [right]) => left.localeCompare(right))) {
    const consumer = key.replace(/^keel-authored:/u, "");
    for (const imported of metadata.imports) {
      const dependency = imported.path.replace(/^keel-authored:/u, "");
      const edge = [...edges.values()].find(item => item.consumer === consumer && item.dependency === dependency && (imported.original === undefined || item.specifier === imported.original));
      if (!edge) throw new TypeError("The authored parser lost an exact dependency edge.");
      ordered.push(edge);
    }
  }
  return ordered;
}
/**
 * Materializes an agent's functional decomposition. It does not invent source
 * boundaries in supplied code or turn storage chunks into creator modules.
 */
export async function createKeelAuthoredProject(value: KeelAuthoredProjectInput) {
  value = structuredClone(value);
  exact(value, ["title", "chainId", "modules", "start", "stylesheet", "assets", "publishedModules"], "Authored project");
  const title = text(value.title, "Project title", 160);
  if (!Number.isSafeInteger(value.chainId) || value.chainId < 1) throw new TypeError("Authored project requires the selected chain ID.");
  if (!Array.isArray(value.modules) || value.modules.length < 2 || value.modules.length > 64) throw new TypeError("Author at least two functional JavaScript modules, at most 64; do not submit one flattened creator bundle.");
  exact(value.start, ["module", "export"], "Authored start");
  if (typeof value.start.export !== "string" || !/^[A-Za-z_$][\w$]*$/u.test(value.start.export)) throw new TypeError("Authored start requires an exported function name.");
  const publishedModules = await qualifyAuthoredPublishedModules(value.publishedModules, value.chainId);
  const ids = new Set<string>();
  const definitions: Array<{ id: string; path: string; purpose: string; source: string }> = [];
  let totalBytes = 0;
  for (const item of value.modules) {
    exact(item, ["id", "purpose", "source"], "Authored module");
    if (typeof item.id !== "string" || !idPattern.test(item.id) || item.id.length > 96 || ids.has(item.id) || /^(?:chunk|part|bundle)(?:-\d+)?$/u.test(item.id)) throw new TypeError("Authored modules require unique stable functional names, not byte-chunk names.");
    ids.add(item.id);
    const source = text(item.source, `Module ${item.id}`, 2_000_000);
    totalBytes += encoder.encode(source).byteLength;
    if (totalBytes > 8_000_000) throw new RangeError("Authored source exceeds the 8,000,000-byte planning budget.");
    definitions.push({ id: item.id, path: `modules/${item.id}.js`, purpose: text(item.purpose, `Purpose for ${item.id}`, 320), source });
  }
  if (!ids.has(value.start.module)) throw new TypeError("Authored start must name a functional module.");
  const stylesheet = value.stylesheet === undefined ? undefined : text(value.stylesheet, "Stylesheet", 1_000_000);
  if (value.assets !== undefined && (!Array.isArray(value.assets) || value.assets.length > 64)) throw new TypeError("Authored assets exceed the 64-resource planning bound.");
  const assetPaths = new Set<string>(); let assetBytes = 0;
  const assets = (value.assets ?? []).map(asset => {
    exact(asset, ["path", "purpose", "mediaType", "bytes"], "Authored asset");
    if (typeof asset.path !== "string" || !/^assets\/[a-z][a-z0-9._-]{0,95}$/u.test(asset.path) || assetPaths.has(asset.path)) throw new TypeError("Authored assets require unique stable single-directory paths.");
    assetPaths.add(asset.path);
    if (typeof asset.mediaType !== "string" || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u.test(asset.mediaType) || /^(?:text\/(?:html|javascript)|application\/(?:javascript|wasm))$/u.test(asset.mediaType)) throw new TypeError("Executable resources belong in functional modules, not asset data.");
    if (!(asset.bytes instanceof Uint8Array) || !asset.bytes.length || asset.bytes.length > 32_000_000) throw new TypeError("Authored asset needs exact nonempty bytes within its 32,000,000-byte planning budget.");
    assetBytes += asset.bytes.length; if (assetBytes > 64_000_000) throw new RangeError("Authored assets exceed the 64,000,000-byte planning budget.");
    if (asset.mediaType === "image/svg+xml") inspectKeelNativeSVG(asset.bytes);
    return { path: asset.path, mediaType: asset.mediaType, bytes: asset.bytes, purpose: text(asset.purpose, "Asset purpose", 320) };
  });
  const bootstrap = `import { ${value.start.export} as start } from "./modules/${value.start.module}.js";\nvoid start(document.getElementById("artwork"));\n`;
  const html = `<!doctype html>\n<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>${stylesheet === undefined ? "" : '<link rel="stylesheet" href="./style.css">'}</head><body><div id="artwork"></div><script type="module" src="./main.js"></script></body></html>\n`;
  const files: KeelStudioStagedProjectFile[] = [
    { path: "index.html", bytes: encoder.encode(html), mediaType: "text/html", role: "entrypoint", format: "asset" },
    { path: "main.js", bytes: encoder.encode(bootstrap), mediaType: "text/javascript", role: "module", format: "es-module" },
    ...definitions.map(item => ({ path: item.path, bytes: encoder.encode(item.source), mediaType: "text/javascript", role: "module" as const, format: "es-module" as const })),
    ...(stylesheet === undefined ? [] : [{ path: "style.css", bytes: encoder.encode(stylesheet), mediaType: "text/css", role: "style" as const, format: "asset" as const }]),
    ...assets.map(asset => ({ path: asset.path, bytes: asset.bytes, mediaType: asset.mediaType, role: "data" as const, format: "asset" as const })),
  ];
  const edges = await moduleEdges(files, publishedModules, value.publishedModules ?? []);
  for (const module of publishedModules) if (!edges.some(edge => edge.dependency === `published:${module.binding.moduleId}`)) throw new TypeError(`Unused published dependency ${module.binding.moduleId}; do not attach an unreachable library.`);
  for (const definition of definitions) {
    const parsed = ts.createSourceFile(definition.path, definition.source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ["bytes", "url"].includes(node.expression.name.text)) {
        const receiver = node.expression.expression;
        if (ts.isIdentifier(receiver) && receiver.text === "__KEEL_CONTENT__" || ts.isPropertyAccessExpression(receiver) && ts.isIdentifier(receiver.expression) && receiver.expression.text === "globalThis" && receiver.name.text === "__KEEL_CONTENT__") {
          const target = node.arguments[0];
          if (node.arguments.length !== 1 || !target || !ts.isStringLiteral(target) || !assetPaths.has(target.text)) throw new TypeError("Authored content reads require one exact declared asset identity; computed or unknown dependencies cannot be published.");
          edges.push({ consumer: definition.path, dependency: target.text, specifier: target.text });
        }
      }
      node.forEachChild(visit);
    }; visit(parsed);
  }
  for (const asset of assets) if (!edges.some(edge => edge.dependency === asset.path)) throw new TypeError(`Orphan authored asset: ${asset.path}.`);
  for (const file of files) if (file.format === "es-module") await compileAuthoredModule(new TextDecoder().decode(file.bytes as Uint8Array), file.path);
  if (stylesheet !== undefined) await assertAuthoredStylesheet(stylesheet);
  edges.push({ consumer: "index.html", dependency: "main.js", specifier: "./main.js" });
  if (stylesheet !== undefined) edges.push({ consumer: "index.html", dependency: "style.css", specifier: "./style.css" });
  authoredExecutionOrder(edges, files.length);
  const nodes: KeelAuthoredProjectNode[] = await Promise.all(files.map(async file => ({
    id: file.path, path: file.path, purpose: definitions.find(item => item.path === file.path)?.purpose ?? assets.find(asset => asset.path === file.path)?.purpose ?? (file.path === "index.html" ? "Creator artwork document" : file.path === "main.js" ? "Small execution bootstrap" : "Artwork styles"),
    mediaType: file.mediaType, role: file.role as KeelAuthoredProjectNode["role"], format: file.format as KeelAuthoredProjectNode["format"],
    integrity: { ...await createIntegrity(file.bytes as Uint8Array), byteLength: (file.bytes as Uint8Array).byteLength },
  })));
  const content = { schema: KEEL_AUTHORED_PROJECT_PROTOCOL, origin: "agent-authored" as const, architecture: "logical-es-modules" as const, chainId: value.chainId, entrypoint: "index.html" as const, nodes, edges, ...(publishedModules.length ? { publishedModules } : {}), publicationReady: false as const };
  const graph: KeelAuthoredProjectGraph = Object.freeze({ ...content, digest: await createIntegrity(encoder.encode(canonicalJson(content))) });
  return { graph, files, sourceBytes: files.reduce((sum, file) => sum + (file.bytes as Uint8Array).length, 0), authoredSourceBytes: totalBytes + assetBytes + (stylesheet === undefined ? 0 : encoder.encode(stylesheet).length), generatedBoundaryBytes: encoder.encode(bootstrap).length + encoder.encode(html).length, completePresentationBytes: null, publicationReady: false as const };
}

async function compileAuthoredModule(source: string, id: string): Promise<Uint8Array> {
  qualifyAuthoredModuleSyntax(source, id);
  const built = await transform(source, { loader: "js", sourcefile: id, format: "esm", target: "es2022", minify: false, legalComments: "inline" });
  if (built.warnings.length) throw new TypeError(`Module ${id} needs a current-reader syntax review.`);
  return encoder.encode(built.code);
}
function qualifyAuthoredModuleSyntax(source: string, id: string, raw = false): void {
  const parsed = ts.createSourceFile(id, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  qualifyAuthoredDependencies(parsed, id);
  const mutable = new Set<string>(), exported = new Set<string>();
  const names = (node: ts.BindingName): string[] => ts.isIdentifier(node) ? [node.text] : node.elements.flatMap(element => ts.isOmittedExpression(element) ? [] : names(element.name));
  const has = (node: ts.Node, kind: ts.SyntaxKind) => ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(modifier => modifier.kind === kind);
  const unsupported = () => { throw new TypeError(`Module ${id} uses syntax unsupported by the current registered static reader. Preserve its source and author compatible functional modules.`); };
  for (const statement of parsed.statements) {
    if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
      for (const name of names(declaration.name)) {
        if (!(statement.declarationList.flags & ts.NodeFlags.Const)) mutable.add(name);
        if (has(statement, ts.SyntaxKind.ExportKeyword)) exported.add(name);
      }
    }
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name && has(statement, ts.SyntaxKind.ExportKeyword)) exported.add(statement.name.text);
    if (ts.isExportDeclaration(statement)) {
      if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) unsupported();
      if (!statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause)) for (const element of statement.exportClause.elements) exported.add((element.propertyName ?? element.name).text);
    }
    if (ts.isImportDeclaration(statement)) {
      if (statement.importClause?.name && statement.importClause.namedBindings || raw && statement.getText(parsed).includes("\n")) unsupported();
    }
    if (raw && (ts.isExportAssignment(statement) || has(statement, ts.SyntaxKind.DefaultKeyword))) unsupported();
  }
  for (const name of exported) if (mutable.has(name)) unsupported();
  const assignedExports = (node: ts.Node): boolean => {
    if (ts.isIdentifier(node)) return exported.has(node.text);
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) return false;
    let found = false; node.forEachChild(child => { if (assignedExports(child)) found = true; }); return found;
  };
  const visit = (node: ts.Node) => {
    if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword
      || ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && ["eval", "require"].includes(node.expression.text))
      || (ts.isImportSpecifier(node) || ts.isExportSpecifier(node)) && (!ts.isIdentifier(node.name) || node.propertyName && !ts.isIdentifier(node.propertyName))) unsupported();
    if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment && assignedExports(node.left)
      || (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) && (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken) && assignedExports(node.operand)
      || (ts.isForOfStatement(node) || ts.isForInStatement(node)) && !ts.isVariableDeclarationList(node.initializer) && assignedExports(node.initializer)) unsupported();
    node.forEachChild(visit);
  };
  visit(parsed);
}
/** Restricted authoring grammar, plus the unchanged canonical sandbox/CSP.
 * This rejects declared network and code-loading dependencies before storage;
 * it does not claim to prove arbitrary JavaScript behavior by static analysis.
 */
function qualifyAuthoredDependencies(parsed: ts.SourceFile, id: string): void {
  const reject = () => { throw new TypeError(`Module ${id} has an external or computed execution dependency. Use exact declared __KEEL_CONTENT__.bytes/url assets and static local module imports.`); };
  const network = new Set(["fetch", "XMLHttpRequest", "WebSocket", "WebTransport", "EventSource", "Worker", "SharedWorker", "ServiceWorker", "importScripts", "sendBeacon", "Function", "eval", "atob"]);
  const resourceProperties = new Set(["src", "srcset", "href", "poster", "data", "action", "formaction", "srcdoc", "innerHTML", "outerHTML"]);
  const literal = (node: ts.Node): string | undefined => ts.isStringLiteralLike(node) ? node.text : undefined;
  const contentURL = (node: ts.Node): boolean => {
    if (ts.isAwaitExpression(node)) return contentURL(node.expression);
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression) || node.expression.name.text !== "url") return false;
    const receiver = node.expression.expression;
    return (ts.isIdentifier(receiver) && receiver.text === "__KEEL_CONTENT__" || ts.isPropertyAccessExpression(receiver) && ts.isIdentifier(receiver.expression) && receiver.expression.text === "globalThis" && receiver.name.text === "__KEEL_CONTENT__")
      && node.arguments.length === 1 && !!node.arguments[0] && ts.isStringLiteral(node.arguments[0]);
  };
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && network.has(node.text)) reject();
    if (ts.isStringLiteralLike(node)) {
      const value = node.text.trim();
      // XML namespace strings are identifiers, not fetched resources.
      if (!/^http:\/\/www\.w3\.org\/(?:2000\/svg|1999\/xhtml|1999\/xlink)$/u.test(value)
        && /(?:https?|wss?|ftp|ipfs|ar|web3|file|javascript):|^\/\//iu.test(value)) reject();
      if (network.has(value) || value === "constructor" || /<(?:script|iframe|object|embed|link|img|video|audio)\b|(?:src|href|poster)\s*=|url\(/iu.test(value)) reject();
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const target = node.left;
      if (ts.isPropertyAccessExpression(target) && resourceProperties.has(target.name.text) && !contentURL(node.right)) reject();
      if (ts.isElementAccessExpression(target) && (literal(target.argumentExpression) === undefined || resourceProperties.has(literal(target.argumentExpression)!))) reject();
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const name = node.expression.name.text;
      if (["write", "writeln", "insertAdjacentHTML", "createContextualFragment"].includes(name)) reject();
      if (name === "setAttribute" || name === "setAttributeNS") {
        const key = node.arguments[name === "setAttributeNS" ? 1 : 0];
        const value = node.arguments[name === "setAttributeNS" ? 2 : 1];
        const attribute = key && literal(key);
        if (attribute === undefined) reject();
        if (resourceProperties.has(attribute!.toLowerCase()) && (!value || !contentURL(value))) reject();
      }
      if (name === "createElement" || name === "createElementNS") {
        const tag = node.arguments[name === "createElementNS" ? 1 : 0];
        if (!tag || !ts.isStringLiteral(tag) || /^(?:script|iframe|object|embed|link|base)$/iu.test(tag.text)) reject();
      }
      if (name === "decode" && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "TextDecoder") reject();
    }
    node.forEachChild(visit);
  }; visit(parsed);
}
async function assertAuthoredStylesheet(source: string): Promise<void> {
  await build({ stdin: { contents: source, loader: "css" }, bundle: true, write: false, logLevel: "silent", plugins: [{ name: "no-undeclared-authored-style-dependencies", setup(builder) { builder.onResolve({ filter: /.*/ }, () => ({ errors: [{ text: "Author styles without undeclared URLs/imports; retain assets as explicit project resources." }] })); } }] });
}
function authoredExecutionOrder(edges: readonly KeelAuthoredProjectEdge[], expectedFiles: number): string[] {
  const ordered: string[] = [], visiting = new Set<string>(), completed = new Set<string>();
  const visit = (id: string) => {
    if (id.startsWith("published:") || completed.has(id)) return;
    if (visiting.has(id)) throw new TypeError("The current canonical authored-module reader requires an acyclic dependency graph; preserve the source and revise its functional boundaries.");
    visiting.add(id);
    for (const edge of edges.filter(edge => edge.consumer === id)) visit(edge.dependency);
    visiting.delete(id); completed.add(id); ordered.push(id);
  };
  visit("index.html");
  if (ordered.length !== expectedFiles) throw new TypeError("The authored presentation lost a declared resource.");
  return ordered;
}

/** Pure source delta; publication must still authenticate existing object IDs. */
export function planKeelAuthoredProjectChanges(previous: KeelAuthoredProjectGraph, next: KeelAuthoredProjectGraph) {
  if (previous.chainId !== next.chainId || previous.schema !== KEEL_AUTHORED_PROJECT_PROTOCOL || next.schema !== KEEL_AUTHORED_PROJECT_PROTOCOL) throw new TypeError("Authored revisions must retain their selected chain and graph protocol.");
  if (canonicalJson(previous.publishedModules ?? []) !== canonicalJson(next.publishedModules ?? [])) throw new TypeError("A published runtime dependency changed; require its exact selected-chain revision review instead of treating this as a creator-only edit.");
  const prior = new Map(previous.nodes.map(node => [node.id, node]));
  const current = new Set(next.nodes.map(node => node.id));
  const changed = next.nodes.filter(node => {
    const before = prior.get(node.id);
    return !before || before.path !== node.path || before.mediaType !== node.mediaType || before.role !== node.role || before.format !== node.format || canonicalJson(before.integrity) !== canonicalJson(node.integrity);
  });
  const unchanged = next.nodes.filter(node => !changed.includes(node));
  return { changedResourceIds: changed.map(node => node.id), unchangedResourceIds: unchanged.map(node => node.id), removedResourceIds: previous.nodes.filter(node => !current.has(node.id)).map(node => node.id), newSourceBytes: changed.reduce((total, node) => total + node.integrity.byteLength, 0), existingObjectBindings: "require-selected-chain-receipt-and-readback" as const, publicationReady: false as const };
}

/** Stage guard: re-parse source; a supplied JSON digest alone grants no trust. */
export async function assertKeelAuthoredProjectFiles(graph: KeelAuthoredProjectGraph, files: readonly KeelStudioStagedProjectFile[], publishedSources: readonly KeelAuthoredPublishedModuleInput[] = []): Promise<void> {
  await assertKeelAuthoredProjectCommitments(graph, files);
  assertAuthoredPublishedRecords(graph.publishedModules ?? [], await qualifyAuthoredPublishedModules(publishedSources, graph.chainId));
  exact(graph, ["schema", "origin", "architecture", "chainId", "entrypoint", "nodes", "edges", "digest", "publishedModules", "publicationReady"], "Authored graph");
  if (graph.schema !== KEEL_AUTHORED_PROJECT_PROTOCOL || graph.origin !== "agent-authored" || graph.architecture !== "logical-es-modules" || graph.entrypoint !== "index.html" || graph.publicationReady !== false || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw new TypeError("Invalid authored project graph.");
  if (files.length !== graph.nodes.length || new Set(files.map(file => file.path)).size !== files.length) throw new TypeError("Authored staging membership changed.");
  const definitions: KeelAuthoredModule[] = [];
  const assets: NonNullable<KeelAuthoredProjectInput["assets"]>[number][] = [];
  let start: KeelAuthoredProjectInput["start"] | undefined;
  let stylesheet: string | undefined;
  let title: string | undefined;
  // Regenerate generated boundaries from their exact bytes; do not accept an
  // altered bootstrap/document whose hash was merely updated in a JSON file.
  for (const node of graph.nodes) {
    const file = files.find(item => item.path === node.path);
    if (!file || file.role !== node.role || file.format !== node.format || file.mediaType !== node.mediaType) throw new TypeError(`Authored component changed: ${node.path}.`);
    const bytes = file.bytes instanceof Uint8Array ? file.bytes : new Uint8Array(await file.bytes.arrayBuffer());
    if (canonicalJson(await createIntegrity(bytes)) !== canonicalJson(node.integrity)) throw new TypeError(`Authored source changed after planning: ${node.path}.`);
    if (node.path.startsWith("assets/")) { assets.push({ path: node.path, purpose: node.purpose, mediaType: node.mediaType, bytes }); continue; }
    const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const module = /^modules\/([a-z][a-z0-9-]*)\.js$/u.exec(node.path);
    if (module) definitions.push({ id: module[1]!, purpose: node.purpose, source });
    else if (node.path === "main.js") {
      const match = /^import \{ ([A-Za-z_$][\w$]*) as start \} from "\.\/modules\/([a-z][a-z0-9-]*)\.js";\nvoid start\(document.getElementById\("artwork"\)\);\n$/u.exec(source);
      if (!match) throw new TypeError("Authored bootstrap changed; reauthor the graph.");
      start = { export: match[1]!, module: match[2]! };
    } else if (node.path === "style.css") stylesheet = source;
    else if (node.path === "index.html") {
      const encoded = /<title>([^<]*)<\/title>/u.exec(source)?.[1];
      if (encoded === undefined) throw new TypeError("Authored document is invalid.");
      title = encoded.replaceAll("&quot;", '"').replaceAll("&gt;", ">").replaceAll("&lt;", "<").replaceAll("&amp;", "&");
    } else throw new TypeError(`Unexpected authored resource: ${node.path}.`);
  }
  if (!start || title === undefined) throw new TypeError("Authored project lost its generated entry boundaries.");
  const regenerated = await createKeelAuthoredProject({ title, chainId: graph.chainId, modules: definitions, start, ...(publishedSources.length ? { publishedModules: publishedSources } : {}), ...(stylesheet === undefined ? {} : { stylesheet }), ...(assets.length ? { assets } : {}) });
  if (canonicalJson(regenerated.graph) !== canonicalJson(graph)) throw new TypeError("Authored project dependencies, identities or exact generated bytes changed.");
}

/**
 * Existing canonical data slots execute verified JavaScript independently.
 * Compile each logical ESM file separately; never bundle the creator graph.
 * This uses the registered reader's existing static module grammar. Unsupported
 * syntax stops rather than installing a new loader or altering its shell.
 */
export async function buildKeelAuthoredInlineDocument(input: {
  readonly graph: KeelAuthoredProjectGraph;
  readonly publishedSources?: readonly KeelAuthoredPublishedModuleInput[];
  readonly files: readonly KeelStudioStagedProjectFile[];
  readonly shell: import("./inline-viewer-graph.js").KeelInlineShellFragments;
  readonly modules: readonly import("./inline-viewer-graph.js").KeelInlineModuleFragment[];
  readonly compressionByPath?: Readonly<Record<string, "none" | "gzip">>;
  readonly payloadStorage?: KeelPayloadStorageMode;
}) {
  const graph = structuredClone(input.graph);
  const files = await Promise.all(input.files.map(async file => ({ ...file, bytes: file.bytes instanceof Uint8Array ? file.bytes.slice() : new Uint8Array(await file.bytes.arrayBuffer()) })));
  await assertKeelAuthoredProjectFiles(graph, files, input.publishedSources);
  const { buildEmbeddedKeelViewerSlot } = await import("./verification-shell.js");
  const { orderKeelModules } = await import("./data-layer.js");
  const modules = orderKeelModules(input.modules);
  if (graph.publishedModules?.length && (modules.length !== graph.publishedModules.length || modules.some((module, index) => module.moduleId !== graph.publishedModules![index]!.binding.moduleId || module.version !== graph.publishedModules![index]!.binding.version || module.execution !== "module"))) throw new TypeError("The authored runtime closure differs from its exact published module bindings.");
  const payloadStorage = resolveKeelPayloadStorage(input.payloadStorage);
  const ordered = authoredExecutionOrder(graph.edges, files.length);
  const creator: Array<{ readonly path: string; readonly sourceIntegrity: Integrity; readonly compiledIntegrity: Integrity; readonly part: import("./inline-viewer-graph.js").KeelInlineLocalDocument["parts"][number] }> = [];
  for (const id of ordered) {
    const file = files.find(candidate => candidate.path === id)!;
    let bytes: Uint8Array = file.bytes;
    if (file.format === "es-module") {
      // esbuild canonicalizes imports/exports without bundling. The existing
      // reader accepts named/namespace/default imports and named exports, not
      // runtime import(), import.meta, star reexports or combined clauses.
      const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const compiled = await compileAuthoredModule(source, id);
      if (payloadStorage === "raw") {
        qualifyAuthoredModuleSyntax(source, id, true);
      } else bytes = compiled;
    } else if (file.mediaType === "text/css") {
      await assertAuthoredStylesheet(new TextDecoder().decode(bytes));
    }
    const entry = id === graph.entrypoint;
    if (payloadStorage === "raw" && input.compressionByPath?.[id] !== undefined && input.compressionByPath[id] !== "none") throw new TypeError("Raw authored source cannot enable automatic compression.");
    const slot = await buildEmbeddedKeelViewerSlot({ id, role: entry ? "entrypoint" : file.format === "es-module" ? "data" : "asset", mediaType: file.mediaType,
      bytes, aliases: [...new Set([id, `./${id}`, ...(id.startsWith("modules/") ? [`./${path.posix.basename(id)}`] : [])])], compression: input.compressionByPath?.[id] ?? "none" });
    creator.push({ path: id, sourceIntegrity: await createIntegrity(file.bytes), compiledIntegrity: await createIntegrity(bytes),
      part: { kind: "creator", role: entry ? "entrypoint" : "asset", bytes: slot.fragment, byteLength: slot.fragment.length, integrity: slot.fragmentIntegrity } });
  }
  const parts: import("./inline-viewer-graph.js").KeelInlineLocalDocument["parts"] = [
    { kind: "existing", role: "shell-prefix", bytes: input.shell.prefix.bytes, byteLength: input.shell.prefix.bytes.length, integrity: input.shell.prefix.integrity },
    ...modules.map(module => ({ kind: "existing" as const, role: "module" as const, moduleId: module.moduleId, moduleVersion: module.version, execution: module.execution, phase: module.phase, weight: module.weight, bytes: module.bytes, byteLength: module.bytes.length, integrity: module.integrity })),
    ...creator.map(item => item.part),
    { kind: "existing", role: "shell-suffix", bytes: input.shell.suffix.bytes, byteLength: input.shell.suffix.bytes.length, integrity: input.shell.suffix.integrity },
  ];
  const rootBytes = new Uint8Array(parts.reduce((total, part) => total + part.bytes.length, 0));
  let offset = 0; for (const part of parts) { rootBytes.set(part.bytes, offset); offset += part.bytes.length; }
  return { schema: "keel-inline-local-document@1" as const, rootBytes, rootIntegrity: await createIntegrity(rootBytes), byteLength: rootBytes.length, parts,
    authored: { sourceGraphDigest: graph.digest, resources: creator.map(({ part, ...item }) => ({ ...item, fragmentIntegrity: part.integrity })), publicationReady: false as const } };
}
