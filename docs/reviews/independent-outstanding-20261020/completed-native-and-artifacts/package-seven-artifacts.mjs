import fs from 'node:fs';import path from 'node:path';import cp from 'node:child_process';import crypto from 'node:crypto';import{createRequire}from'node:module';import{isDeepStrictEqual}from'node:util';
const root='/Users/ravonus/dev/wt/independent-outstanding-20261020/keel-contracts',output='/tmp/keel-independent-7-artifacts-86b-8e8-20261020';
const sdk='/Users/ravonus/dev/wt/independent-outstanding-20261020/keel-sdk',old='86b1534b27ac7dce9ac7aaaf30318dab1808696c',fresh='8e8e32df58b2a641a71ec7d449b4a407f1c002fb';
const{keccak256}=createRequire(path.join(sdk,'package.json'))('viem'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const git=(...args)=>cp.execFileSync('git',args,{cwd:root,maxBuffer:32*1024*1024});
if(git('rev-parse','HEAD').toString().trim()!==old||git('status','--porcelain','--untracked-files=no').toString().trim())throw Error('Exact clean independent86b source required');
if(git('diff',old,fresh,'--','src','foundry.toml','remappings.txt','package.json','pnpm-lock.yaml').length)throw Error('Solidity/compiler/dependency difference against8e8');
fs.mkdirSync(output,{mode:0o700});
const names=['KeelCreator1155','KeelCreatorFactory','KeelMintRouteRegistry','KEEL721','KeelManager','KeelManagerProxy','KeelShared1155'];
function canonical(x){if(Array.isArray(x))return x.map(canonical);if(x&&typeof x==='object')return Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])]));return x;}
function canonicalABI(a){return a.map(e=>canonical({...e,...(e.type==='function'?{outputs:e.outputs??[]}:{} ),...(e.type==='fallback'?{inputs:e.inputs??[]}:{} )})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));}
function canonicalMetadata(m){const n=structuredClone(m);n.settings.remappings=n.settings.remappings.map(x=>x.startsWith(':')?x.slice(1):x);n.output.abi=canonicalABI(n.output.abi);return n;}
const sourceCache=new Map(),artifacts=[];
for(const name of names){
 const relative=`out/${name}.sol/${name}.json`,file=path.join(root,relative),bytes=fs.readFileSync(file),r=JSON.parse(bytes),m=JSON.parse(r.rawMetadata);
 if(!isDeepStrictEqual(m.sources,r.metadata.sources)||!isDeepStrictEqual(m.compiler,r.metadata.compiler)||m.language!==r.metadata.language||m.version!==r.metadata.version||!isDeepStrictEqual(canonicalMetadata(m).settings,canonicalMetadata(r.metadata).settings)||!isDeepStrictEqual(canonicalABI(m.output.abi),canonicalABI(r.metadata.output.abi))||m.compiler.version!=='0.8.36+commit.8a079791'||m.settings.optimizer?.enabled!==true||m.settings.optimizer.runs!==50||m.settings.viaIR!==true||m.settings.evmVersion!=='prague'||m.settings.metadata.bytecodeHash!=='none'||m.settings.metadata.appendCBOR!==false||Object.keys(m.settings.compilationTarget).length!==1||Object.values(m.settings.compilationTarget)[0]!==name||!isDeepStrictEqual(canonicalABI(m.output.abi),canonicalABI(r.abi)))throw Error('Compiled metadata/settings/ABI mismatch');
 const sources=[];
 for(const [relative,expected]of Object.entries(m.sources)){
  if(path.isAbsolute(relative)||relative.split('/').includes('..'))throw Error('Unbounded metadata source path');
  let s=sourceCache.get(relative);
  if(!s){
   let source,origin;
   if(relative.startsWith('src/')){const a=git('show',old+':'+relative),b=git('show',fresh+':'+relative);if(!a.equals(b)||!a.equals(fs.readFileSync(path.join(root,relative))))throw Error('Git source mismatch');source=a;origin={kind:'git',compiledCommit:old,verifiedEquivalentCommit:fresh};}
   else if(relative.startsWith('node_modules/')){
    const match=relative.match(/^node_modules\/(@openzeppelin\/contracts|erc721a-upgradeable|erc721a)\//u);if(!match)throw Error('Unknown dependency source');
    const expectedVersion={'@openzeppelin/contracts':'5.6.1','erc721a':'4.3.0','erc721a-upgradeable':'4.3.0'}[match[1]],pkg=fs.readFileSync(path.join(root,'node_modules',match[1],'package.json'));
    if(JSON.parse(pkg).version!==expectedVersion)throw Error('Dependency version mismatch');
    source=fs.readFileSync(path.join(root,relative));origin={kind:'locked-dependency',package:match[1],version:expectedVersion,packageJSONSHA256:sha(pkg),lockSHA256:sha(git('show',fresh+':pnpm-lock.yaml')),freshFrozenInstall:true};
   }else throw Error('Unexpected compiler source scope');
   s={path:relative,bytes:source.length,sha256:sha(source),keccak256:keccak256(source),origin};sourceCache.set(relative,s);
  }
  if(expected.keccak256!==s.keccak256)throw Error('Compiler metadata source Keccak mismatch');sources.push(relative);
 }
 const dest=path.join(output,relative);fs.mkdirSync(path.dirname(dest),{recursive:true,mode:0o700});fs.writeFileSync(dest,bytes,{flag:'wx',mode:0o600});
 artifacts.push({name,path:relative,bytes:bytes.length,sha256:sha(bytes),compiler:m.compiler,settings:m.settings,rawMetadataSHA256:sha(r.rawMetadata),abiSHA256:sha(JSON.stringify(r.abi)),creationBytecodeTextSHA256:sha(r.bytecode.object),runtimeBytecodeTextSHA256:sha(r.deployedBytecode.object),sources});
}
const compileLog=fs.readFileSync('/tmp/keel-independent-contracts-forge-86b-20261020.log');if(!compileLog.includes(Buffer.from('Solc 0.8.36 finished in 1219.15s')))throw Error('Genuine coldcompile completion receipt missing');
const receipt={schema:'keel-independent-compiled-seven-artifacts@1',compiledSourceCommit:old,sourceTree:git('rev-parse',old+'^{tree}').toString().trim(),verifiedEquivalentSolidityCommit:fresh,forgeVersion:'1.7.1/4072e48705af9d93e3c0f6e29e93b5e9a40caed8',independentColdCompile:true,solcCompileSeconds:1219.15,fullForgeSuiteResult:'INCOMPLETE: original process gone without final summary/exit receipt; no PASS claim',sourceAndDependencyProfileDiffAgainst8e8:'EMPTY',fixtureOrMockReplacement:false,metadataComparisonNormalization:['Top-level ABI declaration order only','Absent function outputs equals empty outputs[]','Absent fallback inputs equals empty inputs[]','Empty remapping context leading colon only; no source/settings/value ignored','Forge parsed NatSpec may omit documentation fields; full rawMetadata+originalartifact retained and hash-bound, all compiler/settings/source/ABI execution fields compared'],artifacts,sources:[...sourceCache.values()],publicChainProof:false,productionOperations:0};
fs.writeFileSync(path.join(output,'artifact-receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({output,artifacts:artifacts.length,metadataSources:sourceCache.size,receiptSHA256:sha(fs.readFileSync(path.join(output,'artifact-receipt.json')))}));
