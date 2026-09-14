import { encodeAbiParameters, keccak256, stringToHex, type Hex } from 'viem';
import { validateKeelSVGArtwork } from './svg-renderer.js';

export type SVGRendererRecipe = {
  schema:'keel.svg-renderer-recipe@1'; name:string; width:number; height:number;
  seed:Hex; colors:{background:string;primary:string;accent:string}; artwork:string;
};
export const SVG_RENDERER_VARIABLES = ['background','primary','accent','tokenId','seedColor','seedX','seedY'] as const;
const baseSeed=keccak256(stringToHex('KEEL SVG Renderer'));
export function createSVGRendererRecipe(preset:'orbit'|'blocks'|'blank'='orbit'):SVGRendererRecipe {
  if(!['orbit','blocks','blank'].includes(preset))throw Error('Choose orbit, blocks or blank.');
  const background='<rect width="512" height="512" fill="{{background}}"/>';
  const artwork=preset==='orbit'?`${background}<circle cx="256" cy="256" r="176" fill="none" stroke="{{primary}}" stroke-width="18"/><ellipse cx="256" cy="256" rx="214" ry="78" fill="none" stroke="{{accent}}" stroke-width="12" transform="rotate(-28 256 256)"/><circle cx="{{seedX}}" cy="{{seedY}}" r="52" fill="{{seedColor}}"/><circle cx="256" cy="256" r="64" fill="{{primary}}"/>`:preset==='blocks'?`${background}<rect x="48" y="48" width="256" height="160" fill="{{primary}}"/><rect x="208" y="208" width="256" height="256" fill="{{accent}}"/><rect x="48" y="304" width="112" height="160" fill="{{seedColor}}"/><circle cx="{{seedX}}" cy="{{seedY}}" r="32" fill="{{primary}}"/>`:background;
  return {schema:'keel.svg-renderer-recipe@1',name:'MySVGRenderer',width:512,height:512,seed:baseSeed,colors:{background:'#10121c',primary:'#e8b6ff',accent:'#85f4cd'},artwork};
}
export function parseSVGRendererRecipe(value:unknown):SVGRendererRecipe {
  const r=value as SVGRendererRecipe;
  if(!r||typeof r!=='object'||Object.keys(r).sort().join()!=='artwork,colors,height,name,schema,seed,width'||r.schema!=='keel.svg-renderer-recipe@1'||typeof r.name!=='string'||!/^[A-Z][A-Za-z0-9]{1,39}$/.test(r.name)||['KeelSVGRenderer','Strings','KeelUriEscape','IERC721SVGSource'].includes(r.name))throw Error('Name the renderer using letters and numbers, starting with a capital letter.');
  if(!Number.isInteger(r.width)||r.width<16||r.width>4096||!Number.isInteger(r.height)||r.height<16||r.height>4096)throw Error('Canvas dimensions must be 16–4096.');
  if(typeof r.seed!=='string'||!/^0x[0-9a-f]{64}$/i.test(r.seed)||!r.colors||Object.keys(r.colors).sort().join()!=='accent,background,primary'||Object.values(r.colors).some(c=>typeof c!=='string'||!/^#[0-9a-f]{6}$/i.test(c)))throw Error('Choose three hex colours and a bytes32 collection seed.');
  if(typeof r.artwork!=='string'||r.artwork.length>8192||!r.artwork.trim()||/[^\x20-\x7e\n\r\t]/.test(r.artwork))throw Error('Use up to 8 KB of passive SVG geometry.');
  const variables=[...r.artwork.matchAll(/\{\{([^{}]+)\}\}/g)];
  if(variables.length>128||variables.some(m=>!SVG_RENDERER_VARIABLES.includes(m[1] as any)))throw Error('Use only the supported contract values.');
  const sample=replace(r,'1');
  if(/[{}]/.test(sample))throw Error('Incomplete contract-value placeholder.');
  validateKeelSVGArtwork(sample);
  return structuredClone(r);
}
function values(r:SVGRendererRecipe,tokenId:string) {
  if(!/^(0|[1-9][0-9]{0,77})$/.test(tokenId)||BigInt(tokenId)>=(1n<<256n))throw Error('Use a uint256 token ID.');
  const seed=keccak256(encodeAbiParameters([{type:'bytes32'},{type:'uint256'}],[r.seed,BigInt(tokenId)])),n=BigInt(seed);
  return {...r.colors,tokenId,seedColor:'#'+(n&0xffffffn).toString(16).padStart(6,'0'),seedX:String((n>>24n)%BigInt(r.width)),seedY:String((n>>56n)%BigInt(r.height)),seed};
}
function replace(r:SVGRendererRecipe,tokenId:string) {const v=values(r,tokenId);return r.artwork.replace(/\{\{([^{}]+)\}\}/g,(_,name:keyof typeof v)=>v[name]??'');}
export function previewSVGRenderer(value:unknown,tokenId='1') {
  const recipe=parseSVGRendererRecipe(value),artwork=replace(recipe,tokenId),seed=values(recipe,tokenId).seed;
  return {artwork,seed,source:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${recipe.width} ${recipe.height}" shape-rendering="crispEdges">${artwork}</svg>`,evidence:'local-preview' as const};
}
/** Emits a general renderer adapter, not a glyph, NFT minter or proof system. */
export function prepareSVGRenderer(value:unknown) {
  const recipe=parseSVGRendererRecipe(value);
  const expressions:Record<string,string>={background:JSON.stringify(recipe.colors.background),primary:JSON.stringify(recipe.colors.primary),accent:JSON.stringify(recipe.colors.accent),tokenId:'Strings.toString(tokenId)',seedColor:'string.concat("#", _colour(uint24(uint256(seed))))',seedX:`Strings.toString((uint256(seed) >> 24) % ${recipe.width})`,seedY:`Strings.toString((uint256(seed) >> 56) % ${recipe.height})`};
  const parts=recipe.artwork.split(/\{\{([^{}]+)\}\}/g).map((part,index)=>index%2?expressions[part]!:JSON.stringify(part));
  const solidity=`// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;
import {KeelSVGRenderer} from "@keel/keel-harness/KeelSVGRenderer.sol";
import {KeelUriEscape} from "@keel/keel-kernel/libraries/KeelUriEscape.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
interface IERC721SVGSource { function ownerOf(uint256 tokenId) external view returns(address); }

/// @notice Generated by KEEL SVG Renderer Builder. Data comes from the NFT contract.
/// @dev Immutable collection/seed. This renderer cannot mint or transfer NFTs.
contract ${recipe.name} is KeelSVGRenderer {
    address public immutable collection;
    bytes32 public constant COLLECTION_SEED = ${recipe.seed};
    constructor(address collection_) {
        require(collection_.code.length != 0, "Collection must be deployed");
        collection = collection_;
    }
    function _colour(uint24 value) private pure returns(string memory) {
        bytes16 digits = "0123456789abcdef";
        bytes memory out = new bytes(6);
        for(uint256 i; i<6; ++i) out[5-i] = digits[(value >> (i*4)) & 15];
        return string(out);
    }
    function _svgDocument(uint256 tokenId) internal view override
        returns(bytes memory art, uint32 width, uint32 height, SVGProof memory context)
    {
        require(IERC721SVGSource(collection).ownerOf(tokenId) != address(0), "Token does not exist");
        bytes32 seed = keccak256(abi.encode(COLLECTION_SEED, tokenId));
        art = abi.encodePacked(${parts.join(',\n            ')});
        context.source = collection;
        context.seed = seed;
        // No proof is claimed for ordinary artwork. Hidden proof metadata is null.
        return (art, ${recipe.width}, ${recipe.height}, context);
    }
    function imageURI(uint256 tokenId) external view returns(string memory) {
        return string(KeelUriEscape.escapePrefixed(bytes(svg(tokenId)), "data:image/svg+xml,"));
    }
}
`;
  return {recipe,solidity,fileName:`${recipe.name}.sol`,preview:previewSVGRenderer(recipe),publicationReady:false,compiled:false,dependencies:['keel-contracts','OpenZeppelin Contracts'],constructor:{collection:'address of your deployed ERC-721/ERC-721A collection'},evidence:'source-prepared' as const};
}
