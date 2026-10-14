import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import solc from 'solc';
const ownRoot = fileURLToPath(new URL('../../',import.meta.url));
export function compileSharedImageContracts(options = {}) {
  const contracts = process.env.KEEL_SHARED_IMAGE_CONTRACTS_ROOT ?? resolve(ownRoot,'../keel-contracts');
  const require = createRequire(import.meta.url), sources = {};
  const read = path => { const content=readFileSync(path,'utf8'); sources[path]=createHash('sha256').update(content).digest('hex'); return content; };
  const imports = name => {
    try {
      let path;
      if(name.startsWith('@keel/')) path=resolve(contracts,'src/modules',name.slice(6));
      else if(name.startsWith('@openzeppelin/')) path=require.resolve(name);
      else path=resolve(ownRoot,name);
      return {contents:read(path)};
    } catch(error) { return {error:error.message}; }
  };
  const input={language:'Solidity',sources:{
    'Shared.sol':{content:read(resolve(ownRoot,'packages/sdk/contracts/KeelLegacySharedImageTokenURIBuilder.sol'))},
    'LocalHold.sol':{content:read(resolve(ownRoot,'tests/fixtures/legacy-shared-image/LocalHold.sol'))},
    ...(options.policy ? {'PolicyAdapters.sol':{content:read(resolve(ownRoot,'tests/fixtures/legacy-shared-image/PolicyAdapters.sol'))}} : {}),
    'Normal.sol':{content:options.policy ? 'pragma solidity 0.8.36; import {KeelHold} from "@keel/keel-hold/KeelHold.sol"; import {KeelRawTokenURIBuilder} from "@keel/keel-harness/KeelRawTokenURIBuilder.sol";' : 'pragma solidity 0.8.36; import {KeelRouted721} from "@keel/keel-die/KeelRouted721.sol"; import {KeelRawTokenURIBuilder} from "@keel/keel-harness/KeelRawTokenURIBuilder.sol"; import {Keel721Presentation} from "@keel/keel-die/Keel721Presentation.sol";'}},
    settings:{evmVersion:'prague',optimizer:{enabled:true,runs:50},viaIR:true,metadata:{bytecodeHash:'none',appendCBOR:false},outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.bytecode.linkReferences','evm.deployedBytecode.object']}}}};
  const output=JSON.parse(solc.compile(JSON.stringify(input),{import:imports}));
  assert.deepEqual((output.errors??[]).filter(error=>error.severity==='error'),[]);
  const artifacts = new Map();
  for(const [file,entries] of Object.entries(output.contracts)) for(const [name,artifact] of Object.entries(entries)) if(artifact.evm.bytecode.object) artifacts.set(name,{...artifact,file,name});
  return {artifacts,sources,compiler:solc.version(),contractsRoot:contracts};
}
