/** Inspect only bytes already accepted by the shell's verifier. Never fetch or execute catalog declarations. */
export interface KeelShellCatalog {
  readonly protocol: "keel-shell-catalog@1";
  readonly resources: readonly Readonly<Record<string, unknown>>[];
  readonly manifests: readonly Readonly<Record<string, unknown>>[];
  readonly metadata: readonly Readonly<Record<string, unknown>>[];
  readonly plugins: readonly Readonly<Record<string, unknown>>[];
  readonly external: readonly Readonly<Record<string, unknown>>[];
}
export function buildKeelShellCatalog(items: readonly {
  readonly id: string; readonly role?: string; readonly mediaType: string; readonly aliases: readonly string[];
  readonly integrity: {readonly digest: string; readonly byteLength: number};
  readonly onchain?: {readonly compression?: string; readonly storedIntegrity?: {readonly byteLength: number}; readonly containerId?: string};
  readonly embedded?: {readonly compression?: string; readonly storedIntegrity?: {readonly byteLength: number}};
}[], resolved: ReadonlyMap<string, Uint8Array>): KeelShellCatalog {
  const manifests: Record<string, unknown>[] = [], metadata: Record<string, unknown>[] = [], plugins: Record<string, unknown>[] = [], external: Record<string, unknown>[] = [];
  const detach = (value: unknown, depth = 0): unknown => {
    if (typeof value === "string") return value.slice(0,2048);
    if (value === null || typeof value === "boolean" || typeof value === "number") return value;
    if (depth >= 4) return "…";
    if (Array.isArray(value)) return Object.freeze(value.slice(0,64).map(item=>detach(item,depth+1)));
    if (value && typeof value === "object") return Object.freeze(Object.fromEntries(Object.entries(value).filter(([key])=>!["__proto__","prototype","constructor","animation_url","image_data"].includes(key)).slice(0,48).map(([key,item])=>[key.slice(0,128),detach(item,depth+1)])));
    return undefined;
  };
  const resources = items.map(item=>Object.freeze({id:item.id,name:item.aliases[0]??item.id,role:item.role??"asset",mediaType:item.mediaType,byteLength:item.integrity.byteLength,digest:item.integrity.digest,aliases:Object.freeze(item.aliases.slice(0,16)),compression:item.onchain?.compression??item.embedded?.compression??"none",...(item.onchain?.containerId?{containerId:item.onchain.containerId}:{}),...(item.onchain?.storedIntegrity?.byteLength!==undefined?{storedByteLength:item.onchain.storedIntegrity.byteLength}:item.embedded?.storedIntegrity?.byteLength!==undefined?{storedByteLength:item.embedded.storedIntegrity.byteLength}:{})}));
  for (const item of items) {
    if (!/(?:application\/(?:json|[^;]+\+json))(?:;|$)/i.test(item.mediaType) || item.integrity.byteLength>65536) continue;
    const bytes=resolved.get(item.id); if (!bytes) continue;
    let parsed: Record<string,unknown>;
    try {const value: unknown=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));if(!value || typeof value!=="object" || Array.isArray(value))continue;parsed=value as Record<string,unknown>;} catch {continue;}
    const ref={resourceId:item.id,digest:item.integrity.digest};
    if (Array.isArray(parsed.attributes) || (typeof parsed.name==="string" && (parsed.image!==undefined || /metadata|token/i.test(item.id)))) metadata.push(Object.freeze({...ref,content:detach(parsed)}));
    if (/manifest/i.test(item.id) || typeof parsed.protocol==="string" || parsed.extensions!==undefined || Array.isArray(parsed.modules)) manifests.push(Object.freeze({...ref,content:detach(parsed)}));
    if (Array.isArray(parsed.plugins)) for(const plugin of parsed.plugins.slice(0,16)) if(plugin && typeof plugin==="object")plugins.push(Object.freeze({...ref,content:detach(plugin)}));
    if (Array.isArray(parsed.external)) for(const dependency of parsed.external.slice(0,32)) {
      const uri=typeof dependency==="string"?dependency:dependency && typeof dependency==="object"?(dependency as {uri?:unknown}).uri:undefined;
      if(typeof uri==="string" && uri.length<=2048)external.push(Object.freeze({...ref,uri}));
    }
  }
  return Object.freeze({protocol:"keel-shell-catalog@1",resources:Object.freeze(resources),manifests:Object.freeze(manifests.slice(0,32)),metadata:Object.freeze(metadata.slice(0,8)),plugins:Object.freeze(plugins.slice(0,32)),external:Object.freeze(external.slice(0,32))});
}
