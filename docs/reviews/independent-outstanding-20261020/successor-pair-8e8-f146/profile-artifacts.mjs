import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const root='/Users/ravonus/dev/wt/independent-outstanding-20261020/keel-contracts';
const sdk='/Users/ravonus/dev/wt/independent-outstanding-20261020/keel-sdk';
const compiled='86b1534b27ac7dce9ac7aaaf30318dab1808696c';
const equivalent='8e8e32df58b2a641a71ec7d449b4a407f1c002fb';
const {keccak256}=createRequire(path.join(sdk,'package.json'))('viem');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const git=(...args)=>cp.execFileSync('git',args,{cwd:root,maxBuffer:64*1024*1024});
assert.equal(git('rev-parse','HEAD').toString().trim(),equivalent);
assert.equal(git('diff',compiled,equivalent,'--','src','foundry.toml','remappings.txt','package.json','pnpm-lock.yaml').length,0);
const sources=new Map();
const names=['KEEL721','Keel721State','Keel721MetadataFormatting','KeelFactory','KEEL721Deployer','KeelRouted721','KeelNativeMediaPresentation'];
const artifacts=[];
for(const name of names){
  const rel=`out/${name}.sol/${name}.json`,bytes=fs.readFileSync(path.join(root,rel));
  const a=JSON.parse(bytes),m=JSON.parse(a.rawMetadata);
  assert.equal(m.compiler.version,'0.8.36+commit.8a079791');
  assert.equal(m.settings.optimizer.enabled,true);assert.equal(m.settings.optimizer.runs,50);
  assert.equal(m.settings.viaIR,true);assert.equal(m.settings.evmVersion,'prague');
  assert.deepEqual(m.settings.metadata,{bytecodeHash:'none',appendCBOR:false});
  assert.equal(Object.values(m.settings.compilationTarget).join(),name);
  for(const [rel,expected] of Object.entries(m.sources)){
    assert(!path.isAbsolute(rel)&&!rel.split('/').includes('..'));
    let src=sources.get(rel);
    if(!src){
      const actual=fs.readFileSync(path.join(root,rel));
      if(rel.startsWith('src/')){
        assert(actual.equals(git('show',compiled+':'+rel)));
        assert(actual.equals(git('show',equivalent+':'+rel)));
      }else{
        const match=/^node_modules\/(@openzeppelin\/contracts|erc721a-upgradeable|erc721a)\//u.exec(rel);
        assert(match,'Unexpected compiler dependency');
        const versions={'@openzeppelin/contracts':'5.6.1','erc721a':'4.3.0','erc721a-upgradeable':'4.3.0'};
        assert.equal(JSON.parse(fs.readFileSync(path.join(root,'node_modules',match[1],'package.json'))).version,versions[match[1]]);
      }
      src={path:rel,bytes:actual.length,sha256:sha(actual),keccak256:keccak256(actual)};sources.set(rel,src);
    }
    assert.equal(expected.keccak256,src.keccak256);
  }
  function code(c){
    const text=c.object,body=text.replace(/^0x/u,''),complete=/^[a-fA-F0-9]*$/u.test(body);
    assert.equal(body.length%2,0);
    return {bytes:body.length/2,objectTextSHA256:sha(text),completeHex:complete,
      ...(complete?{sha256:sha(Buffer.from(body,'hex')),keccak256:keccak256('0x'+body)}:{}),
      linkReferences:c.linkReferences??{},immutableReferences:c.immutableReferences??{}};
  }
  artifacts.push({name,path:rel,artifactBytes:bytes.length,artifactSHA256:sha(bytes),
    rawMetadataSHA256:sha(a.rawMetadata),abiSHA256:sha(JSON.stringify(a.abi)),abiEntries:a.abi.length,
    compiler:m.compiler,settings:m.settings,creation:code(a.bytecode),runtime:code(a.deployedBytecode),
    metadataSources:Object.keys(m.sources)});
}
const report={schema:'keel-independent-native-artifact-profile@1',compiledSourceCommit:compiled,
  verifiedEquivalentSolidityCommit:equivalent,currentGeneratedABISuccessorUncommitted:true,
  compileProvenance:{forge:'1.7.1/4072e48705af9d93e3c0f6e29e93b5e9a40caed8',solc:'0.8.36+commit.8a079791',coldCompileSeconds:1219.15,
  logSHA256:sha(fs.readFileSync('/tmp/keel-independent-contracts-forge-86b-20261020.log'))},
  scope:'Compiled artifact identities only; unresolved linked bytecode is a template, not deployed runtime or a qualified transaction. Constructor arguments, linking, runtime immutables, fresh chain state and gas remain separate gates.',
  transactionPrepared:false,gasQualified:false,onchainDeployed:false,artifacts,sources:[...sources.values()]};
const output='/tmp/keel-independent-native-artifact-profile-8e8-20261020.json';
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({output,sha256:sha(fs.readFileSync(output)),artifacts:artifacts.map(a=>({name:a.name,creation:a.creation.bytes,runtime:a.runtime.bytes,completeHex:a.runtime.completeHex})),metadataSources:sources.size}));
