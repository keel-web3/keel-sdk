import {analyzeLayeredMath} from '@keel/sdk/layered-math';
import {directImageRecipe,directImageCompatibility} from '@keel/sdk/direct-image';
import { checkLayeredArt, resolveLayeredArt, selectLayeredArt, sampleLayeredArt, parseLayeredArt } from '@keel/sdk/layered-art';
import { layeredRevealPlan } from '@keel/sdk/layered-reveal';
import type { ToolDefinition } from './types.js';
export const LAYERED_TOOL_DEFINITIONS: readonly ToolDefinition[] = ['check','select','sample','math','reveal-plan','direct-image-plan'].map(operation=>({
  descriptor:{name:`keel-layered-${operation}`,description:`${operation} a layered NFT manifest: attributes, weighted variants, exceptions and inclusions (conditions use the original draw), masks, meshes and reveal preparation. Local evidence only. Use keel_edit_project layeredJson in the desktop to propose changes; never send reveal keys to an agent.`,inputSchema:{type:'object',properties:{manifestJson:{type:'string',maxLength:2000000},seed:{type:'string',maxLength:256},tokenId:{type:'string',maxLength:78},count:{type:'integer',minimum:1,maximum:1000},...(operation==='direct-image-plan'?{format:{type:'string',enum:['png','svg','gif','webp','apng']},motion:{type:'string',enum:['still','animation']}}:{})},required:['manifestJson'],additionalProperties:false}},
  async run(_context,input){
    const v=input as Record<string,unknown>;if(!v||Array.isArray(v)||Object.keys(v).some(k=>!['manifestJson','seed','tokenId','count',...(operation==='direct-image-plan'?['format','motion']:[])].includes(k))||typeof v.manifestJson!=='string'||v.manifestJson.length>2000000)throw Error('Supply a bounded manifestJson.');
    if(v.seed!==undefined&&typeof v.seed!=='string'||v.tokenId!==undefined&&typeof v.tokenId!=='string'||v.count!==undefined&&typeof v.count!=='number')throw Error('Invalid sample parameters.');
    const manifest=parseLayeredArt(JSON.parse(v.manifestJson));
    if(operation==='direct-image-plan'){const settings={format:v.format??'png',motion:v.motion??'still'};return {...directImageRecipe(manifest,settings),compatibility:directImageCompatibility(settings)};}
    if(operation==='check')return checkLayeredArt(manifest);
    if(operation==='reveal-plan')return layeredRevealPlan(manifest);
    if(operation==='math')return analyzeLayeredMath(manifest,v.count as number??250,v.seed as string??manifest.seed);
    if(operation==='sample')return sampleLayeredArt(manifest,v.count as number??100,v.seed as string??manifest.seed);
    return {...resolveLayeredArt(manifest,await selectLayeredArt(manifest,v.seed as string??manifest.seed,v.tokenId as string??'1')),proof:'local-deterministic-selection'};
  },
}));
