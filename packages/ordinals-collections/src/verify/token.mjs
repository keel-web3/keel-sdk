import {recipeCheck,formCheck} from '../mint.ts';
import {indexRoot} from '../index/root.mjs';
import {verifyPosition} from '../challenge/index.mjs';
const same=(a,b)=>['txid','height','txIndex','m','paymentOutpoint'].every(k=>a[k]===b[k]);
// Supplied host hashes, reference locations, controls, charms and burn status still
// require an authenticated source. This function never promotes them to a verdict.
export function verifyTokenEvidence(input){
 const {recipe,refs,index,entries,hostHashes,token}=input;
 const checks={recipe:false,indexRoot:false,member:false,ownForm:false,ownPosition:false,priorEntries:false,depth:false};
 try {
  checks.recipe=recipeCheck(recipe,refs).length===0;
  const root=indexRoot({recipe:recipe.id,height:index.height,blockhash:index.hash,members:index.members,refunds:index.refunds});
  checks.indexRoot=root.indexRoot===index.root && hostHashes?.[index.height]===index.hash;
  const at=index.members.findIndex(x=>x.txid===token);checks.member=at>=0;
  if(at>=0){
   const inspect=row=>{const proof=entries[row.txid];if(!proof || !Array.isArray(proof.charms)||!proof.commitTx)return {form:false,position:false};
    const result=formCheck({...proof,recipe,refs});
    return {form:!result.error&&same(result,row),position:verifyPosition(proof.position,row,hostHashes)};
   };
   const own=inspect(index.members[at]);checks.ownForm=own.form;checks.ownPosition=own.position;
   checks.priorEntries=index.members.slice(0,at).every(e=>{const x=inspect(e);return x.form&&x.position});
   checks.depth=Number.isSafeInteger(input.tip)&&input.tip-index.members[at].height+1>=recipe.finality;
  }
 }catch{}
 return {checks,rank:checks.member?index.members.findIndex(x=>x.txid===token)+1:null,evidenceValid:Object.values(checks).every(Boolean),verified:false,status:'pending authenticated source, index completeness, charms and burn evidence'};
}
