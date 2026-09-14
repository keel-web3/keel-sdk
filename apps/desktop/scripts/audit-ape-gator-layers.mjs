/** Join by the contract's image CID, never by a possibly stale local token number. */
import {readFile,readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gatorStack} from '@keel/sdk/gator-assembly';
const root=path.resolve(process.argv[2]??'apps/desktop/artifacts/gator-ape-rebuild');
const recovery=path.resolve(process.argv[3]??'/tmp/keel-gator-recovery');
const local=path.resolve('apps/desktop/artifacts/gator-sepolia/source-data');
const json=async f=>JSON.parse(await readFile(f,'utf8'));
const config=await json(path.join(recovery,'src/data/generatorConfig.json'));
const byCID=new Map();
for(const name of ['uploadedImages.json','uploadedImages-last.json'])for(const [file,value]of Object.entries(await json(path.join(local,name)))){if(!value.hash)continue;const ids=byCID.get(value.hash)??new Set();ids.add(file.replace(/\.png$/,''));byCID.set(value.hash,ids);}
const privateRecords=await json(path.join(local,'metadata.json'));
const files=[];for(const folder of await readdir(path.join(recovery,'public/layers'),{withFileTypes:true})){if(!folder.isDirectory())continue;for(const name of await readdir(path.join(recovery,'public/layers',folder.name)))if(name.endsWith('.png'))files.push({path:folder.name+'/'+name,objectId:'0'.repeat(64)});}
const assembly={kind:'token-gators@1',config,files},tokens=[],used=new Set(),failures=[];
const aliases={Skin:'body',Body:'body',Eyes:'eyes',Mouth:'mouth',Hat:'hat',Outfit:'costume',Costume:'costume',Background:'background'};
const routes=await json(path.join(root,'routes.json'));
for(const route of routes){
 try{
  const bytes=await readFile(path.join(root,'metadata',route.tokenId+'.json')),metadata=JSON.parse(bytes),proof=await json(path.join(root,'metadata',route.tokenId+'.json.proof.json'));
  if(proof.uri!==route.uri||proof.sha256!==createHash('sha256').update(bytes).digest('hex'))throw Error('Metadata provenance mismatch');
  const traits={};for(const a of metadata.attributes){const key=aliases[a.trait_type];if(!key)continue;if(key in traits)throw Error('Duplicate rendering trait '+key);if(typeof a.value!=='string')throw Error('Non-string rendering trait '+key);traits[key]=a.value;}
  const cid=metadata.image.match(/(?:ipfs:\/\/|\/ipfs\/)([^/?#]+)/)?.[1];
  const candidates=[...(byCID.get(cid)??[])].filter(id=>privateRecords[id]);
  if(candidates.length!==1)throw Error('Current image CID has '+candidates.length+' unambiguous local records');
  const recordId=candidates[0],record=privateRecords[recordId];
  const traitCorrections=Object.entries(traits).filter(([key,value])=>record[key]!==value).map(([key,value])=>({trait:key,local:record[key],contract:value}));
  // Hidden background comes from the record associated with the exact current image CID.
  // It remains explicitly unverified against that image's pixels until render comparison.
  if(!traits.background)traits.background=record.background;
  for(const [key,value]of Object.entries(record))if(key!=='background'&&value!=='None'&&!(key in traits))traitCorrections.push({trait:key,local:value,contract:'absent'});
  // Filenames predate published trait renames. The image CID identifies the original
  // composition record; retain public labels separately instead of renaming metadata.
  const ordered=Object.fromEntries(['background','body','eyes','mouth','hat','costume'].filter(k=>record[k]&&record[k]!=='None').map(k=>[k,record[k]]));
  const result=gatorStack(assembly,ordered);for(const piece of result.stack)used.add(piece.path);
  tokens.push({tokenId:route.tokenId,sourceURI:route.uri,metadataSHA256:proof.sha256,sourceImage:metadata.image,recordId,traits,assetTraits:ordered,traitCorrections,backgroundEvidence:'record joined by current image CID; pixel comparison pending',stack:result.stack.map(p=>p.path),trace:result.trace,pixelMatchVerified:false});
 }catch(e){failures.push({tokenId:route.tokenId,error:e.message});}
}
const report={schema:'ape-gator-layer-audit@1',chainId:33139,address:routes[0]?.address,total:routes.length,matched:tokens.length,usedPaths:used.size,inventoryPaths:files.length,excludedPaths:files.length-used.size,failures,tokens,publicationReady:false};
await writeFile(path.join(root,'layer-audit.json'),JSON.stringify(report,null,2));
await writeFile(path.join(root,'used-layer-paths.json'),JSON.stringify([...used].sort(),null,2));
const sourceAttributes={body:'Body',eyes:'Eyes',mouth:'Mouth',hat:'Hat',costume:'Costume',background:'Background'},labels={Body:{name:'Skin',items:{}},Costume:{name:'Outfit',items:{}}},conflicts=[];
for(const token of tokens)for(const correction of token.traitCorrections){
 if(correction.contract==='absent')continue;const attribute=sourceAttributes[correction.trait];if(!attribute)continue;
 const label=labels[attribute]??={items:{}};const previous=label.items[correction.local];
 if(previous&&previous!==correction.contract)conflicts.push({tokenId:token.tokenId,...correction,previous});else label.items[correction.local]=correction.contract;
}
await writeFile(path.join(root,'metadata-names.json'),JSON.stringify({names:labels,conflicts,source:'contract-referenced metadata joined to original image CIDs',metadataChecked:tokens.length,complete:tokens.length===routes.length&&conflicts.length===0},null,2));
console.log(JSON.stringify({total:report.total,matched:tokens.length,usedPaths:used.size,failures:failures.length,examples:failures.slice(0,8),publicationReady:false}));
