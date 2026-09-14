import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createModuleObservationDocument } from "./module-observation.js";
import { prepareUnverifiedClassicModule } from "./module-unverified.js";
import { syncKeelModuleEditor, watchKeelModuleEditor } from "./module-editor.js";

/** Local authoring commands never execute uploaded code in the Node process. */
export async function runModuleAuthoringCommand(verb: string | undefined, flags: Readonly<Record<string, string | boolean>>) {
  if (!["observe", "infer", "editor"].includes(verb ?? "")) return false;
  const value = (name: string, fallback?: string) => {
    const result = typeof flags[name] === "string" ? flags[name] as string : fallback;
    if (!result) throw new Error(`module ${verb} requires --${name}.`);
    return result;
  };
  if (verb === "observe") {
    const document = await createModuleObservationDocument(new Uint8Array(await readFile(value("file"))), "classic");
    const escaped = document.html.replace(/&/gu,"&amp;").replace(/"/gu,"&quot;").replace(/</gu,"&lt;");
    const html = `<!doctype html><meta charset="utf-8"><title>KEEL module discovery</title><h1>Module discovery</h1><p>Unverified: names are observed; types are inferred separately from source.</p><pre id="result">Discovering…</pre><button id="save" disabled>Save observation</button><script>let observation;addEventListener('message',e=>{const frame=document.querySelector('iframe');if(e.source!==frame?.contentWindow||e.data?.digest!==${JSON.stringify(document.integrity.digest)})return;observation=e.data;document.querySelector('#result').textContent=JSON.stringify(e.data,null,2);document.querySelector('#save').disabled=false;});document.querySelector('#save').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(observation,null,2)],{type:'application/json'}));a.download='keel-observation.json';a.click();URL.revokeObjectURL(a.href)};</script><iframe title="Isolated uploaded module" sandbox="allow-scripts" srcdoc="${escaped}"></iframe>`;
    await writeFile(value("out"), html, {flag:"wx"});
    console.log("Open the generated HTML to discover globals in an isolated browser sandbox. Save its observation for module infer.");
  } else if (verb === "infer") {
    const result = await prepareUnverifiedClassicModule({name:value("name"),source:await readFile(value("file"),"utf8"),observation:JSON.parse(await readFile(value("observation"),"utf8")),outputDirectory:value("out")});
    console.log(JSON.stringify(result,null,2));
  } else {
    const root = path.resolve(value("root",process.cwd()));
    const entries = value("entry","src/art.ts").split(",");
    if (flags.watch === true) {
      await watchKeelModuleEditor(root, entries, value("includes","keel.includes.json"));
      console.log("Watching module inclusions and source files for editor declarations.");
      return true;
    }
    const modules = JSON.parse(await readFile(path.join(root,value("includes","keel.includes.json")),"utf8"));
    const result=await syncKeelModuleEditor(root,modules,entries);
    console.log(`Refreshed ${result.names.length} bindings. Include .keel/*.d.ts in tsconfig.json.`);
  }
  return true;
}
