// node scripts/build-keel.mjs <project> -> keel/<project>/<project>.js, index.html (+ keel.module.json)
//
// Bundles one engine project (projects/<project>/keel-entry.js and everything
// it imports, engine modules included) into a single script for KEEL: every
// module becomes a function in a registry, imports become lookups, the entry
// runs last. No dependencies, no minifier -- readable and diffable. Lines that
// are only a comment are dropped (onchain they cost bytes and do nothing; the
// source keeps them). The same bundler NOCTURNES uses, taught `export * from`
// and `export { .. } from`.
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const project = process.argv[2] ?? "wallrun";
const entry = join(root, "projects", project, "keel-entry.js");
if (!existsSync(entry)) throw new Error(`No ${relative(root, entry)}: a project needs a keel-entry.js to be a KEEL piece.`);
const IMPORT = /^import\s+(?:\{([^}]*)\}\s+from\s+)?["'](\.[^"']+)["'];?\s*$/gm;
const REEXPORT = /^export\s+(?:\*|\{([^}]*)\})\s+from\s+["'](\.[^"']+)["'];?\s*$/gm;
const order = [];
const seen = new Set();
function visit(file) {
  if (seen.has(file)) return;
  seen.add(file);
  const code = readFileSync(file, "utf8");
  for (const m of code.matchAll(IMPORT)) visit(join(dirname(file), m[2]));
  for (const m of code.matchAll(REEXPORT)) visit(join(dirname(file), m[2]));
  if (/^(import|export)\b[^\n]*\bfrom\s*["']/m.test(code.replace(IMPORT, "").replace(REEXPORT, ""))) throw new Error(`${relative(root, file)}: an import or export this bundler can't read (keep them one line: import { a } from "./x.js").`);
  order.push(file);
}
visit(entry);

// Where the comments are: a small lexer that steps over strings, templates
// (with their ${} nesting) and regex literals, so a "//" inside any of them
// is never taken for one. Returns [start, end) ranges.
const WORD_BEFORE_REGEX = new Set(["return", "typeof", "case", "in", "of", "new", "delete", "void", "throw", "instanceof", "yield", "await", "else", "do"]);
function commentRanges(code) {
  const ranges = [];
  const holes = []; // brace depth at each open ${
  const n = code.length;
  let depth = 0;
  let regexOk = true;
  let i = 0;
  const template = () => { // from inside a template to its end or next ${
    while (i < n) {
      const c = code[i];
      if (c === "\\") { i += 2; continue; }
      if (c === "`") { i += 1; return false; }
      if (c === "$" && code[i + 1] === "{") { i += 2; holes.push(depth); depth += 1; return true; }
      i += 1;
    }
    return false;
  };
  while (i < n) {
    const c = code[i];
    const d = code[i + 1];
    if (c === "/" && d === "/") { const e = code.indexOf("\n", i); ranges.push([i, e < 0 ? n : e]); i = e < 0 ? n : e; continue; }
    if (c === "/" && d === "*") { const e = code.indexOf("*/", i + 2); ranges.push([i, e < 0 ? n : e + 2]); i = e < 0 ? n : e + 2; continue; }
    if (c === "'" || c === '"') { i += 1; while (i < n && code[i] !== c && code[i] !== "\n") i += code[i] === "\\" ? 2 : 1; i += 1; regexOk = false; continue; }
    if (c === "`") { i += 1; regexOk = template(); continue; }
    if (c === "/") {
      i += 1;
      if (!regexOk) { regexOk = true; continue; }
      let cls = false;
      while (i < n && code[i] !== "\n") {
        const r = code[i];
        if (r === "\\") { i += 2; continue; }
        if (cls) cls = r !== "]";
        else if (r === "[") cls = true;
        else if (r === "/") break;
        i += 1;
      }
      i += 1;
      while (i < n && /[a-z]/i.test(code[i])) i += 1;
      regexOk = false;
      continue;
    }
    if (c === "{") { depth += 1; i += 1; regexOk = true; continue; }
    if (c === "}") {
      depth -= 1; i += 1;
      if (holes.length && holes[holes.length - 1] === depth) { holes.pop(); regexOk = template(); continue; }
      regexOk = false;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) { const j0 = i; while (i < n && /[\w$]/.test(code[i])) i += 1; regexOk = WORD_BEFORE_REGEX.has(code.slice(j0, i)); continue; }
    if (/[0-9]/.test(c)) { while (i < n && /[\w.]/.test(code[i])) i += 1; regexOk = false; continue; }
    if (c === ")" || c === "]") { i += 1; regexOk = false; continue; }
    if (!/\s/.test(c)) regexOk = true;
    i += 1;
  }
  return ranges;
}

/**
 * The code without the lines that are nothing but comment. A block comment
 * goes only whole -- from a line it opens alone on to a line it closes alone
 * on -- so no line is ever left holding half of one.
 */
function dropCommentLines(code) {
  const lines = code.split("\n");
  const starts = [];
  let p = 0;
  for (const l of lines) { starts.push(p); p += l.length + 1; }
  const lineOf = (pos) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= pos) lo = mid; else hi = mid - 1; }
    return lo;
  };
  const drop = new Uint8Array(lines.length);
  for (const [s, e] of commentRanges(code)) {
    const l1 = lineOf(s);
    const l2 = lineOf(Math.max(s, e - 1));
    const alone = !code.slice(starts[l1], s).trim() && !code.slice(e, starts[l2] + lines[l2].length).trim();
    if (alone) for (let l = l1; l <= l2; l += 1) drop[l] = 1;
  }
  return lines.filter((_, l) => !drop[l]).join("\n");
}

const id = (file) => relative(root, file);
const modules = order.map((file) => {
  let code = dropCommentLines(readFileSync(file, "utf8"));
  const exported = new Set();
  const passed = new Map(); // (re-exports: read straight from their module, no local name -- the file may import the same names)
  const stars = [];
  code = code.replace(IMPORT, (_, names, from) => {
    if (!names) return "";
    const target = id(join(dirname(file), from));
    const binds = names.split(",").map((n) => n.trim()).filter(Boolean).map((n) => n.replace(/\s+as\s+/, ": "));
    return `const { ${binds.join(", ")} } = __mod(${JSON.stringify(target)});`;
  });
  code = code.replace(REEXPORT, (whole, names, from) => {
    const target = JSON.stringify(id(join(dirname(file), from)));
    if (names === undefined) { stars.push(target); return ""; }
    for (const n of names.split(",").map((x) => x.trim()).filter(Boolean)) {
      const [from, as = from] = n.split(/\s+as\s+/);
      passed.set(as, `__mod(${target}).${from}`);
    }
    return "";
  });
  code = code.replace(/^export\s+\{([^}]*)\};?\s*$/gm, (_, names) => {
    for (const n of names.split(",").map((x) => x.trim()).filter(Boolean)) exported.add(n);
    return "";
  });
  code = code.replace(/^export\s+(async\s+function\*?|function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm, (_, kind, name) => {
    exported.add(name);
    return `${kind} ${name}`;
  });
  const getters = [...[...exported].map((n) => `get ${n}() { return ${n}; }`), ...[...passed].map(([n, e]) => `get ${n}() { return ${e}; }`)].join(", ");
  const box = stars.length ? `Object.defineProperties({ ${getters} }, Object.assign({}, ${stars.map((s) => `Object.getOwnPropertyDescriptors(__mod(${s}))`).join(", ")}))` : `{ ${getters} }`;
  return `__def(${JSON.stringify(id(file))}, () => {\n${code}\nreturn ${box};\n});`;
});

const name = project.toUpperCase();
const bundle = `// ${name} -- built on the KEEL pixel engine by scripts/build-keel.mjs.
(function __piece() {
const __defs = new Map();
const __cache = new Map();
const __def = (name, fn) => __defs.set(name, fn);
const __mod = (name) => {
  if (!__cache.has(name)) { const box = {}; __cache.set(name, box); Object.defineProperties(box, Object.getOwnPropertyDescriptors(__defs.get(name)())); }
  return __cache.get(name);
};
${modules.join("\n\n")}
__mod(${JSON.stringify(id(entry))});
})();
`;

const out = join(root, "keel", project);
mkdirSync(out, { recursive: true });
writeFileSync(join(out, `${project}.js`), bundle);
// (A piece with sound gets Tone and keel-audio from its KEEL extends; the local page loads the same before the piece.)
const audio = order.some((f) => id(f).startsWith("src/audio/"));
const vendor = audio ? `<script src="../../vendor/tone-15.1.22-native.js"></script>\n<script src="../../vendor/keel-audio-1.0.0.min.js"></script>\n` : "";
writeFileSync(join(out, "index.html"), `<!doctype html>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${name}</title>\n<body></body>\n${vendor}<script src="${project}.js"></script>\n`);

const bytes = new TextEncoder().encode(bundle);
let manifest = null;
try {
  const { defineModule } = await import("../../keel-sdk/packages/sdk/dist/module/index.js");
  manifest = defineModule(name[0] + name.slice(1).toLowerCase(), { kind: "app", target: "@keel/eth/sepolia/browser", extends: [], verification: { shell: true } }).manifest;
} catch (error) {
  console.warn(`KEEL SDK not found beside this repo (${error.message}); keel.module.json not written.`);
}
if (manifest) {
  writeFileSync(join(out, "keel.module.json"), `${JSON.stringify({
    schema: "keel-agent-project-declaration@1",
    module: manifest,
    resources: { [`${project}.js`]: { sha256: `0x${createHash("sha256").update(bytes).digest("hex")}`, byteLength: bytes.byteLength } },
    storageStrategy: "onchain",
    immutable: true,
  }, null, 2)}\n`);
}
const stored = gzipSync(bytes, { level: 9 }).byteLength; // (what KeelHold keeps: every object is stored compressed)
console.log(`keel/${project}/${project}.js ${(bytes.byteLength / 1024).toFixed(1)} KB (${(stored / 1024).toFixed(1)} KB stored, gzip) from ${modules.length} modules${manifest ? " + keel.module.json" : ""}`);
