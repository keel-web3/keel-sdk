import {addLayerCandidate,assignLayerCandidate,removeLayerCandidateFromSet,resolveLayerCandidate,layerCurationStats,layerCurationPlan,newLayerCuration,parseLayerCuration} from '@keel/sdk/layered-curation';
import type {ToolDefinition} from './types.js';

/** Pure planning operations; desktop edits use its scoped, reviewable workspace tool. */
export const CURATION_TOOL_DEFINITIONS: readonly ToolDefinition[] = [{
  descriptor: {
    name:'keel-layered-curation',
    description:'Build a local candidate pool and ordered curated set using saved generator versions. Operations return a new workbench or local evidence; they never write files, assign live tokens, sign, or publish. Keep private set plans out of public metadata.',
    inputSchema:{type:'object',properties:{
      operation:{type:'string',enum:['add','assign','remove','resolve','stats','plan']},
      workbenchJson:{type:'string',maxLength:8000000},manifestJson:{type:'string',maxLength:2000000},
      candidateId:{type:'string',maxLength:64},index:{type:'integer',minimum:0,maximum:5000},
      seed:{type:'string',maxLength:256},tokenId:{type:'string',maxLength:78},
      choicesJson:{type:'string',maxLength:32000,description:'Optional object containing overrides and variantOverrides by stable attribute/item IDs.'},
    },required:['operation'],additionalProperties:false},
  },
  async run(_context,input){
    const v=input as Record<string,unknown>;
    if(!v||Array.isArray(v)||typeof v!=='object'||Object.keys(v).some(k=>!['operation','workbenchJson','manifestJson','candidateId','index','seed','tokenId','choicesJson'].includes(k)))throw Error('Invalid curation request.');
    for(const [key,max] of [['workbenchJson',8000000],['manifestJson',2000000],['choicesJson',32000],['candidateId',64],['seed',256],['tokenId',78]] as const)if(v[key]!==undefined&&(typeof v[key]!=='string'||(v[key] as string).length>max))throw Error(`Supply a bounded ${key}.`);
    if(v.index!==undefined&&(!Number.isInteger(v.index)||Number(v.index)<0||Number(v.index)>5000))throw Error('Invalid set position.');
    const state=v.workbenchJson===undefined?newLayerCuration():parseLayerCuration(JSON.parse(v.workbenchJson as string));
    if(v.operation==='add'){
      if(!v.manifestJson)throw Error('Supply manifestJson for the candidate.');
      const choices=v.choicesJson?JSON.parse(v.choicesJson as string):{};
      if(!choices||Array.isArray(choices)||typeof choices!=='object'||Object.keys(choices).some(k=>!['overrides','variantOverrides'].includes(k)))throw Error('Invalid curated choices.');
      return addLayerCandidate(state,JSON.parse(v.manifestJson as string),{...choices,seed:v.seed as string??'1',tokenId:v.tokenId as string??'1',origin:Object.keys(choices).length?'curated':'generated'});
    }
    if(v.operation==='stats')return layerCurationStats(state);
    if(v.operation==='plan')return layerCurationPlan(state);
    if(typeof v.candidateId!=='string')throw Error('Choose a candidate.');
    if(v.operation==='resolve')return resolveLayerCandidate(state,v.candidateId);
    if(v.operation==='assign')return assignLayerCandidate(state,v.candidateId,v.index as number|undefined);
    if(v.operation==='remove')return removeLayerCandidateFromSet(state,v.candidateId);
    throw Error('Unknown curation operation.');
  },
}];
