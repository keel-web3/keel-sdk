const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{createRequire}=require('node:module');
const root='/Users/ravonus/dev/wt/studio-wallet-capable-routing-20261020/keel-site';
const req=createRequire('/Users/ravonus/dev/wt/studio-publication-20261019/qa-final/keel-site/apps/studio/package.json'),ts=req('typescript');
const dir='/private/tmp/keel-dependency-configuration-20261020';
function load(rel){const source=cp.execFileSync('git',['show','d3cdaf2b:'+rel],{cwd:root,encoding:'utf8'});const module={exports:{}};const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;new Function('require','module','exports',code)(req,module,module.exports);return{api:module.exports,sha256:crypto.createHash('sha256').update(source).digest('hex')};}
const parser=load('apps/studio/src/lib/inline-fragment-catalog.ts'),selection=load('apps/studio/src/lib/release-infrastructure-selection.ts');
const read=n=>JSON.parse(fs.readFileSync(path.join(dir,n),'utf8'));
const before=read('catalog.before.json'),proposed=read('catalog.proposed.json'),change=read('chain-contracts-change.proposed.json');
parser.api.parseKeelInlineFragmentCatalog(before);parser.api.parseKeelInlineFragmentCatalog(proposed);
const reversed=structuredClone(proposed);delete reversed.imagePresentation;reversed.compact.collectionCreationCodeHash=before.compact.collectionCreationCodeHash;assert.deepEqual(reversed,before);
assert.equal(proposed.chainId,11155111);assert.equal(proposed.compact.collectionCreationCodeHash,'0x0504f9bc293efe4137a0b54744e879ea5b4a47745b04861f56981e300fd397fb');
assert.deepEqual(proposed.imagePresentation,{address:'0x924c5fA733CF9eF24dc7b355261660dddb24cb1D',runtimeCodeHash:'0x3605de5ffc3c243724537e639fbb9feca2d3fe90091d70758e377ae254a9393d',deploymentTransactionHash:'0x0cedbca40d4920e0cbbc19c575fd3a436c7f5ca23e9f5f3aea70b69aa34641ff'});
const rows=[...change.expectedRows,change.insert].map(x=>({address:x.address,startBlock:BigInt(x.start_block),enabled:x.enabled}));
assert.equal(selection.api.selectLatestReleaseInfrastructure(rows).address,change.insert.address);
assert.equal(selection.api.selectLatestReleaseInfrastructure(rows.map(x=>x.address===change.insert.address?{...x,enabled:false}:x)).address,'0xe7f47a76d2887d0a54f7c40dcf7ffcc69e6f22be');
assert.equal(selection.api.selectLatestReleaseInfrastructure([...rows,{...rows.at(-1),address:'0x'+'11'.repeat(20)}]),undefined);
console.log(JSON.stringify({scope:'Offline exact-source parser and selector; no DB/network/config mutation',sourceCommit:'d3cdaf2b5b3822454353215c23eff7d8af9deb97',parserSHA256:parser.sha256,selectorSHA256:selection.sha256,catalogParse:true,exactTwoFieldDelta:true,newestFactorySelection:true,disabledRowRestoresOldSelection:true,tiedDistinctFactoryRejected:true,activationApproval:false},null,2));
