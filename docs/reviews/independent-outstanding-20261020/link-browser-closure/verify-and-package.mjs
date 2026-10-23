import fs from 'node:fs';import path from 'node:path';import cp from 'node:child_process';import crypto from 'node:crypto';import assert from 'node:assert/strict';import{createRequire}from'node:module';
const root='/Users/ravonus/dev/wt/independent-outstanding-20261020/keel-contracts',sdk='/Users/ravonus/dev/wt/independent-outstanding-20261020/keel-sdk',compiled='86b1534b27ac7dce9ac7aaaf30318dab1808696c',equivalent='8e8e32df58b2a641a71ec7d449b4a407f1c002fb';
const sha=x=>crypto.createHash('sha256').update(x).digest('hex'),{keccak256}=createRequire(path.join(sdk,'package.json'))('viem');
const git=(...args)=>cp.execFileSync('git',args,{cwd:root,maxBuffer:32*1024*1024});
const targets=[['KeelLinkURIBuilder.t','LinkEnumProbe'],['KeelLinkURIBuilder.t','LinkAssemblyStore'],['KeelLinkURIBuilder.t','LinkAssemblyManager'],['KeelLinkURIBuilder.t','LinkAssemblyRegistry'],['KeelLinkRegistry','KeelLinkRegistry'],['KeelLinkURIBuilder','KeelLinkURIBuilder']];
const testBytes=fs.readFileSync(path.join(sdk,'tests/link-assembly-browser.test.mjs'));const expectedCalls=[...testBytes.toString().matchAll(/await deploy\('([^']+)','([^']+)'/gu)].map(m=>[m[1],m[2]]);assert.deepEqual(expectedCalls,targets);
function canon(x){if(Array.isArray(x))return x.map(canon);if(x&&typeof x==='object')return Object.fromEntries(Object.keys(x).sort().map(k=>[k,canon(x[k])]));return x;}
const abi=x=>x.map(e=>canon({...e,...(e.type==='function'?{outputs:e.outputs??[]}:{}),...(e.type==='fallback'?{inputs:e.inputs??[]}:{})})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
const sources=new Map(),artifacts=[],files=[];
for(const[file,name]of targets){
 const rel=`out/${file}.sol/${name}.json`,bytes=fs.readFileSync(path.join(root,rel)),a=JSON.parse(bytes),m=JSON.parse(a.rawMetadata);
 assert.equal(m.compiler.version,'0.8.36+commit.8a079791');assert.equal(m.settings.evmVersion,'prague');assert.equal(m.settings.viaIR,true);assert.deepEqual(m.settings.optimizer,{enabled:true,runs:50});assert.deepEqual(m.settings.metadata,{appendCBOR:false,bytecodeHash:'none'});assert.equal(Object.values(m.settings.compilationTarget).join(),name);assert.deepEqual(abi(a.abi),abi(m.output.abi));assert.deepEqual(m.sources,a.metadata.sources);assert.deepEqual(m.compiler,a.metadata.compiler);
 for(const[rel,expected]of Object.entries(m.sources)){
  assert(!path.isAbsolute(rel)&&!rel.split('/').includes('..'));let s=sources.get(rel);
  if(!s){const b=fs.readFileSync(path.join(root,rel));let origin;
   if(rel.startsWith('src/')||rel.startsWith('test/')){assert(b.equals(git('show',compiled+':'+rel)));assert(b.equals(git('show',equivalent+':'+rel)));origin='git-86b-byte-identical-8e8';}
   else{const match=/^node_modules\/(@openzeppelin\/contracts|erc721a-upgradeable|erc721a)\//u.exec(rel);assert(match);const version={'@openzeppelin/contracts':'5.6.1','erc721a':'4.3.0','erc721a-upgradeable':'4.3.0'}[match[1]];assert.equal(JSON.parse(fs.readFileSync(path.join(root,'node_modules',match[1],'package.json'))).version,version);origin='locked-'+match[1]+'@'+version;}
   s={path:rel,bytes:b.length,sha256:sha(b),keccak256:keccak256(b),origin};sources.set(rel,s);
  }assert.equal(s.keccak256,expected.keccak256);
 }
 artifacts.push({name,path:rel,bytes:bytes.length,sha256:sha(bytes),rawMetadataSHA256:sha(a.rawMetadata),compiler:m.compiler,settings:m.settings,abiSHA256:sha(JSON.stringify(a.abi)),metadataSources:Object.keys(m.sources)});files.push({path:rel,sha256:sha(bytes),base64:bytes.toString('base64')});
}
const receipt={schema:'keel-independent-link-browser-artifact-closure@1',compiledSourceCommit:compiled,verifiedEquivalentSourceCommit:equivalent,currentTestOnlySuccessor:git('rev-parse','HEAD').toString().trim(),test:{path:'tests/link-assembly-browser.test.mjs',sdkCommit:git('-C',sdk,'rev-parse','HEAD').toString().trim(),sha256:sha(testBytes),allSixDeployCallsCovered:true},independentColdCompile:true,artifacts,sources:[...sources.values()],fixtureReplacement:false,browserTestResult:'NOT RUN by artifact supplier',publicChainOperations:0};
const b=Buffer.from(JSON.stringify(receipt,null,2)+'\n'),receiptPath='out/independent-86b-link-browser-artifacts.json';fs.writeFileSync('/tmp/keel-independent-link-browser-artifacts-20261020.json',b,{flag:'wx'});files.push({path:receiptPath,sha256:sha(b),base64:b.toString('base64')});fs.writeFileSync('/tmp/keel-independent-link-browser-transfer-packet-20261020.json',JSON.stringify({files,sources:[...sources.values()]})+'\n',{flag:'wx'});console.log(JSON.stringify({artifactCount:artifacts.length,sourceCount:sources.size,receiptSHA256:sha(b)}));
