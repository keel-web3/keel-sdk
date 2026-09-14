import {parseLayeredArt,sampleLayeredArt,layeredManifestDigest} from './layered-art.js';

/** Probabilities before conditions and measured outcomes use different denominators. */
export async function analyzeLayeredMath(value:unknown,count=250,seed?:string){
  const art=parseLayeredArt(value),sample=await sampleLayeredArt(art,count,seed??art.seed);
  const successful=count-sample.failures.length;
  const edges=art.attributes.flatMap(a=>a.items.flatMap(i=>i.rules.map(r=>({from:r.attributeId,to:a.id,itemId:i.id,mode:r.mode,itemIds:r.itemIds}))));
  const attributes=art.attributes.map(a=>{
    const total=a.items.reduce((sum,i)=>sum+i.weight,0);
    return {id:a.id,name:a.name,totalWeight:total,items:a.items.map(i=>{
      const observed=sample.counts[`${a.id}/${i.id}`]??0;
      return {id:i.id,name:i.name,weight:i.weight,beforeConditions:total?i.weight/total:0,observed,observedFraction:successful?observed/successful:null,conditionCount:i.rules.length};
    })};
  });
  return {schema:'keel-layered-math@1',manifestDigest:await layeredManifestDigest(art),seed:seed??art.seed,count,successful,attributes,edges,failures:sample.failures,duplicates:sample.duplicates,
    exceptions:(art.exceptions??[]).map(r=>({id:r.id,name:r.name,enabled:r.enabled,match:r.match,conditions:r.conditions,actions:r.actions})),
    proof:'deterministic-sample-only',explanation:'Weights are relative within an attribute. Conditions change eligible choices. Observed percentages count visible traits in successful samples; inclusions can make an attribute total exceed 100%. Zero observations do not prove impossibility. Saved candidates retain their original version.'};
}
