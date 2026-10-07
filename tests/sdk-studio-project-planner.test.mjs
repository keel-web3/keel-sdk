import assert from "node:assert/strict";
import test from "node:test";
import { answerKeelStudioPlan, assessKeelPublicationPreflight, compileKeelPlanMatrix, keelStudioPlanFingerprint, resolveKeelStudioPlan } from "../packages/sdk/dist/studio-project-planner.js";

const available = value => ({value,label:value,status:"available"});
const matrix={schema:"keel-studio-plan-matrix@1",capabilityRevision:"network-1:reader-a:v1",fields:[
 {id:"title",label:"What is it called?",kind:"text",required:true},
 {id:"outcome",label:"Store or release?",kind:"choice",choices:[available("storage-only"),available("release")],required:true,allowDefault:true},
 {id:"chainId",label:"Which network?",kind:"integer",minimum:1,required:true,allowDefault:true},
 {id:"usesJavaScript",label:"Does it use JavaScript?",kind:"boolean",required:true,allowDefault:true},
 {id:"modules",label:"Which modules?",kind:"multi-choice",choices:[available("three")],when:{field:"usesJavaScript",equals:true},required:true,advanced:true},
 {id:"contract",label:"Which collection?",kind:"address",dependencies:["chainId"],when:{field:"outcome",equals:"release"},required:true,advanced:true},
 {id:"compression",label:"How should files be kept?",kind:"choice",choices:[available("compact"),available("raw")],required:true,allowDefault:true},
]};
const plan=(answers={})=>({schema:"keel-studio-plan@1",id:"plan-1",projectId:"project-1",revision:1,mode:"guided",mediaType:"image/png",resources:[],answers,
 defaults:{revision:"prefs-1",global:{outcome:"storage-only",chainId:1,usesJavaScript:false,compression:"compact"},byMedia:{"image/png":{compression:"raw"}}}});
const address="0x"+"1".repeat(40);

test("one shared resolver asks a single next question and applies valid explicit defaults",()=>{
 const result=resolveKeelStudioPlan(matrix,plan());assert.equal(result.nextQuestion.id,"title");assert.equal(result.nextQuestion.advanced,false);
 assert.equal(result.answers.compression,"raw");assert.equal(result.answers.usesJavaScript,false);assert.equal(result.activeFields.some(f=>f.id==="modules"),false);
});
test("recommendations never silently answer required fields",()=>{
 const result=resolveKeelStudioPlan({...matrix,fields:[{id:"title",label:"Title",kind:"text",required:true,recommendation:"Suggested"}]},plan());
 assert.equal(result.status,"needs-input");assert.equal(result.answers.title,undefined);
});
test("project defaults override media defaults while explicit answers override both",()=>{
 const base=plan({title:"Work"});base.defaults.project={compression:"compact"};assert.equal(resolveKeelStudioPlan(matrix,base).answers.compression,"compact");
 base.answers.compression="raw";assert.equal(resolveKeelStudioPlan(matrix,base).answers.compression,"raw");
});
test("stale or invalid defaults reopen the relevant question",()=>{
 const base=plan({title:"Work"});base.defaults.global.chainId=0;assert.equal(resolveKeelStudioPlan(matrix,base).nextQuestion.id,"chainId");
});
test("required advanced questions become primary instead of remaining hidden",()=>{
 const result=resolveKeelStudioPlan(matrix,plan({title:"Work",usesJavaScript:true}));assert.equal(result.nextQuestion.id,"modules");assert.equal(result.nextQuestion.advanced,false);
});
test("Back restores inactive branch values without leaking them into a different branch",()=>{
 const base=plan({title:"Work",outcome:"release",contract:address});
 const storage=answerKeelStudioPlan(matrix,base,1,{outcome:"storage-only"});const resolved=resolveKeelStudioPlan(matrix,storage);
 assert.equal(resolved.answers.contract,undefined);assert.equal(resolved.inactiveAnswers.contract,address);
 const back=answerKeelStudioPlan(matrix,storage,2,{outcome:"release"});assert.equal(resolveKeelStudioPlan(matrix,back).answers.contract,address);
});
test("changing network invalidates a still-visible contract address and restores it only for its original network",()=>{
 const base=plan({title:"Work",outcome:"release",chainId:1,contract:address});
 const moved=answerKeelStudioPlan(matrix,base,1,{chainId:2});assert.equal(resolveKeelStudioPlan(matrix,moved).nextQuestion.id,"contract");
 const back=answerKeelStudioPlan(matrix,moved,2,{chainId:1});assert.equal(resolveKeelStudioPlan(matrix,back).answers.contract,address);
});
test("batched explicit dependent answers are anchored to the new context",()=>{
 const base=plan({title:"Work",outcome:"release",chainId:1,contract:address});const changed=answerKeelStudioPlan(matrix,base,1,{chainId:2,contract:"0x"+"2".repeat(40)});
 assert.equal(resolveKeelStudioPlan(matrix,changed).answers.contract,"0x"+"2".repeat(40));
});
test("direct mode has the same readiness and cannot bypass missing contract parameters",()=>{
 const base=plan({title:"Work",outcome:"release"});const guided=resolveKeelStudioPlan(matrix,base);const direct=resolveKeelStudioPlan(matrix,{...base,mode:"direct"});
 assert.deepEqual(direct,guided);assert.equal(direct.nextQuestion.id,"contract");
});
test("unsupported capabilities are blocked with their actual explanation",()=>{
 const modified={...matrix,fields:[...matrix.fields,{id:"sale",label:"Sale",kind:"choice",required:true,choices:[{value:"sealed",label:"Sealed bid",status:"unsupported",explanation:"No audited deployed implementation is available."}]}]};
 const result=resolveKeelStudioPlan(modified,plan({title:"Work",sale:"sealed"}));assert.equal(result.status,"blocked");assert.match(result.issues[0].message,/audited/u);
});
test("stale edits and invalid matrix graphs are rejected",()=>{
 assert.throws(()=>answerKeelStudioPlan(matrix,plan(),2,{title:"Other"}),/changed/u);
 assert.throws(()=>compileKeelPlanMatrix({...matrix,fields:[{id:"a",label:"A",kind:"text",required:true,dependencies:["b"]},{id:"b",label:"B",kind:"text",required:true,dependencies:["a"]}]}),/cycle/u);
 assert.throws(()=>compileKeelPlanMatrix({...matrix,fields:[{id:"a",label:"A",kind:"text",required:true,dependencies:["missing"]}]}),/Unknown/u);
});
test("resumption and semantically unchanged edits retain review, changed answers invalidate it",()=>{
 const base=plan({title:"Work"});const resolved=resolveKeelStudioPlan(matrix,base);const reviewed={...base,reviewedConfiguration:resolved.configurationKey};
 assert.equal(resolveKeelStudioPlan(matrix,JSON.parse(JSON.stringify(reviewed))).reviewed,true);
 assert.equal(resolveKeelStudioPlan(matrix,answerKeelStudioPlan(matrix,reviewed,1,{title:"Work"})).reviewed,true);
 assert.equal(resolveKeelStudioPlan(matrix,answerKeelStudioPlan(matrix,reviewed,1,{title:"New"})).reviewed,false);
});
test("fingerprints bind resource identity and capability revision, not the guided/direct preference",async()=>{
 const base=plan({title:"Work"});base.resources=[{id:"css",mediaType:"text/css",digest:"0x"+"a".repeat(64),byteLength:10,source:{kind:"local",path:"work.css"}}];
 const first=await keelStudioPlanFingerprint(matrix,base);assert.equal(first,await keelStudioPlanFingerprint(matrix,{...base,mode:"direct"}));
 assert.notEqual(first,await keelStudioPlanFingerprint({...matrix,capabilityRevision:"new-reader"},base));
 assert.notEqual(first,await keelStudioPlanFingerprint(matrix,{...base,resources:[{...base.resources[0],digest:"0x"+"b".repeat(64)}]}));
});
const now=Date.parse("2026-10-07T00:00:01Z");
const gate={fingerprint:"exact-config",chainId:1,readerIdentity:"reader-code-hash",required:["source-bytes","complete-metadata","reader-simulation"],now};
const evidence={schema:"keel-publication-preflight@1",planFingerprint:gate.fingerprint,chainId:1,readerIdentity:gate.readerIdentity,checkedAt:"2026-10-07T00:00:00Z",expiresAt:"2026-10-07T00:01:00Z",observations:gate.required.map(id=>({id,status:"passed",explanation:"Verified in a test"}))};
test("preflight never passes on absence, unknown results, stale configuration, or expiry",()=>{
 assert.equal(assessKeelPublicationPreflight(gate).ready,false);
 assert.equal(assessKeelPublicationPreflight({...gate,evidence}).ready,true);
 assert.equal(assessKeelPublicationPreflight({...gate,evidence,fingerprint:"edited"}).ready,false);
 assert.equal(assessKeelPublicationPreflight({...gate,evidence,readerIdentity:"upgraded"}).ready,false);
 assert.equal(assessKeelPublicationPreflight({...gate,evidence,now:Date.parse(evidence.expiresAt)}).ready,false);
 assert.equal(assessKeelPublicationPreflight({...gate,evidence:{...evidence,observations:[...evidence.observations.slice(0,2),{id:"reader-simulation",status:"unknown",explanation:"Unavailable"}]}}).ready,false);
});
test("duplicate evidence cannot overwrite a failed result",()=>{
 assert.equal(assessKeelPublicationPreflight({...gate,evidence:{...evidence,observations:[{id:"source-bytes",status:"failed",explanation:"Mismatch"},...evidence.observations]}}).reason,"ambiguous-preflight");
});

test("capability migration keeps retired settings for Back without emitting them",async()=>{
 const {migrateKeelStudioPlan}=await import("../packages/sdk/dist/studio-project-planner.js");
 const base=plan({title:"Work",usesJavaScript:true,modules:["three"]});
 const narrower={...matrix,capabilityRevision:"no-scripts",fields:matrix.fields.filter(field=>field.id!=="modules")};
 const migrated=migrateKeelStudioPlan(narrower,base);assert.deepEqual(migrated.retiredAnswers.modules,["three"]);assert.equal(resolveKeelStudioPlan(narrower,migrated).answers.modules,undefined);
 const restored=migrateKeelStudioPlan(matrix,migrated);assert.deepEqual(resolveKeelStudioPlan(matrix,restored).answers.modules,["three"]);
});

test("new sessions pin supplied answers and preferences without retaining mutable caller arrays",async()=>{
 const {createKeelStudioPlan}=await import("../packages/sdk/dist/studio-project-planner.js");
 const initial=plan({title:"Work",usesJavaScript:true,modules:["three"],outcome:"release",chainId:1,contract:address});
 const created=createKeelStudioPlan(matrix,initial);
 initial.answers.modules.push("unexpected");initial.defaults.global.chainId=99;
 assert.deepEqual(created.answers.modules,["three"]);assert.equal(created.defaults.global.chainId,1);
 assert.equal(resolveKeelStudioPlan(matrix,answerKeelStudioPlan(matrix,created,1,{chainId:2})).nextQuestion.id,"contract");
});
