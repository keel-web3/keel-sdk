import test from 'node:test';
import assert from 'node:assert/strict';
import {createSVGRendererRecipe,prepareSVGRenderer,previewSVGRenderer,parseSVGRendererRecipe} from '../packages/sdk/dist/svg-renderer-authoring.js';
import { SVG_TOOL_DEFINITIONS } from '../packages/mcp/dist/svg-tools.js';
test('creates reusable renderer source from each design without game or mint logic',()=>{
  for(const preset of ['orbit','blocks','blank']){const r=prepareSVGRenderer(createSVGRendererRecipe(preset));assert.match(r.solidity,/is KeelSVGRenderer/);assert.match(r.solidity,/ownerOf\(tokenId\)/);assert.match(r.solidity,/COLLECTION_SEED/);assert.equal(r.compiled,false);assert.equal(r.publicationReady,false);assert.doesNotMatch(r.solidity,/FRAY|mintAccepted|ERC721A|function mint/);}
});
test('preview follows fixed uint256 seed maths and changes by token',()=>{
  const r=createSVGRendererRecipe('orbit');assert.deepEqual(previewSVGRenderer(r,'4'),previewSVGRenderer(r,'4'));assert.notEqual(previewSVGRenderer(r,'4').source,previewSVGRenderer(r,'5').source);
  const changed={...r,colors:{...r.colors,primary:'#123456'}};assert.match(previewSVGRenderer(changed).source,/#123456/);
});
test('bad names, executable XML, unknown variables and excessive source are rejected',()=>{
  const r=createSVGRendererRecipe();for(const patch of [{name:'Bad;contractX'},{name:'KeelSVGRenderer'},{width:0},{height:5000},{artwork:'<script>alert(1)</script>'},{artwork:'<path d="{{unknown}}"/>'},{artwork:'<path fill="url(https://bad)"/>'},{artwork:' '.repeat(8193)},{artwork:'<path d="{{seedX}"/>'}])assert.throws(()=>prepareSVGRenderer({...r,...patch}));
  assert.throws(()=>parseSVGRendererRecipe({...r,privateKey:'no'}));assert.throws(()=>previewSVGRenderer(r,(1n<<256n).toString()));
});
test('custom geometry keeps each placeholder on the contract side',()=>{
  const r={...createSVGRendererRecipe('blank'),artwork:'<rect x="{{seedX}}" y="{{seedY}}" width="{{tokenId}}" height="10" fill="{{seedColor}}"/>'};
  const s=prepareSVGRenderer(r);assert.match(s.solidity,/Strings.toString\(tokenId\)/);assert.match(s.solidity,/uint256\(seed\) >> 24/);assert.doesNotMatch(s.solidity,/\{\{/);
});
test('MCP creates an editable design and source without deployment',async()=>{
  const tool=SVG_TOOL_DEFINITIONS.find(t=>t.descriptor.name==='keel-svg-create');const result=await tool.run({}, {preset:'blocks',tokenId:'7'});assert.equal(result.preview.evidence,'local-preview');assert.match(result.solidity,/contract MySVGRenderer/);assert.equal(result.publicationReady,false);
  await assert.rejects(tool.run({}, {preset:'blocks',recipeJson:'{}'}));
});
