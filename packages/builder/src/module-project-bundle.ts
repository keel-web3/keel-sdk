import path from "node:path";
import { build } from "esbuild";
/** Compile a generated inclusion project without executing any module. */
export async function bundleKeelEditorModules(project:{readonly files:Readonly<Record<string,string>>;readonly names:readonly string[]}) {
 const root="/keel-editor-export";
 const entries=new Map(Object.entries(project.files).map(([file,source])=>[path.posix.join(root,file),source]));
 const source=project.files["keel-bindings.js"];if(!source)throw new Error("Missing module bindings.");
 const globals=project.names.map(name=>`if(Object.hasOwn(globalThis,${JSON.stringify(name)})&&globalThis[${JSON.stringify(name)}]!==${name})throw new Error(${JSON.stringify(`Global already occupied: ${name}`)});if(!Object.hasOwn(globalThis,${JSON.stringify(name)}))Object.defineProperty(globalThis,${JSON.stringify(name)},{value:${name},enumerable:true});`).join("\n");
 const result=await build({stdin:{contents:source+"\n"+globals,sourcefile:"keel-bindings.js",resolveDir:root},bundle:true,format:"iife",platform:"browser",target:"es2022",write:false,plugins:[{name:"keel-editor-files",setup(builder){builder.onResolve({filter:/.*/},args=>{const candidate=path.posix.resolve(args.resolveDir||path.posix.dirname(args.importer)||root,args.path);if(!candidate.startsWith(root+"/"))return {errors:[{text:"Module import escapes the included project."}]};if(!entries.has(candidate))return {errors:[{text:`Missing included module dependency: ${args.path}`}]};return {path:candidate,namespace:"keel-editor"};});builder.onLoad({filter:/.*/,namespace:"keel-editor"},args=>({contents:entries.get(args.path)!,loader:"js",resolveDir:path.posix.dirname(args.path)}));}}]});
 return result.outputFiles[0]!.text;
}
