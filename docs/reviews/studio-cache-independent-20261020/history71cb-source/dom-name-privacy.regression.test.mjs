import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
const repo='/private/tmp/keel-history-prefix-20261021';
const ref=process.env.KEEL_REVIEW_SOURCE_REF??'ee0acf1ab3863ac3b3c811d130cc0674f430024d';
assert.match(ref,/^[a-f0-9]{40}$/);
const source=execFileSync('/usr/bin/git',['show',`${ref}:apps/studio/src/server/http/release-review-handoff-handler.ts`],{cwd:repo,encoding:'utf8'});
const require=createRequire(repo+'/apps/studio/package.json');
const ts=require('typescript');
const ast=ts.createSourceFile('actual-handler.ts',source,ts.ScriptTarget.Latest,true);
const chosen=ast.statements.filter(n=>(ts.isFunctionDeclaration(n)&&n.name?.text==='reviewFailureStructure')||(ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>['structuralFields','structuralCodes'].includes(d.name.getText(ast)))));
assert.equal(chosen.length,3);
const code=ts.transpileModule(chosen.map(n=>n.getText(ast)).join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const exports={};vm.runInNewContext(code,{exports,DOMException,Error,TypeError,RangeError,SyntaxError});
const allowed=new Set(['unknown','object','Error','TypeError','RangeError','SyntaxError','AbortError','TimeoutError']);
for(const first of ['AbortError','TimeoutError'])test(`actual classifier never emits second DOMException.name getter value after ${first} allowlist check`,()=>{
 let reads=0;const error=new DOMException('synthetic message',first);
 Object.defineProperty(error,'name',{get(){return ++reads===1?first:'https://private.invalid/RAW_SECRET?payload=creator-bytes';}});
 const projected=exports.reviewFailureStructure(error);
 assert(allowed.has(projected.errorType),`Only literal error classes may be emitted; received ${projected.errorType}`);
 assert.doesNotMatch(JSON.stringify(projected),/RAW_SECRET|private\.invalid|creator-bytes/);
});
test('standard DOMException labels remain structural vocabulary',()=>{
 for(const label of ['AbortError','TimeoutError'])assert.equal(exports.reviewFailureStructure(new DOMException('synthetic message',label)).errorType,label);
});
