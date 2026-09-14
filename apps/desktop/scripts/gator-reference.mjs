import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {transform} from 'esbuild';
// Recovered ordering source only. All dependencies are supplied as read-only data.
export async function legacyGatorReference(root){
 const config=JSON.parse(await readFile(path.join(root,'src/data/generatorConfig.json'),'utf8'));
 const directory=path.join(root,'public/layers'),folders={};for(const folder of await readdir(directory))folders[folder]=(await readdir(path.join(directory,folder))).sort();
 for(const folder of ['Top','Bottom','SuperTop','Middle'])folders[folder]??=[];
 const source=await readFile(path.join(root,'src/server/newImageGenerator/merge/imageStackOrder.ts'),'utf8');
 const {code}=await transform(source,{loader:'ts',format:'cjs'});const module={exports:{}};
 const context=vm.createContext({module,exports:module.exports,require(name){if(name==='path')return {join:path.posix.join};if(name==='fs')return {readdirSync(p){const name=p.split('/').filter(Boolean).at(-1);if(!folders[name])throw Error('Unknown source folder '+name);return [...folders[name]];}};if(name.endsWith('generatorConfig.json'))return config;if(name==='../grabDirectory')return {grabPublic:()=>'/reference/public'};throw Error('Unexpected recovered dependency '+name);}});
 new vm.Script(code).runInContext(context,{timeout:1000});
 const trait=file=>file.split('_').at(-1).slice(0,-4);
 function inputs(metadata){return Object.entries(metadata).flatMap(([key,value])=>{const type=key[0].toUpperCase()+key.slice(1),spec=config.attributes[type];if(!spec)throw Error('Unknown attribute '+key);const main=folders[spec.main].find(file=>trait(file)===value);if(!main)throw Error('Missing '+type+' '+value);return [main,...spec.addons.filter(Boolean).flatMap(folder=>{const found=folders[folder]?.find(file=>trait(file)===value);return found?[found]:[];})];});}
 return {config,folders,source,stack(metadata){context.inputLayers=inputs(metadata);context.inputMetadata=metadata;return new vm.Script('module.exports.default(inputLayers,inputMetadata)').runInContext(context,{timeout:1000}).map(file=>file.replace('/reference/public/layers/','').replace(/^\//,''));}};
}
