import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
const gethCommit='a579077007b98217c3e253a66e4b452ca0c32b96';
const root=process.cwd(),build=resolve(process.env.KEEL_NATIVE_BUILD_DIR??'/tmp/keel-proof-executor-build');
const source=join(build,'geth'),binary=join(build,'keel-proof-executor');mkdirSync(build,{recursive:true});
execFileSync('git',['diff','--exit-code','HEAD'],{cwd:root,stdio:'pipe'});
const run=(cmd,args,cwd=root)=>execFileSync(cmd,args,{cwd,stdio:'inherit',env:process.env});
if(!existsSync(join(source,'.git')))run('git',['clone','--depth','1','--branch','v1.17.8','https://github.com/ethereum/go-ethereum.git',source]);
execFileSync('git',['diff','--exit-code','HEAD'],{cwd:source,stdio:'pipe'});
const allowedOverlays=new Set(['cmd/keel-proof-executor/main.go','cmd/keel-proof-fixture/main.go','internal/ethapi/keel_sparse.go','internal/keelfork/reader.go']);
const untracked=execFileSync('git',['ls-files','--others','--exclude-standard'],{cwd:source,encoding:'utf8'}).trim().split('\n').filter(Boolean);
if(untracked.some(path=>!allowedOverlays.has(path)))throw new Error('Unexpected files in pinned engine checkout.');
const actual=execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim();if(actual!==gethCommit)throw new Error('Pinned Geth source mismatch.');
for(const path of allowedOverlays){
  const relative=`native/proof-executor/geth-overlay/${path}`;
  execFileSync('git',['ls-files','--error-unmatch',relative],{cwd:root,stdio:'pipe'});
  const target=join(source,path);mkdirSync(resolve(target,'..'),{recursive:true});cpSync(join(root,relative),target);
}
run(process.env.KEEL_GO_BINARY??'go',['build','-p','2','-trimpath','-o',binary,'./cmd/keel-proof-executor'],source);
run(process.env.KEEL_GO_BINARY??'go',['build','-p','2','-trimpath','-o',join(build,'keel-proof-fixture'),'./cmd/keel-proof-fixture'],source);
const receipt={schema:'keel-proof-executor-build@1',gethCommit,sdkCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),binarySha256:createHash('sha256').update(readFileSync(binary)).digest('hex'),binaryBytes:readFileSync(binary).length,sourceTree:execFileSync('git',['rev-parse','HEAD^{tree}'],{cwd:root,encoding:'utf8'}).trim(),goVersion:execFileSync(process.env.KEEL_GO_BINARY??'go',['version'],{encoding:'utf8'}).trim()};
writeFileSync(join(build,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
