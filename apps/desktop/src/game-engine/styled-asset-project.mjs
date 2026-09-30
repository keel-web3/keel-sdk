// Declarative project attachment for the trusted engine styled-asset importer.
export const STYLED_PREVIEW_URL='keel-preview://game-builder/styled.html';
export const styledImportable=(name='')=>/\.keelasset(?:\.json)?$/i.test(String(name));
export function styledAssetProjectFiles(result,objectId){
  if(result?.kind!=='styled-asset'||!/^([a-f0-9]{64})$/.test(objectId))throw Error('A verified styled asset object is required.');
  const stem=(String(result.name||'asset').toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40)||'asset')+'-'+objectId.slice(0,8);
  const reference={format:'keel-styled-asset-reference@1',objectId,engineImport:'@keel-engine/import/styled-asset',dependencies:result.dependencies,style:result.style,animation:result.animation};
  const code=`// KEEL styled asset. readObject(id) supplies this project's attached object bytes.\nimport {importStyledAsset,createStyledAssetPlayer} from '@keel-engine/import/styled-asset';\nexport const objectId=${JSON.stringify(objectId)};\nexport async function build(readObject,options={}){if(typeof readObject!=='function')throw Error('Pass the host object-byte reader');return importStyledAsset(new Uint8Array(await readObject(objectId)),options);}\nexport async function createPlayer(host,readObject,options={}){return createStyledAssetPlayer({...host,asset:await build(readObject,options)});}\n`;
  return[{name:`assets/${stem}.styled.json`,type:'application/json',content:JSON.stringify(reference,null,2)+'\n'},{name:`assets/${stem}.styled.mjs`,type:'text/javascript',content:code}];
}
export function withStyledAssetReference(project,result,objectId){
  let files=[...project.files];for(const file of styledAssetProjectFiles(result,objectId)){const prior=files.find(f=>f.name===file.name);files=prior?files.map(f=>f.id===prior.id?{...f,...file}:f):[...files,{id:crypto.randomUUID(),...file}];}
  return{...project,files,objectIds:[...new Set([...(project.objectIds||[]),objectId])]};
}
