import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const source=new URL('../../../native/proof-executor/',import.meta.url),destination=new URL('../dist/proof-runtime/',import.meta.url);
mkdirSync(destination,{recursive:true});
for(const name of ['transport','state-reader','runner-client']){
 const original=readFileSync(new URL(`${name}.mjs`,source),'utf8');
 // Copy the reviewed implementation, adjusting only its SDK-relative imports.
 const packaged=original.replaceAll("'../../packages/sdk/dist/publication-preflight.js'","'../publication-preflight.js'").replaceAll("'../../packages/sdk/dist/rpc.js'","'../rpc.js'");
 writeFileSync(new URL(`${name}.js`,destination),packaged);
}
console.log(`Packaged reviewed native proof transport into ${fileURLToPath(destination)}`);
