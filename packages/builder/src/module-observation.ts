import { createIntegrity } from "@keel/protocol";

export interface ObservedModuleValue {
  readonly kind: string;
  readonly arity?: number;
  readonly parameters?: readonly string[];
}
export interface ModuleObservation {
  readonly schema: "keel-module-observation@1";
  readonly digest: string;
  readonly globals: Readonly<Record<string, ObservedModuleValue>>;
  readonly exports: Readonly<Record<string, ObservedModuleValue>>;
  readonly trust: "unverified-observation";
}

/** Executes only inside an opaque browser iframe. No function calls or getters
 * are used for discovery. The parent must treat all reports as untrusted data. */
export async function createModuleObservationDocument(bytes: Uint8Array, format: "classic" | "esm") {
  if (bytes.length > 8_000_000) throw new Error("Module exceeds discovery byte budget.");
  const integrity = await createIntegrity(bytes);
  const source = Buffer.from(bytes).toString("base64");
  const program = `(()=>{const send=parent.postMessage.bind(parent),describe=v=>{const kind=typeof v;if(kind==='function')return {kind,arity:v.length};if(v===null)return {kind:'null'};if(Array.isArray(v))return {kind:'array'};return {kind}},own=Object.getOwnPropertyDescriptors,before=own(globalThis);const report=(exports={})=>{const globals=Object.create(null);for(const [key,d] of Object.entries(own(globalThis))){if(!(key in before)&&'value'in d&&/^[A-Za-z_$][\\w$]*$/.test(key))globals[key]=describe(d.value)}const exported=Object.create(null);for(const [key,d] of Object.entries(own(exports))){if('value'in d)exported[key]=describe(d.value)}send({schema:'keel-module-observation@1',digest:${JSON.stringify(integrity.digest)},trust:'unverified-observation',globals,exports:exported},'*')};const text=new TextDecoder().decode(Uint8Array.from(atob(${JSON.stringify(source)}),c=>c.charCodeAt(0)));${format === "esm" ? "import(URL.createObjectURL(new Blob([text],{type:'text/javascript'}))).then(m=>setTimeout(()=>report(m),50)).catch(e=>send({error:String(e)},'*'))" : "const script=document.createElement('script');script.textContent=text;document.head.append(script);report()"}})();`;
  return { integrity, html: `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob:; connect-src 'none'; img-src data:; style-src 'unsafe-inline'; frame-src 'none'; form-action 'none'; base-uri 'none'"><script>${program.replace(/<\/script/giu, "<\\/script")}</script>`, sandbox: "allow-scripts" };
}
