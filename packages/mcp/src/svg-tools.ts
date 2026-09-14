import { inspectKeelSVG, prepareKeelSVGRead, type KeelSVGTarget } from '@keel/sdk/svg-renderer';
import type { ToolDefinition } from './types.js';
import {createSVGRendererRecipe,prepareSVGRenderer,previewSVGRenderer} from '@keel/sdk/svg-renderer-authoring';

export const SVG_TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    descriptor:{name:'keel-svg-create',description:'Create a general contract-driven SVG renderer from an orbit/blocks/blank starting design or a recipe. Returns editable SVG, deterministic token preview and Solidity source. Not FRAY-specific; no proof system or NFT minter is generated. No compilation, signing or deployment.',inputSchema:{type:'object',properties:{preset:{type:'string',enum:['orbit','blocks','blank']},recipeJson:{type:'string',maxLength:16000},tokenId:{type:'string',maxLength:78}},additionalProperties:false}},
    async run(_context,input){const v=input as {preset?:'orbit'|'blocks'|'blank';recipeJson?:string;tokenId?:string};if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!['preset','recipeJson','tokenId'].includes(k))||v.preset&&v.recipeJson||v.recipeJson!==undefined&&(typeof v.recipeJson!=='string'||v.recipeJson.length>16000)||v.tokenId!==undefined&&typeof v.tokenId!=='string')throw Error('Choose a starting design or a recipe and optional token ID.');const recipe=v.recipeJson?JSON.parse(v.recipeJson):createSVGRendererRecipe(v.preset);return {...prepareSVGRenderer(recipe),preview:previewSVGRenderer(recipe,v.tokenId??'1')};},
  },
  {
    descriptor: { name:'keel-svg-inspect', description:'Inspect a KEEL contract-generated SVG and its hidden proof provenance. Checks passive markup and artwork digest. Local evidence only: metadata is not proof of acceptance; verify exact bytes against trusted chain/contract/token coordinates using the SDK or editor.', inputSchema:{type:'object',properties:{svg:{type:'string',maxLength:1500000}},required:['svg'],additionalProperties:false} },
    async run(_context, input) { const v=input as {svg:string}; if(!v || Object.keys(v).join()!=='svg' || typeof v.svg!=='string')throw Error('Supply only svg.'); const {source,artwork,...result}=inspectKeelSVG(v.svg);return {...result,required:['Trusted contract and token coordinates','Finalized same-block code and svg(uint256) readback'],rendererDocs:'docs/KEEL_SVG_RENDERER.md'}; },
  },
  {
    descriptor: { name:'keel-svg-call-plan', description:'Prepare a read-only svg(uint256) call for a native KEEL renderer. No signing, RPC, publication or claimed verification. Use @keel/sdk/svg-renderer readKeelSVG/verifyKeelSVG for finalized contract readback.', inputSchema:{type:'object',properties:{chainId:{type:'integer',minimum:1},address:{type:'string',minLength:42,maxLength:42},tokenId:{type:'string',minLength:1,maxLength:78}},required:['chainId','address','tokenId'],additionalProperties:false} },
    async run(_context,input) { const v=input as KeelSVGTarget; if(!v || Object.keys(v).sort().join()!=='address,chainId,tokenId')throw Error('Supply only chainId, address and tokenId.');return prepareKeelSVGRead(v); },
  },
];
