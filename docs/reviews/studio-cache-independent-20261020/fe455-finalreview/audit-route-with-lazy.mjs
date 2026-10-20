// Offline emitted-module identity only. Loading chunks registers definitions;
// no module factory, network, wallet, DB or native executor is invoked.
import fs from 'node:fs';import path from 'node:path';import{createRequire}from'node:module';import{createHash}from'node:crypto';
const [old,fresh,project]=process.argv.slice(2).map(x=>path.resolve(x));
const ts=createRequire(path.join(project,'package.json'))('typescript'),sha=x=>createHash('sha256').update(x).digest('hex');
function modules(root){
 const entry='app/api/projects/[projectId]/storage-review/route.js',file=path.join(root,entry),text=fs.readFileSync(file,'utf8'),sf=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),map=new Map(),orders=[],runtimeCallbacks=[];let tables=0,dependencies;
 function visit(n){
  if(ts.isBinaryExpression(n)&&n.operatorToken.kind===ts.SyntaxKind.EqualsToken&&ts.isPropertyAccessExpression(n.left)&&n.left.name.text==='modules'&&ts.isObjectLiteralExpression(n.right)){tables++;for(const p of n.right.properties){if(!ts.isPropertyAssignment(p)||!(ts.isNumericLiteral(p.name)||ts.isStringLiteral(p.name))||!(ts.isArrowFunction(p.initializer)||ts.isFunctionExpression(p.initializer)))throw Error('unrecognized_entry_module');map.set(p.name.text,{source:p.initializer.getText(sf),file:entry});}}
  if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='X'){if(dependencies||n.arguments.length!==3||!ts.isArrayLiteralExpression(n.arguments[1])||n.arguments[1].elements.some(x=>!ts.isNumericLiteral(x)))throw Error('unrecognized_route_registration');dependencies=n.arguments[1].elements.map(x=>x.text);}
  ts.forEachChild(n,visit);
 }visit(sf);if(tables!==1||!dependencies)throw Error('route_module_and_order_required');
 orders.push({file:entry,sha256:sha(text)});const req=createRequire(path.join(root,'webpack-runtime.js'));
 for(const id of dependencies){const name='chunks/'+id+'.js',raw=fs.readFileSync(path.join(root,name)),chunk=req(path.join(root,name));if(!Array.isArray(chunk.ids)||!chunk.ids.includes(Number(id)))throw Error('chunk_identity_changed');for(const[module,fn]of Object.entries(chunk.modules??{})){if(typeof fn!=='function')throw Error('module_function_required');map.set(module,{source:fn.toString(),file:name});}if(chunk.runtime)runtimeCallbacks.push({file:name,sha256:sha(chunk.runtime.toString())});orders.push({file:name,sha256:sha(raw)});}
 map.registrationOrder=orders;map.runtimeCallbacks=runtimeCallbacks;return map;
}
function normalized(source){const pre='const __actual = ',text=pre+source+';',file='actual.ts',sf=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
 const host={getSourceFile:n=>n===file?sf:undefined,getDefaultLibFileName:()=>'',writeFile:()=>{},getCurrentDirectory:()=>'',getDirectories:()=>[],fileExists:n=>n===file,readFile:n=>n===file?text:undefined,useCaseSensitiveFileNames:()=>true,getCanonicalFileName:n=>n,getNewLine:()=> '\n'};
 const checker=ts.createProgram([file],{noLib:true,noResolve:true,target:ts.ScriptTarget.Latest},host).getTypeChecker(),root=sf.statements[0]?.declarationList?.declarations[0]?.initializer;
 if(!(ts.isArrowFunction(root)||ts.isFunctionExpression(root)))throw Error('module_function_required');
 const parameter=root.parameters[2]?.name,symbol=parameter&&ts.isIdentifier(parameter)?checker.getSymbolAtLocation(parameter):undefined,calls=[];
 function walk(n){if(symbol&&ts.isCallExpression(n)&&ts.isIdentifier(n.expression)&&checker.getSymbolAtLocation(n.expression)===symbol&&n.arguments.length===1&&ts.isNumericLiteral(n.arguments[0])){const x=n.arguments[0];calls.push({start:x.getStart(sf)-pre.length,end:x.end-pre.length,id:x.text});}ts.forEachChild(n,walk);}walk(root);
 let value=source;for(const c of [...calls].reverse())value=value.slice(0,c.start)+'__WEBPACK_NUMERIC_ID__'+value.slice(c.end);return{value,calls};
}
const a=modules(old),b=modules(fresh),needle='State reads require explicit configured recipients and a pinned block.';
function entry(map){const values=[...map].filter(([,v])=>v.source.includes(needle));if(values.length!==1)throw Error('actual_factory_ambiguous');return values[0][0];}
const aid=entry(a),bid=entry(b);
const lazyChunkProof=[];
for(const id of [28424,99882,58636]){
 for(const [root,map] of [[old,a],[fresh,b]]){
  const relative='chunks/'+id+'.js',raw=fs.readFileSync(path.join(root,relative));
  const req=createRequire(path.join(root,'webpack-runtime.js')),chunk=req(path.join(root,relative));
  if(!Array.isArray(chunk.ids)||!chunk.ids.includes(id)||chunk.runtime)throw Error('lazy_chunk_identity_or_runtime');
  const added=[];
  for(const [mid,fn] of Object.entries(chunk.modules)){
   if(typeof fn!=='function')throw Error('lazy_definition_type');
   if(map.has(mid)&&map.get(mid).source!==fn.toString())throw Error('lazy_duplicate_override');
   map.set(mid,{source:fn.toString(),file:relative});added.push(mid);
  }
  lazyChunkProof.push({root,relative,bytes:raw.length,sha256:sha(raw),modules:added});
 }
}

function selected(map,id){return map.get(id);}
const queue=[[aid,bid],['28424','28424']],mapping=new Map(),inverse=new Map(),records=[],failures=[];
while(queue.length){const[x,y]=queue.shift();if(mapping.has(x)){if(mapping.get(x)!==y)failures.push({old:x,candidate:y,reason:'mapping_conflict'});continue;}
 if(inverse.has(y)&&inverse.get(y)!==x){failures.push({old:x,candidate:y,reason:'non_bijective_mapping'});continue;}mapping.set(x,y);inverse.set(y,x);
 let av,bv;try{av=selected(a,x);bv=selected(b,y);}catch(error){failures.push({old:x,candidate:y,reason:error.message});continue;}if(!av||!bv){failures.push({old:x,candidate:y,reason:'missing_definition'});continue;}
 const an=normalized(av.source),bn=normalized(bv.source),equal=an.value===bn.value;
 records.push({old:x,candidate:y,oldSHA256:sha(av.source),candidateSHA256:sha(bv.source),oldBytes:Buffer.byteLength(av.source),candidateBytes:Buffer.byteLength(bv.source),normalizedSHA256:equal?sha(an.value):null,equalExceptTypedNumericRequireIds:equal,directCalls:an.calls.length,oldChunk:av.file,candidateChunk:bv.file});
 if(!equal||an.calls.length!==bn.calls.length){failures.push({old:x,candidate:y,reason:'other_body_or_call_shape_change'});continue;}
 if(!process.argv.includes('--direct-only')||x===aid)for(let i=0;i<an.calls.length;i++)queue.push([an.calls[i].id,bn.calls[i].id]);
}
const out={schema:'keel.actual-compiled-proof-transitive-identity@1',result:failures.length?'FAIL_UNPROVEN_COMPILED_CLOSURE':process.argv.includes('--direct-only')?'PASS_FACTORY_AND_ALL_DIRECT_DEPENDENCY_DEFINITIONS':'PASS_ENTIRE_REACHABLE_COMPILED_CLOSURE',scope:process.argv.includes('--direct-only')?'factory-and-direct-definitions':'transitive',oldRoot:old,candidateRoot:fresh,entryRoute:'app/api/projects/[projectId]/storage-review/route.js',oldRegistrationOrder:a.registrationOrder,candidateRegistrationOrder:b.registrationOrder,oldRuntimeCallbacks:a.runtimeCallbacks,candidateRuntimeCallbacks:b.runtimeCallbacks,normalization:'Only numeric argument of one-argument call bound by TypeScript symbol identity to the root third webpack parameter. No string/shadowed/other rewrite.',typescript:ts.version,records,failures,moduleFactoriesInvoked:false,networkInvoked:false,nativeInvoked:false};console.log(JSON.stringify(out,null,2));if(failures.length)process.exitCode=1;

const supplemental=[];
for(const r of records){
 const source=selected(a,r.old).source,pre='const __module = ',text=pre+source+';',file='extra.ts',sf=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
 const host={getSourceFile:n=>n===file?sf:undefined,getDefaultLibFileName:()=>'',writeFile:()=>{},getCurrentDirectory:()=>'',getDirectories:()=>[],fileExists:n=>n===file,readFile:n=>n===file?text:undefined,useCaseSensitiveFileNames:()=>true,getCanonicalFileName:n=>n,getNewLine:()=> '\n'};
 const checker=ts.createProgram([file],{noLib:true,noResolve:true,target:ts.ScriptTarget.Latest},host).getTypeChecker(),fn=sf.statements[0].declarationList.declarations[0].initializer;
 const parameter=fn.parameters[2]?.name,symbol=parameter&&ts.isIdentifier(parameter)?checker.getSymbolAtLocation(parameter):undefined;
 function walk(n){if(symbol&&ts.isCallExpression(n)){
  if(ts.isIdentifier(n.expression)&&checker.getSymbolAtLocation(n.expression)===symbol&&!(n.arguments.length===1&&ts.isNumericLiteral(n.arguments[0])))supplemental.push({module:r.old,kind:'nonliteral-direct-load',call:n.getText(sf)});
  if(ts.isPropertyAccessExpression(n.expression)&&ts.isIdentifier(n.expression.expression)&&checker.getSymbolAtLocation(n.expression.expression)===symbol&&['e','bind','t','resolve'].includes(n.expression.name.text))supplemental.push({module:r.old,kind:n.expression.name.text,call:n.getText(sf)});
 }ts.forEachChild(n,walk);}walk(fn);
}
console.log(JSON.stringify({lazyChunkProof,schema:'keel.independent-proof-loader-edge-scope@1',reachable:records.length,oldRuntimeCallbacks:a.runtimeCallbacks,candidateRuntimeCallbacks:b.runtimeCallbacks,supplementalLoaderCalls:supplemental,normalizationSourceUnchanged:true}));
