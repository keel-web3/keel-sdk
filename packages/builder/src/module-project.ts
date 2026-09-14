import path from "node:path";
import { createKeelModuleInclusions } from "./module-inclusion.js";

export interface EditorModulePackage {
  readonly name: string;
  readonly files: Readonly<Record<string, string>>;
  readonly aliases?: Readonly<Record<string, string>>;
}
/** Portable files: the editor works before installation; compilation installs only pinned build tools. */
export function createKeelEditorProject(modules: readonly EditorModulePackage[]) {
  if (!modules.length || modules.length > 32) throw new Error("Choose from 1 to 32 modules.");
  const root = path.resolve("/keel-editor-export");
  const files: Record<string, string> = {};
  const seen = new Set<string>();
  for (const module of modules) {
    if (!/^[a-zA-Z_$][\w$]*$/u.test(module.name) || seen.has(module.name)) throw new Error("Module aliases must be distinct JavaScript identifiers.");
    seen.add(module.name);
    if (!module.files["index.js"] || !module.files["index.d.ts"]) throw new Error("A module needs runtime and declaration entries.");
    for (const [file, contents] of Object.entries(module.files)) {
      if (file.startsWith("/") || file.includes("\\") || file.split("/").some(part => !part || part === "." || part === "..")) throw new Error("Unsafe editor package path.");
      files[`modules/${module.name}/${file}`] = contents;
    }
  }
  const included = createKeelModuleInclusions(root, modules.map(module => ({name:module.name,specifier:`./modules/${module.name}/index.js`,...(module.aliases ? {aliases:module.aliases} : {})})), Object.fromEntries(Object.entries(files).map(([file,contents])=>[path.join(root,file),contents])));
  files["keel-bindings.js"] = included.runtime;
  files["keel-globals.d.ts"] = included.declarations;
  files["src/main.ts"] = `// Modules are included by the build and typed by keel-globals.d.ts.\n// Start typing a module name here.\nconsole.log(${included.names.filter(name=>!name.startsWith("KEEL_")).map(name=>name).join(", ")});\n`;
  files["tsconfig.json"] = JSON.stringify({compilerOptions:{target:"ES2022",module:"ESNext",moduleResolution:"Bundler",strict:true,noEmit:true,skipLibCheck:true,types:[]},include:["src/**/*.ts","keel-globals.d.ts"]},null,2);
  files["KEEL.code-workspace"] = JSON.stringify({folders:[{path:"."}]},null,2);
  files["package.json"] = JSON.stringify({name:"keel-module-project",private:true,type:"module",scripts:{check:"tsc",build:"tsc && node build.mjs"},devDependencies:{esbuild:"0.28.2",typescript:"5.9.3"}},null,2);
  files["build.mjs"] = `import { build } from "esbuild";\nawait build({entryPoints:["src/main.ts"],bundle:true,format:"esm",platform:"browser",target:"es2022",inject:["./keel-bindings.js"],outfile:"dist/artwork.js"});\n`;
  files["README.md"] = "Open KEEL.code-workspace, then src/main.ts. Types and autocomplete work immediately. Run npm install and npm run build to compile the included runtime bytes into dist/artwork.js. This is a browser module, ready for the normal KEEL upload flow; this project does not publish or sign transactions. Module provenance records keep inferred and verified types distinct.\n";
  return {files, names:included.names};
}

/** Deterministic, uncompressed ZIP for small text editor projects. */
export function zipKeelEditorProject(files: Readonly<Record<string,string>>): Uint8Array {
  const encoder = new TextEncoder(); const local: Uint8Array[] = []; const central: Uint8Array[] = []; let offset = 0;
  const entries = Object.entries(files).sort(([a],[b])=>a.localeCompare(b));
  if (entries.length > 1024) throw new Error("Editor archive exceeds file budget.");
  for (const [name, source] of entries) {
    if (name.startsWith("/") || name.includes("\\") || name.split("/").some(part=>!part || part === "." || part === "..")) throw new Error("Unsafe archive path.");
    const filename=encoder.encode(name), bytes=encoder.encode(source); let crc=0xffffffff;
    for (const byte of bytes) { crc^=byte; for(let bit=0;bit<8;bit++) crc=(crc>>>1)^((crc&1)?0xedb88320:0); } crc=(crc^0xffffffff)>>>0;
    const header=new Uint8Array(30+filename.length); const view=new DataView(header.buffer);
    view.setUint32(0,0x04034b50,true);view.setUint16(4,20,true);view.setUint16(6,0x800,true);view.setUint16(12,33,true);view.setUint32(14,crc,true);view.setUint32(18,bytes.length,true);view.setUint32(22,bytes.length,true);view.setUint16(26,filename.length,true);header.set(filename,30);
    const record=new Uint8Array(46+filename.length);const table=new DataView(record.buffer);
    table.setUint32(0,0x02014b50,true);table.setUint16(4,20,true);table.setUint16(6,20,true);table.setUint16(8,0x800,true);table.setUint16(14,33,true);table.setUint32(16,crc,true);table.setUint32(20,bytes.length,true);table.setUint32(24,bytes.length,true);table.setUint16(28,filename.length,true);table.setUint32(42,offset,true);record.set(filename,46);
    local.push(header,bytes);central.push(record);offset+=header.length+bytes.length;
    if(offset>32_000_000)throw new Error("Editor archive exceeds byte budget.");
  }
  const size=central.reduce((n,part)=>n+part.length,0),end=new Uint8Array(22),view=new DataView(end.buffer);
  view.setUint32(0,0x06054b50,true);view.setUint16(8,entries.length,true);view.setUint16(10,entries.length,true);view.setUint32(12,size,true);view.setUint32(16,offset,true);
  const result=new Uint8Array(offset+size+22);let cursor=0;for(const part of [...local,...central,end]){result.set(part,cursor);cursor+=part.length;}return result;
}
