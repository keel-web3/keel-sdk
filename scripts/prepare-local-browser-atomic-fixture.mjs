import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import solc from 'solc';
import {createHash} from 'node:crypto';
import {keccak256} from 'viem';
import {mnemonicToAccount} from 'viem/accounts';
import {SOLIDITY_COMPILER_SETTINGS} from './solidity-compiler.mjs';
assert.match(solc.version(),/^0\.8\.36\+/);
const output=path.resolve(process.argv[2]??'/workspace/keel-site/apps/studio/.data/cloud-atomic-browser-20261017');
await mkdir(output,{recursive:true});
const sources={};for(const name of ['SyntheticAtomicExecutor.sol','LocalBrowserAtomicExecutor.sol'])sources[`tests/fixtures/native-geth-publication/${name}`]={content:await readFile(`tests/fixtures/native-geth-publication/${name}`,'utf8')};
const settings={optimizer:{enabled:true,runs:SOLIDITY_COMPILER_SETTINGS.optimizerRuns},viaIR:true,evmVersion:SOLIDITY_COMPILER_SETTINGS.evmVersion,metadata:{bytecodeHash:'none',appendCBOR:false},outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}};
const result=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources,settings})));assert.equal(result.errors?.filter(e=>e.severity==='error').length??0,0,JSON.stringify(result.errors));
const contract=result.contracts['tests/fixtures/native-geth-publication/LocalBrowserAtomicExecutor.sol'].LocalBrowserAtomicExecutor;
const delegate='0x00000000000000000000000000000000a70c2026',runtime=`0x${contract.evm.deployedBytecode.object}`;
const accounts=Array.from({length:10},(_,addressIndex)=>mnemonicToAccount('test test test test test test test test test test test junk',{addressIndex}));const owner=accounts[3].address;
const alloc=Object.fromEntries(accounts.map(a=>[a.address.slice(2).toLowerCase(),{balance:'0x211654585005212800000000'}]));alloc[owner.slice(2).toLowerCase()].code=`0xef0100${delegate.slice(2)}`;alloc[delegate.slice(2)]={balance:'0x0',code:runtime};
const genesis={config:{chainId:31337,homesteadBlock:0,eip150Block:0,eip155Block:0,eip158Block:0,byzantiumBlock:0,constantinopleBlock:0,petersburgBlock:0,istanbulBlock:0,berlinBlock:0,londonBlock:0,mergeNetsplitBlock:0,shanghaiTime:0,cancunTime:0,pragueTime:0,osakaTime:0,terminalTotalDifficulty:0},nonce:'0x0',timestamp:`0x${Math.floor(Date.now()/1000).toString(16)}`,extraData:'0x',gasLimit:'0xbebc200',difficulty:'0x0',mixHash:`0x${'00'.repeat(32)}`,coinbase:`0x${'00'.repeat(20)}`,baseFeePerGas:'0x3b9aca00',alloc};
const profile={schema:'keel-local-browser-atomic-fixture@1',chainId:31337,delegate,runtime:keccak256(runtime),owner,rpcUrl:'http://127.0.0.1:18547',appUrl:'http://127.0.0.1:4318',database:'keel_studio_atomic_20261017',genesisInitializationOnly:true,productionInstallation:false,realAccountPermissionGrant:false,sourceSHA256:createHash('sha256').update(JSON.stringify(sources)).digest('hex'),compiler:solc.version()};
for(const [name,value]of Object.entries({'atomic-wallet-artifact.json':{abi:contract.abi,bytecode:`0x${contract.evm.bytecode.object}`,deployedBytecode:runtime},'atomic-genesis.json':genesis,'atomic-fixture-profile.json':profile})){
 const target=path.join(output,name);try{await writeFile(target,JSON.stringify(value,null,2)+'\n',{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;assert.notEqual(name,'atomic-genesis.json','Existing atomic genesis preserved; do not regenerate/reset this fixture.');assert.equal(await readFile(target,'utf8'),JSON.stringify(value,null,2)+'\n');}
}
console.log(JSON.stringify(profile));
