import solc from 'solc';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const source=await readFile(new URL('./contracts/KeelLayerReveal.sol',import.meta.url),'utf8');
const output=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'KeelLayerReveal.sol':{content:source}},settings:{optimizer:{enabled:true,runs:200},outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object','evm.deployedBytecode.immutableReferences']}}}})));
const errors=(output.errors??[]).filter(e=>e.severity==='error');if(errors.length)throw Error(errors.map(e=>e.formattedMessage).join('\n'));
const result=output.contracts['KeelLayerReveal.sol'].KeelLayerReveal;await mkdir(new URL('./artifacts/',import.meta.url),{recursive:true});
await writeFile(new URL('./artifacts/KeelLayerReveal.json',import.meta.url),JSON.stringify({contractName:'KeelLayerReveal',compiler:solc.version(),sourceSHA256:createHash('sha256').update(source).digest('hex'),abi:result.abi,bytecode:'0x'+result.evm.bytecode.object,deployedBytecodeTemplate:'0x'+result.evm.deployedBytecode.object,immutableReferences:result.evm.deployedBytecode.immutableReferences,deployment:null,publicationReady:false,required:['Audit collection allocation adapter and upgrade authority','Verify selected-network VRF configuration when selected','Deploy exact reviewed constructor configuration','Read back immutable values and record actual deployed runtime hash; template contains immutable placeholders']},null,2)+'\n');
console.log('Layer reveal artifact built locally; no deployment.');
