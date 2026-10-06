/** Optional lossless descriptor carriage. The normal verified reader still checks
 * every expanded field, container table and both byte commitments before mounting.
 * Packing rejects unsupported fields instead of silently dropping them. */
function stable(value: unknown): string {
 if(Array.isArray(value))return '['+value.map(stable).join(',')+']';
 if(value&&typeof value==='object'){const record=value as Record<string,unknown>;return '{'+Object.keys(record).sort().map(k=>JSON.stringify(k)+':'+stable(record[k])).join(',')+'}'}
 return JSON.stringify(value);
}
export function packKeelInlineDescriptors(input: readonly unknown[]) {
 const items=input as readonly Record<string, any>[];
 if(!Array.isArray(items)||!items.length||items.length>128||!Array.isArray(items[0]?.containerBindings))throw new TypeError('Container-bound descriptors required');
 const bindings=items[0]!.containerBindings as Record<string,any>[],ids=new Map(bindings.map((b,i)=>[b.id,i])),types: unknown[][]=[],typeIds=new Map<string,number>();
 if(!bindings.length||bindings.length>128)throw new RangeError('Invalid compact binding count');
 const rows=items.map(i=>{if(!Array.isArray(i.aliases)||i.aliases[0]!==i.id||!i.integrity||!i.onchain)throw new TypeError('Unsupported compact member');
  const key=JSON.stringify([i.mediaType,i.role]);if(!typeIds.has(key)){typeIds.set(key,types.length);types.push([i.mediaType,i.role])}
  const alias=i.aliases.length===2?(i.aliases[1]===i.id+'.js'?0:i.aliases[1]):i.aliases.slice(1);
  return [i.id,alias,i.integrity.byteLength,i.integrity.digest,typeIds.get(key),ids.get(i.onchain.containerId),i.onchain.offset];});
 const envelope={format:'keel.inline-descriptor-columns@1',bindings:bindings.map(b=>[b.id,b.compression,b.integrity.byteLength,b.integrity.digest,b.objectId,b.storedIntegrity.byteLength,b.storedIntegrity.digest]),types,rows};
 const expanded=unpackKeelInlineDescriptors([null,envelope],bindings[0]!.chainId,bindings[0]!.store).slice(1);
 if(stable(expanded)!==stable(items))throw new TypeError('Compact descriptor carriage would omit or change fields');
 return envelope;
}
export function unpackKeelInlineDescriptors(items: readonly unknown[],chainId: number,store: string) {
 if(!Number.isSafeInteger(chainId)||chainId<=0||!/^0x[0-9a-f]{40}$/iu.test(store)||/^0x0{40}$/iu.test(store))throw Error('Invalid compact descriptor context');
 if(!Array.isArray(items)||items.length!==2||items[0]!==null)throw Error('Invalid compact descriptor envelope');
 const e=items[1] as Record<string, any>;if(e?.format!=='keel.inline-descriptor-columns@1'||!Array.isArray(e.bindings)||!Array.isArray(e.rows)||!Array.isArray(e.types)||!e.bindings.length||e.bindings.length>128||!e.rows.length||e.rows.length>128||e.types.length>128)throw Error('Invalid compact descriptor table');
 const integrity=(byteLength: number,digest: string)=>({algorithm:'sha256',byteLength,digest});
 const bindings=e.bindings.map((b: any[])=>{if(!Array.isArray(b)||b.length!==7)throw Error('Invalid compact binding');return {chainId,compression:b[1],integrity:integrity(b[2],b[3]),objectId:b[4],store,storedIntegrity:integrity(b[5],b[6]),id:b[0]}});
 const rows=e.rows.map((r: any[])=>{if(!Array.isArray(r)||r.length!==7||!(r[1]===0||Array.isArray(r[1])||typeof r[1]==='string')||!Number.isInteger(r[5])||!bindings[r[5]]||!Number.isInteger(r[4])||!Array.isArray(e.types[r[4]])||e.types[r[4]].length!==2)throw Error('Invalid compact member');return {aliases:[r[0],...(r[1]===0?[r[0]+'.js']:typeof r[1]==='string'?[r[1]]:r[1])],id:r[0],integrity:integrity(r[2],r[3]),mediaType:e.types[r[4]][0],onchain:{containerId:bindings[r[5]]!.id,offset:r[6]},role:e.types[r[4]][1]}});
 Object.assign(rows[0]!,{containerBindings:bindings});return [null,...rows];
}
